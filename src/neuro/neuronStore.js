/**
 * neuronStore.js — Almacenamiento persistente de neuronas en localStorage
 * Namespace: "memorycarl_neurochat_neurons"
 * NeuroChat / MemoryCarl
 */

import { sanitizeNeuron, validateNeuron } from "./schemas.js";

const STORE_KEY = "memorycarl_neurochat_neurons";

// ---- Helpers internos ----

function readAll() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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

// ---- API pública ----

/** Devuelve todas las neuronas almacenadas. */
export function getAllNeurons() {
  return readAll();
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
  const updated = sanitizeNeuron({ ...all[idx], ...patch, id });
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
  const all = readAll();
  const next = all.filter((n) => n.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
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
