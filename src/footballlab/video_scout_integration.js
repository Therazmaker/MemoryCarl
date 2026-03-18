/**
 * VIDEO SCOUT INTEGRATION
 * Capa de análisis táctica que enriquece el Radar del Día con datos de Video Scout.
 *
 * Estas funciones son puras: no acceden a localStorage ni al DOM directamente.
 * Reciben los perfiles computados por vsComputeProfile() y los datos del radar,
 * y devuelven objetos con perfiles tácticos, flags, insights y ajustes de confianza.
 *
 * Reglas de diseño:
 * - El scout modula confianza, no la domina.
 * - Degradación elegante: si no hay scout, devuelve null sin romper el flujo.
 * - Lenguaje táctico preciso (reactivo, estéril, acumulador de área, colapso tardío, etc.).
 * - Evitar sobrepeso por muestra pequeña (ver computeVideoScoutReliability).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ── A. buildVideoScoutProfile ─────────────────────────────────────────────────

/**
 * Convierte el perfil computado por vsComputeProfile() en un perfil táctico legible
 * por el Radar del Día.
 *
 * @param {object|null} vsProfile - output de vsComputeProfile()
 * @returns {object|null} VideoScoutProfile con dominance, threat, tags, etc.
 */
export function buildVideoScoutProfile(vsProfile) {
  if (!vsProfile || !vsProfile.totalPlays) return null;

  const {
    fieldTiltPct   = 0,
    pressureZonePct = 0,
    avgDanger      = 0,
    sterileRate    = 0,
    conversionRate = 0,
    avgProgress    = 0,
    avgBackpasses  = 0,
    avgTouches     = 4,
    preferredSide  = 'center',
    totalPlays     = 0,
    sessions       = 1,
    directPlays    = 0,
  } = vsProfile;

  // ── A. Dominio territorial (low / medium / high)
  const dominanceScore = (fieldTiltPct * 0.6) + (pressureZonePct * 0.4);
  const dominance = dominanceScore >= 0.50 ? 'high'
    : dominanceScore >= 0.28 ? 'medium'
    : 'low';

  // ── B. Calidad de amenaza (low / medium / high)
  const threatScore = (avgDanger / 5 * 0.4) + (pressureZonePct * 0.3) + (conversionRate * 0.3);
  const threat = threatScore >= 0.42 ? 'high'
    : threatScore >= 0.22 ? 'medium'
    : 'low';

  // ── C. Riesgo de esterilidad (low / medium / high)
  // Dominio alto + área baja + conversión baja = estéril
  const sterilityFromFakeDom = (fieldTiltPct > 0.45 && pressureZonePct < 0.22 && conversionRate < 0.32) ? 0.35 : 0;
  const sterilityScore = (sterileRate * 0.50) + sterilityFromFakeDom + (conversionRate < 0.15 ? 0.15 : 0);
  const sterilityRisk = sterilityScore >= 0.40 ? 'high'
    : sterilityScore >= 0.20 ? 'medium'
    : 'low';

  // ── D. Progresión real (weak / neutral / strong)
  const progression = avgProgress >= 0.15 ? 'strong'
    : avgProgress >= 0.00 ? 'neutral'
    : 'weak';

  // ── E. Tendencia a atascarse (low / medium / high)
  const stuckBackpass = avgBackpasses >= 3 ? 0.50 : avgBackpasses >= 2 ? 0.30 : 0;
  const stuckProgress = avgProgress < 0 ? 0.50 : avgProgress < 0.05 ? 0.25 : 0;
  const stuckScore = stuckBackpass + stuckProgress;
  const stuckTendency = stuckScore >= 0.70 ? 'high'
    : stuckScore >= 0.40 ? 'medium'
    : 'low';

  // ── F. Tags tácticos
  const tags = [];

  // Presión sostenida real
  if (fieldTiltPct >= 0.50 && pressureZonePct >= 0.28 && avgDanger >= 3.0) {
    tags.push('sustained_pressure');
  }
  // Dominio falso (fieldTilt alto, área baja, conversión baja)
  if (fieldTiltPct >= 0.50 && pressureZonePct < 0.22 && conversionRate < 0.30) {
    tags.push('fake_dominance');
  }
  // Posesión estéril
  if (sterileRate >= 0.33) {
    tags.push('sterile_possession');
  }
  // Amenaza de transición: pocas jugadas pero efectivas y directas
  if (avgTouches <= 3.5 && avgDanger >= 2.8 && conversionRate >= 0.28) {
    tags.push('transition_threat');
  }
  // Acumulador de área
  if (pressureZonePct >= 0.28 && conversionRate >= 0.15 && conversionRate < 0.45) {
    tags.push('area_accumulator');
  }
  // Bajo volumen, alta conversión
  if (totalPlays < 20 && conversionRate >= 0.40) {
    tags.push('low_volume_high_conversion');
  }
  // Control falso (posesión media, poco peligro)
  if (fieldTiltPct >= 0.38 && avgDanger < 2.5 && sterileRate < 0.30 && conversionRate < 0.25) {
    tags.push('false_control_team');
  }
  // Equipo reactivo
  if (fieldTiltPct < 0.30 && pressureZonePct < 0.16) {
    tags.push('reactive_team');
  }
  // Equipo directo (pocas toques, progresión rápida)
  if (avgTouches <= 3.0 && avgProgress > 0.10) {
    tags.push('direct_team');
  }
  // Sesgo de flanco
  if (preferredSide === 'left')   tags.push('flank_biased_left');
  if (preferredSide === 'right')  tags.push('flank_biased_right');
  if (preferredSide === 'center' && fieldTiltPct >= 0.40) tags.push('central_access_team');

  // ── G. Riesgo temporal
  let temporalRisk = 'unknown';

  // Posesión estéril con acumulación → colapso tardío
  if (tags.includes('sterile_possession') && tags.includes('area_accumulator')) {
    temporalRisk = 'collapse_2H';
  } else if (tags.includes('fake_dominance') && stuckTendency === 'high') {
    temporalRisk = 'stable_then_collapse';
  } else if (tags.includes('transition_threat') && tags.includes('reactive_team')) {
    // Reactivo con transición → más fuerte en 2T si el rival abre
    temporalRisk = 'stronger_2H';
  } else if (tags.includes('sustained_pressure') && avgProgress >= 0.15) {
    temporalRisk = 'stable_1H';
  } else if (conversionRate >= 0.40 && totalPlays < 16) {
    // Pocos juegos pero muy efectivos → riesgo tardío (puede explotar en cualquier momento)
    temporalRisk = 'late_risk';
  } else if (tags.includes('direct_team') && !tags.includes('sustained_pressure')) {
    temporalRisk = 'early_risk';
  }

  return {
    dominance,
    threat,
    sterilityRisk,
    progression,
    stuckTendency,
    tags,
    temporalRisk,
    dominantFlank: preferredSide === 'left' ? 'IZQ' : preferredSide === 'right' ? 'DER' : 'CTR',
    // Scores internos (útiles para debugging)
    _scores: {
      dominanceScore: Number(dominanceScore.toFixed(3)),
      threatScore:    Number(threatScore.toFixed(3)),
      sterilityScore: Number(sterilityScore.toFixed(3)),
      stuckScore:     Number(stuckScore.toFixed(3)),
    },
  };
}

