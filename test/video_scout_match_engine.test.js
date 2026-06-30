import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichPlay,
  computeTeamMetrics,
  computeDefensiveMetrics,
  buildTeamIdentity,
  buildMatchupDynamics,
  buildMatchScout,
} from '../src/footballlab/video_scout_match_engine.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRawPlay(overrides = {}) {
  return {
    id:      'p_test',
    type:    'attack_build',
    outcome: 'lost',
    points:  [{ nx: 0.1, ny: 0.5, t: 1000 }, { nx: 0.6, ny: 0.5, t: 2000 }],
    metrics: {
      touches:     5,
      netProgress: 0.12,
      backpasses:  1,
      startZone:   'def',
      endZone:     'att',
      side:        'center',
    },
    ...overrides,
  };
}

// Genera N jugadas enriquecidas ya listas (pasan por enrichPlay internamente en buildMatchScout)
function makePlays(n, overrides = {}) {
  return Array.from({ length: n }, (_, i) => makeRawPlay({
    id: `p_${i}`,
    type:    i % 3 === 0 ? 'shot_sequence' : i % 3 === 1 ? 'counter' : 'attack_build',
    outcome: i % 4 === 0 ? 'goal' : i % 4 === 1 ? 'saved' : 'lost',
    metrics: {
      touches:     4,
      netProgress: 0.1,
      backpasses:  1,
      startZone:   'def',
      endZone:     i % 2 === 0 ? 'att_box' : 'att',
      side:        'center',
    },
    ...overrides,
  }));
}

// ── enrichPlay ────────────────────────────────────────────────────────────────

test('enrichPlay: sets team', () => {
  const p = enrichPlay(makeRawPlay(), 'home');
  assert.equal(p.team, 'home');
});

test('enrichPlay: sets team=away', () => {
  const p = enrichPlay(makeRawPlay(), 'away');
  assert.equal(p.team, 'away');
});

test('enrichPlay: fallback team from rawPlay.team', () => {
  const p = enrichPlay({ ...makeRawPlay(), team: 'away' });
  assert.equal(p.team, 'away');
});

test('enrichPlay: returns null for null input', () => {
  assert.equal(enrichPlay(null, 'home'), null);
});

test('enrichPlay: zones.start maps att_box to box', () => {
  const p = enrichPlay(makeRawPlay({ metrics: { startZone: 'att_box', endZone: 'att_box', touches: 2, netProgress: 0.5, backpasses: 0, side: 'center' } }), 'home');
  assert.equal(p.zones.start, 'box');
  assert.equal(p.zones.end,   'box');
});

test('enrichPlay: zones.end preserves def/mid/att', () => {
  const p = enrichPlay(makeRawPlay({ metrics: { startZone: 'def', endZone: 'mid', touches: 3, netProgress: 0.1, backpasses: 0, side: 'left' } }), 'home');
  assert.equal(p.zones.start, 'def');
  assert.equal(p.zones.end,   'mid');
});

test('enrichPlay: isDangerous true for shot_sequence', () => {
  const p = enrichPlay(makeRawPlay({ type: 'shot_sequence' }), 'home');
  assert.equal(p.isDangerous, true);
});

test('enrichPlay: isDangerous true for outcome=goal', () => {
  const p = enrichPlay(makeRawPlay({ outcome: 'goal' }), 'home');
  assert.equal(p.isDangerous, true);
});

test('enrichPlay: isDangerous false for sterile_cycle', () => {
  const p = enrichPlay(makeRawPlay({ type: 'sterile_cycle', outcome: 'lost' }), 'home');
  assert.equal(p.isDangerous, false);
});

test('enrichPlay: isSterile true for sterile_cycle', () => {
  const p = enrichPlay(makeRawPlay({ type: 'sterile_cycle' }), 'home');
  assert.equal(p.isSterile, true);
});

test('enrichPlay: isSterile true for lost+negative progress', () => {
  const p = enrichPlay(makeRawPlay({ outcome: 'lost', metrics: { netProgress: -0.1, touches: 3, backpasses: 0, startZone: 'mid', endZone: 'mid', side: 'center' } }), 'home');
  assert.equal(p.isSterile, true);
});

test('enrichPlay: isHighQualityChance for shot_sequence', () => {
  const p = enrichPlay(makeRawPlay({ type: 'shot_sequence' }), 'home');
  assert.equal(p.isHighQualityChance, true);
});

