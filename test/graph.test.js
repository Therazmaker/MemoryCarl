/**
 * graph.test.js — Tests para el módulo de grafo neuronal
 * MemoryCarl
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNeuronGraph,
  filterGraphNodes,
  getGraphDomains,
  getGraphEmotions,
  getDomainColors,
  getEmotionColors,
  computeNodeSize,
} from "../src/neuro/graph.js";

// ---- Helpers ----
function makeNeuron(overrides = {}) {
  return {
    id:             overrides.id             || `nrn_${Math.random().toString(36).slice(2)}`,
    type:           overrides.type           || "memory",
    core: {
      concept:      overrides.concept        || "Test Neuron",
      domain:       overrides.domain         || "general",
      summary:      overrides.summary        || "Resumen de test",
    },
    triggers:       overrides.triggers       || ["test"],
    connections:    overrides.connections    || [],
    weight:         typeof overrides.weight  === "number" ? overrides.weight : 0.5,
    emotion:        overrides.emotion        || "neutral",
    evidence:       overrides.evidence       || [],
    embedding:      [],
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
    lastActivated:  overrides.lastActivated  || null,
    timesActivated: overrides.timesActivated || 0,
    source:         { kind: "generated", ref: "test" },
  };
}

// ================================================================
// buildNeuronGraph
// ================================================================

test("buildNeuronGraph: devuelve nodos y edges vacíos para array vacío", () => {
  const g = buildNeuronGraph([]);
  assert.ok(Array.isArray(g.nodes));
  assert.ok(Array.isArray(g.edges));
  assert.equal(g.nodes.length, 0);
  assert.equal(g.edges.length, 0);
});

test("buildNeuronGraph: devuelve nodos y edges vacíos para entrada inválida", () => {
  const g = buildNeuronGraph(null);
  assert.equal(g.nodes.length, 0);
  assert.equal(g.edges.length, 0);
});

test("buildNeuronGraph: crea un nodo por neurona", () => {
  const neurons = [makeNeuron({ id: "n1" }), makeNeuron({ id: "n2" }), makeNeuron({ id: "n3" })];
  const g = buildNeuronGraph(neurons);
  assert.equal(g.nodes.length, 3);
});

test("buildNeuronGraph: cada nodo incluye metadata requerida", () => {
  const n = makeNeuron({ id: "n1", concept: "Mi concepto", domain: "work", emotion: "joy", weight: 0.7, timesActivated: 5 });
  const g = buildNeuronGraph([n]);
  const node = g.nodes[0];
  assert.equal(node.id,       "n1");
  assert.equal(node.label,    "Mi concepto");
  assert.equal(node.domain,   "work");
  assert.equal(node.emotion,  "joy");
  assert.equal(node.weight,   0.7);
  assert.equal(node.timesActivated, 5);
  assert.ok(typeof node.size   === "number");
  assert.ok(typeof node.color  === "string");
  assert.ok(typeof node.status === "string");
});

test("buildNeuronGraph: crea edges para conexiones existentes", () => {
  const n1 = makeNeuron({ id: "n1", connections: ["n2"] });
  const n2 = makeNeuron({ id: "n2", connections: ["n1"] });
  const g  = buildNeuronGraph([n1, n2]);
  // Debe crear exactamente 1 edge (sin duplicar)
  assert.equal(g.edges.length, 1);
  const edge = g.edges[0];
  assert.ok(edge.source === "n1" || edge.source === "n2");
  assert.ok(edge.target === "n1" || edge.target === "n2");
});

test("buildNeuronGraph: no crea edges para conexiones a neuronas inexistentes", () => {
  const n1 = makeNeuron({ id: "n1", connections: ["nX_inexistente"] });
  const g  = buildNeuronGraph([n1]);
  assert.equal(g.edges.length, 0);
});

test("buildNeuronGraph: no duplica edges bidireccionales", () => {
  const n1 = makeNeuron({ id: "n1", connections: ["n2", "n3"] });
  const n2 = makeNeuron({ id: "n2", connections: ["n1"] });
  const n3 = makeNeuron({ id: "n3", connections: ["n1"] });
  const g  = buildNeuronGraph([n1, n2, n3]);
  // Debe tener exactamente 2 edges: n1-n2 y n1-n3
  assert.equal(g.edges.length, 2);
});

test("buildNeuronGraph: status normal por defecto", () => {
  const n = makeNeuron({ id: "n1" });
  const g = buildNeuronGraph([n]);
  assert.equal(g.nodes[0].status, "normal");
});

test("buildNeuronGraph: status active para IDs en highlightIds", () => {
  const n = makeNeuron({ id: "n1" });
  const g = buildNeuronGraph([n], { highlightIds: ["n1"] });
  assert.equal(g.nodes[0].status, "active");
});

test("buildNeuronGraph: status new para IDs en newIds", () => {
  const n = makeNeuron({ id: "n1" });
  const g = buildNeuronGraph([n], { newIds: ["n1"] });
  assert.equal(g.nodes[0].status, "new");
});

test("buildNeuronGraph: status merged tiene prioridad baja (new > merged)", () => {
  const n = makeNeuron({ id: "n1" });
  // merged sin new → merged
  const g1 = buildNeuronGraph([n], { mergedIds: ["n1"] });
  assert.equal(g1.nodes[0].status, "merged");
  // new + merged → new gana
  const g2 = buildNeuronGraph([n], { newIds: ["n1"], mergedIds: ["n1"] });
  assert.equal(g2.nodes[0].status, "new");
});

test("buildNeuronGraph: color varía por domain cuando colorBy=domain", () => {
  const n1 = makeNeuron({ id: "n1", domain: "work"     });
  const n2 = makeNeuron({ id: "n2", domain: "personal" });
  const g  = buildNeuronGraph([n1, n2], { colorBy: "domain" });
  // Los colores deben ser diferentes para dominios diferentes
  assert.notEqual(g.nodes[0].color, g.nodes[1].color);
});

test("buildNeuronGraph: color varía por emotion cuando colorBy=emotion", () => {
  const n1 = makeNeuron({ id: "n1", emotion: "joy"    });
  const n2 = makeNeuron({ id: "n2", emotion: "sadness" });
  const g  = buildNeuronGraph([n1, n2], { colorBy: "emotion" });
  assert.notEqual(g.nodes[0].color, g.nodes[1].color);
});

// ================================================================
// computeNodeSize
// ================================================================

test("computeNodeSize: devuelve valor entre min y max", () => {
  const n = makeNeuron({ weight: 0.5, timesActivated: 5 });
  const size = computeNodeSize(n);
  assert.ok(size >= 10);
  assert.ok(size <= 36);
});

test("computeNodeSize: nodo con peso 1 y muchas activaciones es más grande", () => {
  const small = makeNeuron({ weight: 0.1, timesActivated: 0 });
  const large = makeNeuron({ weight: 1.0, timesActivated: 20 });
  const sSmall = computeNodeSize(small);
  const sLarge = computeNodeSize(large);
  assert.ok(sLarge > sSmall);
});

test("computeNodeSize: respeta min y max personalizados", () => {
  const n = makeNeuron({ weight: 0.5 });
  const size = computeNodeSize(n, { minSize: 5, maxSize: 20 });
  assert.ok(size >= 5);
  assert.ok(size <= 20);
});

// ================================================================
// filterGraphNodes
// ================================================================

test("filterGraphNodes: sin filtros devuelve el grafo completo", () => {
  const neurons = [makeNeuron({ id: "n1", domain: "work" }), makeNeuron({ id: "n2", domain: "personal" })];
  const g        = buildNeuronGraph(neurons);
  const filtered = filterGraphNodes(g, {});
  assert.equal(filtered.nodes.length, 2);
});

test("filterGraphNodes: filtra por domain", () => {
  const neurons = [
    makeNeuron({ id: "n1", domain: "work" }),
    makeNeuron({ id: "n2", domain: "personal" }),
    makeNeuron({ id: "n3", domain: "work" }),
  ];
  const g        = buildNeuronGraph(neurons);
  const filtered = filterGraphNodes(g, { domain: "work" });
  assert.equal(filtered.nodes.length, 2);
  assert.ok(filtered.nodes.every((n) => n.domain === "work"));
});

test("filterGraphNodes: filtra por emotion", () => {
  const neurons = [
    makeNeuron({ id: "n1", emotion: "joy" }),
    makeNeuron({ id: "n2", emotion: "sadness" }),
    makeNeuron({ id: "n3", emotion: "joy" }),
  ];
  const g        = buildNeuronGraph(neurons);
  const filtered = filterGraphNodes(g, { emotion: "joy" });
  assert.equal(filtered.nodes.length, 2);
});

test("filterGraphNodes: filtra por búsqueda de texto en label", () => {
  const neurons = [
    makeNeuron({ id: "n1", concept: "Meditación diaria" }),
    makeNeuron({ id: "n2", concept: "Trabajo en equipo" }),
  ];
  const g        = buildNeuronGraph(neurons);
  const filtered = filterGraphNodes(g, { search: "meditación" });
  assert.equal(filtered.nodes.length, 1);
  assert.equal(filtered.nodes[0].label, "Meditación diaria");
});

test("filterGraphNodes: filtra por trigger en search", () => {
  const neurons = [
    makeNeuron({ id: "n1", triggers: ["mañana", "yoga"] }),
    makeNeuron({ id: "n2", triggers: ["oficina"] }),
  ];
  const g        = buildNeuronGraph(neurons);
  const filtered = filterGraphNodes(g, { search: "yoga" });
  assert.equal(filtered.nodes.length, 1);
});

test("filterGraphNodes: filtra por activación reciente", () => {
  const recent = makeNeuron({ id: "n1", lastActivated: new Date().toISOString() });
  const old    = makeNeuron({ id: "n2", lastActivated: new Date(Date.now() - 30 * 86400000).toISOString() });
  const none   = makeNeuron({ id: "n3", lastActivated: null });
  const g        = buildNeuronGraph([recent, old, none]);
  const filtered = filterGraphNodes(g, { recentDays: 7 });
  assert.equal(filtered.nodes.length, 1);
  assert.equal(filtered.nodes[0].id, "n1");
});

test("filterGraphNodes: excluye edges de nodos filtrados", () => {
  const n1 = makeNeuron({ id: "n1", domain: "work",     connections: ["n2"] });
  const n2 = makeNeuron({ id: "n2", domain: "personal", connections: ["n1"] });
  const g  = buildNeuronGraph([n1, n2]);
  assert.equal(g.edges.length, 1);
  const filtered = filterGraphNodes(g, { domain: "work" });
  // El edge conecta n1 (work) con n2 (personal); n2 no está en filtered → edge excluido
  assert.equal(filtered.edges.length, 0);
});

// ================================================================
// getGraphDomains / getGraphEmotions
// ================================================================

test("getGraphDomains: devuelve dominios únicos del grafo", () => {
  const neurons = [
    makeNeuron({ domain: "work" }),
    makeNeuron({ domain: "personal" }),
    makeNeuron({ domain: "work" }),
  ];
  const g       = buildNeuronGraph(neurons);
  const domains = getGraphDomains(g);
  assert.ok(Array.isArray(domains));
  assert.equal(new Set(domains).size, domains.length); // sin duplicados
  assert.ok(domains.includes("work"));
  assert.ok(domains.includes("personal"));
});

test("getGraphEmotions: devuelve emociones únicas del grafo", () => {
  const neurons = [
    makeNeuron({ emotion: "joy" }),
    makeNeuron({ emotion: "sadness" }),
    makeNeuron({ emotion: "joy" }),
  ];
  const g        = buildNeuronGraph(neurons);
  const emotions = getGraphEmotions(g);
  assert.ok(Array.isArray(emotions));
  assert.equal(new Set(emotions).size, emotions.length);
  assert.ok(emotions.includes("joy"));
  assert.ok(emotions.includes("sadness"));
});

// ================================================================
// getDomainColors / getEmotionColors
// ================================================================

test("getDomainColors: devuelve un objeto con colores de dominio", () => {
  const colors = getDomainColors();
  assert.ok(typeof colors === "object");
  assert.ok(typeof colors.general  === "string");
  assert.ok(typeof colors.personal === "string");
  assert.ok(typeof colors.work     === "string");
});

test("getEmotionColors: devuelve un objeto con colores de emoción", () => {
  const colors = getEmotionColors();
  assert.ok(typeof colors === "object");
  assert.ok(typeof colors.joy     === "string");
  assert.ok(typeof colors.sadness === "string");
  assert.ok(typeof colors.neutral === "string");
});

// ================================================================
// Integración: nodos resaltados por sesión
// ================================================================

test("buildNeuronGraph: integración completa con sessionState", () => {
  const n1 = makeNeuron({ id: "n1" }); // activada
  const n2 = makeNeuron({ id: "n2" }); // nueva
  const n3 = makeNeuron({ id: "n3" }); // mergeada
  const n4 = makeNeuron({ id: "n4" }); // normal

  const g = buildNeuronGraph([n1, n2, n3, n4], {
    highlightIds: ["n1"],
    newIds:       ["n2"],
    mergedIds:    ["n3"],
  });

  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  assert.equal(byId.n1.status, "active");
  assert.equal(byId.n2.status, "new");
  assert.equal(byId.n3.status, "merged");
  assert.equal(byId.n4.status, "normal");
});
