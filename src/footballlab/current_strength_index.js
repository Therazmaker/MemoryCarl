import { collectMatchesForTeam } from './readiness_memory.js';

const DEFAULT_CSI_WEIGHTS = {
  pressure: 0.30,
  control: 0.20,
  stability: 0.20,
  momentum: 0.20,
  cohesion: 0.10
};

function clamp(value, min = 0, max = 100){
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function toNumber(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseSortableDate(value){
  const raw = String(value || '').trim();
  if(!raw) return Number.NaN;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : Number.NaN;
}

function parseScore(score = ''){
  const hit = String(score || '').match(/(\d+)\s*[-:]\s*(\d+)/);
  if(!hit) return null;
  return { goalsFor: Number(hit[1]), goalsAgainst: Number(hit[2]) };
}

function parseNumericStats(raw = ''){
  if(raw && typeof raw === 'object'){
    if(Array.isArray(raw?.stats)){
      const out = {};
      raw.stats.forEach((row)=>{
        const key = String(row?.key || row?.label || row?.category || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const value = toNumber(row?.home ?? row?.value ?? row?.for);
        if(key && value !== null) out[key] = value;
      });
      return out;
    }
    const out = {};
    Object.entries(raw).forEach(([key, value])=>{
      const normalized = String(key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const num = toNumber(value);
      if(normalized && num !== null) out[normalized] = num;
    });
    return out;
  }
  const text = String(raw || '');
  const matcher = /([^\n:=]{2,40})\s*[:=]\s*(-?\d+(?:[.,]\d+)?)/g;
  const out = {};
  let hit;
  while((hit = matcher.exec(text))){
    const key = String(hit[1] || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const value = Number(String(hit[2] || '').replace(',', '.'));
    if(!key || !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out;
}

function pickStat(stats = {}, keys = []){
  for(const key of keys){
    const v = toNumber(stats[key]);
    if(v !== null) return v;
  }
  return null;
}

function avg(values = []){
  const nums = values.filter((v)=>Number.isFinite(v));
  if(!nums.length) return null;
  return nums.reduce((acc, value)=>acc + value, 0) / nums.length;
}

function relativeScore(ownRaw, oppRaw, spread = 1){
  if(!Number.isFinite(ownRaw) || !Number.isFinite(oppRaw)) return 50;
  const delta = (ownRaw - oppRaw) / Math.max(0.0001, spread);
  return clamp(50 + delta * 25, 0, 100);
}

function getNarrativeChaos(row = {}){
  const txt = String(row?.narrative || '').toLowerCase();
  const negative = /(caos|desorden|fragil|error|roja|colapso|nervio|desconexi)/.test(txt) ? 1 : 0;
  const reasons = Array.isArray(row?.summary?.reasons) ? row.summary.reasons : [];
  const mneNegative = reasons.some((reason)=>{
    const tag = String(reason?.tagId || reason?.tag || '').toLowerCase();
    return /(discipline|failure|collapse|chaos|fragility|error)/.test(tag);
  }) ? 1 : 0;
  return Math.max(negative, mneNegative);
}

function buildMatchFeature(row = {}){
  const stats = parseNumericStats(row?.statsRaw || '');
  const score = parseScore(row?.score || '');
  const goalsFor = score?.goalsFor ?? pickStat(stats, ['goals_for', 'goals', 'gf']);
  const goalsAgainst = score?.goalsAgainst ?? pickStat(stats, ['goals_against', 'ga']);
  return {
    date: row?.date || '',
    stats,
    goalsFor: Number.isFinite(goalsFor) ? goalsFor : null,
    goalsAgainst: Number.isFinite(goalsAgainst) ? goalsAgainst : null,
    resultPoints: Number.isFinite(goalsFor) && Number.isFinite(goalsAgainst)
      ? (goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0)
      : null,
    gd: Number.isFinite(goalsFor) && Number.isFinite(goalsAgainst) ? goalsFor - goalsAgainst : null,
    hasLineup: Array.isArray(row?.lineup) && row.lineup.length >= 8,
    lineup: Array.isArray(row?.lineup) ? row.lineup.map((v)=>String(v || '').trim()).filter(Boolean) : [],
    narrative: String(row?.narrative || ''),
    chaosFlag: getNarrativeChaos(row)
  };
}

export function collectRecentMatchesForTeam({ brainV2 = {}, teamId = '', teamName = '', leagueId = '', N = 5 } = {}){
  const collected = collectMatchesForTeam({
    memories: brainV2?.memories || {},
    teamId,
    teamName,
    leagueId,
    limit: N
  });
  const rows = Array.isArray(collected?.rows) ? collected.rows : [];
  return rows.slice().sort((a,b)=>parseSortableDate(a?.date) - parseSortableDate(b?.date));
}

export function computePressureScore(matches = []){
  const features = matches.map(buildMatchFeature);
  const xg = avg(features.map((m)=>pickStat(m.stats, ['xg', 'expected_goals'])));
  const shots = avg(features.map((m)=>pickStat(m.stats, ['shots', 'total_shots', 'remates_totales'])));
  const shotsOn = avg(features.map((m)=>pickStat(m.stats, ['shots_on_target', 'shots_ot', 'remates_a_puerta'])));
  const corners = avg(features.map((m)=>pickStat(m.stats, ['corners', 'corner_kicks'])));
  const danger = avg(features.map((m)=>pickStat(m.stats, ['dangerous_attacks', 'danger_attacks', 'ataques_peligrosos'])));
  const parts = [];
  if(xg !== null) parts.push((xg / 2.5) * 100);
  if(shots !== null) parts.push((shots / 20) * 100);
  if(shotsOn !== null) parts.push((shotsOn / 8) * 100);
  if(corners !== null) parts.push((corners / 10) * 100);
  if(danger !== null) parts.push((danger / 60) * 100);
  return {
    raw: parts.length ? avg(parts) : 50,
    coverage: parts.length,
    notes: parts.length ? [] : ['Pressure Score limitado: faltan stats de ataque en los últimos partidos']
  };
}

export function computeControlScore(matches = []){
  const features = matches.map(buildMatchFeature);
  const possession = avg(features.map((m)=>pickStat(m.stats, ['possession', 'posesion'])));
  const territory = avg(features.map((m)=>pickStat(m.stats, ['territory', 'field_tilt'])));
  const longSeq = avg(features.map((m)=>pickStat(m.stats, ['long_sequences', 'passes_sequence_long'])));
  const mneControl = avg(features.map((m)=>{
    const txt = m.narrative.toLowerCase();
    return /(control|domini|manej|gobern)/.test(txt) ? 65 : null;
  }));
  const parts = [];
  if(possession !== null) parts.push(possession);
  if(territory !== null) parts.push(territory);
  if(longSeq !== null) parts.push((longSeq / 12) * 100);
  if(mneControl !== null) parts.push(mneControl);
  return {
    raw: parts.length ? avg(parts) : 50,
    coverage: parts.length,
    notes: parts.length ? [] : ['Control Score limitado por falta de posesión/territorio/MNE']
  };
}

export function computeStabilityScore(matches = []){
  const features = matches.map(buildMatchFeature);
  const conceded = avg(features.map((m)=>m.goalsAgainst));
  const chaos = avg(features.map((m)=>m.chaosFlag));
  const base = [];
  if(conceded !== null) base.push(100 - (conceded / 2.5) * 100);
  if(chaos !== null) base.push(100 - chaos * 35);
  return {
    raw: base.length ? avg(base) : 50,
    coverage: base.length,
    notes: base.length ? [] : ['Stability Score limitado: sin goles encajados ni señales narrativas']
  };
}

export function computeMomentumScore(matches = []){
  const features = matches.map(buildMatchFeature);
  const points = features.map((m)=>m.resultPoints).filter((v)=>v !== null);
  const gd = features.map((m)=>m.gd).filter((v)=>v !== null);
  const recentForm = points.length ? (points.reduce((a,b)=>a+b, 0) / (points.length * 3)) * 100 : null;
  const gdScore = gd.length ? clamp(((avg(gd) + 2) / 4) * 100, 0, 100) : null;
  const comebackSignal = features.some((m)=>/remont|levant[oó]|reacci[oó]n/.test(m.narrative.toLowerCase())) ? 8 : 0;
  const parts = [];
  if(recentForm !== null) parts.push(recentForm);
  if(gdScore !== null) parts.push(gdScore);
  const raw = parts.length ? clamp(avg(parts) + comebackSignal, 0, 100) : 50;
  return {
    raw,
    coverage: parts.length,
    notes: parts.length ? [] : ['Momentum Score limitado: se usa fallback conservador (resultados/goles)']
  };
}

export function computeCohesionScore(matches = []){
  const features = matches.map(buildMatchFeature);
  const withLineup = features.filter((m)=>m.hasLineup);
  if(withLineup.length < 2){
    return {
      raw: 50,
      coverage: withLineup.length,
      notes: ['Cohesion Score con fallback simple: no hay XI suficiente para medir estabilidad']
    };
  }
  const overlaps = [];
  for(let i = 1; i < withLineup.length; i += 1){
    const prev = new Set(withLineup[i - 1].lineup);
    const cur = withLineup[i].lineup;
    if(!cur.length || !prev.size) continue;
    const common = cur.filter((name)=>prev.has(name)).length;
    overlaps.push((common / Math.max(cur.length, prev.size)) * 100);
  }
  return {
    raw: overlaps.length ? avg(overlaps) : 50,
    coverage: overlaps.length,
    notes: overlaps.length ? [] : ['Cohesion Score con fallback simple por falta de continuidad de XI']
  };
}

function rankKeys(subscores = {}){
  const rows = Object.entries(subscores || {}).map(([key, value])=>({ key, value: Number(value) || 0 }));
  const sorted = rows.slice().sort((a,b)=>b.value - a.value);
  return {
    strongest: sorted.slice(0, 2).map((row)=>row.key),
    weakest: sorted.slice(-1).map((row)=>row.key)
  };
}

export function buildCSIExplanation({ teamName = 'Equipo', subscores = {}, opponentName = 'Rival', limitations = [] } = {}){
  const ranking = rankKeys(subscores);
  const strongestText = ranking.strongest.length ? ranking.strongest.join(' y ') : 'sin ventajas claras';
  const weakestText = ranking.weakest.length ? ranking.weakest[0] : 'sin debilidades marcadas';
  const summary = `${teamName} llega con mejor ${strongestText} frente a ${opponentName}, aunque su punto más débil es ${weakestText}.`;
  return {
    strongest: ranking.strongest,
    weakest: ranking.weakest,
    summary,
    limitations
  };
}

export function computeCSI({ teamName = '', opponentName = '', matches = [], opponentMatches = [], weights = DEFAULT_CSI_WEIGHTS } = {}){
  const pressureA = computePressureScore(matches);
  const pressureB = computePressureScore(opponentMatches);
  const controlA = computeControlScore(matches);
  const controlB = computeControlScore(opponentMatches);
  const stabilityA = computeStabilityScore(matches);
  const stabilityB = computeStabilityScore(opponentMatches);
  const momentumA = computeMomentumScore(matches);
  const momentumB = computeMomentumScore(opponentMatches);
  const cohesionA = computeCohesionScore(matches);
  const cohesionB = computeCohesionScore(opponentMatches);

  const subscores = {
    pressure: Math.round(relativeScore(pressureA.raw, pressureB.raw, 20)),
    control: Math.round(relativeScore(controlA.raw, controlB.raw, 20)),
    stability: Math.round(relativeScore(stabilityA.raw, stabilityB.raw, 20)),
    momentum: Math.round(relativeScore(momentumA.raw, momentumB.raw, 20)),
    cohesion: Math.round(relativeScore(cohesionA.raw, cohesionB.raw, 20))
  };

  const csi = Math.round(
    (subscores.pressure * (weights.pressure || 0.30))
    + (subscores.control * (weights.control || 0.20))
    + (subscores.stability * (weights.stability || 0.20))
    + (subscores.momentum * (weights.momentum || 0.20))
    + (subscores.cohesion * (weights.cohesion || 0.10))
  );

  const limitations = [
    ...pressureA.notes,
    ...controlA.notes,
    ...stabilityA.notes,
    ...momentumA.notes,
    ...cohesionA.notes
  ];

  return {
    team: teamName,
    CSI: csi,
    subscores,
    explanation: buildCSIExplanation({ teamName, opponentName, subscores, limitations }),
    dataQuality: {
      matches: matches.length,
      opponentMatches: opponentMatches.length,
      limitations
    }
  };
}

export function buildMatchCSI({ brainV2 = {}, home = {}, away = {}, leagueId = '', N = 5 } = {}){
  const homeMatches = collectRecentMatchesForTeam({
    brainV2,
    teamId: home.id,
    teamName: home.name,
    leagueId,
    N
  });
  const awayMatches = collectRecentMatchesForTeam({
    brainV2,
    teamId: away.id,
    teamName: away.name,
    leagueId,
    N
  });

  const homeCSI = computeCSI({
    teamName: home.name || 'Local',
    opponentName: away.name || 'Visitante',
    matches: homeMatches,
    opponentMatches: awayMatches
  });
  const awayCSI = computeCSI({
    teamName: away.name || 'Visitante',
    opponentName: home.name || 'Local',
    matches: awayMatches,
    opponentMatches: homeMatches
  });

  const edge = homeCSI.CSI - awayCSI.CSI;
  const leader = edge === 0 ? 'even' : edge > 0 ? 'home' : 'away';
  return {
    N,
    home: homeCSI,
    away: awayCSI,
    edge,
    leader,
    summary: leader === 'even'
      ? 'Llegan con fuerza reciente muy similar.'
      : `${leader === 'home' ? homeCSI.team : awayCSI.team} llega más fuerte ahora.`
  };
}
