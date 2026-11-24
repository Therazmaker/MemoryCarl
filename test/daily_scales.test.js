import test from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { buildSeries, setDayScales, loadScales, mergeScales, sleepScore, moodScore, scalesPayload } = await import("../src/scales/dailyScalesStore.js");

test("sueño: calidad 1–5 pasa a 1–10; sin calidad usa las horas", () => {
  assert.equal(sleepScore([{ quality: 4, totalMinutes: 300 }]), 8);
  assert.equal(sleepScore([{ quality: null, totalMinutes: 480 }]), 10);
  assert.equal(sleepScore([{ quality: null, totalMinutes: 240 }]), 5);
  assert.equal(sleepScore([]), null);
});

test("ánimo: promedio del puntaje de las caras", () => {
  const score = (id) => ({ incredible: 9, bad: 3 })[id] ?? null;
  assert.equal(moodScore([{ spriteId: "incredible" }, { spriteId: "bad" }], score), 6);
  assert.equal(moodScore([{ spriteId: "desconocida" }], score), null);
});

test("buildSeries junta lo automático y lo marcado; energía cae a la de las caras", () => {
  mem.clear();
  setDayScales("2026-11-23", { stress: 7, water: 14 });
  const s = buildSeries(["2026-11-22", "2026-11-23"], {
    sleepLog: [{ date: "2026-11-23", quality: 3, totalMinutes: 400 }],
    moodDaily: { "2026-11-23": [{ spriteId: "good", energy: 4 }] },
    moodScoreOf: () => 7,
  });
  assert.deepEqual(s.sleep, [null, 6]);
  assert.deepEqual(s.mood, [null, 7]);
  assert.deepEqual(s.stress, [null, 7]);
  assert.deepEqual(s.water, [null, 10]);
  assert.deepEqual(s.energy, [null, 8]);
});

test("borrar un valor y no guardar días sin cambios", () => {
  mem.clear();
  setDayScales("2026-11-20", { focus: null });
  assert.equal(scalesPayload(), null);
  setDayScales("2026-11-20", { focus: 6 });
  setDayScales("2026-11-20", { focus: null });
  assert.equal(loadScales().days["2026-11-20"].focus, undefined);
});

test("mergeScales: por día gana el más reciente", () => {
  const local = { days: { a: { stress: 2, updatedAt: "2026-11-02" }, b: { stress: 5, updatedAt: "2026-11-05" } }, hidden: ["water"] };
  const cloud = { days: { a: { stress: 9, updatedAt: "2026-11-03" }, b: { stress: 1, updatedAt: "2026-11-01" }, c: { food: 4, updatedAt: "x" } } };
  const r = mergeScales(local, cloud);
  assert.equal(r.changed, true);
  assert.equal(r.days.a.stress, 9);
  assert.equal(r.days.b.stress, 5);
  assert.equal(r.days.c.food, 4);
  assert.deepEqual(r.hidden, ["water"]);
});
