/**
 * dayoneImport.js — Importar un diario exportado de Day One como Memorias
 * MemoryCarl / NeuroChat
 *
 * Lógica pura (sin localStorage ni red):
 *   - parseDayOneExport: valida el JSON y devuelve sus entradas.
 *   - buildMemoriesFromDayOne: cada entrada → una memoria con su fecha local, título,
 *     texto limpio, palabras clave propias (las que distinguen esa entrada del resto del
 *     diario) y enlaces a las neuronas que menciona (por nombre, concepto o triggers).
 *
 * Los enlaces a neuronas son lo que más pesa para que Carl recuerde una memoria cuando
 * hablas de algo relacionado, por eso se calculan aquí sin gastar llamadas a Claude.
 */

import { entityNameOf } from "../neuro/dedup.js";

export const DAYONE_SOURCE = "dayone";
export const DAYONE_ID_PREFIX = "mem_dayone_";

const MAX_KEYWORDS = 6;
const MAX_LINKS = 6;

/** Palabras demasiado comunes para servir de palabra clave o trigger. */
const STOP = new Set(`
a al algo algun alguna alguno algunos ante antes aqui asi aun aunque bajo bien cada casi como con contra cosa cosas cual cuales cuando cuanto de del desde donde dos el ella ellas ello ellos en entre era eran eres es esa esas ese eso esos esta estaba estabamos estaban estado estamos estan estar estas este esto estos estoy fue fueron fui gran ha haber habia habian hace hacer hacia han has hasta hay he hemos hice hizo hoy igual la las le les lo los luego mas me mi mientras mio mis mismo mucho muchos muy nada ni no nos nosotros nuestra nuestro nunca o otra otras otro otros para pero poco por porque pues que quien quiero se sea segun ser si sido siempre sin sino sobre solo son soy su sus tal tambien tan tanto te tenemos tener tengo tenia ti tiene tienen todo todos tu tus un una uno unos unas usted vamos va van ver vez voy y ya yo
ahora entonces despues mañana manana ayer dia dias noche tarde semana mes año ano años anos rato momento parte forma manera tiempo
creo siento pienso dije dijo decir hacer hago hecho tuve tuvo pude puedo poder quiere queria saber se sabia ir fue fuimos llegar llegue
bueno buena buenos malo mal mejor peor menos mas super tipo medio luego pronto tarde temprano
`.split(/\s+/).filter(Boolean));

const strip = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function tokenizeWords(text = "") {
  return strip(text).replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Valida el JSON de Day One. Lanza un error entendible si no es un export válido. */
export function parseDayOneExport(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  if (!data || typeof data !== "object" || !Array.isArray(data.entries)) {
    throw new Error("El archivo no parece una exportación de Day One (no tiene 'entries').");
  }
  return data.entries.filter((e) => e && typeof e === "object");
}

/** Fecha local (YYYY-MM-DD) de la entrada según su zona horaria. */
export function localDateOf(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString("en-CA", { timeZone: timeZone || "America/Lima" });
  } catch (_e) {
    return d.toISOString().slice(0, 10);
  }
}

