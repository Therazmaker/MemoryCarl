import test from "node:test";
import assert from "node:assert/strict";

import { classifyInputValue, extractInputSignals } from "../src/neuro/valueClassifier.js";
import { getBootstrapState } from "../src/neuro/bootstrap.js";

test("extractInputSignals detects new personal signals", () => {
  const s = extractInputSignals("Hoy recordé mi infancia, me sentí triste, entendí el patrón, aprendí una lección y escribí mi diario para cerrar en calma.");
  assert.equal(s.appearsJournalLike, true);
  assert.equal(s.mentionsPastOrMemory, true);
  assert.equal(s.hasLearningReflection, true);
  assert.equal(s.hasSelfNarrative, true);
});

test("journal mode boosts medium input", () => {
  const input = "Hoy escribí sobre cómo me sentí en una discusión y qué aprendí.";
  const chat = classifyInputValue(input, { mode: "chat" });
  const journal = classifyInputValue(input, { mode: "journal" });
  assert.ok(journal.score > chat.score);
});

test("autobiography mode boosts more than chat", () => {
  const input = "Recuerdo mi adolescencia y cómo cambió mi forma de relacionarme.";
  const chat = classifyInputValue(input, { mode: "chat" });
  const auto = classifyInputValue(input, { mode: "autobiography" });
  assert.ok(auto.score > chat.score);
});

test("bootstrap can promote personal medium inputs", () => {
  const input = "Hoy me sentí ansioso y entendí por qué reaccioné así en esa situación.";
  const normal = classifyInputValue(input, { mode: "chat", bootstrapState: getBootstrapState(20) });
  const boot = classifyInputValue(input, { mode: "journal", bootstrapState: getBootstrapState(4) });
  assert.ok(boot.score >= normal.score);
  assert.ok(["medium", "high"].includes(boot.label));
});
