import test from "node:test";
import assert from "node:assert/strict";

import { summarizePremiumDecision, isNeuronFeedbackLocked, shouldShowForcePremiumButton, getOverrideResultLabel, viewNeuroChat } from "../src/chat/neurochat-ui.js";
import { renderInsightsPanel } from "../src/chat/insight-ui.js";
import { viewContextWindow } from "../src/chat/context-window-ui.js";

test("UI summary reflects bootstrap activation", () => {
  const summary = summarizePremiumDecision({
    premiumDecision: {
      usePremium: true,
      bootstrapState: { enabled: true, level: "strong" },
      reasons: ["bootstrap mode activo: 4 neuronas"],
    },
  });
  assert.match(summary.badge, /modo semilla/i);
});

test("UI summary explains skipped premium", () => {
  const summary = summarizePremiumDecision({
    premiumDecision: {
      usePremium: false,
      reasons: ["input trivial detectado"],
    },
  });
  assert.match(summary.badge, /omitido/i);
  assert.match(summary.badge, /trivial/i);
});

test("insight UI renderiza sección sin romper", () => {
  const html = renderInsightsPanel([
    {
      id: "i1",
      type: "dominant_pattern",
      title: "Patrón dominante",
      summary: "Lo que aparece aquí es una mezcla de urgencia y dispersión.",
      confidence: 0.78,
      domains: ["work"],
      emotion: "fear",
      basedOnNeurons: ["n1", "n2"],
      signals: { manualEntities: ["Fergis"] },
      recurrent: true,
    },
  ], "Lectura breve");
  assert.match(html, /Lectura del momento/i);
  assert.match(html, /Patrón dominante/i);
});

test("context window UI renderiza filtros temporales", () => {
  const html = viewContextWindow();
  assert.match(html, /cwFilterTimeContext/i);
  assert.match(html, /cwFilterDateFrom/i);
  // Historical import is now in the "Histórico" tab
  assert.match(html, /Hist/i);
  assert.match(html, /json_import/i);
});

test("UI bloquea feedback duplicado por neurona y mensaje", () => {
  const map = { n1: "like" };
  assert.equal(isNeuronFeedbackLocked(map, "n1"), true);
  assert.equal(isNeuronFeedbackLocked(map, "n2"), false);
});

test("UI muestra botón Forzar Gemini cuando aplica", () => {
  const should = shouldShowForcePremiumButton({
    messageId: "m1",
    premiumDecision: { usePremium: false },
    missingAnalysis: { coverage: 0.3 },
    neuronSuggestion: { hasSuggestion: true },
    trace: { classifier: { features: { tokenCount: 12 } } },
  });
  assert.equal(should, true);
});

test("UI puede mostrar estado de aprendizaje forzado completado", () => {
  const label = getOverrideResultLabel({
    premiumForcedSuccess: true,
    generated: [{ id: "n1" }],
  });
  assert.match(label, /completado/i);
  const html = viewNeuroChat();
  assert.match(html, /NeuroChat/i);
});
