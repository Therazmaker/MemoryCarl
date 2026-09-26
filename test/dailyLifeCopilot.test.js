/**
 * dailyLifeCopilot.test.js — Suite de Pruebas Unitarias para el Daily Life Copilot
 * Prueba:
 * 1. productIntelligence.js: Enriquecimiento hedónico, tiers, cálculo de abstinencia y formateo para IA.
 * 2. mealBundles.js: Creación de bundles, costo fraccional por porción, cálculo de ahorro vs calle, inventario activo y consumo.
 * 3. dailyFlowEngine.js: Runway quincenal (15 y último), evaluación de liquidez, oportunidad hedónica (premio vs base) y briefing.
 */

import test from "node:test";
import assert from "node:assert/strict";

// Mock localStorage para Node.js
const mockStore = {};
if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: (k) => mockStore[k] ?? null,
    setItem: (k, v) => { mockStore[k] = String(v); },
    removeItem: (k) => { delete mockStore[k]; },
    clear: () => { Object.keys(mockStore).forEach((k) => delete mockStore[k]); }
  };
}

function resetStorage() {
  Object.keys(mockStore).forEach((k) => delete mockStore[k]);
}

// Imports de los módulos desarrollados
import {
  enrichProductData,
  enrichAllProducts,
  getDaysSinceLastConsumed,
  formatProductForAiPrompt,
  PRODUCT_TIERS,
  PRODUCT_CONTEXTS
} from "../src/shopping/productIntelligence.js";

import {
  createMealBundle,
  consumeMealPortion,
  getActiveMealInventory,
  loadMealBundles,
  saveMealBundles,
  DEFAULT_STREET_COSTS
} from "../src/shopping/mealBundles.js";

import { explainAiError } from "../src/shopping/shoppingAi.js";

import {
  calculateFortnightRunway,
  computeDailyLiquidity,
  evaluateHedonicOpportunity,
  buildDailyFlowContext,
  generateDailyBriefing
} from "../src/services/dailyFlowEngine.js";

// ============================================================================
// 1. PRODUCT INTELLIGENCE TESTS
// ============================================================================

test("productIntelligence: enriquece automáticamente productos con defaults inteligentes", () => {
  const monster = enrichProductData({ name: "Monster Energy Mango Loco", price: 7.5 });
  assert.equal(monster.tier, PRODUCT_TIERS.PREMIUM);
  assert.equal(monster.rating, 5);
  assert.equal(monster.context, PRODUCT_CONTEXTS.OFICINA);

  const volt = enrichProductData({ name: "Volt Maca", price: 2.5 });
  assert.equal(volt.tier, PRODUCT_TIERS.BASE);
  assert.equal(volt.rating, 3);
  assert.equal(volt.context, PRODUCT_CONTEXTS.OFICINA);

  const empanada = enrichProductData({ name: "Empanada de Carne", price: 3.0 });
  assert.equal(empanada.tier, PRODUCT_TIERS.GUSTO);
  assert.equal(empanada.rating, 4);
  assert.equal(empanada.context, PRODUCT_CONTEXTS.CALLE_RAPIDA);
});

test("productIntelligence: calcula días desde el último consumo correctamente", () => {
  const now = new Date("2026-09-22T10:00:00Z");
  const p1 = { lastConsumedAt: "2026-09-17T10:00:00Z" };
  assert.equal(getDaysSinceLastConsumed(p1, now), 5);

  const pNever = { lastConsumedAt: null };
  assert.equal(getDaysSinceLastConsumed(pNever, now), null);
});

test("productIntelligence: formatea producto para el prompt con estrellas y estado", () => {
  const p = enrichProductData({ name: "Monster", price: 7.0, lastConsumedAt: "2026-09-12T00:00:00Z" });
  const promptStr = formatProductForAiPrompt(p, new Date("2026-09-22T00:00:00Z"));
  assert.ok(promptStr.includes("Monster"));
  assert.ok(promptStr.includes("S/ 7.00"));
  assert.ok(promptStr.includes("★★★★★"));
  assert.ok(promptStr.includes("consumido hace 10 día(s)"));
});

// ============================================================================
// 2. MEAL BUNDLES & SAVINGS TESTS
// ============================================================================

