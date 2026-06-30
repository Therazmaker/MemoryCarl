/**
 * neurocore.js — Orquestador central del sistema NeuroChat
 */

import { getAllNeurons, saveManyNeurons, updateNeuron } from "./neuronStore.js";
import { activateNeurons } from "./activation.js";
import { detectMissingConcepts, generateMissingNeurons, generateMissingNeuronsPremium } from "./generator.js";
import { findRelatedNeurons, attachConnections } from "./connections.js";
import { getEmbedding } from "./embeddings.js";
import { createTrace, addStep, recordTiming, finalizeTrace } from "./trace.js";
import { requestChatReply, isNeuroclawConfigured } from "../services/neuroclawClient.js";
import { isGeminiPremiumConfigured, requestAssistedReply } from "../services/geminiPremiumClient.js";
import { isOllamaConfigured, requestOllamaChatReply, requestOllamaNeuronGeneration } from "../services/ollamaClient.js";
import { dedupeGeneratedNeurons } from "./dedup.js";
import { shouldUsePremiumGeneration } from "./premiumPolicy.js";
import { incrementPremiumUsage } from "./premiumUsage.js";
import { getBootstrapState } from "./bootstrap.js";
import { runInsightEngine } from "./insightEngine.js";
import { detectPastOrPresentOrientation } from "./activation.js";
import { summarizeTemporalRange } from "./temporal.js";
import { suggestNeuronActions } from "./neuronSuggestions.js";
import { computeFinalNeuronScore, enforceNeuronDiversity, detectBridgeNeuronNeed } from "./neuronSelection.js";
import { evolveNeuronBatch } from "./evolution.js";
import { findBestPattern, buildResponseFromPattern } from "./responsePatterns.js";
import { extractResponsePattern as extractResponsePatternV2 } from "./responsePatternExtractor.js";
import { savePattern as saveResponsePatternV2 } from "./responsePatternsStore.js";
import { buildLocalReply } from "./localReplyEngine.js";
import { buildReasoningContext } from "./graphReasoner.js";
import { generateRelationSuggestions } from "./structuredFeedback.js";
import { chooseReplyMode, extractKnowledgeFromGeminiReply, applyTriggerCandidates } from "./activeLearnEngine.js";
import { upsertRelation, getAllRelations } from "./relationStore.js";
import { getAllPatterns } from "./responsePatterns.js";
import { findRelevantMemories } from "../memory/memoryRecall.js";
import { getAllMemories } from "../memory/memoryStore.js";
import { findRelevantDays } from "../day/dayStore.js";

function buildDayContext(relevantDays = []) {
  if (!relevantDays.length) return null;
  return relevantDays.map((d) => ({
    date: d.date,
    summary: d.summary,
    emotion: d.dominantEmotion,
    themes: d.dominantThemes,
    insights: d.insights,
    isMilestone: d.isMilestone,
    isRefined: d.geminiProcessed,
  }));
}

function buildFallbackReply(activatedNeurons) {
  if (!activatedNeurons.length) return "No encontré recuerdos relacionados con tu mensaje. Cuéntame más para que pueda aprender.";
  const summaries = activatedNeurons.slice(0, 3)
    .map(({ neuron }) => neuron.core.summary || neuron.core.concept)
    .filter(Boolean)
    .join(" / ");
  return `Basándome en lo que recuerdo: ${summaries}. No tengo conexión con NeuroClaw ahora mismo, pero puedo seguir conversando.`;
}

function buildContext(activatedNeurons) {
  return activatedNeurons.slice(0, 8).map(({ neuron, score }) => ({
    concept: neuron.core.concept,
    domain: neuron.core.domain,
    summary: neuron.core.summary,
    emotion: neuron.emotion,
    weight: neuron.weight,
    score: Math.round(score * 100) / 100,
    triggers: neuron.triggers.slice(0, 5),
    temporal: neuron.temporal || null,
  }));
}

function buildTemporalContext(userInput, activated = [], insights = []) {
  const orientationRaw = detectPastOrPresentOrientation(userInput);
  const orientation = orientationRaw === "mixed" ? "mixed" : (orientationRaw === "past" ? "past" : "present");
  const activatedRecent = activated
    .filter(({ neuron }) => ["current", "recent"].includes(neuron.temporal?.timeContext || "timeless"))
    .map(({ neuron, score }) => ({ id: neuron.id, concept: neuron.core?.concept, score: Number((score || 0).toFixed(2)) }))
    .slice(0, 8);
  const activatedHistorical = activated
    .filter(({ neuron }) => ["past", "historical"].includes(neuron.temporal?.timeContext || ""))
    .map(({ neuron, score }) => ({ id: neuron.id, concept: neuron.core?.concept, score: Number((score || 0).toFixed(2)), stage: neuron.temporal?.stage || null }))
    .slice(0, 8);
  const temporalSummary = summarizeTemporalRange(activated.map((a) => a.neuron));
  const trendSignals = insights.filter((i) => ["trend", "resolved_pattern", "recurring_pattern"].includes(i.type)).map((i) => i.summary).slice(0, 3);
  return {
    orientation,
    activatedRecent,
    activatedHistorical,
    stageSignals: temporalSummary.stageSignals || [],
    trendSignals,
  };
}


