/**
 * neurocore.js — Orquestador central del sistema NeuroChat
 * MemoryCarl
 *
 * Flujo:
 *   1. Carga neuronas
 *   2. Activa neuronas relevantes
 *   3. Analiza cobertura / detecta huecos
 *   4. Evalúa política premium (shouldUsePremiumGeneration)
 *   5. Si coverage < umbral → genera nuevas neuronas via NeuroClaw (normal o premium)
 *   6. Deduplica candidatos antes de persistir (dedupeGeneratedNeurons)
 *   7. Conecta y guarda neuronas realmente nuevas; aplica merges
 *   8. Construye contexto final
 *   9. Solicita respuesta final a NeuroClaw (con fallback)
 *  10. Devuelve payload completo para UI (incluye premiumDecision y dedupeSummary)
 */

import { getAllNeurons, saveManyNeurons }     from "./neuronStore.js";
import { activateNeurons }                    from "./activation.js";
import { detectMissingConcepts, generateMissingNeurons, generateMissingNeuronsPremium } from "./generator.js";
import { findRelatedNeurons, attachConnections }          from "./connections.js";
import { getEmbedding }                       from "./embeddings.js";
import { createTrace, addStep, recordTiming, finalizeTrace } from "./trace.js";
import { requestChatReply, isNeuroclawConfigured }        from "../services/neuroclawClient.js";
import { updateNeuron }                       from "./neuronStore.js";
import { dedupeGeneratedNeurons, mergeNeuronData }        from "./dedup.js";
import { shouldUsePremiumGeneration }                     from "./premiumPolicy.js";
import { incrementPremiumUsage }                          from "./premiumUsage.js";

// ---- Respuesta de fallback cuando NeuroClaw no está disponible ----
function buildFallbackReply(activatedNeurons, userInput) {
  if (!activatedNeurons.length) {
    return `No encontré recuerdos relacionados con tu mensaje. Cuéntame más para que pueda aprender.`;
  }
  const top = activatedNeurons.slice(0, 3);
  const summaries = top
    .map(({ neuron }) => neuron.core.summary || neuron.core.concept)
    .filter(Boolean)
    .join(" / ");
  return `Basándome en lo que recuerdo: ${summaries}. No tengo conexión con NeuroClaw ahora mismo, pero puedo seguir conversando.`;
}

// ---- Construcción del contexto para NeuroClaw ----
function buildContext(activatedNeurons) {
  return activatedNeurons.slice(0, 8).map(({ neuron, score }) => ({
    concept:  neuron.core.concept,
    domain:   neuron.core.domain,
    summary:  neuron.core.summary,
    emotion:  neuron.emotion,
    weight:   neuron.weight,
    score:    Math.round(score * 100) / 100,
    triggers: neuron.triggers.slice(0, 5),
  }));
}

// ---- Motor principal ----

/**
 * Procesa el input del usuario y devuelve payload completo para la UI.
 *
 * @param {string} userInput
 * @param {{ history?: ChatMessage[], topK?: number, skipGeneration?: boolean }} [options]
 * @returns {Promise<NeuroCoreResult>}
 */
