import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFinanceNeurons,
  summarizeFinanceNeurons,
  checkMovementAnomaly,
  buildFinanceHabitsPromptBlock,
  conceptOf,
} from "../src/finance/finance_habits.js";

const NOW = new Date(2026, 10, 20, 12, 0, 0); // 20 nov 2026
let seq = 0;
const at = (y, m, d) => new Date(y, m, d, 10, 0, 0).toISOString();
const exp = (amount, note, extra = {}) => ({ id: `e${++seq}`, type: "expense", amount, note, category: extra.category || "Alimentos", reason: "normal", date: extra.date, archived: false, ...extra });
const inc = (amount, note, extra = {}) => ({ id: `i${++seq}`, type: "income", amount, note, category: extra.category || "Sueldo", date: extra.date, archived: false, ...extra });

function sample() {
  seq = 0;
  const L = [];
  // Café: 6 veces este mes (hormiga), 2 el mes pasado
  for (let d = 1; d <= 18; d += 3) L.push(exp(9, "Café con pan", { date: at(2026, 10, d), reason: "impulso" }));
  L.push(exp(8, "café", { date: at(2026, 9, 5) }), exp(8, "Cafe", { date: at(2026, 9, 12) }));
  // Netflix y Spotify (suscripciones)
  L.push(exp(35, "Netflix", { category: "Ocio", date: at(2026, 10, 2) }), exp(35, "Netflix", { category: "Ocio", date: at(2026, 9, 2) }), exp(35, "Netflix", { category: "Ocio", date: at(2026, 8, 2) }));
  L.push(exp(20, "Spotify", { category: "Ocio", date: at(2026, 10, 3) }), exp(20, "Spotify", { category: "Ocio", date: at(2026, 9, 3) }), exp(20, "Spotify", { category: "Ocio", date: at(2026, 8, 3) }));
  // Gasto suelto → va a la categoría
  L.push(exp(60, "regalo cumpleaños", { category: "Otros", date: at(2026, 10, 10) }));
  // Préstamo a una persona
  L.push(exp(100, "le presté a Jhon", { category: "Otros", counterparty: "Jhon", isLoan: true, date: at(2026, 10, 4) }));
  L.push(inc(30, "Jhon me devolvió", { category: "Otros", counterparty: "jhon", date: at(2026, 10, 15) }));
  // Pozo y un gasto que sale de él
  L.push(inc(1000, "Quincena", { id: "q1", isSourcePool: true, sourcePoolName: "Quincena", date: at(2026, 10, 1) }));
  L.push(exp(950, "Alquiler", { category: "Hogar", sourceMovementId: "q1", date: at(2026, 10, 1) }));
  L.push(exp(950, "Alquiler", { category: "Hogar", date: at(2026, 9, 1) }), exp(950, "Alquiler", { category: "Hogar", date: at(2026, 8, 1) }));
  // Archivado: no cuenta
  L.push(exp(500, "Café", { archived: true, date: at(2026, 10, 2) }));
  return L;
}

test("concepto: primera palabra con sentido del nombre", () => {
  assert.equal(conceptOf({ note: "Café con pan · desayuno" }), "cafe");
  assert.equal(conceptOf({ note: "pagué 50 de luz" }), "luz");
  assert.equal(conceptOf({ note: "" }), "");
});

test("una neurona por hábito que se repite; lo suelto va a su categoría", () => {
  const model = buildFinanceNeurons(sample(), { now: NOW });
  const keys = model.neurons.map((n) => n.key);
  assert.ok(keys.includes("h:cafe"));
  assert.ok(keys.includes("h:netflix"));
  assert.ok(keys.includes("c:otros"), "regalo y préstamo quedan en Otros");
  assert.ok(!keys.some((k) => k.includes("regalo")));
  const cafe = model.neurons.find((n) => n.key === "h:cafe");
  assert.equal(cafe.count, 8, "el archivado no cuenta");
  assert.equal(cafe.thisMonth, 54);
  assert.equal(cafe.prevMonth, 16);
  assert.equal(cafe.tag, "antojo", "mayoría por impulso");
  assert.equal(model.neurons.find((n) => n.key === "h:netflix").tag, "suscripcion");
  assert.equal(model.neurons.find((n) => n.key === "h:alquiler").tag, "fijo");
});