function buildEnrichedContext(userInput, activatedNeurons) {
  const manual = activatedNeurons.filter((a) => a.neuron?.source?.kind === "manual");
  const lowerInput = String(userInput || "").toLowerCase();

  const explicitManual = manual.filter(({ neuron }) => {
    const concept = String(neuron.core?.concept || "").toLowerCase();
    const aliases = neuron.meta?.aliases || [];
    return (concept && lowerInput.includes(concept)) || aliases.some((a) => lowerInput.includes(String(a).toLowerCase()));
  });

  const activatedIds = new Set(activatedNeurons.map((a) => a.neuron.id));
  const relatedPinned = manual
    .filter(({ neuron }) => neuron.meta?.pin)
    .filter(({ neuron }) => (neuron.connections || []).some((id) => activatedIds.has(id)));

  const selected = [...explicitManual, ...relatedPinned, ...manual]
    .filter((entry, idx, arr) => arr.findIndex((x) => x.neuron.id === entry.neuron.id) === idx)
    .slice(0, 4);

  const activatedManual = selected.map(({ neuron, score }) => ({
    id: neuron.id,
    concept: neuron.core?.concept,
    aliases: neuron.meta?.aliases || [],
    category: neuron.meta?.manualCategory || "other",
    priority: neuron.meta?.priority || "medium",
    pin: Boolean(neuron.meta?.pin),
    score: Math.round((score || 0) * 100) / 100,
  }));

  const contextEntities = activatedManual.map((m) => m.concept).filter(Boolean);
  return { activatedManual, contextEntities };
}

function detectMemoryCandidate(userInput = "") {
  const text = String(userInput || "");
  const lower = text.toLowerCase();

  const emotionTokens = ["nunca", "siempre", "llor", "feliz", "triste", "miedo", "ansiedad", "enoj", "rabia", "orgull", "amor", "dolió", "dolio", "trauma"];
  const timeTokens = ["hoy", "ayer", "anoche", "esta mañana", "esta manana", "primer día", "primer dia", "cuando era", "el año pasado", "la semana pasada", "mi cumpleaños"];
  const personalTokens = ["yo", "me", "mi ", "con mi", "mi mamá", "mi mama", "mi papá", "mi papa", "mi pareja", "mi hijo", "mi hija", "en mi trabajo", "me pasó", "me paso"];

  const hasEmotion = emotionTokens.some((t) => lower.includes(t));
  const hasTime = timeTokens.some((t) => lower.includes(t));
  const hasPersonalEvent = personalTokens.some((t) => lower.includes(t));

  const matchedConditions = [hasEmotion, hasTime, hasPersonalEvent].filter(Boolean).length;
  const suggestSave = matchedConditions >= 2;

  return {
    suggestSave,
    matchedConditions,
    reasons: {
      hasEmotion,
      hasTime,
      hasPersonalEvent,
    },
    message: suggestSave ? "Guardar como memoria" : "",
  };
}

