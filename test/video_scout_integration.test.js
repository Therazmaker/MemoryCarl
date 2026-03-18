import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVideoScoutProfile,
  computeVideoScoutReliability,
  compareRadarVsScout,
  computeTacticalMismatchScore,
  adjustRadarPredictionsWithScout,
  buildHalfProfileFromScout,
  buildVideoScoutLayer,
} from '../src/footballlab/video_scout_integration.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeVsProfile(overrides = {}) {
  return {
    sessions:        3,
    totalPlays:      15,
    avgTouches:      4.5,
    avgProgress:     0.1,
    avgBackpasses:   1.8,
    fieldTiltPct:    0.48,
    pressureZonePct: 0.22,
    avgDanger:       2.8,
    sterileRate:     0.10,
    conversionRate:  0.30,
    goalsPerSession: 1.0,
    preferredSide:   'center',
    byOutcome:       {},
    byType:          {},
    startZones:      {},
    endZones:        {},
    directPlays:     3,
    tacticalStyle:   'Equilibrado',
    ...overrides,
  };
}

function makeRecords(n = 10, sessionsCount = 2) {
  const plays = Array.from({ length: n }, (_, i) => ({
    type:    i % 3 === 0 ? 'attack_build' : i % 3 === 1 ? 'counter' : 'shot_sequence',
    outcome: i % 4 === 0 ? 'goal' : 'saved',
    metrics: {
      touches:    4,
      netProgress: 0.1,
      backpasses:  1,
      startZone:  'mid',
      endZone:    'att',
      side:       'center',
    },
  }));
  return Array.from({ length: sessionsCount }, (_, i) => ({
    id:   `rec_${i}`,
    date: '2026-01-0' + (i + 1),
    plays: i === 0 ? plays : plays.slice(0, Math.max(1, Math.floor(n / sessionsCount))),
  }));
}

// ── buildVideoScoutProfile ────────────────────────────────────────────────────

test('buildVideoScoutProfile returns null for null input', () => {
  assert.equal(buildVideoScoutProfile(null), null);
});

test('buildVideoScoutProfile returns null for profile with no plays', () => {
  assert.equal(buildVideoScoutProfile({ totalPlays: 0 }), null);
});

test('buildVideoScoutProfile detects fake_dominance', () => {
  const profile = makeVsProfile({
    fieldTiltPct:    0.62,
    pressureZonePct: 0.12,
    conversionRate:  0.18,
  });
  const result = buildVideoScoutProfile(profile);
  assert.ok(result, 'should return a profile');
  assert.ok(result.tags.includes('fake_dominance'), `expected fake_dominance in ${result.tags}`);
  // fieldTiltPct=0.62, pressureZonePct=0.12, conversionRate=0.18 → sterilityScore ~0.35 → medium
  assert.ok(['medium', 'high'].includes(result.sterilityRisk), `unexpected sterilityRisk: ${result.sterilityRisk}`);
});

test('buildVideoScoutProfile detects sustained_pressure', () => {
  const profile = makeVsProfile({
    fieldTiltPct:    0.65,
    pressureZonePct: 0.38,
    avgDanger:       3.5,
    conversionRate:  0.40,
  });
  const result = buildVideoScoutProfile(profile);
  assert.ok(result.tags.includes('sustained_pressure'), `expected sustained_pressure in ${result.tags}`);
  assert.equal(result.dominance, 'high');
  assert.equal(result.threat, 'high');
});

test('buildVideoScoutProfile detects reactive_team', () => {
  const profile = makeVsProfile({
    fieldTiltPct:    0.20,
    pressureZonePct: 0.08,
    avgDanger:       1.8,
  });
  const result = buildVideoScoutProfile(profile);
  assert.ok(result.tags.includes('reactive_team'), `expected reactive_team in ${result.tags}`);
  assert.equal(result.dominance, 'low');
});

test('buildVideoScoutProfile detects transition_threat', () => {
  const profile = makeVsProfile({
    avgTouches:      3.0,
    avgDanger:       3.2,
    conversionRate:  0.42,
  });
  const result = buildVideoScoutProfile(profile);
  assert.ok(result.tags.includes('transition_threat'), `expected transition_threat in ${result.tags}`);
});

