/**
 * neurochat-ui.js — Interfaz de NeuroChat integrada en MemoryCarl
 * MemoryCarl
 *
 * Exporta:
 *   viewNeuroChat()   → HTML string para el tab principal
 *   wireNeuroChat(root) → wiring de eventos DOM
 *   initNeuroChat()   → inicialización del módulo
 */

import { sendMessage, forcePremiumGenerationForMessage, getChatHistory, clearChatHistory, getNeurons, submitNeuronFeedback } from "./neurochat.js";
import { isNeuroclawConfigured } from "../services/neuroclawClient.js";
import { getPremiumUsageState } from "../neuro/premiumUsage.js";
import {
  getNeuroChatSettings, saveNeuroChatSettings, resetNeuroChatSettings,
  validateNeuroChatSettings, maskApiKey,
} from "../settings/neurochatSettings.js";
import { isGeminiPremiumConfigured, streamGeminiNeuronGeneration } from "../services/geminiPremiumClient.js";
import { viewNeuroGraph, wireNeuroGraph } from "./neurograph-ui.js";
import { viewContextWindow, wireContextWindow } from "./context-window-ui.js";
import { renderInsightsPanel } from "./insight-ui.js";
import { RELATION_TYPE_LABELS } from "../neuro/relationStore.js";
import {
  recordResponseFeedback,
  getPendingRelationSuggestions,
  confirmRelation,
  rejectInferredRelation,
  createUserRelation,
} from "../neuro/structuredFeedback.js";

// ---- Constantes UI ----
const MAX_INPUT_HEIGHT_PX = 140;
const uiState = {
  loading:         false,
  error:           null,
  lastResult:      null,  // NeuroCoreResult
  traceExpanded:   false,
  neuronsExpanded: false,
  activeTab:       "chat",   // "chat" | "graph" | "context"
  settingsOpen:    false,
  settingsMsg:     null,
  settingsApiKeyVisible: false,
  currentMode: "chat",
  interpretationMode: "default",
  // IDs de neuronas de la sesión actual para resaltado en grafo
  sessionState: {
    lastActivatedIds: [],
    lastGeneratedIds: [],
    lastMergedIds:    [],
  },
  feedbackByMessage: {},
  forcingByMessage: {},
  overrideStatus: {},
  streamingNeuronText: "",
  inputHeightPx: null,
  pendingSuggestions: [],
};

const MODE_OPTIONS = [
  { value: "chat", label: "Chat" },
  { value: "journal", label: "Diario emocional" },
  { value: "autobiography", label: "Autobiografía" },
  { value: "exercise", label: "Ejercicio psicológico" },
];

// ---- Helpers ----
function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmt(n, digits = 2) {
  return typeof n === "number" ? n.toFixed(digits) : "—";
}

function emotionIcon(emotion) {
  const map = {
    joy: "😊", sadness: "😢", anger: "😠", fear: "😨", surprise: "😲",
    disgust: "🤢", curiosity: "🧐", pride: "🏆", shame: "😔", love: "❤️", neutral: "•",
  };
  return map[emotion] || "•";
}

