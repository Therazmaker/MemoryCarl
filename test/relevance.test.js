import test from "node:test";
import assert from "node:assert/strict";

import { buildRelevanceScorer, expandQuery } from "../src/neuro/relevance.js";

const N = (id, concept, summary, triggers = [], extra = {}) => ({ id, core: { concept, summary, domain: "general" }, triggers, connections: [], ...extra });
const neurons = [
  N("n_sofia", "Sofía (hija, 6 años)", "Mi hija Sofía va al colegio", ["sofia", "hija", "colegio"]),
  N("n_cansancio", "Agotamiento físico", "Cansancio después de turnos largos", ["agotamiento", "turnos"]),
  N("n_deudas", "Deudas con el banco", "Cuotas del préstamo atrasadas", ["deudas", "prestamo"]),
  N("n_trabajo", "Trabajo en la tienda", "Jornada en la tienda de ropa", ["tienda", "jornada"]),
  N("n_pedro", "Pedro", "Amigo del barrio", ["pedro"], { meta: { aliases: ["pedrito"] } }),
];
const score = buildRelevanceScorer(neurons);

test("charla sin relación con la vida: ninguna neurona", () => {
  assert.equal(score("qué película vemos hoy").size, 0);
  assert.equal(score("hola, bien y tú?").size, 0);
});

test("mencionar a alguien por nombre o alias la activa fuerte", () => {
  assert.ok(score("hoy vi a Sofía en el parque").get("n_sofia").mention);
  assert.ok(score("me escribió pedrito").get("n_pedro").relevance >= 0.9);
});

test("raíces y equivalencias", () => {
  const r = score("estoy muy cansado");
  assert.ok(r.get("n_cansancio")?.relevance > 0, "'cansado' encuentra 'cansancio'");
  assert.ok(score("me atrasé con la cuota del crédito").has("n_deudas"), "'crédito' equivale a deudas");
  assert.ok(expandQuery("plata").includes("dinero"));
  // una equivalencia pesa menos que la palabra exacta
  const exact = score("deudas").get("n_deudas").relevance;
  const syn = score("credito").get("n_deudas").relevance;
  assert.ok(exact > syn);
});

test("los últimos mensajes ayudan, con menos fuerza", () => {
  const r = score("y qué hago con eso", { context: "tengo deudas con el banco" });
  const d = r.get("n_deudas");
  assert.ok(d && d.relevance < 0.5 && d.context > 0);
});

test("con pocas neuronas, una coincidencia exacta de trigger igual alcanza", () => {
  const few = buildRelevanceScorer([
    N("a", "ansiedad en el trabajo", "me pongo ansioso", ["ansiedad", "trabajo"]),
    N("b", "ansiedad social", "en reuniones", ["ansiedad", "gente"]),
  ]);
  const r = few("tengo ansiedad");
  assert.ok(r.get("a").relevance >= 0.45 && r.get("b").relevance >= 0.45);
  assert.ok(r.get("a").keyHit);
});
