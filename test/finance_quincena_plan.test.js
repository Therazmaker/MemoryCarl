import test from "node:test";
import assert from "node:assert/strict";

import { computeQuincenaPlan, buildQuincenaPlanCard, normalizePlan, periodForDay, buildCashTimeline, autoAssignUnassigned, owedOf } from "../src/finance/finance_quincena_plan.js";

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
  // Lo que vence del 15 al 29 sale del 15; lo del último y los primeros días, del último
  assert.equal(periodForDay(20), "q15");
  assert.equal(periodForDay(10), "q30");
  assert.equal(periodForDay(30), "q30");
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

test("Fergis: cada uno con sus cobros, sus pagos y su propia reserva", () => {
  const p = {
    periods: {
      q15: { income: 1250, fergisIncome: 900, rows: [{ id: "a", itemId: "ce", amount: 100, payer: "me" }] },
      q30: { income: 1250, fergisIncome: 900, rows: [{ id: "b", itemId: "alq", amount: 1500, payer: "me" }, { id: "c", label: "Colegio", amount: 1000, payer: "fergis" }] },
    },
  };
  const c = computeQuincenaPlan(p, items);
  assert.equal(c.usesFergis, true);
  assert.equal(c.periods.q15.people.me.reserveForNext, 250);
  assert.equal(c.periods.q15.people.fergis.reserveForNext, 100);
  assert.equal(c.periods.q15.people.me.free, 900);
  assert.equal(c.periods.q15.people.fergis.free, 800);
  assert.equal(c.periods.q15.free, 1700);
  assert.equal(c.people.fergis.free, 800);
  assert.ok(c.warnings.some((w) => w.person === "fergis" && /guarda S\/ 100/.test(w.text)));
  const card = buildQuincenaPlanCard(p, items);
  assert.match(card, /junto con Fergis/);
  assert.match(card, /Colegio: S\/ 1000 \(paga Fergis\)/);
  assert.match(card, /Fergis NO puede gastar entera su quincena del 15: hay que guardar S\/ 100/);
});

test("si a uno no le alcanza y al otro le sobra, se avisa que pueden cubrirse", () => {
  const p = { periods: { q15: { income: 100, fergisIncome: 1000, rows: [{ id: "a", label: "Mercado", amount: 400, payer: "me" }] }, q30: {} } };
  const c = computeQuincenaPlan(p, []);
  const w = c.warnings.find((x) => x.level === "bad");
  assert.match(w.text, /faltan S\/ 300/);
  assert.match(w.text, /A Fergis le sobran S\/ 1000/);
});

test("pago que vence antes del cobro y línea de caja del mes", () => {
  const p = { periods: { q15: { income: 1250, rows: [{ id: "a", itemId: "luz", amount: 80, payer: "me" }] }, q30: { income: 1250, rows: [{ id: "b", itemId: "alq", amount: 1500, payer: "me" }] } } };
  const c = computeQuincenaPlan(p, items);
  assert.equal(c.periods.q15.rows[0].late, true, "la luz vence el 10 y se paga con el 15");
  assert.ok(c.warnings.some((w) => /Luz vence el día 10/.test(w.text)));
  const t = buildCashTimeline(p, items);
  assert.deepEqual(t.events.map((e) => [e.day, e.kind, e.amount]), [[15, "in", 1250], [15, "out", 80], [30, "in", 1250], [30, "out", 1500]]);
  assert.equal(t.end.me, 920);
  assert.equal(t.lowest.me, 0);
});

test("en un mes de 31 días, lo que vence el 29 y se paga con el último avisa que llega tarde", () => {
  const its = [{ id: "x", name: "Internet", amount: 90, dueDay: 29, status: "pending", type: "commitment" }];
  const p = { periods: { q15: { income: 500, rows: [] }, q30: { income: 500, rows: [{ id: "r", itemId: "x", amount: 90 }] } } };
  assert.equal(computeQuincenaPlan(p, its, { lastDay: 31 }).periods.q30.rows[0].late, true);
  assert.equal(computeQuincenaPlan(p, its, { lastDay: 29 }).periods.q30.rows[0].late, false);
  assert.equal(periodForDay(30, 31), "q30", "el alquiler del 30 se sugiere con el último (con aviso si cobras el 31)");
  assert.equal(periodForDay(27, 31), "q15");
  const t = buildCashTimeline(p, its, { lastDay: 31 });
  assert.equal(t.events.find((e) => e.kind === "out").day, 31);
});

test("pagado a medias: solo cuenta lo que falta", () => {
  const its = [{ id: "luz", name: "Luz", amount: 120, partialPaid: 50, pendingAmount: 70, dueDay: 20, status: "pending", type: "commitment" }];
  assert.equal(owedOf(its[0]), 70);
  const c = computeQuincenaPlan({}, its);
  assert.equal(c.unassigned[0].remaining, 70);
  const c2 = computeQuincenaPlan({ periods: { q15: { income: 500, rows: [{ id: "r", itemId: "luz", amount: 70 }] } } }, its);
  assert.equal(c2.periods.q15.rows[0].partial, false, "70 de 70 pendientes no es adelanto");
  assert.equal(c2.unassigned.length, 0);
});

test("ubicar todo según su fecha, a nombre de quien se elija", () => {
  const its = [
    { id: "a", name: "Internet", amount: 90, dueDay: 20, status: "pending", type: "commitment" },
    { id: "b", name: "Alquiler", amount: 1500, dueDay: 30, status: "pending", type: "commitment" },
    { id: "c", name: "Luz", amount: 80, dueDay: 5, status: "pending", type: "commitment" },
    { id: "d", name: "Gas", amount: 40, dueDay: 25, status: "paid", type: "commitment" },
  ];
  let i = 0;
  const { plan, count } = autoAssignUnassigned({ periods: { q15: { income: 1250 }, q30: { income: 1250 } } }, its, { payer: "fergis", newId: () => `n${i++}` });
  assert.equal(count, 3, "lo pagado no se ubica");
  assert.deepEqual(plan.periods.q15.rows.map((r) => r.label), ["Internet"]);
  assert.deepEqual(plan.periods.q30.rows.map((r) => r.label).sort(), ["Alquiler", "Luz"]);
  assert.ok([...plan.periods.q15.rows, ...plan.periods.q30.rows].every((r) => r.payer === "fergis"));
  assert.equal(computeQuincenaPlan(plan, its).unassigned.length, 0);
  assert.equal(autoAssignUnassigned(plan, its).count, 0, "no duplica");
});
