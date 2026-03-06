import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchRQI, computeRQI } from '../src/footballlab/result_quality_index.js';

function buildMatches({ dominant = true, partial = false } = {}){
  const strong = [
    { id: 'a1', teamId: 'a', teamName: 'A', date: '2026-01-01', score: '3-0', statsRaw: partial ? 'shots: 13' : 'xg: 2.2\nxga: 0.6\nshots: 16\nshots_against: 7\nshots_on_target: 7\nshots_on_target_against: 2\npossession: 61\ncorners: 7\nterritory: 63', narrative: 'control y dominio total' },
    { id: 'a2', teamId: 'a', teamName: 'A', date: '2026-01-05', score: '2-0', statsRaw: partial ? 'shots: 11' : 'xg: 1.9\nxga: 0.7\nshots: 14\nshots_against: 8\nshots_on_target: 6\nshots_on_target_against: 2\npossession: 58\ncorners: 6\nterritory: 59', narrative: 'equipo con autoridad y control' },
    { id: 'a3', teamId: 'a', teamName: 'A', date: '2026-01-10', score: '2-1', statsRaw: partial ? 'shots: 12' : 'xg: 1.8\nxga: 0.9\nshots: 15\nshots_against: 9\nshots_on_target: 6\nshots_on_target_against: 3\npossession: 57\ncorners: 5\nterritory: 56', narrative: 'dominio estable' },
    { id: 'a4', teamId: 'a', teamName: 'A', date: '2026-01-13', score: '1-0', statsRaw: partial ? 'shots: 10' : 'xg: 1.4\nxga: 0.5\nshots: 12\nshots_against: 6\nshots_on_target: 5\nshots_on_target_against: 2\npossession: 55\ncorners: 5\nterritory: 54', narrative: 'partido controlado' },
    { id: 'a5', teamId: 'a', teamName: 'A', date: '2026-01-17', score: '3-1', statsRaw: partial ? 'shots: 14' : 'xg: 2.1\nxga: 1.0\nshots: 17\nshots_against: 10\nshots_on_target: 8\nshots_on_target_against: 3\npossession: 60\ncorners: 7\nterritory: 62', narrative: 'dominó tramos largos con convicción' }
  ];

  const fragile = [
    { id: 'b1', teamId: 'b', teamName: 'B', date: '2026-01-01', score: '1-0', statsRaw: partial ? '' : 'xg: 0.6\nxga: 1.5\nshots: 6\nshots_against: 15\nshots_on_target: 2\nshots_on_target_against: 6\npossession: 41\ncorners: 2\nterritory: 40', narrative: 'sufrió mucho, caos total' },
    { id: 'b2', teamId: 'b', teamName: 'B', date: '2026-01-05', score: '2-1', statsRaw: partial ? '' : 'xg: 0.8\nxga: 1.7\nshots: 7\nshots_against: 16\nshots_on_target: 2\nshots_on_target_against: 7\npossession: 43\ncorners: 3\nterritory: 42', narrative: 'ganó pero sin control' },
    { id: 'b3', teamId: 'b', teamName: 'B', date: '2026-01-09', score: '1-1', statsRaw: partial ? '' : 'xg: 0.7\nxga: 1.4\nshots: 8\nshots_against: 13\nshots_on_target: 2\nshots_on_target_against: 5\npossession: 44\ncorners: 3\nterritory: 43', narrative: 'partido roto con sufrimiento' },
    { id: 'b4', teamId: 'b', teamName: 'B', date: '2026-01-14', score: '1-0', statsRaw: partial ? '' : 'xg: 0.5\nxga: 1.3\nshots: 5\nshots_against: 12\nshots_on_target: 2\nshots_on_target_against: 5\npossession: 40\ncorners: 2\nterritory: 38', narrative: 'sobrevivió con nervio' },
    { id: 'b5', teamId: 'b', teamName: 'B', date: '2026-01-18', score: '0-1', statsRaw: partial ? '' : 'xg: 0.4\nxga: 1.6\nshots: 6\nshots_against: 14\nshots_on_target: 1\nshots_on_target_against: 6\npossession: 39\ncorners: 2\nterritory: 37', narrative: 'otra vez frágil' }
  ];

  return dominant ? strong : fragile;
}

test('RQI alto cuando hay dominio claro', ()=>{
  const rqi = computeRQI({ teamName: 'A', opponentName: 'B', matches: buildMatches({ dominant: true }) });
  assert.ok(rqi.RQI >= 65);
  assert.equal(rqi.status === 'solid' || rqi.status === 'very_solid', true);
});

test('RQI bajo cuando hay victorias frágiles', ()=>{
  const rqi = computeRQI({ teamName: 'B', opponentName: 'A', matches: buildMatches({ dominant: false }) });
  assert.ok(rqi.RQI <= 50);
  assert.equal(rqi.status === 'fragile' || rqi.status === 'very_fragile' || rqi.status === 'neutral', true);
});

test('RQI neutral cuando la racha es ambigua', ()=>{
  const mixed = [
    ...buildMatches({ dominant: true }).slice(0, 2),
    ...buildMatches({ dominant: false }).slice(0, 3)
  ];
  const rqi = computeRQI({ teamName: 'Mix', opponentName: 'Rival', matches: mixed });
  assert.ok(rqi.RQI >= 45 && rqi.RQI <= 62);
});

test('buildMatchRQI funciona con datos completos', ()=>{
  const brainV2 = { memories: { home: buildMatches({ dominant: true }), away: buildMatches({ dominant: false }) } };
  const rqi = buildMatchRQI({ brainV2, home: { id: 'home', name: 'Home' }, away: { id: 'away', name: 'Away' }, N: 5 });
  assert.equal(rqi.N, 5);
  assert.equal(typeof rqi.home.RQI, 'number');
  assert.equal(typeof rqi.away.RQI, 'number');
});

test('buildMatchRQI funciona con datos parciales y no rompe sin xG/posesión', ()=>{
  const brainV2 = { memories: { home: buildMatches({ dominant: true, partial: true }), away: buildMatches({ dominant: false, partial: true }) } };
  const rqi = buildMatchRQI({ brainV2, home: { id: 'home', name: 'Home' }, away: { id: 'away', name: 'Away' }, N: 5 });
  assert.equal(typeof rqi.home.RQI, 'number');
  assert.ok(Array.isArray(rqi.home.interpretation.limitations));
});