test('enrichPlay: isHighQualityChance for counter+goal', () => {
  const p = enrichPlay(makeRawPlay({ type: 'counter', outcome: 'goal' }), 'home');
  assert.equal(p.isHighQualityChance, true);
});

test('enrichPlay: isHighQualityChance false for attack_build+lost', () => {
  const p = enrichPlay(makeRawPlay({ type: 'attack_build', outcome: 'lost' }), 'home');
  assert.equal(p.isHighQualityChance, false);
});

test('enrichPlay: touches taken from metrics when available', () => {
  const p = enrichPlay(makeRawPlay({ metrics: { touches: 7, netProgress: 0, backpasses: 2, startZone: 'mid', endZone: 'mid', side: 'center' } }), 'home');
  assert.equal(p.touches, 7);
});

test('enrichPlay: duration computed from points timestamps', () => {
  const p = enrichPlay(makeRawPlay({
    points: [{ nx: 0.1, ny: 0.5, t: 1000 }, { nx: 0.5, ny: 0.5, t: 3000 }],
  }), 'home');
  assert.equal(p.duration, 2000);
});

test('enrichPlay: duration is 0 for single point', () => {
  const p = enrichPlay(makeRawPlay({ points: [{ nx: 0.5, ny: 0.5, t: 1000 }] }), 'home');
  assert.equal(p.duration, 0);
});

test('enrichPlay: progressionScore is a number 0-10', () => {
  const p = enrichPlay(makeRawPlay(), 'home');
  assert.ok(typeof p.progressionScore === 'number');
  assert.ok(p.progressionScore >= 0 && p.progressionScore <= 10);
});

// ── computeTeamMetrics ───────────────────────────────────────────────────────

test('computeTeamMetrics returns null for empty array', () => {
  assert.equal(computeTeamMetrics([]), null);
  assert.equal(computeTeamMetrics(null), null);
});

test('computeTeamMetrics returns correct totalPlays', () => {
  const plays = makePlays(8).map(p => enrichPlay(p, 'home'));
  const m = computeTeamMetrics(plays);
  assert.equal(m.totalPlays, 8);
});

test('computeTeamMetrics fieldTilt includes att and box plays', () => {
  // All plays end in att_box → fieldTilt should be high after enrichPlay maps att_box→box
  const plays = Array.from({ length: 4 }, () => enrichPlay(makeRawPlay({ metrics: { touches: 3, netProgress: 0.2, backpasses: 0, startZone: 'mid', endZone: 'att_box', side: 'center' } }), 'home'));
  const m = computeTeamMetrics(plays);
  assert.ok(m.fieldTilt > 0.5, `expected > 0.5, got ${m.fieldTilt}`);
  assert.ok(m.areaPct > 0.5, `expected areaPct > 0.5, got ${m.areaPct}`);
});

test('computeTeamMetrics conversionPct correct', () => {
  const plays = [
    enrichPlay(makeRawPlay({ type: 'shot_sequence', outcome: 'goal' }), 'home'),
    enrichPlay(makeRawPlay({ type: 'shot_sequence', outcome: 'saved' }), 'home'),
    enrichPlay(makeRawPlay({ type: 'shot_sequence', outcome: 'saved' }), 'home'),
    enrichPlay(makeRawPlay({ type: 'shot_sequence', outcome: 'saved' }), 'home'),
  ];
  const m = computeTeamMetrics(plays);
  assert.equal(m.shots, 4);
  assert.equal(m.goals, 1);
  assert.ok(Math.abs(m.conversionPct - 0.25) < 0.001, `expected 0.25 got ${m.conversionPct}`);
});

test('computeTeamMetrics dangerScore higher for dangerous plays', () => {
  const dangerPlays   = Array.from({ length: 4 }, () => enrichPlay(makeRawPlay({ type: 'shot_sequence' }), 'home'));
  const safePlays     = Array.from({ length: 4 }, () => enrichPlay(makeRawPlay({ type: 'sterile_cycle' }), 'home'));
  const mDanger = computeTeamMetrics(dangerPlays);
  const mSafe   = computeTeamMetrics(safePlays);
  assert.ok(mDanger.dangerScore > mSafe.dangerScore, `danger:${mDanger.dangerScore} should > safe:${mSafe.dangerScore}`);
});

