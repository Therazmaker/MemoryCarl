function summarize(entries = []) {
  const income = entries.filter((e) => e.direction === 'income').reduce((a, e) => a + e.amount, 0);
  const expenses = entries.filter((e) => e.direction !== 'income').reduce((a, e) => a + e.amount, 0);
  const fixed = entries.filter((e) => e.impactMode === 'fixed').reduce((a, e) => a + e.amount, 0);
  const variable = Math.max(0, expenses - fixed);
  const debtOutflow = entries.filter((e) => e.isDebtRelated).reduce((a, e) => a + e.amount, 0);
  return {
    totalIncome: income,
    totalExpenses: expenses,
    fixedVsVariable: { fixed, variable },
    debtRelatedOutflow: debtOutflow,
    marginEstimate: income - expenses,
    pressureScore: expenses > 0 ? Math.min(1, (expenses - income > 0 ? 0.7 : 0.3) + (debtOutflow / Math.max(1, expenses))) : 0,
    leakScore: entries.filter((e) => e.derivedLabels.includes('silent_leak_candidate')).length / Math.max(1, entries.length)
  };
}

export function updateHippocampus(hippocampus, snapshot, neurons, now = new Date()) {
  const next = {
    daily: { ...(hippocampus?.daily || {}) },
    weekly: { ...(hippocampus?.weekly || {}) },
    monthly: { ...(hippocampus?.monthly || {}) },
    patternHistory: [...(hippocampus?.patternHistory || [])],
    neuronHistory: [...(hippocampus?.neuronHistory || [])]
  };

  const entries = snapshot.entries || [];
  const day = now.toISOString().slice(0, 10);
  const week = entries[0]?.weekKey || `${day}-W`;
  const month = day.slice(0, 7);

  next.daily[day] = summarize(entries.filter((e) => e.dayKey === day));
  next.weekly[week] = summarize(entries.filter((e) => e.weekKey === week));
  next.monthly[month] = summarize(entries.filter((e) => e.monthKey === month));

  next.patternHistory.push({ at: now.toISOString(), recurringCount: entries.filter((e) => e.isRecurring).length, leakCandidates: entries.filter((e) => e.derivedLabels.includes('silent_leak_candidate')).length });
  next.patternHistory = next.patternHistory.slice(-90);
  next.neuronHistory.push({ at: now.toISOString(), active: (neurons || []).map((n) => ({ type: n.type, score: n.score })) });
  next.neuronHistory = next.neuronHistory.slice(-90);

  return next;
}
