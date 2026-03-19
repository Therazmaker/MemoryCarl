/**
 * MATCH INTELLIGENCE ENGINE
 * Motor de decisión unificado para el Radar del Día de FutbolLab.
 *
 * Transforma las señales individuales del partido en una síntesis unificada
 * con tesis central, conflictos, alineaciones, ángulos de apuesta,
 * advertencias de trampa y arquitectura de confianza.
 *
 * Reglas de diseño:
 * - Pure functions: no acceden a DOM ni localStorage.
 * - Degradación elegante: si faltan capas, modula pesos sin romper.
 * - Salida siempre coherente con la tesis central.
 * - No "mostrar datos" — RESOLVER el partido con una tesis.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Neutral confidence returned when a layer's data is unavailable
const NEUTRAL_CONFIDENCE = 0.4;

// ── Thesis taxonomy ──────────────────────────────────────────────────────────

/**
 * Catálogo de tesis centrales del partido.
 * Cada tesis es un código + etiqueta + descripción táctica.
 */
export const MATCH_THESIS = {
  strong_favorite_real:          { label: 'Favorito real',              description: 'El favorito domina en fuerza, presión y forma. El resultado lógico tiene respaldo sistémico.' },
  strong_favorite_false:         { label: 'Favorito en papel',          description: 'El favorito cotiza alto pero su presión real es baja. El mercado sobrevalora su nombre.' },
  underdog_live:                 { label: 'Underdog vivo',              description: 'El no-favorito llega con defensa sólida o FSI positivo. El resultado sorpresa tiene base real.' },
  draw_trap:                     { label: 'Trampa de empate',           description: 'Las fuerzas están equilibradas y las señales apuntan al empate. Apostar 1 o 2 puede ser la trampa.' },
  clean_match_deceptive:         { label: 'Partido limpio engañoso',    description: 'Parece partido tranquilo pero las señales esconden tensión real.' },
  chaotic_match_hidden:          { label: 'Partido caótico oculto',     description: 'El caos sistémico es alto. Las señales contradictorias sugieren resultado impredecible.' },
  first_half_closed_second_half_open: { label: '1T cerrado, 2T abierto', description: 'El primer tiempo apunta a ser táctico y cerrado; el segundo se abre con más riesgo de goles.' },
  fake_dominance_home:           { label: 'Dominio falso del local',    description: 'El local domina en territorio pero no convierte. Su presión es estéril.' },
  market_overpricing_favorite:   { label: 'Mercado sobreprecio al favorito', description: 'Las cuotas no reflejan la realidad defensiva o la presión real del favorito.' },
  tension_match_with_upset_risk: { label: 'Partido de tensión con riesgo de sorpresa', description: 'El partido es equilibrado con señales de sorpresa activas.' },
};

// ── Trap warning taxonomy ─────────────────────────────────────────────────────

export const TRAP_TYPES = {
  favorite_name_trap:          'El mercado cotiza al favorito por nombre/posición, no por datos reales recientes.',
  fake_dominance_trap:         'El equipo dominante no convierte: alto dominio, baja amenaza real.',
  high_fsi_ignored:            'El FSI del no-favorito es positivo pero las cuotas lo ignoran.',
  overreaction_to_recent_win:  'Una victoria reciente infla la percepción sin respaldo sistémico.',
  clean_match_deceptive:       'El partido parece limpio pero las señales temporales esconden tensión.',
  sterile_pressure_misread:    'Alta presión territorial leída como dominancia real cuando es estéril.',
  underdog_hidden_live:        'El underdog tiene transición real que el mercado no precio.',
  first_half_under_valued:     'El under de 1T tiene valor por perfil cerrado pero no se refleja en cuotas.',
  second_half_break_pattern:   'El patrón de 2T abierto no está valorado: el over tiene lógica temporal.',
};

// ── A. computeSignalWeights ───────────────────────────────────────────────────

/**
 * Calcula los pesos dinámicos de cada capa de señales según
 * la cobertura y calidad de los datos disponibles.
 *
 * @param {object} matchContext
 * @param {boolean} matchContext.hasScoutHome       - scout disponible para local
 * @param {boolean} matchContext.hasScoutAway       - scout disponible para visitante
 * @param {boolean} matchContext.hasOdds            - cuotas disponibles
 * @param {boolean} matchContext.hasFormData        - datos de forma disponibles
 * @param {boolean} matchContext.hasHalfProfile     - perfil de medio tiempo disponible
 * @param {boolean} matchContext.extremeFsi         - FSI extremo (alguno > 30)
 * @param {boolean} matchContext.oddsMismatch       - odds en conflicto con presión real
 * @param {boolean} matchContext.consistentHalfProfile - perfil temporal consistente
 * @returns {{ structuralWeight, correctiveWeight, scoutWeight, temporalWeight, marketWeight }}
 */
export function computeSignalWeights(matchContext = {}) {
  const {
    hasScoutHome         = false,
    hasScoutAway         = false,
    hasOdds              = false,
    hasFormData          = false,
    hasHalfProfile       = false,
    extremeFsi           = false,
    oddsMismatch         = false,
    consistentHalfProfile = false,
  } = matchContext;

  const bothScout  = hasScoutHome && hasScoutAway;
  const oneScout   = (hasScoutHome || hasScoutAway) && !bothScout;
  const noScout    = !hasScoutHome && !hasScoutAway;

  // Base weights
  let structural  = 0.40;
  let corrective  = 0.20;
  let scoutWeight = 0.20;
  let temporal    = 0.10;
  let market      = 0.10;

  // Adjust for scout coverage
  if (noScout) {
    // Redistribute scout weight to structural + corrective
    structural  += 0.10;
    corrective  += 0.05;
    scoutWeight  = 0.05;
  } else if (oneScout) {
    // Partial scout — smaller modulator
    scoutWeight = 0.12;
    structural += 0.05;
    corrective += 0.03;
  } else if (bothScout) {
    // Full scout — upweight tactical
    scoutWeight = 0.22;
    structural -= 0.02;
  }

  // FSI correction: if extreme, boost corrective layer
  if (extremeFsi) {
    corrective += 0.05;
    structural -= 0.05;
  }

  // Market mismatch: boost market weight when odds conflict with real pressure
  if (oddsMismatch && hasOdds) {
    market     += 0.05;
    structural -= 0.03;
    corrective -= 0.02;
  }

  // Temporal: boost if half profile is consistent
  if (consistentHalfProfile && hasHalfProfile) {
    temporal   += 0.05;
    structural -= 0.05;
  }

  // No form data: degrade structural slightly; scout minimum is 0.03
  if (!hasFormData) {
    structural  -= 0.05;
    corrective  -= 0.03;
    scoutWeight  = Math.max(0.03, scoutWeight - 0.02);
  }

  // Normalise to sum to 1
  const total = structural + corrective + scoutWeight + temporal + market;
  return {
    structuralWeight: Number((structural  / total).toFixed(3)),
    correctiveWeight: Number((corrective  / total).toFixed(3)),
    scoutWeight:      Number((scoutWeight / total).toFixed(3)),
    temporalWeight:   Number((temporal    / total).toFixed(3)),
    marketWeight:     Number((market      / total).toFixed(3)),
  };
}

