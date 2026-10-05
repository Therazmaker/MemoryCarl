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

// 2. Test resolveScheduleItems with detailed fields
const products = [
  { id: "p1", name: "Pollo a la Brasa", price: 18.00, tier: "gusto_medio" }
];

const items = [
  { name: "Pollo a la Brasa", portions: 2, unit: "plato", unitPrice: 18.00, origin: "Comprado fuera", notes: "Extra papas" },
  { name: "Sopa Casera", qty: 2, estimatedPrice: 5.00 } // legacy item
];

const res = resolveScheduleItems(items, products);
assert.strictEqual(res.resolvedItems.length, 2);
assert.strictEqual(res.resolvedItems[0].portions, 2);
assert.strictEqual(res.resolvedItems[0].unit, "plato");
assert.strictEqual(res.resolvedItems[0].unitPrice, 18.00);
assert.strictEqual(res.resolvedItems[0].totalPrice, 36.00);
assert.strictEqual(res.resolvedItems[0].origin, "Comprado fuera");
assert.strictEqual(res.resolvedItems[0].notes, "Extra papas");

// Legacy item check
assert.strictEqual(res.resolvedItems[1].portions, 2);
assert.strictEqual(res.resolvedItems[1].unitPrice, 5.00);
assert.strictEqual(res.resolvedItems[1].totalPrice, 10.00);
assert.strictEqual(res.resolvedItems[1].foundInLibrary, false);

assert.strictEqual(res.totalCost, 46.00);

console.log("✓ resolveScheduleItems detailed tests passed");

// 3. Test schedule update normalization logic
const updatePayload = {
  dayKey: "miércoles",
  slotId: "almuerzo",
  items: [{ name: "Seco de Pollo", portions: 2, unitPrice: 16.00, origin: "Cocinado en casa", notes: "Con frejoles" }]
};

const targetKey = normalizeDayKey(updatePayload.dayKey);
assert.strictEqual(targetKey, "miercoles");

const formattedItems = updatePayload.items.map(it => ({
  name: String(it.name).trim(),
  portions: Math.max(0.1, Number(it.portions ?? it.qty) || 1),
  unitPrice: Number(it.unitPrice ?? it.estimatedPrice ?? it.price ?? 0),
  origin: String(it.origin || "Comprado fuera").trim(),
  notes: String(it.notes || "").trim()
}));

assert.strictEqual(formattedItems[0].name, "Seco de Pollo");
assert.strictEqual(formattedItems[0].portions, 2);
assert.strictEqual(formattedItems[0].unitPrice, 16.00);
assert.strictEqual(formattedItems[0].origin, "Cocinado en casa");
assert.strictEqual(formattedItems[0].notes, "Con frejoles");

console.log("✓ updateMealSchedule payload formatting tests passed");

console.log("ALL MEAL SCHEDULE TESTS PASSED! ✅");
