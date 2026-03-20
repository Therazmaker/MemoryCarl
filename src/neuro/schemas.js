/**
 * schemas.js — Definición y validación del modelo de datos de neuronas
 * NeuroChat / MemoryCarl
 */
import { normalizeTemporalMeta, TEMPORAL_CONTEXTS, TEMPORAL_SOURCES, TEMPORAL_CONFIDENCE } from "./temporal.js";

/** Tipos de neurona permitidos */
export const NEURON_TYPES = [
  "memory", "pattern", "belief", "rule", "event", "identity",
  "person", "relationship", "work_context", "hobby", "project",
  "preference", "life_area", "place", "identity_anchor", "manual_context",
];

export const MANUAL_CATEGORIES = ["people", "work", "hobbies", "projects", "preferences", "places", "identity", "other"];
export const MANUAL_PRIORITIES = ["low", "medium", "high"];

/** Emociones reconocidas */
export const EMOTION_VALUES = [
  "joy", "sadness", "anger", "fear", "surprise", "disgust",
  "curiosity", "pride", "shame", "love", "neutral"
];

function normalizeAliases(aliases) {
  if (!Array.isArray(aliases)) return [];
  const seen = new Set();
  return aliases
    .map((a) => String(a || "").trim().toLowerCase())
    .filter(Boolean)
    .filter((a) => {
      if (seen.has(a)) return false;
      seen.add(a);
      return true;
    })
    .slice(0, 30);
}

function sanitizeMeta(meta = {}) {
  const aliases = normalizeAliases(meta.aliases);
  const priority = MANUAL_PRIORITIES.includes(meta.priority) ? meta.priority : "medium";
  const manualCategory = MANUAL_CATEGORIES.includes(meta.manualCategory) ? meta.manualCategory : "other";
  const pin = Boolean(meta.pin);
  const notes = String(meta.notes || "").slice(0, 600);
  const colorTag = meta.colorTag ? String(meta.colorTag).slice(0, 60) : "";

  if (!aliases.length && !pin && manualCategory === "other" && !notes && !colorTag && priority === "medium") {
    return undefined;
  }

  return {
    aliases,
    priority,
    pin,
    manualCategory,
    notes,
    ...(colorTag ? { colorTag } : {}),
  };
}

function isValidDateOnly(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}

function isValidTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function sanitizeFeedbackStats(stats = {}) {
  const likes = Math.max(0, Number(stats.likes) || 0);
  const dislikes = Math.max(0, Number(stats.dislikes) || 0);
  return {
    likes,
    dislikes,
    netScore: likes - dislikes,
    lastFeedbackAt: isValidTimestamp(stats.lastFeedbackAt) ? stats.lastFeedbackAt : null,
  };
}

function sanitizeActivationLearning(learning = {}) {
  return {
    usefulCount: Math.max(0, Number(learning.usefulCount) || 0),
    falsePositiveCount: Math.max(0, Number(learning.falsePositiveCount) || 0),
  };
}

function sanitizeEvolution(evolution = {}) {
  if (!evolution || typeof evolution !== "object") return undefined;
  const normalizeHistory = (items) => (Array.isArray(items) ? items.slice(-60) : []);
  return {
    enabled: evolution.enabled !== false,
    usageCount: Math.max(0, Number(evolution.usageCount) || 0),
    successfulActivations: Math.max(0, Number(evolution.successfulActivations) || 0),
    failedActivations: Math.max(0, Number(evolution.failedActivations) || 0),
    falsePositiveCount: Math.max(0, Number(evolution.falsePositiveCount) || 0),
    finalSelectionCount: Math.max(0, Number(evolution.finalSelectionCount) || 0),
    likeCount: Math.max(0, Number(evolution.likeCount) || 0),
    dislikeCount: Math.max(0, Number(evolution.dislikeCount) || 0),
    lastUsedAt: isValidTimestamp(evolution.lastUsedAt) ? evolution.lastUsedAt : null,
    lastEvolvedAt: isValidTimestamp(evolution.lastEvolvedAt) ? evolution.lastEvolvedAt : null,
    recentUsage: normalizeHistory(evolution.recentUsage),
    triggerCandidates: normalizeHistory(evolution.triggerCandidates),
    triggerHistory: normalizeHistory(evolution.triggerHistory),
    summaryHistory: normalizeHistory(evolution.summaryHistory),
    weightHistory: normalizeHistory(evolution.weightHistory),
    connectionHistory: normalizeHistory(evolution.connectionHistory),
    summarySuggestion: evolution.summarySuggestion || null,
    connectionSuggestions: normalizeHistory(evolution.connectionSuggestions),
  };
}

