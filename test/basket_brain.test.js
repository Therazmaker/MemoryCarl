/**
 * basket_brain.test.js — el cerebro de La Canasta (respuestas de IA simuladas, datos inventados)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseBrainReply, brainItemsToParsed, brainContext, askBrain } from "../src/shopping/basketBrain.js";
import { analyzeList } from "../src/shopping/basketEngine.js";

const products = [
  { id: "p1", name: "Coca-Cola 3L", price: 12, unit: "u", category: "Bebidas" },
  { id: "p2", name: "Tomate", price: 4, unit: "kg", category: "Verduras" },
];

test("cerebro: lee el JSON aunque venga con ```", () => {
  const r = parseBrainReply('```json\n{"intent":"compra","items":[{"name":"Pepsi","qty":1,"price":5.5}],"reply":"ok"}\n```');
  assert.equal(r.intent, "compra");
  assert.equal(r.items[0].price, 5.5);
});

test("cerebro: intención desconocida o JSON roto", () => {
  assert.equal(parseBrainReply('{"intent":"otra","reply":"hola"}').intent, "pregunta");
  assert.equal(parseBrainReply("no es json"), null);
});

test("cerebro: items de la IA → lista con precios correctos (por unidad y por kg)", () => {
  const items = [
    { name: "Coca-Cola 3L", productId: "p1", qty: 2, unit: "u", price: 12, paid: null },
    { name: "Tomate", productId: "p2", qty: null, unit: "", price: null, paid: 3 },
    { name: "Pepsi", productId: null, qty: 1, unit: "u", price: 5.5, paid: null },
  ];
  const a = analyzeList(brainItemsToParsed(items, products), { products, rhythm: new Map() });
  const by = Object.fromEntries(a.items.map((i) => [i.name, i]));
  assert.equal(by["Coca-Cola 3L"].line, 24);
  assert.equal(by.Tomate.line, 3);
  assert.equal(by.Tomate.qty, 0.75);
  assert.equal(by.Pepsi.line, 5.5);
  assert.equal(a.totals.all, 32.5);
});

test("cerebro: me_alcanza y rutina", () => {
  const r = parseBrainReply('{"intent":"me_alcanza","spend":{"amount":15,"desc":"almuerzo","mealType":"almuerzo","who":"yo"},"reply":"x"}');
  assert.equal(r.spend.amount, 15);
  const q = parseBrainReply('{"intent":"rutina","routine":[{"name":"Volt","price":2.5,"qty":1,"days":"lun-vie"}]}');
  assert.deepEqual(q.routine[0].days, [1, 2, 3, 4, 5]);
});

test("cerebro: el contexto lleva biblioteca, dinero y rutinas", () => {
  const ctx = brainContext({ products, runway: { cash: 100, payday: { label: "el lun 30", daysLeft: 5 }, pending: 10, free: 90, homeFoodNeed: 30, routine: { total: 5 }, extra: 55 }, routines: [{ name: "Volt", price: 2.5, qty: 1, days: [1, 2] }] });
  assert.match(ctx, /p2\|Tomate\|4\|kg/);
  assert.match(ctx, /libre S\/ 90\.00/);
  assert.match(ctx, /Volt/);
});

test("cerebro: si Claude falla usa Gemini; sin claves no llama", async () => {
  const callClaude = async () => { throw new Error("529 overloaded"); };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"intent":"pregunta","reply":"hola"}' }] } }] }) });
  const r = await askBrain({ text: "hola", context: "", claude: { apiKey: "k" }, gemini: { apiKey: "g" }, callClaude, fetchImpl });
  assert.equal(r.provider, "Gemini");
  assert.equal(r.result.reply, "hola");
  const none = await askBrain({ text: "hola", context: "" });
  assert.equal(none.result, null);
});
