import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMneClaudeExport,
  parseClaudeFeedbackText,
  updateClaudeMemoryState,
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
