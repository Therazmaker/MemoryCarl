/**
 * astroLinks.js — Vincula lo que hablas en NeuroChat con tu carta natal
 * MemoryCarl / NeuroChat · Couch
 *
 * Todo ocurre en el dispositivo, sin llamar a ninguna IA:
 * 1. detectAstroThemes: detecta en un mensaje los temas de casa y de planeta.
 * 2. recordAstroActivation: guarda esos temas (no los factores de la carta, así un
 *    cambio en la carta no deja datos viejos).
 * 3. getActivationStats: cruza lo guardado con la carta actual (planetas en cada casa,
 *    regente de la casa) y calcula qué se activa más.
 */

import { normalizeText } from "./lifeFacts.js";
import { getNatalChartData } from "./couchStore.js";
import { HOUSE_THEMES, planetsInHouse, houseRuler, hasChartData, chartSummaryForPrompt } from "./astroChart.js";
import { PLANETS_CATALOG } from "./couchStore.js";

export const ACTIVATIONS_KEY = "memorycarl_astro_activations";
export const BACKFILL_KEY = "memorycarl_astro_backfill_done";
export const ASTRO_IN_PROMPT_KEY = "memorycarl_astro_in_prompt";
const MAX_RECORDS = 3000;

// Raíces de palabras (sin tildes) que señalan el tema de cada casa
const HOUSE_WORDS = {
  1: ["mi imagen", "mi cuerpo", "apariencia", "quien soy", "identidad", "autoestima", "me veo"],
  2: ["dinero", "plata", "sueldo", "salario", "ahorr", "gaste", "gasto", "compre", "comprar", "precio", "pagar", "cobr", "ingreso", "soles", "presupuesto", "finanz"],
  3: ["herman", "estudi", "curso", "clase", "aprend", "escrib", "libro", "vecin", "primo", "prima"],
  4: ["mi casa", "hogar", "familia", "mama", "papa", "madre", "padre", "mudanz", "mudar", "depa", "departamento", "alquiler", "infancia"],
  5: ["hijo", "hija", "romance", "enamor", "ligue", "creativ", "arte", "pintar", "musica", "jugar", "juego", "fiesta", "hobby", "disfrut"],
  6: ["rutina", "salud", "gym", "gimnasio", "ejercicio", "dieta", "medic", "doctor", "enferm", "mascota", "perro", "gato", "habito"],
  7: ["pareja", "novia", "novio", "esposa", "esposo", "matrimonio", "boda", "socio", "contrato", "ruptura", "terminamos"],
  8: ["deuda", "prestamo", "credito", "herencia", "crisis", "sexo", "intimidad", "muerte", "murio", "duelo", "terapia", "celos"],
  9: ["viaj", "extranjer", "universidad", "maestria", "doctorado", "filosof", "religio", "dios", "sentido de la vida", "creencia"],
  10: ["trabaj", "empleo", "chamba", "jefe", "empresa", "carrera", "ascenso", "entrevista", "oficina", "profesion", "reputacion", "negocio", "cliente", "renunci", "despid"],
  11: ["amig", "grupo", "comunidad", "equipo", "redes sociales", "planes a futuro"],
  12: ["soledad", "me siento sol", "ansiedad", "insomnio", "pesadilla", "medita", "espiritual", "aislad", "culpa", "inconsciente", "descans"],
};

// Raíces que señalan directamente la energía de un planeta
const PLANET_WORDS = {
  sol: ["proposito", "orgullo", "vitalidad", "brillar"],
  luna: ["emocion", "sentir", "me siento", "nostalgi", "llor", "triste"],
  mercurio: ["pensar", "pienso", "hablar", "comunic", "mensaje", "decidir", "idea"],
  venus: ["amor", "enamor", "belleza", "placer", "carino"],
  marte: ["enoj", "rabia", "ira", "pelea", "discut", "energia", "deporte", "impulso", "conflicto"],
  jupiter: ["suerte", "oportunidad", "crecer", "expandir", "optimis", "abundancia"],
  saturno: ["responsabilidad", "deber", "limite", "presion", "miedo", "disciplina", "cansad", "esfuerzo", "frustr"],
  urano: ["cambio repentino", "sorpresa", "libertad", "rebel", "inesperad"],
  neptuno: ["confus", "ilusion", "inspiraci", "escapar", "alcohol", "engan"],
  pluton: ["control", "poder", "obsesi", "transform", "renacer"],
  chiron: ["herida", "sanar", "trauma"],
};

