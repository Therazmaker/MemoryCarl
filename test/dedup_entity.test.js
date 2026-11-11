import test from "node:test";
import assert from "node:assert/strict";

import { entityNameOf, shouldMergeNeuron } from "../src/neuro/dedup.js";

const n = (id, concept, type = "relationship", domain = "relationships") => ({ id, type, core: { concept, domain, summary: concept }, triggers: [], connections: [] });

test("nombre propio al inicio del concepto", () => {
  assert.equal(entityNameOf(n("a", "Lucas: amigo de años")), "lucas");
  assert.equal(entityNameOf(n("a", "Marta (mamá de Lucas) y contrato")), "marta");
  assert.equal(entityNameOf(n("a", "Señora Marta")), "marta");
  assert.equal(entityNameOf(n("a", "Pedro (hermano)")), "pedro");
  assert.equal(entityNameOf(n("a", "Ana Lucía")), "ana lucia");
  assert.equal(entityNameOf(n("a", "Ciclo de Dinero Secreto y Presión en Pareja")), "");
  assert.equal(entityNameOf(n("a", "dinero oculto")), "");
});

test("una neurona nueva sobre la misma persona se fusiona con la existente", () => {
  const existing = [n("j1", "Lucas: amigo y conexión clave"), n("x", "Sofía", "person")];
  const cand = n("new", "Lucas: hijo de Marta, no es familiar", "pattern", "housing");
  const d = shouldMergeNeuron(cand, existing);
  assert.equal(d.action, "merge_existing");
  assert.equal(d.matchId, "j1");
});

test("no fusiona conceptos que no son personas aunque compartan la primera palabra", () => {
  const existing = [n("p1", "Ansiedad: antes de reuniones", "pattern", "emotions")];
  const cand = n("p2", "Ansiedad: al volver al trabajo", "pattern", "work");
  assert.notEqual(shouldMergeNeuron(cand, existing).matchId, "p1");
});
