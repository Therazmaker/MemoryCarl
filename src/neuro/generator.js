/**
 * generator.js — Generación de neuronas faltantes via NeuroClaw
 * NeuroChat / MemoryCarl
 *
 * Este módulo detecta huecos en el conocimiento y genera nuevas neuronas
 * llamando al backend NeuroClaw (que a su vez usa Gemini).
 */

import { tokenize, neuronTokenSet } from "./utils.js";
import { requestNeuronGeneration } from "../services/neuroclawClient.js";
import { sanitizeNeuron } from "./schemas.js";

// Umbral de coverage por debajo del cual se activa la generación
const LOW_COVERAGE_THRESHOLD = 0.45;
// Mínimo de neuronas activadas para considerar cobertura suficiente
const MIN_ACTIVATED_FOR_COVERAGE = 3;

// ---- Detección de huecos ----

/**
 * Detecta conceptos faltantes dado el input y las neuronas activadas.
 *
 * @param {string} userInput
 * @param {ActivatedNeuron[]} activatedNeurons
 * @returns {MissingConceptsResult}
 */
export function detectMissingConcepts(userInput, activatedNeurons) {
  const queryTokens = tokenize(userInput);
  const reasons = [];
  let coverage = 0;

  if (!activatedNeurons.length) {
    reasons.push("sin neuronas activadas");
  } else {
    // Tokens cubiertos por las neuronas activadas
    const coveredTokens = new Set();
    for (const { neuron } of activatedNeurons) {
      for (const tok of neuronTokenSet(neuron)) coveredTokens.add(tok);
    }
    const covered = queryTokens.filter((t) => coveredTokens.has(t)).length;
    coverage = queryTokens.length ? covered / queryTokens.length : 0;

    if (activatedNeurons.length < MIN_ACTIVATED_FOR_COVERAGE) {
      reasons.push("pocas neuronas activadas");
    }
    if (coverage < LOW_COVERAGE_THRESHOLD) {
      reasons.push(`cobertura de tokens baja (${Math.round(coverage * 100)}%)`);
    }
    // Score promedio bajo
    const avgScore = activatedNeurons.reduce((s, r) => s + r.score, 0) / activatedNeurons.length;
    if (avgScore < 0.30) {
      reasons.push("scores de activación bajos");
    }
  }

  // Tokens del input no cubiertos por ningún trigger/concept
  const allCovered = new Set();
  for (const { neuron } of activatedNeurons) {
    for (const tok of neuronTokenSet(neuron)) allCovered.add(tok);
  }
  const missing = queryTokens.filter((t) => !allCovered.has(t) && t.length > 3);
  const missingConcepts = [...new Set(missing)].slice(0, 10);

  const needsGeneration = reasons.length > 0 || coverage < LOW_COVERAGE_THRESHOLD;

  return {
    coverage: Math.round(coverage * 100) / 100,
    missingConcepts,
    reasons,
    needsGeneration,
  };
}

// ---- Generación ----

/**
 * Genera nuevas neuronas a través de NeuroClaw si la cobertura es insuficiente.
 *
 * @param {{ userInput: string, activatedNeurons: ActivatedNeuron[], missingAnalysis: MissingConceptsResult }} params
 * @returns {Promise<Neuron[]>} neuronas nuevas (ya sanitizadas)
 */
export async function generateMissingNeurons({ userInput, activatedNeurons, missingAnalysis }) {
  if (!missingAnalysis.needsGeneration) return [];

  const payload = {
    userInput,
    activatedNeurons: activatedNeurons.slice(0, 5).map(({ neuron, score }) => ({
      id:      neuron.id,
      type:    neuron.type,
      concept: neuron.core.concept,
      domain:  neuron.core.domain,
      summary: neuron.core.summary,
      score,
    })),
    missingConcepts: missingAnalysis.missingConcepts,
    coverage:        missingAnalysis.coverage,
    reasons:         missingAnalysis.reasons,
  };

  let raw = null;
  try {
    raw = await requestNeuronGeneration(payload);
  } catch (err) {
    console.warn("[generator] Error al generar neuronas:", err);
    return [];
  }

  if (!raw || !Array.isArray(raw)) return [];

  // Sanitizar y filtrar neuronas válidas
  const generated = raw
    .map((r) => {
      try {
        return sanitizeNeuron({
          ...r,
          source: { kind: "generated", ref: "neuroclaw" },
        });
      } catch (_e) {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, 10); // máximo 10 neuronas nuevas por llamada

  return generated;
}
