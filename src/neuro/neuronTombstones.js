/**
 * neuronTombstones.js — Registro local de neuronas borradas o fusionadas
 * MemoryCarl / NeuroChat
 *
 * Se sube a la nube como módulo `neuron_tombstones` para que los otros dispositivos
 * también quiten esas neuronas (y redirijan sus conexiones a la que quedó).
 */

export const TOMBSTONES_KEY = "memorycarl_neuron_tombstones_v1";
const MAX_IDS = 2000;

function emptyTombstones() {
  return { ids: [], mergedInto: {}, updatedAt: null };
}

export function normalizeTombstones(raw) {
  const out = emptyTombstones();
  if (!raw || typeof raw !== "object") return out;
  out.ids = [...new Set((Array.isArray(raw.ids) ? raw.ids : []).map(String).filter(Boolean))];
  if (raw.mergedInto && typeof raw.mergedInto === "object") {
    for (const [k, v] of Object.entries(raw.mergedInto)) if (k && v) out.mergedInto[String(k)] = String(v);
  }
  out.updatedAt = raw.updatedAt || null;
  return out;
}

/** Une dos registros: ids sin repetir; en mergedInto gana `b` si ambos lo tienen. */
export function mergeTombstones(a, b) {
  const x = normalizeTombstones(a);
  const y = normalizeTombstones(b);
  const ids = [...new Set([...x.ids, ...y.ids])].slice(-MAX_IDS);
  const keep = new Set(ids);
  const mergedInto = {};
  for (const [k, v] of Object.entries({ ...x.mergedInto, ...y.mergedInto })) if (keep.has(k)) mergedInto[k] = v;
  const times = [x.updatedAt, y.updatedAt].filter(Boolean).sort();
  return { ids, mergedInto, updatedAt: times[times.length - 1] || null };
}

/** Quita ids del registro (deshacer una reparación). */
export function withoutTombstones(t, ids = []) {
  const x = normalizeTombstones(t);
  const drop = new Set(ids.map(String));
  const mergedInto = {};
  for (const [k, v] of Object.entries(x.mergedInto)) if (!drop.has(k)) mergedInto[k] = v;
  return { ids: x.ids.filter((id) => !drop.has(id)), mergedInto, updatedAt: new Date().toISOString() };
}

export function loadTombstones() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(TOMBSTONES_KEY);
    return raw ? normalizeTombstones(JSON.parse(raw)) : null;
  } catch (_e) {
    return null;
  }
}

export function saveTombstones(t) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(normalizeTombstones(t)));
  } catch (_e) { /* sin espacio: la nube igual borra las filas */ }
}

export function addTombstones(ids = [], mergedInto = {}) {
  if (!ids.length) return loadTombstones();
  const next = mergeTombstones(loadTombstones(), { ids, mergedInto, updatedAt: new Date().toISOString() });
  saveTombstones(next);
  return next;
}