// ── B. buildSignalConflicts ───────────────────────────────────────────────────

/**
 * Detecta conflictos entre señales del partido.
 * Devuelve array de objetos { code, message, severity }.
 *
 * @param {object} matchData - objeto completo del partido del Radar
 * @returns {Array<{ code, message, severity }>}
 */
export function buildSignalConflicts(matchData = {}) {
  const conflicts = [];

  const {
    favoritePressureIndex:  fpi    = null,
    underdogDefenseIndex:   udi    = null,
    drawIndex:              di     = null,
    htCleanSheetSignal:     htcs   = null,
    videoScout:             vs     = null,
    odds                           = {},
    strengthGap                    = 0,
    fsiHome                        = 0,
    fsiAway                        = 0,
    formHome                       = null,
    formAway                       = null,
    mktFavIsHome                   = true,
    favoriteName                   = 'Favorito',
    underdogName                   = 'Underdog',
    marketDefense:          md     = null,
    type                           = 'tension',
  } = matchData;

  const strongerFsi  = mktFavIsHome ? fsiHome : fsiAway;
  const weakerFsi    = mktFavIsHome ? fsiAway : fsiHome;
  const hasOdds      = [odds?.home, odds?.draw, odds?.away].some(o => Number.isFinite(Number(o)));

  // 1. Alta fuerza del favorito + baja presión real
  if (strengthGap >= 20 && fpi && fpi.level === 'BAJO') {
    conflicts.push({
      code:     'high_strength_low_pressure',
      message:  `${favoriteName} tiene ventaja histórica de fuerza pero su presión real de partido es baja (FPI: ${fpi.score}/100). El dato estructural puede no reflejar el momento actual.`,
      severity: 'high',
    });
  }

  // 2. Mercado ve favorito fuerte pero presión real no acompaña
  if (hasOdds && md && md.ready) {
    const mktFavProb = Number(md.marketFavoriteProb) || 0;
    if (mktFavProb >= 60 && fpi && fpi.level === 'BAJO') {
      conflicts.push({
        code:     'market_high_pressure_low',
        message:  `El mercado da ${mktFavProb}% al ${favoriteName}, pero su presión real no lo respalda (FPI ${fpi.level}). El precio puede ser excesivo.`,
        severity: 'high',
      });
    }
  }

  // 3. Scout sugiere dominio falso pero fuerza o AI dice victoria limpia del local
  const scoutFav = vs?.available ? (mktFavIsHome ? vs.home : vs.away) : null;
  if (scoutFav && scoutFav.sterilityRisk === 'high' && strengthGap >= 15) {
    conflicts.push({
      code:     'scout_fake_dominance_vs_structural_strength',
      message:  `El scout sugiere que ${favoriteName} acumula sin penetrar (estéril). Su ventaja estructural puede ser engañosa si no convierte.`,
      severity: 'medium',
    });
  }

  // 4. CS de 1T probable + over 2.5 fuerte sin lógica de 2T
  if (htcs && htcs.level === 'PROBABLE' && di && di.score < 40) {
    conflicts.push({
      code:     'ht_clean_vs_over',
      message:  `La señal de portería a 0 en 1T es fuerte, pero hay indicadores de partido con goles. El over necesita lógica temporal: ¿quién los hace y cuándo?`,
      severity: 'medium',
    });
  }

  // 5. FSI del underdog muy alto y odds ignoran el riesgo de sorpresa
  if (weakerFsi >= 25 && hasOdds) {
    const awayOdd = Number(odds?.away);
    const homeOdd = Number(odds?.home);
    const underdogOdd = mktFavIsHome ? awayOdd : homeOdd;
    if (Number.isFinite(underdogOdd) && underdogOdd >= 3.5) {
      conflicts.push({
        code:     'high_fsi_underdog_ignored',
        message:  `${underdogName} llega con FSI muy positivo (+${weakerFsi.toFixed(1)}) pero las cuotas lo dan a ${underdogOdd.toFixed(2)}. El potencial de sorpresa no está priceado.`,
        severity: 'high',
      });
    }
  }

  // 6. Favorito FSI muy negativo vs odds que lo siguen favorito
  if (strongerFsi <= -20 && strengthGap >= 15) {
    conflicts.push({
      code:     'favorite_fsi_negative',
      message:  `${favoriteName} llega con FSI muy negativo (${strongerFsi.toFixed(1)}) pese a la ventaja histórica. La forma sistémica contradice el resultado esperado.`,
      severity: 'medium',
    });
  }

  // 7. Empate con señal alta pero odds del empate > 3.5 (mercado infravalora)
  if (di && di.level === 'ALTO' && hasOdds) {
    const drawOdd = Number(odds?.draw);
    if (Number.isFinite(drawOdd) && drawOdd >= 3.5) {
      conflicts.push({
        code:     'draw_signal_vs_market',
        message:  `Señal de empate alta (DI ${di.score}/100) pero las cuotas lo dan a ${drawOdd.toFixed(2)}. Puede haber valor en el empate.`,
        severity: 'medium',
      });
    }
  }

  // 8. Partido tipo tension + forma muy asimétrica entre los dos equipos
  if (type === 'tension' && formHome && formAway) {
    const ptsDiff = Math.abs((formHome.ptsPerGame || 0) - (formAway.ptsPerGame || 0));
    if (ptsDiff >= 1.2) {
      const betterTeam = (formHome.ptsPerGame || 0) >= (formAway.ptsPerGame || 0)
        ? matchData.home : matchData.away;
      conflicts.push({
        code:     'tension_type_form_asymmetry',
        message:  `El partido clasificado como "tensión" (fuerzas equilibradas) tiene una forma reciente muy asimétrica. ${betterTeam} llega con ventaja real de momento que el tipo no captura.`,
        severity: 'low',
      });
    }
  }

  return conflicts;
}

// ── C. buildSignalAlignment ───────────────────────────────────────────────────

