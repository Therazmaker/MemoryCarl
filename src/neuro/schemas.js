/**
 * schemas.js — Definición y validación del modelo de datos de neuronas
 * NeuroChat / MemoryCarl
 */

/** Tipos de neurona permitidos */
export const NEURON_TYPES = ["memory", "pattern", "belief", "rule", "event", "identity"];

/** Emociones reconocidas */
export const EMOTION_VALUES = [
  "joy", "sadness", "anger", "fear", "surprise", "disgust",
  "curiosity", "pride", "shame", "love", "neutral"
];

/**
 * Crea una neurona con valores por defecto, mezclando el objeto dado.
 * @param {Partial<Neuron>} data
 * @returns {Neuron}
 */
export function createNeuron(data = {}) {
  const now = new Date().toISOString();
  return {
    id:           data.id           || generateId(),
    type:         data.type         || "memory",
    core: {
      concept:    data.core?.concept  || "",
      domain:     data.core?.domain   || "general",
      summary:    data.core?.summary  || "",
    },
    triggers:     Array.isArray(data.triggers)    ? [...data.triggers]    : [],
    connections:  Array.isArray(data.connections) ? [...data.connections] : [],
    weight:       typeof data.weight === "number" ? data.weight : 0.5,
    emotion:      data.emotion       || "neutral",
    evidence:     Array.isArray(data.evidence)    ? [...data.evidence]    : [],
    embedding:    Array.isArray(data.embedding)   ? [...data.embedding]   : [],
    createdAt:    data.createdAt    || now,
    updatedAt:    data.updatedAt    || now,
    lastActivated: data.lastActivated || null,
    timesActivated: typeof data.timesActivated === "number" ? data.timesActivated : 0,
    source: {
      kind:  data.source?.kind  || "user",
      ref:   data.source?.ref   || "",
    },
  };
}

/**
 * Valida una neurona y devuelve lista de errores.
 * @param {any} n
 * @returns {string[]}
 */
export function validateNeuron(n) {
  const errs = [];
  if (!n || typeof n !== "object") { errs.push("neurona no es un objeto"); return errs; }
  if (typeof n.id !== "string" || !n.id)         errs.push("id inválido");
  if (!NEURON_TYPES.includes(n.type))            errs.push(`type inválido: ${n.type}`);
  if (!n.core || typeof n.core !== "object")     errs.push("core faltante");
  else {
    if (typeof n.core.concept !== "string")      errs.push("core.concept inválido");
    if (typeof n.core.domain  !== "string")      errs.push("core.domain inválido");
    if (typeof n.core.summary !== "string")      errs.push("core.summary inválido");
  }
  if (!Array.isArray(n.triggers))                errs.push("triggers no es array");
  if (!Array.isArray(n.connections))             errs.push("connections no es array");
  if (typeof n.weight !== "number")              errs.push("weight inválido");
  if (!Array.isArray(n.evidence))               errs.push("evidence no es array");
  if (!Array.isArray(n.embedding))              errs.push("embedding no es array");
  return errs;
}

/**
 * Sanitiza y normaliza una neurona potencialmente incompleta.
 * @param {any} raw
 * @returns {Neuron|null}
 */
export function sanitizeNeuron(raw) {
  if (!raw || typeof raw !== "object") return null;
  const n = createNeuron(raw);
  // Clamp weight a [0, 1]
  n.weight = Math.max(0, Math.min(1, isFinite(n.weight) ? n.weight : 0.5));
  // Normalizar type
  if (!NEURON_TYPES.includes(n.type)) n.type = "memory";
  // Normalizar emotion
  if (!EMOTION_VALUES.includes(n.emotion)) n.emotion = "neutral";
  // Asegurar strings en core
  n.core.concept = String(n.core.concept || "").slice(0, 200);
  n.core.domain  = String(n.core.domain  || "general").slice(0, 100);
  n.core.summary = String(n.core.summary || "").slice(0, 500);
  // Limitar triggers y connections
  n.triggers    = n.triggers.map(String).filter(Boolean).slice(0, 20);
  n.connections = n.connections.map(String).filter(Boolean).slice(0, 30);
  n.evidence    = n.evidence.map(String).filter(Boolean).slice(0, 20);
  return n;
}

/** Genera un ID simple usando tiempo + random */
export function generateId() {
  return `nrn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