export async function processNeuroInput(userInput, options = {}) {
  const trace = createTrace();
  const t0 = Date.now();
  const mode = options.mode || "chat";
  const interpretationMode = options.interpretationMode || "default";
  const messageId = options.messageId || null;

  addStep(trace, "load_neurons");
  const t1 = Date.now();
  const allNeurons = getAllNeurons();
  recordTiming(trace, "load", Date.now() - t1);

  const totalNeurons = allNeurons.length;
  const bootstrapState = getBootstrapState(totalNeurons, options.bootstrapOptions);
  trace.totalNeurons = totalNeurons;
  trace.bootstrapState = bootstrapState;
  trace.mode = mode;
  trace.interpretationMode = interpretationMode;

  addStep(trace, "neurons_loaded", { count: totalNeurons, bootstrapState, mode });

  addStep(trace, "activate_neurons");
  const t2 = Date.now();
  const activationMeta = {};
  const activated = await activateNeurons(userInput, allNeurons, {
    topK: options.topK ?? 8,
    persistActivation: true,
    totalNeurons,
    bootstrapState,
    traceMeta: activationMeta,
  });
  recordTiming(trace, "activation", Date.now() - t2);
  trace.activated = activated.length;
  trace.activation = activationMeta;
  addStep(trace, "neurons_activated", { count: activated.length, threshold: activationMeta.activationThreshold, bootstrapAdjusted: activationMeta.bootstrapAdjusted });

  addStep(trace, "analyze_coverage");
  const missingAnalysis = detectMissingConcepts(userInput, activated);
  trace.coverage = missingAnalysis.coverage;
  addStep(trace, "coverage_analyzed", {
    coverage: missingAnalysis.coverage,
    missing: missingAnalysis.missingConcepts,
    reasons: missingAnalysis.reasons,
  });

  addStep(trace, "evaluate_premium_policy");
  const premiumDecision = shouldUsePremiumGeneration({
    userInput,
    activated,
    missingAnalysis,
    history: options.history || [],
    mode,
    totalNeurons,
    options: { ...(options.premiumOptions || {}), bootstrapState },
  });
  trace.classifier = premiumDecision.classifier;
  trace.premiumRulePath = premiumDecision.rulePath;
  addStep(trace, "premium_policy_evaluated", {
    usePremium: premiumDecision.usePremium,
    reasons: premiumDecision.reasons,
    rulePath: premiumDecision.rulePath,
    mode,
    bootstrapState,
  });

  const suggestionResult = suggestNeuronActions({
    input: userInput,
    activated,
    missingAnalysis,
    options: options.suggestionOptions || {},
  });
  trace.neuronSuggestionAnalysis = suggestionResult.analysis || null;
  trace.hasSuggestion = Boolean(suggestionResult.hasSuggestion);
  trace.suggestionReasons = suggestionResult.reasons || [];
  addStep(trace, "neuron_suggestion_analyzed", {
    hasSuggestion: trace.hasSuggestion,
    reasons: trace.suggestionReasons,
  });

  let generated = [];
  let dedupeSummary = { saved: 0, merged: 0, discarded: 0 };
  const manualOverride = Boolean(options.manualPremiumOverride);
  let premiumGenerationMeta = {
    manualOverrideUsed: manualOverride,
    premiumForced: false,
    premiumForcedSuccess: false,
    premiumForcedFailure: null,
    generatedBy: premiumDecision.usePremium ? "policy" : "none",
  };

  const shouldGenerate = Boolean(missingAnalysis.needsGeneration || options.forceGeneration || manualOverride);

  // Usar Ollama para generación de neuronas si está configurado y NeuroClaw no lo está
  if (!options.skipGeneration && shouldGenerate && isOllamaConfigured() && !isNeuroclawConfigured()) {
    addStep(trace, "ollama_neuron_generation_triggered");
    try {
      const rawGenerated = await requestOllamaNeuronGeneration({
        userInput,
        activatedNeurons: activated,
        missingAnalysis,
        history: options.history || [],
      });

      if (rawGenerated && rawGenerated.length > 0) {
        for (const n of rawGenerated) {
          if (!n.embedding || n.embedding.length === 0) {
            const text = [n.core?.concept, n.core?.summary, ...(n.triggers || [])].filter(Boolean).join(" ");
            n.embedding = await getEmbedding(text);
          }
        }
        const allAtGenTime = getAllNeurons();
        const dedupeResult = dedupeGeneratedNeurons(rawGenerated, allAtGenTime);
        dedupeSummary = {
          saved: dedupeResult.toSave.length,
          merged: dedupeResult.toMerge.length,
          discarded: dedupeResult.discarded.length,
          mergedIds: dedupeResult.toMerge.map((m) => m.targetId),
        };
        if (dedupeResult.toSave.length > 0) {
          for (const n of dedupeResult.toSave) {
            const related = await findRelatedNeurons(n, [...allAtGenTime, ...dedupeResult.toSave]);
            attachConnections(n, related);
          }
          saveManyNeurons(dedupeResult.toSave);
        }
        for (const mergeEntry of dedupeResult.toMerge) {
          try { updateNeuron(mergeEntry.targetId, mergeEntry.mergedNeuron); } catch (_e) {}
        }
        generated = dedupeResult.toSave;
        addStep(trace, "ollama_neurons_persisted", dedupeSummary);
      }
    } catch (ollamaGenErr) {
      console.warn("[neurocore] Ollama neuron generation falló:", ollamaGenErr);
    }
  } else if (!options.skipGeneration && shouldGenerate && isNeuroclawConfigured()) {
    const shouldAttemptPremium = premiumDecision.usePremium || manualOverride;
    addStep(trace, "generation_triggered", {
      premium: shouldAttemptPremium,
      rulePath: premiumDecision.rulePath,
      manualOverride,
    });
    const t3 = Date.now();
    try {
      let rawGenerated = [];
      let premiumSucceeded = false;
      let premiumAttempted = false;

      if (shouldAttemptPremium) {
        premiumAttempted = true;
        try {
          rawGenerated = await generateMissingNeuronsPremium({ userInput, activatedNeurons: activated, missingAnalysis, history: options.history || [] });
          premiumSucceeded = true;
          premiumGenerationMeta = {
            manualOverrideUsed: manualOverride,
            premiumForced: manualOverride && !premiumDecision.usePremium,
            premiumForcedSuccess: manualOverride && !premiumDecision.usePremium,
            premiumForcedFailure: null,
            generatedBy: manualOverride && !premiumDecision.usePremium ? "manual_override" : "policy",
          };
          addStep(trace, "premium_generation_succeeded", { count: rawGenerated.length, manualOverride });
        } catch (premiumErr) {
          premiumGenerationMeta = {
            manualOverrideUsed: manualOverride,
            premiumForced: manualOverride && !premiumDecision.usePremium,
            premiumForcedSuccess: false,
            premiumForcedFailure: String(premiumErr),
            generatedBy: manualOverride && !premiumDecision.usePremium ? "manual_override" : "policy",
          };
          addStep(trace, "premium_generation_failed", { error: String(premiumErr) });
          console.warn("[neurocore] Gemini premium falló, fallback:", premiumErr);
          rawGenerated = await generateMissingNeurons({ userInput, activatedNeurons: activated, missingAnalysis });
          addStep(trace, "generation_fallback_used");
        }
      } else {
        rawGenerated = await generateMissingNeurons({ userInput, activatedNeurons: activated, missingAnalysis });
      }
      recordTiming(trace, "generation", Date.now() - t3);

      if (premiumAttempted && premiumSucceeded) {
        incrementPremiumUsage({
          reason: manualOverride ? "premium_manual_override" : "premium_neuron_generation",
          inputLabel: premiumDecision.classifier?.label || "unknown",
          inputPreview: userInput.slice(0, 80),
        });
        addStep(trace, "premium_usage_incremented");
      }

      if (rawGenerated.length > 0) {
        for (const n of rawGenerated) {
          if (!n.embedding || n.embedding.length === 0) {
            const text = [n.core.concept, n.core.summary, ...n.triggers].join(" ");
            n.embedding = await getEmbedding(text);
          }
        }

        addStep(trace, "dedup_start");
        const allAtGenTime = getAllNeurons();
        const dedupeResult = dedupeGeneratedNeurons(rawGenerated, allAtGenTime);
        dedupeSummary = {
          saved: dedupeResult.toSave.length,
          merged: dedupeResult.toMerge.length,
          discarded: dedupeResult.discarded.length,
          mergedIds: dedupeResult.toMerge.map((m) => m.targetId),
        };
        addStep(trace, "dedup_done", dedupeSummary);

        if (dedupeResult.toSave.length > 0) {
          for (const n of dedupeResult.toSave) {
            const related = await findRelatedNeurons(n, [...allAtGenTime, ...dedupeResult.toSave]);
            attachConnections(n, related);
          }
          saveManyNeurons(dedupeResult.toSave);

          for (const n of dedupeResult.toSave) {
            for (const connId of n.connections) {
              try {
                const existing = allAtGenTime.find((x) => x.id === connId);
                if (existing && !existing.connections.includes(n.id)) {
                  updateNeuron(connId, { connections: [...existing.connections, n.id] });
                }
              } catch (_e) {}
            }
          }
        }

        for (const mergeEntry of dedupeResult.toMerge) {
          try {
            updateNeuron(mergeEntry.targetId, mergeEntry.mergedNeuron);
          } catch (_e) {
            console.warn("[neurocore] Error aplicando merge:", _e);
          }
        }

        generated = dedupeResult.toSave;
        trace.generated = generated.length;
        addStep(trace, "neurons_persisted", dedupeSummary);
      }
    } catch (err) {
      console.warn("[neurocore] Error en generación:", err);
      addStep(trace, "generation_failed", { error: String(err) });
    }
  } else if (shouldGenerate && !isOllamaConfigured() && !isNeuroclawConfigured()) {
    addStep(trace, "generation_skipped", { reason: "NeuroClaw y Ollama no configurados o skipGeneration=true" });
  }

  addStep(trace, "build_context");
  const finalNeurons = generated.length > 0 || dedupeSummary.merged > 0 ? getAllNeurons() : allNeurons;
  const finalActivationMeta = {};
  const baseActivated = (generated.length > 0 || dedupeSummary.merged > 0)
    ? await activateNeurons(userInput, finalNeurons, {
        topK: 12,
        persistActivation: false,
        totalNeurons: finalNeurons.length,
        bootstrapState: getBootstrapState(finalNeurons.length, options.bootstrapOptions),
        traceMeta: finalActivationMeta,
      })
    : activated;

  addStep(trace, "apply_trigger_quality");
  const scoredActivated = baseActivated
    .map((entry) => {
      const finalScoreData = computeFinalNeuronScore(entry, userInput);
      return {
        ...entry,
        scoreFinal: finalScoreData.score,
        score: finalScoreData.score,
        quality: finalScoreData,
      };
    })
    .sort((a, b) => b.scoreFinal - a.scoreFinal);

  const topInitial = Number(options.topInitialK) || 10;
  const topK = Number(options.finalTopK) || 5;
  const top10 = scoredActivated.slice(0, topInitial);

  addStep(trace, "enforce_diversity", { topInitial: top10.length, topK });
  const diversityResult = await enforceNeuronDiversity(top10, { topK });
  const finalActivated = diversityResult.selected.slice(0, topK);

  const bridgeAnalysis = detectBridgeNeuronNeed({
    input: userInput,
    activated: scoredActivated,
    finalSelection: finalActivated,
    missingAnalysis,
  });

  trace.selection = {
    initialActivated: baseActivated.length,
    afterScoring: scoredActivated.map((item) => ({
      id: item.neuron.id,
      concept: item.neuron.core?.concept,
      score: Number((item.scoreFinal || 0).toFixed(3)),
      triggerQuality: Number((item.quality?.triggerQualityRaw || 0).toFixed(3)),
    })),
    top10: top10.map((item) => ({
      id: item.neuron.id,
      concept: item.neuron.core?.concept,
      score: Number((item.scoreFinal || 0).toFixed(3)),
    })),
    finalSelected: finalActivated.map((item) => ({
      id: item.neuron.id,
      concept: item.neuron.core?.concept,
      score: Number((item.scoreFinal || 0).toFixed(3)),
    })),
    diversityRemoved: diversityResult.removed,
    triggerPenalties: scoredActivated
      .filter((item) => (item.quality?.triggerQualityRaw || 0) < 0)
      .map((item) => ({
        id: item.neuron.id,
        concept: item.neuron.core?.concept,
        triggerQuality: Number((item.quality.triggerQualityRaw || 0).toFixed(3)),
      })),
    bridgeSuggested: bridgeAnalysis.bridgeSuggested,
  };
  trace.bridgeSuggestion = bridgeAnalysis.bridgeSuggestion || null;

  addStep(trace, "selection_finalized", {
    initialActivated: trace.selection.initialActivated,
    finalSelected: trace.selection.finalSelected.length,
    bridgeSuggested: bridgeAnalysis.bridgeSuggested,
  });

  const context = buildContext(finalActivated);
  const enrichedContext = buildEnrichedContext(userInput, finalActivated);

  addStep(trace, "build_reasoning_context");
  let reasoningContext = { chains: [], contradictions: [], resolutions: [], graphSummary: "" };
  try {
    reasoningContext = buildReasoningContext(finalActivated, finalNeurons);
    addStep(trace, "reasoning_context_built", {
      chains: reasoningContext.chains.length,
      contradictions: reasoningContext.contradictions.length,
      resolutions: reasoningContext.resolutions.length,
    });
  } catch (rErr) {
    addStep(trace, "reasoning_context_failed", { error: String(rErr) });
  }

  if (messageId) {
    try {
      generateRelationSuggestions({ messageId, activated: finalActivated });
    } catch (_e) {}
  }

  const feedbackSummary = finalActivated.reduce((acc, item) => {
    const stats = item.neuron?.feedbackStats || {};
    const learning = item.neuron?.activationLearning || {};
    const dislikes = Number(stats.dislikes) || 0;
    const likes = Number(stats.likes) || 0;
    const netScore = Number(stats.netScore) || (likes - dislikes);
    const falsePositiveCount = Number(learning.falsePositiveCount) || 0;
    acc.totalLikes += likes;
    acc.totalDislikes += dislikes;
    if (netScore <= -3 || falsePositiveCount >= 3) {
      acc.strongDislikeNeurons.push({
        id: item.neuron.id,
        concept: item.neuron.core?.concept || "",
        netScore,
        dislikes,
        falsePositiveCount,
        feedbackAdjustedActivationScore: Number((item.score || 0).toFixed(3)),
      });
    }
    return acc;
  }, { totalLikes: 0, totalDislikes: 0, strongDislikeNeurons: [] });
  trace.feedbackSummary = feedbackSummary;
  addStep(trace, "feedback_summary_collected", {
    totalLikes: feedbackSummary.totalLikes,
    totalDislikes: feedbackSummary.totalDislikes,
    strongDislikeNeurons: feedbackSummary.strongDislikeNeurons.length,
  });

  addStep(trace, "run_insight_engine");
  const insightResult = await runInsightEngine({
    activated: finalActivated,
    allNeurons: finalNeurons,
    contextEntities: enrichedContext.contextEntities,
    options: {
      interpretationMode,
      maxInsights: options.maxInsights || 3,
      minConfidence: options.minInsightConfidence || 0.42,
      maxHistory: options.maxInsightHistory || 80,
    },
  });
  addStep(trace, "insight_engine_completed", {
    insights: insightResult.insights.length,
    clusters: insightResult.clusters.length,
    patterns: insightResult.patterns.length,
  });
  const temporalContext = buildTemporalContext(userInput, finalActivated, insightResult.insights);
  const memorySuggestion = detectMemoryCandidate(userInput);
  addStep(trace, "memory_candidate_detected", memorySuggestion);

  const recentMemoryRecallIds = (options.history || [])
    .filter((msg) => msg?.role === "assistant")
    .flatMap((msg) => msg?.memoryRecallIds || [])
    .slice(-8);

  const memoryRecallResult = findRelevantMemories(
    userInput,
    getAllMemories(),
    finalActivated,
    {
      threshold: options.memoryRecallThreshold ?? 0.65,
      maxResults: options.memoryRecallMaxResults ?? 3,
      recentMemoryIds: recentMemoryRecallIds,
    },
  );
  addStep(trace, "memory_recall_evaluated", {
    threshold: memoryRecallResult.threshold,
    candidates: memoryRecallResult.ranked.length,
    topScore: memoryRecallResult.ranked[0]?.score || 0,
  });

  addStep(trace, "find_relevant_days");
  const currentThemes = (missingAnalysis?.missingConcepts || []).concat(enrichedContext.contextEntities);
  const relevantDays = findRelevantDays(
    finalActivated.map((a) => a.neuron?.id).filter(Boolean),
    currentThemes,
    { limit: 3, excludeCurrent: true }
  );
  const dayContext = buildDayContext(relevantDays);
  addStep(trace, "relevant_days_found", { count: relevantDays.length });

  addStep(trace, "choose_reply_mode");
  const patternCount = (() => {
    try { return getAllPatterns().length; } catch (_e) { return 0; }
  })();
  const relationCount = (() => {
    try { return getAllRelations().length; } catch (_e) { return 0; }
  })();
  const replyMode = chooseReplyMode({
    coverage: missingAnalysis.coverage,
    activatedCount: finalActivated.length,
    patternCount,
    relationCount,
    mode,
    isNeuroclawConfigured: isNeuroclawConfigured(),
    isGeminiConfigured: isGeminiPremiumConfigured(),
    isOllamaConfigured: isOllamaConfigured(),
  });
  addStep(trace, "reply_mode_chosen", { replyMode, patternCount, relationCount });
  trace.replyMode = replyMode;

  addStep(trace, "request_reply");
  const t4 = Date.now();
  let reply = null;
  let replySource = "fallback";
  let localDraft = "";
  let geminiReplyText = "";

  const bestPatternMatch = findBestPattern(userInput, finalActivated.map((a) => a.neuron));

  // ---- Bloque de respuesta Ollama (prioritario) ----
  // Ollama responde Y gestiona neuronas en un solo turno
  let ollamaStreamBuffer = "";
  let ollamaChunkCallback = null;
  if (!reply && replyMode === "ollama" && isOllamaConfigured()) {
    try {
      addStep(trace, "ollama_reply_start");

      // El onChunk se emitirá al bus de eventos del DOM para streaming en UI
      ollamaChunkCallback = (displayText) => {
        ollamaStreamBuffer = displayText;
        // Emitir evento para que la UI actualice el mensaje en tiempo real
        try {
          window.dispatchEvent(new CustomEvent("neurochat:ollama:stream", {
            detail: { text: displayText, messageId },
          }));
        } catch (_e) {}
      };

      const ollamaResult = await requestOllamaChatReply({
        userInput,
        context,
        history: (options.history || []).slice(-8),
        insights: insightResult.insights,
        temporalContext,
        dayContext,
        memoryRecall: memoryRecallResult.ranked,
      }, ollamaChunkCallback);

      if (ollamaResult && ollamaResult.reply) {
        reply = ollamaResult.reply;
        geminiReplyText = ollamaResult.reply; // reutilizamos para knowledge extraction
        replySource = "ollama";
        addStep(trace, "ollama_reply_received", { length: reply.length });

        // Aplicar acciones de neuronas que Ollama decidió
        const { actions = [] } = ollamaResult.neuronActions || {};
        if (actions.length > 0) {
          addStep(trace, "ollama_neuron_actions_start", { count: actions.length });
          const allAtActionTime = getAllNeurons();
          const neuronsToSave = [];

          for (const action of actions) {
            try {
              if (action.type === "create" && action.neuron) {
                const newNeuron = action.neuron;
                if (!newNeuron.embedding || newNeuron.embedding.length === 0) {
                  const text = [newNeuron.core?.concept, newNeuron.core?.summary, ...(newNeuron.triggers || [])].filter(Boolean).join(" ");
                  newNeuron.embedding = await getEmbedding(text);
                }
                // Deduplicar antes de guardar
                const dedupeCheck = dedupeGeneratedNeurons([newNeuron], allAtActionTime);
                if (dedupeCheck.toSave.length > 0) {
                  const n = dedupeCheck.toSave[0];
                  const related = await findRelatedNeurons(n, [...allAtActionTime, ...neuronsToSave]);
                  attachConnections(n, related);
                  neuronsToSave.push(n);
                  generated.push(n);
                  addStep(trace, "ollama_neuron_created", { concept: newNeuron.core?.concept });
                }
              } else if (action.type === "update" && action.neuronId) {
                // Actualizar neurona existente con los cambios indicados
                const changes = {};
                for (const [key, value] of Object.entries(action.changes || {})) {
                  if (key.includes(".")) {
                    // Campos anidados como "core.summary"
                    const parts = key.split(".");
                    const existing = allAtActionTime.find((n) => n.id === action.neuronId);
                    if (existing) {
                      const nested = { ...(existing[parts[0]] || {}) };
                      nested[parts[1]] = value;
                      changes[parts[0]] = nested;
                    }
                  } else {
                    changes[key] = value;
                  }
                }
                if (Object.keys(changes).length > 0) {
                  updateNeuron(action.neuronId, changes);
                  addStep(trace, "ollama_neuron_updated", { id: action.neuronId });
                }
              } else if (action.type === "merge" && action.sourceId && action.targetId) {
                // Merge: combinar triggers y actualizar target
                const source = allAtActionTime.find((n) => n.id === action.sourceId);
                const target = allAtActionTime.find((n) => n.id === action.targetId);
                if (source && target) {
                  const mergedTriggers = [...new Set([...(target.triggers || []), ...(source.triggers || [])])];
                  updateNeuron(action.targetId, { triggers: mergedTriggers });
                  addStep(trace, "ollama_neuron_merged", { source: action.sourceId, target: action.targetId });
                }
              }
            } catch (actionErr) {
              console.warn("[neurocore] Error aplicando acción Ollama:", actionErr);
            }
          }

          if (neuronsToSave.length > 0) {
            saveManyNeurons(neuronsToSave);
            addStep(trace, "ollama_neurons_saved", { count: neuronsToSave.length });
          }
        }
      }
    } catch (ollamaErr) {
      console.warn("[neurocore] Ollama reply falló, intentando fallback:", ollamaErr);
      addStep(trace, "ollama_reply_failed", { error: String(ollamaErr) });
    }
  }

  // ---- Pattern-based reply (local) ----
  if (bestPatternMatch?.isGoodMatch && bestPatternMatch.pattern) {
    const patternReply = buildResponseFromPattern(bestPatternMatch.pattern, userInput);
    if (patternReply) {
      reply = patternReply;
      replySource = "response_pattern";
      addStep(trace, "response_pattern_used", {
        patternId: bestPatternMatch.pattern.id,
        score: Number((bestPatternMatch.score || 0).toFixed(3)),
      });
    }
  }

  if (!reply && finalActivated.length > 0) {
    try {
      localDraft = buildLocalReply({
        userInput,
        activated: finalActivated,
        insights: insightResult.insights,
        insightSummary: insightResult.insightSummary,
        temporalContext,
        mode,
        history: options.history || [],
        missingAnalysis,
        reasoningContext,
      });
      if (replyMode === "autonomous") {
        reply = localDraft;
        replySource = "local_engine";
        addStep(trace, "local_engine_reply_used_autonomous", { coverage: missingAnalysis.coverage });
      }
    } catch (localErr) {
      console.warn("[neurocore] localReplyEngine falló:", localErr);
    }
  }

  if (!reply && replyMode === "assisted" && isGeminiPremiumConfigured()) {
    try {
      const assistedReply = await requestAssistedReply({
        userInput,
        localDraft,
        context,
        history: (options.history || []).slice(-6),
        insights: insightResult.insights,
        temporalContext,
        dayContext,
      });
      if (assistedReply) {
        geminiReplyText = assistedReply;
        reply = assistedReply;
        replySource = "assisted";
        addStep(trace, "assisted_reply_received", { draftLength: localDraft.length });
      }
    } catch (err) {
      console.warn("[neurocore] assisted reply falló:", err);
    }
  }

  if (!reply && replyMode === "delegated" && isNeuroclawConfigured()) {
    try {
      reply = await requestChatReply({
        userInput,
        context,
        history: (options.history || []).slice(-6),
        missingConcepts: missingAnalysis.missingConcepts,
        activatedManual: enrichedContext.activatedManual,
        contextEntities: enrichedContext.contextEntities,
        insights: insightResult.insights,
        insightSummary: insightResult.insightSummary,
        temporalContext,
        interpretationMode,
        dayContext,
      });
      if (reply) {
        geminiReplyText = reply;
        replySource = "gemini";
        addStep(trace, "delegated_reply_received");
      }
    } catch (err) {
      console.warn("[neurocore] delegated reply falló:", err);
    }
  }

  if (!reply && localDraft) {
    reply = localDraft;
    replySource = "local_engine";
    addStep(trace, "local_engine_fallback_used");
  }

  if (!reply) {
    reply = buildFallbackReply(finalActivated);
    replySource = "fallback";
    addStep(trace, "fallback_reply_used");
  } else {
    addStep(trace, "reply_received", { source: replySource });
  }

  if (memoryRecallResult.ranked.length > 0) {
    const recallText = memoryRecallResult.ranked.map((item) => item.snippet).join("\n\n");
    reply = `${reply}\n\n${recallText}`;
    addStep(trace, "memory_recall_attached", {
      count: memoryRecallResult.ranked.length,
      topScore: memoryRecallResult.ranked[0]?.score || 0,
    });
  }

  recordTiming(trace, "reply", Date.now() - t4);

  let knowledgeExtracted = { relationHints: [], triggerCandidates: [], quality: "low", delta: 0 };
  if (geminiReplyText && (replySource === "gemini" || replySource === "assisted")) {
    try {
      knowledgeExtracted = extractKnowledgeFromGeminiReply({
        userInput,
        geminiReply: geminiReplyText,
        activated: finalActivated,
        localDraft,
      });

      if (knowledgeExtracted.quality !== "low") {
        const triggersApplied = applyTriggerCandidates({
          triggerCandidates: knowledgeExtracted.triggerCandidates,
          minScore: 0.4,
        });
        addStep(trace, "triggers_learned", { count: triggersApplied });
        trace.triggersLearned = triggersApplied;
      }

      if (knowledgeExtracted.relationHints.length > 0 && messageId) {
        for (const hint of knowledgeExtracted.relationHints.slice(0, 3)) {
          try {
            upsertRelation({ ...hint, origin: "inferred", strength: 0.35 });
          } catch (_e) {}
        }
        addStep(trace, "relation_hints_stored", { count: knowledgeExtracted.relationHints.length });
      }

      if (knowledgeExtracted.quality === "high") {
        const pattern = extractResponsePatternV2({
          input: userInput,
          neurons: finalActivated.map((a) => a.neuron),
          response: geminiReplyText,
        });
        saveResponsePatternV2(pattern);
        addStep(trace, "response_pattern_learned_from_gemini");
      }
    } catch (learnErr) {
      console.warn("[neurocore] extracción de conocimiento falló:", learnErr);
    }
  }
  trace.replyMode = replyMode;
  trace.knowledgeExtracted = {
    relationHints: knowledgeExtracted.relationHints.length,
    triggerCandidates: knowledgeExtracted.triggerCandidates.length,
    quality: knowledgeExtracted.quality,
    delta: knowledgeExtracted.delta,
  };
  trace.reply = true;

  addStep(trace, "post_evolution");
  let evolutionMetrics = {
    neuronsEvolvedCount: 0,
    triggerCandidatesAdded: 0,
    triggersApproved: 0,
    triggersPruned: 0,
    weightsAdjusted: 0,
    summarySuggestions: 0,
    connectionSuggestions: 0,
  };
  try {
    const evolutionResult = evolveNeuronBatch(finalNeurons, {
      input: userInput,
      activated: scoredActivated,
      finalSelection: finalActivated.map((item) => item.neuron),
      feedbackMap: options.feedbackMap || {},
    });
    evolutionMetrics = evolutionResult.metrics;
    if (evolutionMetrics.neuronsEvolvedCount > 0) {
      saveManyNeurons(evolutionResult.neurons);
    }
    addStep(trace, "post_evolution_done", evolutionMetrics);
  } catch (evoErr) {
    addStep(trace, "post_evolution_failed", { error: String(evoErr) });
  }
  trace.evolution = evolutionMetrics;

  recordTiming(trace, "total", Date.now() - t0);
  trace.manualOverrideUsed = premiumGenerationMeta.manualOverrideUsed;
  trace.premiumForced = premiumGenerationMeta.premiumForced;
  trace.premiumForcedSuccess = premiumGenerationMeta.premiumForcedSuccess;
  trace.premiumForcedFailure = premiumGenerationMeta.premiumForcedFailure;
  trace.generatedBy = premiumGenerationMeta.generatedBy;
  const traceResult = finalizeTrace(trace);
  traceResult.neuronSuggestionAnalysis = trace.neuronSuggestionAnalysis;
  traceResult.hasSuggestion = trace.hasSuggestion;
  traceResult.suggestionReasons = trace.suggestionReasons;
  traceResult.manualOverrideUsed = premiumGenerationMeta.manualOverrideUsed;
  traceResult.premiumForced = premiumGenerationMeta.premiumForced;
  traceResult.premiumForcedSuccess = premiumGenerationMeta.premiumForcedSuccess;
  traceResult.premiumForcedFailure = premiumGenerationMeta.premiumForcedFailure;
  traceResult.generatedBy = premiumGenerationMeta.generatedBy;

  return {
    reply,
    activated: finalActivated,
    activatedManual: enrichedContext.activatedManual,
    contextEntities: enrichedContext.contextEntities,
    insights: insightResult.insights,
    insightSummary: insightResult.insightSummary,
    temporalContext,
    memorySuggestion,
    memoryRecall: memoryRecallResult.ranked,
    memoryRecallThreshold: memoryRecallResult.threshold,
    reasoningContext,
    insightTrace: {
      clusters: insightResult.clusters,
      patterns: insightResult.patterns,
      trend: insightResult.trend,
    },
    interpretationMode,
    generated,
    relevantDays: dayContext,
    trace: traceResult,
    missingAnalysis,
    bridgeSuggestion: bridgeAnalysis.bridgeSuggestion || null,
    bridgeAnalysis,
    premiumDecision,
    neuronSuggestion: suggestionResult,
    dedupeSummary,
    bootstrapState,
    mode,
    totalNeurons,
    messageId,
    manualOverrideUsed: premiumGenerationMeta.manualOverrideUsed,
    premiumForced: premiumGenerationMeta.premiumForced,
    premiumForcedSuccess: premiumGenerationMeta.premiumForcedSuccess,
    premiumForcedFailure: premiumGenerationMeta.premiumForcedFailure,
    generatedBy: premiumGenerationMeta.generatedBy,
    replySource,
    replyMode,
    knowledgeExtracted: {
      relationHints: trace.knowledgeExtracted?.relationHints || 0,
      triggerCandidates: trace.knowledgeExtracted?.triggerCandidates || 0,
      quality: trace.knowledgeExtracted?.quality || "low",
    },
  };
}
