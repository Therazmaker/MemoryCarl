/**
 * finance_source_links.js
 * Módulo de enlaces entre movimientos (origen del dinero).
 * Lógica plana sin IA — la IA ya extrajo sourceRef; aquí solo se hace matching.
 */

const LINK_WINDOW_DAYS = 60;

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getMovements() {
  return (window.FINANCE && window.FINANCE.state && window.FINANCE.state.movements) || [];
}

function getRecentIncomes() {
  const cutoff = Date.now() - LINK_WINDOW_DAYS * 86400000;
  return getMovements().filter(m =>
    m.type === "income" &&
    !m.archived &&
    new Date(m.date || 0).getTime() > cutoff
  );
}

/**
 * Intenta enlazar un movimiento con el ingreso origen basándose en sourceLabel.
 * Solo asigna sourceMovementId si hay exactamente 1 coincidencia clara.
 * Si hay 0 o >1, el sourceLabel permanece como texto libre (no se toca).
 */
export function resolveSourceLink(movement) {
  if (!movement || !movement.sourceLabel) return;

  // Si ya tiene un enlace resuelto manualmente, respetarlo
  if (movement.sourceMovementId) return;

  const label = normalizeText(movement.sourceLabel);
  if (!label) return;

  const incomes = getRecentIncomes();
  const candidates = incomes.filter(income => {
    const cp = normalizeText(income.counterparty || "");
    const cat = normalizeText(income.category || "");
    const note = normalizeText(income.note || "");

    // Match if label contains counterparty/category of income, or vice versa
    const hasMatch =
      (cp && (label.includes(cp) || cp.includes(label))) ||
      (cat && cat !== "otros" && (label.includes(cat) || cat.includes(label))) ||
      (note && note.length > 3 && (label.includes(note.slice(0, 15)) || note.includes(label.slice(0, 15))));

    return hasMatch;
  });

  if (candidates.length === 1) {
    movement.sourceMovementId = candidates[0].id;
    // Persist: update in FINANCE.state.movements directly (same object ref)
    // since movement IS a reference into the array, no extra save needed here.
    // Caller (addMovement) already calls save() after this.
  }
  // Zero or multiple matches → leave sourceLabel as free text, no link assigned
}

/**
 * Devuelve lista de gastos cuyo sourceMovementId apunta a un ingreso específico.
 */
export function getMovementsFromSource(sourceMovementId) {
  if (!sourceMovementId) return [];
  return getMovements().filter(m =>
    m.type === "expense" &&
    !m.archived &&
    m.sourceMovementId === sourceMovementId
  );
}

/**
 * Devuelve resumen de cuánto se gastó de un ingreso específico.
 */
export function getSourceBreakdown(sourceMovementId) {
  const origin = getMovements().find(m => m.id === sourceMovementId);
  if (!origin) return null;

  const linked = getMovementsFromSource(sourceMovementId);
  const totalSpent = linked.reduce((s, m) => s + (Number(m.amount) || 0), 0);
  const originAmount = Number(origin.amount) || 0;

  return {
    sourceMovementId,
    originAmount,
    totalSpent,
    percentUsed: originAmount > 0 ? Math.round((totalSpent / originAmount) * 100) : 0,
    linkedCount: linked.length,
    linkedMovements: linked.map(m => ({ id: m.id, amount: m.amount, note: m.note, date: m.date }))
  };
}
