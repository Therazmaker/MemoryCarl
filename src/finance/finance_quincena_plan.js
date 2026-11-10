/**
 * finance_quincena_plan.js — Plan de quincenas de Mission Control
 * MemoryCarl · Finanzas
 *
 * El usuario escribe cuánto cree que recibirá el 15 y a fin de mes, y reparte a mano
 * qué paga con cada quincena (completo o un adelanto: "a Carlos Emilio le debo 200,
 * el 15 le adelanto 100"). Si lo asignado al fin de mes no alcanza con lo de fin de mes,
 * la diferencia hay que guardarla de la quincena del 15.
 *
 * Lógica pura: recibe el plan guardado y las obligaciones del mes (financeMissionControlModel).
 */

export const PERIODS = [
  { id: "q15", label: "Quincena del 15", short: "15", day: 15 },
  { id: "q30", label: "Fin de mes", short: "30", day: 30 },
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function emptyPeriod() {
  return { income: 0, rows: [] };
}

export function emptyPlan() {
  return { periods: { q15: emptyPeriod(), q30: emptyPeriod() }, updatedAt: null, history: [] };
}

/** Plan del mes con forma segura. */
export function normalizePlan(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const periods = {};
  for (const { id } of PERIODS) {
    const src = p.periods?.[id] || {};
    periods[id] = {
      income: Math.max(0, Number(src.income) || 0),
      rows: (Array.isArray(src.rows) ? src.rows : [])
        .filter((r) => r && r.id)
        .map((r) => ({
          id: String(r.id),
          itemId: r.itemId ? String(r.itemId) : null,
          label: String(r.label || "").slice(0, 80),
          amount: Math.max(0, Number(r.amount) || 0),
          note: String(r.note || "").slice(0, 120),
          done: !!r.done,
        })),
    };
  }
  return {
    periods,
    updatedAt: p.updatedAt || null,
    history: Array.isArray(p.history) ? p.history.slice(-20) : [],
  };
}

/** En qué quincena cae un día del mes (1–15 → 15, 16–31 → fin de mes). */
export function periodForDay(day) {
  return Number(day) <= 15 ? "q15" : "q30";
}

/**
 * Cálculo del plan.
 * @param {object} rawPlan
 * @param {Array} items - obligaciones del mes ({ id, name, amount, dueDay, status, type, paidAmount })
 */
export function computeQuincenaPlan(rawPlan, items = []) {
  const plan = normalizePlan(rawPlan);
  const byId = new Map((items || []).filter((i) => i && i.id).map((i) => [i.id, i]));
  const assigned = new Map();
  for (const { id } of PERIODS) {
    for (const r of plan.periods[id].rows) {
      if (r.itemId) assigned.set(r.itemId, (assigned.get(r.itemId) || 0) + r.amount);
    }
  }

  const periods = {};
  for (const def of PERIODS) {
    const per = plan.periods[def.id];
    const rows = per.rows.map((r) => {
      const item = r.itemId ? byId.get(r.itemId) : null;
      return {
        ...r,
        label: r.label || item?.name || "Pago",
        item: item || null,
        missing: !!r.itemId && !item, // la obligación ya no existe este mes
        partial: !!item && r.amount + 0.009 < Number(item.amount || 0),
        itemTotal: item ? round2(item.amount) : null,
        itemPaid: item?.status === "paid",
      };
    });
    const allocated = round2(rows.reduce((s, r) => s + r.amount, 0));
    periods[def.id] = { ...def, income: per.income, rows, allocated, balance: round2(per.income - allocated) };
  }

  // Lo que falta en fin de mes se guarda de la quincena del 15
  const q15 = periods.q15;
  const q30 = periods.q30;
  q30.reserveNeeded = q30.balance < 0 ? round2(-q30.balance) : 0;
  q15.reserveForNext = q30.reserveNeeded;
  q15.free = round2(q15.balance - q15.reserveForNext);
  q30.free = round2(Math.max(0, q30.balance));
  q15.shortfall = q15.free < 0 ? round2(-q15.free) : 0;

  const unassigned = (items || [])
    .filter((i) => i && i.status !== "paid" && Number(i.amount) > 0)
    .map((i) => {
      const remaining = round2(Number(i.amount) - (assigned.get(i.id) || 0));
      return { ...i, assignedAmount: round2(assigned.get(i.id) || 0), remaining, suggested: periodForDay(i.dueDay) };
    })
    .filter((i) => i.remaining > 0.009)
    .sort((a, b) => (a.dueDay || 1) - (b.dueDay || 1));

  const totalIncome = round2(q15.income + q30.income);
  const totalAllocated = round2(q15.allocated + q30.allocated);
  const unassignedTotal = round2(unassigned.reduce((s, i) => s + i.remaining, 0));

  const warnings = [];
  if (q30.reserveNeeded > 0) warnings.push({ level: "warn", text: `Lo del fin de mes no alcanza: guarda S/ ${fmt(q30.reserveNeeded)} de la quincena del 15.` });
  if (q15.shortfall > 0) warnings.push({ level: "bad", text: `Con lo que esperas recibir faltan S/ ${fmt(q15.shortfall)} en el mes.` });
  const newUnexpected = unassigned.filter((i) => i.type === "unexpected");
  for (const u of newUnexpected) warnings.push({ level: "warn", text: `Imprevisto sin ubicar: ${u.name} (S/ ${fmt(u.remaining)}).`, itemId: u.id });

  return {
    plan,
    periods,
    unassigned,
    unassignedTotal,
    totalIncome,
    totalAllocated,
    freeMonth: round2(totalIncome - totalAllocated),
    // Lo que sobraría si además se pagara lo que aún no está en el plan
    freeAfterAll: round2(totalIncome - totalAllocated - unassignedTotal),
    hasPlan: totalIncome > 0 || totalAllocated > 0,
    warnings,
  };
}

function fmt(n) {
  const v = round2(n);
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

/**
 * Tarjeta de texto del plan para el Copiloto Estratégico Unificado.
 * Vacía si no hay plan.
 */
export function buildQuincenaPlanCard(rawPlan, items = [], { monthLabel = "" } = {}) {
  const c = computeQuincenaPlan(rawPlan, items);
  if (!c.hasPlan) return "";
  const lines = [`PLAN DE QUINCENAS${monthLabel ? ` (${monthLabel})` : ""}, hecho a mano por el usuario:`];
  for (const def of PERIODS) {
    const p = c.periods[def.id];
    lines.push(`- ${def.label}: espera recibir S/ ${fmt(p.income)}; asignó S/ ${fmt(p.allocated)}.`);
    for (const r of p.rows) {
      const extra = [
        r.partial ? `adelanto de S/ ${fmt(r.itemTotal)}` : "",
        r.partial && /^adelanto$/i.test(r.note.trim()) ? "" : r.note,
        r.done || r.itemPaid ? "ya hecho" : "",
      ].filter(Boolean).join(", ");
      lines.push(`  · ${r.label}: S/ ${fmt(r.amount)}${extra ? ` (${extra})` : ""}`);
    }
  }
  if (c.periods.q30.reserveNeeded > 0) lines.push(`- La quincena del 15 NO se puede gastar entera: hay que guardar S/ ${fmt(c.periods.q30.reserveNeeded)} para cubrir el fin de mes.`);
  lines.push(`- Libre real de la quincena del 15: S/ ${fmt(c.periods.q15.free)}. Libre de fin de mes: S/ ${fmt(c.periods.q30.free)}.`);
  if (c.unassigned.length) {
    lines.push(`- Pendientes que aún no están en el plan (S/ ${fmt(c.unassignedTotal)}): ${c.unassigned.slice(0, 6).map((i) => `${i.name} S/ ${fmt(i.remaining)}${i.type === "unexpected" ? " (imprevisto)" : ""}`).join("; ")}.`);
  }
  const recent = (c.plan.history || []).slice(-3);
  if (recent.length) lines.push(`- Cambios recientes del plan: ${recent.map((h) => h.text).join("; ")}.`);
  lines.push("Respeta este orden al aconsejar: no propongas gastar lo que está reservado y, si hay un imprevisto, sugiere de qué fila del plan sacarlo.");
  return lines.join("\n");
}
