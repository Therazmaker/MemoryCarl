import { getAllNeurons } from "../neuro/neuronStore.js";
import {
  listContextWindowNeurons,
  createContextWindowNeuron,
  updateContextWindowNeuron,
  deleteContextWindowNeuron,
  duplicateContextWindowNeuron,
  createManualLink,
  removeManualLink,
  applyQuickTemplate,
  QUICK_CONTEXT_TEMPLATES,
  getContextNeuronDeletionImpact,
  deleteContextNeuronSafely,
  restoreContextNeuron,
} from "../neuro/contextWindow.js";
import { importHistoricalEntries } from "../neuro/historicalImport.js";
import {
  parseNeuronJsonInput,
  normalizeImportedNeuronPayload,
  previewNeuronImport,
  importNeuronJson,
  getNeuronSchemaTemplate,
  getNeuronPromptTemplate,
  copyNeuronSchemaAndPrompt,
  copyNeuronSchemaToClipboard,
  copyNeuronPromptToClipboard,
} from "../neuro/importer.js";
import { updateNeuron } from "../neuro/neuronStore.js";
import { acceptTriggerCandidate, rejectTriggerCandidate, ensureNeuronEvolution } from "../neuro/evolution.js";

const COPY_FEEDBACK_DURATION_MS = 2000;
const SCHEMA_COPIED_MSG = "Schema copiado 📋";
const PROMPT_COPIED_MSG = "Prompt copiado 🤖";
const BOTH_COPIED_MSG = "Schema + prompt copiados 🚀";

const state = {
  query: "",
  filters: { category: "", type: "", priority: "", pinned: "", withConnections: "", timeContext: "", stage: "", dateFrom: "", dateTo: "", showDeleted: "" },
  filtersOpen: false,
  selectedId: null,
  editingId: null,
  importText: "",
  importMode: "journal",
  importSource: "",
  importHistorical: true,
  importStage: "",
  importSummary: null,
  // JSON Import tab
  activeTab: "manual",   // "manual" | "json_import" | "historical"
  jsonImportText: "",
  jsonImportDupStrategy: "discard",
  jsonImportPreview: null,
  jsonImportResult: null,
  jsonImportMsg: "",
  jsonCopyMsg: "",
  jsonSchemaCopyMsg: "",
  jsonPromptCopyMsg: "",
};

