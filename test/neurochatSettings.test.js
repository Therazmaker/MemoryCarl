/**
 * neurochatSettings.test.js — Tests para el módulo de settings de NeuroChat
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

// ---- Imports ----
import {
  getNeuroChatSettings,
  saveNeuroChatSettings,
  resetNeuroChatSettings,
  validateNeuroChatSettings,
  maskApiKey,
  DEFAULT_SETTINGS,
} from "../src/settings/neurochatSettings.js";

// ================================================================
// getNeuroChatSettings — valores por defecto
// ================================================================

test("getNeuroChatSettings: devuelve defaults cuando no hay settings guardados", () => {
  resetStorage();
  const s = getNeuroChatSettings();
  assert.equal(s.enabled,  DEFAULT_SETTINGS.enabled);
  assert.equal(s.apiKey,   DEFAULT_SETTINGS.apiKey);
  assert.equal(s.model,    DEFAULT_SETTINGS.model);
  assert.equal(s.dailyLimit, DEFAULT_SETTINGS.dailyLimit);
  assert.equal(s.timeoutMs,  DEFAULT_SETTINGS.timeoutMs);
  assert.equal(s.temperature, DEFAULT_SETTINGS.temperature);
  assert.equal(s.maxOutputTokens, DEFAULT_SETTINGS.maxOutputTokens);
  assert.equal(s.premiumOnlyForGeneration, DEFAULT_SETTINGS.premiumOnlyForGeneration);
});

test("getNeuroChatSettings: recupera settings guardados", () => {
  resetStorage();
  saveNeuroChatSettings({ apiKey: "AIzaTest12345", model: "gemini-2.0-flash" });
  const s = getNeuroChatSettings();
  assert.equal(s.apiKey, "AIzaTest12345");
  assert.equal(s.model,  "gemini-2.0-flash");
});

test("getNeuroChatSettings: mezcla defaults con valores parciales", () => {
  resetStorage();
  saveNeuroChatSettings({ dailyLimit: 10 });
  const s = getNeuroChatSettings();
  assert.equal(s.dailyLimit, 10);
  assert.equal(s.model, DEFAULT_SETTINGS.model); // resto permanece por defecto
});

// ================================================================
// saveNeuroChatSettings
// ================================================================

test("saveNeuroChatSettings: guarda y retorna el settings actualizado", () => {
  resetStorage();
  const updated = saveNeuroChatSettings({ temperature: 0.7, dailyLimit: 15 });
  assert.equal(updated.temperature, 0.7);
  assert.equal(updated.dailyLimit,  15);
});

test("saveNeuroChatSettings: lanza error en settings inválidos", () => {
  resetStorage();
  assert.throws(() => saveNeuroChatSettings({ dailyLimit: -5 }), /Settings inválidos/);
});

test("saveNeuroChatSettings: persiste cambios entre llamadas", () => {
  resetStorage();
  saveNeuroChatSettings({ model: "gemini-pro" });
  saveNeuroChatSettings({ temperature: 0.9 });
  const s = getNeuroChatSettings();
  assert.equal(s.model,       "gemini-pro");
  assert.equal(s.temperature, 0.9);
});

// ================================================================
// resetNeuroChatSettings
// ================================================================

test("resetNeuroChatSettings: restaura defaults", () => {
  resetStorage();
  saveNeuroChatSettings({ dailyLimit: 5, temperature: 1.5 });
  resetNeuroChatSettings();
  const s = getNeuroChatSettings();
  assert.equal(s.dailyLimit,   DEFAULT_SETTINGS.dailyLimit);
  assert.equal(s.temperature,  DEFAULT_SETTINGS.temperature);
});

test("resetNeuroChatSettings: keepApiKey preserva la apiKey", () => {
  resetStorage();
  saveNeuroChatSettings({ apiKey: "AIzaMyKey12345", dailyLimit: 5 });
  resetNeuroChatSettings({ keepApiKey: true });
  const s = getNeuroChatSettings();
  assert.equal(s.apiKey,     "AIzaMyKey12345");
  assert.equal(s.dailyLimit, DEFAULT_SETTINGS.dailyLimit);
});

test("resetNeuroChatSettings: sin keepApiKey borra la apiKey", () => {
  resetStorage();
  saveNeuroChatSettings({ apiKey: "AIzaMyKey12345" });
  resetNeuroChatSettings();
  const s = getNeuroChatSettings();
  assert.equal(s.apiKey, "");
});

// ================================================================
// validateNeuroChatSettings
// ================================================================

test("validateNeuroChatSettings: acepta settings válidos completos", () => {
  const errs = validateNeuroChatSettings({
    enabled:                true,
    apiKey:                 "AIzaKey",
    model:                  "gemini-2.5-flash",
    dailyLimit:             20,
    timeoutMs:              15000,
    temperature:            0.4,
    maxOutputTokens:        4096,
    premiumOnlyForGeneration: true,
  });
  assert.deepEqual(errs, []);
});

test("validateNeuroChatSettings: detecta enabled no-boolean", () => {
  const errs = validateNeuroChatSettings({ ...DEFAULT_SETTINGS, enabled: "yes" });
  assert.ok(errs.some((e) => e.includes("enabled")));
});

test("validateNeuroChatSettings: detecta dailyLimit inválido", () => {
  const errs = validateNeuroChatSettings({ ...DEFAULT_SETTINGS, dailyLimit: 0 });
  assert.ok(errs.some((e) => e.includes("dailyLimit")));
});

test("validateNeuroChatSettings: detecta temperature fuera de rango", () => {
  const errs = validateNeuroChatSettings({ ...DEFAULT_SETTINGS, temperature: 3 });
  assert.ok(errs.some((e) => e.includes("temperature")));
});

test("validateNeuroChatSettings: detecta timeoutMs demasiado bajo", () => {
  const errs = validateNeuroChatSettings({ ...DEFAULT_SETTINGS, timeoutMs: 500 });
  assert.ok(errs.some((e) => e.includes("timeoutMs")));
});

test("validateNeuroChatSettings: detecta model vacío", () => {
  const errs = validateNeuroChatSettings({ ...DEFAULT_SETTINGS, model: "" });
  assert.ok(errs.some((e) => e.includes("model")));
});

test("validateNeuroChatSettings: detecta maxOutputTokens <= 0", () => {
  const errs = validateNeuroChatSettings({ ...DEFAULT_SETTINGS, maxOutputTokens: 0 });
  assert.ok(errs.some((e) => e.includes("maxOutputTokens")));
});

test("validateNeuroChatSettings: devuelve error para null", () => {
  const errs = validateNeuroChatSettings(null);
  assert.ok(errs.length > 0);
});

// ================================================================
// maskApiKey
// ================================================================

test("maskApiKey: enmascara key larga correctamente", () => {
  const masked = maskApiKey("AIzaSyB12345678901234");
  assert.ok(masked.startsWith("AIza"));
  assert.ok(masked.includes("•"));
  assert.ok(!masked.includes("B12345678901")); // el medio está oculto
});

test("maskApiKey: devuelve bullet string para key corta", () => {
  const masked = maskApiKey("abc");
  assert.equal(masked, "••••••••");
});

test("maskApiKey: devuelve empty string para apiKey vacía", () => {
  assert.equal(maskApiKey(""), "");
  assert.equal(maskApiKey(null), "");
  assert.equal(maskApiKey(undefined), "");
});

test("maskApiKey: preserva prefijo y sufijo", () => {
  const key    = "AIzaXXXXXXXXXXXXlast";
  const masked = maskApiKey(key);
  assert.ok(masked.startsWith("AIza"));
  assert.ok(masked.endsWith("last"));
});
