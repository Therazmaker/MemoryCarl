/**
 * feedback.js — Feedback explícito sobre neuronas activadas
 */

import { clamp } from "./utils.js";
import { getNeuronById, updateNeuron } from "./neuronStore.js";

const FEEDBACK_STORE_KEY = "memorycarl_neurochat_feedback_history";
const MAX_FEEDBACK_ITEMS = 5000;

function normalizeFeedbackStats(stats = {}) {
  const likes = Number(stats.likes) || 0;
  const dislikes = Number(stats.dislikes) || 0;
  return {
    likes,
    dislikes,
    netScore: likes - dislikes,
    lastFeedbackAt: stats.lastFeedbackAt || null,
  };
}

function normalizeActivationLearning(learning = {}) {
  return {
    usefulCount: Number(learning.usefulCount) || 0,
    falsePositiveCount: Number(learning.falsePositiveCount) || 0,
  };
}

function readHistory() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(FEEDBACK_STORE_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function writeHistory(items) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(FEEDBACK_STORE_KEY, JSON.stringify(items.slice(-MAX_FEEDBACK_ITEMS)));
  } catch (_e) {}
}

function createFeedbackId() {
  return `feedback_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function applyNeuronFeedback(neuron, feedback, options = {}) {
  if (!neuron || typeof neuron !== "object") return null;
  if (feedback !== "like" && feedback !== "dislike") return null;

  const now = new Date().toISOString();
  const stats = normalizeFeedbackStats(neuron.feedbackStats);
  const learning = normalizeActivationLearning(neuron.activationLearning);

  if (feedback === "like") {
    stats.likes += 1;
    learning.usefulCount += 1;
  } else {
    stats.dislikes += 1;
    learning.falsePositiveCount += 1;
  }

  stats.netScore = stats.likes - stats.dislikes;
  stats.lastFeedbackAt = now;

  const updated = {
    ...neuron,
    feedbackStats: stats,
    activationLearning: learning,
    updatedAt: now,
  };

  updated.weight = recomputeNeuronWeightFromFeedback(updated, {
    ...options,
    feedback,
  });

  return updated;
}

export function recomputeNeuronWeightFromFeedback(neuron, options = {}) {
  const stats = normalizeFeedbackStats(neuron?.feedbackStats);
  const learning = normalizeActivationLearning(neuron?.activationLearning);
  const current = clamp(Number(neuron?.weight ?? 0.5), 0, 1);

  const totalVotes = stats.likes + stats.dislikes;
  const netVoteSignal = totalVotes > 0 ? (stats.netScore / totalVotes) : 0;
  const learningTotal = learning.usefulCount + learning.falsePositiveCount;
  const netLearningSignal = learningTotal > 0
    ? (learning.usefulCount - learning.falsePositiveCount) / learningTotal
    : 0;

  const blendedSignal = netVoteSignal * 0.6 + netLearningSignal * 0.4;
  const confidence = Math.min(totalVotes / 12, 1);
  const targetWeight = clamp(0.5 + blendedSignal * 0.18, 0.2, 0.9);

  let recomputed = current + (targetWeight - current) * (0.18 * confidence);

  const immediateNudge = options.feedback === "like"
    ? 0.015
    : options.feedback === "dislike"
      ? -0.018
      : 0;

  recomputed = clamp(recomputed + immediateNudge, 0.12, 0.96);
  return Number(recomputed.toFixed(4));
}

export function recordNeuronFeedback({ neuronId, feedback, inputPreview = "", messageId = null } = {}) {
  if (!neuronId || (feedback !== "like" && feedback !== "dislike")) {
    throw new Error("Feedback inválido");
  }

  const history = readHistory();
  const duplicate = messageId
    ? history.find((item) => item.neuronId === neuronId && item.messageId === messageId)
    : null;

  if (duplicate) {
    return {
      duplicate: true,
      applied: false,
      record: duplicate,
      neuron: getNeuronById(neuronId),
    };
  }

  const neuron = getNeuronById(neuronId);
  if (!neuron) throw new Error(`Neurona no encontrada: ${neuronId}`);

  const record = {
    id: createFeedbackId(),
    neuronId,
    feedback,
    timestamp: new Date().toISOString(),
    inputPreview: String(inputPreview || "").slice(0, 180),
    messageId: messageId || null,
    reasonContext: "user_activation_feedback",
  };

  history.push(record);
  writeHistory(history);

  const updatedNeuron = applyNeuronFeedback(neuron, feedback, { messageId, inputPreview });
  const persisted = updateNeuron(neuronId, {
    feedbackStats: updatedNeuron.feedbackStats,
    activationLearning: updatedNeuron.activationLearning,
    weight: updatedNeuron.weight,
    updatedAt: updatedNeuron.updatedAt,
  });

  return {
    duplicate: false,
    applied: true,
    record,
    neuron: persisted || updatedNeuron,
  };
}

export function getNeuronFeedbackStats(neuronId) {
  const neuron = getNeuronById(neuronId);
  if (!neuron) return null;
  return {
    feedbackStats: normalizeFeedbackStats(neuron.feedbackStats),
    activationLearning: normalizeActivationLearning(neuron.activationLearning),
  };
}

export function getNeuronFeedbackHistory(neuronId, options = {}) {
  const items = readHistory().filter((i) => i.neuronId === neuronId);
  const sorted = items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (options.messageId) return sorted.filter((i) => i.messageId === options.messageId);
  if (options.limit) return sorted.slice(0, Math.max(0, Number(options.limit) || 0));
  return sorted;
}

export function getMessageFeedbackMap(messageId) {
  if (!messageId) return {};
  return readHistory()
    .filter((i) => i.messageId === messageId)
    .reduce((acc, item) => {
      acc[item.neuronId] = item.feedback;
      return acc;
    }, {});
}
