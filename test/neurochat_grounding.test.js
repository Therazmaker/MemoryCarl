/**
 * neurochat_grounding.test.js — Que Carl no invente (datos inventados)
 * Directorio de personas, correcciones, fechas en el historial y lo que todavía no pasa.
 */
import test from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
// Un Storage mínimo (unlimitedStorage.js lo usa al cargarse)
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

const { upsertPerson, findMentions, buildPeopleBlock, seedPeopleFromNeurons, loadPeople, deletePerson, looksAlike, mergePeople } = await import("../src/chat/peopleDirectory.js");
const { addCorrection, buildCorrectionsBlock, deleteCorrection } = await import("../src/chat/corrections.js");
const { buildHistoryMessages, guardLifeActions, isFutureStatement, applyMemoryActions, stampLabel } = await import("../src/chat/grounding.js");
const { applyLifeActions } = await import("../src/chat/lifeChanges.js");
const { getLifeFacts, buildLifeFactsPromptBlock } = await import("../src/chat/lifeFacts.js");
const { getOpenThreads } = await import("../src/chat/openThreads.js");
const { claudeCallParams, claudeReplyText, isThinkingClaudeModel } = await import("../src/services/claudeModels.js");

test("personas: un nombre parecido NO es la misma persona", () => {
  localStorage.clear();
  upsertPerson({ name: "Marisol", relation: "pareja", aliases: ["Mari"], source: "user" });
  upsertPerson({ name: "Tomás", relation: "hermano", source: "user" });
  assert.ok(looksAlike("Marisol", "Mariana"));
  const m = findMentions("Mariana me escribió y Tomás va llegando");
  assert.deepEqual(m.known.map((p) => p.name), ["Tomás"]);
  assert.deepEqual(m.unknown, ["Mariana"]);
  assert.equal(m.lookalikes[0].person.name, "Marisol");
  const block = buildPeopleBlock("Mariana me escribió y Tomás va llegando");
  assert.match(block, /- Marisol \(también le dice: Mari\) — pareja/);
  assert.match(block, /"Mariana" NO es Marisol/);
  assert.match(block, /Nombra a: Tomás \(hermano\)/);
  // El apodo también cuenta como la persona
  assert.deepEqual(findMentions("hoy hablé con mari").known.map((p) => p.name), ["Marisol"]);
  // Palabras con mayúscula que no son nombres no se marcan
  assert.deepEqual(findMentions("Hoy fui a Lima con Tomás. Bueno, ya.").unknown, []);
});

test("personas: la IA suma apodos pero no pisa lo que escribió el usuario", () => {
  localStorage.clear();
  upsertPerson({ name: "Tomás", relation: "hermano mayor", source: "user" });
  applyMemoryActions([{ type: "upsertPerson", person: { name: "Tomás", relation: "amigo", aliases: ["Tommy"] } }]);
  const t = loadPeople().find((p) => p.name === "Tomás");
  assert.equal(t.relation, "hermano mayor");
  assert.deepEqual(t.aliases, ["Tommy"]);
  // Una persona nueva sí la guarda
  const saved = applyMemoryActions([{ type: "upsertPerson", person: { name: "Mariana", relation: "amiga del trabajo" } }]);
  assert.deepEqual(saved, [{ kind: "person", text: "Mariana (amiga del trabajo)" }]);
  // Quitar a alguien no lo devuelve al sembrar desde neuronas
  deletePerson(t.id);
  seedPeopleFromNeurons([{ id: "n1", type: "person", core: { concept: "Tomás: hermano", summary: "Hermano." } }]);
  assert.equal(loadPeople().filter((p) => !p.deleted && p.name === "Tomás").length, 0);
});

test("personas: se siembran desde las neuronas y se unen con la nube", () => {
  localStorage.clear();
  const n = seedPeopleFromNeurons([
    { id: "a", type: "person", core: { concept: "Lucía: amiga de la universidad", summary: "Amiga cercana." } },
    { id: "b", type: "pattern", core: { concept: "Dormir poco", summary: "x" } },
    { id: "c", type: "relationship", core: { concept: "Señora Rosa", summary: "La vecina del tercero. Muy amable." } },
  ]);
  assert.equal(n, 2);
  const people = loadPeople();
  assert.equal(people.find((p) => p.name === "Lucía").relation, "amiga de la universidad");
  assert.equal(people.find((p) => p.name === "Rosa").relation, "La vecina del tercero.");
  const r = mergePeople(people, [{ ...people[0], relation: "otra", updatedAt: "2999-01-01" }]);
  assert.equal(r.changed, true);
  assert.equal(r.list.find((p) => p.id === people[0].id).relation, "otra");
});

