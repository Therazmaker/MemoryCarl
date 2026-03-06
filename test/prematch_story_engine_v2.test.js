import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrematchInsights, composePrematchEditorial, collectPrematchData } from '../src/footballlab/prematch_story_engine_v2.js';

function buildDb(){
  return {
    leagues: [{ id: 'L1', name: 'Ligue 1' }],
    teams: [
      { id: 'psg', name: 'PSG', leagueId: 'L1' },
      { id: 'mon', name: 'Monaco', leagueId: 'L1' },
      { id: 'nic', name: 'Nice', leagueId: 'L1' }
    ],
    players: [
      { teamId: 'psg', name: 'Dembélé', rating: 8.2 },
      { teamId: 'psg', name: 'Vitinha', rating: 7.9 },
      { teamId: 'mon', name: 'Ben Yedder', rating: 8.0 }
    ],
    tracker: [
      { leagueId: 'L1', homeId: 'psg', awayId: 'mon', homeGoals: 2, awayGoals: 1, date: '2026-01-01' },
      { leagueId: 'L1', homeId: 'mon', awayId: 'psg', homeGoals: 1, awayGoals: 1, date: '2025-10-10' },
      { leagueId: 'L1', homeId: 'psg', awayId: 'nic', homeGoals: 3, awayGoals: 0, date: '2026-01-10' },
      { leagueId: 'L1', homeId: 'nic', awayId: 'psg', homeGoals: 0, awayGoals: 2, date: '2026-01-15' },
      { leagueId: 'L1', homeId: 'mon', awayId: 'nic', homeGoals: 1, awayGoals: 0, date: '2026-01-12' },
      { leagueId: 'L1', homeId: 'nic', awayId: 'mon', homeGoals: 2, awayGoals: 2, date: '2026-01-18' }
    ]
  };
}

test('detects title race context when both are near top', ()=>{
  const db = buildDb();
  const data = collectPrematchData({ db, homeId: 'psg', awayId: 'mon', leagueId: 'L1' });
  assert.equal(data.context.stakes, 'title_race');
});

test('detects favorite_but_not_free when market/readiness home edge but away form stronger', ()=>{
  const insights = buildPrematchInsights({
    match: { home: 'PSG', away: 'Monaco', homeId: 'psg', awayId: 'mon' },
    context: { stakes: 'title_race' },
    standings: {},
    form: {
      homeLast5: { played: 5, points: 7, trendLabel: 'mixed' },
      awayLast5: { played: 5, points: 12, trendLabel: 'strong' }
    },
    homeAway: { home: { played: 5, ppg: 2.0 }, away: { played: 5, ppg: 1.8 } },
    h2h: { matches: [] },
    readiness: { home: { readinessScore: 72 }, away: { readinessScore: 64 } },
    players: { home: [], away: [] },
    memory: { homeRows: [], awayRows: [] },
    market: { pH: 0.58, pD: 0.23, pA: 0.19 }
  });
  assert.equal(insights.editorialAngle.headlineType, 'favorite_but_not_free');
});

test('compose works without h2h and absences', ()=>{
  const insights = buildPrematchInsights({
    match: { home: 'PSG', away: 'Monaco', homeId: 'psg', awayId: 'mon', competition: 'Ligue 1' },
    context: { stakes: 'neutral_context' },
    standings: {},
    form: { homeLast5: { played: 1, points: 3 }, awayLast5: { played: 1, points: 0 } },
    homeAway: { home: { played: 0 }, away: { played: 0 } },
    h2h: { matches: [] },
    readiness: { home: { readinessScore: 55 }, away: { readinessScore: 52 } },
    players: { home: [], away: [] },
    memory: { homeRows: [], awayRows: [] },
    market: null
  });
  const editorial = composePrematchEditorial(insights);
  assert.ok(editorial.text.length > 20);
  assert.equal(editorial.sections.some((s)=>s.key === 'h2h'), false);
});

test('translates readiness into editorial line', ()=>{
  const insights = buildPrematchInsights({
    match: { home: 'PSG', away: 'Monaco', homeId: 'psg', awayId: 'mon' },
    context: {},
    standings: {},
    form: { homeLast5: { points: 9, played: 5 }, awayLast5: { points: 9, played: 5 } },
    homeAway: { home: {}, away: {} },
    h2h: { matches: [] },
    readiness: { home: { readinessScore: 66 }, away: { readinessScore: 60 } },
    players: { home: [], away: [] },
    memory: { homeRows: [], awayRows: [] },
    market: null
  });
  const section = composePrematchEditorial(insights).sections.find((s)=>s.key === 'readiness');
  assert.ok(section.text.includes('ventaja estructural'));
});

test('translates MNE tags from memory reasons', ()=>{
  const insights = buildPrematchInsights({
    match: { home: 'PSG', away: 'Monaco', homeId: 'psg', awayId: 'mon', competition: 'Ligue 1' },
    context: {},
    standings: {},
    form: { homeLast5: { points: 9, played: 5 }, awayLast5: { points: 6, played: 5 } },
    homeAway: { home: {}, away: {} },
    h2h: { matches: [] },
    readiness: { home: { readinessScore: 60 }, away: { readinessScore: 60 } },
    players: { home: [], away: [] },
    memory: {
      homeRows: [{ summary: { reasons: [{ tagId: 'territorial_pressure', strength: 0.9 }] } }],
      awayRows: [{ summary: { reasons: [{ tagId: 'finishing_failure', strength: 0.8 }] } }]
    },
    market: null
  });
  const editorial = composePrematchEditorial(insights);
  const brainSection = editorial.sections.find((s)=>s.key === 'brain');
  assert.ok(brainSection.text.includes('empujar al rival'));
  assert.ok(brainSection.text.includes('inconsistencia en la definición'));
});

test('collectPrematchData incluye bloque CSI', ()=>{
  const db = buildDb();
  const brainV2 = {
    memories: {
      psg: [
        { id: 'bp1', teamId: 'psg', teamName: 'PSG', date: '2026-01-01', score: '2-0', opponent: 'Monaco', statsRaw: 'xg: 1.8\nshots: 13\npossession: 57' }
      ],
      mon: [
        { id: 'bm1', teamId: 'mon', teamName: 'Monaco', date: '2026-01-01', score: '0-2', opponent: 'PSG', statsRaw: 'xg: 0.8\nshots: 8\npossession: 43' }
      ]
    }
  };
  const data = collectPrematchData({ db, brainV2, homeId: 'psg', awayId: 'mon', leagueId: 'L1' });
  assert.equal(typeof data.csi?.home?.CSI, 'number');
  assert.equal(typeof data.csi?.away?.CSI, 'number');
});
