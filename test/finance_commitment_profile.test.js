import test from "node:test";
import assert from "node:assert/strict";

import { buildCommitmentProfile, commitmentMiniStats } from "../src/finance/finance_commitment_profile.js";

const NOW = new Date(2026, 10, 20, 12); // 20 nov 2026
const tpl = { id: "luz", name: "Luz", category: "Servicios", dueDay: 15, amountMode: "variable", baseAmount: 100 };
const inst = (mk, paid, { day = 10, expected = 100, status = "paid" } = {}) => ({
  id: `i_${mk}`, templateId: "luz", periodKey: mk, expectedAmount: expected, paidAmount: paid, actualAmount: paid,
  status, paidAt: paid ? new Date(Number(mk.slice(0, 4)), Number(mk.slice(5)) - 1, day, 12).toISOString() : null,
  dueDate: `${mk}-15`,
});

const history = [
  inst("2026-06", 90), inst("2026-07", 95), inst("2026-08", 100, { day: 20 }),
  inst("2026-09", 110), inst("2026-10", 115), inst("2026-11", 138),
];

test("historia de 12 meses, promedio, máximo y variación", () => {
  const p = buildCommitmentProfile(tpl, history, [], { now: NOW });
  assert.equal(p.series.length, 12);
  assert.equal(p.series[11].mk, "2026-11");
  assert.equal(p.series[11].isCurrent, true);
  assert.equal(p.paidCount, 6);
  assert.equal(p.avg, 108);
  assert.equal(p.max.mk, "2026-11");
  assert.equal(p.min.mk, "2026-06");
  assert.equal(p.changeVsPrev, 20);
  assert.equal(p.trend, "sube");
  assert.ok(p.slope > 0);
  assert.equal(p.total12, 648);
  assert.ok(p.insights.some((i) => /Subió 20%/.test(i.text)));
  assert.ok(p.insights.some((i) => /pago más alto/.test(i.text)));
});

test("puntualidad y racha", () => {
  const p = buildCommitmentProfile(tpl, history, [], { now: NOW });
  assert.equal(p.series.find((s) => s.mk === "2026-08").onTime, false);
  assert.equal(p.punctuality, 83);
  assert.equal(p.streak, 3);
  assert.ok(p.insights.some((i) => /3 meses seguidos/.test(i.text)));
});

test("estimación: variable promedia los últimos 3, fijo usa el monto base", () => {
  assert.equal(buildCommitmentProfile(tpl, history, [], { now: NOW }).forecast, 121);
  const fixed = { ...tpl, id: "alq", amountMode: "fixed", baseAmount: 1500 };
  const fixedHist = ["2026-09", "2026-10", "2026-11"].map((mk) => ({ ...inst(mk, 1500), templateId: "alq" }));
  const p = buildCommitmentProfile(fixed, fixedHist, [], { now: NOW });
  assert.equal(p.forecast, 1500);
  assert.equal(p.trend, "estable");
  assert.equal(p.variable, false);
});

test("pagos en movimientos completan meses sin instancia", () => {
  const ledger = [
    { id: "m1", type: "expense", amount: 80, commitmentId: "luz", date: new Date(2026, 3, 12).toISOString() },
    { id: "m2", type: "expense", amount: 5, commitmentId: "otro", date: new Date(2026, 3, 12).toISOString() },
    { id: "m3", type: "expense", amount: 99, commitmentId: "luz", archived: true, date: new Date(2026, 4, 12).toISOString() },
  ];
  const p = buildCommitmentProfile(tpl, history, ledger, { now: NOW });
  assert.equal(p.series.find((s) => s.mk === "2026-04").paid, 80);
  assert.equal(p.series.find((s) => s.mk === "2026-05").paid, 0);
});

test("sin pagos: perfil vacío con mensaje; mini stats para la tarjeta", () => {
  const p = buildCommitmentProfile(tpl, [], [], { now: NOW });
  assert.equal(p.paidCount, 0);
  assert.ok(p.insights[0].text.includes("Aún no hay pagos"));
  const mini = commitmentMiniStats(tpl, history, [], { now: NOW });
  assert.deepEqual(mini.series, [90, 95, 100, 110, 115, 138]);
  assert.equal(mini.changeVsPrev, 20);
});

test("la minigráfica ignora el mes en curso aún sin pagar", () => {
  const alq = { id: "alq", amountMode: "fixed", baseAmount: 1500 };
  const rows = ["2026-08", "2026-09", "2026-10"].map((mk) => ({ ...inst(mk, 1500), templateId: "alq" }));
  rows.push({ ...inst("2026-11", 0, { status: "pending" }), templateId: "alq" });
  assert.deepEqual(commitmentMiniStats(alq, rows, [], { now: NOW }).series, [1500, 1500, 1500]);
});

test("la racha exige meses seguidos: un mes sin pagar la corta", () => {
  const gaps = [inst("2026-06", 100), inst("2026-08", 100), inst("2026-10", 100)];
  const p = buildCommitmentProfile(tpl, gaps, [], { now: NOW });
  assert.equal(p.streak, 1, "noviembre en curso se salta; octubre cuenta y setiembre sin pago corta la racha");
  assert.ok(!p.insights.some((i) => /meses seguidos/.test(i.text)));
  const pending = [...history.slice(0, 5), { ...inst("2026-11", 0, { status: "pending" }) }];
  assert.equal(buildCommitmentProfile(tpl, pending, [], { now: NOW }).streak, 2, "el mes en curso sin pagar no corta la racha");
});
