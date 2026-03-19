/**
 * neurocore.js — Orquestador central del sistema NeuroChat
 * MemoryCarl
 *
 * Flujo:
 *   1. Carga neuronas
 *   2. Activa neuronas relevantes
 *   3. Analiza cobertura / detecta huecos
 *   4. Si coverage < umbral → genera nuevas neuronas via NeuroClaw
 *   5. Conecta y guarda neuronas nuevas
 *   6. Construye contexto final
 *   7. Solicita respuesta final a NeuroClaw (con fallback)
 *   8. Devuelve payload completo para UI
 */

import { getAllNeurons, saveManyNeurons }     from "./neuronStore.js";
import { activateNeurons }                    from "./activation.js";
import { detectMissingConcepts, generateMissingNeurons } from "./generator.js";
import { findRelatedNeurons, attachConnections }          from "./connections.js";
import { getEmbedding }                       from "./embeddings.js";
import { createTrace, addStep, recordTiming, finalizeTrace } from "./trace.js";
import { requestChatReply, isNeuroclawConfigured }        from "../services/neuroclawClient.js";
import { updateNeuron }                       from "./neuronStore.js";

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

  // ---- 4 & 5. Generar y guardar nuevas neuronas si hace falta ----
  let generated = [];
  if (!options.skipGeneration && missingAnalysis.needsGeneration && isNeuroclawConfigured()) {
    addStep(trace, "generation_triggered");
    const t3 = Date.now();
    try {
      const rawGenerated = await generateMissingNeurons({ userInput, activatedNeurons: activated, missingAnalysis });
      recordTiming(trace, "generation", Date.now() - t3);

      if (rawGenerated.length > 0) {
        // Precomputar embeddings para las neuronas nuevas
        for (const n of rawGenerated) {
          if (!n.embedding || n.embedding.length === 0) {
            const text = [n.core.concept, n.core.summary, ...n.triggers].join(" ");
            n.embedding = await getEmbedding(text);
          }
        }

        // Conectar con neuronas existentes
        const allAfterActivation = getAllNeurons();
        for (const n of rawGenerated) {
          const related = await findRelatedNeurons(n, [...allAfterActivation, ...rawGenerated]);
          attachConnections(n, related);
        }

        // Persistir (también actualiza conexiones inversas en store)
        saveManyNeurons(rawGenerated);

        // Actualizar conexiones inversas en las neuronas ya guardadas
        for (const n of rawGenerated) {
          for (const connId of n.connections) {
            try {
              const existing = allAfterActivation.find((x) => x.id === connId);
              if (existing && !existing.connections.includes(n.id)) {
                updateNeuron(connId, { connections: [...existing.connections, n.id] });
              }
            } catch (_e) {}
          }
        }

        generated = rawGenerated;
        trace.generated = generated.length;
        addStep(trace, "neurons_generated", { count: generated.length });
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
  // Re-activar incluyendo neuronas nuevas si las hay
  const finalNeurons = generated.length > 0 ? getAllNeurons() : allNeurons;
  const finalActivated = generated.length > 0
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
        history: (options.history || []).slice(-6), // últimos 6 mensajes
        missingConcepts: missingAnalysis.missingConcepts,
      });
    } catch (err) {
      console.warn("[neurocore] Error al pedir reply:", err);
    }
  }
  recordTiming(trace, "reply", Date.now() - t4);

  // Fallback si NeuroClaw no respondió
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
    activated: finalActivated,
    generated,
    trace:     traceResult,
    missingAnalysis,
  };
}
