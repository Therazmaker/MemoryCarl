import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMneClaudeExport,
  parseClaudeFeedbackText,
  updateClaudeMemoryState,
  observeAuditAgainstMatch,
  classifyAuditObservation,
  createLearningAuditFromFeedback,
  EXPORT_SCHEMA,
  FEEDBACK_SCHEMA
} from '../src/footballlab/mne_claude_exchange.js';

test('buildMneClaudeExport returns stable export schema', ()=>{
  const payload = buildMneClaudeExport({
    match: { id: 'sim_1', home: 'A', away: 'B', competition: 'Liga', status: 'simulation' },
    vision: {
      score: { home: 1, away: 0 },
      probs: { home: 0.5, draw: 0.25, away: 0.25 },
      mne: {
        narrative: [{ phase: '0-15', title: 'Inicio', tags: ['press'], notes: ['alto ritmo'], confidence: 0.72, confidenceMeta: { completeness: 0.66 } }],
        keyRisks: [{ tag: 'late_pressure', side: 'away' }],
        liveTriggers: [{ if: 'corner', then: 'goal', weight: 0.2 }]
      }
    }
  });
  assert.equal(payload.schemaVersion, EXPORT_SCHEMA);
  assert.equal(payload.match.id, 'sim_1');
  assert.equal(payload.segments.length, 1);
  assert.equal(payload.liveTriggers.length, 1);
});

test('parseClaudeFeedbackText accepts valid payload', ()=>{
  const raw = {
    schemaVersion: FEEDBACK_SCHEMA,
    generatedAt: new Date().toISOString(),
    matchRef: { id: 'sim_1', home: 'A', away: 'B' },
    evaluation: { accuracy: 0.88, summary: 'good', agreementLevel: 'high' },
    missedSignals: [{ type: 'tempo', detail: 'faltó', importance: 'high' }],
    patternInsights: [{ name: 'pattern1', detail: 'x', reusability: 'medium' }],
    newRules: [{ id: 'r1', name: 'Rule 1', logic: 'if x', effect: 'boost', confidence: 0.7 }],
    trainingNotes: ['revisar var']
  };
  const parsed = parseClaudeFeedbackText(JSON.stringify(raw));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.schemaVersion, FEEDBACK_SCHEMA);
  assert.equal(parsed.data.newRules.length, 1);
});

test('parseClaudeFeedbackText rejects broken JSON or schema', ()=>{
  const broken = parseClaudeFeedbackText('{invalid}');
  assert.equal(broken.ok, false);
  const wrongSchema = parseClaudeFeedbackText(JSON.stringify({ schemaVersion: 'x', matchRef: {} }));
  assert.equal(wrongSchema.ok, false);
});

test('updateClaudeMemoryState stores history and reusable items', ()=>{
  const feedback = {
    newRules: [{ id: 'r1', name: 'Rule 1' }],
    patternInsights: [{ name: 'slow_start', detail: '...' }],
    trainingNotes: ['note']
  };
  const next = updateClaudeMemoryState({}, { matchId: 'sim_1', feedback });
  assert.equal(next.claudeExchange.historyByMatch.sim_1.length, 1);
  assert.equal(next.claudeExchange.candidateRules.length, 1);
  assert.equal(next.claudeExchange.patterns.length, 1);
});


test('createLearningAuditFromFeedback bootstraps tracked items and metrics', ()=>{
  const feedback = {
    evaluation: { accuracy: 0.8, agreementLevel: 'medium', summary: 'ok' },
    missedSignals: [{ type: 'emotional_game_state', detail: 'faltó lectura emocional' }],
    newRules: [{ id: 'boost_game_state_control', name: 'Control marcador', logic: 'if close game', effect: 'boost control' }],
    patternInsights: [{ name: 'late_shift', detail: 'cambio en cierre' }]
  };
  const audit = createLearningAuditFromFeedback(feedback, { matchId: 'sim_1', importedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(audit.sourceMatchId, 'sim_1');
  assert.equal(audit.observations.length, 0);
  assert.equal(audit.metrics.totalObservedMatches, 0);
  assert.ok(audit.trackedItems.length >= 3);
});

test('observeAuditAgainstMatch classifies improved when signal appears and rule evidence exists', ()=>{
  const audit = createLearningAuditFromFeedback({
    missedSignals: [{ type: 'territorial_pressure', detail: 'faltó control territorial' }],
    newRules: [{ id: 'boost_game_state_control', name: 'Control', logic: 'control', effect: 'territorial' }]
  }, { matchId: 'sim_seed' });
  const next = observeAuditAgainstMatch(audit, {
    matchId: 'sim_2',
    observedAt: '2026-01-02T00:00:00.000Z',
    triggerIds: ['boost_game_state_control:if close game'],
    derivedTags: { territorial_pressure: 0.55 },
    evidenceEvents: 5,
    narrative: 'mejor control del cierre'
  });
  assert.equal(next.observations.length, 1);
  assert.equal(next.observations[0].status, 'improved');
  assert.equal(next.metrics.improvements, 1);
});

test('observeAuditAgainstMatch yields unchanged/regressed/not_triggered conservatively', ()=>{
  const audit = createLearningAuditFromFeedback({
    missedSignals: [{ type: 'finishing_failure', detail: 'sobreuso de finishing_failure' }]
  }, { matchId: 'sim_seed' });

  const unchanged = observeAuditAgainstMatch(audit, {
    matchId: 'sim_3',
    derivedTags: { finishing_failure: 0.35 },
    evidenceEvents: 4,
    narrative: 'sin cambios claros'
  });
  assert.equal(unchanged.observations[0].status, 'unchanged');

  const regressed = observeAuditAgainstMatch(audit, {
    matchId: 'sim_4',
    derivedTags: { finishing_failure: 0.82 },
    evidenceEvents: 6,
    narrative: 'múltiples fallos de definición'
  });
  assert.equal(regressed.observations[0].status, 'regressed');

  const notTriggered = observeAuditAgainstMatch(audit, {
    matchId: 'sim_5',
    derivedTags: {},
    evidenceEvents: 0,
    narrative: ''
  });
  assert.equal(notTriggered.observations[0].status, 'not_triggered');
});

test('classifyAuditObservation handles empty and mixed states', ()=>{
  assert.equal(classifyAuditObservation([]), 'not_triggered');
  assert.equal(classifyAuditObservation([{ status: 'not_triggered' }, { status: 'unchanged' }]), 'unchanged');
  assert.equal(classifyAuditObservation([{ status: 'improved' }, { status: 'unchanged' }]), 'improved');
  assert.equal(classifyAuditObservation([{ status: 'regressed' }, { status: 'improved' }]), 'regressed');
});