const compiled = (dict) => Object.entries(dict).map(([key, words]) => ({
  key,
  // Captura la palabra completa del mensaje para mostrarla ("trabajo", no "trabaj")
  words: words.map((w) => ({ w, re: new RegExp(`(?:^|[^a-z0-9])(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z]*)`) })),
}));
const HOUSE_RULES = compiled(HOUSE_WORDS);
const PLANET_RULES = compiled(PLANET_WORDS);

/**
 * Detecta los temas astrológicos de un texto.
 * @param {string} text
 * @returns {{ houses: Array<{h: number, via: string}>, planets: Array<{p: string, via: string}> }}
 */
export function detectAstroThemes(text = "") {
  const lower = normalizeText(text);
  const houses = [];
  const planets = [];
  if (!lower) return { houses, planets };
  const firstMatch = (rule) => {
    for (const { re } of rule.words) {
      const m = lower.match(re);
      if (m) return m[1].trim();
    }
    return null;
  };
  for (const rule of HOUSE_RULES) {
    const via = firstMatch(rule);
    if (via) houses.push({ h: Number(rule.key), via });
  }
  for (const rule of PLANET_RULES) {
    const via = firstMatch(rule);
    if (via) planets.push({ p: rule.key, via });
  }
  return { houses, planets };
}

