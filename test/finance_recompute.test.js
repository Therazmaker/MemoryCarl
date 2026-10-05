import test from 'node:test';
import assert from 'node:assert';

test('Finance Recompute Balances with unassigned movements and transfers', () => {
  const state = {
    financePrimaryAccountId: "acc_bcp",
    financeAccounts: [
      { id: "acc_bcp", name: "BCP", type: "bank", initialBalance: 1000, balance: 1000 },
      { id: "acc_cash", name: "Efectivo", type: "cash", initialBalance: 200, balance: 200 }
    ],
    financeLedger: [
      // Income with no accountId (orphaned) -> defaults to primary account acc_bcp (+500)
      { id: "mov_1", type: "income", amount: 500, archived: false },
      // Expense with explicit accountId -> acc_bcp (-200)
      { id: "mov_2", type: "expense", amount: 200, accountId: "acc_bcp", archived: false },
      // Transfer from acc_bcp to acc_cash (100) -> acc_bcp (-100), acc_cash (+100)
      { id: "mov_3", type: "transfer", amount: 100, accountId: "acc_bcp", toAccountId: "acc_cash", archived: false }
    ]
  };

  function financeActiveLedger() {
    return state.financeLedger.filter(e => !e.archived);
  }

  function financeRecomputeBalances(){
    const sums = {};
    const primaryId = state.financePrimaryAccountId || (state.financeAccounts||[]).find(a=>!a.archived && a.status !== "archived")?.id;

    (financeActiveLedger()||[]).forEach(e=>{
      const accId = e.accountId || primaryId;
      const amt = Number(e.amount||0);
      if(accId) {
        if(sums[accId] === undefined) sums[accId] = 0;
        if(e.type === "expense") {
          sums[accId] -= amt;
        }
        else if(e.type === "income") sums[accId] += amt;
        else if(e.type === "transfer") sums[accId] -= amt;
      }
      if(e.type === "transfer" && e.toAccountId) {
        const toAccId = e.toAccountId;
        if(sums[toAccId] === undefined) sums[toAccId] = 0;
        sums[toAccId] += amt;
      }
    });

    (state.financeAccounts||[]).forEach(a=>{
      const base = Number(a.initialBalance||0);
      const delta = Number(sums[a.id]||0);
      const finalVal = base + delta;
      a.balance = a.type === "crypto" ? Number(finalVal.toFixed(8)) : Number(finalVal.toFixed(2));
    });
  }

  financeRecomputeBalances();

  assert.strictEqual(state.financeAccounts[0].balance, 1200);
  assert.strictEqual(state.financeAccounts[1].balance, 300);
});