test('computeTeamMetrics dominantFlank detected', () => {
  const plays = [
    enrichPlay(makeRawPlay({ metrics: { touches: 3, netProgress: 0.1, backpasses: 0, startZone: 'mid', endZone: 'att', side: 'left' } }), 'home'),
    enrichPlay(makeRawPlay({ metrics: { touches: 3, netProgress: 0.1, backpasses: 0, startZone: 'mid', endZone: 'att', side: 'left' } }), 'home'),
    enrichPlay(makeRawPlay({ metrics: { touches: 3, netProgress: 0.1, backpasses: 0, startZone: 'mid', endZone: 'att', side: 'center' } }), 'home'),
  ];
  const m = computeTeamMetrics(plays);
  assert.equal(m.dominantFlank, 'left');
});

test('computeTeamMetrics sterileSPI for all sterile plays', () => {
  const plays = Array.from({ length: 4 }, () => enrichPlay(makeRawPlay({ type: 'sterile_cycle' }), 'home'));
  const m = computeTeamMetrics(plays);
  assert.ok(m.sterileSPI >= 0.9, `expected >= 0.9 got ${m.sterileSPI}`);
});

test('computeTeamMetrics has all required fields', () => {
  const plays = makePlays(5).map(p => enrichPlay(p, 'home'));
  const m = computeTeamMetrics(plays);
  const required = [
    'totalPlays','sequences','avgTouchesPerSequence','fieldTilt','areaPct',
    'dangerScore','dangerousPlaysRatio','shotsLikeEvents','conversionPct','goalPerDanger',
    'netProgression','backPassesPerSequence','stalledSequencesRatio',
    'sterileSPI','effectiveAttackRatio','dominantFlank','goals','shots',
  ];
  required.forEach(f => assert.ok(f in m, `missing field: ${f}`));
});

// ── computeDefensiveMetrics ──────────────────────────────────────────────────

test('computeDefensiveMetrics returns null for empty array', () => {
  assert.equal(computeDefensiveMetrics([]), null);
  assert.equal(computeDefensiveMetrics(null), null);
});

test('computeDefensiveMetrics has all required fields', () => {
  const plays = makePlays(6).map(p => enrichPlay(p, 'away'));
  const d = computeDefensiveMetrics(plays);
  const required = ['opponentDangerConceded','opponentAreaAllowed','opponentConversionFaced','pressureResistance'];
  required.forEach(f => assert.ok(f in d, `missing field: ${f}`));
});

test('computeDefensiveMetrics opponentDangerConceded high for dangerous opponent', () => {
  const plays = Array.from({ length: 6 }, () => enrichPlay(makeRawPlay({ type: 'shot_sequence', outcome: 'saved' }), 'away'));
  const d = computeDefensiveMetrics(plays);
  assert.ok(d.opponentDangerConceded >= 0.9, `expected >= 0.9, got ${d.opponentDangerConceded}`);
});

test('computeDefensiveMetrics opponentConversionFaced correct', () => {
  const plays = [
    enrichPlay(makeRawPlay({ type: 'shot_sequence', outcome: 'goal' }), 'away'),
    enrichPlay(makeRawPlay({ type: 'shot_sequence', outcome: 'saved' }), 'away'),
  ];
  const d = computeDefensiveMetrics(plays);
  assert.ok(Math.abs(d.opponentConversionFaced - 0.5) < 0.001, `expected 0.5 got ${d.opponentConversionFaced}`);
});

test('computeDefensiveMetrics pressureResistance high when opponent stalled', () => {
  const plays = Array.from({ length: 4 }, () => enrichPlay(makeRawPlay({ metrics: { touches: 3, netProgress: -0.1, backpasses: 2, startZone: 'mid', endZone: 'mid', side: 'center' } }), 'away'));
  const d = computeDefensiveMetrics(plays);
  assert.ok(d.pressureResistance >= 0.9, `expected >= 0.9, got ${d.pressureResistance}`);
});

// ── buildTeamIdentity ────────────────────────────────────────────────────────

test('buildTeamIdentity returns empty for null metrics', () => {
  const id = buildTeamIdentity(null);
  assert.deepEqual(id.tags, []);
  assert.deepEqual(id.strengths, []);
  assert.deepEqual(id.weaknesses, []);
});

test('buildTeamIdentity detects fake_dominance', () => {
  const metrics = {
    fieldTilt: 0.60, areaPct: 0.10, dangerScore: 1.8, conversionPct: 0.15,
    totalPlays: 10, sterileSPI: 0.1, netProgression: 0.05,
    stalledSequencesRatio: 0.2, dangerousPlaysRatio: 0.3, avgTouchesPerSequence: 4, goals: 1,
  };
  const id = buildTeamIdentity(metrics);
  assert.ok(id.tags.includes('fake_dominance'), `tags: ${id.tags.join(',')}`);
  assert.ok(id.weaknesses.length > 0);
});

