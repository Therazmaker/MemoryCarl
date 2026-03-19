/**
 * premiumPolicy.js — Política de uso de generación premium
 * NeuroChat / MemoryCarl
 *
 * Decide si vale la pena usar una llamada premium de aprendizaje para
 * un determinado input y estado del sistema.
 *
 * TODO (integración futura de API premium):
 *   1. En neurocore.js, cuando usePremium=true, llamar a generateMissingNeuronsPremium()
 *      en lugar de generateMissingNeurons().
 *   2. Implementar generateMissingNeuronsPremium() en generator.js apuntando
 *      al endpoint de la API premium (p.ej. GPT-4 / Claude API).
 *   3. Pasar la API key vía configuración de entorno o ajustes de NeuroClaw.
 *   4. Registrar el uso con incrementPremiumUsage() DESPUÉS de la llamada exitosa.
 */

import { classifyInputValue } from "./valueClassifier.js";
import { canUsePremiumCall, getPremiumUsageState } from "./premiumUsage.js";

// Cooldown: no usar premium si se usó en los últimos N mensajes
const DEFAULT_COOLDOWN_TURNS = 2;

// Cobertura mínima requerida para que el sistema justifique premium
// (si la cobertura ya es alta, no hace falta)
const COVERAGE_THRESHOLD_FOR_PREMIUM = 0.55;

/**
 * Decide si se debe usar generación premium para el input y contexto actuales.
 *
 * @param {{
 *   userInput: string,
 *   activated: ActivatedNeuron[],
 *   missingAnalysis: MissingConceptsResult,
 *   history?: Array<{ role: string, premiumUsed?: boolean }>,
 *   options?: {
 *     cooldownTurns?: number,
 *     coverageThreshold?: number,
 *     valueThreshold?: number,
 *   }
 * }} params
 * @returns {{
 *   usePremium: boolean,
 *   reasons: string[],
 *   classifier: object,
 *   usageState: object
 * }}
 */
export function shouldUsePremiumGeneration({
  userInput,
  activated = [],
  missingAnalysis = {},
  history = [],
  options = {},
}) {
  const reasons = [];
  const cooldownTurns     = options.cooldownTurns     ?? DEFAULT_COOLDOWN_TURNS;
  const coverageThreshold = options.coverageThreshold ?? COVERAGE_THRESHOLD_FOR_PREMIUM;

  // ---- 1. Clasificar el input ----
  const classifier   = classifyInputValue(userInput, options);
  const usageState   = getPremiumUsageState();
  const inputIsHigh  = classifier.label === "high";

  // ---- 2. Verificar condiciones de bloqueo ----

  // Cobertura suficiente → no hace falta premium
  const coverage = typeof missingAnalysis.coverage === "number" ? missingAnalysis.coverage : 0;
  if (coverage >= coverageThreshold) {
    reasons.push(`cobertura suficiente (${Math.round(coverage * 100)}%) → no requiere premium`);
    return { usePremium: false, reasons, classifier, usageState };
  }

  // Input de bajo valor → no merece gastar call
  if (!inputIsHigh) {
    reasons.push(`input de valor ${classifier.label} → no merece premium`);
    return { usePremium: false, reasons, classifier, usageState };
  }

  // Sin calls disponibles hoy
  if (!usageState.canUse) {
    reasons.push(`límite diario alcanzado (${usageState.used}/${usageState.limit})`);
    return { usePremium: false, reasons, classifier, usageState };
  }

  // Cooldown: ¿se usó premium recientemente?
  if (cooldownTurns > 0 && history.length > 0) {
    const recent = history.slice(-cooldownTurns);
    const recentPremium = recent.filter((m) => m.premiumUsed === true).length;
    if (recentPremium > 0) {
      reasons.push(`cooldown activo: premium usado en los últimos ${cooldownTurns} turnos`);
      return { usePremium: false, reasons, classifier, usageState };
    }
  }

  // ---- 3. Todas las condiciones positivas cumplidas ----
  reasons.push(`cobertura baja (${Math.round(coverage * 100)}%)`);
  reasons.push(`input de alto valor`);
  reasons.push(`calls restantes hoy: ${usageState.remaining}`);
  if (classifier.reasons.length) {
    reasons.push(...classifier.reasons.slice(0, 3));
  }

  return { usePremium: true, reasons, classifier, usageState };
}
