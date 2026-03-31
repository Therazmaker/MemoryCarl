import { EPISODIC_MEMORY_KEY } from './finance_neural_storage.js';

const MAX_EPISODES_PER_NEURON = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'general';
}

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function parseDate(value) {
  const dt = new Date(value || 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((acc, v) => acc + ((v - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function inferFamilyByMovement(movement = {}) {
  const type = String(movement.type || '').toLowerCase();
  if (type === 'income') return 'flow';
  const role = String(movement.neuronRole || '');
  if (role === 'risk') return 'risk';
  if (role === 'opportunity') return 'opportunity';
  return 'habit';
}

function inferEmotion(note, context, amount) {
  const normalized = normalizeText(note);
  if (!normalized) return 'neutral';
  if (context === 'urgencia' || context === 'inversion') return 'necesario';

  const necessaryHints = ['necesario', 'medicina', 'salud', 'trabajo', 'servicio', 'colegio', 'factura'];
  const avoidableHints = ['capricho', 'antojo', 'gusto', 'lujo', 'impulso', 'ocio'];

  if (necessaryHints.some((w) => normalized.includes(w))) return 'necesario';
  if (avoidableHints.some((w) => normalized.includes(w))) return 'evitable';
  if (Math.abs(Number(amount) || 0) <= 0) return 'neutral';
  return 'neutral';
}

function pickDominant(items, key, fallback = 'desconocido') {
  const freq = new Map();
  items.forEach((item) => {
    const value = item?.[key];
    if (!value) return;
    freq.set(value, (freq.get(value) || 0) + 1);
  });
  let winner = fallback;
  let max = 0;
  freq.forEach((count, value) => {
    if (count > max) {
      max = count;
      winner = value;
    }
  });
  return winner;
}

function inferFrequency(episodes) {
  if (!episodes || episodes.length < 2) return 'sporadic';
  const sorted = [...episodes].sort((a, b) => new Date(a.date) - new Date(b.date));
  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const a = parseDate(sorted[i - 1].date);
    const b = parseDate(sorted[i].date);
    if (!a || !b) continue;
    const diff = Math.abs(b.getTime() - a.getTime()) / DAY_MS;
    if (diff > 0) gaps.push(diff);
  }
  const avgGap = mean(gaps);
  if (avgGap <= 2) return 'daily';
  if (avgGap <= 10) return 'weekly';
  if (avgGap <= 45) return 'monthly';
  return 'sporadic';
}

function inferTrend(episodes) {
  if (!episodes || episodes.length < 6) return 'stable';
  const latest10 = episodes.slice(-10);
  const previous10 = episodes.slice(-20, -10);
  const latestSum = latest10.reduce((acc, ep) => acc + Math.abs(Number(ep.amount) || 0), 0);
  const previousSum = previous10.reduce((acc, ep) => acc + Math.abs(Number(ep.amount) || 0), 0);
  if (!previousSum && latestSum) return 'growing';
  if (!previousSum && !latestSum) return 'stable';
  const ratio = (latestSum - previousSum) / previousSum;
  if (ratio > 0.2) return 'growing';
  if (ratio < -0.2) return 'declining';
  return 'stable';
}

function normalizeNeuron(raw) {
  const now = new Date().toISOString();
  const episodes = Array.isArray(raw?.episodes) ? raw.episodes.slice(-MAX_EPISODES_PER_NEURON) : [];
  const stats = raw?.stats && typeof raw.stats === 'object' ? raw.stats : {};
  return {
    id: String(raw?.id || `neurona_${slugify(raw?.category || raw?.label || 'general')}`),
    label: String(raw?.label || raw?.manualLabel || titleCase(raw?.category || 'General')),
    category: String(raw?.category || raw?.label || 'General'),
    family: raw?.family || 'habit',
    episodes,
    stats: {
      avgAmount: Number(stats.avgAmount) || 0,
      stdDev: Number(stats.stdDev) || 0,
      frequency: stats.frequency || 'sporadic',
      lastSeenAt: stats.lastSeenAt || episodes[episodes.length - 1]?.date || null,
      totalSpent: Number(stats.totalSpent) || 0,
      episodeCount: Number(stats.episodeCount) || episodes.length,
      trend: stats.trend || 'stable',
      dominantContext: stats.dominantContext || 'desconocido',
      dominantEmotion: stats.dominantEmotion || 'neutral',
    },
    createdAt: raw?.createdAt || now,
    updatedAt: raw?.updatedAt || now,
    manualLabel: raw?.manualLabel,
    pinned: !!raw?.pinned,
    archived: !!raw?.archived,
  };
}

export function loadEpisodicMemory() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(EPISODIC_MEMORY_KEY);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeNeuron);
  } catch (_e) {
    return [];
  }
}

export function saveEpisodicMemory(neurons) {
  if (typeof localStorage === 'undefined') return;
  const clean = Array.isArray(neurons) ? neurons.map(normalizeNeuron) : [];
  localStorage.setItem(EPISODIC_MEMORY_KEY, JSON.stringify(clean));
}

export function getOrCreateEpisodicNeuron(category, family = 'habit') {
  const cleanCategory = String(category || 'General').trim() || 'General';
  const neurons = loadEpisodicMemory();
  const existing = neurons.find((n) => normalizeText(n.category) === normalizeText(cleanCategory));
  if (existing) return existing;

  const now = new Date().toISOString();
  const neuron = {
    id: `neurona_${slugify(cleanCategory)}`,
    label: titleCase(cleanCategory),
    category: cleanCategory,
    family,
    episodes: [],
    stats: {
      avgAmount: 0,
      stdDev: 0,
      frequency: 'sporadic',
      lastSeenAt: null,
      totalSpent: 0,
      episodeCount: 0,
      trend: 'stable',
      dominantContext: 'desconocido',
      dominantEmotion: 'neutral',
    },
    createdAt: now,
    updatedAt: now,
    pinned: false,
    archived: false,
  };

  neurons.push(neuron);
  saveEpisodicMemory(neurons);
  return neuron;
}

export function inferContext(note, category) {
  const normalized = normalizeText(note);
  if (!normalized) return 'desconocido';

  const keywordGroups = [
    ['urgencia', ['urgente', 'emergencia', 'hospital']],
    ['planificado', ['planificado', 'previsto', 'anticipo', 'programado']],
    ['inversion', ['curso', 'software', 'herramienta', 'inversion']],
    ['ocio', ['capricho', 'gusto', 'antojo', 'salida', 'viaje']],
  ];

  for (const [context, words] of keywordGroups) {
    if (words.some((word) => normalized.includes(word))) return context;
  }

  const categoryHits = normalized.split(/\s+/).filter((token) => token && token === slugify(category));
  if (categoryHits.length > 3) return 'habito';
  return 'desconocido';
}

export function recalculateStats(neuron) {
  const episodes = Array.isArray(neuron?.episodes) ? neuron.episodes.slice(-MAX_EPISODES_PER_NEURON) : [];
  const recent20 = episodes.slice(-20);
  const amounts20 = recent20.map((ep) => Math.abs(Number(ep.amount) || 0));
  const avgAmount = mean(amounts20);
  const deviation = stdDev(amounts20);

  const latest = episodes[episodes.length - 1];
  if (latest) {
    const baselineAmounts = recent20.slice(0, -1).map((ep) => Math.abs(Number(ep.amount) || 0));
    const baselineAvg = baselineAmounts.length ? mean(baselineAmounts) : avgAmount;
    const baselineStd = baselineAmounts.length ? stdDev(baselineAmounts) : deviation;
    latest.wasAnomaly = (Math.abs(Number(latest.amount) || 0) > (baselineAvg + (2 * baselineStd))) && episodes.length > 2;
  }

  const recent10 = episodes.slice(-10);
  neuron.stats = {
    avgAmount,
    stdDev: deviation,
    frequency: inferFrequency(recent20),
    lastSeenAt: latest?.date || null,
    totalSpent: episodes.reduce((acc, ep) => acc + Math.abs(Number(ep.amount) || 0), 0),
    episodeCount: episodes.length,
    trend: inferTrend(episodes),
    dominantContext: pickDominant(recent10, 'context', 'desconocido'),
    dominantEmotion: pickDominant(recent10, 'emotional', 'neutral'),
  };
  neuron.episodes = episodes;
  neuron.updatedAt = new Date().toISOString();
  return neuron;
}

export function recordEpisode(movement, accountsMap = new Map()) {
  if (!movement || typeof movement !== 'object') return null;
  const category = String(movement.category || movement.reason || 'General').trim() || 'General';

  const neurons = loadEpisodicMemory();
  let neuron = neurons.find((n) => normalizeText(n.category) === normalizeText(category));
  if (!neuron) {
    neuron = getOrCreateEpisodicNeuron(category, inferFamilyByMovement(movement));
  }

  const account = accountsMap.get?.(movement.accountId) || {};
  const note = String(movement.note || movement.notes || movement.notas || '').trim();
  const context = inferContext(note, category);
  const emotional = note ? inferEmotion(note, context, movement.amount) : 'neutral';

  const episode = {
    movementId: String(movement.id || `mov_${Date.now().toString(36)}`),
    date: String(movement.date || movement.createdAt || new Date().toISOString()),
    amount: Number(movement.amount) || 0,
    note,
    reason: note || category,
    context,
    sourceAccount: movement.accountId || null,
    sourceAccountType: account.type || account.accountType || 'unknown',
    emotional,
    wasAnomaly: false,
  };

  const existingIdx = neuron.episodes.findIndex((ep) => ep.movementId === episode.movementId);
  if (existingIdx >= 0) neuron.episodes[existingIdx] = episode;
  else neuron.episodes.push(episode);

  if (neuron.episodes.length > MAX_EPISODES_PER_NEURON) {
    neuron.episodes = neuron.episodes.slice(-MAX_EPISODES_PER_NEURON);
  }

  recalculateStats(neuron);

  const idx = neurons.findIndex((n) => n.id === neuron.id);
  if (idx >= 0) neurons[idx] = neuron;
  else neurons.push(neuron);
  saveEpisodicMemory(neurons);
  return neuron;
}

export function getRankedEpisodicNeurons(limit = 20) {
  const trendWeight = { growing: 1.35, stable: 1, declining: 0.8 };
  return loadEpisodicMemory()
    .filter((n) => !n.archived)
    .sort((a, b) => {
      const scoreA = (a.stats?.episodeCount || 0) * (trendWeight[a.stats?.trend] || 1);
      const scoreB = (b.stats?.episodeCount || 0) * (trendWeight[b.stats?.trend] || 1);
      return scoreB - scoreA;
    })
    .slice(0, limit);
}