test('buildTeamIdentity detects sustained_pressure', () => {
  const metrics = {
    fieldTilt: 0.60, areaPct: 0.35, dangerScore: 3.5, conversionPct: 0.40,
    totalPlays: 12, sterileSPI: 0.05, netProgression: 0.20,
    stalledSequencesRatio: 0.1, dangerousPlaysRatio: 0.6, avgTouchesPerSequence: 4, goals: 3,
  };
  const id = buildTeamIdentity(metrics);
  assert.ok(id.tags.includes('sustained_pressure'), `tags: ${id.tags.join(',')}`);
  assert.ok(id.strengths.length > 0);
});

test('buildTeamIdentity detects sterile_possession', () => {
  const metrics = {
    fieldTilt: 0.45, areaPct: 0.10, dangerScore: 1.5, conversionPct: 0.10,
    totalPlays: 20, sterileSPI: 0.40, netProgression: 0.02,
    stalledSequencesRatio: 0.3, dangerousPlaysRatio: 0.1, avgTouchesPerSequence: 6, goals: 0,
  };
  const id = buildTeamIdentity(metrics);
  assert.ok(id.tags.includes('sterile_possession'), `tags: ${id.tags.join(',')}`);
});

test('buildTeamIdentity detects transition_threat', () => {
  const metrics = {
    fieldTilt: 0.30, areaPct: 0.20, dangerScore: 3.5, conversionPct: 0.40,
    totalPlays: 10, sterileSPI: 0.05, netProgression: 0.15,
    stalledSequencesRatio: 0.1, dangerousPlaysRatio: 0.5, avgTouchesPerSequence: 3.0, goals: 3,
  };
  const id = buildTeamIdentity(metrics);
  assert.ok(id.tags.includes('transition_threat'), `tags: ${id.tags.join(',')}`);
});

test('buildTeamIdentity detects reactive_team for low territory', () => {
  const metrics = {
    fieldTilt: 0.20, areaPct: 0.05, dangerScore: 1.5, conversionPct: 0.10,
    totalPlays: 8, sterileSPI: 0.1, netProgression: -0.05,
    stalledSequencesRatio: 0.2, dangerousPlaysRatio: 0.1, avgTouchesPerSequence: 4, goals: 0,
  };
  const id = buildTeamIdentity(metrics);
  assert.ok(id.tags.includes('reactive_team'), `tags: ${id.tags.join(',')}`);
});

test('buildTeamIdentity detects direct_team', () => {
  const metrics = {
    fieldTilt: 0.45, areaPct: 0.20, dangerScore: 3.0, conversionPct: 0.30,
    totalPlays: 8, sterileSPI: 0.05, netProgression: 0.20,
    stalledSequencesRatio: 0.1, dangerousPlaysRatio: 0.4, avgTouchesPerSequence: 2.5, goals: 2,
  };
  const id = buildTeamIdentity(metrics);
  assert.ok(id.tags.includes('direct_team'), `tags: ${id.tags.join(',')}`);
});

test('buildTeamIdentity detects chaotic_team', () => {
  const metrics = {
    fieldTilt: 0.40, areaPct: 0.10, dangerScore: 1.8, conversionPct: 0.10,
    totalPlays: 15, sterileSPI: 0.20, netProgression: 0.01,
    stalledSequencesRatio: 0.55, dangerousPlaysRatio: 0.1, avgTouchesPerSequence: 5, goals: 1,
  };
  const id = buildTeamIdentity(metrics);
  assert.ok(id.tags.includes('chaotic_team'), `tags: ${id.tags.join(',')}`);
  assert.ok(id.weaknesses.length > 0);
});

test('buildTeamIdentity detects late_explosion', () => {
  const metrics = {
    fieldTilt: 0.35, areaPct: 0.25, dangerScore: 3.0, conversionPct: 0.50,
    totalPlays: 10, sterileSPI: 0.1, netProgression: 0.15,
    stalledSequencesRatio: 0.1, dangerousPlaysRatio: 0.4, avgTouchesPerSequence: 3, goals: 3,
  };
  const id = buildTeamIdentity(metrics);
  assert.ok(id.tags.includes('late_explosion'), `tags: ${id.tags.join(',')}`);
});

