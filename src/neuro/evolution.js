import { clamp, tokenize, truncate } from "./utils.js";

const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 1.0;
const MAX_HISTORY = 40;
const DEFAULT_APPROVAL_THRESHOLD = { minFrequency: 2, minScore: 0.55 };

const GENERIC_TOKENS = new Set([
  "yo", "tu", "el", "la", "los", "las", "de", "del", "que", "con", "por", "para", "una", "uno", "esto", "esta", "ese", "esa", "hoy", "ayer", "manana", "ahora", "muy", "algo", "nada", "solo", "si", "no", "me", "te", "se", "mi", "mis", "su", "sus", "un", "en", "es", "fue", "ser", "estar", "tener", "hacer",
]);

function nowIso() {
  return new Date().toISOString();
}

function pushHistory(list, entry, max = MAX_HISTORY) {
  const next = [...(Array.isArray(list) ? list : []), entry];
  return next.slice(-max);
}

export function ensureNeuronEvolution(neuron) {
  if (!neuron || typeof neuron !== "object") return neuron;
  const evo = neuron.evolution || {};
  neuron.evolution = {
    enabled: evo.enabled !== false,
    usageCount: Math.max(0, Number(evo.usageCount) || 0),
    successfulActivations: Math.max(0, Number(evo.successfulActivations) || 0),
    failedActivations: Math.max(0, Number(evo.failedActivations) || 0),
    falsePositiveCount: Math.max(0, Number(evo.falsePositiveCount) || 0),
    finalSelectionCount: Math.max(0, Number(evo.finalSelectionCount) || 0),
    likeCount: Math.max(0, Number(evo.likeCount) || 0),
    dislikeCount: Math.max(0, Number(evo.dislikeCount) || 0),
    lastUsedAt: evo.lastUsedAt || null,
    lastEvolvedAt: evo.lastEvolvedAt || null,
    recentUsage: Array.isArray(evo.recentUsage) ? evo.recentUsage.slice(-12) : [],
    triggerCandidates: Array.isArray(evo.triggerCandidates) ? evo.triggerCandidates.slice(-80) : [],
    triggerHistory: Array.isArray(evo.triggerHistory) ? evo.triggerHistory.slice(-MAX_HISTORY) : [],
    summaryHistory: Array.isArray(evo.summaryHistory) ? evo.summaryHistory.slice(-MAX_HISTORY) : [],
    weightHistory: Array.isArray(evo.weightHistory) ? evo.weightHistory.slice(-MAX_HISTORY) : [],
    connectionHistory: Array.isArray(evo.connectionHistory) ? evo.connectionHistory.slice(-MAX_HISTORY) : [],
    summarySuggestion: evo.summarySuggestion || null,
    connectionSuggestions: Array.isArray(evo.connectionSuggestions) ? evo.connectionSuggestions.slice(-20) : [],
  };
  return neuron;
}

export function updateNeuronEvolution(neuron, patch = {}) {
  ensureNeuronEvolution(neuron);
  neuron.evolution = {
    ...neuron.evolution,
    ...patch,
    lastEvolvedAt: nowIso(),
  };
  return neuron;
}

export function recordNeuronUsage(neuron, context = {}) {
  ensureNeuronEvolution(neuron);
  const ts = nowIso();
  neuron.evolution.usageCount += 1;
  neuron.evolution.lastUsedAt = ts;
  neuron.evolution.recentUsage = pushHistory(neuron.evolution.recentUsage, {
    timestamp: ts,
    inputPreview: truncate(String(context.inputPreview || ""), 120),
    score: Number((context.score || 0).toFixed(4)),
    selected: Boolean(context.selected),
    feedback: context.feedback || null,
  }, 20);
  return neuron;
}

export function recordSuccessfulActivation(neuron, context = {}) {
  ensureNeuronEvolution(neuron);
  neuron.evolution.successfulActivations += 1;
  neuron.evolution.finalSelectionCount += 1;
  return recordNeuronUsage(neuron, { ...context, selected: true });
}

