/**
 * grounding.js — Que Carl no invente: reglas, fechas en el historial y guardas
 * MemoryCarl / NeuroChat
 *
 * - GROUNDING_RULES: reglas de "solo afirma lo que está escrito" que van en el prompt.
 * - buildHistoryMessages: el historial con la fecha y hora de cada mensaje del usuario,
 *   y un aviso cuando pasó mucho tiempo desde el mensaje anterior.
 * - guardLifeActions: lo que todavía no pasa ("va llegando", "el viernes empiezo") no se
 *   guarda como hecho de vida, sino como pendiente con fecha.
 * - applyMemoryActions: aplica upsertPerson y correction (directorio y correcciones).
 */

import { todayLocalStr } from "./lifeDates.js";
import { upsertPerson } from "./peopleDirectory.js";
import { addCorrection } from "./corrections.js";

export const GROUNDING_RULES = `
REGLAS DE VERDAD (las más importantes):
- Solo afirma lo que está escrito en tu contexto (directorio de personas, hechos, hilos, días, neuronas, memorias, correcciones) o en la conversación. Si algo no está, no lo sabes: no lo completes con suposiciones. Dilo o pregunta.
- Nunca inventes fechas, plazos ni "hace X días". Las duraciones ya vienen calculadas en el contexto; si no vienen, no las digas.
- Distingue lo que YA PASÓ de lo que VA A PASAR o está pasando: "va llegando", "llega el viernes", "voy a empezar" NO es que ya ocurrió. No lo des por hecho después: si no sabes si ya pasó, pregunta.
- Escribe los nombres de las personas exactamente como aparecen en el directorio. Si el usuario nombra a alguien que no está, es otra persona: no la confundas con nadie.
- Si el contexto se contradice con lo que el usuario dice ahora, manda lo que dice ahora (y si cambia algo guardado, actualízalo).
- Cuando uses tu memoria, puedes decirlo con naturalidad ("me contaste que…"), pero solo si de verdad está en el contexto. Es mejor no mencionar un recuerdo que inventarlo.
- Los mensajes del usuario llevan entre corchetes cuándo los escribió, para que sepas cuánto tiempo pasó. Tú no escribas esos corchetes.

DIRECTORIO Y CORRECCIONES (también van en el JSON de acciones):
- { "type": "upsertPerson", "person": { "name": "Nombre exacto", "relation": "quién es para el usuario (ej. hermano, pareja, amiga del trabajo)", "aliases": ["apodo"] } } — solo cuando el usuario diga quién es alguien. No adivines la relación.
- { "type": "correction", "wrong": "lo que dijiste o creías mal", "right": "lo cierto según el usuario" } — cuando el usuario te corrija ("no, eso no es así", "no se llama así", "todavía no llega").`;

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "[lun 14 nov · 18:05]" en hora local. */
export function stampLabel(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `[${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${hh}:${mm}]`;
}

/** "3 horas", "2 días"… */
export function gapLabel(ms) {
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} minutos`;
  if (h < 48) return `${Math.round(h)} hora${Math.round(h) === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} días`;
}

const msgTs = (m) => {
  const t = m?.ts ?? (m?.created_at ? Date.parse(m.created_at) : null);
  return Number.isFinite(t) ? t : null;
};

const cleanContent = (m) => {
  let c = String(m?.content || "").trim();
  if (m?.role === "assistant" && c.includes("---NEURON_ACTIONS---")) c = c.split("---NEURON_ACTIONS---")[0].trim();
  return c;
};

/**
 * Historial listo para la IA: cada mensaje del usuario con su fecha y hora, sin repetir el
 * mensaje actual (el historial ya lo trae), y un aviso si pasaron horas o días desde el anterior.
 * @param {Array} history - mensajes { role, content, ts }
 * @param {string} userInput - mensaje actual
 * @param {{ now?: number, limit?: number }} [opts]
 * @returns {{ messages: Array<{ role: string, content: string }>, gapNote: string }}
 */
export function buildHistoryMessages(history = [], userInput = "", opts = {}) {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 12;
  const items = (history || []).filter((m) => (m?.role === "user" || m?.role === "assistant") && cleanContent(m));
  // El mensaje actual ya viene al final del historial: se quita para no mandarlo dos veces
  const last = items[items.length - 1];
  if (last && last.role === "user" && cleanContent(last) === String(userInput || "").trim()) items.pop();
  const recent = items.slice(-limit);
  const messages = recent.map((m) => {
    const content = cleanContent(m);
    const ts = msgTs(m);
    return { role: m.role, content: m.role === "user" && ts ? `${stampLabel(ts)} ${content}` : content };
  });
  messages.push({ role: "user", content: `${stampLabel(now)} ${String(userInput || "").trim()}` });

  let gapNote = "";
  const prevTs = recent.length ? msgTs(recent[recent.length - 1]) : null;
  if (prevTs && now - prevTs >= 3 * 3600000) {
    gapNote = `\n\n## TIEMPO DESDE LA CHARLA ANTERIOR\nEl mensaje anterior de esta conversación fue hace ${gapLabel(now - prevTs)}. Lo que se habló antes puede haber cambiado: no supongas que sigue igual (si algo "iba a pasar", no sabes si ya pasó).`;
  }
  return { messages, gapNote };
}

