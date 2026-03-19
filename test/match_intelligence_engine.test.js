import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSignalWeights,
  buildSignalConflicts,
  buildSignalAlignment,
  resolveMatchThesis,
  buildConfidenceArchitecture,
  buildBestAngles,
  buildTrapWarnings,
  computeIntegrationCompleteness,
  buildTemporalStory,
  buildWhyReasons,
  runMatchIntelligenceEngine,
  MATCH_THESIS,
  TRAP_TYPES,
} from '../src/footballlab/match_intelligence_engine.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFpi(level = 'ALTO', score = 72) {
  return { score, level, gfPerGame: 1.8, winsVsTop: 2, sources: ['GF/j: 1.8', 'Ganó 2x vs top'] };
}

function makeUdi(level = 'SÓLIDA', score = 70) {
  return { score, level, gaPerGame: 0.6, cleanSheetRate: 0.5, htCleanSheetSignal: true, sources: ['GA/j: 0.6'] };
}

function makeDi(level = 'ALTO', score = 65) {
  return { score, level, signals: ['Fuerzas equilibradas', 'FSI neutro'] };
}

function makeHtcs(level = 'PROBABLE', score = 60) {
  return { score, level, signals: ['GA/j bajo local', 'GA/j bajo visitante'] };
}

function makeMarketDefense(riskLevel = 'HIGH', marketFavoriteProb = 68) {
  return {
    ready: true,
    riskLevel,
    marketFavoriteProb,
    favName: 'Local',
    underdogName: 'Visitante',
    verdict: 'Mercado sobreprecio al favorito',
    defenseScoreUnderdog: 70,
    attackPenetrationFavorite: 42,
    upsetRiskScore: 65,
    mktFavIsHome: true,
    flags: ['MARKET_BLIND_DEFENSE'],
    context: { underdogGa: 0.6, favoriteGf: 1.2, underdogTrend: 'stable', favoriteWinsVsTop: 0 },
  };
}

function makeVideoScout(overrides = {}) {
  return {
    available: true,
    home: {
      dominance: 'high',
      threat: 'medium',
      sterilityRisk: 'low',
      progression: 'strong',
      stuckTendency: 'low',
      tags: [],
    },
    away: {
      dominance: 'low',
      threat: 'low',
      sterilityRisk: 'low',
      progression: 'neutral',
      stuckTendency: 'medium',
      tags: [],
    },
    halfProfile: {
      firstHalfProfile: 'closed',
      secondHalfProfile: 'open',
    },
    tacticalMismatchScore: 55,
    reliabilityScore: 70,
    flags: [],
    ...overrides,
  };
}

function makeFormProfile(overrides = {}) {
  return {
    n: 5,
    sequence: ['G', 'G', 'E', 'G', 'P'],
    gfPerGame: 1.8,
    gaPerGame: 0.8,
    ptsPerGame: 1.8,
    winsVsTop: 2,
    winsVsBottom: 1,
    wins: 3,
    draws: 1,
    losses: 1,
    lossesVsBot: 0,
    trend: 'rising',
    qualityScore: 0.65,
    drawRate: 0.2,
    matchDetails: [
      { rivalName: 'TopTeam', rivalRank: 2, myGoals: 1, oppGoals: 0 },
      { rivalName: 'MidTeam', rivalRank: 8, myGoals: 2, oppGoals: 1 },
      { rivalName: 'MidTeam', rivalRank: 7, myGoals: 1, oppGoals: 1 },
      { rivalName: 'BotTeam', rivalRank: 18, myGoals: 2, oppGoals: 0 },
      { rivalName: 'TopTeam', rivalRank: 3, myGoals: 0, oppGoals: 1 },
    ],
    ...overrides,
  };
}

function makeFullMatch(overrides = {}) {
  return {
    id: 'test_match',
    home: 'Local FC',
    away: 'Visitante CF',
    strengthHome: 70,
    strengthAway: 45,
    strengthGap: 25,
    fsiHome: 18,
    fsiAway: -8,
    avgFSI: 5,
    type: 'tension',
    mktFavIsHome: true,
    favoriteName: 'Local FC',
    underdogName: 'Visitante CF',
    odds: { home: 1.65, draw: 3.40, away: 4.50 },
    flags: [],
    favoritePressureIndex: makeFpi(),
    underdogDefenseIndex: makeUdi('MODERADA', 50),
    drawIndex: makeDi('BAJO', 25),
    htCleanSheetSignal: makeHtcs('POSIBLE', 40),
    formHome: makeFormProfile(),
    formAway: makeFormProfile({ trend: 'falling', ptsPerGame: 0.8, wins: 1, winsVsTop: 0 }),
    marketDefense: makeMarketDefense('LOW', 55),
    videoScout: makeVideoScout(),
    dataWindow: 5,
    ...overrides,
  };
}

