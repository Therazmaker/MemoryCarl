function mk(id, type, priority, title, message, confidence, evidence, relatedNeuronIds, periodScope) {
  return { id, type, priority, title, message, confidence, evidence, relatedNeuronIds, periodScope, createdAt: new Date().toISOString() };
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

  return insights.slice(0, 8);
}
