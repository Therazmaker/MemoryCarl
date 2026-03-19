/**
 * VIDEO SCOUT MATCH ENGINE
 * Motor de análisis táctico por equipo para el sistema de Video Scout.
 *
 * Implementa separación total de métricas por equipo (home/away),
 * perfiles defensivos, identidad táctica y dinámica de enfrentamiento.
 *
 * Reglas de diseño:
 * - NUNCA mezclar jugadas entre equipos.
 * - TODO debe ser relativo al equipo.
 * - Separar siempre ataque vs defensa.
 * - No usar solo volumen — usar calidad.
 * - No asumir que más jugadas = mejor equipo.
 * - Detectar patrones, no solo números.
 */

// ── Constantes internas ───────────────────────────────────────────────────────

const PLAY_DANGERS = {
  attack_build:   1,
  counter:        4,
  press_recover:  2,
  set_piece:      3,
  cross_sequence: 3,
  through_run:    4,
  shot_sequence:  5,
  sterile_cycle:  0,
};

const SHOT_OUTCOMES = new Set(['goal', 'saved', 'blocked', 'off_target']);

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ── A. Enriquecimiento del modelo de jugada ───────────────────────────────────

/**
 * Enriquece una jugada cruda con los campos del nuevo modelo:
 * team, zones, progressionScore, isDangerous, isSterile, isHighQualityChance.
 *
 * @param {object} rawPlay - jugada en formato existente (type, outcome, metrics, points)
 * @param {'home'|'away'} team - equipo al que pertenece la jugada
 * @returns {object} jugada enriquecida
 */
export function enrichPlay(rawPlay, team) {
  if (!rawPlay) return null;

  const touches    = rawPlay.metrics?.touches    ?? rawPlay.points?.length ?? 1;
  const startZone  = rawPlay.metrics?.startZone  ?? 'mid';
  const endZone    = rawPlay.metrics?.endZone    ?? 'mid';
  const netProg    = rawPlay.metrics?.netProgress ?? 0;
  const dangerBase = PLAY_DANGERS[rawPlay.type]   ?? 1;

  // progressionScore 0-10: combina progresión neta y peligro del tipo
  const progressionScore = Number(clamp(
    (netProg * 5 + dangerBase) * 0.9,
    0, 10
  ).toFixed(1));

  const isDangerous = dangerBase >= 3
    || rawPlay.outcome === 'goal'
    || rawPlay.outcome === 'saved';

  const isSterile = rawPlay.type === 'sterile_cycle'
    || (rawPlay.outcome === 'lost' && netProg < 0)
    || (touches > 6 && endZone !== 'att' && endZone !== 'att_box');

  const isHighQualityChance = rawPlay.type === 'shot_sequence'
    || (dangerBase >= 4 && SHOT_OUTCOMES.has(rawPlay.outcome));

  return {
    ...rawPlay,
    team: team ?? rawPlay.team ?? 'home',
    zones: {
      start: startZone === 'att_box' ? 'box' : startZone,
      end:   endZone   === 'att_box' ? 'box' : endZone,
    },
    touches,
    duration: Array.isArray(rawPlay.points) && rawPlay.points.length > 1
      ? (rawPlay.points[rawPlay.points.length - 1].t ?? 0) - (rawPlay.points[0].t ?? 0)
      : 0,
    progressionScore,
    isDangerous,
    isSterile,
    isHighQualityChance,
  };
}

// ── B. Métricas ofensivas por equipo ─────────────────────────────────────────

/**
 * Calcula el conjunto completo de métricas ofensivas de un equipo.
 *
 * @param {object[]} plays - jugadas enriquecidas del equipo
 * @returns {object|null} métricas por equipo
 */
