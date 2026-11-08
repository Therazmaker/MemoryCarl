/**
 * journal.js — Diario: entradas cortas del día a día, sin conversación
 * MemoryCarl · NeuroChat
 *
 * Cada entrada vive dentro de su día (`day.journal`), así viaja a Supabase con el día
 * (tabla `days`, columna `data`) sin tablas nuevas. Un borrado deja una lápida
 * (`deleted: true`) para que al fusionar con la nube no reaparezca.
 *
 * Lógica pura (sin almacenamiento): dayStore.js la usa para leer y guardar.
 */

import { todayLocalStr } from "../chat/lifeDates.js";

export const JOURNAL_MOODS = [
  { id: "great", emoji: "😄", label: "Genial" },
  { id: "good", emoji: "🙂", label: "Bien" },
  { id: "meh", emoji: "😐", label: "Normal" },
  { id: "low", emoji: "😕", label: "Bajón" },
  { id: "sad", emoji: "😢", label: "Triste" },
  { id: "angry", emoji: "😠", label: "Enojo" },
  { id: "anxious", emoji: "😰", label: "Ansiedad" },
  { id: "tired", emoji: "😴", label: "Cansancio" },
];

export const QUICK_TAGS = ["trabajo", "casa", "salud", "pareja", "familia", "dinero", "amigos", "proyecto"];

const MAX_TEXT = 4000;

export function moodById(id) {
  return JOURNAL_MOODS.find((m) => m.id === id) || null;
}

function normTag(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ_]/g, "").slice(0, 30);
}

/** Etiquetas escritas como #hashtag dentro del texto. */
export function parseTags(text = "") {
  const out = [];
  for (const m of String(text).matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const t = normTag(m[1]);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Crea una entrada. Las etiquetas son las elegidas más los #hashtags del texto.
 * @returns {object|null} null si el texto está vacío
 */
export function createEntry({ text, mood = null, tags = [], ts = Date.now() } = {}) {
  const clean = String(text || "").trim().slice(0, MAX_TEXT);
  if (!clean) return null;
  const now = new Date().toISOString();
  const allTags = [...new Set([...(tags || []).map(normTag).filter(Boolean), ...parseTags(clean)])];
  return {
    id: `jr_${Number(ts).toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    ts: Number(ts),
    text: clean,
    mood: moodById(mood) ? mood : null,
    tags: allTags,
    createdAt: now,
    updatedAt: now,
  };
}

/** Fecha local (YYYY-MM-DD) de una entrada. */
export function entryDate(entry) {
  return todayLocalStr(new Date(entry.ts));
}

/**
 * Añade una entrada a su día (lo crea si no existe). No modifica la lista recibida.
 * @param {Array} days
 * @param {object} entry
 * @param {(date: string) => object} buildDay
 */
export function addEntryToDays(days = [], entry, buildDay) {
  const date = entryDate(entry);
  const list = [...days];
  let idx = list.findIndex((d) => d.date === date);
  if (idx === -1) {
    list.push({ ...buildDay(date), status: date < todayLocalStr() ? "closed" : "open" });
    idx = list.length - 1;
  }
  const day = list[idx];
  list[idx] = { ...day, journal: [...(day.journal || []), entry].sort((a, b) => a.ts - b.ts), updatedAt: new Date().toISOString() };
  list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return list;
}

function mapEntry(days, id, fn) {
  let found = false;
  const list = days.map((d) => {
    if (!Array.isArray(d.journal) || !d.journal.some((e) => e.id === id)) return d;
    found = true;
    return { ...d, journal: d.journal.map((e) => (e.id === id ? fn(e) : e)), updatedAt: new Date().toISOString() };
  });
  return { list, found };
}

/** Edita texto, ánimo o etiquetas de una entrada. */
export function updateEntryInDays(days = [], id, patch = {}) {
  return mapEntry(days, id, (e) => {
    const text = patch.text !== undefined ? String(patch.text).trim().slice(0, MAX_TEXT) : e.text;
    const tags = patch.tags !== undefined
      ? [...new Set([...patch.tags.map(normTag).filter(Boolean), ...parseTags(text)])]
      : [...new Set([...(e.tags || []), ...parseTags(text)])];
    return {
      ...e,
      text,
      mood: patch.mood !== undefined ? (moodById(patch.mood) ? patch.mood : null) : e.mood,
      tags,
      updatedAt: new Date().toISOString(),
    };
  });
}

/** Borra una entrada dejando una lápida (para que no vuelva desde la nube). */
export function deleteEntryInDays(days = [], id) {
  return mapEntry(days, id, (e) => ({ id: e.id, ts: e.ts, deleted: true, text: "", tags: [], mood: null, createdAt: e.createdAt, updatedAt: new Date().toISOString() }));
}

/** Todas las entradas visibles, de la más reciente a la más antigua, con su fecha. */
export function journalEntries(days = []) {
  const out = [];
  for (const d of days) {
    for (const e of d.journal || []) if (e && !e.deleted) out.push({ ...e, date: d.date });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/** Une dos diarios del mismo día: por id, gana la versión modificada más recientemente. */
export function mergeJournals(a = [], b = []) {
  const byId = new Map();
  for (const e of [...(a || []), ...(b || [])]) {
    if (!e?.id) continue;
    const cur = byId.get(e.id);
    if (!cur || String(e.updatedAt || "") > String(cur.updatedAt || "")) byId.set(e.id, e);
  }
  return [...byId.values()].sort((x, y) => x.ts - y.ts);
}

function relDay(date, today) {
  if (date === today) return "hoy";
  const y = new Date(today + "T12:00:00");
  y.setDate(y.getDate() - 1);
  if (date === todayLocalStr(y)) return "ayer";
  return date;
}

/**
 * Bloque para el prompt de Carl: lo escrito en el diario los últimos días.
 * Compacto (~100–200 tokens) y vacío si no hay entradas.
 */
export function buildJournalPromptBlock(days = [], { lastDays = 3, maxChars = 700, now = new Date() } = {}) {
  const today = todayLocalStr(now);
  const from = new Date(now);
  from.setDate(from.getDate() - (lastDays - 1));
  const fromStr = todayLocalStr(from);
  const entries = journalEntries(days).filter((e) => e.date >= fromStr && e.date <= today).reverse();
  if (!entries.length) return "";

  const lines = [];
  let used = 0;
  // Las más recientes primero en importancia: se recorta por el lado antiguo
  for (const e of [...entries].reverse()) {
    const time = new Date(e.ts).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
    const mood = moodById(e.mood);
    const text = e.text.length > 220 ? `${e.text.slice(0, 217)}…` : e.text;
    const line = `- ${relDay(e.date, today)} ${time}${mood ? ` (${mood.label.toLowerCase()})` : ""}: ${text}`;
    if (used + line.length > maxChars) break;
    lines.unshift(line);
    used += line.length;
  }
  return `\n\n## DIARIO DEL USUARIO (últimos días)\nNotas que el usuario escribió para sí mismo, sin conversar. Úsalas como contexto de su día a día; no las cites literalmente ni comentes que las leíste salvo que venga al caso.\n${lines.join("\n")}`;
}