function inferTemporalSource(data = {}) {
  if (data.temporal?.source) return data.temporal.source;
  const kind = data.source?.kind;
  if (kind === "manual") return "manual";
  if (kind === "import") return "batch_import";
  if (kind === "ai" || kind === "system" || kind === "assistant" || kind === "auto") return "generated";
  return "unknown";
}

export function validateTemporalMeta(temporal) {
  const errs = [];
  if (temporal == null) return errs;
  if (!temporal || typeof temporal !== "object") return ["temporal inválido"];
  if (temporal.date != null && !isValidDateOnly(temporal.date)) errs.push("temporal.date inválido");
  if (temporal.timestamp != null && !isValidTimestamp(temporal.timestamp)) errs.push("temporal.timestamp inválido");
  if (temporal.timeContext != null && !TEMPORAL_CONTEXTS.includes(temporal.timeContext)) errs.push("temporal.timeContext inválido");
  if (temporal.isHistorical != null && typeof temporal.isHistorical !== "boolean") errs.push("temporal.isHistorical inválido");
  if (temporal.isPast != null && typeof temporal.isPast !== "boolean") errs.push("temporal.isPast inválido");
  if (temporal.stage != null && typeof temporal.stage !== "string") errs.push("temporal.stage inválido");
  if (temporal.source != null && !TEMPORAL_SOURCES.includes(temporal.source)) errs.push("temporal.source inválido");
  if (temporal.confidence != null && !TEMPORAL_CONFIDENCE.includes(temporal.confidence)) errs.push("temporal.confidence inválido");
  if (temporal.recencyWeight != null && typeof temporal.recencyWeight !== "number") errs.push("temporal.recencyWeight inválido");
  if (temporal.sourcePeriod != null) {
    if (!temporal.sourcePeriod || typeof temporal.sourcePeriod !== "object") errs.push("temporal.sourcePeriod inválido");
    else {
      if (temporal.sourcePeriod.start != null && !isValidDateOnly(temporal.sourcePeriod.start)) errs.push("temporal.sourcePeriod.start inválido");
      if (temporal.sourcePeriod.end != null && !isValidDateOnly(temporal.sourcePeriod.end)) errs.push("temporal.sourcePeriod.end inválido");
    }
  }
  return errs;
}

export function sanitizeTemporalMeta(input = {}, options = {}) {
  return normalizeTemporalMeta(input, options);
}

/**
 * Crea una neurona con valores por defecto, mezclando el objeto dado.
 * @param {Partial<Neuron>} data
 * @returns {Neuron}
 */
