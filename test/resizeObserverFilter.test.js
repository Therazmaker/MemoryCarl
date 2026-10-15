import test from 'node:test';
import assert from 'node:assert/strict';

test('ResizeObserver error filter ignores benign ResizeObserver loop errors', () => {
  const logs = [];
  let rescueTriggered = false;

  const handleConsoleLog = (e) => {
    if (e && e.message && e.message.includes('ResizeObserver loop')) return;
    logs.push(`Error: ${e.message}`);
  };

  const handleRescueTrigger = (e) => {
    if (e && e.message && e.message.includes('ResizeObserver loop')) return;
    rescueTriggered = true;
  };

  // 1. Simulate ResizeObserver loop completed error
  const resizeObserverError = {
    message: 'ResizeObserver loop completed with undelivered notifications.',
    filename: 'https://therazmaker.github.io/MemoryCarl/src/main.js',
    lineno: 0,
    colno: 0
  };

  handleConsoleLog(resizeObserverError);
  handleRescueTrigger(resizeObserverError);

  assert.equal(logs.length, 0, 'ResizeObserver error should not be logged');
  assert.equal(rescueTriggered, false, 'ResizeObserver error should not trigger rescue banner');

  // 2. Simulate standard uncaught error
  const standardError = {
    message: 'Uncaught ReferenceError: foo is not defined',
    filename: 'https://therazmaker.github.io/MemoryCarl/src/main.js',
    lineno: 42,
    colno: 10
  };

  handleConsoleLog(standardError);
  handleRescueTrigger(standardError);

  assert.equal(logs.length, 1, 'Standard error should be logged');
  assert.equal(logs[0], 'Error: Uncaught ReferenceError: foo is not defined');
  assert.equal(rescueTriggered, true, 'Standard error should trigger rescue banner');
});