export function computeTeamMetrics(plays) {
  if (!plays || plays.length === 0) return null;
  const n = plays.length;

  // A. Volumen
  const totalPlays            = n;
  const sequences             = plays.filter(p => p.touches >= 3).length;
  const avgTouchesPerSequence = plays.reduce((s, p) => s + (p.touches || 1), 0) / n;

  // B. Dominio territorial
  const inOppHalf  = plays.filter(p => p.zones?.end === 'att' || p.zones?.end === 'box').length;
  const fieldTilt  = inOppHalf / n;
  const inBox      = plays.filter(p => p.zones?.end === 'box').length;
  const areaPct    = inBox / n;

  // C. Calidad ofensiva
  const dangerSum  = plays.reduce((s, p) => s + (PLAY_DANGERS[p.type] ?? 1), 0);
  const dangerScore = Number((dangerSum / n).toFixed(2));
  const dangerousPlays      = plays.filter(p => p.isDangerous).length;
  const dangerousPlaysRatio = dangerousPlays / n;
  const shotsLikeEvents     = plays.filter(p => p.isHighQualityChance).length;

  // D. Eficiencia
  const goals          = plays.filter(p => p.outcome === 'goal').length;
  const shots          = plays.filter(p => SHOT_OUTCOMES.has(p.outcome)).length;
  const conversionPct  = shots > 0 ? goals / shots : 0;
  const goalPerDanger  = dangerousPlays > 0 ? goals / dangerousPlays : 0;

  // E. Fluidez vs fricción
  const netProgression         = plays.reduce((s, p) => s + (p.metrics?.netProgress || 0), 0) / n;
  const backPassesPerSequence  = plays.reduce((s, p) => s + (p.metrics?.backpasses  || 0), 0) / n;
  const stalledPlays           = plays.filter(p => (p.metrics?.netProgress || 0) <= 0 && p.touches > 3).length;
  const stalledSequencesRatio  = stalledPlays / n;

  // F. Estéril vs efectivo
  const sterilePlays       = plays.filter(p => p.isSterile).length;
  const sterileSPI         = sterilePlays / n;
  const effectivePlays     = plays.filter(p => p.isDangerous && !p.isSterile).length;
  const effectiveAttackRatio = effectivePlays / n;

  // G. Dirección de ataque
  const flanks = { left: 0, center: 0, right: 0 };
  plays.forEach(p => {
    const side = p.metrics?.side || 'center';
    flanks[side] = (flanks[side] || 0) + 1;
  });
  const dominantFlank = Object.entries(flanks).sort((a, b) => b[1] - a[1])[0][0];

  return {
    totalPlays,
    sequences,
    avgTouchesPerSequence:  Number(avgTouchesPerSequence.toFixed(2)),
    fieldTilt:              Number(fieldTilt.toFixed(3)),
    areaPct:                Number(areaPct.toFixed(3)),
    dangerScore,
    dangerousPlaysRatio:    Number(dangerousPlaysRatio.toFixed(3)),
    shotsLikeEvents,
    conversionPct:          Number(conversionPct.toFixed(3)),
    goalPerDanger:          Number(goalPerDanger.toFixed(3)),
    netProgression:         Number(netProgression.toFixed(3)),
    backPassesPerSequence:  Number(backPassesPerSequence.toFixed(2)),
    stalledSequencesRatio:  Number(stalledSequencesRatio.toFixed(3)),
    sterileSPI:             Number(sterileSPI.toFixed(3)),
    effectiveAttackRatio:   Number(effectiveAttackRatio.toFixed(3)),
    dominantFlank,
    goals,
    shots,
  };
}

// ── C. Métricas defensivas por equipo ────────────────────────────────────────

/**
 * Calcula el perfil defensivo de un equipo a partir de las jugadas del RIVAL.
 * Responde: ¿cuánto sufre este equipo?
 *
 * @param {object[]} opponentPlays - jugadas enriquecidas del equipo contrario
 * @returns {object|null} métricas defensivas
 */
export function computeDefensiveMetrics(opponentPlays) {
  if (!opponentPlays || opponentPlays.length === 0) return null;
  const n = opponentPlays.length;

  const dangerousOpp           = opponentPlays.filter(p => p.isDangerous).length;
  const opponentDangerConceded = dangerousOpp / n;

  const oppInBox             = opponentPlays.filter(p => p.zones?.end === 'box').length;
  const opponentAreaAllowed  = oppInBox / n;

  const oppGoals = opponentPlays.filter(p => p.outcome === 'goal').length;
  const oppShots = opponentPlays.filter(p => SHOT_OUTCOMES.has(p.outcome)).length;
  const opponentConversionFaced = oppShots > 0 ? oppGoals / oppShots : 0;

  // pressureResistance: qué porcentaje de jugadas rivales termina sin progresión
  const stalledOpp         = opponentPlays.filter(p => (p.metrics?.netProgress || 0) <= 0).length;
  const pressureResistance = stalledOpp / n;

  return {
    opponentDangerConceded:  Number(opponentDangerConceded.toFixed(3)),
    opponentAreaAllowed:     Number(opponentAreaAllowed.toFixed(3)),
    opponentConversionFaced: Number(opponentConversionFaced.toFixed(3)),
    pressureResistance:      Number(pressureResistance.toFixed(3)),
  };
}

// ── D. Identidad táctica ──────────────────────────────────────────────────────

/**
 * Detecta la identidad táctica de un equipo a partir de sus métricas ofensivas.
 * Devuelve tags, fortalezas y debilidades.
 *
 * @param {object|null} metrics - output de computeTeamMetrics
 * @returns {{ tags: string[], strengths: string[], weaknesses: string[] }}
 */