/**
 * Detecta señales que se refuerzan entre sí.
 * Devuelve array de objetos { code, message, strength }.
 *
 * @param {object} matchData
 * @returns {Array<{ code, message, strength }>}
 */
export function buildSignalAlignment(matchData = {}) {
  const alignments = [];

  const {
    favoritePressureIndex:  fpi    = null,
    underdogDefenseIndex:   udi    = null,
    drawIndex:              di     = null,
    htCleanSheetSignal:     htcs   = null,
    videoScout:             vs     = null,
    strengthGap                    = 0,
    fsiHome                        = 0,
    fsiAway                        = 0,
    formHome                       = null,
    formAway                       = null,
    mktFavIsHome                   = true,
    favoriteName                   = 'Favorito',
    underdogName                   = 'Underdog',
    flags:                  flags  = [],
  } = matchData;

  const strongerFsi = mktFavIsHome ? fsiHome : fsiAway;
  const weakerFsi   = mktFavIsHome ? fsiAway : fsiHome;

  // 1. Favorito con presión real alta + underdog con defensa permeable + scout con dominancia real
  if (fpi && fpi.level === 'ALTO' && udi && udi.level === 'PERMEABLE') {
    alignments.push({
      code:    'favorite_pressure_underdog_weak_defense',
      message: `${favoriteName} tiene presión real alta (FPI ${fpi.score}/100) y ${underdogName} presenta defensa permeable (UDI ${udi.score}/100). Las señales apuntan a goles del favorito.`,
      strength: 'strong',
    });
  }

  // Scout confirms dominance
  const scoutFav = vs?.available ? (mktFavIsHome ? vs.home : vs.away) : null;
  if (fpi && fpi.level === 'ALTO' && scoutFav && scoutFav.dominance === 'high' && scoutFav.sterilityRisk !== 'high') {
    alignments.push({
      code:    'structural_and_scout_dominance',
      message: `Scout y datos estructurales confirman dominio real de ${favoriteName}. La presión no es estéril.`,
      strength: 'strong',
    });
  }

  // 2. Portería a 0 en 1T probable + perfil de 2T estable y bajo riesgo
  if (htcs && htcs.level === 'PROBABLE') {
    alignments.push({
      code:    'ht_clean_aligned',
      message: `Señal de portería a 0 en 1T consistente con defensas ajustadas. El under HT tiene respaldo real.`,
      strength: 'medium',
    });
  }

  // 3. Underdog con transición + favorito con progresión débil
  const scoutUnd = vs?.available ? (mktFavIsHome ? vs.away : vs.home) : null;
  if (scoutUnd && scoutUnd.threat === 'high' && fpi && fpi.level === 'BAJO') {
    alignments.push({
      code:    'underdog_transition_threat',
      message: `${underdogName} genera amenaza real en transición mientras ${favoriteName} muestra presión baja. El patrón de sorpresa está bien fundado.`,
      strength: 'strong',
    });
  }

  // 4. Favorito FSI positivo + fuerza superior + forma ascendente
  const favoriteForm = mktFavIsHome ? formHome : formAway;
  if (strongerFsi >= 18 && strengthGap >= 15 && favoriteForm?.trend === 'rising') {
    alignments.push({
      code:    'fsi_strength_form_alignment',
      message: `${favoriteName} alinea fuerza histórica, FSI positivo (+${strongerFsi.toFixed(1)}) y tendencia ascendente. El rol de favorito está validado en tres dimensiones.`,
      strength: 'strong',
    });
  }

  // 5. Empate con señales alineadas (DI alto + equilibrio de fuerzas + FSI neutro de ambos)
  if (di && di.level === 'ALTO' && strengthGap <= 10 && Math.abs(fsiHome) < 15 && Math.abs(fsiAway) < 15) {
    alignments.push({
      code:    'draw_signals_aligned',
      message: `Señal de empate alta con equilibrio de fuerzas y FSI neutro de ambos equipos. El empate tiene fundamento sistémico sólido.`,
      strength: 'strong',
    });
  }

  // 6. Flag de UPSET_RISK_HIGH con underdog FSI positivo
  if (flags.includes('UPSET_RISK_HIGH') && weakerFsi >= 10) {
    alignments.push({
      code:    'upset_risk_aligned',
      message: `Múltiples señales de sorpresa activas (UPSET_RISK_HIGH + FSI del underdog positivo). El mercado puede estar subestimando al ${underdogName}.`,
      strength: 'strong',
    });
  }

  return alignments;
}

// ── D. resolveMatchThesis ─────────────────────────────────────────────────────

/**
 * Determina la tesis central del partido basada en la jerarquía de señales.
 *
 * @param {object} matchData
 * @returns {{ thesis, thesisLabel, thesisDescription, oneLiner }}
 */
