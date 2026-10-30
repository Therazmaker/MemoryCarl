/**
 * neurochatSync.js — Sincronización de NeuroChat con Supabase (vía /api/sync y /api/restore)
 * MemoryCarl / NeuroChat
 *
 * - Envía solo lo que el backend guarda (neuronas sin embeddings, días sin chat, últimos
 *   mensajes, hechos e hilos de "Ahora"), para no superar el límite de 4,5 MB de Vercel.
 *   Finanzas, sueño y ánimo los sincroniza la app principal por su cuenta.
 * - Agrupa las subidas: muchos guardados seguidos producen una sola petición.
 * - Al restaurar solo AÑADE lo que falta en el teléfono (ver cloudRestore.js).
 * - Guarda el resultado de la última sincronización para mostrarlo en Ajustes.
 */

import { getAllNeurons } from "../neuro/neuronStore.js";
import { getAllMemories } from "../memory/memoryStore.js";
import { getAllDays, mergeDaysFromCloud } from "../day/dayStore.js";
import { loadLifeFacts, LIFE_FACTS_KEY } from "../chat/lifeFacts.js";
import { loadOpenThreads, OPEN_THREADS_KEY } from "../chat/openThreads.js";
import { mergeLifeLists } from "../chat/lifeChanges.js";
import { loadOutbox, markChanged, markAppStateChanged, ackSent, pendingCount, chatKey } from "./syncOutbox.js";
import { getFullChatHistory } from "../chat/neurochat.js";
import { addMissingById, cloudNeuronToLocal, cloudMemoryToLocal, cloudChatToLocal, refreshNeuronsFromCloud } from "./cloudRestore.js";

export const SYNC_STATUS_KEY = "memorycarl_neurochat_sync_status";
const HISTORY_KEY = "memorycarl_neurochat_history";
const PUSH_DEBOUNCE_MS = 2500;
const TIMEOUT_MS = 30000;

// Servidor que usa la app principal para sincronizar finanzas, sueño y ánimo
const MAIN_APP_API_URL = "https://memory-carl.vercel.app";

/**
 * URL y key del servidor. Si NeuroChat no tiene las suyas en Ajustes, usa las de la
 * sincronización de la app principal (misma API, misma API_SECRET_KEY).
 */
export function getApiConfig() {
  try {
    const ownUrl = (localStorage.getItem("memorycarl_api_url") || "").trim();
    const ownKey = (localStorage.getItem("memorycarl_api_key") || "").trim();
    const mainKey = (localStorage.getItem("memorycarl_script_api_key") || "").trim();
    const key = ownKey || mainKey;
    const url = (ownUrl || (key ? MAIN_APP_API_URL : "")).replace(/\/+$/, "");
    return { url, key, source: ownKey ? "neurochat" : mainKey ? "app" : "none" };
  } catch (_e) {
    return { url: "", key: "", source: "none" };
  }
}

function readJsonArray(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (_e) {
    return [];
  }
}

/** Estado de la última sincronización (para Ajustes). */
export function getSyncStatus() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_STATUS_KEY) || "null");
  } catch (_e) {
    return null;
  }
}

// Deja el resultado en la consola de la app (la misma donde aparece la sync de finanzas)
function logToAppConsole(status) {
  if (typeof window === "undefined" || !Array.isArray(window.__mcLogs)) return;
  const time = new Date().toLocaleTimeString("es-PE");
  if (status.kind === "push") {
    const c = status.counts || {};
    if (status.ok && !c.neurons && !c.memories && !c.days && !c.chat && !c.appState && !c.deleted) return; // nada que subir
    const text = status.ok
      ? `☁️ NeuroChat sincronizado (${status.counts?.neurons || 0} neuronas, ${status.counts?.days || 0} días, ${status.counts?.chat || 0} mensajes${status.pending ? `; quedan ${status.pending}` : ""})`
      : `☁️ NeuroChat NO sincronizado${status.httpStatus ? ` (HTTP ${status.httpStatus})` : ""}: ${status.message}`;
    window.__mcLogs.push({ time, type: status.ok ? "info" : "error", text });
  } else if (status.pullOk === false) {
    window.__mcLogs.push({ time, type: "error", text: `☁️ NeuroChat no pudo leer Supabase: ${status.pullMessage}` });
  }
}

