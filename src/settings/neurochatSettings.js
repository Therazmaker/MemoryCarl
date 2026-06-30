/**
 * neurochatSettings.js — Configuración persistente de NeuroChat / Gemini Premium
 * MemoryCarl
 *
 * Exporta:
 *   getNeuroChatSettings()
 *   saveNeuroChatSettings(patch)
 *   resetNeuroChatSettings()
 *   validateNeuroChatSettings(settings)
 *   maskApiKey(apiKey)
 */

const SETTINGS_KEY = "memorycarl_neurochat_settings";

/** Valores por defecto */
export const DEFAULT_SETTINGS = {
  enabled:                true,
  apiKey:                 "",
  model:                  "gemini-2.5-flash",
  dailyLimit:             20,
  timeoutMs:              20000,
  temperature:            0.4,
  maxOutputTokens:        4096,
  premiumOnlyForGeneration: true,
};

// ---- Helpers ----

function readRaw() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_e) {
    return null;
  }
}

function writeRaw(settings) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn("[neurochatSettings] Error al guardar settings:", e);
  }
}

// ---- API pública ----

/**
 * Devuelve los settings actuales, mezclados con los valores por defecto.
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function getNeuroChatSettings() {
  const raw = readRaw();
  if (!raw) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    // Asegurar que los campos numéricos son números
    dailyLimit:      typeof raw.dailyLimit      === "number" ? raw.dailyLimit      : DEFAULT_SETTINGS.dailyLimit,
    timeoutMs:       typeof raw.timeoutMs       === "number" ? raw.timeoutMs       : DEFAULT_SETTINGS.timeoutMs,
    temperature:     typeof raw.temperature     === "number" ? raw.temperature     : DEFAULT_SETTINGS.temperature,
    maxOutputTokens: typeof raw.maxOutputTokens === "number" ? raw.maxOutputTokens : DEFAULT_SETTINGS.maxOutputTokens,
  };
}

/**
 * Aplica un patch parcial a los settings actuales y los persiste.
 * @param {Partial<typeof DEFAULT_SETTINGS>} patch
 * @returns {typeof DEFAULT_SETTINGS} settings resultantes
 */
export function saveNeuroChatSettings(patch) {
  const current = getNeuroChatSettings();
  const updated  = { ...current, ...patch };
  const errs = validateNeuroChatSettings(updated);
  if (errs.length > 0) {
    throw new Error(`Settings inválidos: ${errs.join(", ")}`);
  }
  writeRaw(updated);
  return updated;
}

/**
 * Resetea los settings a los valores por defecto (sin borrar la API key por seguridad).
 * @param {{ keepApiKey?: boolean }} [options]
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function resetNeuroChatSettings(options = {}) {
  const defaults = { ...DEFAULT_SETTINGS };
  if (options.keepApiKey) {
    const current = getNeuroChatSettings();
    defaults.apiKey = current.apiKey;
  }
  writeRaw(defaults);
  return defaults;
}

/**
 * Valida un objeto de settings y devuelve lista de errores.
 * @param {any} settings
 * @returns {string[]}
 */
export function validateNeuroChatSettings(settings) {
  const errs = [];
  if (!settings || typeof settings !== "object") {
    errs.push("settings no es un objeto");
    return errs;
  }
  if (typeof settings.enabled !== "boolean") errs.push("enabled debe ser boolean");
  if (typeof settings.apiKey  !== "string")  errs.push("apiKey debe ser string");
  if (typeof settings.model   !== "string" || !settings.model) errs.push("model inválido");
  if (typeof settings.dailyLimit !== "number"      || settings.dailyLimit < 1)    errs.push("dailyLimit debe ser >= 1");
  if (typeof settings.timeoutMs  !== "number"      || settings.timeoutMs  < 1000) errs.push("timeoutMs debe ser >= 1000");
  if (typeof settings.temperature !== "number"     || settings.temperature < 0 || settings.temperature > 2) {
    errs.push("temperature debe estar entre 0 y 2");
  }
  if (typeof settings.maxOutputTokens !== "number" || settings.maxOutputTokens < 1) {
    errs.push("maxOutputTokens debe ser >= 1");
  }
  if (typeof settings.premiumOnlyForGeneration !== "boolean") {
    errs.push("premiumOnlyForGeneration debe ser boolean");
  }
  return errs;
}

/**
 * Enmascara una API key para mostrarla en UI sin exponerla.
 * Ejemplo: "AIza...xxxxx" → "AIza••••••••••xxxx"
 * @param {string} apiKey
 * @returns {string}
 */
export function maskApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return "";
  if (apiKey.length <= 8) return "••••••••";
  const visible = 4;
  const prefix  = apiKey.slice(0, visible);
  const suffix  = apiKey.slice(-4);
  const hidden  = "•".repeat(Math.min(10, apiKey.length - visible - 4));
  return `${prefix}${hidden}${suffix}`;
}
