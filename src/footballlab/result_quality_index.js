import { collectMatchesForTeam } from './readiness_memory.js';

const DEFAULT_RQI_WEIGHTS = {
  resultStrength: 0.25,
  dominance: 0.25,
  fragility: 0.20,
  efficiencyAlert: 0.15,
  controlConviction: 0.15
};

function clamp(value, min = 0, max = 100){
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function toNumber(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function avg(values = []){
  const nums = values.filter((v)=>Number.isFinite(v));
  if(!nums.length) return null;
  return nums.reduce((acc, value)=>acc + value, 0) / nums.length;
}

function parseSortableDate(value){
  const ts = Date.parse(String(value || '').trim());
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
function mneReasons(row = {}){
  return Array.isArray(row?.summary?.reasons) ? row.summary.reasons : [];
}

function buildMatchFeature(row = {}){
  const stats = parseNumericStats(row?.statsRaw || '');
  const score = parseScore(row?.score || '');
  const goalsFor = score?.goalsFor ?? pickStat(stats, ['goals_for', 'goals', 'gf']);
  const goalsAgainst = score?.goalsAgainst ?? pickStat(stats, ['goals_against', 'ga']);
  const narrative = String(row?.narrative || '').toLowerCase();
  const reasons = mneReasons(row);

  const ownXg = pickStat(stats, ['xg', 'expected_goals', 'xg_for']);
  const oppXg = pickStat(stats, ['xga', 'xg_against', 'expected_goals_against', 'xg_conceded']);
  const ownShots = pickStat(stats, ['shots', 'total_shots', 'shots_for', 'remates_totales']);
  const oppShots = pickStat(stats, ['shots_against', 'shots_conceded', 'opponent_shots', 'remates_recibidos']);
  const ownShotsOn = pickStat(stats, ['shots_on_target', 'shots_ot', 'shots_on_target_for', 'remates_a_puerta']);
  const oppShotsOn = pickStat(stats, ['shots_on_target_against', 'shots_on_target_conceded', 'opponent_shots_on_target', 'remates_a_puerta_recibidos']);
  const possession = pickStat(stats, ['possession', 'posesion']);
  const corners = pickStat(stats, ['corners', 'corner_kicks']);
  const territory = pickStat(stats, ['territory', 'field_tilt']);

  const hasChaosNarrative = /(caos|desorden|fragil|sufri|nervio|roto|partido\s+abierto|sobreviv)/.test(narrative);
  const hasControlNarrative = /(control|domini|manej|gobern|autoridad|convinc)/.test(narrative);
  const hasStressReason = reasons.some((reason)=>/(failure|collapse|chaos|fragility|error|discipline)/.test(String(reason?.tagId || reason?.tag || '').toLowerCase()));
  const hasControlReason = reasons.some((reason)=>/(territorial_pressure|momentum_control|late_pressure)/.test(String(reason?.tagId || reason?.tag || '').toLowerCase()));

  const gd = Number.isFinite(goalsFor) && Number.isFinite(goalsAgainst) ? goalsFor - goalsAgainst : null;
  const points = Number.isFinite(goalsFor) && Number.isFinite(goalsAgainst)
    ? (goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0)
    : null;

  return {
    stats,
    date: row?.date || '',
    goalsFor: Number.isFinite(goalsFor) ? goalsFor : null,
    goalsAgainst: Number.isFinite(goalsAgainst) ? goalsAgainst : null,
    gd,
    points,
    ownXg,
    oppXg,
    ownShots,
    oppShots,
    ownShotsOn,
    oppShotsOn,
    possession,
    corners,
    territory,
    narrowGame: Number.isFinite(gd) ? Math.abs(gd) <= 1 : null,
    narrowWin: Number.isFinite(gd) && gd === 1,
    hasChaos: hasChaosNarrative || hasStressReason,
    hasControl: hasControlNarrative || hasControlReason
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

export function computeResultStrengthScore(matches = []){
  const rows = matches.map(buildMatchFeature);
  const ppg = avg(rows.map((m)=>m.points));
  const gdAvg = avg(rows.map((m)=>m.gd));
  const ppgScore = ppg === null ? null : (ppg / 3) * 100;
  const gdScore = gdAvg === null ? null : clamp(((gdAvg + 2) / 4) * 100, 0, 100);
  const parts = [ppgScore, gdScore].filter((v)=>v !== null);
  return {
    raw: Math.round(parts.length ? (ppgScore || 50) * 0.65 + (gdScore || 50) * 0.35 : 50),
    coverage: parts.length,
    notes: parts.length ? [] : ['Result Strength con fallback: faltan score/goles recientes']
  };
}

export function computeDominanceScore(matches = []){
  const rows = matches.map(buildMatchFeature);
  const xgDelta = avg(rows.map((m)=>Number.isFinite(m.ownXg) && Number.isFinite(m.oppXg) ? m.ownXg - m.oppXg : null));
  const shotsDelta = avg(rows.map((m)=>Number.isFinite(m.ownShots) && Number.isFinite(m.oppShots) ? m.ownShots - m.oppShots : null));
  const shotsOnDelta = avg(rows.map((m)=>Number.isFinite(m.ownShotsOn) && Number.isFinite(m.oppShotsOn) ? m.ownShotsOn - m.oppShotsOn : null));
  const possession = avg(rows.map((m)=>m.possession));
  const corners = avg(rows.map((m)=>m.corners));
  const controlNarrative = avg(rows.map((m)=>m.hasControl ? 68 : 42));

  const parts = [];
  if(xgDelta !== null) parts.push(clamp(50 + xgDelta * 18, 0, 100));
  if(shotsDelta !== null) parts.push(clamp(50 + shotsDelta * 3, 0, 100));
  if(shotsOnDelta !== null) parts.push(clamp(50 + shotsOnDelta * 8, 0, 100));
  if(possession !== null) parts.push(clamp(possession, 0, 100));
  if(corners !== null) parts.push(clamp((corners / 9) * 100, 0, 100));
  parts.push(controlNarrative || 50);

  return {
    raw: Math.round(clamp(avg(parts) ?? 50, 0, 100)),
    coverage: parts.length,
    notes: (xgDelta === null && shotsDelta === null && shotsOnDelta === null)
      ? ['Dominance con fallback: sin diferenciales rival, se prioriza control narrativo/posesión']
      : []
  };
}

export function computeFragilityScore(matches = []){
  const rows = matches.map(buildMatchFeature);
  const conceded = avg(rows.map((m)=>m.goalsAgainst));
  const oppXg = avg(rows.map((m)=>m.oppXg));
  const oppShots = avg(rows.map((m)=>m.oppShots));
  const chaosRate = avg(rows.map((m)=>m.hasChaos ? 1 : 0));
  const narrowRate = avg(rows.map((m)=>m.narrowGame ? 1 : 0));

  const stress = [];
  if(conceded !== null) stress.push(clamp((conceded / 2.5) * 100, 0, 100));
  if(oppXg !== null) stress.push(clamp((oppXg / 2.0) * 100, 0, 100));
  if(oppShots !== null) stress.push(clamp((oppShots / 16) * 100, 0, 100));
  if(chaosRate !== null) stress.push(chaosRate * 100);
  if(narrowRate !== null) stress.push(narrowRate * 70);

  const stressScore = stress.length ? avg(stress) : 50;
  return {
    raw: Math.round(clamp(100 - stressScore, 0, 100)),
    coverage: stress.length,
    notes: stress.length ? [] : ['Fragility con fallback: sin señales de sufrimiento medibles']
  };
}

export function computeEfficiencyAlertScore(matches = []){
  const rows = matches.map(buildMatchFeature);
  const goalsFor = avg(rows.map((m)=>m.goalsFor));
  const xgFor = avg(rows.map((m)=>m.ownXg));
  const shots = avg(rows.map((m)=>m.ownShots));
  const narrowWinsRate = avg(rows.map((m)=>m.narrowWin ? 1 : 0));
  const points = avg(rows.map((m)=>m.points));

  let alert = 0;
  let coverage = 0;

  if(goalsFor !== null && xgFor !== null){
    const over = goalsFor - xgFor;
    alert += clamp(over * 30, 0, 30);
    coverage += 1;
  }

  if(points !== null && shots !== null){
    const lowVolume = shots < 9 ? (9 - shots) * 4 : 0;
    const highPoints = points > 1.8 ? (points - 1.8) * 10 : 0;
    alert += clamp(lowVolume + highPoints, 0, 30);
    coverage += 1;
  }

  if(narrowWinsRate !== null){
    alert += narrowWinsRate * 35;
    coverage += 1;
  }

  const quality = clamp(100 - alert, 0, 100);
  return {
    raw: Math.round(coverage ? quality : 55),
    coverage,
    notes: coverage ? [] : ['Efficiency Alert con fallback conservador: faltan xG/volumen de tiro']
  };
}

export function computeControlConvictionScore(matches = []){
  const rows = matches.map(buildMatchFeature);
  const possession = avg(rows.map((m)=>m.possession));
  const territory = avg(rows.map((m)=>m.territory));
  const xg = avg(rows.map((m)=>m.ownXg));
  const shotsOn = avg(rows.map((m)=>m.ownShotsOn));
  const controlRate = avg(rows.map((m)=>m.hasControl ? 1 : 0));
  const chaosRate = avg(rows.map((m)=>m.hasChaos ? 1 : 0));

  const parts = [];
  if(possession !== null) parts.push(possession);
  if(territory !== null) parts.push(territory);
  if(xg !== null) parts.push(clamp((xg / 2.2) * 100, 0, 100));
  if(shotsOn !== null) parts.push(clamp((shotsOn / 7) * 100, 0, 100));
  if(controlRate !== null) parts.push(controlRate * 100);
  if(chaosRate !== null) parts.push(100 - chaosRate * 100);

  return {
    raw: Math.round(clamp(avg(parts) ?? 50, 0, 100)),
    coverage: parts.length,
    notes: parts.length ? [] : ['Control/Conviction con fallback: faltan señales de control territorial']
  };
}

export function classifyRQI(rqi = 50){
  if(rqi < 35) return { code: 'very_fragile', label: 'muy frágil' };
  if(rqi < 47) return { code: 'fragile', label: 'frágil' };
  if(rqi < 60) return { code: 'neutral', label: 'neutro' };
  if(rqi < 75) return { code: 'solid', label: 'sólido' };
  return { code: 'very_solid', label: 'muy sólido' };
}

export function buildRQIInterpretation({ team = 'Equipo', opponent = 'Rival', subscores = {}, classif = { code: 'neutral', label: 'neutro' }, limitations = [] } = {}){
  const flags = [];

  if((subscores.resultStrength || 0) >= 62 && (subscores.dominance || 0) < 50){
    flags.push('suma puntos por encima de su dominio real');
  }
  if((subscores.resultStrength || 0) >= 60 && (subscores.fragility || 0) < 45){
    flags.push('victorias de margen corto o contexto de alto sufrimiento');
  }
  if((subscores.efficiencyAlert || 0) < 45){
    flags.push('eficiencia por encima del volumen generado (alerta de sostenibilidad)');
  }
  if((subscores.dominance || 0) >= 65 && (subscores.controlConviction || 0) >= 62){
    flags.push('racha respaldada por dominio y control del guion');
  }
  if((subscores.dominance || 0) >= 60 && (subscores.fragility || 0) < 48){
    flags.push('equipo peligroso pero inestable: genera y también sufre');
  }

  const summary = classif.code === 'very_solid'
    ? `${team} llega en racha realmente convincente: domina tramos y sufre poco frente a ${opponent}.`
    : classif.code === 'solid'
      ? `${team} trae una racha competitiva y bastante sólida, aunque con detalles mejorables ante ${opponent}.`
      : classif.code === 'neutral'
        ? `${team} suma de forma aceptable, pero su racha reciente no muestra dominio continuo frente a ${opponent}.`
        : classif.code === 'fragile'
          ? `${team} está sumando con señales claras de fragilidad; la racha puede ser engañosa frente a ${opponent}.`
          : `${team} llega con una dinámica muy frágil: resultados y juego reciente no sostienen autoridad ante ${opponent}.`;

  return {
    summary,
    flags,
    limitations
  };
}

export function computeRQI({ teamName = '', opponentName = '', matches = [], weights = DEFAULT_RQI_WEIGHTS } = {}){
  const resultStrength = computeResultStrengthScore(matches);
  const dominance = computeDominanceScore(matches);
  const fragility = computeFragilityScore(matches);
  const efficiencyAlert = computeEfficiencyAlertScore(matches);
  const controlConviction = computeControlConvictionScore(matches);

  const subscores = {
    resultStrength: resultStrength.raw,
    dominance: dominance.raw,
    fragility: fragility.raw,
    efficiencyAlert: efficiencyAlert.raw,
    controlConviction: controlConviction.raw
  };

  const rqi = Math.round(
    subscores.resultStrength * (weights.resultStrength || 0.25)
    + subscores.dominance * (weights.dominance || 0.25)
    + subscores.fragility * (weights.fragility || 0.20)
    + subscores.efficiencyAlert * (weights.efficiencyAlert || 0.15)
    + subscores.controlConviction * (weights.controlConviction || 0.15)
  );

  const limitations = [
    ...resultStrength.notes,
    ...dominance.notes,
    ...fragility.notes,
    ...efficiencyAlert.notes,
    ...controlConviction.notes
  ];
  const classif = classifyRQI(rqi);

  return {
    team: teamName,
    RQI: rqi,
    status: classif.code,
    statusLabel: classif.label,
    subscores,
    interpretation: buildRQIInterpretation({
      team: teamName,
      opponent: opponentName,
      subscores,
      classif,
      limitations
    }),
    dataQuality: {
      matches: matches.length,
      limitations
    }
  };
}

export function buildMatchRQI({ brainV2 = {}, home = {}, away = {}, leagueId = '', N = 5 } = {}){
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

  const homeRQI = computeRQI({
    teamName: home.name || 'Local',
    opponentName: away.name || 'Visitante',
    matches: homeMatches
  });
  const awayRQI = computeRQI({
    teamName: away.name || 'Visitante',
    opponentName: home.name || 'Local',
    matches: awayMatches
  });

  const edge = homeRQI.RQI - awayRQI.RQI;
  const leader = edge === 0 ? 'even' : edge > 0 ? 'home' : 'away';

  return {
    N,
    home: homeRQI,
    away: awayRQI,
    edge,
    leader,
    summary: leader === 'even'
      ? 'Ambos llegan con calidad de racha similar.'
      : `${leader === 'home' ? homeRQI.team : awayRQI.team} trae una racha reciente más convincente.`
  };
}