export function recordFailedActivation(neuron, context = {}) {
  ensureNeuronEvolution(neuron);
  neuron.evolution.failedActivations += 1;
  if (context.falsePositive) neuron.evolution.falsePositiveCount += 1;
  return recordNeuronUsage(neuron, { ...context, selected: false });
}

export function isGenericTrigger(token = "") {
  const t = String(token || "").toLowerCase().trim();
  return !t || t.length < 3 || GENERIC_TOKENS.has(t);
}

export function scoreTriggerCandidate(candidate, neuron, input = "", _options = {}) {
  const trigger = String(candidate?.trigger || candidate || "").toLowerCase().trim();
  if (isGenericTrigger(trigger)) return 0;

  const conceptTokens = new Set(tokenize(neuron?.core?.concept || ""));
  const summaryTokens = new Set(tokenize(neuron?.core?.summary || ""));
  const inputTokens = tokenize(input);
  const frequency = Math.max(1, Number(candidate?.frequency) || 1);

  let score = 0.28;
  if (conceptTokens.has(trigger)) score += 0.18;
  if (summaryTokens.has(trigger)) score += 0.14;
  if (inputTokens.includes(trigger)) score += 0.12;
  if (frequency >= 2) score += 0.14;
  if (frequency >= 3) score += 0.1;
  return clamp(Number(score.toFixed(4)), 0, 1);
}

export function appendTriggerCandidate(neuron, candidate = {}) {
  ensureNeuronEvolution(neuron);
  const trigger = String(candidate.trigger || "").toLowerCase().trim();
  if (isGenericTrigger(trigger)) return { added: false, reason: "generic_or_short" };
  if ((neuron.triggers || []).map((t) => t.toLowerCase()).includes(trigger)) return { added: false, reason: "already_exists" };

  const idx = neuron.evolution.triggerCandidates.findIndex((c) => c.trigger === trigger && !c.rejected);
  const now = nowIso();
  if (idx >= 0) {
    const prev = neuron.evolution.triggerCandidates[idx];
    const merged = {
      ...prev,
      frequency: (Number(prev.frequency) || 1) + 1,
      lastSeenAt: now,
      score: clamp(Math.max(Number(prev.score) || 0, Number(candidate.score) || 0), 0, 1),
      contexts: pushHistory(prev.contexts, truncate(candidate.inputPreview || "", 80), 5),
    };
    neuron.evolution.triggerCandidates[idx] = merged;
    return { added: true, updated: true, candidate: merged };
  }

  const item = {
    trigger,
    frequency: Math.max(1, Number(candidate.frequency) || 1),
    score: clamp(Number(candidate.score) || 0, 0, 1),
    createdAt: now,
    lastSeenAt: now,
    rejected: false,
    approved: false,
    contexts: [truncate(candidate.inputPreview || "", 80)],
  };
  neuron.evolution.triggerCandidates.push(item);
  return { added: true, updated: false, candidate: item };
}

export function acceptTriggerCandidate(neuron, trigger, reason = "threshold met") {
  ensureNeuronEvolution(neuron);
  const t = String(trigger || "").toLowerCase().trim();
  if (!t) return { accepted: false };
  if (!(neuron.triggers || []).includes(t)) neuron.triggers = [...(neuron.triggers || []), t].slice(0, 24);

  neuron.evolution.triggerCandidates = (neuron.evolution.triggerCandidates || []).map((c) => (
    c.trigger === t ? { ...c, approved: true, rejected: false, approvedAt: nowIso() } : c
  ));
  neuron.evolution.triggerHistory = pushHistory(neuron.evolution.triggerHistory, {
    timestamp: nowIso(),
    action: "added",
    trigger: t,
    reason,
  });
  return { accepted: true, trigger: t };
}

