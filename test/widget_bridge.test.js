/**
 * widget_bridge.test.js — Resumen para los widgets y aplicado del buzón (datos inventados)
 */
import test from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
globalThis.Storage = class Storage {
  getItem(k) { return mem.has(k) ? mem.get(k) : null; }
  setItem(k, v) { mem.set(k, String(v)); }
  removeItem(k) { mem.delete(k); }
  clear() { mem.clear(); }
  key(i) { return [...mem.keys()][i] ?? null; }
  get length() { return mem.size; }
};
globalThis.localStorage = new globalThis.Storage();
globalThis.window = globalThis.window || globalThis;

const { buildWidgetSummary, applyInboxItems, syncWidgetInbox, summaryForHash } = await import("../src/widgets/widgetBridge.js");
const { createTask, applyBreakdown } = await import("../src/todo/magicTodoEngine.js");

const NOW = new Date(2026, 10, 23, 9, 0);

test("resumen: cuentas propias, categorías más usadas, último gasto, hasta el cobro y tareas con hora", () => {
  const t1 = createTask("Llamar al banco");
  t1.remindAt = new Date(2026, 10, 23, 17, 0).toISOString();
  const t2 = createTask("Planchar la ropa");
  applyBreakdown(t2, t2.id, [{ text: "A" }, { text: "B" }]);
  t2.steps[0].done = true;
  const far = createTask("Renovar DNI");
  far.remindAt = new Date(2027, 0, 30).toISOString();
  const state = {
    financeAccounts: [{ id: "acc1", name: "Billetera" }, { id: "acc2", name: "Banco", archived: true }, { id: "ext_otro", name: "Externa" }],
    financeLastAccountId: "acc1",
    financeLedger: [
      { type: "expense", amount: 10, category: "Transporte", date: "2026-11-22T10:00:00Z" },
      { type: "expense", amount: 12, category: "Transporte", date: "2026-11-21T10:00:00Z" },
      { type: "expense", amount: 8.5, category: "Comida", date: "2026-11-22T12:00:00Z" },
      { type: "income", amount: 500, category: "Sueldo", date: "2026-11-15T12:00:00Z" },
    ],
    reminders: [t2, t1, far, { id: "x", text: "Hecha", done: true }],
  };
  const s = buildWidgetSummary({ state, runway: { free: 320.5, perDay: 45.8, payday: { daysLeft: 7, label: "el lun 30" } }, now: NOW });
  assert.deepEqual(s.accounts, [{ id: "acc1", name: "Billetera" }]);
  assert.equal(s.lastAccountId, "acc1");
  assert.deepEqual(s.categories.slice(0, 2), ["Transporte", "Comida"]);
  assert.equal(s.categories.includes("Sueldo"), false);
  assert.deepEqual(s.lastExpense, { amount: 8.5, category: "Comida", date: "2026-11-22T12:00:00Z" });
  assert.deepEqual(s.runway, { free: 320.5, perDay: 45.8, daysLeft: 7, paydayLabel: "el lun 30" });
  assert.equal(s.tasks[0].text, "Llamar al banco");
  assert.ok(s.tasks[0].remindAt);
  assert.equal(s.tasks.find((t) => t.text === "Renovar DNI").remindAt, undefined, "un aviso lejano no va todavía");
  assert.deepEqual([s.tasks.find((t) => t.text === "Planchar la ropa").stepsDone, s.tasks.find((t) => t.text === "Planchar la ropa").stepsTotal], [1, 2]);
  assert.equal(s.tasks.some((t) => t.text === "Hecha"), false);
  assert.equal(s.moods.length, 8);
  assert.deepEqual(summaryForHash({ ...s, generatedAt: "otra" }), summaryForHash(s));
});

test("buzón: aplica gasto, diario, tarea hecha y pospuesta; no repite lo ya aplicado", () => {
  const task = createTask("Llamar al banco");
  const other = createTask("Pagar la luz");
  const expenses = [];
  const journal = [];
  const history = [];
  let saved = 0;
  const handlers = {
    expense: (d) => { expenses.push(d); return { id: "fin1" }; },
    journal: (d) => { journal.push(d); return { id: "jr1" }; },
    task: (id) => [task, other].find((t) => t.id === id) || null,
    history: (h) => history.push(h),
    save: () => saved++,
  };
  const items = [
    { id: "w_gasto0001", kind: "expense", client_ts: "2026-11-23T13:05:00Z", data: { amount: 8, category: "Comida", accountId: "acc1" } },
    { id: "w_diario001", kind: "journal", client_ts: "2026-11-23T13:10:00Z", data: { text: "Me sentí tranquilo", mood: "good" } },
    { id: "w_tarea0001", kind: "task_done", client_ts: "2026-11-23T14:00:00Z", data: { taskId: task.id } },
    { id: "w_tarea0002", kind: "task_snooze", client_ts: "2026-11-23T14:00:00Z", data: { taskId: other.id, remindAt: "2026-11-23T15:00:00.000Z" } },
    { id: "w_borrada01", kind: "task_done", client_ts: "2026-11-23T14:00:00Z", data: { taskId: "ya_no_existe" } },
  ];
  const r = applyInboxItems(items, handlers, { appliedIds: [] });
  assert.equal(r.applied.length, 5);
  assert.equal(expenses[0].date, "2026-11-23T13:05:00Z", "se anota a la hora en que lo registraste");
  assert.equal(journal[0].ts, Date.parse("2026-11-23T13:10:00Z"));
  assert.equal(task.done, true);
  assert.equal(history[0].text, "Llamar al banco");
  assert.equal(other.remindAt, "2026-11-23T15:00:00.000Z");
  assert.equal(saved, 1);
  const again = applyInboxItems(items, handlers, { appliedIds: r.applied });
  assert.equal(again.applied.length, 0);
  assert.equal(again.skipped.length, 5);
  assert.equal(expenses.length, 1);
  const bad = applyInboxItems([{ id: "w_gasto0002", kind: "expense", data: { amount: 5 } }], { expense: () => null }, { appliedIds: [] });
  assert.equal(bad.failed.length, 1, "si no se pudo anotar, no se confirma (vuelve a intentarse)");
});

test("sincronizar: baja, aplica y confirma solo lo aplicado", async () => {
  localStorage.clear();
  const calls = [];
  const fakeFetch = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers?.Authorization });
    if (url.endsWith("/pending")) {
      return { ok: true, json: async () => ({ data: [
        { id: "w_gasto0009", kind: "expense", client_ts: "2026-11-23T13:05:00Z", data: { amount: 3, category: "Comida" } },
        { id: "w_gasto0010", kind: "expense", client_ts: "2026-11-23T13:06:00Z", data: { amount: 4, category: "Comida" } },
      ] }) };
    }
    return { ok: true, json: async () => ({ status: "ok" }) };
  };
  let n = 0;
  const r = await syncWidgetInbox({ expense: () => (++n === 1 ? { id: "ok" } : null), save: () => {} }, { config: { url: "https://x.test", key: "k" }, fetch: fakeFetch, force: true });
  assert.equal(r.applied, 1);
  const ack = calls.find((c) => c.url.endsWith("/ack"));
  assert.deepEqual(ack.body.ids, ["w_gasto0009"]);
  assert.equal(calls[0].auth, "Bearer k");
});