// ── B. computeVideoScoutReliability ──────────────────────────────────────────

/**
 * Calcula la confiabilidad del video scout de un equipo (0..1).
 * Escala:
 *   0.20–0.39 = baja
 *   0.40–0.64 = media
 *   0.65+     = alta
 *
 * @param {Array} records - array de sesiones scout crudas (output de vsGetTeamRecords)
 * @returns {number} reliability 0..1
 */
export function computeVideoScoutReliability(records) {
  if (!Array.isArray(records) || records.length === 0) return 0;

  const allPlays = records.flatMap(r => Array.isArray(r.plays) ? r.plays : []);
  const n = allPlays.length;
  const sessions = records.length;

  if (n === 0) return 0;

  // Base: número de jugadas registradas
  let base;
  if (n >= 30)      base = 0.65;
  else if (n >= 20) base = 0.58;
  else if (n >= 10) base = 0.48;
  else if (n >= 5)  base = 0.36;
  else              base = 0.22;

  // Bonus por múltiples sesiones/partidos
  let sessionsBonus = 0;
  if (sessions >= 3)      sessionsBonus = 0.08;
  else if (sessions >= 2) sessionsBonus = 0.04;

  // Coherencia interna: fieldTilt debería ser >= areaPct (si están registrados)
  // Si hay juegos de tipo shot_sequence o through_run (alta calidad de muestra)
  const hasHighQualityPlays = allPlays.some(p =>
    p.type === 'shot_sequence' || p.type === 'through_run' || p.type === 'counter'
  );
  const coherenceBonus = hasHighQualityPlays ? 0.04 : 0;

  return clamp(base + sessionsBonus + coherenceBonus, 0, 0.95);
}

