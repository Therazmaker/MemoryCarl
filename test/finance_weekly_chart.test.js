import test from 'node:test';
import assert from 'node:assert/strict';

// Setup DOM & window mock environment
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

// Mock financeActiveLedger
let mockLedger = [];
globalThis.financeActiveLedger = () => mockLedger;

// Minimal implementation of getLast7DaysExpenseData for direct testing
function getLast7DaysExpenseData(now = new Date()){
  const days = [];
  const labels = [];
  const fullLabels = [];
  const values = [];
  const weekdayAverages = [];
  const dateKeys = [];
  const movementsByDay = [];

  const ledger = (typeof globalThis.financeActiveLedger === 'function') ? (globalThis.financeActiveLedger() || []) : [];
  const expenseLedger = ledger.filter(e => e.type === "expense" && Number(e.amount || 0) > 0);

  const dailyTotalsMap = {};
  const dailyMovementsMap = {};

  expenseLedger.forEach(e => {
    const rawDate = String(e.date || "").slice(0, 10);
    if (!rawDate) return;
    dailyTotalsMap[rawDate] = (dailyTotalsMap[rawDate] || 0) + Number(e.amount || 0);
    if (!dailyMovementsMap[rawDate]) dailyMovementsMap[rawDate] = [];
    dailyMovementsMap[rawDate].push(e);
  });

  const historicalDates = Object.keys(dailyTotalsMap);

  const currentWindowKeys = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    currentWindowKeys.push(`${y}-${m}-${day}`);
  }

  function getWeekdayAverage(targetWeekday) {
    const pastMatchingDates = historicalDates.filter(dateStr => {
      if (currentWindowKeys.includes(dateStr)) return false;
      const parts = dateStr.split("-");
      if (parts.length !== 3) return false;
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return !isNaN(d.getTime()) && d.getDay() === targetWeekday;
    });

    if (pastMatchingDates.length === 0) {
      const allMatchingDates = historicalDates.filter(dateStr => {
        const parts = dateStr.split("-");
        if (parts.length !== 3) return false;
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return !isNaN(d.getTime()) && d.getDay() === targetWeekday;
      });
      if (allMatchingDates.length === 0) return 0;
      const sum = allMatchingDates.reduce((s, k) => s + (dailyTotalsMap[k] || 0), 0);
      return sum / allMatchingDates.length;
    }

    const sum = pastMatchingDates.reduce((s, k) => s + (dailyTotalsMap[k] || 0), 0);
    return sum / pastMatchingDates.length;
  }

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dayNum = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${dayNum}`;

    const weekdayIdx = d.getDay();
    const rawShortWeekday = d.toLocaleDateString("es-PE", { weekday: "short" }).replace(".", "");
    const capitalizedWeekday = rawShortWeekday.charAt(0).toUpperCase() + rawShortWeekday.slice(1);

    const totalSpentReal = dailyTotalsMap[key] || 0;
    const avgForWeekday = getWeekdayAverage(weekdayIdx);
    const dayMovements = dailyMovementsMap[key] || [];
    const isToday = (i === 0);

    labels.push(capitalizedWeekday);
    fullLabels.push(`${capitalizedWeekday} ${dayNum}/${m}`);
    values.push(Number(totalSpentReal.toFixed(2)));
    weekdayAverages.push(Number(avgForWeekday.toFixed(2)));
    dateKeys.push(key);
    movementsByDay.push(dayMovements);

    days.push({
      dateKey: key,
      label: capitalizedWeekday,
      fullLabel: `${capitalizedWeekday} ${dayNum}/${m}`,
      dayNum,
      monthNum: m,
      weekdayIdx,
      realSpent: Number(totalSpentReal.toFixed(2)),
      usualAvg: Number(avgForWeekday.toFixed(2)),
      diff: Number((totalSpentReal - avgForWeekday).toFixed(2)),
      movementsCount: dayMovements.length,
      movements: dayMovements,
      isToday
    });
  }

  const total7DaysSpent = values.reduce((s, v) => s + v, 0);
  const avg7DaysSpentReal = total7DaysSpent / 7;
  const total7DaysUsualAvg = weekdayAverages.reduce((s, v) => s + v, 0);

  return {
    labels,
    fullLabels,
    values,
    weekdayAverages,
    dateKeys,
    movementsByDay,
    days,
    total7DaysSpent: Number(total7DaysSpent.toFixed(2)),
    avg7DaysSpentReal: Number(avg7DaysSpentReal.toFixed(2)),
    total7DaysUsualAvg: Number(total7DaysUsualAvg.toFixed(2))
  };
}

test('getLast7DaysExpenseData returns 7 days structure with 0 values when ledger is empty', () => {
  mockLedger = [];
  const refDate = new Date(2025, 4, 12); // Mon May 12 2025
  const res = getLast7DaysExpenseData(refDate);

  assert.equal(res.days.length, 7);
  assert.equal(res.values.length, 7);
  assert.equal(res.weekdayAverages.length, 7);
  assert.equal(res.total7DaysSpent, 0);
  assert.equal(res.avg7DaysSpentReal, 0);
  assert.equal(res.total7DaysUsualAvg, 0);
  assert.ok(res.days[6].isToday);
});

test('getLast7DaysExpenseData correctly aggregates daily expenses in current 7-day window', () => {
  mockLedger = [
    { type: 'expense', amount: 50, date: '2025-05-12T10:00:00.000Z', note: 'Lunch' },
    { type: 'expense', amount: 25, date: '2025-05-12T18:00:00.000Z', note: 'Taxi' },
    { type: 'expense', amount: 30, date: '2025-05-11T12:00:00.000Z', note: 'Dinner' },
    { type: 'income', amount: 500, date: '2025-05-12T08:00:00.000Z', note: 'Salary' }
  ];

  const refDate = new Date(2025, 4, 12); // Mon May 12 2025
  const res = getLast7DaysExpenseData(refDate);

  const todayData = res.days.find(d => d.dateKey === '2025-05-12');
  assert.ok(todayData);
  assert.equal(todayData.realSpent, 75);
  assert.equal(todayData.movementsCount, 2);

  const yesterdayData = res.days.find(d => d.dateKey === '2025-05-11');
  assert.ok(yesterdayData);
  assert.equal(yesterdayData.realSpent, 30);
  assert.equal(yesterdayData.movementsCount, 1);
});

test('getLast7DaysExpenseData correctly calculates historical weekday averages ("promedio habitual")', () => {
  // Setup historical Mondays outside the current 7-day window (refDate: 2025-05-12, window: 2025-05-06 to 2025-05-12)
  // Past Mondays: 2025-04-28 (spent 40), 2025-05-05 (spent 60). Average for Mondays should be (40 + 60) / 2 = 50.
  mockLedger = [
    { type: 'expense', amount: 40, date: '2025-04-28T10:00:00.000Z', note: 'Mon 1' },
    { type: 'expense', amount: 60, date: '2025-05-05T10:00:00.000Z', note: 'Mon 2' },
    { type: 'expense', amount: 90, date: '2025-05-12T10:00:00.000Z', note: 'Mon today' }
  ];

  const refDate = new Date(2025, 4, 12); // Mon May 12 2025
  const res = getLast7DaysExpenseData(refDate);

  const mondayData = res.days.find(d => d.dateKey === '2025-05-12');
  assert.ok(mondayData);
  assert.equal(mondayData.realSpent, 90);
  assert.equal(mondayData.usualAvg, 50);
  assert.equal(mondayData.diff, 40); // 90 - 50 = +40
});
