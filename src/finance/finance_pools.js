/**
 * finance_pools.js — Pozos de dinero (quincenas, bonos…): de dónde sale cada gasto
 * MemoryCarl · Finanzas
 *
 * Modelo (compatible con los movimientos ya guardados):
 * - Pozo: ingreso con `isSourcePool: true`. Nombre en `sourcePoolName`.
 * - Recarga: ingreso con `parentPoolId` = id de un pozo (o de otra recarga).
 *   Compatibilidad: un ingreso viejo con `sourceMovementId` apuntando a un pozo también cuenta.
 * - Gasto de un pozo: gasto con `sourceMovementId` = id del pozo (o de una de sus recargas).
 *   Compatibilidad: un gasto viejo sin enlace cuyo `sourceLabel` es exactamente el nombre de un
 *   único pozo también cuenta. Ya no se asigna "por parecido".
 * - Pozo cerrado: `poolClosed: true` en el ingreso raíz (no se ofrece para gastos nuevos).
 *
 * El saldo de un pozo usa SIEMPRE todos sus movimientos, sin importar el periodo que se esté viendo.
 */

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const amountOf = (m) => Number(m?.amount) || 0;
const timeOf = (m) => new Date(m?.date || 0).getTime() || 0;

/** Nombre visible de un pozo. */
export function poolName(m) {
  if (!m) return "Pozo";
  if (m.sourcePoolName && String(m.sourcePoolName).trim()) return String(m.sourcePoolName).trim();
  const fromNote = m.note ? String(m.note).split(" · ")[0].trim() : "";
  return fromNote || "Pozo";
}

/** true si el movimiento es la raíz de un pozo. */
export function isPoolRoot(m) {
  return !!m && m.type === "income" && !m.archived && !!m.isSourcePool;
}

/**
 * Pozo raíz al que pertenece un id (un pozo, una recarga o un gasto que apunta a una recarga).
 * @returns {string|null}
 */
export function resolvePoolRootId(byId, id) {
  const seen = new Set();
  let cur = id ? byId.get(id) : null;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (isPoolRoot(cur)) return cur.id;
    if (cur.type !== "income" || cur.archived) return null;
    const next = cur.parentPoolId || cur.sourceMovementId;
    cur = next ? byId.get(next) : null;
  }
  return null;
}

/**
 * Pozo de un movimiento según las reglas de arriba, o null.
 * @param {Map} byId
 * @param {object} m
 * @param {Map} [poolByName] - nombre normalizado → id (solo nombres únicos), para datos viejos
 */
export function poolIdOfMovement(byId, m, poolByName) {
  if (!m || m.archived) return null;
  if (m.type === "income") {
    if (isPoolRoot(m)) return m.id;
    const parent = m.parentPoolId || m.sourceMovementId;
    return parent ? resolvePoolRootId(byId, parent) : null;
  }
  if (m.type !== "expense") return null;
  if (m.sourceMovementId) return resolvePoolRootId(byId, m.sourceMovementId);
  if (m.sourceLabel && poolByName) return poolByName.get(normalize(m.sourceLabel)) || null;
  return null;
}

function uniqueNameIndex(roots) {
  const counts = new Map();
  for (const r of roots) {
    const k = normalize(poolName(r));
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const index = new Map();
  for (const r of roots) {
    const k = normalize(poolName(r));
    if (k && counts.get(k) === 1) index.set(k, r.id);
  }
  return index;
}

/**
 * Todos los pozos con sus entradas, gastos y saldo.
 * @param {Array} ledger - movimientos (se ignoran los archivados)
 * @param {{ excludeId?: string }} [opts] - excluye un movimiento (al editarlo, para no contarlo dos veces)
 * @returns {Array<{ id, name, date, closed, root, inflows, expenses, totalIn, spent, remaining, pct }>}
 *          ordenados del más reciente al más antiguo
 */
export function buildPools(ledger = [], opts = {}) {
  const active = (Array.isArray(ledger) ? ledger : []).filter((m) => m && !m.archived && m.id !== opts.excludeId);
  const byId = new Map(active.map((m) => [m.id, m]));
  const roots = active.filter(isPoolRoot);
  const poolByName = uniqueNameIndex(roots);
  const pools = new Map(roots.map((r) => [r.id, {
    id: r.id,
    name: poolName(r),
    date: r.date || null,
    closed: !!r.poolClosed,
    root: r,
    inflows: [r],
    expenses: [],
  }]));

  for (const m of active) {
    if (isPoolRoot(m)) continue;
    const pid = poolIdOfMovement(byId, m, poolByName);
    const pool = pid ? pools.get(pid) : null;
    if (!pool) continue;
    if (m.type === "income") pool.inflows.push(m);
    else if (m.type === "expense") pool.expenses.push(m);
  }

  return [...pools.values()].map((p) => {
    p.inflows.sort((a, b) => timeOf(a) - timeOf(b));
    p.expenses.sort((a, b) => timeOf(b) - timeOf(a));
    const totalIn = p.inflows.reduce((s, m) => s + amountOf(m), 0);
    const spent = p.expenses.reduce((s, m) => s + amountOf(m), 0);
    return {
      ...p,
      totalIn,
      spent,
      remaining: totalIn - spent,
      pct: totalIn > 0 ? Math.min(100, Math.round((spent / totalIn) * 100)) : 0,
    };
  }).sort((a, b) => timeOf(b.root) - timeOf(a.root));
}

/**
 * Id del pozo de un gasto (o null), con las mismas reglas que buildPools.
 */
export function expensePoolId(ledger = [], expense) {
  const active = (Array.isArray(ledger) ? ledger : []).filter((m) => m && !m.archived);
  const byId = new Map(active.map((m) => [m.id, m]));
  return poolIdOfMovement(byId, expense, uniqueNameIndex(active.filter(isPoolRoot)));
}

/**
 * Gastos sin pozo dentro de una lista (por ejemplo, los del periodo que se está viendo).
 * @param {Array} ledger - todos los movimientos (para resolver los enlaces)
 * @param {Array} expenses - gastos a revisar
 */
export function expensesWithoutPool(ledger = [], expenses = []) {
  const active = (Array.isArray(ledger) ? ledger : []).filter((m) => m && !m.archived);
  const byId = new Map(active.map((m) => [m.id, m]));
  const poolByName = uniqueNameIndex(active.filter(isPoolRoot));
  return expenses.filter((e) => e && e.type === "expense" && !e.archived && !poolIdOfMovement(byId, e, poolByName));
}

/**
 * Pozo al que apuntaría un texto libre de origen (para la sugerencia de la IA):
 * solo si el texto nombra exactamente a un único pozo abierto.
 * @returns {string|null}
 */
export function matchPoolByLabel(ledger = [], label = "") {
  const text = normalize(label);
  if (!text) return null;
  const open = buildPools(ledger).filter((p) => !p.closed);
  // El nombre tiene que aparecer como palabra o frase completa ("bono" no debe enlazar "abono")
  const escape = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hits = open.filter((p) => {
    const n = normalize(p.name);
    if (!n || n === "pozo") return false;
    return new RegExp(`(^|[^a-z0-9ñ])${escape(n)}($|[^a-z0-9ñ])`).test(text);
  });
  return hits.length === 1 ? hits[0].id : null;
}
