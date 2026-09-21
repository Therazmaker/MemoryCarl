import test from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage and window environment
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, val) => {
    if (key === 'trigger_quota_err') {
      const err = new Error("Setting the value of 'finance_v2_state' exceeded the quota.");
      err.name = 'QuotaExceededError';
      err.code = 22;
      throw err;
    }
    storage.set(key, String(val));
  },
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear()
};

globalThis.window = globalThis;
window.state = { financeAccounts: [{ id: 'acc_1', name: 'Cash', type: 'cash', balance: 100 }] };

await import('../src/finance/finance_core_v2.js');

test('FINANCE.addMovement handles QuotaExceededError gracefully without crashing', () => {
  // force setItem to throw quota exceeded error
  const origSetItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    const err = new Error("Setting the value exceeded quota.");
    err.name = 'QuotaExceededError';
    throw err;
  };

  assert.doesNotThrow(() => {
    window.FINANCE.addMovement({
      accountId: 'acc_1',
      type: 'expense',
      amount: 10,
      category: 'Food',
      note: 'Test quota error'
    });
  });

  globalThis.localStorage.setItem = origSetItem;
});

test('FINANCE.fetchPendingTelegramTransactions uses fallback default endpoint', async () => {
  globalThis.localStorage.removeItem('memorycarl_script_url');
  globalThis.localStorage.removeItem('memorycarl_script_api_key');

  let fetchedUrl = '';
  let fetchedHeaders = {};

  globalThis.fetch = async (url, options) => {
    fetchedUrl = url;
    fetchedHeaders = options?.headers || {};
    return {
      ok: true,
      json: async () => ({ status: 'ok', data: [] })
    };
  };

  await window.FINANCE.fetchPendingTelegramTransactions();

  assert.equal(fetchedUrl, 'https://memory-carl.vercel.app/api/telegram/pending');
  assert.equal(fetchedHeaders['Content-Type'], 'application/json');
});