export function resolveMatchThesis(matchData = {}) {
  const {
    favoritePressureIndex:  fpi    = null,
    underdogDefenseIndex:   udi    = null,
    drawIndex:              di     = null,
    htCleanSheetSignal:     htcs   = null,
    videoScout:             vs     = null,
    marketDefense:          md     = null,
    strengthGap                    = 0,
    fsiHome                        = 0,
    fsiAway                        = 0,
    type                           = 'tension',
    flags:                  flags  = [],
    mktFavIsHome                   = true,
    favoriteName                   = 'Favorito',
    underdogName                   = 'Underdog',
    formHome                       = null,
    formAway                       = null,
  } = matchData;

  const strongerFsi = mktFavIsHome ? fsiHome : fsiAway;
  const weakerFsi   = mktFavIsHome ? fsiAway : fsiHome;
  const scoutFav    = vs?.available ? (mktFavIsHome ? vs.home : vs.away) : null;
  const scoutUnd    = vs?.available ? (mktFavIsHome ? vs.away : vs.home) : null;
  const hasOdds     = md && md.ready;

  let thesis = 'tension_match_with_upset_risk'; // fallback

  // ── Priority 1: Fake dominance (scout says sterile, structural says strong)
  if (scoutFav && scoutFav.sterilityRisk === 'high' && strengthGap >= 15) {
    thesis = 'fake_dominance_home';
  }
  // ── Priority 2: Market overpricing (high prob + low pressure)
  else if (hasOdds && md.riskLevel === 'HIGH' && fpi && fpi.level === 'BAJO') {
    thesis = 'market_overpricing_favorite';
  }
  // ── Priority 3: Underdog live (solid defense + threat + FSI positive)
  else if (
    weakerFsi >= 18 ||
    (udi && udi.level === 'SÓLIDA' && fpi && fpi.level !== 'ALTO') ||
    flags.includes('UPSET_RISK_HIGH')
  ) {
    thesis = 'underdog_live';
  }
  // ── Priority 4: Strong favorite — real (aligned: high pressure + gap + form)
  else if (
    fpi && fpi.level === 'ALTO' &&
    strengthGap >= 20 &&
    strongerFsi >= 5
  ) {
    thesis = 'strong_favorite_real';
  }
  // ── Priority 5: Strong favorite — false (gap exists but pressure is low)
  else if (strengthGap >= 20 && fpi && fpi.level === 'BAJO') {
    thesis = 'strong_favorite_false';
  }
  // ── Priority 6: Draw trap (balanced + high DI + FSI neutral)
  else if (di && di.level === 'ALTO' && strengthGap <= 12) {
    thesis = 'draw_trap';
  }
  // ── Priority 7: First half closed / second half open
  else if (htcs && htcs.level === 'PROBABLE' && type === 'tension') {
    thesis = 'first_half_closed_second_half_open';
  }
  // ── Priority 8: Chaotic match
  else if (type === 'chaos') {
    thesis = 'chaotic_match_hidden';
  }
  // ── Priority 9: Clean but deceptive (clean type + high DI or flags)
  else if (type === 'clean' && (di?.level === 'MEDIO' || flags.includes('HIGH_DRAW_SIGNAL'))) {
    thesis = 'clean_match_deceptive';
  }
  // ── Priority 10: Tension with upset risk (default for tension type)
  else if (type === 'tension' && (weakerFsi >= 10 || flags.includes('UNDERDOG_SOLID_DEFENSE'))) {
    thesis = 'tension_match_with_upset_risk';
  }
  // ── Fallback: strong favorite real if gap is high
  else if (strengthGap >= 25) {
    thesis = 'strong_favorite_real';
  }

  const thesisMeta = MATCH_THESIS[thesis] || MATCH_THESIS['tension_match_with_upset_risk'];

  // Build one-liner narrative from thesis + key data
  const oneLiner = _buildThesisOneLiner(thesis, { favoriteName, underdogName, strongerFsi, weakerFsi, strengthGap, fpi, udi, di, htcs });

  return {
    thesis,
    thesisLabel:       thesisMeta.label,
    thesisDescription: thesisMeta.description,
    oneLiner,
  };
}

function _buildThesisOneLiner(thesis, { favoriteName, underdogName, strongerFsi, weakerFsi, strengthGap, fpi, udi, di, htcs }) {
  switch (thesis) {
    case 'strong_favorite_real':
      return `${favoriteName} es el favorito real: fuerza, forma y presión se alinean. El resultado lógico tiene respaldo sistémico.`;
    case 'strong_favorite_false':
      return `${favoriteName} es favorito en papel pero no en datos. Su presión real no respalda el precio del mercado.`;
    case 'underdog_live':
      return `${underdogName} no es solo relleno: defensa sólida o momento sistémico positivo lo mantienen vivo en este partido.`;
    case 'draw_trap':
      return `Las señales apuntan al empate. Apostar solo a 1 o 2 puede ser la trampa: las fuerzas están equilibradas y el DI es alto.`;
    case 'clean_match_deceptive':
      return `El partido parece predecible, pero hay señales que esconden tensión real. No es tan limpio como parece.`;
    case 'chaotic_match_hidden':
      return `Las señales se contradicen: partido caótico de difícil predicción. La certeza es la incertidumbre misma.`;
    case 'first_half_closed_second_half_open':
      return `Primer tiempo cerrado y táctico; si el local acumula sin convertir, el segundo tiempo se abre. El valor está en el timing.`;
    case 'fake_dominance_home':
      return `${favoriteName} domina en territorio pero no en amenaza real. La presión es estéril: el resultado puede sorprender.`;
    case 'market_overpricing_favorite':
      return `El mercado sobrevalora a ${favoriteName}. Los datos de presión real y defensa del rival no justifican el precio.`;
    case 'tension_match_with_upset_risk':
    default:
      return `Partido de tensión con riesgo real de sorpresa. Las señales no son suficientes para descartar al ${underdogName}.`;
  }
}

// ── E. buildConfidenceArchitecture ───────────────────────────────────────────

/**
 * Construye la arquitectura de confianza: de dónde viene la confianza
 * del sistema y qué parte sostiene el pick.
 *
 * @param {object} matchData
 * @param {object} weights - output de computeSignalWeights
 * @returns {{ finalConfidence, confidenceArchitecture, confidenceNote }}
 */
export function buildConfidenceArchitecture(matchData = {}, weights = {}) {
  const {
    favoritePressureIndex:  fpi    = null,
    underdogDefenseIndex:   udi    = null,
    drawIndex:              di     = null,
    htCleanSheetSignal:     htcs   = null,
    videoScout:             vs     = null,
    marketDefense:          md     = null,
    strengthGap                    = 0,
    fsiHome                        = 0,
    fsiAway                        = 0,
    formHome                       = null,
    formAway                       = null,
    flags:                  flags  = [],
  } = matchData;

  // ── Structural confidence
  const structuralScore = _computeStructuralConfidence({ strengthGap, fsiHome, fsiAway, formHome, formAway, fpi, udi });

  // ── Tactical confidence (from scout)
  const tacticalScore = _computeTacticalConfidence(vs);

  // ── Temporal confidence (from HT signal + half profile consistency)
  const temporalScore = _computeTemporalConfidence(htcs, matchData);

  // ── Market mismatch confidence
  const marketScore = _computeMarketConfidence(md, flags);

  // Label helper
  const label = (v) => v >= 0.70 ? 'high' : v >= 0.45 ? 'medium' : 'low';

  const {
    structuralWeight = 0.40,
    correctiveWeight = 0.20,
    scoutWeight      = 0.20,
    temporalWeight   = 0.10,
    marketWeight     = 0.10,
  } = weights;

  // Weighted blend
  const finalConfidence = clamp(
    (structuralScore * structuralWeight) +
    (structuralScore * correctiveWeight * 0.5) +  // corrective modulates structural
    (tacticalScore   * scoutWeight)     +
    (temporalScore   * temporalWeight)  +
    (marketScore     * marketWeight),
    0,
    1
  );

  const confidenceArchitecture = {
    structural:    label(structuralScore),
    tactical:      tacticalScore >= 0 ? label(tacticalScore) : 'unavailable',
    temporal:      label(temporalScore),
    marketMismatch: label(marketScore),
  };

  // Confidence note: explain main driver and weakness
  const drivers = Object.entries(confidenceArchitecture)
    .filter(([, v]) => v === 'high')
    .map(([k]) => k);
  const weak = Object.entries(confidenceArchitecture)
    .filter(([, v]) => v === 'low')
    .map(([k]) => k);

  let confidenceNote = '';
  if (drivers.length >= 2) {
    confidenceNote = `Alta confianza sostenida por: ${drivers.join(' + ')}.`;
  } else if (drivers.length === 1) {
    confidenceNote = `Confianza moderada. Capa principal: ${drivers[0]}.`;
  } else {
    confidenceNote = `Confianza limitada. Las señales no son suficientemente consistentes.`;
  }
  if (weak.length > 0) {
    confidenceNote += ` Capa débil: ${weak.join(', ')}.`;
  }

  return {
    finalConfidence: Number(finalConfidence.toFixed(2)),
    confidenceArchitecture,
    confidenceNote,
  };
}

