/**
 * day-calendar-ui.js — UI del Daily Memory Engine
 * MemoryCarl
 *
 * Exporta:
 *   viewDayCalendar()         → HTML string del calendario/lista de días
 *   wireDayCalendar(root, rerenderCallback) → wiring de eventos
 *   viewDayDetail(day)        → HTML string del detalle de un día
 */

import {
  getAllDays, getCurrentDay, closeDay, updateDay, rollbackDay, getDayByDate, reopenDay,
} from "./dayStore.js";
import { summarizeDay, inferDayEmotion, extractDayThemes, aggregateActivatedNeurons } from "./dayAnalyzer.js";
import { getAllNeurons } from "../neuro/neuronStore.js";
import { requestGeminiDayRefine } from "../services/geminiPremiumClient.js";
import { applyDayRefinement } from "./dayRefine.js";
import { isOllamaConfigured, enhanceMemoryWithOllama } from "../services/ollamaClient.js";

// ---- Estado de la UI de días ----
export const dayUiState = {
  selectedDayId: null,
  view: "calendar", // "calendar" | "detail"
  loading: false,
  error: null,
  confirmClose: false,
  refiningWithGemini: false,
  editingManually: false,
  manualEdit: null,
};

// ---- Helpers ----

const EMOTION_ICONS = {
  alegría:  "😄",
  tristeza: "😢",
  ansiedad: "😰",
  enojo:    "😠",
  calma:    "😌",
  neutral:  "😐",
};

function esc(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  } catch (_e) {
    return dateStr;
  }
}

function groupDaysByMonth(days) {
  const groups = {};
  for (const day of days) {
    const month = (day.date || "").slice(0, 7); // YYYY-MM
    if (!groups[month]) groups[month] = [];
    groups[month].push(day);
  }
  return groups;
}

function formatMonth(monthStr) {
  if (!monthStr) return "—";
  try {
    const [year, month] = monthStr.split("-").map(Number);
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  } catch (_e) {
    return monthStr;
  }
}

function getNeuronConceptById(id, neurons) {
  const n = neurons.find((n) => n.id === id);
  return n?.core?.concept || id;
}

// ---- CSS ----