test("mealBundles: crea un bundle, calcula costo por porción y ahorro frente a comer fuera", () => {
  resetStorage();
  const bundle = createMealBundle({
    name: "Almuerzo: Pollo con Arroz y Plátano",
    mealType: "almuerzo",
    totalCost: 20.00,
    portions: 4,
    notes: "Hecho en casa"
  });

  assert.equal(bundle.portionsTotal, 4);
  assert.equal(bundle.portionsRemaining, 4);
  assert.equal(bundle.costPerPortion, 5.00); // 20 / 4
  assert.equal(bundle.streetReferenceCost, 15.00);
  assert.equal(bundle.savingsPerPortion, 10.00); // 15 - 5 = 10 soles de ahorro por porción
  assert.equal(bundle.status, "active");
});

test("mealBundles: consume porciones y actualiza inventario y estado completado", () => {
  resetStorage();
  const bundle = createMealBundle({
    name: "Cena Ligera",
    mealType: "cena",
    totalCost: 10.00,
    portions: 2
  });

  // Consumir 1ra porción
  const res1 = consumeMealPortion(bundle.id);
  assert.equal(res1.remaining, 1);
  assert.equal(res1.savingsToday, 7.00); // 12 (cena calle) - 5 = 7

  // Consumir 2da porción (se agota)
  const res2 = consumeMealPortion(bundle.id);
  assert.equal(res2.remaining, 0);
  assert.equal(res2.bundle.status, "completed");

  // Ya no debe aparecer en inventario activo
  const inv = getActiveMealInventory();
  assert.equal(inv.byMealType.cena.portions, 0);
});

// ============================================================================
// 3. DAILY FLOW & REWARD ENGINE TESTS
// ============================================================================

test("dailyFlowEngine: cálculo determinista de runway quincenal (15 y último)", () => {
  // Caso 1: Día 5 del mes -> faltan 10 días para el 15
  const d1 = new Date("2026-09-05T12:00:00");
  const r1 = calculateFortnightRunway(d1);
  assert.equal(r1.targetDay, 15);
  assert.equal(r1.daysRemaining, 10);

  // Caso 2: Día 15 -> día de cobro
  const d2 = new Date("2026-09-15T12:00:00");
  const r2 = calculateFortnightRunway(d2);
  assert.equal(r2.targetDay, 15);
  assert.equal(r2.rawDaysRemaining, 0);

  // Caso 3: Día 20 de septiembre (mes de 30 días) -> faltan 10 días para el 30
  const d3 = new Date("2026-09-20T12:00:00");
  const r3 = calculateFortnightRunway(d3);
  assert.equal(r3.targetDay, 30);
  assert.equal(r3.daysRemaining, 10);
});

test("dailyFlowEngine: cálculo de liquidez y margen libre diario restando compromisos", () => {
  const fakeState = {
    financeAccounts: [
      { id: "acc1", balance: 500.00 },
      { id: "acc2", balance: 100.00 }
    ],
    financeCommitments: [
      { id: "com1", amount: 120.00, dueDate: 10, resolved: false }, // Vence el 10 (antes del 15)
      { id: "com2", amount: 200.00, dueDate: 28, resolved: false }  // Vence el 28 (después del 15)
    ]
  };

  const now = new Date("2026-09-05T12:00:00"); // Quedan 10 días para el 15
  const liq = computeDailyLiquidity(fakeState, now);

  assert.equal(liq.totalBalance, 600.00);
  assert.equal(liq.upcomingCommitments, 120.00);
  assert.equal(liq.availableLiquidity, 480.00); // 600 - 120
  assert.equal(liq.dailyFreeBudget, 48.00);     // 480 / 10 días
  assert.equal(liq.liquidityHealth, "excelente");
  assert.equal(liq.accountsBreakdown.length, 2);
  assert.equal(liq.upcomingCommitmentsList.length, 1);
});

