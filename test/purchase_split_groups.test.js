/**
 * purchase_split_groups.test.js — Finanzas por partes y grupos de la biblioteca (datos inventados)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SPLIT_MAIN, SPLIT_SKIP, alreadyInFinance, initialChoices, rememberChoices, buildFinanceGroups, itemKey } from "../src/shopping/purchaseSplit.js";
import { classifyProductName, proposeGroups } from "../src/shopping/productGroups.js";

const now = new Date(2026, 10, 14, 19, 0);
const items = [
  { id: "a", name: "Pepsi 750ml", productId: "pp", price: 5.5, qty: 1 },
  { id: "b", name: "Limón", price: 0.68, qty: 1 },
  { id: "c", name: "Volt", productId: "vv", price: 2.5, qty: 2 },
  { id: "d", name: "Tomate", price: 4.11, qty: 1 },
];

test("por partes: lo separado va en su categoría y lo de la misma categoría se junta", () => {
  const g = buildFinanceGroups(items, { a: "Bebidas", c: "Bebidas", b: SPLIT_MAIN, d: SPLIT_MAIN }, { mainCategory: "Alimentos", store: "Tambo" });
  assert.equal(g.length, 2);
  const main = g.find((x) => x.key === "main");
  const beb = g.find((x) => x.key === "Bebidas");
  assert.equal(main.amount, 4.79);
  assert.equal(main.note, "🧺 Limón, Tomate · Tambo");
  assert.equal(beb.amount, 10.5);
  assert.equal(beb.category, "Bebidas");
});

test("por partes: lo que ya está en Finanzas no se suma", () => {
  const g = buildFinanceGroups(items, { a: SPLIT_SKIP }, { mainCategory: "Alimentos" });
  assert.equal(g.length, 1);
  assert.equal(g[0].amount, 0.68 + 5 + 4.11);
});

test("duplicado: mismo monto y nombre en la nota, hoy o ayer, y no de una compra", () => {
  const ledger = [
    { type: "expense", amount: 5.5, note: "Pepsi en la oficina", date: new Date(2026, 10, 14, 12, 0).toISOString() },
    { type: "expense", amount: 2.5 * 2, note: "volt", date: new Date(2026, 10, 10).toISOString() },
    { type: "expense", amount: 4.11, note: "Tomate", date: new Date(2026, 10, 14).toISOString(), source: "shopping" },
  ];
  assert.ok(alreadyInFinance(items[0], ledger, now));
  assert.equal(alreadyInFinance(items[2], ledger, now), null, "hace 4 días no cuenta");
  assert.equal(alreadyInFinance(items[3], ledger, now), null, "lo de La Canasta no cuenta");
  const { choices, dupes } = initialChoices(items, { ledger, now, categories: ["Bebidas"] });
  assert.equal(choices.a, SPLIT_SKIP);
  assert.ok(dupes.a);
});

test("costumbre: se recuerda lo que se separó y se olvida si se vuelve a juntar", () => {
  let h = rememberChoices({}, items, { a: "Bebidas", b: SPLIT_MAIN });
  assert.equal(h[itemKey(items[0])], "Bebidas");
  const { choices } = initialChoices(items, { habits: h, categories: ["Bebidas", "Alimentos"], now });
  assert.equal(choices.a, "Bebidas");
  assert.equal(choices.b, SPLIT_MAIN);
  h = rememberChoices(h, items, { a: SPLIT_MAIN });
  assert.equal(h[itemKey(items[0])], undefined);
});

test("grupos: nombres comunes de Perú", () => {
  const cases = { "Pepsi 750ml": "Bebidas", "Sporade": "Bebidas", "Pollo entero": "Pollo", "Pollo a la brasa": "Comida preparada", "Carne molida": "Carnes", "Palta": "Frutas", "Tomate": "Verduras", "Leche Gloria": "Lácteos y huevos", "Arroz Costeño 5kg": "Abarrotes", "Pan francés": "Panadería", "Galletas Soda": "Snacks y dulces", "Detergente Ariel": "Limpieza", "Papel higiénico": "Higiene personal", "Paté": "Embutidos" };
  for (const [n, g] of Object.entries(cases)) assert.equal(classifyProductName(n), g, n);
  assert.equal(classifyProductName("Cosa rara xyz"), null);
});

test("grupos: propuesta para la biblioteca", () => {
  const r = proposeGroups([{ id: "1", name: "Pepsi", category: "Cena" }, { id: "2", name: "Leche", category: "Lácteos y huevos" }, { id: "3", name: "Zzz raro", category: "" }]);
  assert.deepEqual(r.changes.map((c) => [c.id, c.to]), [["1", "Bebidas"]]);
  assert.deepEqual(r.unknown.map((u) => u.id), ["3"]);
});
