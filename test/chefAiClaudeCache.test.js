import test from "node:test";
import assert from "node:assert/strict";
import { callClaude } from "../src/shopping/shoppingAi.js";

test("callClaude formats system prompt with cache_control: { type: 'ephemeral' }", async () => {
  const originalFetch = globalThis.fetch;
  let interceptedPayload = null;

  globalThis.fetch = async (url, options) => {
    interceptedPayload = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        content: [{ text: "Respuesta test" }],
        usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 50, cache_read_input_tokens: 0 }
      })
    };
  };

  try {
    const messages = [
      { role: "system", content: "Prompt de sistema largo para Chef AI..." },
      { role: "user", content: "Hola Chef" }
    ];

    const reply = await callClaude(messages, "sk-ant-test-key", "claude-haiku-4-5");

    assert.equal(reply, "Respuesta test");
    assert.ok(Array.isArray(interceptedPayload.system), "system debe ser un array");
    assert.deepEqual(interceptedPayload.system, [
      {
        type: "text",
        text: "Prompt de sistema largo para Chef AI...",
        cache_control: { type: "ephemeral" }
      }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
