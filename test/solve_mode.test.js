/**
 * solve_mode.test.js — 🧭 Modo ABC (datos inventados)
 */
import test from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
globalThis.Storage = class Storage {
  getItem(k) { return mem.has(k) ? mem.get(k) : null; }
  setItem(k, v) { mem.set(k, String(v)); }
  removeItem(k) { mem.delete(k); }
  key(i) { return [...mem.keys()][i] ?? null; }
  get length() { return mem.size; }
};
globalThis.localStorage = new globalThis.Storage();

const S = await import("../src/chat/solveMode.js");
const { createTask, createStep } = await import("../src/todo/magicTodoEngine.js");

test("estados: empezar, avanzar de paso, cambiar intensidad, terminar y salir", () => {
  mem.clear();
  const t0 = Date.parse("2026-11-25T10:00:00");
  assert.equal(S.loadSolve(t0).active, false);
  assert.equal(S.startSolve("hardcore", t0).intensity, "hardcore");
  assert.equal(S.noteStep("C", t0 + 1000).step, "C");
  assert.equal(S.noteStep("Z", t0 + 2000).step, "C", "un paso que no existe no cambia nada");
  assert.equal(S.setIntensity("suave").intensity, "suave");
  const done = S.noteStep("done", t0 + 3000);
  assert.equal(done.active, false, "con el plan listo, el modo se cierra");
  S.startSolve("medio", t0);
  assert.equal(S.stopSolve().active, false);
});

test("se apaga solo tras 12 horas sin uso", () => {
  mem.clear();
  const t0 = Date.parse("2026-11-25T10:00:00");
  S.startSolve("medio", t0);
  assert.equal(S.loadSolve(t0 + 11 * 3600e3).active, true);
  assert.equal(S.loadSolve(t0 + 13 * 3600e3).active, false);
});

test("'solo quiero desahogarme': no vuelve a ofrecer por 6 horas", () => {
  mem.clear();
  const t0 = Date.parse("2026-11-25T10:00:00");
  S.declineOffer(t0);
  assert.equal(S.canOffer(S.loadSolve(t0), t0 + 3600e3), false);
  assert.match(S.buildSolvePromptBlock(S.loadSolve(t0), t0 + 3600e3), /NO le ofrezcas/);
  assert.equal(S.canOffer(S.loadSolve(t0), t0 + 7 * 3600e3), true);
  assert.match(S.buildSolvePromptBlock(S.loadSolve(t0), t0 + 7 * 3600e3), /"offerSolve": true/);
});

test("el prompt activo lleva el método, la intensidad y los límites del hardcore", () => {
  mem.clear();
  const t0 = Date.parse("2026-11-25T10:00:00");
  S.startSolve("hardcore", t0);
  const p = S.buildSolvePromptBlock(S.loadSolve(t0), t0);
  assert.match(p, /MODO ABC ACTIVO \(🔥 Hardcore\) — paso actual: A · Aterrizar/);
  assert.match(p, /Sin pañitos/);
  assert.match(p, /nunca insultes, humilles/);
  assert.match(p, /crisis/);
  assert.match(p, /"no sé"/);
  S.setIntensity("suave");
  const p2 = S.buildSolvePromptBlock(S.loadSolve(t0), t0);
  assert.match(p2, /ESTILO SUAVE/);
  assert.doesNotMatch(p2, /Sin pañitos/);
});

test("lee la oferta, el paso y el plan del JSON de Carl (y limpia lo raro)", () => {
  assert.equal(S.parseSolveFields({ intent: "respond", actions: [] }), null);
  assert.deepEqual(S.parseSolveFields({ offerSolve: true }), { offerSolve: true });
  const r = S.parseSolveFields({
    solveStep: "done",
    plan: { title: "Ponerme al día con la luz", firstStepAt: "2026-11-25T19:30", steps: [{ text: "Ver el recibo y anotar cuánto debo", minutes: 10 }, "Llamar a Luz del Sur", { text: "", minutes: 5 }, { text: "Pagar", minutes: -3 }] },
  });
  assert.equal(r.solveStep, "done");
  assert.deepEqual(r.plan.steps, [
    { text: "Ver el recibo y anotar cuánto debo", minutes: 10 },
    { text: "Llamar a Luz del Sur", minutes: null },
    { text: "Pagar", minutes: null },
  ]);
  assert.equal(r.plan.firstStepAt, "2026-11-25T19:30");
  assert.equal(S.parseSolveFields({ plan: { title: "x", steps: [] } }), null);
});

test("el plan se vuelve una tarea de Magic ToDo con pasos y aviso del primer paso", () => {
  const now = new Date(2026, 10, 25, 10, 0);
  const plan = { title: "Ponerme al día con la luz", firstStepAt: "2026-11-25T19:30", steps: [{ text: "Ver el recibo", minutes: 10 }, { text: "Pagar", minutes: null }] };
  const task = S.planToTask(plan, { createTask, createStep }, now);
  assert.equal(task.text, "🧭 Ponerme al día con la luz");
  assert.equal(task.source, "abc");
  assert.deepEqual(task.steps.map((x) => [x.text, x.minutes ?? null]), [["Ver el recibo", 10], ["Pagar", null]]);
  assert.equal(new Date(task.remindAt).getHours(), 19);
  const past = S.planToTask({ ...plan, firstStepAt: "2026-11-24T08:00" }, { createTask, createStep }, now);
  assert.equal(past.remindAt, undefined, "una hora que ya pasó no se programa");
});
