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
} from "../neuro/contextWindow.js";
import { importHistoricalEntries } from "../neuro/historicalImport.js";

const state = {
  query: "",
  filters: { category: "", type: "", priority: "", pinned: "", withConnections: "", timeContext: "", stage: "", dateFrom: "", dateTo: "" },
  selectedId: null,
  editingId: null,
  importText: "",
  importMode: "journal",
  importSource: "",
  importHistorical: true,
  importStage: "",
  importSummary: null,
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
  return `<button class="cwCard" data-id="${esc(n.id)}">
    <div class="cwCardHead"><b>${esc(n.core?.concept || "—")}</b><span>${n.meta?.pin ? "📌" : ""}</span></div>
    <div class="cwMeta">${esc(n.type)} · ${esc(n.meta?.manualCategory || "other")} · ${esc(n.meta?.priority || "medium")}</div>
    <div class="cwMeta">${temporalBadge}</div>
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
    <textarea name="notes" placeholder="notes">${esc(n.meta?.notes || "")}</textarea>
    <input name="colorTag" placeholder="colorTag" value="${esc(n.meta?.colorTag || "")}" />
    <div class="cwFormActions"><button type="submit">${state.editingId ? "Guardar" : "Crear"}</button>${state.editingId ? '<button type="button" id="cwCancelEdit">Cancelar</button>' : ''}</div>
  </form>`;
}

function renderDetail() {
  const neuron = getFiltered().find((n) => n.id === state.selectedId);
  if (!neuron) return `<div class="cwDetail">Selecciona una neurona manual.</div>`;
  const connButtons = (neuron.connections || []).map((id) => `<button class="cwLinkBtn" data-unlink="${id}">unlink ${esc(id)}</button>`).join("");
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
    <div>fecha: ${esc(neuron.temporal?.date || "—")} · contexto: ${esc(neuron.temporal?.timeContext || "timeless")} · stage: ${esc(neuron.temporal?.stage || "—")}</div>
    <div class="cwRowBtns">
      <button id="cwEdit">Editar</button>
      <button id="cwDelete">Borrar</button>
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

export function viewContextWindow() {
  const items = getFiltered();
  const fc = state.filters.category;
  const fp = state.filters.priority;
  const fn = state.filters.pinned;
  return `<div class="cwWrap"><style>
    .cwLayout{display:grid;grid-template-columns:1.2fr 1fr;gap:12px}.cwCards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
    .cwCard{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);padding:10px;border-radius:10px;text-align:left;color:inherit}
    .cwTop{display:flex;gap:8px;flex-wrap:wrap}.cwTop input,.cwTop select{background:#151924;color:inherit;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px}
    .cwForm{display:grid;gap:8px}.cwForm input,.cwForm textarea,.cwForm select{background:#151924;color:inherit;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:7px}
    .cwDetail{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px}
    .cwTemporal{font-size:11px;padding:2px 6px;border-radius:999px;border:1px solid rgba(255,255,255,.2)}
  </style>
  <div class="cwTop">
    <input id="cwSearch" placeholder="Buscar context neuron" value="${esc(state.query)}" />
    <select id="cwFilterCategory"><option value=""${sel(fc,"")}>category</option><option value="people"${sel(fc,"people")}>people</option><option value="work"${sel(fc,"work")}>work</option><option value="hobbies"${sel(fc,"hobbies")}>hobbies</option><option value="projects"${sel(fc,"projects")}>projects</option><option value="preferences"${sel(fc,"preferences")}>preferences</option><option value="places"${sel(fc,"places")}>places</option><option value="identity"${sel(fc,"identity")}>identity</option></select>
    <select id="cwFilterPriority"><option value=""${sel(fp,"")}>priority</option><option value="low"${sel(fp,"low")}>low</option><option value="medium"${sel(fp,"medium")}>medium</option><option value="high"${sel(fp,"high")}>high</option></select>
    <select id="cwFilterPinned"><option value=""${sel(fn,"")}>pinned?</option><option value="1"${sel(fn,"1")}>pinned</option><option value="0"${sel(fn,"0")}>not pinned</option></select>
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
      <div class="cwDetail">
        <h3>Importación histórica batch</h3>
        <textarea id="cwImportText" placeholder='JSON array: [{"date":"2025-02-10","text":"..."}]'>${esc(state.importText)}</textarea>
        <input id="cwImportSource" placeholder="source label" value="${esc(state.importSource)}"/>
        <select id="cwImportMode"><option value="journal">journal</option><option value="autobiography">autobiography</option><option value="exercise">exercise</option></select>
        <label><input type="checkbox" id="cwImportHistorical" ${state.importHistorical ? "checked" : ""}/> marcar como histórico</label>
        <input id="cwImportStage" placeholder="stage aproximada (sin fecha)" value="${esc(state.importStage)}"/>
        <button id="cwRunImport">Importar batch</button>
        ${state.importSummary ? `<div>creadas: ${state.importSummary.created} · fusionadas: ${state.importSummary.merged} · descartadas: ${state.importSummary.discarded} · rango: ${esc(state.importSummary.temporalRange ? `${state.importSummary.temporalRange.start}..${state.importSummary.temporalRange.end}` : "—")}</div>` : ""}
      </div>
      ${renderDetail()}
    </div>
  </div></div>`;
}

export function wireContextWindow(root, rerender) {
  root.querySelectorAll(".cwCard").forEach((el) => el.addEventListener("click", () => { state.selectedId = el.dataset.id; state.editingId = null; rerender(); }));
  root.querySelector("#cwSearch")?.addEventListener("input", (e) => { state.query = e.target.value; rerender(); });
  root.querySelector("#cwFilterCategory")?.addEventListener("change", (e) => { state.filters.category = e.target.value; rerender(); });
  root.querySelector("#cwFilterPriority")?.addEventListener("change", (e) => { state.filters.priority = e.target.value; rerender(); });
  root.querySelector("#cwFilterPinned")?.addEventListener("change", (e) => { state.filters.pinned = e.target.value; rerender(); });
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
    if (state.editingId) await updateContextWindowNeuron(state.editingId, payload);
    else await createContextWindowNeuron(payload);
    state.editingId = null;
    rerender();
  });

  root.querySelector("#cwCancelEdit")?.addEventListener("click", () => { state.editingId = null; rerender(); });
  root.querySelector("#cwEdit")?.addEventListener("click", () => { state.editingId = state.selectedId; rerender(); });
  root.querySelector("#cwDelete")?.addEventListener("click", async () => { if (!state.selectedId) return; await deleteContextWindowNeuron(state.selectedId); state.selectedId = null; rerender(); });
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
}
