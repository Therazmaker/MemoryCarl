/**
 * receptionist_prompt.test.js — Lo que llega a Claude con el recepcionista (internet simulado)
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
globalThis.window = globalThis;
localStorage.setItem("memorycarl_neurochat_settings", JSON.stringify({ claudeApiKey: "sk-ant-test-1234567890", claudeModel: "claude-opus-5-5", carlTools: false }));

const { requestClaudeChatReply } = await import("../src/services/claudeClient.js");
const { buildMemoryIndex } = await import("../src/chat/receptionist.js");

test("Claude recibe el índice de la memoria y la nota del recepcionista", async () => {
  let body = null;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ type: "text", text: "Hola" }] }) };
  };
  const neurons = [
    { id: "a", type: "person", core: { concept: "Papá", summary: "Vive en Arequipa" } },
    { id: "b", type: "project", core: { concept: "Mudanza a Miraflores" } },
  ];
  const memoryIndex = buildMemoryIndex(neurons, [{ name: "Papá", aliases: ["mi viejo"] }]);
  const r = await requestClaudeChatReply({
    userInput: "hablé con mi viejo de lo que te conté",
    memoryIndex,
    reception: { names: ["Papá", "Mudanza a Miraflores"], searches: ["mudanza papá"], references: "'lo que te conté' = la mudanza" },
    memoryRecall: Array.from({ length: 5 }, (_, i) => ({ memory: { title: `Memoria ${i + 1}` }, snippet: "..." })),
  });
  assert.equal(r.reply, "Hola");
  const system = body.system[0].text;
  assert.match(system, /## ÍNDICE DE TU MEMORIA[\s\S]*persona: Papá \(mi viejo\)/);
  assert.match(system, /## NOTA DEL RECEPCIONISTA[\s\S]*importa: Papá, Mudanza a Miraflores/);
  assert.match(system, /'lo que te conté' = la mudanza/);
  assert.match(system, /Memoria 5/, "con el recepcionista entran hasta 6 memorias, no 3");
});
