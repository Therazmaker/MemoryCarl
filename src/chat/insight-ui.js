/**
 * insight-ui.js — Render compacto de insights para panel lateral de NeuroChat
 */

function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function confidenceBar(confidence = 0) {
  const pct = Math.max(0, Math.min(100, Math.round(confidence * 100)));
  const color = pct >= 75 ? "#34d399" : pct >= 55 ? "#fbbf24" : "#94a3b8";
  return `
    <div class="ncInsightConfidenceWrap">
      <div class="ncInsightConfidenceBar"><div class="ncInsightConfidenceFill" style="width:${pct}%;background:${color}"></div></div>
      <span class="ncInsightConfidencePct">${pct}%</span>
    </div>`;
}

function renderInsightCard(insight) {
  const recurrent = insight.recurrent ? `<span class="ncInsightRecurrent">patrón recurrente</span>` : "";
  const metaTags = [insight.type, ...(insight.domains || []).slice(0, 2), insight.emotion].filter(Boolean)
    .map((x) => `<span class="ncInsightTag">${esc(x)}</span>`).join("");

  const entities = (insight.signals?.manualEntities || []).slice(0, 3);
  const entitiesHtml = entities.length ? `<div class="ncInsightEntities">${entities.map((e) => `<span class="ncInsightEntity">${esc(e)}</span>`).join("")}</div>` : "";
  const neuronHint = (insight.basedOnNeurons || []).slice(0, 4).join(", ");

  return `
    <div class="ncInsightCard">
      <div class="ncInsightHead">
        <div class="ncInsightTitle">${esc(insight.title)}</div>
        ${recurrent}
      </div>
      <div class="ncInsightSummary">${esc(insight.summary)}</div>
      ${confidenceBar(insight.confidence)}
      <div class="ncInsightMeta">${metaTags}</div>
      ${entitiesHtml}
      ${neuronHint ? `<details class="ncInsightDetails"><summary>base neuronal</summary><div>${esc(neuronHint)}</div></details>` : ""}
    </div>`;
}

export function renderInsightsPanel(insights = [], insightSummary = "") {
  if (!Array.isArray(insights) || insights.length === 0) {
    return "";
  }

  return `
    <div class="ncSideSection ncInsightSection">
      <div class="ncSideSectionTitle">Lectura del momento</div>
      ${insightSummary ? `<div class="ncInsightSummaryTop">${esc(insightSummary)}</div>` : ""}
      <div class="ncInsightList">${insights.slice(0, 3).map(renderInsightCard).join("")}</div>
    </div>`;
}