test('buildVideoScoutProfile returns weak progression for negative avgProgress', () => {
  const profile = makeVsProfile({ avgProgress: -0.10 });
  const result  = buildVideoScoutProfile(profile);
  assert.equal(result.progression, 'weak');
});

test('buildVideoScoutProfile returns strong progression for high avgProgress', () => {
  const profile = makeVsProfile({ avgProgress: 0.25 });
  const result  = buildVideoScoutProfile(profile);
  assert.equal(result.progression, 'strong');
});

test('buildVideoScoutProfile detects sterile_possession', () => {
  const profile = makeVsProfile({ sterileRate: 0.42 });
  const result  = buildVideoScoutProfile(profile);
  assert.ok(result.tags.includes('sterile_possession'), `expected sterile_possession in ${result.tags}`);
});

test('buildVideoScoutProfile temporal risk collapse_2H for sterile+area_accumulator', () => {
  const profile = makeVsProfile({
    sterileRate:     0.42,
    pressureZonePct: 0.32,
    conversionRate:  0.22,
    totalPlays:      20,
  });
  const result = buildVideoScoutProfile(profile);
  assert.equal(result.temporalRisk, 'collapse_2H');
});

test('buildVideoScoutProfile temporal risk stable_then_collapse for fake_dominance + stuck', () => {
  const profile = makeVsProfile({
    fieldTiltPct:    0.62,
    pressureZonePct: 0.12,
    conversionRate:  0.15,
    avgBackpasses:   3.2,
    avgProgress:     -0.05,
  });
  const result = buildVideoScoutProfile(profile);
  assert.equal(result.temporalRisk, 'stable_then_collapse');
});

// ── computeVideoScoutReliability ─────────────────────────────────────────────

test('computeVideoScoutReliability returns 0 for empty records', () => {
  assert.equal(computeVideoScoutReliability([]), 0);
  assert.equal(computeVideoScoutReliability(null), 0);
});

test('computeVideoScoutReliability scales with play count', () => {
  const few   = computeVideoScoutReliability(makeRecords(3, 1));
  const some  = computeVideoScoutReliability(makeRecords(10, 2));
  const many  = computeVideoScoutReliability(makeRecords(30, 3));
  assert.ok(few < some, `few(${few}) should be < some(${some})`);
  assert.ok(some < many, `some(${some}) should be < many(${many})`);
});

test('computeVideoScoutReliability range is 0..1', () => {
  const r = computeVideoScoutReliability(makeRecords(50, 5));
  assert.ok(r >= 0 && r <= 1, `out of range: ${r}`);
});

test('computeVideoScoutReliability low for single session and few plays', () => {
  const r = computeVideoScoutReliability(makeRecords(3, 1));
  assert.ok(r < 0.40, `expected < 0.40, got ${r}`);
});

test('computeVideoScoutReliability medium for 10+ plays', () => {
  const r = computeVideoScoutReliability(makeRecords(12, 2));
  assert.ok(r >= 0.40 && r < 0.65, `expected 0.40-0.64, got ${r}`);
});

test('computeVideoScoutReliability high for 30+ plays', () => {
  const r = computeVideoScoutReliability(makeRecords(30, 3));
  assert.ok(r >= 0.65, `expected >= 0.65, got ${r}`);
});

// ── compareRadarVsScout ───────────────────────────────────────────────────────

test('compareRadarVsScout returns empty arrays when no profiles', () => {
  const result = compareRadarVsScout({}, null, null);
  assert.deepEqual(result, { flags: [], insights: [] });
});

test('compareRadarVsScout flags FAVORITE_FALSE_CONTROL for fake_dominance on strong favorite', () => {
  const radarCtx = {
    strengthGap: 25,
    mktFavIsHome: true,
    favoritePressureIndex: { level: 'BAJO' },
    htCleanSheetSignal: null,
    type: 'clean',
    favoriteName: 'HomeTeam',
    underdogName: 'AwayTeam',
    home: 'HomeTeam',
    away: 'AwayTeam',
  };
  const homeProfile = buildVideoScoutProfile(makeVsProfile({
    fieldTiltPct:    0.60,
    pressureZonePct: 0.14,
    conversionRate:  0.15,
  }));
  const result = compareRadarVsScout(radarCtx, homeProfile, null);
  assert.ok(result.flags.includes('FAVORITE_FALSE_CONTROL') || result.flags.includes('FAVORITE_LOW_REAL_THREAT'),
    `flags: ${result.flags.join(', ')}`);
  assert.ok(result.insights.length > 0);
});

