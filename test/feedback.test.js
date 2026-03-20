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

function resetStorage() {
  Object.keys(store).forEach((k) => delete store[k]);
}

import { createNeuron } from "../src/neuro/schemas.js";
import { saveNeuron } from "../src/neuro/neuronStore.js";
import {
  recordNeuronFeedback,
  getNeuronFeedbackHistory,
  getNeuronFeedbackStats,
  recomputeNeuronWeightFromFeedback,
} from "../src/neuro/feedback.js";

test("recordNeuronFeedback guarda historial y stats", () => {
  resetStorage();
  saveNeuron(createNeuron({ id: "n_feedback_1", core: { concept: "proyecto", domain: "work", summary: "detalle" }, weight: 0.5 }));

  const res = recordNeuronFeedback({ neuronId: "n_feedback_1", feedback: "like", inputPreview: "mensaje útil", messageId: "msg_1" });
  assert.equal(res.applied, true);

  const hist = getNeuronFeedbackHistory("n_feedback_1");
  assert.equal(hist.length, 1);
  assert.equal(hist[0].feedback, "like");
  assert.equal(hist[0].messageId, "msg_1");

  const stats = getNeuronFeedbackStats("n_feedback_1");
  assert.equal(stats.feedbackStats.likes, 1);
  assert.equal(stats.feedbackStats.dislikes, 0);
  assert.equal(stats.activationLearning.usefulCount, 1);
});

test("like incrementa peso con clamp", () => {
  resetStorage();
  saveNeuron(createNeuron({ id: "n_feedback_2", core: { concept: "like", domain: "general", summary: "" }, weight: 0.94 }));
  const res = recordNeuronFeedback({ neuronId: "n_feedback_2", feedback: "like", inputPreview: "ok", messageId: "msg_2" });
  assert.ok(res.neuron.weight >= 0.94);
  assert.ok(res.neuron.weight <= 0.96);
});

test("dislike reduce peso con clamp", () => {
  resetStorage();
  saveNeuron(createNeuron({ id: "n_feedback_3", core: { concept: "dislike", domain: "general", summary: "" }, weight: 0.14 }));
  const res = recordNeuronFeedback({ neuronId: "n_feedback_3", feedback: "dislike", inputPreview: "ruido", messageId: "msg_3" });
  assert.ok(res.neuron.weight <= 0.14);
  assert.ok(res.neuron.weight >= 0.12);
});

test("feedback por neurona y mensaje no se duplica", () => {
  resetStorage();
  saveNeuron(createNeuron({ id: "n_feedback_4", core: { concept: "dup", domain: "general", summary: "" }, weight: 0.5 }));

  const first = recordNeuronFeedback({ neuronId: "n_feedback_4", feedback: "like", inputPreview: "a", messageId: "msg_same" });
  const second = recordNeuronFeedback({ neuronId: "n_feedback_4", feedback: "dislike", inputPreview: "b", messageId: "msg_same" });

  assert.equal(first.applied, true);
  assert.equal(second.duplicate, true);

  const hist = getNeuronFeedbackHistory("n_feedback_4");
  assert.equal(hist.length, 1);
});

test("recomputeNeuronWeightFromFeedback mantiene ajuste suave", () => {
  const n = createNeuron({
    id: "n_feedback_5",
    core: { concept: "balance", domain: "general", summary: "" },
    weight: 0.5,
    feedbackStats: { likes: 8, dislikes: 2, netScore: 6 },
    activationLearning: { usefulCount: 7, falsePositiveCount: 2 },
  });
  const next = recomputeNeuronWeightFromFeedback(n, { feedback: "like" });
  assert.ok(next > 0.5);
  assert.ok(next < 0.8);
});

import {
  getFeedbackAdjustedWeight,
  getNeuronCalibrationSummary,
  getRecentNeuronFeedback,
  applyNeuronFeedbackAndPersist,
} from "../src/neuro/feedback.js";

