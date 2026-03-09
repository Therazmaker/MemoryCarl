const UCL_COMP_REGEX = /(champions|uefa\s*champions|ucl)/i;
const KO_STAGE_REGEX = /(round\s*of\s*16|octavos|quarter|cuartos|semi|final|knockout|eliminatoria)/i;

export const UCL_KNOCKOUT_WEIGHTS = {
  domesticGap: 0.18,
  europeanMaturityGap: 0.20,
  firstLegCage: 0.16,
  underdogResistance: 0.16,
  favoriteFragility: 0.14,
  bigNightStability: 0.10,
  stressVolatility: 0.06
};

const DEFAULT_CONFIDENCE = 0.72;

export function clamp(value, min = 0, max = 100){
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function normalize(value, min, max){
  const span = (Number(max) || 0) - (Number(min) || 0);
  if(span <= 0) return 0;
  return clamp(((Number(value) || 0) - Number(min)) / span, 0, 1);
}

function weightedAverage(items = []){
  const valid = items.filter((it)=>Number.isFinite(it?.value) && Number.isFinite(it?.weight) && it.weight > 0);
  const totalWeight = valid.reduce((acc, it)=>acc + it.weight, 0);
  if(totalWeight <= 0) return null;
  return valid.reduce((acc, it)=>acc + (it.value * it.weight), 0) / totalWeight;
}

function fallbackPenalty(fallbacks = 0){
  return clamp(fallbacks * 0.06, 0, 0.35);
}

function toPct(value){
  return clamp(Math.round(value), 0, 100);
}

function detectFavorite({ strengthHome = 50, strengthAway = 50, market = {} } = {}){
  const homeOdd = Number(market?.home);
  const awayOdd = Number(market?.away);
  if(Number.isFinite(homeOdd) && Number.isFinite(awayOdd) && homeOdd !== awayOdd){
    return homeOdd < awayOdd ? 'home' : 'away';
  }
  return Number(strengthHome) >= Number(strengthAway) ? 'home' : 'away';
}

export function detectCompetitionMode({ match = {} } = {}){
  const competition = String(match?.competition || match?.league || '').trim();
  const stage = String(match?.stage || match?.phase || '').trim();
  const leg = String(match?.leg || match?.roundLeg || '').trim();
  const isChampions = UCL_COMP_REGEX.test(competition);
  const isKnockout = KO_STAGE_REGEX.test(stage) || /ida|vuelta|1st\s*leg|2nd\s*leg/i.test(leg);
  return {
    competitionMode: isChampions && isKnockout ? 'ucl_knockout' : 'league',
    isChampions,
    isKnockout,
    autoDetected: isChampions && isKnockout,
    reasons: [
      isChampions ? 'Competition tagged as UEFA Champions League.' : '',
      isKnockout ? 'Knockout stage/leg detected.' : ''
    ].filter(Boolean)
  };
}

export function computeEuropeanMaturityScore({ teamName = 'Equipo', side = 'home', prematch = {}, strength = 50, fallbackNotes = [] } = {}){
  const rqiPack = side === 'home' ? prematch?.rqi?.home : prematch?.rqi?.away;
  const form10 = side === 'home' ? prematch?.form?.homeLast10 : prematch?.form?.awayLast10;
  const split = side === 'home' ? prematch?.homeAway?.home : prematch?.homeAway?.away;

  let fallbackCount = 0;
  const defensiveStability = form10?.played ? 100 - clamp(((Number(form10.ga) || 0) / Math.max(1, Number(form10.played))) * 25, 0, 100) : (fallbackCount++, clamp(strength, 35, 80));
  const pressureConsistency = Number(rqiPack?.subscores?.controlConviction ?? rqiPack?.RQI);
  const consistencyScore = Number.isFinite(pressureConsistency) ? clamp(pressureConsistency, 0, 100) : (fallbackCount++, clamp(strength * 0.85, 30, 85));
  const awayStability = split?.played ? clamp((Number(split.ppg) || 0) * 33, 0, 100) : (fallbackCount++, 52);
  const volatilityPenalty = form10?.played ? clamp(Math.abs((Number(form10.gf) || 0) - (Number(form10.ga) || 0)) > 6 ? 9 : 4, 0, 12) : 7;

  const raw = weightedAverage([
    { value: defensiveStability, weight: 0.35 },
    { value: consistencyScore, weight: 0.35 },
    { value: awayStability, weight: 0.30 }
  ]);
  const score = toPct((raw ?? 55) - volatilityPenalty);

  if(fallbackCount > 0) fallbackNotes.push(`${teamName}: European Maturity built with ${fallbackCount} proxy sources.`);

  return {
    score,
    label: score >= 72 ? 'elite' : score >= 58 ? 'competitive' : score >= 45 ? 'fragile' : 'volatile',
    fallbackCount,
    reasons: [
      `${teamName} muestra ${defensiveStability >= 65 ? 'solidez' : 'fragilidad'} defensiva reciente (${toPct(defensiveStability)}).`,
      `Consistencia competitiva en partidos exigentes: ${toPct(consistencyScore)}.`,
      `Estabilidad fuera de casa/proxy: ${toPct(awayStability)}.`
    ]
  };
}

export function computeFirstLegCageIndex({ context = {}, favoriteFragility = 50, underdogResistance = 50 } = {}){
  const legText = String(context?.leg || '').toLowerCase();
  const isFirstLeg = /ida|1st/.test(legText);
  const firstLegBoost = isFirstLeg ? 14 : 0;
  const tacticalCaution = context?.isKnockout ? 16 : 6;
  const compactness = clamp((Number(underdogResistance) * 0.28) + (Number(favoriteFragility) * 0.22), 0, 45);
  const base = 24 + firstLegBoost + tacticalCaution + compactness;
  const score = toPct(base);
  return {
    score,
    label: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low',
    reasons: [
      isFirstLeg ? 'Partido de ida detectado: aumenta la prudencia táctica.' : 'No se detecta ida explícita, cautela moderada.',
      `Resistencia del underdog + fragilidad del favorito elevan el riesgo de atasco (${score}).`
    ]
  };
}

export function computeUnderdogResistanceScore({ underdogForm = null, underdogStrength = 50, underdogFsi = 0 } = {}){
  const games = Number(underdogForm?.n || underdogForm?.played || 0);
  const gaPg = Number(underdogForm?.gaPerGame ?? (games ? (Number(underdogForm?.ga || 0) / games) : null));
  const defense = Number.isFinite(gaPg) ? clamp(100 - (gaPg * 35), 20, 90) : clamp(underdogStrength * 0.9, 35, 80);
  const formResilience = clamp((Number(underdogForm?.ptsPerGame ?? 1.2) * 32), 20, 88);
  const transitionThreat = clamp(48 + (Number(underdogFsi) * 0.6), 20, 82);
  const score = toPct(weightedAverage([
    { value: defense, weight: 0.5 },
    { value: formResilience, weight: 0.3 },
    { value: transitionThreat, weight: 0.2 }
  ]) ?? 52);
  return {
    score,
    label: score >= 68 ? 'high' : score >= 50 ? 'medium' : 'low',
    reasons: [
      `Defensa del underdog estimada en ${toPct(defense)}.`,
      `Capacidad de sostener tramos largos: ${toPct(formResilience)}.`,
      `Amenaza puntual en transición/balón parado: ${toPct(transitionThreat)}.`
    ]
  };
}

export function computeFavoriteConversionFragility({ favoriteForm = null, favoriteStrength = 55, favoriteFsi = 0 } = {}){
  const gfPg = Number(favoriteForm?.gfPerGame ?? null);
  const gaPg = Number(favoriteForm?.gaPerGame ?? null);
  const sterileVolumeRisk = Number.isFinite(gfPg) ? clamp(68 - (gfPg * 12), 18, 78) : clamp(70 - favoriteStrength * 0.5, 22, 72);
  const inefficiency = clamp(48 - (Number(favoriteFsi) * 0.6), 20, 82);
  const emotionalLeak = Number.isFinite(gaPg) ? clamp(gaPg * 18, 8, 35) : 18;
  const score = toPct(weightedAverage([
    { value: sterileVolumeRisk, weight: 0.45 },
    { value: inefficiency, weight: 0.35 },
    { value: emotionalLeak, weight: 0.2 }
  ]) ?? 48);
  return {
    score,
    label: score >= 66 ? 'high' : score >= 47 ? 'medium' : 'low',
    reasons: [
      `Riesgo de dominio estéril estimado en ${toPct(sterileVolumeRisk)}.`,
      `Eficiencia de finalización reciente sugiere fragilidad ${toPct(inefficiency)}.`,
      `Señales de pérdida de control tras errores: ${toPct(emotionalLeak)}.`
    ]
  };
}

export function computeBigNightStabilityScore({ form = null, strength = 50, fsi = 0, teamName = 'Equipo' } = {}){
  const recentPoints = Number(form?.ptsPerGame ?? 1.3);
  const controlBase = clamp((recentPoints * 34) + (Number(strength) * 0.32), 18, 92);
  const pressureResponse = clamp(52 + (Number(fsi) * 0.9), 20, 90);
  const latePhase = clamp(45 + (recentPoints * 12), 20, 88);
  const score = toPct(weightedAverage([
    { value: controlBase, weight: 0.45 },
    { value: pressureResponse, weight: 0.35 },
    { value: latePhase, weight: 0.2 }
  ]) ?? 54);
  return {
    score,
    label: score >= 72 ? 'strong' : score >= 55 ? 'steady' : 'shaky',
    reasons: [
      `${teamName} conserva estructura base con nota ${toPct(controlBase)}.`,
      `Respuesta emocional bajo presión: ${toPct(pressureResponse)}.`,
      `Sostenimiento competitivo 60-90': ${toPct(latePhase)}.`
    ]
  };
}

function classifyCsi(score = 50){
  if(score < 34) return 'clean favorite';
  if(score < 52) return 'favorite in uncomfortable spot';
  if(score < 70) return 'draw very live';
  return 'surprise danger';
}

function visualTagFromLabel(label = ''){
  if(label === 'clean favorite') return 'CLEAN FAVORITE';
  if(label === 'favorite in uncomfortable spot') return 'TACTICAL TRAP';
  if(label === 'draw very live') return 'DRAW LIVE';
  return 'SURPRISE ALERT';
}

export function computeChampionsSurpriseIndex({ domesticGap = 0, europeanMaturityGap = 0, firstLegCage = 50, underdogResistance = 50, favoriteFragility = 50, bigNightStabilityGap = 0, stressVolatility = 50, weights = UCL_KNOCKOUT_WEIGHTS } = {}){
  const normalizedDomestic = normalize(Math.abs(domesticGap), 0, 35);
  const domesticInversion = (1 - normalizedDomestic) * 100;
  const maturityStress = normalize(europeanMaturityGap * -1, -30, 30) * 100;
  const bigNightStress = normalize(bigNightStabilityGap * -1, -30, 30) * 100;

  const score = toPct(weightedAverage([
    { value: domesticInversion, weight: weights.domesticGap },
    { value: maturityStress, weight: weights.europeanMaturityGap },
    { value: clamp(firstLegCage, 0, 100), weight: weights.firstLegCage },
    { value: clamp(underdogResistance, 0, 100), weight: weights.underdogResistance },
    { value: clamp(favoriteFragility, 0, 100), weight: weights.favoriteFragility },
    { value: bigNightStress, weight: weights.bigNightStability },
    { value: clamp(stressVolatility, 0, 100), weight: weights.stressVolatility }
  ]) ?? 50);

  return {
    score,
    label: classifyCsi(score),
    visualTag: visualTagFromLabel(classifyCsi(score)),
    reasons: [
      `Domestic gap ${Math.round(domesticGap)} no garantiza control KO.`,
      'El contexto de eliminatoria eleva el valor de resistir y castigar.',
      `Índice de cautela táctica (ida/KO): ${toPct(firstLegCage)}.`
    ]
  };
}

export function predictChampionsMatchScript({ csi = 50, firstLegCage = 50, favoriteFragility = 50, underdogResistance = 50, bigNightGap = 0 } = {}){
  const reasons = [];
  let primaryScript = 'balanced_and_cautious';
  let secondaryScript = 'favorite_controls_but_gets_stuck';

  if(csi <= 34 && favoriteFragility < 42){
    primaryScript = 'favorite_controls_and_converts';
    secondaryScript = 'match_breaks_open_after_early_goal';
    reasons.push('El favorito llega con bajo riesgo CSI y buena conversión proyectada.');
  } else if(firstLegCage >= 65 && underdogResistance >= 62){
    primaryScript = 'favorite_controls_but_gets_stuck';
    secondaryScript = 'balanced_and_cautious';
    reasons.push('La ida/escenario KO favorece partido trabado y ritmo bajo.');
  } else if(csi >= 70 || underdogResistance >= 70){
    primaryScript = 'underdog_resists_and_punishes';
    secondaryScript = 'second_half_emotional_chaos';
    reasons.push('Sube el potencial de sorpresa por resistencia del underdog.');
  } else if(Math.abs(bigNightGap) <= 6 && favoriteFragility >= 58){
    primaryScript = 'second_half_emotional_chaos';
    secondaryScript = 'match_breaks_open_after_early_goal';
    reasons.push('Brecha emocional chica + fragilidad del favorito enciende tramos calientes.');
  }

  const confidence = clamp(0.62 + (Math.abs(csi - 50) / 200) + (Math.abs(firstLegCage - 50) / 250), 0.45, 0.89);
  return {
    primaryScript,
    secondaryScript,
    confidence: Number(confidence.toFixed(2)),
    reasons
  };
}

function buildEditorialLine({ csiLabel = '', firstLegCage = 50, underdogResistance = 50, favoriteFragility = 50 } = {}){
  if(csiLabel === 'clean favorite') return 'Favorito fuerte y con guion bastante limpio para imponer control.';
  if(firstLegCage >= 65 && underdogResistance >= 60) return 'La ida invita a cautela y favorece la resistencia del no-favorito.';
  if(favoriteFragility >= 60) return 'Mucho dominio potencial del favorito, pero con señales claras de atasco.';
  return 'Favorito superior en nivel base, pero partido de riesgo táctico.';
}

export function buildChampionsAnalysisPayload({ match = {}, prematch = {}, formHome = null, formAway = null, strengthHome = 50, strengthAway = 50, fsiHome = 0, fsiAway = 0, market = {}, manualMode = null } = {}){
  const detection = detectCompetitionMode({ match });
  const competitionMode = manualMode || detection.competitionMode;
  const fallbackNotes = [];

  if(competitionMode !== 'ucl_knockout'){
    return { competitionMode, active: false, detection, message: 'League mode: Champions engine not applied.' };
  }

  console.info('[UCL] Champions mode detected', { competition: match?.competition || match?.league, stage: match?.stage || match?.phase, leg: match?.leg });
  const favoriteSide = detectFavorite({ strengthHome, strengthAway, market });
  const underdogSide = favoriteSide === 'home' ? 'away' : 'home';
  const favoriteName = favoriteSide === 'home' ? (match?.home || 'Local') : (match?.away || 'Visitante');
  const underdogName = underdogSide === 'home' ? (match?.home || 'Local') : (match?.away || 'Visitante');

  const emHome = computeEuropeanMaturityScore({ teamName: match?.home, side: 'home', prematch, strength: strengthHome, fallbackNotes });
  const emAway = computeEuropeanMaturityScore({ teamName: match?.away, side: 'away', prematch, strength: strengthAway, fallbackNotes });
  const underdogResistance = computeUnderdogResistanceScore({
    underdogForm: underdogSide === 'home' ? formHome : formAway,
    underdogStrength: underdogSide === 'home' ? strengthHome : strengthAway,
    underdogFsi: underdogSide === 'home' ? fsiHome : fsiAway
  });
  const favoriteFragility = computeFavoriteConversionFragility({
    favoriteForm: favoriteSide === 'home' ? formHome : formAway,
    favoriteStrength: favoriteSide === 'home' ? strengthHome : strengthAway,
    favoriteFsi: favoriteSide === 'home' ? fsiHome : fsiAway
  });

  console.info('[UCL] Computing First Leg Cage Index');
  const firstLegCage = computeFirstLegCageIndex({
    context: {
      leg: match?.leg || match?.roundLeg || '',
      isKnockout: detection.isKnockout
    },
    favoriteFragility: favoriteFragility.score,
    underdogResistance: underdogResistance.score
  });

  const bnsHome = computeBigNightStabilityScore({ form: formHome, strength: strengthHome, fsi: fsiHome, teamName: match?.home });
  const bnsAway = computeBigNightStabilityScore({ form: formAway, strength: strengthAway, fsi: fsiAway, teamName: match?.away });

  const domesticGap = Number(strengthHome) - Number(strengthAway);
  const favoriteEm = favoriteSide === 'home' ? emHome.score : emAway.score;
  const underdogEm = underdogSide === 'home' ? emHome.score : emAway.score;
  const europeanMaturityGap = favoriteEm - underdogEm;
  const favoriteBns = favoriteSide === 'home' ? bnsHome.score : bnsAway.score;
  const underdogBns = underdogSide === 'home' ? bnsHome.score : bnsAway.score;
  const bigNightStabilityGap = favoriteBns - underdogBns;
  const stressVolatility = clamp((favoriteFragility.score * 0.55) + (100 - Math.abs(bigNightStabilityGap) * 2), 20, 92);

  const csi = computeChampionsSurpriseIndex({
    domesticGap,
    europeanMaturityGap,
    firstLegCage: firstLegCage.score,
    underdogResistance: underdogResistance.score,
    favoriteFragility: favoriteFragility.score,
    bigNightStabilityGap,
    stressVolatility
  });

  const script = predictChampionsMatchScript({
    csi: csi.score,
    firstLegCage: firstLegCage.score,
    favoriteFragility: favoriteFragility.score,
    underdogResistance: underdogResistance.score,
    bigNightGap: bigNightStabilityGap
  });

  if(fallbackNotes.length){
    console.info('[UCL] Using fallback proxies for European Maturity', fallbackNotes);
  }

  const confidence = clamp((DEFAULT_CONFIDENCE - fallbackPenalty(fallbackNotes.length) + (script.confidence - 0.62)), 0.38, 0.9);
  const reasons = [
    ...csi.reasons,
    ...firstLegCage.reasons.slice(0, 1),
    ...underdogResistance.reasons.slice(0, 1),
    ...favoriteFragility.reasons.slice(0, 1),
    ...script.reasons
  ].slice(0, 6);

  return {
    active: true,
    competitionMode,
    detection,
    context: {
      competition: match?.competition || match?.league || 'Champions League',
      stage: match?.stage || match?.phase || 'Knockout',
      leg: match?.leg || match?.roundLeg || 'N/A',
      venue: `${match?.home || 'Local'} vs ${match?.away || 'Visitante'}`,
      favorite: favoriteName,
      underdog: underdogName
    },
    ratings: {
      domesticStrength: {
        home: toPct(strengthHome),
        away: toPct(strengthAway),
        gap: Number(domesticGap.toFixed(1))
      },
      europeanMaturity: { home: emHome, away: emAway, gap: Number((emHome.score - emAway.score).toFixed(1)) },
      underdogResistance,
      favoriteConversionFragility: favoriteFragility,
      bigNightStability: { home: bnsHome, away: bnsAway, gap: Number((bnsHome.score - bnsAway.score).toFixed(1)) },
      firstLegCage
    },
    championsSurpriseIndex: {
      score: csi.score,
      label: csi.label,
      visualTag: csi.visualTag,
      reasons
    },
    matchScript: script,
    confidence: Number(confidence.toFixed(2)),
    editorial: buildEditorialLine({
      csiLabel: csi.label,
      firstLegCage: firstLegCage.score,
      underdogResistance: underdogResistance.score,
      favoriteFragility: favoriteFragility.score
    }),
    fallbackNotes
  };
}
