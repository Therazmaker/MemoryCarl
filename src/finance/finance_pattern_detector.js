function makeNeuron({ id, type, family, score, confidence, supportingEvidence, lastActivatedAt }) {
  return { id, type, family, score, confidence, supportingEvidence, lastActivatedAt };
}

function keyByType(neurons) {
  const map = new Map();
  for (const n of neurons || []) map.set(n.type, n);
  return map;
}

export function detectPatternNeurons(snapshot, existing = [], now = new Date().toISOString()) {
  const entries = snapshot.entries || [];
  const expenses = entries.filter((e) => e.direction === 'expense');
  const income = entries.filter((e) => e.direction === 'income');
  const debt = entries.filter((e) => e.isDebtRelated || e.direction === 'debt');
  const silentLeak = expenses.filter((e) => e.derivedLabels.includes('silent_leak_candidate') || (e.amount <= 60 && e.isRecurring));
  const recurringMonthly = expenses.filter((e) => e.isRecurring && e.recurrencePeriodDays === 30);

  const candidates = [];
  if (income.length) candidates.push(makeNeuron({ id: 'flow_income_fixed', type: 'income_fixed', family: 'flow', score: Math.min(1, income.length / 5), confidence: 0.7, supportingEvidence: income.slice(0, 5), lastActivatedAt: now }));
  if (expenses.length) candidates.push(makeNeuron({ id: 'flow_expense_essential', type: 'expense_essential', family: 'flow', score: Math.min(1, expenses.filter((e) => e.isEssential).length / Math.max(1, expenses.length)), confidence: 0.72, supportingEvidence: expenses.filter((e) => e.isEssential).slice(0, 5), lastActivatedAt: now }));
  if (debt.length) candidates.push(makeNeuron({ id: 'risk_debt_outflow', type: 'debt_outflow', family: 'risk', score: Math.min(1, debt.length / Math.max(1, entries.length)), confidence: 0.74, supportingEvidence: debt.slice(0, 5), lastActivatedAt: now }));
  if (recurringMonthly.length) candidates.push(makeNeuron({ id: 'habit_recurring_monthly', type: 'recurring_monthly', family: 'habit', score: Math.min(1, recurringMonthly.length / Math.max(1, expenses.length)), confidence: 0.78, supportingEvidence: recurringMonthly.slice(0, 5), lastActivatedAt: now }));
  if (silentLeak.length) candidates.push(makeNeuron({ id: 'risk_silent_leak', type: 'silent_leak', family: 'risk', score: Math.min(1, silentLeak.length / Math.max(1, expenses.length)), confidence: 0.75, supportingEvidence: silentLeak.slice(0, 5), lastActivatedAt: now }));

  return mergeNeurons(existing, candidates);
}

export function mergeNeurons(existing = [], incoming = []) {
  const byType = keyByType(existing);
  for (const neuron of incoming) {
    const found = byType.get(neuron.type);
    if (!found) {
      byType.set(neuron.type, neuron);
      continue;
    }
    found.score = Number(((found.score * 0.6) + (neuron.score * 0.4)).toFixed(4));
    found.confidence = Math.max(found.confidence, neuron.confidence);
    found.lastActivatedAt = neuron.lastActivatedAt;
    const evidence = [...(found.supportingEvidence || []), ...(neuron.supportingEvidence || [])];
    found.supportingEvidence = evidence.slice(-8);
  }
  return [...byType.values()].sort((a, b) => b.score - a.score);
}
