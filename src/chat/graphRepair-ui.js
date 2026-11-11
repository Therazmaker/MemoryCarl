/**
 * graphRepair-ui.js — Ventana de "Reparar con Claude": progreso, vista previa del plan,
 * aplicar (con copia) y deshacer.
 * MemoryCarl / NeuroChat
 */

import { getAllNeurons } from "../neuro/neuronStore.js";
import { proposeGraphRepair, applyGraphRepair, undoLastGraphRepair, getRepairBackupInfo } from "../neuro/graphRepairEngine.js";

const DOMAIN_ES = {
  general: "General", personal: "Personal", work: "Trabajo", health: "Salud", finance: "Finanzas",
  relationships: "Relaciones", habits: "Hábitos", beliefs: "Creencias", emotions: "Emociones",
  learning: "Aprendizaje", creativity: "Creatividad",
};

function esc(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function css() {
  return `<style id="grStyles">
  .grBack { position: fixed; inset: 0; z-index: 9999; background: rgba(5,4,12,.72); display: flex; align-items: flex-end; justify-content: center; }
  @media (min-width: 720px) { .grBack { align-items: center; } }
  .grSheet { width: 100%; max-width: 640px; max-height: 88vh; display: flex; flex-direction: column; background: #14111f; color: #e2e8f0;
    border: 1px solid rgba(255,255,255,.1); border-radius: 18px 18px 0 0; font-family: system-ui, -apple-system, sans-serif; }
  @media (min-width: 720px) { .grSheet { border-radius: 18px; } }
  .grHead { padding: 16px 18px 10px; border-bottom: 1px solid rgba(255,255,255,.07); }
  .grTitle { font-size: 17px; font-weight: 700; }
  .grSub { font-size: 13px; color: #94a3b8; margin-top: 4px; line-height: 1.45; }
  .grBody { padding: 12px 18px; overflow: auto; flex: 1; }
  .grFoot { display: flex; gap: 8px; padding: 12px 18px 16px; border-top: 1px solid rgba(255,255,255,.07); flex-wrap: wrap; }
  .grBtn { flex: 1; min-width: 120px; padding: 11px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05);
    color: #e2e8f0; font-size: 14px; font-weight: 600; cursor: pointer; }
  .grBtn.primary { background: #7c5cff; border-color: #7c5cff; color: #fff; }
  .grBtn:disabled { opacity: .5; cursor: default; }
  .grSec { margin: 10px 0 14px; }
  .grSecHead { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px; }
  .grSecHead input { width: 17px; height: 17px; accent-color: #7c5cff; }
  .grCount { font-size: 11px; padding: 1px 7px; border-radius: 99px; background: rgba(124,92,255,.2); color: #c4b5fd; }
  .grItem { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.03); margin-bottom: 5px; font-size: 13px; line-height: 1.4; }
  .grItem input { margin-top: 2px; width: 16px; height: 16px; accent-color: #7c5cff; flex: none; }
  .grWhy { color: #94a3b8; font-size: 12px; margin-top: 2px; }
  .grOld { color: #94a3b8; text-decoration: line-through; }
  .grArrow { color: #a78bfa; padding: 0 3px; }
  .grSpin { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.2); border-top-color: #a78bfa; border-radius: 50%; animation: grSpin 0.8s linear infinite; vertical-align: -3px; margin-right: 8px; }
  @keyframes grSpin { to { transform: rotate(360deg); } }
  .grWarn { font-size: 12px; color: #fbbf24; margin: 4px 0; }
  .grStat { font-size: 14px; margin: 4px 0; }
  .grErr { color: #fca5a5; font-size: 14px; line-height: 1.5; }
  </style>`;
}

function openSheet() {
  document.querySelector(".grBack")?.remove();
  const back = document.createElement("div");
  back.className = "grBack";
  back.innerHTML = `${css()}<div class="grSheet" role="dialog" aria-modal="true"></div>`;
  document.body.appendChild(back);
  return { back, sheet: back.querySelector(".grSheet"), close: () => back.remove() };
}

function nameMap() {
  const m = new Map();
  for (const n of getAllNeurons({ includeDeleted: false })) m.set(String(n.id), n);
  return m;
}

function nameOf(map, id) {
  const n = map.get(String(id));
  return esc(n?.core?.concept || "(sin nombre)");
}

function renderPlan(plan, warnings, names) {
  const sec = (key, title, items) => (items.length ? `
    <div class="grSec">
      <label class="grSecHead"><input type="checkbox" data-all="${key}" checked/> ${title} <span class="grCount">${items.length}</span></label>
      ${items.join("")}
    </div>` : "");
  const item = (key, i, html, why) => `
    <label class="grItem"><input type="checkbox" data-k="${key}" data-i="${i}" checked/>
      <div>${html}${why ? `<div class="grWhy">${esc(why)}</div>` : ""}</div>
    </label>`;

  const merges = plan.merges.map((m, i) => item("merges", i,
    `${m.removeIds.map((id) => `<b>${nameOf(names, id)}</b>`).join(", ")}<span class="grArrow">→</span><b>${m.concept ? esc(m.concept) : nameOf(names, m.keepId)}</b>`,
    m.reason));
  const deletions = plan.deletions.map((d, i) => item("deletions", i, `<b>${nameOf(names, d.id)}</b>`, d.reason));
  const updates = plan.updates.map((u, i) => {
    const parts = [];
    const cur = names.get(String(u.id));
    if (u.concept) parts.push(`<span class="grOld">${esc(cur?.core?.concept || "sin nombre")}</span><span class="grArrow">→</span><b>${esc(u.concept)}</b>`);
    else parts.push(`<b>${nameOf(names, u.id)}</b>`);
    if (u.domain) parts.push(`área: ${esc(DOMAIN_ES[cur?.core?.domain] || cur?.core?.domain || "—")}<span class="grArrow">→</span>${esc(DOMAIN_ES[u.domain] || u.domain)}`);
    if (u.summary) parts.push("resumen más claro");
    if (u.addTriggers.length) parts.push(`+ ${u.addTriggers.map(esc).join(", ")}`);
    if (u.removeTriggers.length) parts.push(`− ${u.removeTriggers.map(esc).join(", ")}`);
    return item("updates", i, parts.join(" · "), u.reason);
  });
  const connections = plan.connections.map((c, i) => item("connections", i,
    `<b>${nameOf(names, c.a)}</b><span class="grArrow">↔</span><b>${nameOf(names, c.b)}</b>`, c.reason));

  return `
    ${warnings.map((w) => `<div class="grWarn">⚠️ ${esc(w)}</div>`).join("")}
    ${sec("merges", "Fusionar duplicadas", merges)}
    ${sec("deletions", "Borrar", deletions)}
    ${sec("updates", "Corregir nombres, áreas y triggers", updates)}
    ${sec("connections", "Conexiones nuevas", connections)}`;
}

function selectedPlan(sheet, plan) {
  const pick = (key) => plan[key].filter((_, i) => sheet.querySelector(`input[data-k="${key}"][data-i="${i}"]`)?.checked);
  return { ...plan, merges: pick("merges"), deletions: pick("deletions"), updates: pick("updates"), connections: pick("connections") };
}

/**
 * Abre la ventana y corre todo el flujo.
 * @param {{ onApplied?: () => void }} [opts]
 */
export async function openGraphRepair({ onApplied = () => {} } = {}) {
  const { back, sheet, close } = openSheet();
  const controller = new AbortController();
  const backup = getRepairBackupInfo();

  sheet.innerHTML = `
    <div class="grHead"><div class="grTitle">✨ Reparar con Claude</div>
      <div class="grSub">Claude revisa tus neuronas y propone qué fusionar, borrar, renombrar y conectar. Nada cambia hasta que tú lo apruebes.</div></div>
    <div class="grBody"><div class="grStat"><span class="grSpin"></span><span id="grProgress">Preparando…</span></div>
      <div class="grSub">Puede tardar uno o dos minutos.</div></div>
    <div class="grFoot">
      ${backup ? `<button class="grBtn" id="grUndo">↶ Deshacer la última reparación</button>` : ""}
      <button class="grBtn" id="grCancel">Cancelar</button>
    </div>`;
  const cancelBtn = sheet.querySelector("#grCancel");
  cancelBtn.onclick = () => { controller.abort(); close(); };
  back.addEventListener("click", (e) => { if (e.target === back) { controller.abort(); close(); } });
  const undoBtn = sheet.querySelector("#grUndo");
  if (undoBtn) {
    undoBtn.onclick = () => {
      if (!confirm(`¿Volver al grafo como estaba antes de la reparación del ${new Date(backup.at).toLocaleString("es")}?`)) return;
      controller.abort();
      const r = undoLastGraphRepair();
      close();
      if (r.ok) onApplied();
      alert(r.ok ? `Listo: se recuperaron ${r.count} neuronas como estaban.` : r.error);
    };
  }

  const res = await proposeGraphRepair({
    signal: controller.signal,
    onProgress: (msg) => { const el = sheet.querySelector("#grProgress"); if (el) el.textContent = msg; },
  });
  if (!back.isConnected) return;

  if (!res.ok) {
    sheet.querySelector(".grBody").innerHTML = `<div class="grErr">❌ ${esc(res.error)}</div>`;
    cancelBtn.textContent = "Cerrar";
    return;
  }

  const names = nameMap();
  const { plan, warnings } = res;
  if (res.empty) {
    sheet.querySelector(".grBody").innerHTML = `<div class="grStat">✅ Tu grafo ya está ordenado.</div>${plan.summary ? `<div class="grSub">${esc(plan.summary)}</div>` : ""}`;
    cancelBtn.textContent = "Cerrar";
    return;
  }

  sheet.querySelector(".grHead").innerHTML = `<div class="grTitle">✨ Plan de limpieza</div>
    <div class="grSub">${esc(plan.summary || "Revisa los cambios propuestos.")} Desmarca lo que no quieras.</div>`;
  sheet.querySelector(".grBody").innerHTML = renderPlan(plan, warnings, names);
  sheet.querySelector(".grFoot").innerHTML = `
    <button class="grBtn" id="grCancel2">Cancelar</button>
    <button class="grBtn primary" id="grApply">Aplicar cambios</button>`;
  sheet.querySelector("#grCancel2").onclick = close;

  sheet.querySelectorAll("input[data-all]").forEach((all) => {
    all.addEventListener("change", () => {
      sheet.querySelectorAll(`input[data-k="${all.dataset.all}"]`).forEach((c) => { c.checked = all.checked; });
    });
  });

  sheet.querySelector("#grApply").onclick = () => {
    const chosen = selectedPlan(sheet, plan);
    const total = chosen.merges.length + chosen.deletions.length + chosen.updates.length + chosen.connections.length;
    if (!total) { close(); return; }
    const r = applyGraphRepair(chosen);
    if (!r.ok) {
      sheet.querySelector(".grBody").insertAdjacentHTML("afterbegin", `<div class="grErr">❌ ${esc(r.error)}</div>`);
      return;
    }
    const s = r.stats;
    sheet.querySelector(".grHead").innerHTML = `<div class="grTitle">✅ Grafo reparado</div>`;
    sheet.querySelector(".grBody").innerHTML = `
      <div class="grStat">🔗 Fusionadas: <b>${s.merged}</b></div>
      <div class="grStat">🗑️ Borradas: <b>${s.deleted}</b></div>
      <div class="grStat">✏️ Corregidas: <b>${s.updated}</b></div>
      <div class="grStat">➕ Conexiones nuevas: <b>${s.connected}</b></div>
      ${s.fixedLinks ? `<div class="grStat">🧩 Conexiones arregladas: <b>${s.fixedLinks}</b></div>` : ""}
      ${s.memories ? `<div class="grStat">📝 Recuerdos re-enlazados: <b>${s.memories}</b></div>` : ""}
      <div class="grSub">Se guardó una copia. Si algo no te gusta, abre de nuevo "Reparar con Claude" y elige "Deshacer".</div>`;
    sheet.querySelector(".grFoot").innerHTML = `<button class="grBtn primary" id="grDone">Listo</button>`;
    sheet.querySelector("#grDone").onclick = close;
    onApplied();
  };
}
