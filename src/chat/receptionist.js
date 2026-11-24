/**
 * receptionist.js — El recepcionista de NeuroChat
 * MemoryCarl / NeuroChat
 *
 * Antes de que Claude (el cerebro) responda, un modelo chico y barato lee tu mensaje y los
 * últimos del chat, mira el ÍNDICE de lo que existe en tu memoria y dice:
 *   "Claude, para esto vas a necesitar a Papá y lo de la mudanza; busca 'mudanza papá';
 *    'lo que te conté' = la mudanza".
 * No responde ni decide nada sobre ti: solo arma el expediente. La palabra final es de Claude.
 *
 * Hoy lo hace Haiku. El modelo es una pieza intercambiable: cada decisión se guarda en el
 * teléfono para tomarle examen a Gemma (si elige igual de bien, se gana el puesto).
 *
 * Si falla o tarda, no pasa nada: Carl sigue como antes (buscador por palabras + herramientas).
 */

import { getNeuroChatSettings } from "../settings/neurochatSettings.js";
import { claudeCallParams, claudeReplyText } from "../services/claudeModels.js";
import { loadPeople } from "./peopleDirectory.js";

export const RECEPTIONIST_LOG_KEY = "memorycarl_receptionist_log";
export const DEFAULT_RECEPTIONIST_MODEL = "claude-haiku-4-5";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MAX_INDEX = 220;
const TIMEOUT_MS = 9000;

const TYPE_LABEL = {
  person: "persona", project: "proyecto", work_context: "trabajo", hobby: "hobby", preference: "preferencia",
  belief: "creencia", pattern: "patrón", habit: "hábito", emotion: "emoción", goal: "meta", stage: "etapa",
  event: "evento", place: "lugar", memory: "recuerdo", concept: "tema",
};

const clean = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

/** Cuánto pesa una neurona para entrar al índice (si hay demasiadas). */
function importance(n) {
  const pin = n.pin || n.pinned || n.meta?.pinned ? 3 : 0;
  const prio = n.priority === "high" || n.meta?.priority === "high" ? 1.5 : 0;
  const person = n.type === "person" ? 2 : 0;
  const used = Math.log1p(Number(n.timesActivated) || 0);
  const w = Number(n.weight) || 0;
  const last = Date.parse(n.lastActivated || n.updatedAt || n.createdAt || "") || 0;
  const recent = last ? Math.max(0, 1 - (Date.now() - last) / (180 * 86400000)) : 0;
  return pin + prio + person + used + w + recent;
}

/**
 * Índice de lo que existe en la memoria: una línea por cosa, con una referencia corta (n1, n2…)
 * para no gastar tokens en ids largos. Las personas del directorio suman sus apodos.
 * @returns {{ entries: Array<{ ref, id, name, aliases, kind, summary }>, byRef: Map<string, object> }}
 */