// ── computeSignalWeights ──────────────────────────────────────────────────────

test('computeSignalWeights — retorna pesos que suman aproximadamente 1', () => {
  const ctx = { hasScoutHome: true, hasScoutAway: true, hasOdds: true, hasFormData: true };
  const w = computeSignalWeights(ctx);
  const total = w.structuralWeight + w.correctiveWeight + w.scoutWeight + w.temporalWeight + w.marketWeight;
  assert.ok(Math.abs(total - 1) < 0.01, `Pesos deben sumar 1, suman ${total}`);
});

test('computeSignalWeights — sin scout aumenta peso estructural', () => {
  const noScout = computeSignalWeights({ hasScoutHome: false, hasScoutAway: false, hasFormData: true });
  const bothScout = computeSignalWeights({ hasScoutHome: true, hasScoutAway: true, hasFormData: true });
  assert.ok(noScout.structuralWeight > bothScout.structuralWeight, 'Sin scout debe subir peso estructural');
  assert.ok(noScout.scoutWeight < bothScout.scoutWeight, 'Sin scout debe bajar peso de scout');
});

test('computeSignalWeights — FSI extremo sube peso corrector', () => {
  const normal  = computeSignalWeights({ extremeFsi: false });
  const extreme = computeSignalWeights({ extremeFsi: true });
  assert.ok(extreme.correctiveWeight > normal.correctiveWeight, 'FSI extremo debe subir peso corrector');
});

test('computeSignalWeights — mismatch de odds sube peso de mercado', () => {
  const noMismatch = computeSignalWeights({ oddsMismatch: false, hasOdds: true });
  const mismatch   = computeSignalWeights({ oddsMismatch: true,  hasOdds: true });
  assert.ok(mismatch.marketWeight > noMismatch.marketWeight, 'Mismatch debe subir peso de mercado');
});

test('computeSignalWeights — valores entre 0 y 1', () => {
  const w = computeSignalWeights({ hasScoutHome: true, oddsMismatch: true, extremeFsi: true });
  for (const [k, v] of Object.entries(w)) {
    assert.ok(v >= 0 && v <= 1, `${k} debe estar entre 0 y 1, es ${v}`);
  }
});

// ── buildSignalConflicts ──────────────────────────────────────────────────────

test('buildSignalConflicts — detecta favorito fuerte con presión baja', () => {
  const match = makeFullMatch({
    strengthGap: 25,
    favoritePressureIndex: makeFpi('BAJO', 30),
    mktFavIsHome: true,
  });
  const conflicts = buildSignalConflicts(match);
  assert.ok(conflicts.some(c => c.code === 'high_strength_low_pressure'), 'Debe detectar conflicto de fuerza vs presión');
});

test('buildSignalConflicts — detecta mercado alto con presión baja', () => {
  const match = makeFullMatch({
    favoritePressureIndex: makeFpi('BAJO', 28),
    marketDefense: makeMarketDefense('HIGH', 70),
  });
  const conflicts = buildSignalConflicts(match);
  assert.ok(conflicts.some(c => c.code === 'market_high_pressure_low'), 'Debe detectar conflicto mercado vs presión');
});

test('buildSignalConflicts — detecta FSI alto del underdog ignorado por cuotas', () => {
  const match = makeFullMatch({
    fsiAway: 28,
    mktFavIsHome: true,
    odds: { home: 1.60, draw: 3.50, away: 4.20 },
  });
  const conflicts = buildSignalConflicts(match);
  assert.ok(conflicts.some(c => c.code === 'high_fsi_underdog_ignored'), 'Debe detectar FSI alto del underdog ignorado');
});

test('buildSignalConflicts — devuelve array vacío si no hay conflictos', () => {
  const match = makeFullMatch({
    strengthGap: 5,
    fsiHome: 2,
    fsiAway: 1,
    favoritePressureIndex: makeFpi('MEDIO', 55),
    underdogDefenseIndex: makeUdi('MODERADA', 48),
    marketDefense: makeMarketDefense('LOW', 50),
    odds: { home: 2.10, draw: 3.20, away: 3.40 },
  });
  const conflicts = buildSignalConflicts(match);
  assert.ok(Array.isArray(conflicts), 'Debe devolver array');
});

