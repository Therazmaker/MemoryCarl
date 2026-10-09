const test = require('node:test');
const assert = require('node:assert/strict');

// Import index.js (express app)
const app = require('../api/index.js');

test('Supabase sync & restore mapping logic for sleep_log and mood_daily', async (t) => {
  // Sample appState payload
  const sampleSleep = [
    {
      id: 'sleep_1',
      date: '2025-05-10',
      totalMinutes: 480,
      quality: 4,
      note: 'Sueño reparador',
      mode: 'complete',
      start: '23:00',
      end: '07:00',
      dreamType: 'lúcido',
      wakeEmotion: 'joy',
      narrative: 'Soñé que volaba',
      symbols: ['vuelo', 'cielo'],
      clarity: 5,
      ts: '2025-05-10T07:05:00.000Z'
    }
  ];

  const sampleMood = {
    '2025-05-10': [
      {
        id: 'mood_1',
        spriteId: 'incredible',
        label: 'Increíble',
        activities: ['ejercicio', 'comer_rico'],
        energy: 5,
        note: 'Excelente día',
        ts: '2025-05-10T20:00:00.000Z'
      }
    ]
  };

  // Test mapping to DB rows for sleep
  const sleepRows = sampleSleep.map(s => ({
    id: String(s.id),
    date: s.date || new Date().toISOString().split('T')[0],
    total_minutes: Number(s.totalMinutes || s.total_minutes || 0),
    quality: (s.quality !== undefined && s.quality !== null && s.quality !== "") ? Number(s.quality) : null,
    note: s.note || '',
    mode: s.mode || 'simple',
    start_time: s.start || s.start_time || '',
    end_time: s.end || s.end_time || '',
    dream_type: s.dreamType || s.dream_type || '',
    wake_emotion: s.wakeEmotion || s.wake_emotion || '',
    narrative: s.narrative || '',
    symbols: Array.isArray(s.symbols) ? s.symbols : [],
    clarity: (s.clarity !== undefined && s.clarity !== null && s.clarity !== "") ? Number(s.clarity) : null,
    created_at: s.ts || s.created_at || new Date().toISOString()
  }));

  assert.equal(sleepRows.length, 1);
  assert.equal(sleepRows[0].id, 'sleep_1');
  assert.equal(sleepRows[0].total_minutes, 480);
  assert.equal(sleepRows[0].dream_type, 'lúcido');
  assert.deepEqual(sleepRows[0].symbols, ['vuelo', 'cielo']);

  // Test mapping to DB rows for mood
  const moodEntries = [];
  Object.entries(sampleMood).forEach(([dateKey, val]) => {
    const items = Array.isArray(val) ? val : [val];
    items.forEach((e, idx) => {
      if (!e || typeof e !== 'object') return;
      const entryId = e.id || `${dateKey}_${idx}_${e.spriteId || 'mood'}`;
      moodEntries.push({
        id: String(entryId),
        date: dateKey,
        sprite_id: e.spriteId || e.sprite_id || null,
        label: e.label || null,
        activities: Array.isArray(e.activities) ? e.activities : [],
        energy: (e.energy !== undefined && e.energy !== null && e.energy !== "") ? Number(e.energy) : null,
        note: e.note || '',
        ts: e.ts || new Date().toISOString()
      });
    });
  });

  assert.equal(moodEntries.length, 1);
  assert.equal(moodEntries[0].id, 'mood_1');
  assert.equal(moodEntries[0].date, '2025-05-10');
  assert.equal(moodEntries[0].sprite_id, 'incredible');
  assert.deepEqual(moodEntries[0].activities, ['ejercicio', 'comer_rico']);

  // Test restore mapping back to appState
  const restoredSleep = sleepRows.map(s => ({
    id: s.id,
    date: s.date,
    totalMinutes: Number(s.total_minutes || 0),
    quality: s.quality,
    note: s.note,
    mode: s.mode,
    start: s.start_time,
    end: s.end_time,
    dreamType: s.dream_type,
    wakeEmotion: s.wake_emotion,
    narrative: s.narrative,
    symbols: s.symbols || [],
    clarity: s.clarity,
    ts: s.created_at
  }));

  assert.equal(restoredSleep[0].id, sampleSleep[0].id);
  assert.equal(restoredSleep[0].totalMinutes, sampleSleep[0].totalMinutes);
  assert.equal(restoredSleep[0].narrative, sampleSleep[0].narrative);

  const restoredMoodMap = {};
  moodEntries.forEach(m => {
    if (!restoredMoodMap[m.date]) restoredMoodMap[m.date] = [];
    restoredMoodMap[m.date].push({
      id: m.id,
      spriteId: m.sprite_id,
      label: m.label,
      activities: m.activities || [],
      energy: m.energy,
      note: m.note,
      ts: m.ts
    });
  });

  assert.ok(restoredMoodMap['2025-05-10']);
  assert.equal(restoredMoodMap['2025-05-10'][0].spriteId, 'incredible');
  assert.equal(restoredMoodMap['2025-05-10'][0].energy, 5);
});
