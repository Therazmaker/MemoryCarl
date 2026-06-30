/**
 * neuronStore.js — Almacenamiento persistente de neuronas en localStorage
 * Namespace: "memorycarl_neurochat_neurons"
 * NeuroChat / MemoryCarl
 */

import { sanitizeNeuron, validateNeuron, createNeuron } from "./schemas.js";
import { getEmbedding } from "./embeddings.js";
import { rebuildGraph } from "./connections.js";
import { normalizeTemporalMeta } from "./temporal.js";

const STORE_KEY = "memorycarl_neurochat_neurons";
const MEMORY_KEY = "memorycarl_memories_v1";
const INSIGHT_HISTORY_KEY = "memorycarl_neurochat_insight_history";

// ---- Helpers internos ----

function readAll() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    let changed = false;
    const normalized = parsed
      .map((n) => {
        const clean = sanitizeNeuron(n);
        if (!clean) return null;
        if (!n.temporal) changed = true;
        return clean;
      })
      .filter(Boolean);
    if (changed) writeAll(normalized);
    return normalized;
  } catch (_e) {
    return [];
  }
}

function writeAll(neurons) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORE_KEY, JSON.stringify(neurons));
  } catch (e) {
    console.error("[neuronStore] Error al guardar neuronas:", e);
  }
}

function readJsonArray(key) {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(key);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function writeJsonArray(key, value) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(Array.isArray(value) ? value : []));
  } catch (_e) {
    // noop
  }
}

function isManualNeuron(n) {
  return n?.source?.kind === "manual";
}

