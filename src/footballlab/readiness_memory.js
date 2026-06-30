const TEAM_ALIAS_MAP = {
  psg: 'paris saint germain',
  'paris sg': 'paris saint germain',
  'paris saint germain': 'paris saint germain',
  'paris saint-germain': 'paris saint germain',
  'paris st germain': 'paris saint germain',
  monaco: 'as monaco',
  'as monaco': 'as monaco'
};

export function normalizeTeamIdentity(value = ''){
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function resolveTeamAliases(name = ''){
  const normalized = normalizeTeamIdentity(name);
  if(!normalized) return [];
  const canonical = TEAM_ALIAS_MAP[normalized] || normalized;
  const set = new Set([normalized, canonical]);
  Object.entries(TEAM_ALIAS_MAP).forEach(([alias, target])=>{
    if(target === canonical) set.add(alias);
  });
  return [...set];
}

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

export function collectMatchesForTeam({
  memories = {},
  teamId = '',
  teamName = '',
  leagueId = '',
  limit = 5
} = {}){
  const directRows = Array.isArray(memories?.[teamId]) ? memories[teamId] : [];
  const aliases = new Set(resolveTeamAliases(teamName));
  const allRows = Object.values(memories || {}).flatMap((rows)=>Array.isArray(rows) ? rows : []);
  const aliasRows = allRows.filter((row)=>aliases.has(normalizeTeamIdentity(row?.teamName || '')));
  const baseRows = directRows.length ? directRows : aliasRows;
  const validRows = baseRows.filter((row)=>row && typeof row === 'object');
  const byLeague = leagueId ? validRows.filter((row)=>String(row?.leagueId || '') === String(leagueId)) : validRows;
  const usingLeagueFilter = Boolean(leagueId);
  const leagueFallback = usingLeagueFilter && !byLeague.length && validRows.length > 0;
  const selectedRows = (leagueFallback ? validRows : byLeague)
    .slice()
    .sort((a,b)=>parseSortableDate(a?.date) - parseSortableDate(b?.date));
  const usedRows = selectedRows.slice(-Math.max(1, Number(limit) || 5));

  return {
    rows: usedRows,
    evidence: {
      source: 'brainV2.memories',
      usedAliasFallback: !directRows.length && aliasRows.length > 0,
      aliases: [...aliases],
      totalMatches: validRows.length,
      leagueMatches: byLeague.length,
      selectedMatches: selectedRows.length,
      usedMatches: usedRows.length,
      usingLeagueFilter,
      leagueFallback,
      filterLabel: usingLeagueFilter ? (leagueFallback ? 'all competitions (fallback)' : 'league only') : 'all competitions'
    }
  };
}