function saveSyncStatus(status) {
  try {
    localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status));
  } catch (_e) {}
  logToAppConsole(status);
  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new CustomEvent("neurochat-sync-status", { detail: status })); } catch (_e) {}
  }
  return status;
}

// Tandas por petición (muy por debajo del límite de 4,5 MB de Vercel)
const BATCH_LIMITS = { neurons: 150, memories: 100, days: 10, chat: 200 };
const MAX_BATCHES_PER_PUSH = 40;
// Tamaño máximo por petición (Vercel rechaza por encima de 4,5 MB)
const MAX_BODY_BYTES = 3 * 1024 * 1024;
export const BACKFILL_FLAG = "memorycarl_sync_backfill_v2";

// La neurona viaja completa salvo el embedding (se recalcula en el teléfono)
function neuronForCloud(n) {
  const { embedding, ...rest } = n;
  return rest;
}

// Bytes reales que se envían (UTF-8): con tildes o emojis es más que el número de caracteres
function byteLength(str) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str).length;
  return unescape(encodeURIComponent(str)).length;
}

// Marca de que ya se leyó la nube con éxito alguna vez (antes de subir todo lo local)
export const PULLED_ONCE_FLAG = "memorycarl_sync_pulled_once";

// El día viaja completo salvo la copia de "deshacer" (duplicaría su tamaño)
function dayForCloud(d) {
  const { _previousVersion, ...rest } = d;
  return rest;
}

// Último recurso para un elemento que por sí solo no cabe: se sube sin las partes pesadas
function shrinkPayload(payload) {
  return {
    ...payload,
    days: (payload.days || []).map((d) => ({ ...d, rawChat: (d.rawChat || []).slice(-300).map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 4000), ts: m.ts })) })),
    neurons: (payload.neurons || []).map(({ evolution, evidence, ...n }) => n),
    memories: (payload.memories || []).map((m) => ({ ...m, text: String(m.text || "").slice(0, 20000) })),
    chatHistory: (payload.chatHistory || []).map((c) => ({ ...c, content: String(c.content || "").slice(0, 20000) })),
  };
}

function chatForCloud(m) {
  // Usuario y asistente comparten messageId: se separa por rol para que el backend no los junte
  return { messageId: `${m.messageId || m.ts}_${m.role}`, role: m.role, content: m.content, meta: { ts: m.ts, messageId: m.messageId || null } };
}

/**
 * La primera vez pone en la cola todo lo que hay en el teléfono, para que Supabase
 * recupere lo que no se subió (por ejemplo, desde julio).
 * @returns {Promise<boolean>} si se encoló
 */
export async function queueFullBackfill() {
  try {
    if (localStorage.getItem(BACKFILL_FLAG) === "1") return false;
    if (localStorage.getItem(PULLED_ONCE_FLAG) !== "1") return false;
  } catch (_e) {
    return false;
  }
  markChanged("neurons", getAllNeurons({ includeDeleted: true }).map((n) => n.id));
  markChanged("memories", getAllMemories().map((m) => m.id));
  markChanged("days", getAllDays().map((d) => d.date));
  try {
    const history = await getFullChatHistory();
    markChanged("chat", history.filter((m) => m?.content).map(chatKey));
  } catch (_e) {}
  markAppStateChanged();
  try { localStorage.setItem(BACKFILL_FLAG, "1"); } catch (_e) {}
  return true;
}

/**
 * Prepara una tanda con los cambios pendientes de la cola.
 * @returns {Promise<{ payload: object, sent: object, empty: boolean }>}
 */