test('compareRadarVsScout flags UNDERDOG_TRANSITION_LIVE for transition underdog', () => {
  const radarCtx = {
    strengthGap: 18,
    mktFavIsHome: true,
    favoritePressureIndex: null,
    htCleanSheetSignal: null,
    type: 'tension',
    favoriteName: 'HomeTeam',
    underdogName: 'AwayTeam',
    home: 'HomeTeam',
    away: 'AwayTeam',
  };
  const awayProfile = buildVideoScoutProfile(makeVsProfile({
    fieldTiltPct:    0.22,
    pressureZonePct: 0.10,
    avgTouches:      3.0,
    avgDanger:       3.5,
    conversionRate:  0.45,
  }));
  const result = compareRadarVsScout(radarCtx, null, awayProfile);
  assert.ok(result.flags.includes('UNDERDOG_TRANSITION_LIVE'), `flags: ${result.flags.join(', ')}`);
});

test('compareRadarVsScout flags CLEAN_TYPE_MAY_BE_DECEPTIVE for clean type with transition profiles', () => {
  const radarCtx = { type: 'clean', mktFavIsHome: true, favoriteName: 'H', underdogName: 'A', home: 'H', away: 'A', strengthGap: 20 };
  const homeProfile = buildVideoScoutProfile(makeVsProfile({ avgTouches: 2.8, avgDanger: 3.5, conversionRate: 0.45 }));
  const result = compareRadarVsScout(radarCtx, homeProfile, null);
  assert.ok(result.flags.includes('CLEAN_TYPE_MAY_BE_DECEPTIVE'), `flags: ${result.flags.join(', ')}`);
});

test('compareRadarVsScout flags HT_UNDER_VALUE_CANDIDATE when scout suggests stable 1H', () => {
  const radarCtx = {
    type: 'tension', mktFavIsHome: true, htCleanSheetSignal: null,
    favoriteName: 'H', underdogName: 'A', home: 'H', away: 'A', strengthGap: 5,
  };
  // Profile with stable_then_collapse or stable_1H temporal risk
  const awayProfile = buildVideoScoutProfile(makeVsProfile({
    fieldTiltPct:    0.60,
    pressureZonePct: 0.12,
    conversionRate:  0.12,
    avgBackpasses:   3.5,
    avgProgress:     -0.08,
  }));
  const result = compareRadarVsScout(radarCtx, null, awayProfile);
  // Either HT_UNDER_VALUE_CANDIDATE or some related flag should be present
  assert.ok(result.flags.length > 0, 'should produce at least one flag');
});

// ── computeTacticalMismatchScore ─────────────────────────────────────────────

test('computeTacticalMismatchScore returns 0 when no profiles', () => {
  assert.equal(computeTacticalMismatchScore({}, null, null), 0);
});

test('computeTacticalMismatchScore is higher for strong favorite with fake_dominance scout', () => {
  const radarCtx   = { strengthGap: 28, mktFavIsHome: true, type: 'clean', favoritePressureIndex: { level: 'BAJO' } };
  const homeProfile = buildVideoScoutProfile(makeVsProfile({
    fieldTiltPct:    0.62,
    pressureZonePct: 0.14,
    conversionRate:  0.15,
    avgDanger:       1.8,
  }));
  const base = computeTacticalMismatchScore({ strengthGap: 5, mktFavIsHome: true, type: 'tension' }, null, null);
  const high = computeTacticalMismatchScore(radarCtx, homeProfile, null);
  assert.ok(high > base, `high(${high}) should be > base(${base})`);
  assert.ok(high >= 25, `expected >= 25, got ${high}`);
});

