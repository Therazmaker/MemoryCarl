/**
 * receptionist.test.js — El recepcionista de NeuroChat (datos inventados, Haiku simulado)
 */
import test from "node:test";
import assert from "node:assert/strict";

// localStorage del navegador, simulado (algunos módulos de la app usan Storage.prototype)
const mem = new Map();
globalThis.Storage = class Storage {
  getItem(k) { return mem.has(k) ? mem.get(k) : null; }
  setItem(k, v) { mem.set(k, String(v)); }
  removeItem(k) { mem.delete(k); }
  key(i) { return [...mem.keys()][i] ?? null; }
  get length() { return mem.size; }
};
globalThis.localStorage = new globalThis.Storage();

const R = await import("../src/chat/receptionist.js");

const neurons = [
  { id: "id-papa", type: "person", core: { concept: "Papá", summary: "Vive en Arequipa, se jubiló este año" }, timesActivated: 20 },
  { id: "id-mudanza", type: "project", core: { concept: "Mudanza a Miraflores", summary: "Planeada para enero" }, timesActivated: 5 },
  { id: "id-borrada", type: "person", deleted: true, core: { concept: "Alguien borrado" } },
  { id: "id-quitada", type: "concept", feedbackStats: { removed: true }, core: { concept: "Quitada" } },
];
const people = [{ id: "p1", name: "Papá", aliases: ["mi viejo"], relation: "padre" }];

test("índice: sin borradas, con apodos del directorio y referencias cortas", () => {
  const idx = R.buildMemoryIndex(neurons, people);
  assert.equal(idx.entries.length, 2);
  const papa = idx.entries.find((e) => e.id === "id-papa");
  assert.deepEqual(papa.aliases, ["mi viejo", "padre"]);
  assert.equal(papa.kind, "persona");
  assert.match(R.indexText(idx), /n\d Papá \(mi viejo, padre\) \[persona\] — Vive en Arequipa/);
  const block = R.buildIndexPromptBlock(idx);
  assert.match(block, /## ÍNDICE DE TU MEMORIA/);
  assert.match(block, /persona: Papá \(mi viejo, padre\)/);
  assert.equal(R.buildIndexPromptBlock({ entries: [] }), "");
});

test("respuesta: valida contra el índice y descarta lo inventado", () => {
  const idx = R.buildMemoryIndex(neurons, people);
  const ref = idx.entries.find((e) => e.id === "id-papa").ref;
  const r = R.parseReceptionistReply(`Claro: {"neuronas":["${ref}","n99","${ref}"],"busquedas":["mudanza papá","",1],"finanzas":true,"referencias":"'mi viejo' = Papá"}`, idx);
  assert.deepEqual(r.neuronIds, ["id-papa"]);
  assert.deepEqual(r.names, ["Papá"]);
  assert.deepEqual(r.searches, ["mudanza papá", "1"]);
  assert.equal(r.finance, true);
  assert.equal(R.parseReceptionistReply("no sé", idx), null);
  assert.equal(R.parseReceptionistReply("{roto", idx), null);
});

test("nota para Claude: solo si hay algo que decir", () => {
  assert.equal(R.buildReceptionPromptBlock(null), "");
  assert.equal(R.buildReceptionPromptBlock({ names: [], searches: [], references: "" }), "");
  const b = R.buildReceptionPromptBlock({ names: ["Papá"], searches: ["mudanza"], references: "'lo que te conté' = la mudanza" });
  assert.match(b, /## NOTA DEL RECEPCIONISTA/);
  assert.match(b, /importa: Papá/);
  assert.match(b, /'lo que te conté' = la mudanza/);
});

test("detecta cuando le dices a Carl que ya tenía la información", () => {
  for (const t of ["Ya lo tienes en tu memoria", "ya te lo dije", "ya te conté eso", "¿No te acuerdas?", "Eso está en tu memoria"]) assert.equal(R.isMissSignal(t), true, t);
  for (const t of ["Ya tengo hambre", "te cuento algo", "hola Carl"]) assert.equal(R.isMissSignal(t), false, t);
});

test("corre con Haiku simulado, manda el índice cacheado y guarda la decisión", async () => {
  mem.clear();
  let sent = null;
  const fetchFn = async (_url, init) => {
    sent = JSON.parse(init.body);
    const idx = R.buildMemoryIndex(neurons, people);
    const ref = idx.entries.find((e) => e.id === "id-mudanza").ref;
    return { ok: true, json: async () => ({ content: [{ type: "text", text: `{"neuronas":["${ref}"],"busquedas":[],"finanzas":false,"referencias":"'lo que te conté' = la mudanza"}` }] }) };
  };
  const r = await R.runReceptionist({ userInput: "hablé con mi viejo de lo que te conté", history: [{ role: "user", content: "me mudo en enero" }], neurons, people, apiKey: "sk-test-123456", fetchFn });
  assert.deepEqual(r.neuronIds, ["id-mudanza"]);
  assert.equal(sent.model, "claude-haiku-4-5");
  assert.equal(sent.system[1].cache_control.type, "ephemeral");
  assert.match(sent.messages[0].content, /Usuario: me mudo en enero/);
  const log = R.getReceptionLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].ok, true);
  assert.deepEqual(log[0].chosen, ["Mudanza a Miraflores"]);
});

test("si Haiku falla, no rompe nada y lo anota; sin clave ni siquiera corre", async () => {
  mem.clear();
  const r = await R.runReceptionist({ userInput: "hola", neurons, people, apiKey: "sk-test-123456", fetchFn: async () => ({ ok: false, status: 529 }) });
  assert.equal(r.failed, true);
  assert.deepEqual(r.neuronIds, []);
  assert.ok(r.index.entries.length > 0, "el índice igual llega a Claude");
  assert.equal(R.getReceptionLog()[0].ok, false);
  assert.equal(await R.runReceptionist({ userInput: "hola", neurons, people, apiKey: "" }), null);
});
