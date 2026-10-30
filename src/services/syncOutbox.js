/**
 * syncOutbox.js — Cola de cambios pendientes de subir a Supabase
 * MemoryCarl
 *
 * Cada vez que un almacén local guarda (neuronas, memorias, días, mensajes, "Ahora"),
 * se anota aquí QUÉ cambió (solo ids, no los datos). La subida (neurochatSync.js) lee
 * los datos actuales de esos ids, los sube en tandas y los quita de la cola al confirmar.
 * Si no hay conexión, la cola persiste y se reintenta más tarde.
 *
 * Sin dependencias para que cualquier almacén pueda importarlo sin ciclos.
 */

export const OUTBOX_KEY = "memorycarl_sync_outbox_v1";
const KINDS = ["neurons", "memories", "days", "chat"];

function emptyOutbox() {
  return { seq: 0, neurons: {}, memories: {}, days: {}, chat: {}, appState: 0 };
}

export function loadOutbox() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(OUTBOX_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return emptyOutbox();
    const box = { ...emptyOutbox(), ...parsed };
    for (const k of KINDS) if (!box[k] || typeof box[k] !== "object") box[k] = {};
    return box;
  } catch (_e) {
    return emptyOutbox();
  }
}

function saveOutbox(box) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(box));
  } catch (_e) {
    // Sin espacio: la cola se pierde, pero la siguiente subida completa la recupera
  }
}

// Avisa a la sincronización (si está registrada) para que suba en unos segundos
function notify() {
  try {
    if (typeof window !== "undefined" && typeof window.neurochatPushToSupabase === "function") {
      window.neurochatPushToSupabase(false);
    }
  } catch (_e) {}
}

/**
 * Anota cambios en una lista de un almacén.
 * Cada entrada guarda { op: "upsert"|"delete", seq } para no perder cambios hechos mientras se sube.
 * @param {"neurons"|"memories"|"days"|"chat"} kind
 * @param {string[]} upserts - ids/claves creados o modificados
 * @param {string[]} [deletes] - ids/claves borrados
 */
export function markChanged(kind, upserts = [], deletes = [], { keepDeletes = false } = {}) {
  if (!KINDS.includes(kind) || (!upserts.length && !deletes.length)) return;
  const box = loadOutbox();
  for (const id of upserts) {
    if (id == null) continue;
    // La subida inicial no debe pisar un borrado que aún no se subió
    if (keepDeletes && box[kind][String(id)]?.op === "delete") continue;
    box[kind][String(id)] = { op: "upsert", seq: ++box.seq };
  }
  for (const id of deletes) if (id != null) box[kind][String(id)] = { op: "delete", seq: ++box.seq };
  saveOutbox(box);
  notify();
}

/** "Ahora" (hechos e hilos) se sube entero: es pequeño. */
export function markAppStateChanged() {
  const box = loadOutbox();
  box.appState = ++box.seq;
  saveOutbox(box);
  notify();
}

/**
 * Compara la lista guardada antes con la nueva y anota lo creado, modificado y borrado.
 * @param {"neurons"|"memories"|"days"} kind
 * @param {Array} prevList
 * @param {Array} nextList
 * @param {(x: object) => string} keyOf
 */
export function trackListChanges(kind, prevList = [], nextList = [], keyOf = (x) => x?.id) {
  const before = new Map();
  for (const item of Array.isArray(prevList) ? prevList : []) {
    const k = keyOf(item);
    if (k != null) before.set(String(k), JSON.stringify(item));
  }
  const upserts = [];
  const seen = new Set();
  for (const item of Array.isArray(nextList) ? nextList : []) {
    const k = keyOf(item);
    if (k == null) continue;
    const key = String(k);
    seen.add(key);
    if (before.get(key) !== JSON.stringify(item)) upserts.push(key);
  }
  const deletes = [...before.keys()].filter((k) => !seen.has(k));
  markChanged(kind, upserts, deletes);
}

/** Clave de un mensaje del chat en la cola. */
export function chatKey(msg) {
  return `${msg?.ts}_${msg?.role}`;
}

/** Claves con un borrado pendiente de subir (para no traerlas de vuelta al restaurar). */
export function pendingDeletes(kind) {
  const box = loadOutbox();
  return new Set(Object.entries(box[kind] || {}).filter(([, v]) => v?.op === "delete").map(([k]) => k));
}

/** Número de cambios pendientes. */
export function pendingCount() {
  const box = loadOutbox();
  return KINDS.reduce((n, k) => n + Object.keys(box[k]).length, 0) + (box.appState ? 1 : 0);
}

/**
 * Quita de la cola lo que se subió, solo si no volvió a cambiar mientras tanto.
 * @param {{ neurons?: object, memories?: object, days?: object, chat?: object, appState?: number }} sent
 *        mapas clave → seq tal como estaban al preparar la subida
 */
export function ackSent(sent = {}) {
  const box = loadOutbox();
  for (const k of KINDS) {
    for (const [key, seq] of Object.entries(sent[k] || {})) {
      if (box[k][key]?.seq === seq) delete box[k][key];
    }
  }
  if (sent.appState && box.appState === sent.appState) box.appState = 0;
  saveOutbox(box);
}
