/**
 * connections.js — Gestión de conexiones entre neuronas
 * NeuroChat / MemoryCarl
 *
 * Las conexiones se calculan por similitud de:
 * - concepto / dominio
 * - triggers compartidos
 * - emoción
 * - evidencia
 */

import { cosineSimilarity, getEmbedding } from "./embeddings.js";
import { neuronTokenSet, keywordOverlap } from "./utils.js";
import { getAllNeurons, updateNeuron } from "./neuronStore.js";

const MIN_CONNECTION_SCORE = 0.30;
const MAX_CONNECTIONS_PER_NEURON = 8;

/**
 * Calcula un score de afinidad entre dos neuronas (sin embeddings).
 * @param {Neuron} a
 * @param {Neuron} b
 * @returns {number} [0, 1]
 */
function affinityScore(a, b) {
  const domainMatch = a.core.domain && b.core.domain &&
    a.core.domain.toLowerCase() === b.core.domain.toLowerCase() ? 0.3 : 0;

  const emotionMatch = a.emotion && b.emotion &&
    a.emotion !== "neutral" && a.emotion === b.emotion ? 0.15 : 0;

  const tokA = [...neuronTokenSet(a)];
  const tokB = [...neuronTokenSet(b)];
  const overlap = keywordOverlap(tokA, tokB);

  return Math.min(1, domainMatch + emotionMatch + overlap * 0.55);
}

export async function findRelatedNeurons(newNeuron, allNeurons) {
  const pool = allNeurons.filter((n) => n.id !== newNeuron.id);
  if (!pool.length) return [];

  const newText = [newNeuron.core.concept, newNeuron.core.summary, ...newNeuron.triggers].join(" ");
  const newEmbed = newNeuron.embedding?.length ? newNeuron.embedding : await getEmbedding(newText);

  const scored = await Promise.all(
    pool.map(async (candidate) => {
      const candText = [candidate.core.concept, candidate.core.summary, ...candidate.triggers].join(" ");
      const candEmbed = candidate.embedding?.length ? candidate.embedding : await getEmbedding(candText);

      const semantic = cosineSimilarity(newEmbed, candEmbed);
      const affinity = affinityScore(newNeuron, candidate);
      const combined = semantic * 0.6 + affinity * 0.4;

      return { neuron: candidate, score: combined };
    })
  );

  return scored
    .filter((r) => r.score >= MIN_CONNECTION_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CONNECTIONS_PER_NEURON)
    .map((r) => r.neuron);
}

export function attachConnections(newNeuron, relatedNeurons) {
  const existingIds = new Set(newNeuron.connections);
  for (const rel of relatedNeurons.slice(0, MAX_CONNECTIONS_PER_NEURON)) {
    if (!existingIds.has(rel.id)) {
      newNeuron.connections.push(rel.id);
      existingIds.add(rel.id);
    }
    if (!rel.connections.includes(newNeuron.id)) {
      rel.connections.push(newNeuron.id);
    }
  }
  return newNeuron;
}

export async function rebuildGraph(neurons) {
  const ids = new Set(neurons.map((n) => n.id));

  for (const n of neurons) {
    n.connections = n.connections.filter((id) => ids.has(id) && id !== n.id);
  }

  for (const n of neurons) {
    if (!n.embedding || n.embedding.length === 0) {
      const text = [n.core.concept, n.core.summary, ...n.triggers].join(" ");
      n.embedding = await getEmbedding(text);
    }
  }

  return neurons;
}

export function linkNeurons(sourceId, targetId, options = {}) {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const all = getAllNeurons();
  const source = all.find((n) => n.id === sourceId);
  const target = all.find((n) => n.id === targetId);
  if (!source || !target) return false;

  const sourceConnections = new Set(source.connections || []);
  const targetConnections = new Set(target.connections || []);
  sourceConnections.add(targetId);
  targetConnections.add(sourceId);

  const connectionSource = options.connectionSource || "manual";
  updateNeuron(sourceId, {
    connections: [...sourceConnections],
    linkMeta: { ...(source.linkMeta || {}), [targetId]: { connectionSource } },
  });
  updateNeuron(targetId, {
    connections: [...targetConnections],
    linkMeta: { ...(target.linkMeta || {}), [sourceId]: { connectionSource } },
  });
  return true;
}

export function unlinkNeurons(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const all = getAllNeurons();
  const source = all.find((n) => n.id === sourceId);
  const target = all.find((n) => n.id === targetId);
  if (!source || !target) return false;

  const sourceConnections = (source.connections || []).filter((id) => id !== targetId);
  const targetConnections = (target.connections || []).filter((id) => id !== sourceId);
  const sourceMeta = { ...(source.linkMeta || {}) };
  const targetMeta = { ...(target.linkMeta || {}) };
  delete sourceMeta[targetId];
  delete targetMeta[sourceId];

  updateNeuron(sourceId, { connections: sourceConnections, linkMeta: sourceMeta });
  updateNeuron(targetId, { connections: targetConnections, linkMeta: targetMeta });
  return true;
}

export function suggestContextLinks(neuron, allNeurons) {
  if (!neuron || !Array.isArray(allNeurons)) return [];
  const concept = String(neuron.core?.concept || "").toLowerCase();
  const aliases = (neuron.meta?.aliases || []).map((a) => String(a).toLowerCase());

  return allNeurons
    .filter((n) => n.id !== neuron.id)
    .map((candidate) => {
      const text = [candidate.core?.concept, candidate.core?.summary, ...(candidate.triggers || [])].join(" ").toLowerCase();
      let score = 0;
      if (concept && text.includes(concept)) score += 0.45;
      if (aliases.some((a) => a && text.includes(a))) score += 0.4;
      if (candidate.core?.domain && candidate.core.domain === neuron.core?.domain) score += 0.15;
      return { neuron: candidate, score };
    })
    .filter((entry) => entry.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((entry) => entry.neuron);
}