// ── C. compareRadarVsScout ────────────────────────────────────────────────────

/**
 * Cruza datos estructurales del radar con perfiles tácticos del scout.
 * Detecta incongruencias y genera flags + insights.
 *
 * @param {object} radarCtx - contexto del partido del radar (strengthGap, type, etc.)
 * @param {object|null} homeScoutProfile - VideoScoutProfile del local
 * @param {object|null} awayScoutProfile - VideoScoutProfile del visitante
 * @returns {{ flags: string[], insights: string[] }}
 */
export function compareRadarVsScout(radarCtx, homeScoutProfile, awayScoutProfile) {
  const flags   = [];
  const insights = [];

  if (!homeScoutProfile && !awayScoutProfile) return { flags, insights };

  const {
    strengthGap          = 0,
    mktFavIsHome         = true,
    favoritePressureIndex = null,
    htCleanSheetSignal   = null,
    type                 = 'tension',
    favoriteName         = 'Favorito',
    underdogName         = 'Underdog',
    home                 = 'Local',
    away                 = 'Visitante',
  } = radarCtx || {};

  const favScout      = mktFavIsHome ? homeScoutProfile : awayScoutProfile;
  const underdogScout = mktFavIsHome ? awayScoutProfile : homeScoutProfile;

  // ── A. FAVORITO ESTRUCTURAL SIN DOMINIO REAL
  const favHasFakeDom = favScout && (
    favScout.tags.includes('fake_dominance') ||
    favScout.tags.includes('sterile_possession')
  );
  const favLowThreat = favScout && (favScout.dominance === 'low' || favScout.threat === 'low');

  if (strengthGap >= 15 && favHasFakeDom) {
    flags.push('FAVORITE_FALSE_CONTROL');
    insights.push(`${favoriteName} tiene ventaja estructural pero el scout muestra dominio táctico estéril o aparente.`);
  }
  if ((strengthGap >= 10 || favoritePressureIndex?.level === 'BAJO') && (favHasFakeDom || favLowThreat)) {
    if (!flags.includes('FAVORITE_LOW_REAL_THREAT')) {
      flags.push('FAVORITE_LOW_REAL_THREAT');
      if (!favHasFakeDom) {
        insights.push(`${favoriteName} no genera peligro real según el scout pese a su superioridad en el tracker.`);
      }
    }
  }

  // ── B. UNDERDOG PELIGROSO EN TRANSICIÓN
  const underdogIsDangerous = underdogScout && (
    underdogScout.tags.includes('transition_threat') ||
    underdogScout.tags.includes('low_volume_high_conversion') ||
    underdogScout.threat === 'high'
  );
  if (underdogIsDangerous) {
    flags.push('UNDERDOG_TRANSITION_LIVE');
    insights.push(`${underdogName} muestra perfil reactivo pero con amenaza real de transición o alta conversión.`);
    if (
      underdogScout.tags.includes('low_volume_high_conversion') ||
      underdogScout.threat === 'high'
    ) {
      flags.push('UNDERDOG_MATCHUP_LIVE_RISK');
    }
  }

  // ── C. PARTIDO CLEAN EN RADAR, PERO SCOUT DICE CAOS
  const chaosTagsPresent = [homeScoutProfile, awayScoutProfile].some(p =>
    p && (
      p.tags.includes('transition_threat')    ||
      p.tags.includes('delayed_collapse')     ||
      p.tags.includes('stable_then_collapse') ||
      p.temporalRisk === 'collapse_2H'        ||
      p.temporalRisk === 'stable_then_collapse'
    )
  );
  if (type === 'clean' && chaosTagsPresent) {
    flags.push('CLEAN_TYPE_MAY_BE_DECEPTIVE');
    flags.push('LIVE_VOLATILITY_RISK');
    insights.push(`Tipo "clean" estructuralmente, pero el scout detecta riesgo de transición o colapso táctico.`);
  }

  // ── D. SEÑAL DE UNDER HT
  const htWeak = !htCleanSheetSignal || htCleanSheetSignal.level !== 'PROBABLE';
  const scoutSuggestsStable1H = [favScout, underdogScout].some(p =>
    p && (
      p.temporalRisk === 'stable_1H'    ||
      p.stuckTendency === 'high'        ||
      p.temporalRisk === 'stronger_1H'
    )
  );
  if (htWeak && scoutSuggestsStable1H) {
    flags.push('HT_UNDER_VALUE_CANDIDATE');
    insights.push(`El perfil scout apunta a un primer tiempo cerrado — valor potencial en Under 1.5 HT o HT Draw.`);
  }

  // ── E. RIESGO DE GOL TARDÍO
  const hasLateRisk = [homeScoutProfile, awayScoutProfile].some(p =>
    p && (
      p.temporalRisk === 'collapse_2H'        ||
      p.temporalRisk === 'late_risk'          ||
      p.temporalRisk === 'stable_then_collapse' ||
      p.tags.includes('area_accumulator')
    )
  );
  if (hasLateRisk) {
    flags.push('LATE_GOAL_RISK');
    flags.push('SECOND_HALF_OPENING_PATTERN');
    insights.push(`Uno o ambos equipos tienen perfil de riesgo tardío — considerar goles en 2T o Over FT.`);
  }

  // ── F. DOMINIO SIN MORDIENTE (falso dominio con acumulación)
  [
    { scout: homeScoutProfile, name: home },
    { scout: awayScoutProfile, name: away },
  ].forEach(({ scout, name }) => {
    if (
      scout &&
      scout.dominance !== 'low' &&
      scout.threat === 'low'    &&
      scout.sterilityRisk !== 'low'
    ) {
      if (!flags.includes('FAKE_STERILE_DOMINANCE')) {
        flags.push('FAKE_STERILE_DOMINANCE');
        flags.push('PRESSURE_ACCUMULATION_RISK');
        insights.push(`${name} acumula territorio sin convertirlo en peligro real. Su área puede materializarse tarde.`);
      }
    }
  });

  return { flags, insights };
}

