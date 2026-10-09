const assert = require('assert');

// Mock state and environment
const state = {
  financeMissionPayments: [],
  financeMissionMonthKey: "2025-05",
  financeAccounts: [{ id: "acc1", name: "Banco BCP", balance: 2000 }],
  financeDebts: [{ id: "d1", name: "Deuda Carlos Emilio", balance: 500, monthlyDue: 100, status: "active" }],
  financeCommitments: [{ id: "c1", name: "Servicios", amount: 150, dueDay: 10, active: true }]
};

function getCurrentMonthKey() {
  return "2025-05";
}

function uid(prefix = "id") {
  return prefix + "_" + Math.random().toString(36).substr(2, 9);
}

function persist() {}
function view() {}
function toast(msg) {}

function financeEnsureMissionControlStructures() {
  if (!Array.isArray(state.financeMissionPayments)) state.financeMissionPayments = [];
  if (!state.financeMissionMonthKey) state.financeMissionMonthKey = getCurrentMonthKey();
}

function mcAddUnexpectedPayment(payload) {
  financeEnsureMissionControlStructures();
  const mk = state.financeMissionMonthKey;
  const item = {
    id: uid("mc_unexp"),
    monthKey: mk,
    type: "unexpected",
    refId: null,
    name: payload.name || "Gasto Imprevisto",
    category: payload.category || "Imprevisto",
    amount: Number(payload.amount || 0),
    dueDay: Number(payload.dueDay || new Date().getDate()),
    status: "pending",
    paidAmount: 0,
    paidDate: null,
    movementId: null,
    notes: payload.notes || ""
  };
  state.financeMissionPayments.unshift(item);
  return item;
}

function mcPayItem(itemId, accountId, paidAmount) {
  financeEnsureMissionControlStructures();
  const mk = state.financeMissionMonthKey;
  let item = state.financeMissionPayments.find(p => p.id === itemId);

  // If item is virtual (not yet stored in state.financeMissionPayments), promote it to stored item
  if (!item && itemId.startsWith("virtual_")) {
    const isCmt = itemId.startsWith("virtual_cmt_");
    const refId = itemId.replace(isCmt ? `virtual_cmt_` : `virtual_dbt_`, "").replace(`_${mk}`, "");
    if (isCmt) {
      const c = state.financeCommitments.find(x => x.id === refId);
      if (c) {
        item = {
          id: uid("mc_cmt"),
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
        };
        state.financeMissionPayments.push(item);
      }
    } else {
      const d = state.financeDebts.find(x => x.id === refId);
      if (d) {
        item = {
          id: uid("mc_dbt"),
          monthKey: mk,
          type: "debt",
          refId: d.id,
          name: d.name,
          category: "Deuda",
          amount: Math.min(Number(d.monthlyDue || d.balance || 0), Number(d.balance || 0)),
          dueDay: Number(d.dueDay || 15),
          status: "pending",
          paidAmount: 0,
          paidDate: null,
          movementId: null,
          totalDebtBalance: Number(d.balance || 0),
          notes: d.notes || ""
        };
        state.financeMissionPayments.push(item);
      }
    }
  }

  if (!item) return false;

  const amt = Number(paidAmount || item.amount || 0);

  // Mark as paid
  item.status = "paid";
  item.paidAmount = amt;
  item.paidDate = new Date().toISOString();

  // Deduct from debt if debt
  if (item.type === "debt" && item.refId) {
    const d = state.financeDebts.find(x => x.id === item.refId);
    if (d) {
      d.balance = Math.max(0, Number(d.balance || 0) - amt);
      if (d.balance === 0) d.status = "closed";
    }
  }

  // Deduct account balance
  const acc = state.financeAccounts.find(a => a.id === accountId);
  if (acc) {
    acc.balance = Number(acc.balance || 0) - amt;
  }

  return true;
}

// Tests
const unexp = mcAddUnexpectedPayment({ name: "Reparación auto", amount: 300, dueDay: 12 });
assert.strictEqual(state.financeMissionPayments.length, 1);
assert.strictEqual(unexp.amount, 300);

// Pay debt virtual item
const success = mcPayItem("virtual_dbt_d1_2025-05", "acc1", 100);
assert.strictEqual(success, true);
const debt = state.financeDebts.find(d => d.id === "d1");
assert.strictEqual(debt.balance, 400, "Debt balance should be 400 after 100 payment");
const acc = state.financeAccounts.find(a => a.id === "acc1");
assert.strictEqual(acc.balance, 1900, "Account balance should be 1900 after 100 payment");

console.log("All Mission Control UI action tests passed!");