function _computeStructuralConfidence({ strengthGap, fsiHome, fsiAway, formHome, formAway, fpi, udi }) {
  let score = 0.5; // base

  // Gap de fuerza contribuye a certeza estructural
  score += clamp(strengthGap / 100 * 0.3, 0, 0.25);

  // FPI alto = favorito validado
  if (fpi) score += fpi.level === 'ALTO' ? 0.15 : fpi.level === 'BAJO' ? -0.1 : 0;

  // UDI sólida = underdog resistente
  if (udi) score += udi.level === 'SÓLIDA' ? 0.08 : udi.level === 'PERMEABLE' ? -0.05 : 0;

  // FSI extremo baja certeza (caos)
  const maxFsi = Math.max(Math.abs(fsiHome), Math.abs(fsiAway));
  if (maxFsi >= 35) score -= 0.10;

  // Forma disponible aumenta certeza
  if (formHome && formHome.n >= 4 && formAway && formAway.n >= 4) score += 0.08;

  return clamp(score, 0, 1);
}

function _computeTacticalConfidence(vs) {
  if (!vs || !vs.available) return NEUTRAL_CONFIDENCE; // neutral when no scout

  const { tacticalMismatchScore = 0, reliabilityScore = 0 } = vs;
  // High mismatch + good reliability = higher confidence
  const base = clamp(reliabilityScore / 100, 0, 1);
  const mismatchBonus = clamp(tacticalMismatchScore / 100 * 0.2, 0, 0.2);
  return clamp(base + mismatchBonus, 0, 1);
}

function _computeTemporalConfidence(htcs, matchData) {
  let score = NEUTRAL_CONFIDENCE; // base neutral

  if (htcs) {
    score += htcs.level === 'PROBABLE'     ? 0.25
          :  htcs.level === 'POSIBLE'      ? 0.12
          : 0;
  }

  // Half profile from video scout
  const halfProfile = matchData?.videoScout?.halfProfile;
  if (halfProfile) {
    if (halfProfile.firstHalfProfile !== 'unknown') score += 0.10;
    if (halfProfile.secondHalfProfile !== 'unknown') score += 0.10;
  }

  return clamp(score, 0, 1);
}

function _computeMarketConfidence(md, flags) {
  if (!md || !md.ready) return 0.3; // low when no market data

  let score = 0.4;
  if (md.riskLevel === 'HIGH') score += 0.30;
  if (md.riskLevel === 'MEDIUM') score += 0.15;
  if (flags.includes('MARKET_BLIND_DEFENSE')) score += 0.15;
  if (flags.includes('FAVORITE_NOT_PROVEN')) score += 0.10;

  return clamp(score, 0, 1);
}

// ── F. buildBestAngles ────────────────────────────────────────────────────────

/**
 * Selecciona los mejores ángulos de apuesta según la tesis y señales.
 *
 * @param {object} matchData
 * @param {string} thesis
 * @returns {{ safer, tactical, value, live }}
 */
export function buildBestAngles(matchData = {}, thesis = '') {
  const {
    drawIndex:             di     = null,
    htCleanSheetSignal:    htcs   = null,
    videoScout:            vs     = null,
    marketDefense:         md     = null,
    favoritePressureIndex: fpi    = null,
    underdogDefenseIndex:  udi    = null,
    odds                          = {},
    mktFavIsHome                  = true,
    favoriteName                  = 'Favorito',
    underdogName                  = 'Underdog',
    home                          = 'Local',
    away                          = 'Visitante',
    strengthGap                   = 0,
  } = matchData;

  const favSign  = mktFavIsHome ? '1' : '2';
  const undSign  = mktFavIsHome ? '2' : '1';

  let safer    = null;
  let tactical = null;
  let value    = null;
  let live     = null;

  // ── Safer angle (least risky — covers draw or dominant team)
  switch (thesis) {
    case 'strong_favorite_real':
      safer = `${favSign} (${favoriteName})`;
      break;
    case 'draw_trap':
    case 'tension_match_with_upset_risk':
      safer = `1X — ${favoriteName} no pierde`;
      break;
    case 'underdog_live':
    case 'fake_dominance_home':
    case 'market_overpricing_favorite':
      safer = `X2 — ${underdogName} no pierde`;
      break;
    case 'first_half_closed_second_half_open':
    case 'clean_match_deceptive':
      safer = htcs && htcs.level === 'PROBABLE' ? `Under 0.5 HT` : `1X`;
      break;
    default:
      safer = di && di.level === 'ALTO' ? `Empate (X)` : `1X`;
  }

  // ── Tactical angle (based on scout / half profile)
  const halfProfile = vs?.halfProfile;
  if (halfProfile && halfProfile.firstHalfProfile === 'closed') {
    tactical = `Under 1.5 HT — 1T cerrado por perfil táctico`;
  } else if (htcs && htcs.level === 'PROBABLE') {
    tactical = `Under 0.5 HT o CS HT — portería a 0 en 1T probable`;
  } else if (fpi && fpi.level === 'ALTO' && udi && udi.level === 'PERMEABLE') {
    tactical = `${favSign} & Over 1.5 — presión + defensa débil del rival`;
  } else if (thesis === 'fake_dominance_home') {
    tactical = `Under 2.5 o BTTS No — dominio sin conversión`;
  } else {
    tactical = `Resultado con doble oportunidad según señales`;
  }

  // ── Value angle (where odds > fair value, based on mismatch signals)
  if (thesis === 'market_overpricing_favorite' || thesis === 'strong_favorite_false') {
    const drawOdd = Number(odds?.draw);
    value = Number.isFinite(drawOdd)
      ? `Empate o ${undSign} (X2) — mercado sobreprecio al ${favoriteName}`
      : `X2 — precio del ${underdogName} sobrevalorado`;
  } else if (thesis === 'underdog_live') {
    const undOdd = mktFavIsHome ? Number(odds?.away) : Number(odds?.home);
    value = Number.isFinite(undOdd) && undOdd >= 2.5
      ? `${undSign} (${underdogName}) a ${undOdd.toFixed(2)} — FSI/defensa justifican el precio`
      : `X2 — valor en no-derrota del ${underdogName}`;
  } else if (thesis === 'draw_trap') {
    const drawOdd = Number(odds?.draw);
    value = Number.isFinite(drawOdd) && drawOdd >= 3.0
      ? `Empate (X) a ${drawOdd.toFixed(2)} — señal DI alta con precio atractivo`
      : `Empate (X) — señales de equilibrio justifican`;
  } else {
    value = `Revisar cuotas individuales: no hay valor claro sin mismatch`;
  }

  // ── Live angle (in-play based on half profile and temporal story)
  if (thesis === 'first_half_closed_second_half_open') {
    live = `Gol en 2T si ${favoriteName} acumula área sin convertir en 1T`;
  } else if (thesis === 'strong_favorite_real' && fpi && fpi.level === 'ALTO') {
    live = `Gol temprano del ${favoriteName} si empieza dominando — entrar antes del 25'`;
  } else if (thesis === 'underdog_live' || thesis === 'tension_match_with_upset_risk') {
    live = `Sorpresa en transición del ${underdogName} — atención a los primeros contraataques`;
  } else if (htcs && htcs.level === 'PROBABLE') {
    live = `CS HT en vivo si llega al 35-40' sin goles — valor in-play`;
  } else {
    live = `Observar el patrón de juego en los primeros 20 minutos antes de entrar`;
  }

  return { safer, tactical, value, live };
}

