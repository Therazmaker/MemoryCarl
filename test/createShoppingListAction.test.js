import test from "node:test";
import assert from "node:assert/strict";
import { sendShoppingAiMessage, saveChefAiSettings } from "../src/shopping/shoppingAi.js";

test("Chef AI: Prompt system contains createShoppingList definition", async (t) => {
  // Mock localStorage for node environment
  if (typeof globalThis.localStorage === "undefined") {
    const store = {};
    globalThis.localStorage = {
      getItem: (key) => store[key] || null,
      setItem: (key, val) => { store[key] = String(val); },
      removeItem: (key) => { delete store[key]; }
    };
  }

  saveChefAiSettings({ provider: "gemini", geminiApiKey: "fake_gemini_key_for_test" });

  globalThis.fetch = async (url, options) => {
    return {
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '¡Claro! He creado tu lista de compras.\n---ACTIONS---\n{\n  "createShoppingList": {\n    "name": "Compra del 12 Jul",\n    "items": [\n      { "name": "Pollo", "qty": 2, "price": 18.5 },\n      { "name": "Arroz", "qty": 1 }\n    ]\n  }\n}'
                }
              ]
            }
          }
        ]
      })
    };
  };

  const products = [{ id: "p1", name: "Arroz", price: 4.20, category: "Abarrotes" }];
  const history = [];

  const res = await sendShoppingAiMessage("hoy compré 2kg de pollo y 1 arroz", history, products);

  assert.ok(res.actions, "Actions object should exist");
  assert.ok(res.actions.createShoppingList, "createShoppingList action should be extracted");
  assert.equal(res.actions.createShoppingList.name, "Compra del 12 Jul");
  assert.equal(res.actions.createShoppingList.items.length, 2);
  assert.equal(res.actions.createShoppingList.items[0].name, "Pollo");
  assert.equal(res.actions.createShoppingList.items[1].name, "Arroz");
});
