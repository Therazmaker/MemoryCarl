import { collectMatchesForTeam } from './readiness_memory.js';
import { buildMatchCSI } from './current_strength_index.js';
import { buildMatchRQI } from './result_quality_index.js';
import { buildMatchFormSurprise } from './form_surprise_index.js';

const BRAIN_TAG_COPY = {
  territorial_pressure: 'tendencia a empujar al rival hacia atrás',
  momentum_control: 'capacidad para gobernar los tramos del partido',
  finishing_edge: 'más filo en zonas decisivas',
  clinical_finish: 'más filo en zonas decisivas',
  finishing_failure: 'cierta inconsistencia en la definición',
  keeper_heroics: 'dependencia potencial del portero en escenarios exigentes',
  discipline_issues: 'riesgo de rupturas por indisciplina',
  counter_strike: 'amenaza para castigar transiciones',
  late_pressure: 'capacidad para apretar en tramos finales',
  setpiece_threat: 'peligro claro a balón parado'
};

function clamp(value, min, max){
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function norm(value = ''){
  return String(value || '').trim().toLowerCase();
}

function safeDateTs(value){
  const ts = Date.parse(String(value || '').trim());
  return Number.isFinite(ts) ? ts : 0;
}

function computeTableRows(tracker = [], leagueId = ''){
  const rows = new Map();
  (Array.isArray(tracker) ? tracker : [])
    .filter((m)=>!leagueId || String(m?.leagueId || '') === String(leagueId))
    .forEach((m)=>{
      const homeId = m?.homeId;
      const awayId = m?.awayId;
      const hg = Number(m?.homeGoals);
      const ag = Number(m?.awayGoals);
      if(!homeId || !awayId || !Number.isFinite(hg) || !Number.isFinite(ag)) return;
      const ensure = (teamId)=>{
        if(!rows.has(teamId)) rows.set(teamId, { teamId, pts: 0, gf: 0, ga: 0, p: 0, w: 0, d: 0, l: 0 });
        return rows.get(teamId);
      };
      const home = ensure(homeId);
      const away = ensure(awayId);
      home.gf += hg; home.ga += ag; home.p += 1;
      away.gf += ag; away.ga += hg; away.p += 1;
      if(hg > ag){ home.w += 1; away.l += 1; home.pts += 3; }
      else if(ag > hg){ away.w += 1; home.l += 1; away.pts += 3; }
      else { home.d += 1; away.d += 1; home.pts += 1; away.pts += 1; }
    });

  return [...rows.values()]
    .map((row)=>({ ...row, gd: row.gf - row.ga }))
    .sort((a,b)=>b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || String(a.teamId).localeCompare(String(b.teamId)));
}

function buildRecentForm(tracker = [], teamId = '', limit = 5){
  const matches = (Array.isArray(tracker) ? tracker : [])
    .filter((m)=>m?.homeId === teamId || m?.awayId === teamId)
    .slice()
    .sort((a,b)=>safeDateTs(a?.date) - safeDateTs(b?.date))
    .slice(-Math.max(1, Number(limit) || 5));
  let w = 0; let d = 0; let l = 0; let gf = 0; let ga = 0;
  const sequence = matches.map((m)=>{
    const isHome = m?.homeId === teamId;
    const goalsFor = Number(isHome ? m?.homeGoals : m?.awayGoals) || 0;
    const goalsAgainst = Number(isHome ? m?.awayGoals : m?.homeGoals) || 0;
    gf += goalsFor;
    ga += goalsAgainst;
    if(goalsFor > goalsAgainst){ w += 1; return 'W'; }
    if(goalsFor < goalsAgainst){ l += 1; return 'L'; }
    d += 1;
    return 'D';
  });
  const points = w * 3 + d;
  const formPct = matches.length ? points / (matches.length * 3) : 0;
  const trendLabel = formPct >= 0.72 ? 'strong' : formPct >= 0.5 ? 'solid' : formPct >= 0.35 ? 'mixed' : 'fragile';
  return { limit, played: matches.length, points, w, d, l, gf, ga, sequence, trendLabel };
}

function buildHomeAwaySplit(tracker = [], teamId = '', side = 'home', limit = 8){
  const isHomeSide = side === 'home';
  const matches = (Array.isArray(tracker) ? tracker : [])
    .filter((m)=>isHomeSide ? m?.homeId === teamId : m?.awayId === teamId)
    .slice()
    .sort((a,b)=>safeDateTs(a?.date) - safeDateTs(b?.date))
    .slice(-Math.max(1, Number(limit) || 8));
  let points = 0;
  matches.forEach((m)=>{
    const gf = Number(isHomeSide ? m?.homeGoals : m?.awayGoals) || 0;
    const ga = Number(isHomeSide ? m?.awayGoals : m?.homeGoals) || 0;
    if(gf > ga) points += 3;
    else if(gf === ga) points += 1;
  });
  const ppg = matches.length ? points / matches.length : null;
  const strengthLabel = ppg === null ? 'unknown' : ppg >= 2.1 ? 'strong' : ppg >= 1.4 ? 'competitive' : 'inconsistent';
  return { played: matches.length, points, ppg, strengthLabel };
}

function detectCompetitiveContext({ homeTable, awayTable, tableRows, homeName, awayName }){
  if(!homeTable || !awayTable || !Array.isArray(tableRows) || !tableRows.length){
    return { stakes: 'neutral_context', confidence: 'low' };
  }
  const top = tableRows[0];
  const gapToLeaderHome = Number(top?.pts || 0) - Number(homeTable?.pts || 0);
  const gapToLeaderAway = Number(top?.pts || 0) - Number(awayTable?.pts || 0);
  const maxPos = tableRows.length;
  const lowBand = Math.max(16, maxPos - 3);
  const derby = norm(homeName).includes(norm(awayName)) || norm(awayName).includes(norm(homeName));

  if((homeTable.pos <= 2 && gapToLeaderHome <= 3) || (awayTable.pos <= 2 && gapToLeaderAway <= 3)){
    return { stakes: 'title_race', titleRace: true, confidence: 'high' };
  }
  if(homeTable.pos <= 4 && awayTable.pos <= 6){
    return { stakes: 'top4_race', europeContext: true, confidence: 'high' };
  }
  if(homeTable.pos <= 7 && awayTable.pos <= 7){
    return { stakes: 'european_race', europeContext: true, confidence: 'medium' };
  }
  if(homeTable.pos >= lowBand && awayTable.pos >= lowBand){
    return { stakes: 'relegation_battle', confidence: 'high' };
  }
  if(derby){
    return { stakes: 'derby', confidence: 'medium' };
  }
  return { stakes: 'midtable_low_pressure', confidence: 'medium' };
}

export function collectPrematchData({ db = {}, brainV2 = {}, homeId = '', awayId = '', leagueId = '', market = null, readiness = null, matchDate = '', csiWindow = 5 } = {}){
  const tracker = Array.isArray(db?.tracker) ? db.tracker : [];
  const teams = Array.isArray(db?.teams) ? db.teams : [];
  const leagues = Array.isArray(db?.leagues) ? db.leagues : [];
  const players = Array.isArray(db?.players) ? db.players : [];
  const homeTeam = teams.find((t)=>t?.id === homeId) || {};
  const awayTeam = teams.find((t)=>t?.id === awayId) || {};
  const resolvedLeagueId = leagueId || homeTeam?.leagueId || awayTeam?.leagueId || '';
  const league = leagues.find((item)=>item?.id === resolvedLeagueId) || {};

  const tableRows = computeTableRows(tracker, resolvedLeagueId).map((row, idx)=>({ ...row, pos: idx + 1 }));
  const homeTable = tableRows.find((row)=>row.teamId === homeId) || null;
  const awayTable = tableRows.find((row)=>row.teamId === awayId) || null;

  const h2hMatches = tracker
    .filter((m)=>(m?.homeId === homeId && m?.awayId === awayId) || (m?.homeId === awayId && m?.awayId === homeId))
    .slice()
    .sort((a,b)=>safeDateTs(a?.date) - safeDateTs(b?.date))
    .slice(-6);

  const homeMemoryRows = collectMatchesForTeam({
    memories: brainV2?.memories || {},
    teamId: homeId,
    teamName: homeTeam?.name || '',
    leagueId: resolvedLeagueId,
    limit: 10
  }).rows;
  const awayMemoryRows = collectMatchesForTeam({
    memories: brainV2?.memories || {},
    teamId: awayId,
    teamName: awayTeam?.name || '',
    leagueId: resolvedLeagueId,
    limit: 10
  }).rows;

  const csi = buildMatchCSI({
    brainV2,
    home: { id: homeId, name: homeTeam?.name || 'Local' },
    away: { id: awayId, name: awayTeam?.name || 'Visitante' },
    leagueId: resolvedLeagueId,
    N: csiWindow
  });

  const fsi = buildMatchFormSurprise({
    brainV2,
    home: homeTeam,
    away: awayTeam,
    leagueId: resolvedLeagueId,
    N: csiWindow
  });

  const rqi = buildMatchRQI({
    brainV2,
    home: { id: homeId, name: homeTeam?.name || 'Local' },
    away: { id: awayId, name: awayTeam?.name || 'Visitante' },
    leagueId: resolvedLeagueId,
    N: csiWindow
  });

  return {
    match: {
      homeId,
      awayId,
      home: homeTeam?.name || 'Local',
      away: awayTeam?.name || 'Visitante',
      competition: league?.name || 'Simulation',
      competitionId: resolvedLeagueId,
      date: matchDate || new Date().toISOString().slice(0, 10)
    },
    standings: { tableRows, homeTable, awayTable },
    form: {
      homeLast5: buildRecentForm(tracker, homeId, 5),
      awayLast5: buildRecentForm(tracker, awayId, 5),
      homeLast10: buildRecentForm(tracker, homeId, 10),
      awayLast10: buildRecentForm(tracker, awayId, 10)
    },
    homeAway: {
      home: buildHomeAwaySplit(tracker, homeId, 'home', 8),
      away: buildHomeAwaySplit(tracker, awayId, 'away', 8)
    },
    h2h: { matches: h2hMatches },
    readiness: readiness || null,
    players: {
      home: players.filter((p)=>p?.teamId === homeId),
      away: players.filter((p)=>p?.teamId === awayId)
    },
    market,
    memory: {
      homeRows: homeMemoryRows,
      awayRows: awayMemoryRows
    },
    csi,
    rqi,
    fsi,
    context: detectCompetitiveContext({
      homeTable,
      awayTable,
      tableRows,
      homeName: homeTeam?.name,
      awayName: awayTeam?.name
    })
  };
}

export function collectBrainSignalContext(memoryRows = []){
  const tagTotals = new Map();
  (Array.isArray(memoryRows) ? memoryRows : []).forEach((row)=>{
    const reasons = Array.isArray(row?.summary?.reasons) ? row.summary.reasons : [];
    reasons.forEach((reason)=>{
      const tag = String(reason?.tagId || reason?.tag || '').trim();
      const strength = clamp(reason?.strength, 0, 1);
      if(!tag) return;
      tagTotals.set(tag, (tagTotals.get(tag) || 0) + strength);
    });
  });
  return [...tagTotals.entries()]
    .sort((a,b)=>b[1] - a[1])
    .slice(0, 4)
    .map(([tag, weight])=>({
      tag,
      weight: Number(weight.toFixed(2)),
      copy: BRAIN_TAG_COPY[tag] || `señal de ${tag.replace(/_/g, ' ')}`
    }));
}

export function buildEditorialAngle(insights = {}){
  const homeProb = Number(insights?.oddsContext?.homeProb) || 0;
  const awayProb = Number(insights?.oddsContext?.awayProb) || 0;
  const readinessEdge = Number(insights?.readiness?.edgeScore) || 0;
  const formDelta = Number(insights?.contradictions?.formDelta) || 0;
  const riskCount = Array.isArray(insights?.contradictions?.notes) ? insights.contradictions.notes.length : 0;

  if((homeProb - awayProb) > 0.18 && readinessEdge > 4 && formDelta < -2){
    return { headlineType: 'favorite_but_not_free', coreTension: `${insights?.match?.home} parte por delante, pero ${insights?.match?.away} llega con dinámica más sólida.` };
  }
  if((homeProb - awayProb) > 0.2 && riskCount >= 2){
    return { headlineType: 'stronger_side_with_schedule_risk', coreTension: 'Hay ventaja estructural, pero señales de riesgo competitivo real.' };
  }
  if(Math.abs(formDelta) <= 1 && Math.abs(readinessEdge) <= 4){
    return { headlineType: 'balanced_fixture_despite_market_gap', coreTension: 'El duelo parece más parejo de lo que sugiere el precio inicial.' };
  }
  if(formDelta >= 3){
    return { headlineType: 'dominant_home_side_vs_resurgent_visitor', coreTension: `${insights?.match?.away} llega al alza frente a un local que sostiene ventaja de contexto.` };
  }
  return { headlineType: 'context_driven_match', coreTension: 'Partido definido por detalles de forma, contexto y estado competitivo.' };
}

function summarizeH2h(h2hMatches = [], homeId = '', awayId = ''){
  if(!Array.isArray(h2hMatches) || !h2hMatches.length) return null;
  let homeWins = 0; let awayWins = 0; let draws = 0;
  h2hMatches.forEach((m)=>{
    const hg = Number(m?.homeGoals) || 0;
    const ag = Number(m?.awayGoals) || 0;
    if(hg === ag) draws += 1;
    else if((m?.homeId === homeId && hg > ag) || (m?.awayId === homeId && ag > hg)) homeWins += 1;
    else awayWins += 1;
  });
  const label = homeWins > awayWins ? 'home_edge' : awayWins > homeWins ? 'away_edge' : 'balanced';
  const last = h2hMatches[h2hMatches.length - 1] || null;
  return {
    label,
    homeWins,
    awayWins,
    draws,
    lastMeeting: last ? `${last.date || 's/f'} · ${(last.homeGoals ?? 0)}-${(last.awayGoals ?? 0)}` : ''
  };
}

function toOddsContext(market = null, fallback = {}){
  const h = Number(market?.pH ?? fallback?.pH);
  const d = Number(market?.pD ?? fallback?.pD);
  const a = Number(market?.pA ?? fallback?.pA);
  if(!Number.isFinite(h) || !Number.isFinite(a) || !Number.isFinite(d)) return null;
  const favorite = h >= a ? 'home' : 'away';
  const gap = Math.abs(h - a);
  return {
    homeProb: h,
    drawProb: d,
    awayProb: a,
    favorite,
    marketGap: gap >= 0.18 ? 'clear' : gap >= 0.1 ? 'moderate' : 'tight'
  };
}

function buildReadinessEditorial(readiness = null){
  if(!readiness?.home || !readiness?.away) return null;
  const homeScore = Number(readiness.home.readinessScore) || 0;
  const awayScore = Number(readiness.away.readinessScore) || 0;
  const edge = Number((homeScore - awayScore).toFixed(1));
  const edgeLabel = Math.abs(edge) < 3 ? 'even' : edge > 0 ? 'home_small_edge' : 'away_small_edge';
  return {
    home: readiness.home,
    away: readiness.away,
    edgeScore: edge,
    advantage: edgeLabel,
    line: Math.abs(edge) < 3
      ? 'el readiness llega muy equilibrado en la previa'
      : edge > 0
        ? 'el local presenta una ligera ventaja estructural en readiness'
        : 'el visitante parte con una ligera ventaja estructural en readiness'
  };
}

export function buildPrematchInsights(data = {}){
  const h2h = summarizeH2h(data?.h2h?.matches, data?.match?.homeId, data?.match?.awayId);
  const homeSignals = collectBrainSignalContext(data?.memory?.homeRows || []);
  const awaySignals = collectBrainSignalContext(data?.memory?.awayRows || []);
  const oddsContext = toOddsContext(data?.market, data?.market?.fallbackProbs);
  const readiness = buildReadinessEditorial(data?.readiness);
  const formDelta = (Number(data?.form?.homeLast5?.points) || 0) - (Number(data?.form?.awayLast5?.points) || 0);
  const contradictions = [];
  if(oddsContext && oddsContext.favorite === 'home' && formDelta < 0) contradictions.push('market_favors_home_but_away_form_better');
  if(readiness && readiness.edgeScore > 4 && formDelta < 0) contradictions.push('readiness_home_edge_but_away_form_hot');
  if((Number(data?.homeAway?.home?.ppg) || 0) > 2 && (Number(data?.homeAway?.away?.ppg) || 0) > 1.8) contradictions.push('strong_home_vs_dangerous_away');
  if(h2h && h2h.label === 'home_edge' && h2h.draws >= 2) contradictions.push('historical_edge_but_recent_balance');

  const topHomePlayers = (data?.players?.home || []).slice().sort((a,b)=>(Number(b?.rating) || 0) - (Number(a?.rating) || 0)).slice(0, 3).map((p)=>p.name);
  const topAwayPlayers = (data?.players?.away || []).slice().sort((a,b)=>(Number(b?.rating) || 0) - (Number(a?.rating) || 0)).slice(0, 3).map((p)=>p.name);

  const insights = {
    match: data.match,
    context: data.context,
    standings: {
      home: data?.standings?.homeTable,
      away: data?.standings?.awayTable,
      pointsGap: data?.standings?.homeTable && data?.standings?.awayTable
        ? Math.abs((Number(data.standings.homeTable.pts) || 0) - (Number(data.standings.awayTable.pts) || 0))
        : null
    },
    form: {
      homeLast5: data?.form?.homeLast5,
      awayLast5: data?.form?.awayLast5,
      homeTrendLabel: data?.form?.homeLast5?.trendLabel,
      awayTrendLabel: data?.form?.awayLast5?.trendLabel
    },
    homeAway: {
      homeStrengthLabel: data?.homeAway?.home?.strengthLabel,
      awayStrengthLabel: data?.homeAway?.away?.strengthLabel,
      home: data?.homeAway?.home,
      away: data?.homeAway?.away
    },
    h2h,
    readiness,
    csi: data?.csi || null,
    fsi: data?.fsi || null,
    brainSignals: {
      home: homeSignals,
      away: awaySignals,
      riskNotes: contradictions
    },
    players: {
      homeKey: topHomePlayers,
      awayKey: topAwayPlayers,
      absences: []
    },
    oddsContext,
    contradictions: {
      notes: contradictions,
      formDelta
    },
    memory: {
      homeMatches: Array.isArray(data?.memory?.homeRows) ? data.memory.homeRows.length : 0,
      awayMatches: Array.isArray(data?.memory?.awayRows) ? data.memory.awayRows.length : 0
    }
  };
  insights.editorialAngle = buildEditorialAngle(insights);
  return insights;
}

export function composePrematchHeadline(insights = {}){
  const home = insights?.match?.home || 'Local';
  const away = insights?.match?.away || 'Visitante';
  const mode = insights?.editorialAngle?.headlineType;
  if(mode === 'favorite_but_not_free') return `Favorito sí, paseo no: ${home} recibe a ${away} con tensión real`;
  if(mode === 'balanced_fixture_despite_market_gap') return `${home} vs ${away}: choque más cerrado de lo que parece`;
  if(mode === 'dominant_home_side_vs_resurgent_visitor') return `${home} busca sostener su ventaja ante un ${away} al alza`;
  return `${home} y ${away}, previa de alto detalle antes del pitazo inicial`;
}

export function composePrematchSections(insights = {}){
  const sections = [];
  sections.push({
    key: 'intro',
    title: 'Intro',
    text: `${insights?.match?.home} y ${insights?.match?.away} llegan a este cruce en ${insights?.match?.competition || 'competición'} con una lectura previa marcada por contexto competitivo, forma y señales de preparación.`
  });

  if(insights?.context?.stakes && insights.context.stakes !== 'neutral_context'){
    sections.push({
      key: 'context',
      title: 'Estado competitivo',
      text: `El partido entra en clave ${insights.context.stakes.replace(/_/g, ' ')} y eso eleva el valor estratégico de los puntos en juego.`
    });
  }

  const homeForm = insights?.form?.homeLast5;
  const awayForm = insights?.form?.awayLast5;
  if(homeForm?.played && awayForm?.played){
    sections.push({
      key: 'form',
      title: 'Forma reciente',
      text: `${insights.match.home} suma ${homeForm.points}/${homeForm.played * 3} en sus últimos ${homeForm.played}, mientras ${insights.match.away} acumula ${awayForm.points}/${awayForm.played * 3}.`
    });
  }

  if(insights?.homeAway?.home?.played || insights?.homeAway?.away?.played){
    sections.push({
      key: 'homeaway',
      title: 'Local / visitante',
      text: `${insights.match.home} en casa muestra perfil ${insights.homeAway.homeStrengthLabel || 'estable'}, y ${insights.match.away} fuera presenta rendimiento ${insights.homeAway.awayStrengthLabel || 'variable'}.`
    });
  }

  if(insights?.h2h){
    sections.push({
      key: 'h2h',
      title: 'Historial directo',
      text: `En los últimos cruces, el balance marca ${insights.h2h.homeWins}-${insights.h2h.draws}-${insights.h2h.awayWins} (local-empates-visita). Último antecedente: ${insights.h2h.lastMeeting}.`
    });
  }

  if(insights?.readiness){
    sections.push({
      key: 'readiness',
      title: 'Readiness y señales de cerebro',
      text: `En clave MRE, ${insights.readiness.line}. La diferencia actual es de ${insights.readiness.edgeScore > 0 ? '+' : ''}${insights.readiness.edgeScore} puntos de readiness.`
    });
  }

  const brainLines = [];
  const homeTag = insights?.brainSignals?.home?.[0];
  const awayTag = insights?.brainSignals?.away?.[0];
  if(homeTag) brainLines.push(`${insights.match.home}: ${homeTag.copy}`);
  if(awayTag) brainLines.push(`${insights.match.away}: ${awayTag.copy}`);
  if(brainLines.length){
    sections.push({ key: 'brain', title: 'Lectura MNE', text: brainLines.join(' · ') });
  }

  if((insights?.players?.homeKey || []).length || (insights?.players?.awayKey || []).length){
    sections.push({
      key: 'players',
      title: 'Jugadores clave',
      text: `${insights.match.home}: ${(insights.players.homeKey || []).join(', ') || 'sin datos'} · ${insights.match.away}: ${(insights.players.awayKey || []).join(', ') || 'sin datos'}.`
    });
  }

  if(insights?.oddsContext){
    const fav = insights.oddsContext.favorite === 'home' ? insights.match.home : insights.match.away;
    sections.push({
      key: 'market',
      title: 'Mercado',
      text: `El mercado marca como favorito a ${fav} con un gap ${insights.oddsContext.marketGap}.`
    });
  }

  if(insights?.fsi?.home || insights?.fsi?.away){
    const homeFsi = insights?.fsi?.home;
    const awayFsi = insights?.fsi?.away;
    const homeLine = homeFsi
      ? `${homeFsi.team}: ${Number.isFinite(homeFsi?.FSI) ? `FSI ${homeFsi.FSI} (${homeFsi.status})` : homeFsi.explanation}`
      : '';
    const awayLine = awayFsi
      ? `${awayFsi.team}: ${Number.isFinite(awayFsi?.FSI) ? `FSI ${awayFsi.FSI} (${awayFsi.status})` : awayFsi.explanation}`
      : '';
    sections.push({
      key: 'fsi',
      title: 'Form Surprise Index (FSI)',
      text: [homeLine, awayLine, insights?.fsi?.conclusion].filter(Boolean).join(' · ')
    });
  }

  sections.push({ key: 'close', title: 'Cierre editorial', text: insights?.editorialAngle?.coreTension || '' });
  return sections.filter((section)=>String(section.text || '').trim());
}

export function composePrematchEditorial(insights = {}){
  const headline = composePrematchHeadline(insights);
  const sections = composePrematchSections(insights);
  return {
    headline,
    sections,
    text: [headline, ...sections.map((section)=>`${section.title}: ${section.text}`)].join('\n\n')
  };
}
