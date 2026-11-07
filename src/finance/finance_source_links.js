/**
 * finance_source_links.js
 * Módulo de enlaces entre movimientos (origen del dinero).
 * Lógica plana sin IA — la IA ya extrajo sourceRef; aquí solo se hace matching.
 */

import { matchPoolByLabel } from "./finance_pools.js";

function getMovements() {
  return (window.FINANCE && window.FINANCE.state && window.FINANCE.state.movements) || [];
}

/**
 * Intenta enlazar un gasto con su pozo de origen basándose en sourceLabel (sugerencia de la IA).
 * Solo enlaza si el texto nombra exactamente a UN pozo abierto. Antes se enlazaba a cualquier
 * ingreso "parecido" y esos gastos quedaban asignados a algo que no era un pozo.
 */
export function resolveSourceLink(movement) {
  if (!movement || movement.type !== "expense" || !movement.sourceLabel) return;
  // Si ya tiene un enlace (manual), respetarlo
  if (movement.sourceMovementId) return;
  const poolId = matchPoolByLabel(getMovements(), movement.sourceLabel);
  if (poolId) movement.sourceMovementId = poolId;
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
