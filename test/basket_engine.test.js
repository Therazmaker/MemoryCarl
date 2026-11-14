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

// ---- Productos por peso ----
import { isWeighed, weighedLine, kgFromWritten, weighedHistoryFields } from "../src/shopping/basketEngine.js";

test("peso: solo lo pagado estima los kg con el precio de la biblioteca", () => {
  const l = weighedLine({ pricePerKg: 4, paid: 3 });
  assert.deepEqual(l, { paid: 3, kg: 0.75, pricePerKg: 4, estimated: true });
  const h = weighedHistoryFields(l);
  assert.equal(h.price, 3); assert.equal(h.qty, 1); assert.equal(h.weight_g, 750); assert.equal(h.weightEstimated, true);
});

test("peso: pagado + kg aprende el precio real por kg", () => {
  const l = weighedLine({ pricePerKg: 4, paid: 4.5, kg: 1 });
  assert.equal(l.pricePerKg, 4.5); assert.equal(l.estimated, false);
  assert.equal(weighedHistoryFields(l).weightEstimated, undefined);
});

test("peso: solo kg calcula lo pagado; sin datos → null", () => {
  assert.equal(weighedLine({ pricePerKg: 4, kg: 0.5 }).paid, 2);
  assert.equal(weighedLine({ pricePerKg: 4 }), null);
});

test("peso: unidades escritas y producto por kg", () => {
  assert.equal(kgFromWritten(500, "g"), 0.5);
  assert.equal(kgFromWritten(1.5, "kg"), 1.5);
  assert.equal(kgFromWritten(3, ""), null);
  assert.equal(isWeighed({ unit: "kg" }), true);
  assert.equal(isWeighed({ unit: "u" }), false);
});

test("peso: el ritmo cuenta kg a precio por kg y la lista estima con eso", () => {
  const products = [{ id: "tom", name: "Tomate", price: 4, unit: "kg" }];
  const day = (n) => { const d = new Date(2026, 0, 30); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const history = [10, 5].map((n) => ({ date: day(n), items: [{ name: "Tomate", productId: "tom", price: 3, qty: 1, weight_g: 750, pricePerKg: 4, unit: "g" }] }));
  const rhythm = learnRhythm(history, { now: new Date(2026, 0, 30), products });
  const st = rhythm.get("p:tom");
  assert.equal(st.avgQty, 0.75);
  assert.equal(st.lastPrice, 4);
  const a = analyzeList(parseListText("tomate 500 g\ntomate"), { products, rhythm });
  assert.equal(a.items[0].weighed, true);
  assert.equal(a.items[0].qty, 0.5);
  assert.equal(a.items[0].line, 2);
  assert.equal(a.items[1].qty, 0.75); // sin peso escrito: lo de siempre
});

test("peso: solo lo pagado sin precio por kg conocido → null (hacen falta los kg)", () => {
  assert.equal(weighedLine({ pricePerKg: 0, paid: 3 }), null);
  assert.equal(weighedLine({ pricePerKg: 0, paid: 3, kg: 0.5 }).pricePerKg, 6);
});

test("lista: precios escritos ('a 3.20', '1 sol de pan') y verbos/artículos fuera del nombre", () => {
  const r = parseListText("Compré un Paté a 3.20, un Sporade a 2.5 y 1 sol de Pan");
  assert.deepEqual(r.map((x) => [x.name, x.price]), [["Paté", 3.2], ["Sporade", 2.5], ["Pan", 1]]);
  const a = analyzeList(r, { products: [], rhythm: new Map() });
  assert.equal(a.totals.all, 6.7);
  assert.ok(a.items.every((i) => i.group !== "sinprecio"));
  assert.deepEqual(parseListText("2 leches a 4.20").map((x) => [x.name, x.qty, x.price]), [["Leches", 2, 4.2]]);
  assert.deepEqual(parseListText("arroz 2kg").map((x) => [x.qty, x.unit, x.price]), [[2, "kg", undefined]]);
});

test("lista: producto por kilo con lo pagado escrito estima los kg", () => {
  const a = analyzeList(parseListText("tomate a 3"), { products: [{ id: "t", name: "Tomate", price: 4, unit: "kg" }], rhythm: new Map() });
  assert.equal(a.items[0].qty, 0.75);
  assert.equal(a.items[0].paid, 3);
  assert.equal(a.items[0].line, 3);
});

test("lista por kilo: peso escrito manda y sin precio por kg sigue por peso", () => {
  const tom = [{ id: "t", name: "Tomate", price: 4, unit: "kg" }];
  const a = analyzeList(parseListText("tomate 500 g a 3"), { products: tom, rhythm: new Map() });
  assert.equal(a.items[0].qty, 0.5);
  assert.equal(a.items[0].line, 3);
  assert.equal(a.items[0].kgWritten, true);
  const b = analyzeList(parseListText("tomate 500 g a 3"), { products: [{ id: "t", name: "Tomate", price: 0, unit: "kg" }], rhythm: new Map() });
  assert.equal(b.items[0].weighed, true);
  assert.equal(b.items[0].qty, 0.5);
  assert.equal(b.items[0].line, 3, "no 500 unidades a S/ 3");
  const c = analyzeList(parseListText("tomate a 3"), { products: [{ id: "t", name: "Tomate", price: 0, unit: "kg" }], rhythm: new Map() });
  assert.equal(c.items[0].weighed, true);
  assert.equal(c.items[0].line, 3);
});

test("lista: 'Pepsi 5.5' (decimales sin unidad) es precio; '2kg' y 'huevos 12' siguen siendo cantidad", () => {
  const r = parseListText("Pepsi 5.5\nLimón 0.68\nTomate 4.11\narroz 2kg\nhuevos 12\npollo 1.5 kg");
  assert.deepEqual(r.map((x) => [x.name, x.qty, x.unit, x.price]), [
    ["Pepsi", null, "", 5.5], ["Limón", null, "", 0.68], ["Tomate", null, "", 4.11],
    ["Arroz", 2, "kg", undefined], ["Huevos", 12, "", undefined], ["Pollo", 1.5, "kg", undefined],
  ]);
});