export function buildTeamIdentity(metrics) {
  if (!metrics) return { tags: [], strengths: [], weaknesses: [] };

  const {
    fieldTilt               = 0,
    areaPct                 = 0,
    dangerScore             = 0,
    conversionPct           = 0,
    totalPlays              = 0,
    sterileSPI              = 0,
    netProgression          = 0,
    stalledSequencesRatio   = 0,
    dangerousPlaysRatio     = 0,
    avgTouchesPerSequence   = 4,
    goals                   = 0,
  } = metrics;

  const tags      = [];
  const strengths = [];
  const weaknesses = [];

  // SUSTAINED PRESSURE: dominio + área + peligro real
  if (fieldTilt >= 0.50 && areaPct >= 0.25 && dangerScore >= 3.0) {
    tags.push('sustained_pressure');
    strengths.push('Presión sostenida real con llegada al área');
  }

  // FAKE DOMINANCE: fieldTilt alto + área baja + peligro bajo
  if (fieldTilt >= 0.50 && areaPct < 0.20 && dangerScore < 2.5) {
    tags.push('fake_dominance');
    weaknesses.push('Dominio territorial sin conversión a peligro real');
  }

  // STERILE POSSESSION: posesión larga sin peligro
  if (sterileSPI >= 0.30 || (totalPlays > 15 && conversionPct < 0.15 && dangerScore < 2.0)) {
    tags.push('sterile_possession');
    weaknesses.push('Posesión sin peligro — muchas jugadas sin efecto');
  }

  // TRANSITION THREAT: pocas jugadas, alto peligro, alta conversión
  if (avgTouchesPerSequence <= 3.5 && dangerScore >= 3.0 && conversionPct >= 0.25) {
    tags.push('transition_threat');
    strengths.push('Amenaza real en transición con alta conversión');
  }

  // REACTIVE TEAM: poco territorio, poco área
  if (fieldTilt < 0.30 && areaPct < 0.15) {
    tags.push('reactive_team');
  }

  // LOW BLOCK: muy poco territorio + jugadas muy atascadas
  if (fieldTilt < 0.25 && stalledSequencesRatio > 0.40) {
    tags.push('low_block');
    strengths.push('Bloque bajo ordenado — difícil de penetrar');
  }

  // HIGH BLOCK: mucho territorio + alto ratio de peligro
  if (fieldTilt >= 0.55 && dangerousPlaysRatio >= 0.40) {
    tags.push('high_block');
    strengths.push('Presión alta efectiva — recupera en campo rival');
  }

  // DIRECT TEAM: pocas tomas, buena progresión
  if (avgTouchesPerSequence <= 3.0 && netProgression > 0.10) {
    tags.push('direct_team');
    strengths.push('Juego directo y vertical — progresión rápida');
  }

  // POSITIONAL TEAM: muchas tomas, buena progresión, dominio
  if (avgTouchesPerSequence >= 5 && netProgression > 0.15 && fieldTilt >= 0.45) {
    tags.push('positional_team');
    strengths.push('Juego posicional con progresión controlada');
  }

  // CHAOTIC TEAM: muchas jugadas sin dirección
  if (stalledSequencesRatio > 0.45 && conversionPct < 0.15 && totalPlays > 10) {
    tags.push('chaotic_team');
    weaknesses.push('Juego caótico — muchas jugadas sin dirección clara');
  }

  // DELAYED COLLAPSE: posesión estéril con acumulación de área
  if (sterileSPI >= 0.30 && areaPct >= 0.25) {
    tags.push('delayed_collapse');
    weaknesses.push('Acumulación sin conversión — riesgo de colapso tardío');
  }

  // LATE EXPLOSION: alta efectividad con pocos intentos
  if (goals > 0 && conversionPct >= 0.40 && totalPlays < 20) {
    tags.push('late_explosion');
    strengths.push('Alta efectividad con pocos intentos — peligroso en 2T');
  }

  // STABLE FIRST HALF: presión sostenida con buena progresión
  if (tags.includes('sustained_pressure') && netProgression >= 0.15) {
    tags.push('stable_first_half');
  }

  return { tags, strengths, weaknesses };
}

// ── E. Dinámica del enfrentamiento ────────────────────────────────────────────

/**
 * Analiza la relación entre los dos equipos para detectar quién propone,
 * quién reacciona y el tipo de partido.
 *
 * @param {object|null} homeMetrics - output de computeTeamMetrics para local
 * @param {object|null} awayMetrics - output de computeTeamMetrics para visitante
 * @returns {object|null} dinámica del enfrentamiento
 */
