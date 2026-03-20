import { tokenize } from "./utils.js";

const DEFAULT_OPTIONS = {
  coverageThreshold: 0.5,
  minActivated: 2,
  weakScoreThreshold: 0.35,
  weakTriggerCount: 2,
  weakSummaryMinLength: 28,
  weakNegativeFeedbackThreshold: -2,
};

function detectWeakNeuron(entry, options) {
  const neuron = entry?.neuron || entry;
  if (!neuron) return { weak: false, flags: [] };

  const flags = [];
  const triggers = neuron.triggers || [];
  const summary = String(neuron.core?.summary || "").trim();
  const concept = String(neuron.core?.concept || "").trim();
  const aliases = neuron.meta?.aliases || [];
  const score = Number(entry?.score || 0);
  const netScore = Number(neuron.feedbackStats?.netScore || 0);

  if (triggers.length < options.weakTriggerCount) flags.push("few_triggers");
  if (summary.length > 0 && summary.length < options.weakSummaryMinLength) flags.push("short_summary");
  if (netScore <= options.weakNegativeFeedbackThreshold) flags.push("negative_feedback");
  if (score > 0 && score < options.weakScoreThreshold) flags.push("low_activation_score");
  if (concept.split(" ").length <= 2 && aliases.length === 0 && /[A-ZÁÉÍÓÚÑ]/.test(concept)) flags.push("missing_aliases");

  return { weak: flags.length > 0, flags };
}

export function analyzeNeuronCoverageQuality({ input, activated = [], missingAnalysis = {}, insights = [], options = {} }) {
  const cfg = { ...DEFAULT_OPTIONS, ...options };
  const coverage = typeof missingAnalysis.coverage === "number" ? missingAnalysis.coverage : 0;
  const reasons = [];

  if (coverage < cfg.coverageThreshold) reasons.push("low_coverage");
  if (activated.length < cfg.minActivated) reasons.push("weak_activation");

  const weakNeurons = activated
    .map((entry) => ({ entry, check: detectWeakNeuron(entry, cfg) }))
    .filter((x) => x.check.weak)
    .map((x) => ({
      id: x.entry.neuron?.id || x.entry.id,
      concept: x.entry.neuron?.core?.concept || x.entry.core?.concept || "",
      flags: x.check.flags,
      score: Number((x.entry.score || 0).toFixed(3)),
    }));

  if (weakNeurons.length > 0) reasons.push("low_trigger_quality");
  if (coverage > 0 && coverage < 0.75 && (missingAnalysis.missingConcepts || []).length > 0) reasons.push("partial_match");
  if (insights.length === 0 && activated.length === 0) reasons.push("sparse_context");

  return {
    hasSuggestion: reasons.length > 0,
    reason: reasons[0] || null,
    reasons,
    weakNeurons,
    quality: {
      coverage,
      activatedCount: activated.length,
      missingConcepts: (missingAnalysis.missingConcepts || []).length,
    },
  };
}

export function buildNeuronSuggestionDraft({ input, activated = [], missingAnalysis = {}, options = {} }) {
  const tokens = tokenize(input).filter((t) => t.length > 3);
  const topMissing = (missingAnalysis.missingConcepts || []).slice(0, 4);
  const conceptHint = options.conceptHint || topMissing[0] || tokens[0] || "contexto personal";
  const domainHint = options.domainHint || (/(terapia|emoc|psic|ansied|reflex|diario)/i.test(input) ? "personal" : "general");
  const triggerHints = [...new Set([...topMissing, ...tokens.slice(0, 6)])].slice(0, 6);

  return {
    conceptHint,
    domainHint,
    triggerHints,
    summaryHint: options.summaryHint || `Memoria útil sobre ${conceptHint} que aparece en el relato del usuario y ayuda a contextualizar futuras respuestas.`,
    suggestedCategory: options.suggestedCategory || "other",
    sourceReason: options.sourceReason || "El input actual menciona señales con cobertura parcial y neuronas activadas insuficientes.",
  };
}

export function suggestNeuronActions({ input, activated = [], missingAnalysis = {}, options = {} }) {
  const analysis = analyzeNeuronCoverageQuality({ input, activated, missingAnalysis, options });
  if (!analysis.hasSuggestion) {
    return { hasSuggestion: false, reason: null, suggestions: [], reasons: [] };
  }

  const draft = buildNeuronSuggestionDraft({ input, activated, missingAnalysis, options: { sourceReason: analysis.reasons.join(", ") } });
  const suggestions = [
    {
      type: "create_new_neuron",
      label: `Crear neurona puente para ${draft.conceptHint}`,
      conceptHint: draft.conceptHint,
      draft,
    },
  ];

  if (analysis.weakNeurons.length > 0) {
    const target = analysis.weakNeurons[0];
    suggestions.push({
      type: "improve_existing_neuron",
      label: "Mejorar triggers de neurona existente",
      targetNeuronId: target.id,
      draftPatch: {
        triggerHints: draft.triggerHints,
        summaryHint: draft.summaryHint,
        sourceReason: `Neurona con señales débiles: ${target.flags.join(", ")}`,
      },
    });
  }

  return {
    hasSuggestion: true,
    reason: analysis.reason,
    reasons: analysis.reasons,
    suggestions,
    analysis,
  };
}
