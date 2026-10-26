import test from 'node:test';
import assert from 'node:assert/strict';
import { setFinanceStorageAdapter } from '../src/finance/finance_storage.js';

const LS_KEY = 'finance_v2_state';
let n = 0;

function makeEnv({ ls = {}, idb = {}, idbFailsWrite = false, idbReadDelayMs = 0 } = {}) {
  const lsMap = new Map(Object.entries(ls));
  globalThis.localStorage = {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => { lsMap.set(k, String(v)); },
    removeItem: (k) => { lsMap.delete(k); },
  };
  globalThis.window = globalThis;
  window.state = { financeAccounts: [] };
  const idbMap = new Map(Object.entries(idb));
  const writes = [];
  setFinanceStorageAdapter({
    get: async (k) => { if (idbReadDelayMs) await new Promise(r => setTimeout(r, idbReadDelayMs)); return idbMap.has(k) ? idbMap.get(k) : null; },
    set: async (k, v) => { if (idbFailsWrite) throw new Error('idb write fail'); writes.push(v); idbMap.set(k, v); },
  });
  return { lsMap, idbMap, writes };
}

async function freshFinance() {
  await import(`../src/finance/finance_core_v2.js?case=${++n}`);
  return window.FINANCE;
}

const mov = (id, amount = 5) => ({ id, date: '2026-10-11T10:00:00Z', type: 'expense', amount, accountId: 'a1', category: 'Test' });

test('hidratación: si memoria vacía, adopta los movimientos de IndexedDB', async () => {
  const saved = JSON.stringify({ movements: [mov('m1'), mov('m2')], currentMonth: 9, currentYear: 2026 });
  makeEnv({ idb: { [LS_KEY]: saved } });
  const F = await freshFinance();
  const adopted = await F.ready;
  assert.equal(adopted, true);
  assert.equal(F.state.movements.length, 2);
});

test('migración: copia legacy en localStorage pasa a IndexedDB y luego se borra de localStorage', async () => {
  const legacy = JSON.stringify({ movements: [mov('m1'), mov('m2'), mov('m3')], currentMonth: 9, currentYear: 2026 });
  const env = makeEnv({ ls: { [LS_KEY]: legacy } });
  const F = await freshFinance();
  await F.ready;
  await F.flush();
  assert.equal(F.state.movements.length, 3);
  assert.equal(env.idbMap.has(LS_KEY), true, 'debe existir en IndexedDB');
  assert.equal(JSON.parse(env.idbMap.get(LS_KEY)).movements.length, 3);
  assert.equal(env.lsMap.has(LS_KEY), false, 'se libera localStorage solo tras verificar IndexedDB');
});

test('un save() antes de terminar la hidratación NO pisa IndexedDB con estado vacío', async () => {
  const saved = JSON.stringify({ movements: [mov('m1'), mov('m2')], currentMonth: 9, currentYear: 2026 });
  const env = makeEnv({ idb: { [LS_KEY]: saved }, idbReadDelayMs: 30 });
  const F = await freshFinance();
  F.save(); // llamado mientras IndexedDB aún no respondió (movements=[])
  await new Promise(r => setTimeout(r, 400));
  await F.ready;
  await F.flush();
  assert.equal(F.state.movements.length, 2, 'los datos de IndexedDB se cargan');
  const stored = JSON.parse(env.idbMap.get(LS_KEY));
  assert.equal(stored.movements.length, 2, 'IndexedDB conserva los movimientos');
});

test('save() persiste en IndexedDB (debounced) y no usa localStorage', async () => {
  const env = makeEnv();
  const F = await freshFinance();
  await F.ready;
  F.state.accounts = [{ id: 'a1', name: 'Cash', type: 'cash', balance: 100 }];
  F.addMovement({ accountId: 'a1', type: 'expense', amount: 10, category: 'Food' });
  F.addMovement({ accountId: 'a1', type: 'expense', amount: 20, category: 'Food' });
  await F.flush();
  assert.equal(JSON.parse(env.idbMap.get(LS_KEY)).movements.length, 2);
  assert.equal(env.lsMap.has(LS_KEY), false);
  assert.ok(env.writes.length <= 2, 'el debounce agrupa escrituras');
});

test('si IndexedDB falla al escribir, cae a localStorage (no se pierde el guardado)', async () => {
  const env = makeEnv({ idbFailsWrite: true });
  const F = await freshFinance();
  await F.ready;
  F.state.accounts = [{ id: 'a1', name: 'Cash', type: 'cash', balance: 100 }];
  F.addMovement({ accountId: 'a1', type: 'expense', amount: 10, category: 'Food' });
  await F.flush();
  assert.equal(env.lsMap.has(LS_KEY), true);
  assert.equal(JSON.parse(env.lsMap.get(LS_KEY)).movements.length, 1);
});

test('sin IndexedDB (adaptador nulo y sin indexedDB global) usa el camino anterior de localStorage', async () => {
  const env = makeEnv();
  setFinanceStorageAdapter(null);
  assert.equal(typeof globalThis.indexedDB, 'undefined');
  const F = await freshFinance();
  await F.ready;
  F.state.accounts = [{ id: 'a1', name: 'Cash', type: 'cash', balance: 100 }];
  F.addMovement({ accountId: 'a1', type: 'expense', amount: 10, category: 'Food' });
  assert.equal(JSON.parse(env.lsMap.get(LS_KEY)).movements.length, 1);
});