export function buildMatchupDynamics(homeMetrics, awayMetrics) {
  if (!homeMetrics && !awayMetrics) return null;

  const h = homeMetrics || {};
  const a = awayMetrics || {};

  const flags = [];
  let type    = 'balanced';

  // ── Quién propone
  const homeTilt = h.fieldTilt || 0;
  const awayTilt = a.fieldTilt || 0;
  const proposes = homeTilt >= awayTilt ? 'home' : 'away';
  const reacts   = proposes === 'home'  ? 'away' : 'home';

  const tiltDiff   = Math.abs(homeTilt - awayTilt);
  const dangerDiff = Math.abs((h.dangerScore || 0) - (a.dangerScore || 0));

  // Desequilibrio territorial
  if (tiltDiff >= 0.25) {
    flags.push('TERRITORIAL_IMBALANCE');
  }

  // Control con riesgo de contraataque
  if (homeTilt > 0.60 && (a.dangerScore || 0) > (h.dangerScore || 0)) {
    flags.push('HOME_CONTROL_WITH_COUNTER_RISK');
    type = 'deceptive';
  } else if (awayTilt > 0.60 && (h.dangerScore || 0) > (a.dangerScore || 0)) {
    flags.push('AWAY_CONTROL_WITH_COUNTER_RISK');
    type = 'deceptive';
  }

  // Partido de transición: ambos equipos directos y peligrosos
  const bothTransition = (h.avgTouchesPerSequence || 4) <= 3.5
    && (a.avgTouchesPerSequence || 4) <= 3.5
    && ((h.dangerScore || 0) >= 3.0 || (a.dangerScore || 0) >= 3.0);
  if (bothTransition) {
    flags.push('BOTH_TRANSITION_TEAMS');
    type = 'transition-heavy';
  }

  // Partido controlado: un equipo manda pero sin peligro real del otro
  if (
    Math.max(homeTilt, awayTilt) > 0.55
    && Math.min(h.dangerScore || 0, a.dangerScore || 0) < 2.5
    && !flags.includes('HOME_CONTROL_WITH_COUNTER_RISK')
    && !flags.includes('AWAY_CONTROL_WITH_COUNTER_RISK')
  ) {
    type = 'controlled';
    flags.push('DOMINANT_CONTROL_WITHOUT_DANGER');
  }

  // Partido caótico: ambos equipos desorganizados
  const homeChaotic = (h.stalledSequencesRatio || 0) > 0.35 || (h.sterileSPI || 0) > 0.35;
  const awayChaotic = (a.stalledSequencesRatio || 0) > 0.35 || (a.sterileSPI || 0) > 0.35;
  if (homeChaotic && awayChaotic && type === 'balanced') {
    type = 'chaotic';
    flags.push('BOTH_TEAMS_DISORGANIZED');
  }

  // Partido engañoso: dominio territorial vs peligro real del adversario
  if (type === 'balanced' && tiltDiff >= 0.20 && dangerDiff >= 1.5) {
    type = 'deceptive';
    flags.push('TERRITORY_DANGER_MISMATCH');
  }

  return { proposes, reacts, type, flags };
}

// ── F. buildMatchScout — orquestador principal ────────────────────────────────

/**
 * Construye el análisis completo del partido con separación total por equipo.
 *
 * Nunca mezcla jugadas entre equipos. Todas las métricas son relativas al equipo.
 * El perfil defensivo se calcula desde las jugadas del RIVAL.
 *
 * @param {object[]} homePlays - jugadas del equipo local (formato existente)
 * @param {object[]} awayPlays - jugadas del equipo visitante (formato existente)
 * @returns {object} output completo del partido
 */
export function buildMatchScout(homePlays, awayPlays) {
  const enrichedHome = (homePlays || []).map(p => enrichPlay(p, 'home'));
  const enrichedAway = (awayPlays || []).map(p => enrichPlay(p, 'away'));

  const homeMetrics  = computeTeamMetrics(enrichedHome);
  const awayMetrics  = computeTeamMetrics(enrichedAway);
  const homeDefense  = computeDefensiveMetrics(enrichedAway);
  const awayDefense  = computeDefensiveMetrics(enrichedHome);
  const homeIdentity = buildTeamIdentity(homeMetrics);
  const awayIdentity = buildTeamIdentity(awayMetrics);
  const matchup      = buildMatchupDynamics(homeMetrics, awayMetrics);

  return {
    home: {
      metrics:   homeMetrics,
      defense:   homeDefense,
      identity:  homeIdentity.tags,
      strengths: homeIdentity.strengths,
      weaknesses: homeIdentity.weaknesses,
    },
    away: {
      metrics:   awayMetrics,
      defense:   awayDefense,
      identity:  awayIdentity.tags,
      strengths: awayIdentity.strengths,
      weaknesses: awayIdentity.weaknesses,
    },
    matchup,
  };
}