export async function buildOutboxBatch(limits = BATCH_LIMITS) {
  const box = loadOutbox();
  const take = (kind) => Object.entries(box[kind] || {})
    .sort((x, y) => x[1].seq - y[1].seq)
    .slice(0, limits[kind]);
  const sent = { neurons: {}, memories: {}, days: {}, chat: {}, appState: 0 };
  const deleted = { neurons: [], memories: [], days: [] };

  const collect = (kind, entries, list, keyOf, convert) => {
    const byKey = new Map(list.map((x) => [String(keyOf(x)), x]));
    const out = [];
    for (const [key, entry] of entries) {
      sent[kind][key] = entry.seq;
      const item = byKey.get(key);
      if (entry.op === "delete" || !item) deleted[kind].push(key);
      else out.push(convert(item));
    }
    return out;
  };

  const nEntries = take("neurons");
  const mEntries = take("memories");
  const dEntries = take("days");
  const cEntries = take("chat");
  const neurons = nEntries.length ? collect("neurons", nEntries, getAllNeurons({ includeDeleted: true }), (n) => n.id, neuronForCloud) : [];
  const memories = mEntries.length ? collect("memories", mEntries, getAllMemories(), (m) => m.id, (m) => m) : [];
  const days = dEntries.length ? collect("days", dEntries, getAllDays(), (d) => d.date, dayForCloud) : [];

  let chatHistory = [];
  if (cEntries.length) {
    let history = [];
    try { history = await getFullChatHistory(); } catch (_e) {}
    const byKey = new Map(history.map((m) => [chatKey(m), m]));
    for (const [key, entry] of cEntries) {
      sent.chat[key] = entry.seq;
      const msg = byKey.get(key);
      if (msg?.content) chatHistory.push(chatForCloud(msg));
    }
  }

  const payload = { neurons, memories, days, chatHistory, deleted };
  if (box.appState) {
    sent.appState = box.appState;
    payload.appState = { lifeFacts: loadLifeFacts(), openThreads: loadOpenThreads() };
  }
  const empty = !nEntries.length && !mEntries.length && !dEntries.length && !cEntries.length && !box.appState;
  const items = nEntries.length + mEntries.length + dEntries.length + cEntries.length;
  return { payload, sent, empty, items };
}

// Qué secciones fallaron en el servidor, según el texto de cada error
function failedSections(errors = []) {
  const text = errors.join(" ").toLowerCase();
  return {
    neurons: /neurona/.test(text),
    memories: /memoria/.test(text),
    chat: /historial/.test(text),
    days: /d[ií]as/.test(text),
    appState: /app_state|finance|estado/.test(text),
  };
}

async function fetchWithTimeout(url, opts) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    return await fetch(url, { ...opts, ...(ctrl ? { signal: ctrl.signal } : {}) });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readError(res) {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return json.message || json.error || text;
  } catch (_e) {
    return text || `HTTP ${res.status}`;
  }
}

/**
 * Sube los cambios pendientes de la cola, en tandas, hasta vaciarla.
 * @returns {Promise<object>} estado guardado ({ ok, at, httpStatus, sizeKB, message, counts, pending })
 */
