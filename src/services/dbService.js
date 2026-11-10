/**
 * =====================================================================================
 * dbService.js — Motor Unificado de Sincronización de Doble Capa (Local-First + Supabase)
 * MemoryCarl — Edición Ultra-Ligera Anti-OOM para Móviles
 * =====================================================================================
 *
 * ¿POR QUÉ NUNCA CONSUME RAM DE MÁS NI CUELGA EL NAVEGADOR MÓVIL?
 * 1. Cola Offline Ultra-Ligera (`memorycarl_offline_queue_v4`):
 *    Guarda ÚNICAMENTE `{ t: tabla, id: clave, op: 'u'|'d', seq }` (sin duplicar los objetos
 *    pesados dentro de la cola). 1,200 cambios ocupan apenas ~35 KB en lugar de 15 MB.
 * 2. Encolado en una Sola Pasada (Single-Pass Batch):
 *    `captureLocalChangesToQueue()` modifica la cola en memoria y hace 1 solo `JSON.stringify`
 *    al terminar (antes hacía 1,198 serializaciones seguidas y saturaba la RAM del teléfono).
 * 3. Subida por Micro-Tandas (`BATCH_SIZE = 40`) con Pausa de Respiración (`40 ms`):
 *    Si hay 1,198 elementos pendientes, los sube de 40 en 40 (~60 KB por petición),
 *    actualizando el contador en vivo (`⟳ Sincronizando (1158)...` -> `1118` -> ... -> `✓ Sincronizado`)
 *    y liberando memoria entre tanda y tanda para que el recolector de basura del móvil
 *    mantenga la pestaña rápida y fluida.
 * =====================================================================================
 */

import { hydrateUnlimitedStorage, getStorageStats } from "./unlimitedStorage.js";
import { getAllNeurons } from "../neuro/neuronStore.js";
import { getAllMemories } from "../memory/memoryStore.js";
import { getAllDays, mergeDaysFromCloud } from "../day/dayStore.js";
import { loadLifeFacts, LIFE_FACTS_KEY } from "../chat/lifeFacts.js";
import { loadOpenThreads, OPEN_THREADS_KEY } from "../chat/openThreads.js";
import { mergeLifeLists } from "../chat/lifeChanges.js";
import { getFullChatHistory } from "../chat/neurochat.js";
import {
  addMissingById,
  cloudNeuronToLocal,
  cloudMemoryToLocal,
  cloudChatToLocal,
  refreshNeuronsFromCloud,
} from "./cloudRestore.js";

// Usamos una nueva clave limpia v4 para descartar cualquier cola pesada v3 que causaba OOM
export const OFFLINE_QUEUE_KEY = "memorycarl_offline_queue_v4";
export const SYNC_HASHES_KEY = "memorycarl_sync_hashes_v4";
export const SYNC_STATUS_KEY = "memorycarl_neurochat_sync_status";
export const SUPABASE_URL_KEY = "memorycarl_supabase_url";
export const SUPABASE_ANON_KEY = "memorycarl_supabase_anon_key";
export const INITIAL_BACKFILL_DONE_KEY = "memorycarl_dbservice_backfill_v4";

const DEFAULT_API_ORIGIN = "https://memory-carl.vercel.app";
const DEBOUNCE_MS = 1200;
const REQUEST_TIMEOUT_MS = 25000;
const BATCH_SIZE = 40; // Micro-tandas de 40 elementos para cero picos de RAM

// Limpiar cualquier rastro de la cola pesada anterior al cargar el módulo
try {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("memorycarl_offline_queue");
    localStorage.removeItem("memorycarl_sync_hashes_v3");
  }
} catch (_e) {}

// =====================================================================================
// 1. GENERADOR DE UUID v4 (Formato nativo PostgreSQL)
// =====================================================================================
export function generateUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

if (typeof window !== "undefined") {
  window.generateUUID = generateUUID;
}

// =====================================================================================
// 2. CONFIGURACIÓN DE CONEXIÓN A SUPABASE (DIRECTA REST + FALLBACK VERCEL API)
// =====================================================================================
let configAutoFetched = false;

export function getSupabaseConfig() {
  try {
    const supabaseUrl = (
      localStorage.getItem(SUPABASE_URL_KEY) ||
      window.__MC_SUPABASE_URL__ ||
      ""
    )
      .trim()
      .replace(/\/+$/, "");

    const supabaseAnonKey = (
      localStorage.getItem(SUPABASE_ANON_KEY) ||
      window.__MC_SUPABASE_ANON_KEY__ ||
      ""
    ).trim();

    const ownApiUrl = (
      localStorage.getItem("memorycarl_api_url") ||
      localStorage.getItem("memorycarl_script_url") ||
      ""
    )
      .trim()
      .replace(/\/+$/, "");

    const apiKey = (
      localStorage.getItem("memorycarl_api_key") ||
      localStorage.getItem("memorycarl_script_api_key") ||
      ""
    ).trim();

    const isVercelOrLocalServer =
      typeof window !== "undefined" &&
      window.location &&
      /^https?:\/\//i.test(window.location.origin) &&
      !window.location.origin.includes("github.io");

    const apiUrl = ownApiUrl || (isVercelOrLocalServer ? window.location.origin : DEFAULT_API_ORIGIN);

    const hasDirectSupabase = Boolean(supabaseUrl && supabaseAnonKey);
    const hasApiSync = Boolean(apiUrl && (apiKey || hasDirectSupabase || isVercelOrLocalServer));

    return {
      supabaseUrl,
      supabaseAnonKey,
      apiUrl,
      apiKey,
      hasDirectSupabase,
      hasApiSync,
      mode: hasDirectSupabase ? "direct" : hasApiSync ? "api" : "unconfigured",
      url: hasDirectSupabase ? supabaseUrl : apiUrl,
      key: supabaseAnonKey || apiKey || (isVercelOrLocalServer ? "auto" : ""),
      source: hasDirectSupabase ? "supabase-direct" : apiKey ? "app" : isVercelOrLocalServer ? "vercel-auto" : "none",
    };
  } catch (_e) {
    return {
      supabaseUrl: "",
      supabaseAnonKey: "",
      apiUrl: DEFAULT_API_ORIGIN,
      apiKey: "",
      hasDirectSupabase: false,
      hasApiSync: false,
      mode: "unconfigured",
      url: "",
      key: "",
      source: "none",
    };
  }
}

export function saveSupabaseConfig({ supabaseUrl, supabaseAnonKey, apiKey, apiUrl } = {}) {
  try {
    if (typeof supabaseUrl === "string") {
      localStorage.setItem(SUPABASE_URL_KEY, supabaseUrl.trim().replace(/\/+$/, ""));
    }
    if (typeof supabaseAnonKey === "string") {
      localStorage.setItem(SUPABASE_ANON_KEY, supabaseAnonKey.trim());
    }
    if (typeof apiKey === "string") {
      localStorage.setItem("memorycarl_script_api_key", apiKey.trim());
      localStorage.setItem("memorycarl_api_key", apiKey.trim());
    }
    if (typeof apiUrl === "string") {
      localStorage.setItem("memorycarl_api_url", apiUrl.trim().replace(/\/+$/, ""));
    }
  } catch (e) {
    console.warn("[dbService] Error guardando configuración de Supabase:", e);
  }
}

export async function autoDiscoverConfig() {
  if (configAutoFetched) return getSupabaseConfig();
  configAutoFetched = true;

  const current = getSupabaseConfig();
  if (current.hasDirectSupabase) return current;

  const candidates = [];
  if (
    typeof window !== "undefined" &&
    window.location?.origin &&
    /^https?:\/\//i.test(window.location.origin) &&
    !window.location.origin.includes("github.io")
  ) {
    candidates.push(window.location.origin);
  }
  if (!candidates.includes(DEFAULT_API_ORIGIN)) {
    candidates.push(DEFAULT_API_ORIGIN);
  }

  for (const base of candidates) {
    try {
      const res = await fetchWithTimeout(`${base}/api/config`, { method: "GET" }, 5000);
      if (!res.ok) continue;
      const json = await res.json();
      if (json?.supabaseUrl && json?.supabaseAnonKey) {
        saveSupabaseConfig({
          supabaseUrl: json.supabaseUrl,
          supabaseAnonKey: json.supabaseAnonKey,
        });
        return getSupabaseConfig();
      }
    } catch (_e) {}
  }
  return getSupabaseConfig();
}

