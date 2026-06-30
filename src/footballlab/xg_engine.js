export function computeExpectedGoals(homeStats = {}, awayStats = {}) {
  const homeAttack = (toNumber(homeStats.xg_for, 1.25) + toNumber(homeStats.goals_for, 1.2)) / 2;
  const awayDefense = (toNumber(awayStats.xg_against, 1.2) + toNumber(awayStats.goals_against, 1.1)) / 2;
  const awayAttack = (toNumber(awayStats.xg_for, 1.1) + toNumber(awayStats.goals_for, 1.05)) / 2;
  const homeDefense = (toNumber(homeStats.xg_against, 1.1) + toNumber(homeStats.goals_against, 1.0)) / 2;

  const homeAdvantage = 1.12;

  const xgHome = homeAttack * awayDefense * homeAdvantage;
  const xgAway = awayAttack * homeDefense;

  return {
    xg_home: Math.max(0.2, xgHome),
    xg_away: Math.max(0.2, xgAway)
  };
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}
