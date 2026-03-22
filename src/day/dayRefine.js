/**
 * dayRefine.js — Aplicación de refinamientos Gemini al Daily Memory Engine
 * MemoryCarl
 *
 * Exporta:
 *   validateDayRefinement(refinement)
 *   previewDayRefinement(dayId, refinement)
 *   applyDayRefinement(dayId, refinement, options?)
 */

import { getAllDays, updateDay, getMemoriesForDay } from "./dayStore.js";
import { getAllNeurons, saveNeuron, deleteNeuron } from "../neuro/neuronStore.js";
import { createNeuron } from "../neuro/schemas.js";

// ---- Validación ----

/**
 * Valida el objeto de refinamiento devuelto por Gemini.
 * Retorna { valid: true } o { valid: false, errors: string[] }.
 *
 * @param {any} refinement
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateDayRefinement(refinement) {
  if (!refinement || typeof refinement !== "object") {
    return { valid: false, errors: ["refinement debe ser un objeto"] };
  }

  const errors = [];

  if (refinement.improvedSummary !== undefined && typeof refinement.improvedSummary !== "string") {
    errors.push("improvedSummary debe ser string");
  }
  if (refinement.correctedEmotion !== undefined && typeof refinement.correctedEmotion !== "string") {
    errors.push("correctedEmotion debe ser string");
  }
  if (refinement.refinedThemes !== undefined && !Array.isArray(refinement.refinedThemes)) {
    errors.push("refinedThemes debe ser array");
  }
  if (refinement.insights !== undefined && !Array.isArray(refinement.insights)) {
    errors.push("insights debe ser array");
  }
  if (refinement.memorySuggestions !== undefined) {
    if (!Array.isArray(refinement.memorySuggestions)) {
      errors.push("memorySuggestions debe ser array");
    } else {
      for (const [i, sug] of refinement.memorySuggestions.entries()) {
        if (!sug || typeof sug !== "object") {
          errors.push(`memorySuggestions[${i}] debe ser un objeto`);
        } else {
          if (typeof sug.title !== "string" || !sug.title) {
            errors.push(`memorySuggestions[${i}].title debe ser string no vacío`);
          }
          if (typeof sug.text !== "string" || !sug.text) {
            errors.push(`memorySuggestions[${i}].text debe ser string no vacío`);
          }
          if (sug.importance !== undefined && !["high", "medium", "low"].includes(sug.importance)) {
            errors.push(`memorySuggestions[${i}].importance debe ser 'high', 'medium' o 'low'`);
          }
        }
      }
    }
  }

  // Validar neuronAdjustments
  if (refinement.neuronAdjustments !== undefined) {
    const adj = refinement.neuronAdjustments;
    if (typeof adj !== "object" || adj === null || Array.isArray(adj)) {
      errors.push("neuronAdjustments debe ser un objeto");
    } else {
      if (adj.create !== undefined && !Array.isArray(adj.create)) {
        errors.push("neuronAdjustments.create debe ser array");
      }
      if (adj.update !== undefined && !Array.isArray(adj.update)) {
        errors.push("neuronAdjustments.update debe ser array");
      }
      if (adj.merge !== undefined && !Array.isArray(adj.merge)) {
        errors.push("neuronAdjustments.merge debe ser array");
      }
      if (adj.remove !== undefined && !Array.isArray(adj.remove)) {
        errors.push("neuronAdjustments.remove debe ser array");
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ---- Preview ----

/**
 * Genera una preview del refinamiento sin aplicarlo.
 * Retorna un objeto con los cambios que se aplicarían.
 *
 * @param {string} dayId
 * @param {object} refinement
 * @returns {object|null}
 */