function dayCss() {
  return `<style id="dayEngineCss">
  .dcWrap {
    font-family: inherit;
    color: rgba(255,255,255,.9);
    padding: 16px;
    max-width: 860px;
    margin: 0 auto;
  }
  .dcHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    gap: 12px;
    flex-wrap: wrap;
  }
  .dcHeaderTitle {
    font-size: 18px;
    font-weight: 700;
  }
  .dcHeaderSub {
    font-size: 12px;
    opacity: .6;
    margin-top: 2px;
  }
  .dcBtn {
    background: rgba(124,92,255,.18);
    border: 1px solid rgba(124,92,255,.35);
    border-radius: 10px;
    padding: 8px 16px;
    color: #a78bfa;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background .12s;
  }
  .dcBtn:hover { background: rgba(124,92,255,.3); }
  .dcBtn:disabled { opacity: .4; cursor: not-allowed; }
  .dcBtnDanger {
    background: rgba(239,68,68,.12);
    border: 1px solid rgba(239,68,68,.3);
    color: #f87171;
  }
  .dcBtnDanger:hover { background: rgba(239,68,68,.22); }
  .dcBtnSecondary {
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.1);
    color: rgba(255,255,255,.7);
  }
  .dcBtnSecondary:hover { background: rgba(255,255,255,.12); }

  .dcMonthGroup { margin-bottom: 28px; }
  .dcMonthLabel {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .08em;
    opacity: .45;
    margin-bottom: 10px;
  }
  .dcDayList { display: grid; gap: 10px; }
  .dcDayCard {
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 12px;
    padding: 14px 16px;
    cursor: pointer;
    transition: border-color .12s, background .12s;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .dcDayCard:hover { border-color: rgba(124,92,255,.45); background: rgba(124,92,255,.06); }
  .dcDayCard--open { border-left: 3px solid #a78bfa; }
  .dcDayCard--closed { border-left: 3px solid rgba(255,255,255,.2); opacity: .85; }
  .dcDayEmoIcon { font-size: 22px; flex-shrink: 0; }
  .dcDayMeta { flex: 1; min-width: 0; }
  .dcDayDate { font-size: 14px; font-weight: 600; }
  .dcDayStats { font-size: 11px; opacity: .55; margin-top: 3px; }
  .dcDayStatus {
    font-size: 10px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 20px;
    text-transform: uppercase;
    letter-spacing: .06em;
  }
  .dcDayStatus--open { background: rgba(124,92,255,.18); color: #a78bfa; }
  .dcDayStatus--closed { background: rgba(255,255,255,.07); color: rgba(255,255,255,.4); }
  .dcMilestoneTag {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 20px;
    background: rgba(250,200,80,.15);
    border: 1px solid rgba(250,200,80,.3);
    color: #fac050;
    letter-spacing: .05em;
    text-transform: uppercase;
    vertical-align: middle;
  }
  .dcEmpty {
    text-align: center;
    padding: 40px 20px;
    opacity: .5;
    font-size: 14px;
  }

  /* Detail view */
  .dcDetailBack {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #a78bfa;
    cursor: pointer;
    margin-bottom: 18px;
    width: fit-content;
  }
  .dcDetailBack:hover { text-decoration: underline; }
  .dcDetailHeader {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .dcDetailDate { font-size: 20px; font-weight: 700; }
  .dcDetailEmo { font-size: 14px; opacity: .75; margin-top: 4px; }
  .dcDetailActions { display: flex; gap: 8px; flex-wrap: wrap; }

  .dcSection { margin-bottom: 20px; }
  .dcSectionTitle {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .08em;
    opacity: .45;
    margin-bottom: 10px;
  }
  .dcSummaryBox {
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 14px;
    line-height: 1.6;
  }
  .dcThemeChips { display: flex; flex-wrap: wrap; gap: 6px; }
  .dcChip {
    background: rgba(124,92,255,.15);
    border: 1px solid rgba(124,92,255,.25);
    border-radius: 20px;
    padding: 4px 10px;
    font-size: 12px;
    color: #c4b5fd;
  }
  .dcNeuronChip {
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 20px;
    padding: 4px 10px;
    font-size: 12px;
    color: rgba(255,255,255,.75);
  }
  .dcTimeline { display: grid; gap: 8px; }
  .dcTimelineMsg {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(255,255,255,.03);
    border: 1px solid rgba(255,255,255,.06);
    font-size: 13px;
  }
  .dcTimelineMsg--user .dcMsgRole { color: #a78bfa; }
  .dcTimelineMsg--assistant .dcMsgRole { color: rgba(255,255,255,.45); }
  .dcMsgRole { font-size: 10px; font-weight: 700; text-transform: uppercase; flex-shrink: 0; min-width: 60px; }
  .dcMsgText { flex: 1; line-height: 1.5; opacity: .9; }
  .dcMsgTime { font-size: 10px; opacity: .4; flex-shrink: 0; }

  .dcInsightList { display: grid; gap: 6px; }
  .dcInsightItem {
    background: rgba(250,200,80,.06);
    border: 1px solid rgba(250,200,80,.18);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    line-height: 1.5;
  }

  .dcError {
    background: rgba(239,68,68,.08);
    border: 1px solid rgba(239,68,68,.25);
    border-radius: 8px;
    padding: 10px 14px;
    color: #f87171;
    font-size: 13px;
    margin-bottom: 14px;
  }
  .dcLoading {
    text-align: center;
    padding: 20px;
    opacity: .6;
    font-size: 14px;
  }
  .dcConfirmBanner {
    background: rgba(239,68,68,.08);
    border: 1px solid rgba(239,68,68,.25);
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 14px;
    font-size: 13px;
  }
  .dcConfirmBannerText { flex: 1; }
  .dcEditTextarea {
    width: 100%;
    min-height: 80px;
    background: rgba(255,255,255,.05);
    border: 1px solid rgba(124,92,255,.3);
    border-radius: 8px;
    padding: 10px 12px;
    color: rgba(255,255,255,.9);
    font-size: 14px;
    line-height: 1.5;
    resize: vertical;
    font-family: inherit;
    box-sizing: border-box;
  }
  .dcEditTextarea:focus { outline: none; border-color: rgba(124,92,255,.6); }
  </style>`;
}

// ---- Vista: Calendario (lista de días) ----

