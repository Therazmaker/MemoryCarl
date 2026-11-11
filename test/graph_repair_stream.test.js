import test from "node:test";
import assert from "node:assert/strict";

import { readMessageStream, friendlyApiError } from "../src/neuro/claudeStream.js";
import { mergeTombstones, withoutTombstones } from "../src/neuro/neuronTombstones.js";

function bodyOf(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return { getReader: () => ({ read: async () => (i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { done: true }) }) };
}
const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;

test("lee el stream: ignora el pensamiento, junta el texto y la razón de parada", async () => {
  const sse = [
    ev({ type: "message_start", message: {} }),
    ev({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
    ev({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }),
    ev({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
    ev({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: '{"summary":' } }),
    ev({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: '"ok"}' } }),
    ev({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
  ].join("");
  // cortado en pedazos arbitrarios, como llega por la red
  const chunks = sse.match(/[\s\S]{1,37}/g);
  const out = await readMessageStream(bodyOf(chunks));
  assert.equal(out.text, '{"summary":"ok"}');
  assert.equal(out.stopReason, "end_turn");
});

test("un mensaje nuevo dentro del stream (respaldo del servidor) reemplaza al anterior", async () => {
  const sse = [
    ev({ type: "message_start" }),
    ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "parcial" } }),
    ev({ type: "message_start" }),
    ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "{}" } }),
    ev({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
  ].join("");
  assert.equal((await readMessageStream(bodyOf([sse]))).text, "{}");
});

test("errores del stream y de HTTP se traducen", async () => {
  await assert.rejects(readMessageStream(bodyOf([ev({ type: "error", error: { type: "overloaded_error", message: "x" } })])), /saturado/);
  assert.match(friendlyApiError(401), /API key/);
  assert.match(friendlyApiError(429), /demasiadas/);
});

test("registro de borrados: une sin repetir y deshacer quita ids", () => {
  const m = mergeTombstones({ ids: ["a", "b"], mergedInto: { a: "k" } }, { ids: ["b", "c"], mergedInto: { c: "k" } });
  assert.deepEqual(m.ids, ["a", "b", "c"]);
  assert.deepEqual(m.mergedInto, { a: "k", c: "k" });
  const w = withoutTombstones(m, ["a"]);
  assert.deepEqual(w.ids, ["b", "c"]);
  assert.deepEqual(w.mergedInto, { c: "k" });
});