export function buildMemoryIndex(neurons = [], people = [], opts = {}) {
  const max = opts.max || MAX_INDEX;
  const live = neurons.filter((n) => n && n.id && !n.deleted && !n.feedbackStats?.removed && n.core?.concept);
  const peopleByName = new Map();
  for (const p of people || []) {
    if (!p || p.deleted || !p.name) continue;
    peopleByName.set(clean(p.name, 60).toLowerCase(), p);
  }
  const chosen = [...live].sort((a, b) => importance(b) - importance(a)).slice(0, max);
  const entries = chosen.map((n, i) => {
    const name = clean(n.core.concept, 60);
    const head = name.split(/\s*(?:\(|:|—|–|,)\s*/)[0].toLowerCase();
    const person = peopleByName.get(name.toLowerCase()) || peopleByName.get(head);
    const aliases = [...new Set([...(n.meta?.aliases || []), ...(person?.aliases || []), ...(person?.relation ? [person.relation] : [])]
      .map((a) => clean(a, 30)).filter(Boolean))].slice(0, 5);
    return {
      ref: `n${i + 1}`,
      id: n.id,
      name,
      aliases,
      kind: TYPE_LABEL[n.type] || n.core.domain || "tema",
      past: Boolean(n.temporal?.isPast || n.temporal?.isHistorical),
      summary: clean(n.core.summary, 70),
    };
  });
  return { entries, byRef: new Map(entries.map((e) => [e.ref, e])) };
}

/** El índice como texto para el recepcionista (con un resumen corto para no confundir nombres). */
export function indexText(index) {
  return index.entries.map((e) => `${e.ref} ${e.name}${e.aliases.length ? ` (${e.aliases.join(", ")})` : ""} [${e.kind}${e.past ? ", pasado" : ""}]${e.summary ? ` — ${e.summary}` : ""}`).join("\n");
}

/** El índice corto para Claude: solo nombres, agrupados, para que sepa QUÉ sabe y lo busque. */
export function buildIndexPromptBlock(index) {
  if (!index?.entries?.length) return "";
  const groups = new Map();
  // Va en cada mensaje a Claude (el modelo caro): solo las 120 más importantes; el resto lo encuentra buscando
  for (const e of index.entries.slice(0, 120)) {
    const k = e.kind;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(`${e.name}${e.aliases.length ? ` (${e.aliases.slice(0, 2).join(", ")})` : ""}`);
  }
  const lines = [...groups.entries()].map(([k, names]) => `- ${k}: ${names.join("; ")}`);
  return `\n\n## ÍNDICE DE TU MEMORIA\nEsto es TODO lo que tienes guardado del usuario (solo nombres). Si su mensaje toca algo de aquí y no tienes el detalle en el contexto de abajo, búscalo con tus herramientas ANTES de responder; no le pidas que te lo repita ni digas que no sabes.\n${lines.join("\n")}\n`;
}

const SYSTEM = `Eres el recepcionista de Carl, el asistente personal de un usuario. NO le respondes al usuario. Tu único trabajo: leer su mensaje (y los últimos del chat) y decirle a Carl qué de la memoria va a necesitar.

Reglas:
- Elige SOLO del índice, por su referencia (n12, n4…). Entre 0 y 6. Mejor una de más que olvidar una importante.
- Resuelve referencias: "mi viejo" = papá, "ella", "eso que te conté", "lo de siempre"… usando los mensajes anteriores y los apodos del índice.
- Si el mensaje es saludo o charla trivial, no elijas nada.
- "busquedas": 0 a 3 búsquedas cortas (2-4 palabras) para el diario del usuario, solo si hace falta un recuerdo concreto (algo que pasó, una fecha, "¿te acuerdas…?").
- "finanzas": true solo si el mensaje tiene que ver con dinero, gastos, deudas o pagos.
- "referencias": explica en una frase corta a qué se refiere lo indirecto (o "" si no hay).
Responde SOLO con JSON, sin texto alrededor:
{"neuronas":["n3"],"busquedas":["mudanza papá"],"finanzas":false,"referencias":"'lo que te conté' = la mudanza"}`;

/** El mensaje para el recepcionista: índice + últimos mensajes + mensaje actual. */
export function buildReceptionistMessages(userInput, history = [], index) {
  const recent = (history || []).filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Usuario" : "Carl"}: ${clean(m.content, m.role === "user" ? 400 : 220)}`)
    .join("\n");
  return {
    system: [
      { type: "text", text: SYSTEM },
      // El índice cambia poco: se cachea y sale más barato desde el segundo mensaje
      { type: "text", text: `ÍNDICE DE LA MEMORIA:\n${indexText(index) || "(vacío)"}`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{
      role: "user",
      content: `${recent ? `Últimos mensajes:\n${recent}\n\n` : ""}Mensaje nuevo del usuario:\n${clean(userInput, 1500)}`,
    }],
  };
}

/** Lee el JSON del recepcionista y lo valida contra el índice (lo que no existe se descarta). */
export function parseReceptionistReply(text, index) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch (_e) { return null; }
  const refs = (Array.isArray(j.neuronas) ? j.neuronas : []).map((r) => String(r).trim());
  const entries = [...new Set(refs)].map((r) => index.byRef.get(r)).filter(Boolean).slice(0, 6);
  const searches = (Array.isArray(j.busquedas) ? j.busquedas : []).map((q) => clean(q, 60)).filter(Boolean).slice(0, 3);
  return {
    neuronIds: entries.map((e) => e.id),
    names: entries.map((e) => e.name),
    searches,
    finance: j.finanzas === true,
    references: clean(j.referencias, 240),
  };
}

/** Bloque para Claude con lo que preparó el recepcionista. */
export function buildReceptionPromptBlock(reception) {
  if (!reception) return "";
  const parts = [];
  if (reception.names?.length) parts.push(`- Para este mensaje importa: ${reception.names.join(", ")} (su detalle está en "Contexto neuronal activo").`);
  if (reception.references) parts.push(`- Referencias: ${reception.references}`);
  if (reception.searches?.length) parts.push(`- Ya se buscó en su diario: ${reception.searches.map((q) => `"${q}"`).join(", ")} (resultados en "Memorias recordadas", si hubo).`);
  if (!parts.length) return "";
  return `\n\n## NOTA DEL RECEPCIONISTA\nUn asistente leyó el mensaje antes que tú y preparó esto. Úsalo como pista; si algo no cuadra con lo que dice el usuario, manda el usuario.\n${parts.join("\n")}\n`;
}

/** ¿El usuario le está diciendo a Carl que ya tenía esa información? (un fallo para medir) */
export function isMissSignal(text = "") {
  const t = String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return /\bya (lo |la |eso )?(tienes|sabes|te (lo |la )?(dije|conte|habia dicho|habia contado))\b|\b(esta|lo tienes|eso esta) en tu memoria\b|\bte lo (dije|conte) (antes|ya)\b|\b(no te acuerdas|acaso no recuerdas)\b/.test(t);
}

// ---------------------------------------------------------------- registro (para el examen de Gemma)

function readLog() {
  try {
    const v = JSON.parse(localStorage.getItem(RECEPTIONIST_LOG_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (_e) { return []; }
}

export function logReception(entry) {
  try {
    const list = readLog();
    list.push({ ts: Date.now(), ...entry });
    localStorage.setItem(RECEPTIONIST_LOG_KEY, JSON.stringify(list.slice(-300)));
  } catch (_e) {}
}

export function getReceptionLog() { return readLog(); }

// ---------------------------------------------------------------- llamada

/** Encendido en Ajustes (por defecto sí) y con clave de Claude. */
export function receptionistEnabled(apiKey) {
  return getNeuroChatSettings().receptionist !== false && Boolean(String(apiKey || "").trim());
}

/**
 * Corre el recepcionista. Nunca lanza error: si algo falla devuelve null y Carl sigue como antes.
 * @param {{ userInput: string, history?: object[], neurons?: object[], people?: object[], apiKey: string, fetchFn?: Function }} input
 * @returns {Promise<null | { neuronIds, names, searches, finance, references, ms, model, index, failed? }>}
 */
export async function runReceptionist({ userInput, history = [], neurons = [], people, apiKey = "", fetchFn } = {}) {
  const started = Date.now();
  const preview = clean(userInput, 300);
  const miss = isMissSignal(userInput);
  if (!receptionistEnabled(apiKey)) return null;
  const index = buildMemoryIndex(neurons, people ?? loadPeople());
  const model = getNeuroChatSettings().receptionistModel || DEFAULT_RECEPTIONIST_MODEL;
  try {
    const { system, messages } = buildReceptionistMessages(userInput, history, index);
    const params = claudeCallParams(model, { maxTokens: 400, effort: "low" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await (fetchFn || fetch)(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": String(apiKey).trim(),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({ model, ...params.body, system, messages }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const parsed = parseReceptionistReply(claudeReplyText(data), index);
    if (!parsed) throw new Error("Respuesta sin JSON");
    const out = { ...parsed, ms: Date.now() - started, model, index };
    logReception({ input: preview, model, ms: out.ms, ok: true, chosen: parsed.names, searches: parsed.searches, finance: parsed.finance, references: parsed.references, miss, indexSize: index.entries.length });
    return out;
  } catch (e) {
    logReception({ input: preview, model, ms: Date.now() - started, ok: false, error: String(e?.message || e).slice(0, 120), miss, indexSize: index.entries.length });
    return { neuronIds: [], names: [], searches: [], finance: false, references: "", failed: true, index };
  }
}