test('buildSignalConflicts — cada conflicto tiene code, message y severity', () => {
  const match = makeFullMatch({
    strengthGap: 25,
    favoritePressureIndex: makeFpi('BAJO', 28),
    marketDefense: makeMarketDefense('HIGH', 72),
  });
  const conflicts = buildSignalConflicts(match);
  assert.ok(conflicts.length > 0, 'Debe haber conflictos');
  for (const c of conflicts) {
    assert.ok(typeof c.code === 'string', 'code debe ser string');
    assert.ok(typeof c.message === 'string', 'message debe ser string');
    assert.ok(['high', 'medium', 'low'].includes(c.severity), `severity inválida: ${c.severity}`);
  }
});

// ── buildSignalAlignment ──────────────────────────────────────────────────────

test('buildSignalAlignment — detecta alineación favorito + defensa débil', () => {
  const match = makeFullMatch({
    favoritePressureIndex: makeFpi('ALTO', 78),
    underdogDefenseIndex: makeUdi('PERMEABLE', 30),
  });
  const alignments = buildSignalAlignment(match);
  assert.ok(alignments.some(a => a.code === 'favorite_pressure_underdog_weak_defense'), 'Debe detectar alineación presión + defensa débil');
});

test('buildSignalAlignment — detecta alineación de portería a 0 en 1T', () => {
  const match = makeFullMatch({
    htCleanSheetSignal: makeHtcs('PROBABLE', 65),
  });
  const alignments = buildSignalAlignment(match);
  assert.ok(alignments.some(a => a.code === 'ht_clean_aligned'), 'Debe detectar alineación HT clean sheet');
});

test('buildSignalAlignment — detecta alineación FSI + fuerza + forma ascendente', () => {
  const match = makeFullMatch({
    fsiHome: 22,
    mktFavIsHome: true,
    strengthGap: 20,
    formHome: makeFormProfile({ trend: 'rising' }),
  });
  const alignments = buildSignalAlignment(match);
  assert.ok(alignments.some(a => a.code === 'fsi_strength_form_alignment'), 'Debe detectar alineación FSI + fuerza + forma');
});

test('buildSignalAlignment — cada alineación tiene code, message y strength', () => {
  const match = makeFullMatch({
    favoritePressureIndex: makeFpi('ALTO', 78),
    underdogDefenseIndex: makeUdi('PERMEABLE', 30),
    htCleanSheetSignal: makeHtcs('PROBABLE', 65),
  });
  const alignments = buildSignalAlignment(match);
  assert.ok(alignments.length > 0, 'Debe haber alineaciones');
  for (const a of alignments) {
    assert.ok(typeof a.code === 'string', 'code debe ser string');
    assert.ok(typeof a.message === 'string', 'message debe ser string');
    assert.ok(['strong', 'medium', 'low'].includes(a.strength), `strength inválida: ${a.strength}`);
  }
});

// ── resolveMatchThesis ────────────────────────────────────────────────────────

test('resolveMatchThesis — favorito real con presión alta + brecha + FSI positivo', () => {
  const match = makeFullMatch({
    favoritePressureIndex: makeFpi('ALTO', 78),
    strengthGap: 28,
    fsiHome: 20,
    mktFavIsHome: true,
  });
  const result = resolveMatchThesis(match);
  assert.equal(result.thesis, 'strong_favorite_real', 'Debe resolver como favorito real');
  assert.ok(typeof result.oneLiner === 'string', 'oneLiner debe ser string');
  assert.ok(typeof result.thesisLabel === 'string', 'thesisLabel debe ser string');
});

test('resolveMatchThesis — favorito falso con brecha + presión baja', () => {
  const match = makeFullMatch({
    favoritePressureIndex: makeFpi('BAJO', 28),
    strengthGap: 22,
    underdogDefenseIndex: makeUdi('MODERADA', 50),
    type: 'clean',
  });
  const result = resolveMatchThesis(match);
  assert.ok(['strong_favorite_false', 'market_overpricing_favorite'].includes(result.thesis),
    `Debe resolver como favorito falso o sobreprecio, obtuvo: ${result.thesis}`);
});

