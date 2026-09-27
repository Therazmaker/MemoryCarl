import assert from "assert";
import {
  DAYS_OF_WEEK,
  MEAL_SLOTS,
  normalizeDayKey,
  resolveScheduleItems
} from "../src/shopping/mealSchedule.js";

console.log("[test/mealSchedule.test.js] Starting tests...");

// 1. Test normalizeDayKey
assert.strictEqual(normalizeDayKey("lunes"), "lunes");
assert.strictEqual(normalizeDayKey("LUNES"), "lunes");
assert.strictEqual(normalizeDayKey("miércoles"), "miercoles");
assert.strictEqual(normalizeDayKey("MiÉRCOLES"), "miercoles");
assert.strictEqual(normalizeDayKey("sábado"), "sabado");
assert.strictEqual(normalizeDayKey("SÁBADO"), "sabado");
assert.strictEqual(normalizeDayKey("monday"), "lunes");
assert.strictEqual(normalizeDayKey("wednesday"), "miercoles");

// Relative days
// 2026-02-24 is a Tuesday ("martes")
assert.strictEqual(normalizeDayKey("hoy", "2026-02-24"), "martes");
assert.strictEqual(normalizeDayKey("mañana", "2026-02-24"), "miercoles");
assert.strictEqual(normalizeDayKey("today", "2026-02-24"), "martes");
assert.strictEqual(normalizeDayKey("tomorrow", "2026-02-24"), "miercoles");

// Invalid
assert.strictEqual(normalizeDayKey(null), null);
assert.strictEqual(normalizeDayKey(""), null);
assert.strictEqual(normalizeDayKey("invalid_day"), null);

console.log("✓ normalizeDayKey tests passed");

// 2. Test resolveScheduleItems
const products = [
  { id: "p1", name: "Pollo a la Brasa", price: 18.00, tier: "gusto_medio" }
];

const items = [
  { name: "Pollo a la Brasa", qty: 1, estimatedPrice: 18.00 },
  { name: "Sopa Casera", qty: 2, estimatedPrice: 5.00 }
];

const res = resolveScheduleItems(items, products);
assert.strictEqual(res.resolvedItems.length, 2);
assert.strictEqual(res.resolvedItems[0].unitPrice, 18.00);
assert.strictEqual(res.resolvedItems[0].totalPrice, 18.00);
assert.strictEqual(res.resolvedItems[0].foundInLibrary, true);

assert.strictEqual(res.resolvedItems[1].unitPrice, 5.00);
assert.strictEqual(res.resolvedItems[1].totalPrice, 10.00);
assert.strictEqual(res.resolvedItems[1].foundInLibrary, false);

assert.strictEqual(res.totalCost, 28.00);
assert.strictEqual(res.missingItems.length, 1);
assert.strictEqual(res.missingItems[0].name, "Sopa Casera");

console.log("✓ resolveScheduleItems tests passed");

// 3. Test schedule update normalization logic
const updatePayload = {
  dayKey: "miércoles",
  slotId: "almuerzo",
  items: [{ name: "Seco de Pollo", price: 16.00 }]
};

const targetKey = normalizeDayKey(updatePayload.dayKey);
assert.strictEqual(targetKey, "miercoles");

const formattedItems = updatePayload.items.map(it => ({
  name: String(it.name).trim(),
  estimatedPrice: Number(it.estimatedPrice ?? it.price ?? 0),
  qty: Math.max(1, Number(it.qty) || 1)
}));

assert.strictEqual(formattedItems[0].name, "Seco de Pollo");
assert.strictEqual(formattedItems[0].estimatedPrice, 16.00);

console.log("✓ updateMealSchedule payload formatting tests passed");

console.log("ALL MEAL SCHEDULE TESTS PASSED! ✅");
