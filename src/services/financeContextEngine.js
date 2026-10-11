/**
 * financeContextEngine.js — Constructor de contexto financiero para NeuroChat
 * MemoryCarl / NeuroChat
 *
 * Proporciona contexto de finanzas (saldos de cuentas, resumen de 30 días y
 * movimientos recientes de los últimos 30 días) cuando la conversación en NeuroChat
 * aborde temas de dinero o finanzas.
 */

const FINANCE_KEYWORDS = [
  "dinero", "finanza", "finanzas", "gasto", "gastos", "gasté", "gaste", "gastado", "gastaría", "gastaria",
  "ingreso", "ingresos", "compré", "compre", "comprar", "compra", "compras", "pagué", "pague", "pagar", "pago", "pagos",
  "precio", "costo", "costos", "presupuesto", "saldo", "saldos", "cuenta", "cuentas", "bcp", "efectivo", "tarjeta", "tarjetas",
  "deuda", "deudas", "plata", "soles", "dólares", "dolares", "ahorro", "ahorros",
  "prestamo", "préstamo", "fiado", "transferencia", "banco", "s/", "$"
];

/**
 * Detecta si el mensaje del usuario o las neuronas activadas tratan sobre temas financieros.
 *
 * @param {string} userInput
 * @param {Array<object>} activatedNeurons
 * @returns {boolean}
 */
export function isFinanceTopic(userInput = "", activatedNeurons = []) {
  const text = String(userInput || "").toLowerCase();

  // 1. Coincidencia por palabras clave en el input del usuario
  const hasKeyword = FINANCE_KEYWORDS.some((kw) => text.includes(kw));
  if (hasKeyword) return true;

  // 2. Coincidencia por neuronas activas relacionadas con finanzas
  if (Array.isArray(activatedNeurons)) {
    const hasFinanceNeuron = activatedNeurons.some((item) => {
      const n = item.neuron || item;
      const domain = String(n.core?.domain || n.domain || "").toLowerCase();
      const concept = String(n.core?.concept || n.concept || "").toLowerCase();
      return (
        domain === "finance" ||
        domain === "finanzas" ||
        FINANCE_KEYWORDS.some((kw) => concept.includes(kw))
      );
    });
    if (hasFinanceNeuron) return true;
  }

  return false;
}

/**
 * Reúne el estado financiero actual y el resumen/movimientos de los últimos 30 días.
 *
 * @param {object} options
 * @param {object} [options.state]
 * @param {number} [options.daysLimit=30]
 * @returns {object|null} Contexto financiero estructurado
 */
export function buildFinanceContext(options = {}) {
  const g = typeof globalThis !== "undefined" ? globalThis : {};
  const appState = options.state || g.state || (g.window && g.window.state) || {};

  const accounts = Array.isArray(appState.financeAccounts)
    ? appState.financeAccounts
    : Array.isArray(appState.finance_accounts)
    ? appState.finance_accounts
    : [];

  const ledger = Array.isArray(appState.financeLedger)
    ? appState.financeLedger
    : Array.isArray(appState.finance_ledger)
    ? appState.finance_ledger
    : Array.isArray(appState.financeMovements)
    ? appState.financeMovements
    : [];

  if (accounts.length === 0 && ledger.length === 0) {
    return null;
  }

  const daysLimit = options.daysLimit || 30;
  const now = Date.now();
  const cutoffTime = now - daysLimit * 24 * 60 * 60 * 1000;

  // 1. Cuentas activas
  const activeAccounts = accounts.filter((a) => a && !a.archived && a.status !== "archived");
  const accountsSummary = activeAccounts.map((a) => ({
    id: a.id,
    name: a.name || a.label || "Cuenta",
    balance: Number(a.balance) || 0,
    currency: a.currency || "PEN",
    type: a.type || "cuenta",
    excludeFromTotal: Boolean(a.excludeFromTotal),
  }));

  const totalBalance = accountsSummary
    .filter((a) => !a.excludeFromTotal && !String(a.name).toLowerCase().includes("fergis"))
    .reduce((sum, a) => sum + a.balance, 0);

  // 2. Movimientos de los últimos 30 días
  const activeLedger = ledger.filter((m) => m && !m.archived);

  const last30DaysMovements = activeLedger.filter((m) => {
    if (!m.date && !m.createdAt) return false;
    const ts = new Date(m.date || m.createdAt).getTime();
    return !Number.isNaN(ts) && ts >= cutoffTime;
  });

  // Ordenar de más reciente a más antiguo
  last30DaysMovements.sort((a, b) => {
    const tsA = new Date(a.date || a.createdAt).getTime();
    const tsB = new Date(b.date || b.createdAt).getTime();
    return tsB - tsA;
  });

  let totalIncome30d = 0;
  let totalExpense30d = 0;
  const categoryExpenses = {};

  const movementsSummary = last30DaysMovements.map((m) => {
    const rawAmount = Number(m.amount || m.monto || 0);
    const amount = Math.abs(rawAmount);
    const type = String(m.type || "").toLowerCase();
    const category = m.category || m.reason || m.nombre || "Gasto";
    const note = m.note || m.notes || m.notas || "";
    const dateStr = String(m.date || m.createdAt || "").slice(0, 10);

    if (type === "income" || (type !== "transfer" && rawAmount > 0)) {
      totalIncome30d += amount;
    } else if (type === "expense" || (type !== "transfer" && rawAmount < 0)) {
      totalExpense30d += amount;
      categoryExpenses[category] = (categoryExpenses[category] || 0) + amount;
    }

    return {
      id: m.id,
      date: dateStr,
      type: type === "income" || rawAmount > 0 ? "ingreso" : type === "transfer" ? "transferencia" : "gasto",
      category,
      amount,
      note,
    };
  });

  // Top categorías de gastos en 30 días
  const topExpenseCategories = Object.entries(categoryExpenses)
    .map(([cat, total]) => ({ category: cat, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    daysPeriod: daysLimit,
    accounts: accountsSummary,
    totalBalance,
    totalIncome30d,
    totalExpense30d,
    net30d: totalIncome30d - totalExpense30d,
    topExpenseCategories,
    recentMovementsCount: movementsSummary.length,
    movements: movementsSummary.slice(0, 20), // Máximo 20 movimientos más recientes para contexto de prompt
  };
}