export function loadActivations() {
  try {
    if (typeof localStorage === "undefined") return [];
    const parsed = JSON.parse(localStorage.getItem(ACTIVATIONS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function saveActivations(records) {
  try {
    localStorage.setItem(ACTIVATIONS_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
  } catch (_e) {
    // Cuota llena: se descartan los más antiguos
    try { localStorage.setItem(ACTIVATIONS_KEY, JSON.stringify(records.slice(-Math.floor(MAX_RECORDS / 2)))); } catch (_e2) {}
  }
}

function buildRecord({ text, messageId, ts, source }) {
  const themes = detectAstroThemes(text);
  if (!themes.houses.length && !themes.planets.length) return null;
  return {
    ts: Number(ts) || Date.now(),
    messageId: messageId || null,
    snippet: String(text || "").trim().slice(0, 160),
    houses: themes.houses,
    planets: themes.planets,
    source: source || "live",
  };
}

/**
 * Registra los temas de un mensaje del usuario. Devuelve el registro o null si no tocó nada.
 */
export function recordAstroActivation({ text, messageId = null, ts = Date.now() } = {}) {
  const rec = buildRecord({ text, messageId, ts, source: "live" });
  if (!rec) return null;
  const records = loadActivations();
  if (messageId && records.some((r) => r.messageId === messageId)) return null;
  records.push(rec);
  saveActivations(records);
  return rec;
}

/**
 * Analiza el historial de chat una sola vez para que las activaciones no empiecen vacías.
 * @param {Array} messages - mensajes del chat ({ role, content, ts, messageId })
 * @returns {number} registros añadidos
 */
export function backfillAstroActivations(messages = []) {
  try {
    if (localStorage.getItem(BACKFILL_KEY) === "1") return 0;
  } catch (_e) {
    return 0;
  }
  const records = loadActivations();
  const known = new Set(records.map((r) => r.messageId).filter(Boolean));
  let added = 0;
  for (const m of messages) {
    if (m?.role !== "user" || (m.messageId && known.has(m.messageId))) continue;
    const rec = buildRecord({ text: m.content, messageId: m.messageId, ts: m.ts, source: "history" });
    if (rec) {
      records.push(rec);
      added++;
    }
  }
  records.sort((a, b) => a.ts - b.ts);
  saveActivations(records);
  try { localStorage.setItem(BACKFILL_KEY, "1"); } catch (_e) {}
  return added;
}

/**
 * Cruza las activaciones con la carta actual.
 * Peso por mensaje: casa tocada 1 · planeta nombrado por su tema 0.8 ·
 * planeta que está en la casa tocada 0.6 · regente de la casa tocada 0.5.
 *
 * @param {{ days?: number|null, chart?: object }} [opts]
 * @returns {{ total: number, houses: Array, planets: Array, records: Array }}
 */
export function getActivationStats({ days = null, chart = getNatalChartData() } = {}) {
  const since = days ? Date.now() - days * 86400000 : 0;
  const records = loadActivations().filter((r) => r.ts >= since);

  const houseStats = new Map();
  const planetStats = new Map();
  const bump = (map, key, w, rec, via) => {
    const s = map.get(key) || { score: 0, count: 0, examples: [], via: new Map() };
    s.score += w;
    if (!s.examples.includes(rec)) {
      s.count++;
      s.examples.push(rec);
    }
    if (via) s.via.set(via, (s.via.get(via) || 0) + 1);
    map.set(key, s);
  };

  for (const rec of records) {
    for (const { h, via } of rec.houses || []) {
      bump(houseStats, h, 1, rec, via);
      for (const pid of planetsInHouse(chart, h)) bump(planetStats, pid, 0.6, rec, `en tu casa ${h}`);
      const ruler = houseRuler(chart, h);
      if (ruler) bump(planetStats, ruler, 0.5, rec, `rige tu casa ${h}`);
    }
    for (const { p, via } of rec.planets || []) bump(planetStats, p, 0.8, rec, via);
  }

  const finish = (s) => ({
    score: Math.round(s.score * 10) / 10,
    count: s.count,
    examples: s.examples.slice(-12).reverse(),
    via: [...s.via.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v]) => v),
  });

  const houses = Array.from({ length: 12 }, (_, i) => ({
    house: i + 1,
    theme: HOUSE_THEMES[i + 1],
    ...(houseStats.has(i + 1) ? finish(houseStats.get(i + 1)) : { score: 0, count: 0, examples: [], via: [] }),
  }));
  const planets = [...planetStats.entries()]
    .map(([id, s]) => ({ id, name: PLANETS_CATALOG.find((c) => c.id === id)?.name || id, symbol: PLANETS_CATALOG.find((c) => c.id === id)?.symbol || "", ...finish(s) }))
    .sort((a, b) => b.score - a.score);

  return { total: records.length, houses, planets, records };
}

/** Si el usuario activó que Carl use la carta en sus respuestas */
export function isAstroInPromptEnabled() {
  try { return localStorage.getItem(ASTRO_IN_PROMPT_KEY) === "1"; } catch (_e) { return false; }
}

export function setAstroInPromptEnabled(enabled) {
  try { localStorage.setItem(ASTRO_IN_PROMPT_KEY, enabled ? "1" : "0"); } catch (_e) {}
}

/**
 * Bloque de carta natal para el prompt. Solo se envía si el usuario lo activó, hay carta
 * y el mensaje toca algún tema; si no, devuelve "" y no gasta tokens.
 */
export function buildAstroPromptBlock(userInput = "", chart = getNatalChartData()) {
  if (!isAstroInPromptEnabled() || !hasChartData(chart)) return "";
  const themes = detectAstroThemes(userInput);
  if (!themes.houses.length && !themes.planets.length) return "";

  const nameOf = (id) => PLANETS_CATALOG.find((c) => c.id === id)?.name || id;
  const touched = themes.houses.map(({ h }) => {
    const inside = planetsInHouse(chart, h).map(nameOf);
    const ruler = houseRuler(chart, h);
    return `Casa ${h} (${HOUSE_THEMES[h]}${inside.length ? `; con ${inside.join(", ")}` : ""}${ruler ? `; regente ${nameOf(ruler)}` : ""})`;
  });
  const planets = themes.planets.map(({ p }) => nameOf(p));

  return `\n\n## CARTA NATAL DEL USUARIO (resumen)\n${chartSummaryForPrompt(chart)}\nEste mensaje toca: ${[...touched, ...planets].join("; ")}.\nÚsala solo como una lente más si aporta algo o si el usuario pregunta por astrología. Nada de predicciones ni determinismo.`;
}
