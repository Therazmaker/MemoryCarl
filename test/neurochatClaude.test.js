import test from "node:test";
import assert from "node:assert/strict";
import { getClaudeSettings, isClaudeConfigured, parseClaudeNeuronActions, requestClaudeChatReply } from "../src/services/claudeClient.js";
import { chooseReplyMode } from "../src/neuro/activeLearnEngine.js";
import { processNeuroInput } from "../src/neuro/neurocore.js";

// Global mock for localStorage and window
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

if (typeof globalThis.window === "undefined") {
  globalThis.window = { state: {} };
}

test("Claude Integration: getClaudeSettings inherits key from Chef AI if NeuroChat settings empty", () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_chef_settings", JSON.stringify({
    claudeApiKey: "sk-ant-test-chef-key-12345",
    claudeModel: "claude-3-5-sonnet-20241022",
  }));

  const settings = getClaudeSettings();
  assert.equal(settings.apiKey, "sk-ant-test-chef-key-12345");
  assert.equal(settings.model, "claude-3-5-sonnet-20241022");
  assert.equal(isClaudeConfigured(), true);
});

test("Claude Integration: chooseReplyMode prioritizes Claude when configured", () => {
  const mode = chooseReplyMode({
    isClaudeConfigured: true,
    isOllamaConfigured: true,
    isGeminiConfigured: true,
  });
  assert.equal(mode, "claude");
});

test("Claude Integration: parseClaudeNeuronActions extracts intent and actions", () => {
  const raw = `
    {"intent": "consolidate", "actions": [{"type": "create", "neuron": {"core": {"concept": "Gusto por el té"}}}]}
  `;
  const result = parseClaudeNeuronActions(raw);
  assert.equal(result.intent, "consolidate");
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].neuron.core.concept, "Gusto por el té");
});

test("Claude Integration: requestClaudeChatReply calls fetch and returns parsed reply and actions", async () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_neurochat_settings", JSON.stringify({
    claudeApiKey: "sk-ant-api03-testkey-123456789",
    claudeModel: "claude-haiku-4-5",
  }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.ok(url.includes("api.anthropic.com"));
    assert.equal(options.headers["x-api-key"], "sk-ant-api03-testkey-123456789");
    return {
      ok: true,
      json: async () => ({
        content: [
          {
            text: "¡Hola Carlos! Es un gusto saludarte.\n---NEURON_ACTIONS---\n{\"intent\": \"respond\", \"actions\": []}",
          },
        ],
      }),
    };
  };

  try {
    const res = await requestClaudeChatReply({ userInput: "Hola" });
    assert.ok(res);
    assert.equal(res.reply, "¡Hola Carlos! Es un gusto saludarte.");
    assert.equal(res.intent, "respond");
    assert.equal(res.neuronActions.actions.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Claude Integration: processNeuroInput uses Claude when replyMode is claude", async () => {
  localStorage.clear();
  localStorage.setItem("memorycarl_neurochat_settings", JSON.stringify({
    claudeApiKey: "sk-ant-api03-testkey-123456789",
    claudeModel: "claude-haiku-4-5",
  }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    return {
      ok: true,
      json: async () => ({
        content: [
          {
            text: "Claro, recuerdo que te encanta la música instrumental.\n---NEURON_ACTIONS---\n{\"intent\": \"respond\", \"actions\": []}",
          },
        ],
      }),
    };
  };

  try {
    const result = await processNeuroInput("Me siento relajado hoy", { topK: 3 });
    assert.equal(result.replyMode, "claude");
    assert.equal(result.reply, "Claro, recuerdo que te encanta la música instrumental.");
    assert.equal(result.replySource, "claude_respond");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
