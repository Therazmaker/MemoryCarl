/**
 * neurochat-ui.js — Interfaz de NeuroChat integrada en MemoryCarl
 * MemoryCarl
 *
 * Exporta:
 *   viewNeuroChat()   → HTML string para el tab principal
 *   wireNeuroChat(root) → wiring de eventos DOM
 *   initNeuroChat()   → inicialización del módulo
 */

import { sendMessage, getChatHistory, clearChatHistory, getNeurons } from "./neurochat.js";
import { isNeuroclawConfigured } from "../services/neuroclawClient.js";
import { getPremiumUsageState } from "../neuro/premiumUsage.js";
import {
  getNeuroChatSettings, saveNeuroChatSettings, resetNeuroChatSettings,
  validateNeuroChatSettings, maskApiKey,
} from "../settings/neurochatSettings.js";
import { isGeminiPremiumConfigured } from "../services/geminiPremiumClient.js";
import { viewNeuroGraph, wireNeuroGraph } from "./neurograph-ui.js";
import { viewContextWindow, wireContextWindow } from "./context-window-ui.js";

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
  // IDs de neuronas de la sesión actual para resaltado en grafo
  sessionState: {
    lastActivatedIds: [],
    lastGeneratedIds: [],
    lastMergedIds:    [],
  },
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

function rerender() {
  const root = document.querySelector("#app");
  if (!root) return;
  const el = root.querySelector(".nchatWrap");
  if (!el) return;
  el.outerHTML = nchatInner();
  wireNeuroChatInner(root);
}

// ---- Renderizado de componentes ----

function renderMessage(msg) {
  const isUser = msg.role === "user";
  const time   = timeSince(msg.ts);
  return `
    <div class="ncMsg ${isUser ? "ncMsgUser" : "ncMsgAssistant"}">
      <div class="ncMsgBubble">${esc(msg.content)}</div>
      <div class="ncMsgMeta">${time}${msg.coverage != null ? ` · cobertura ${Math.round(msg.coverage * 100)}%` : ""}</div>
    </div>`;
}

