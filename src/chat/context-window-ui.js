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
  const temporalBadge = `<span class="cwTemporal cwTemporal--${esc(n.temporal?.timeContext || "timeless")}">${esc(n.temporal?.timeContext || "timeless")}</span>`;
  const temporalLine = [n.temporal?.date, n.temporal?.isHistorical ? "histórico" : "", n.temporal?.stage]
    .filter(Boolean)
    .join(" · ");
  return `<button class="cwCard" data-id="${esc(n.id)}">
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
    <input name="concept" placeholder="Concept" value="${esc(n.core?.concept || "")}" required />
    <input name="summary" placeholder="Summary" value="${esc(n.core?.summary || "")}" />
    <input name="type" placeholder="type" value="${esc(n.type || "manual_context")}" />
    <input name="manualCategory" placeholder="category" value="${esc(n.meta?.manualCategory || "other")}" />
    <input name="aliases" placeholder="aliases (coma)" value="${esc((n.meta?.aliases || []).join(", "))}" />
    <select name="priority"><option value="low">low</option><option value="medium" ${n.meta?.priority !== "high" && n.meta?.priority !== "low" ? "selected" : ""}>medium</option><option value="high" ${n.meta?.priority === "high" ? "selected" : ""}>high</option></select>
    <label><input type="checkbox" name="pin" ${n.meta?.pin ? "checked" : ""}/> Pin</label>
    <input name="emotion" placeholder="emotion" value="${esc(n.emotion || "neutral")}" />
    <input name="triggers" placeholder="triggers (coma)" value="${esc((n.triggers || []).join(", "))}" />
    <input name="date" type="date" value="${esc(n.temporal?.date || "")}" />
    <input name="stage" placeholder="stage" value="${esc(n.temporal?.stage || "")}" />
    <label><input type="checkbox" name="isHistorical" ${n.temporal?.isHistorical ? "checked" : ""}/> Histórico</label>
    <textarea name="notes" placeholder="notes">${esc(n.meta?.notes || "")}</textarea>
    <input name="colorTag" placeholder="colorTag" value="${esc(n.meta?.colorTag || "")}" />
    <div class="cwFormActions"><button type="submit">${state.editingId ? "Guardar" : "Crear"}</button>${state.editingId ? '<button type="button" id="cwCancelEdit">Cancelar</button>' : ''}</div>
  </form>`;
}

