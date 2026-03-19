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

const state = {
  query: "",
  filters: { category: "", type: "", priority: "", pinned: "", withConnections: "" },
  selectedId: null,
  editingId: null,
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
  return listContextWindowNeurons(options);
}

function renderCard(n) {
  return `<button class="cwCard" data-id="${esc(n.id)}">
    <div class="cwCardHead"><b>${esc(n.core?.concept || "—")}</b><span>${n.meta?.pin ? "📌" : ""}</span></div>
    <div class="cwMeta">${esc(n.type)} · ${esc(n.meta?.manualCategory || "other")} · ${esc(n.meta?.priority || "medium")}</div>
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

export function viewContextWindow() {
  const items = getFiltered();
  return `<div class="cwWrap"><style>
    .cwLayout{display:grid;grid-template-columns:1.2fr 1fr;gap:12px}.cwCards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
    .cwCard{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);padding:10px;border-radius:10px;text-align:left;color:inherit}
    .cwTop{display:flex;gap:8px;flex-wrap:wrap}.cwTop input,.cwTop select{background:#151924;color:inherit;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px}
    .cwForm{display:grid;gap:8px}.cwForm input,.cwForm textarea,.cwForm select{background:#151924;color:inherit;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:7px}
    .cwDetail{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px}
  </style>
  <div class="cwTop">
    <input id="cwSearch" placeholder="Buscar context neuron" value="${esc(state.query)}" />
    <select id="cwFilterCategory"><option value="">category</option><option value="people">people</option><option value="work">work</option><option value="hobbies">hobbies</option><option value="projects">projects</option><option value="preferences">preferences</option><option value="places">places</option><option value="identity">identity</option></select>
    <select id="cwFilterPriority"><option value="">priority</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select>
    <select id="cwFilterPinned"><option value="">pinned?</option><option value="1">pinned</option><option value="0">not pinned</option></select>
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
  </div></div>`;
}

export function wireContextWindow(root) {
  const rerender = () => {
    const wrap = root.querySelector(".nchatWrap");
    if (!wrap) return;
    wrap.outerHTML = root.querySelector(".nchatWrap") ? root.querySelector(".nchatWrap").outerHTML : "";
  };
  root.querySelectorAll(".cwCard").forEach((el) => el.addEventListener("click", () => { state.selectedId = el.dataset.id; state.editingId = null; location.reload(); }));
  root.querySelector("#cwSearch")?.addEventListener("input", (e) => { state.query = e.target.value; location.reload(); });
  root.querySelector("#cwFilterCategory")?.addEventListener("change", (e) => { state.filters.category = e.target.value; location.reload(); });
  root.querySelector("#cwFilterPriority")?.addEventListener("change", (e) => { state.filters.priority = e.target.value; location.reload(); });
  root.querySelector("#cwFilterPinned")?.addEventListener("change", (e) => { state.filters.pinned = e.target.value; location.reload(); });

  root.querySelector("#cwQuickAdd")?.addEventListener("click", async () => {
    const key = prompt(`Template (${Object.keys(QUICK_CONTEXT_TEMPLATES).join(", ")})`, "person");
    if (!key) return;
    const concept = prompt("Concepto", "");
    const template = applyQuickTemplate(key, concept || "");
    if (!template) return;
    await createContextWindowNeuron(template);
    location.reload();
  });

  root.querySelector("#cwForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    payload.pin = fd.get("pin") === "on";
    if (state.editingId) await updateContextWindowNeuron(state.editingId, payload);
    else await createContextWindowNeuron(payload);
    state.editingId = null;
    location.reload();
  });

  root.querySelector("#cwCancelEdit")?.addEventListener("click", () => { state.editingId = null; location.reload(); });
  root.querySelector("#cwEdit")?.addEventListener("click", () => { state.editingId = state.selectedId; location.reload(); });
  root.querySelector("#cwDelete")?.addEventListener("click", async () => { if (!state.selectedId) return; await deleteContextWindowNeuron(state.selectedId); state.selectedId = null; location.reload(); });
  root.querySelector("#cwDuplicate")?.addEventListener("click", async () => { if (!state.selectedId) return; await duplicateContextWindowNeuron(state.selectedId); location.reload(); });
  root.querySelector("#cwTogglePin")?.addEventListener("click", async () => {
    const neuron = listContextWindowNeurons().find((n) => n.id === state.selectedId);
    if (!neuron) return;
    await updateContextWindowNeuron(neuron.id, { ...neuron, pin: !neuron.meta?.pin });
    location.reload();
  });
  root.querySelector("#cwAddLink")?.addEventListener("click", () => {
    const targetId = root.querySelector("#cwLinkTarget")?.value?.trim();
    if (state.selectedId && targetId) createManualLink(state.selectedId, targetId);
    location.reload();
  });
  root.querySelectorAll(".cwLinkBtn").forEach((btn) => btn.addEventListener("click", () => { if (state.selectedId) removeManualLink(state.selectedId, btn.dataset.unlink); location.reload(); }));
}
