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
import { addMissingById, cloudNeuronToLocal, cloudMemoryToLocal, cloudChatToLocal, refreshNeuronsFromCloud } from "./cloudRestore.js";

export const SYNC_STATUS_KEY = "memorycarl_neurochat_sync_status";
const HISTORY_KEY = "memorycarl_neurochat_history";
const MAX_CHAT_MESSAGES = 100;
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
    const text = status.ok
      ? `☁️ NeuroChat sincronizado (${status.sizeKB} KB: ${status.counts?.neurons || 0} neuronas, ${status.counts?.days || 0} días)`
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

/** Payload mínimo: solo los campos que /api/sync guarda. */
export function buildSyncPayload() {
  const neurons = getAllNeurons().map((n) => ({
    id: n.id,
    core: n.core,
    triggers: n.triggers,
    emotion: n.emotion,
    weight: n.weight,
    temporal: n.temporal,
  }));
  const memories = getAllMemories().map((m) => ({
    id: m.id,
    title: m.title,
    text: m.text,
    date: m.date,
    emotion: m.emotion,
    tags: m.tags,
    linkedNeurons: m.linkedNeurons,
    importance: m.importance,
    temporal: m.temporal,
  }));
  const days = getAllDays().map((d) => ({
    id: d.id,
    date: d.date,
    summary: d.summary,
    dominantEmotion: d.dominantEmotion,
    dominantThemes: d.dominantThemes,
    insights: d.insights,
    isMilestone: d.isMilestone,
  }));
  // Usuario y asistente comparten messageId: se separa por rol para que el backend no los junte
  const chatHistory = readJsonArray(HISTORY_KEY).slice(-MAX_CHAT_MESSAGES)
    .filter((m) => m && m.content)
    .map((m) => ({ messageId: `${m.messageId || m.ts}_${m.role}`, role: m.role, content: m.content, meta: { ts: m.ts } }));
  const appState = { lifeFacts: loadLifeFacts(), openThreads: loadOpenThreads() };
  return { neurons, memories, chatHistory, days, appState };
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
 * Sube los datos de NeuroChat ahora mismo.
 * @returns {Promise<object>} estado guardado ({ ok, at, httpStatus, sizeKB, message, ... })
 */
export async function pushNeurochatNow() {
  const { url, key } = getApiConfig();
  if (!key) return saveSyncStatus({ ok: false, at: Date.now(), kind: "push", message: "Falta la API key del servidor (Ajustes de NeuroChat → Carl API, o la key de sincronización de la app)." });

  let body;
  try {
    body = JSON.stringify(buildSyncPayload());
  } catch (err) {
    return saveSyncStatus({ ok: false, at: Date.now(), kind: "push", message: `No se pudo preparar el envío: ${err.message}` });
  }
  const sizeKB = Math.round(body.length / 1024);
  try {
    const res = await fetchWithTimeout(`${url}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body,
      // keepalive solo admite cuerpos de hasta 64 KB
      keepalive: body.length < 60000,
    });
    if (!res.ok) {
      const msg = await readError(res);
      return saveSyncStatus({ ok: false, at: Date.now(), kind: "push", httpStatus: res.status, sizeKB, message: res.status === 413 ? `El envío es demasiado grande (${sizeKB} KB).` : msg });
    }
    const json = await res.json().catch(() => ({}));
    const data = json?.data || {};
    const errors = Array.isArray(data.errors) ? data.errors : [];
    return saveSyncStatus({
      ok: errors.length === 0,
      partial: errors.length > 0,
      at: Date.now(),
      kind: "push",
      httpStatus: res.status,
      sizeKB,
      counts: { neurons: data.neuronsSynced || 0, memories: data.memoriesSynced || 0, chat: data.chatSynced || 0, days: data.daysSynced || 0, appState: Boolean(data.appStateSynced) },
      message: errors.length ? errors.join(" · ") : "",
    });
  } catch (err) {
    const msg = err?.name === "AbortError" ? "El servidor tardó demasiado en responder." : `Sin conexión con el servidor (${err?.message || err}).`;
    return saveSyncStatus({ ok: false, at: Date.now(), kind: "push", sizeKB, message: msg });
  }
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
  if (needsPush) schedulePush();
  return { ok: true, changed, added };
}