export async function processNeuroInput(userInput, options = {}) {
  const trace = createTrace();
  const t0 = Date.now();

  // ---- 1. Cargar neuronas ----
  addStep(trace, "load_neurons");
  const t1 = Date.now();
  const allNeurons = getAllNeurons();
  recordTiming(trace, "load", Date.now() - t1);
  addStep(trace, "neurons_loaded", { count: allNeurons.length });

  // ---- 2. Activar neuronas ----
  addStep(trace, "activate_neurons");
  const t2 = Date.now();
  const activated = await activateNeurons(userInput, allNeurons, {
    topK: options.topK ?? 8,
    persistActivation: true,
  });
  recordTiming(trace, "activation", Date.now() - t2);
  trace.activated = activated.length;
  addStep(trace, "neurons_activated", { count: activated.length, scores: activated.map((r) => r.score) });

  // ---- 3. Analizar cobertura ----
  addStep(trace, "analyze_coverage");
  const missingAnalysis = detectMissingConcepts(userInput, activated);
  trace.coverage = missingAnalysis.coverage;
  addStep(trace, "coverage_analyzed", {
    coverage: missingAnalysis.coverage,
    missing:  missingAnalysis.missingConcepts,
    reasons:  missingAnalysis.reasons,
  });

  // ---- 4. Evaluar política premium ----
  addStep(trace, "evaluate_premium_policy");
  const premiumDecision = shouldUsePremiumGeneration({
    userInput,
    activated,
    missingAnalysis,
    history: options.history || [],
    options: options.premiumOptions || {},
  });
  addStep(trace, "premium_policy_evaluated", {
    usePremium: premiumDecision.usePremium,
    reasons:    premiumDecision.reasons,
  });

  // ---- 5. Generar y deduplicar neuronas si hace falta ----
  let generated = [];
  let dedupeSummary = { saved: 0, merged: 0, discarded: 0 };

  if (!options.skipGeneration && missingAnalysis.needsGeneration && isNeuroclawConfigured()) {
    addStep(trace, "generation_triggered", { premium: premiumDecision.usePremium });
    const t3 = Date.now();
    try {
      // --- 5a. Generación (normal o premium) ---
      let rawGenerated = [];
      let premiumSucceeded = false;

      if (premiumDecision.usePremium) {
        try {
          rawGenerated = await generateMissingNeuronsPremium({
            userInput,
            activatedNeurons: activated,
            missingAnalysis,
            history: options.history || [],
          });
          premiumSucceeded = true;
          addStep(trace, "premium_generation_succeeded", { count: rawGenerated.length });
        } catch (premiumErr) {
          addStep(trace, "premium_generation_failed", { error: String(premiumErr) });
          console.warn("[neurocore] Gemini premium falló, haciendo fallback a NeuroClaw:", premiumErr);
          // Fallback a generación normal
          rawGenerated = await generateMissingNeurons({ userInput, activatedNeurons: activated, missingAnalysis });
          addStep(trace, "generation_fallback_used");
        }
      } else {
        rawGenerated = await generateMissingNeurons({ userInput, activatedNeurons: activated, missingAnalysis });
      }
      recordTiming(trace, "generation", Date.now() - t3);

      if (premiumDecision.usePremium && premiumSucceeded) {
        // Registrar el uso premium SOLO si la generación fue exitosa
        incrementPremiumUsage({
          reason:       "premium_neuron_generation",
          inputLabel:   premiumDecision.classifier?.label || "unknown",
          inputPreview: userInput.slice(0, 80),
        });
        addStep(trace, "premium_usage_incremented");
      }

      if (rawGenerated.length > 0) {
        // --- 5b. Precomputar embeddings ---
        for (const n of rawGenerated) {
          if (!n.embedding || n.embedding.length === 0) {
            const text = [n.core.concept, n.core.summary, ...n.triggers].join(" ");
            n.embedding = await getEmbedding(text);
          }
        }

        // --- 5c. Deduplicar candidatos ---
        addStep(trace, "dedup_start");
        const allAtGenTime = getAllNeurons();
        const dedupeResult = dedupeGeneratedNeurons(rawGenerated, allAtGenTime);
        dedupeSummary = {
          saved:     dedupeResult.toSave.length,
          merged:    dedupeResult.toMerge.length,
          discarded: dedupeResult.discarded.length,
        };
        addStep(trace, "dedup_done", dedupeSummary);

        // --- 5d. Conectar y persistir solo las nuevas ---
        if (dedupeResult.toSave.length > 0) {
          for (const n of dedupeResult.toSave) {
            const related = await findRelatedNeurons(n, [...allAtGenTime, ...dedupeResult.toSave]);
            attachConnections(n, related);
          }
          saveManyNeurons(dedupeResult.toSave);

          // Actualizar conexiones inversas en neuronas ya guardadas
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

        // --- 5e. Aplicar merges ---
        for (const mergeEntry of dedupeResult.toMerge) {
          try {
            updateNeuron(mergeEntry.targetId, mergeEntry.mergedNeuron);
          } catch (_e) {
            console.warn("[neurocore] Error aplicando merge:", _e);
          }
        }

        generated = dedupeResult.toSave;
        trace.generated = generated.length;
        addStep(trace, "neurons_persisted", {
          saved:     dedupeSummary.saved,
          merged:    dedupeSummary.merged,
          discarded: dedupeSummary.discarded,
        });
      }
    } catch (err) {
      console.warn("[neurocore] Error en generación:", err);
      addStep(trace, "generation_failed", { error: String(err) });
    }
  } else if (missingAnalysis.needsGeneration) {
    addStep(trace, "generation_skipped", { reason: "NeuroClaw no configurado o skipGeneration=true" });
  }

  // ---- 6. Construir contexto final ----
  addStep(trace, "build_context");
  const finalNeurons = generated.length > 0 || dedupeSummary.merged > 0
    ? getAllNeurons()
    : allNeurons;
  const finalActivated = (generated.length > 0 || dedupeSummary.merged > 0)
    ? await activateNeurons(userInput, finalNeurons, { topK: 8, persistActivation: false })
    : activated;
  const context = buildContext(finalActivated);

  // ---- 7. Solicitar respuesta final ----
  addStep(trace, "request_reply");
  const t4 = Date.now();
  let reply = null;

  if (isNeuroclawConfigured()) {
    try {
      reply = await requestChatReply({
        userInput,
        context,
        history: (options.history || []).slice(-6),
        missingConcepts: missingAnalysis.missingConcepts,
      });
    } catch (err) {
      console.warn("[neurocore] Error al pedir reply:", err);
    }
  }
  recordTiming(trace, "reply", Date.now() - t4);

  if (!reply) {
    reply = buildFallbackReply(finalActivated, userInput);
    addStep(trace, "fallback_reply_used");
  } else {
    addStep(trace, "reply_received");
  }
  trace.reply = true;

  recordTiming(trace, "total", Date.now() - t0);
  const traceResult = finalizeTrace(trace);

  // ---- 8. Payload para UI ----
  return {
    reply,
    activated:      finalActivated,
    generated,
    trace:          traceResult,
    missingAnalysis,
    premiumDecision,
    dedupeSummary,
  };
}
