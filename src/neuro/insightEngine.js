/**
 * insightEngine.js — Orquesta clustering + patrones + síntesis + historial
 */

import { buildInsightClusters, detectInsightPatterns } from "./insightPatterns.js";
import { synthesizeInsights } from "./insightSynthesis.js";
import { getInsightHistory, saveInsightBatch, findRecentSimilarInsights, summarizeInsightTrend } from "./insightHistory.js";

export async function runInsightEngine({ activated = [], allNeurons = [], contextEntities = [], options = {} } = {}) {
  const interpretationMode = options.interpretationMode || "default";
  if (!Array.isArray(activated) || activated.length === 0) {
    return { insights: [], insightSummary: "", clusters: [], patterns: [], trend: null };
  }

  const history = getInsightHistory({ maxHistory: options.maxHistory });
  const clusters = buildInsightClusters(activated, allNeurons, options);
  const patterns = detectInsightPatterns({ activated, clusters, insightHistory: history, options: { ...options, interpretationMode } });

  const insights = synthesizeInsights({
    activated,
    clusters,
    patterns,
    contextEntities,
    options: { ...options, interpretationMode },
  });

  const recurrence = findRecentSimilarInsights(insights, { history, minSimilarity: 0.55 });
  const enrichedInsights = insights.map((insight) => {
    const rec = recurrence.find((r) => r.insightId === insight.id);
    return {
      ...insight,
      signals: {
        ...insight.signals,
        recurrenceScore: rec?.recurrenceScore || insight.signals?.recurrenceScore || 0,
      },
      recurrent: Boolean(rec?.isRecurrent),
    };
  });

  if (enrichedInsights.length > 0) {
    saveInsightBatch(enrichedInsights, { maxHistory: options.maxHistory, batchAt: new Date().toISOString() });
  }

  const trend = summarizeInsightTrend(getInsightHistory({ maxHistory: options.maxHistory }));
  const insightSummary = enrichedInsights.length
    ? enrichedInsights.map((i) => i.summary).slice(0, 2).join(" ")
    : (trend?.summary || "");

  return {
    insights: enrichedInsights,
    insightSummary,
    clusters,
    patterns,
    trend,
  };
}

export { buildInsightClusters } from "./insightPatterns.js";
export { synthesizeInsights } from "./insightSynthesis.js";