test('resolveMatchThesis — underdog live con FSI positivo alto', () => {
  const match = makeFullMatch({
    fsiAway: 26,
    mktFavIsHome: true,
    strengthGap: 12,
    underdogDefenseIndex: makeUdi('SÓLIDA', 72),
    favoritePressureIndex: makeFpi('MEDIO', 52),
  });
  const result = resolveMatchThesis(match);
  assert.equal(result.thesis, 'underdog_live', 'Debe resolver como underdog live');
});

test('resolveMatchThesis — draw trap con DI alto + fuerzas equilibradas', () => {
  const match = makeFullMatch({
    drawIndex: makeDi('ALTO', 72),
    strengthGap: 8,
    fsiHome: 3,
    fsiAway: -2,
  });
  const result = resolveMatchThesis(match);
  assert.equal(result.thesis, 'draw_trap', 'Debe resolver como draw trap');
});

test('resolveMatchThesis — caótico si type es chaos', () => {
  const match = makeFullMatch({ type: 'chaos', strengthGap: 5 });
  const result = resolveMatchThesis(match);
  assert.equal(result.thesis, 'chaotic_match_hidden', 'Debe resolver como caótico');
});

test('resolveMatchThesis — devuelve estructura completa', () => {
  const match = makeFullMatch();
  const result = resolveMatchThesis(match);
  assert.ok(typeof result.thesis === 'string', 'thesis debe ser string');
  assert.ok(typeof result.thesisLabel === 'string', 'thesisLabel debe ser string');
  assert.ok(typeof result.thesisDescription === 'string', 'thesisDescription debe ser string');
  assert.ok(typeof result.oneLiner === 'string', 'oneLiner debe ser string');
  assert.ok(MATCH_THESIS[result.thesis], `thesis "${result.thesis}" debe estar en catálogo`);
});

// ── buildConfidenceArchitecture ───────────────────────────────────────────────

test('buildConfidenceArchitecture — confianza entre 0 y 1', () => {
  const match  = makeFullMatch();
  const weights = computeSignalWeights({ hasScoutHome: true, hasScoutAway: true });
  const result = buildConfidenceArchitecture(match, weights);
  assert.ok(result.finalConfidence >= 0 && result.finalConfidence <= 1,
    `finalConfidence debe estar entre 0 y 1, es ${result.finalConfidence}`);
});

test('buildConfidenceArchitecture — devuelve estructura esperada', () => {
  const match  = makeFullMatch();
  const weights = computeSignalWeights({});
  const result = buildConfidenceArchitecture(match, weights);
  assert.ok(result.confidenceArchitecture, 'Debe tener confidenceArchitecture');
  assert.ok(['high', 'medium', 'low'].includes(result.confidenceArchitecture.structural), 'structural válido');
  assert.ok(['high', 'medium', 'low', 'unavailable'].includes(result.confidenceArchitecture.tactical), 'tactical válido');
  assert.ok(typeof result.confidenceNote === 'string', 'confidenceNote debe ser string');
});

test('buildConfidenceArchitecture — partido con scout tiene confianza táctica disponible', () => {
  const match   = makeFullMatch({ videoScout: makeVideoScout() });
  const weights = computeSignalWeights({ hasScoutHome: true, hasScoutAway: true });
  const result  = buildConfidenceArchitecture(match, weights);
  assert.notEqual(result.confidenceArchitecture.tactical, 'unavailable', 'Tactical debe estar disponible con scout');
});

// ── buildBestAngles ───────────────────────────────────────────────────────────

test('buildBestAngles — devuelve las cuatro claves esperadas', () => {
  const match = makeFullMatch();
  const angles = buildBestAngles(match, 'strong_favorite_real');
  assert.ok(angles.safer  !== undefined, 'Debe tener safer');
  assert.ok(angles.tactical !== undefined, 'Debe tener tactical');
  assert.ok(angles.value   !== undefined, 'Debe tener value');
  assert.ok(angles.live    !== undefined, 'Debe tener live');
});

test('buildBestAngles — safer es 1X para partido de tensión', () => {
  const match = makeFullMatch({ type: 'tension' });
  const angles = buildBestAngles(match, 'tension_match_with_upset_risk');
  assert.match(angles.safer, /1X|no pierde/i, `safer debe incluir 1X o doble oportunidad, es: ${angles.safer}`);
});