function timeSince(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60000)  return "justo ahora";
  if (diff < 3600000) return `hace ${Math.floor(diff / 60000)}m`;
  return new Date(ts).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function renderMarkdown(raw) {
  if (!raw) return "";
  let html = String(raw)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => `<pre class="ncCode"><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    .replace(/^[*-] (.+)$/gm, "<li>$1</li>")
    .replace(/^### (.+)$/gm, "<h4 class='ncH4'>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3 class='ncH3'>$1</h3>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul class=\"ncList\">$1</ul>");

  html = html
    .split(/\n{2,}/)
    .map((para) => (para.startsWith("<") ? para : `<p>${para.replace(/\n/g, "<br>")}</p>`))
    .join("\n")
    .replace(/<\/ul>\s*<ul class="ncList">/g, "");

  return html;
}

// ---- Renderizado de componentes ----

function renderMessage(msg) {
  const isUser = msg.role === "user";
  const time = timeSince(msg.ts);
  const bodyHtml = isUser
    ? `<div class="ncMsgBubble">${esc(msg.content)}</div>`
    : `<div class="ncMsgBubble ncMsgBubble--md">${renderMarkdown(msg.content)}</div>`;

  const responseFeedback = (!isUser && msg.messageId) ? `
    <div class="ncResponseFeedback" data-msg-id="${esc(msg.messageId)}">
      <button class="ncRfBtn" data-rf-rating="useful" data-rf-msg="${esc(msg.messageId)}" title="Útil">Útil</button>
      <button class="ncRfBtn" data-rf-rating="partial" data-rf-msg="${esc(msg.messageId)}" title="Parcialmente útil">Parcial</button>
      <button class="ncRfBtn" data-rf-rating="useless" data-rf-msg="${esc(msg.messageId)}" title="No útil">No útil</button>
    </div>` : "";

  return `
    <div class="ncMsg ${isUser ? "ncMsgUser" : "ncMsgAssistant"}" data-msg-id="${esc(msg.messageId || "")}">
      ${bodyHtml}
      <div class="ncMsgMeta">${time}${msg.coverage != null ? ` · cobertura ${Math.round(msg.coverage * 100)}%` : ""}</div>
      ${responseFeedback}
    </div>`;
}

export function isNeuronFeedbackLocked(feedbackMap = {}, neuronId) {
  return Boolean(feedbackMap && neuronId && feedbackMap[neuronId]);
}

function renderNeuronCard(neuronOrActivated, isGenerated = false, options = {}) {
  // Acepta tanto {neuron, score} como la neurona directa
  const n = neuronOrActivated.neuron || neuronOrActivated;
  const score = neuronOrActivated.score;
  const badge = isGenerated
    ? `<span class="ncBadge ncBadgeNew">nueva</span>`
    : (score != null ? `<span class="ncBadge">${fmt(score, 2)}</span>` : "");

  const temporal = n.temporal || {};
  const temporalBadge = `<span class="ncTag">${esc(temporal.timeContext || "timeless")}</span>`;
  const temporalLine = [temporal.date, temporal.isHistorical ? "histórico" : "", temporal.stage].filter(Boolean).join(" · ");
  const currentFeedback = options.feedbackMap?.[n.id] || null;
  const feedbackActions = !isGenerated && options.allowFeedback
    ? `<div class="ncNeuronFeedbackRow">
        <button class="ncFeedbackBtn ${currentFeedback === "like" ? "ncFeedbackBtn--active" : ""}" aria-label="Marcar neurona ${esc(n.core.concept || "sin nombre")} como relevante" data-feedback-neuron="${esc(n.id)}" data-feedback-type="like" ${currentFeedback ? "disabled" : ""} title="Relevante">👍</button>
        <button class="ncFeedbackBtn ${currentFeedback === "dislike" ? "ncFeedbackBtn--active ncFeedbackBtn--negative" : "ncFeedbackBtn--negative"}" aria-label="Marcar neurona ${esc(n.core.concept || "sin nombre")} como no relevante" data-feedback-neuron="${esc(n.id)}" data-feedback-type="dislike" ${currentFeedback ? "disabled" : ""} title="No relevante">👎</button>
        ${currentFeedback ? `<span class="ncFeedbackState">${currentFeedback === "like" ? "Relevante" : "No relevante"}</span>` : ""}
      </div>`
    : "";
  return `
    <div class="ncNeuronCard" title="${esc(n.core.summary)}">
      <div class="ncNeuronHead">
        <span class="ncNeuronConcept">${esc(n.core.concept || "—")}</span>
        <span>${emotionIcon(n.emotion)}</span>
        ${badge}
      </div>
      <div class="ncNeuronMeta">
        <span class="ncTag">${esc(n.core.domain)}</span>
        ${temporalBadge}
        ${temporal.date ? `<span class="ncTag">${esc(temporal.date)}</span>` : ""}
        ${temporal.stage ? `<span class="ncTag">stage:${esc(temporal.stage)}</span>` : ""}
        ${temporalLine ? `<span class="ncTag">🕒 ${esc(temporalLine)}</span>` : ""}
        <span class="ncNeuronW">w: ${fmt(n.weight, 2)}</span>
        ${n.connections?.length ? `<span class="ncNeuronConn">${n.connections.length} conexiones</span>` : ""}
      </div>
      ${n.core.summary ? `<div class="ncNeuronSummary">${esc(n.core.summary)}</div>` : ""}
      ${n.evolution ? `<div class="ncNeuronSummary">Evolution · uso:${n.evolution.usageCount || 0} · ok:${n.evolution.successfulActivations || 0} · fail:${n.evolution.failedActivations || 0} · candidatos:${(n.evolution.triggerCandidates || []).filter((c) => !c.rejected && !c.approved).length || 0}</div>` : ""}
      ${feedbackActions}
    </div>`;
}

function renderPremiumPanel() {
  const r = uiState.lastResult;
  const usageState = getPremiumUsageState({ bootstrapState: r?.bootstrapState });

  // Build usage bar
  const usedPct    = usageState.limit > 0 ? Math.round((usageState.used / usageState.limit) * 100) : 0;
  const usageColor = usedPct >= 90 ? "#fb7185" : usedPct >= 60 ? "#fbbf24" : "#36d399";

  // Premium decision info from last result
  let decisionBadge = "";
  let dedupeBadge   = "";

  if (r) {
    const pd = r.premiumDecision;
    const ds = r.dedupeSummary;
    const summary = summarizePremiumDecision(r);

    if (pd) {
      if (pd.usePremium) {
        decisionBadge = `<span class="ncPremiumBadge ncPremiumUsed">${esc(summary.badge)}</span>`;
      } else {
        decisionBadge = `<span class="ncPremiumBadge ncPremiumSkipped" title="${esc(pd.reasons?.join(" · "))}">${esc(summary.badge)}</span>`;
      }
    }

    if (ds && (ds.merged > 0 || ds.discarded > 0)) {
      const parts = [];
      if (ds.merged   > 0) parts.push(`Merged ${ds.merged}`);
      if (ds.discarded > 0) parts.push(`Discarded ${ds.discarded}`);
      if (ds.saved    > 0) parts.push(`Saved ${ds.saved} new`);
      dedupeBadge = `<span class="ncDedupeBadge">🔀 ${parts.join(" · ")}</span>`;
    }
  }

  return `
    <div class="ncSideSection ncPremiumSection">
      <div class="ncSideSectionTitle">Premium</div>
      <div class="ncPremiumUsageRow">
        <span class="ncPremiumUsageLabel">Hoy: ${usageState.used} / ${usageState.limit}</span>
        <span class="ncPremiumUsageLeft" style="color:${usageColor}">${usageState.remaining} restantes</span>
      </div>
      <div class="ncPremiumBar">
        <div class="ncPremiumBarFill" style="width:${usedPct}%;background:${usageColor}"></div>
      </div>
      ${decisionBadge ? `<div class="ncPremiumDecision">${decisionBadge}</div>` : ""}
      ${r?.bootstrapState ? `<div class="ncPremiumDecisionMeta">Modo semilla: <b>${esc(r.bootstrapState.level)}</b> · modo input: <b>${esc(r.mode || "chat")}</b></div>` : ""}
      ${r?.premiumDecision?.rulePath ? `<div class="ncPremiumDecisionMeta">Ruta policy: ${esc(r.premiumDecision.rulePath)} · perfil: ${esc(usageState.bootstrapSpendingProfile)}</div>` : ""}
      ${dedupeBadge   ? `<div class="ncDedupeRow">${dedupeBadge}</div>` : ""}
    </div>`;
}

export function summarizePremiumDecision(result) {
  const pd = result?.premiumDecision;
  if (!pd) return { badge: "Sin decisión premium", details: [] };
  if (pd.usePremium) {
    const badge = pd.bootstrapState?.enabled
      ? "Aprendizaje premium activado por modo semilla"
      : "Aprendizaje premium activado";
    return { badge, details: pd.reasons || [] };
  }
  const first = pd.reasons?.[0] || "criterios insuficientes";
  return {
    badge: `Aprendizaje premium omitido: ${first}`,
    details: pd.reasons || [],
  };
}

export function shouldShowForcePremiumButton(result) {
  if (!result || !result.messageId) return false;
  if (result.premiumDecision?.usePremium) return false;
  if (result.premiumForcedSuccess) return false;
  const coverage = result?.missingAnalysis?.coverage ?? 1;
  const inputLongEnough = (result?.trace?.classifier?.features?.tokenCount || 0) >= 8;
  return Boolean(
    result?.neuronSuggestion?.hasSuggestion
    || coverage < 0.62
    || inputLongEnough
  );
}

export function getOverrideResultLabel(result) {
  if (!result) return "";
  if (result.premiumForcedSuccess) {
    if ((result.generated || []).length > 0) return `Aprendizaje forzado completado. Se creó ${result.generated.length} neurona nueva.`;
    return "Aprendizaje forzado completado. No se generaron neuronas útiles.";
  }
  if (result.manualOverrideUsed && !result.premiumForcedSuccess) {
    return "Aprendizaje forzado falló o no aportó mejoras.";
  }
  return "";
}

function renderSuggestionPanel(result) {
  if (!result?.neuronSuggestion?.hasSuggestion) return "";
  const reasons = (result.neuronSuggestion.reasons || []).slice(0, 2);
  const firstDraft = result.neuronSuggestion.suggestions?.[0]?.draft || null;
  const messageId = result.messageId;
  const forcing = Boolean(uiState.forcingByMessage[messageId]);
  const done = uiState.overrideStatus[messageId] === "success";
  const failed = uiState.overrideStatus[messageId] === "error";
  const canForce = shouldShowForcePremiumButton(result) && !forcing && !done;
  const draftJson = firstDraft ? esc(JSON.stringify(firstDraft, null, 2)) : "";

  return `
    <div class="ncSideSection ncSuggestionBox">
      <div class="ncSideSectionTitle">Sugerencia de memoria</div>
      <div class="ncSuggestionText">El sistema detectó cobertura floja (${Math.round((result?.missingAnalysis?.coverage || 0) * 100)}%).</div>
      ${reasons.length ? `<div class="ncMissingList">${reasons.map((r) => `<div class="ncMissingItem">• ${esc(r)}</div>`).join("")}</div>` : ""}
      <div class="ncSuggestionActions">
        ${canForce ? `<button class="ncActionBtn ncActionBtnPrimary" data-force-premium="${esc(messageId)}">Forzar Gemini</button>` : ""}
        ${forcing ? `<button class="ncActionBtn" disabled>Forzando…</button>` : ""}
        ${firstDraft ? `<button class="ncActionBtn" data-copy-draft="${esc(messageId)}">Copiar borrador JSON</button>` : ""}
      </div>
      ${forcing ? `<div class="ncStreamingIndicator">Gemini streaming… ${uiState.streamingNeuronText.length} chars</div>` : ""}
      ${firstDraft ? `<pre class="ncSuggestionDraft">${draftJson}</pre>` : ""}
      ${done ? `<div class="ncSuccess">${esc(getOverrideResultLabel(result) || "Aprendizaje forzado completado.")}</div>` : ""}
      ${failed ? `<div class="ncError">No se pudo completar el aprendizaje forzado.</div>` : ""}
    </div>
  `;
}

function renderRelationSuggestions(suggestions, allNeurons) {
  if (!suggestions || suggestions.length === 0) return "";
  const cards = suggestions.map((s) => {
    const srcNeuron = allNeurons.find((n) => n.id === s.sourceId);
    const tgtNeuron = allNeurons.find((n) => n.id === s.targetId);
    if (!srcNeuron || !tgtNeuron) return "";
    const srcLabel = esc(srcNeuron.core?.concept || s.sourceId);
    const tgtLabel = esc(tgtNeuron.core?.concept || s.targetId);
    const typeLabel = esc(RELATION_TYPE_LABELS[s.type] || s.type);
    return `
      <div class="ncRelSuggestion">
        <div class="ncRelSuggestionText">"${srcLabel}" <em>${typeLabel}</em> "${tgtLabel}"</div>
        <div class="ncRelSuggestionActions">
          <button class="ncRelBtn ncRelBtn--confirm" data-suggestion-id="${esc(s.id)}" title="Confirmar relación">Confirmar</button>
          <button class="ncRelBtn ncRelBtn--reject" data-suggestion-id="${esc(s.id)}" data-reject="true" title="Rechazar">No</button>
        </div>
      </div>`;
  }).filter(Boolean).join("");

  if (!cards) return "";
  return `
    <div class="ncSideSection ncRelSection">
      <div class="ncSideSectionTitle">Relaciones detectadas</div>
      <div class="ncRelHint">¿Estas conexiones tienen sentido?</div>
      ${cards}
    </div>`;
}

function renderSidePanel() {
  const r = uiState.lastResult;
  if (!r) return `<div class="ncSide${uiState.neuronsExpanded ? " ncSide--expanded" : ""}"><div class="ncSideEmpty">Escribe un mensaje para ver neuronas activadas.</div></div>`;
  const expandedClass = uiState.neuronsExpanded ? " ncSide--expanded" : "";

  const { activated, generated, trace, missingAnalysis } = r;
  const coverage = missingAnalysis?.coverage ?? trace?.coverage ?? 0;
  const covPct   = Math.round(coverage * 100);
  const covColor = covPct >= 70 ? "#36d399" : covPct >= 40 ? "#fbbf24" : "#fb7185";

  const replySourceBadge = (() => {
    const src = r?.replySource || "";
    const mode = r?.replyMode || "";
    const modeLabel = { autonomous: "Autónomo", assisted: "Asistido", delegated: "Delegado" }[mode] || "";
    const srcLabel = {
      gemini: "NeuroClaw",
      assisted: "Gemini asistido",
      local_engine: "Motor local",
      response_pattern: "Patrón aprendido",
      fallback: "Sin contexto",
    }[src] || src;

    if (!srcLabel) return "";
    const modeTag = modeLabel ? ` <span class="ncRSBMode">${modeLabel}</span>` : "";
    const cls = {
      gemini: "ncRSB--gemini",
      assisted: "ncRSB--assisted",
      local_engine: "ncRSB--local",
      response_pattern: "ncRSB--pattern",
      fallback: "ncRSB--fallback",
    }[src] || "";
    return `<span class="ncReplySourceBadge ${cls}">${srcLabel}${modeTag}</span>`;
  })();
  const learningBadge = (() => {
    const ke = r?.knowledgeExtracted;
    if (!ke || ke.quality === "low") return "";
    const parts = [];
    if (ke.triggerCandidates > 0) parts.push(`+${ke.triggerCandidates} triggers`);
    if (ke.relationHints > 0) parts.push(`${ke.relationHints} relaciones`);
    if (!parts.length) return "";
    return `<div class="ncLearningBadge">Aprendido: ${parts.join(" · ")}</div>`;
  })();

  const messageId = r.messageId;
  const feedbackMap = uiState.feedbackByMessage[messageId] || r.feedbackForMessage || {};
  const activatedHtml = activated.length
    ? activated.map((a) => renderNeuronCard(a, false, { allowFeedback: true, feedbackMap })).join("")
    : `<div class="ncSideEmpty">Sin neuronas activadas</div>`;

  const generatedHtml = generated.length
    ? generated.map((n) => renderNeuronCard(n, true)).join("")
    : `<div class="ncSideEmpty muted">—</div>`;

  const traceSteps = (trace?.steps || []).map((s) =>
    `<div class="ncTraceStep">+${s.ts}ms <b>${esc(s.step)}</b></div>`
  ).join("");

  const timingEntries = Object.entries(trace?.timing || {}).map(([k, v]) =>
    `<div class="ncTimingRow"><span>${esc(k)}</span><span>${v}ms</span></div>`
  ).join("");

  return `
    <div class="ncSide${expandedClass}">
      <!-- Coverage -->
      <div class="ncSideSection">
        <div class="ncSideSectionTitle">Cobertura</div>
        <div class="ncCoverageBar">
          <div class="ncCoverageFill" style="width:${covPct}%;background:${covColor}"></div>
        </div>
        <div class="ncCoveragePct" style="color:${covColor}">${covPct}%</div>
        ${replySourceBadge ? `<div class="ncReplySource">${replySourceBadge}</div>` : ""}
        ${learningBadge ? `<div class="ncLearningRow">${learningBadge}</div>` : ""}
        ${missingAnalysis?.reasons?.length ? `<div class="ncMissingList">${missingAnalysis.reasons.map(r => `<div class="ncMissingItem">⚠ ${esc(r)}</div>`).join("")}</div>` : ""}
      </div>

      <!-- Premium status -->
      ${renderPremiumPanel()}

      ${renderInsightsPanel(r.insights || [], r.insightSummary || "")}
      ${renderSuggestionPanel(r)}

      <!-- Neuronas activadas -->
      <div class="ncSideSection">
        <div class="ncSideSectionTitle">⚡ Activadas (${activated.length})</div>
        ${activatedHtml}
      </div>

      ${renderRelationSuggestions(uiState.pendingSuggestions || [], getNeurons())}

      <!-- Neuronas generadas -->
      ${generated.length > 0 ? `
      <div class="ncSideSection">
        <div class="ncSideSectionTitle">✨ Generadas (${generated.length})</div>
        ${generatedHtml}
      </div>` : ""}

      <!-- Trace -->
      <div class="ncSideSection">
        <button class="ncCollapseBtn" id="btnTraceToggle">
          ${uiState.traceExpanded ? "▾" : "▸"} Traza
        </button>
        ${uiState.traceExpanded ? `
        <div class="ncTracePanel">
          ${traceSteps}
          <div class="ncTimingSection">
            <div class="ncTimingRow"><span>neuronsEvolved</span><span>${trace?.evolution?.neuronsEvolvedCount || 0}</span></div>
            <div class="ncTimingRow"><span>triggerCandidatesAdded</span><span>${trace?.evolution?.triggerCandidatesAdded || 0}</span></div>
            <div class="ncTimingRow"><span>triggersApproved</span><span>${trace?.evolution?.triggersApproved || 0}</span></div>
            <div class="ncTimingRow"><span>triggersPruned</span><span>${trace?.evolution?.triggersPruned || 0}</span></div>
            <div class="ncTimingRow"><span>weightsAdjusted</span><span>${trace?.evolution?.weightsAdjusted || 0}</span></div>
          </div>
          <div class="ncTimingSection">${timingEntries}</div>
        </div>` : ""}
      </div>
    </div>`;
}

// ---- Settings Modal ----

function renderSettingsModal() {
  const s       = getNeuroChatSettings();
  const maskedKey = s.apiKey ? maskApiKey(s.apiKey) : "";
  const keyPlaceholder = s.apiKey
    ? `${maskedKey} (escribe para reemplazar)`
    : "AIza… (tu API key de Gemini)";
  const premiumConfigured = isGeminiPremiumConfigured();

  const statusBadge = premiumConfigured
    ? `<span class="ncSettingsBadge ncSettingsBadgeOn">✓ Premium activo</span>`
    : `<span class="ncSettingsBadge ncSettingsBadgeOff">Sin API key configurada</span>`;

  return `
    <div class="ncSettingsOverlay" id="ncSettingsOverlay">
      <div class="ncSettingsModal">
        <div class="ncSettingsHeader">
          <div class="ncSettingsTitle">⚙️ Configuración NeuroChat</div>
          <button class="ncIconBtn" id="btnSettingsClose">✕</button>
        </div>

        <div class="ncSettingsStatus">
          ${statusBadge}
          <span class="ncSettingsStatusSub">${s.enabled ? "Generación premium habilitada" : "Generación premium deshabilitada"}</span>
        </div>

        ${uiState.settingsMsg ? `<div class="ncSettingsMsg ncSettingsMsgType--${uiState.settingsMsg.type}">${esc(uiState.settingsMsg.text)}</div>` : ""}

        <form id="ncSettingsForm" autocomplete="off">
          <!-- Toggle premium -->
          <label class="ncSettingsRow ncSettingsToggleRow">
            <span class="ncSettingsLabel">Activar generación premium Gemini</span>
            <input type="checkbox" id="ncsPremiumEnabled" ${s.enabled ? "checked" : ""} />
          </label>

          <!-- API Key -->
          <div class="ncSettingsField">
            <label class="ncSettingsLabel" for="ncsApiKey">Gemini API key</label>
            <div class="ncSettingsKeyRow">
              <input
                type="${uiState.settingsApiKeyVisible ? "text" : "password"}"
                id="ncsApiKey"
                class="ncSettingsInput"
                placeholder="${esc(keyPlaceholder)}"
                autocomplete="new-password"
                value=""
              />
              <button type="button" class="ncIconBtn" id="btnToggleApiKeyVisibility">
                ${uiState.settingsApiKeyVisible ? "🙈" : "👁"}
              </button>
            </div>
            <div class="ncSettingsHint">La key se guarda solo en tu navegador (localStorage). No se envía a ningún servidor de MemoryCarl.</div>
          </div>

          <!-- Modelo -->
          <div class="ncSettingsField">
            <label class="ncSettingsLabel" for="ncsModel">Modelo Gemini</label>
            <input type="text" id="ncsModel" class="ncSettingsInput" value="${esc(s.model)}" placeholder="gemini-2.5-flash" />
          </div>

          <!-- Daily limit -->
          <div class="ncSettingsField">
            <label class="ncSettingsLabel" for="ncsDailyLimit">Límite diario de llamadas premium</label>
            <input type="number" id="ncsDailyLimit" class="ncSettingsInput ncSettingsInputSm" value="${s.dailyLimit}" min="1" max="100" />
          </div>

          <!-- Timeout -->
          <div class="ncSettingsField">
            <label class="ncSettingsLabel" for="ncsTimeout">Timeout (ms)</label>
            <input type="number" id="ncsTimeout" class="ncSettingsInput ncSettingsInputSm" value="${s.timeoutMs}" min="1000" max="60000" step="1000" />
          </div>

          <!-- Temperature -->
          <div class="ncSettingsField">
            <label class="ncSettingsLabel" for="ncsTemp">Temperatura (0 – 2)</label>
            <input type="number" id="ncsTemp" class="ncSettingsInput ncSettingsInputSm" value="${s.temperature}" min="0" max="2" step="0.1" />
          </div>

          <!-- Max output tokens -->
          <div class="ncSettingsField">
            <label class="ncSettingsLabel" for="ncsMaxTokens">Max output tokens</label>
            <input type="number" id="ncsMaxTokens" class="ncSettingsInput ncSettingsInputSm" value="${s.maxOutputTokens}" min="256" max="8192" step="256" />
          </div>

          <!-- Botones -->
          <div class="ncSettingsBtns">
            <button type="submit" class="ncSettingsSaveBtn" id="btnSettingsSave">Guardar</button>
            <button type="button" class="ncSettingsTestBtn" id="btnSettingsTest">Probar conexión</button>
            <button type="button" class="ncSettingsResetBtn" id="btnSettingsReset">Restaurar por defecto</button>
          </div>
        </form>
      </div>
    </div>`;
}

function nchatInner() {
  const history = getChatHistory();
  const configured = isNeuroclawConfigured();
  const configWarning = configured ? "" : `
    <div class="ncConfigWarn">
      ⚠️ NeuroClaw no está configurado. Las respuestas serán locales.
      Ve a <b>Ajustes</b> para añadir URL y key de NeuroClaw.
    </div>`;

  const totalNeurons = getNeurons().length;
  const premiumConfigured = isGeminiPremiumConfigured();
  const premiumDot = premiumConfigured
    ? `<span class="ncPremiumDot ncPremiumDotOn" title="Gemini premium activo">⚡</span>`
    : `<span class="ncPremiumDot" title="Gemini premium no configurado">○</span>`;

  const tabChat  = uiState.activeTab === "chat";
  const tabGraph = uiState.activeTab === "graph";
  const tabContext = uiState.activeTab === "context";
  const showSidePanel = uiState.neuronsExpanded || Boolean(uiState.lastResult) || history.length > 0;

  const settingsModal = uiState.settingsOpen ? renderSettingsModal() : "";

  const chatContent = tabChat ? `
    <div class="ncLayout">
      <!-- Panel principal de chat -->
      <div class="ncMain">
        <div class="ncMessages" id="ncMessages" role="log" aria-live="polite" aria-label="Historial de conversación">${buildMessagesHtml()}</div>

        <div class="ncInputBar">${buildInputBarHtml()}</div>
      </div>

      <!-- Panel lateral con neuronas + trace -->
      ${showSidePanel ? renderSidePanel() : ""}
    </div>` : "";

  const graphContent = tabGraph
    ? viewNeuroGraph(uiState.sessionState)
    : "";
  const contextContent = tabContext
    ? viewContextWindow()
    : "";

  return `
    <div class="nchatWrap">
      ${ncCss()}
      ${configWarning}

      <!-- Header -->
      <div class="ncHeader">
        <div class="ncHeaderLeft">
          <span class="ncHeaderIcon">🧠</span>
          <div>
            <div class="ncHeaderTitle">NeuroChat ${premiumDot}</div>
            <div class="ncHeaderSub">${totalNeurons} neuronas · ${history.filter(m => m.role === "user").length} conversaciones</div>
          </div>
        </div>
        <div class="ncHeaderActions">
          <button class="ncIconBtn" id="btnNcCloseSession" title="Cerrar sesión y guardar resumen">💾</button>
          <button class="ncIconBtn" id="btnNcToggleNeurons" title="Ver neuronas">${uiState.neuronsExpanded ? "📱🧠▾" : "📱🧠"}</button>
          <button class="ncIconBtn" id="btnNcClear" title="Limpiar chat">🗑</button>
          <button class="ncIconBtn" id="btnNcSettings" title="Configuración">⚙️</button>
        </div>
      </div>

      <!-- Tabs -->
      <div class="ncTabs">
        <button class="ncTab ${tabChat  ? "ncTab--active" : ""}" id="btnTabChat">💬 Chat</button>
        <button class="ncTab ${tabGraph ? "ncTab--active" : ""}" id="btnTabGraph">🕸️ Neuron Graph</button>
        <button class="ncTab ${tabContext ? "ncTab--active" : ""}" id="btnTabContext">🗂️ Context Window</button>
      </div>

      <!-- Contenido del tab activo -->
      ${chatContent}
      ${graphContent}
      ${contextContent}

      <!-- Settings modal -->
      ${settingsModal}
    </div>`;
}

function buildMessagesHtml() {
  const history = getChatHistory();
  const messagesHtml = history.length
    ? history.map(renderMessage).join("")
    : `<div class="ncWelcome">
        <div class="ncWelcomeIcon">🧠</div>
        <div class="ncWelcomeTitle">NeuroChat</div>
        <div class="ncWelcomeSub">Conversación con memoria contextual viva.</div>
      </div>`;
  return `${messagesHtml}
    ${uiState.loading ? `<div class="ncLoading"><span class="ncDot"></span><span class="ncDot"></span><span class="ncDot"></span></div>` : ""}
    ${uiState.error ? `<div class="ncError">⚠️ ${esc(uiState.error)}</div>` : ""}`;
}

function buildInputBarHtml() {
  const heightStyle = uiState.inputHeightPx ? `style=\"height:${uiState.inputHeightPx}px\"` : "";
  return `
    <select class="ncModeSelect" id="ncModeSelect" ${uiState.loading ? "disabled" : ""}>
      ${MODE_OPTIONS.map((m) => `<option value="${m.value}" ${uiState.currentMode === m.value ? "selected" : ""}>${m.label}</option>`).join("")}
    </select>
    <select class="ncModeSelect ncInterpretSelect" id="ncInterpretSelect" ${uiState.loading ? "disabled" : ""}>
      <option value="default" ${uiState.interpretationMode === "default" ? "selected" : ""}>Lectura: default</option>
      <option value="objective" ${uiState.interpretationMode === "objective" ? "selected" : ""}>Lectura: objetiva</option>
    </select>
    <textarea
      class="ncInput"
      id="ncInput"
      placeholder="Escribe algo…"
      rows="1"
      ${heightStyle}
      ${uiState.loading ? "disabled" : ""}
    ></textarea>
    <button class="ncSendBtn" id="btnNcSend" ${uiState.loading ? "disabled" : ""}>
      ${uiState.loading ? "…" : "↑"}
    </button>
  `;
}

