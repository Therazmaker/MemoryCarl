import test from "node:test";
import assert from "node:assert/strict";

import { summarizePremiumDecision } from "../src/chat/neurochat-ui.js";

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
