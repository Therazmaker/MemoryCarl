import assert from "node:assert";
import test from "node:test";
import {
  getTodayMovements,
  buildDailyFlowContext,
  inferWorkdayStatus,
  evaluateHedonicOpportunity,
  hasProhibitedTone,
  generateDeterministicFallback
} from "../src/services/dailyFlowEngine.js";
import {
  loadFinanceDayHistory,
  saveFinanceDayHistory,
  closeDayIfNeeded,
  recordDailySnapshot,
  getYesterdaySnapshot,
  getWeekdayPattern
} from "../src/services/financeDayHistory.js";

// Mock localStorage
const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k] || null,
  setItem: (k, v) => store[k] = String(v),
  removeItem: (k) => delete store[k]
};

test("FASE 1: getTodayMovements extrae gastos de hoy", () => {
  const now = new Date("2026-09-29T12:00:00-05:00");
  const state = {
    financeMovementsV2: [
      { date: "2026-09-29T09:00:00-05:00", type: "expense", category: "Alimentos", amount: 14, note: "menu ejecutivo" },
      { date: "2026-09-29T10:00:00-05:00", type: "income", category: "Sueldo", amount: 500, note: "pago" },
      { date: "2026-09-28T09:00:00-05:00", type: "expense", category: "Transporte", amount: 10, note: "ayer" }
    ]
  };

  const movs = getTodayMovements(state, now);
  assert.strictEqual(movs.length, 1);
  assert.strictEqual(movs[0].amount, 14);
  assert.strictEqual(movs[0].category, "Alimentos");
});

test("FASE 2: financeDayHistory registra e idempotentemente mantiene fotos", () => {
  // Clear history
  saveFinanceDayHistory({});

  const day1 = new Date("2026-09-28T12:00:00-05:00");
  const state1 = {
    financeMovementsV2: [{ date: "2026-09-28T08:00:00-05:00", type: "expense", category: "Transporte", amount: 12, note: "Taxi" }]
  };

  const ctx1 = buildDailyFlowContext(state1, day1);
  const hist1 = loadFinanceDayHistory();
  assert.strictEqual(Object.keys(hist1).length, 1);
  assert.strictEqual(hist1["2026-09-28"].closed, false);
  assert.strictEqual(hist1["2026-09-28"].hadMobilityExpense, true);

  // Re-opening on same day 1
  buildDailyFlowContext(state1, day1);
  assert.strictEqual(Object.keys(loadFinanceDayHistory()).length, 1);

  // Day 2
  const day2 = new Date("2026-09-29T12:00:00-05:00");
  const ctx2 = buildDailyFlowContext({}, day2);
  const hist2 = loadFinanceDayHistory();
  assert.strictEqual(Object.keys(hist2).length, 2);
  assert.strictEqual(hist2["2026-09-28"].closed, true);
  assert.strictEqual(hist2["2026-09-29"].closed, false);

  const yesterday = getYesterdaySnapshot(day2);
  assert.ok(yesterday);
  assert.strictEqual(yesterday.totalSpentReal, 12);
});

test("FASE 3: inferWorkdayStatus infiere días libres vs laborales", () => {
  // Con menos de 4 muestras -> sin_datos_suficientes
  saveFinanceDayHistory({});
  const resEmpty = inferWorkdayStatus({ todayMovements: [] }, new Date("2026-09-29T14:00:00-05:00"));
  assert.strictEqual(resEmpty.status, "sin_datos_suficientes");

  // Crear 4 martes pasados con movilidad
  const hist = {
    "2026-09-01": { weekday: 2, hadMobilityExpense: true, closed: true },
    "2026-09-08": { weekday: 2, hadMobilityExpense: true, closed: true },
    "2026-09-15": { weekday: 2, hadMobilityExpense: true, closed: true },
    "2026-09-22": { weekday: 2, hadMobilityExpense: true, closed: true }
  };
  saveFinanceDayHistory(hist);

  // Antes de las 11 AM sin movilidad -> ambiguo (no declara parece_dia_libre temprano)
  const earlyRes = inferWorkdayStatus({ todayMovements: [] }, new Date("2026-09-29T09:00:00-05:00"));
  assert.notStrictEqual(earlyRes.status, "parece_dia_libre");

  // Después de las 11 AM sin movilidad -> parece_dia_libre
  const lateRes = inferWorkdayStatus({ todayMovements: [] }, new Date("2026-09-29T14:00:00-05:00"));
  assert.strictEqual(lateRes.status, "parece_dia_libre");

  // Después de las 11 AM con movilidad -> dia_laboral
  const workRes = inferWorkdayStatus({ todayMovements: [{ category: "Transporte", amount: 10 }] }, new Date("2026-09-29T14:00:00-05:00"));
  assert.strictEqual(workRes.status, "dia_laboral");
});

test("FASE 4: Tono estricto y fallback determinista hecho + efecto", () => {
  assert.strictEqual(hasProhibitedTone("Ayer te pasaste, deberías cuidar tu dinero."), true);
  assert.strictEqual(hasProhibitedTone("Cuidado con el saldo."), true);
  assert.strictEqual(hasProhibitedTone("Evita compras en la calle."), true);
  assert.strictEqual(hasProhibitedTone("Ayer gastaste S/12 más de lo previsto. Hoy tu margen es S/14.50."), false);

  const ctx = {
    date: "2026-09-29",
    liquidity: { dailyFreeBudget: 18.5, runway: { label: "Quincena del 15" } },
    hasHomeLunchReady: true,
    todayMovements: [],
    workdayStatus: { status: "dia_laboral" }
  };

  const text = generateDeterministicFallback(ctx, new Date("2026-09-29T12:00:00-05:00"));
  assert.strictEqual(hasProhibitedTone(text), false);
  assert.ok(text.includes("S/ 18.50"));
});

test("FASE 5: Oportunidad hedónica no recomienda premio si ya se gastó uno hoy", () => {
  const products = [
    { id: "p1", name: "Monster", tier: "premio_premium", rating: 5, context: "oficina", price: 7.5 }
  ];

  const noSpend = evaluateHedonicOpportunity(products, "bueno", new Date(), []);
  assert.strictEqual(noSpend.shouldUpgradeToReward, true);

  const withSpend = evaluateHedonicOpportunity(products, "bueno", new Date(), [{ category: "Ocio", amount: 8, note: "Monster" }]);
  assert.strictEqual(withSpend.shouldUpgradeToReward, false);
  assert.strictEqual(withSpend.alreadySpentToday, true);
});