export function viewDayCalendar() {
  const days = getAllDays().sort((a, b) => (b.date > a.date ? 1 : -1));
  const groups = groupDaysByMonth(days);
  const months = Object.keys(groups).sort((a, b) => (b > a ? 1 : -1));

  const listHtml = months.length === 0
    ? `<div class="dcEmpty">No hay días registrados aún.<br>Los días se crean automáticamente cuando chateas.</div>`
    : months.map((month) => {
      const monthDays = groups[month];
      const dayCardsHtml = monthDays.map((day) => {
        const emoIcon = EMOTION_ICONS[day.dominantEmotion] || "😐";
        const msgCount = (day.rawChat || []).filter((m) => m.role === "user").length;
        const neuronCount = (day.linkedNeurons || []).length;
        const statusClass = day.status === "open" ? "dcDayCard--open" : "dcDayCard--closed";
        const statusLabel = day.status === "open" ? "open" : "cerrado";
        const statusCls = day.status === "open" ? "dcDayStatus--open" : "dcDayStatus--closed";
        const milestoneTag = day.isMilestone ? `<span class="dcMilestoneTag">⭐ Hito</span>` : "";
        return `
          <div class="dcDayCard ${statusClass}" data-day-id="${esc(day.id)}">
            <div class="dcDayEmoIcon">${emoIcon}</div>
            <div class="dcDayMeta">
              <div class="dcDayDate">${esc(formatDate(day.date))}${milestoneTag ? " " + milestoneTag : ""}</div>
              <div class="dcDayStats">${msgCount} mensaje${msgCount !== 1 ? "s" : ""} · ${neuronCount} neurona${neuronCount !== 1 ? "s" : ""}${day.geminiProcessed ? " · ✨ Refinado" : ""}</div>
            </div>
            <div class="dcDayStatus ${statusCls}">${statusLabel}</div>
          </div>`;
      }).join("");
      return `
        <div class="dcMonthGroup">
          <div class="dcMonthLabel">${esc(formatMonth(month))}</div>
          <div class="dcDayList">${dayCardsHtml}</div>
        </div>`;
    }).join("");

  return `
    <div class="dcWrap" id="dcCalendarView">
      ${dayCss()}
      <div class="dcHeader">
        <div>
          <div class="dcHeaderTitle">📅 Daily Memory Engine</div>
          <div class="dcHeaderSub">${days.length} día${days.length !== 1 ? "s" : ""} registrado${days.length !== 1 ? "s" : ""}</div>
        </div>
      </div>
      ${listHtml}
    </div>`;
}

// ---- Vista: Detalle de día ----