// Señales de que algo todavía no pasa (sin tildes, minúsculas)
const FUTURE_RE = /(^|\s)(va a|vas a|voy a|vamos a|van a|iremos|ira a|llegara|vendra|va llegando|esta llegando|estan llegando|esta por|por llegar|viene a|vienen a|viene el|vienen el|llega el|llega la|llega en|llega manana|llegan el|empieza el|empiezo el|empiezo la|empieza la|empieza manana|empiezo manana|desde el proximo|el proximo|la proxima|proxima semana|proximo mes|pasado manana|planea|planeo|planeamos|piensa|pienso|quiere|quiero|quisiera|me gustaria|tal vez|quizas|quiza|posiblemente|seguramente|si todo sale|a fin de mes|a fin de ano)(\s|$|[,.])/;

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** true si el texto habla de algo que todavía no pasó. */
export function isFutureStatement(text = "") {
  return FUTURE_RE.test(` ${norm(text)} `);
}

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Revisa las acciones de situación de vida antes de aplicarlas:
 * - un hecho que empieza en el futuro, o que habla de algo que todavía no pasa, se guarda
 *   como pendiente (openThread) con su fecha, no como hecho;
 * - un hecho sin fecha queda marcado "sin fecha exacta" (no se inventa "desde hace X días").
 * @returns {Array} acciones revisadas
 */
export function guardLifeActions(actions = [], opts = {}) {
  const today = opts.today || todayLocalStr();
  if (!Array.isArray(actions)) return [];
  return actions.map((a) => {
    if (a?.type !== "upsertLifeFact" || !a.fact) return a;
    const fact = { ...a.fact };
    const since = isDate(fact.since) ? fact.since : null;
    if ((since && since > today) || isFutureStatement(fact.text)) {
      return {
        type: "openThread",
        thread: {
          topic: String(fact.text || "").slice(0, 200),
          category: fact.category,
          dueDate: since && since > today ? since : null,
          note: "Todavía no pasa: confirmar si ocurrió",
        },
        guardedFrom: "upsertLifeFact",
      };
    }
    if (!since) fact.sinceApprox = true;
    return { ...a, fact };
  });
}

/**
 * Aplica las acciones de directorio y correcciones.
 * @returns {Array<{ kind: string, text: string }>} lo que se guardó (para avisarle al usuario)
 */
export function applyMemoryActions(actions = []) {
  const done = [];
  for (const a of Array.isArray(actions) ? actions : []) {
    try {
      if (a?.type === "upsertPerson" && a.person?.name) {
        const p = upsertPerson({ ...a.person, source: "carl" });
        if (p) done.push({ kind: "person", text: `${p.name}${p.relation ? ` (${p.relation})` : ""}` });
      } else if (a?.type === "correction" && (a.wrong || a.right)) {
        const c = addCorrection({ wrong: a.wrong, right: a.right, source: "chat" });
        if (c) done.push({ kind: "correction", text: c.right || c.wrong });
      }
    } catch (err) {
      console.warn("[grounding] No se pudo aplicar:", a?.type, err);
    }
  }
  return done;
}
