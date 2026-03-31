import { getRankedEpisodicNeurons } from './finance_episodic_memory.js';

function mk(id, type, priority, title, message, confidence, evidence, relatedNeuronIds, periodScope, extras = {}) {
  return {
    id,
    type,
    priority,
    title,
    message,
    confidence,
    evidence,
    relatedNeuronIds,
    periodScope,
    createdAt: new Date().toISOString(),
    ...extras,
  };
}

export function generateFinanceInsights({ snapshot, neurons, hippocampus }) {
  const insights = [];
  const monthKey = new Date().toISOString().slice(0, 7);
  const month = (hippocampus.monthly || {})[monthKey] || {};
  const leak = (neurons || []).find((n) => n.type === 'silent_leak');
  const recurring = (neurons || []).find((n) => n.type === 'recurring_monthly');

  if (leak && leak.score >= 0.25) {
    insights.push(mk('insight_silent_leak', 'risk', 'high', 'Possible silent leak detected', 'Small recurring outflows appear frequently and may be draining margin.', 0.75, leak.supportingEvidence, [leak.id], 'monthly'));
  }
  if (recurring && recurring.score >= 0.2) {
    insights.push(mk('insight_recurring_cluster', 'habit', 'medium', 'Recurring payment cluster detected', 'A recurring payment cluster appears near similar windows in the month.', 0.74, recurring.supportingEvidence, [recurring.id], 'monthly'));
  }
  if ((month.marginEstimate || 0) < 0) {
    insights.push(mk('insight_pressure', 'risk', 'critical', 'Margin under pressure', 'Expenses are exceeding income in the current monthly memory window.', 0.8, month, [], 'monthly'));
  }
  if ((month.marginEstimate || 0) > 0 && (month.fixedVsVariable?.variable || 0) < (month.totalExpenses || 0) * 0.35) {
    insights.push(mk('insight_opportunity', 'opportunity', 'medium', 'Potential debt reduction window', 'Discretionary spending is contained; this may be a good window to reduce debt.', 0.67, month, [], 'monthly'));
  }

  const episodic = getRankedEpisodicNeurons(10);
  const silentHabits = episodic.filter((n) => (
    n.stats?.dominantContext === 'habito'
    && n.stats?.frequency === 'weekly'
    && n.stats?.dominantEmotion === 'evitable'
  ));
  const anomalies = episodic.filter((n) => n.episodes?.slice(-1)?.[0]?.wasAnomaly === true);
  const growing = episodic.filter((n) => n.stats?.trend === 'growing' && n.family === 'habit');

  silentHabits.slice(0, 2).forEach((n, idx) => {
    const lastEpisode = n.episodes?.slice(-1)?.[0] || null;
    insights.push(mk(
      `episodic_silent_habit_${n.id}_${idx}`,
      'risk',
      'medium',
      `Hábito silencioso: ${n.manualLabel || n.label}`,
      `La neurona ${n.manualLabel || n.label} se repite semanalmente y suele sentirse evitable.`,
      0.71,
      n.stats,
      [n.id],
      'episodic',
      { neuronId: n.id, episodeRef: lastEpisode?.movementId || null }
    ));
  });

  anomalies.slice(0, 2).forEach((n, idx) => {
    const lastEpisode = n.episodes?.slice(-1)?.[0] || null;
    insights.push(mk(
      `episodic_anomaly_${n.id}_${idx}`,
      'risk',
      'high',
      `Anomalía detectada en ${n.manualLabel || n.label}`,
      'El último episodio superó el rango típico de esta neurona episódica.',
      0.78,
      lastEpisode,
      [n.id],
      'episodic',
      { neuronId: n.id, episodeRef: lastEpisode?.movementId || null }
    ));
  });

  growing.slice(0, 2).forEach((n, idx) => {
    const lastEpisode = n.episodes?.slice(-1)?.[0] || null;
    insights.push(mk(
      `episodic_growing_${n.id}_${idx}`,
      'risk',
      'medium',
      `Neurona en crecimiento: ${n.manualLabel || n.label}`,
      'Este hábito viene creciendo frente al bloque anterior y podría requerir control.',
      0.69,
      n.stats,
      [n.id],
      'episodic',
      { neuronId: n.id, episodeRef: lastEpisode?.movementId || null }
    ));
  });

  return insights.slice(0, 8);
}
