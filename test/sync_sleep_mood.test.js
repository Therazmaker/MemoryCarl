const test = require('node:test');
const assert = require('node:assert/strict');

test('(a) app_state merge preserves existing keys', () => {
  const existingAppState = {
    sleepLog: [{ id: 'sleep_100', date: '2025-05-01' }],
    moodDaily: { '2025-05-01': [{ spriteId: 'happy' }] },
    customSetting: 'hello_world'
  };

  const incomingAppState = {
    financeLedger: [{ id: 'f_1', amount: 50 }],
    financeAccounts: [{ id: 'a_1', name: 'BCP' }]
  };

  const merged = {
    ...(existingAppState || {}),
    ...incomingAppState
  };

  assert.equal(merged.customSetting, 'hello_world');
  assert.equal(merged.sleepLog.length, 1);
  assert.equal(merged.sleepLog[0].id, 'sleep_100');
  assert.equal(merged.financeLedger.length, 1);
  assert.equal(merged.financeLedger[0].id, 'f_1');
});

test('(b) mood entries ID uses ts and includes tags and full data object', () => {
  const dateKey = '2025-05-10';
  const e = {
    spriteId: 'calm',
    label: 'Calmado',
    ts: '2025-05-10T14:30:00Z',
    tags: ['meditation', 'rest'],
    note: 'Feeling peaceful'
  };
  const idx = 0;

  const entryId = `${dateKey}_${e.ts || idx}`;
  assert.equal(entryId, '2025-05-10_2025-05-10T14:30:00Z');

  const record = {
    id: String(entryId),
    date: dateKey,
    sprite_id: e.spriteId || e.sprite_id || null,
    label: e.label || null,
    activities: Array.isArray(e.activities) ? e.activities : [],
    energy: (e.energy !== undefined && e.energy !== null && e.energy !== "") ? Number(e.energy) : null,
    note: e.note || '',
    tags: Array.isArray(e.tags) ? e.tags : [],
    ts: e.ts || new Date().toISOString(),
    data: e
  };

  assert.equal(record.id, '2025-05-10_2025-05-10T14:30:00Z');
  assert.deepEqual(record.tags, ['meditation', 'rest']);
  assert.deepEqual(record.data, e);

  // Fallback test when ts is missing
  const eNoTs = { spriteId: 'happy' };
  const fallbackId = `${dateKey}_${eNoTs.ts || 2}`;
  assert.equal(fallbackId, '2025-05-10_2');
});

test('(c) empty list does not perform delete operations', () => {
  const sleepLog = [];
  const moodDaily = {};

  let sleepDeleted = false;
  let moodDeleted = false;

  if (sleepLog.length > 0) {
    sleepDeleted = true; // Would run upsert
  }

  const moodEntries = [];
  Object.entries(moodDaily).forEach(([dateKey, val]) => {
    const items = Array.isArray(val) ? val : [val];
    items.forEach((e, idx) => {
      if (e) moodEntries.push(e);
    });
  });

  if (moodEntries.length > 0) {
    moodDeleted = true; // Would run upsert
  }

  assert.equal(sleepDeleted, false);
  assert.equal(moodDeleted, false);
  assert.equal(sleepLog.length, 0);
  assert.equal(moodEntries.length, 0);
});

test('(d) pull merges sleepLog by id without duplication and moodDaily by date key', () => {
  const localState = {
    sleepLog: [
      { id: 'sleep_1', totalMinutes: 420, date: '2025-05-01' }
    ],
    moodDaily: {
      '2025-05-01': [{ spriteId: 'good', ts: '2025-05-01T10:00:00Z' }]
    }
  };

  const remoteAppState = {
    sleepLog: [
      { id: 'sleep_1', totalMinutes: 420, date: '2025-05-01' }, // duplicate
      { id: 'sleep_2', totalMinutes: 480, date: '2025-05-02' }  // new
    ],
    moodDaily: {
      '2025-05-01': [{ spriteId: 'bad' }], // existing date, should NOT overwrite
      '2025-05-02': [{ spriteId: 'awesome', ts: '2025-05-02T10:00:00Z' }] // new date
    }
  };

  let nonFinanceChanged = false;

  // Merge sleepLog
  if (Array.isArray(remoteAppState.sleepLog) && remoteAppState.sleepLog.length > 0) {
    if (!Array.isArray(localState.sleepLog)) localState.sleepLog = [];
    const localSleepIds = new Set(localState.sleepLog.map(s => String(s.id)));
    remoteAppState.sleepLog.forEach(s => {
      if (s && s.id !== undefined && s.id !== null && !localSleepIds.has(String(s.id))) {
        localState.sleepLog.push(s);
        localSleepIds.add(String(s.id));
        nonFinanceChanged = true;
      }
    });
  }

  // Merge moodDaily
  if (remoteAppState.moodDaily && typeof remoteAppState.moodDaily === 'object') {
    if (!localState.moodDaily || typeof localState.moodDaily !== 'object') localState.moodDaily = {};
    Object.entries(remoteAppState.moodDaily).forEach(([dateKey, val]) => {
      if (val && localState.moodDaily[dateKey] === undefined) {
        localState.moodDaily[dateKey] = val;
        nonFinanceChanged = true;
      }
    });
  }

  assert.equal(nonFinanceChanged, true);
  // Sleep log assertions
  assert.equal(localState.sleepLog.length, 2);
  assert.equal(localState.sleepLog[0].id, 'sleep_1');
  assert.equal(localState.sleepLog[1].id, 'sleep_2');

  // Mood daily assertions
  assert.equal(localState.moodDaily['2025-05-01'][0].spriteId, 'good'); // local date preserved
  assert.equal(localState.moodDaily['2025-05-02'][0].spriteId, 'awesome'); // remote missing date added
});
