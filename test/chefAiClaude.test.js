import test from "node:test";
import assert from "node:assert/strict";

// Shim localStorage for Node environment if needed
if (typeof globalThis.localStorage === "undefined") {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear()
  };
}

import {
  getChefAiSettings,
  saveChefAiSettings,
  explainAiError,
  callClaude
} from "../src/shopping/shoppingAi.js";

test("Chef AI Claude: getChefAiSettings devuelve defaults y detecta claude", () => {
  localStorage.clear();
  const defaults = getChefAiSettings();
  assert.equal(defaults.claudeApiKey, "");
  assert.equal(defaults.claudeModel, "claude-3-5-sonnet-20241022");
  assert.equal(defaults.provider, "gemini");
});

test("Chef AI Claude: saveChefAiSettings guarda configuraciones de Claude", () => {
  localStorage.clear();
  saveChefAiSettings({
    provider: "claude",
    claudeApiKey: "sk-ant-api-test-key",
    claudeModel: "claude-3-7-sonnet-latest"
  });

  const saved = getChefAiSettings();
  assert.equal(saved.provider, "claude");
  assert.equal(saved.claudeApiKey, "sk-ant-api-test-key");
  assert.equal(saved.claudeModel, "claude-3-7-sonnet-latest");
});

test("Chef AI Claude: explainAiError formatea correctamente errores de Claude", () => {
  const authErr = explainAiError(null, "Anthropic Claude", 401, "invalid x-api-key");
  assert.ok(authErr.includes("ERROR DE AUTENTICACIÓN"));
  assert.ok(authErr.includes("Anthropic Claude"));

  const quotaErr = explainAiError(null, "Anthropic Claude", 429, "rate_limit_error");
  assert.ok(quotaErr.includes("LÍMITE DE LLAMADAS ALCANZADO"));
});

test("Chef AI Claude: callClaude valida la presencia de la API Key", async () => {
  await assert.rejects(
    async () => {
      await callClaude([{ role: "user", content: "Hola" }], "");
    },
    (err) => {
      return err.message.includes("Falta la API Key de Anthropic Claude");
    }
  );
});