export function previewDayRefinement(dayId, refinement) {
  if (!dayId || !refinement) return null;

  const validation = validateDayRefinement(refinement);
  if (!validation.valid) return { valid: false, errors: validation.errors };

  const days = getAllDays();
  const day = days.find((d) => d.id === dayId);
  if (!day) return null;

  const preview = {
    dayId,
    valid: true,
    changes: {
      summary: refinement.improvedSummary !== undefined
        ? { from: day.summary, to: String(refinement.improvedSummary) }
        : null,
      dominantEmotion: refinement.correctedEmotion !== undefined
        ? { from: day.dominantEmotion, to: String(refinement.correctedEmotion) }
        : null,
      dominantThemes: Array.isArray(refinement.refinedThemes)
        ? { from: day.dominantThemes, to: refinement.refinedThemes.map(String) }
        : null,
      insights: Array.isArray(refinement.insights)
        ? { from: day.insights, to: refinement.insights.map(String) }
        : null,
    },
    neuronAdjustments: refinement.neuronAdjustments
      ? _previewNeuronAdjustments(refinement.neuronAdjustments)
      : null,
    memorySuggestions: Array.isArray(refinement.memorySuggestions)
      ? refinement.memorySuggestions.length
      : null,
  };

  return preview;
}

function _previewNeuronAdjustments(adj) {
  if (!adj || typeof adj !== "object") return null;
  const neurons = getAllNeurons();
  return {
    create: Array.isArray(adj.create) ? adj.create.length : 0,
    update: Array.isArray(adj.update)
      ? adj.update.filter((u) => u?.id && neurons.some((n) => n.id === u.id)).length
      : 0,
    merge: Array.isArray(adj.merge)
      ? adj.merge.filter((m) => m?.sourceId && m?.targetId).length
      : 0,
    remove: Array.isArray(adj.remove)
      ? adj.remove.filter((id) => neurons.some((n) => n.id === id)).length
      : 0,
  };
}

// ---- Apply ----

/**
 * Aplica el refinamiento de Gemini al día indicado.
 *
 * options: {
 *   skipNeurons?: boolean,    — no aplicar cambios de neuronas
 *   skipMemories?: boolean,   — no crear memorias sugeridas
 * }
 *
 * Retorna el día actualizado, o null si el dayId no existe.
 * No lanza excepciones — retorna el estado anterior si algo falla.
 *
 * @param {string} dayId
 * @param {object} refinement
 * @param {object} [options]
 * @returns {object|null}
 */
export function applyDayRefinement(dayId, refinement, options = {}) {
  if (!dayId || !refinement) return null;

  // Pre-normalize memorySuggestions to make apply resilient to AI output:
  // filter out invalid items and normalize importance before strict validation.
  let normalized = refinement;
  if (Array.isArray(refinement.memorySuggestions)) {
    const cleanedSuggestions = refinement.memorySuggestions
      .filter(_isValidMemorySuggestionItem)
      .map((s) => ({
        ...s,
        importance: ["high", "medium", "low"].includes(s.importance) ? s.importance : "medium",
      }));
    normalized = { ...refinement, memorySuggestions: cleanedSuggestions };
  }

  // Validar con el refinement normalizado
  const validation = validateDayRefinement(normalized);
  if (!validation.valid) {
    console.warn("[dayRefine] refinement inválido:", validation.errors);
    return null;
  }

  const days = getAllDays();
  const day = days.find((d) => d.id === dayId);
  if (!day) return null;

  try {
    const updated = { ...day };

    if (typeof normalized.improvedSummary === "string" && normalized.improvedSummary) {
      updated.summary = normalized.improvedSummary;
    }
    if (typeof normalized.correctedEmotion === "string" && normalized.correctedEmotion) {
      updated.dominantEmotion = normalized.correctedEmotion;
    }
    if (Array.isArray(normalized.refinedThemes) && normalized.refinedThemes.length > 0) {
      updated.dominantThemes = normalized.refinedThemes.map(String).filter(Boolean);
    }
    if (Array.isArray(normalized.insights) && normalized.insights.length > 0) {
      updated.insights = normalized.insights.map(String).filter(Boolean);
    }

    updated.geminiProcessed = true;
    updated.geminiLastProcessedAt = new Date().toISOString();

    // Aplicar ajustes de neuronas
    if (!options.skipNeurons && normalized.neuronAdjustments) {
      _applyNeuronAdjustments(normalized.neuronAdjustments, updated);
    }

    // Almacenar sugerencias de memoria en el día (ya pre-normalizadas)
    if (!options.skipMemories && Array.isArray(normalized.memorySuggestions) && normalized.memorySuggestions.length > 0) {
      updated.memorySuggestions = normalized.memorySuggestions;
    }

    return updateDay(updated) || updated;
  } catch (err) {
    console.error("[dayRefine] Error aplicando refinamiento:", err);
    return day;
  }
}

