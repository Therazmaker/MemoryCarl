/**
 * finance_habits.js — Neuronas financieras: hábitos de dinero, personas y pozos
 * MemoryCarl · Finanzas
 *
 * Una neurona es un HÁBITO (no un movimiento): "Café", "Taxi", "Netflix"… Se arma sola a
 * partir de lo que se escribe en el formulario de movimientos:
 * - Nombre (primera parte de la nota, antes de " · ") → concepto del hábito.
 * - Categoría → agrupa los hábitos (y recoge los gastos sueltos que no se repiten).
 * - Persona (counterparty), préstamo y fiado → neuronas de personas.
 * - Pozo (sourceMovementId) → neuronas de pozos.
 * - Motivo (impulso, emergencia…), quién pagó y la cuenta → rasgos de cada neurona.
 *
 * Lógica pura y sin almacenamiento: recibe el ledger y las preferencias del usuario.
 */

import { buildPools, buildPoolResolver } from "./finance_pools.js";

const DAY = 86400000;

export const HABIT_TAGS = {
  fijo: { label: "Fijo", emoji: "📌", color: "#60a5fa" },
  suscripcion: { label: "Suscripción", emoji: "🔁", color: "#a78bfa" },
  hormiga: { label: "Hormiga", emoji: "🐜", color: "#f87171" },
  antojo: { label: "Antojo", emoji: "🍩", color: "#fb923c" },
  esencial: { label: "Esencial", emoji: "🧺", color: "#34d399" },
  variable: { label: "Variable", emoji: "〰️", color: "#94a3b8" },
  ingreso: { label: "Ingreso", emoji: "💰", color: "#22c55e" },
};

const SUBSCRIPTION_WORDS = ["netflix", "spotify", "youtube", "disney", "prime", "hbo", "max", "icloud", "google one", "chatgpt", "openai", "claude", "suscripcion", "membresia", "gym", "gimnasio", "crunchyroll", "paramount", "apple"];
const FIXED_WORDS = ["alquiler", "renta", "luz", "agua", "gas", "internet", "telefono", "celular", "plan", "cuota", "seguro", "colegio", "mensualidad", "pension", "hipoteca", "prestamo", "tarjeta"];
const ESSENTIAL_WORDS = ["mercado", "supermercado", "alimentos", "salud", "farmacia", "medicina", "pasaje", "transporte", "bus", "hogar", "mascotas", "veterinario", "doctor"];
const STOPWORDS = new Set(["de", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o", "a", "al", "del", "en", "con", "por", "para", "mi", "mis", "su", "sus", "le", "les", "lo", "me", "se", "que", "hoy", "ayer", "noche", "tarde", "manana",
  "pague", "pago", "compre", "compra", "gaste", "gasto", "di", "fue", "ir", "otro", "otra", "algo", "cosas", "varios", "soles", "sol", "s", "usd", "dolares"]);