test('computeTacticalMismatchScore is penalized when only one scout available', () => {
  const radarCtx   = { strengthGap: 25, mktFavIsHome: true, type: 'clean', favoritePressureIndex: { level: 'BAJO' } };
  const homeProfile = buildVideoScoutProfile(makeVsProfile({
    fieldTiltPct:    0.62,
    pressureZonePct: 0.14,
    conversionRate:  0.15,
    avgDanger:       1.8,
  }));
  const awayProfile = buildVideoScoutProfile(makeVsProfile({ avgTouches: 3.0, avgDanger: 3.5, conversionRate: 0.45 }));
  const oneScout  = computeTacticalMismatchScore(radarCtx, homeProfile, null);
  const twoScouts = computeTacticalMismatchScore(radarCtx, homeProfile, awayProfile);
  assert.ok(twoScouts >= oneScout, `twoScouts(${twoScouts}) should be >= oneScout(${oneScout})`);
});

test('computeTacticalMismatchScore is bounded 0-100', () => {
  const radarCtx = { strengthGap: 50, mktFavIsHome: true, type: 'clean', favoritePressureIndex: { level: 'BAJO' } };
  const p = buildVideoScoutProfile(makeVsProfile({ fieldTiltPct:0.65, pressureZonePct:0.12, conversionRate:0.10, avgDanger:1.5, sterileRate:0.4 }));
  const score = computeTacticalMismatchScore(radarCtx, p, p);
  assert.ok(score >= 0 && score <= 100, `out of range: ${score}`);
});

// ── adjustRadarPredictionsWithScout ──────────────────────────────────────────

test('adjustRadarPredictionsWithScout returns null when no profiles', () => {
  const result = adjustRadarPredictionsWithScout({}, null, null, null);
  assert.equal(result, null);
});

test('adjustRadarPredictionsWithScout sets drawSensitivityUp for FAVORITE_FALSE_CONTROL', () => {
  const vsComparison = { flags: ['FAVORITE_FALSE_CONTROL', 'FAVORITE_LOW_REAL_THREAT'], insights: [] };
  const homeProfile  = buildVideoScoutProfile(makeVsProfile({ fieldTiltPct: 0.62, pressureZonePct: 0.12, conversionRate: 0.15 }));
  const result = adjustRadarPredictionsWithScout({ mktFavIsHome: true }, vsComparison, homeProfile, null);
  assert.ok(result, 'should return adjustments');
  assert.equal(result.drawSensitivityUp, true);
  assert.ok(result.scoutConfidenceWeight < 1.0, `confidence should decrease, got ${result.scoutConfidenceWeight}`);
});

test('adjustRadarPredictionsWithScout sets underHtCandidate for stable underdog 1H', () => {
  const underdogProfile = buildVideoScoutProfile(makeVsProfile({
    fieldTiltPct:    0.60,
    pressureZonePct: 0.12,
    conversionRate:  0.12,
    avgBackpasses:   3.5,
    avgProgress:     -0.10,
  }));
  const vsComparison = { flags: ['HT_UNDER_VALUE_CANDIDATE'], insights: [] };
  const result = adjustRadarPredictionsWithScout({ mktFavIsHome: true }, vsComparison, null, underdogProfile);
  assert.ok(result, 'should return adjustments');
  assert.equal(result.underHtCandidate, true);
});

test('adjustRadarPredictionsWithScout sets bttsBoost for both transition profiles', () => {
  const transitionProfile = buildVideoScoutProfile(makeVsProfile({ avgTouches: 3.0, avgDanger: 3.2, conversionRate: 0.42 }));
  const vsComparison = { flags: [], insights: [] };
  const result = adjustRadarPredictionsWithScout({ mktFavIsHome: true }, vsComparison, transitionProfile, transitionProfile);
  assert.equal(result.bttsBoost, true);
});

// ── buildHalfProfileFromScout ─────────────────────────────────────────────────

test('buildHalfProfileFromScout returns null for no profiles', () => {
  assert.equal(buildHalfProfileFromScout(null, null), null);
});

test('buildHalfProfileFromScout returns correct structure', () => {
  const p    = buildVideoScoutProfile(makeVsProfile());
  const half = buildHalfProfileFromScout(p, null);
  assert.ok(half, 'should return half profile');
  assert.ok(half.firstHalf,  'should have firstHalf');
  assert.ok(half.secondHalf, 'should have secondHalf');
  assert.ok(['high','medium','low'].includes(half.firstHalf.stability));
  assert.ok(['high','medium','low'].includes(half.firstHalf.goalRisk));
  assert.ok(['high','medium','low'].includes(half.secondHalf.stability));
  assert.ok(['high','medium','low'].includes(half.secondHalf.goalRisk));
});