test('buildTeamIdentity stable_first_half requires sustained_pressure', () => {
  const metrics = {
    fieldTilt: 0.62, areaPct: 0.30, dangerScore: 3.5, conversionPct: 0.40,
    totalPlays: 12, sterileSPI: 0.05, netProgression: 0.20,
    stalledSequencesRatio: 0.1, dangerousPlaysRatio: 0.55, avgTouchesPerSequence: 4, goals: 3,
  };
  const id = buildTeamIdentity(metrics);
  assert.ok(id.tags.includes('stable_first_half'), `tags: ${id.tags.join(',')}`);
  assert.ok(id.tags.includes('sustained_pressure'));
});

// ── buildMatchupDynamics ─────────────────────────────────────────────────────

test('buildMatchupDynamics returns null when both metrics null', () => {
  assert.equal(buildMatchupDynamics(null, null), null);
});

test('buildMatchupDynamics detects home as proposer when higher fieldTilt', () => {
  const h = { fieldTilt: 0.65, dangerScore: 2.5, avgTouchesPerSequence: 4, stalledSequencesRatio: 0.2, sterileSPI: 0.1 };
  const a = { fieldTilt: 0.25, dangerScore: 2.0, avgTouchesPerSequence: 4, stalledSequencesRatio: 0.2, sterileSPI: 0.1 };
  const d = buildMatchupDynamics(h, a);
  assert.equal(d.proposes, 'home');
  assert.equal(d.reacts, 'away');
});

test('buildMatchupDynamics detects TERRITORIAL_IMBALANCE', () => {
  const h = { fieldTilt: 0.70, dangerScore: 2.5, avgTouchesPerSequence: 4, stalledSequencesRatio: 0.2, sterileSPI: 0.1 };
  const a = { fieldTilt: 0.30, dangerScore: 2.0, avgTouchesPerSequence: 4, stalledSequencesRatio: 0.2, sterileSPI: 0.1 };
  const d = buildMatchupDynamics(h, a);
  assert.ok(d.flags.includes('TERRITORIAL_IMBALANCE'), `flags: ${d.flags.join(',')}`);
});

test('buildMatchupDynamics type=deceptive when home controls but away more dangerous', () => {
  const h = { fieldTilt: 0.65, dangerScore: 2.0, avgTouchesPerSequence: 4, stalledSequencesRatio: 0.2, sterileSPI: 0.1 };
  const a = { fieldTilt: 0.25, dangerScore: 3.5, avgTouchesPerSequence: 4, stalledSequencesRatio: 0.2, sterileSPI: 0.1 };
  const d = buildMatchupDynamics(h, a);
  assert.equal(d.type, 'deceptive');
  assert.ok(d.flags.includes('HOME_CONTROL_WITH_COUNTER_RISK'), `flags: ${d.flags.join(',')}`);
});

test('buildMatchupDynamics type=transition-heavy for both direct+dangerous', () => {
  const h = { fieldTilt: 0.45, dangerScore: 3.5, avgTouchesPerSequence: 3.0, stalledSequencesRatio: 0.1, sterileSPI: 0.1 };
  const a = { fieldTilt: 0.40, dangerScore: 3.2, avgTouchesPerSequence: 2.8, stalledSequencesRatio: 0.1, sterileSPI: 0.1 };
  const d = buildMatchupDynamics(h, a);
  assert.equal(d.type, 'transition-heavy');
  assert.ok(d.flags.includes('BOTH_TRANSITION_TEAMS'), `flags: ${d.flags.join(',')}`);
});

test('buildMatchupDynamics type=chaotic when both teams disorganized', () => {
  const h = { fieldTilt: 0.40, dangerScore: 1.8, avgTouchesPerSequence: 5, stalledSequencesRatio: 0.50, sterileSPI: 0.40 };
  const a = { fieldTilt: 0.35, dangerScore: 1.5, avgTouchesPerSequence: 5, stalledSequencesRatio: 0.45, sterileSPI: 0.38 };
  const d = buildMatchupDynamics(h, a);
  assert.equal(d.type, 'chaotic');
  assert.ok(d.flags.includes('BOTH_TEAMS_DISORGANIZED'), `flags: ${d.flags.join(',')}`);
});