/**
 * Returns true if a memorySuggestion item has the required shape (title + text as non-empty strings).
 */
function _isValidMemorySuggestionItem(s) {
  return (
    s !== null &&
    typeof s === "object" &&
    typeof s.title === "string" && s.title.length > 0 &&
    typeof s.text === "string" && s.text.length > 0
  );
}

/**
 * Aplica los ajustes de neuronas del refinamiento.
 * Muta `updatedDay.linkedNeurons` para reflejar cambios.
 * No lanza — falla silenciosamente por neurona individual.
 *
 * @param {object} adj — neuronAdjustments
 * @param {object} updatedDay — día que está siendo actualizado (mutado in-place)
 */
function _applyNeuronAdjustments(adj, updatedDay) {
  if (!adj || typeof adj !== "object") return;

  const linkedSet = new Set(updatedDay.linkedNeurons || []);

  // CREATE
  if (Array.isArray(adj.create)) {
    for (const spec of adj.create) {
      try {
        if (!spec || typeof spec !== "object") continue;
        const newNeuron = createNeuron(spec);
        const saved = saveNeuron(newNeuron);
        if (saved?.id) linkedSet.add(saved.id);
      } catch (e) {
        console.warn("[dayRefine] Error creando neurona:", e);
      }
    }
  }

  // UPDATE
  if (Array.isArray(adj.update)) {
    const neurons = getAllNeurons();
    for (const item of adj.update) {
      try {
        if (!item?.id || !item?.patch || typeof item.patch !== "object") continue;
        const existing = neurons.find((n) => n.id === item.id);
        if (!existing) continue;
        const patched = _deepMerge(existing, item.patch);
        saveNeuron(patched);
      } catch (e) {
        console.warn("[dayRefine] Error actualizando neurona:", e);
      }
    }
  }

  // MERGE — redirigir linkedNeurons del día al targetId, luego eliminar source
  if (Array.isArray(adj.merge)) {
    for (const item of adj.merge) {
      try {
        if (!item?.sourceId || !item?.targetId) continue;
        if (linkedSet.has(item.sourceId)) {
          linkedSet.delete(item.sourceId);
          linkedSet.add(item.targetId);
        }
        // Eliminar la neurona source
        deleteNeuron(item.sourceId);
      } catch (e) {
        console.warn("[dayRefine] Error en merge de neuronas:", e);
      }
    }
  }

  // REMOVE
  if (Array.isArray(adj.remove)) {
    for (const id of adj.remove) {
      try {
        if (typeof id !== "string" || !id) continue;
        linkedSet.delete(id);
        deleteNeuron(id);
      } catch (e) {
        console.warn("[dayRefine] Error eliminando neurona:", e);
      }
    }
  }

  updatedDay.linkedNeurons = Array.from(linkedSet);
}

/**
 * Returns true if a value is a plain (non-array, non-null) object.
 */
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Merge profundo superficial de dos objetos (solo primer nivel recursivo en `core`).
 */
function _deepMerge(base, patch) {
  const result = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(result[k])) {
      result[k] = { ...result[k], ...v };
    } else {
      result[k] = v;
    }
  }
  return result;
}