// ── G. buildTrapWarnings ──────────────────────────────────────────────────────

/**
 * Detecta trampas activas en el partido.
 *
 * @param {object} matchData
 * @param {string} thesis
 * @returns {Array<{ type, message, priority }>}
 */
export function buildTrapWarnings(matchData = {}, thesis = '') {
  const warnings = [];

  const {
    favoritePressureIndex:  fpi    = null,
    underdogDefenseIndex:   udi    = null,
    drawIndex:              di     = null,
    htCleanSheetSignal:     htcs   = null,
    videoScout:             vs     = null,
    marketDefense:          md     = null,
    flags:                  flags  = [],
    formHome                       = null,
    formAway                       = null,
    mktFavIsHome                   = true,
    favoriteName                   = 'Favorito',
    underdogName                   = 'Underdog',
    strengthGap                    = 0,
    fsiHome                        = 0,
    fsiAway                        = 0,
    type                           = 'tension',
  } = matchData;

  const strongerFsi = mktFavIsHome ? fsiHome : fsiAway;
  const weakerFsi   = mktFavIsHome ? fsiAway : fsiHome;
  const scoutFav    = vs?.available ? (mktFavIsHome ? vs.home : vs.away) : null;
  const favForm     = mktFavIsHome ? formHome : formAway;

  // 1. Favorite name trap
  if (strengthGap >= 15 && fpi && fpi.level === 'BAJO') {
    warnings.push({
      type:     'favorite_name_trap',
      message:  TRAP_TYPES.favorite_name_trap + ` (${favoriteName}: FPI ${fpi.score}/100)`,
      priority: 'high',
    });
  }

  // 2. Fake dominance trap
  if (scoutFav && scoutFav.sterilityRisk === 'high') {
    warnings.push({
      type:     'fake_dominance_trap',
      message:  TRAP_TYPES.fake_dominance_trap + ` (${favoriteName}: alto dominio, baja penetración)`,
      priority: 'high',
    });
  }

  // 3. High FSI ignored
  if (weakerFsi >= 25 && md && md.ready) {
    const mktFavProb = Number(md.marketFavoriteProb) || 0;
    if (mktFavProb >= 55) {
      warnings.push({
        type:     'high_fsi_ignored',
        message:  TRAP_TYPES.high_fsi_ignored + ` (${underdogName} FSI: +${weakerFsi.toFixed(1)}, mercado ignora)`,
        priority: 'high',
      });
    }
  }

  // 4. Overreaction to recent win
  if (favForm && favForm.n >= 2 && favForm.wins >= 2 && favForm.winsVsBottom === favForm.wins) {
    warnings.push({
      type:     'overreaction_to_recent_win',
      message:  TRAP_TYPES.overreaction_to_recent_win + ` (${favoriteName}: victorias solo vs débiles)`,
      priority: 'medium',
    });
  }

  // 5. Clean match deceptive
  if (type === 'clean' && di && di.level !== 'BAJO') {
    warnings.push({
      type:     'clean_match_deceptive',
      message:  TRAP_TYPES.clean_match_deceptive,
      priority: 'medium',
    });
  }

  // 6. Sterile pressure misread (high scout dominance, high sterility)
  if (scoutFav && scoutFav.dominance === 'high' && scoutFav.sterilityRisk === 'high') {
    warnings.push({
      type:     'sterile_pressure_misread',
      message:  TRAP_TYPES.sterile_pressure_misread + ` — ${favoriteName} controla el balón sin crear peligro real`,
      priority: 'high',
    });
  }

  // 7. Underdog hidden live
  if (flags.includes('UPSET_RISK_HIGH') || (udi && udi.level === 'SÓLIDA' && weakerFsi >= 10)) {
    warnings.push({
      type:     'underdog_hidden_live',
      message:  TRAP_TYPES.underdog_hidden_live + ` (${underdogName}: defensa + momento positivo)`,
      priority: 'high',
    });
  }

  // 8. First half under valued
  if (htcs && htcs.level === 'PROBABLE' && thesis === 'first_half_closed_second_half_open') {
    warnings.push({
      type:     'first_half_under_valued',
      message:  TRAP_TYPES.first_half_under_valued,
      priority: 'medium',
    });
  }

  // 9. Second half break pattern
  if (thesis === 'first_half_closed_second_half_open' && fpi && fpi.level !== 'BAJO') {
    warnings.push({
      type:     'second_half_break_pattern',
      message:  TRAP_TYPES.second_half_break_pattern,
      priority: 'medium',
    });
  }

  // Deduplicate
  const seen = new Set();
  return warnings.filter(w => {
    if (seen.has(w.type)) return false;
    seen.add(w.type);
    return true;
  });
}

// ── H. computeIntegrationCompleteness ────────────────────────────────────────

