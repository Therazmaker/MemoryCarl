import test from "node:test";
import assert from "node:assert/strict";

import { parseListText, matchProduct, learnRhythm, weeklyMinimum, analyzeList, weeklySpend, categorySpend } from "../src/shopping/basketEngine.js";

const products = [
  { id: "arroz", name: "Arroz Costeño 5kg", price: 22, category: "Despensa", tier: "base_diario" },
  { id: "huevo", name: "Huevos (plancha)", price: 15, category: "Despensa", tier: "base_diario" },
  { id: "aceite", name: "Aceite vegetal 1L", price: 9.5, category: "Despensa" },
  { id: "pollo", name: "Pollo entero", price: 18, category: "Carnes" },
  { id: "gaseosa", name: "Gaseosa 3L", price: 10, category: "Bebidas", tier: "gusto_medio" },
];

test("lee listas pegadas de cualquier forma", () => {
  const items = parseListText(`Lista para el mercado:
- 2 kg de arroz
* huevos x2
• aceite
3 leches
pollo 1 kilo
[x] pan (6)
detergente, papel higiénico y sal
1,5 kg papa`);
  const by = Object.fromEntries(items.map((i) => [i.name.toLowerCase(), i]));
  assert.equal(by["arroz"].qty, 2); assert.equal(by["arroz"].unit, "kg");
  assert.equal(by["huevos"].qty, 2);
  assert.ok(by["aceite"]);
  assert.equal(by["leches"].qty, 3);
  assert.equal(by["pollo"].qty, 1); assert.equal(by["pollo"].unit, "kg");
  assert.equal(by["pan"].qty, 6);
  assert.ok(by["detergente"] && by["papel higiénico"] && by["sal"]);
  assert.equal(by["papa"].qty, 1.5);
  assert.ok(!items.some((i) => /lista/i.test(i.name)), "el encabezado no es un ítem");
});

test("encuentra el producto en la biblioteca", () => {
  assert.equal(matchProduct("arroz", products).id, "arroz");
  assert.equal(matchProduct("huevos", products).id, "huevo");
  assert.equal(matchProduct("Aceite", products).id, "aceite");
  assert.equal(matchProduct("detergente", products), null);
});

// Historial: huevos cada ~7 días, arroz cada ~14, aceite comprado hace 2 días (cada ~10)
const NOW = new Date("2026-11-20T12:00:00");
const H = (date, items, buyer = "yo") => ({ date, buyer, items });
const history = [
  H("2026-10-16", [{ productId: "huevo", name: "Huevos", qty: 1, price: 14 }, { productId: "arroz", name: "Arroz", qty: 1, price: 21 }, { productId: "aceite", name: "Aceite", qty: 1, price: 9 }]),
  H("2026-10-23", [{ productId: "huevo", name: "Huevos", qty: 1, price: 14 }]),
  H("2026-10-30", [{ productId: "huevo", name: "Huevos", qty: 1, price: 15 }, { productId: "arroz", name: "Arroz", qty: 1, price: 22 }], "fergis"),
  H("2026-10-28", [{ productId: "aceite", name: "Aceite", qty: 1, price: 9 }]),
  H("2026-11-06", [{ productId: "huevo", name: "Huevos", qty: 1, price: 15 }, { productId: "aceite", name: "Aceite", qty: 1, price: 9.5 }]),
  H("2026-11-13", [{ productId: "huevo", name: "Huevos", qty: 1, price: 15 }, { productId: "arroz", name: "Arroz", qty: 1, price: 22 }, { productId: "gaseosa", name: "Gaseosa", qty: 2, price: 10 }], "fergis"),
  H("2026-11-18", [{ productId: "aceite", name: "Aceite", qty: 1, price: 9.5 }]),
];

