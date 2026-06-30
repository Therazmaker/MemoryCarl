import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSeasonBaseMetrics,
  computeRecentFormMetrics,
  computeFormSurpriseIndex,
  classifyFormSurprise,
  buildTeamFormSurpriseSignal
} from '../src/footballlab/form_surprise_index.js';

test('computeSeasonBaseMetrics calcula métricas base desde bloque manual', ()=>{
  const metrics = computeSeasonBaseMetrics({ pj: 24, g: 18, e: 3, p: 3, gf: 53, gc: 19, pts: 57 });
  assert.ok(metrics);
  assert.equal(metrics.ppg, 2.38);
  assert.equal(metrics.gfpg, 2.21);
  assert.equal(metrics.gcpg, 0.79);
  assert.equal(metrics.dgpg, 1.42);
});

test('computeRecentFormMetrics calcula forma desde últimos partidos', ()=>{
  const rows = [
    { score: '2-0' },
    { score: '1-1' },
    { score: '3-1' },
    { score: '0-1' },
    { score: '2-1' }
  ];
  const metrics = computeRecentFormMetrics(rows, { minMatches: 3 });
  assert.ok(metrics);
  assert.equal(metrics.played, 5);
  assert.equal(metrics.points, 10);
  assert.equal(metrics.ppg, 2);
});

test('FSI clasifica above_expectation cuando recent > base', ()=>{
  const seasonBase = computeSeasonBaseMetrics({ pj: 20, gf: 30, gc: 22, pts: 32, dg: 8 });
  const recentForm = { ppg: 2.2, gfpg: 2, gcpg: 0.8, dgpg: 1.2 };
  const fsi = computeFormSurpriseIndex({ seasonBase, recentForm });
  assert.ok(fsi > 18);
  assert.match(classifyFormSurprise(fsi), /above_expectation/);
});

test('FSI clasifica normal cuando recent ~ base', ()=>{
  const seasonBase = computeSeasonBaseMetrics({ pj: 20, gf: 32, gc: 20, pts: 36, dg: 12 });
  const recentForm = { ppg: 1.82, gfpg: 1.58, gcpg: 1.02, dgpg: 0.56 };
  const fsi = computeFormSurpriseIndex({ seasonBase, recentForm });
  assert.equal(classifyFormSurprise(fsi), 'normal');
});

test('FSI clasifica below_expectation cuando recent < base', ()=>{
  const seasonBase = computeSeasonBaseMetrics({ pj: 20, gf: 40, gc: 18, pts: 45, dg: 22 });
  const recentForm = { ppg: 1.1, gfpg: 1.1, gcpg: 1.4, dgpg: -0.3 };
  const fsi = computeFormSurpriseIndex({ seasonBase, recentForm });
  assert.ok(fsi < -18);
  assert.match(classifyFormSurprise(fsi), /below_expectation/);
});

test('buildTeamFormSurpriseSignal no rompe con datos faltantes', ()=>{
  const out = buildTeamFormSurpriseSignal({
    brainV2: { memories: { t1: [{ teamId: 't1', teamName: 'Test', date: '2026-01-01', score: '1-0' }] } },
    team: { id: 't1', name: 'Test', intProfile: {} },
    N: 5
  });
  assert.equal(out.status, 'unavailable');
  assert.equal(out.FSI, null);
});
