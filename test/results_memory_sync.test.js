import test from 'node:test';
import assert from 'node:assert/strict';
import { getResultsSyncSummary, syncMemoryMatchesIntoResultsModule } from '../src/footballlab/results_memory_sync.js';

function createDb(){
  return {
    teams: [
      { id: 't_psg', name: 'PSG' },
      { id: 't_monaco', name: 'AS Monaco' }
    ],
    leagues: [
      { id: 'ligue1', name: 'Ligue 1' }
    ],
    tracker: []
  };
}

function ensureTrackerMatchState(match = {}){ return match; }

test('getResultsSyncSummary detects matches in memory for team', ()=>{
  const db = createDb();
  const brainV2 = {
    memories: {
      t_psg: Array.from({ length: 6 }, (_, i)=>({
        id: `m_${i}`,
        teamId: 't_psg',
        teamName: 'Paris Saint-Germain',
        date: `2026-03-${String(i+1).padStart(2, '0')}`,
        opponent: 'AS Monaco',
        score: '2-1',
        leagueId: 'ligue1'
      }))
    }
  };
  const summary = getResultsSyncSummary({ db, brainV2, team: { id: 't_psg', name: 'PSG' } });
  assert.equal(summary.totalInMemory, 6);
  assert.equal(summary.pendingToSync, 6);
});

test('syncMemoryMatchesIntoResultsModule imports pending matches without duplicates', ()=>{
  const db = createDb();
  const brainV2 = {
    memories: {
      t_psg: [
        { id: 'm_1', teamId: 't_psg', teamName: 'PSG', date: '2026-03-01', opponent: 'AS Monaco', score: '2-1', leagueId: 'ligue1' },
        { id: 'm_2', teamId: 't_psg', teamName: 'PSG', date: '2026-03-02', opponent: 'AS Monaco', score: '1-1', leagueId: 'ligue1' }
      ]
    }
  };
  const uid = (()=>{ let i = 0; return ()=>`tr_${++i}`; })();

  const first = syncMemoryMatchesIntoResultsModule({ db, brainV2, team: { id: 't_psg', name: 'PSG' }, ensureTrackerMatchState, uid });
  assert.equal(first.inserted, 2);
  assert.equal(db.tracker.length, 2);

  const second = syncMemoryMatchesIntoResultsModule({ db, brainV2, team: { id: 't_psg', name: 'PSG' }, ensureTrackerMatchState, uid });
  assert.equal(second.inserted, 0);
  assert.equal(db.tracker.length, 2);
});

test('sync summary resolves PSG aliases and synced count', ()=>{
  const db = createDb();
  db.tracker.push({
    id: 'tr_1',
    date: '2026-03-01',
    leagueId: 'ligue1',
    homeId: 't_psg',
    awayId: 't_monaco',
    homeGoals: 2,
    awayGoals: 1,
    brainMemoryId: 'm_1'
  });
  const brainV2 = {
    memories: {
      legacy_bucket: [
        { id: 'm_1', teamId: 'legacy', teamName: 'Paris SG', date: '2026-03-01', opponent: 'Monaco', score: '2-1', leagueId: 'ligue1' },
        { id: 'm_2', teamId: 'legacy', teamName: 'Paris Saint-Germain', date: '2026-03-05', opponent: 'AS Monaco', score: '3-0', leagueId: 'ligue1' }
      ]
    }
  };
  const summary = getResultsSyncSummary({ db, brainV2, team: { id: 't_psg', name: 'PSG' } });
  assert.equal(summary.totalInMemory, 2);
  assert.equal(summary.alreadySynced, 1);
  assert.equal(summary.pendingToSync, 1);
});
