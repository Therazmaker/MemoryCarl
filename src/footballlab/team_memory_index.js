import { normalizeTeamIdentity, resolveTeamAliases } from './readiness_memory.js';

function parseSortableDate(value){
  const raw = String(value || '').trim();
  if(!raw) return Number.NaN;
  const exact = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(exact){
    return Date.UTC(Number(exact[1]), Number(exact[2]) - 1, Number(exact[3]));
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function buildTeamProfileKey({ teamId = '', teamName = '' } = {}){
  if(teamId) return `id:${teamId}`;
  const normalizedName = normalizeTeamIdentity(teamName);
  if(normalizedName) return `name:${normalizedName}`;
  return '';
}

function toMatchRef(memoryMatch = {}, { teamId = '', teamName = '' } = {}){
  return {
    memoryId: String(memoryMatch?.id || '').trim(),
    teamId: String(teamId || memoryMatch?.teamId || '').trim(),
    teamName: String(teamName || memoryMatch?.teamName || '').trim(),
    date: String(memoryMatch?.date || '').trim(),
    opponent: String(memoryMatch?.opponent || '').trim(),
    score: String(memoryMatch?.score || '').trim()
  };
}

function normalizeMatchRef(ref = {}){
  if(!ref || typeof ref !== 'object') return null;
  const memoryId = String(ref.memoryId || '').trim();
  if(!memoryId) return null;
  return {
    memoryId,
    teamId: String(ref.teamId || '').trim(),
    teamName: String(ref.teamName || '').trim(),
    date: String(ref.date || '').trim(),
    opponent: String(ref.opponent || '').trim(),
    score: String(ref.score || '').trim()
  };
}

function normalizeTeamProfileEntry(entry = {}){
  const raw = entry && typeof entry === 'object' ? entry : {};
  const refs = Array.isArray(raw.matchRefs) ? raw.matchRefs.map((row)=>normalizeMatchRef(row)).filter(Boolean) : [];
  const byMemoryId = new Map();
  refs.forEach((ref)=>{
    const prev = byMemoryId.get(ref.memoryId);
    if(!prev || parseSortableDate(ref.date) >= parseSortableDate(prev.date)){
      byMemoryId.set(ref.memoryId, ref);
    }
  });
  const matchRefs = [...byMemoryId.values()].sort((a,b)=>parseSortableDate(a.date) - parseSortableDate(b.date));
  return {
    teamId: String(raw.teamId || '').trim(),
    teamName: String(raw.teamName || '').trim(),
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map((value)=>String(value || '').trim()).filter(Boolean) : [],
    matchRefs,
    updatedAt: raw.updatedAt || null
  };
}

export function ensureTeamProfileEntry(brainV2 = {}, { teamId = '', teamName = '' } = {}){
  const key = buildTeamProfileKey({ teamId, teamName });
  if(!key) return null;
  brainV2.teamProfiles ||= {};
  const current = normalizeTeamProfileEntry(brainV2.teamProfiles[key]);
  const aliases = teamName ? resolveTeamAliases(teamName) : [];
  brainV2.teamProfiles[key] = {
    ...current,
    teamId: String(teamId || current.teamId || '').trim(),
    teamName: String(teamName || current.teamName || '').trim(),
    aliases: aliases.length ? aliases : current.aliases,
    updatedAt: new Date().toISOString()
  };
  return { key, entry: brainV2.teamProfiles[key] };
}

export function indexMemoryMatchIntoTeamProfiles(brainV2 = {}, memoryMatch = {}, options = {}){
  if(!memoryMatch || typeof memoryMatch !== 'object') return { indexedKeys: [] };
  const memoryId = String(memoryMatch.id || '').trim();
  if(!memoryId) return { indexedKeys: [] };

  const indexedKeys = [];
  const indexOne = ({ teamId = '', teamName = '' } = {})=>{
    const ensured = ensureTeamProfileEntry(brainV2, { teamId, teamName });
    if(!ensured) return;
    const ref = toMatchRef(memoryMatch, { teamId, teamName });
    const currentRefs = Array.isArray(ensured.entry.matchRefs) ? ensured.entry.matchRefs : [];
    const filtered = currentRefs.filter((row)=>row?.memoryId !== ref.memoryId);
    filtered.push(ref);
    filtered.sort((a,b)=>parseSortableDate(a.date) - parseSortableDate(b.date));
    ensured.entry.matchRefs = filtered;
    ensured.entry.updatedAt = new Date().toISOString();
    indexedKeys.push(ensured.key);
  };

  indexOne({ teamId: options.primaryTeamId || memoryMatch.teamId || '', teamName: options.primaryTeamName || memoryMatch.teamName || '' });

  if(options.includeOpponent){
    const opponentName = String(options.opponentTeamName || memoryMatch.opponent || '').trim();
    const opponentTeamId = String(options.opponentTeamId || '').trim();
    if(opponentTeamId || opponentName){
      indexOne({ teamId: opponentTeamId, teamName: opponentName });
    }
  }

  return { indexedKeys };
}

export function normalizeTeamProfilesState(brainV2 = {}, { rebuildIfMissing = true } = {}){
  const memories = brainV2?.memories && typeof brainV2.memories === 'object' ? brainV2.memories : {};
  const rawProfiles = brainV2?.teamProfiles && typeof brainV2.teamProfiles === 'object' ? brainV2.teamProfiles : {};
  const nextProfiles = {};
  Object.entries(rawProfiles).forEach(([key, profile])=>{
    nextProfiles[key] = normalizeTeamProfileEntry(profile);
  });
  brainV2.teamProfiles = nextProfiles;

  const hasRefs = Object.values(nextProfiles).some((profile)=>Array.isArray(profile.matchRefs) && profile.matchRefs.length > 0);
  const hasMemories = Object.values(memories).some((rows)=>Array.isArray(rows) && rows.length > 0);
  if(rebuildIfMissing && hasMemories && !hasRefs){
    rebuildTeamProfileIndex(brainV2, { replace: true });
  }
  return brainV2;
}

export function rebuildTeamProfileIndex(brainV2 = {}, { replace = true, includeOpponent = true } = {}){
  const memories = brainV2?.memories && typeof brainV2.memories === 'object' ? brainV2.memories : {};
  if(replace){
    brainV2.teamProfiles = {};
  }else{
    brainV2.teamProfiles ||= {};
  }

  Object.entries(memories).forEach(([bucketTeamId, rows])=>{
    if(!Array.isArray(rows)) return;
    rows.forEach((memoryMatch)=>{
      const primaryTeamId = String(memoryMatch?.teamId || bucketTeamId || '').trim();
      indexMemoryMatchIntoTeamProfiles(brainV2, memoryMatch, {
        includeOpponent,
        primaryTeamId,
        primaryTeamName: memoryMatch?.teamName || '',
        opponentTeamName: memoryMatch?.opponent || ''
      });
    });
  });
  return brainV2.teamProfiles;
}

export function getTeamMatchRefs(brainV2 = {}, { teamId = '', teamName = '', limit = 0 } = {}){
  normalizeTeamProfilesState(brainV2, { rebuildIfMissing: true });
  const directKey = buildTeamProfileKey({ teamId, teamName });
  const aliases = new Set(resolveTeamAliases(teamName));
  const rows = [];
  const addRows = (profile)=>{
    const refs = Array.isArray(profile?.matchRefs) ? profile.matchRefs : [];
    refs.forEach((ref)=>rows.push(ref));
  };

  if(directKey && brainV2.teamProfiles[directKey]){
    addRows(brainV2.teamProfiles[directKey]);
  }else{
    Object.values(brainV2.teamProfiles || {}).forEach((profile)=>{
      const profileNameNorm = normalizeTeamIdentity(profile?.teamName || '');
      const profileAliases = Array.isArray(profile?.aliases) ? profile.aliases : [];
      const hitAlias = profileAliases.some((alias)=>aliases.has(alias));
      if(hitAlias || (profileNameNorm && aliases.has(profileNameNorm))){
        addRows(profile);
      }
    });
  }

  const uniqueById = new Map();
  rows.forEach((row)=>{
    const normalized = normalizeMatchRef(row);
    if(!normalized) return;
    const prev = uniqueById.get(normalized.memoryId);
    if(!prev || parseSortableDate(normalized.date) >= parseSortableDate(prev.date)){
      uniqueById.set(normalized.memoryId, normalized);
    }
  });

  const ordered = [...uniqueById.values()].sort((a,b)=>parseSortableDate(a.date) - parseSortableDate(b.date));
  if(limit > 0) return ordered.slice(-Math.max(1, Number(limit) || 1));
  return ordered;
}

export function resolveTeamMatchesFromRefs(brainV2 = {}, { teamId = '', teamName = '', limit = 0 } = {}){
  const refs = getTeamMatchRefs(brainV2, { teamId, teamName, limit });
  const byId = new Map();
  Object.values(brainV2?.memories || {}).forEach((rows)=>{
    if(!Array.isArray(rows)) return;
    rows.forEach((row)=>{
      const memoryId = String(row?.id || '').trim();
      if(memoryId) byId.set(memoryId, row);
    });
  });
  return refs
    .map((ref)=>byId.get(ref.memoryId))
    .filter((row)=>row && typeof row === 'object');
}