// =====================================================================================
// 3. COLA OFFLINE ULTRA-LIGERA EN MEMORIA (`memQueue`) — CERO DUPLICACIÓN DE DATOS
// =====================================================================================
/**
 * Estructura en memoria y disco:
 * {
 *   seq: number,
 *   items: {
 *     "finance_ledger:550e8400...": { t: "finance_ledger", id: "550e8400...", op: "u" | "d", c: "id", seq: 1 }
 *   }
 * }
 */
let memQueue = null;

export function loadOfflineQueue() {
  if (memQueue) return memQueue;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(OFFLINE_QUEUE_KEY) : null;
    if (!raw) {
      memQueue = { seq: 0, items: {} };
      return memQueue;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.items !== "object") {
      memQueue = { seq: 0, items: {} };
      return memQueue;
    }
    memQueue = parsed;
    return memQueue;
  } catch (_e) {
    memQueue = { seq: 0, items: {} };
    return memQueue;
  }
}

function persistOfflineQueue() {
  if (!memQueue) return;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(memQueue));
    }
  } catch (_e) {}
  updateSyncBannerUI();
}

export function getOfflineQueueCount() {
  const q = loadOfflineQueue();
  return Object.keys(q.items || {}).length;
}

/**
 * Añade una operación a la cola en memoria. Con `persist = false` permite encolar
 * miles de elementos en un bucle y guardar una sola vez al final.
 */
export function enqueueOperation(table, id, op, _rowIgnored = null, conflictColumn = "id", persist = true) {
  if (!table || id === undefined || id === null || id === "") return;
  const q = loadOfflineQueue();
  const key = `${table}:${String(id)}`;
  const seq = (q.seq || 0) + 1;
  q.seq = seq;
  q.items[key] = {
    t: table,
    id: String(id),
    op: op === "delete" || op === "d" ? "d" : "u",
    c: conflictColumn || "id",
    seq,
  };
  if (persist) persistOfflineQueue();
}

export function getPendingIdsForTable(table) {
  const q = loadOfflineQueue();
  const set = new Set();
  for (const item of Object.values(q.items || {})) {
    if (item && item.t === table) set.add(String(item.id));
  }
  return set;
}

export function getPendingDeletesForTable(table) {
  const q = loadOfflineQueue();
  const set = new Set();
  for (const item of Object.values(q.items || {})) {
    if (item && item.t === table && item.op === "d") set.add(String(item.id));
  }
  return set;
}

