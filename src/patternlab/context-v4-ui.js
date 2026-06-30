import { computeSignalContextScore, buildContextDashboard } from './context-engine.js';

function esc(value){
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderV4ContextPanel({ signal = {}, session = {}, surroundingCandles = [], stats = {} } = {}){
  const ctx = computeSignalContextScore(signal, session, surroundingCandles, stats);
  const hist = ctx.historical.hasEnoughSample
    ? `Winrate ${Math.round(ctx.historical.winRate * 100)}% · Avg MFE ${ctx.historical.avgMfe.toFixed(2)} · Avg MAE ${ctx.historical.avgMae.toFixed(2)}`
    : 'Muestra histórica insuficiente para afirmar desempeño del contexto.';

  const cautionHtml = ctx.caution.length
    ? `<div class="v4-caution">${ctx.caution.map((c)=>`<span class="v4-pill">${esc(c)}</span>`).join(' ')}</div>`
    : '';

  return `
  <section class="v4-context-card" data-v4-context>
    <header class="v4-context-head">
      <h3>V4 Context</h3>
      <span class="v4-semaphore">${esc(ctx.semaphore)}</span>
    </header>
    <div class="v4-grid">
      <div><strong>Score:</strong> ${ctx.score}</div>
      <div><strong>Label:</strong> ${esc(ctx.label)}</div>
      <div><strong>Session:</strong> ${esc(ctx.sessionProfile.label)}</div>
      <div><strong>Bucket:</strong> ${esc(ctx.bucket)}</div>
    </div>
    <p class="v4-why"><strong>Why it matters:</strong> ${esc(ctx.why[0])}</p>
    <p class="v4-historical"><strong>Historical performance:</strong> ${esc(hist)}</p>
    <details class="v4-reasoning">
      <summary>Why this score</summary>
      <ul>${ctx.why.map((reason)=>`<li>${esc(reason)}</li>`).join('')}</ul>
    </details>
    ${cautionHtml}
  </section>`;
}

export function renderV4Dashboard({ signals = [], sessionsById = {}, stats = {} } = {}){
  const dash = buildContextDashboard(signals, sessionsById, stats);
  if(!dash.hasSample){
    return `<section class="v4-dashboard-empty">${esc(dash.emptyState)}</section>`;
  }

  const table = (title, rows)=>`
    <div class="v4-dash-card">
      <h4>${esc(title)}</h4>
      <table>
        <thead><tr><th>Contexto</th><th>Signals</th><th>Winrate</th><th>Avg MFE</th><th>Avg MAE</th></tr></thead>
        <tbody>
          ${rows.map((r)=>`<tr><td>${esc(r.name)}</td><td>${r.count}</td><td>${Math.round(r.winRate * 100)}%</td><td>${r.avgMfe.toFixed(2)}</td><td>${r.avgMae.toFixed(2)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  return `
  <section class="v4-dashboard">
    ${table('Winrate by context label', dash.byLabel)}
    ${table('Winrate by session profile', dash.bySessionProfile)}
    ${table('Signals by context bucket', dash.byBucket)}
    ${table('Top good contexts', dash.topGoodContexts)}
    ${table('Top bad contexts', dash.topBadContexts)}
  </section>`;
}