function renderNeuronCard(neuronOrActivated, isGenerated = false) {
  // Acepta tanto {neuron, score} como la neurona directa
  const n = neuronOrActivated.neuron || neuronOrActivated;
  const score = neuronOrActivated.score;
  const badge = isGenerated
    ? `<span class="ncBadge ncBadgeNew">nueva</span>`
    : (score != null ? `<span class="ncBadge">${fmt(score, 2)}</span>` : "");

  return `
    <div class="ncNeuronCard" title="${esc(n.core.summary)}">
      <div class="ncNeuronHead">
        <span class="ncNeuronConcept">${esc(n.core.concept || "—")}</span>
        <span>${emotionIcon(n.emotion)}</span>
        ${badge}
      </div>
      <div class="ncNeuronMeta">
        <span class="ncTag">${esc(n.core.domain)}</span>
        <span class="ncNeuronW">w: ${fmt(n.weight, 2)}</span>
        ${n.connections?.length ? `<span class="ncNeuronConn">${n.connections.length} conexiones</span>` : ""}
      </div>
      ${n.core.summary ? `<div class="ncNeuronSummary">${esc(n.core.summary)}</div>` : ""}
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

function renderSidePanel() {
  const r = uiState.lastResult;
  if (!r) return `<div class="ncSide"><div class="ncSideEmpty">Escribe un mensaje para ver neuronas activadas.</div></div>`;

  const { activated, generated, trace, missingAnalysis } = r;
  const coverage = missingAnalysis?.coverage ?? trace?.coverage ?? 0;
  const covPct   = Math.round(coverage * 100);
  const covColor = covPct >= 70 ? "#36d399" : covPct >= 40 ? "#fbbf24" : "#fb7185";

  const activatedHtml = activated.length
    ? activated.map((a) => renderNeuronCard(a, false)).join("")
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
    <div class="ncSide">
      <!-- Coverage -->
      <div class="ncSideSection">
        <div class="ncSideSectionTitle">Cobertura</div>
        <div class="ncCoverageBar">
          <div class="ncCoverageFill" style="width:${covPct}%;background:${covColor}"></div>
        </div>
        <div class="ncCoveragePct" style="color:${covColor}">${covPct}%</div>
        ${missingAnalysis?.reasons?.length ? `<div class="ncMissingList">${missingAnalysis.reasons.map(r => `<div class="ncMissingItem">⚠ ${esc(r)}</div>`).join("")}</div>` : ""}
      </div>

      <!-- Premium status -->
      ${renderPremiumPanel()}

      <!-- Neuronas activadas -->
      <div class="ncSideSection">
        <div class="ncSideSectionTitle">⚡ Activadas (${activated.length})</div>
        ${activatedHtml}
      </div>

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

  const messagesHtml = history.length
    ? history.map(renderMessage).join("")
    : `<div class="ncWelcome">
        <div class="ncWelcomeIcon">🧠</div>
        <div class="ncWelcomeTitle">NeuroChat</div>
        <div class="ncWelcomeSub">Conversación con memoria contextual viva.</div>
      </div>`;

  const totalNeurons = getNeurons().length;
  const premiumConfigured = isGeminiPremiumConfigured();
  const premiumDot = premiumConfigured
    ? `<span class="ncPremiumDot ncPremiumDotOn" title="Gemini premium activo">⚡</span>`
    : `<span class="ncPremiumDot" title="Gemini premium no configurado">○</span>`;

  const tabChat  = uiState.activeTab === "chat";
  const tabGraph = uiState.activeTab === "graph";
  const tabContext = uiState.activeTab === "context";

  const settingsModal = uiState.settingsOpen ? renderSettingsModal() : "";

  const chatContent = tabChat ? `
    <div class="ncLayout">
      <!-- Panel principal de chat -->
      <div class="ncMain">
        <div class="ncMessages" id="ncMessages">
          ${messagesHtml}
          ${uiState.loading ? `<div class="ncLoading"><span class="ncDot"></span><span class="ncDot"></span><span class="ncDot"></span></div>` : ""}
          ${uiState.error   ? `<div class="ncError">⚠️ ${esc(uiState.error)}</div>` : ""}
        </div>

        <div class="ncInputBar">
          <select class="ncModeSelect" id="ncModeSelect" ${uiState.loading ? "disabled" : ""}>
            ${MODE_OPTIONS.map((m) => `<option value="${m.value}" ${uiState.currentMode === m.value ? "selected" : ""}>${m.label}</option>`).join("")}
          </select>
          <textarea
            class="ncInput"
            id="ncInput"
            placeholder="Escribe algo…"
            rows="1"
            ${uiState.loading ? "disabled" : ""}
          ></textarea>
          <button class="ncSendBtn" id="btnNcSend" ${uiState.loading ? "disabled" : ""}>
            ${uiState.loading ? "…" : "↑"}
          </button>
        </div>
      </div>

      <!-- Panel lateral con neuronas + trace -->
      ${renderSidePanel()}
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
          <button class="ncIconBtn" id="btnNcToggleNeurons" title="Ver neuronas">${uiState.neuronsExpanded ? "🧠▾" : "🧠"}</button>
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

// ---- Función principal de vista (llamada desde main.js) ----
export function viewNeuroChat() {
  return nchatInner();
}

// ---- Wiring de eventos ----

function wireNeuroChatInner(root) {
  // Scroll al final de mensajes
  const msgs = root.querySelector("#ncMessages");
  if (msgs) msgs.scrollTop = msgs.scrollHeight;

  // Botón enviar
  const btnSend  = root.querySelector("#btnNcSend");
  const inputEl  = root.querySelector("#ncInput");

  async function doSend() {
    if (!inputEl || uiState.loading) return;
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    uiState.loading = true;
    uiState.error   = null;
    rerender();
    try {
      const result = await sendMessage(text, { mode: uiState.currentMode });
      uiState.lastResult = result;
      uiState.loading    = false;
      // Actualizar estado de sesión para resaltado en grafo
      if (result) {
        uiState.sessionState.lastActivatedIds = (result.activated || [])
          .map((a) => a.neuron?.id || a.id).filter(Boolean);
        uiState.sessionState.lastGeneratedIds = (result.generated || [])
          .map((n) => n.id).filter(Boolean);
        uiState.sessionState.lastMergedIds    = (result.dedupeSummary?.mergedIds || []);
      }
    } catch (err) {
      console.error("[NeuroChat]", err);
      uiState.error   = err.message || "Error desconocido";
      uiState.loading = false;
    }
    rerender();
  }

  if (btnSend)  btnSend.addEventListener("click",  doSend);
  if (inputEl) {
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
    // Auto-grow
    inputEl.addEventListener("input", () => {
      inputEl.style.height = "auto";
      inputEl.style.height = Math.min(inputEl.scrollHeight, MAX_INPUT_HEIGHT_PX) + "px";
    });
  }
  const modeSelect = root.querySelector("#ncModeSelect");
  if (modeSelect) {
    modeSelect.addEventListener("change", () => {
      uiState.currentMode = modeSelect.value || "chat";
    });
  }

  // Limpiar chat
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

  // Toggle trace
  const btnTrace = root.querySelector("#btnTraceToggle");
  if (btnTrace) {
    btnTrace.addEventListener("click", () => {
      uiState.traceExpanded = !uiState.traceExpanded;
      rerender();
    });
  }

  // Toggle neuronas panel (en mobile el side panel puede colapsarse)
  const btnNeurons = root.querySelector("#btnNcToggleNeurons");
  if (btnNeurons) {
    btnNeurons.addEventListener("click", () => {
      uiState.neuronsExpanded = !uiState.neuronsExpanded;
      rerender();
    });
  }

  // ---- Tabs ----
  root.querySelector("#btnTabChat")?.addEventListener("click", () => {
    uiState.activeTab = "chat";
    rerender();
  });
  root.querySelector("#btnTabGraph")?.addEventListener("click", () => {
    uiState.activeTab = "graph";
    rerender();
    const graphRoot = root.querySelector(".nchatWrap");
    if (graphRoot) wireNeuroGraph(graphRoot.closest("#app") || root, uiState.sessionState);
  });
  root.querySelector("#btnTabContext")?.addEventListener("click", () => {
    uiState.activeTab = "context";
    rerender();
  });

  // Si el tab activo es el grafo, wirear
  if (uiState.activeTab === "graph") {
    wireNeuroGraph(root, uiState.sessionState);
  }
  if (uiState.activeTab === "context") {
    wireContextWindow(root);
  }

  // ---- Settings button ----
  root.querySelector("#btnNcSettings")?.addEventListener("click", () => {
    uiState.settingsOpen = true;
    uiState.settingsMsg  = null;
    rerender();
  });

  // Settings modal wiring
  wireSettingsModal(root);

  // Focus en input
  if (inputEl && !uiState.loading && uiState.activeTab === "chat") inputEl.focus();
}

function wireSettingsModal(root) {
  const overlay = root.querySelector("#ncSettingsOverlay");
  if (!overlay) return;

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
  .nchatWrap { max-width: 900px; margin: 0 auto; padding: 0 0 80px; }
  .ncConfigWarn {
    background: rgba(251,191,36,.12); border: 1px solid rgba(251,191,36,.3);
    border-radius: 10px; padding: 10px 14px; margin: 8px 0 14px;
    font-size: 13px; color: #fbbf24;
  }
  /* Layout */
  .ncLayout { display: flex; gap: 16px; align-items: flex-start; }
  .ncMain   { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
  .ncSide   {
    width: 280px; flex-shrink: 0;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
    border-radius: 16px; padding: 14px; overflow-y: auto; max-height: 80vh;
  }
  @media(max-width: 680px){
    .ncLayout { flex-direction: column; }
    .ncSide   { width: 100%; max-height: none; }
  }

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
  .ncMsgMeta { font-size: 10px; opacity: .45; margin-top: 3px; }

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
  </style>`;
}