/**
 * Calcula el score de completitud de la integración (0-100).
 * Mide qué tan bien se integraron todas las capas de análisis.
 *
 * @param {object} matchData
 * @returns {{ score, level, missingLayers, warning }}
 */
export function computeIntegrationCompleteness(matchData = {}) {
  const checks = [
    // Structural radar
    { layer: 'structural_radar',   present: (matchData.strengthHome != null && matchData.fsiHome != null), weight: 20 },
    // Form data
    { layer: 'form_data',          present: !!(matchData.formHome?.n >= 3 && matchData.formAway?.n >= 3),   weight: 15 },
    // AI signals (FPI, UDI, DI)
    { layer: 'intelligence_signals', present: !!(matchData.favoritePressureIndex && matchData.underdogDefenseIndex), weight: 15 },
    // Video scout
    { layer: 'video_scout',        present: !!(matchData.videoScout?.available),                            weight: 20 },
    // Market / odds
    { layer: 'market_odds',        present: !!(matchData.odds?.home && matchData.odds?.draw && matchData.odds?.away), weight: 15 },
    // HT signal
    { layer: 'half_time_signal',   present: !!(matchData.htCleanSheetSignal),                               weight: 10 },
    // Market defense analysis
    { layer: 'market_defense',     present: !!(matchData.marketDefense?.ready),                             weight: 5  },
  ];

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const earnedWeight = checks.filter(c => c.present).reduce((s, c) => s + c.weight, 0);
  const score = Math.round((earnedWeight / totalWeight) * 100);

  const missingLayers = checks.filter(c => !c.present).map(c => c.layer);
  const level = score >= 80 ? 'complete' : score >= 55 ? 'partial' : 'incomplete';
  const warning = score < 55
    ? 'Análisis incompleto: faltan capas relevantes o hay conflicto no resuelto.'
    : score < 80
    ? 'Análisis parcial: algunas capas no están disponibles.'
    : null;

  return { score, level, missingLayers, warning };
}

// ── I. buildTemporalStory ─────────────────────────────────────────────────────

/**
 * Construye la narrativa temporal del partido (cómo se espera que viva).
 *
 * @param {object} matchData
 * @param {string} thesis
 * @returns {string}
 */
export function buildTemporalStory(matchData = {}, thesis = '') {
  const {
    htCleanSheetSignal:    htcs       = null,
    videoScout:            vs         = null,
    favoritePressureIndex: fpi        = null,
    favoriteName                      = 'el local',
    underdogName                      = 'el visitante',
  } = matchData;

  const halfProfile  = vs?.halfProfile;
  const firstHalf    = halfProfile?.firstHalfProfile  || null;
  const secondHalf   = halfProfile?.secondHalfProfile || null;

  if (thesis === 'first_half_closed_second_half_open') {
    return `1T más cerrado y táctico. Si ${favoriteName} acumula presión sin convertir, el 2T se abre — mayor riesgo de goles en los últimos 30 minutos.`;
  }

  if (thesis === 'strong_favorite_real') {
    return `${favoriteName} debería marcar el ritmo desde el inicio. Si el partido se equilibra en el primer tiempo, revisar el pick en el descanso.`;
  }

  if (thesis === 'underdog_live' || thesis === 'tension_match_with_upset_risk') {
    return `Partido de tensión. Las transiciones del ${underdogName} serán el foco en los primeros 20 minutos. El 2T puede ser más abierto si el resultado sigue 0-0.`;
  }

  if (htcs && htcs.level === 'PROBABLE') {
    return `1T con alta probabilidad de portería a cero para ambos. El partido puede decidirse en el segundo tiempo con mayor riesgo táctico acumulado.`;
  }

  if (firstHalf === 'closed' && secondHalf === 'open') {
    return `El perfil histórico de los equipos sugiere 1T cerrado y 2T con más oportunidades. El under HT tiene respaldo real.`;
  }

  if (firstHalf === 'open') {
    return `Historial de 1T con goles para ambos equipos. La apuesta de BTTS o over temprano puede tener valor.`;
  }

  if (thesis === 'fake_dominance_home') {
    return `${favoriteName} acumulará posesión y territorio pero sin profundidad real. Si llega al 70' sin gol, el cansancio puede abrir espacios al ${underdogName}.`;
  }

  if (thesis === 'draw_trap') {
    return `Partido probable de bajo marcador con mucho equilibrio. El empate puede darse tanto en el 1T como cerrarse así en el 2T sin grandes cambios.`;
  }

  return `Partido que necesita seguimiento en tiempo real. Sin perfil temporal claro, observar el tono de los primeros 15 minutos antes de decidir.`;
}

// ── J. buildWhyReasons ────────────────────────────────────────────────────────

/**
 * Construye las 3 razones principales que explican la tesis.
 *
 * @param {object} matchData
 * @param {string} thesis
 * @returns {string[]} array de máximo 3 bullets
 */
