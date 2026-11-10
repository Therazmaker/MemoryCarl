/**
 * finance_quincena_plan.js — Plan de quincenas (Mission Control y Hoja de Ruta)
 * MemoryCarl · Finanzas
 *
 * Cada mes tiene dos cobros: el 15 y el último. En cada uno cobran dos personas: el usuario
 * ("me") y Fergis ("fergis"). El usuario reparte a mano qué se paga con cada cobro y quién
 * lo paga, completo o un adelanto ("a Carlos Emilio le debo 200, el 15 le adelanto 100").
 *
 * Reglas:
 * - Lo que cada persona asigna al último y no le alcanza con lo que cobra el último, lo
 *   tiene que guardar de SU cobro del 15 (la quincena no se puede gastar entera).
 * - Si a una persona no le alcanza y a la otra le sobra, se avisa (pueden cubrirse entre sí).
 *
 * Lógica pura: recibe el plan guardado y las obligaciones del mes (financeMissionControlModel).
 */

export const PERIODS = [
  { id: "q15", label: "Quincena del 15", short: "15", day: 15 },
  { id: "q30", label: "Último del mes", short: "Últ", day: 30 },
];

export const PEOPLE = [
  { id: "me", label: "Tú", emoji: "🧑" },
  { id: "fergis", label: "Fergis", emoji: "💜" },
];

const PAYERS = new Set(PEOPLE.map((p) => p.id));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function emptyPeriod() {
  return { income: 0, fergisIncome: 0, rows: [] };
}

export function emptyPlan() {
  return { periods: { q15: emptyPeriod(), q30: emptyPeriod() }, updatedAt: null, history: [] };
}

/** Ingreso guardado de una persona en un cobro. */
export function incomeKey(person) {
  return person === "fergis" ? "fergisIncome" : "income";
}

/** Plan del mes con forma segura. */
export function normalizePlan(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const periods = {};
  for (const { id } of PERIODS) {
    const src = p.periods?.[id] || {};
    periods[id] = {
      income: Math.max(0, Number(src.income) || 0),
      fergisIncome: Math.max(0, Number(src.fergisIncome) || 0),
      rows: (Array.isArray(src.rows) ? src.rows : [])
        .filter((r) => r && r.id)
        .map((r) => ({
          id: String(r.id),
          itemId: r.itemId ? String(r.itemId) : null,
          label: String(r.label || "").slice(0, 80),
          amount: Math.max(0, Number(r.amount) || 0),
          note: String(r.note || "").slice(0, 120),
          done: !!r.done,
          payer: PAYERS.has(r.payer) ? r.payer : "me",
        })),
    };
  }
  return {
    periods,
    updatedAt: p.updatedAt || null,
    history: Array.isArray(p.history) ? p.history.slice(-20) : [],
  };
}

/**
 * Con qué cobro conviene pagar algo según su día de vencimiento:
 * lo que vence del 15 al 29 sale de la quincena del 15; lo que vence el último o en los
 * primeros días (1–14) sale de lo que se cobra el último.
 */
export function periodForDay(day, lastDay = 30) {
  const d = Number(day) || 1;
  return d >= 15 && d < lastDay ? "q15" : "q30";
}

/** true si el pago vence antes de que llegue el dinero con que se planeó pagarlo. */
function dueBeforePay(periodId, dueDay, lastDay = 30) {
  const d = Number(dueDay);
  if (!d) return false;
  // El cobro del "último" llega el último día real del mes (28–31)
  return periodId === "q15" ? d < 15 : d >= 15 && d < lastDay;
}

/**
 * Cálculo del plan.
 * @param {object} rawPlan
 * @param {Array} items - obligaciones del mes ({ id, name, amount, dueDay, status, type, paidAmount })
 * @param {{ lastDay?: number }} [opts] - último día del mes (día del cobro del último)
 */