test("personas y pozos se conectan con sus neuronas", () => {
  const model = buildFinanceNeurons(sample(), { now: NOW });
  const jhon = model.people.find((p) => p.key === "p:jhon");
  assert.equal(jhon.given, 100);
  assert.equal(jhon.received, 30);
  assert.equal(jhon.balance, 70);
  assert.ok(model.edges.some((e) => e.kind === "person" && [e.from, e.to].includes("p:jhon")));
  assert.ok(model.edges.some((e) => e.kind === "pool" && [e.from, e.to].includes("w:q1") && [e.from, e.to].includes("h:alquiler")));
  assert.equal(model.pools.find((p) => p.id === "q1").remaining, 50);
});

test("preferencias: renombrar, unir y marcar evitable", () => {
  const prefs = { labels: { "h:cafe": "Cafecito" }, merges: { "h:spotify": "h:netflix" }, verdicts: { "h:cafe": "evitable" } };
  const model = buildFinanceNeurons(sample(), { now: NOW, prefs });
  const cafe = model.neurons.find((n) => n.key === "h:cafe");
  assert.equal(cafe.label, "Cafecito");
  assert.equal(cafe.verdict, "evitable");
  assert.ok(!model.neurons.some((n) => n.key === "h:spotify"));
  assert.equal(model.neurons.find((n) => n.key === "h:netflix").count, 6);
});

test("resumen e insights en español, descartables", () => {
  const ledger = sample();
  const model = buildFinanceNeurons(ledger, { now: NOW });
  const s = summarizeFinanceNeurons(model);
  assert.ok(s.lines.some((l) => l.text.startsWith("Suscripciones: S/ 55")));
  const subs = s.insights.find((i) => i.title === "Suscripciones");
  assert.ok(subs);
  assert.ok(s.insights.some((i) => i.key === "p:jhon"));
  const again = summarizeFinanceNeurons(model, { prefs: { dismissed: [subs.id] } });
  assert.ok(!again.insights.some((i) => i.id === subs.id));
});

test("aviso de gasto fuera de lo normal", () => {
  const ledger = sample();
  const big = exp(45, "café gigante", { date: at(2026, 10, 19) });
  ledger.push(big);
  assert.match(checkMovementAnomaly(ledger, big, { now: NOW }), /veces lo que sueles pagar/);
  const normal = exp(10, "café", { date: at(2026, 10, 19) });
  ledger.push(normal);
  assert.equal(checkMovementAnomaly(ledger, normal, { now: NOW }), null);
});

test("bloque para Carl: compacto y vacío sin datos", () => {
  const block = buildFinanceHabitsPromptBlock(sample(), { now: NOW });
  assert.match(block, /HÁBITOS DE DINERO/);
  assert.match(block, /Jhon le debe S\/ 70/);
  assert.ok(block.length < 1000);
  assert.equal(buildFinanceHabitsPromptBlock([], { now: NOW }), "");
});

test("un hábito con nombre propio no hereda 'esencial' de su categoría", () => {
  const d = (n) => new Date(2026, 10, n, 9).toISOString();
  const L = [1, 2, 3].map((n) => ({ id: `x${n}`, type: "expense", amount: 40, note: "Café", category: "Alimentos", date: d(n) }));
  L.push(...[4, 5, 6].map((n) => ({ id: `y${n}`, type: "expense", amount: 120, note: "Supermercado", category: "Alimentos", date: d(n) })));
  const m = buildFinanceNeurons(L, { now: NOW });
  assert.notEqual(m.neurons.find((n) => n.key === "h:cafe").tag, "esencial");
  assert.equal(m.neurons.find((n) => n.key === "h:supermercado").tag, "esencial");
});
