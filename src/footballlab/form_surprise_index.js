import { collectRecentMatchesForTeam } from './current_strength_index.js';

function clamp(value, min = -100, max = 100){
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function toNumber(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseScore(score = ''){
  const hit = String(score || '').match(/(\d+)\s*[-:]\s*(\d+)/);
  if(!hit) return null;
  return { gf: Number(hit[1]), gc: Number(hit[2]) };
}

export function normalizeTeamSeasonBase(raw = null){
  if(!raw || typeof raw !== 'object') return null;
  const base = {
    pj: toNumber(raw?.pj ?? raw?.played),
    g: toNumber(raw?.g ?? raw?.w),
    e: toNumber(raw?.e ?? raw?.d),
    p: toNumber(raw?.p ?? raw?.l),
    gf: toNumber(raw?.gf),
    gc: toNumber(raw?.gc),
    dg: toNumber(raw?.dg),
    pts: toNumber(raw?.pts ?? raw?.points),
    position: toNumber(raw?.position ?? raw?.pos)
  };
  const hasCore = Number.isFinite(base.pj) && base.pj > 0 && Number.isFinite(base.gf) && Number.isFinite(base.gc) && Number.isFinite(base.pts);
  if(!hasCore) return null;
  if(!Number.isFinite(base.dg)) base.dg = base.gf - base.gc;
  if(!Number.isFinite(base.g) && Number.isFinite(base.e) && Number.isFinite(base.pj) && Number.isFinite(base.p)){
    base.g = Math.max(0, base.pj - base.e - base.p);
  }
  if(!Number.isFinite(base.e) && Number.isFinite(base.g) && Number.isFinite(base.pj) && Number.isFinite(base.p)){
    base.e = Math.max(0, base.pj - base.g - base.p);
  }
  if(!Number.isFinite(base.p) && Number.isFinite(base.g) && Number.isFinite(base.e) && Number.isFinite(base.pj)){
    base.p = Math.max(0, base.pj - base.g - base.e);
  }
  return base;
}

export function computeSeasonBaseMetrics(rawBase = null){
  const base = normalizeTeamSeasonBase(rawBase);
  if(!base) return null;
  const pj = Math.max(1, Number(base.pj) || 1);
  return {
    raw: base,
    played: pj,
    ppg: Number((base.pts / pj).toFixed(2)),
    gfpg: Number((base.gf / pj).toFixed(2)),
    gcpg: Number((base.gc / pj).toFixed(2)),
    dgpg: Number((base.dg / pj).toFixed(2))
  };
}

export function computeRecentFormMetrics(matches = [], { minMatches = 3 } = {}){
  const rows = Array.isArray(matches) ? matches : [];
  const parsed = rows
    .map((row)=>{
      const score = parseScore(row?.score || '');
      if(!score) return null;
      const pts = score.gf > score.gc ? 3 : score.gf === score.gc ? 1 : 0;
      return { gf: score.gf, gc: score.gc, dg: score.gf - score.gc, pts };
    })
    .filter(Boolean);
  if(parsed.length < minMatches) return null;
  const totals = parsed.reduce((acc, row)=>({
    gf: acc.gf + row.gf,
    gc: acc.gc + row.gc,
    dg: acc.dg + row.dg,
    pts: acc.pts + row.pts
  }), { gf: 0, gc: 0, dg: 0, pts: 0 });
  const played = parsed.length;
  return {
    played,
    points: totals.pts,
    gf: totals.gf,
    gc: totals.gc,
    dg: totals.dg,
    ppg: Number((totals.pts / played).toFixed(2)),
    gfpg: Number((totals.gf / played).toFixed(2)),
    gcpg: Number((totals.gc / played).toFixed(2)),
    dgpg: Number((totals.dg / played).toFixed(2))
  };
}

export function computeFormSurpriseIndex({ seasonBase = null, recentForm = null } = {}){
  if(!seasonBase || !recentForm) return null;
  const ppgDelta = recentForm.ppg - seasonBase.ppg;
  const gfDelta = recentForm.gfpg - seasonBase.gfpg;
  const gcDelta = seasonBase.gcpg - recentForm.gcpg;
  const dgDelta = recentForm.dgpg - seasonBase.dgpg;
  const weighted = (ppgDelta * 45) + (gfDelta * 20) + (gcDelta * 20) + (dgDelta * 15);
  return clamp(Number(weighted.toFixed(1)), -100, 100);
}

export function classifyFormSurprise(fsi = 0){
  if(fsi >= 55) return 'strongly_above_expectation';
  if(fsi >= 18) return 'above_expectation';
  if(fsi <= -55) return 'strongly_below_expectation';
  if(fsi <= -18) return 'below_expectation';
  return 'normal';
}

export function buildFormSurpriseExplanation({ teamName = 'Equipo', status = 'normal', fsi = 0, seasonBase = null, recentForm = null } = {}){
  if(!seasonBase) return `Base de temporada no disponible para ${teamName}.`;
  if(!recentForm) return `Forma reciente insuficiente para ${teamName}.`;
  const delta = recentForm.ppg - seasonBase.ppg;
  const deltaTxt = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pts/partido`;
  if(status === 'strongly_above_expectation') return `${teamName} llega muy por encima de su base estructural (${deltaTxt}), con mejora clara en producción y/o solidez reciente.`;
  if(status === 'above_expectation') return `${teamName} llega por encima de su nivel estructural (${deltaTxt}), mostrando una forma reciente mejor de lo habitual.`;
  if(status === 'strongly_below_expectation') return `${teamName} llega muy por debajo de su base estructural (${deltaTxt}), con señales recientes de caída competitiva.`;
  if(status === 'below_expectation') return `${teamName} llega por debajo de su nivel estructural (${deltaTxt}), rindiendo menos que su referencia de temporada.`;
  return `${teamName} mantiene una forma reciente cercana a su base estructural (FSI ${Number(fsi).toFixed(1)}).`;
}

export function buildTeamFormSurpriseSignal({
  brainV2 = {},
  team = {},
  leagueId = '',
  N = 5,
  minMatches = 3
} = {}){
  const seasonBase = computeSeasonBaseMetrics(team?.intProfile?.seasonBase || null);
  const recentMatches = collectRecentMatchesForTeam({
    brainV2,
    teamId: team?.id || '',
    teamName: team?.name || '',
    leagueId,
    N
  });
  const recentForm = computeRecentFormMetrics(recentMatches, { minMatches });
  if(!seasonBase || !recentForm){
    return {
      team: team?.name || 'Equipo',
      N,
      seasonBase,
      recentForm,
      FSI: null,
      status: 'unavailable',
      explanation: !seasonBase
        ? `Base de temporada no disponible para ${team?.name || 'Equipo'}.`
        : `Forma reciente insuficiente (${recentMatches.length}/${minMatches} con marcador utilizable).`
    };
  }
  const FSI = computeFormSurpriseIndex({ seasonBase, recentForm });
  const status = classifyFormSurprise(FSI);
  return {
    team: team?.name || 'Equipo',
    N,
    seasonBase,
    recentForm,
    FSI,
    status,
    explanation: buildFormSurpriseExplanation({ teamName: team?.name || 'Equipo', status, fsi: FSI, seasonBase, recentForm })
  };
}

export function buildMatchFormSurprise({ brainV2 = {}, home = {}, away = {}, leagueId = '', N = 5 } = {}){
  const homeSignal = buildTeamFormSurpriseSignal({ brainV2, team: home, leagueId, N });
  const awaySignal = buildTeamFormSurpriseSignal({ brainV2, team: away, leagueId, N });
  const available = [homeSignal, awaySignal].filter((row)=>Number.isFinite(row?.FSI));
  let conclusion = 'Sin datos suficientes para comparar forma vs expectativa.';
  if(available.length === 2){
    if((awaySignal.FSI - homeSignal.FSI) >= 15){
      conclusion = `${awaySignal.team} llega más peligroso de lo habitual frente a su base, incluso si ${homeSignal.team} también viene fuerte.`;
    }else if((homeSignal.FSI - awaySignal.FSI) >= 15){
      conclusion = `${homeSignal.team} muestra una aceleración reciente más alta frente a su identidad base.`;
    }else{
      conclusion = 'Ambos equipos llegan con una desviación similar frente a su base estructural.';
    }
  }
  return {
    N,
    home: homeSignal,
    away: awaySignal,
    conclusion
  };
}
