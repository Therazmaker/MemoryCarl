import test from "node:test";
import assert from "node:assert/strict";

// ---- Mock localStorage ----
const store = {};
if (typeof localStorage === "undefined") {
  globalThis.localStorage = {
    getItem:    (k)    => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    clear:      ()     => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

import { requestClaudeChatReply } from "../src/services/claudeClient.js";
import { requestOllamaChatReply, saveOllamaSettings } from "../src/services/ollamaClient.js";
import { saveNeuroChatSettings } from "../src/settings/neurochatSettings.js";
import { processNeuroInput } from "../src/neuro/neurocore.js";

test("requestClaudeChatReply retries 3 times when fetch fails", async () => {
  saveNeuroChatSettings({
    claudeApiKey: "sk-ant-test-key-123456789012345",
    claudeModel: "claude-haiku-4-5",
    enabled: true,
  });

  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response("Internal Error", { status: 500 });
  };

  const progressEvents = [];
  try {
    const res = await requestClaudeChatReply(
      { userInput: "hola" },
      (p) => progressEvents.push(p)
    );
    assert.equal(res, null);
    assert.equal(calls, 3);
    assert.equal(progressEvents.length, 2); // attempts 2 and 3
    assert.equal(progressEvents[0].attempt, 2);
    assert.equal(progressEvents[1].attempt, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestOllamaChatReply retries 3 times when fetch fails", async () => {
  saveOllamaSettings({
    apiKey: "ollama-test-key-123456789012345",
    enabled: true,
    stream: false,
    baseUrl: "https://ollama.com",
  });

  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response("Server Error", { status: 503 });
  };

  const progressEvents = [];
  try {
    const res = await requestOllamaChatReply(
      { userInput: "hola" },
      null,
      (p) => progressEvents.push(p)
    );
    assert.equal(res, null);
    assert.equal(calls, 3);
    assert.equal(progressEvents.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("processNeuroInput returns api_error without script fallback when AI is configured and fails", async () => {
  saveOllamaSettings({
    apiKey: "ollama-test-key-123456789012345",
    enabled: true,
    stream: false,
    baseUrl: "https://ollama.com",
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response("Server Error", { status: 500 });
  };

  try {
    const res = await processNeuroInput("hola, como estás", { mode: "chat" });
    assert.equal(res.replySource, "api_error");
    assert.match(res.reply, /Error/i);
    assert.doesNotMatch(res.reply, /No encontré recuerdos relacionados/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