function rerenderMessages(root) {
  const container = root.querySelector("#ncMessages");
  if (!container) return;
  const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  container.innerHTML = buildMessagesHtml();
  if (scrollBottom < 80) container.scrollTop = container.scrollHeight;
  wireMessageEvents(root);
}

function rerenderSidePanel(root) {
  const layout = root.querySelector(".ncLayout");
  if (!layout) {
    fullRerender();
    return;
  }
  const shouldShow = uiState.neuronsExpanded || Boolean(uiState.lastResult) || getChatHistory().length > 0;
  const el = layout.querySelector(".ncSide");
  if (!shouldShow) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    layout.insertAdjacentHTML("beforeend", renderSidePanel());
  } else {
    el.outerHTML = renderSidePanel();
  }
  const side = root.querySelector(".ncSide");
  if (side && window.innerWidth < 640) {
    side.classList.toggle("ncSide--expanded", uiState.neuronsExpanded);
  }
  wireSidePanelEvents(root);
  const activeFeedback = document.activeElement?.getAttribute?.("data-feedback-neuron");
  const activeType = document.activeElement?.getAttribute?.("data-feedback-type");
  if (activeFeedback && activeType) {
    root.querySelector(`[data-feedback-neuron="${activeFeedback}"][data-feedback-type="${activeType}"]`)?.focus();
  }
}

