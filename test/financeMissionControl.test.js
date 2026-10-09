const assert = require('assert');

// Mock state
const state = {
  financeMissionPayments: [],
  financeMissionMonthKey: "2025-05",
  financeCommitments: [
    { id: "c1", name: "Alquiler", amount: 1200, dueDay: 5, group: "Vivienda", active: true }
  ],
  financeDebts: [
    { id: "d1", name: "Banco BCP", balance: 5000, monthlyDue: 500, dueDay: 15, status: "active" },
    { id: "d2", name: "Carlos Emilio", balance: 800, monthlyDue: 100, dueDay: 20, status: "active" }
  ],
  financeAccounts: [
    { id: "a1", name: "BCP Principal", balance: 3500, type: "bank" }
  ]
};

function getCurrentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function financeEnsureMissionControlStructures() {
  if (!Array.isArray(state.financeMissionPayments)) state.financeMissionPayments = [];
  if (!state.financeMissionMonthKey) state.financeMissionMonthKey = getCurrentMonthKey();
}

function financeMissionControlModel(monthKey) {
  financeEnsureMissionControlStructures();
  const mk = monthKey || state.financeMissionMonthKey || getCurrentMonthKey();

  const storedForMonth = state.financeMissionPayments.filter(p => p.monthKey === mk);
  const storedRefIds = new Set(storedForMonth.map(p => p.refId).filter(Boolean));

  const items = [...storedForMonth];

  // Auto-generate commitment items for month if not explicitly stored
  (state.financeCommitments || []).filter(c => c && c.active !== false).forEach(c => {
    if (!storedRefIds.has(c.id)) {
      items.push({
        id: `virtual_cmt_${c.id}_${mk}`,
        monthKey: mk,
        type: "commitment",
        refId: c.id,
        name: c.name,
        category: c.group || "Compromiso",
        amount: Number(c.amount || 0),
        dueDay: Number(c.dueDay || 1),
        status: "pending",
        paidAmount: 0,
        paidDate: null,
        movementId: null,
        notes: c.note || ""
      });
    }
  });

  // Auto-generate debt items for month if not explicitly stored
  (state.financeDebts || []).filter(d => d && String(d.status || 'active') === 'active').forEach(d => {
    if (!storedRefIds.has(d.id)) {
      const dueAmt = Math.min(Number(d.monthlyDue || d.balance || 0), Number(d.balance || 0));
      items.push({
        id: `virtual_dbt_${d.id}_${mk}`,
        monthKey: mk,
        type: "debt",
        refId: d.id,
        name: d.name,
        category: "Deuda",
        amount: dueAmt,
        dueDay: Number(d.dueDay || d.dueDate || 15),
        status: "pending",
        paidAmount: 0,
        paidDate: null,
        movementId: null,
        totalDebtBalance: Number(d.balance || 0),
        notes: d.notes || ""
      });
    }
  });

  items.sort((a, b) => (Number(a.dueDay) || 1) - (Number(b.dueDay) || 1));

  const totalExpected = items.reduce((s, i) => s + Number(i.amount || 0), 0);
  const totalPaid = items.reduce((s, i) => s + (i.status === 'paid' ? Number(i.paidAmount || i.amount || 0) : 0), 0);
  const totalPending = Math.max(0, totalExpected - totalPaid);
  const unexpectedTotal = items.filter(i => i.type === 'unexpected').reduce((s, i) => s + Number(i.amount || 0), 0);
  const commitmentsTotal = items.filter(i => i.type === 'commitment').reduce((s, i) => s + Number(i.amount || 0), 0);
  const debtsTotal = items.filter(i => i.type === 'debt').reduce((s, i) => s + Number(i.amount || 0), 0);
  const completionPct = totalExpected > 0 ? Math.min(100, Math.round((totalPaid / totalExpected) * 100)) : 0;

  const totalRemainingDebtsBalance = (state.financeDebts || [])
    .filter(d => String(d.status || 'active') === 'active')
    .reduce((s, d) => s + Number(d.balance || 0), 0);

  const availableCash = (state.financeAccounts || [])
    .filter(a => !a.archived && !a.excludeFromTotal)
    .reduce((s, a) => s + Number(a.balance || 0), 0);

  return {
    mk,
    items,
    totalExpected,
    totalPaid,
    totalPending,
    unexpectedTotal,
    commitmentsTotal,
    debtsTotal,
    completionPct,
    totalRemainingDebtsBalance,
    availableCash
  };
}

// Test model
const m = financeMissionControlModel("2025-05");
assert.strictEqual(m.items.length, 3, "Should have 3 items (1 commitment + 2 debts)");
assert.strictEqual(m.totalExpected, 1200 + 500 + 100, "Total expected should be 1800");
assert.strictEqual(m.totalPaid, 0, "Total paid should be 0");
assert.strictEqual(m.totalPending, 1800, "Total pending should be 1800");
assert.strictEqual(m.totalRemainingDebtsBalance, 5800, "Total remaining debts balance should be 5800");

console.log("Mission Control data structure test passed!");