/** Separa el título ("# …" de la primera línea) del cuerpo y limpia las marcas de Day One. */
export function splitTitleAndBody(raw = "") {
  let text = String(raw || "").replace(/\r\n/g, "\n");
  // Fotos: el export no trae las imágenes, solo su código
  text = text.replace(/!\[[^\]]*\]\(dayone-moment:[^)]*\)/g, "");
  // Escapes de markdown (\. \- \!)
  text = text.replace(/\\([.\-!()#*_[\]>+])/g, "$1");
  const lines = text.split("\n");
  let title = "";
  const first = (lines[0] || "").trim();
  if (/^#{1,6}\s+/.test(first)) {
    title = first.replace(/^#{1,6}\s+/, "").trim();
    lines.shift();
  }
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, body };
}

function normTerm(t) {
  return strip(t).replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();
}

function buildNeuronTerms(neurons = []) {
  const live = neurons.filter((n) => n && !n.deleted && n.id);
  // Dueño de cada nombre propio: la neurona de la persona. Si hay varias con el mismo nombre,
  // gana la que se llama exactamente así ("Lucas" antes que "Lucas: su trabajo").
  const owner = new Map();
  for (const n of live) {
    const name = entityNameOf(n);
    if (!name || name.length < 3) continue;
    const exact = normTerm(n.core?.concept) === name;
    const prev = owner.get(name);
    if (!prev || (exact && !prev.exact)) owner.set(name, { id: String(n.id), exact });
  }
  const out = [];
  for (const n of live) {
    const id = String(n.id);
    const terms = new Map(); // término normalizado → peso
    const name = entityNameOf(n);
    if (name && owner.get(name)?.id === id) terms.set(name, 3);
    const concept = normTerm(n.core?.concept);
    if (concept && concept.split(" ").length <= 3 && concept.length >= 4 && !STOP.has(concept) && !owner.has(concept)) {
      terms.set(concept, Math.max(terms.get(concept) || 0, 2));
    }
    for (const t of Array.isArray(n.triggers) ? n.triggers : []) {
      const v = normTerm(t);
      // El nombre de una persona solo enlaza a su propia neurona
      if (v.length < 4 || STOP.has(v) || terms.has(v) || (owner.has(v) && owner.get(v).id !== id)) continue;
      terms.set(v, 1);
    }
    if (terms.size) {
      out.push({
        id,
        terms: [...terms.entries()].map(([term, weight]) => ({
          term, weight, re: new RegExp(`(^|[^a-z0-9ñ])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9ñ]|$)`),
        })),
      });
    }
  }
  return out;
}

/**
 * Convierte las entradas en memorias.
 * @param {Array} entries - entradas de Day One
 * @param {{ neurons?: Array, existingIds?: Set<string>|string[] }} [opts]
 * @returns {{ memories: Array, skipped: { empty: number, duplicate: number, photoOnly: number, already: number }, range: { from: string, to: string } | null }}
 */
export function buildMemoriesFromDayOne(entries = [], opts = {}) {
  const existing = new Set(opts.existingIds || []);
  const skipped = { empty: 0, duplicate: 0, photoOnly: 0, already: 0 };
  const seenText = new Set();
  const prepared = [];

  for (const e of entries) {
    const raw = String(e.text || "");
    const { title, body } = splitTitleAndBody(raw);
    const text = body || title;
    if (!raw.trim()) { skipped.empty++; continue; }
    // Solo se omite si al quitar las fotos no queda texto (un "Te amo" corto sí se guarda)
    if (!text.trim()) { if (/dayone-moment:/.test(raw)) skipped.photoOnly++; else skipped.empty++; continue; }
    const key = strip(text).replace(/\s+/g, " ");
    if (seenText.has(key)) { skipped.duplicate++; continue; }
    seenText.add(key);
    const id = `${DAYONE_ID_PREFIX}${String(e.uuid || "").toLowerCase() || prepared.length}`;
    if (existing.has(id)) { skipped.already++; continue; }
    prepared.push({ e, id, title, text, words: tokenizeWords(`${title}\n${text}`) });
  }

  // Frecuencia de cada palabra en todo el diario: las que aparecen en casi todas no distinguen nada
  const df = new Map();
  for (const p of prepared) for (const w of new Set(p.words)) df.set(w, (df.get(w) || 0) + 1);
  const N = Math.max(1, prepared.length);

  const neuronTerms = buildNeuronTerms(opts.neurons || []);
  const memories = prepared.map(({ e, id, title, text, words }) => {
    const date = localDateOf(e.creationDate, e.timeZone);
    // Palabras clave: TF-IDF dentro del diario
    const tf = new Map();
    for (const w of words) tf.set(w, (tf.get(w) || 0) + 1);
    const keywords = [...tf.entries()]
      .filter(([w]) => (df.get(w) || 0) >= 2 || N < 5)
      .map(([w, c]) => [w, c * Math.log((N + 1) / (df.get(w) || 1))])
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_KEYWORDS)
      .map(([w]) => w);

    // Enlaces a neuronas: el texto menciona su nombre, su concepto o sus triggers
    const hay = ` ${strip(`${title}\n${text}`).replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ")} `;
    const scored = [];
    for (const nt of neuronTerms) {
      let score = 0;
      for (const { weight, re } of nt.terms) if (re.test(hay)) score += weight;
      if (score >= 2) scored.push([nt.id, score]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    const linkedNeurons = scored.slice(0, MAX_LINKS).map(([nid]) => nid);

    const tags = [...new Set([
      ...(Array.isArray(e.tags) ? e.tags : []).map((t) => String(t).trim()).filter(Boolean),
      ...keywords,
    ])];

    return {
      id,
      title: (title || text.split("\n")[0]).slice(0, 90),
      text,
      date,
      tags,
      linkedNeurons,
      source: DAYONE_SOURCE,
      context: "dayone_import",
      createdAt: Date.parse(e.creationDate) || Date.now(),
      temporal: { stage: "past", timeContext: "historical", date },
      importance: e.starred || e.isPinned ? "high" : undefined,
    };
  });

  const dates = memories.map((m) => m.date).filter(Boolean).sort();
  return { memories, skipped, range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null };
}
