import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePickCLV,
  normalizePickRecord,
  computePortfolioMetrics,
  buildPerformanceBreakdowns,
  buildPerformanceInsights,
  buildBitacoraPerformanceLab
} from '../src/footballlab/bitacora_performance.js';

test('computePickCLV uses taken vs closing odds', ()=>{
  const out = computePickCLV({ oddsTaken: 2.1, closingOdds: 1.95 });
  assert.ok(out);
  assert.ok(out.clvDelta > 0);
  assert.ok(out.oddsDelta > 0);
});

test('normalizePickRecord handles missing closing odds defensively', ()=>{
  const row = normalizePickRecord({ stake: 10, odds: 2.0, result: 'win' });
  assert.equal(row.clvDelta, null);
  assert.equal(row.profit, 10);
});

test('computePortfolioMetrics calculates ROI with mixed results', ()=>{
  const rows = [
    normalizePickRecord({ stake: 10, odds: 2.0, result: 'win', date: '2026-01-01' }),
    normalizePickRecord({ stake: 20, odds: 1.8, result: 'loss', date: '2026-01-02' }),
    normalizePickRecord({ stake: 5, odds: 2.2, result: 'push', date: '2026-01-03' })
  ];
  const p = computePortfolioMetrics(rows);
  assert.equal(p.global.stakeTotal, 35);
  assert.equal(p.global.profitTotal, -10);
  assert.equal(Number((p.global.roi || 0).toFixed(4)), -0.2857);
});

test('EV acumulado ignora picks sin EV', ()=>{
  const lab = buildBitacoraPerformanceLab([
    { stake: 10, odds: 2, result: 'win', ev: 0.1, date: '2026-01-01' },
    { stake: 10, odds: 2, result: 'loss', date: '2026-01-02' },
    { stake: 5, odds: 1.6, result: 'win', evValue: 0.05, date: '2026-01-03' }
  ]);
  assert.equal(Number(lab.portfolio.global.evCumulative.toFixed(2)), 1.25);
});

test('breakdown by type groups records', ()=>{
  const rows = [
    normalizePickRecord({ stake: 10, odds: 2.0, result: 'win', pickType: '1X2' }),
    normalizePickRecord({ stake: 10, odds: 2.0, result: 'loss', pickType: '1X2' }),
    normalizePickRecord({ stake: 10, odds: 2.0, result: 'win', pickType: 'DNB' })
  ];
  const b = buildPerformanceBreakdowns(rows);
  assert.equal(b.byType.find((r)=>r.key === '1X2')?.picks, 2);
  assert.equal(b.byType.find((r)=>r.key === 'DNB')?.picks, 1);
});

test('insights generate coherent output', ()=>{
  const insights = buildPerformanceInsights({
    global: { clvAverage: 0.02, roi: -0.03 },
    breakdowns: {
      byType: [{ key: 'DNB', picks: 4, roi: 0.12 }],
      byTag: [{ key: 'edge+', picks: 4, roi: 0.1 }],
      byOdds: [{ key: '1.60-1.99', picks: 5, roi: 0.08 }]
    },
    rolling: [{ roi: 0.01 }, { roi: 0.03 }, { roi: 0.04 }, { roi: 0.05 }, { roi: 0.06 }, { roi: 0.07 }, { roi: 0.08 }, { roi: 0.09 }, { roi: 0.1 }, { roi: 0.11 }]
  });
  assert.ok(insights.length >= 3);
  assert.ok(insights[0].includes('CLV positivo'));
});
