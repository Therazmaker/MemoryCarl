function factorial(n) {
  if (n === 0) return 1;
  let result = 1;
  for (let i = 1; i <= n; i++) result *= i;
  return result;
}

function poisson(k, lambda) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

export function scoreMatrix(xgHome, xgAway, maxGoals = 6) {
  const matrix = [];
  for (let h = 0; h <= maxGoals; h++) {
    const row = [];
    for (let a = 0; a <= maxGoals; a++) {
      row.push(poisson(h, xgHome) * poisson(a, xgAway));
    }
    matrix.push(row);
  }
  return matrix;
}

export function matrixToOutcome(matrix = []) {
  let home = 0;
  let draw = 0;
  let away = 0;

  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      const p = Number(matrix[h][a]) || 0;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }

  return normalizeOutcome({ home, draw, away });
}

export function mostLikelyScore(matrix = []) {
  let best = 0;
  let score = [0, 0];

  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      const current = Number(matrix[h][a]) || 0;
      if (current > best) {
        best = current;
        score = [h, a];
      }
    }
  }

  return { home: score[0], away: score[1], prob: best };
}

export function oddsToMarketProbabilities(odds = {}) {
  const home = 1 / Number(odds.home || 0);
  const draw = 1 / Number(odds.draw || 0);
  const away = 1 / Number(odds.away || 0);
  return normalizeOutcome({ home, draw, away });
}

export function blendOutcomes(model = {}, market = {}, alpha = 0.65) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0.65));
  return normalizeOutcome({
    home: safeAlpha * (Number(model.home) || 0) + (1 - safeAlpha) * (Number(market.home) || 0),
    draw: safeAlpha * (Number(model.draw) || 0) + (1 - safeAlpha) * (Number(market.draw) || 0),
    away: safeAlpha * (Number(model.away) || 0) + (1 - safeAlpha) * (Number(market.away) || 0)
  });
}

function normalizeOutcome(outcome = {}) {
  const normalized = {
    home: Number(outcome.home) || 0,
    draw: Number(outcome.draw) || 0,
    away: Number(outcome.away) || 0
  };
  const sum = normalized.home + normalized.draw + normalized.away;
  if (sum <= 0) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return {
    home: normalized.home / sum,
    draw: normalized.draw / sum,
    away: normalized.away / sum
  };
}
