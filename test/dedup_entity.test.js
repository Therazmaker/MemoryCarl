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
  const existing = [{ ...n("j1", "Lucas: amigo y conexión clave"), triggers: ["lucas", "marta", "amigo"] }, n("x", "Sofía", "person")];
  const cand = { ...n("new", "Lucas: hijo de Marta, no es familiar", "pattern", "housing"), triggers: ["Marta", "departamento"] };
  const d = shouldMergeNeuron(cand, existing);
  assert.equal(d.action, "merge_existing");
  assert.equal(d.matchId, "j1");
});

test("no fusiona conceptos que no son personas aunque compartan la primera palabra", () => {
  const existing = [n("p1", "Ansiedad: antes de reuniones", "pattern", "emotions")];
  const cand = n("p2", "Ansiedad: al volver al trabajo", "pattern", "work");
  assert.notEqual(shouldMergeNeuron(cand, existing).matchId, "p1");
});

test("dos personas distintas con el mismo nombre no se fusionan sin más evidencia", () => {
  const ana1 = { ...n("a1", "Ana: compañera del trabajo"), triggers: ["oficina", "reunión"], core: { concept: "Ana: compañera del trabajo", domain: "relationships", summary: "Compañera de la oficina que lleva los reportes semanales." } };
  const ana2 = { ...n("a2", "Ana: vecina del tercer piso", "person"), triggers: ["edificio", "vecina"], core: { concept: "Ana: vecina del tercer piso", domain: "relationships", summary: "Vive arriba con su perro y a veces recibe paquetes." } };
  assert.notEqual(shouldMergeNeuron(ana2, [ana1]).matchId, "a1");
  // Con un trigger en común sí es la misma
  const ana3 = { ...ana2, id: "a3", triggers: ["oficina", "reportes"] };
  assert.equal(shouldMergeNeuron(ana3, [ana1]).matchId, "a1");
});
