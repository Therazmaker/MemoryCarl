import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinanceSnapshot } from '../src/finance/finance_snapshot_builder.js';
import { detectPatternNeurons, mergeNeurons } from '../src/finance/finance_pattern_detector.js';
import { updateHippocampus } from '../src/finance/finance_hippocampus.js';
import { generateFinanceInsights } from '../src/finance/finance_insight_engine.js';
import { loadFinanceBrainState, saveFinanceBrainState, BRAIN_STORAGE_KEY, LEGACY_NEURON_KEY } from '../src/finance/finance_neural_storage.js';
import { runFinanceBrainScan } from '../src/finance/finance_brain_engine.js';
import { actualizarSistemaFinanciero, getAllNeuronas, NeuronaFinanciera, saveNeurona, getNeurona, neuronasEscanearTodo } from '../src/finance/neuron_financiera.js';

const store = {};
if (typeof localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
}

function resetStorage() {
  Object.keys(store).forEach((k) => delete store[k]);
}

const sample = {
  accounts: [{ id: 'a1', type: 'bank' }],
  movements: [
    { id: 'm1', date: '2025-01-02', type: 'income', amount: 3000, accountId: 'a1', category: 'Salario' },
    { id: 'm2', date: '2025-01-03', type: 'expense', amount: -45, accountId: 'a1', category: 'Suscripcion Streaming', note: 'mensual' },
    { id: 'm3', date: '2025-01-10', type: 'expense', amount: -900, accountId: 'a1', category: 'Renta' }
  ]
};

test('snapshot normalization derives enriched fields', () => {
  const snapshot = buildFinanceSnapshot(sample);
  assert.equal(snapshot.entries.length, 3);
  const rent = snapshot.entries.find((e) => e.category === 'Renta');
  assert.equal(rent.direction, 'expense');
  assert.equal(rent.isEssential, true);
  assert.ok(rent.monthKey);
  assert.ok(rent.weekKey);
});

test('recurring pattern and silent leak detection activates neurons', () => {
  const snapshot = buildFinanceSnapshot(sample);
  const neurons = detectPatternNeurons(snapshot, []);
  assert.ok(neurons.some((n) => n.type === 'recurring_monthly'));
  assert.ok(neurons.some((n) => n.type === 'silent_leak'));
});

test('hippocampus aggregates monthly and weekly metrics', () => {
  const snapshot = buildFinanceSnapshot(sample);
  const neurons = detectPatternNeurons(snapshot, []);
  const hip = updateHippocampus({}, snapshot, neurons, new Date('2025-01-15T10:00:00.000Z'));
  assert.ok(Object.keys(hip.monthly).includes('2025-01'));
  assert.ok(Object.keys(hip.weekly).length >= 1);
  assert.ok(hip.monthly['2025-01'].totalExpenses > 0);
});

test('neuron merging dedupes by type', () => {
  const merged = mergeNeurons(
    [{ id: 'n1', type: 'silent_leak', family: 'risk', score: 0.4, confidence: 0.6, supportingEvidence: [], lastActivatedAt: null }],
    [{ id: 'n2', type: 'silent_leak', family: 'risk', score: 0.9, confidence: 0.8, supportingEvidence: [{ a: 1 }], lastActivatedAt: 'now' }]
  );
  assert.equal(merged.length, 1);
  assert.ok(merged[0].score > 0.4);
  assert.equal(merged[0].lastActivatedAt, 'now');
});

test('insight generation emits practical risk/opportunity insights', () => {
  const snapshot = buildFinanceSnapshot(sample);
  const neurons = detectPatternNeurons(snapshot, []);
  const hip = updateHippocampus({}, snapshot, neurons, new Date('2025-01-15T10:00:00.000Z'));
  const insights = generateFinanceInsights({ snapshot, neurons, hippocampus: hip });
  assert.ok(insights.length >= 1);
  assert.ok(insights.every((i) => i.priority));
});

test('persistence migration from legacy storage is supported', () => {
  resetStorage();
  localStorage.setItem(LEGACY_NEURON_KEY, JSON.stringify([{ id: 'legacy_1', tipo: 'consumo', nombre: 'Legacy', monto: 100, peso: 0.5 }]));
  const state = loadFinanceBrainState();
  assert.equal(state.version, 2);
  assert.ok(state.neuronRegistry.length >= 1);
  assert.ok(localStorage.getItem(BRAIN_STORAGE_KEY));
});

test('repeated scan remains stable without neuron explosion', () => {
  resetStorage();
  runFinanceBrainScan({ financeState: sample, now: '2025-01-15T10:00:00.000Z' });
  const once = loadFinanceBrainState().neuronRegistry.length;
  runFinanceBrainScan({ financeState: sample, now: '2025-01-15T11:00:00.000Z' });
  const twice = loadFinanceBrainState().neuronRegistry.length;
  assert.equal(once, twice);
});

test('compatibility API keeps legacy neurona CRUD behavior', () => {
  resetStorage();
  const n = new NeuronaFinanciera({ id: 'x1', tipo: 'consumo', nombre: 'Manual', monto: 20 });
  saveNeurona(n);
  const found = getNeurona('x1');
  assert.equal(found.nombre, 'Manual');
  assert.ok(getAllNeuronas().length >= 1);
});

test('actualizarSistemaFinanciero and escanearTodo still process app-like data', () => {
  resetStorage();
  const result = actualizarSistemaFinanciero({ transacciones: [{ nombre: 'Taxi', monto: 30, tipo: 'consumo' }] });
  assert.ok(Array.isArray(result.neuronas));

  globalThis.state = { financeLedger: [{ type: 'expense', amount: -22, category: 'Cafe', date: '2025-01-02' }] };
  neuronasEscanearTodo();
  assert.ok(getAllNeuronas().length >= 1);
});