test("dailyFlowEngine: soporta calibración / override manual del saldo en cuenta", () => {
  resetStorage();
  const fakeState = {
    financeAccounts: [{ id: "acc1", balance: 50.00 }]
  };
  const now = new Date("2026-09-20T12:00:00"); // 10 días restantes para el 30

  // Sin override
  let liq = computeDailyLiquidity(fakeState, now);
  assert.equal(liq.totalBalance, 50.00);
  assert.equal(liq.dailyFreeBudget, 5.00);
  assert.equal(liq.isManualOverride, false);

  // Con override manual (ej: usuario tiene S/ 120 reales)
  localStorage.setItem("memorycarl_liquidity_override", "120.00");
  liq = computeDailyLiquidity(fakeState, now);
  assert.equal(liq.totalBalance, 120.00);
  assert.equal(liq.calculatedBalance, 50.00);
  assert.equal(liq.dailyFreeBudget, 12.00); // 120 / 10 días
  assert.equal(liq.isManualOverride, true);

  // Limpiar override
  localStorage.removeItem("memorycarl_liquidity_override");
  liq = computeDailyLiquidity(fakeState, now);
  assert.equal(liq.totalBalance, 50.00);
  assert.equal(liq.isManualOverride, false);
});

test("dailyFlowEngine: excluye cuentas de terceros (Fergis) y no resta compromisos fuera de ciclo (ej: día 1)", () => {
  resetStorage();
  const stateWithFergis = {
    financeAccounts: [
      { id: "bcp", name: "BCP", balance: 120.00 },
      { id: "fergis", name: "Fergis", balance: 163.88 }
    ],
    financeCommitments: [
      // Compromiso del día 1: Vence en el siguiente ciclo (mes entrante), no antes del 30
      { id: "c1", name: "Agua", amount: 138.00, dueDay: 1, resolved: false },
      // Compromiso del día 28: Vence dentro de este ciclo (entre hoy 23 y fin de mes 30)
      { id: "c2", name: "Internet", amount: 20.00, dueDay: 28, resolved: false }
    ]
  };

  const now = new Date("2026-09-23T12:00:00"); // 7 días para el 30
  const liq = computeDailyLiquidity(stateWithFergis, now);

  // Solo BCP (120) debe contar; Fergis no
  assert.equal(liq.totalBalance, 120.00);
  assert.equal(liq.accountsBreakdown.length, 1);
  assert.equal(liq.accountsBreakdown[0].name, "BCP");

  // Solo el compromiso del día 28 debe deducirse; el del día 1 vence el próximo mes
  assert.equal(liq.upcomingCommitmentsList.length, 1);
  assert.equal(liq.upcomingCommitmentsList[0].name, "Internet");
  assert.equal(liq.effectiveCommitments, 20.00);

  // Margen libre: (120 - 20) / 7 = 14.29 / día (nunca 0)
  assert.equal(liq.availableLiquidity, 100.00);
  assert.equal(liq.dailyFreeBudget, 14.29);
});

test("dailyFlowEngine: evaluación de oportunidad hedónica (luz verde para premio si hay abstinencia y liquidez)", () => {
  const products = [
    { id: "p1", name: "Volt", price: 2.5, tier: "base_diario", context: "oficina", rating: 3 },
    { id: "p2", name: "Monster", price: 7.0, tier: "premio_premium", context: "oficina", rating: 5, lastConsumedAt: "2026-09-10T00:00:00Z" }
  ];

  const now = new Date("2026-09-22T00:00:00Z"); // 12 días sin Monster
  const opp = evaluateHedonicOpportunity(products, "excelente", now);

  assert.equal(opp.shouldUpgradeToReward, true);
  assert.equal(opp.topPremium.name, "Monster");
  assert.equal(opp.topBase.name, "Volt");
  assert.equal(opp.daysSincePremium, 12);
});

test("dailyFlowEngine: genera briefing con fallback inteligente cuando Ollama no está configurado", async () => {
  resetStorage();
  createMealBundle({
    name: "Pollo con Verduras",
    mealType: "almuerzo",
    totalCost: 15.00,
    portions: 3
  });

  const fakeState = {
    products: [
      { id: "p1", name: "Volt", price: 2.5, tier: "base_diario", context: "oficina", rating: 3 },
      { id: "p2", name: "Monster", price: 7.0, tier: "premio_premium", context: "oficina", rating: 5, lastConsumedAt: "2026-09-10T00:00:00Z" }
    ],
    financeAccounts: [{ id: "acc1", balance: 400.00 }],
    financeCommitments: []
  };

  const now = new Date("2026-09-22T00:00:00Z");
  const res = await generateDailyBriefing(fakeState, now);

  assert.ok(res.briefingText.length > 20);
  assert.ok(res.briefingText.includes("almuerzo"));
  assert.ok(res.context.hasHomeLunchReady === true);
});