export function viewDayDetail(day) {
  if (!day) return `<div class="dcWrap"><div class="dcEmpty">Día no encontrado.</div></div>`;

  const neurons = getAllNeurons();
  const emoIcon = EMOTION_ICONS[day.dominantEmotion] || "😐";
  const themes = day.dominantThemes?.length ? day.dominantThemes : extractDayThemes(day);
  const linkedNeuronConcepts = (day.linkedNeurons || []).map((id) => getNeuronConceptById(id, neurons));
  const userMsgs = (day.rawChat || []).filter((m) => m.role === "user").length;
  const statusLabel = day.status === "open" ? "Abierto" : "Cerrado";
  const statusCls = day.status === "open" ? "dcDayStatus--open" : "dcDayStatus--closed";

  const summaryHtml = `
    <div class="dcSection">
      <div class="dcSectionTitle">Resumen</div>
      ${dayUiState.editingManually ? `
        <textarea class="dcEditTextarea" id="dcManualSummary" rows="4">${esc(dayUiState.manualEdit?.summary ?? day.summary)}</textarea>
      ` : `<div class="dcSummaryBox">${esc(day.summary || summarizeDay(day))}</div>`}
    </div>`;

  const themesHtml = themes.length ? `
    <div class="dcSection">
      <div class="dcSectionTitle">Temas dominantes</div>
      <div class="dcThemeChips">${themes.map((t) => `<span class="dcChip">${esc(t)}</span>`).join("")}</div>
    </div>` : "";

  const neuronsHtml = linkedNeuronConcepts.length ? `
    <div class="dcSection">
      <div class="dcSectionTitle">Neuronas vinculadas (${linkedNeuronConcepts.length})</div>
      <div class="dcThemeChips">${linkedNeuronConcepts.map((c) => `<span class="dcNeuronChip">🧠 ${esc(c)}</span>`).join("")}</div>
    </div>` : "";

  const insightsHtml = (day.insights || []).length ? `
    <div class="dcSection">
      <div class="dcSectionTitle">Insights (${day.insights.length})</div>
      <div class="dcInsightList">${day.insights.map((ins) => `<div class="dcInsightItem">💡 ${esc(ins)}</div>`).join("")}</div>
    </div>` : "";

  const isOllamaConf = typeof isOllamaConfigured === "function" ? isOllamaConfigured() : false;
  const memorySuggestionsHtml = (day.memorySuggestions || []).length ? `
    <div class="dcSection">
      <div class="dcSectionTitle">Sugerencias de memoria (${day.memorySuggestions.length})</div>
      <div class="dcInsightList">${day.memorySuggestions.map((s, idx) => `
        <div class="dcInsightItem">
          📝 <b>${esc(s.title)}</b>${s.importance === "high" ? " ⭐" : ""}<br>
          <span style="opacity:.8">${esc(s.text)}</span>
          <div style="margin-top: 5px;">
            ${isOllamaConf ? `<button class="dcBtn dcBtnSecondary" style="font-size: 10px; padding: 2px 6px;" data-improve-suggestion="${idx}">✨ Mejorar con Ollama</button>` : ""}
          </div>
        </div>`).join("")}</div>
    </div>` : "";

  const timelineHtml = (day.rawChat || []).length ? `
    <div class="dcSection">
      <div class="dcSectionTitle">Timeline (${day.rawChat.length} mensajes)</div>
      <div class="dcTimeline">
        ${day.rawChat.map((msg) => {
          const timeStr = msg.ts ? new Date(msg.ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
          const roleClass = msg.role === "user" ? "dcTimelineMsg--user" : "dcTimelineMsg--assistant";
          const roleLabel = msg.role === "user" ? "Tú" : "Carl";
          const text = (msg.content || "").slice(0, 200);
          const suffix = (msg.content || "").length > 200 ? "..." : "";
          return `<div class="dcTimelineMsg ${roleClass}">
            <div class="dcMsgRole">${esc(roleLabel)}</div>
            <div class="dcMsgText">${esc(text)}${suffix}</div>
            ${timeStr ? `<div class="dcMsgTime">${esc(timeStr)}</div>` : ""}
          </div>`;
        }).join("")}
      </div>
    </div>` : "";

  const confirmBanner = dayUiState.confirmClose ? `
    <div class="dcConfirmBanner">
      <div class="dcConfirmBannerText">¿Cerrar este día? Se generará un resumen automático. Esta acción no borra los datos.</div>
      <button class="dcBtn" id="dcConfirmCloseYes">✅ Confirmar cierre</button>
      <button class="dcBtn dcBtnSecondary" id="dcConfirmCloseNo">Cancelar</button>
    </div>` : "";

  const errorBanner = dayUiState.error ? `<div class="dcError">⚠️ ${esc(dayUiState.error)}</div>` : "";
  const loadingBanner = dayUiState.loading ? `<div class="dcLoading">⏳ Procesando…</div>` : "";

  const canClose = day.status === "open";
  const canReopen = day.status === "closed";
  const canRollback = Boolean(day._previousVersion);
  const milestoneLabel = day.isMilestone ? "Quitar hito" : "⭐ Marcar hito";

  const actionButtons = `
    <div class="dcDetailActions">
      ${canClose ? `<button class="dcBtn" id="dcBtnCloseDay">🔒 Cerrar día</button>` : ""}
      ${canReopen ? `<button class="dcBtn dcBtnSecondary" id="dcBtnReopenDay">🔓 Reabrir día</button>` : ""}
      <button class="dcBtn" id="dcBtnRefineGemini" ${dayUiState.loading ? "disabled" : ""}>✨ Refinar con Gemini</button>
      ${!dayUiState.editingManually
        ? `<button class="dcBtn dcBtnSecondary" id="dcBtnEditManual">✏️ Editar manualmente</button>`
        : `<button class="dcBtn" id="dcBtnSaveManual">💾 Guardar edición</button>
           <button class="dcBtn dcBtnSecondary" id="dcBtnCancelManual">Cancelar</button>`}
      <button class="dcBtn dcBtnSecondary" id="dcBtnToggleMilestone">${esc(milestoneLabel)}</button>
      ${canRollback ? `<button class="dcBtn dcBtnDanger" id="dcBtnRollback">↩️ Deshacer cambios</button>` : ""}
    </div>`;

  return `
    <div class="dcWrap" id="dcDetailView" data-day-id="${esc(day.id)}">
      ${dayCss()}
      <div class="dcDetailBack" id="dcBackToCalendar">← Volver al calendario</div>
      ${errorBanner}
      ${loadingBanner}
      ${confirmBanner}
      <div class="dcDetailHeader">
        <div>
          <div class="dcDetailDate">${esc(formatDate(day.date))} ${emoIcon}</div>
          <div class="dcDetailEmo">Emoción: <b>${esc(day.dominantEmotion || "neutral")}</b> · <span class="dcDayStatus ${statusCls}">${esc(statusLabel)}</span>${day.geminiProcessed ? " · ✨ Refinado con Gemini" : ""}</div>
        </div>
        ${actionButtons}
      </div>
      ${summaryHtml}
      ${themesHtml}
      ${neuronsHtml}
      ${insightsHtml}
      ${memorySuggestionsHtml}
      ${timelineHtml}
    </div>`;
}