// ── D. computeTacticalMismatchScore ──────────────────────────────────────────

/**
 * Calcula el tacticalMismatchScore (0-100):
 * cuánto difieren el radar estructural y el perfil scout.
 * Clasificación:
 *   0-24  = bajo
 *   25-49 = medio
 *   50-74 = alto
 *   75-100 = extremo
 *
 * @param {object} radarCtx
 * @param {object|null} homeScoutProfile
 * @param {object|null} awayScoutProfile
 * @returns {number} 0..100
 */
export function computeTacticalMismatchScore(radarCtx, homeScoutProfile, awayScoutProfile) {
  if (!homeScoutProfile && !awayScoutProfile) return 0;

  const {
    strengthGap          = 0,
    mktFavIsHome         = true,
    favoritePressureIndex = null,
    type                 = 'tension',
  } = radarCtx || {};

  const favScout      = mktFavIsHome ? homeScoutProfile : awayScoutProfile;
  const underdogScout = mktFavIsHome ? awayScoutProfile : homeScoutProfile;

  let score = 0;

  // Favorito con brecha grande pero scout flojo
  if (strengthGap >= 20 && favScout) {
    if (favScout.tags.includes('fake_dominance') || favScout.tags.includes('sterile_possession')) score += 25;
    if (favScout.threat === 'low')    score += 15;
    if (favScout.progression === 'weak') score += 10;
  } else if (strengthGap >= 12 && favScout) {
    if (favScout.tags.includes('fake_dominance')) score += 15;
    if (favScout.threat === 'low')    score += 8;
  }

  // Underdog con señales de peligro real (el radar no lo refleja)
  if (underdogScout) {
    if (underdogScout.tags.includes('transition_threat'))         score += 18;
    if (underdogScout.tags.includes('low_volume_high_conversion')) score += 15;
    if (underdogScout.threat === 'high')                           score += 12;
  }

  // Partido clean con señales tácticas de caos
  if (type === 'clean') {
    const hasTransition = [homeScoutProfile, awayScoutProfile].some(p =>
      p && p.tags.includes('transition_threat')
    );
    const hasCollapse = [homeScoutProfile, awayScoutProfile].some(p =>
      p && (p.temporalRisk === 'collapse_2H' || p.tags.includes('stable_then_collapse'))
    );
    if (hasTransition) score += 20;
    if (hasCollapse)   score += 15;
  }

  // FavoritePressureIndex bajo + scout confirma debilidad
  if (favoritePressureIndex?.level === 'BAJO' && favScout?.tags.includes('fake_dominance')) {
    score += 15;
  }

  // Solo un scout disponible → penalizar confianza del score
  const bothAvailable = !!(homeScoutProfile && awayScoutProfile);
  if (!bothAvailable) score = Math.round(score * 0.70);

  return Math.min(100, Math.round(score));
}

