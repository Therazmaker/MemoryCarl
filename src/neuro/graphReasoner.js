/**
 * graphReasoner.js — Razonamiento en cadena sobre el grafo de relaciones
 */

import { getOutgoingRelations, getIncomingRelations } from "./relationStore.js";
import { getNeuronById } from "./neuronStore.js";
import { RELATION_TYPE_LABELS } from "./relationStore.js";

const MAX_CHAIN_DEPTH = 3;
const MIN_STRENGTH_TO_TRAVERSE = 0.35;

export function traceChain(startIds = [], options = {}) {
  const maxDepth = options.maxDepth ?? MAX_CHAIN_DEPTH;
  const minStrength = options.minStrength ?? MIN_STRENGTH_TO_TRAVERSE;
  const forwardTypes = ["causa", "precede_a", "refuerza"];
  const results = [];
  const visited = new Set();

  function dfs(currentId, path, types, cumulativeStrength) {
    if (path.length >= maxDepth) return;
    const visitKey = `${currentId}|${path.length}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    const outgoing = getOutgoingRelations(currentId)
      .filter((r) => forwardTypes.includes(r.type) && r.strength >= minStrength)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 3);

    for (const rel of outgoing) {
      if (path.includes(rel.targetId)) continue;
      const newPath = [...path, rel.targetId];
      const newTypes = [...types, rel.type];
      const newStrength = cumulativeStrength * rel.strength;

      results.push({
        path: newPath,
        types: newTypes,
        totalStrength: Number(newStrength.toFixed(3)),
      });

      dfs(rel.targetId, newPath, newTypes, newStrength);
    }
  }

  for (const id of startIds) {
    dfs(id, [id], [], 1);
  }

  return results
    .filter((r) => r.path.length >= 2)
    .sort((a, b) => b.totalStrength - a.totalStrength)
    .slice(0, 10);
}

export function findContradictions(activated = []) {
  const neurons = activated.map((a) => a?.neuron).filter(Boolean);
  const results = [];
  const seen = new Set();

  for (const n of neurons) {
    const contradictions = getOutgoingRelations(n.id, "contradice")
      .filter((r) => r.strength >= 0.3);

    for (const rel of contradictions) {
      const target = neurons.find((x) => x.id === rel.targetId);
      if (!target) continue;
      const key = [n.id, rel.targetId].sort().join("--");
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ a: n, b: target, strength: rel.strength });
    }
  }

  return results;
}

export function buildReasoningContext(activated, allNeurons = []) {
  if (!activated || activated.length === 0) {
    return { chains: [], contradictions: [], resolutions: [], graphSummary: "" };
  }

  const startIds = activated.map((a) => a.neuron?.id).filter(Boolean);
  const rawChains = traceChain(startIds, { maxDepth: 3, minStrength: 0.3 });
  const chains = rawChains
    .map((chain) => ({ ...chain, narrative: buildChainNarrative(chain, allNeurons) }))
    .filter((c) => c.narrative);

  const contradictions = findContradictions(activated);

  const resolutions = [];
  for (const { neuron } of activated) {
    const resolvers = getIncomingRelations(neuron.id, "resuelve");
    for (const rel of resolvers) {
      if (rel.strength < 0.35) continue;
      const solver = getNeuronById(rel.sourceId);
      if (!solver) continue;
      resolutions.push({ problem: neuron, solution: solver, strength: rel.strength });
    }
  }

  const graphSummary = buildGraphSummary(chains, contradictions, resolutions);
  return { chains, contradictions, resolutions, graphSummary };
}

function buildChainNarrative(chain, allNeurons) {
  if (chain.path.length < 2) return "";
  const concepts = chain.path.map((id) => {
    const n = allNeurons.find((x) => x.id === id);
    return n?.core?.concept || id;
  });

  const parts = [];
  for (let i = 0; i < concepts.length - 1; i++) {
    const relLabel = RELATION_TYPE_LABELS[chain.types[i]] || chain.types[i];
    parts.push(`"${concepts[i]}" ${relLabel} "${concepts[i + 1]}"`);
  }

  return parts.join(", que a su vez ");
}

function buildGraphSummary(chains, contradictions, resolutions) {
  const parts = [];
  if (chains.length > 0) {
    parts.push(`Hay una cadena de relaciones: ${chains[0].narrative}.`);
  }
  if (contradictions.length > 0) {
    const c = contradictions[0];
    const cA = c.a.core?.concept || "algo";
    const cB = c.b.core?.concept || "algo";
    parts.push(`"${cA}" y "${cB}" están en tensión según el historial registrado.`);
  }
  if (resolutions.length > 0) {
    const r = resolutions[0];
    const prob = r.problem.core?.concept || "eso";
    const sol = r.solution.core?.concept || "algo";
    parts.push(`"${sol}" aparece como una salida posible para "${prob}".`);
  }
  return parts.join(" ");
}
