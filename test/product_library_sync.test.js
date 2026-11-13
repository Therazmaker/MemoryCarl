/**
 * product_library_sync.test.js — biblioteca de productos segura en la nube. Datos inventados.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mergeProducts, mergeById, libraryPayload, rebuildFromPurchases } from "../src/shopping/productLibrarySync.js";

test("biblioteca: la nube se une con lo local, no lo reemplaza", () => {
  const local = [{ id: "a", name: "Arroz", price: 20 }];
  const cloud = [{ id: "a", name: "Arroz", price: 18 }, { id: "b", name: "Leche", price: 4.2 }];
  const r = mergeProducts(local, cloud);
  assert.equal(r.products.length, 2);
  assert.equal(r.added, 1);
  assert.equal(r.products.find((p) => p.id === "a").price, 20, "sin fechas gana lo local");
});

test("biblioteca: teléfono vacío recupera todo de la nube", () => {
  const cloud = [{ id: "a", name: "Arroz", price: 18 }, { id: "b", name: "Leche", price: 4.2 }];
  assert.equal(mergeProducts([], cloud).products.length, 2);
});

test("biblioteca: gana la versión más reciente y se juntan los historiales", () => {
  const local = [{ id: "a", name: "Arroz", price: 20, updatedAt: "2026-01-01", history: [{ price: 19, date: "2025-12-01" }] }];
  const cloud = [{ id: "a", name: "Arroz", price: 22, updatedAt: "2026-02-01", history: [{ price: 20, date: "2026-01-01" }] }];
  const r = mergeProducts(local, cloud);
  assert.equal(r.products[0].price, 22);
  assert.equal(r.products[0].history.length, 2);
});

test("biblioteca: mismo nombre con otro id no se duplica", () => {
  const r = mergeProducts([{ id: "x1", name: "Tomate" }], [{ id: "x2", name: "tomate " }]);
  assert.equal(r.products.length, 1);
});

test("biblioteca: vacía no se sube", () => {
  assert.equal(libraryPayload([]), null);
  assert.equal(libraryPayload([{ name: "Arroz" }]).count, 1);
});

test("historial: se agregan las compras que falten por id", () => {
  const r = mergeById([{ id: "h1" }], [{ id: "h1" }, { id: "h2" }]);
  assert.equal(r.added, 1);
  assert.equal(r.list.length, 2);
});

test("reconstruir: productos con último precio, unidad kg y categoría desde las compras", () => {
  const history = [
    { date: "2026-01-02", store: "Mercado", items: [{ name: "Tomate", price: 3, qty: 1, weight_g: 750, pricePerKg: 4, category: "Verduras", productId: "tom" }, { name: "Leche", price: 4, qty: 2, category: "Lácteos" }] },
    { date: "2026-01-09", items: [{ name: "Leche", price: 4.5, qty: 1, category: "Lácteos" }] },
  ];
  const lists = [{ items: [{ name: "Pan", price: 0.4 }] }];
  let n = 0;
  const r = rebuildFromPurchases({ history, lists, existing: [{ name: "Pan" }], uid: () => `p${++n}` });
  assert.equal(r.added, 2, "el pan ya existe");
  const tom = r.products.find((p) => p.name === "Tomate");
  assert.equal(tom.unit, "kg"); assert.equal(tom.price, 4); assert.equal(tom.id, "tom");
  const leche = r.products.find((p) => p.name === "Leche");
  assert.equal(leche.price, 4.5); assert.equal(leche.history.length, 1); assert.equal(leche.category, "Lácteos");
});
