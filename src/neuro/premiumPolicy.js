/**
 * premiumPolicy.js — Política de uso de generación premium
 */

import { classifyInputValue } from "./valueClassifier.js";
import { getPremiumUsageState } from "./premiumUsage.js";
import { getBootstrapState } from "./bootstrap.js";

const DEFAULT_COOLDOWN_TURNS = 2;
const COVERAGE_THRESHOLD_FOR_PREMIUM = 0.55;

function normalizeMode(mode) {
  const m = String(mode || "chat").toLowerCase();
  return ["chat", "journal", "autobiography", "exercise"].includes(m) ? m : "chat";
}

function hasRecentPremium(history, cooldownTurns) {
  if (cooldownTurns <= 0 || !history?.length) return false;
  return history.slice(-cooldownTurns).some((m) => m.premiumUsed === true);
}

function hasPersonalStrongSignals(signals = {}) {
  return Boolean(
    signals.hasEmotionSituationThoughtStructure
    || signals.hasLearningReflection
    || signals.appearsJournalLike
    || signals.appearsAutobiographical
    || signals.hasSelfNarrative
    || signals.mentionsPastOrMemory
    || signals.mentionsPersonalGrowth
  );
}

function isTrivial(signals = {}) {
  return Boolean(signals.isGreeting || signals.isConfirmation || signals.isShortUtilityMessage || signals.isLogisticsQuestion);
}

function formatPolicyReason(code, details = "") {
  const map = {
    daily_limit_reached: "calls reservadas por policy",
    trivial_input: "input trivial o utilitario",
    cooldown_active: "cooldown activo",
    low_value_input: "input medium sin suficiente señal",
    enough_coverage: "coverage parcial pero no crítico",
    bootstrap_conditions: "condiciones bootstrap insuficientes",
  };
  const label = map[code] || code;
  return details ? `${label} (${details})` : label;
}