export function createNeuron(data = {}) {
  const now = new Date().toISOString();
  const sanitizedMeta = sanitizeMeta(data.meta || {});
  const sanitizedTemporal = sanitizeTemporalMeta(
    { ...(data.temporal || {}), source: data.temporal?.source || inferTemporalSource(data) },
  );
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
    feedbackStats: sanitizeFeedbackStats(data.feedbackStats || {}),
    activationLearning: sanitizeActivationLearning(data.activationLearning || {}),
    evolution: sanitizeEvolution(data.evolution || {}) || sanitizeEvolution({}),
    ...(sanitizedMeta ? { meta: sanitizedMeta } : {}),
    ...(sanitizedTemporal ? { temporal: sanitizedTemporal } : {}),
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
  if (typeof n.weight !== "number")             errs.push("weight inválido");
  if (!Array.isArray(n.evidence))               errs.push("evidence no es array");
  if (!Array.isArray(n.embedding))              errs.push("embedding no es array");
  if (!n.feedbackStats || typeof n.feedbackStats !== "object") errs.push("feedbackStats inválido");
  else {
    if (typeof n.feedbackStats.likes !== "number") errs.push("feedbackStats.likes inválido");
    if (typeof n.feedbackStats.dislikes !== "number") errs.push("feedbackStats.dislikes inválido");
    if (typeof n.feedbackStats.netScore !== "number") errs.push("feedbackStats.netScore inválido");
    if (n.feedbackStats.lastFeedbackAt != null && !isValidTimestamp(n.feedbackStats.lastFeedbackAt)) errs.push("feedbackStats.lastFeedbackAt inválido");
  }
  if (!n.activationLearning || typeof n.activationLearning !== "object") errs.push("activationLearning inválido");
  else {
    if (typeof n.activationLearning.usefulCount !== "number") errs.push("activationLearning.usefulCount inválido");
    if (typeof n.activationLearning.falsePositiveCount !== "number") errs.push("activationLearning.falsePositiveCount inválido");
  }
  if (n.evolution != null) {
    if (!n.evolution || typeof n.evolution !== "object") errs.push("evolution inválido");
    else {
      if (typeof n.evolution.usageCount !== "number") errs.push("evolution.usageCount inválido");
      if (typeof n.evolution.successfulActivations !== "number") errs.push("evolution.successfulActivations inválido");
      if (typeof n.evolution.failedActivations !== "number") errs.push("evolution.failedActivations inválido");
      if (n.evolution.lastUsedAt != null && !isValidTimestamp(n.evolution.lastUsedAt)) errs.push("evolution.lastUsedAt inválido");
      if (n.evolution.lastEvolvedAt != null && !isValidTimestamp(n.evolution.lastEvolvedAt)) errs.push("evolution.lastEvolvedAt inválido");
      if (!Array.isArray(n.evolution.triggerHistory)) errs.push("evolution.triggerHistory inválido");
      if (!Array.isArray(n.evolution.weightHistory)) errs.push("evolution.weightHistory inválido");
    }
  }

  if (n.source && typeof n.source === "object") {
    if (n.source.kind != null && typeof n.source.kind !== "string") errs.push("source.kind inválido");
    if (n.source.ref != null && typeof n.source.ref !== "string") errs.push("source.ref inválido");
  }

  if (n.meta != null) {
    if (!n.meta || typeof n.meta !== "object") {
      errs.push("meta inválido");
    } else {
      if (n.meta.aliases != null && !Array.isArray(n.meta.aliases)) errs.push("meta.aliases inválido");
      if (Array.isArray(n.meta.aliases) && n.meta.aliases.some((a) => typeof a !== "string")) errs.push("meta.aliases debe contener strings");
      if (n.meta.priority != null && !MANUAL_PRIORITIES.includes(n.meta.priority)) errs.push("meta.priority inválido");
      if (n.meta.pin != null && typeof n.meta.pin !== "boolean") errs.push("meta.pin inválido");
      if (n.meta.manualCategory != null && !MANUAL_CATEGORIES.includes(n.meta.manualCategory)) errs.push("meta.manualCategory inválido");
    }
  }
  if (n.temporal != null) errs.push(...validateTemporalMeta(n.temporal));
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
  n.feedbackStats = sanitizeFeedbackStats(raw.feedbackStats || n.feedbackStats || {});
  n.activationLearning = sanitizeActivationLearning(raw.activationLearning || n.activationLearning || {});
  n.evolution = sanitizeEvolution(raw.evolution || n.evolution || {}) || sanitizeEvolution({});

  const sanitizedMeta = sanitizeMeta(raw.meta || n.meta || {});
  if (sanitizedMeta) n.meta = sanitizedMeta;
  else delete n.meta;
  const sanitizedTemporal = sanitizeTemporalMeta({
    ...(raw.temporal || n.temporal || {}),
    source: raw.temporal?.source || n.temporal?.source || inferTemporalSource(raw) || inferTemporalSource(n),
  });
  if (sanitizedTemporal) n.temporal = sanitizedTemporal;
  else delete n.temporal;

  return n;
}

/** Genera un ID simple usando tiempo + random */
export function generateId() {
  return `nrn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