test('buildMatchupDynamics type=deceptive for territory/danger mismatch', () => {
  const h = { fieldTilt: 0.65, dangerScore: 1.5, avgTouchesPerSequence: 5, stalledSequencesRatio: 0.2, sterileSPI: 0.2 };
  const a = { fieldTilt: 0.28, dangerScore: 3.5, avgTouchesPerSequence: 3, stalledSequencesRatio: 0.1, sterileSPI: 0.0 };
  const d = buildMatchupDynamics(h, a);
  assert.ok(['deceptive'].includes(d.type), `type: ${d.type}`);
});

// ── buildMatchScout ──────────────────────────────────────────────────────────

test('buildMatchScout returns correct structure for empty inputs', () => {
  const result = buildMatchScout([], []);
  assert.ok('home' in result && 'away' in result && 'matchup' in result);
  assert.equal(result.home.metrics, null);
  assert.equal(result.away.metrics, null);
  assert.equal(result.matchup, null);
});

test('buildMatchScout home and away plays are never mixed', () => {
  const homePlays = makePlays(5);
  const awayPlays = makePlays(4, { type: 'counter', outcome: 'goal' });
  const result = buildMatchScout(homePlays, awayPlays);
  assert.equal(result.home.metrics?.totalPlays, 5, 'home should have 5 plays');
  assert.equal(result.away.metrics?.totalPlays, 4, 'away should have 4 plays');
});

test('buildMatchScout home defense comes from away plays', () => {
  const homePlays = makePlays(3);
  const awayPlays = Array.from({ length: 5 }, () => makeRawPlay({ type: 'shot_sequence', outcome: 'goal' }));
  const result = buildMatchScout(homePlays, awayPlays);
  // Home defense = what away did → all dangerous plays → high opponentDangerConceded
  assert.ok(result.home.defense.opponentDangerConceded >= 0.9,
    `expected >= 0.9, got ${result.home.defense.opponentDangerConceded}`);
});

test('buildMatchScout away defense comes from home plays', () => {
  const homePlays = Array.from({ length: 5 }, () => makeRawPlay({ type: 'sterile_cycle', outcome: 'lost' }));
  const awayPlays = makePlays(3);
  const result = buildMatchScout(homePlays, awayPlays);
  // Away defense = what home did → all sterile → low opponentDangerConceded
  assert.ok(result.away.defense.opponentDangerConceded < 0.1,
    `expected < 0.1, got ${result.away.defense.opponentDangerConceded}`);
});

test('buildMatchScout has identity, strengths, weaknesses arrays', () => {
  const result = buildMatchScout(makePlays(6), makePlays(6));
  assert.ok(Array.isArray(result.home.identity),  'home.identity should be array');
  assert.ok(Array.isArray(result.home.strengths), 'home.strengths should be array');
  assert.ok(Array.isArray(result.home.weaknesses),'home.weaknesses should be array');
  assert.ok(Array.isArray(result.away.identity),  'away.identity should be array');
});

test('buildMatchScout matchup has type and flags', () => {
  const result = buildMatchScout(makePlays(6), makePlays(6));
  assert.ok(result.matchup, 'matchup should exist');
  assert.ok(typeof result.matchup.type === 'string',  'matchup.type should be string');
  assert.ok(Array.isArray(result.matchup.flags),      'matchup.flags should be array');
  assert.ok(['home','away'].includes(result.matchup.proposes), 'matchup.proposes should be home or away');
});

test('buildMatchScout detects transition-heavy matchup', () => {
  // Both teams: few touches, dangerous plays
  const counterPlays = Array.from({ length: 8 }, () => makeRawPlay({
    type: 'counter',
    outcome: 'goal',
    metrics: { touches: 2, netProgress: 0.4, backpasses: 0, startZone: 'def', endZone: 'att_box', side: 'center' },
  }));
  const result = buildMatchScout(counterPlays, counterPlays);
  assert.equal(result.matchup.type, 'transition-heavy');
});

test('buildMatchScout detects fake_dominance identity', () => {
  // Home: lots of territory, low area, low danger
  const homePlays = Array.from({ length: 10 }, () => makeRawPlay({
    type:    'attack_build',
    outcome: 'lost',
    metrics: { touches: 5, netProgress: 0.1, backpasses: 1, startZone: 'mid', endZone: 'att', side: 'center' },
  }));
  const awayPlays = makePlays(4);
  const result = buildMatchScout(homePlays, awayPlays);
  // fieldTilt high (all end at att), areaPct low (none in box), dangerScore low (attack_build=1)
  assert.ok(result.home.identity.includes('fake_dominance'),
    `home.identity: ${result.home.identity.join(',')}`);
});
