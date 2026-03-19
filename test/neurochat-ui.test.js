import test from "node:test";
import assert from "node:assert/strict";

import { summarizePremiumDecision } from "../src/chat/neurochat-ui.js";
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
  assert.match(html, /Importación histórica batch/i);
});