export function rejectTriggerCandidate(neuron, trigger, reason = "rejected by filter") {
  ensureNeuronEvolution(neuron);
  const t = String(trigger || "").toLowerCase().trim();
  if (!t) return { rejected: false };
  neuron.evolution.triggerCandidates = (neuron.evolution.triggerCandidates || []).map((c) => (
    c.trigger === t ? { ...c, rejected: true, approved: false, rejectedAt: nowIso() } : c
  ));
  neuron.evolution.triggerHistory = pushHistory(neuron.evolution.triggerHistory, {
    timestamp: nowIso(),
    action: "rejected",
    trigger: t,
    reason,
  });
  return { rejected: true, trigger: t };
}

export function extractTriggerCandidatesFromInput(input, neuron, options = {}) {
  const tokens = tokenize(String(input || ""));
  const existing = new Set((neuron?.triggers || []).map((t) => String(t).toLowerCase()));
  const conceptTokens = new Set(tokenize(neuron?.core?.concept || ""));
  const summaryTokens = new Set(tokenize(neuron?.core?.summary || ""));

  return [...new Set(tokens)]
    .filter((t) => !existing.has(t))
    .filter((t) => !isGenericTrigger(t))
    .filter((t) => conceptTokens.has(t) || summaryTokens.has(t) || (options.allowLooseMatch !== false && t.length >= 4))
    .map((trigger) => {
      const base = { trigger, frequency: 1, inputPreview: truncate(input, 120) };
      return { ...base, score: scoreTriggerCandidate(base, neuron, input, options) };
    })
    .filter((c) => c.score >= 0.42)
    .slice(0, 8);
}

export function getApprovedTriggerCandidates(neuron, options = {}) {
  ensureNeuronEvolution(neuron);
  const threshold = {
    ...DEFAULT_APPROVAL_THRESHOLD,
    ...(options.threshold || {}),
  };

  return (neuron.evolution.triggerCandidates || []).filter((c) => {
    if (c.rejected || c.approved) return false;
    return (Number(c.frequency) || 0) >= threshold.minFrequency && (Number(c.score) || 0) >= threshold.minScore;
  });
}

export function detectWeakTriggers(neuron, _options = {}) {
  ensureNeuronEvolution(neuron);
  const candidates = neuron.evolution.triggerCandidates || [];
  const candidateSet = new Set(candidates.filter((c) => !c.rejected).map((c) => c.trigger));
  const weak = [];
  for (const t of (neuron.triggers || [])) {
    const low = String(t || "").toLowerCase();
    if (isGenericTrigger(low)) {
      weak.push({ trigger: low, reason: "generic trigger" });
      continue;
    }
    if (!candidateSet.has(low) && neuron.evolution.usageCount >= 5 && neuron.evolution.successfulActivations <= 1) {
      weak.push({ trigger: low, reason: "low useful signal" });
    }
  }
  return weak;
}

export function pruneWeakTriggers(neuron, options = {}) {
  const weak = detectWeakTriggers(neuron, options);
  if (!weak.length) return { pruned: 0, weak };

  const removable = new Set(weak.map((w) => w.trigger));
  const minKeep = options.minKeep ?? 1;
  const next = [];
  const removed = [];

  for (const t of neuron.triggers || []) {
    if (removable.has(String(t).toLowerCase()) && (neuron.triggers.length - removed.length) > minKeep) {
      removed.push(String(t).toLowerCase());
      neuron.evolution.triggerHistory = pushHistory(neuron.evolution.triggerHistory, {
        timestamp: nowIso(),
        action: "removed",
        trigger: String(t).toLowerCase(),
        reason: weak.find((w) => w.trigger === String(t).toLowerCase())?.reason || "weak trigger pruned",
      });
      continue;
    }
    next.push(t);
  }

  neuron.triggers = next;
  return { pruned: removed.length, removed, weak };
}

export function adjustNeuronWeight(neuron, delta = 0, reason = "evolution") {
  ensureNeuronEvolution(neuron);
  const prev = clamp(Number(neuron.weight ?? 0.5), MIN_WEIGHT, MAX_WEIGHT);
  const next = clamp(prev + delta, MIN_WEIGHT, MAX_WEIGHT);
  neuron.weight = Number(next.toFixed(4));
  if (Math.abs(next - prev) > 0.0001) {
    neuron.evolution.weightHistory = pushHistory(neuron.evolution.weightHistory, {
      timestamp: nowIso(),
      previous: Number(prev.toFixed(4)),
      next: Number(next.toFixed(4)),
      delta: Number((next - prev).toFixed(4)),
      reason,
    });
  }
  return neuron.weight;
}

