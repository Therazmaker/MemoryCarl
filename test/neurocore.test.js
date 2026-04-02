import test from "node:test";
import assert from "node:assert/strict";

const store = {};
if (typeof localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

function resetStorage() { Object.keys(store).forEach((k) => delete store[k]); }

import { processNeuroInput } from "../src/neuro/neurocore.js";
import { saveManyNeurons } from "../src/neuro/neuronStore.js";
import { createNeuron } from "../src/neuro/schemas.js";
import { saveNeuroChatSettings } from "../src/settings/neurochatSettings.js";
import { getPremiumUsageState } from "../src/neuro/premiumUsage.js";

test("neurocore returns bootstrapState and mode in payload", async () => {
  resetStorage();
  const neurons = Array.from({ length: 4 }, (_, i) => createNeuron({
    core: { concept: `concept_${i}`, domain: "personal", summary: `summary ${i}` },
    triggers: ["ansiedad", "diario", `tag_${i}`],
    weight: 0.6,
  }));
  saveManyNeurons(neurons);

  const result = await processNeuroInput("Hoy en mi diario sentí ansiedad y aprendí algo.", {
    mode: "journal",
    skipGeneration: true,
    history: [],
  });

  assert.equal(result.mode, "journal");
  assert.equal(result.bootstrapState.enabled, true);
  assert.equal(result.bootstrapState.level, "strong");
  assert.equal(result.trace.mode, "journal");
  assert.ok(result.trace.bootstrapState);
  assert.ok(result.premiumDecision.rulePath.startsWith("bootstrap_"));
});

test("neurocore includes activatedManual and contextEntities when input mentions alias", async () => {
  resetStorage();
  saveManyNeurons([
    createNeuron({
      id: "m_fergis",
      type: "person",
      core: { concept: "Fergis", domain: "relationships", summary: "pareja" },
      source: { kind: "manual", ref: "context_window" },
      meta: { aliases: ["mi esposa"], manualCategory: "people", priority: "high", pin: true },
    }),
    createNeuron({ id: "p1", type: "project", core: { concept: "Proyecto Atlas", domain: "work", summary: "proyecto actual" } }),
  ]);

  const result = await processNeuroInput("Mi esposa está estresada por el proyecto", { skipGeneration: true, history: [] });
  assert.ok(Array.isArray(result.activatedManual));
  assert.ok(result.activatedManual.some((m) => m.concept === "Fergis"));
  assert.ok(result.contextEntities.includes("Fergis"));
});

test("neurocore devuelve insights en payload", async () => {
  resetStorage();
  saveManyNeurons([
    createNeuron({ id: "n1", core: { concept: "saturación", domain: "emocional", summary: "muchas tareas abiertas" }, triggers: ["saturación", "bloqueo"], emotion: "fear", weight: 0.8 }),
    createNeuron({ id: "n2", core: { concept: "quiero avanzar", domain: "work", summary: "dispersión al iniciar" }, triggers: ["quiero", "avanzar", "dispersión"], emotion: "fear", weight: 0.7 }),
  ]);

  const result = await processNeuroInput("Quiero avanzar pero tengo demasiadas tareas y me bloqueo", {
    skipGeneration: true,
    history: [],
    interpretationMode: "objective",
  });

  assert.ok(Array.isArray(result.insights));
  assert.ok(result.insights.length >= 1);
  assert.equal(result.interpretationMode, "objective");
});

test("reply autónomo conserva insights y contexto temporal", async () => {
  resetStorage();
  saveManyNeurons([
    createNeuron({ id: "n1", core: { concept: "bloqueo", domain: "emocional", summary: "inicio frenado" }, triggers: ["bloqueo"], emotion: "fear", weight: 0.8 }),
    createNeuron({ id: "n2", core: { concept: "Proyecto Atlas", domain: "work", summary: "presión por entrega" }, triggers: ["proyecto", "urgencia"], weight: 0.6 }),
  ]);

  localStorage.setItem("memorycarl_v2_neuroclaw_ai_url", "https://api.example.com");
  localStorage.setItem("memorycarl_v2_neuroclaw_ai_key", "test_key");

  let capturedBody = null;
  globalThis.fetch = async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ reply: "ok" }),
    };
  };

  const result = await processNeuroInput("Hay urgencia en el proyecto y me bloqueo", { skipGeneration: true, history: [] });
  assert.ok(typeof result.reply === "string" && result.reply.length > 0);
  if(capturedBody){
    assert.ok(Array.isArray(capturedBody.insights));
    assert.ok(capturedBody.insights.length >= 1);
    assert.ok(capturedBody.temporalContext);
    assert.ok(["present", "past", "mixed"].includes(capturedBody.temporalContext.orientation));
  }else{
    assert.ok(Array.isArray(result.insights));
    assert.ok(result.insights.length >= 1);
    assert.ok(result.temporalContext);
    assert.ok(["present", "past", "mixed"].includes(result.temporalContext.orientation));
  }
});

