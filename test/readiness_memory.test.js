import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTeamAliases, collectMatchesForTeam } from '../src/footballlab/readiness_memory.js';

test('resolveTeamAliases maps PSG variants', ()=>{
  const aliases = resolveTeamAliases('PSG');
  assert.ok(aliases.includes('psg'));
  assert.ok(aliases.includes('paris sg'));
  assert.ok(aliases.includes('paris saint germain'));
});

test('collectMatchesForTeam finds direct team rows', ()=>{
  const memories = {
    t_psg: Array.from({ length: 6 }, (_, i)=>({ id: `m${i}`, teamId: 't_psg', teamName: 'PSG', date: `2026-01-0${(i%9)+1}`, score: '2-1', leagueId: 'ligue1' }))
  };
  const result = collectMatchesForTeam({ memories, teamId: 't_psg', teamName: 'Paris SG', leagueId: 'ligue1', limit: 5 });
  assert.equal(result.evidence.totalMatches, 6);
  assert.equal(result.evidence.usedMatches, 5);
  assert.equal(result.evidence.leagueFallback, false);
});

test('collectMatchesForTeam uses alias rows when teamId bucket is empty', ()=>{
  const memories = {
    other: Array.from({ length: 6 }, (_, i)=>({ id: `m${i}`, teamId: 'legacy_psg', teamName: 'Paris Saint-Germain', date: `2026-02-${String(i+1).padStart(2,'0')}`, score: '1-0', leagueId: 'ligue1' }))
  };
  const result = collectMatchesForTeam({ memories, teamId: 't_psg', teamName: 'PSG', leagueId: 'ligue1', limit: 5 });
  assert.equal(result.evidence.usedAliasFallback, true);
  assert.equal(result.evidence.totalMatches, 6);
  assert.equal(result.rows.length, 5);
});

test('collectMatchesForTeam falls back to all competitions when league filter empties sample', ()=>{
  const memories = {
    t_psg: Array.from({ length: 3 }, (_, i)=>({ id: `m${i}`, teamId: 't_psg', teamName: 'PSG', date: `2026-03-${String(i+1).padStart(2,'0')}`, score: '0-0', leagueId: 'ucl' }))
  };
  const result = collectMatchesForTeam({ memories, teamId: 't_psg', teamName: 'PSG', leagueId: 'ligue1', limit: 5 });
  assert.equal(result.evidence.leagueFallback, true);
  assert.equal(result.rows.length, 3);
});
