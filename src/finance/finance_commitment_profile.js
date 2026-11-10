/**
 * finance_commitment_profile.js — Perfil de un compromiso (alquiler, luz, internet…)
 * MemoryCarl · Finanzas
 *
 * A partir de las instancias mensuales del compromiso (financeCommitmentInstances) y de los
 * movimientos ligados a él (commitmentId en el ledger) arma su historia: cuánto se pagó cada
 * mes frente a lo esperado, si subió o bajó, tendencia, puntualidad y estimación del mes que viene.
 *
 * Lógica pura: recibe la plantilla, las instancias y el ledger.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function monthKeyOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(mk, delta) {
  const [y, m] = mk.split("-").map(Number);
  return monthKeyOf(new Date(y, m - 1 + delta, 1));
}

export function monthShortLabel(mk) {
  const [y, m] = mk.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]}${String(y).slice(2)}`;
}

function fmt(n) {
  const v = round2(n);
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

const PAID_STATUSES = new Set(["paid", "covered_by_debt"]);

/**
 * Historia y estadísticas de un compromiso.
 * @param {object} template - plantilla del compromiso
 * @param {Array} instances - todas las instancias (se filtran por templateId)
 * @param {Array} ledger - movimientos (se usan los que tienen commitmentId de esta plantilla)
 * @param {{ now?: Date, months?: number }} [opts]
 */