test("neurocore incluye messageId y feedback summary en trace", async () => {
  resetStorage();
  saveManyNeurons([
    createNeuron({
      id: "n_fb_trace",
      core: { concept: "foco", domain: "work", summary: "foco profundo" },
      triggers: ["foco", "trabajo"],
      feedbackStats: { likes: 2, dislikes: 1, netScore: 1 },
      activationLearning: { usefulCount: 2, falsePositiveCount: 1 },
      weight: 0.7,
    }),
  ]);

  const result = await processNeuroInput("Necesito foco en el trabajo", {
    skipGeneration: true,
    history: [],
    messageId: "msg_trace_1",
  });

  assert.equal(result.messageId, "msg_trace_1");
  assert.ok(result.trace.feedbackSummary);
  assert.ok(typeof result.trace.feedbackSummary.totalLikes === "number");
});

test("premiumDecision=false pero manual override=true ejecuta premium y marca trace", async () => {
  resetStorage();
  saveNeuroChatSettings({ enabled: true, apiKey: "AIzaTestKey123456789" });
  localStorage.setItem("memorycarl_v2_neuroclaw_ai_url", "https://api.example.com");
  localStorage.setItem("memorycarl_v2_neuroclaw_ai_key", "test_key");

  globalThis.fetch = async (url) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ neurons: [{ type: "pattern", core: { concept: "Terapia psicológica", domain: "personal", summary: "Proceso terapéutico" }, triggers: ["terapia", "sesión"] }] }) }] },
          }],
        }),
      };
    }
    return { ok: true, json: async () => ({ reply: "ok" }) };
  };

  const before = getPremiumUsageState().used;
  const result = await processNeuroInput("Tuve una sesión de terapia y aprendí algo fuerte sobre mí.", {
    history: [],
    manualPremiumOverride: true,
    forceGeneration: true,
    premiumOptions: { coverageThreshold: 0.05 },
    messageId: "msg_override_1",
  });

  const after = getPremiumUsageState().used;
  assert.equal(result.premiumDecision.usePremium, false);
  assert.equal(result.manualOverrideUsed, true);
  assert.equal(result.generatedBy, "manual_override");
  assert.equal(result.trace.generatedBy, "manual_override");
  assert.equal(after, before + 1);
});

test("si falla Gemini forzado no incrementa usage", async () => {
  resetStorage();
  saveNeuroChatSettings({ enabled: true, apiKey: "AIzaTestKey123456789" });
  localStorage.setItem("memorycarl_v2_neuroclaw_ai_url", "https://api.example.com");
  localStorage.setItem("memorycarl_v2_neuroclaw_ai_key", "test_key");
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return { ok: false, status: 500, text: async () => "boom" };
    }
    if (opts?.body) return { ok: true, json: async () => ([]) };
    return { ok: true, json: async () => ({ reply: "ok" }) };
  };

  const before = getPremiumUsageState().used;
  const result = await processNeuroInput("Mensaje para forzar premium aunque falle", {
    history: [],
    manualPremiumOverride: true,
    forceGeneration: true,
    messageId: "msg_override_2",
  });
  const after = getPremiumUsageState().used;
  assert.equal(result.premiumForcedSuccess, false);
  assert.equal(after, before);
});


test("neurocore limita selección final a top 5 y agrega trace de selección", async () => {
  resetStorage();
  const neurons = Array.from({ length: 12 }, (_, i) => createNeuron({
    id: `sel_${i}`,
    core: { concept: `concepto ${i}`, domain: "personal", summary: `resumen único ${i}` },
    triggers: ["ansiedad", "diario", `tag_${i}`, `clave_${i}`],
    weight: 0.6 - i * 0.01,
  }));
  saveManyNeurons(neurons);

  const result = await processNeuroInput("Hoy en mi diario tuve ansiedad y aprendí sobre mi enfoque", {
    skipGeneration: true,
    history: [],
  });

  assert.ok(result.activated.length <= 5);
  assert.ok(result.trace.selection);
  assert.equal(typeof result.trace.selection.bridgeSuggested, "boolean");
  assert.ok(Array.isArray(result.trace.selection.top10));
});

test("neurocore ejecuta evolución ligera post-response", async () => {
  resetStorage();
  saveManyNeurons([
    createNeuron({
      id: "n_evo_core",
      core: { concept: "terapia psicológica", domain: "health", summary: "proceso terapéutico" },
      triggers: ["terapia"],
      weight: 0.5,
    }),
  ]);

  const result = await processNeuroInput("Mi psicólogo me ayudó en esta sesión de terapia", {
    skipGeneration: true,
    history: [],
  });

  assert.ok(result.trace.evolution);
  assert.ok(result.trace.evolution.neuronsEvolvedCount >= 1);
});
