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
}

function setOllamaSettings(settings = {}) {
  const fullSettings = {
    enabled: true,
    apiKey: "test-key-1234567890",
    model: "llama3.1",
    baseUrl: "https://ollama.test",
    ...settings
  };
  localStorage.setItem("memorycarl_ollama_settings", JSON.stringify(fullSettings));
}

import { classifyMovementWithAI } from '../src/finance/finance_ai_classifier.js';
import { buildFinanceSnapshot } from '../src/finance/finance_snapshot_builder.js';
import '../src/finance/finance_core_v2.js';

test('classifyMovementWithAI returns null when credentials missing in localStorage', async () => {
  resetStorage();
  const res = await classifyMovementWithAI({ category: 'Alquiler', note: 'departamento', amount: 1200, direction: 'expense' });
  assert.equal(res, null);
});

test('classifyMovementWithAI returns classification when API responds with valid JSON', async () => {
  resetStorage();
  setOllamaSettings();

  const expectedAIResponse = {
    isEssential: true,
    isRecurring: true,
    isDebtRelated: false,
    derivedLabels: ["fixed_obligation"]
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://ollama.test/api/chat");
    assert.equal(options.headers["Authorization"], "Bearer test-key-1234567890");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "llama3.1");
    assert.equal(body.stream, false);
    assert.equal(body.format, "json");
    assert.equal(body.options.temperature, 0.3);

    return {
      ok: true,
      json: async () => ({
        message: { content: JSON.stringify(expectedAIResponse) }
      })
    };
  };

  try {
    const res = await classifyMovementWithAI({ category: 'Alquiler', note: 'departamento', amount: 1200, direction: 'expense' });
    assert.deepEqual(res, expectedAIResponse);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('classifyMovementWithAI returns null if response contains invalid label outside VALID_LABELS', async () => {
  resetStorage();
  setOllamaSettings();

  const invalidAIResponse = {
    isEssential: true,
    isRecurring: true,
    isDebtRelated: false,
    derivedLabels: ["fixed_obligation", "invalid_hallucinated_label"]
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      message: { content: JSON.stringify(invalidAIResponse) }
    })
  });

  try {
    const res = await classifyMovementWithAI({ category: 'Alquiler', note: 'departamento', amount: 1200, direction: 'expense' });
    assert.equal(res, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildFinanceSnapshot prefers aiClassification when present and falls back when absent', () => {
  const sample = {
    accounts: [{ id: 'a1', type: 'bank' }],
    movements: [
      {
        id: 'm1',
        date: '2025-01-02',
        type: 'expense',
        amount: 150,
        accountId: 'a1',
        category: 'Gasto Raro',
        note: 'sin palabras clave',
        aiClassification: {
          isEssential: true,
          isRecurring: false,
          isDebtRelated: true,
          derivedLabels: ['debt_related']
        }
      },
      {
        id: 'm2',
        date: '2025-01-03',
        type: 'expense',
        amount: 500,
        accountId: 'a1',
        category: 'Alquiler',
        note: 'departamento'
      }
    ]
  };

  const snapshot = buildFinanceSnapshot(sample);

  // m1 with AI classification
  const e1 = snapshot.entries.find(e => e.id === 'm1');
  assert.equal(e1.isEssential, true);
  assert.equal(e1.isRecurring, false);
  assert.equal(e1.isDebtRelated, true);
  assert.deepEqual(e1.derivedLabels, ['debt_related']);

  // m2 fallback to inferLabels
  const e2 = snapshot.entries.find(e => e.id === 'm2');
  assert.equal(e2.isEssential, true); // fixed_obligation -> essential
  assert.equal(e2.isRecurring, true); // recurringScore >= 0.65
  assert.equal(e2.isDebtRelated, false);
  assert.deepEqual(e2.derivedLabels, ['fixed_obligation']);
});

test('addMovement in finance_core_v2 triggers background classification without blocking', async () => {
  resetStorage();
  setOllamaSettings();

  let resolveFetch;
  const fetchPromise = new Promise(resolve => { resolveFetch = resolve; });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    await fetchPromise;
    return {
      ok: true,
      json: async () => ({
        message: { content: JSON.stringify({
          isEssential: false,
          isRecurring: true,
          isDebtRelated: false,
          derivedLabels: ["silent_leak_candidate"]
        }) }
      })
    };
  };

  let appRendered = false;
  window.renderApp = () => { appRendered = true; };

  try {
    const acc = window.FINANCE.createAccount({ name: 'Cuenta 1', type: 'bank', balance: 1000 });
    const mov = window.FINANCE.addMovement({
      type: 'expense',
      amount: 25,
      accountId: acc.id,
      category: 'Suscripcion',
      note: 'servicio'
    });

    // Synchronous return
    assert.equal(mov.amount, 25);
    assert.equal(mov.aiClassification, undefined);

    // Resolve AI response background promise
    resolveFetch();
    // Wait microtask queue tick
    await new Promise(r => setTimeout(r, 20));

    assert.ok(mov.aiClassification);
    assert.equal(mov.aiClassification.isEssential, false);
    assert.deepEqual(mov.aiClassification.derivedLabels, ["silent_leak_candidate"]);
    assert.equal(appRendered, true);
  } finally {
    globalThis.fetch = originalFetch;
    delete window.renderApp;
  }
});
