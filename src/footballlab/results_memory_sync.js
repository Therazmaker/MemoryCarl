import { collectMatchesForTeam, normalizeTeamIdentity, resolveTeamAliases } from './readiness_memory.js';
import { resolveTeamMatchesFromRefs } from './team_memory_index.js';

function normalizeDate(value = ''){
  const raw = String(value || '').trim();
  if(!raw) return '';
  const exact = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(exact) return `${exact[1]}-${exact[2]}-${exact[3]}`;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : raw;
}

function normalizeScore(value = ''){
  const hit = String(value || '').match(/(\d+)\s*[-:]\s*(\d+)/);
  if(!hit) return '';
  return `${Number(hit[1]) || 0}-${Number(hit[2]) || 0}`;
}

function buildMemoryMatchSignature(memoryMatch = {}, { teamName = '' } = {}){
  const date = normalizeDate(memoryMatch?.date || '');
  const team = normalizeTeamIdentity(memoryMatch?.teamName || teamName || '');
  const opponent = normalizeTeamIdentity(memoryMatch?.opponent || '');
  const score = normalizeScore(memoryMatch?.score || '');
  const league = normalizeTeamIdentity(memoryMatch?.leagueId || memoryMatch?.league || '');
  return `${date}|${team}|${opponent}|${score}|${league}`;
}

function buildTrackerMatchSignature(match = {}, { db = {}, teamName = '' } = {}){
  const teamById = new Map((db?.teams || []).map((row)=>[row.id, row.name]));
  const leagueById = new Map((db?.leagues || []).map((row)=>[row.id, row.name]));
  const homeName = teamById.get(match?.homeId) || match?.homeName || '';
  const awayName = teamById.get(match?.awayId) || match?.awayName || '';
  const focusNorm = normalizeTeamIdentity(teamName || '');
  const focusIsHome = focusNorm && normalizeTeamIdentity(homeName) === focusNorm;
  const focusIsAway = focusNorm && normalizeTeamIdentity(awayName) === focusNorm;
  const team = focusIsAway ? awayName : homeName;
  const opponent = focusIsAway ? homeName : awayName;
  const date = normalizeDate(match?.date || '');
  const league = normalizeTeamIdentity(leagueById.get(match?.leagueId) || match?.league || '');
  const score = `${Number(match?.homeGoals) || 0}-${Number(match?.awayGoals) || 0}`;
  return `${date}|${normalizeTeamIdentity(team || teamName || '')}|${normalizeTeamIdentity(opponent)}|${score}|${league}`;
}

export function collectMemoryMatchesForTeam({ brainV2 = {}, teamId = '', teamName = '' } = {}){
  const indexed = resolveTeamMatchesFromRefs(brainV2, { teamId, teamName, limit: 0 });
  if(indexed.length){
    return indexed.filter((row)=>row && typeof row === 'object');
  }
  const memories = brainV2?.memories || {};
  const directRows = Array.isArray(memories?.[teamId]) ? memories[teamId] : [];
  if(directRows.length) return directRows.filter((row)=>row && typeof row === 'object');
  const aliases = new Set(resolveTeamAliases(teamName));
  const fallback = collectMatchesForTeam({
    memories,
    teamId,
    teamName,
    leagueId: '',
    limit: 100000
  });
  if(fallback?.rows?.length) return fallback.rows;
  return Object.values(memories)
    .flatMap((rows)=>Array.isArray(rows) ? rows : [])
    .filter((row)=>aliases.has(normalizeTeamIdentity(row?.teamName || '')));
}

export function getResultsSyncSummary({ db = {}, brainV2 = {}, team = {} } = {}){
  const memoryMatches = collectMemoryMatchesForTeam({ brainV2, teamId: team?.id || '', teamName: team?.name || '' });
  const teamMatches = (db?.tracker || []).filter((m)=>m?.homeId===team?.id || m?.awayId===team?.id);
  const existingMemoryIds = new Set(teamMatches.map((m)=>String(m?.brainMemoryId || '').trim()).filter(Boolean));
  const existingSignatures = new Set(teamMatches.map((m)=>buildTrackerMatchSignature(m, { db, teamName: team?.name || '' })));
  let alreadySynced = 0;
  memoryMatches.forEach((row)=>{
    const memoryId = String(row?.id || '').trim();
    const signature = buildMemoryMatchSignature(row, { teamName: team?.name || '' });
    if((memoryId && existingMemoryIds.has(memoryId)) || existingSignatures.has(signature)){
      alreadySynced += 1;
    }
  });
  const total = memoryMatches.length;
  return {
    totalInMemory: total,
    alreadySynced,
    pendingToSync: Math.max(0, total - alreadySynced),
    memoryMatches
  };
}

function findOpponentTeamId(db = {}, opponentName = ''){
  const target = normalizeTeamIdentity(opponentName);
  if(!target) return '';
  const aliases = new Set(resolveTeamAliases(opponentName));
  const hit = (db?.teams || []).find((team)=>aliases.has(normalizeTeamIdentity(team?.name || '')) || normalizeTeamIdentity(team?.name || '')===target);
  return hit?.id || '';
}

function mapMemoryMatchToTracker(memoryMatch = {}, { teamId = '', db = {} } = {}){
  const score = normalizeScore(memoryMatch?.score || '0-0');
  const [homeGoals, awayGoals] = score ? score.split('-').map((n)=>Number(n) || 0) : [0, 0];
  const opponentId = findOpponentTeamId(db, memoryMatch?.opponent || '');
  return {
    leagueId: String(memoryMatch?.leagueId || '').trim(),
    date: normalizeDate(memoryMatch?.date || ''),
    homeId: teamId,
    awayId: opponentId,
    awayName: String(memoryMatch?.opponent || '').trim(),
    homeGoals,
    awayGoals,
    note: '',
    stats: [],
    statsRaw: memoryMatch?.statsRaw || null,
    featureSnapshots: {},
    featureSnapshotStatus: {},
    source: 'brainV2.memories',
    brainMemoryId: String(memoryMatch?.id || '').trim()
  };
}

export function syncMemoryMatchesIntoResultsModule({ db = {}, brainV2 = {}, team = {}, ensureTrackerMatchState, uid } = {}){
  const summary = getResultsSyncSummary({ db, brainV2, team });
  const existingTeamMatches = (db?.tracker || []).filter((m)=>m?.homeId===team?.id || m?.awayId===team?.id);
  const byMemoryId = new Set(existingTeamMatches.map((row)=>String(row?.brainMemoryId || '').trim()).filter(Boolean));
  const bySignature = new Set(existingTeamMatches.map((m)=>buildTrackerMatchSignature(m, { db, teamName: team?.name || '' })));

  let inserted = 0;
  (summary.memoryMatches || []).forEach((memoryMatch)=>{
    const memoryId = String(memoryMatch?.id || '').trim();
    const signature = buildMemoryMatchSignature(memoryMatch, { teamName: team?.name || '' });
    if((memoryId && byMemoryId.has(memoryId)) || bySignature.has(signature)) return;
    const row = mapMemoryMatchToTracker(memoryMatch, { teamId: team?.id || '', db });
    row.id = typeof uid === 'function' ? uid('tr') : `tr_${Date.now()}`;
    const normalized = typeof ensureTrackerMatchState === 'function' ? ensureTrackerMatchState(row) : row;
    db.tracker.push(normalized);
    if(memoryId) byMemoryId.add(memoryId);
    bySignature.add(signature);
    inserted += 1;
  });

  return {
    inserted,
    summary: getResultsSyncSummary({ db, brainV2, team })
  };
}

export { buildMemoryMatchSignature, buildTrackerMatchSignature };