export function detectWeakSummary(neuron) {
  const summary = String(neuron?.core?.summary || "").trim();
  if (!summary || summary.length < 22) return { weak: true, reason: "summary too short" };
  const generic = ["general", "cosa", "tema", "varios", "importante", "recuerdo"];
  const lower = summary.toLowerCase();
  if (generic.some((g) => lower === g || lower.includes(` ${g} `))) return { weak: true, reason: "summary too generic" };
  return { weak: false, reason: "ok" };
}

export function suggestSummaryRefinement(neuron, _context = {}) {
  const weak = detectWeakSummary(neuron);
  if (!weak.weak) return { hasSuggestion: false, reason: "summary looks healthy", suggestedSummary: "" };

  const topTriggers = (neuron.triggers || []).slice(0, 3).join(", ");
  const suggestedSummary = `${neuron.core?.concept || "Patrón"}: activado por ${topTriggers || "señales recurrentes"} y útil en contexto ${neuron.core?.domain || "general"}.`;
  return {
    hasSuggestion: true,
    reason: weak.reason,
    suggestedSummary,
  };
}

export function suggestConnectionEvolution(neuron, coActivatedNeurons = [], options = {}) {
  ensureNeuronEvolution(neuron);
  const map = new Map();
  for (const c of coActivatedNeurons) {
    if (!c?.id || c.id === neuron.id) continue;
    map.set(c.id, (map.get(c.id) || 0) + 1);
  }
  const minCoActivation = options.minCoActivation ?? 2;
  const suggestions = [...map.entries()]
    .filter(([, count]) => count >= minCoActivation)
    .map(([targetId, count]) => ({
      type: "strengthen",
      sourceId: neuron.id,
      targetId,
      score: Number((Math.min(1, count / 5)).toFixed(3)),
      reason: "co-activation detected",
    }));

  neuron.evolution.connectionSuggestions = suggestions.slice(0, 6);
  return suggestions;
}

export function strengthenConnection(sourceId, targetId, reason = "co-activation detected") {
  return { action: "strengthen", sourceId, targetId, reason, timestamp: nowIso() };
}

export function weakenConnection(sourceId, targetId, reason = "low co-activation") {
  return { action: "weaken", sourceId, targetId, reason, timestamp: nowIso() };
}

