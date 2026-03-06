import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTeamProfilesState,
  indexMemoryMatchIntoTeamProfiles,
  getTeamMatchRefs,
  resolveTeamMatchesFromRefs,
  rebuildTeamProfileIndex
} from '../src/footballlab/team_memory_index.js';

test('indexMemoryMatchIntoTeamProfiles stores refs without duplicating full match payload', ()=>{
  const brainV2 = { memories: {}, teamProfiles: {} };
  const memoryMatch = {
    id: 'mem_001',
    teamId: 't_psg',
    teamName: 'PSG',
    date: '2026-03-06',
    opponent: 'Monaco',
    score: '2-1',
    statsRaw: 'xg: 1.9',
    narrative: 'dominó el partido'
  };
  indexMemoryMatchIntoTeamProfiles(brainV2, memoryMatch, { includeOpponent: true });
  const psgRefs = getTeamMatchRefs(brainV2, { teamId: 't_psg', teamName: 'Paris SG' });
  assert.equal(psgRefs.length, 1);
  assert.equal(psgRefs[0].memoryId, 'mem_001');
  assert.equal(Object.prototype.hasOwnProperty.call(psgRefs[0], 'statsRaw'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(psgRefs[0], 'narrative'), false);
  const monacoRefs = getTeamMatchRefs(brainV2, { teamName: 'AS Monaco' });
  assert.equal(monacoRefs.length, 1);
  assert.equal(monacoRefs[0].memoryId, 'mem_001');
});

test('getTeamMatchRefs resolves PSG aliases under same bucket', ()=>{
  const brainV2 = { memories: {}, teamProfiles: {} };
  indexMemoryMatchIntoTeamProfiles(brainV2, {
    id: 'mem_002',
    teamId: 't_psg',
    teamName: 'Paris Saint-Germain',
    date: '2026-03-07',
    opponent: 'Monaco',
    score: '1-0'
  });
  const refsA = getTeamMatchRefs(brainV2, { teamId: 't_psg', teamName: 'PSG' });
  const refsB = getTeamMatchRefs(brainV2, { teamName: 'Paris SG' });
  assert.equal(refsA.length, 1);
  assert.equal(refsB.length, 1);
  assert.equal(refsA[0].memoryId, refsB[0].memoryId);
});

test('normalizeTeamProfilesState rebuilds index from existing memories when refs are missing', ()=>{
  const row = { id: 'mem_003', teamId: 't_psg', teamName: 'PSG', opponent: 'Monaco', score: '0-0', date: '2026-03-08' };
  const brainV2 = {
    memories: { t_psg: [row] },
    teamProfiles: {}
  };
  normalizeTeamProfilesState(brainV2, { rebuildIfMissing: true });
  const refs = getTeamMatchRefs(brainV2, { teamId: 't_psg', teamName: 'PSG' });
  assert.equal(refs.length, 1);
  const resolved = resolveTeamMatchesFromRefs(brainV2, { teamId: 't_psg', teamName: 'PSG' });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0], row);
});

test('rebuildTeamProfileIndex keeps refs aligned after memory deletion', ()=>{
  const brainV2 = {
    memories: {
      t_psg: [
        { id: 'mem_10', teamId: 't_psg', teamName: 'PSG', opponent: 'Monaco', score: '1-1', date: '2026-03-01' },
        { id: 'mem_11', teamId: 't_psg', teamName: 'PSG', opponent: 'Lyon', score: '2-1', date: '2026-03-02' }
      ]
    },
    teamProfiles: {}
  };
  rebuildTeamProfileIndex(brainV2, { replace: true, includeOpponent: true });
  brainV2.memories.t_psg = brainV2.memories.t_psg.filter((row)=>row.id !== 'mem_10');
  rebuildTeamProfileIndex(brainV2, { replace: true, includeOpponent: true });
  const refs = getTeamMatchRefs(brainV2, { teamId: 't_psg', teamName: 'PSG' });
  assert.equal(refs.length, 1);
  assert.equal(refs[0].memoryId, 'mem_11');
});