export function buildCommitmentProfile(template, instances = [], ledger = [], opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const monthsBack = opts.months || 12;
  const tid = template?.id;
  const ids = new Set([tid, template?.legacyCommitmentId].filter(Boolean));
  const current = monthKeyOf(now);
  const months = Array.from({ length: monthsBack }, (_, i) => shiftMonth(current, i - (monthsBack - 1)));

  const byMonth = new Map();
  for (const inst of instances || []) {
    if (!inst || !ids.has(inst.templateId) || !inst.periodKey) continue;
    byMonth.set(inst.periodKey, inst);
  }
  // Pagos registrados en movimientos (si la instancia no tiene monto pagado)
  const ledgerByMonth = new Map();
  const ledgerDateByMonth = new Map();
  for (const e of ledger || []) {
    if (!e || e.archived || e.type !== "expense" || !ids.has(e.commitmentId)) continue;
    const mk = e.commitmentInstanceId
      ? ([...byMonth.values()].find((i) => i.id === e.commitmentInstanceId)?.periodKey || monthKeyOf(e.date))
      : monthKeyOf(e.date);
    ledgerByMonth.set(mk, (ledgerByMonth.get(mk) || 0) + Math.abs(Number(e.amount) || 0));
    const t = new Date(e.date).getTime();
    if (!ledgerDateByMonth.has(mk) || t < ledgerDateByMonth.get(mk)) ledgerDateByMonth.set(mk, t);
  }

  const base = Number(template?.baseAmount) || 0;
  const series = months.map((mk) => {
    const inst = byMonth.get(mk) || null;
    const expected = inst ? Number(inst.expectedAmount) || 0 : null;
    const instPaid = inst ? Math.max(Number(inst.paidAmount) || 0, PAID_STATUSES.has(String(inst.status)) ? Number(inst.actualAmount) || 0 : 0) : 0;
    const paid = round2(instPaid || ledgerByMonth.get(mk) || 0);
    const dueDay = inst?.dueDate ? Number(String(inst.dueDate).slice(8, 10)) : Number(template?.dueDay) || null;
    const paidAtTs = inst?.paidAt ? new Date(inst.paidAt).getTime() : ledgerDateByMonth.get(mk) || null;
    let onTime = null;
    if (paid > 0 && paidAtTs && dueDay) {
      const [y, m] = mk.split("-").map(Number);
      const due = new Date(y, m - 1, dueDay, 23, 59, 59).getTime();
      onTime = paidAtTs <= due;
    }
    const status = inst ? String(inst.status || "pending") : (paid > 0 ? "paid" : "none");
    return {
      mk,
      label: monthShortLabel(mk),
      expected: expected === null ? null : round2(expected),
      paid,
      status,
      paidAt: paidAtTs ? new Date(paidAtTs).toISOString() : null,
      dueDay,
      onTime,
      isCurrent: mk === current,
    };
  });

  const paidMonths = series.filter((s) => s.paid > 0);
  const values = paidMonths.map((s) => s.paid);
  const avg = values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  const max = paidMonths.reduce((best, s) => (!best || s.paid > best.paid ? s : best), null);
  const min = paidMonths.reduce((best, s) => (!best || s.paid < best.paid ? s : best), null);
  const last = paidMonths[paidMonths.length - 1] || null;
  const prev = paidMonths[paidMonths.length - 2] || null;
  const changeVsPrev = last && prev && prev.paid > 0 ? Math.round(((last.paid - prev.paid) / prev.paid) * 100) : null;

  // Tendencia: pendiente de la recta (S/ por mes) sobre los meses pagados
  let slope = 0;
  if (paidMonths.length >= 3) {
    const xs = paidMonths.map((s) => months.indexOf(s.mk));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = avg;
    let num = 0;
    let den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (values[i] - my); den += (x - mx) ** 2; });
    slope = den ? round2(num / den) : 0;
  }
  const trend = paidMonths.length < 3 || Math.abs(slope) < Math.max(1, avg * 0.01) ? "estable" : slope > 0 ? "sube" : "baja";

  const timed = series.filter((s) => s.onTime !== null);
  const onTimeCount = timed.filter((s) => s.onTime).length;
  const punctuality = timed.length ? Math.round((onTimeCount / timed.length) * 100) : null;
  let streak = 0;
  for (let i = timed.length - 1; i >= 0 && timed[i].onTime; i--) streak++;

  const variable = String(template?.amountMode || "fixed") === "variable" || (values.length >= 3 && max.paid - min.paid > Math.max(5, avg * 0.05));
  const recent = values.slice(-3);
  const forecast = variable && recent.length ? round2(recent.reduce((a, b) => a + b, 0) / recent.length) : round2(base || last?.paid || 0);
  const total12 = round2(values.reduce((a, b) => a + b, 0));

  const insights = [];
  if (last && changeVsPrev !== null && Math.abs(changeVsPrev) >= 3) {
    insights.push({ tone: changeVsPrev > 0 ? "up" : "down", text: `${changeVsPrev > 0 ? "Subió" : "Bajó"} ${Math.abs(changeVsPrev)}% frente al mes anterior (S/ ${fmt(prev.paid)} → S/ ${fmt(last.paid)}).` });
  }
  if (last && max && paidMonths.length >= 4 && last.mk === max.mk) insights.push({ tone: "up", text: `${last.label} fue el pago más alto de los últimos ${monthsBack} meses.` });
  if (last && min && paidMonths.length >= 4 && last.mk === min.mk) insights.push({ tone: "down", text: `${last.label} fue el pago más bajo de los últimos ${monthsBack} meses.` });
  if (trend !== "estable") insights.push({ tone: trend === "sube" ? "up" : "down", text: `Tendencia: ${trend === "sube" ? "sube" : "baja"} unos S/ ${fmt(Math.abs(slope))} por mes.` });
  if (last && avg && paidMonths.length >= 3) {
    const vsAvg = Math.round(((last.paid - avg) / avg) * 100);
    if (Math.abs(vsAvg) >= 10) insights.push({ tone: vsAvg > 0 ? "up" : "down", text: `El último pago está ${Math.abs(vsAvg)}% ${vsAvg > 0 ? "por encima" : "por debajo"} de tu promedio (S/ ${fmt(avg)}).` });
  }
  if (streak >= 3) insights.push({ tone: "good", text: `Llevas ${streak} meses seguidos pagándolo a tiempo.` });
  else if (timed.length >= 3 && punctuality !== null && punctuality < 60) insights.push({ tone: "bad", text: `Sueles pagarlo tarde: a tiempo solo el ${punctuality}% de las veces.` });
  if (!paidMonths.length) insights.push({ tone: "neutral", text: "Aún no hay pagos registrados. El perfil se llena a medida que lo pagues cada mes." });

  return {
    template,
    months,
    series,
    paidCount: paidMonths.length,
    avg,
    max,
    min,
    last,
    prev,
    changeVsPrev,
    slope,
    trend,
    punctuality,
    onTimeCount,
    timedCount: timed.length,
    streak,
    variable,
    forecast,
    total12,
    insights,
  };
}

/** Variación del último pago frente al anterior y los últimos 6 meses pagados (para la tarjeta). */
export function commitmentMiniStats(template, instances = [], ledger = [], opts = {}) {
  const p = buildCommitmentProfile(template, instances, ledger, { ...opts, months: 12 });
  // Solo meses pagados: un mes en curso aún pendiente no debe verse como una caída a 0
  const paid = p.series.filter((s) => s.paid > 0).slice(-6).map((s) => s.paid);
  return { series: paid, changeVsPrev: p.changeVsPrev, paidCount: p.paidCount };
}
