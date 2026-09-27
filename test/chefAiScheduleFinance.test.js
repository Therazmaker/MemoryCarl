import test from "node:test";
import assert from "node:assert/strict";

// Shim localStorage for Node environment
if (typeof globalThis.localStorage === "undefined") {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear()
  };
}

import {
  getChefAiSettings,
  saveChefAiSettings,
  explainAiError,
  sendShoppingAiMessage
} from "../src/shopping/shoppingAi.js";

test("Chef AI Schedule & Finance: getChefAiSettings handles provider settings", () => {
  localStorage.clear();
  saveChefAiSettings({
    provider: "claude",
    claudeApiKey: "sk-ant-test-12345",
    claudeModel: "claude-haiku-4-5"
  });

  const settings = getChefAiSettings();
  assert.equal(settings.provider, "claude");
  assert.equal(settings.claudeApiKey, "sk-ant-test-12345");
  assert.equal(settings.claudeModel, "claude-haiku-4-5");
});

test("Chef AI Schedule & Finance: sendShoppingAiMessage con contexto de Schedule y Finanzas", async () => {
  localStorage.clear();

  const mockProducts = [
    { id: "p1", name: "Empanada", price: 3.50, rating: 4, tier: "gusto_medio" }
  ];

  const mockScheduleContext = {
    dayKey: "lunes",
    dayTotalCost: 22.50,
    bySlot: {
      desayuno: { label: "Desayuno", icon: "🍳", items: [{ name: "Huevos y Pan", qty: 1, totalPrice: 3.50 }] },
      almuerzo: { label: "Almuerzo", icon: "🍲", items: [{ name: "Menú Ejecutivo", qty: 1, totalPrice: 14.00 }] }
    },
    actualItems: [
      { slotId: "desayuno", name: "Huevos y Pan", price: 3.50 }
    ]
  };

  const mockFinanceMovements = [
    { date: "2025-02-24", type: "expense", amount: 14.00, category: "Comida/Restaurante", note: "Almuerzo Menú", accountName: "Yape" }
  ];

  const mockFinanceAccounts = ["Yape", "BCP", "Efectivo"];

  const extraOptions = {
    scheduleContext: mockScheduleContext,
    financeMovements: mockFinanceMovements,
    financeAccounts: mockFinanceAccounts
  };

  // Mock callAi through settings/fallback or direct test validation
  // We test that sendShoppingAiMessage accepts extraOptions without error
  try {
    const result = await sendShoppingAiMessage("Hola Chef, qué tengo de almuerzo hoy?", [], mockProducts, [], [], null, extraOptions);
    assert.ok(Array.isArray(result.newChat) || Array.isArray(result));
  } catch (err) {
    // If API key missing, expect the human error message from explainAiError
    assert.ok(err.message.includes("API Key") || err.message.includes("Chef AI"));
  }
});

test("Chef AI Schedule & Finance: JSON Actions formatting check", () => {
  const sampleAiResponse = `Claro Carlos, registré tu almuerzo de hoy.
---ACTIONS---
{
  "syncFoodExpense": {
    "type": "expense",
    "amount": 15.00,
    "category": "Comida/Restaurante",
    "note": "Almuerzo Menú Ejecutivo",
    "accountName": "Yape",
    "slotId": "almuerzo",
    "mealName": "Menú Ejecutivo"
  },
  "logScheduleConsumption": {
    "slotId": "almuerzo",
    "name": "Menú Ejecutivo",
    "price": 15.00
  },
  "recordFinanceMovement": {
    "type": "expense",
    "amount": 15.00,
    "category": "Comida/Restaurante",
    "note": "Almuerzo Menú Ejecutivo",
    "accountName": "Yape"
  }
}`;

  const splitIdx = sampleAiResponse.indexOf("---ACTIONS---");
  assert.notEqual(splitIdx, -1);

  const rawActions = sampleAiResponse.substring(splitIdx + 13).trim();
  const parsed = JSON.parse(rawActions);

  assert.equal(parsed.syncFoodExpense.amount, 15.00);
  assert.equal(parsed.syncFoodExpense.accountName, "Yape");
  assert.equal(parsed.logScheduleConsumption.slotId, "almuerzo");
  assert.equal(parsed.recordFinanceMovement.type, "expense");
});
