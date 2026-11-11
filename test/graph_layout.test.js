import test from "node:test";
import assert from "node:assert/strict";

import { runForceLayout, seedPositions, computeAreaAnchors, areaCentroids, minPairDistance } from "../src/neuro/graphLayout.js";

const DOMAINS = ["work", "relationships", "health", "finance"];
function makeGraph(n = 80) {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, domain: DOMAINS[i % 4], numberOfConnections: 0 }));
  const edges = [];
  // un nodo "hub" conectado a muchos, más enlaces dentro de cada dominio
  for (let i = 1; i < n; i += 2) edges.push({ source: "n0", target: `n${i}` });
  for (let i = 4; i < n; i++) edges.push({ source: `n${i}`, target: `n${i - 4}` });
  const deg = new Map();
  for (const e of edges) { deg.set(e.source, (deg.get(e.source) || 0) + 1); deg.set(e.target, (deg.get(e.target) || 0) + 1); }
  nodes.forEach((x) => { x.numberOfConnections = deg.get(x.id) || 0; });
  return { nodes, edges };
}

test("red: los nodos guardan espacio entre sí (no se amontonan)", () => {
  const { nodes, edges } = makeGraph();
  const pos = {};
  seedPositions(nodes, edges, pos);
  runForceLayout(nodes, edges, pos, { iterations: 300, sizeOf: () => 12 });
  assert.ok(minPairDistance(nodes, pos) > 30, `distancia mínima ${minPairDistance(nodes, pos)}`);
  assert.ok(Object.values(pos).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test("por área: cada dominio forma su grupo y los grupos no se mezclan", () => {
  const { nodes, edges } = makeGraph();
  const pos = {};
  const anchors = computeAreaAnchors(nodes);
  assert.equal(Object.keys(anchors).length, 4);
  seedPositions(nodes, edges, pos, { mode: "areas", anchors });
  runForceLayout(nodes, edges, pos, { mode: "areas", anchors, iterations: 300, sizeOf: () => 12 });
  const groups = areaCentroids(nodes, pos);
  // cada nodo está más cerca del centro de su grupo que de cualquier otro
  let ok = 0;
  for (const n of nodes) {
    const p = pos[n.id];
    const nearest = groups.reduce((best, g) => (Math.hypot(g.x - p.x, g.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? g : best));
    if (nearest.domain === n.domain) ok++;
  }
  assert.ok(ok / nodes.length > 0.9, `${ok}/${nodes.length} en su grupo`);
});

test("los nodos fijados no se mueven", () => {
  const { nodes, edges } = makeGraph(20);
  const pos = {};
  seedPositions(nodes, edges, pos);
  const fixed = { ...pos.n3 };
  runForceLayout(nodes, edges, pos, { pinned: new Set(["n3"]), iterations: 50 });
  assert.deepEqual(pos.n3, fixed);
});