// ── E. adjustRadarPredictionsWithScout ───────────────────────────────────────

/**
 * Ajusta las predicciones del radar basándose en la capa scout.
 * No reemplaza el análisis estructural: lo modula.
 *
 * @param {object} radarCtx - contexto del radar (mktFavIsHome, type, etc.)
 * @param {object|null} vsComparison - output de compareRadarVsScout
 * @param {object|null} homeScoutProfile
 * @param {object|null} awayScoutProfile
 * @returns {object|null} ajustes tácticos
 */
export function adjustRadarPredictionsWithScout(radarCtx, vsComparison, homeScoutProfile, awayScoutProfile) {
  if (!homeScoutProfile && !awayScoutProfile) return null;
  if (!vsComparison) return null;

  const { flags = [], insights = [] } = vsComparison;
  const { mktFavIsHome = true } = radarCtx || {};

  const favScout      = mktFavIsHome ? homeScoutProfile : awayScoutProfile;
  const underdogScout = mktFavIsHome ? awayScoutProfile : homeScoutProfile;

  const adjustments = {
    scoutAdjustmentSummary: [],
    scoutConfidenceWeight:  1.0,
    tacticalValueNote:      null,
    drawSensitivityUp:      false,
    underHtCandidate:       false,
    overFtBoost:            false,
    lateGoalAlert:          false,
    bttsBoost:              false,
  };

  // A. Favorito con dominio estéril → bajar confianza en victoria directa
  if (flags.includes('FAVORITE_FALSE_CONTROL') || flags.includes('FAVORITE_LOW_REAL_THREAT')) {
    adjustments.scoutConfidenceWeight = Math.max(0.70, adjustments.scoutConfidenceWeight - 0.20);
    adjustments.drawSensitivityUp = true;
    adjustments.scoutAdjustmentSummary.push('Confianza reducida en victoria del favorito — dominio táctico estéril confirmado por scout.');
    adjustments.tacticalValueNote = 'Empate o marcador ajustado con más valor del que indica el mercado.';
  }

  // B. Underdog estable en 1T → under HT / over FT
  const underdogStable1H = underdogScout && (
    underdogScout.temporalRisk === 'stable_1H'    ||
    underdogScout.temporalRisk === 'stronger_1H'  ||
    underdogScout.stuckTendency === 'high'
  );
  if (underdogStable1H) {
    adjustments.underHtCandidate = true;
    adjustments.overFtBoost      = true;
    adjustments.scoutAdjustmentSummary.push('Primer tiempo cerrado esperado — valor en Under 1.5 HT y HT Draw.');
  }

  // C. Acumulador de área → no penalizar conversión baja, alertar gol tardío
  const hasAreaAccumulator = [homeScoutProfile, awayScoutProfile].some(p => p?.tags.includes('area_accumulator'));
  if (hasAreaAccumulator) {
    adjustments.lateGoalAlert = true;
    adjustments.scoutAdjustmentSummary.push('Acumulador de área detectado — gol tardío posible si el patrón se sostiene.');
  }

  // D. Ambos con transición → volatilidad alta
  const bothTransition = [homeScoutProfile, awayScoutProfile].every(p => p?.tags.includes('transition_threat'));
  if (bothTransition) {
    adjustments.bttsBoost = true;
    adjustments.scoutConfidenceWeight = Math.max(0.65, adjustments.scoutConfidenceWeight - 0.15);
    adjustments.scoutAdjustmentSummary.push('Ambos equipos con perfil de transición — elevar BTTS y Over 2.5, reducir confianza en victoria limpia.');
  }

  // E. Late goal risk
  if (flags.includes('LATE_GOAL_RISK') && !adjustments.lateGoalAlert) {
    adjustments.lateGoalAlert = true;
    adjustments.overFtBoost   = true;
    adjustments.scoutAdjustmentSummary.push('Riesgo de gol en 2T por perfil temporal — considerar Over 1.5 FT y gol en 2T.');
  }

  return adjustments;
}

