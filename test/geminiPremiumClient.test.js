/**
 * geminiPremiumClient.test.js — Tests para el cliente Gemini Premium
 * MemoryCarl
 */

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
function resetStorage() {
  Object.keys(store).forEach((k) => delete store[k]);
}

// ---- Mock fetch ----
let fetchMock = null;
globalThis.fetch = async (url, opts) => {
  if (fetchMock) return fetchMock(url, opts);
  throw new Error("fetch no mockeado");
};

// ---- Imports ----
import {
  parseGeminiJsonResponse,
  sanitizeGeminiNeuronPayload,
  isGeminiPremiumConfigured,
  getGeminiPremiumSettings,
  requestGeminiPremiumNeuronGeneration,
} from "../src/services/geminiPremiumClient.js";

import {
  saveNeuroChatSettings,
  resetNeuroChatSettings,
  getNeuroChatSettings,
} from "../src/settings/neurochatSettings.js";

// ================================================================
// parseGeminiJsonResponse — parseo robusto
// ================================================================

test("parseGeminiJsonResponse: JSON limpio con neurons array", () => {
  const raw = JSON.stringify({ neurons: [{ type: "pattern", core: { concept: "A", domain: "general", summary: "S" } }] });
  const result = parseGeminiJsonResponse(raw);
  assert.ok(Array.isArray(result.neurons));
  assert.equal(result.neurons.length, 1);
});

test("parseGeminiJsonResponse: array directo", () => {
  const raw = JSON.stringify([{ type: "memory", core: { concept: "B", domain: "personal", summary: "X" } }]);
  const result = parseGeminiJsonResponse(raw);
  assert.ok(Array.isArray(result.neurons));
  assert.equal(result.neurons.length, 1);
});

test("parseGeminiJsonResponse: quita markdown fences ```json", () => {
  const raw = '```json\n{"neurons":[{"type":"belief","core":{"concept":"C","domain":"habits","summary":"S"}}]}\n```';
  const result = parseGeminiJsonResponse(raw);
  assert.ok(Array.isArray(result.neurons));
  assert.equal(result.neurons[0].core.concept, "C");
});

test("parseGeminiJsonResponse: quita markdown fences genéricas", () => {
  const raw = '```\n{"neurons":[]}\n```';
  const result = parseGeminiJsonResponse(raw);
  assert.ok(Array.isArray(result.neurons));
  assert.equal(result.neurons.length, 0);
});

test("parseGeminiJsonResponse: extrae JSON de texto adicional", () => {
  const raw = 'Aquí está la respuesta:\n{"neurons":[{"type":"pattern","core":{"concept":"D","domain":"work","summary":"T"}}]}\nFin.';
  const result = parseGeminiJsonResponse(raw);
  assert.ok(Array.isArray(result.neurons));
  assert.equal(result.neurons.length, 1);
});

test("parseGeminiJsonResponse: lanza error en JSON inválido", () => {
  assert.throws(() => parseGeminiJsonResponse("esto no es JSON"), /No se pudo parsear JSON/);
});

test("parseGeminiJsonResponse: lanza error en string vacío", () => {
  assert.throws(() => parseGeminiJsonResponse(""), /vacía o inválida/);
});

test("parseGeminiJsonResponse: lanza error en null", () => {
  assert.throws(() => parseGeminiJsonResponse(null), /vacía o inválida/);
});

test("parseGeminiJsonResponse: estructura no reconocida lanza error", () => {
  assert.throws(() => parseGeminiJsonResponse('{"foo":"bar"}'), /no reconocida/);
});

// ================================================================
// sanitizeGeminiNeuronPayload
// ================================================================

test("sanitizeGeminiNeuronPayload: filtra nodos inválidos y devuelve los válidos", () => {
  const raw = [
    { type: "pattern", core: { concept: "Mi patrón", domain: "personal", summary: "Resumen" }, triggers: ["trigger1"] },
    null,
    { type: "INVALID_TYPE", core: { concept: "x", domain: "general", summary: "" } },
    { type: "memory", core: { concept: "Otro recuerdo", domain: "work", summary: "Detalle" }, triggers: [] },
  ];
  const result = sanitizeGeminiNeuronPayload(raw);
  assert.ok(Array.isArray(result));
  assert.ok(result.length >= 1);
  // Todas las neuronas devueltas deben tener concept
  for (const n of result) {
    assert.ok(n.core.concept.length >= 3);
    assert.equal(n.source.ref, "gemini_premium");
  }
});

test("sanitizeGeminiNeuronPayload: limita a máximo 3 neuronas", () => {
  const raw = Array.from({ length: 10 }, (_, i) => ({
    type: "memory",
    core: { concept: `Concepto ${i}`, domain: "general", summary: `Resumen ${i}` },
    triggers: [`trigger${i}`],
  }));
  const result = sanitizeGeminiNeuronPayload(raw);
  assert.ok(result.length <= 3);
});

