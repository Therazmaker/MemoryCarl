/**
 * tdha_hooks.test.js — Enganches de la pestaña TDHA (datos inventados)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectHook, detectLocal, sameHook, hookStatus, hookSpending, hookStats } from "../src/tdha/tdhaEngine.js";

const DAY = 86400000;

test("enganche: se detecta y se nombra corto", () => {
  assert.equal(detectHook("Ahorita pienso mucho en una nueva bebida energética Score de mango"), "Score de mango");
  assert.equal(detectHook("Sigo pensando mucho en la Score de mango, quiero probarla ya"), "Score de mango");
  assert.equal(detectHook("hoy fue un día normal"), null);
  assert.deepEqual(detectLocal("no me saco de la cabeza las zapatillas").signals, ["enganche"]);
});

test("enganche: se reconoce el mismo aunque se escriba distinto", () => {
  assert.ok(sameHook("Score de mango", "la Score"));
  assert.ok(!sameHook("Score de mango", "zapatillas Nike"));
});

test("enganche: activo mientras se menciona; pasa solo a los 10 días sin mención", () => {
  const now = Date.UTC(2026, 10, 15);
  const fresh = { firstTs: now - 3 * DAY, mentions: [now - 3 * DAY, now - DAY] };
  assert.equal(hookStatus(fresh, now).active, true);
  const old = { firstTs: now - 40 * DAY, mentions: [now - 40 * DAY, now - 30 * DAY] };
  const st = hookStatus(old, now);
  assert.equal(st.active, false);
  assert.equal(st.days, 10);
  assert.equal(st.mentionCount, 2);
  assert.equal(hookStatus({ ...fresh, endedTs: now - DAY }, now).active, false, "cerrado a mano");
});

test("enganche: gasto mientras duró y cuánto suelen durar", () => {
  const now = Date.UTC(2026, 10, 15);
  const hook = { name: "Score de mango", firstTs: now - 5 * DAY, mentions: [now - 5 * DAY, now - DAY] };
  const ledger = [
    { type: "expense", amount: 4.5, note: "Score mango oficina", date: new Date(now - 2 * DAY).toISOString() },
    { type: "expense", amount: 4.5, note: "Score", date: new Date(now - 60 * DAY).toISOString() },
  ];
  const history = [{ date: new Date(now - 3 * DAY).toISOString().slice(0, 10), items: [{ name: "Score Mango 500ml", price: 4.5, qty: 2 }] }];
  assert.deepEqual(hookSpending(hook, { ledger, history }, now), { count: 2, total: 13.5 });
  const stats = hookStats([
    { firstTs: now - 60 * DAY, mentions: [now - 60 * DAY, now - 52 * DAY] },
    { firstTs: now - 30 * DAY, mentions: [now - 30 * DAY, now - 24 * DAY] },
    hook,
  ], now);
  assert.equal(stats.avgDays, 7);
  assert.equal(stats.active, 1);
  assert.equal(stats.everyDays, 28);
});
