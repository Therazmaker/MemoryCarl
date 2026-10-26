import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};
globalThis.window = globalThis.window || globalThis;

const { normalizeClaudeModel, CLAUDE_MODELS } = await import('../src/services/claudeClient.js');

test('normalizeClaudeModel migra modelos retirados a modelos vigentes', () => {
  assert.equal(normalizeClaudeModel('claude-3-5-haiku-20241022'), 'claude-haiku-4-5');
  assert.equal(normalizeClaudeModel('claude-3-5-sonnet-20241022'), 'claude-sonnet-4-5');
  assert.equal(normalizeClaudeModel('claude-3-7-sonnet-latest'), 'claude-sonnet-4-5');
});

test('normalizeClaudeModel conserva modelos vigentes y usa Haiku 4.5 por defecto', () => {
  assert.equal(normalizeClaudeModel('claude-haiku-4-5'), 'claude-haiku-4-5');
  assert.equal(normalizeClaudeModel('claude-sonnet-4-5'), 'claude-sonnet-4-5');
  assert.equal(normalizeClaudeModel(''), 'claude-haiku-4-5');
  assert.equal(normalizeClaudeModel(undefined), 'claude-haiku-4-5');
});

test('CLAUDE_MODELS no ofrece modelos retirados', () => {
  const ids = CLAUDE_MODELS.map((m) => m.id);
  assert.ok(ids.includes('claude-haiku-4-5'));
  assert.ok(!ids.some((id) => id.startsWith('claude-3-')));
});