test("aprende cada cuánto se compra cada cosa, sin preguntar cuánto queda", () => {
  const r = learnRhythm(history, { now: NOW, products });
  const huevo = r.get("p:huevo");
  assert.equal(huevo.intervalDays, 7);
  assert.equal(huevo.daysSince, 7);
  assert.equal(huevo.status, "toca");
  assert.equal(huevo.confidence, "alta");
  assert.equal(r.get("p:arroz").intervalDays, 14);
  assert.equal(r.get("p:arroz").status, "tienes");
  assert.equal(r.get("p:aceite").daysSince, 2);
  assert.deepEqual(r.get("p:huevo").buyers, { yo: 3, fergis: 2 });
});

test("canasta mínima semanal: solo lo básico", () => {
  const r = learnRhythm(history, { now: NOW, products });
  const m = weeklyMinimum(r);
  const names = m.items.map((i) => i.name);
  assert.ok(names.includes("Huevos (plancha)"));
  assert.ok(!names.some((n) => /Gaseosa/.test(n)), "los gustos no entran al mínimo");
  // huevos 1/semana a 15 + arroz 0.5/semana a 22 + aceite ~0.7/semana a 9.5
  assert.ok(m.total > 30 && m.total < 40, `total ${m.total}`);
});

test("analiza la lista: falta, puede esperar, gusto y sin precio; avisa lo que se olvidó", () => {
  const r = learnRhythm(history, { now: NOW, products });
  const a = analyzeList(parseListText("aceite\ngaseosa x2\ndetergente\npollo"), { products, rhythm: r });
  const g = Object.fromEntries(a.items.map((i) => [i.written.toLowerCase(), i]));
  assert.equal(g["aceite"].group, "espera");
  assert.match(g["aceite"].reason, /hace 2 días/);
  assert.equal(g["gaseosa"].group, "gusto");
  assert.equal(g["gaseosa"].line, 20);
  assert.equal(g["detergente"].group, "sinprecio");
  assert.equal(g["pollo"].group, "falta");
  assert.equal(a.totals.wait, 9.5);
  assert.equal(a.totals.treats, 20);
  assert.ok(a.missing.some((m) => /Huevos/.test(m.name)), "los huevos ya tocan y no están en la lista");
});

test("gasto por semana y por categoría", () => {
  const w = weeklySpend(history.map((e) => ({ ...e, totals: { total: e.items.reduce((s, i) => s + i.price * i.qty, 0) } })), { weeks: 4, now: NOW });
  assert.equal(w.length, 4);
  assert.equal(w[3].start, "2026-11-16");
  assert.equal(w[3].total, 9.5);
  assert.equal(w[2].byBuyer.fergis, 57);
  const c = categorySpend(history.map((e) => ({ ...e, items: e.items.map((i) => ({ ...i, category: i.productId === "gaseosa" ? "Bebidas" : "Despensa" })) })), { days: 30, now: NOW });
  assert.equal(c[0].category, "Despensa");
});

test("fracciones al inicio y bebidas básicas", () => {
  const [a, b] = parseListText("1/2 kilo de arroz\nqueso 1/4 kg");
  assert.equal(a.name, "Arroz"); assert.equal(a.qty, 0.5); assert.equal(a.unit, "kg");
  assert.equal(b.name, "Queso"); assert.equal(b.qty, 0.25);
  const prods = [{ id: "agua", name: "Agua 7L", price: 8, category: "Bebidas", tier: "base_diario" }, { id: "gas", name: "Gaseosa", price: 10, category: "Bebidas" }];
  const r = learnRhythm([
    { date: "2026-11-01", items: [{ productId: "agua", name: "Agua", qty: 1, price: 8 }, { productId: "gas", name: "Gaseosa", qty: 1, price: 10 }] },
    { date: "2026-11-08", items: [{ productId: "agua", name: "Agua", qty: 1, price: 8 }, { productId: "gas", name: "Gaseosa", qty: 1, price: 10 }] },
  ], { now: new Date("2026-11-10T12:00:00"), products: prods });
  const names = weeklyMinimum(r).items.map((i) => i.name);
  assert.ok(names.includes("Agua 7L"), "el agua básica entra al mínimo");
  assert.ok(!names.includes("Gaseosa"), "la gaseosa sin nivel sigue siendo gusto por su nombre");
});