// ---- Wiring del calendario ----

export function wireDayCalendar(root, rerenderCallback) {
  // Click en tarjeta de día → ir a detalle
  root.querySelectorAll(".dcDayCard[data-day-id]").forEach((card) => {
    card.addEventListener("click", () => {
      dayUiState.selectedDayId = card.getAttribute("data-day-id");
      dayUiState.view = "detail";
      dayUiState.confirmClose = false;
      dayUiState.error = null;
      dayUiState.editingManually = false;
      dayUiState.manualEdit = null;
      rerenderCallback();
    });
  });

  // Botones de Mejorar Sugerencia (Ollama)
  root.querySelectorAll("[data-improve-suggestion]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = btn.getAttribute("data-improve-suggestion");
      if (idx === null) return;
      const day = getDayByDate(dayUiState.selectedDayId);
      if (!day || !day.memorySuggestions || !day.memorySuggestions[idx]) return;

      const originalText = btn.textContent;
      btn.textContent = "✨ Mejorando...";
      btn.disabled = true;

      try {
        const result = await enhanceMemoryWithOllama(day.memorySuggestions[idx]);
        day.memorySuggestions[idx].title = result.title || day.memorySuggestions[idx].title;
        day.memorySuggestions[idx].text = result.text || day.memorySuggestions[idx].text;
        if (result.tags) day.memorySuggestions[idx].tags = result.tags;
        
        updateDay(day.date, { memorySuggestions: day.memorySuggestions });
      } catch (err) {
        dayUiState.error = err.message || "Error al mejorar con Ollama";
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
        rerenderCallback();
      }
    });
  });
}

// ---- Wiring del detalle ----

