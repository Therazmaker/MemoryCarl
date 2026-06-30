import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSignalContextScore,
  computeSessionProfile,
  computeContextBucket,
  getContextLabel,
  buildContextDashboard
} from '../src/patternlab/context-engine.js';

test('getContextLabel maps score bands', ()=>{
  assert.equal(getContextLabel(90), 'Strong');
  assert.equal(getContextLabel(72), 'Favorable');
  assert.equal(getContextLabel(58), 'Neutral');
  assert.equal(getContextLabel(44), 'Weak');
  assert.equal(getContextLabel(10), 'Poor');
});

test('computeSessionProfile identifies sideways noise', ()=>{
  const candles = [
    { open: 100, high: 103, low: 99, close: 100.2 },
    { open: 100.2, high: 102.9, low: 99.5, close: 100.1 },
    { open: 100.1, high: 103.1, low: 99.7, close: 100.0 },
    { open: 100.0, high: 103.2, low: 99.8, close: 100.1 }
  ];
  const profile = computeSessionProfile({ candles });
  assert.equal(profile.label, 'Sideways Noise');
});

test('computeContextBucket groups reclaim + favorable session', ()=>{
  const bucket = computeContextBucket(
    { reclaimQuality: 0.8, expansionScore: 0.7 },
    {},
    { label: 'Trend Session' }
  );
  assert.equal(bucket, 'reclaim + favorable session');
});

test('computeSignalContextScore returns caution on missing data', ()=>{
  const result = computeSignalContextScore({ side: 'long' }, {}, [], {});
  assert.ok(result.caution.includes('Limited context available'));
  assert.equal(result.sessionProfile.confidence, 'low');
});

test('buildContextDashboard aggregates labels and buckets', ()=>{
  const signals = [
    { id: 's1', side: 'long', review: 'win', mfe: 2.1, mae: -0.7, reclaimQuality: 0.8, expansionScore: 0.7, structure: { continuity: 0.8, expansion: 0.7, noise: 0.2 }, analyticalRead: { clarity: 0.8, alignment: 0.8 }, surroundingCandles: [{ o:1,h:2,l:0.8,c:1.9 },{ o:1.9,h:2.5,l:1.8,c:2.4 }] },
    { id: 's2', side: 'long', review: 'loss', mfe: 0.6, mae: -1.4, reclaimQuality: 0.2, expansionScore: 0.2, structure: { continuity: 0.3, expansion: 0.2, noise: 0.7 }, analyticalRead: { clarity: 0.3, alignment: 0.2 }, surroundingCandles: [{ o:2,h:2.2,l:1.4,c:1.7 },{ o:1.7,h:2.0,l:1.3,c:1.6 }] },
    { id: 's3', side: 'short', review: 'skip', mfe: 1.2, mae: -0.8, reclaimQuality: 0.5, expansionScore: 0.4, structure: { continuity: 0.5, expansion: 0.4, noise: 0.4 }, analyticalRead: { clarity: 0.5, alignment: 0.5 }, surroundingCandles: [{ o:3,h:3.4,l:2.9,c:3.0 },{ o:3.0,h:3.2,l:2.7,c:2.8 }] },
    { id: 's4', side: 'short', review: 'win', mfe: 1.8, mae: -0.5, reclaimQuality: 0.7, expansionScore: 0.6, structure: { continuity: 0.75, expansion: 0.6, noise: 0.25 }, analyticalRead: { clarity: 0.7, alignment: 0.8 }, surroundingCandles: [{ o:3,h:2.9,l:2.3,c:2.4 },{ o:2.4,h:2.6,l:2.0,c:2.1 }] },
    { id: 's5', side: 'long', review: 'loss', mfe: 0.9, mae: -1.1, reclaimQuality: 0.4, expansionScore: 0.3, structure: { continuity: 0.4, expansion: 0.3, noise: 0.55 }, analyticalRead: { clarity: 0.45, alignment: 0.4 }, surroundingCandles: [{ o:1.4,h:1.9,l:1.3,c:1.5 },{ o:1.5,h:1.8,l:1.2,c:1.4 }] }
  ];

  const dashboard = buildContextDashboard(signals, {}, {});
  assert.equal(dashboard.hasSample, true);
  assert.ok(dashboard.byLabel.length > 0);
  assert.ok(dashboard.byBucket.length > 0);
});