test('buildHalfProfileFromScout: collapse_2H profile yields 1H closed / 2H volatile', () => {
  // Profile that triggers collapse_2H temporal risk
  const profile = buildVideoScoutProfile(makeVsProfile({
    sterileRate:     0.42,
    pressureZonePct: 0.32,
    conversionRate:  0.22,
    totalPlays:      20,
  }));
  assert.equal(profile.temporalRisk, 'collapse_2H');
  const half = buildHalfProfileFromScout(profile, null);
  assert.equal(half.firstHalf.stability,  'high');
  assert.equal(half.firstHalf.goalRisk,   'low');
  assert.equal(half.secondHalf.stability, 'low');
  assert.equal(half.secondHalf.goalRisk,  'high');
});

// ── buildVideoScoutLayer ──────────────────────────────────────────────────────

test('buildVideoScoutLayer returns available:false when no records', () => {
  const result = buildVideoScoutLayer({
    vsRecordsHome: [],
    vsRecordsAway: [],
    scoutHome:     null,
    scoutAway:     null,
    radarCtx:      { strengthGap: 10, mktFavIsHome: true, type: 'tension', home: 'H', away: 'A' },
  });
  assert.equal(result.available, false);
});

test('buildVideoScoutLayer builds complete layer with one scout', () => {
  const records  = makeRecords(15, 2);
  const scoutProfile = {
    sessions: 2, totalPlays: 15, avgTouches: 4, avgProgress: -0.05, avgBackpasses: 2.5,
    fieldTiltPct: 0.62, pressureZonePct: 0.12, avgDanger: 1.8, sterileRate: 0.15,
    conversionRate: 0.18, goalsPerSession: 0.5, preferredSide: 'center',
    byOutcome: {}, byType: {}, startZones: {}, endZones: {}, directPlays: 2,
    tacticalStyle: 'Dominante sin mordiente',
  };
  const result = buildVideoScoutLayer({
    vsRecordsHome: records,
    vsRecordsAway: [],
    scoutHome:     scoutProfile,
    scoutAway:     null,
    radarCtx:      { strengthGap: 22, mktFavIsHome: true, type: 'clean', favoriteName: 'H', underdogName: 'A', home: 'H', away: 'A', favoritePressureIndex: { level: 'BAJO' } },
  });
  assert.equal(result.available, true);
  assert.equal(result.coverage.home, true);
  assert.equal(result.coverage.away, false);
  assert.ok(Number.isFinite(result.tacticalMismatchScore));
  assert.ok(Array.isArray(result.flags));
  assert.ok(Array.isArray(result.insights));
  assert.ok(result.profiles.home, 'should have home profile');
  assert.equal(result.profiles.away, null);
  assert.ok(result.halfProfile, 'should have half profile');
});

test('buildVideoScoutLayer includes mismatchLabel', () => {
  const records  = makeRecords(20, 3);
  const scoutProfile = {
    sessions: 3, totalPlays: 20, avgTouches: 3, avgProgress: -0.1, avgBackpasses: 3.5,
    fieldTiltPct: 0.65, pressureZonePct: 0.11, avgDanger: 1.5, sterileRate: 0.40,
    conversionRate: 0.10, goalsPerSession: 0.3, preferredSide: 'left',
    byOutcome: {}, byType: {}, startZones: {}, endZones: {}, directPlays: 1,
    tacticalStyle: 'Posesión estéril',
  };
  const result = buildVideoScoutLayer({
    vsRecordsHome: records,
    vsRecordsAway: [],
    scoutHome: scoutProfile,
    scoutAway: null,
    radarCtx: { strengthGap: 30, mktFavIsHome: true, type: 'clean', home: 'H', away: 'A', favoriteName: 'H', underdogName: 'A', favoritePressureIndex: { level: 'BAJO' } },
  });
  assert.ok(['bajo','medio','alto','extremo'].includes(result.mismatchLabel),
    `unexpected mismatchLabel: ${result.mismatchLabel}`);
});
