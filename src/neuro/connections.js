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

const MIN_CONNECTION_SCORE = 0.30;
const MAX_CONNECTIONS_PER_NEURON = 8;

/**
 * Calcula un score de afinidad entre dos neuronas (sin embeddings).
 * @param {Neuron} a
 * @param {Neuron} b
 * @returns {number} [0, 1]
 */
function affinityScore(a, b) {
  // Dominio coincidente
  const domainMatch = a.core.domain && b.core.domain &&
    a.core.domain.toLowerCase() === b.core.domain.toLowerCase() ? 0.3 : 0;

  // Emoción coincidente
  const emotionMatch = a.emotion && b.emotion &&
    a.emotion !== "neutral" && a.emotion === b.emotion ? 0.15 : 0;

  // Overlap de tokens (triggers + concept + summary)
  const tokA = [...neuronTokenSet(a)];
  const tokB = [...neuronTokenSet(b)];
  const overlap = keywordOverlap(tokA, tokB);

  return Math.min(1, domainMatch + emotionMatch + overlap * 0.55);
}

/**
 * Encuentra neuronas relacionadas con una neurona dada dentro de un pool.
 * @param {Neuron} newNeuron
 * @param {Neuron[]} allNeurons — pool de candidatos (excluye a newNeuron por id)
 * @returns {Promise<Neuron[]>} neuronas relacionadas ordenadas por afinidad
 */
export async function findRelatedNeurons(newNeuron, allNeurons) {
  const pool = allNeurons.filter((n) => n.id !== newNeuron.id);
  if (!pool.length) return [];

  // Obtener embedding de la neurona nueva (o computarlo)
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

/**
 * Asigna conexiones a una neurona nueva basadas en las relacionadas.
 * También añade la conexión inversa en las relacionadas (in-place en el array).
 *
 * @param {Neuron} newNeuron — mutado con .connections
 * @param {Neuron[]} relatedNeurons
 * @returns {Neuron} la neurona con conexiones actualizadas
 */
export function attachConnections(newNeuron, relatedNeurons) {
  const existingIds = new Set(newNeuron.connections);
  for (const rel of relatedNeurons.slice(0, MAX_CONNECTIONS_PER_NEURON)) {
    if (!existingIds.has(rel.id)) {
      newNeuron.connections.push(rel.id);
      existingIds.add(rel.id);
    }
    // Conexión inversa (si no existe ya)
    if (!rel.connections.includes(newNeuron.id)) {
      rel.connections.push(newNeuron.id);
    }
  }
  return newNeuron;
}

/**
 * Reconstruye el grafo completo de conexiones para un array de neuronas.
 * Útil para sanear el estado tras múltiples operaciones.
 * @param {Neuron[]} neurons
 * @returns {Promise<Neuron[]>} neurons actualizadas
 */
export async function rebuildGraph(neurons) {
  const ids = new Set(neurons.map((n) => n.id));

  // Paso 1: limpiar referencias huérfanas
  for (const n of neurons) {
    n.connections = n.connections.filter((id) => ids.has(id) && id !== n.id);
  }

  // Paso 2: para las neuronas sin embedding, computarlo
  for (const n of neurons) {
    if (!n.embedding || n.embedding.length === 0) {
      const text = [n.core.concept, n.core.summary, ...n.triggers].join(" ");
      n.embedding = await getEmbedding(text);
    }
  }

  return neurons;
}
