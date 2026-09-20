import test from 'node:test';
import assert from 'node:assert/strict';

// Setup global environment for localStorage and window before ES module imports
const store = {};
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

function resetStorage() {
  Object.keys(store).forEach((k) => delete store[k]);
  if (window.FINANCE && window.FINANCE.state) {
    window.FINANCE.state.movements = [];
  }
}

import '../src/finance/finance_core_v2.js';

test('addMovement saves movement and updates balance when account is in window.state.financeAccounts', () => {
  resetStorage();

  globalThis.state = {
    financeAccounts: [
      { id: 'acc_bcp', name: 'BCP', type: 'bank', balance: 500 }
    ],
    financeLedger: []
  };

  const entry = {
    type: 'expense',
    amount: 150,
    accountId: 'acc_bcp',
    category: 'Alimentos',
    note: 'Supermercado'
  };

  const created = window.FINANCE.addMovement(entry);

  assert.ok(created);
  assert.equal(created.amount, 150);
  assert.equal(created.accountId, 'acc_bcp');

  // Verify movement was stored in FINANCE.state.movements
  assert.equal(window.FINANCE.state.movements.length, 1);
  assert.equal(window.FINANCE.state.movements[0].id, created.id);

  // Verify account balance was deducted
  assert.equal(globalThis.state.financeAccounts[0].balance, 350);
});

test('addMovement handles income by increasing balance', () => {
  resetStorage();

  globalThis.state = {
    financeAccounts: [
      { id: 'acc_bcp', name: 'BCP', type: 'bank', balance: 350 }
    ],
    financeLedger: []
  };

  const entry = {
    type: 'income',
    amount: 200,
    accountId: 'acc_bcp',
    category: 'Sueldo',
    note: 'Trabajo'
  };

  const created = window.FINANCE.addMovement(entry);

  assert.ok(created);
  assert.equal(globalThis.state.financeAccounts[0].balance, 550);
});

test('updateMovement updates movement data and recalculates balance', () => {
  resetStorage();

  globalThis.state = {
    financeAccounts: [
      { id: 'acc_bcp', name: 'BCP', type: 'bank', balance: 500 }
    ],
    financeLedger: []
  };

  const created = window.FINANCE.addMovement({
    type: 'expense',
    amount: 100,
    accountId: 'acc_bcp',
    category: 'Transporte',
    note: 'Taxi'
  });

  assert.equal(globalThis.state.financeAccounts[0].balance, 400);

  // Update movement amount from 100 to 150
  const updated = window.FINANCE.updateMovement(created.id, { amount: 150 });

  assert.equal(updated.amount, 150);
  assert.equal(globalThis.state.financeAccounts[0].balance, 350);
});

test('deleteMovement removes movement and reverts balance', () => {
  resetStorage();

  globalThis.state = {
    financeAccounts: [
      { id: 'acc_bcp', name: 'BCP', type: 'bank', balance: 500 }
    ],
    financeLedger: []
  };

  const created = window.FINANCE.addMovement({
    type: 'expense',
    amount: 80,
    accountId: 'acc_bcp',
    category: 'Ocio',
    note: 'Cine'
  });

  assert.equal(globalThis.state.financeAccounts[0].balance, 420);
  assert.equal(window.FINANCE.state.movements.length, 1);

  window.FINANCE.deleteMovement(created.id);

  assert.equal(window.FINANCE.state.movements.length, 0);
  assert.equal(globalThis.state.financeAccounts[0].balance, 500);
});