function rerenderInputBar(root) {
  const bar = root.querySelector(".ncInputBar");
  if (!bar) return;
  bar.innerHTML = buildInputBarHtml();
  wireInputBarEvents(root);
}

function rerenderSettingsModal(root) {
  root.querySelector("#ncSettingsOverlay")?.remove();
  const wrap = root.querySelector(".nchatWrap");
  if (!wrap || !uiState.settingsOpen) return;
  wrap.insertAdjacentHTML("beforeend", renderSettingsModal());
  wireSettingsModal(root);
}

function fullRerender() {
  const root = document.querySelector("#app");
  if (!root) return;
  const wrap = root.querySelector(".nchatWrap");
  if (!wrap) {
    root.innerHTML = nchatInner();
  } else {
    wrap.outerHTML = nchatInner();
  }
  wireNeuroChatInner(root);
}

function rerender() {
  const root = document.querySelector("#app");
  if (!root) return;
  const wrap = root.querySelector(".nchatWrap");
  if (!wrap) {
    fullRerender();
    return;
  }
  rerenderMessages(root);
  rerenderSidePanel(root);
  rerenderInputBar(root);
  rerenderSettingsModal(root);
}

// ---- Función principal de vista (llamada desde main.js) ----
export function viewNeuroChat() {
  return nchatInner();
}

// ---- Wiring de eventos ----

async function doSend(root, inputEl) {
  if (!inputEl || uiState.loading) return;
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  uiState.loading = true;
  uiState.error = null;
  rerender();
  try {
    const result = await sendMessage(text, { mode: uiState.currentMode, interpretationMode: uiState.interpretationMode });
    uiState.lastResult = result;
    uiState.loading = false;
    if (result) {
      if (result.messageId) {
        uiState.feedbackByMessage[result.messageId] = { ...(result.feedbackForMessage || {}) };
        uiState.pendingSuggestions = [];
      }
      uiState.sessionState.lastActivatedIds = (result.activated || [])
        .map((a) => a.neuron?.id || a.id).filter(Boolean);
      uiState.sessionState.lastGeneratedIds = (result.generated || [])
        .map((n) => n.id).filter(Boolean);
      uiState.sessionState.lastMergedIds = (result.dedupeSummary?.mergedIds || []);
    }
  } catch (err) {
    console.error("[NeuroChat]", err);
    uiState.error = err.message || "Error desconocido";
    uiState.loading = false;
  }
  rerender();
  const rootEl = document.querySelector("#app");
  if (rootEl) {
    wireSidePanelEvents(rootEl);
    wireMessageEvents(rootEl);
  }
}