export async function pushNeurochatNow() {
  const { url, key } = getApiConfig();
  if (!key) return saveSyncStatus({ ok: false, at: Date.now(), kind: "push", pending: pendingCount(), message: "Falta la API key del servidor (Ajustes de NeuroChat → Carl API, o la key de sincronización de la app)." });

  // Subida inicial de todo lo local (una vez). Siempre después de haber leído la nube con
  // éxito, para que un dispositivo con datos viejos no pise lo más reciente.
  try {
    if (localStorage.getItem(BACKFILL_FLAG) !== "1") {
      let pulled = localStorage.getItem(PULLED_ONCE_FLAG) === "1";
      if (!pulled) pulled = (await pullNeurochat()).ok;
      if (pulled) await queueFullBackfill();
    }
  } catch (_e) {}

  const counts = { neurons: 0, memories: 0, chat: 0, days: 0, deleted: 0, appState: false };
  let totalKB = 0;
  let fullData = true;
  const errors = [];

  for (let i = 0; i < MAX_BATCHES_PER_PUSH; i++) {
    let batch;
    let body;
    try {
      // Se arma la tanda y, si pesa demasiado, se parte a la mitad hasta que quepa
      let limits = { ...BATCH_LIMITS };
      batch = await buildOutboxBatch(limits);
      body = JSON.stringify(batch.payload);
      while (byteLength(body) > MAX_BODY_BYTES && batch.items > 1) {
        limits = Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, Math.max(1, Math.floor(v / 2))]));
        if (Object.values(limits).every((v) => v === 1) && batch.items <= 4) {
          limits = { neurons: 1, memories: 0, days: 0, chat: 0 };
          for (const k of ["neurons", "memories", "days", "chat"]) {
            if (Object.keys(loadOutbox()[k] || {}).length) { limits = { neurons: 0, memories: 0, days: 0, chat: 0, [k]: 1 }; break; }
          }
        }
        batch = await buildOutboxBatch(limits);
        body = JSON.stringify(batch.payload);
      }
      // Un solo elemento que no cabe: se sube recortado para no bloquear la cola
      if (byteLength(body) > MAX_BODY_BYTES) body = JSON.stringify(shrinkPayload(batch.payload));
    } catch (err) {
      return saveSyncStatus({ ok: false, at: Date.now(), kind: "push", pending: pendingCount(), message: `No se pudo preparar el envío: ${err.message}` });
    }
    if (batch.empty) break;

    const sizeKB = Math.round(byteLength(body) / 1024);
    totalKB += sizeKB;
    let res;
    try {
      res = await fetchWithTimeout(`${url}/api/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body,
        // keepalive solo admite cuerpos de hasta 64 KB
        keepalive: body.length < 60000,
      });
    } catch (err) {
      const msg = err?.name === "AbortError" ? "El servidor tardó demasiado en responder." : `Sin conexión con el servidor (${err?.message || err}).`;
      return saveSyncStatus({ ok: false, at: Date.now(), kind: "push", sizeKB, pending: pendingCount(), message: msg });
    }
    if (!res.ok) {
      const msg = await readError(res);
      return saveSyncStatus({ ok: false, at: Date.now(), kind: "push", httpStatus: res.status, sizeKB, pending: pendingCount(), message: res.status === 413 ? `El envío es demasiado grande (${sizeKB} KB).` : msg });
    }

    const data = (await res.json().catch(() => ({})))?.data || {};
    const batchErrors = Array.isArray(data.errors) ? data.errors : [];
    if (data.fullData === false) fullData = false;
    // Solo se quita de la cola lo que el servidor guardó; lo que falló se reintenta
    const failed = failedSections(batchErrors);
    ackSent({
      neurons: failed.neurons ? {} : batch.sent.neurons,
      memories: failed.memories ? {} : batch.sent.memories,
      days: failed.days ? {} : batch.sent.days,
      chat: failed.chat ? {} : batch.sent.chat,
      appState: failed.appState ? 0 : batch.sent.appState,
    });
    counts.neurons += data.neuronsSynced || 0;
    counts.memories += data.memoriesSynced || 0;
    counts.chat += data.chatSynced || 0;
    counts.days += data.daysSynced || 0;
    counts.deleted += Object.values(data.deleted || {}).reduce((a, b) => a + b, 0);
    counts.appState = counts.appState || Boolean(data.appStateSynced);
    if (batchErrors.length) {
      errors.push(...batchErrors);
      break; // no insistir en esta ronda; queda en la cola para el siguiente intento
    }
  }

  const pending = pendingCount();
  return saveSyncStatus({
    ok: errors.length === 0,
    partial: errors.length > 0,
    at: Date.now(),
    kind: "push",
    sizeKB: totalKB,
    counts,
    pending,
    fullData,
    message: errors.length ? errors.join(" · ") : fullData ? "" : "Supabase no tiene la columna data: se guardó la versión resumida.",
  });
}

let pushTimer = null;
let pushInFlight = null;

/**
 * Programa una subida (agrupa las llamadas seguidas). Con `immediate` sube ya.
 * @returns {Promise<object>|null}
 */
export function schedulePush({ immediate = false } = {}) {
  if (immediate) {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    pushInFlight = (pushInFlight || Promise.resolve()).then(() => pushNeurochatNow()).finally(() => { pushInFlight = null; });
    return pushInFlight;
  }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    schedulePush({ immediate: true });
  }, PUSH_DEBOUNCE_MS);
  return null;
}

/**
 * Restaura desde la nube sin pisar nada local: añade neuronas, memorias y días que falten,
 * fusiona hechos e hilos por versión más reciente y restaura el chat solo si no hay ninguno.
 * @param {{ hasLocalChat?: () => Promise<boolean> }} [opts]
 * @returns {Promise<{ ok: boolean, changed: boolean, message?: string, added?: object }>}
 */
export async function pullNeurochat(opts = {}) {
  const { url, key } = getApiConfig();
  if (!url || !key) return { ok: false, changed: false, message: "Falta la URL o la API key del servidor." };
  let data;
  try {
    const res = await fetchWithTimeout(`${url}/api/restore`, { method: "GET", headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      const message = await readError(res);
      saveSyncStatus({ ...(getSyncStatus() || {}), kind: "pull", pullOk: false, pullAt: Date.now(), pullMessage: message });
      return { ok: false, changed: false, message };
    }
    data = (await res.json())?.data;
  } catch (err) {
    const message = `Sin conexión con el servidor (${err?.message || err}).`;
    saveSyncStatus({ ...(getSyncStatus() || {}), kind: "pull", pullOk: false, pullAt: Date.now(), pullMessage: message });
    return { ok: false, changed: false, message };
  }
  if (!data) return { ok: true, changed: false };

  let changed = false;
  let needsPush = false;
  const added = { neurons: 0, memories: 0, days: 0, chat: 0 };

  const addMissing = (storageKey, cloudList, convert, field) => {
    if (!Array.isArray(cloudList) || !cloudList.length) return;
    const { list, added: n } = addMissingById(readJsonArray(storageKey), cloudList, convert);
    if (n) {
      localStorage.setItem(storageKey, JSON.stringify(list));
      added[field] = n;
      changed = true;
    }
  };
  // Neuronas que otro dispositivo actualizó después de la última edición local
  if (Array.isArray(data.neurons) && data.neurons.length) {
    const { list, updated } = refreshNeuronsFromCloud(readJsonArray("memorycarl_neurochat_neurons"), data.neurons);
    if (updated) {
      localStorage.setItem("memorycarl_neurochat_neurons", JSON.stringify(list));
      added.updatedNeurons = updated;
      changed = true;
    }
  }
  addMissing("memorycarl_neurochat_neurons", data.neurons, cloudNeuronToLocal, "neurons");
  addMissing("memorycarl_memories_v1", data.memories, cloudMemoryToLocal, "memories");

  if (Array.isArray(data.chatHistory) && data.chatHistory.length && !readJsonArray(HISTORY_KEY).length) {
    const hasLocal = opts.hasLocalChat ? await opts.hasLocalChat().catch(() => true) : true;
    if (!hasLocal) {
      const msgs = data.chatHistory.map(cloudChatToLocal).filter(Boolean)
        .map((m) => ({ ...m, messageId: String(m.messageId || "").replace(/_(user|assistant)$/, "") }))
        .slice(-50);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs));
      added.chat = msgs.length;
      changed = true;
    }
  }

  if (Array.isArray(data.days) && data.days.length && mergeDaysFromCloud(data.days)) {
    changed = true;
    added.days = 1;
  }

  const mergeKey = (storageKey, cloudList) => {
    if (!Array.isArray(cloudList) || !cloudList.length) return;
    const localList = readJsonArray(storageKey);
    const merged = mergeLifeLists(localList, cloudList);
    const mergedJson = JSON.stringify(merged);
    if (mergedJson !== JSON.stringify(localList)) {
      localStorage.setItem(storageKey, mergedJson);
      changed = true;
    }
    if (mergedJson !== JSON.stringify(cloudList)) needsPush = true;
  };
  mergeKey(LIFE_FACTS_KEY, data.lifeFacts || data.appState?.lifeFacts);
  mergeKey(OPEN_THREADS_KEY, data.openThreads || data.appState?.openThreads);

  saveSyncStatus({ ...(getSyncStatus() || {}), kind: "pull", pullOk: true, pullAt: Date.now(), pullMessage: "" });
  try { localStorage.setItem(PULLED_ONCE_FLAG, "1"); } catch (_e) {}
  if (needsPush) schedulePush();
  return { ok: true, changed, added };
}
