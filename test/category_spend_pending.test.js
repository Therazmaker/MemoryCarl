/**
 * category_spend_pending.test.js — "En qué se va" nunca muestra "Sin categoría" (datos inventados)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { categorySpend } from "../src/shopping/basketEngine.js";

test("en qué se va: nunca 'Sin categoría'; lo que no tiene grupo queda pendiente", () => {
  const hist = [{ date: "2026-01-20", items: [
    { name: "Pepsi", price: 5.5, qty: 1, category: "" },
    { name: "Cosa rara", productId: "zz", price: 3, qty: 2, category: "" },
    { name: "Leche", price: 4, qty: 1, category: "Lácteos y huevos" },
  ] }];
  const resolve = (it) => (it.name === "Pepsi" ? "Bebidas" : it.category);
  const c = categorySpend(hist, { days: 30, now: new Date(2026, 0, 25), resolve });
  assert.deepEqual(c.map((x) => x.category), ["Bebidas", "Lácteos y huevos"]);
  assert.ok(!c.some((x) => /sin categor/i.test(x.category)));
  assert.deepEqual(c.pending, [{ name: "Cosa rara", productId: "zz", total: 6 }]);
});
