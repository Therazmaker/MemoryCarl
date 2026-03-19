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
