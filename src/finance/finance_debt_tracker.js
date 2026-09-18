/**
 * finance_debt_tracker.js
 * Módulo de memoria de deudas por persona.
 * Lógica plana y aritmética — no usa IA.
 * La IA extrae counterparty y debtDirection; este módulo solo lleva la cuenta.
 */

const DEBT_LEDGER_KEY = "memorycarl_debt_ledger";

function loadDebtLedger() {
  try {
    return JSON.parse(localStorage.getItem(DEBT_LEDGER_KEY) || "{}");
  } catch(_) { return {}; }
}

function saveDebtLedger(ledger) {
  try {
    localStorage.setItem(DEBT_LEDGER_KEY, JSON.stringify(ledger));
  } catch(_) {}
}

function normalizeName(name) {
  if (!name || typeof name !== "string") return null;
  return name.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) || null;
}

function dateStr(d) {
  return (d instanceof Date ? d : new Date(d || Date.now())).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const msA = new Date(a || Date.now()).getTime();
  const msB = new Date(b || Date.now()).getTime();
  return Math.round(Math.abs(msB - msA) / 86400000);
}

/**
 * captureContextSnapshot — toma foto de hechos actuales del sistema financiero.
 * Lee del hipocampo (si está disponible) sin modificarlo.
 */
function captureContextSnapshot() {
  try {
    const monthKey = new Date().toISOString().slice(0, 7);
    // Read from FINANCE neural storage if available
    const hippocampus = (window.FINANCE_BRAIN && window.FINANCE_BRAIN.hippocampus) || null;
    const month = (hippocampus && hippocampus.monthly && hippocampus.monthly[monthKey]) || null;

    // Build top category changes vs previous month
    const prevMonth = new Date();
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    const prevKey = prevMonth.toISOString().slice(0, 7);
    const prevMonthData = (hippocampus && hippocampus.monthly && hippocampus.monthly[prevKey]) || null;

    // Snapshot of facts — no causal inference
    return {
      capturedAt: new Date().toISOString(),
      marginEstimate: month ? (month.marginEstimate || null) : null,
      pressureScore: month ? (month.pressureScore || null) : null,
      leakScore: month ? (month.leakScore || null) : null,
      totalExpenses: month ? (month.totalExpenses || null) : null,
      prevTotalExpenses: prevMonthData ? (prevMonthData.totalExpenses || null) : null,
      // Category-level snapshot from FINANCE.state.movements if available
      topCategoryChanges: _getCategoryChanges(monthKey, prevKey),
      unusualIncome: _getUnusualIncome()
    };
  } catch(_) {
    return { capturedAt: new Date().toISOString(), error: "snapshot_failed" };
  }
}

function _getCategoryChanges(monthKey, prevKey) {
  try {
    const movements = (window.FINANCE && window.FINANCE.state && window.FINANCE.state.movements) || [];
    const sumByMonth = (key) => {
      const sums = {};
      movements
        .filter(m => m.type === "expense" && !m.archived && String(m.date).startsWith(key))
        .forEach(m => {
          const cat = m.category || "Otros";
          sums[cat] = (sums[cat] || 0) + (Number(m.amount) || 0);
        });
      return sums;
    };
    const curr = sumByMonth(monthKey);
    const prev = sumByMonth(prevKey);
    const allCats = new Set([...Object.keys(curr), ...Object.keys(prev)]);
    const changes = [];
    allCats.forEach(cat => {
      const c = curr[cat] || 0;
      const p = prev[cat] || 0;
      if (p > 0) {
        const pct = ((c - p) / p) * 100;
        changes.push({ category: cat, pctChange: Math.round(pct) });
      }
    });
    // Return top 3 categories that dropped the most
    return changes.sort((a, b) => a.pctChange - b.pctChange).slice(0, 3);
  } catch(_) { return null; }
}

function _getUnusualIncome() {
  try {
    const movements = (window.FINANCE && window.FINANCE.state && window.FINANCE.state.movements) || [];
    const now = Date.now();
    const fourWeeksAgo = now - 28 * 86400000;
    const recentIncomes = movements
      .filter(m => m.type === "income" && !m.archived && new Date(m.date).getTime() > fourWeeksAgo);
    if (!recentIncomes.length) return null;

    // Calculate typical income (median of all time income)
    const allIncomes = movements
      .filter(m => m.type === "income" && !m.archived)
      .map(m => Number(m.amount) || 0)
      .sort((a, b) => a - b);
    if (!allIncomes.length) return null;
    const median = allIncomes[Math.floor(allIncomes.length / 2)];

    // Flag unusual = > 50% above median
    const unusual = recentIncomes.filter(m => (Number(m.amount) || 0) > median * 1.5);
    if (!unusual.length) return null;
    return unusual.slice(0, 1).map(m => ({
      amount: Number(m.amount),
      date: dateStr(m.date),
      note: m.note || null
    }))[0];
  } catch(_) { return null; }
}