function esc(str) { return String(str ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

function getFiltered() {
  const options = {
    query: state.query,
    category: state.filters.category || undefined,
    type: state.filters.type || undefined,
    priority: state.filters.priority || undefined,
    pinned: state.filters.pinned === "" ? undefined : state.filters.pinned === "1",
    withConnections: state.filters.withConnections === "" ? undefined : state.filters.withConnections === "1",
    showDeleted: state.filters.showDeleted === "1",
  };
  const rows = listContextWindowNeurons(options);
  return rows.filter((n) => {
    const t = n.temporal || {};
    if (state.filters.timeContext && (t.timeContext || "timeless") !== state.filters.timeContext) return false;
    if (state.filters.stage && (t.stage || "") !== state.filters.stage) return false;
    if (state.filters.dateFrom && t.date && t.date < state.filters.dateFrom) return false;
    if (state.filters.dateTo && t.date && t.date > state.filters.dateTo) return false;
    return true;
  });
}

function renderCard(n) {
  const isSelected = n.id === state.selectedId;
  const temporalBadge = `<span class="cwTemporal cwTemporal--${esc(n.temporal?.timeContext || "timeless")}">${esc(n.temporal?.timeContext || "timeless")}</span>`;
  const temporalLine = [n.temporal?.date, n.temporal?.isHistorical ? "histórico" : "", n.temporal?.stage]
    .filter(Boolean)
    .join(" · ");
  return `<button class="cwCard ${isSelected ? "cwCard--selected" : ""}" data-id="${esc(n.id)}">
    <div class="cwCardHead"><b>${esc(n.core?.concept || "—")}</b><span>${n.meta?.pin ? "📌" : ""}</span></div>
    <div class="cwMeta">${esc(n.type)} · ${esc(n.meta?.manualCategory || "other")} · ${esc(n.meta?.priority || "medium")} ${n.deleted ? "· 🗑️ deleted" : ""}</div>
    <div class="cwMeta">${temporalBadge}</div>
    ${temporalLine ? `<div class="cwMeta">🕒 ${esc(temporalLine)}</div>` : ""}
    <div class="cwSummary">${esc(n.core?.summary || "")}</div>
    <div class="cwAliases">${(n.meta?.aliases || []).slice(0, 3).map((a) => `<span>${esc(a)}</span>`).join("")}</div>
    <div class="cwConn">${(n.connections || []).length} conexiones</div>
  </button>`;
}

function renderForm(neuron) {
  const n = neuron || { core: {}, meta: {}, triggers: [] };
  return `<form id="cwForm" class="cwForm">
    <div style="font-weight:700;font-size:14px;margin-bottom:4px;color:#a5b4fc">${state.editingId ? "✏️ Editar Neurona" : "➕ Nueva Neurona Contextual"}</div>
    <input name="concept" placeholder="Concepto (ej. Trabajo, Alex)" value="${esc(n.core?.concept || "")}" required />
    <input name="summary" placeholder="Resumen corto" value="${esc(n.core?.summary || "")}" />
    <div class="cwFormRow">
      <input name="type" placeholder="Tipo (ej. manual_context)" value="${esc(n.type || "manual_context")}" />
      <input name="manualCategory" placeholder="Categoría" value="${esc(n.meta?.manualCategory || "other")}" />
    </div>
    <input name="aliases" placeholder="Aliases (separados por coma)" value="${esc((n.meta?.aliases || []).join(", "))}" />
    <div class="cwFormRow">
      <select name="priority">
        <option value="low">Prioridad Baja</option>
        <option value="medium" ${n.meta?.priority !== "high" && n.meta?.priority !== "low" ? "selected" : ""}>Prioridad Media</option>
        <option value="high" ${n.meta?.priority === "high" ? "selected" : ""}>Prioridad Alta</option>
      </select>
      <label class="cwCheckLabel"><input type="checkbox" name="pin" ${n.meta?.pin ? "checked" : ""}/> 📌 Pin</label>
    </div>
    <div class="cwFormRow">
      <input name="emotion" placeholder="Emoción" value="${esc(n.emotion || "neutral")}" />
      <input name="triggers" placeholder="Triggers (coma)" value="${esc((n.triggers || []).join(", "))}" />
    </div>
    <div class="cwFormRow">
      <input name="date" type="date" value="${esc(n.temporal?.date || "")}" />
      <input name="stage" placeholder="Etapa / Stage" value="${esc(n.temporal?.stage || "")}" />
    </div>
    <label class="cwCheckLabel"><input type="checkbox" name="isHistorical" ${n.temporal?.isHistorical ? "checked" : ""}/> 📜 Marcar como Histórico</label>
    <textarea name="notes" placeholder="Notas adicionales">${esc(n.meta?.notes || "")}</textarea>
    <input name="colorTag" placeholder="Color Tag (ej. #6366f1)" value="${esc(n.meta?.colorTag || "")}" />
    <div class="cwFormActions">
      <button type="submit" class="cwBtn cwBtn--primary">${state.editingId ? "Guardar Cambios" : "Crear Neurona"}</button>
      ${state.editingId ? '<button type="button" id="cwCancelEdit" class="cwBtn cwBtn--secondary">Cancelar</button>' : ''}
    </div>
  </form>`;
}

function renderDetail() {
  const neuron = getFiltered().find((n) => n.id === state.selectedId);
  if (!neuron) return `<div class="cwDetail cwDetail--empty">Selecciona una neurona manual para ver sus detalles.</div>`;
  ensureNeuronEvolution(neuron);
  const connButtons = (neuron.connections || []).map((id) => `<button class="cwLinkBtn" data-unlink="${id}">unlink ${esc(id)}</button>`).join("");
  const triggerCandidates = (neuron.evolution?.triggerCandidates || []).filter((c) => !c.rejected && !c.approved).slice(0, 5);
  const candidateHtml = triggerCandidates.length
    ? triggerCandidates.map((c) => `<div class="cwEvolutionItem">
      <span><b>${esc(c.trigger)}</b> · f:${c.frequency} · s:${Number(c.score || 0).toFixed(2)}</span>
      <span>
        <button class="cwTriggerAction" data-approve-trigger="${esc(c.trigger)}">Aprobar</button>
        <button class="cwTriggerAction" data-reject-trigger="${esc(c.trigger)}">Rechazar</button>
      </span>
    </div>`).join("")
    : "<div>Sin candidatos pendientes</div>";
  return `<div class="cwDetail">
    <div class="cwDetailHead">
      <h3>${esc(neuron.core.concept)}</h3>
      <button id="cwDeselect" class="cwBtn cwBtn--secondary" style="min-height:32px;padding:4px 10px;font-size:11px">✕ Cerrar</button>
    </div>
    <p>${esc(neuron.core.summary || "")}</p>
    <div class="cwDetailMeta">
      <div><b>Aliases:</b> ${(neuron.meta?.aliases || []).join(", ") || "—"}</div>
      <div><b>Prioridad:</b> ${esc(neuron.meta?.priority || "medium")} · <b>Pin:</b> ${neuron.meta?.pin ? "Sí" : "No"}</div>
      <div><b>Categoría:</b> ${esc(neuron.meta?.manualCategory || "other")}</div>
      <div><b>Triggers:</b> ${(neuron.triggers || []).join(", ") || "—"}</div>
      <div><b>Evidencia:</b> ${(neuron.evidence || []).join(", ") || "—"}</div>
      <div><b>Notas:</b> ${esc(neuron.meta?.notes || "—")}</div>
      <div><b>Conexiones:</b> ${(neuron.connections || []).join(", ") || "—"}</div>
      <div><b>Fecha:</b> ${esc(neuron.temporal?.date || "—")} · <b>Histórico:</b> ${neuron.temporal?.isHistorical ? "sí" : "no"} · <b>Contexto:</b> ${esc(neuron.temporal?.timeContext || "timeless")} · <b>Stage:</b> ${esc(neuron.temporal?.stage || "—")}</div>
    </div>
    <div class="cwEvolutionBox">
      <h4>Evolución AI</h4>
      <div><b>Uso:</b> ${neuron.evolution.usageCount} · <b>Éxitos:</b> ${neuron.evolution.successfulActivations} · <b>Fallos:</b> ${neuron.evolution.failedActivations}</div>
      <div><b>Último uso:</b> ${esc(neuron.evolution.lastUsedAt || "—")} · <b>Peso:</b> ${Number(neuron.weight || 0).toFixed(3)}</div>
      <div><b>Sugerencia resumen:</b> ${esc(neuron.evolution.summarySuggestion?.suggestedSummary || "—")}</div>
      <div style="margin-top:6px;font-weight:600">Candidatos trigger:</div>
      ${candidateHtml}
    </div>
    <div class="cwRowBtns">
      <button id="cwEdit">✏️ Editar</button>
      <button id="cwDelete">🗑️ Eliminar</button>
      ${neuron.deleted ? '<button id="cwRestore">♻️ Restaurar</button>' : ""}
      <button id="cwDuplicate">📄 Duplicar</button>
      <button id="cwTogglePin">${neuron.meta?.pin ? "📌 Unpin" : "📌 Pin"}</button>
    </div>
    <div class="cwLinkRow">
      <input id="cwLinkTarget" placeholder="ID de neurona a conectar" />
      <button id="cwAddLink" class="cwBtn cwBtn--secondary">Vincular</button>
    </div>
    <div class="cwConnList">${connButtons}</div>
  </div>`;
}

function sel(current, value) { return current === value ? " selected" : ""; }
function tab(current, value, label) {
  return `<button class="cwTab${current === value ? " cwTab--active" : ""}" data-tab="${value}">${label}</button>`;
}

function renderJsonImportTab() {
  const p = state.jsonImportPreview;
  const previewHtml = p ? `
    <div class="cwImportPreview">
      <div class="cwImportPreviewRow cwImportPreviewRow--ok">✓ Válidas: ${p.valid.length}</div>
      ${p.valid.slice(0, 3).map((item) => `<div class="cwImportPreviewItem">• ${esc(item.neuron?.core?.concept || "—")} <span class="cwImportTag">OK</span></div>`).join("")}
      ${p.fixable.length > 0 ? `<div class="cwImportPreviewRow cwImportPreviewRow--warn">⚠ Corregibles: ${p.fixable.length}</div>` : ""}
      ${p.fixable.slice(0, 3).map((item) => `<div class="cwImportPreviewItem">• ${esc(item.neuron?.core?.concept || "?")} — ${esc(item.errors.slice(0,2).join("; "))}</div>`).join("")}
      ${p.rejected.length > 0 ? `<div class="cwImportPreviewRow cwImportPreviewRow--err">✗ Rechazadas: ${p.rejected.length}</div>` : ""}
      ${p.rejected.slice(0, 3).map((item) => `<div class="cwImportPreviewItem">• ${esc(item.errors.slice(0,2).join("; "))}</div>`).join("")}
    </div>` : "";

  const resultHtml = state.jsonImportResult ? `
    <div class="cwImportResult">
      Importadas: <b>${state.jsonImportResult.imported}</b> · Merged: <b>${state.jsonImportResult.merged}</b> · Descartadas: <b>${state.jsonImportResult.discarded}</b>
      ${state.jsonImportResult.errors.length ? `<div style="color:#f87171;margin-top:4px">${state.jsonImportResult.errors.slice(0,3).map(esc).join(", ")}</div>` : ""}
    </div>` : "";

  const msgHtml = state.jsonImportMsg
    ? `<div class="cwImportMsg ${state.jsonImportMsg.startsWith("✓") ? "cwImportMsg--ok" : "cwImportMsg--err"}">${esc(state.jsonImportMsg)}</div>`
    : "";

  const copyMsgHtml = state.jsonCopyMsg
    ? `<div class="cwImportMsg cwImportMsg--ok">${esc(state.jsonCopyMsg)}</div>`
    : "";

  const schemaCopyMsgHtml = state.jsonSchemaCopyMsg
    ? `<div class="cwCopyFeedback">${esc(state.jsonSchemaCopyMsg)}</div>`
    : "";

  const promptCopyMsgHtml = state.jsonPromptCopyMsg
    ? `<div class="cwCopyFeedback">${esc(state.jsonPromptCopyMsg)}</div>`
    : "";

  return `
    <div class="cwJsonImport">
      <h3 style="margin:0 0 8px;font-size:14px;font-weight:700">📥 Importar Neuronas JSON</h3>
      <p style="font-size:12px;opacity:.7;margin:0 0 10px;line-height:1.4">Pega una neurona, un array o un objeto con "neurons: [...]". Se acepta JSON con markdown fences.</p>

      <div class="cwCopyBtnRow">
        <button id="cwCopySchema" class="cwBtn cwBtn--secondary">📋 Schema</button>
        <button id="cwCopyPrompt" class="cwBtn cwBtn--secondary">🤖 Prompt</button>
        <button id="cwCopyBoth" class="cwBtn cwBtn--secondary">🚀 Ambos</button>
      </div>
      ${schemaCopyMsgHtml}
      ${promptCopyMsgHtml}
      ${copyMsgHtml}

      <textarea
        id="cwJsonInput"
        class="cwJsonTextarea"
        placeholder='{"type":"person","core":{"concept":"Ejemplo","domain":"relationships","summary":"..."},...}'
        rows="6"
      >${esc(state.jsonImportText)}</textarea>

      <div class="cwJsonActionRow">
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:160px">
          <label style="font-size:11px;opacity:.7">Duplicados:</label>
          <select id="cwJsonDupStrategy" class="cwSelect" style="flex:1">
            <option value="discard"${state.jsonImportDupStrategy === "discard" ? " selected" : ""}>Descartar</option>
            <option value="merge"${state.jsonImportDupStrategy === "merge" ? " selected" : ""}>Merge</option>
            <option value="new"${state.jsonImportDupStrategy === "new" ? " selected" : ""}>Como nueva</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="cwJsonValidate" class="cwBtn cwBtn--secondary">🔍 Validar</button>
          <button id="cwJsonImport" class="cwBtn cwBtn--primary">✅ Importar</button>
        </div>
      </div>

      ${msgHtml}
      ${previewHtml}
      ${resultHtml}

      <details style="margin-top:10px">
        <summary style="font-size:11px;opacity:.6;cursor:pointer">Ver schema…</summary>
        <pre class="cwSchemaPreview">${esc(getNeuronSchemaTemplate())}</pre>
      </details>
    </div>`;
}

export function viewContextWindow() {
  const items = getFiltered();
  const fc = state.filters.category;
  const fp = state.filters.priority;
  const fn = state.filters.pinned;

  const activeFilterCount = [
    state.filters.category,
    state.filters.priority,
    state.filters.pinned,
    state.filters.showDeleted,
    state.filters.timeContext,
    state.filters.stage,
    state.filters.dateFrom,
    state.filters.dateTo
  ].filter(Boolean).length;

  const tabsHtml = `
    <div class="cwTabs">
      ${tab(state.activeTab, "manual", "📝 Manual")}
      ${tab(state.activeTab, "json_import", "📥 Import JSON")}
      ${tab(state.activeTab, "historical", "🗂 Histórico")}
    </div>`;

  const manualTabHtml = state.activeTab === "manual" ? `
    <div class="cwTop">
      <div class="cwTopMain">
        <input id="cwSearch" class="cwSearchInput" placeholder="🔍 Buscar context neuron..." value="${esc(state.query)}" />
        <button id="cwToggleFilters" class="cwBtn cwBtn--secondary cwFilterToggleBtn ${state.filtersOpen ? "cwFilterToggleBtn--active" : ""}">
          ⚙️ Filtros ${activeFilterCount ? `(${activeFilterCount})` : ""}
        </button>
        <button id="cwQuickAdd" class="cwBtn cwBtn--primary">+ Contexto</button>
      </div>
      <div class="cwFiltersGrid ${state.filtersOpen ? "cwFiltersGrid--open" : ""}">
        <select id="cwFilterCategory"><option value=""${sel(fc,"")}>Categoría (todas)</option><option value="people"${sel(fc,"people")}>people</option><option value="work"${sel(fc,"work")}>work</option><option value="hobbies"${sel(fc,"hobbies")}>hobbies</option><option value="projects"${sel(fc,"projects")}>projects</option><option value="preferences"${sel(fc,"preferences")}>preferences</option><option value="places"${sel(fc,"places")}>places</option><option value="identity"${sel(fc,"identity")}>identity</option></select>
        <select id="cwFilterPriority"><option value=""${sel(fp,"")}>Prioridad (todas)</option><option value="low"${sel(fp,"low")}>Baja</option><option value="medium"${sel(fp,"medium")}>Media</option><option value="high"${sel(fp,"high")}>Alta</option></select>
        <select id="cwFilterPinned"><option value=""${sel(fn,"")}>Pinned?</option><option value="1"${sel(fn,"1")}>Pinned</option><option value="0"${sel(fn,"0")}>Not pinned</option></select>
        <select id="cwFilterDeleted"><option value="">Estado?</option><option value="1"${sel(state.filters.showDeleted,"1")}>Mostrar eliminadas</option></select>
        <select id="cwFilterTimeContext"><option value="">Time Context</option><option value="current">current</option><option value="recent">recent</option><option value="past">past</option><option value="historical">historical</option><option value="timeless">timeless</option></select>
        <input id="cwFilterStage" placeholder="Stage" value="${esc(state.filters.stage)}"/>
        <input id="cwFilterDateFrom" type="date" title="Fecha desde" value="${esc(state.filters.dateFrom)}"/>
        <input id="cwFilterDateTo" type="date" title="Fecha hasta" value="${esc(state.filters.dateTo)}"/>
      </div>
    </div>
    <div class="cwLayout">
      <div>
        <div class="cwCards">${items.map(renderCard).join("") || '<div class="cwEmptyList">Sin neuronas manuales</div>'}</div>
      </div>
      <div>
        ${renderForm(getFiltered().find((n) => n.id === state.editingId))}
        ${renderDetail()}
      </div>
    </div>` : "";

  const jsonTabHtml = state.activeTab === "json_import" ? renderJsonImportTab() : "";

  const historicalTabHtml = state.activeTab === "historical" ? `
    <div class="cwDetail">
      <h3>Importación histórica batch</h3>
      <textarea id="cwImportText" class="cwJsonTextarea" placeholder='JSON array: [{"date":"2025-02-10","text":"..."}]' rows="5">${esc(state.importText)}</textarea>
      <div class="cwFormRow" style="margin-top:8px">
        <input id="cwImportSource" placeholder="Source label (ej. diario)" value="${esc(state.importSource)}"/>
        <select id="cwImportMode" class="cwSelect"><option value="journal">journal</option><option value="autobiography">autobiography</option><option value="exercise">exercise</option></select>
      </div>
      <div class="cwFormRow" style="margin-top:8px">
        <input id="cwImportStage" placeholder="Stage aproximada" value="${esc(state.importStage)}"/>
        <label class="cwCheckLabel"><input type="checkbox" id="cwImportHistorical" ${state.importHistorical ? "checked" : ""}/> Histórico</label>
      </div>
      <button id="cwRunImport" class="cwBtn cwBtn--primary" style="margin-top:10px;width:100%">Importar batch</button>
      ${state.importSummary ? `<div class="cwImportResult" style="margin-top:10px">Creadas: <b>${state.importSummary.created}</b> · Fusionadas: <b>${state.importSummary.merged}</b> · Descartadas: <b>${state.importSummary.discarded}</b> · Rango: ${esc(state.importSummary.temporalRange ? `${state.importSummary.temporalRange.start}..${state.importSummary.temporalRange.end}` : "—")}</div>` : ""}
    </div>` : "";

  return `<div class="cwWrap"><style>
    .cwWrap { box-sizing: border-box; width: 100%; color: #f3f4f6; }
    .cwTabs { display: flex; gap: 6px; margin-bottom: 12px; overflow-x: auto; padding-bottom: 4px; -webkit-overflow-scrolling: touch; }
    .cwTab { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 8px 14px; cursor: pointer; font-size: 13px; color: #9ca3af; font-weight: 600; white-space: nowrap; min-height: 40px; display: inline-flex; align-items: center; }
    .cwTab--active { background: rgba(99, 102, 241, 0.25); border-color: rgba(99, 102, 241, 0.5); color: #a5b4fc; }

    .cwTop { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .cwTopMain { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .cwSearchInput { flex: 1; min-width: 160px; background: #151924; color: inherit; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 8px 12px; font-size: 13px; min-height: 40px; box-sizing: border-box; }
    .cwFilterToggleBtn { min-height: 40px; white-space: nowrap; }
    .cwFilterToggleBtn--active { border-color: rgba(99, 102, 241, 0.5); background: rgba(99, 102, 241, 0.2); color: #a5b4fc; }

    .cwFiltersGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; background: rgba(255, 255, 255, 0.03); padding: 10px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.08); }
    .cwFiltersGrid input, .cwFiltersGrid select { background: #151924; color: inherit; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 8px; font-size: 12px; min-height: 38px; width: 100%; box-sizing: border-box; }

    @media (max-width: 768px) {
      .cwFiltersGrid:not(.cwFiltersGrid--open) { display: none; }
    }

    .cwLayout { display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; }
    @media (max-width: 768px) {
      .cwLayout { grid-template-columns: 1fr; }
    }

    .cwCards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
    @media (max-width: 480px) {
      .cwCards { grid-template-columns: 1fr; }
    }

    .cwCard { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); padding: 10px 12px; border-radius: 10px; text-align: left; color: inherit; width: 100%; box-sizing: border-box; cursor: pointer; transition: background .15s, border-color .15s; }
    .cwCard:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(99, 102, 241, 0.4); }
    .cwCard--selected { border-color: rgba(99, 102, 241, 0.6); background: rgba(99, 102, 241, 0.15); }
    .cwCardHead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 14px; }
    .cwMeta { font-size: 11px; opacity: 0.75; margin-bottom: 2px; }
    .cwSummary { font-size: 12px; margin-top: 4px; line-height: 1.3; opacity: 0.9; }
    .cwAliases { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
    .cwAliases span { font-size: 10px; background: rgba(255, 255, 255, 0.08); padding: 2px 6px; border-radius: 4px; }
    .cwConn { font-size: 10px; opacity: 0.6; margin-top: 4px; }
    .cwEmptyList { font-size: 13px; opacity: 0.6; padding: 16px; text-align: center; background: rgba(255, 255, 255, 0.02); border-radius: 10px; border: 1px dashed rgba(255, 255, 255, 0.1); }

    .cwForm { display: grid; gap: 8px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 12px; margin-bottom: 12px; box-sizing: border-box; }
    .cwForm input, .cwForm textarea, .cwForm select { background: #151924; color: inherit; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 8px 10px; font-size: 13px; min-height: 40px; width: 100%; box-sizing: border-box; }
    .cwForm textarea { min-height: 70px; resize: vertical; }
    .cwFormRow { display: flex; gap: 8px; flex-wrap: wrap; }
    .cwFormRow > * { flex: 1; min-width: 130px; }
    .cwCheckLabel { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; min-height: 38px; }
    .cwCheckLabel input { width: auto; min-height: auto; }
    .cwFormActions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }

    .cwDetail { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 12px; box-sizing: border-box; word-break: break-word; }
    .cwDetail--empty { font-size: 13px; opacity: 0.6; text-align: center; padding: 20px; }
    .cwDetailHead { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
    .cwDetailHead h3 { margin: 0; font-size: 16px; font-weight: 700; color: #a5b4fc; }
    .cwDetailMeta { display: grid; gap: 4px; font-size: 12px; opacity: 0.85; margin: 8px 0; background: rgba(0, 0, 0, 0.2); padding: 8px; border-radius: 8px; }
    .cwEvolutionBox { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px; margin-top: 8px; font-size: 11px; }
    .cwEvolutionBox h4 { margin: 0 0 4px; font-size: 12px; color: #a5b4fc; }
    .cwEvolutionItem { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: rgba(255, 255, 255, 0.04); padding: 4px 8px; border-radius: 6px; margin-top: 4px; }
    .cwTriggerAction { background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4); color: #a5b4fc; border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer; }

    .cwTemporal { font-size: 10px; padding: 2px 6px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.2); display: inline-block; }
    .cwRowBtns { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
    .cwRowBtns button { min-height: 38px; padding: 6px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12); color: inherit; font-size: 12px; font-weight: 600; cursor: pointer; flex: 1; min-width: 90px; text-align: center; }
    .cwLinkRow { display: flex; gap: 8px; margin: 8px 0; }
    .cwLinkRow input { flex: 1; background: #151924; color: inherit; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 8px; font-size: 12px; min-height: 38px; }
    .cwLinkBtn { background: rgba(248, 113, 113, 0.15); border: 1px solid rgba(248, 113, 113, 0.3); color: #f87171; border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer; margin: 2px; }

    .cwJsonImport { background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 12px; padding: 12px; box-sizing: border-box; }
    .cwJsonTextarea { width: 100%; box-sizing: border-box; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 10px; color: inherit; font-family: monospace; font-size: 12px; resize: vertical; outline: none; min-height: 120px; }
    .cwSelect { background: #151924; color: inherit; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 6px 8px; font-size: 12px; min-height: 38px; }
    .cwBtn { border: none; border-radius: 8px; padding: 8px 12px; cursor: pointer; font-size: 12px; font-weight: 600; min-height: 40px; display: inline-flex; align-items: center; justify-content: center; transition: background .12s; box-sizing: border-box; white-space: nowrap; }
    .cwBtn--primary { background: rgba(99, 102, 241, 0.3); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.4); }
    .cwBtn--primary:hover { background: rgba(99, 102, 241, 0.45); }
    .cwBtn--secondary { background: rgba(255, 255, 255, 0.07); color: inherit; border: 1px solid rgba(255, 255, 255, 0.1); }
    .cwBtn--secondary:hover { background: rgba(255, 255, 255, 0.14); }

    .cwCopyBtnRow { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
    .cwCopyBtnRow .cwBtn { flex: 1; min-width: 90px; }
    .cwJsonActionRow { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: space-between; margin-top: 10px; }

    .cwImportPreview { margin-top: 10px; font-size: 11px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
    .cwImportPreviewRow { font-weight: 700; }
    .cwImportPreviewRow--ok { color: #34d399; }
    .cwImportPreviewRow--warn { color: #fbbf24; }
    .cwImportPreviewRow--err { color: #f87171; }
    .cwImportPreviewItem { padding-left: 8px; opacity: 0.8; word-break: break-all; }
    .cwImportTag { font-size: 10px; padding: 1px 5px; border-radius: 5px; background: rgba(52, 211, 153, 0.15); color: #34d399; margin-left: 4px; }
    .cwImportResult { margin-top: 8px; font-size: 12px; background: rgba(52, 211, 153, 0.08); border: 1px solid rgba(52, 211, 153, 0.2); border-radius: 8px; padding: 8px; }
    .cwImportMsg { font-size: 12px; padding: 6px 10px; border-radius: 8px; margin-top: 8px; }
    .cwImportMsg--ok { background: rgba(52, 211, 153, 0.12); color: #34d399; }
    .cwImportMsg--err { background: rgba(248, 113, 113, 0.12); color: #f87171; }
    .cwSchemaPreview { font-size: 10px; overflow: auto; max-height: 200px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 6px; padding: 8px; margin-top: 6px; }
    .cwCopyFeedback { font-size: 11px; padding: 4px 10px; border-radius: 6px; background: rgba(99, 102, 241, 0.15); color: #a5b4fc; margin-bottom: 6px; display: inline-block; }
  </style>
  ${tabsHtml}
  ${manualTabHtml}
  ${jsonTabHtml}
  ${historicalTabHtml}
  </div>`;
}

export function wireContextWindow(root, rerender) {
  // Tab switching
  root.querySelectorAll(".cwTab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      state.jsonImportMsg = "";
      state.jsonCopyMsg = "";
      state.jsonSchemaCopyMsg = "";
      state.jsonPromptCopyMsg = "";
      state.jsonImportPreview = null;
      state.jsonImportResult = null;
      rerender();
    });
  });

  root.querySelectorAll(".cwCard").forEach((el) => el.addEventListener("click", () => {
    state.selectedId = el.dataset.id;
    state.editingId = null;
    rerender();
  }));

  root.querySelector("#cwDeselect")?.addEventListener("click", () => {
    state.selectedId = null;
    rerender();
  });

  root.querySelector("#cwSearch")?.addEventListener("input", (e) => { state.query = e.target.value; rerender(); });
  root.querySelector("#cwToggleFilters")?.addEventListener("click", () => {
    state.filtersOpen = !state.filtersOpen;
    rerender();
  });

  root.querySelector("#cwFilterCategory")?.addEventListener("change", (e) => { state.filters.category = e.target.value; rerender(); });
  root.querySelector("#cwFilterPriority")?.addEventListener("change", (e) => { state.filters.priority = e.target.value; rerender(); });
  root.querySelector("#cwFilterPinned")?.addEventListener("change", (e) => { state.filters.pinned = e.target.value; rerender(); });
  root.querySelector("#cwFilterDeleted")?.addEventListener("change", (e) => { state.filters.showDeleted = e.target.value; rerender(); });
  root.querySelector("#cwFilterTimeContext")?.addEventListener("change", (e) => { state.filters.timeContext = e.target.value; rerender(); });
  root.querySelector("#cwFilterStage")?.addEventListener("input", (e) => { state.filters.stage = e.target.value; rerender(); });
  root.querySelector("#cwFilterDateFrom")?.addEventListener("change", (e) => { state.filters.dateFrom = e.target.value; rerender(); });
  root.querySelector("#cwFilterDateTo")?.addEventListener("change", (e) => { state.filters.dateTo = e.target.value; rerender(); });

  root.querySelector("#cwQuickAdd")?.addEventListener("click", async () => {
    const key = prompt(`Template (${Object.keys(QUICK_CONTEXT_TEMPLATES).join(", ")})`, "person");
    if (!key) return;
    const concept = prompt("Concepto", "");
    const template = applyQuickTemplate(key, concept || "");
    if (!template) return;
    await createContextWindowNeuron(template);
    rerender();
  });

  root.querySelector("#cwForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    payload.pin = fd.get("pin") === "on";
    payload.isHistorical = fd.get("isHistorical") === "on";
    if (state.editingId) await updateContextWindowNeuron(state.editingId, payload);
    else await createContextWindowNeuron(payload);
    state.editingId = null;
    rerender();
  });

  root.querySelector("#cwCancelEdit")?.addEventListener("click", () => { state.editingId = null; rerender(); });
  root.querySelector("#cwEdit")?.addEventListener("click", () => { state.editingId = state.selectedId; rerender(); });
  root.querySelector("#cwDelete")?.addEventListener("click", async () => {
    if (!state.selectedId) return;
    const impact = getContextNeuronDeletionImpact(state.selectedId);
    if (!impact) return;
    const warning = impact.likes >= 5 || impact.connectionsAffected >= 6
      ? "\n⚠️ Esta neurona tiene alta relevancia (likes/conexiones)." : "";
    const msg = `Esta neurona está conectada a ${impact.memoriesAffected} memorias y ${impact.connectionsAffected} neuronas. Insights afectados: ${impact.insightsAffected}. ¿Deseas eliminarla?${warning}`;
    if (!confirm(msg)) return;
    await deleteContextNeuronSafely(state.selectedId, { hard: true });
    state.selectedId = null;
    rerender();
  });
  root.querySelector("#cwRestore")?.addEventListener("click", async () => {
    if (!state.selectedId) return;
    await restoreContextNeuron(state.selectedId);
    rerender();
  });
  root.querySelector("#cwDuplicate")?.addEventListener("click", async () => { if (!state.selectedId) return; await duplicateContextWindowNeuron(state.selectedId); rerender(); });
  root.querySelector("#cwTogglePin")?.addEventListener("click", async () => {
    const neuron = listContextWindowNeurons().find((n) => n.id === state.selectedId);
    if (!neuron) return;
    await updateContextWindowNeuron(neuron.id, { ...neuron, pin: !neuron.meta?.pin });
    rerender();
  });
  root.querySelector("#cwAddLink")?.addEventListener("click", () => {
    const targetId = root.querySelector("#cwLinkTarget")?.value?.trim();
    if (state.selectedId && targetId) createManualLink(state.selectedId, targetId);
    rerender();
  });
  root.querySelectorAll(".cwLinkBtn").forEach((btn) => btn.addEventListener("click", () => { if (state.selectedId) removeManualLink(state.selectedId, btn.dataset.unlink); rerender(); }));
  root.querySelectorAll("[data-approve-trigger]").forEach((btn) => btn.addEventListener("click", () => {
    const neuron = listContextWindowNeurons().find((n) => n.id === state.selectedId);
    if (!neuron) return;
    acceptTriggerCandidate(neuron, btn.dataset.approveTrigger, "manual UI approval");
    updateNeuron(neuron.id, { triggers: neuron.triggers, evolution: neuron.evolution });
    rerender();
  }));
  root.querySelectorAll("[data-reject-trigger]").forEach((btn) => btn.addEventListener("click", () => {
    const neuron = listContextWindowNeurons().find((n) => n.id === state.selectedId);
    if (!neuron) return;
    rejectTriggerCandidate(neuron, btn.dataset.rejectTrigger, "manual UI rejection");
    updateNeuron(neuron.id, { evolution: neuron.evolution });
    rerender();
  }));
  root.querySelector("#cwRunImport")?.addEventListener("click", () => {
    try {
      const mode = root.querySelector("#cwImportMode")?.value || "journal";
      const source = root.querySelector("#cwImportSource")?.value || "";
      const forceHistorical = root.querySelector("#cwImportHistorical")?.checked;
      const stage = root.querySelector("#cwImportStage")?.value || "";
      const raw = root.querySelector("#cwImportText")?.value || "[]";
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      const enriched = entries.map((e) => ({ ...e, mode: e.mode || mode, source: e.source || source, isHistorical: forceHistorical, stage: e.stage || stage }));
      state.importSummary = importHistoricalEntries(enriched, { batchSize: 20 });
      rerender();
    } catch (_e) {
      state.importSummary = { created: 0, merged: 0, discarded: 0, temporalRange: null };
      rerender();
    }
  });

  // JSON Import tab wiring
  root.querySelector("#cwJsonInput")?.addEventListener("input", (e) => {
    state.jsonImportText = e.target.value;
    state.jsonImportPreview = null;
    state.jsonImportResult = null;
    state.jsonImportMsg = "";
  });

  root.querySelector("#cwJsonDupStrategy")?.addEventListener("change", (e) => {
    state.jsonImportDupStrategy = e.target.value;
  });

  root.querySelector("#cwJsonValidate")?.addEventListener("click", () => {
    const raw = root.querySelector("#cwJsonInput")?.value || state.jsonImportText;
    const { parsed, error } = parseNeuronJsonInput(raw);
    if (error) {
      state.jsonImportMsg = `✗ ${error}`;
      state.jsonImportPreview = null;
      rerender();
      return;
    }
    const { neurons, error: normErr } = normalizeImportedNeuronPayload(parsed);
    if (normErr) {
      state.jsonImportMsg = `✗ ${normErr}`;
      state.jsonImportPreview = null;
      rerender();
      return;
    }
    state.jsonImportPreview = previewNeuronImport(neurons);
    state.jsonImportMsg = `✓ ${neurons.length} neurona(s) encontrada(s). Revisa el preview y haz clic en Importar.`;
    state.jsonImportResult = null;
    rerender();
  });

  root.querySelector("#cwJsonImport")?.addEventListener("click", () => {
    const raw = root.querySelector("#cwJsonInput")?.value || state.jsonImportText;
    const { parsed, error } = parseNeuronJsonInput(raw);
    if (error) {
      state.jsonImportMsg = `✗ ${error}`;
      rerender();
      return;
    }
    const { neurons, error: normErr } = normalizeImportedNeuronPayload(parsed);
    if (normErr) {
      state.jsonImportMsg = `✗ ${normErr}`;
      rerender();
      return;
    }
    const result = importNeuronJson(neurons, { duplicateStrategy: state.jsonImportDupStrategy, skipInvalid: true });
    state.jsonImportResult = result;
    state.jsonImportMsg = result.imported > 0 || result.merged > 0
      ? `✓ ¡Listo! ${result.imported} importadas, ${result.merged} mergeadas.`
      : `⚠ Ninguna importada. ${result.discarded} descartadas.`;
    state.jsonImportPreview = null;
    rerender();
  });

  root.querySelector("#cwCopySchema")?.addEventListener("click", async () => {
    const result = await copyNeuronSchemaToClipboard();
    state.jsonSchemaCopyMsg = result.success ? SCHEMA_COPIED_MSG : result.message;
    rerender();
    setTimeout(() => { state.jsonSchemaCopyMsg = ""; rerender(); }, COPY_FEEDBACK_DURATION_MS);
  });

  root.querySelector("#cwCopyPrompt")?.addEventListener("click", async () => {
    const result = await copyNeuronPromptToClipboard();
    state.jsonPromptCopyMsg = result.success ? PROMPT_COPIED_MSG : result.message;
    rerender();
    setTimeout(() => { state.jsonPromptCopyMsg = ""; rerender(); }, COPY_FEEDBACK_DURATION_MS);
  });

  root.querySelector("#cwCopyBoth")?.addEventListener("click", async () => {
    const result = await copyNeuronSchemaAndPrompt();
    state.jsonCopyMsg = result.success ? BOTH_COPIED_MSG : result.message;
    rerender();
    setTimeout(() => { state.jsonCopyMsg = ""; rerender(); }, COPY_FEEDBACK_DURATION_MS);
  });
}