test("getFeedbackAdjustedWeight: neurona con muchos likes tiene peso mayor", () => {
  const n = createNeuron({
    id: "n_fw_1",
    core: { concept: "fw", domain: "general", summary: "" },
    weight: 0.5,
    feedbackStats: { likes: 10, dislikes: 1, netScore: 9 },
    activationLearning: { usefulCount: 8, falsePositiveCount: 1 },
  });
  const adjusted = getFeedbackAdjustedWeight(n);
  assert.ok(adjusted > 0.5, `adjusted (${adjusted}) debe ser > 0.5`);
});

test("getFeedbackAdjustedWeight: neurona con muchos dislikes tiene peso menor", () => {
  const n = createNeuron({
    id: "n_fw_2",
    core: { concept: "fw2", domain: "general", summary: "" },
    weight: 0.5,
    feedbackStats: { likes: 1, dislikes: 10, netScore: -9 },
    activationLearning: { usefulCount: 1, falsePositiveCount: 8 },
  });
  const adjusted = getFeedbackAdjustedWeight(n);
  assert.ok(adjusted < 0.5, `adjusted (${adjusted}) debe ser < 0.5`);
});

test("getNeuronCalibrationSummary: retorna badge positivo con muchos likes", () => {
  const n = createNeuron({
    id: "n_calib_1",
    core: { concept: "calib", domain: "general", summary: "" },
    weight: 0.5,
    feedbackStats: { likes: 8, dislikes: 1, netScore: 7 },
    activationLearning: { usefulCount: 6, falsePositiveCount: 1 },
  });
  const summary = getNeuronCalibrationSummary(n);
  assert.ok(summary.badge === "very_positive" || summary.badge === "positive");
  assert.ok(summary.netScore > 0);
  assert.equal(summary.likes, 8);
  assert.equal(summary.dislikes, 1);
});

test("getNeuronCalibrationSummary: retorna badge negativo con muchos dislikes", () => {
  const n = createNeuron({
    id: "n_calib_2",
    core: { concept: "calib2", domain: "general", summary: "" },
    weight: 0.4,
    feedbackStats: { likes: 1, dislikes: 8, netScore: -7 },
    activationLearning: { usefulCount: 1, falsePositiveCount: 6 },
  });
  const summary = getNeuronCalibrationSummary(n);
  assert.ok(summary.badge === "very_negative" || summary.badge === "negative");
  assert.ok(summary.netScore < 0);
});

test("getNeuronCalibrationSummary: retorna neutral para neurona sin feedback", () => {
  const n = createNeuron({
    id: "n_calib_3",
    core: { concept: "calib3", domain: "general", summary: "" },
    weight: 0.5,
  });
  const summary = getNeuronCalibrationSummary(n);
  assert.equal(summary.badge, "neutral");
  assert.equal(summary.totalVotes, 0);
});

test("getRecentNeuronFeedback: retorna últimos N feedbacks", () => {
  resetStorage();
  saveNeuron(createNeuron({ id: "n_recent_1", core: { concept: "recent", domain: "general", summary: "" }, weight: 0.5 }));
  recordNeuronFeedback({ neuronId: "n_recent_1", feedback: "like", inputPreview: "msg1", messageId: "msg_1" });
  recordNeuronFeedback({ neuronId: "n_recent_1", feedback: "dislike", inputPreview: "msg2", messageId: "msg_2" });
  recordNeuronFeedback({ neuronId: "n_recent_1", feedback: "like", inputPreview: "msg3", messageId: "msg_3" });

  const recent = getRecentNeuronFeedback("n_recent_1", 2);
  assert.equal(recent.length, 2);
  // Should be ordered most recent first
  assert.ok(recent[0].timestamp >= recent[1].timestamp);
});

test("applyNeuronFeedbackAndPersist: es alias de recordNeuronFeedback", () => {
  resetStorage();
  saveNeuron(createNeuron({ id: "n_alias_1", core: { concept: "alias", domain: "general", summary: "" }, weight: 0.5 }));
  const res = applyNeuronFeedbackAndPersist({ neuronId: "n_alias_1", feedback: "like", inputPreview: "ok", messageId: "msg_alias" });
  assert.equal(res.applied, true);
  assert.equal(res.neuron.feedbackStats.likes, 1);
});
