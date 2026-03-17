function toDate(value) {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function weekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function inferDirection(m) {
  const type = String(m.type || '').toLowerCase();
  if (type.includes('income') || Number(m.amount) > 0) return 'income';
  if (type.includes('transfer')) return 'transfer';
  if (type.includes('debt') || type.includes('loan')) return 'debt';
  if (type.includes('adjust')) return 'adjustment';
  return 'expense';
}

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^a-záéíóúñ0-9]+/i).filter(Boolean);
}

function inferLabels({ category, note, amount, direction }) {
  const tokens = tokenize(`${category} ${note}`);
  const labels = [];
  const includes = (arr) => arr.some((t) => tokens.includes(t));
  if (includes(['renta', 'alquiler', 'luz', 'agua', 'internet', 'colegio', 'seguro', 'cuota'])) labels.push('fixed_obligation');
  if (includes(['uber', 'taxi', 'bus', 'transporte', 'gasolina', 'combustible'])) labels.push('mobility');
  if (includes(['comida', 'mercado', 'supermercado', 'farmacia'])) labels.push('maintenance');
  if (includes(['suscripcion', 'suscripción', 'streaming', 'comision', 'comisión'])) labels.push('silent_leak_candidate');
  if (includes(['deuda', 'prestamo', 'préstamo', 'tarjeta', 'credito', 'crédito'])) labels.push('debt_related');
  if (direction === 'expense' && amount <= 60) labels.push('micro_outflow');
  return labels;
}

export function buildFinanceSnapshot(input = {}) {
  const source = Array.isArray(input.movements) ? input.movements : [];
  const accountsById = new Map((input.accounts || []).map((a) => [a.id, a]));

  const entries = source.map((m) => {
    const dt = toDate(m.date || m.createdAt);
    const amountRaw = Number(m.amount || m.monto || 0);
    const direction = inferDirection(m);
    const amount = Math.abs(amountRaw);
    const category = m.category || m.reason || m.nombre || 'Uncategorized';
    const note = m.note || m.notes || m.notas || '';
    const labels = inferLabels({ category, note, amount, direction });
    const recurringScore = labels.includes('fixed_obligation') ? 0.8 : labels.includes('silent_leak_candidate') ? 0.7 : 0.35;
    const volatilityScore = amount > 0 ? Math.min(1, amount / 1000) : 0;
    const predictabilityScore = labels.includes('fixed_obligation') ? 0.8 : 0.45;
    const strainScore = direction === 'expense' ? Math.min(1, amount / 700) : 0;
    const account = accountsById.get(m.accountId) || {};

    return {
      id: m.id || `${dayKey(dt)}_${category}_${amount}`,
      date: dayKey(dt),
      timestamp: dt.toISOString(),
      monthKey: dayKey(dt).slice(0, 7),
      weekKey: weekKey(dt),
      dayKey: dayKey(dt),
      amount,
      direction,
      category,
      subcategory: m.subcategory || null,
      note,
      accountId: m.accountId || null,
      accountType: account.type || null,
      obligationId: m.obligationId || null,
      commitmentId: m.commitmentId || null,
      sourceKind: m.sourceKind || 'manual',
      counterparty: m.counterparty || null,
      tags: Array.isArray(m.tags) ? m.tags : [],
      isEssential: labels.includes('fixed_obligation') || labels.includes('maintenance'),
      isRecurring: recurringScore >= 0.65,
      recurringScore,
      recurrencePeriodDays: labels.includes('fixed_obligation') ? 30 : null,
      isDebtRelated: labels.includes('debt_related'),
      isThirdPartyFunded: Boolean(m.thirdPartyFunded),
      affectsCashflow: direction !== 'transfer',
      impactMode: labels.includes('fixed_obligation') ? 'fixed' : 'variable',
      volatilityScore,
      predictabilityScore,
      urgencyScore: labels.includes('fixed_obligation') ? 0.7 : 0.35,
      strainScore,
      derivedLabels: labels
    };
  });

  return {
    entries,
    totals: entries.reduce((acc, e) => {
      if (e.direction === 'income') acc.income += e.amount;
      else if (e.direction === 'expense' || e.direction === 'debt') acc.expense += e.amount;
      return acc;
    }, { income: 0, expense: 0 })
  };
}
