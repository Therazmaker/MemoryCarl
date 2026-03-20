/**
 * relationStore.js — Store de relaciones tipadas entre neuronas
 * NeuroChat / MemoryCarl
 */

import { uuid4 } from "./utils.js";

const STORE_KEY = "memorycarl_neurochat_relations";
const MAX_RELATIONS = 2000;

export const RELATION_TYPES = [
  "causa", "consecuencia", "refuerza", "contradice",
  "parte_de", "precede_a", "resuelve",
];

export const RELATION_TYPE_LABELS = {
  causa: "causa",
  consecuencia: "es consecuencia de",
  refuerza: "refuerza",
  contradice: "contradice",
  parte_de: "es parte de",
  precede_a: "precede a",
  resuelve: "resuelve",
};

function readAll() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function writeAll(relations) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORE_KEY, JSON.stringify(relations.slice(-MAX_RELATIONS)));
  } catch (_e) {}
}

function normalize(r) {
  return {
    id: String(r.id || uuid4()),
    sourceId: String(r.sourceId || ""),
    targetId: String(r.targetId || ""),
    type: RELATION_TYPES.includes(r.type) ? r.type : "refuerza",
    strength: Math.max(0, Math.min(1, Number(r.strength ?? 0.6))),
    origin: ["user", "inferred", "feedback"].includes(r.origin) ? r.origin : "user",
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: r.updatedAt || null,
    confirmations: Math.max(0, Number(r.confirmations) || 0),
    rejections: Math.max(0, Number(r.rejections) || 0),
    note: r.note ? String(r.note).slice(0, 300) : null,
  };
}

function edgeKey(sourceId, targetId, type) {
  return `${sourceId}::${type}::${targetId}`;
}

export function getAllRelations() {
  return readAll();
}

export function getRelationsForNeuron(neuronId) {
  return readAll().filter((r) => r.sourceId === neuronId || r.targetId === neuronId);
}

export function getOutgoingRelations(sourceId, type = null) {
  return readAll().filter((r) => r.sourceId === sourceId && (!type || r.type === type));
}

export function getIncomingRelations(targetId, type = null) {
  return readAll().filter((r) => r.targetId === targetId && (!type || r.type === type));
}

export function upsertRelation({ sourceId, targetId, type, strength = 0.6, origin = "user", note = null }) {
  if (!sourceId || !targetId || sourceId === targetId) {
    throw new Error("sourceId y targetId son obligatorios y distintos");
  }
  if (!RELATION_TYPES.includes(type)) {
    throw new Error(`Tipo de relación inválido: ${type}`);
  }

  const all = readAll();
  const key = edgeKey(sourceId, targetId, type);
  const existingIdx = all.findIndex((r) => edgeKey(r.sourceId, r.targetId, r.type) === key);

  if (existingIdx >= 0) {
    const existing = all[existingIdx];
    const newStrength = Math.min(1, Number(existing.strength || 0) + 0.08);
    all[existingIdx] = normalize({
      ...existing,
      strength: newStrength,
      confirmations: Number(existing.confirmations || 0) + 1,
      updatedAt: new Date().toISOString(),
      ...(note ? { note } : {}),
    });
    writeAll(all);
    return all[existingIdx];
  }

  const relation = normalize({ sourceId, targetId, type, strength, origin, note });
  all.push(relation);
  writeAll(all);
  return relation;
}

export function deleteRelation(id) {
  const all = readAll();
  const next = all.filter((r) => r.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}

export function rejectRelation(id) {
  const all = readAll();
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) return "not_found";

  const r = all[idx];
  const rejections = Number(r.rejections || 0) + 1;

  if (rejections >= 3 || r.origin === "inferred") {
    all.splice(idx, 1);
    writeAll(all);
    return "deleted";
  }

  all[idx] = normalize({
    ...r,
    rejections,
    strength: Math.max(0.1, Number(r.strength || 0) - 0.15),
    updatedAt: new Date().toISOString(),
  });
  writeAll(all);
  return "weakened";
}

export function inferRelationsFromActivation(activated = []) {
  const suggestions = [];
  const neurons = activated.map((a) => a?.neuron).filter(Boolean);

  for (let i = 0; i < neurons.length; i++) {
    for (let j = i + 1; j < neurons.length; j++) {
      const a = neurons[i];
      const b = neurons[j];
      const aDom = a.core?.domain || "";
      const bDom = b.core?.domain || "";
      const aEmo = a.emotion || "neutral";
      const bEmo = b.emotion || "neutral";

      const negativeEmotions = ["sadness", "anger", "fear", "shame"];
      if (negativeEmotions.includes(aEmo) && aEmo === bEmo) {
        suggestions.push({
          sourceId: a.id,
          targetId: b.id,
          type: "refuerza",
          strength: 0.45,
          reason: `misma emoción negativa (${aEmo})`,
        });
      }

      const opposites = { joy: ["sadness", "shame"], pride: ["shame"], love: ["disgust", "anger"] };
      if (aDom === bDom && opposites[aEmo]?.includes(bEmo)) {
        suggestions.push({
          sourceId: a.id,
          targetId: b.id,
          type: "contradice",
          strength: 0.5,
          reason: `emociones opuestas (${aEmo} vs ${bEmo}) en ${aDom}`,
        });
      }

      if (a.type === "pattern" && b.type === "memory" && aDom === bDom) {
        suggestions.push({
          sourceId: a.id,
          targetId: b.id,
          type: "causa",
          strength: 0.4,
          reason: "patrón activo en mismo dominio que memoria",
        });
      }

      if (a.type === "belief" && b.type === "identity" && aDom === bDom) {
        suggestions.push({
          sourceId: a.id,
          targetId: b.id,
          type: "parte_de",
          strength: 0.5,
          reason: "creencia dentro de identidad",
        });
      }
    }
  }

  return suggestions;
}

export function getStrongestRelations(neuronId, topK = 5) {
  return getRelationsForNeuron(neuronId)
    .map((r) => ({ relation: r, direction: r.sourceId === neuronId ? "out" : "in" }))
    .sort((a, b) => b.relation.strength - a.relation.strength)
    .slice(0, topK);
}