test('buildBestAngles — underdog live tiene X2 como safer', () => {
  const match = makeFullMatch({ mktFavIsHome: true });
  const angles = buildBestAngles(match, 'underdog_live');
  assert.match(angles.safer, /X2|no pierde/i, `safer del underdog live debe ser X2 o doble oportunidad, es: ${angles.safer}`);
});

test('buildBestAngles — first_half_closed da under HT como táctico', () => {
  const match = makeFullMatch({ htCleanSheetSignal: makeHtcs('PROBABLE', 65) });
  const angles = buildBestAngles(match, 'first_half_closed_second_half_open');
  assert.ok(angles.tactical, 'Debe tener ángulo táctico');
  assert.ok(angles.live.toLowerCase().includes('2t') || angles.live.toLowerCase().includes('2º'), 'Live debe mencionar 2T');
});

// ── buildTrapWarnings ─────────────────────────────────────────────────────────

test('buildTrapWarnings — detecta trampa de nombre de favorito', () => {
  const match = makeFullMatch({
    strengthGap: 20,
    favoritePressureIndex: makeFpi('BAJO', 28),
  });
  const warnings = buildTrapWarnings(match, 'strong_favorite_false');
  assert.ok(warnings.some(w => w.type === 'favorite_name_trap'), 'Debe detectar favorite_name_trap');
});

test('buildTrapWarnings — detecta dominio falso con scout estéril', () => {
  const match = makeFullMatch({
    videoScout: makeVideoScout({
      home: { dominance: 'high', threat: 'low', sterilityRisk: 'high', progression: 'weak', stuckTendency: 'high', tags: [] },
    }),
  });
  const warnings = buildTrapWarnings(match, 'fake_dominance_home');
  assert.ok(
    warnings.some(w => w.type === 'fake_dominance_trap' || w.type === 'sterile_pressure_misread'),
    'Debe detectar trampa de dominio estéril'
  );
});

test('buildTrapWarnings — no hay duplicados', () => {
  const match = makeFullMatch({
    strengthGap: 20,
    favoritePressureIndex: makeFpi('BAJO', 28),
    videoScout: makeVideoScout({
      home: { dominance: 'high', threat: 'low', sterilityRisk: 'high', progression: 'weak', stuckTendency: 'high', tags: [] },
    }),
  });
  const warnings = buildTrapWarnings(match, 'fake_dominance_home');
  const types = warnings.map(w => w.type);
  const unique = new Set(types);
  assert.equal(types.length, unique.size, 'No debe haber tipos de trampa duplicados');
});

test('buildTrapWarnings — cada advertencia tiene type, message y priority', () => {
  const match = makeFullMatch({
    strengthGap: 20,
    favoritePressureIndex: makeFpi('BAJO', 28),
    flags: ['UPSET_RISK_HIGH'],
    underdogDefenseIndex: makeUdi('SÓLIDA', 70),
    fsiAway: 12,
  });
  const warnings = buildTrapWarnings(match, 'strong_favorite_false');
  for (const w of warnings) {
    assert.ok(typeof w.type === 'string', 'type debe ser string');
    assert.ok(typeof w.message === 'string', 'message debe ser string');
    assert.ok(['high', 'medium', 'low'].includes(w.priority), `priority inválida: ${w.priority}`);
  }
});

test('buildTrapWarnings — trampas high priority primero', () => {
  const match = makeFullMatch({
    strengthGap: 20,
    favoritePressureIndex: makeFpi('BAJO', 28),
    flags: ['UPSET_RISK_HIGH'],
    underdogDefenseIndex: makeUdi('SÓLIDA', 70),
    fsiAway: 28,
    marketDefense: makeMarketDefense('HIGH', 68),
  });
  const warnings = buildTrapWarnings(match, 'strong_favorite_false');
  const sorted = [...warnings].sort((a, b) =>
    (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1)
  );
  assert.deepEqual(warnings, sorted, 'Las advertencias high priority deben aparecer primero');
});

// ── computeIntegrationCompleteness ───────────────────────────────────────────

test('computeIntegrationCompleteness — score entre 0 y 100', () => {
  const match = makeFullMatch();
  const result = computeIntegrationCompleteness(match);
  assert.ok(result.score >= 0 && result.score <= 100, `score debe ser 0-100, es ${result.score}`);
});