export function computeQuincenaPlan(rawPlan, items = [], { lastDay = 30 } = {}) {
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
        dueDay: item?.dueDay || null,
        late: dueBeforePay(def.id, item?.dueDay, lastDay),
        missing: !!r.itemId && !item, // la obligación ya no existe este mes
        partial: !!item && r.amount + 0.009 < Number(item.amount || 0),
        itemTotal: item ? round2(item.amount) : null,
        itemPaid: item?.status === "paid",
      };
    });
    const people = {};
    for (const person of PEOPLE) {
      const income = per[incomeKey(person.id)];
      const allocated = round2(rows.filter((r) => r.payer === person.id).reduce((s, r) => s + r.amount, 0));
      people[person.id] = { ...person, income, allocated, balance: round2(income - allocated) };
    }
    const income = round2(people.me.income + people.fergis.income);
    const allocated = round2(people.me.allocated + people.fergis.allocated);
    periods[def.id] = { ...def, income, rows, allocated, balance: round2(income - allocated), people };
  }

  // Por persona: lo que falta en el último se guarda de su quincena del 15
  const q15 = periods.q15;
  const q30 = periods.q30;
  for (const { id } of PEOPLE) {
    const a = q15.people[id];
    const b = q30.people[id];
    b.reserveNeeded = b.balance < 0 ? round2(-b.balance) : 0;
    a.reserveForNext = b.reserveNeeded;
    a.free = round2(a.balance - a.reserveForNext);
    b.free = round2(Math.max(0, b.balance));
    a.shortfall = a.free < 0 ? round2(-a.free) : 0;
  }
  const sumPeople = (period, key) => round2(period.people.me[key] + period.people.fergis[key]);
  q30.reserveNeeded = sumPeople(q30, "reserveNeeded");
  q15.reserveForNext = sumPeople(q15, "reserveForNext");
  q15.free = sumPeople(q15, "free");
  q30.free = sumPeople(q30, "free");
  q15.shortfall = q15.free < 0 ? round2(-q15.free) : 0;

  const unassigned = (items || [])
    .filter((i) => i && i.status !== "paid" && Number(i.amount) > 0)
    .map((i) => {
      const remaining = round2(Number(i.amount) - (assigned.get(i.id) || 0));
      return { ...i, assignedAmount: round2(assigned.get(i.id) || 0), remaining, suggested: periodForDay(i.dueDay, lastDay) };
    })
    .filter((i) => i.remaining > 0.009)
    .sort((a, b) => (a.dueDay || 1) - (b.dueDay || 1));

  const totalIncome = round2(q15.income + q30.income);
  const totalAllocated = round2(q15.allocated + q30.allocated);
  const unassignedTotal = round2(unassigned.reduce((s, i) => s + i.remaining, 0));
  const usesFergis = q15.people.fergis.income + q30.people.fergis.income + q15.people.fergis.allocated + q30.people.fergis.allocated > 0;

  const people = {};
  for (const person of PEOPLE) {
    const a = q15.people[person.id];
    const b = q30.people[person.id];
    people[person.id] = {
      ...person,
      income: round2(a.income + b.income),
      allocated: round2(a.allocated + b.allocated),
      free: round2(a.free + b.free),
      reserve: a.reserveForNext,
      shortfall: a.shortfall,
    };
  }

  const who = (id) => (usesFergis ? (id === "me" ? "Tú: " : "Fergis: ") : "");
  const warnings = [];
  for (const { id } of PEOPLE) {
    const a = q15.people[id];
    if (a.reserveForNext > 0) warnings.push({ level: "warn", person: id, text: `${who(id)}lo del último no alcanza; guarda S/ ${fmt(a.reserveForNext)} de la quincena del 15.` });
    if (a.shortfall > 0) {
      const other = id === "me" ? people.fergis : people.me;
      const cover = usesFergis && other.free > 0 ? ` ${other.id === "me" ? "A ti te" : "A Fergis le"} sobran S/ ${fmt(other.free)}: pueden cubrirlo entre los dos.` : "";
      warnings.push({ level: "bad", person: id, text: `${who(id)}con lo que esperas cobrar faltan S/ ${fmt(a.shortfall)} en el mes.${cover}` });
    }
  }
  const lateRows = [...q15.rows, ...q30.rows].filter((r) => r.late && !r.itemPaid && !r.done);
  for (const r of lateRows.slice(0, 3)) {
    warnings.push({ level: "warn", text: `${r.label} vence el día ${r.dueDay}, antes de cobrar el ${r.late && q15.rows.includes(r) ? "15" : "último"}: págalo con lo que ya tienes o muévelo.` });
  }
  for (const u of unassigned.filter((i) => i.type === "unexpected")) {
    warnings.push({ level: "warn", text: `Imprevisto sin ubicar: ${u.name} (S/ ${fmt(u.remaining)}).`, itemId: u.id });
  }

  return {
    plan,
    periods,
    people,
    usesFergis,
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

/**
 * Línea de caja del mes: cobros (día 15 y último) y pagos del plan en orden de fecha,
 * con el saldo acumulado de cada persona. Un pago se ubica en su día de vencimiento,
 * pero nunca antes del cobro con que se planeó pagarlo.
 */
export function buildCashTimeline(rawPlan, items = [], { lastDay = 30 } = {}) {
  const c = computeQuincenaPlan(rawPlan, items, { lastDay });
  const events = [];
  for (const def of PERIODS) {
    const p = c.periods[def.id];
    const payDay = def.id === "q15" ? 15 : lastDay;
    for (const person of PEOPLE) {
      const inc = p.people[person.id].income;
      if (inc > 0) events.push({ day: payDay, kind: "in", person: person.id, label: `Cobro ${person.label === "Tú" ? "tuyo" : "de Fergis"}`, amount: inc, order: 0 });
    }
    p.rows.forEach((r, idx) => {
      const due = Number(r.dueDay) || payDay;
      events.push({ day: Math.max(payDay, Math.min(lastDay, due)), kind: "out", person: r.payer, label: r.label, amount: r.amount, done: r.done || r.itemPaid, rowId: r.id, period: def.id, order: 1 + idx });
    });
  }
  events.sort((a, b) => a.day - b.day || a.order - b.order);
  const bal = { me: 0, fergis: 0 };
  let lowest = { me: 0, fergis: 0 };
  for (const e of events) {
    bal[e.person] = round2(bal[e.person] + (e.kind === "in" ? e.amount : -e.amount));
    e.balance = { ...bal };
    e.total = round2(bal.me + bal.fergis);
    lowest = { me: Math.min(lowest.me, bal.me), fergis: Math.min(lowest.fergis, bal.fergis) };
  }
  return { events, end: { ...bal, total: round2(bal.me + bal.fergis) }, lowest };
}

function fmt(n) {
  const v = round2(n);
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

/**
 * Tarjeta de texto del plan para el Copiloto Estratégico Unificado y para Carl.
 * Vacía si no hay plan.
 */
export function buildQuincenaPlanCard(rawPlan, items = [], { monthLabel = "", lastDay = 30 } = {}) {
  const c = computeQuincenaPlan(rawPlan, items, { lastDay });
  if (!c.hasPlan) return "";
  const lines = [`PLAN DE QUINCENAS${monthLabel ? ` (${monthLabel})` : ""}, hecho a mano por el usuario${c.usesFergis ? " junto con Fergis (su pareja, también cobra el 15 y el último)" : ""}:`];
  for (const def of PERIODS) {
    const p = c.periods[def.id];
    const inc = c.usesFergis
      ? `usuario S/ ${fmt(p.people.me.income)} + Fergis S/ ${fmt(p.people.fergis.income)}`
      : `S/ ${fmt(p.income)}`;
    lines.push(`- ${def.label}: espera recibir ${inc}; asignó S/ ${fmt(p.allocated)}.`);
    for (const r of p.rows) {
      const extra = [
        c.usesFergis ? (r.payer === "fergis" ? "paga Fergis" : "paga el usuario") : "",
        r.partial ? `adelanto de S/ ${fmt(r.itemTotal)}` : "",
        r.partial && /^adelanto$/i.test(r.note.trim()) ? "" : r.note,
        r.late ? `vence el día ${r.dueDay}, antes de ese cobro` : "",
        r.done || r.itemPaid ? "ya hecho" : "",
      ].filter(Boolean).join(", ");
      lines.push(`  · ${r.label}: S/ ${fmt(r.amount)}${extra ? ` (${extra})` : ""}`);
    }
  }
  for (const person of PEOPLE) {
    const pr = c.people[person.id];
    if (person.id === "fergis" && !c.usesFergis) continue;
    if (pr.reserve <= 0) continue;
    if (!c.usesFergis) lines.push(`- La quincena del 15 NO se puede gastar entera: hay que guardar S/ ${fmt(pr.reserve)} para cubrir el último.`);
    else lines.push(`- ${person.id === "me" ? "El usuario" : "Fergis"} NO puede gastar entera su quincena del 15: hay que guardar S/ ${fmt(pr.reserve)} para cubrir su último.`);
  }
  if (c.usesFergis) {
    lines.push(`- Libre del usuario en el mes: S/ ${fmt(c.people.me.free)} (del 15: S/ ${fmt(c.periods.q15.people.me.free)}). Libre de Fergis: S/ ${fmt(c.people.fergis.free)} (del 15: S/ ${fmt(c.periods.q15.people.fergis.free)}).`);
  } else {
    lines.push(`- Libre real de la quincena del 15: S/ ${fmt(c.periods.q15.free)}. Libre del último: S/ ${fmt(c.periods.q30.free)}.`);
  }
  if (c.unassigned.length) {
    lines.push(`- Pendientes que aún no están en el plan (S/ ${fmt(c.unassignedTotal)}): ${c.unassigned.slice(0, 6).map((i) => `${i.name} S/ ${fmt(i.remaining)}${i.type === "unexpected" ? " (imprevisto)" : ""}`).join("; ")}.`);
  }
  const recent = (c.plan.history || []).slice(-3);
  if (recent.length) lines.push(`- Cambios recientes del plan: ${recent.map((h) => h.text).join("; ")}.`);
  lines.push("Respeta este orden al aconsejar: no propongas gastar lo que está reservado, respeta quién paga cada cosa y, si hay un imprevisto, sugiere de qué fila del plan (y de quién) sacarlo.");
  return lines.join("\n");
}
