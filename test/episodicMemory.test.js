import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
if (typeof localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

function resetStorage() {
  Object.keys(store).forEach((k) => delete store[k]);
}

import {
  loadEpisodicMemory,
  saveEpisodicMemory,
  recordEpisode,
  inferContext,
  recalculateStats,
  getRankedEpisodicNeurons,
} from '../src/finance/finance_episodic_memory.js';

test('recordEpisode crea neurona nueva si no existe', () => {
  resetStorage();
  recordEpisode({
    id: 'm1',
    date: '2026-03-01T10:00:00.000Z',
    type: 'expense',
    amount: -50,
    category: 'Comida Rápida',
    note: 'capricho de viernes',
    accountId: 'acc_1',
  }, new Map([['acc_1', { id: 'acc_1', type: 'checking' }]]));

  const neurons = loadEpisodicMemory();
  assert.equal(neurons.length, 1);
  assert.equal(neurons[0].category, 'Comida Rápida');
  assert.equal(neurons[0].episodes.length, 1);
});

test('recordEpisode actualiza neurona existente', () => {
  resetStorage();
  recordEpisode({ id: 'm1', date: '2026-03-01', type: 'expense', amount: -20, category: 'Transporte', note: 'bus', accountId: 'a1' }, new Map([['a1', { type: 'checking' }]]));
  recordEpisode({ id: 'm2', date: '2026-03-02', type: 'expense', amount: -30, category: 'Transporte', note: 'taxi', accountId: 'a1' }, new Map([['a1', { type: 'checking' }]]));

  const neurons = loadEpisodicMemory();
  assert.equal(neurons.length, 1);
  assert.equal(neurons[0].episodes.length, 2);
  assert.equal(neurons[0].stats.episodeCount, 2);
});

test('inferContext detecta urgencia correctamente', () => {
  const context = inferContext('pago urgente por emergencia hospitalaria', 'Salud');
  assert.equal(context, 'urgencia');
});

test('recalculateStats marca wasAnomaly true cuando corresponde', () => {
  const neuron = {
    episodes: [
      { date: '2026-03-01', amount: 10, context: 'desconocido', emotional: 'neutral', wasAnomaly: false },
      { date: '2026-03-02', amount: 11, context: 'desconocido', emotional: 'neutral', wasAnomaly: false },
      { date: '2026-03-03', amount: 9, context: 'desconocido', emotional: 'neutral', wasAnomaly: false },
      { date: '2026-03-04', amount: 90, context: 'desconocido', emotional: 'neutral', wasAnomaly: false },
    ],
    stats: {},
  };
  recalculateStats(neuron);
  assert.equal(neuron.episodes.at(-1).wasAnomaly, true);
});

test('getRankedEpisodicNeurons ordena por relevancia', () => {
  resetStorage();
  const n1 = {
    id: 'n1', label: 'A', category: 'A', family: 'habit', episodes: Array.from({ length: 6 }, (_, i) => ({ movementId: `a${i}`, date: '2026-03-01', amount: 10, context: 'habito', emotional: 'evitable', wasAnomaly: false })),
    stats: { episodeCount: 6, trend: 'stable', avgAmount: 10, stdDev: 0, frequency: 'weekly', lastSeenAt: '2026-03-01', totalSpent: 60, dominantContext: 'habito', dominantEmotion: 'evitable' }, createdAt: '2026-03-01', updatedAt: '2026-03-01'
  };
  const n2 = {
    id: 'n2', label: 'B', category: 'B', family: 'habit', episodes: Array.from({ length: 4 }, (_, i) => ({ movementId: `b${i}`, date: '2026-03-01', amount: 10, context: 'habito', emotional: 'evitable', wasAnomaly: false })),
    stats: { episodeCount: 4, trend: 'growing', avgAmount: 10, stdDev: 0, frequency: 'weekly', lastSeenAt: '2026-03-01', totalSpent: 40, dominantContext: 'habito', dominantEmotion: 'evitable' }, createdAt: '2026-03-01', updatedAt: '2026-03-01'
  };
  saveEpisodicMemory([n1, n2]);
  const ranked = getRankedEpisodicNeurons(2);
  assert.equal(ranked[0].id, 'n1');
  assert.equal(ranked[1].id, 'n2');
});