function tokenizeSearch(query) {
  return String(query || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
}

function neuronMatchesQuery(n, tokens) {
  if (!tokens.length) return true;
  const haystack = [
    n.core?.concept,
    n.core?.summary,
    ...(n.triggers || []),
    ...(n.meta?.aliases || []),
    n.meta?.manualCategory,
    n.type,
  ].join(" ").toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

async function ensureNeuronEmbedding(neuron) {
  if (Array.isArray(neuron.embedding) && neuron.embedding.length > 0) return neuron;
  const text = [neuron.core?.concept, neuron.core?.summary, ...(neuron.triggers || []), ...(neuron.meta?.aliases || [])]
    .filter(Boolean)
    .join(" ");
  neuron.embedding = await getEmbedding(text);
  return neuron;
}

async function reindexAndPersist(neurons) {
  const rebuilt = await rebuildGraph(neurons);
  writeAll(rebuilt);
  return rebuilt;
}

// ---- API pública ----

/** Devuelve todas las neuronas almacenadas. */
export function getAllNeurons(options = {}) {
  const all = readAll();
  if (options.includeDeleted) return all;
  return all.filter((n) => !n.deleted);
}

/** Devuelve una neurona por ID o null si no existe. */
export function getNeuronById(id) {
  return readAll().find((n) => n.id === id) || null;
}

/**
 * Guarda una neurona (inserta o reemplaza por ID).
 * Valida antes de guardar. Devuelve la neurona guardada o null si inválida.
 */
export function saveNeuron(neuron) {
  const sanitized = sanitizeNeuron(neuron);
  if (!sanitized) return null;
  const errs = validateNeuron(sanitized);
  if (errs.length > 0) {
    console.warn("[neuronStore] Neurona inválida, no se guarda:", errs, neuron);
    return null;
  }
  const all = readAll();
  const idx = all.findIndex((n) => n.id === sanitized.id);
  if (idx >= 0) {
    all[idx] = sanitized;
  } else {
    all.push(sanitized);
  }
  writeAll(all);
  return sanitized;
}

/**
 * Guarda múltiples neuronas de una vez.
 * @param {any[]} neurons
 * @returns {number} cantidad de neuronas guardadas con éxito
 */
export function saveManyNeurons(neurons) {
  if (!Array.isArray(neurons)) return 0;
  let count = 0;
  const all = readAll();
  for (const raw of neurons) {
    const n = sanitizeNeuron(raw);
    if (!n) continue;
    const errs = validateNeuron(n);
    if (errs.length > 0) { console.warn("[neuronStore] Neurona inválida:", errs); continue; }
    const idx = all.findIndex((x) => x.id === n.id);
    if (idx >= 0) { all[idx] = n; } else { all.push(n); }
    count++;
  }
  writeAll(all);
  return count;
}

/**
 * Aplica un patch parcial a una neurona existente.
 * @param {string} id
 * @param {Partial<Neuron>} patch
 * @returns {Neuron|null}
 */
export function updateNeuron(id, patch) {
  const all = readAll();
  const idx = all.findIndex((n) => n.id === id);
  if (idx < 0) return null;
  const updated = sanitizeNeuron({ ...all[idx], ...patch, id, updatedAt: new Date().toISOString() });
  if (!updated) return null;
  all[idx] = updated;
  writeAll(all);
  return updated;
}

/**
 * Actualiza únicamente metadata temporal de una neurona.
 * @param {string} id
 * @param {Partial<Neuron["temporal"]>} temporalPatch
 * @returns {Neuron|null}
 */
export function updateNeuronTemporal(id, temporalPatch = {}) {
  const all = readAll();
  const idx = all.findIndex((n) => n.id === id);
  if (idx < 0) return null;
  const currentTemporal = all[idx].temporal || normalizeTemporalMeta({});
  const mergedTemporal = normalizeTemporalMeta({ ...currentTemporal, ...temporalPatch });
  const updated = sanitizeNeuron({
    ...all[idx],
    temporal: mergedTemporal,
    id,
    updatedAt: new Date().toISOString(),
  });
  if (!updated) return null;
  all[idx] = updated;
  writeAll(all);
  return updated;
}

/**
 * Elimina una neurona por ID.
 * @returns {boolean} true si se encontró y eliminó
 */
export function deleteNeuron(id) {
  return hardDeleteNeuron(id);
}

/**
 * Busca neuronas cuyo texto (triggers, concept, summary) incluya el término.
 * @param {string} text
 * @returns {Neuron[]}
 */
export function searchNeuronsByTrigger(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return readAll().filter((n) => {
    if (n.triggers.some((t) => t.toLowerCase().includes(lower))) return true;
    if ((n.core.concept || "").toLowerCase().includes(lower)) return true;
    if ((n.core.summary || "").toLowerCase().includes(lower)) return true;
    return false;
  });
}

/**
 * Reconstruye las listas de conexiones asegurando que sean bidireccionales.
 * Útil tras eliminar neuronas.
 */
export function reindexConnections() {
  const all = readAll();
  const ids = new Set(all.map((n) => n.id));
  let changed = false;
  for (const n of all) {
    const valid = n.connections.filter((id) => ids.has(id));
    if (valid.length !== n.connections.length) {
      n.connections = valid;
      changed = true;
    }
  }
  if (changed) writeAll(all);
  return all;
}

export function getManualContextNeurons() {
  return readAll().filter((n) => isManualNeuron(n) && !n.deleted);
}

export function getPinnedContextNeurons() {
  return getManualContextNeurons().filter((n) => Boolean(n.meta?.pin));
}

export function getContextNeuronsByCategory(category) {
  return getManualContextNeurons().filter((n) => n.meta?.manualCategory === category);
}

export function searchManualContextNeurons(query, options = {}) {
  const tokens = tokenizeSearch(query);
  const source = options.showDeleted ? readAll().filter((n) => isManualNeuron(n)) : getManualContextNeurons();
  return source.filter((n) => {
    if (options.category && n.meta?.manualCategory !== options.category) return false;
    if (options.type && n.type !== options.type) return false;
    if (options.priority && n.meta?.priority !== options.priority) return false;
    if (options.deleted === false && n.deleted) return false;
    if (options.deleted === true && !n.deleted) return false;
    if (options.pinned != null && Boolean(n.meta?.pin) !== Boolean(options.pinned)) return false;
    if (options.withConnections === true && (!Array.isArray(n.connections) || n.connections.length === 0)) return false;
    if (options.withConnections === false && Array.isArray(n.connections) && n.connections.length > 0) return false;
    return neuronMatchesQuery(n, tokens);
  });
}

export async function createManualContextNeuron(input) {
  const base = createNeuron({
    ...input,
    source: { kind: "manual", ref: "context_window" },
    type: input?.type || "manual_context",
    meta: {
      priority: "medium",
      manualCategory: "other",
      pin: false,
      aliases: [],
      ...input?.meta,
    },
  });

  const sanitized = sanitizeNeuron(base);
  if (!sanitized) return null;
  const errs = validateNeuron(sanitized);
  if (errs.length) return null;

  await ensureNeuronEmbedding(sanitized);

  const all = readAll();
  all.push(sanitized);
  await reindexAndPersist(all);
  return sanitized;
}

export async function updateManualContextNeuron(id, patch) {
  const all = readAll();
  const idx = all.findIndex((n) => n.id === id && isManualNeuron(n));
  if (idx < 0) return null;

  const mergedMeta = { ...(all[idx].meta || {}), ...(patch.meta || {}) };
  const updated = sanitizeNeuron({
    ...all[idx],
    ...patch,
    id,
    source: { kind: "manual", ref: patch?.source?.ref || all[idx].source?.ref || "context_window" },
    meta: mergedMeta,
    updatedAt: new Date().toISOString(),
  });
  if (!updated) return null;

  const textChanged = ["core", "triggers", "meta", "type"].some((k) => patch[k] != null);
  if (textChanged) {
    updated.embedding = [];
    await ensureNeuronEmbedding(updated);
  }

  all[idx] = updated;
  await reindexAndPersist(all);
  return updated;
}

export async function deleteManualContextNeuron(id) {
  const target = getNeuronById(id);
  if (!target || !isManualNeuron(target)) return false;
  return deleteNeuronSafely(id, { hard: true });
}

export function removeNeuronFromMemories(neuronId) {
  if (!neuronId) return 0;
  const memories = readJsonArray(MEMORY_KEY);
  let touched = 0;
  const next = memories.map((m) => {
    const linked = Array.isArray(m.linkedNeurons) ? m.linkedNeurons : [];
    const filtered = linked.filter((id) => id !== neuronId);
    if (filtered.length === linked.length) return m;
    touched++;
    const display = Array.isArray(m.linkedNeuronDisplay) ? m.linkedNeuronDisplay.filter((x) => x?.id !== neuronId) : [];
    return { ...m, linkedNeurons: filtered, linkedNeuronDisplay: display };
  });
  if (touched > 0) writeJsonArray(MEMORY_KEY, next);
  return touched;
}

export function removeNeuronFromInsights(neuronId) {
  if (!neuronId) return 0;
  const history = readJsonArray(INSIGHT_HISTORY_KEY);
  let touched = 0;
  const next = history.map((ins) => {
    const based = Array.isArray(ins.basedOnNeurons) ? ins.basedOnNeurons : [];
    const filtered = based.filter((id) => id !== neuronId);
    if (filtered.length === based.length) return ins;
    touched++;
    return { ...ins, basedOnNeurons: filtered };
  });
  if (touched > 0) writeJsonArray(INSIGHT_HISTORY_KEY, next);
  return touched;
}

export function unlinkNeuronFromAllConnections(neuronId) {
  if (!neuronId) return 0;
  const all = readAll();
  let touched = 0;
  for (const neuron of all) {
    const before = Array.isArray(neuron.connections) ? neuron.connections.length : 0;
    neuron.connections = (neuron.connections || []).filter((id) => id !== neuronId);
    if (neuron.id === neuronId) neuron.connections = [];
    if (neuron.connections.length !== before || neuron.id === neuronId) touched++;
  }
  if (touched > 0) writeAll(all);
  return touched;
}

export function getNeuronDeletionImpact(neuronId) {
  const all = readAll();
  const target = all.find((n) => n.id === neuronId);
  if (!target) return null;
  const connectedNeurons = all.filter((n) => (n.connections || []).includes(neuronId) || (target.connections || []).includes(n.id));
  const memoryRefs = readJsonArray(MEMORY_KEY).filter((m) => (m.linkedNeurons || []).includes(neuronId));
  const insightRefs = readJsonArray(INSIGHT_HISTORY_KEY).filter((ins) => (ins.basedOnNeurons || []).includes(neuronId));
  return {
    neuronId,
    exists: true,
    isManual: isManualNeuron(target),
    likes: Number(target.feedbackStats?.likes) || 0,
    connectionsAffected: connectedNeurons.length,
    memoriesAffected: memoryRefs.length,
    insightsAffected: insightRefs.length,
  };
}

export function softDeleteNeuron(neuronId) {
  const all = readAll();
  const idx = all.findIndex((n) => n.id === neuronId);
  if (idx < 0) return false;
  all[idx] = sanitizeNeuron({ ...all[idx], deleted: true, updatedAt: new Date().toISOString() });
  writeAll(all);
  return true;
}

export function restoreSoftDeletedNeuron(neuronId) {
  const all = readAll();
  const idx = all.findIndex((n) => n.id === neuronId);
  if (idx < 0) return false;
  all[idx] = sanitizeNeuron({ ...all[idx], deleted: false, updatedAt: new Date().toISOString() });
  writeAll(all);
  return true;
}

export function hardDeleteNeuron(neuronId) {
  if (!neuronId) return false;
  const all = readAll();
  const before = all.length;
  const next = all.filter((n) => n.id !== neuronId).map((n) => ({ ...n, connections: (n.connections || []).filter((id) => id !== neuronId) }));
  if (next.length === before) return false;
  writeAll(next);
  removeNeuronFromMemories(neuronId);
  removeNeuronFromInsights(neuronId);
  if (typeof process !== "undefined" && process?.env?.NODE_ENV !== "production") {
    console.debug(`[neuronStore] hardDeleteNeuron ${neuronId} aplicado`);
  }
  return true;
}

export function deleteNeuronSafely(neuronId, options = {}) {
  const impact = getNeuronDeletionImpact(neuronId);
  if (!impact) return { ok: false, reason: "not_found", impact: null };
  if (options.soft === true) {
    const ok = softDeleteNeuron(neuronId);
    return { ok, mode: "soft", impact };
  }
  const ok = hardDeleteNeuron(neuronId);
  return { ok, mode: "hard", impact };
}