test("shoppingAi: explainAiError diagnostica con precisión límites de cuota, autenticación y CORS", () => {
  // Caso 1: Límite de llamadas gratis alcanzado (429 / Quota)
  const quotaErr = explainAiError(null, "Google Gemini", 429, "Resource has been exhausted (e.g. check quota)");
  assert.ok(quotaErr.includes("LÍMITE DE LLAMADAS ALCANZADO"));
  assert.ok(quotaErr.includes("429"));
  assert.ok(quotaErr.includes("Espera 1 o 2 minutos"));

  // Caso 2: API Key inválida (400 / 401)
  const authErr = explainAiError(null, "Google Gemini", 400, "API_KEY_INVALID");
  assert.ok(authErr.includes("ERROR DE AUTENTICACIÓN"));
  assert.ok(authErr.includes("Google AI Studio"));

  // Caso 3: Error de CORS o red
  const corsErr = explainAiError(new TypeError("Failed to fetch"), "Ollama Cloud");
  assert.ok(corsErr.includes("ERROR DE RED / CORS"));
  assert.ok(corsErr.includes("activa Google Gemini"));
});

// ============================================================================
// 4. MEAL SCHEDULE & PREDICTIVE PLAN TESTS
// ============================================================================

import {
  findProductInLibrary,
  resolveScheduleItems,
  getDayScheduleSummary,
  getWeeklyScheduleSummary,
  logActualConsumption,
  getPlannedVsActualForDate
} from "../src/shopping/mealSchedule.js";

test("mealSchedule: resolución automática de precios y detección de items faltantes en biblioteca", () => {
  resetStorage();
  const products = [
    { id: "p1", name: "Volt Blue", price: 2.50, tier: "base_diario" },
    { id: "p2", name: "Monster Mango Loco", price: 7.50, tier: "premio_premium" },
    { id: "p3", name: "Menú Ejecutivo", price: 14.00, tier: "base_diario" }
  ];

  // Caso 1: Item existe en biblioteca
  const match = findProductInLibrary("Volt Blue", products);
  assert.equal(match.id, "p1");
  assert.equal(match.price, 2.50);

  // Caso 2: Resolver lista mixta (con productos en biblioteca y productos faltantes)
  const items = [
    { name: "Volt Blue", qty: 2 }, // 2 * 2.50 = 5.00
    { name: "Menú Ejecutivo", qty: 1 }, // 1 * 14.00 = 14.00
    { name: "Pastel de Choclo Desconocido", qty: 1, estimatedPrice: 6.00 } // No existe en biblioteca
  ];

  const res = resolveScheduleItems(items, products);
  assert.equal(res.totalCost, 25.00); // 5 + 14 + 6
  assert.equal(res.missingItems.length, 1);
  assert.equal(res.missingItems[0].name, "Pastel de Choclo Desconocido");
});

test("mealSchedule: seguimiento inmutable de plan proyectado vs consumos reales", () => {
  resetStorage();
  const products = [
    { id: "p1", name: "Volt", price: 2.50 },
    { id: "p2", name: "Almuerzo", price: 14.00 }
  ];

  const dateIso = "2026-09-23"; // Miércoles
  // Registrar consumo real de hoy
  logActualConsumption(dateIso, { slotId: "almuerzo", name: "Almuerzo", price: 15.00, isPlanned: true });
  logActualConsumption(dateIso, { slotId: "bebidas", name: "Monster Extra", price: 7.50, isPlanned: false });

  const comp = getPlannedVsActualForDate(dateIso, products);
  assert.equal(comp.actualTotal, 22.50);
  assert.ok(comp.actualItems.length === 2);
  assert.ok(typeof comp.plannedTotal === "number");
});