// ── F. buildHalfProfileFromScout ─────────────────────────────────────────────

/**
 * Construye el perfil temporal (1T vs 2T) a partir de los scouts disponibles.
 *
 * @param {object|null} homeScoutProfile
 * @param {object|null} awayScoutProfile
 * @returns {object|null} halfProfile con firstHalf/secondHalf
 */
export function buildHalfProfileFromScout(homeScoutProfile, awayScoutProfile) {
  const profiles = [homeScoutProfile, awayScoutProfile].filter(Boolean);
  if (!profiles.length) return null;

  let firstHalfStability  = 'medium';
  let firstHalfGoalRisk   = 'medium';
  let secondHalfStability = 'medium';
  let secondHalfGoalRisk  = 'medium';

  const hasCombined = (check) => profiles.some(p => check(p));

  // Colapso tardío o estable-luego-colapso → 1T cerrado, 2T volátil
  if (
    hasCombined(p => p.temporalRisk === 'collapse_2H') ||
    hasCombined(p => p.temporalRisk === 'stable_then_collapse') ||
    hasCombined(p => p.tags.includes('stable_then_collapse'))
  ) {
    firstHalfStability  = 'high';
    firstHalfGoalRisk   = 'low';
    secondHalfStability = 'low';
    secondHalfGoalRisk  = 'high';
  }

  // Riesgo tardío (late_risk) → 1T bajo riesgo, 2T explosivo
  if (hasCombined(p => p.temporalRisk === 'late_risk')) {
    firstHalfGoalRisk  = firstHalfGoalRisk === 'high' ? 'medium' : 'low';
    secondHalfGoalRisk = 'high';
  }

  // 1T estable (stable_1H) → primer tiempo cerrado
  if (hasCombined(p => p.temporalRisk === 'stable_1H')) {
    firstHalfStability = 'high';
    firstHalfGoalRisk  = 'low';
  }

  // Riesgo temprano (early_risk / direct team) → 1T abierto
  if (hasCombined(p => p.temporalRisk === 'early_risk')) {
    firstHalfGoalRisk  = 'high';
    firstHalfStability = 'low';
  }

  // Transición sin presión sostenida → mediano en 1T, medio-alto en 2T
  const hasTransition    = hasCombined(p => p.tags.includes('transition_threat'));
  const hasSustainedPres = hasCombined(p => p.tags.includes('sustained_pressure'));
  if (hasTransition && !hasSustainedPres) {
    if (secondHalfGoalRisk !== 'high') secondHalfGoalRisk = 'medium';
  }

  // Más fuerte en 2T (stronger_2H)
  if (hasCombined(p => p.temporalRisk === 'stronger_2H')) {
    secondHalfGoalRisk  = 'high';
    secondHalfStability = 'low';
  }

  return {
    firstHalf: {
      stability: firstHalfStability,
      goalRisk:  firstHalfGoalRisk,
    },
    secondHalf: {
      stability: secondHalfStability,
      goalRisk:  secondHalfGoalRisk,
    },
  };
}