function wireInputBarEvents(root) {
  const btnSend = root.querySelector("#btnNcSend");
  const inputEl = root.querySelector("#ncInput");
  if (btnSend) btnSend.addEventListener("click", () => doSend(root, inputEl));
  if (inputEl) {
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(root, inputEl); }
    });
    inputEl.addEventListener("input", () => {
      inputEl.style.height = "auto";
      inputEl.style.height = `${Math.min(inputEl.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
      uiState.inputHeightPx = parseInt(inputEl.style.height, 10) || null;
    });
  }
  const modeSelect = root.querySelector("#ncModeSelect");
  if (modeSelect) {
    modeSelect.addEventListener("change", () => {
      uiState.currentMode = modeSelect.value || "chat";
    });
  }
  const interpretationSelect = root.querySelector("#ncInterpretSelect");
  if (interpretationSelect) {
    interpretationSelect.addEventListener("change", () => {
      uiState.interpretationMode = interpretationSelect.value || "default";
    });
  }
  if (inputEl && !uiState.loading && uiState.activeTab === "chat") inputEl.focus();
}

function wireMessageEvents(root) {
  const btnTrace = root.querySelector("#btnTraceToggle");
  if (btnTrace) {
    btnTrace.addEventListener("click", () => {
      uiState.traceExpanded = !uiState.traceExpanded;
      rerenderSidePanel(root);
    });
  }

  root.querySelectorAll("[data-feedback-neuron]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const neuronId = btn.getAttribute("data-feedback-neuron");
      const feedback = btn.getAttribute("data-feedback-type");
      const messageId = uiState.lastResult?.messageId;
      if (!neuronId || !messageId || !feedback) return;

      const currentMap = uiState.feedbackByMessage[messageId] || {};
      if (isNeuronFeedbackLocked(currentMap, neuronId)) return;

      try {
        const inputPreview = getChatHistory().filter((m) => m.role === "user").slice(-1)[0]?.content || "";
        const result = submitNeuronFeedback({ neuronId, feedback, messageId, inputPreview });
        if (result?.record) {
          uiState.feedbackByMessage[messageId] = {
            ...(uiState.feedbackByMessage[messageId] || {}),
            [neuronId]: feedback,
          };
          if (uiState.lastResult?.activated) {
            uiState.lastResult.activated = uiState.lastResult.activated.map((item) => (
              item.neuron?.id === neuronId
                ? { ...item, neuron: { ...item.neuron, ...(result.neuron || {}) } }
                : item
            ));
          }
          uiState.error = null;
        }
      } catch (err) {
        uiState.error = err.message || "No se pudo guardar feedback";
      }
      rerenderSidePanel(root);
    });
  });

  root.querySelectorAll("[data-rf-rating]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rating = btn.getAttribute("data-rf-rating");
      const messageId = btn.getAttribute("data-rf-msg");
      if (!rating || !messageId) return;

      const lastResult = uiState.lastResult;
      try {
        recordResponseFeedback({
          messageId,
          rating,
          replySource: lastResult?.replySource || "unknown",
          activatedIds: (lastResult?.activated || []).map((a) => a.neuron?.id).filter(Boolean),
        });
      } catch (_e) {}

      const container = root.querySelector(`[data-msg-id="${messageId}"] .ncResponseFeedback`);
      if (container) {
        container.querySelectorAll(".ncRfBtn").forEach((b) => {
          b.classList.remove("ncRfBtn--active", "ncRfBtn--active-partial", "ncRfBtn--active-useless");
          b.disabled = true;
        });
        const classMap = { useful: "ncRfBtn--active", partial: "ncRfBtn--active-partial", useless: "ncRfBtn--active-useless" };
        btn.classList.add(classMap[rating] || "ncRfBtn--active");
      }

      if (rating === "useful" && messageId) {
        uiState.pendingSuggestions = getPendingRelationSuggestions(messageId);
        rerenderSidePanel(root);
      }
    });
  });
}

function wireSidePanelEvents(root) {
  root.querySelectorAll("[data-suggestion-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const suggestionId = btn.getAttribute("data-suggestion-id");
      const isReject = btn.getAttribute("data-reject") === "true";
      if (!suggestionId) return;
      try {
        if (isReject) {
          rejectInferredRelation({ suggestionId });
        } else {
          confirmRelation({ suggestionId, messageId: uiState.lastResult?.messageId });
        }
        uiState.pendingSuggestions = (uiState.pendingSuggestions || []).filter((s) => s.id !== suggestionId);
        rerenderSidePanel(root);
      } catch (err) {
        uiState.error = err.message;
      }
    });
  });

  root.querySelectorAll("[data-copy-draft]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const messageId = btn.getAttribute("data-copy-draft");
      const draft = uiState.lastResult?.neuronSuggestion?.suggestions?.[0]?.draft;
      if (!messageId || !draft) return;
      try {
        await navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
        uiState.error = null;
      } catch (_e) {
        uiState.error = "No se pudo copiar el borrador JSON";
      }
      rerenderSidePanel(root);
    });
  });

  root.querySelectorAll("[data-force-premium]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const messageId = btn.getAttribute("data-force-premium");
      if (!messageId || uiState.forcingByMessage[messageId]) return;
      uiState.forcingByMessage[messageId] = true;
      uiState.overrideStatus[messageId] = "running";
      uiState.streamingNeuronText = "";
      uiState.error = null;
      rerenderSidePanel(root);
      try {
        const userMessage = [...getChatHistory()].reverse().find((m) => m.role === "user" && m.messageId === messageId);
        const activatedNeurons = uiState.lastResult?.activated || [];
        const missingAnalysis = uiState.lastResult?.missingAnalysis || { coverage: 0, missingConcepts: [], reasons: [] };
        if (userMessage && isGeminiPremiumConfigured()) {
          try {
            await streamGeminiNeuronGeneration({
              userInput: userMessage.content,
              activatedNeurons,
              missingAnalysis,
              history: getChatHistory().slice(-10),
            }, (chunk) => {
              uiState.streamingNeuronText += chunk;
              rerenderSidePanel(root);
            });
          } catch (_streamErr) {
            // fallback: seguir con la llamada bloqueante existente
          }
        }
        const result = await forcePremiumGenerationForMessage(messageId);
        uiState.lastResult = result;
        uiState.overrideStatus[messageId] = "success";
        if (result.messageId) {
          uiState.feedbackByMessage[result.messageId] = { ...(result.feedbackForMessage || {}) };
        }
      } catch (err) {
        uiState.overrideStatus[messageId] = "error";
        uiState.error = err.message || "No se pudo forzar Gemini";
      } finally {
        uiState.forcingByMessage[messageId] = false;
        uiState.streamingNeuronText = "";
        rerender();
      }
    });
  });
}

function wireNeuroChatInner(root) {
  const msgs = root.querySelector("#ncMessages");
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
  wireMessageEvents(root);
  wireSidePanelEvents(root);
  wireInputBarEvents(root);

  const btnClear = root.querySelector("#btnNcClear");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      if (!confirm("¿Limpiar historial de conversación?")) return;
      clearChatHistory();
      uiState.lastResult = null;
      uiState.error = null;
      rerender();
    });
  }

  root.querySelector("#btnNcCloseSession")?.addEventListener("click", async () => {
    if (!confirm("¿Cerrar sesión y guardar resumen de la conversación?")) return;
    try {
      const { buildSessionSummary, saveSessionMemory } = await import("../neuro/sessionMemory.js");
      const history = getChatHistory();
      const summary = buildSessionSummary({
        history,
        dominantActivated: uiState.lastResult?.activated || [],
        insights: uiState.lastResult?.insights || [],
        replyModes: [],
        relationHintsApplied: uiState.lastResult?.knowledgeExtracted?.relationHints || 0,
        triggersApplied: uiState.lastResult?.knowledgeExtracted?.triggerCandidates || 0,
      });
      if (summary) {
        saveSessionMemory(summary);
        uiState.error = null;
        const wrap = root.querySelector(".nchatWrap");
        if (wrap) {
          const toast = document.createElement("div");
          toast.className = "ncToast";
          toast.textContent = "Sesión guardada en memoria";
          wrap.appendChild(toast);
          setTimeout(() => toast.remove(), 2500);
        }
      }
    } catch (err) {
      uiState.error = `No se pudo guardar la sesión: ${err.message}`;
      rerender();
    }
  });

  // Toggle neuronas panel (en mobile el side panel puede colapsarse)
  const btnNeurons = root.querySelector("#btnNcToggleNeurons");
  if (btnNeurons) {
    btnNeurons.addEventListener("click", () => {
      uiState.neuronsExpanded = !uiState.neuronsExpanded;
      const side = root.querySelector(".ncSide");
      if (side) side.classList.toggle("ncSide--expanded", uiState.neuronsExpanded);
      if (window.innerWidth >= 640) fullRerender();
    });
  }

  // ---- Tabs ----
  root.querySelector("#btnTabChat")?.addEventListener("click", () => {
    uiState.activeTab = "chat";
    fullRerender();
  });
  root.querySelector("#btnTabGraph")?.addEventListener("click", () => {
    uiState.activeTab = "graph";
    fullRerender();
    const graphRoot = root.querySelector(".nchatWrap");
    if (graphRoot) wireNeuroGraph(graphRoot.closest("#app") || root, uiState.sessionState);
  });
  root.querySelector("#btnTabContext")?.addEventListener("click", () => {
    uiState.activeTab = "context";
    fullRerender();
  });

  // Si el tab activo es el grafo, wirear
  if (uiState.activeTab === "graph") {
    wireNeuroGraph(root, uiState.sessionState);
  }
  if (uiState.activeTab === "context") {
    wireContextWindow(root, rerender);
  }

  // ---- Settings button ----
  root.querySelector("#btnNcSettings")?.addEventListener("click", () => {
    uiState.settingsOpen = true;
    uiState.settingsMsg  = null;
    rerenderSettingsModal(root);
  });

  // Settings modal wiring
  wireSettingsModal(root);
}

function wireSettingsModal(root) {
  const overlay = root.querySelector("#ncSettingsOverlay");
  if (!overlay) return;
  const modal = overlay.querySelector(".ncSettingsModal");
  if (!modal) return;
  const focusableSelectors = "button, input, select, textarea, [tabindex]:not([tabindex=\"-1\"])";
  const focusables = () => Array.from(modal.querySelectorAll(focusableSelectors));

  // Cerrar modal
  const closeModal = () => {
    uiState.settingsOpen  = false;
    uiState.settingsMsg   = null;
    uiState.settingsApiKeyVisible = false;
    rerender();
  };

  root.querySelector("#btnSettingsClose")?.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  requestAnimationFrame(() => {
    const els = focusables();
    if (els[0]) els[0].focus();
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      return;
    }
    if (e.key !== "Tab") return;
    const els = focusables();
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Toggle API key visibility
  root.querySelector("#btnToggleApiKeyVisibility")?.addEventListener("click", () => {
    uiState.settingsApiKeyVisible = !uiState.settingsApiKeyVisible;
    rerender();
  });

  // Guardar
  root.querySelector("#ncSettingsForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const apiKeyInput = root.querySelector("#ncsApiKey");
    const patch = {
      enabled:         root.querySelector("#ncsPremiumEnabled")?.checked ?? true,
      model:           root.querySelector("#ncsModel")?.value?.trim() || "gemini-2.5-flash",
      dailyLimit:      parseInt(root.querySelector("#ncsDailyLimit")?.value, 10) || 20,
      timeoutMs:       parseInt(root.querySelector("#ncsTimeout")?.value,    10) || 20000,
      temperature:     parseFloat(root.querySelector("#ncsTemp")?.value)    || 0.4,
      maxOutputTokens: parseInt(root.querySelector("#ncsMaxTokens")?.value, 10) || 4096,
      premiumOnlyForGeneration: true,
    };
    // Solo actualizar apiKey si el usuario escribió algo
    const newKey = apiKeyInput?.value?.trim();
    if (newKey) patch.apiKey = newKey;

    try {
      saveNeuroChatSettings(patch);
      uiState.settingsMsg = { type: "success", text: "✓ Configuración guardada" };
    } catch (err) {
      uiState.settingsMsg = { type: "error", text: err.message };
    }
    rerender();
  });

  // Reset
  root.querySelector("#btnSettingsReset")?.addEventListener("click", () => {
    if (!confirm("¿Restaurar configuración por defecto? (La API key no se borrará)")) return;
    resetNeuroChatSettings({ keepApiKey: true });
    uiState.settingsMsg = { type: "success", text: "✓ Configuración restaurada" };
    rerender();
  });

  // Test conexión
  root.querySelector("#btnSettingsTest")?.addEventListener("click", async () => {
    const { isGeminiPremiumConfigured: configured, getGeminiPremiumSettings: getSettings } =
      await import("../services/geminiPremiumClient.js");
    if (!configured()) {
      uiState.settingsMsg = { type: "error", text: "Sin API key configurada. Guarda primero la key." };
      rerender();
      return;
    }
    const s = getSettings();
    uiState.settingsMsg = { type: "info", text: "Probando conexión con Gemini…" };
    rerender();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model || "gemini-2.5-flash")}?key=${s.apiKey}`;
      const res = await fetch(url);
      if (res.ok) {
        uiState.settingsMsg = { type: "success", text: `✓ Conexión OK con ${s.model}` };
      } else {
        const txt = await res.text().catch(() => "");
        uiState.settingsMsg = { type: "error", text: `Error ${res.status}: ${txt.slice(0, 100)}` };
      }
    } catch (err) {
      uiState.settingsMsg = { type: "error", text: `Error de red: ${err.message}` };
    }
    rerender();
  });
}