// =====================================================================================
// 4. TRANSFORMADORES DE MODELO LOCAL <-> FILA SUPABASE (BAJO DEMANDA POR LOTE)
// =====================================================================================
export function mapAccountToRow(a) {
  const id = String(a.id || generateUUID());
  a.id = id;
  return {
    id,
    name: a.name || "Cuenta",
    type: a.type || "bank",
    initial_balance: Number(a.initialBalance ?? a.initial_balance ?? 0),
    balance: Number(a.balance ?? 0),
    color: a.color || null,
    data: a,
    created_at: a.createdAt || a.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function mapRowToAccount(r) {
  if (r.data && typeof r.data === "object" && r.data.name) {
    return {
      ...r.data,
      id: String(r.id),
      balance: Number(r.balance ?? r.data.balance ?? 0),
      initialBalance: Number(r.initial_balance ?? r.data.initialBalance ?? 0),
    };
  }
  return {
    id: String(r.id),
    name: r.name || "Cuenta",
    type: r.type || "bank",
    initialBalance: Number(r.initial_balance || 0),
    balance: Number(r.balance || 0),
    color: r.color || null,
    createdAt: r.created_at || new Date().toISOString(),
  };
}

export function mapMovementToRow(e) {
  const id = String(e.id || generateUUID());
  e.id = id;
  return {
    id,
    account_id: e.accountId || e.account_id || null,
    to_account_id: e.toAccountId || e.to_account_id || null,
    type: e.type || "expense",
    amount: Number(e.amount || 0),
    category: e.category || "Otros",
    reason: e.reason || "normal",
    note: e.note || "",
    date: e.date || new Date().toISOString(),
    is_fiado: Boolean(e.isFiado ?? e.is_fiado),
    fiado_status: e.fiadoStatus || e.fiado_status || null,
    archived: Boolean(e.archived),
    counterparty: e.counterparty || null,
    source_label: e.sourceLabel || e.source_label || null,
    data: e,
    created_at: e.createdAt || e.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function mapRowToMovement(r) {
  if (r.data && typeof r.data === "object" && r.data.amount !== undefined) {
    return {
      ...r.data,
      id: String(r.id),
      accountId: r.account_id || r.data.accountId,
      toAccountId: r.to_account_id || r.data.toAccountId || null,
      type: r.type || r.data.type || "expense",
      amount: Number(r.amount ?? r.data.amount ?? 0),
      category: r.category || r.data.category || "Otros",
      reason: r.reason || r.data.reason || "normal",
      note: r.note ?? r.data.note ?? "",
      date: r.date || r.data.date,
      isFiado: Boolean(r.is_fiado ?? r.data.isFiado),
      fiadoStatus: r.fiado_status || r.data.fiadoStatus || null,
      archived: Boolean(r.archived ?? r.data.archived),
      createdAt: r.created_at || r.data.createdAt,
    };
  }
  return {
    id: String(r.id),
    accountId: r.account_id,
    toAccountId: r.to_account_id || null,
    type: r.type || "expense",
    amount: Number(r.amount || 0),
    category: r.category || "Otros",
    reason: r.reason || "normal",
    note: r.note || "",
    date: r.date || new Date().toISOString(),
    isFiado: Boolean(r.is_fiado),
    fiadoStatus: r.fiado_status || null,
    archived: Boolean(r.archived),
    counterparty: r.counterparty || null,
    sourceLabel: r.source_label || null,
    createdAt: r.created_at || new Date().toISOString(),
  };
}

export function mapDebtToRow(d, kind = "debt") {
  const id = String(d.id || generateUUID());
  d.id = id;
  return {
    id: `${kind}_${id}`.replace(new RegExp(`^${kind}_${kind}_`), `${kind}_`),
    kind,
    name: d.name || d.title || d.counterparty || "Compromiso",
    amount: Number(d.amount ?? d.totalAmount ?? d.monthlyAmount ?? 0),
    balance: Number(d.balance ?? d.remainingAmount ?? d.amount ?? 0),
    status: d.status || (d.paid ? "paid" : "active"),
    due_date: d.dueDate || d.due_date || d.nextDueDate || null,
    data: d,
    created_at: d.createdAt || d.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function mapSleepToRow(s) {
  const id = String(s.id || `sleep_${s.date || generateUUID()}`);
  s.id = id;
  return {
    id,
    date: s.date || new Date().toISOString().split("T")[0],
    total_minutes: Number(s.totalMinutes ?? s.total_minutes ?? 0),
    quality: s.quality !== undefined && s.quality !== null && s.quality !== "" ? Number(s.quality) : null,
    note: s.note || "",
    mode: s.mode || "simple",
    start_time: s.start || s.start_time || "",
    end_time: s.end || s.end_time || "",
    dream_type: s.dreamType || s.dream_type || "",
    wake_emotion: s.wakeEmotion || s.wake_emotion || "",
    narrative: s.narrative || "",
    symbols: Array.isArray(s.symbols) ? s.symbols : [],
    clarity: s.clarity !== undefined && s.clarity !== null && s.clarity !== "" ? Number(s.clarity) : null,
    data: s,
    created_at: s.ts || s.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function mapRowToSleep(r) {
  if (r.data && typeof r.data === "object" && r.data.date) {
    return { ...r.data, id: String(r.id) };
  }
  return {
    id: String(r.id),
    date: r.date,
    totalMinutes: Number(r.total_minutes || 0),
    quality: r.quality,
    note: r.note || "",
    mode: r.mode || "simple",
    start: r.start_time || "",
    end: r.end_time || "",
    dreamType: r.dream_type || "",
    wakeEmotion: r.wake_emotion || "",
    narrative: r.narrative || "",
    symbols: Array.isArray(r.symbols) ? r.symbols : [],
    clarity: r.clarity,
    ts: r.created_at,
  };
}

export function mapNeuronToRow(n) {
  const { embedding, ...cleanNeuron } = n;
  const id = String(n.id || generateUUID());
  return {
    id,
    type: n.type || "memory",
    concept: n.core?.concept || n.concept || "Sin nombre",
    domain: n.core?.domain || n.domain || "general",
    summary: n.core?.summary || n.summary || "",
    triggers: Array.isArray(n.triggers) ? n.triggers : [],
    connections: Array.isArray(n.connections) ? n.connections : [],
    emotion: n.emotion || "neutral",
    weight: typeof n.weight === "number" ? n.weight : 1.0,
    temporal: n.temporal && typeof n.temporal === "object" ? n.temporal : {},
    data: cleanNeuron,
    updated_at: n.updatedAt || new Date().toISOString(),
  };
}

export function mapMemoryToRow(m) {
  const id = String(m.id || generateUUID());
  return {
    id,
    title: m.title || "Memoria",
    snippet: String(m.text || m.snippet || "").substring(0, 120),
    text_content: m.text || m.text_content || "",
    date: m.date || new Date().toISOString().split("T")[0],
    emotion: m.emotion || "neutral",
    tags: Array.isArray(m.tags) ? m.tags : [],
    linked_neurons: Array.isArray(m.linkedNeurons) ? m.linkedNeurons : [],
    importance: m.importance || "medium",
    temporal: m.temporal && typeof m.temporal === "object" ? m.temporal : {},
    data: m,
    updated_at: m.updatedAt || new Date().toISOString(),
  };
}

export function mapDayToRow(d) {
  const { _previousVersion, ...cleanDay } = d;
  // Limitar rawChat por día si es gigantesco para nunca superar límites de red
  if (Array.isArray(cleanDay.rawChat) && cleanDay.rawChat.length > 250) {
    cleanDay.rawChat = cleanDay.rawChat.slice(-250);
  }
  return {
    id: String(d.id || `day_${d.date}`),
    date: String(d.date),
    summary: d.summary || "",
    dominant_emotion: d.dominantEmotion || d.dominant_emotion || "neutral",
    dominant_themes: Array.isArray(d.dominantThemes) ? d.dominantThemes : [],
    insights: Array.isArray(d.insights) ? d.insights : [],
    is_milestone: Boolean(d.isMilestone ?? d.is_milestone),
    status: d.status || "open",
    data: cleanDay,
    updated_at: d.updatedAt || new Date().toISOString(),
  };
}

export function mapChatMsgToRow(m) {
  const derivedId = `${m.messageId || m.id || m.ts}_${m.role || "user"}`;
  return {
    id: derivedId,
    message_id: derivedId,
    role: m.role || "user",
    content: String(m.content || m.text || "").slice(0, 15000),
    meta: { ts: m.ts || Date.now(), messageId: m.messageId || m.id || null },
    updated_at: new Date().toISOString(),
  };
}

// =====================================================================================
// 5. DETECCIÓN INCREMENTAL DE CAMBIOS EN UNA SOLA PASADA (CERO PICOS DE RAM)
// =====================================================================================
let memoryHashes = null;

function loadHashes() {
  if (memoryHashes) return memoryHashes;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(SYNC_HASHES_KEY) : null;
    memoryHashes = raw ? JSON.parse(raw) : {};
  } catch (_e) {
    memoryHashes = {};
  }
  return memoryHashes;
}

function saveHashes() {
  if (!memoryHashes) return;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SYNC_HASHES_KEY, JSON.stringify(memoryHashes));
    }
  } catch (_e) {}
}

/**
 * Huella ultrarrápida sin `JSON.stringify` masivo (evita picos de RAM en móviles)
 */
function fastHash(item) {
  if (!item || typeof item !== "object") return String(item);
  // Si es un módulo de app_modules ({ id, payload })
  if (item.payload !== undefined && item.id) {
    const p = item.payload;
    if (Array.isArray(p)) return `arr:${p.length}:${p[p.length - 1]?.id || p[p.length - 1]?.updatedAt || ""}`;
    if (p && typeof p === "object") {
      const keys = Object.keys(p);
      return `obj:${keys.length}:${keys.map((k) => (Array.isArray(p[k]) ? p[k].length : typeof p[k])).join(",")}`;
    }
    return String(p);
  }
  // Si es un día de NeuroChat
  if (item.date && Array.isArray(item.rawChat)) {
    const lastTs = item.rawChat[item.rawChat.length - 1]?.ts || 0;
    return `day:${item.date}:${item.rawChat.length}:${lastTs}:${(item.summary || "").length}:${item.updatedAt || ""}`;
  }
  // Si es una neurona
  if (item.core && typeof item.core === "object") {
    return `neu:${item.id}:${item.updatedAt || ""}:${(item.core.concept || "").length}:${(item.core.summary || "").length}:${(item.triggers || []).length}:${(item.connections || []).length}:${item.weight || 0}`;
  }
  // Si es un movimiento o cuenta financiera
  if (item.amount !== undefined || item.balance !== undefined) {
    return `fin:${item.id}:${item.amount ?? item.balance ?? 0}:${item.type || ""}:${item.category || ""}:${item.note || ""}:${item.archived ? 1 : 0}:${item.fiadoStatus || ""}`;
  }
  // Si es un mensaje de chat
  if (item.role && item.content !== undefined) {
    return `msg:${item.ts || ""}:${item.role}:${(item.content || "").length}`;
  }
  // Fallback ligero para objetos pequeños
  return `${item.id || ""}:${item.updatedAt || item.ts || item.date || ""}:${item.name || item.title || item.note || ""}`;
}

function diffTableListInMemory(table, list, getKey, conflictColumn = "id") {
  const hashes = loadHashes();
  if (!hashes[table]) hashes[table] = {};
  const prevMap = hashes[table];
  const nextMap = {};
  let changes = 0;

  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== "object") continue;
    const key = String(getKey(item));
    if (!key) continue;
    const h = fastHash(item);
    nextMap[key] = h;
    if (prevMap[key] !== h) {
      enqueueOperation(table, key, "u", null, conflictColumn, false);
      changes++;
    }
  }

  for (const oldKey of Object.keys(prevMap)) {
    if (!(oldKey in nextMap)) {
      enqueueOperation(table, oldKey, "d", null, conflictColumn, false);
      changes++;
    }
  }

  hashes[table] = nextMap;
  return changes;
}

function getUnifiedMovements() {
  const byId = new Map();
  const stateLedger = (typeof window !== "undefined" && window.state?.financeLedger) || [];
  const financeMovs = (typeof window !== "undefined" && window.FINANCE?.movements) || [];

  for (const m of stateLedger) {
    if (!m) continue;
    if (!m.id) m.id = generateUUID();
    byId.set(String(m.id), m);
  }
  for (const m of financeMovs) {
    if (!m) continue;
    if (!m.id) m.id = generateUUID();
    if (!byId.has(String(m.id))) {
      byId.set(String(m.id), m);
    }
  }
  return Array.from(byId.values());
}

function getAppModulesList() {
  const st = (typeof window !== "undefined" && window.state) || {};
  const list = [
    { id: "routines", payload: st.routines },
    { id: "semana", payload: st.semana },
    { id: "house", payload: st.house },
    { id: "shopping", payload: { shopping: st.shopping, products: st.products, shoppingHistory: st.shoppingHistory } },
    { id: "inventory", payload: { inventory: st.inventory, inventoryLots: st.inventoryLots } },
    { id: "reminders", payload: { reminders: st.reminders, lifeTasks: st.lifeTasks, lifeTasksLog: st.lifeTasksLog } },
    { id: "home_widgets", payload: { musicToday: st.musicToday, musicLog: st.musicLog, budgetMonthly: st.budgetMonthly, calDraw: st.calDraw, moodSpritesCustom: st.moodSpritesCustom, moodActivityCats: st.moodActivityCats } },
    {
      id: "finance_extras",
      payload: {
        financeResetAt: st.financeResetAt,
        financeEntryCategories: st.financeEntryCategories,
        financePaymentSources: st.financePaymentSources,
        financeInternalBalances: st.financeInternalBalances,
        financeInsights: st.financeInsights,
        financeCommitmentTemplates: st.financeCommitmentTemplates,
        financeCommitmentInstances: st.financeCommitmentInstances,
        financeLoanUsageLedger: st.financeLoanUsageLedger,
        financeMeta: st.financeMeta,
      },
    },
    { id: "neurochat_now", payload: { lifeFacts: loadLifeFacts(), openThreads: loadOpenThreads() } },
  ];
  return list.filter((m) => m.payload !== undefined);
}

/**
 * Construye un índice rápido bajo demanda para resolver `table + id` -> fila de Supabase
 * únicamente cuando se está enviando una micro-tanda de 40 elementos.
 */
async function buildLiveLookupForTables(tablesNeeded) {
  const st = (typeof window !== "undefined" && window.state) || {};
  const lookup = {};

  if (tablesNeeded.has("finance_accounts")) {
    const map = new Map();
    for (const a of st.financeAccounts || []) {
      if (a) map.set(String(a.id || (a.id = generateUUID())), () => mapAccountToRow(a));
    }
    lookup.finance_accounts = map;
  }

  if (tablesNeeded.has("finance_ledger")) {
    const map = new Map();
    for (const m of getUnifiedMovements()) {
      if (m) map.set(String(m.id || (m.id = generateUUID())), () => mapMovementToRow(m));
    }
    lookup.finance_ledger = map;
  }

  if (tablesNeeded.has("finance_debts")) {
    const map = new Map();
    const allDebts = [
      ...(Array.isArray(st.financeDebts) ? st.financeDebts.map((d) => ({ _kind: "debt", item: d })) : []),
      ...(Array.isArray(st.financeCommitments) ? st.financeCommitments.map((c) => ({ _kind: "commitment", item: c })) : []),
      ...(Array.isArray(st.financeObligations) ? st.financeObligations.map((o) => ({ _kind: "obligation", item: o })) : []),
    ];
    for (const entry of allDebts) {
      if (!entry.item.id) entry.item.id = generateUUID();
      const key = `${entry._kind}_${entry.item.id}`.replace(new RegExp(`^${entry._kind}_${entry._kind}_`), `${entry._kind}_`);
      map.set(key, () => mapDebtToRow(entry.item, entry._kind));
    }
    lookup.finance_debts = map;
  }

  if (tablesNeeded.has("sleep_log")) {
    const map = new Map();
    for (const s of st.sleepLog || []) {
      if (s) map.set(String(s.id || (s.id = `sleep_${s.date || generateUUID()}`)), () => mapSleepToRow(s));
    }
    lookup.sleep_log = map;
  }

  if (tablesNeeded.has("mood_daily")) {
    const map = new Map();
    if (st.moodDaily && typeof st.moodDaily === "object") {
      for (const [dateKey, val] of Object.entries(st.moodDaily)) {
        const items = Array.isArray(val) ? val : [val];
        items.forEach((e, idx) => {
          if (!e || typeof e !== "object") return;
          const id = String(e.id || `${dateKey}_${e.ts || idx}`);
          map.set(id, () => ({
            id,
            date: dateKey,
            sprite_id: e.spriteId || e.sprite_id || null,
            label: e.label || null,
            activities: Array.isArray(e.activities) ? e.activities : [],
            energy: e.energy !== undefined && e.energy !== null && e.energy !== "" ? Number(e.energy) : null,
            note: e.note || "",
            tags: Array.isArray(e.tags) ? e.tags : [],
            ts: e.ts || new Date().toISOString(),
            data: e,
            updated_at: new Date().toISOString(),
          }));
        });
      }
    }
    lookup.mood_daily = map;
  }

  if (tablesNeeded.has("neurons")) {
    const map = new Map();
    try {
      for (const n of getAllNeurons({ includeDeleted: false })) {
        if (n) map.set(String(n.id || (n.id = generateUUID())), () => mapNeuronToRow(n));
      }
    } catch (_e) {}
    lookup.neurons = map;
  }

  if (tablesNeeded.has("memories")) {
    const map = new Map();
    try {
      for (const m of getAllMemories()) {
        if (m) map.set(String(m.id || (m.id = generateUUID())), () => mapMemoryToRow(m));
      }
    } catch (_e) {}
    lookup.memories = map;
  }

  if (tablesNeeded.has("days")) {
    const map = new Map();
    try {
      for (const d of getAllDays()) {
        if (d?.date) map.set(String(d.date), () => mapDayToRow(d));
      }
    } catch (_e) {}
    lookup.days = map;
  }

  if (tablesNeeded.has("chat_history")) {
    const map = new Map();
    try {
      const history = await getFullChatHistory();
      for (const m of Array.isArray(history) ? history : []) {
        if (m?.content) {
          const key = `${m.messageId || m.id || m.ts}_${m.role || "user"}`;
          map.set(key, () => mapChatMsgToRow(m));
        }
      }
    } catch (_e) {}
    lookup.chat_history = map;
  }

  if (tablesNeeded.has("app_modules")) {
    const map = new Map();
    for (const m of getAppModulesList()) {
      map.set(m.id, () => ({
        id: m.id,
        module_name: m.id,
        payload: m.payload,
        updated_at: new Date().toISOString(),
      }));
    }
    lookup.app_modules = map;
  }

  return lookup;
}

export async function captureLocalChangesToQueue({ forceAll = false } = {}) {
  const hashes = loadHashes();
  if (forceAll) {
    for (const k of Object.keys(hashes)) delete hashes[k];
  }

  let totalChanges = 0;
  const st = (typeof window !== "undefined" && window.state) || {};

  if (Array.isArray(st.financeAccounts)) {
    totalChanges += diffTableListInMemory(
      "finance_accounts",
      st.financeAccounts,
      (a) => a.id || (a.id = generateUUID())
    );
  }

  const movements = getUnifiedMovements();
  if (movements.length > 0 || hashes.finance_ledger) {
    totalChanges += diffTableListInMemory(
      "finance_ledger",
      movements,
      (m) => m.id || (m.id = generateUUID())
    );
  }

  const allDebts = [
    ...(Array.isArray(st.financeDebts) ? st.financeDebts.map((d) => ({ _kind: "debt", item: d })) : []),
    ...(Array.isArray(st.financeCommitments) ? st.financeCommitments.map((c) => ({ _kind: "commitment", item: c })) : []),
    ...(Array.isArray(st.financeObligations) ? st.financeObligations.map((o) => ({ _kind: "obligation", item: o })) : []),
  ];
  if (allDebts.length > 0 || hashes.finance_debts) {
    totalChanges += diffTableListInMemory("finance_debts", allDebts, (entry) => {
      if (!entry.item.id) entry.item.id = generateUUID();
      return `${entry._kind}_${entry.item.id}`.replace(new RegExp(`^${entry._kind}_${entry._kind}_`), `${entry._kind}_`);
    });
  }

  if (Array.isArray(st.sleepLog)) {
    totalChanges += diffTableListInMemory(
      "sleep_log",
      st.sleepLog,
      (s) => s.id || (s.id = `sleep_${s.date || generateUUID()}`)
    );
  }

  if (st.moodDaily && typeof st.moodDaily === "object") {
    const moodList = [];
    for (const [dateKey, val] of Object.entries(st.moodDaily)) {
      const items = Array.isArray(val) ? val : [val];
      items.forEach((e, idx) => {
        if (!e || typeof e !== "object") return;
        const id = String(e.id || `${dateKey}_${e.ts || idx}`);
        moodList.push({ id, dateKey, e });
      });
    }
    totalChanges += diffTableListInMemory("mood_daily", moodList, (m) => m.id);
  }

  try {
    const neurons = getAllNeurons({ includeDeleted: false });
    totalChanges += diffTableListInMemory(
      "neurons",
      neurons,
      (n) => n.id || (n.id = generateUUID())
    );
  } catch (_e) {}

  try {
    const memories = getAllMemories();
    totalChanges += diffTableListInMemory(
      "memories",
      memories,
      (m) => m.id || (m.id = generateUUID())
    );
  } catch (_e) {}

  try {
    const days = getAllDays();
    totalChanges += diffTableListInMemory("days", days, (d) => d.date, "date");
  } catch (_e) {}

  try {
    const history = await getFullChatHistory();
    const validMsgs = (Array.isArray(history) ? history : []).filter((m) => m && m.content);
    totalChanges += diffTableListInMemory(
      "chat_history",
      validMsgs,
      (m) => `${m.messageId || m.id || m.ts}_${m.role || "user"}`
    );
  } catch (_e) {}

  totalChanges += diffTableListInMemory("app_modules", getAppModulesList(), (m) => m.id);

  // UNA SOLA ESCRITURA AL FINAL DE TODA LA PASADA
  if (totalChanges > 0 || forceAll) {
    saveHashes();
    persistOfflineQueue();
  }
  return totalChanges;
}

// =====================================================================================
// 6. TRANSPORTE DE RED: REST DIRECTO A SUPABASE + FALLBACK A /api/sync
// =====================================================================================
async function fetchWithTimeout(url, opts = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { ...opts, ...(ctrl ? { signal: ctrl.signal } : {}) });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function directSupabaseUpsert(cfg, table, rows, conflictColumn = "id") {
  if (!rows.length) return { ok: true };
  const headers = {
    apikey: cfg.supabaseAnonKey,
    Authorization: `Bearer ${cfg.supabaseAnonKey}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  };

  const endpoint = `${cfg.supabaseUrl}/rest/v1/${encodeURIComponent(table)}?on_conflict=${encodeURIComponent(conflictColumn)}`;
  let res = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (/column .* does not exist|PGRST204/i.test(errText)) {
      const stripped = rows.map(({ data, updated_at, to_account_id, counterparty, source_label, ...rest }) => rest);
      res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(stripped),
      });
    } else {
      throw new Error(`Supabase [${table}] HTTP ${res.status}: ${errText}`);
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Supabase [${table}] HTTP ${res.status}: ${errText}`);
  }
  return { ok: true };
}

async function directSupabaseDelete(cfg, table, ids, column = "id") {
  if (!ids.length) return { ok: true };
  const headers = {
    apikey: cfg.supabaseAnonKey,
    Authorization: `Bearer ${cfg.supabaseAnonKey}`,
  };
  const cleanUrl = `${cfg.supabaseUrl}/rest/v1/${encodeURIComponent(table)}?${encodeURIComponent(column)}=in.(${ids.map((x) => encodeURIComponent(String(x))).join(",")})`;
  const res = await fetchWithTimeout(cleanUrl, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Supabase DELETE [${table}] HTTP ${res.status}: ${errText}`);
  }
  return { ok: true };
}

async function directSupabaseSelect(cfg, table, query = "select=*") {
  const headers = {
    apikey: cfg.supabaseAnonKey,
    Authorization: `Bearer ${cfg.supabaseAnonKey}`,
  };
  const res = await fetchWithTimeout(`${cfg.supabaseUrl}/rest/v1/${encodeURIComponent(table)}?${query}`, {
    method: "GET",
    headers,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (/relation .* does not exist|42P01|PGRST205/i.test(errText)) {
      return [];
    }
    throw new Error(`Supabase SELECT [${table}] HTTP ${res.status}: ${errText}`);
  }
  return await res.json();
}

// =====================================================================================
// 7. PROCESADOR DE COLA POR MICRO-TANDAS (`flushOfflineQueue` — 40 ITEMS POR TANDA)
// =====================================================================================
let flushInFlight = null;
let flushDebounceTimer = null;

export function scheduleSync({ immediate = false } = {}) {
  if (immediate) {
    if (flushDebounceTimer) {
      clearTimeout(flushDebounceTimer);
      flushDebounceTimer = null;
    }
    flushInFlight = (flushInFlight || Promise.resolve())
      .then(() => flushOfflineQueue())
      .finally(() => {
        flushInFlight = null;
      });
    return flushInFlight;
  }

  if (flushDebounceTimer) clearTimeout(flushDebounceTimer);
  flushDebounceTimer = setTimeout(() => {
    flushDebounceTimer = null;
    scheduleSync({ immediate: true });
  }, DEBOUNCE_MS);
  return null;
}

export async function flushOfflineQueue({ isManual = false, forceAll = false } = {}) {
  await captureLocalChangesToQueue({ forceAll });

  const q = loadOfflineQueue();
  let entries = Object.entries(q.items || {});
  const initialTotal = entries.length;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const status = saveSyncStatusObj({
      ok: false,
      offline: true,
      at: Date.now(),
      kind: "push",
      pending: initialTotal,
      message: `Sin internet · ${initialTotal} cambio(s) guardado(s) en cola local.`,
    });
    updateSyncBannerUI();
    return status;
  }

  const cfg = await autoDiscoverConfig();
  if (cfg.mode === "unconfigured") {
    const msg = "Configura tu URL y Anon Key de Supabase en Ajustes → Sincronización con Supabase.";
    if (isManual && typeof window.toast === "function") window.toast("⚠️ " + msg);
    return saveSyncStatusObj({
      ok: false,
      at: Date.now(),
      kind: "push",
      pending: initialTotal,
      message: msg,
    });
  }

  if (!forceAll && initialTotal === 0) {
    try {
      if (localStorage.getItem(INITIAL_BACKFILL_DONE_KEY) !== "1") {
        await captureLocalChangesToQueue({ forceAll: true });
        localStorage.setItem(INITIAL_BACKFILL_DONE_KEY, "1");
        return flushOfflineQueue({ isManual });
      }
    } catch (_e) {}
  }

  if (initialTotal === 0) {
    updateSyncBannerUI({ justSyncedCount: 0 });
    return saveSyncStatusObj({
      ok: true,
      at: Date.now(),
      kind: "push",
      pending: 0,
      counts: { neurons: 0, memories: 0, days: 0, chat: 0, finance: 0, appState: false },
      message: "",
    });
  }

  const counts = { finance: 0, neurons: 0, memories: 0, days: 0, chat: 0, appState: false };
  let totalSyncedSoFar = 0;
  const MAX_BATCHES_PER_CYCLE = 6; // Máximo 6 micro-tandas por ciclo para liberar el recolector de basura (GC)
  let batchesRun = 0;

  try {
    while (entries.length > 0 && batchesRun < MAX_BATCHES_PER_CYCLE) {
      batchesRun++;
      // Agrupar por la tabla del primer elemento pendiente para cargar EN RAM solo 1 tabla a la vez
      const targetTable = entries[0][1].t;
      const maxForTable =
        targetTable === "app_modules"
          ? 1
          : targetTable === "days"
          ? 5
          : targetTable === "neurons" || targetTable === "memories"
          ? 25
          : BATCH_SIZE;

      const slice = entries.filter(([, it]) => it.t === targetTable).slice(0, maxForTable);
      updateSyncBannerUI({ syncing: true, pendingOverride: entries.length });

      // Construir lookup SOLO para esta única tabla (y liberarlo al terminar la iteración)
      const singleTableLookup = await buildLiveLookupForTables(new Set([targetTable]));

      const byTableUpserts = {};
      const byTableDeletes = {};
      const conflictColByTable = {};
      const batchSeqs = {};

      for (const [key, item] of slice) {
        batchSeqs[key] = item.seq;
        conflictColByTable[item.t] = item.c || (item.t === "days" ? "date" : "id");

        if (item.op === "d") {
          if (!byTableDeletes[item.t]) byTableDeletes[item.t] = [];
          byTableDeletes[item.t].push(item.id);
        } else {
          const rowBuilder = singleTableLookup[item.t]?.get(String(item.id));
          if (rowBuilder) {
            if (!byTableUpserts[item.t]) byTableUpserts[item.t] = [];
            byTableUpserts[item.t].push(rowBuilder());
          }
        }
      }

      if (cfg.hasDirectSupabase) {
        for (const [table, rows] of Object.entries(byTableUpserts)) {
          await directSupabaseUpsert(cfg, table, rows, conflictColByTable[table] || "id");
        }
        for (const [table, ids] of Object.entries(byTableDeletes)) {
          await directSupabaseDelete(cfg, table, ids, conflictColByTable[table] || "id");
        }
      } else {
        const headers = { "Content-Type": "application/json" };
        if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
        const res = await fetchWithTimeout(`${cfg.apiUrl}/api/sync`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            tableUpserts: byTableUpserts,
            tableDeletes: byTableDeletes,
          }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          throw new Error(errText);
        }
        const resJson = await res.json().catch(() => ({}));
        if (Array.isArray(resJson?.data?.errors) && resJson.data.errors.length > 0) {
          throw new Error(resJson.data.errors.join(" · "));
        }
      }

      counts.finance += (byTableUpserts.finance_ledger?.length || 0) + (byTableUpserts.finance_accounts?.length || 0);
      counts.neurons += byTableUpserts.neurons?.length || 0;
      counts.memories += byTableUpserts.memories?.length || 0;
      counts.days += byTableUpserts.days?.length || 0;
      counts.chat += byTableUpserts.chat_history?.length || 0;
      counts.appState = counts.appState || Boolean(byTableUpserts.app_modules?.length);

      const currentQueue = loadOfflineQueue();
      for (const [key, seq] of Object.entries(batchSeqs)) {
        if (currentQueue.items[key]?.seq === seq) {
          delete currentQueue.items[key];
        }
      }
      persistOfflineQueue();

      totalSyncedSoFar += slice.length;
      entries = Object.entries(currentQueue.items || {});

      if (entries.length > 0) {
        await new Promise((r) => setTimeout(r, 60));
      }
    }

    // Si aún quedan más lotes por subir (p. ej. en el backfill inicial de 1,198 elementos),
    // programar el siguiente ciclo en 500 ms liberando completamente el call stack y la RAM
    if (entries.length > 0) {
      updateSyncBannerUI({ syncing: true, pendingOverride: entries.length });
      setTimeout(() => {
        scheduleSync({ immediate: true });
      }, 500);
      return saveSyncStatusObj({
        ok: true,
        at: Date.now(),
        kind: "push",
        counts,
        pending: entries.length,
        fullData: true,
        message: "",
      });
    }

    updateSyncBannerUI({ justSyncedCount: totalSyncedSoFar });
    return saveSyncStatusObj({
      ok: true,
      at: Date.now(),
      kind: "push",
      counts,
      pending: 0,
      fullData: true,
      message: "",
    });
  } catch (err) {
    console.warn("[dbService] Pausa en sincronización (el progreso ya subido se conservó):", err);
    updateSyncBannerUI({ error: err.message });
    return saveSyncStatusObj({
      ok: false,
      at: Date.now(),
      kind: "push",
      counts,
      pending: getOfflineQueueCount(),
      message: err?.message || String(err),
    });
  }
}

// =====================================================================================
// 8. DESCARGA Y RECONCILIACIÓN DESDE SUPABASE (`pullFromSupabase`)
// =====================================================================================
export async function pullFromSupabase({ isManual = false } = {}) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    if (isManual && typeof window.toast === "function") {
      window.toast("⚡ Estás sin internet. Usando copia local.");
    }
    return { ok: false, changed: false, offline: true, message: "Sin conexión a internet." };
  }

  if (typeof window !== "undefined" && window.FINANCE?.ready) {
    try {
      await window.FINANCE.ready;
    } catch (_e) {}
  }

  const cfg = await autoDiscoverConfig();
  if (cfg.mode === "unconfigured") {
    return { ok: false, changed: false, message: "Supabase no configurado aún." };
  }

  let cloud = {
    accounts: [],
    ledger: [],
    debts: [],
    sleep: [],
    mood: [],
    neurons: [],
    memories: [],
    days: [],
    chatHistory: [],
    modules: [],
    appState: null,
  };

  try {
    if (cfg.hasDirectSupabase) {
      const [
        accounts,
        ledger,
        debts,
        sleep,
        mood,
        neurons,
        memories,
        days,
        chatHistory,
        modules,
        appStateRows,
      ] = await Promise.all([
        directSupabaseSelect(cfg, "finance_accounts", "select=*"),
        directSupabaseSelect(cfg, "finance_ledger", "select=*&order=date.desc"),
        directSupabaseSelect(cfg, "finance_debts", "select=*"),
        directSupabaseSelect(cfg, "sleep_log", "select=*&order=date.desc"),
        directSupabaseSelect(cfg, "mood_daily", "select=*&order=date.desc"),
        directSupabaseSelect(cfg, "neurons", "select=*"),
        directSupabaseSelect(cfg, "memories", "select=*"),
        directSupabaseSelect(cfg, "days", "select=*&order=date.desc"),
        directSupabaseSelect(cfg, "chat_history", "select=*&order=created_at.asc"),
        directSupabaseSelect(cfg, "app_modules", "select=*"),
        directSupabaseSelect(cfg, "app_state", "select=*&id=eq.default_user"),
      ]);

      cloud = {
        accounts: accounts || [],
        ledger: ledger || [],
        debts: debts || [],
        sleep: sleep || [],
        mood: mood || [],
        neurons: neurons || [],
        memories: memories || [],
        days: days || [],
        chatHistory: chatHistory || [],
        modules: modules || [],
        appState: appStateRows?.[0]?.state_json || null,
      };
    } else {
      const headers = {};
      if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
      const res = await fetchWithTimeout(`${cfg.apiUrl}/api/restore`, {
        method: "GET",
        headers,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(errText);
      }
      const json = await res.json();
      const d = json?.data || {};
      cloud = {
        accounts: d.financeAccounts || d.appState?.financeAccounts || [],
        ledger: d.financeLedger || d.appState?.financeLedger || [],
        debts: d.financeDebts || d.appState?.financeDebts || [],
        sleep: d.sleepLog || d.appState?.sleepLog || [],
        mood: d.moodRows || [],
        neurons: d.neurons || [],
        memories: d.memories || [],
        days: d.days || [],
        chatHistory: d.chatHistory || [],
        modules: d.modules || [],
        appState: d.appState || null,
      };
    }
  } catch (err) {
    const message = err?.message || String(err);
    saveSyncStatusObj({
      ...(getSyncStatus() || {}),
      kind: "pull",
      pullOk: false,
      pullAt: Date.now(),
      pullMessage: message,
    });
    return { ok: false, changed: false, message };
  }

  let changed = false;
  const added = { accounts: 0, ledger: 0, sleep: 0, mood: 0, neurons: 0, memories: 0, days: 0, chat: 0, modules: 0 };
  const st = typeof window !== "undefined" ? window.state : null;

  if (st && Array.isArray(cloud.accounts) && cloud.accounts.length > 0) {
    const pendingAcc = getPendingIdsForTable("finance_accounts");
    const deletedAcc = getPendingDeletesForTable("finance_accounts");
    const localAccs = Array.isArray(st.financeAccounts) ? [...st.financeAccounts] : [];
    const byId = new Map(localAccs.map((a) => [String(a.id), a]));

    for (const row of cloud.accounts) {
      const acc = mapRowToAccount(row);
      if (!acc?.id || deletedAcc.has(acc.id) || pendingAcc.has(acc.id)) continue;
      if (!byId.has(acc.id)) {
        localAccs.push(acc);
        byId.set(acc.id, acc);
        added.accounts++;
        changed = true;
      }
    }
    if (added.accounts > 0) st.financeAccounts = localAccs;
  }

  if (st && Array.isArray(cloud.ledger) && cloud.ledger.length > 0) {
    const pendingMov = getPendingIdsForTable("finance_ledger");
    const deletedMov = getPendingDeletesForTable("finance_ledger");
    const localLedger = Array.isArray(st.financeLedger) ? [...st.financeLedger] : [];
    const byId = new Map(localLedger.map((m) => [String(m.id), m]));

    for (const row of cloud.ledger) {
      const mov = mapRowToMovement(row);
      if (!mov?.id || deletedMov.has(mov.id) || pendingMov.has(mov.id)) continue;
      if (!byId.has(mov.id)) {
        localLedger.push(mov);
        byId.set(mov.id, mov);
        added.ledger++;
        changed = true;
      }
    }

    if (added.ledger > 0) {
      st.financeLedger = localLedger;
      if (window.FINANCE && Array.isArray(window.FINANCE.movements)) {
        window.FINANCE.movements = [...localLedger];
      }
    }
  }

  if (st && Array.isArray(cloud.debts) && cloud.debts.length > 0) {
    const pendingDebts = getPendingIdsForTable("finance_debts");
    const deletedDebts = getPendingDeletesForTable("finance_debts");
    const debts = Array.isArray(st.financeDebts) ? [...st.financeDebts] : [];
    const commitments = Array.isArray(st.financeCommitments) ? [...st.financeCommitments] : [];
    const obligations = Array.isArray(st.financeObligations) ? [...st.financeObligations] : [];

    const debtIds = new Set(debts.flatMap((d) => [String(d.id), String(d.id).replace(/^debt_/, ""), `debt_${d.id}`]));
    const commIds = new Set(commitments.flatMap((c) => [String(c.id), String(c.id).replace(/^commitment_/, ""), `commitment_${c.id}`]));
    const obIds = new Set(obligations.flatMap((o) => [String(o.id), String(o.id).replace(/^obligation_/, ""), `obligation_${o.id}`]));

    for (const row of cloud.debts) {
      if (!row?.id || deletedDebts.has(String(row.id)) || pendingDebts.has(String(row.id))) continue;
      const item = row.data && typeof row.data === "object" ? { ...row.data } : { ...row };
      const rawId = String(item.id || row.id).replace(/^(debt|commitment|obligation)_/, "");

      if (row.kind === "commitment") {
        if (!commIds.has(rawId)) {
          item.id = item.id || rawId;
          commitments.push(item);
          commIds.add(rawId);
          commIds.add(`commitment_${rawId}`);
          changed = true;
        }
      } else if (row.kind === "obligation") {
        if (!obIds.has(rawId)) {
          item.id = item.id || rawId;
          obligations.push(item);
          obIds.add(rawId);
          obIds.add(`obligation_${rawId}`);
          changed = true;
        }
      } else {
        const normName = String(item.name || '').trim().toLowerCase();
        const existingByName = normName ? debts.find(d => String(d.name || '').trim().toLowerCase() === normName && Number(d.dueDay || 0) === Number(item.dueDay || 0)) : null;

        if (!debtIds.has(rawId) && !existingByName) {
          item.id = item.id || rawId;
          debts.push(item);
          debtIds.add(rawId);
          debtIds.add(`debt_${rawId}`);
          changed = true;
        } else if (existingByName && !debtIds.has(rawId)) {
          debtIds.add(rawId);
        }
      }
    }
    st.financeDebts = debts;
    st.financeCommitments = commitments;
    st.financeObligations = obligations;
  }

  if (st && Array.isArray(cloud.sleep) && cloud.sleep.length > 0) {
    const deletedSleep = getPendingDeletesForTable("sleep_log");
    if (!Array.isArray(st.sleepLog)) st.sleepLog = [];
    const localIds = new Set(st.sleepLog.map((s) => String(s.id)));
    for (const row of cloud.sleep) {
      const s = mapRowToSleep(row);
      if (!s?.id || deletedSleep.has(s.id) || localIds.has(s.id)) continue;
      st.sleepLog.push(s);
      localIds.add(s.id);
      added.sleep++;
      changed = true;
    }
  }

  if (st && Array.isArray(cloud.mood) && cloud.mood.length > 0) {
    if (!st.moodDaily || typeof st.moodDaily !== "object") st.moodDaily = {};
    for (const row of cloud.mood) {
      const dateKey = row.date;
      if (!dateKey) continue;
      const entry = row.data && typeof row.data === "object" ? row.data : {
        id: row.id,
        spriteId: row.sprite_id,
        label: row.label,
        activities: row.activities || [],
        energy: row.energy,
        note: row.note || "",
        tags: row.tags || [],
        ts: row.ts,
      };
      if (!st.moodDaily[dateKey]) {
        st.moodDaily[dateKey] = [entry];
        added.mood++;
        changed = true;
      }
    }
  }

  if (st && Array.isArray(cloud.modules) && cloud.modules.length > 0) {
    const pendingMods = getPendingIdsForTable("app_modules");
    for (const modRow of cloud.modules) {
      if (!modRow?.id || pendingMods.has(String(modRow.id)) || !modRow.payload) continue;
      const p = modRow.payload;
      switch (modRow.id) {
        case "routines":
          if (Array.isArray(p) && (!st.routines || st.routines.length === 0)) { st.routines = p; changed = true; }
          break;
        case "semana":
          if (p && typeof p === "object" && (!st.semana || Object.keys(st.semana).length === 0)) { st.semana = p; changed = true; }
          break;
        case "house":
          if (p && typeof p === "object" && (!st.house || !st.house.zones?.length)) { st.house = p; changed = true; }
          break;
        case "home_widgets":
          if (p && typeof p === "object") {
            if (Array.isArray(p.moodActivityCats) && p.moodActivityCats.length > 0) {
              if (!Array.isArray(st.moodActivityCats) || st.moodActivityCats.length === 0) {
                st.moodActivityCats = p.moodActivityCats;
                localStorage.setItem("memorycarl_v2_mood_activity_cats", JSON.stringify(p.moodActivityCats));
                changed = true;
              } else {
                // Merge custom items across categories so no custom activity label is lost
                let catsChanged = false;
                for (const cloudCat of p.moodActivityCats) {
                  if (!cloudCat?.id) continue;
                  const localCat = st.moodActivityCats.find((c) => c.id === cloudCat.id);
                  if (!localCat) {
                    st.moodActivityCats.push(cloudCat);
                    catsChanged = true;
                  } else if (Array.isArray(cloudCat.items)) {
                    if (!Array.isArray(localCat.items)) localCat.items = [];
                    const existingIds = new Set(localCat.items.map((it) => it.id));
                    for (const item of cloudCat.items) {
                      if (item?.id && !existingIds.has(item.id)) {
                        localCat.items.push(item);
                        existingIds.add(item.id);
                        catsChanged = true;
                      }
                    }
                  }
                }
                if (catsChanged) {
                  localStorage.setItem("memorycarl_v2_mood_activity_cats", JSON.stringify(st.moodActivityCats));
                  changed = true;
                }
              }
            }
          }
          break;
        case "finance_extras": {
          // Preferencias del Mapa Neuronal (renombres, uniones, necesario/evitable): se unen, gana lo local
          const cloudPrefs = p?.financeMeta?.habitPrefs;
          if (cloudPrefs && typeof cloudPrefs === "object") {
            const local = (st.financeMeta && st.financeMeta.habitPrefs) || {};
            const merged = {
              merges: { ...(cloudPrefs.merges || {}), ...(local.merges || {}) },
              labels: { ...(cloudPrefs.labels || {}), ...(local.labels || {}) },
              verdicts: { ...(cloudPrefs.verdicts || {}), ...(local.verdicts || {}) },
              dismissed: [...new Set([...(cloudPrefs.dismissed || []), ...(local.dismissed || [])])].slice(-200),
            };
            if (JSON.stringify(merged) !== JSON.stringify(local)) {
              st.financeMeta = { ...(st.financeMeta || {}), habitPrefs: merged };
              localStorage.setItem("memorycarl_v2_finance_meta", JSON.stringify(st.financeMeta));
              changed = true;
            }
          }
          break;
        }
        case "neurochat_now":
          if (Array.isArray(p.lifeFacts) && p.lifeFacts.length) {
            const localFacts = readLocalArray(LIFE_FACTS_KEY);
            const merged = mergeLifeLists(localFacts, p.lifeFacts);
            if (JSON.stringify(merged) !== JSON.stringify(localFacts)) {
              localStorage.setItem(LIFE_FACTS_KEY, JSON.stringify(merged));
              changed = true;
            }
          }
          if (Array.isArray(p.openThreads) && p.openThreads.length) {
            const localThreads = readLocalArray(OPEN_THREADS_KEY);
            const merged = mergeLifeLists(localThreads, p.openThreads);
            if (JSON.stringify(merged) !== JSON.stringify(localThreads)) {
              localStorage.setItem(OPEN_THREADS_KEY, JSON.stringify(merged));
              changed = true;
            }
          }
          break;
      }
    }
  }

  const deletedNeurons = getPendingDeletesForTable("neurons");
  if (Array.isArray(cloud.neurons) && cloud.neurons.length > 0) {
    const localNeurons = readLocalArray("memorycarl_neurochat_neurons");
    const { list: refreshed, updated } = refreshNeuronsFromCloud(localNeurons, cloud.neurons);
    const { list: finalNeurons, added: nAdded } = addMissingById(
      refreshed,
      cloud.neurons.filter((r) => !deletedNeurons.has(String(r?.id))),
      cloudNeuronToLocal
    );
    if (updated || nAdded) {
      localStorage.setItem("memorycarl_neurochat_neurons", JSON.stringify(finalNeurons));
      added.neurons = nAdded + updated;
      changed = true;
    }
  }

  const deletedMemories = getPendingDeletesForTable("memories");
  if (Array.isArray(cloud.memories) && cloud.memories.length > 0) {
    const localMemories = readLocalArray("memorycarl_memories_v1");
    const { list: finalMemories, added: mAdded } = addMissingById(
      localMemories,
      cloud.memories.filter((r) => !deletedMemories.has(String(r?.id))),
      cloudMemoryToLocal
    );
    if (mAdded) {
      localStorage.setItem("memorycarl_memories_v1", JSON.stringify(finalMemories));
      added.memories = mAdded;
      changed = true;
    }
  }

  if (Array.isArray(cloud.days) && cloud.days.length > 0) {
    if (mergeDaysFromCloud(cloud.days)) {
      added.days = cloud.days.length;
      changed = true;
    }
  }

  if (Array.isArray(cloud.chatHistory) && cloud.chatHistory.length > 0) {
    const localHist = readLocalArray("memorycarl_neurochat_history");
    if (localHist.length === 0) {
      const msgs = cloud.chatHistory
        .map(cloudChatToLocal)
        .filter(Boolean)
        .map((m) => ({ ...m, messageId: String(m.messageId || "").replace(/_(user|assistant)$/, "") }))
        .slice(-50);
      if (msgs.length > 0) {
        localStorage.setItem("memorycarl_neurochat_history", JSON.stringify(msgs));
        added.chat = msgs.length;
        changed = true;
      }
    }
  }

  if (changed && typeof window !== "undefined") {
    try {
      window.__mcSuppressSync = true;
      if (typeof window.persist === "function") window.persist();
      if (typeof window.view === "function") window.view();
    } finally {
      window.__mcSuppressSync = false;
    }
  }

  saveSyncStatusObj({
    ...(getSyncStatus() || {}),
    ok: true,
    kind: "pull",
    pullOk: true,
    pullAt: Date.now(),
    pullMessage: "",
  });

  updateSyncBannerUI();
  return { ok: true, changed, added, cloud };
}

function readLocalArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

// =====================================================================================
// 9. INTERFAZ VISUAL EN TIEMPO REAL (BARRA OFFLINE + BADGE CON PROGRESO POR LOTES)
// =====================================================================================
export function getSyncStatus() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_STATUS_KEY) || "null");
  } catch (_e) {
    return null;
  }
}

function saveSyncStatusObj(status) {
  try {
    localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status));
  } catch (_e) {}
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("neurochat-sync-status", { detail: status }));
      window.dispatchEvent(new CustomEvent("memorycarl-sync-status", { detail: status }));
    } catch (_e) {}
  }
  return status;
}

let badgeHideTimer = null;

export function updateSyncBannerUI({ syncing = false, pendingOverride = null, justSyncedCount = null, error = null } = {}) {
  if (typeof document === "undefined" || !document.body) return;

  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  const pending = pendingOverride !== null ? pendingOverride : getOfflineQueueCount();
  const cfg = getSupabaseConfig();

  let offlineBar = document.getElementById("mc-offline-top-bar");
  if (!offlineBar) {
    offlineBar = document.createElement("div");
    offlineBar.id = "mc-offline-top-bar";
    offlineBar.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "z-index:10050",
      "background:linear-gradient(90deg,#f59e0b,#d97706)",
      "color:#0f172a",
      "font-size:12px",
      "font-weight:700",
      "padding:6px 14px",
      "display:none",
      "align-items:center",
      "justify-content:space-between",
      "box-shadow:0 2px 10px rgba(0,0,0,0.35)",
      "font-family:'DM Sans',system-ui,sans-serif",
    ].join(";");
    document.body.appendChild(offlineBar);
  }

  if (isOffline) {
    offlineBar.style.display = "flex";
    offlineBar.innerHTML = `
      <span>⚡ Sin internet — Guardando en caché local</span>
      <span style="background:rgba(15,23,42,0.85);color:#fbbf24;padding:2px 8px;border-radius:999px;font-size:11px;">
        Offline${pending > 0 ? ` (${pending})` : ""}
      </span>
    `;
  } else {
    offlineBar.style.display = "none";
  }

  let badge = document.getElementById("mc-sync-live-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "mc-sync-live-badge";
    badge.style.cssText = [
      "position:fixed",
      "top:10px",
      "right:12px",
      "z-index:10049",
      "padding:5px 11px",
      "border-radius:999px",
      "font-size:11px",
      "font-weight:700",
      "display:none",
      "align-items:center",
      "gap:6px",
      "backdrop-filter:blur(8px)",
      "box-shadow:0 4px 12px rgba(0,0,0,0.3)",
      "cursor:pointer",
      "transition:opacity 0.25s ease, transform 0.25s ease",
      "font-family:'DM Sans',system-ui,sans-serif",
    ].join(";");
    badge.title = "Pulsa para sincronizar ahora con Supabase";
    badge.addEventListener("click", () => {
      flushOfflineQueue({ isManual: true });
    });
    document.body.appendChild(badge);
  }

  if (badgeHideTimer) {
    clearTimeout(badgeHideTimer);
    badgeHideTimer = null;
  }

  if (isOffline) {
    badge.style.display = "inline-flex";
    badge.style.top = "38px";
    badge.style.background = "rgba(245, 158, 11, 0.18)";
    badge.style.border = "1px solid rgba(245, 158, 11, 0.45)";
    badge.style.color = "#fbbf24";
    badge.textContent = `⚡ Offline${pending > 0 ? ` (${pending})` : ""}`;
  } else if (syncing) {
    badge.style.display = "inline-flex";
    badge.style.top = "10px";
    badge.style.background = "rgba(99, 102, 241, 0.2)";
    badge.style.border = "1px solid rgba(99, 102, 241, 0.45)";
    badge.style.color = "#a5b4fc";
    badge.textContent = `⟳ Sincronizando${pending > 0 ? ` (${pending})` : ""}...`;
  } else if (error) {
    badge.style.display = "inline-flex";
    badge.style.top = "10px";
    badge.style.background = "rgba(244, 63, 94, 0.2)";
    badge.style.border = "1px solid rgba(244, 63, 94, 0.45)";
    badge.style.color = "#fda4af";
    badge.textContent = `⚠️ Pendiente (${pending})`;
  } else if (pending > 0 && cfg.mode !== "unconfigured") {
    badge.style.display = "inline-flex";
    badge.style.top = "10px";
    badge.style.background = "rgba(245, 158, 11, 0.18)";
    badge.style.border = "1px solid rgba(245, 158, 11, 0.4)";
    badge.style.color = "#fbbf24";
    badge.textContent = `⏳ Cola (${pending})`;
  } else if (justSyncedCount !== null && justSyncedCount >= 0) {
    badge.style.display = "inline-flex";
    badge.style.top = "10px";
    badge.style.background = "rgba(16, 185, 129, 0.18)";
    badge.style.border = "1px solid rgba(52, 211, 153, 0.45)";
    badge.style.color = "#34d399";
    badge.textContent = `✓ Sincronizado${justSyncedCount > 0 ? ` (${justSyncedCount})` : ""}`;
    badgeHideTimer = setTimeout(() => {
      if (badge && getOfflineQueueCount() === 0 && navigator.onLine !== false) {
        badge.style.display = "none";
      }
    }, 4500);
  } else {
    badge.style.display = "none";
  }

  const statusChip = document.getElementById("supabaseSyncStatus");
  if (statusChip) {
    if (isOffline) {
      statusChip.textContent = `⚡ Offline (${pending})`;
      statusChip.style.color = "#fbbf24";
    } else if (cfg.mode === "unconfigured") {
      statusChip.textContent = "⚪ Sin configurar";
      statusChip.style.color = "#94a3b8";
    } else if (pending > 0) {
      statusChip.textContent = `⏳ Pendientes (${pending})`;
      statusChip.style.color = "#fbbf24";
    } else {
      statusChip.textContent = cfg.hasDirectSupabase ? "🟢 Directo Activo" : "🟢 API Activa";
      statusChip.style.color = "#34d399";
    }
  }
}

// =====================================================================================
// 10. INICIALIZACIÓN GLOBAL Y EVENT LISTENERS
// =====================================================================================
let dbServiceInitialized = false;

export function initDbService() {
  if (typeof window === "undefined" || dbServiceInitialized) return;
  dbServiceInitialized = true;

  window.dbService = {
    generateUUID,
    getSupabaseConfig,
    saveSupabaseConfig,
    flushOfflineQueue,
    pullFromSupabase,
    scheduleSync,
    getOfflineQueueCount,
    captureLocalChangesToQueue,
  };

  window.addEventListener("online", () => {
    updateSyncBannerUI({ syncing: true });
    scheduleSync({ immediate: true });
  });

  window.addEventListener("offline", () => {
    updateSyncBannerUI();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && getOfflineQueueCount() > 0) {
      scheduleSync({ immediate: true });
    } else if (document.visibilityState === "visible" && navigator.onLine !== false) {
      if (getOfflineQueueCount() > 0) {
        scheduleSync({ immediate: true });
      }
    }
  });

  setTimeout(async () => {
    try {
      await hydrateUnlimitedStorage();
    } catch (_e) {}
    updateSyncBannerUI();
    await autoDiscoverConfig();
    const pullRes = await pullFromSupabase({ isManual: false });
    if (pullRes.ok || getOfflineQueueCount() > 0) {
      await scheduleSync({ immediate: true });
    }
  }, 1000);
}

export { hydrateUnlimitedStorage, getStorageStats };
