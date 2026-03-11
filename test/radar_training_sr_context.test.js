import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSrContext,
  buildSrContextFromQuickAdd,
  updateSignalSrContext,
  filterSignalsBySr,
  computeSrStats,
  buildSrInsights,
  createTrainingRecord,
  buildTrainingReport,
  loadTrainingState,
  defaultTrainingState
} from '../src/radar_training_engine.js';

test('normalizeSrContext aplica defaults seguros', ()=>{
  assert.deepEqual(normalizeSrContext(null), { nearSupport: false, nearResistance: false, srComment: '' });
  assert.deepEqual(normalizeSrContext({ nearSupport: 1, nearResistance: 0, srComment: '  zona fuerte ' }), {
    nearSupport: true,
    nearResistance: false,
    srComment: 'zona fuerte'
  });
});

test('quick add y updateSignalSrContext preservan estructura SR', ()=>{
  const sr = buildSrContextFromQuickAdd({ nearSupport: true, srComment: 'TV H1' });
  const updated = updateSignalSrContext({ id: 's1' }, sr);
  assert.equal(updated.srContext.nearSupport, true);
  assert.equal(updated.srContext.nearResistance, false);
  assert.equal(updated.srContext.srComment, 'TV H1');
});

test('filterSignalsBySr soporta only/exclude', ()=>{
  const signals = [
    { id: 'a', srContext: { nearSupport: true } },
    { id: 'b', srContext: { nearResistance: true } },
    { id: 'c', srContext: {} }
  ];
  assert.deepEqual(filterSignalsBySr(signals, { nearSupport: 'only' }).map(s=>s.id), ['a']);
  assert.deepEqual(filterSignalsBySr(signals, { nearResistance: 'exclude' }).map(s=>s.id), ['a', 'c']);
});

function mkRecord({ id, srContext, acc, status = 'resolved' }){
  return {
    id,
    status,
    srContext,
    evaluation: status === 'resolved' ? { summary: { matchAccuracy: acc } } : null
  };
}

test('computeSrStats calcula baseline y buckets S/R', ()=>{
  const stats = computeSrStats([
    mkRecord({ id: '1', srContext: { nearSupport: true }, acc: 1 }),
    mkRecord({ id: '2', srContext: { nearResistance: true }, acc: 0 }),
    mkRecord({ id: '3', srContext: {}, acc: 1 }),
    mkRecord({ id: '4', srContext: { nearSupport: true, nearResistance: true }, acc: 0 })
  ]);
  assert.equal(stats.baseline.reviewed, 4);
  assert.equal(stats.nearSupport.total, 2);
  assert.equal(stats.nearResistance.total, 2);
  assert.equal(stats.combined.neither.total, 1);
});

test('buildSrInsights usa lenguaje prudente', ()=>{
  const insights = buildSrInsights({
    baseline: { winrate: 0.5 },
    nearSupport: { winrate: 0.7, reviewed: 3 },
    nearResistance: { winrate: 0.3, reviewed: 3 }
  });
  assert.ok(insights.some(line => line.includes('mejor rendimiento')));
  assert.ok(insights.some(line => line.includes('degradarse')));
  assert.ok(insights.some(line => line.includes('todavía es baja')));
  assert.ok(insights.some(line => line.includes('más evidencia')));
});

test('createTrainingRecord y loadTrainingState mantienen compatibilidad SR', ()=>{
  const rec = createTrainingRecord({
    matchData: { id: 'm1', home: 'H', away: 'A' },
    aiPrediction: { markets: {}, confidence: 0.6 },
    srContext: { nearSupport: true, srComment: 'manual tv' }
  }).record;
  assert.equal(rec.srContext.nearSupport, true);

  const loaded = loadTrainingState({ records: [{ id: 'old' }] });
  assert.deepEqual(loaded.records[0].srContext, { nearSupport: false, nearResistance: false, srComment: '' });
});

test('buildTrainingReport incorpora SR Context Analysis', ()=>{
  const base = defaultTrainingState();
  const report = buildTrainingReport({
    ...base,
    records: [mkRecord({ id: '1', srContext: { nearSupport: true }, acc: 1 })],
    globalMetrics: { ...base.globalMetrics, overallAccuracy: 1, lastRecomputed: null }
  });
  assert.equal(typeof report.srContextAnalysis.baseline.total, 'number');
  assert.ok(Array.isArray(report.srContextAnalysis.insights));
});