/**
 * Wiring principal del tab NeuroChat.
 * Llamado por main.js tras insertar el HTML.
 */
export function wireNeuroChat(root) {
  wireNeuroChatInner(root);
}

/**
 * Inicialización del módulo (llamada una vez al montar el tab).
 */
export function initNeuroChat() {
  // No hay inicialización pesada necesaria; el estado es lazy.
}

// ---- CSS embebido del módulo ----
function ncCss() {
  return `<style id="nchatStyles">
  .nchatWrap { max-width: 900px; margin: 0 auto; padding: 0 0 80px; position: relative; }
  .ncConfigWarn {
    background: rgba(251,191,36,.12); border: 1px solid rgba(251,191,36,.3);
    border-radius: 10px; padding: 10px 14px; margin: 8px 0 14px;
    font-size: 13px; color: #fbbf24;
  }
  /* Layout */
  .ncLayout { display: flex; flex-direction: column; gap: 16px; align-items: stretch; }
  .ncMain   { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
  .ncSide   { width: 100%; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 14px; }

  /* Header */
  .ncHeader {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; background: rgba(124,92,255,.12);
    border: 1px solid rgba(124,92,255,.25); border-radius: 16px;
  }
  .ncHeaderLeft { display: flex; align-items: center; gap: 12px; }
  .ncHeaderIcon { font-size: 28px; line-height: 1; }
  .ncHeaderTitle { font-size: 16px; font-weight: 800; }
  .ncHeaderSub   { font-size: 11px; opacity: .6; margin-top: 2px; }
  .ncHeaderActions { display: flex; gap: 6px; }
  .ncIconBtn {
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1);
    border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 14px;
    color: inherit; transition: background .12s;
  }
  .ncIconBtn:hover { background: rgba(255,255,255,.15); }

  /* Messages */
  .ncMessages {
    background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.07);
    border-radius: 16px; padding: 14px; min-height: 220px; max-height: 52vh;
    overflow-y: auto; display: flex; flex-direction: column; gap: 10px;
    scroll-behavior: smooth;
  }
  .ncWelcome { text-align: center; padding: 28px 16px; opacity: .6; }
  .ncWelcomeIcon  { font-size: 40px; margin-bottom: 8px; }
  .ncWelcomeTitle { font-size: 18px; font-weight: 800; }
  .ncWelcomeSub   { font-size: 13px; margin-top: 4px; }

  .ncMsg { display: flex; flex-direction: column; }
  .ncMsgUser      { align-items: flex-end; }
  .ncMsgAssistant { align-items: flex-start; }
  .ncMsgBubble {
    max-width: 80%; padding: 10px 14px; border-radius: 14px;
    font-size: 14px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
  }
  .ncMsgUser .ncMsgBubble {
    background: rgba(124,92,255,.3); border-bottom-right-radius: 4px;
  }
  .ncMsgAssistant .ncMsgBubble {
    background: rgba(255,255,255,.07); border-bottom-left-radius: 4px;
  }
  .ncMsgBubble--md p { margin: 0 0 8px; }
  .ncMsgBubble--md p:last-child { margin: 0; }
  .ncMsgBubble--md ul.ncList, .ncMsgBubble--md ol { margin: 4px 0 8px 20px; padding: 0; }
  .ncMsgBubble--md li { margin: 2px 0; }
  .ncMsgBubble--md code { background: rgba(255,255,255,.1); border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: 12px; }
  .ncMsgBubble--md pre.ncCode { background: rgba(0,0,0,.25); border-radius: 8px; padding: 10px 14px; overflow-x: auto; margin: 8px 0; }
  .ncMsgBubble--md pre.ncCode code { background: none; padding: 0; }
  .ncMsgBubble--md h3.ncH3 { font-size: 14px; font-weight: 700; margin: 8px 0 4px; }
  .ncMsgBubble--md h4.ncH4 { font-size: 13px; font-weight: 600; margin: 6px 0 3px; }
  .ncMsgMeta { font-size: 10px; opacity: .45; margin-top: 3px; }
  .ncResponseFeedback { display: flex; gap: 4px; margin-top: 4px; }
  .ncRfBtn { font-size: 11px; border-radius: 4px; padding: 2px 8px; cursor: pointer; border: 0.5px solid var(--color-border-tertiary); background: var(--color-background-secondary); color: var(--color-text-secondary); }
  .ncRfBtn:hover { background: var(--color-background-tertiary); }
  .ncRfBtn--active { background: var(--color-background-success); color: var(--color-text-success); border-color: var(--color-border-success); }
  .ncRfBtn--active-partial { background: var(--color-background-warning); color: var(--color-text-warning); border-color: var(--color-border-warning); }
  .ncRfBtn--active-useless { background: var(--color-background-danger); color: var(--color-text-danger); border-color: var(--color-border-danger); }

  /* Loading dots */
  .ncLoading { display: flex; gap: 5px; padding: 6px; align-items: center; }
  .ncDot {
    width: 7px; height: 7px; border-radius: 50%;
    background: rgba(124,92,255,.7);
    animation: ncBounce 1.2s infinite;
  }
  .ncDot:nth-child(2) { animation-delay: .2s; }
  .ncDot:nth-child(3) { animation-delay: .4s; }
  @keyframes ncBounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: .5; }
    40%           { transform: scale(1);   opacity: 1;  }
  }

  /* Error */
  .ncError {
    background: rgba(251,113,133,.12); border: 1px solid rgba(251,113,133,.25);
    border-radius: 10px; padding: 8px 12px; font-size: 13px; color: #fb7185;
  }

  /* Input bar */
  .ncInputBar {
    display: flex; gap: 8px; align-items: flex-end;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1);
    border-radius: 16px; padding: 10px 12px;
  }
  .ncInput {
    flex: 1; background: transparent; border: none; outline: none;
    color: inherit; font-size: 14px; font-family: inherit;
    resize: none; max-height: 140px; /* MAX_INPUT_HEIGHT_PX */ line-height: 1.5;
  }
  .ncModeSelect {
    background: rgba(255,255,255,.07);
    border: 1px solid rgba(255,255,255,.15);
    border-radius: 10px;
    color: inherit;
    font-size: 12px;
    padding: 8px 10px;
    max-width: 180px;
  }
  .ncPremiumDecisionMeta { font-size: 11px; opacity: .7; margin-top: 6px; line-height: 1.35; }
  .ncSuggestionBox { border-top: 1px solid rgba(255,255,255,.06); padding-top: 10px; }
  .ncSuggestionText { font-size: 12px; opacity: .85; line-height: 1.4; }
  .ncSuggestionActions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .ncActionBtn { border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.08); color: inherit; border-radius: 10px; padding: 8px 10px; font-size: 12px; }
  .ncActionBtnPrimary { background: rgba(124,92,255,.45); border-color: rgba(124,92,255,.6); color: #fff; font-weight: 700; }
  .ncSuggestionDraft { margin-top: 8px; max-height: 120px; overflow: auto; font-size: 10px; padding: 8px; background: rgba(0,0,0,.2); border-radius: 8px; white-space: pre-wrap; }
  .ncStreamingIndicator { margin-top: 8px; font-size: 11px; opacity: .75; }
  .ncSuccess { margin-top: 8px; font-size: 12px; color: #34d399; }
  .ncInterpretSelect { max-width: 170px; }
  .ncInsightSection { border-top: 1px solid rgba(255,255,255,.06); padding-top: 10px; }
  .ncInsightSummaryTop { font-size: 11px; opacity: .72; line-height: 1.35; margin-bottom: 8px; }
  .ncInsightList { display: flex; flex-direction: column; gap: 8px; }
  .ncInsightCard { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 8px; }
  .ncInsightHead { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
  .ncInsightTitle { font-size: 12px; font-weight: 700; }
  .ncInsightSummary { font-size: 11px; opacity: .8; line-height: 1.4; margin-top: 4px; }
  .ncInsightMeta { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
  .ncInsightTag { font-size: 9px; padding: 1px 5px; border-radius: 999px; background: rgba(124,92,255,.2); color: #c4b5fd; }
  .ncInsightEntities { margin-top: 6px; display: flex; gap: 4px; flex-wrap: wrap; }
  .ncInsightEntity { font-size: 10px; padding: 1px 6px; border-radius: 6px; background: rgba(52,211,153,.18); color: #34d399; }
  .ncInsightConfidenceWrap { margin-top: 6px; display: flex; gap: 6px; align-items: center; }
  .ncInsightConfidenceBar { height: 4px; flex: 1; border-radius: 4px; background: rgba(255,255,255,.1); overflow: hidden; }
  .ncInsightConfidenceFill { height: 100%; border-radius: 4px; }
  .ncInsightConfidencePct { font-size: 10px; opacity: .6; min-width: 30px; text-align: right; }
  .ncInsightRecurrent { font-size: 9px; color: #fbbf24; text-transform: uppercase; letter-spacing: .3px; }
  .ncInsightDetails { margin-top: 6px; font-size: 10px; opacity: .55; }

  .ncInput::placeholder { opacity: .4; }
  .ncSendBtn {
    background: rgba(124,92,255,.8); border: none; border-radius: 10px;
    padding: 8px 14px; color: #fff; font-size: 18px; cursor: pointer;
    transition: background .12s; flex-shrink: 0; align-self: flex-end;
  }
  .ncSendBtn:hover:not(:disabled) { background: rgba(124,92,255,1); }
  .ncSendBtn:disabled { opacity: .4; cursor: default; }

  /* Side panel */
  .ncSideSection { margin-bottom: 16px; }
  .ncSideSection:last-child { margin-bottom: 0; }
  .ncRelSection { border-top: 0.5px solid var(--color-border-tertiary); padding-top: 10px; }
  .ncRelHint { font-size: 11px; color: var(--color-text-tertiary); margin-bottom: 6px; }
  .ncRelSuggestion { background: var(--color-background-secondary); border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; }
  .ncRelSuggestionText { font-size: 12px; margin-bottom: 6px; }
  .ncRelSuggestionText em { font-style: normal; color: var(--color-text-info); }
  .ncRelSuggestionActions { display: flex; gap: 6px; }
  .ncRelBtn { font-size: 11px; border-radius: 4px; padding: 3px 10px; cursor: pointer; border: 0.5px solid var(--color-border-secondary); background: transparent; }
  .ncRelBtn--confirm { color: var(--color-text-success); border-color: var(--color-border-success); }
  .ncRelBtn--reject { color: var(--color-text-secondary); }
  .ncSideSectionTitle { font-size: 11px; font-weight: 800; text-transform: uppercase;
    letter-spacing: .6px; opacity: .55; margin-bottom: 8px; }
  .ncSideEmpty { font-size: 12px; opacity: .4; font-style: italic; }

  /* Coverage */
  .ncCoverageBar {
    height: 6px; background: rgba(255,255,255,.1); border-radius: 4px;
    overflow: hidden; margin-bottom: 4px;
  }
  .ncCoverageFill { height: 100%; border-radius: 4px; transition: width .4s; }
  .ncCoveragePct  { font-size: 18px; font-weight: 800; }
  .ncReplySource { margin-top: 4px; }
  .ncReplySourceBadge { font-size: 11px; border-radius: 4px; padding: 2px 7px; font-weight: 500; }
  .ncRSB--gemini  { background: rgba(56,138,221,.15); color: #378ADD; }
  .ncRSB--assisted { background: rgba(239,159,39,.15); color: #BA7517; }
  .ncRSB--local   { background: rgba(29,158,117,.15); color: #1D9E75; }
  .ncRSB--pattern { background: rgba(127,119,221,.15); color: #7F77DD; }
  .ncRSB--fallback{ background: rgba(136,135,128,.15); color: #888780; }
  .ncRSBMode { font-size: 10px; opacity: .7; margin-left: 4px; }
  .ncLearningBadge { font-size: 11px; color: var(--color-text-success); margin-top: 3px; }
  .ncMissingList  { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
  .ncMissingItem  { font-size: 11px; color: #fbbf24; }

  /* Neuron card */
  .ncNeuronCard {
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
    border-radius: 10px; padding: 8px 10px; margin-bottom: 6px;
  }
  .ncNeuronHead   { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .ncNeuronConcept { font-size: 13px; font-weight: 700; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ncNeuronMeta   { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .ncNeuronSummary { font-size: 11px; opacity: .6; margin-top: 4px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .ncNeuronFeedbackRow { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
  .ncFeedbackBtn {
    border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.06); color: inherit;
    border-radius: 8px; padding: 3px 9px; cursor: pointer; font-size: 13px; line-height: 1.4;
  }
  .ncFeedbackBtn--negative { border-color: rgba(251,113,133,.35); }
  .ncFeedbackBtn--active { background: rgba(52,211,153,.22); border-color: rgba(52,211,153,.42); }
  .ncFeedbackBtn--active.ncFeedbackBtn--negative { background: rgba(251,113,133,.2); border-color: rgba(251,113,133,.4); }
  .ncFeedbackBtn:disabled { opacity: .65; cursor: default; }
  .ncFeedbackState { font-size: 10px; opacity: .68; }
  .ncTag { font-size: 10px; padding: 2px 6px; border-radius: 6px;
    background: rgba(124,92,255,.18); color: #a78bfa; font-weight: 600; }
  .ncNeuronW    { font-size: 10px; opacity: .5; }
  .ncNeuronConn { font-size: 10px; opacity: .4; }
  .ncBadge {
    font-size: 10px; padding: 1px 6px; border-radius: 6px;
    background: rgba(255,255,255,.1); color: rgba(255,255,255,.6); font-weight: 700;
  }
  .ncBadgeNew { background: rgba(52,211,153,.18); color: #34d399; }

  /* Trace */
  .ncCollapseBtn {
    background: none; border: none; cursor: pointer; color: inherit;
    font-size: 12px; opacity: .6; padding: 2px 0; display: flex; align-items: center; gap: 4px;
  }
  .ncCollapseBtn:hover { opacity: 1; }
  .ncTracePanel { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
  .ncTraceStep { font-size: 10px; font-family: monospace; opacity: .7; }
  .ncTimingSection { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
  .ncTimingRow { display: flex; justify-content: space-between; font-size: 10px; opacity: .55; }

  /* Premium panel */
  .ncPremiumSection { border-top: 1px solid rgba(255,255,255,.06); padding-top: 10px; }
  .ncPremiumUsageRow {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 11px; margin-bottom: 4px;
  }
  .ncPremiumUsageLabel { opacity: .6; }
  .ncPremiumUsageLeft  { font-weight: 700; font-size: 11px; }
  .ncPremiumBar {
    height: 4px; background: rgba(255,255,255,.08); border-radius: 4px;
    overflow: hidden; margin-bottom: 6px;
  }
  .ncPremiumBarFill { height: 100%; border-radius: 4px; transition: width .4s; }
  .ncPremiumDecision { margin-top: 4px; }
  .ncPremiumBadge {
    display: inline-block; font-size: 10px; padding: 2px 7px; border-radius: 6px;
    font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; cursor: default;
  }
  .ncPremiumUsed    { background: rgba(124,92,255,.25); color: #a78bfa; }
  .ncPremiumSkipped { background: rgba(255,255,255,.07); color: rgba(255,255,255,.45); }
  .ncDedupeRow  { margin-top: 4px; }
  .ncDedupeBadge {
    display: inline-block; font-size: 10px; padding: 2px 7px; border-radius: 6px;
    background: rgba(52,211,153,.15); color: #34d399; font-weight: 600;
  }

  /* Premium dot in header */
  .ncPremiumDot    { font-size: 12px; margin-left: 4px; opacity: .5; }
  .ncPremiumDotOn  { opacity: 1; color: #fbbf24; }

  /* Tabs */
  .ncTabs {
    display: flex; gap: 4px; margin: 10px 0 12px;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
    border-radius: 12px; padding: 4px;
  }
  .ncTab {
    flex: 1; background: none; border: none; cursor: pointer;
    color: inherit; font-size: 13px; font-weight: 600; padding: 7px 12px;
    border-radius: 9px; transition: background .12s;
    opacity: .55;
  }
  .ncTab:hover      { background: rgba(255,255,255,.08); opacity: .8; }
  .ncTab--active    { background: rgba(124,92,255,.25); color: #a78bfa; opacity: 1; }

  /* Settings modal overlay */
  .ncSettingsOverlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.6);
    z-index: 1000; display: flex; align-items: center; justify-content: center;
    padding: 20px;
  }
  .ncSettingsModal {
    background: #1a1a2e; border: 1px solid rgba(255,255,255,.12);
    border-radius: 20px; padding: 24px; max-width: 500px; width: 100%;
    max-height: 90vh; overflow-y: auto;
  }
  .ncSettingsHeader {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 14px;
  }
  .ncSettingsTitle { font-size: 16px; font-weight: 800; }
  .ncSettingsStatus {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    background: rgba(255,255,255,.04); border-radius: 10px;
    padding: 8px 12px; margin-bottom: 14px;
  }
  .ncSettingsStatusSub { font-size: 11px; opacity: .5; }
  .ncSettingsBadge {
    font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 700;
  }
  .ncSettingsBadgeOn  { background: rgba(52,211,153,.2);  color: #34d399; }
  .ncSettingsBadgeOff { background: rgba(255,255,255,.07); color: rgba(255,255,255,.4); }
  .ncSettingsMsg {
    border-radius: 8px; padding: 8px 12px; font-size: 12px; margin-bottom: 12px;
  }
  .ncSettingsMsgType--success { background: rgba(52,211,153,.12);  color: #34d399; border: 1px solid rgba(52,211,153,.25); }
  .ncSettingsMsgType--error   { background: rgba(251,113,133,.12); color: #fb7185; border: 1px solid rgba(251,113,133,.25); }
  .ncSettingsMsgType--info    { background: rgba(96,165,250,.12);  color: #60a5fa; border: 1px solid rgba(96,165,250,.25); }

  .ncSettingsField    { margin-bottom: 12px; }
  .ncSettingsRow      { display: flex; flex-direction: column; gap: 5px; }
  .ncSettingsToggleRow { flex-direction: row; align-items: center; justify-content: space-between;
    background: rgba(255,255,255,.04); border-radius: 10px; padding: 10px 14px;
    margin-bottom: 12px; cursor: pointer;
  }
  .ncSettingsLabel    { font-size: 12px; opacity: .75; font-weight: 600; }
  .ncSettingsInput {
    width: 100%; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
    border-radius: 8px; padding: 8px 10px; color: inherit; font-size: 13px;
    outline: none; font-family: inherit; box-sizing: border-box;
  }
  .ncSettingsInput:focus { border-color: rgba(124,92,255,.5); }
  .ncSettingsInputSm  { max-width: 140px; }
  .ncSettingsKeyRow   { display: flex; gap: 6px; align-items: center; }
  .ncSettingsKeyRow .ncSettingsInput { flex: 1; }
  .ncSettingsHint     { font-size: 10px; opacity: .4; margin-top: 4px; }
  .ncSettingsBtns     { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
  .ncSettingsSaveBtn {
    background: rgba(124,92,255,.8); border: none; border-radius: 10px;
    padding: 9px 18px; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer;
    transition: background .12s;
  }
  .ncSettingsSaveBtn:hover { background: rgba(124,92,255,1); }
  .ncSettingsTestBtn {
    background: rgba(52,211,153,.15); border: 1px solid rgba(52,211,153,.3);
    border-radius: 10px; padding: 9px 14px; color: #34d399;
    font-size: 13px; cursor: pointer; transition: background .12s;
  }
  .ncSettingsTestBtn:hover { background: rgba(52,211,153,.25); }
  .ncSettingsResetBtn {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
    border-radius: 10px; padding: 9px 14px; color: rgba(255,255,255,.6);
    font-size: 13px; cursor: pointer; transition: background .12s;
  }
  .ncSettingsResetBtn:hover { background: rgba(255,255,255,.12); }

  .ncToast {
    position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
    background: var(--color-background-success); color: var(--color-text-success);
    border: 0.5px solid var(--color-border-success); border-radius: 8px;
    padding: 8px 16px; font-size: 13px; pointer-events: none;
    animation: ncFadeOut 2.5s forwards;
  }
  @keyframes ncFadeOut { 0%{opacity:1} 70%{opacity:1} 100%{opacity:0} }

  @media (min-width: 640px) {
    .ncLayout { flex-direction: row; align-items: flex-start; }
    .ncMain { flex: 1; min-width: 0; }
    .ncSide {
      width: 280px;
      flex-shrink: 0;
      max-height: calc(100vh - 200px);
      overflow-y: auto;
      position: sticky;
      top: 16px;
    }
  }

  @media (max-width: 639px) {
    .ncSide {
      width: 100%;
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease;
      border-radius: 12px;
      padding-top: 0;
      padding-bottom: 0;
      border-width: 0;
    }
    .ncSide.ncSide--expanded {
      max-height: 600px;
      overflow-y: auto;
      padding: 14px;
      border-width: 1px;
    }
    .ncMessages { max-height: 55vh; }
  }

  @media(max-width: 680px){
    .nchatWrap { padding-bottom: 56px; }
    .ncHeader { padding: 10px 12px; }
    .ncHeaderTitle { font-size: 14px; }
    .ncHeaderSub { font-size: 10px; }
    .ncTabs { gap: 2px; }
    .ncTab { font-size: 12px; padding: 7px 8px; }
    .ncInputBar { flex-wrap: wrap; gap: 6px; }
    .ncModeSelect, .ncInterpretSelect { max-width: 100%; flex: 1 1 46%; min-width: 130px; }
    .ncInput { width: 100%; flex-basis: 100%; }
    .ncSendBtn { min-width: 48px; min-height: 42px; padding: 8px 10px; }
    .ncMsgBubble { max-width: 92%; }
    .ncNeuronFeedbackRow { justify-content: flex-start; flex-wrap: wrap; }
    .ncFeedbackBtn { min-height: 32px; min-width: 38px; }
  }
  </style>`;
}