export function buildWhyReasons(matchData = {}, thesis = '') {
  const {
    favoritePressureIndex:  fpi    = null,
    underdogDefenseIndex:   udi    = null,
    drawIndex:              di     = null,
    htCleanSheetSignal:     htcs   = null,
    videoScout:             vs     = null,
    marketDefense:          md     = null,
    fsiHome                        = 0,
    fsiAway                        = 0,
    strengthGap                    = 0,
    mktFavIsHome                   = true,
    favoriteName                   = 'Favorito',
    underdogName                   = 'Underdog',
    formHome                       = null,
    formAway                       = null,
    flags:                  flags  = [],
  } = matchData;

  const reasons = [];
  const strongerFsi = mktFavIsHome ? fsiHome : fsiAway;
  const weakerFsi   = mktFavIsHome ? fsiAway : fsiHome;

  switch (thesis) {
    case 'strong_favorite_real':
      if (strengthGap >= 20) reasons.push(`Ventaja de fuerza histórica sólida (gap: ${strengthGap})`);
      if (fpi?.level === 'ALTO') reasons.push(`Presión real del ${favoriteName} confirmada (FPI ${fpi.score}/100)`);
      if (strongerFsi >= 10) reasons.push(`Momento sistémico positivo (FSI: +${strongerFsi.toFixed(1)})`);
      break;

    case 'strong_favorite_false':
      if (fpi?.level === 'BAJO') reasons.push(`Presión real del ${favoriteName} baja (FPI ${fpi.score}/100) pese a ser favorito`);
      if (strengthGap >= 15) reasons.push(`La ventaja histórica (gap: ${strengthGap}) no se traduce en momento actual`);
      if (strongerFsi <= -10) reasons.push(`FSI negativo del ${favoriteName} (${strongerFsi.toFixed(1)}): mal momento sistémico`);
      break;

    case 'underdog_live':
      if (weakerFsi >= 15) reasons.push(`${underdogName} llega con FSI positivo (+${weakerFsi.toFixed(1)}): buen momento sistémico`);
      if (udi?.level === 'SÓLIDA') reasons.push(`Defensa del ${underdogName} sólida (UDI ${udi.score}/100)`);
      if (flags.includes('UPSET_RISK_HIGH')) reasons.push(`Múltiples señales de sorpresa activas (UPSET_RISK_HIGH)`);
      break;

    case 'draw_trap':
      if (di?.level === 'ALTO') reasons.push(`Señal de empate alta (DI ${di.score}/100)`);
      if (strengthGap <= 10) reasons.push(`Fuerzas muy equilibradas (gap: ${strengthGap})`);
      reasons.push(`FSI neutro de ambos equipos — sin ventaja de momento clara`);
      break;

    case 'fake_dominance_home': {
      const scoutFav = vs?.available ? (mktFavIsHome ? vs.home : vs.away) : null;
      if (scoutFav?.sterilityRisk === 'high') reasons.push(`Scout detecta dominio estéril del ${favoriteName}: alto territorio, baja conversión`);
      if (fpi?.level !== 'ALTO') reasons.push(`Presión real del ${favoriteName} no alcanza nivel alto (FPI ${fpi?.score ?? '-'}/100)`);
      reasons.push(`La apariencia de dominio no se traduce en amenaza real según los datos`);
      break;
    }

    case 'market_overpricing_favorite':
      if (md?.ready) reasons.push(`Mercado da ${md.marketFavoriteProb}% al ${favoriteName} pero los datos no justifican ese precio`);
      if (udi?.level === 'SÓLIDA') reasons.push(`Defensa del ${underdogName} sólida: el mercado la ignora (UDI ${udi.score}/100)`);
      if (fpi?.level === 'BAJO') reasons.push(`Presión real del ${favoriteName} baja: el mercado sobrevalora su nombre`);
      break;

    case 'first_half_closed_second_half_open':
      if (htcs?.level === 'PROBABLE') reasons.push(`Señal de portería a 0 en 1T fuerte (${htcs.score}/100)`);
      reasons.push(`Perfil de partido sugiere apertura progresiva hacia el 2T`);
      if (fpi?.level !== 'BAJO') reasons.push(`${favoriteName} tiene presión que puede explotar en el segundo tiempo`);
      break;

    case 'tension_match_with_upset_risk':
    default:
      if (strengthGap <= 15) reasons.push(`Partido equilibrado: ningún equipo domina claramente en fuerza`);
      if (weakerFsi >= 10) reasons.push(`${underdogName} llega con momento positivo (FSI: +${weakerFsi.toFixed(1)})`);
      if (flags.includes('UNDERDOG_SOLID_DEFENSE')) reasons.push(`Defensa del ${underdogName} dificulta la victoria del favorito`);
  }

  // Fill up to 3 reasons if not enough specific ones
  if (reasons.length === 0) {
    reasons.push(`Partido con señales mixtas que no permiten una tesis más definida`);
  }

  return reasons.slice(0, 3);
}

// ── K. runMatchIntelligenceEngine ─────────────────────────────────────────────

/**
 * Punto de entrada principal del Match Intelligence Engine.
 * Recibe el objeto completo del partido (salida de buildRadarMatches)
 * y produce la síntesis unificada.
 *
 * @param {object} matchData - objeto del partido del Radar del Día
 * @returns {object} matchIntelligence — síntesis completa
 */
export function runMatchIntelligenceEngine(matchData = {}) {
  if (!matchData || typeof matchData !== 'object') {
    return null;
  }

  // ── Context flags for weight computation
  const matchContext = {
    hasScoutHome:         !!(matchData.videoScout?.available && matchData.videoScout?.home),
    hasScoutAway:         !!(matchData.videoScout?.available && matchData.videoScout?.away),
    hasOdds:              !!(matchData.odds?.home && matchData.odds?.draw && matchData.odds?.away),
    hasFormData:          !!(matchData.formHome?.n >= 3 && matchData.formAway?.n >= 3),
    hasHalfProfile:       !!(matchData.videoScout?.halfProfile),
    extremeFsi:           Math.max(Math.abs(matchData.fsiHome || 0), Math.abs(matchData.fsiAway || 0)) >= 30,
    oddsMismatch:         !!(matchData.marketDefense?.ready && matchData.marketDefense?.riskLevel === 'HIGH'),
    consistentHalfProfile: !!(matchData.videoScout?.halfProfile?.firstHalfProfile !== 'unknown'),
  };

  const weights            = computeSignalWeights(matchContext);
  const { thesis, thesisLabel, thesisDescription, oneLiner } = resolveMatchThesis(matchData);
  const signalConflicts    = buildSignalConflicts(matchData);
  const signalAlignment    = buildSignalAlignment(matchData);
  const { finalConfidence, confidenceArchitecture, confidenceNote } = buildConfidenceArchitecture(matchData, weights);
  const bestAngles         = buildBestAngles(matchData, thesis);
  const trapWarnings       = buildTrapWarnings(matchData, thesis);
  const temporalStory      = buildTemporalStory(matchData, thesis);
  const whyReasons         = buildWhyReasons(matchData, thesis);
  const integration        = computeIntegrationCompleteness(matchData);

  return {
    // Core thesis
    coreMatchThesis: {
      thesis,
      thesisLabel,
      thesisDescription,
      oneLiner,
    },

    // Signal analysis
    signalConflicts,
    signalAlignment,

    // Best markets / angles
    bestAngles,

    // Trap warnings (sorted by priority: high first)
    trapWarnings: trapWarnings.sort((a, b) =>
      (a.priority === 'high' ? 0 : a.priority === 'medium' ? 1 : 2) -
      (b.priority === 'high' ? 0 : b.priority === 'medium' ? 1 : 2)
    ),

    // Confidence
    confidenceArchitecture: {
      finalConfidence,
      breakdown: confidenceArchitecture,
      note: confidenceNote,
    },

    // Temporal story
    temporalStory,

    // Why reasons (max 3 bullets)
    whyReasons,

    // Signal weights used
    signalWeights: weights,

    // Integration completeness score
    integrationCompleteness: integration,

    // Final verdict (thesis + confidence + best safer angle)
    finalVerdict: {
      thesis,
      confidence: finalConfidence,
      saferAngle: bestAngles.safer,
      oneLiner,
    },
  };
}