// ── G. buildVideoScoutLayer ───────────────────────────────────────────────────

/**
 * Función de orquestación: construye la capa completa de Video Scout para un partido.
 * Llama a todos los componentes y los agrega en un único objeto.
 *
 * @param {object} params
 * @param {Array}  params.vsRecordsHome  - sesiones scout crudas del equipo local
 * @param {Array}  params.vsRecordsAway  - sesiones scout crudas del equipo visitante
 * @param {object} params.scoutHome      - output de vsComputeProfile(vsRecordsHome)
 * @param {object} params.scoutAway      - output de vsComputeProfile(vsRecordsAway)
 * @param {object} params.radarCtx       - contexto radar (strengthGap, type, etc.)
 * @returns {object} videoScout layer completo
 */
export function buildVideoScoutLayer({ vsRecordsHome, vsRecordsAway, scoutHome, scoutAway, radarCtx }) {
  const vsProfileHome = buildVideoScoutProfile(scoutHome);
  const vsProfileAway = buildVideoScoutProfile(scoutAway);

  const hasHome = !!vsProfileHome;
  const hasAway = !!vsProfileAway;

  if (!hasHome && !hasAway) {
    return { available: false, coverage: { home: false, away: false } };
  }

  const vsReliabilityHome = computeVideoScoutReliability(vsRecordsHome || []);
  const vsReliabilityAway = computeVideoScoutReliability(vsRecordsAway || []);
  const bothAvail         = hasHome && hasAway;
  const reliabilityCombined = bothAvail
    ? (vsReliabilityHome + vsReliabilityAway) / 2
    : hasHome ? vsReliabilityHome : vsReliabilityAway;

  const vsComparison        = compareRadarVsScout(radarCtx, vsProfileHome, vsProfileAway);
  const tacticalMismatchScore = computeTacticalMismatchScore(radarCtx, vsProfileHome, vsProfileAway);
  const halfProfile         = buildHalfProfileFromScout(vsProfileHome, vsProfileAway);
  const adjustments         = adjustRadarPredictionsWithScout(radarCtx, vsComparison, vsProfileHome, vsProfileAway);

  const mismatchLabel = tacticalMismatchScore >= 75 ? 'extremo'
    : tacticalMismatchScore >= 50 ? 'alto'
    : tacticalMismatchScore >= 25 ? 'medio'
    : 'bajo';

  return {
    available: true,
    coverage: { home: hasHome, away: hasAway },
    reliability: {
      home:     Number(vsReliabilityHome.toFixed(2)),
      away:     Number(vsReliabilityAway.toFixed(2)),
      combined: Number(reliabilityCombined.toFixed(2)),
    },
    profiles: {
      home: vsProfileHome,
      away: vsProfileAway,
    },
    insights:             vsComparison?.insights || [],
    flags:                vsComparison?.flags    || [],
    tacticalMismatchScore,
    mismatchLabel,
    halfProfile,
    adjustments,
  };
}
