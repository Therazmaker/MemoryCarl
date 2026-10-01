import test from 'node:test';
import assert from 'node:assert/strict';

// Mock browser environment
globalThis.window = globalThis;
globalThis.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; }
};

await import('../src/finance/finance_core_v2.js');

test('Transfer movement logic correctly transfers balance between accounts', async (t) => {
  const accA = { id: 'accA', name: 'Cuenta A', type: 'bank', balance: 500 };
  const accB = { id: 'accB', name: 'Cuenta B', type: 'bank', balance: 200 };
  window.state = { financeAccounts: [accA, accB] };

  // Add transfer movement from A to B of 150
  const trf = window.FINANCE.addMovement({
    type: 'transfer',
    amount: 150,
    accountId: 'accA',
    toAccountId: 'accB',
    note: 'Traspaso de prueba'
  });

  assert.equal(trf.type, 'transfer');
  assert.equal(accA.balance, 350, 'Account A should decrease by 150');
  assert.equal(accB.balance, 350, 'Account B should increase by 150');

  // Update transfer amount to 200
  window.FINANCE.updateMovement(trf.id, { amount: 200 });
  assert.equal(accA.balance, 300, 'Account A should decrease by 200 total');
  assert.equal(accB.balance, 400, 'Account B should increase by 200 total');

  // Delete transfer movement
  window.FINANCE.deleteMovement(trf.id);
  assert.equal(accA.balance, 500, 'Account A balance should revert to initial');
  assert.equal(accB.balance, 200, 'Account B balance should revert to initial');
});