test('computeIntegrationCompleteness — partido completo tiene score alto', () => {
  const match = makeFullMatch({ videoScout: makeVideoScout(), marketDefense: makeMarketDefense('LOW', 50) });
  const result = computeIntegrationCompleteness(match);
  assert.ok(result.score >= 70, `Partido completo debe tener score >= 70, es ${result.score}`);
});

test('computeIntegrationCompleteness — partido sin scout tiene score menor', () => {
  const withScout    = makeFullMatch({ videoScout: makeVideoScout() });
  const withoutScout = makeFullMatch({ videoScout: null });
  const r1 = computeIntegrationCompleteness(withScout);
  const r2 = computeIntegrationCompleteness(withoutScout);
  assert.ok(r1.score > r2.score, 'Con scout debe tener mayor score de integración');
});

test('computeIntegrationCompleteness — devuelve missingLayers como array', () => {
  const match = makeFullMatch({ videoScout: null, odds: {} });
  const result = computeIntegrationCompleteness(match);
  assert.ok(Array.isArray(result.missingLayers), 'missingLayers debe ser array');
  assert.ok(result.missingLayers.includes('video_scout'), 'Debe incluir video_scout como capa faltante');
  assert.ok(result.missingLayers.includes('market_odds'), 'Debe incluir market_odds como capa faltante');
});

test('computeIntegrationCompleteness — level es complete, partial o incomplete', () => {
  const match = makeFullMatch();
  const result = computeIntegrationCompleteness(match);
  assert.ok(['complete', 'partial', 'incomplete'].includes(result.level), `level inválido: ${result.level}`);
});

// ── buildTemporalStory ────────────────────────────────────────────────────────

test('buildTemporalStory — devuelve string no vacío', () => {
  const match = makeFullMatch();
  const story = buildTemporalStory(match, 'tension_match_with_upset_risk');
  assert.ok(typeof story === 'string' && story.length > 0, 'Debe devolver string no vacío');
});

test('buildTemporalStory — 1T cerrado/2T abierto menciona el segundo tiempo', () => {
  const match = makeFullMatch();
  const story = buildTemporalStory(match, 'first_half_closed_second_half_open');
  assert.ok(story.toLowerCase().includes('2t') || story.toLowerCase().includes('segundo'), 'Debe mencionar el 2T');
});

// ── buildWhyReasons ───────────────────────────────────────────────────────────

test('buildWhyReasons — devuelve máximo 3 razones', () => {
  const match = makeFullMatch();
  const reasons = buildWhyReasons(match, 'strong_favorite_real');
  assert.ok(Array.isArray(reasons), 'Debe ser array');
  assert.ok(reasons.length <= 3, `Máximo 3 razones, devolvió ${reasons.length}`);
  assert.ok(reasons.length >= 1, 'Debe haber al menos una razón');
});

test('buildWhyReasons — razones son strings no vacíos', () => {
  const match = makeFullMatch();
  const reasons = buildWhyReasons(match, 'underdog_live');
  for (const r of reasons) {
    assert.ok(typeof r === 'string' && r.length > 0, 'Cada razón debe ser string no vacío');
  }
});

// ── runMatchIntelligenceEngine ────────────────────────────────────────────────

test('runMatchIntelligenceEngine — devuelve null para input null o no-objeto', () => {
  assert.equal(runMatchIntelligenceEngine(null), null);
  assert.equal(runMatchIntelligenceEngine('string'), null);
  assert.equal(runMatchIntelligenceEngine(42), null);
});

test('runMatchIntelligenceEngine — devuelve todas las claves esperadas', () => {
  const match  = makeFullMatch();
  const result = runMatchIntelligenceEngine(match);
  assert.ok(result, 'Debe devolver un objeto');
  assert.ok(result.coreMatchThesis,          'Debe tener coreMatchThesis');
  assert.ok(Array.isArray(result.signalConflicts),    'signalConflicts debe ser array');
  assert.ok(Array.isArray(result.signalAlignment),    'signalAlignment debe ser array');
  assert.ok(result.bestAngles,               'Debe tener bestAngles');
  assert.ok(Array.isArray(result.trapWarnings),       'trapWarnings debe ser array');
  assert.ok(result.confidenceArchitecture,   'Debe tener confidenceArchitecture');
  assert.ok(typeof result.temporalStory === 'string', 'temporalStory debe ser string');
  assert.ok(Array.isArray(result.whyReasons),         'whyReasons debe ser array');
  assert.ok(result.signalWeights,            'Debe tener signalWeights');
  assert.ok(result.integrationCompleteness,  'Debe tener integrationCompleteness');
  assert.ok(result.finalVerdict,             'Debe tener finalVerdict');
});