test("correcciones: van al prompt y se pueden quitar", () => {
  localStorage.clear();
  const c = addCorrection({ wrong: "Tomás llegó hace tres días", right: "Tomás todavía no llega" });
  applyMemoryActions([{ type: "correction", wrong: "Se llama Mari", right: "Mariana es otra persona" }]);
  const block = buildCorrectionsBlock();
  assert.match(block, /NO es cierto: "Tomás llegó hace tres días"\. Lo cierto: Tomás todavía no llega/);
  assert.match(block, /Mariana es otra persona/);
  deleteCorrection(c.id);
  assert.doesNotMatch(buildCorrectionsBlock(), /tres días/);
});

test("historial: cada mensaje del usuario lleva su fecha, sin repetir el actual, y avisa si pasó tiempo", () => {
  const now = new Date(2026, 10, 17, 9, 30).getTime();
  const before = new Date(2026, 10, 14, 18, 5).getTime();
  const history = [
    { role: "user", content: "Mi hermano va llegando", ts: before },
    { role: "assistant", content: "¡Qué bien!\n---NEURON_ACTIONS---\n{}", ts: before + 60000 },
    { role: "user", content: "Hola de nuevo", ts: now },
  ];
  const { messages, gapNote } = buildHistoryMessages(history, "Hola de nuevo", { now });
  assert.equal(messages.length, 3);
  assert.equal(messages[0].content, `${stampLabel(before)} Mi hermano va llegando`);
  assert.equal(messages[0].content.startsWith("[sáb 14 nov · 18:05]"), true);
  assert.equal(messages[1].content, "¡Qué bien!");
  assert.equal(messages[2].content, "[mar 17 nov · 09:30] Hola de nuevo");
  assert.match(gapNote, /hace 3 días/);
  assert.equal(buildHistoryMessages(history.slice(0, 2), "x", { now: before + 120000 }).gapNote, "");
});

test("lo que todavía no pasa se guarda como pendiente, no como hecho", () => {
  localStorage.clear();
  assert.ok(isFutureStatement("Mi hermano va llegando a Lima"));
  assert.ok(isFutureStatement("El lunes empiezo en el trabajo nuevo, desde el próximo mes"));
  assert.ok(!isFutureStatement("Mi hermano llegó ayer"));
  const today = "2026-11-17";
  const guarded = guardLifeActions([
    { type: "upsertLifeFact", fact: { text: "Su hermano va llegando de visita", category: "relaciones" } },
    { type: "upsertLifeFact", fact: { text: "Trabaja en Empresa B", category: "trabajo", since: "2026-12-01" } },
    { type: "upsertLifeFact", fact: { text: "Se mudó a otro barrio", category: "vivienda" } },
    { type: "upsertLifeFact", fact: { text: "Consiguió trabajo", category: "trabajo", since: "2026-11-10" } },
  ], { today });
  assert.equal(guarded[0].type, "openThread");
  assert.equal(guarded[0].thread.dueDate, null);
  assert.equal(guarded[1].type, "openThread");
  assert.equal(guarded[1].thread.dueDate, "2026-12-01");
  assert.equal(guarded[2].fact.sinceApprox, true);
  assert.equal(guarded[3].fact.sinceApprox, undefined);
});

test("aplicado de punta a punta: sin 'desde hace X días' inventado", () => {
  localStorage.clear();
  applyLifeActions([
    { type: "upsertLifeFact", fact: { text: "Su hermano va llegando de visita", category: "relaciones" } },
    { type: "upsertLifeFact", fact: { text: "Tiene un perro", category: "otro" } },
  ]);
  assert.equal(getLifeFacts({ status: "active" }).length, 1);
  assert.equal(getOpenThreads({ status: "open" })[0].topic, "Su hermano va llegando de visita");
  const block = buildLifeFactsPromptBlock("hola").blockText;
  assert.match(block, /Tiene un perro \(anotado el .*; no dijo desde cuándo\)/);
  assert.doesNotMatch(block, /desde hace/);
});

test("modelos 5.x: más tokens y tiempo, y el texto sale aunque venga el pensamiento primero", () => {
  assert.ok(isThinkingClaudeModel("claude-opus-5-5"));
  assert.ok(!isThinkingClaudeModel("claude-haiku-4-5"));
  assert.deepEqual(claudeCallParams("claude-haiku-4-5", { maxTokens: 2048 }), { body: { max_tokens: 2048 }, timeoutMs: 30000 });
  const p = claudeCallParams("claude-sonnet-5-5", { maxTokens: 2048, effort: "low" });
  assert.equal(p.body.max_tokens, 16000);
  assert.deepEqual(p.body.output_config, { effort: "low" });
  assert.equal(claudeReplyText({ content: [{ type: "thinking", thinking: "..." }, { type: "text", text: "Hola" }] }), "Hola");
});
