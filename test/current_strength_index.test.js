import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchCSI, computeCSI } from '../src/footballlab/current_strength_index.js';

function buildBrain(){
  return {
    memories: {
      psg: [
        { id: 'p1', teamId: 'psg', teamName: 'PSG', date: '2026-01-01', score: '2-0', opponent: 'Monaco', statsRaw: 'xg: 1.9\nshots: 14\nshots_on_target: 6\npossession: 58\ncorners: 6\ndangerous_attacks: 34', narrative: 'partido con control y dominio', lineup: ['a','b','c','d','e','f','g','h','i','j','k'] },
        { id: 'p2', teamId: 'psg', teamName: 'PSG', date: '2026-01-05', score: '1-1', opponent: 'Lyon', statsRaw: 'xg: 1.5\nshots: 12\nshots_on_target: 5\npossession: 55\ncorners: 5\ndangerous_attacks: 30', narrative: 'remontada y presión final', lineup: ['a','b','c','d','e','f','g','h','i','x','k'] },
        { id: 'p3', teamId: 'psg', teamName: 'PSG', date: '2026-01-09', score: '3-1', opponent: 'Nice', statsRaw: 'xg: 2.1\nshots: 16\nshots_on_target: 7\npossession: 61\ncorners: 7\ndangerous_attacks: 38', narrative: 'control total', lineup: ['a','b','c','d','e','f','g','h','i','j','k'] },
        { id: 'p4', teamId: 'psg', teamName: 'PSG', date: '2026-01-13', score: '2-1', opponent: 'Lille', statsRaw: 'xg: 1.8\nshots: 13\nshots_on_target: 5\npossession: 57\ncorners: 6\ndangerous_attacks: 32', narrative: 'buen ritmo', lineup: ['a','b','c','d','e','f','g','h','i','j','k'] },
        { id: 'p5', teamId: 'psg', teamName: 'PSG', date: '2026-01-18', score: '2-0', opponent: 'Lens', statsRaw: 'xg: 1.7\nshots: 11\nshots_on_target: 4\npossession: 54\ncorners: 5\ndangerous_attacks: 29', narrative: 'equipo sólido', lineup: ['a','b','c','d','e','f','g','h','i','j','k'] }
      ],
      mon: [
        { id: 'm1', teamId: 'mon', teamName: 'Monaco', date: '2026-01-01', score: '0-1', opponent: 'PSG', statsRaw: 'xg: 0.9\nshots: 8\nshots_on_target: 2\npossession: 46\ncorners: 3\ndangerous_attacks: 21', narrative: 'fragil en defensa', lineup: ['a1','b1','c1','d1','e1','f1','g1','h1','i1','j1','k1'] },
        { id: 'm2', teamId: 'mon', teamName: 'Monaco', date: '2026-01-05', score: '1-2', opponent: 'Lyon', statsRaw: 'xg: 1.0\nshots: 9\nshots_on_target: 3\npossession: 48\ncorners: 3\ndangerous_attacks: 22', narrative: 'caos y errores', lineup: ['a1','b1','c1','d1','e1','f1','g1','h1','i1','x1','k1'] },
        { id: 'm3', teamId: 'mon', teamName: 'Monaco', date: '2026-01-10', score: '2-2', opponent: 'Nice', statsRaw: 'xg: 1.1\nshots: 10\nshots_on_target: 3\npossession: 49\ncorners: 4\ndangerous_attacks: 24', narrative: 'reacción tarde', lineup: ['a1','b1','c1','d1','e1','f1','g1','h1','i1','j1','k1'] },
        { id: 'm4', teamId: 'mon', teamName: 'Monaco', date: '2026-01-14', score: '1-1', opponent: 'Lille', statsRaw: 'xg: 1.0\nshots: 9\nshots_on_target: 3\npossession: 47\ncorners: 4\ndangerous_attacks: 22', narrative: 'sin control', lineup: ['a1','b1','c1','d1','e1','f1','g1','h1','i1','j1','k1'] },
        { id: 'm5', teamId: 'mon', teamName: 'Monaco', date: '2026-01-19', score: '0-0', opponent: 'Lens', statsRaw: 'xg: 0.8\nshots: 7\nshots_on_target: 2\npossession: 44\ncorners: 3\ndangerous_attacks: 18', narrative: 'poca presión', lineup: ['a1','b1','c1','d1','e1','f1','g1','h1','i1','j1','k1'] }
      ]
    }
  };
}

test('CSI calcula con datos completos', ()=>{
  const brainV2 = buildBrain();
  const csi = buildMatchCSI({ brainV2, home: { id: 'psg', name: 'PSG' }, away: { id: 'mon', name: 'Monaco' }, N: 5 });
  assert.equal(csi.N, 5);
  assert.ok(Number.isFinite(csi.home.CSI));
  assert.ok(Number.isFinite(csi.away.CSI));
});

test('CSI calcula con datos parciales y reporta limitaciones', ()=>{
  const partial = {
    memories: {
      a: [{ id: 'a1', teamId: 'a', teamName: 'A', date: '2026-02-01', score: '1-0', opponent: 'B', statsRaw: '', narrative: 'partido cerrado' }],
      b: [{ id: 'b1', teamId: 'b', teamName: 'B', date: '2026-02-01', score: '0-1', opponent: 'A', statsRaw: '', narrative: '' }]
    }
  };
  const csi = buildMatchCSI({ brainV2: partial, home: { id: 'a', name: 'A' }, away: { id: 'b', name: 'B' }, N: 5 });
  assert.ok(Array.isArray(csi.home.explanation.limitations));
  assert.ok(csi.home.explanation.limitations.length > 0);
});

test('computeCSI responde distinto para equipos distintos', ()=>{
  const brainV2 = buildBrain();
  const psg = brainV2.memories.psg;
  const mon = brainV2.memories.mon;
  const csiA = computeCSI({ teamName: 'PSG', opponentName: 'Monaco', matches: psg, opponentMatches: mon });
  const csiB = computeCSI({ teamName: 'Monaco', opponentName: 'PSG', matches: mon, opponentMatches: psg });
  assert.notEqual(csiA.CSI, csiB.CSI);
});

test('buildMatchCSI respeta ventana N=5 por defecto', ()=>{
  const brainV2 = buildBrain();
  const csi = buildMatchCSI({ brainV2, home: { id: 'psg', name: 'PSG' }, away: { id: 'mon', name: 'Monaco' } });
  assert.equal(csi.N, 5);
});
