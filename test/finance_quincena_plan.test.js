import test from "node:test";
import assert from "node:assert/strict";

import { computeQuincenaPlan, buildQuincenaPlanCard, normalizePlan, periodForDay } from "../src/finance/finance_quincena_plan.js";

const items = [
  { id: "alq", name: "Alquiler", amount: 1500, dueDay: 30, status: "pending", type: "commitment" },
  { id: "ce", name: "Carlos Emilio", amount: 200, dueDay: 15, status: "pending", type: "debt" },
  { id: "luz", name: "Luz", amount: 80, dueDay: 10, status: "pending", type: "commitment" },
];

const plan = (q15 = {}, q30 = {}) => ({
  periods: {
    q15: { income: 1250, rows: [], ...q15 },
    q30: { income: 1250, rows: [], ...q30 },
  },
});

test("alquiler de 1500 con quincenas de 1250: el 15 no se puede gastar entero", () => {
  const c = computeQuincenaPlan(plan({}, { rows: [{ id: "r1", itemId: "alq", amount: 1500 }] }), items);
  assert.equal(c.periods.q30.reserveNeeded, 250);
  assert.equal(c.periods.q15.reserveForNext, 250);
  assert.equal(c.periods.q15.free, 1000);
  assert.equal(c.periods.q30.free, 0);
  assert.ok(c.warnings.some((w) => /guarda S\/ 250/.test(w.text)));
});

test("adelanto parcial: lo que falta sigue pendiente sin asignar", () => {
  const c = computeQuincenaPlan(plan({ rows: [{ id: "r1", itemId: "ce", amount: 100, note: "adelanto" }] }), items);
  const row = c.periods.q15.rows[0];
  assert.equal(row.partial, true);
  assert.equal(row.itemTotal, 200);
  const ce = c.unassigned.find((i) => i.id === "ce");
  assert.equal(ce.remaining, 100);
  assert.equal(c.periods.q15.free, 1150);
});

test("faltante del mes y sugerencia de quincena por día", () => {
  const c = computeQuincenaPlan(plan({ income: 500, rows: [{ id: "a", itemId: "luz", amount: 80 }, { id: "b", label: "Mercado", amount: 400 }] }, { income: 1000, rows: [{ id: "c", itemId: "alq", amount: 1500 }] }), items);
  assert.equal(c.periods.q15.free, 20 - 500);
  assert.equal(c.periods.q15.shortfall, 480);
  assert.equal(c.periods.q15.short, "15", "el número del día no se pisa");
  assert.ok(c.warnings.some((w) => w.level === "bad"));
  assert.equal(periodForDay(10), "q15");
  assert.equal(periodForDay(28), "q30");
});

test("imprevisto nuevo aparece como aviso y en la tarjeta del copiloto", () => {
  const withUnexp = [...items, { id: "u1", name: "Dentista", amount: 120, dueDay: 16, status: "pending", type: "unexpected" }];
  const p = plan({ rows: [{ id: "r1", itemId: "ce", amount: 100 }] }, { rows: [{ id: "r2", itemId: "alq", amount: 1500 }] });
  const c = computeQuincenaPlan(p, withUnexp);
  assert.ok(c.warnings.some((w) => w.itemId === "u1"));
  const card = buildQuincenaPlanCard(p, withUnexp, { monthLabel: "Noviembre 2026" });
  assert.match(card, /PLAN DE QUINCENAS \(Noviembre 2026\)/);
  assert.match(card, /Carlos Emilio: S\/ 100 \(adelanto de S\/ 200\)/);
  assert.match(card, /NO se puede gastar entera: hay que guardar S\/ 250/);
  assert.match(card, /Dentista S\/ 120 \(imprevisto\)/);
});

test("sin plan no hay tarjeta; datos raros se normalizan", () => {
  assert.equal(buildQuincenaPlanCard({}, items), "");
  const n = normalizePlan({ periods: { q15: { income: "-5", rows: [null, { id: 1, amount: "40" }] } } });
  assert.equal(n.periods.q15.income, 0);
  assert.equal(n.periods.q15.rows[0].amount, 40);
  assert.deepEqual(n.periods.q30.rows, []);
});

test("una fila cuya obligación ya no existe queda marcada", () => {
  const c = computeQuincenaPlan(plan({ rows: [{ id: "x", itemId: "borrada", label: "Vieja", amount: 50 }] }), items);
  assert.equal(c.periods.q15.rows[0].missing, true);
  assert.equal(c.periods.q15.allocated, 50);
});