function renderDetail() {
  const neuron = getFiltered().find((n) => n.id === state.selectedId);
  if (!neuron) return `<div class="cwDetail">Selecciona una neurona manual.</div>`;
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
    <h3>${esc(neuron.core.concept)}</h3>
    <p>${esc(neuron.core.summary || "")}</p>
    <div>aliases: ${(neuron.meta?.aliases || []).join(", ")}</div>
    <div>priority: ${esc(neuron.meta?.priority || "medium")} · pin: ${neuron.meta?.pin ? "yes" : "no"}</div>
    <div>category: ${esc(neuron.meta?.manualCategory || "other")}</div>
    <div>triggers: ${(neuron.triggers || []).join(", ")}</div>
    <div>evidence: ${(neuron.evidence || []).join(", ")}</div>
    <div>notes: ${esc(neuron.meta?.notes || "")}</div>
    <div>connections: ${(neuron.connections || []).join(", ") || "—"}</div>
    <div>fecha: ${esc(neuron.temporal?.date || "—")} · histórico: ${neuron.temporal?.isHistorical ? "sí" : "no"} · contexto: ${esc(neuron.temporal?.timeContext || "timeless")} · stage: ${esc(neuron.temporal?.stage || "—")} · source: ${esc(neuron.temporal?.source || "unknown")}</div>
    <div class="cwEvolutionBox">
      <h4>Evolution</h4>
      <div>usage: ${neuron.evolution.usageCount} · success: ${neuron.evolution.successfulActivations} · failed: ${neuron.evolution.failedActivations}</div>
      <div>lastUsedAt: ${esc(neuron.evolution.lastUsedAt || "—")} · weight: ${Number(neuron.weight || 0).toFixed(3)}</div>
      <div>triggerHistory: ${(neuron.evolution.triggerHistory || []).slice(-3).map((h) => `${h.action}:${h.trigger}`).join(" · ") || "—"}</div>
      <div>summary suggestion: ${esc(neuron.evolution.summarySuggestion?.suggestedSummary || "—")}</div>
      <div>candidatos trigger:</div>
      ${candidateHtml}
    </div>
    <div class="cwRowBtns">
      <button id="cwEdit">Editar</button>
      <button id="cwDelete">Delete neuron</button>
      ${neuron.deleted ? '<button id="cwRestore">Restore neuron</button>' : ""}
      <button id="cwDuplicate">Duplicar</button>
      <button id="cwTogglePin">${neuron.meta?.pin ? "Unpin" : "Pin"}</button>
    </div>
    <div class="cwLinkRow">
      <input id="cwLinkTarget" placeholder="ID de neurona a linkear" />
      <button id="cwAddLink">Link</button>
    </div>
    <div>${connButtons}</div>
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
      <h3 style="margin:0 0 10px;font-size:14px;font-weight:700">📥 Importar Neuronas JSON</h3>
      <p style="font-size:11px;opacity:.6;margin:0 0 10px">Pega una neurona, un array o un objeto con "neurons: [...]". Se acepta JSON con markdown fences.</p>

      <div class="cwCopyBtnRow">
        <button id="cwCopySchema" class="cwBtn cwBtn--secondary">📋 Copiar schema</button>
        <button id="cwCopyPrompt" class="cwBtn cwBtn--secondary">🤖 Copiar prompt</button>
        <button id="cwCopyBoth" class="cwBtn cwBtn--secondary">🚀 Copiar ambos</button>
      </div>
      ${schemaCopyMsgHtml}
      ${promptCopyMsgHtml}
      ${copyMsgHtml}

      <textarea
        id="cwJsonInput"
        class="cwJsonTextarea"
        placeholder='{"type":"person","core":{"concept":"Fergis","domain":"relationships","summary":"..."},...}'
        rows="7"
      >${esc(state.jsonImportText)}</textarea>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">
        <label style="font-size:11px;opacity:.6">Duplicados:</label>
        <select id="cwJsonDupStrategy" class="cwSelect">
          <option value="discard"${state.jsonImportDupStrategy === "discard" ? " selected" : ""}>Descartar</option>
          <option value="merge"${state.jsonImportDupStrategy === "merge" ? " selected" : ""}>Merge</option>
          <option value="new"${state.jsonImportDupStrategy === "new" ? " selected" : ""}>Importar como nueva</option>
        </select>
        <button id="cwJsonValidate" class="cwBtn cwBtn--secondary">🔍 Validar</button>
        <button id="cwJsonImport" class="cwBtn cwBtn--primary">✅ Importar</button>
      </div>

      ${msgHtml}
      ${previewHtml}
      ${resultHtml}

      <details style="margin-top:10px">
        <summary style="font-size:11px;opacity:.5;cursor:pointer">Ver schema…</summary>
        <pre class="cwSchemaPreview">${esc(getNeuronSchemaTemplate())}</pre>
      </details>
    </div>`;
}

export function viewContextWindow() {
  const items = getFiltered();
  const fc = state.filters.category;
  const fp = state.filters.priority;
  const fn = state.filters.pinned;

  const tabsHtml = `
    <div class="cwTabs">
      ${tab(state.activeTab, "manual", "📝 Manual")}
      ${tab(state.activeTab, "json_import", "📥 Import JSON")}
      ${tab(state.activeTab, "historical", "🗂 Histórico")}
    </div>`;

  const manualTabHtml = state.activeTab === "manual" ? `
    <div class="cwTop">
      <input id="cwSearch" placeholder="Buscar context neuron" value="${esc(state.query)}" />
      <select id="cwFilterCategory"><option value=""${sel(fc,"")}>category</option><option value="people"${sel(fc,"people")}>people</option><option value="work"${sel(fc,"work")}>work</option><option value="hobbies"${sel(fc,"hobbies")}>hobbies</option><option value="projects"${sel(fc,"projects")}>projects</option><option value="preferences"${sel(fc,"preferences")}>preferences</option><option value="places"${sel(fc,"places")}>places</option><option value="identity"${sel(fc,"identity")}>identity</option></select>
      <select id="cwFilterPriority"><option value=""${sel(fp,"")}>priority</option><option value="low"${sel(fp,"low")}>low</option><option value="medium"${sel(fp,"medium")}>medium</option><option value="high"${sel(fp,"high")}>high</option></select>
      <select id="cwFilterPinned"><option value=""${sel(fn,"")}>pinned?</option><option value="1"${sel(fn,"1")}>pinned</option><option value="0"${sel(fn,"0")}>not pinned</option></select>
      <select id="cwFilterDeleted"><option value="">deleted?</option><option value="1"${sel(state.filters.showDeleted,"1")}>show deleted</option></select>
      <select id="cwFilterTimeContext"><option value="">timeContext</option><option value="current">current</option><option value="recent">recent</option><option value="past">past</option><option value="historical">historical</option><option value="timeless">timeless</option></select>
      <input id="cwFilterStage" placeholder="stage" value="${esc(state.filters.stage)}"/>
      <input id="cwFilterDateFrom" type="date" value="${esc(state.filters.dateFrom)}"/>
      <input id="cwFilterDateTo" type="date" value="${esc(state.filters.dateTo)}"/>
      <button id="cwQuickAdd">Add Starter Context</button>
    </div>
    <div class="cwLayout">
      <div>
        <div class="cwCards">${items.map(renderCard).join("") || '<div>Sin neuronas manuales</div>'}</div>
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
      <textarea id="cwImportText" placeholder='JSON array: [{"date":"2025-02-10","text":"..."}]'>${esc(state.importText)}</textarea>
      <input id="cwImportSource" placeholder="source label" value="${esc(state.importSource)}"/>
      <select id="cwImportMode"><option value="journal">journal</option><option value="autobiography">autobiography</option><option value="exercise">exercise</option></select>
      <label><input type="checkbox" id="cwImportHistorical" ${state.importHistorical ? "checked" : ""}/> marcar como histórico</label>
      <input id="cwImportStage" placeholder="stage aproximada (sin fecha)" value="${esc(state.importStage)}"/>
      <button id="cwRunImport">Importar batch</button>
      ${state.importSummary ? `<div>creadas: ${state.importSummary.created} · fusionadas: ${state.importSummary.merged} · descartadas: ${state.importSummary.discarded} · rango: ${esc(state.importSummary.temporalRange ? `${state.importSummary.temporalRange.start}..${state.importSummary.temporalRange.end}` : "—")}</div>` : ""}
    </div>` : "";

  return `<div class="cwWrap"><style>
    .cwLayout{display:grid;grid-template-columns:1.2fr 1fr;gap:12px}.cwCards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
    .cwCard{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);padding:10px;border-radius:10px;text-align:left;color:inherit}
    .cwTop{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.cwTop input,.cwTop select{background:#151924;color:inherit;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px}
    .cwForm{display:grid;gap:8px}.cwForm input,.cwForm textarea,.cwForm select{background:#151924;color:inherit;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:7px}
    .cwDetail{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px}
    .cwTemporal{font-size:11px;padding:2px 6px;border-radius:999px;border:1px solid rgba(255,255,255,.2)}
    .cwTabs{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
    .cwTab{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 14px;cursor:pointer;font-size:12px;color:inherit;font-weight:600}
    .cwTab--active{background:rgba(99,102,241,.25);border-color:rgba(99,102,241,.4);color:#a5b4fc}
    .cwJsonImport{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px}
    .cwJsonTextarea{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:9px;color:inherit;font-family:monospace;font-size:12px;resize:vertical;outline:none}
    .cwSelect{background:#151924;color:inherit;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px 8px;font-size:12px}
    .cwBtn{border:none;border-radius:8px;padding:7px 14px;cursor:pointer;font-size:12px;font-weight:600;transition:background .12s}
    .cwBtn--primary{background:rgba(99,102,241,.3);color:#a5b4fc;border:1px solid rgba(99,102,241,.4)}
    .cwBtn--primary:hover{background:rgba(99,102,241,.45)}
    .cwBtn--secondary{background:rgba(255,255,255,.07);color:inherit;border:1px solid rgba(255,255,255,.1)}
    .cwBtn--secondary:hover{background:rgba(255,255,255,.14)}
    .cwImportPreview{margin-top:10px;font-size:11px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:4px}
    .cwImportPreviewRow{font-weight:700}.cwImportPreviewRow--ok{color:#34d399}.cwImportPreviewRow--warn{color:#fbbf24}.cwImportPreviewRow--err{color:#f87171}
    .cwImportPreviewItem{padding-left:8px;opacity:.8}
    .cwImportTag{font-size:10px;padding:1px 5px;border-radius:5px;background:rgba(52,211,153,.15);color:#34d399;margin-left:4px}
    .cwImportResult{margin-top:8px;font-size:12px;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.2);border-radius:8px;padding:8px}
    .cwImportMsg{font-size:12px;padding:6px 10px;border-radius:8px;margin-top:8px}
    .cwImportMsg--ok{background:rgba(52,211,153,.12);color:#34d399}.cwImportMsg--err{background:rgba(248,113,113,.12);color:#f87171}
    .cwSchemaPreview{font-size:10px;overflow:auto;max-height:200px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:6px;padding:8px;margin-top:6px}
    .cwCopyBtnRow{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
    .cwCopyFeedback{font-size:11px;padding:4px 10px;border-radius:6px;background:rgba(99,102,241,.15);color:#a5b4fc;margin-bottom:6px;display:inline-block}
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

  root.querySelectorAll(".cwCard").forEach((el) => el.addEventListener("click", () => { state.selectedId = el.dataset.id; state.editingId = null; rerender(); }));
  root.querySelector("#cwSearch")?.addEventListener("input", (e) => { state.query = e.target.value; rerender(); });
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
      ? "\\n⚠️ Esta neurona tiene alta relevancia (likes/conexiones)." : "";
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