export function normalize(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

function titleCase(s) {
  const t = String(s || "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

const amountOf = (m) => Math.abs(Number(m?.amount) || 0);
const timeOf = (m) => new Date(m?.date || 0).getTime() || 0;

/** Clave de mes local "YYYY-MM". */
export function monthKeyOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dayKeyOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${monthKeyOf(d)}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftMonth(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKeyOf(d);
}

/** Nombre escrito en el formulario (la nota guarda "Nombre · notas"). */
export function movementName(m) {
  return String(m?.note || "").split(" · ")[0].trim();
}

/** Palabra que da nombre al hábito ("Café con pan" → "cafe"). */
export function conceptOf(m) {
  const words = normalize(movementName(m)).replace(/[^a-z0-9ñ ]/g, " ").split(" ").filter(Boolean);
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    return w;
  }
  return "";
}

export function personKey(name) {
  const n = normalize(name);
  return n ? `p:${n}` : "";
}

function hasWord(text, words) {
  const t = ` ${normalize(text).replace(/[^a-z0-9ñ ]/g, " ")} `;
  return words.some((w) => t.includes(` ${w} `));
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function emptyPrefs() {
  return { merges: {}, labels: {}, verdicts: {}, dismissed: [] };
}

export function normalizePrefs(prefs) {
  const p = prefs && typeof prefs === "object" ? prefs : {};
  return {
    merges: p.merges && typeof p.merges === "object" ? p.merges : {},
    labels: p.labels && typeof p.labels === "object" ? p.labels : {},
    verdicts: p.verdicts && typeof p.verdicts === "object" ? p.verdicts : {},
    dismissed: Array.isArray(p.dismissed) ? p.dismissed : [],
  };
}

/** Sigue las uniones del usuario (A → B → C) sin colgarse con ciclos. */
function resolveMerge(key, merges) {
  const seen = new Set();
  let cur = key;
  while (merges[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = merges[cur];
  }
  return cur;
}

/** Movimientos que cuentan: activos, gastos o ingresos (los traspasos no son hábitos). */
function activeMovements(ledger) {
  return (Array.isArray(ledger) ? ledger : []).filter((m) => m && !m.archived && (m.type === "expense" || m.type === "income") && amountOf(m) > 0 && timeOf(m) > 0);
}

/**
 * Clave de la neurona de un movimiento: `h:<concepto>` si el concepto se repite,
 * si no `c:<categoría>` (o `i:<categoría>` para ingresos).
 */
function rawKeyOf(m, conceptCounts) {
  const cat = normalize(m.category || "otros") || "otros";
  if (m.type === "income") return `i:${cat}`;
  const concept = conceptOf(m);
  if (concept && (conceptCounts.get(concept) || 0) >= 3) return `h:${concept}`;
  return `c:${cat}`;
}

function inferTag({ kind, group, label, category, monthsActive, perMonth, avg, amountSpread, reasons, verdict, count30 }) {
  if (kind === "income") return "ingreso";
  if (verdict === "evitable" && (reasons.impulso || 0) > 0) return "antojo";
  const text = `${label} ${category}`;
  if (hasWord(text, SUBSCRIPTION_WORDS)) return "suscripcion";
  if (hasWord(text, FIXED_WORDS)) return "fijo";
  // Una vez al mes, monto parecido, varios meses → fijo
  if (monthsActive >= 2 && perMonth <= 1.5 && amountSpread <= 0.15) return "fijo";
  const impulse = reasons.impulso || 0;
  const total = Object.values(reasons).reduce((a, b) => a + b, 0) || 1;
  if (impulse / total >= 0.4) return "antojo";
  if (count30 >= 4 && avg <= 30) return "hormiga";
  // Un hábito con nombre propio ("Café") no hereda "esencial" de su categoría ("Alimentos")
  if (hasWord(group === "habit" ? label : text, ESSENTIAL_WORDS)) return "esencial";
  return "variable";
}

/**
 * Construye las neuronas y sus conexiones.
 * @param {Array} ledger - movimientos de finanzas
 * @param {{ now?: Date, prefs?: object, accounts?: Array }} [opts]
 */
export function buildFinanceNeurons(ledger = [], opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const prefs = normalizePrefs(opts.prefs);
  const accounts = new Map((opts.accounts || []).map((a) => [a.id, a]));
  const thisMonth = monthKeyOf(now);
  const prevMonth = shiftMonth(thisMonth, -1);
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(thisMonth, i - 5));
  const since30 = now.getTime() - 30 * DAY;

  const all = activeMovements(ledger);
  const conceptCounts = new Map();
  for (const m of all) {
    if (m.type !== "expense") continue;
    const c = conceptOf(m);
    if (c) conceptCounts.set(c, (conceptCounts.get(c) || 0) + 1);
  }

  const pools = buildPools(ledger);
  const poolById = new Map(pools.map((p) => [p.id, p]));
  const poolOf = buildPoolResolver(ledger);

  const neurons = new Map();
  const people = new Map();
  const edgeMap = new Map();
  const dayHabits = new Map();
  const keyOfMovement = new Map();

  const addEdge = (a, b, kind, amount = 0) => {
    if (!a || !b || a === b) return;
    const [x, y] = a < b ? [a, b] : [b, a];
    const id = `${x}|${y}|${kind}`;
    const e = edgeMap.get(id) || { from: x, to: y, kind, count: 0, amount: 0 };
    e.count++;
    e.amount += amount;
    edgeMap.set(id, e);
  };

  for (const m of all) {
    const key = resolveMerge(rawKeyOf(m, conceptCounts), prefs.merges);
    keyOfMovement.set(m.id, key);
    const amount = amountOf(m);
    const t = timeOf(m);
    const mk = monthKeyOf(new Date(t));
    let n = neurons.get(key);
    if (!n) {
      const kind = key.startsWith("i:") ? "income" : "expense";
      const base = key.slice(2);
      n = {
        key,
        kind,
        group: key.startsWith("h:") ? "habit" : "category",
        label: "",
        category: titleCase(m.category || "Otros"),
        movements: [],
        total: 0,
        byMonth: Object.fromEntries(months.map((k) => [k, 0])),
        reasons: {},
        paidBy: {},
        accounts: {},
        people: {},
        pools: {},
        names: {},
        baseLabel: titleCase(base),
      };
      neurons.set(key, n);
    }
    n.movements.push(m);
    n.total += amount;
    if (mk in n.byMonth) n.byMonth[mk] += amount;
    const reason = normalize(m.reason || "normal") || "normal";
    n.reasons[reason] = (n.reasons[reason] || 0) + 1;
    const payer = m.paidBy || "me";
    n.paidBy[payer] = (n.paidBy[payer] || 0) + 1;
    const accName = accounts.get(m.accountId)?.name;
    if (accName) n.accounts[accName] = (n.accounts[accName] || 0) + 1;
    const nm = movementName(m);
    if (nm) n.names[nm] = (n.names[nm] || 0) + 1;

    // Personas
    const who = String(m.counterparty || "").trim();
    const pk = personKey(who);
    if (pk) {
      const p = people.get(pk) || { key: pk, label: titleCase(who), given: 0, received: 0, lent: 0, owed: 0, count: 0, loans: 0, fiados: 0, last: 0, movements: [] };
      if (m.type === "expense") p.given += amount; else p.received += amount;
      // Deuda: lo prestado (gasto con préstamo) menos lo que entró de esa persona
      // (devoluciones o préstamos recibidos) menos los fiados aún sin pagar (eso lo debe el usuario)
      if (m.type === "expense" && m.isLoan) p.lent += amount;
      if (m.type === "expense" && m.isFiado && m.fiadoStatus !== "paid") p.owed += amount;
      p.count++;
      if (m.isLoan) p.loans++;
      if (m.isFiado) p.fiados++;
      p.last = Math.max(p.last, t);
      p.movements.push(m);
      people.set(pk, p);
      n.people[pk] = (n.people[pk] || 0) + 1;
      addEdge(key, pk, "person", amount);
    }

    // Pozo del que salió el gasto
    if (m.type === "expense") {
      const pid = poolOf(m);
      if (pid && poolById.has(pid)) {
        n.pools[pid] = (n.pools[pid] || 0) + amount;
        addEdge(key, `w:${pid}`, "pool", amount);
      }
      const dk = dayKeyOf(new Date(t));
      const set = dayHabits.get(dk) || new Set();
      set.add(key);
      dayHabits.set(dk, set);
    }
  }

  // Hábitos que suelen ir el mismo día
  const coCount = new Map();
  for (const set of dayHabits.values()) {
    const keys = [...set].sort();
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const id = `${keys[i]}|${keys[j]}`;
        coCount.set(id, (coCount.get(id) || 0) + 1);
      }
    }
  }
  for (const [id, count] of coCount) {
    if (count < 3) continue;
    const [a, b] = id.split("|");
    edgeMap.set(`${a}|${b}|together`, { from: a, to: b, kind: "together", count, amount: 0 });
  }

  // Estadísticas por neurona
  const list = [...neurons.values()].map((n) => {
    const amounts = n.movements.map(amountOf);
    const times = n.movements.map(timeOf).sort((a, b) => a - b);
    const first = times[0];
    const last = times[times.length - 1];
    const count30 = n.movements.filter((m) => timeOf(m) >= since30).length;
    const monthsActive = Object.values(n.byMonth).filter((v) => v > 0).length;
    const spanWeeks = Math.max(1, (now.getTime() - first) / (7 * DAY));
    const perWeek = n.movements.length / spanWeeks;
    const perMonth = n.movements.length / Math.max(1, monthsActive);
    const avg = n.total / Math.max(1, n.movements.length);
    const med = median(amounts);
    const amountSpread = med > 0 ? (Math.max(...amounts) - Math.min(...amounts)) / med : 1;
    const verdict = prefs.verdicts[n.key] || null;
    const topName = Object.entries(n.names).sort((a, b) => b[1] - a[1])[0]?.[0];
    const label = prefs.labels[n.key]
      || (n.group === "habit" ? titleCase(topName && conceptOf({ note: topName }) === n.key.slice(2) ? topName.split(" ").slice(0, 3).join(" ") : n.baseLabel) : n.category);
    const tag = inferTag({ kind: n.kind, group: n.group, label, category: n.category, monthsActive, perMonth, avg, amountSpread, reasons: n.reasons, verdict, count30 });
    const cur = n.byMonth[thisMonth] || 0;
    const prev = n.byMonth[prevMonth] || 0;
    return {
      key: n.key,
      kind: n.kind,
      group: n.group,
      label,
      category: n.category,
      tag,
      verdict,
      count: n.movements.length,
      count30,
      total: round2(n.total),
      thisMonth: round2(cur),
      prevMonth: round2(prev),
      delta: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null,
      series: months.map((k) => round2(n.byMonth[k])),
      months,
      avg: round2(avg),
      median: round2(med),
      perWeek: Math.round(perWeek * 10) / 10,
      first,
      last,
      reasons: n.reasons,
      paidBy: n.paidBy,
      accounts: n.accounts,
      people: n.people,
      pools: n.pools,
      movementIds: n.movements.sort((a, b) => timeOf(b) - timeOf(a)).map((m) => m.id),
    };
  }).sort((a, b) => (b.thisMonth - a.thisMonth) || (b.total - a.total));

  const peopleList = [...people.values()].map((p) => ({
    ...p,
    given: round2(p.given),
    received: round2(p.received),
    balance: round2(p.lent - p.received - p.owed),
    movementIds: p.movements.sort((a, b) => timeOf(b) - timeOf(a)).map((m) => m.id),
    movements: undefined,
  })).sort((a, b) => b.count - a.count);

  const usedPools = new Set([...edgeMap.values()].filter((e) => e.kind === "pool").map((e) => (e.from.startsWith("w:") ? e.from : e.to).slice(2)));
  const poolList = pools.filter((p) => usedPools.has(p.id) || !p.closed).map((p) => ({
    key: `w:${p.id}`, id: p.id, label: p.name, totalIn: p.totalIn, spent: p.spent, remaining: p.remaining, pct: p.pct, closed: p.closed,
  }));

  return {
    neurons: list,
    people: peopleList,
    pools: poolList,
    edges: [...edgeMap.values()].map((e) => ({ ...e, amount: round2(e.amount) })),
    keyOfMovement,
    thisMonth,
    prevMonth,
  };
}

function money(n) {
  const v = round2(n);
  return `S/ ${v % 1 === 0 ? v : v.toFixed(2)}`;
}

/**
 * Resumen del mes en frases y los insights accionables.
 * @param {ReturnType<typeof buildFinanceNeurons>} model
 */
export function summarizeFinanceNeurons(model, { prefs } = {}) {
  const p = normalizePrefs(prefs);
  const expenses = model.neurons.filter((n) => n.kind === "expense");
  const incomes = model.neurons.filter((n) => n.kind === "income");
  const spent = expenses.reduce((s, n) => s + n.thisMonth, 0);
  const prevSpent = expenses.reduce((s, n) => s + n.prevMonth, 0);
  const earned = incomes.reduce((s, n) => s + n.thisMonth, 0);
  const byTag = (tag) => expenses.filter((n) => n.tag === tag);
  const sum = (list, f = "thisMonth") => list.reduce((s, n) => s + n[f], 0);

  const hormiga = byTag("hormiga");
  const subs = byTag("suscripcion");
  const antojos = byTag("antojo");
  const grew = expenses.filter((n) => n.prevMonth > 0 && n.thisMonth - n.prevMonth >= 20 && n.delta >= 25).sort((a, b) => (b.thisMonth - b.prevMonth) - (a.thisMonth - a.prevMonth));
  const evitables = expenses.filter((n) => n.verdict === "evitable" && n.thisMonth > 0);

  const lines = [];
  if (grew[0]) lines.push({ icon: "📈", text: `Lo que más creció: ${grew[0].label} +${grew[0].delta}% (${money(grew[0].thisMonth)})`, key: grew[0].key });
  if (hormiga.length && sum(hormiga) > 0) lines.push({ icon: "🐜", text: `Gastos hormiga: ${money(sum(hormiga))}${spent > 0 ? `, el ${Math.round((sum(hormiga) / spent) * 100)}% de lo gastado` : ""}`, key: hormiga[0].key });
  if (subs.length) {
    const monthly = subs.reduce((s, n) => s + (n.thisMonth || n.prevMonth || n.median), 0);
    lines.push({ icon: "🔁", text: `Suscripciones: ${money(monthly)} al mes (${subs.map((n) => n.label).slice(0, 3).join(", ")})`, key: subs[0].key });
  }
  if (antojos.length && sum(antojos) > 0) lines.push({ icon: "🍩", text: `Antojos: ${money(sum(antojos))} este mes`, key: antojos[0].key });
  if (!lines.length && expenses[0]?.thisMonth > 0) lines.push({ icon: "💸", text: `Donde más se va: ${expenses[0].label} (${money(expenses[0].thisMonth)})`, key: expenses[0].key });

  const insights = [];
  const add = (id, priority, title, text, key = null) => {
    if (!p.dismissed.includes(id)) insights.push({ id, priority, title, text, key });
  };
  if (subs.length >= 2) {
    const monthly = subs.reduce((s, n) => s + (n.thisMonth || n.prevMonth || n.median), 0);
    add(`subs_${model.thisMonth}`, "medio", "Suscripciones", `${subs.map((n) => n.label).join(" + ")} = ${money(monthly)} al mes. ¿Sigues usando todas?`, subs[0].key);
  }
  for (const n of grew.slice(0, 2)) {
    add(`grew_${n.key}_${model.thisMonth}`, "medio", `${n.label} subió`, `Este mes llevas ${money(n.thisMonth)} en ${n.label}, ${money(n.thisMonth - n.prevMonth)} más que el mes pasado.`, n.key);
  }
  if (hormiga.length && sum(hormiga) >= 50) {
    const top = [...hormiga].sort((a, b) => b.thisMonth - a.thisMonth)[0];
    add(`hormiga_${model.thisMonth}`, "medio", "Gastos hormiga", `${top.label} va ${top.count30} veces en 30 días (${money(top.avg)} cada vez). Sumados son ${money(sum(hormiga))} este mes.`, top.key);
  }
  for (const n of evitables.slice(0, 2)) {
    add(`evitable_${n.key}_${model.thisMonth}`, "bajo", `${n.label} (evitable)`, `Lo marcaste como evitable y este mes ya van ${money(n.thisMonth)}.`, n.key);
  }
  if (earned > 0 && spent > earned) {
    add(`margin_${model.thisMonth}`, "alto", "Gastas más de lo que entra", `Este mes entraron ${money(earned)} y salieron ${money(spent)}.`);
  }
  for (const person of model.people.filter((x) => x.balance >= 50 && (x.loans || x.fiados)).slice(0, 2)) {
    add(`person_${person.key}`, "bajo", `${person.label} te debe`, `Le prestaste ${money(person.lent)} y te devolvió ${money(person.received)}: quedan ${money(person.balance)}.`, person.key);
  }
  for (const pool of model.pools.filter((x) => !x.closed && x.totalIn > 0 && x.pct >= 85).slice(0, 2)) {
    add(`pool_${pool.id}_${pool.pct >= 100 ? "full" : "near"}`, pool.pct >= 100 ? "alto" : "medio", `Pozo ${pool.label}`, pool.remaining < 0 ? `Te pasaste por ${money(-pool.remaining)}.` : `Ya usaste el ${pool.pct}%: quedan ${money(pool.remaining)}.`, pool.key);
  }

  return {
    spent: round2(spent),
    prevSpent: round2(prevSpent),
    earned: round2(earned),
    lines,
    insights,
  };
}

/**
 * Aviso si un gasto nuevo es muy distinto a lo normal en su hábito.
 * @returns {string|null}
 */
export function checkMovementAnomaly(ledger = [], movement, opts = {}) {
  if (!movement || movement.type !== "expense") return null;
  const model = buildFinanceNeurons(ledger, opts);
  const key = model.keyOfMovement.get(movement.id);
  const n = model.neurons.find((x) => x.key === key);
  if (!n || n.count < 5) return null;
  const others = (Array.isArray(ledger) ? ledger : []).filter((m) => m && m.id !== movement.id && n.movementIds.includes(m.id)).map(amountOf);
  const med = median(others);
  const amount = amountOf(movement);
  if (med <= 0 || amount < 20) return null;
  const ratio = amount / med;
  if (ratio < 2.5) return null;
  return `Este gasto en ${n.label} (${money(amount)}) es ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1).replace(/\.0$/, "")} veces lo que sueles pagar (${money(med)}).`;
}

/**
 * Bloque compacto para el prompt de Carl (~100 palabras). Vacío si no hay datos del mes.
 */
export function buildFinanceHabitsPromptBlock(ledger = [], opts = {}) {
  const model = buildFinanceNeurons(ledger, opts);
  const s = summarizeFinanceNeurons(model, opts);
  const expenses = model.neurons.filter((n) => n.kind === "expense" && (n.thisMonth > 0 || n.prevMonth > 0));
  if (!expenses.length) return "";
  const top = expenses.slice(0, 5).map((n) => {
    const d = n.delta === null ? "" : n.delta > 0 ? `, +${n.delta}%` : n.delta < 0 ? `, ${n.delta}%` : "";
    return `${n.label} ${money(n.thisMonth)} (${HABIT_TAGS[n.tag]?.label.toLowerCase() || n.tag}${d})`;
  });
  const parts = [`Este mes: gastó ${money(s.spent)}${s.prevSpent ? ` (mes pasado ${money(s.prevSpent)})` : ""}${s.earned ? `, entraron ${money(s.earned)}` : ""}.`];
  parts.push(`Hábitos principales: ${top.join("; ")}.`);
  for (const l of s.lines.slice(0, 3)) parts.push(`${l.text}.`);
  const debts = model.people.filter((p) => Math.abs(p.balance) >= 50 && (p.loans || p.fiados)).slice(0, 2);
  if (debts.length) parts.push(`Pendientes con personas: ${debts.map((p) => (p.balance > 0 ? `${p.label} le debe al usuario ${money(p.balance)}` : `el usuario le debe a ${p.label} ${money(-p.balance)}`)).join("; ")}.`);
  const text = parts.join(" ").slice(0, 750);
  return `\n\n## HÁBITOS DE DINERO DEL USUARIO\nResumen local de sus finanzas (no lo recites; úsalo solo si la conversación toca dinero, gastos o planes).\n${text}`;
}

export { emptyPrefs };