test("sanitizeGeminiNeuronPayload: devuelve vacío para input inválido", () => {
  assert.deepEqual(sanitizeGeminiNeuronPayload(null), []);
  assert.deepEqual(sanitizeGeminiNeuronPayload("string"), []);
  assert.deepEqual(sanitizeGeminiNeuronPayload([]), []);
});

test("sanitizeGeminiNeuronPayload: rechaza neuronas sin concepto mínimo", () => {
  const raw = [
    { type: "memory", core: { concept: "ab", domain: "general", summary: "" }, triggers: [] }, // concept demasiado corto
  ];
  const result = sanitizeGeminiNeuronPayload(raw);
  assert.equal(result.length, 0);
});

// ================================================================
// isGeminiPremiumConfigured
// ================================================================

test("isGeminiPremiumConfigured: false sin settings", () => {
  resetStorage();
  assert.equal(isGeminiPremiumConfigured(), false);
});

test("isGeminiPremiumConfigured: false con apiKey vacía", () => {
  resetStorage();
  saveNeuroChatSettings({ enabled: true, apiKey: "" });
  assert.equal(isGeminiPremiumConfigured(), false);
});

test("isGeminiPremiumConfigured: false con apiKey corta", () => {
  resetStorage();
  saveNeuroChatSettings({ enabled: true, apiKey: "abc123" });
  assert.equal(isGeminiPremiumConfigured(), false);
});

test("isGeminiPremiumConfigured: true con apiKey válida y enabled=true", () => {
  resetStorage();
  saveNeuroChatSettings({ enabled: true, apiKey: "AIzaTestKey12345" });
  assert.equal(isGeminiPremiumConfigured(), true);
});

test("isGeminiPremiumConfigured: false cuando enabled=false aunque haya apiKey", () => {
  resetStorage();
  saveNeuroChatSettings({ enabled: false, apiKey: "AIzaTestKey12345" });
  assert.equal(isGeminiPremiumConfigured(), false);
});

// ================================================================
// requestGeminiPremiumNeuronGeneration — con mocks
// ================================================================

test("requestGeminiPremiumNeuronGeneration: lanza error si no configurado", async () => {
  resetStorage();
  await assert.rejects(
    () => requestGeminiPremiumNeuronGeneration({ userInput: "test", activatedNeurons: [], missingAnalysis: { needsGeneration: true, missingConcepts: [], reasons: [], coverage: 0 } }),
    /no configurado/
  );
});

test("requestGeminiPremiumNeuronGeneration: retorna neuronas válidas de respuesta mock", async () => {
  resetStorage();
  saveNeuroChatSettings({ enabled: true, apiKey: "AIzaTestKey12345678" });

  const mockNeurons = [
    { type: "pattern", core: { concept: "Rutina matutina", domain: "habits", summary: "El usuario hace ejercicio cada mañana" }, triggers: ["mañana", "rutina"], evidence: ["lo mencionó hoy"] },
  ];
  fetchMock = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ neurons: mockNeurons }) }] } }]
    }),
  });

  const result = await requestGeminiPremiumNeuronGeneration({
    userInput: "Hoy hice ejercicio de mañana como siempre",
    activatedNeurons: [],
    missingAnalysis: { needsGeneration: true, missingConcepts: ["rutina"], reasons: ["baja cobertura"], coverage: 0.2 },
    history: [],
  });

  assert.ok(Array.isArray(result));
  assert.ok(result.length >= 1);
  assert.equal(result[0].core.concept, "Rutina matutina");
  assert.equal(result[0].source.ref, "gemini_premium");

  fetchMock = null;
});

test("requestGeminiPremiumNeuronGeneration: lanza error útil en respuesta HTTP no-ok", async () => {
  resetStorage();
  saveNeuroChatSettings({ enabled: true, apiKey: "AIzaTestKey12345678" });

  fetchMock = async () => ({
    ok: false,
    status: 403,
    text: async () => "API key invalid",
  });

  await assert.rejects(
    () => requestGeminiPremiumNeuronGeneration({
      userInput: "test",
      activatedNeurons: [],
      missingAnalysis: { needsGeneration: true, missingConcepts: [], reasons: [], coverage: 0 },
    }),
    /403/
  );

  fetchMock = null;
});

test("requestGeminiPremiumNeuronGeneration: lanza error si candidates vacío", async () => {
  resetStorage();
  saveNeuroChatSettings({ enabled: true, apiKey: "AIzaTestKey12345678" });

  fetchMock = async () => ({
    ok: true,
    json: async () => ({ candidates: [] }),
  });

  await assert.rejects(
    () => requestGeminiPremiumNeuronGeneration({
      userInput: "test",
      activatedNeurons: [],
      missingAnalysis: { needsGeneration: true, missingConcepts: [], reasons: [], coverage: 0 },
    }),
    /no devolvió contenido/
  );

  fetchMock = null;
});