export function wireDayDetail(root, rerenderCallback) {
  // Volver al calendario
  root.querySelector("#dcBackToCalendar")?.addEventListener("click", () => {
    dayUiState.view = "calendar";
    dayUiState.confirmClose = false;
    dayUiState.error = null;
    dayUiState.editingManually = false;
    dayUiState.manualEdit = null;
    rerenderCallback();
  });

  const dayId = root.querySelector("#dcDetailView")?.getAttribute("data-day-id");
  if (!dayId) return;

  // Botón cerrar día → pedir confirmación
  root.querySelector("#dcBtnCloseDay")?.addEventListener("click", () => {
    dayUiState.confirmClose = true;
    rerenderCallback();
  });

  // Confirmar cierre
  root.querySelector("#dcConfirmCloseYes")?.addEventListener("click", () => {
    const days = getAllDays();
    const day = days.find((d) => d.id === dayId);
    if (!day) return;

    // Generar resumen, emoción y temas automáticamente antes de cerrar
    const neuronIds = aggregateActivatedNeurons(day);
    const updatedDay = {
      ...day,
      summary: day.summary || summarizeDay(day),
      dominantEmotion: day.dominantEmotion !== "neutral" ? day.dominantEmotion : inferDayEmotion(day),
      dominantThemes: day.dominantThemes?.length ? day.dominantThemes : extractDayThemes(day),
      linkedNeurons: neuronIds.length > 0 ? [...new Set([...(day.linkedNeurons || []), ...neuronIds])] : day.linkedNeurons,
    };
    updateDay(updatedDay);
    closeDay(day.date);

    dayUiState.confirmClose = false;
    dayUiState.error = null;
    rerenderCallback();
  });

  // Cancelar cierre
  root.querySelector("#dcConfirmCloseNo")?.addEventListener("click", () => {
    dayUiState.confirmClose = false;
    rerenderCallback();
  });

  // Botón Refinar con Gemini
  root.querySelector("#dcBtnRefineGemini")?.addEventListener("click", async () => {
    const days = getAllDays();
    const day = days.find((d) => d.id === dayId);
    if (!day) return;

    dayUiState.loading = true;
    dayUiState.error = null;
    rerenderCallback();

    try {
      const neurons = getAllNeurons();
      const linkedNeuronsData = (day.linkedNeurons || [])
        .map((id) => neurons.find((n) => n.id === id))
        .filter(Boolean)
        .map((n) => ({ id: n.id, concept: n.core?.concept, domain: n.core?.domain, summary: n.core?.summary }));

      const response = await requestGeminiDayRefine({
        rawChat: day.rawChat || [],
        memories: day.memoryIds || day.memories || [], // memoryIds is the current field; memories is the legacy field name
        linkedNeurons: linkedNeuronsData,
        currentSummary: day.summary,
        currentEmotion: day.dominantEmotion,
        currentThemes: day.dominantThemes,
        currentInsights: day.insights || [],
        date: day.date,
      });

      if (response) {
        applyDayRefinement(day.id, response);
      } else {
        dayUiState.error = "No se pudo refinar con Gemini. Verifica tu API key en Ajustes de NeuroChat.";
      }
    } catch (err) {
      dayUiState.error = `Error al refinar: ${err?.message || "desconocido"}`;
    } finally {
      dayUiState.loading = false;
      rerenderCallback();
    }
  });

  // Botón rollback
  root.querySelector("#dcBtnRollback")?.addEventListener("click", () => {
    const result = rollbackDay(dayId);
    if (!result) {
      dayUiState.error = "No hay versión anterior para restaurar.";
    } else {
      dayUiState.error = null;
    }
    rerenderCallback();
  });

  // Edición manual
  root.querySelector("#dcBtnEditManual")?.addEventListener("click", () => {
    const days = getAllDays();
    const day = days.find((d) => d.id === dayId);
    if (!day) return;
    dayUiState.editingManually = true;
    dayUiState.manualEdit = { summary: day.summary };
    rerenderCallback();
  });

  root.querySelector("#dcBtnSaveManual")?.addEventListener("click", () => {
    const days = getAllDays();
    const day = days.find((d) => d.id === dayId);
    if (!day) return;
    const summaryEl = root.querySelector("#dcManualSummary");
    const newSummary = summaryEl ? summaryEl.value : (dayUiState.manualEdit?.summary || day.summary);
    updateDay({ ...day, summary: newSummary });
    dayUiState.editingManually = false;
    dayUiState.manualEdit = null;
    dayUiState.error = null;
    rerenderCallback();
  });

  root.querySelector("#dcBtnCancelManual")?.addEventListener("click", () => {
    dayUiState.editingManually = false;
    dayUiState.manualEdit = null;
    rerenderCallback();
  });

  // Botón reabrir día
  root.querySelector("#dcBtnReopenDay")?.addEventListener("click", () => {
    const result = reopenDay(dayId);
    if (!result) {
      dayUiState.error = "No se pudo reabrir el día.";
    } else {
      dayUiState.error = null;
    }
    rerenderCallback();
  });

  // Botón toggle milestone
  root.querySelector("#dcBtnToggleMilestone")?.addEventListener("click", () => {
    const days = getAllDays();
    const day = days.find((d) => d.id === dayId);
    if (!day) return;
    updateDay({ ...day, isMilestone: !day.isMilestone });
    rerenderCallback();
  });
}