export function shouldUsePremiumGeneration({
  userInput,
  activated = [],
  missingAnalysis = {},
  history = [],
  mode = "chat",
  totalNeurons = 0,
  options = {},
}) {
  const reasons = [];
  const activeMode = normalizeMode(mode);
  const bootstrapState = options.bootstrapState || getBootstrapState(totalNeurons, options.bootstrapOptions);
  const usageState = getPremiumUsageState({ bootstrapState });
  const coverage = typeof missingAnalysis.coverage === "number" ? missingAnalysis.coverage : 0;

  const classifier = classifyInputValue(userInput, {
    ...options,
    mode: activeMode,
    bootstrapState,
  });

  const personalSignals = hasPersonalStrongSignals(classifier.signals);
  const trivial = isTrivial(classifier.signals);

  if (!usageState.canUse) {
    return {
      usePremium: false,
      rulePath: bootstrapState.enabled ? `bootstrap_${bootstrapState.level}` : "normal",
      reasons: [formatPolicyReason("daily_limit_reached", `${usageState.used}/${usageState.limit}`)],
      reasonCode: "daily_limit_reached",
      classifier,
      usageState,
      bootstrapState,
      mode: activeMode,
    };
  }

  if (trivial) {
    return {
      usePremium: false,
      rulePath: bootstrapState.enabled ? `bootstrap_${bootstrapState.level}` : "normal",
      reasons: [formatPolicyReason("trivial_input")],
      reasonCode: "trivial_input",
      classifier,
      usageState,
      bootstrapState,
      mode: activeMode,
    };
  }

  if (bootstrapState.level === "strong") {
    const strongCoverageThreshold = options.bootstrapStrongCoverageThreshold ?? 0.40;
    const strongCooldown = options.bootstrapStrongCooldownTurns ?? 0;

    if (coverage >= strongCoverageThreshold) reasons.push(`coverage ${Math.round(coverage * 100)}% >= ${Math.round(strongCoverageThreshold * 100)}%`);
    if (!["medium", "high"].includes(classifier.label)) reasons.push(`label ${classifier.label} no permitido en bootstrap strong`);
    if (!personalSignals && activeMode === "chat") reasons.push("faltan señales personales fuertes");
    if (hasRecentPremium(history, strongCooldown)) reasons.push(`cooldown activo (${strongCooldown} turnos)`);

    const allowed = coverage < strongCoverageThreshold
      && ["medium", "high"].includes(classifier.label)
      && (personalSignals || ["journal", "autobiography", "exercise"].includes(activeMode))
      && !hasRecentPremium(history, strongCooldown);

    if (allowed) {
      return {
        usePremium: true,
        rulePath: "bootstrap_strong",
        reasons: [
          `bootstrap mode activo: ${bootstrapState.totalNeurons} neuronas`,
          `coverage bajo (${Math.round(coverage * 100)}%)`,
          `input ${classifier.label} permitido en bootstrap`,
          personalSignals ? "señales personales/reflexivas detectadas" : `prioridad por modo ${activeMode}`,
          `calls restantes hoy: ${usageState.remaining}`,
        ],
        classifier,
        reasonCode: "allowed_bootstrap_strong",
        usageState,
        bootstrapState,
        mode: activeMode,
      };
    }

    return {
      usePremium: false,
      rulePath: "bootstrap_strong",
      reasons: reasons.length ? reasons.map((r) => formatPolicyReason("bootstrap_conditions", r)) : [formatPolicyReason("bootstrap_conditions")],
      reasonCode: "bootstrap_conditions",
      classifier,
      usageState,
      bootstrapState,
      mode: activeMode,
    };
  }

  if (bootstrapState.level === "normal") {
    const normalCoverageThreshold = options.bootstrapNormalCoverageThreshold ?? 0.30;
    const normalCooldown = options.bootstrapNormalCooldownTurns ?? 1;
    const mediumAllowed = classifier.label === "medium"
      && (classifier.signals.appearsAutobiographical || classifier.signals.appearsJournalLike || ["journal", "autobiography", "exercise"].includes(activeMode));

    if (coverage >= normalCoverageThreshold) reasons.push(`coverage ${Math.round(coverage * 100)}% >= ${Math.round(normalCoverageThreshold * 100)}%`);
    if (!(classifier.label === "high" || mediumAllowed)) reasons.push("bootstrap normal requiere high o medium personal");
    if (hasRecentPremium(history, normalCooldown)) reasons.push(`cooldown activo (${normalCooldown} turnos)`);

    const allowed = coverage < normalCoverageThreshold
      && (classifier.label === "high" || mediumAllowed)
      && !hasRecentPremium(history, normalCooldown);

    return {
      usePremium: allowed,
      rulePath: "bootstrap_normal",
      reasons: allowed
        ? [
            `bootstrap mode activo: ${bootstrapState.totalNeurons} neuronas`,
            `coverage bajo (${Math.round(coverage * 100)}%)`,
            classifier.label === "high" ? "input high permitido" : "input medium personal permitido",
            `calls restantes hoy: ${usageState.remaining}`,
          ]
        : (reasons.length ? reasons.map((r) => formatPolicyReason("bootstrap_conditions", r)) : [formatPolicyReason("bootstrap_conditions")]),
      reasonCode: allowed ? "allowed_bootstrap_normal" : "bootstrap_conditions",
      classifier,
      usageState,
      bootstrapState,
      mode: activeMode,
    };
  }

  const cooldownTurns = options.cooldownTurns ?? DEFAULT_COOLDOWN_TURNS;
  const coverageThreshold = options.coverageThreshold ?? COVERAGE_THRESHOLD_FOR_PREMIUM;

  if (coverage >= coverageThreshold) {
    reasons.push(formatPolicyReason("enough_coverage", `${Math.round(coverage * 100)}%`));
    return { usePremium: false, rulePath: "normal", reasons, classifier, usageState, bootstrapState, mode: activeMode, reasonCode: "enough_coverage" };
  }

  if (classifier.label !== "high") {
    reasons.push(formatPolicyReason("low_value_input", `label ${classifier.label}`));
    return { usePremium: false, rulePath: "normal", reasons, classifier, usageState, bootstrapState, mode: activeMode, reasonCode: "low_value_input" };
  }

  if (hasRecentPremium(history, cooldownTurns)) {
    reasons.push(formatPolicyReason("cooldown_active", `${cooldownTurns} turnos`));
    return { usePremium: false, rulePath: "normal", reasons, classifier, usageState, bootstrapState, mode: activeMode, reasonCode: "cooldown_active" };
  }

  reasons.push(`cobertura baja (${Math.round(coverage * 100)}%)`);
  reasons.push("input de alto valor");
  reasons.push(`calls restantes hoy: ${usageState.remaining}`);

  return { usePremium: true, rulePath: "normal", reasons, classifier, usageState, bootstrapState, mode: activeMode, reasonCode: "allowed_normal" };
}