export function evolveNeuron(neuron, context = {}, options = {}) {
  ensureNeuronEvolution(neuron);
  if (neuron.evolution.enabled === false) return { neuron, metrics: {} };

  const metrics = {
    triggerCandidatesAdded: 0,
    triggersApproved: 0,
    triggersPruned: 0,
    weightsAdjusted: 0,
    summarySuggestions: 0,
    connectionSuggestions: 0,
  };

  const score = Number(context.score || 0);
  if (context.selected) recordSuccessfulActivation(neuron, context);
  else if (context.activated) recordFailedActivation(neuron, { ...context, falsePositive: Boolean(context.falsePositive) });

  const usefulSignal = Boolean(context.selected || context.feedback === "like" || score >= (options.usefulScoreThreshold ?? 0.5));
  if (usefulSignal && context.input) {
    const candidates = extractTriggerCandidatesFromInput(context.input, neuron, options);
    for (const candidate of candidates) {
      const added = appendTriggerCandidate(neuron, candidate);
      if (added.added) metrics.triggerCandidatesAdded += 1;
    }
  }

  const approved = getApprovedTriggerCandidates(neuron, options);
  for (const candidate of approved) {
    acceptTriggerCandidate(neuron, candidate.trigger, "repeated useful match");
    metrics.triggersApproved += 1;
  }

  const prune = pruneWeakTriggers(neuron, options);
  metrics.triggersPruned = prune.pruned;

  let delta = 0;
  if (context.feedback === "like") {
    neuron.evolution.likeCount += 1;
    delta += 0.01;
  }
  if (context.feedback === "dislike") {
    neuron.evolution.dislikeCount += 1;
    neuron.evolution.falsePositiveCount += 1;
    delta -= 0.013;
  }
  if (context.selected) delta += 0.004;
  if (context.falsePositive) delta -= 0.006;

  const prevWeight = neuron.weight;
  adjustNeuronWeight(neuron, clamp(delta, -0.03, 0.03), delta >= 0 ? "repeated useful activation" : "false positive penalty");
  metrics.weightsAdjusted = prevWeight !== neuron.weight ? 1 : 0;

  const summarySuggestion = suggestSummaryRefinement(neuron, context);
  neuron.evolution.summarySuggestion = summarySuggestion.hasSuggestion ? summarySuggestion : null;
  if (summarySuggestion.hasSuggestion) {
    neuron.evolution.summaryHistory = pushHistory(neuron.evolution.summaryHistory, {
      timestamp: nowIso(),
      action: "suggested",
      reason: summarySuggestion.reason,
      suggestedSummary: summarySuggestion.suggestedSummary,
    });
    metrics.summarySuggestions = 1;
  }

  if (Array.isArray(context.coActivatedNeurons) && context.coActivatedNeurons.length) {
    const conn = suggestConnectionEvolution(neuron, context.coActivatedNeurons, options);
    metrics.connectionSuggestions = conn.length;
    if (conn.length) {
      neuron.evolution.connectionHistory = pushHistory(neuron.evolution.connectionHistory, {
        timestamp: nowIso(),
        action: "suggested",
        reason: "co-activation detected",
        suggestions: conn.slice(0, 4),
      });
    }
  }

  neuron.evolution.lastEvolvedAt = nowIso();
  return { neuron, metrics };
}

export function evolveNeuronBatch(neurons, context = {}, options = {}) {
  const metrics = {
    neuronsEvolvedCount: 0,
    triggerCandidatesAdded: 0,
    triggersApproved: 0,
    triggersPruned: 0,
    weightsAdjusted: 0,
    summarySuggestions: 0,
    connectionSuggestions: 0,
  };

  const selectedIds = new Set((context.finalSelection || []).map((n) => n.id));
  const activatedEntries = context.activated || [];
  const feedbackMap = context.feedbackMap || {};

  const evolved = neurons.map((neuron) => {
    const activatedEntry = activatedEntries.find((a) => (a.neuron?.id || a.id) === neuron.id);
    if (!activatedEntry) return neuron;

    const selected = selectedIds.has(neuron.id);
    const coActivatedNeurons = (context.finalSelection || [])
      .map((n) => n.neuron || n)
      .filter((n) => n && n.id !== neuron.id);

    const result = evolveNeuron(neuron, {
      input: context.input,
      inputPreview: truncate(context.input || "", 120),
      activated: true,
      selected,
      falsePositive: !selected,
      score: activatedEntry.scoreFinal ?? activatedEntry.score ?? 0,
      feedback: feedbackMap[neuron.id] || null,
      coActivatedNeurons,
    }, options);

    metrics.neuronsEvolvedCount += 1;
    metrics.triggerCandidatesAdded += result.metrics.triggerCandidatesAdded;
    metrics.triggersApproved += result.metrics.triggersApproved;
    metrics.triggersPruned += result.metrics.triggersPruned;
    metrics.weightsAdjusted += result.metrics.weightsAdjusted;
    metrics.summarySuggestions += result.metrics.summarySuggestions;
    metrics.connectionSuggestions += result.metrics.connectionSuggestions;
    return result.neuron;
  });

  return { neurons: evolved, metrics };
}

// TODO: Hook premium LLM future evolution
export async function evolveNeuronWithLLM(_neuron, _context = {}) {
  throw new Error("Not implemented yet");
}
