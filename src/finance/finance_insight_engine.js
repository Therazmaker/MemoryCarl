import { getRankedEpisodicNeurons } from './finance_episodic_memory.js';
import { getDebtHistory, getActiveDebts } from './finance_debt_tracker.js';
import { getSourceBreakdown, getMovementsFromSource } from './finance_source_links.js';

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

  // ——— INSIGHT: Deuda recurrente con persona ———
  // Se dispara cuando se abre un ciclo nuevo con alguien que YA tiene historia previa
  try {
    const activeDebts = getActiveDebts();
    activeDebts.forEach(({ person, balance, openedAt, historyCount }) => {
      if (historyCount < 1) return; // sin historia previa → no es recurrente
      const hist = getDebtHistory(person);
      const lastCycle = hist && hist.history && hist.history.slice(-1)[0];
      if (!lastCycle) return;
      const direction = balance > 0 ? 'te debe' : 'le debes';
      const absBalance = Math.abs(balance).toFixed(2);
      let closedInfo = `La cerraste en ${lastCycle.durationDays} días (máx S/${lastCycle.peakAmount?.toFixed(2) || '?'}).`;
      // Mention top dropped category if available
      const topDrop = lastCycle.contextSnapshot?.topCategoryChanges?.[0];
      if (topDrop && topDrop.pctChange < 0) {
        closedInfo += ` En ese periodo, tu gasto en ${topDrop.category} bajó ${Math.abs(topDrop.pctChange)}%.`;
      }
      const unusualIncome = lastCycle.contextSnapshot?.unusualIncome;
      if (unusualIncome) {
        closedInfo += ` Hubo un ingreso no habitual de S/${unusualIncome.amount} el ${unusualIncome.date}.`;
      }
      insights.push(mk(
        `debt_recurring_${person.replace(/\s+/g, '_')}_${Date.now()}`,
        'risk',
        'medium',
        `Deuda recurrente con ${person}`,
        `Ya tuviste una deuda con ${person} antes (${historyCount} ciclo/s). ${closedInfo} Actualmente ${direction} S/${absBalance}.`,
        0.72,
        { person, balance, lastCycle },
        [],
        'debt'
      ));
    });
  } catch(_) {}

  // ——— INSIGHT: Desglose de origen (cuando un ingreso acumula ≥3 gastos enlazados) ———
  try {
    const movements = (window.FINANCE && window.FINANCE.state && window.FINANCE.state.movements) || [];
    const incomes = movements.filter(m => m.type === 'income' && !m.archived);
    incomes.forEach(inc => {
      const linked = getMovementsFromSource(inc.id);
      if (linked.length < 3) return;
      const breakdown = getSourceBreakdown(inc.id);
      if (!breakdown) return;
      const label = inc.note || inc.category || 'ingreso';
      insights.push(mk(
        `source_breakdown_${inc.id}`,
        'habit',
        'low',
        `Desglose de origen: ${label}`,
        `Del ingreso "${label}" (S/${breakdown.originAmount?.toFixed(2)}), ya se fue el ${breakdown.percentUsed}% (S/${breakdown.totalSpent?.toFixed(2)}) en ${breakdown.linkedCount} gastos.`,
        0.65,
        breakdown,
        [],
        'source'
      ));
    });
  } catch(_) {}

  return insights.slice(0, 10);
}
