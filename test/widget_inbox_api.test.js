/**
 * widget_inbox_api.test.js — Buzón de la app de widgets en el servidor (datos inventados)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateInboxItem, mountWidgetRoutes } = require("../api/src/widget/widgetInbox.js");

// Express y Supabase simulados
function fakeApp() {
  const routes = {};
  const add = (m) => (path, ...handlers) => { routes[`${m} ${path}`] = handlers; };
  return { routes, get: add("GET"), post: add("POST") };
}
function fakeDb() {
  const rows = new Map();
  const modules = new Map([["widget_summary", { payload: { runway: { free: 120 } }, updated_at: "2026-11-23T10:00:00Z" }]]);
  const from = (table) => {
    const q = { table, filters: [], op: "select" };
    const run = () => {
      if (table === "app_modules") {
        const id = q.filters.find((f) => f[0] === "eq")?.[2];
        return { data: modules.get(id) || null, error: null };
      }
      let list = [...rows.values()];
      for (const [k, col, v] of q.filters) {
        if (k === "is") list = list.filter((r) => (r[col] ?? null) === v);
        if (k === "in") list = list.filter((r) => v.includes(r[col]));
      }
      if (q.op === "update") { list.forEach((r) => Object.assign(r, q.patch)); return { data: null, error: null }; }
      return { data: list, error: null };
    };
    const api = {
      select() { return api; },
      is(c, v) { q.filters.push(["is", c, v]); return api; },
      in(c, v) { q.filters.push(["in", c, v]); return q.op === "update" ? Promise.resolve(run()) : api; },
      eq(c, v) { q.filters.push(["eq", c, v]); return api; },
      order() { return api; },
      limit() { return Promise.resolve(run()); },
      maybeSingle() { return Promise.resolve(run()); },
      upsert(list, opts) { for (const r of list) if (!(opts?.ignoreDuplicates && rows.has(r.id))) rows.set(r.id, { ...r, applied_at: null }); return Promise.resolve({ error: null }); },
      update(patch) { q.op = "update"; q.patch = patch; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return api;
  };
  return { rows, from };
}
async function call(app, key, { auth = "Bearer secreto", body = {}, query = {} } = {}) {
  const [mw, handler] = app.routes[key];
  const res = { code: 200, json(o) { this.body = o; return this; }, status(c) { this.code = c; return this; } };
  const req = { headers: { authorization: auth }, body, query };
  let passed = false;
  await mw(req, res, () => { passed = true; });
  if (passed) await handler(req, res);
  return res;
}

test("validar: gasto, diario y tareas; se rechaza lo inválido", () => {
  const ok = validateInboxItem({ id: "w_abc12345", kind: "expense", ts: Date.now(), data: { amount: "12,50", category: "Comida", accountId: "acc1", note: "almuerzo" } });
  assert.equal(ok.ok, true);
  assert.equal(ok.item.data.amount, 12.5);
  assert.equal(validateInboxItem({ id: "w_abc12345", kind: "expense", data: { amount: -3 } }).ok, false);
  assert.equal(validateInboxItem({ id: "corto", kind: "expense", data: { amount: 3 } }).ok, false);
  assert.equal(validateInboxItem({ id: "w_abc12345", kind: "borrar_todo", data: {} }).ok, false);
  assert.equal(validateInboxItem({ id: "w_abc12345", kind: "journal", data: { text: "   " } }).ok, false);
  assert.equal(validateInboxItem({ id: "w_abc12345", kind: "journal", data: { text: "Hoy fue un buen día", mood: "good" } }).item.data.mood, "good");
  assert.equal(validateInboxItem({ id: "w_abc12345", kind: "task_snooze", data: { taskId: "m1", remindAt: "2026-11-24T17:00:00Z" } }).item.data.remindAt, "2026-11-24T17:00:00.000Z");
});

test("rutas: exige la API key exacta (ni la anónima ni 'auto')", async () => {
  process.env.API_SECRET_KEY = "secreto";
  const app = fakeApp();
  mountWidgetRoutes(app, () => fakeDb());
  assert.equal((await call(app, "GET /api/widget/summary", { auth: "Bearer auto" })).code, 401);
  assert.equal((await call(app, "GET /api/widget/summary", { auth: "" })).code, 401);
  delete process.env.API_SECRET_KEY;
  assert.equal((await call(app, "GET /api/widget/summary")).code, 503);
});

test("buzón: dejar, reenviar sin duplicar, bajar pendientes, confirmar y consultar estado", async () => {
  process.env.API_SECRET_KEY = "secreto";
  const app = fakeApp();
  const db = fakeDb();
  mountWidgetRoutes(app, () => db);
  const item = { id: "w_gasto0001", kind: "expense", ts: Date.now(), data: { amount: 8, category: "Comida" } };
  const r1 = await call(app, "POST /api/widget/inbox", { body: { items: [item, { id: "w_malo00001", kind: "expense", data: { amount: 0 } }] } });
  assert.deepEqual(r1.body.accepted, ["w_gasto0001"]);
  assert.equal(r1.body.rejected.length, 1);
  await call(app, "POST /api/widget/inbox", { body: item });
  assert.equal(db.rows.size, 1, "reenviar el mismo id no lo duplica");
  const pend = await call(app, "GET /api/widget/inbox/pending");
  assert.equal(pend.body.data.length, 1);
  await call(app, "POST /api/widget/inbox/ack", { body: { ids: ["w_gasto0001"] } });
  assert.equal((await call(app, "GET /api/widget/inbox/pending")).body.data.length, 0);
  const st = await call(app, "GET /api/widget/inbox/status", { query: { ids: "w_gasto0001" } });
  assert.ok(st.body.data[0].applied_at);
  const sum = await call(app, "GET /api/widget/summary");
  assert.equal(sum.body.data.runway.free, 120);
  delete process.env.API_SECRET_KEY;
});

test("validar: Bitácora 1–10 desde la app de widgets", () => {
  const today = new Date().toISOString().slice(0, 10);
  const ok = validateInboxItem({ id: "w_scales001", kind: "scales", data: { date: today, values: { stress: 8.4, energy: "3", focus: null, hack: 9 } } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.item.data, { date: today, values: { stress: 8, energy: 3 } }, "redondea, ignora vacíos y claves desconocidas");
  assert.equal(validateInboxItem({ id: "w_scales002", kind: "scales", data: { date: today, values: { stress: 11 } } }).ok, false);
  assert.equal(validateInboxItem({ id: "w_scales003", kind: "scales", data: { date: today, values: {} } }).ok, false);
  assert.equal(validateInboxItem({ id: "w_scales004", kind: "scales", data: { date: "ayer", values: { stress: 5 } } }).ok, false);
  assert.equal(validateInboxItem({ id: "w_scales005", kind: "scales", data: { date: "2099-01-01", values: { stress: 5 } } }).ok, false);
});
