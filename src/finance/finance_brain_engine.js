import { buildFinanceSnapshot } from './finance_snapshot_builder.js';
import { detectPatternNeurons } from './finance_pattern_detector.js';
import { updateHippocampus } from './finance_hippocampus.js';
import { generateFinanceInsights } from './finance_insight_engine.js';
import { loadFinanceBrainState, saveFinanceBrainState } from './finance_neural_storage.js';

function resolveFinanceState(explicitState) {
  if (explicitState && typeof explicitState === 'object') return explicitState;
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  if (g.window?.FINANCE?.state) {
    return {
      movements: g.window.FINANCE.state.movements || [],
      accounts: g.window.FINANCE.state.accounts || []
    };
  }
  if (g.state) {
    return {
      movements: g.state.financeMovements || g.state.financeLedger || [],
      accounts: g.state.financeAccounts || []
    };
  }
  return { movements: [], accounts: [] };
}

export function runFinanceBrainScan({ financeState, now } = {}) {
  const state = loadFinanceBrainState();
  const resolved = resolveFinanceState(financeState);
  const snapshot = buildFinanceSnapshot(resolved);
  const neurons = detectPatternNeurons(snapshot, state.neuronRegistry, now || new Date().toISOString());
  const hippocampus = updateHippocampus(state.hippocampus, snapshot, neurons, now ? new Date(now) : new Date());
  const insights = generateFinanceInsights({ snapshot, neurons, hippocampus });

  const next = {
    ...state,
    lastScanAt: now || new Date().toISOString(),
    latestScanSummary: {
      totalEntriesScanned: snapshot.entries.length,
      income: snapshot.totals.income,
      expense: snapshot.totals.expense
    },
    neuronRegistry: neurons,
    hippocampus,
    insights
  };
  saveFinanceBrainState(next);

  const monthKey = (next.lastScanAt || '').slice(0, 7);
  const monthSummary = next.hippocampus.monthly[monthKey] || {};
  return {
    state: next,
    snapshot,
    neurons,
    insights,
    summary: {
      status: 'ready',
      lastScanAt: next.lastScanAt,
      totalEntriesScanned: snapshot.entries.length,
      activeNeuronCount: neurons.length,
      topSignals: neurons.filter((n) => n.family === 'habit' || n.family === 'flow').slice(0, 3),
      topRisks: neurons.filter((n) => n.family === 'risk').slice(0, 3),
      topOpportunities: insights.filter((i) => i.type === 'opportunity').slice(0, 3),
      latestInsights: insights,
      monthSummary,
      pressureScore: monthSummary.pressureScore || 0,
      leakScore: monthSummary.leakScore || 0
    }
  };
}
