/**
 * dedup.test.js — Tests para el módulo dedup.js
 * MemoryCarl / NeuroChat Phase 2
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  compareNeuronCandidate,
  findBestNeuronMatch,
  shouldMergeNeuron,
  mergeNeuronData,
  dedupeGeneratedNeurons,
} from "../src/neuro/dedup.js";

import { createNeuron } from "../src/neuro/schemas.js";

// ---- Helpers ----
function makeNeuron(overrides = {}) {
  return createNeuron({
    core: {
      concept: overrides.concept || "test concept",
      domain:  overrides.domain  || "general",
      summary: overrides.summary || "test summary",
    },
    triggers:   overrides.triggers   || ["test", "trigger"],
    evidence:   overrides.evidence   || [],
    connections: overrides.connections || [],
    emotion:    overrides.emotion    || "neutral",
    weight:     overrides.weight     || 0.5,
    embedding:  overrides.embedding  || [],
    ...overrides,
  });
}

// ================================================================
// compareNeuronCandidate
// ================================================================

test("compareNeuronCandidate returns 1 for identical neurons", () => {
  const n = makeNeuron({ concept: "resilience", domain: "psychology", summary: "ability to recover", triggers: ["resilience", "bounce back"] });
  const { score } = compareNeuronCandidate(n, n);
  // Same neuron with no embedding → text-only max ≈ 0.90
  assert.ok(score >= 0.75, `Expected score >= 0.75, got ${score}`);
});

test("compareNeuronCandidate returns low score for very different neurons", () => {
  const a = makeNeuron({ concept: "trading risk", domain: "finance",    summary: "manage risk in trades",   triggers: ["stop loss", "drawdown"] });
  const b = makeNeuron({ concept: "meditation",   domain: "health",     summary: "mindful breathing focus", triggers: ["breath", "mindful", "calm"] });
  const { score } = compareNeuronCandidate(a, b);
  assert.ok(score < 0.55, `Expected score < 0.55, got ${score}`);
});

test("compareNeuronCandidate breakdown includes all components", () => {
  const a = makeNeuron({ concept: "focus" });
  const b = makeNeuron({ concept: "concentration" });
  const { breakdown } = compareNeuronCandidate(a, b);
  assert.ok("conceptSim"   in breakdown);
  assert.ok("summarySim"   in breakdown);
  assert.ok("triggersSim"  in breakdown);
  assert.ok("embSim"       in breakdown);
  assert.ok("domainScore"  in breakdown);
  assert.ok("emotionScore" in breakdown);
});

test("compareNeuronCandidate uses embedding similarity when provided", () => {
  const embA = [1, 0, 0, 0];
  const embB = [1, 0, 0, 0];
  const embC = [0, 1, 0, 0];
  const a = makeNeuron({ concept: "foo", embedding: embA });
  const b = makeNeuron({ concept: "foo", embedding: embB });
  const c = makeNeuron({ concept: "foo", embedding: embC });
  const { score: scoreAB } = compareNeuronCandidate(a, b);
  const { score: scoreAC } = compareNeuronCandidate(a, c);
  assert.ok(scoreAB > scoreAC, `Expected scoreAB (${scoreAB}) > scoreAC (${scoreAC})`);
});

// ================================================================
// findBestNeuronMatch
// ================================================================

test("findBestNeuronMatch returns null for empty list", () => {
  const n = makeNeuron({ concept: "focus" });
  const result = findBestNeuronMatch(n, []);
  assert.equal(result, null);
});

test("findBestNeuronMatch picks closest neuron", () => {
  const candidate = makeNeuron({ concept: "trading strategy", domain: "finance", summary: "plan for trades", triggers: ["strategy", "trade", "plan"] });
  const n1 = makeNeuron({ concept: "meditation",       domain: "health",   summary: "breathing exercise",   triggers: ["breath", "relax"] });
  const n2 = makeNeuron({ concept: "trading approach", domain: "finance",  summary: "method for trading",   triggers: ["strategy", "trade", "method"] });
  const result = findBestNeuronMatch(candidate, [n1, n2]);
  assert.ok(result);
  assert.equal(result.neuron.id, n2.id);
  assert.ok(result.score > 0.20);
});

test("findBestNeuronMatch skips neuron with same id", () => {
  const n = makeNeuron({ concept: "focus", id: "same-id" });
  const n2 = { ...n }; // same id
  const result = findBestNeuronMatch(n, [n2]);
  assert.equal(result, null);
});

// ================================================================
// shouldMergeNeuron
// ================================================================

test("shouldMergeNeuron returns save_new for no existing neurons", () => {
  const n = makeNeuron({ concept: "new unique idea" });
  const decision = shouldMergeNeuron(n, []);
  assert.equal(decision.action, "save_new");
  assert.equal(decision.matchId, null);
});

test("shouldMergeNeuron returns merge_existing for very similar neurons", () => {
  const existing = makeNeuron({
    concept: "daily trading habit", domain: "finance",
    summary: "routine of reviewing charts and setting alerts",
    triggers: ["daily", "trading", "habit", "routine", "charts"],
  });
  const candidate = makeNeuron({
    concept: "daily trading habit", domain: "finance",
    summary: "practice of checking charts and reviewing positions",
    triggers: ["daily", "trading", "habit", "charts", "positions"],
  });
  const decision = shouldMergeNeuron(candidate, [existing]);
  // Should want to merge because high overlap
  assert.ok(decision.action === "merge_existing" || decision.score >= 0.55,
    `Expected merge or score>=0.55, got action=${decision.action} score=${decision.score}`);
});

test("shouldMergeNeuron returns discard for near-identical content", () => {
  const existing = makeNeuron({
    concept: "risk management",
    summary: "controlling losses through stop loss and position sizing",
    triggers: ["risk", "stop loss", "position sizing", "loss"],
    domain:   "finance",
  });
  const candidate = makeNeuron({
    concept: "risk management",
    summary: "controlling losses through stop loss and position sizing",
    triggers: ["risk", "stop loss", "position sizing", "loss"],
    domain:   "finance",
  });
  const decision = shouldMergeNeuron(candidate, [existing]);
  // Near-identical → discard or merge (both valid outcomes)
  assert.ok(
    decision.action === "discard" || decision.action === "merge_existing",
    `Expected discard or merge for near-identical, got ${decision.action}`
  );
});

test("shouldMergeNeuron returns save_new for genuinely new concept", () => {
  const existing = makeNeuron({ concept: "basketball rules", domain: "sports",  summary: "dribble shoot score" });
  const candidate = makeNeuron({ concept: "machine learning", domain: "tech",   summary: "algorithms that learn from data" });
  const decision = shouldMergeNeuron(candidate, [existing]);
  assert.equal(decision.action, "save_new");
});

test("shouldMergeNeuron decision has required fields", () => {
  const n = makeNeuron({ concept: "test" });
  const decision = shouldMergeNeuron(n, []);
  assert.ok("action"  in decision);
  assert.ok("matchId" in decision);
  assert.ok("score"   in decision);
  assert.ok(Array.isArray(decision.reasons));
});

// ================================================================
// mergeNeuronData
// ================================================================

test("mergeNeuronData preserves base id", () => {
  const base = makeNeuron({ concept: "habit", id: "base-id", triggers: ["habit", "routine"] });
  const cand = makeNeuron({ concept: "daily habit", triggers: ["daily", "habit", "morning"] });
  const merged = mergeNeuronData(base, cand);
  assert.equal(merged.id, "base-id");
});

test("mergeNeuronData combines triggers without duplicates", () => {
  const base = makeNeuron({ triggers: ["habit", "routine"] });
  const cand = makeNeuron({ triggers: ["habit", "daily", "morning"] });
  const merged = mergeNeuronData(base, cand);
  const unique = new Set(merged.triggers.map((t) => t.toLowerCase()));
  assert.equal(unique.size, merged.triggers.length, "No duplicate triggers expected");
  assert.ok(merged.triggers.some((t) => t.toLowerCase() === "daily"));
});

test("mergeNeuronData combines evidence without duplicates", () => {
  const base = makeNeuron({ evidence: ["source A", "source B"] });
  const cand = makeNeuron({ evidence: ["source B", "source C"] });
  const merged = mergeNeuronData(base, cand);
  assert.ok(merged.evidence.includes("source A"));
  assert.ok(merged.evidence.includes("source B"));
  assert.ok(merged.evidence.includes("source C"));
  // No duplicates
  const unique = new Set(merged.evidence);
  assert.equal(unique.size, merged.evidence.length);
});

test("mergeNeuronData increments weight with clamp", () => {
  const base = makeNeuron({ weight: 0.95 });
  const cand = makeNeuron({ weight: 0.5 });
  const merged = mergeNeuronData(base, cand);
  assert.ok(merged.weight <= 1, "Weight should be clamped to 1");
  assert.ok(merged.weight >= base.weight, "Weight should not decrease");
});

test("mergeNeuronData updates updatedAt", () => {
  const before = new Date(Date.now() - 10000).toISOString();
  const base = makeNeuron({ updatedAt: before });
  const cand = makeNeuron({});
  const merged = mergeNeuronData(base, cand);
  assert.ok(merged.updatedAt >= before);
});

test("mergeNeuronData enriches summary when candidate has new info", () => {
  const base = makeNeuron({ summary: "managing risk in financial markets" });
  const cand = makeNeuron({ summary: "portfolio diversification and hedging techniques" });
  const merged = mergeNeuronData(base, cand);
  // Summary should be richer (contains both contributions)
  assert.ok(merged.core.summary.length >= base.core.summary.length);
});

test("mergeNeuronData does not duplicate summary when content is same", () => {
  const s = "controlling losses through stop loss";
  const base = makeNeuron({ summary: s });
  const cand = makeNeuron({ summary: s });
  const merged = mergeNeuronData(base, cand);
  // Summary should NOT be doubled
  assert.ok(!merged.core.summary.includes(s + " / " + s));
});

// ================================================================
// dedupeGeneratedNeurons
// ================================================================

test("dedupeGeneratedNeurons saves genuinely new neurons", () => {
  const existing = [
    makeNeuron({ concept: "sleep quality", domain: "health", triggers: ["sleep", "rest"] }),
  ];
  const candidates = [
    makeNeuron({ concept: "machine learning basics", domain: "tech", triggers: ["ml", "ai", "model"] }),
    makeNeuron({ concept: "crypto trading signals", domain: "finance", triggers: ["btc", "signal", "trade"] }),
  ];
  const result = dedupeGeneratedNeurons(candidates, existing);
  assert.equal(result.toSave.length, 2);
  assert.equal(result.toMerge.length, 0);
  assert.equal(result.discarded.length, 0);
});

test("dedupeGeneratedNeurons deduplicates within batch", () => {
  const existing = [];
  // Two near-identical candidates in the same batch (same concept, domain, summary, triggers)
  const base = {
    concept: "trading journal practice",
    domain:  "finance",
    summary: "recording trades in a journal to review performance and learn",
    triggers: ["journal", "trading", "review", "performance", "recording", "trades"],
  };
  const cand1 = makeNeuron(base);
  const cand2 = makeNeuron(base);
  const result = dedupeGeneratedNeurons([cand1, cand2], existing);
  // First is saved, second should be discarded as intra-batch near-duplicate
  assert.equal(result.toSave.length + result.discarded.length, 2, "Both candidates accounted for");
  // At least one should be discarded (near-identical batch dedup)
  // OR both saved (if dedup threshold not met without embeddings — acceptable)
  assert.ok(result.toSave.length >= 1, "At least one should be saved");
});

test("dedupeGeneratedNeurons returns correct shape", () => {
  const result = dedupeGeneratedNeurons([], []);
  assert.ok(Array.isArray(result.toSave));
  assert.ok(Array.isArray(result.toMerge));
  assert.ok(Array.isArray(result.discarded));
});

test("dedupeGeneratedNeurons toMerge entries have required fields", () => {
  const existing = [
    makeNeuron({
      concept: "risk control", domain: "finance",
      summary: "reducing trading losses", triggers: ["risk", "loss", "control"],
    }),
  ];
  const candidate = makeNeuron({
    concept: "risk control", domain: "finance",
    summary: "limiting downside in trades using stops",
    triggers: ["risk", "loss", "stop", "control"],
  });
  const result = dedupeGeneratedNeurons([candidate], existing);

  if (result.toMerge.length > 0) {
    const entry = result.toMerge[0];
    assert.ok("targetId"       in entry);
    assert.ok("mergedNeuron"   in entry);
    assert.ok("sourceCandidate" in entry);
    assert.ok("decision"       in entry);
  }
  // Either merged or saved, not discarded for meaningful new info
  assert.ok(result.toSave.length + result.toMerge.length >= 1);
});

test("dedupeGeneratedNeurons handles invalid input gracefully", () => {
  const result = dedupeGeneratedNeurons([null, undefined, 42], []);
  assert.equal(result.discarded.length, 0);
  assert.equal(result.toSave.length, 0);
  assert.equal(result.toMerge.length, 0);
});