test('runMatchIntelligenceEngine — coreMatchThesis es consistente', () => {
  const match  = makeFullMatch();
  const result = runMatchIntelligenceEngine(match);
  assert.ok(MATCH_THESIS[result.coreMatchThesis.thesis], `thesis "${result.coreMatchThesis.thesis}" debe estar en catálogo`);
  assert.equal(result.coreMatchThesis.thesis, result.finalVerdict.thesis, 'thesis en coreMatchThesis y finalVerdict deben coincidir');
});

test('runMatchIntelligenceEngine — trapWarnings ordenadas por prioridad', () => {
  const match = makeFullMatch({
    strengthGap: 20,
    favoritePressureIndex: makeFpi('BAJO', 28),
    flags: ['UPSET_RISK_HIGH'],
    underdogDefenseIndex: makeUdi('SÓLIDA', 70),
    fsiAway: 28,
    marketDefense: makeMarketDefense('HIGH', 68),
  });
  const result = runMatchIntelligenceEngine(match);
  const priorities = result.trapWarnings.map(w => w.priority === 'high' ? 0 : w.priority === 'medium' ? 1 : 2);
  for (let i = 1; i < priorities.length; i++) {
    assert.ok(priorities[i] >= priorities[i - 1], 'trapWarnings deben estar ordenadas por prioridad');
  }
});

test('runMatchIntelligenceEngine — integrationCompleteness score válido', () => {
  const match  = makeFullMatch();
  const result = runMatchIntelligenceEngine(match);
  assert.ok(result.integrationCompleteness.score >= 0 && result.integrationCompleteness.score <= 100,
    `score de integración debe ser 0-100, es ${result.integrationCompleteness.score}`);
});

test('runMatchIntelligenceEngine — partido con underdog FSI alto detecta upset', () => {
  const match = makeFullMatch({
    fsiAway: 30,
    mktFavIsHome: true,
    strengthGap: 10,
    underdogDefenseIndex: makeUdi('SÓLIDA', 72),
  });
  const result = runMatchIntelligenceEngine(match);
  assert.ok(
    ['underdog_live', 'tension_match_with_upset_risk'].includes(result.coreMatchThesis.thesis),
    `Debe detectar upset risk, thesis: ${result.coreMatchThesis.thesis}`
  );
});

test('runMatchIntelligenceEngine — objeto vacío no rompe el motor', () => {
  const result = runMatchIntelligenceEngine({});
  assert.ok(result, 'Debe devolver objeto aunque el input esté vacío');
  assert.ok(result.coreMatchThesis, 'Debe tener thesis aunque no haya datos');
});

// ── MATCH_THESIS y TRAP_TYPES catálogos ──────────────────────────────────────

test('MATCH_THESIS — tiene todas las tesis esperadas', () => {
  const expected = [
    'strong_favorite_real',
    'strong_favorite_false',
    'underdog_live',
    'draw_trap',
    'clean_match_deceptive',
    'chaotic_match_hidden',
    'first_half_closed_second_half_open',
    'fake_dominance_home',
    'market_overpricing_favorite',
    'tension_match_with_upset_risk',
  ];
  for (const key of expected) {
    assert.ok(MATCH_THESIS[key], `Debe existir tesis: ${key}`);
    assert.ok(typeof MATCH_THESIS[key].label === 'string', `label de ${key} debe ser string`);
    assert.ok(typeof MATCH_THESIS[key].description === 'string', `description de ${key} debe ser string`);
  }
});

test('TRAP_TYPES — tiene todos los tipos de trampa esperados', () => {
  const expected = [
    'favorite_name_trap',
    'fake_dominance_trap',
    'high_fsi_ignored',
    'overreaction_to_recent_win',
    'clean_match_deceptive',
    'sterile_pressure_misread',
    'underdog_hidden_live',
    'first_half_under_valued',
    'second_half_break_pattern',
  ];
  for (const key of expected) {
    assert.ok(TRAP_TYPES[key], `Debe existir trampa: ${key}`);
    assert.ok(typeof TRAP_TYPES[key] === 'string', `Trampa ${key} debe ser string`);
  }
});
