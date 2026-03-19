/**
 * historicalImport.js — Importación batch de diarios/autobiografía con capa temporal
 */
import { getAllNeurons, saveManyNeurons, updateNeuron } from "./neuronStore.js";
import { createNeuron, sanitizeNeuron } from "./schemas.js";
import { dedupeGeneratedNeurons } from "./dedup.js";
import { normalizeTemporalMeta } from "./temporal.js";

const DEFAULT_BATCH_SIZE = 25;

function tokenize(text) {
  return String(text || "").split(/[.!?\n]+/).map((x) => x.trim()).filter((x) => x.length > 8);
}

export function inferStageFromEntry(entry = {}, _options = {}) {
  if (entry.stage) return String(entry.stage).trim();
  if (entry.approximatePeriod) return String(entry.approximatePeriod).trim();
  const text = String(entry.text || "").toLowerCase();
  if (text.includes("cuando era niño") || text.includes("infancia")) return "infancia";
  if (text.includes("adolescencia") || text.includes("secundaria")) return "adolescencia";
  if (text.includes("universidad") || text.includes("facultad")) return "universidad";
  if (text.includes("trabajo")) return "trabajo_actual";
  return "";
}

function inferDomainFromText(text = "") {
  const t = String(text).toLowerCase();
  if (/(trabajo|equipo|proyecto|entrega)/.test(t)) return "work";
  if (/(pareja|familia|amigo|relación)/.test(t)) return "relationships";
  if (/(ansiedad|miedo|triste|alegr)/.test(t)) return "emocional";
  return "personal";
}

export function createHistoricalNeuronsFromEntry(entry = {}, options = {}) {
  const chunks = tokenize(entry.text || "").slice(0, options.maxNeuronsPerEntry || 4);
  return chunks.map((chunk, idx) => createNeuron({
    type: entry.mode === "autobiography" ? "memory" : "event",
    core: {
      concept: chunk.split(/\s+/).slice(0, 5).join(" ").slice(0, 60),
      domain: inferDomainFromText(chunk),
      summary: chunk.slice(0, 220),
    },
    triggers: chunk.toLowerCase().split(/[^a-z0-9ñáéíóúü]+/i).filter((x) => x.length >= 4).slice(0, 8),
    source: { kind: "import", ref: entry.source || "historical_import" },
    evidence: [entry.text || ""].filter(Boolean),
    emotion: "neutral",
    weight: 0.55 - Math.min(0.2, idx * 0.03),
  }));
}

export function assignTemporalMetadata(neurons = [], entry = {}, options = {}) {
  const stage = inferStageFromEntry(entry, options) || undefined;
  const baseTemporal = normalizeTemporalMeta({
    date: entry.date,
    timestamp: entry.timestamp,
    timeContext: entry.isHistorical ? "historical" : entry.timeContext,
    stage,
    sourcePeriod: entry.sourcePeriod,
  }, options.temporalOptions || {});

  return neurons.map((n) => sanitizeNeuron({
    ...n,
    temporal: {
      ...baseTemporal,
      ...((!entry.date && !entry.timestamp && stage) ? { timeContext: "historical" } : {}),
      ...(baseTemporal?.timeContext ? {} : { timeContext: stage ? "historical" : "timeless" }),
      ...(entry.date || entry.timestamp ? {} : { isPast: Boolean(stage) }),
    },
  })).filter(Boolean);
}

export function importHistoricalEntries(entries = [], options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
  const allExisting = getAllNeurons();

  let created = 0;
  let merged = 0;
  let discarded = 0;
  const imported = [];

  for (let i = 0; i < list.length; i += batchSize) {
    const chunk = list.slice(i, i + batchSize);
    const generated = chunk.flatMap((entry) => {
      const neurons = createHistoricalNeuronsFromEntry(entry, options);
      return assignTemporalMetadata(neurons, entry, options);
    });

    const dedupe = dedupeGeneratedNeurons(generated, [...allExisting, ...imported]);
    if (dedupe.toSave.length) {
      saveManyNeurons(dedupe.toSave);
      imported.push(...dedupe.toSave);
      created += dedupe.toSave.length;
    }
    for (const m of dedupe.toMerge) {
      updateNeuron(m.targetId, m.mergedNeuron);
    }
    merged += dedupe.toMerge.length;
    discarded += dedupe.discarded.length;
  }

  const allTemporal = imported.map((n) => n.temporal).filter(Boolean);
  const dates = allTemporal.map((t) => t?.date).filter(Boolean).sort();
  return {
    created,
    merged,
    discarded,
    importedCount: imported.length,
    temporalRange: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null,
  };
}
