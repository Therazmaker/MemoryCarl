/**
 * solve_prompt.test.js — 🧭 Modo ABC de punta a punta con Claude simulado
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
const { startSolve, stopSolve } = await import("../src/chat/solveMode.js");

function fakeClaude(text) {
  let body = null;
  globalThis.fetch = async (_u, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ type: "text", text }] }) };
  };
  return () => body;
}

test("sin modo activo: Carl puede ofrecer el plan y se lee offerSolve", async () => {
  stopSolve();
  const sent = fakeClaude('Uf, entiendo. ¿Quieres que lo bajemos a un plan?\n---NEURON_ACTIONS---\n{"intent":"respond","actions":[],"offerSolve":true}');
  const r = await requestClaudeChatReply({ userInput: "Me cortan la luz el viernes y no sé qué hacer" });
  assert.match(sent().system[0].text, /OFRECER EL MODO ABC/);
  assert.equal(r.solve.offerSolve, true);
  assert.doesNotMatch(r.reply, /NEURON_ACTIONS/);
});

test("con el modo hardcore activo: el prompt lo guía y se lee el plan", async () => {
  startSolve("hardcore");
  const sent = fakeClaude('Listo. Hoy a las 7:30 pm ves el recibo. Sin excusas.\n---NEURON_ACTIONS---\n{"intent":"respond","actions":[],"solveStep":"done","plan":{"title":"Pagar la luz","firstStepAt":"2026-11-25T19:30","steps":[{"text":"Ver el recibo","minutes":10}]}}');
  const r = await requestClaudeChatReply({ userInput: "ok, lo hago" });
  const sys = sent().system[0].text;
  assert.match(sys, /MODO ABC ACTIVO \(🔥 Hardcore\)/);
  assert.doesNotMatch(sys, /OFRECER EL MODO ABC/);
  assert.equal(r.solve.solveStep, "done");
  assert.equal(r.solve.plan.title, "Pagar la luz");
  assert.equal(r.neuronActions.solve.plan.steps[0].text, "Ver el recibo");
});
