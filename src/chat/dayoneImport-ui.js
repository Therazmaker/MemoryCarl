/**
 * dayoneImport-ui.js — "Importar diario" en la pestaña Memorias
 * MemoryCarl / NeuroChat
 *
 * Elige el .zip o .json exportado de Day One, muestra un resumen y guarda cada entrada
 * como una Memoria (sin llamar a Claude). Volver a importar el mismo archivo no duplica.
 */

import { parseDayOneExport, buildMemoriesFromDayOne } from "../memory/dayoneImport.js";
import { importMemories, getAllMemories } from "../memory/memoryStore.js";
import { getAllNeurons } from "../neuro/neuronStore.js";
import { readJsonFromZip } from "../services/zipReader.js";

function esc(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function css() {
  return `<style id="diStyles">
  .diBack { position: fixed; inset: 0; z-index: 9999; background: rgba(5,4,12,.72); display: flex; align-items: flex-end; justify-content: center; }
  @media (min-width: 720px) { .diBack { align-items: center; } }
  .diSheet { width: 100%; max-width: 560px; max-height: 88vh; overflow: auto; background: #14111f; color: #e2e8f0; border: 1px solid rgba(255,255,255,.1);
    border-radius: 18px 18px 0 0; padding: 18px; font-family: system-ui, -apple-system, sans-serif; }
  @media (min-width: 720px) { .diSheet { border-radius: 18px; } }
  .diTitle { font-size: 17px; font-weight: 700; margin-bottom: 6px; }
  .diSub { font-size: 13px; color: #94a3b8; line-height: 1.5; }
  .diGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 14px 0; }
  .diStat { background: rgba(255,255,255,.04); border-radius: 12px; padding: 10px 12px; }
  .diStat b { display: block; font-size: 20px; color: #fff; }
  .diStat span { font-size: 12px; color: #94a3b8; }
  .diYears { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 12px; }
  .diYear { font-size: 12px; padding: 3px 9px; border-radius: 99px; background: rgba(124,92,255,.18); color: #c4b5fd; }
  .diFoot { display: flex; gap: 8px; margin-top: 14px; }
  .diBtn { flex: 1; padding: 11px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: #e2e8f0; font-size: 14px; font-weight: 600; cursor: pointer; }
  .diBtn.primary { background: #7c5cff; border-color: #7c5cff; color: #fff; }
  .diErr { color: #fca5a5; font-size: 14px; line-height: 1.5; }
  </style>`;
}

function openSheet(html) {
  document.querySelector(".diBack")?.remove();
  const back = document.createElement("div");
  back.className = "diBack";
  back.innerHTML = `${css()}<div class="diSheet" role="dialog" aria-modal="true">${html}</div>`;
  back.addEventListener("click", (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
  return back;
}

async function readFileText(file) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (isZip) return (await readJsonFromZip(buf)).text;
  return new TextDecoder().decode(buf);
}

/** Pide el archivo y corre el flujo. */
export function startDayOneImport({ onDone = () => {} } = {}) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip,.json,application/zip,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const back = openSheet(`<div class="diTitle">📥 Importar diario</div><div class="diSub">Leyendo ${esc(file.name)}…</div>`);
    const sheet = back.querySelector(".diSheet");
    try {
      const entries = parseDayOneExport(await readFileText(file));
      const existingIds = getAllMemories().map((m) => m.id);
      const { memories, skipped, range } = buildMemoriesFromDayOne(entries, { neurons: getAllNeurons(), existingIds });
      const years = memories.reduce((acc, m) => { const y = (m.date || "").slice(0, 4); acc[y] = (acc[y] || 0) + 1; return acc; }, {});
      const linked = memories.filter((m) => m.linkedNeurons.length).length;
      const discarded = skipped.empty + skipped.duplicate + skipped.photoOnly;

      if (!memories.length) {
        sheet.innerHTML = `<div class="diTitle">📥 Importar diario</div>
          <div class="diSub">${skipped.already ? `Las ${skipped.already} entradas de este archivo ya están en tus Memorias.` : "El archivo no tiene entradas con texto."}</div>
          <div class="diFoot"><button class="diBtn primary" id="diClose">Cerrar</button></div>`;
        sheet.querySelector("#diClose").onclick = () => back.remove();
        return;
      }

      sheet.innerHTML = `
        <div class="diTitle">📥 Importar diario de Day One</div>
        <div class="diSub">Cada entrada se guarda como una Memoria con su fecha, marcada como pasado. Carl la recordará cuando hables de algo relacionado. No se usa Claude.</div>
        <div class="diGrid">
          <div class="diStat"><b>${memories.length}</b><span>memorias nuevas</span></div>
          <div class="diStat"><b>${linked}</b><span>ya enlazadas a tus neuronas</span></div>
          <div class="diStat"><b>${esc(range?.from || "—")}</b><span>desde</span></div>
          <div class="diStat"><b>${esc(range?.to || "—")}</b><span>hasta</span></div>
        </div>
        <div class="diYears">${Object.keys(years).sort().map((y) => `<span class="diYear">${esc(y)} · ${years[y]}</span>`).join("")}</div>
        <div class="diSub">${skipped.already ? `${skipped.already} ya estaban importadas. ` : ""}${discarded ? `Se omiten ${discarded} (vacías, repetidas o solo con foto). ` : ""}Las fotos no vienen en la exportación, solo el texto.</div>
        <div class="diFoot">
          <button class="diBtn" id="diCancel">Cancelar</button>
          <button class="diBtn primary" id="diGo">Importar ${memories.length}</button>
        </div>`;
      sheet.querySelector("#diCancel").onclick = () => back.remove();
      sheet.querySelector("#diGo").onclick = () => {
        const n = importMemories(memories);
        sheet.innerHTML = `<div class="diTitle">✅ Listo</div>
          <div class="diSub">Se guardaron ${n} memorias. Se están subiendo a tu nube en segundo plano.</div>
          <div class="diFoot"><button class="diBtn primary" id="diClose">Ver memorias</button></div>`;
        sheet.querySelector("#diClose").onclick = () => back.remove();
        if (typeof window !== "undefined" && typeof window.neurochatPushToSupabase === "function") window.neurochatPushToSupabase(true);
        onDone();
      };
    } catch (err) {
      sheet.innerHTML = `<div class="diTitle">📥 Importar diario</div><div class="diErr">❌ ${esc(err?.message || "No se pudo leer el archivo.")}</div>
        <div class="diFoot"><button class="diBtn" id="diClose">Cerrar</button></div>`;
      sheet.querySelector("#diClose").onclick = () => back.remove();
    }
  };
  input.click();
}
