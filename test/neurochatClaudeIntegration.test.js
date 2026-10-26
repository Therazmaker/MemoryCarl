import test from "node:test";
import assert from "node:assert/strict";
import { getClaudeSettings, isClaudeConfigured, normalizeClaudeModel } from "../src/services/claudeClient.js";
import { chooseReplyMode } from "../src/neuro/activeLearnEngine.js";
import { processNeuroInput } from "../src/neuro/neurocore.js";

test("normalizeClaudeModel handles obsolete and empty model names", () => {
  assert.equal(normalizeClaudeModel("claude-haiku-4-5"), "claude-3-5-haiku-20241022");
  assert.equal(normalizeClaudeModel(""), "claude-3-5-haiku-20241022");
  assert.equal(normalizeClaudeModel("claude-3-5-sonnet-20241022"), "claude-3-5-sonnet-20241022");
});

test("chooseReplyMode selects claude when isClaudeConfigured is true", () => {
  const mode = chooseReplyMode({
    isClaudeConfigured: true,
    isOllamaConfigured: false,
    isGeminiConfigured: false,
  });
  assert.equal(mode, "claude");
});

test("processNeuroInput formats consecutive user roles and returns error details if API fails", async () => {
  const testKey = "sk-ant-test-key-12345";
  global.localStorage = {
    getItem: (k) => {
      if (k === "memorycarl_neurochat_settings") {
        return JSON.stringify({ claudeApiKey: testKey, claudeModel: "claude-3-5-haiku-20241022", enabled: true });
      }
      return null;
    },
    setItem: () => {},
  };

  let capturedRequestBody = null;
  global.fetch = async (url, opts) => {
    capturedRequestBody = JSON.parse(opts.body);
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "invalid_x_api_key" } }),
    };
  };

  const res = await processNeuroInput("hola", {
    history: [
      { role: "user", content: "primer mensaje" },
      { role: "user", content: "segundo mensaje consecutivo" },
    ],
  });

  assert.equal(res.replyMode, "claude");
  assert.equal(res.replySource, "api_error");
  assert.ok(res.reply.includes("invalid_x_api_key"));

  // Check alternating roles in captured request
  assert.ok(capturedRequestBody);
  const messages = capturedRequestBody.messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
  assert.ok(messages[0].content.includes("primer mensaje"));
  assert.ok(messages[0].content.includes("segundo mensaje consecutivo"));
});
