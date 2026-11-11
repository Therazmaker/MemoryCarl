import test from "node:test";
import assert from "node:assert/strict";

import { buildRepairInput, validateRepairPlan, applyRepairPlan, planIsEmpty, REPAIR_PLAN_SCHEMA } from "../src/neuro/graphRepairPlan.js";

const N = (id, concept, extra = {}) => ({
  id, type: "person", core: { concept, domain: "relationships", summary: `${concept} resumen` }, triggers: [concept.toLowerCase()], connections: [], weight: 0.5, ...extra,
});

function graph() {
  const g = [
    N("a", "Lucas", { connections: ["b", "x"] }),
    N("b", "Marta", { connections: ["a"] }),
    N("c", "Hermano Lucas", { connections: ["d"] }),
    N("d", "Trabajo en la tienda", { type: "work_context", core: { concept: "Trabajo en la tienda", domain: "trabajo_actual", summary: "Ana trabaja en la tienda" }, connections: ["c"] }),
    N("e", "", { core: { concept: "", domain: "general", summary: "Sofía cocina los domingos" }, triggers: [] }),
    N("f", "", { core: { concept: "", domain: "general", summary: "" }, triggers: [] }),
    N("p", "Pedro", { meta: { pin: true } }),
  ];
  for (let i = 0; i < 13; i++) g.push(N(`z${i}`, `Tema ${i}`));
  return g;
}

test("la entrada compacta no manda listas de conexiones completas", () => {
  const input = buildRepairInput(graph());
  const a = input.find((r) => r.id === "a");
  assert.equal(a.k, 1, "solo cuenta conexiones a neuronas existentes");
  assert.deepEqual(a.v, ["Marta"]);
  assert.equal(a.connections, undefined);
  assert.equal(input.find((r) => r.id === "p").fija, true);
  assert.equal(REPAIR_PLAN_SCHEMA.additionalProperties, false);
});

test("validación: ids inventados, fijadas, dominios y nombres vacíos", () => {
  const raw = {
    summary: "ok",
    deletions: [{ id: "nope", reason: "" }, { id: "p", reason: "basura" }, { id: "z1", reason: "ruido" }],
    merges: [{ keepId: "a", removeIds: ["c", "p", "ghost"], concept: "", summary: "", reason: "misma persona" }],
    updates: [
      { id: "d", concept: "", summary: "", domain: "trabajo_actual", addTriggers: ["de", "tienda", "caja"], removeTriggers: [], reason: "" },
      { id: "b", concept: "", summary: "", domain: "relationships", addTriggers: [], removeTriggers: [], reason: "sin cambio" },
    ],
    connections: [{ a: "c", b: "b", reason: "" }, { a: "a", b: "b", reason: "ya existe" }, { a: "d", b: "z2", reason: "" }],
  };
  const { plan, warnings } = validateRepairPlan(raw, graph());
  assert.deepEqual(plan.merges[0].removeIds, ["c"], "la fijada y la inventada no se funden");
  assert.deepEqual(plan.deletions.map((d) => d.id).sort(), ["f", "z1"], "la fijada no se borra; la vacía sin datos sí");
  const d = plan.updates.find((u) => u.id === "d");
  assert.equal(d.domain, "", "dominio fuera del vocabulario se ignora");
  assert.deepEqual(d.addTriggers, ["tienda", "caja"], "'de' es genérico");
  assert.ok(!plan.updates.some((u) => u.id === "b"), "updates sin cambios se descartan");
  assert.equal(plan.updates.find((u) => u.id === "e").concept, "Sofía cocina los domingos", "sin nombre → nombre desde el resumen");
  // c→b se redirige a a→b, que ya existe: se descarta
  assert.deepEqual(plan.connections.map((c) => [c.a, c.b]), [["d", "z2"]]);
  assert.ok(warnings.some((w) => /fijada/.test(w)));
  assert.ok(warnings.some((w) => /trabajo_actual/.test(w)));
});

test("límite de borrados", () => {
  const raw = { summary: "", merges: [], updates: [], connections: [], deletions: Array.from({ length: 13 }, (_, i) => ({ id: `z${i}`, reason: "" })) };
  const { plan, warnings } = validateRepairPlan(raw, graph(), { maxDeleteRatio: 0.15 });
  // 20 neuronas → máximo 3 borrados pedidos + la vacía "f" que se borra sola
  assert.equal(plan.deletions.filter((d) => d.id.startsWith("z")).length, 3);
  assert.ok(warnings.some((w) => /limitaron/.test(w)));
});

test("aplicar: fusiones redirigen conexiones y todo queda bidireccional", () => {
  const neurons = graph();
  const raw = {
    summary: "",
    deletions: [{ id: "z0", reason: "" }],
    merges: [{ keepId: "a", removeIds: ["c"], concept: "Lucas (hermano)", summary: "", reason: "" }],
    updates: [{ id: "d", concept: "Tienda", summary: "", domain: "work", addTriggers: ["tienda"], removeTriggers: [], reason: "" }],
    connections: [{ a: "b", b: "z3", reason: "" }],
  };
  const { plan } = validateRepairPlan(raw, neurons);
  const before = JSON.stringify(neurons);
  const out = applyRepairPlan(neurons, plan, { now: "2026-11-11T00:00:00Z" });
  assert.equal(JSON.stringify(neurons), before, "no muta la entrada");
  const by = new Map(out.neurons.map((n) => [n.id, n]));
  assert.ok(!by.has("c") && !by.has("z0") && !by.has("f"));
  assert.equal(out.mergedInto.c, "a");
  assert.equal(by.get("a").core.concept, "Lucas (hermano)");
  assert.ok(by.get("a").connections.includes("d"), "hereda la conexión de la fusionada");
  assert.ok(by.get("d").connections.includes("a"), "la conexión a la fusionada apunta a la que quedó");
  assert.ok(!by.get("a").connections.includes("x"), "conexión rota eliminada");
  assert.equal(by.get("d").core.domain, "work");
  assert.ok(by.get("b").connections.includes("z3") && by.get("z3").connections.includes("b"));
  for (const n of out.neurons) for (const id of n.connections) {
    assert.ok(by.has(id), `conexión a existente ${n.id}→${id}`);
    assert.ok(by.get(id).connections.includes(n.id), `bidireccional ${n.id}↔${id}`);
  }
  assert.equal(by.get("e").core.concept, "Sofía cocina los domingos");
  assert.ok(out.neurons.every((n) => n.core.concept), "ninguna queda sin nombre");
});

test("plan vacío", () => {
  const { plan } = validateRepairPlan({ summary: "Todo bien", deletions: [], merges: [], updates: [], connections: [] }, graph().filter((n) => n.core.concept));
  assert.ok(planIsEmpty(plan));
  assert.ok(planIsEmpty(validateRepairPlan(null, []).plan));
});
