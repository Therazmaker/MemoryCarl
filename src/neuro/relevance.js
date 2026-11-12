/**
 * relevance.js — Qué tan relacionada está cada neurona con lo que dice el usuario
 * MemoryCarl / NeuroChat
 *
 * Reemplaza al "semántico" de hash-vectores (que daba 0.8–0.9 a casi todo) por
 * evidencia real:
 *   - BM25 sobre concepto, triggers, alias y resumen, con raíces en español y sin acentos,
 *   - equivalencias de palabras comunes ("plata" → dinero, "chamba" → trabajo),
 *   - mención directa del nombre o alias de la neurona,
 *   - lo dicho en los últimos mensajes, con menos fuerza.
 * Si no hay evidencia, la relevancia es 0 y la neurona no se activa.
 * Lógica pura.
 */

import { buildIndex, scoreIndex, normalize } from "../memory/lifeSearch.js";

/** Equivalencias: cada palabra suma también las de su grupo a la búsqueda. */
const SYNONYM_GROUPS = [
  ["dinero", "plata", "soles", "finanzas", "gasto", "gastos", "pago", "pagos", "presupuesto", "ahorro", "cuentas"],
  ["deuda", "deudas", "prestamo", "credito", "debo", "cuota", "cuotas"],
  ["trabajo", "chamba", "empleo", "laburo", "oficina", "empresa", "jefe", "jefa", "entrevista"],
  ["hijo", "hija", "hijos", "niño", "niña", "niños", "bebe"],
  ["pareja", "esposa", "esposo", "novia", "novio", "mujer", "marido", "matrimonio"],
  ["mama", "madre", "papa", "padre", "familia", "hermano", "hermana"],
  ["cansado", "cansada", "cansancio", "agotado", "agotada", "agotamiento", "reventado", "sueño", "dormir", "dormi", "insomnio"],
  ["ansiedad", "ansioso", "ansiosa", "nervioso", "nerviosa", "nervios", "angustia", "preocupado", "preocupada", "estres", "estresado"],
  ["triste", "tristeza", "deprimido", "deprimida", "bajon", "llorar", "llore"],
  ["enojado", "enojada", "rabia", "molesto", "molesta", "furioso", "ira", "pelea", "discusion"],
  ["salud", "enfermo", "enferma", "fiebre", "doctor", "medico", "hospital", "gripe"],
  ["ejercicio", "gimnasio", "gym", "correr", "entrenar", "deporte"],
  ["comida", "comer", "almuerzo", "cena", "desayuno", "dieta"],
  ["estudio", "estudiar", "curso", "clase", "aprender", "universidad"],
];

/** Palabras de conversación que no dicen nada del tema ("hoy", "quiero", "tengo"…). */
const CHAT_STOP = new Set(`
hoy ayer manana mañana ahora luego despues antes siempre nunca ver vemos veo vimos mirar quiero quieres queria tengo tiene tienes tenemos tenia siento sientes estoy estas esta estamos estaba este estos estas mes dia dias semana año ano hacer hago hice hace algo cosa cosas bien mal mucho mucha poco poca ir voy vamos fui puedo puedes podemos creo digo dice dijo gracias hola oye bueno buena pues entonces tambien solo todo toda todos nada otra otro mismo vez rato momento
`.split(/\s+/).filter(Boolean).map((w) => normalize(w).trim()));

function cleanQuery(text = "") {
  return normalize(text).split(/\s+/).filter((w) => w && !CHAT_STOP.has(w)).join(" ");
}

const SYN_INDEX = (() => {
  const m = new Map();
  for (const group of SYNONYM_GROUPS) for (const w of group) m.set(normalize(w).trim(), group);
  return m;
})();

/** Agrega las equivalencias de las palabras del texto (una sola vez por grupo). */
export function expandQuery(text = "") {
  const words = normalize(text).split(/\s+/).filter(Boolean);
  const extra = new Set();
  for (const w of words) {
    const g = SYN_INDEX.get(w);
    if (g) for (const s of g) if (s !== w && !words.includes(s)) extra.add(s);
  }
  return [...extra].join(" ");
}

function mentioned(haystack, needle) {
  const n = normalize(needle).replace(/\s+/g, " ").trim();
  if (n.length < 3) return false;
  return new RegExp(`(^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(haystack);
}

/** Nombre corto de la neurona para detectar que la mencionan ("Lucas (amigo)" → "lucas"). */
function headName(concept = "") {
  return String(concept).split(/\s*(?::|\(|—|–|\s-\s|,)\s*/)[0].trim();
}

/**
 * Prepara el índice de las neuronas una vez por mensaje.
 * @returns {(input: string, opts?: { context?: string }) => Map<string, { relevance, lexical, mention, context }>}
 */
export function buildRelevanceScorer(neurons = []) {
  const live = neurons.filter((n) => n && n.id && n.core?.concept);
  const idx = buildIndex(live.map((n) => ({
    id: n.id,
    fields: {
      concept: n.core.concept,
      triggers: (n.triggers || []).join(" "),
      aliases: (n.meta?.aliases || []).join(" "),
      summary: n.core.summary || "",
    },
  })), { concept: 3, triggers: 2, aliases: 2.5, summary: 1 });

  // BM25 → 0..1 (saturación suave: ~0.5 con una coincidencia clara de palabra rara)
  const squash = (s) => (s > 0 ? s / (s + 4) : 0);

  return (input = "", opts = {}) => {
    const out = new Map();
    // Lo que dijo pesa completo; las equivalencias, a medias
    const q = cleanQuery(input);
    const main = scoreIndex(idx, q);
    const syn = scoreIndex(idx, expandQuery(q));
    const cq = cleanQuery(opts.context || "");
    const ctx = cq ? scoreIndex(idx, `${cq} ${expandQuery(cq)}`) : new Map();
    const hay = ` ${normalize(input).replace(/\s+/g, " ")} `;
    for (const n of live) {
      // Con coincidencia exacta, las equivalencias solo suman un poco; sin ella valen a medias
      const exact = squash(main.get(n.id) || 0);
      const equiv = squash(syn.get(n.id) || 0);
      const lexical = exact > 0 ? Math.min(1, exact + equiv * 0.25) : equiv * 0.6;
      const context = squash(ctx.get(n.id) || 0);
      const name = headName(n.core.concept);
      const mention = (name.split(" ").length <= 3 && mentioned(hay, name))
        || (n.meta?.aliases || []).some((a) => mentioned(hay, a));
      let relevance = Math.max(lexical, context * 0.45);
      if (mention) relevance = Math.max(relevance, 0.9);
      if (relevance > 0) out.set(n.id, { relevance, lexical, mention, context });
    }
    return out;
  };
}
