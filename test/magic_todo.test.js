/**
 * magic_todo.test.js — Magic ToDo (datos inventados)
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

const E = await import("../src/todo/magicTodoEngine.js");
const S = await import("../src/todo/magicTodoStore.js");
const { askBreakdown } = await import("../src/todo/magicTodo-ui.js");

const T0 = new Date(2026, 10, 23, 7, 0).getTime();

test("desarmar: los pasos de la IA quedan en la tarea y se puede desarmar un paso", () => {
  const t = E.createTask("Planchar la ropa", { now: T0 });
  E.applyBreakdown(t, t.id, [{ text: "Sacar la tabla", minutes: 2 }, { text: "Calentar la plancha", minutes: 3 }, { text: "Planchar la camisa", minutes: 10 }], { detail: 2, minutes: 15, now: T0 });
  assert.equal(t.steps.length, 3);
  assert.deepEqual(t.aiSteps, ["Sacar la tabla", "Calentar la plancha", "Planchar la camisa"]);
  assert.equal(E.estimateMinutes(t), 15);
  const camisa = t.steps[2];
  E.applyBreakdown(t, camisa.id, [{ text: "Cuello", minutes: 3 }, { text: "Mangas", minutes: 4 }], { now: T0 });
  assert.equal(camisa.steps.length, 2);
  assert.equal(E.estimateMinutes(t), 12, "el paso desarmado suma sus pasos");
  assert.deepEqual(t.aiSteps, ["Sacar la tabla", "Calentar la plancha", "Planchar la camisa"], "desarmar un paso no cambia lo que propuso la IA para la tarea");
  assert.equal(E.leafSteps(t).length, 4);
});

test("marcar: primer paso = empezaste, último = terminaste; el padre se marca solo", () => {
  const t = E.createTask("Planchar la ropa", { now: T0 });
  E.applyBreakdown(t, t.id, [{ text: "A", minutes: 5 }, { text: "B", minutes: 5, steps: [{ text: "B1" }, { text: "B2" }] }], { now: T0 });
  const [a, b] = t.steps;
  E.toggleNode(t, a.id, true, { now: T0 + 60000 });
  assert.equal(t.startedAt, T0 + 60000);
  E.toggleNode(t, b.steps[0].id, true, { now: T0 + 120000 });
  assert.equal(b.done, false);
  const r = E.toggleNode(t, b.steps[1].id, true, { now: T0 + 25 * 60000 });
  assert.equal(b.done, true);
  assert.equal(r.completed, true);
  assert.equal(t.done, true);
  assert.equal(E.realMinutes(t), 24);
  assert.deepEqual(E.progress(t), { done: 3, total: 3, pct: 100 });
  // Desmarcar vuelve a dejarla pendiente
  E.toggleNode(t, a.id, false, { now: T0 + 26 * 60000 });
  assert.equal(t.done, false);
  assert.equal(t.doneAt, undefined);
});

test("editar, agregar, mover y borrar pasos", () => {
  const t = E.createTask("Ordenar el cuarto");
  E.applyBreakdown(t, t.id, [{ text: "Recoger ropa" }, { text: "Tender la cama" }]);
  const extra = E.addStep(t, t.id, "Poner música");
  assert.equal(extra.manual, true);
  E.moveNode(t, extra.id, -1);
  assert.deepEqual(t.steps.map((s) => s.text), ["Recoger ropa", "Poner música", "Tender la cama"]);
  E.editNode(t, extra.id, { text: "Poner mi playlist", minutes: 1 });
  assert.equal(t.steps[1].text, "Poner mi playlist");
  E.deleteNode(t, t.steps[0].id);
  assert.deepEqual(t.steps.map((s) => s.text), ["Poner mi playlist", "Tender la cama"]);
});

test("aprendizaje: tiempo real, detalle, pasos que agrega y que borra, y tareas parecidas", () => {
  const hist = [];
  for (let i = 0; i < 3; i++) {
    const t = E.createTask(`Planchar la ropa del trabajo ${i}`, { now: T0 });
    E.applyBreakdown(t, t.id, [{ text: "Sacar la tabla", minutes: 5 }, { text: "Doblar todo", minutes: 5 }, { text: "Planchar", minutes: 10 }], { detail: 3, now: T0 });
    E.deleteNode(t, t.steps[1].id); // siempre borra "Doblar todo"
    E.addStep(t, t.id, "Poner un podcast");
    E.toggleNode(t, t.steps[0].id, true, { now: T0 });
    for (const s of t.steps) E.toggleNode(t, s.id, true, { now: T0 + 30 * 60000 });
    hist.push(E.historyEntry(t));
  }
  const L = E.learnings(hist);
  assert.equal(L.count, 3);
  assert.equal(L.timeFactor, 2, "estimó 15 y tardó 30");
  assert.equal(L.detail, 3);
  assert.equal(L.added[0].text, "Poner un podcast");
  assert.equal(L.removed[0].text, "Doblar todo");
  assert.equal(E.similarDone("planchar ropa", hist).length, 3);
  assert.equal(E.similarDone("pagar la luz", hist).length, 0);
  const { user } = E.buildBreakdownPrompt({ text: "Planchar la ropa", detail: 3, history: hist, now: new Date(T0) });
  assert.match(user, /tarda en realidad 2×/);
  assert.match(user, /suele agregar a mano.*Poner un podcast/);
  assert.match(user, /suele borrar.*Doblar todo/);
  assert.match(user, /Tareas parecidas que ya cumplió/);
});

test("leer la respuesta de la IA aunque venga con texto alrededor", () => {
  assert.deepEqual(E.parseBreakdown('Aquí va:\n```json\n{"minutes": 12, "steps": [{"text":"Uno","minutes":5},{"text":"Dos","minutes":7}]}\n```'), { minutes: 12, steps: [{ text: "Uno", minutes: 5 }, { text: "Dos", minutes: 7 }] });
  assert.deepEqual(E.parseBreakdown('["Uno", "Dos"]'), { minutes: null, steps: [{ text: "Uno" }, { text: "Dos" }] });
  assert.equal(E.parseBreakdown("no sé"), null);
});

test("historial: se guarda, se quita y se une con la nube", () => {
  localStorage.clear();
  S.addToHistory({ id: "a", text: "Tarea A", steps: [], doneAt: T0 });
  S.addToHistory({ id: "b", text: "Tarea B", steps: [], doneAt: T0 + 1 });
  S.removeFromHistory("a");
  assert.equal(S.loadMagic().history.find((h) => h.id === "a").deleted, true);
  assert.equal(S.mergeMagicFromCloud({ history: [{ id: "c", text: "Tarea C", doneAt: T0 + 2, updatedAt: T0 + 2 }] }), true);
  assert.deepEqual(S.loadMagic().history.map((h) => h.id).sort(), ["a", "b", "c"]);
  assert.equal(S.mergeMagicFromCloud({ history: [{ id: "c", text: "Tarea C", doneAt: T0 + 2, updatedAt: T0 + 2 }] }), false);
});

test("IA: Claude primero y Gemini si Claude falla", async () => {
  const keys = { claude: { apiKey: "k", model: "m" }, gemini: { apiKey: "g", model: "gm" } };
  const ok = await askBreakdown({ text: "Lavar platos", detail: 1, history: [] }, { keys, callClaude: async () => '{"steps":[{"text":"Abrir el caño","minutes":1}]}' });
  assert.equal(ok.steps[0].text, "Abrir el caño");
  const fb = await askBreakdown({ text: "Lavar platos", detail: 1, history: [] }, {
    keys,
    callClaude: async () => { throw new Error("caído"); },
    geminiJson: async () => '{"steps":[{"text":"Juntar los platos"}]}',
  });
  assert.equal(fb.steps[0].text, "Juntar los platos");
  await assert.rejects(askBreakdown({ text: "x" }, { keys: { claude: {}, gemini: {} } }), /necesito la clave/);
});
