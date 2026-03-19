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

// ---- Estado UI local ----
const uiState = {
  loading:        false,
  error:          null,
  lastResult:     null,  // NeuroCoreResult
  traceExpanded:  false,
  neuronsExpanded: false,
};

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
  return `
    <div class="nchatWrap">
      ${ncCss()}
      ${configWarning}
      <div class="ncLayout">
        <!-- Panel principal de chat -->
        <div class="ncMain">
          <div class="ncHeader">
            <div class="ncHeaderLeft">
              <span class="ncHeaderIcon">🧠</span>
              <div>
                <div class="ncHeaderTitle">NeuroChat</div>
                <div class="ncHeaderSub">${totalNeurons} neuronas · ${history.filter(m => m.role === "user").length} conversaciones</div>
              </div>
            </div>
            <div class="ncHeaderActions">
              <button class="ncIconBtn" id="btnNcToggleNeurons" title="Ver neuronas">${uiState.neuronsExpanded ? "🧠▾" : "🧠"}</button>
              <button class="ncIconBtn" id="btnNcClear" title="Limpiar chat">🗑</button>
            </div>
          </div>

          <div class="ncMessages" id="ncMessages">
            ${messagesHtml}
            ${uiState.loading ? `<div class="ncLoading"><span class="ncDot"></span><span class="ncDot"></span><span class="ncDot"></span></div>` : ""}
            ${uiState.error   ? `<div class="ncError">⚠️ ${esc(uiState.error)}</div>` : ""}
          </div>

          <div class="ncInputBar">
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
      </div>
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
      const result = await sendMessage(text);
      uiState.lastResult = result;
      uiState.loading    = false;
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
      inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
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

  // Focus en input
  if (inputEl && !uiState.loading) inputEl.focus();
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
    resize: none; max-height: 140px; line-height: 1.5;
  }
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
  </style>`;
}