/**
 * closeDebtCycle — cierra el ciclo activo de una persona.
 * Solo aritmética. No infiere causas.
 */
function closeDebtCycle(ledger, personKey, closeDate) {
  const entry = ledger[personKey];
  if (!entry || !entry.openedAt) return;

  const allAmounts = (entry.movements || []).map(() => 0); // just a structure ref
  // peak = max absolute balance seen during cycle
  // We approximate: if we tracked a running balance, peak would be exact.
  // Here we store it as Math.abs of initial entry (best we can do without full history)
  const peak = Math.abs(entry._peakAmount || entry.balance || 0);

  const snapshot = captureContextSnapshot();
  const historyEntry = {
    openedAt: entry.openedAt,
    closedAt: closeDate,
    durationDays: daysBetween(entry.openedAt, closeDate),
    peakAmount: peak,
    movementCount: (entry.movements || []).length,
    contextSnapshot: snapshot
  };

  if (!Array.isArray(entry.history)) entry.history = [];
  entry.history.push(historyEntry);

  // Reset active cycle
  entry.balance = 0;
  entry.movements = [];
  entry.openedAt = null;
  entry._peakAmount = 0;
}

/**
 * updateDebtBalance — actualiza el balance de deuda de la persona involucrada.
 * Se llama desde finance_core_v2.js después de que la IA clasifica el movimiento.
 */
export function updateDebtBalance(movement) {
  if (!movement || !movement.counterparty || !movement.debtDirection) return;

  const personKey = normalizeName(movement.counterparty);
  if (!personKey) return;

  const ledger = loadDebtLedger();
  const moveDate = dateStr(movement.date);
  const amount = Number(movement.amount) || 0;

  if (!ledger[personKey]) {
    ledger[personKey] = {
      balance: 0,
      openedAt: moveDate,
      movements: [],
      history: [],
      _peakAmount: 0
    };
  }

  const entry = ledger[personKey];

  // Open a new cycle if there isn't one active
  if (!entry.openedAt) {
    entry.openedAt = moveDate;
    entry.balance = 0;
    entry.movements = [];
    entry._peakAmount = 0;
  }

  // Adjust balance
  if (movement.debtDirection === "presto_yo") {
    entry.balance += amount;
  } else if (movement.debtDirection === "me_prestan") {
    entry.balance -= amount;
  }

  // Track peak
  const absBalance = Math.abs(entry.balance);
  if (absBalance > (entry._peakAmount || 0)) {
    entry._peakAmount = absBalance;
  }

  // Register movement id
  if (movement.id && !entry.movements.includes(movement.id)) {
    entry.movements.push(movement.id);
  }

  // Close cycle if balance is ≈ 0 (tolerance ±1 sol)
  if (Math.abs(entry.balance) <= 1) {
    closeDebtCycle(ledger, personKey, moveDate);
    // Fire a custom event so insight_engine can react
    try {
      window.dispatchEvent(new CustomEvent("debtCycleClosed", {
        detail: { person: personKey, history: ledger[personKey].history.slice(-1)[0] }
      }));
    } catch(_) {}
  }

  // Fire event for new cycle with existing history (recurring debt detection)
  if (entry.openedAt === moveDate && (entry.history || []).length > 0) {
    try {
      window.dispatchEvent(new CustomEvent("debtCycleOpened", {
        detail: { person: personKey, history: ledger[personKey].history }
      }));
    } catch(_) {}
  }

  saveDebtLedger(ledger);
}

/**
 * getDebtHistory — devuelve objeto completo de deuda de una persona.
 */
export function getDebtHistory(person) {
  const personKey = normalizeName(person);
  if (!personKey) return null;
  const ledger = loadDebtLedger();
  return ledger[personKey] || null;
}

/**
 * getActiveDebts — devuelve todas las personas con balance ≠ 0.
 */
export function getActiveDebts() {
  const ledger = loadDebtLedger();
  const result = [];
  Object.entries(ledger).forEach(([person, data]) => {
    if (Math.abs(data.balance || 0) > 1) {
      result.push({
        person,
        balance: data.balance,
        openedAt: data.openedAt,
        movementCount: (data.movements || []).length,
        historyCount: (data.history || []).length
      });
    }
  });
  return result;
}
