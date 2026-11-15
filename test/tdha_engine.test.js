/**
 * tdha_engine.test.js — Pestaña TDHA (datos inventados)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectLocal, autoFactors, dailyView, patterns, signalCounts, parseTdhaReply } from "../src/tdha/tdhaEngine.js";
import { mergeTdha } from "../src/tdha/tdhaStore.js";

test("lectura local: sed + irritable = a medias/desregulado, y activaciones del texto", () => {
  const r = detectLocal("Tengo mucha sed y estoy irritable, dormí poco y tomé dos Volt");
  assert.deepEqual(r.signals.sort(), ["irritable", "sed"]);
  assert.ok(r.factors.includes("poco_sueno"));
  assert.ok(r.factors.includes("cafeina"));
  assert.equal(r.state, "red");
  assert.equal(detectLocal("hoy estoy tranquilo y enfocado").state, "green");
  assert.equal(detectLocal("no estoy bien").state, null, "'bien' solo no es tranquilo");
});

test("activaciones automáticas: poco sueño, compra por impulso y comida en la calle", () => {
  const date = new Date(2026, 10, 14, 15);
  const f = autoFactors({
    date,
    sleepLog: [{ date: "2026-11-14", totalMinutes: 300 }],
    ledger: [
      { type: "expense", reason: "impulso", amount: 20, date: new Date(2026, 10, 14, 12).toISOString() },
      { type: "expense", category: "Comida en la calle", amount: 15, date: new Date(2026, 10, 14, 13).toISOString() },
      { type: "expense", reason: "impulso", amount: 9, date: new Date(2026, 10, 10).toISOString() },
    ],
  });
  assert.deepEqual(f.sort(), ["comida_calle", "compra_impulso", "poco_sueno"]);
});

test("por día: el estado del día es el peor y se juntan señales y activaciones", () => {
  const d = new Date(2026, 10, 14, 9).getTime();
  const v = dailyView([
    { id: "a", ts: d, state: "green", signals: ["enfocado"], factors: ["ejercicio"] },
    { id: "b", ts: d + 3600000, state: "red", signals: ["irritable"], factors: ["conflicto"] },
  ]);
  assert.equal(v.length, 1);
  assert.equal(v[0].state, "red");
  assert.deepEqual([...v[0].factors].sort(), ["conflicto", "ejercicio"]);
});

test("patrones: lo que aparece en días rojos desordena, lo que aparece en días verdes ayuda", () => {
  const day = (i) => new Date(2026, 9, 1 + i, 12).getTime();
  const entries = [];
  for (let i = 0; i < 6; i++) entries.push({ id: `r${i}`, ts: day(i), state: "red", factors: ["poco_sueno"] });
  for (let i = 6; i < 12; i++) entries.push({ id: `g${i}`, ts: day(i), state: "green", factors: ["ejercicio"] });
  const p = patterns(entries);
  assert.equal(p.days, 12);
  assert.equal(p.hurts[0].id, "poco_sueno");
  assert.equal(p.helps[0].id, "ejercicio");
  assert.equal(patterns(entries.slice(0, 3)).days, 3, "con pocos días no saca patrones");
  assert.equal(patterns(entries.slice(0, 3)).hurts.length, 0);
});

test("señales frecuentes y respuesta de la IA", () => {
  const now = new Date(2026, 10, 14);
  const s = signalCounts([{ ts: now.getTime() - 86400000, signals: ["sed", "ansiedad"] }, { ts: now.getTime(), signals: ["sed"] }], 30, now);
  assert.deepEqual(s.map((x) => [x.id, x.n]), [["sed", 2], ["ansiedad", 1]]);
  const r = parseTdhaReply('{"state":"yellow","signals":["sed","inventada"],"factors":["cafeina"],"when":"ayer","reply":"Te leo."}');
  assert.deepEqual(r, { state: "yellow", signals: ["sed"], factors: ["cafeina"], when: "ayer", hook: null, reply: "Te leo." });
});

test("nube: se une por id y gana lo más reciente", () => {
  const local = { entries: [{ id: "a", ts: 1, state: "red", updatedAt: "2026-01-01" }], chat: [{ id: "c1", ts: 1 }] };
  const cloud = { entries: [{ id: "a", ts: 1, state: "yellow", updatedAt: "2026-01-02" }, { id: "b", ts: 2, state: "green", updatedAt: "2026-01-02" }], chat: [{ id: "c2", ts: 2 }] };
  const r = mergeTdha(local, cloud);
  assert.equal(r.changed, true);
  assert.deepEqual(r.entries.map((e) => [e.id, e.state]), [["a", "yellow"], ["b", "green"]]);
  assert.equal(r.chat.length, 2);
});
