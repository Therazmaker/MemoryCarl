const SEMANA_GEMINI_KEY_LS = "memorycarl_v2_semana_gemini_api_key";
const GEMINI_API_KEY = import.meta?.env?.VITE_GEMINI_KEY || "";

function getSemanaGeminiApiKey(){
  try{
    const fromLs = (localStorage.getItem(SEMANA_GEMINI_KEY_LS) || "").trim();
    if(fromLs) return fromLs;
  }catch(_e){}
  return GEMINI_API_KEY;
}

const DAYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
const MEALS = ["desayuno", "almuerzo", "cena", "snack"];
const COLLAPSED_DEFAULT = ["viernes", "sabado", "domingo"];

function emptyDay(){
  return { desayuno: null, almuerzo: null, cena: null, snack: null };
}

function getSemanaSchemaTemplate() {
  return {
    presupuesto: 280,
    semana: {
      lunes: { desayuno: "ID_RECETA", almuerzo: "ID_RECETA", cena: "ID_RECETA", snack: "ID_RECETA" },
      martes: { desayuno: null, almuerzo: null, cena: null, snack: null },
      miercoles: { desayuno: null, almuerzo: null, cena: null, snack: null },
      jueves: { desayuno: null, almuerzo: null, cena: null, snack: null },
      viernes: { desayuno: null, almuerzo: null, cena: null, snack: null },
      sabado: { desayuno: null, almuerzo: null, cena: null, snack: null },
      domingo: { desayuno: null, almuerzo: null, cena: null, snack: null }
    },
    recetas: [
      {
        id: "r_123",
        nombre: "Ejemplo Receta",
        porciones: 4,
        tiempoMin: 30,
        costoEstimado: 25.5,
        aptaNinos: true,
        ingredientes: [
          { nombre: "Ingrediente 1", cantidad: 500, unidad: "gr" }
        ]
      }
    ],
    despensa: [
      { id: "d_123", nombre: "Ingrediente 1", cantidad: 1000, unidad: "gr", venceEn: "2024-12-31" }
    ],
    historialCompras: [],
    contingencia: []
  };
}

export function seedSemana(){
  return {
    presupuesto: 280,
    semana: {
      lunes: emptyDay(),
      martes: emptyDay(),
      miercoles: emptyDay(),
      jueves: emptyDay(),
      viernes: emptyDay(),
      sabado: emptyDay(),
      domingo: emptyDay()
    },
    recetas: [],
    despensa: [],
    expandedDays: [],
    contingencia: [],
    historialCompras: [],
    analisisNutricional: null,
    geminiCache: {},
    view: "planner",
    ui: {
      showRecipeForm: false,
      showPantryForm: false,
      ingredientDrafts: [{ nombre: "", cantidad: 1, unidad: "und" }],
      modal: null,
      shoppingListModal: false,
      importModal: false,
      importJsonDraft: "",
      assign: { day: "", meal: "" }
    },
    messages: []
  };
}

function getCtx(){
  const ctx = window.__MC_WEEK_CTX__ || {};
  return {
    state: ctx.state || {},
    persist: typeof ctx.persist === "function" ? ctx.persist : ()=>{},
    view: typeof ctx.view === "function" ? ctx.view : ()=>{},
    toast: typeof ctx.toast === "function" ? ctx.toast : (()=>{})
  };
}

function ensureSemanaShape(root){
  if(!root.semana || typeof root.semana !== "object") root.semana = seedSemana();
  const s = root.semana;
  if(!s.semana || typeof s.semana !== "object") s.semana = seedSemana().semana;
  DAYS.forEach((d)=>{ if(!s.semana[d]) s.semana[d] = emptyDay(); });
  if(!Array.isArray(s.recetas)) s.recetas = [];
  if(!Array.isArray(s.despensa)) s.despensa = [];
  if(!Array.isArray(s.expandedDays)) s.expandedDays = [];
  if(!Array.isArray(s.contingencia)) s.contingencia = [];
  if(!Array.isArray(s.historialCompras)) s.historialCompras = [];
  if(s.analisisNutricional === undefined) s.analisisNutricional = null;
  if(!s.geminiCache || typeof s.geminiCache !== "object") s.geminiCache = {};
  if(!s.view) s.view = "planner";
  if(!s.ui || typeof s.ui !== "object") s.ui = seedSemana().ui;
  if(!Array.isArray(s.ui.ingredientDrafts) || !s.ui.ingredientDrafts.length){
    s.ui.ingredientDrafts = [{ nombre: "", cantidad: 1, unidad: "und" }];
  }
  if(s.ui.importModal === undefined) s.ui.importModal = false;
  if(s.ui.importJsonDraft === undefined) s.ui.importJsonDraft = "";
}

function escapeHtml(v){
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(v){
  const n = Number(v || 0);
  return `S/. ${n.toFixed(2)}`;
}

function weekNeedsByNameUnidad(semanaState){
  const out = new Map();
  const recMap = new Map((semanaState.recetas||[]).map(r=>[String(r.id), r]));
  DAYS.forEach((day)=>{
    MEALS.forEach((meal)=>{
      const rid = semanaState.semana?.[day]?.[meal];
      if(!rid) return;
      const rec = recMap.get(String(rid));
      if(!rec) return;
      (rec.ingredientes || []).forEach((ing)=>{
        const name = String(ing.nombre || "").trim().toLowerCase();
        const unidad = String(ing.unidad || "und").trim().toLowerCase();
        if(!name) return;
        const key = `${name}__${unidad}`;
        out.set(key, (out.get(key) || 0) + Number(ing.cantidad || 0));
      });
    });
  });
  return out;
}

function pantryByNameUnidad(semanaState){
  const out = new Map();
  (semanaState.despensa || []).forEach((it)=>{
    const name = String(it.nombre || "").trim().toLowerCase();
    const unidad = String(it.unidad || "und").trim().toLowerCase();
    if(!name) return;
    const key = `${name}__${unidad}`;
    out.set(key, (out.get(key) || 0) + Number(it.cantidad || 0));
  });
  return out;
}

function missingForRecipe(receta, despensaMap){
  if(!receta) return [];
  return (receta.ingredientes || []).filter((ing)=>{
    const name = String(ing.nombre || "").trim().toLowerCase();
    const unidad = String(ing.unidad || "und").trim().toLowerCase();
    if(!name) return false;
    const key = `${name}__${unidad}`;
    return Number(despensaMap.get(key) || 0) < Number(ing.cantidad || 0);
  });
}

function totalPlan(semanaState){
  const recMap = new Map((semanaState.recetas||[]).map(r=>[String(r.id), r]));
  let total = 0;
  DAYS.forEach((d)=>{
    MEALS.forEach((m)=>{
      const rec = recMap.get(String(semanaState.semana?.[d]?.[m] || ""));
      total += Number(rec?.costoEstimado || 0);
    });
  });
  return total;
}

function todayDayName(){
  const i = new Date().getDay();
  return ["domingo","lunes","martes","miercoles","jueves","viernes","sabado"][i];
}

function daysToExpire(dateStr){
  if(!dateStr) return null;
  const now = new Date();
  now.setHours(0,0,0,0);
  const end = new Date(`${dateStr}T00:00:00`);
  if(Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - now.getTime()) / (1000*60*60*24));
}

export function generarListaCompra(state){
  const semanaState = state?.semana || seedSemana();
  const need = weekNeedsByNameUnidad(semanaState);
  const pantry = pantryByNameUnidad(semanaState);
  const rows = [];
  need.forEach((cant, key)=>{
    const current = Number(pantry.get(key) || 0);
    const missing = cant - current;
    if(missing > 0){
      const [nombre, unidad] = key.split("__");
      rows.push({ nombre, unidad, cantidad: Number(missing.toFixed(2)) });
    }
  });
  return rows.sort((a,b)=>a.nombre.localeCompare(b.nombre));
}

async function callGeminiCached(prompt, force = false){
  const { state, persist } = getCtx();
  const apiKey = getSemanaGeminiApiKey();
  if(!apiKey) throw new Error("SEMANA_GEMINI_API_KEY_MISSING");

  // Simple hash for prompt
  const hash = prompt.split("").reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0).toString();

  if(!force && state.semana.geminiCache?.[hash]){
    console.log("[Semana IA] Cache hit");
    return state.semana.geminiCache[hash];
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    }
  );

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if(!raw) throw new Error("GEMINI_EMPTY_RESPONSE");

  if(!state.semana.geminiCache) state.semana.geminiCache = {};
  state.semana.geminiCache[hash] = raw;
  persist();

  return raw;
}

async function generarPlanContingencia(despensa){
  const prompt = `
Eres un asistente de cocina familiar para una familia peruana con niños.
Tengo estos ingredientes en casa: ${JSON.stringify(despensa)}.
Sugiere exactamente 3 recetas que pueda preparar HOY con lo que tengo.
Prioriza ingredientes que venzan pronto.
Responde SOLO en JSON con este formato exacto, sin texto adicional:
[
  { "nombre": "...", "ingredientesUsados": ["...", "..."], "costoEstimado": 0, "aptaNinos": true }
]
  `;

  const raw = await callGeminiCached(prompt);
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

async function generarAnalisisNutricional(semanaState){
  const recMap = new Map((semanaState.recetas||[]).map(r=>[String(r.id), r]));
  const planInfo = [];

  DAYS.forEach(day => {
    MEALS.forEach(meal => {
      const rid = semanaState.semana?.[day]?.[meal];
      const rec = recMap.get(String(rid || ""));
      if(rec){
        planInfo.push({
          dia: day,
          comida: meal,
          nombre: rec.nombre,
          ingredientes: (rec.ingredientes || []).map(i => `${i.cantidad} ${i.unidad} ${i.nombre}`)
        });
      }
    });
  });

  if(!planInfo.length) return "No hay platos asignados en la semana para analizar.";

  const prompt = `
Actúa como un nutricionista experto. Analiza este plan semanal de comidas:
${JSON.stringify(planInfo)}
Proporciona un resumen nutricional breve y ameno (máximo 200 palabras) que incluya:
1. Balance general (proteínas, carbos, vegetales).
2. Una sugerencia de mejora para hacerlo más saludable o equilibrado.
3. Un "Semáforo Nutricional" (Verde/Amarillo/Rojo) para la semana.
Responde en texto plano con formato limpio.
  `;

  return await callGeminiCached(prompt);
}

function exportarSemanaJson(data, filename){
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `semana_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderPlanner(semanaState){
  const recMap = new Map((semanaState.recetas||[]).map(r=>[String(r.id), r]));
  const today = todayDayName();
  const despensaMap = pantryByNameUnidad(semanaState);
  const total = totalPlan(semanaState);
  const presupuesto = Number(semanaState.presupuesto || 0);
  const ratio = presupuesto > 0 ? Math.min(100, Math.round((total / presupuesto) * 100)) : 0;
  const saldo = presupuesto - total;
  const faltantesSemana = generarListaCompra({ semana: semanaState });

  const dayCards = DAYS.map((day)=>{
    const collapsed = COLLAPSED_DEFAULT.includes(day) && !semanaState.expandedDays.includes(day);
    let dayTotal = 0;
    let dayMissing = 0;
    const slots = MEALS.map((meal)=>{
      const rid = semanaState.semana?.[day]?.[meal];
      const rec = recMap.get(String(rid || ""));
      const missing = missingForRecipe(rec, despensaMap);
      dayTotal += Number(rec?.costoEstimado || 0);
      dayMissing += missing.length;
      return `
        <button class="sem-slot ${missing.length ? "warn" : ""}" data-act="slot-open" data-day="${day}" data-meal="${meal}">
          <div>
            <div class="sem-slot-meal">${escapeHtml(meal)}</div>
            <div class="sem-slot-name">${rec ? escapeHtml(rec.nombre) : "— vacío —"}</div>
          </div>
          <div class="sem-slot-meta">
            ${rec?.aptaNinos ? '<span class="chip">👶</span>' : ""}
            <span class="chip">${formatMoney(rec?.costoEstimado || 0)}</span>
          </div>
        </button>
      `;
    }).join("");

    return `
      <section class="card sem-day">
        <button class="row sem-day-head" data-act="toggle-day" data-day="${day}" style="width:100%;justify-content:space-between;">
          <div class="row" style="gap:8px;align-items:center;">
            <strong>${escapeHtml(day)}</strong>
            ${today === day ? '<span class="chip">hoy</span>' : ""}
            ${dayMissing ? `<span class="chip sem-warn">⚠ faltan ${dayMissing}</span>` : ""}
          </div>
          <div class="row" style="gap:8px;align-items:center;">
            <span class="chip">${formatMoney(dayTotal)}</span>
            <span class="muted">${collapsed ? "▾" : "▴"}</span>
          </div>
        </button>
        <div class="sem-slots ${collapsed ? "collapsed" : ""}">
          ${slots}
        </div>
      </section>
    `;
  }).join("");

  return `
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h3 class="sectionTitle" style="margin:0;">Semana familiar</h3>
        <span class="chip">Presupuesto: ${formatMoney(presupuesto)}</span>
      </div>
      <div class="sem-budget ${saldo < 0 ? "bad" : "ok"}">
        <div class="row" style="justify-content:space-between;">
          <span>Planificado: <b>${formatMoney(total)}</b></span>
          <span>Saldo: <b>${formatMoney(saldo)}</b></span>
        </div>
        <div class="sem-progress"><span style="width:${ratio}%"></span></div>
      </div>
      <div class="row sem-actions">
        <button class="btn primary" data-act="goto" data-view="recetas">+ Receta</button>
        <button class="btn" data-act="open-shopping">Lista de compra</button>
        <button class="btn good" data-act="plan-ia">Plan IA</button>
        <button class="btn good" data-act="analisis-ia">Análisis Nutricional</button>
      </div>
      <div class="row sem-actions" style="margin-top:8px;">
        <button class="btn" data-act="open-shopping">Historial</button>
        <button class="btn" data-act="export-json" title="Exportar a JSON">Exportar</button>
        <button class="btn" data-act="import-json-trigger" title="Importar desde JSON">Importar</button>
        <input type="file" id="semImportFile" accept="application/json" style="display:none;">
      </div>
    </section>

    ${faltantesSemana.length ? `<section class="card sem-alert">⚠ Faltan ${faltantesSemana.length} ingredientes para completar la semana.</section>` : ""}
    <section class="sem-grid">${dayCards}</section>

    ${semanaState.analisisNutricional ? `
    <section class="card">
      <h4 class="sectionTitle" style="margin:0 0 8px 0;">Análisis Nutricional IA</h4>
      <div class="muted" style="white-space: pre-wrap; font-size: 13px;">${escapeHtml(semanaState.analisisNutricional)}</div>
      <div class="row" style="margin-top:8px;"><button class="btn small" data-act="clear-analisis">Limpiar</button></div>
    </section>
    ` : ""}

    <section class="card">
      <h4 class="sectionTitle" style="margin:0 0 8px 0;">Plan de contingencia</h4>
      ${(semanaState.contingencia||[]).length ? `
        <div class="list">
          ${(semanaState.contingencia||[]).map((it)=>`
            <div class="item">
              <div>
                <div><strong>${escapeHtml(it.nombre || "Receta")}</strong> ${it.aptaNinos ? "👶" : ""}</div>
                <div class="muted">${formatMoney(it.costoEstimado || 0)} · ${(it.ingredientesUsados || []).map(escapeHtml).join(", ")}</div>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `<div class="muted">Aún no hay sugerencias IA guardadas.</div>`}
    </section>
  `;
}

function renderRecetas(semanaState){
  const cards = (semanaState.recetas||[]).map((r)=>`
    <button class="card sem-receta" data-act="open-recipe" data-id="${escapeHtml(r.id)}">
      <div class="row" style="justify-content:space-between;">
        <strong>${escapeHtml(r.nombre)}</strong>
        <span class="chip">${formatMoney(r.costoEstimado || 0)}</span>
      </div>
      <div class="muted">${Number(r.porciones || 0)} porciones · ${Number(r.tiempoMin || 0)} min ${r.aptaNinos ? "· 👶 apta niños" : ""}</div>
    </button>
  `).join("");

  const ingDrafts = (semanaState.ui.ingredientDrafts || []).map((it, idx)=>`
    <div class="row sem-ing-row">
      <input class="sem-input" placeholder="Ingrediente" data-idx="${idx}" data-field="nombre" value="${escapeHtml(it.nombre || "")}">
      <input class="sem-input" type="number" min="0" step="0.1" placeholder="Cant" data-idx="${idx}" data-field="cantidad" value="${escapeHtml(it.cantidad || 0)}">
      <input class="sem-input" placeholder="Unidad" data-idx="${idx}" data-field="unidad" value="${escapeHtml(it.unidad || "und")}">
      <button class="btn danger" data-act="drop-ing" data-idx="${idx}">×</button>
    </div>
  `).join("");

  return `
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h3 class="sectionTitle" style="margin:0;">Biblioteca de recetas</h3>
        <div class="row">
          <button class="btn" data-act="goto" data-view="planner">Volver plan</button>
          <button class="btn primary" data-act="toggle-recipe-form">${semanaState.ui.showRecipeForm ? "Cerrar" : "Nueva"}</button>
        </div>
      </div>
      ${semanaState.ui.showRecipeForm ? `
      <form class="sem-form" id="semRecipeForm">
        <input class="sem-input" name="nombre" placeholder="Nombre receta" required>
        <div class="row sem-grid2">
          <input class="sem-input" type="number" min="1" name="porciones" placeholder="Porciones" required>
          <input class="sem-input" type="number" min="1" name="tiempoMin" placeholder="Tiempo (min)" required>
          <input class="sem-input" type="number" min="0" step="0.1" name="costoEstimado" placeholder="Costo estimado" required>
          <label class="row" style="align-items:center;gap:6px;"><input type="checkbox" name="aptaNinos"> Apta niños</label>
        </div>
        <div class="hr"></div>
        <div class="row" style="justify-content:space-between;align-items:center;"><strong>Ingredientes</strong><button type="button" class="btn" data-act="add-ing">+ Ingrediente</button></div>
        ${ingDrafts}
        <div class="row"><button class="btn good" type="submit">Guardar receta</button></div>
      </form>` : ""}
      <div class="list" style="margin-top:10px;">${cards || '<div class="muted">Sin recetas todavía.</div>'}</div>
    </section>
  `;
}

function renderDespensa(semanaState){
  const rows = (semanaState.despensa||[]).map((it)=>{
    const d = daysToExpire(it.venceEn);
    const soon = d !== null && d <= 3;
    return `
      <div class="item">
        <div>
          <div><strong>${escapeHtml(it.nombre)}</strong> ${soon ? '<span class="chip sem-warn">vence pronto</span>' : ""}</div>
          <div class="muted">${Number(it.cantidad || 0)} ${escapeHtml(it.unidad || "und")} ${it.venceEn ? `· vence ${escapeHtml(it.venceEn)}` : ""}</div>
        </div>
        <div class="row">
          <button class="btn" data-act="pantry-dec" data-id="${escapeHtml(it.id)}">-1</button>
          <button class="btn danger" data-act="pantry-del" data-id="${escapeHtml(it.id)}">Eliminar</button>
        </div>
      </div>
    `;
  }).join("");

  return `
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h3 class="sectionTitle" style="margin:0;">Despensa</h3>
        <div class="row">
          <button class="btn" data-act="goto" data-view="planner">Volver plan</button>
          <button class="btn primary" data-act="toggle-pantry-form">${semanaState.ui.showPantryForm ? "Cerrar" : "Nuevo"}</button>
        </div>
      </div>
      ${semanaState.ui.showPantryForm ? `
      <form id="semPantryForm" class="sem-form">
        <div class="row sem-grid2">
          <input class="sem-input" name="nombre" required placeholder="Ingrediente">
          <input class="sem-input" type="number" min="0" step="0.1" name="cantidad" required placeholder="Cantidad">
          <input class="sem-input" name="unidad" required placeholder="Unidad">
          <input class="sem-input" type="date" name="venceEn" placeholder="Vence en">
        </div>
        <button class="btn good" type="submit">Agregar a despensa</button>
      </form>` : ""}
      <div class="list" style="margin-top:10px;">${rows || '<div class="muted">Despensa vacía.</div>'}</div>
    </section>
  `;
}

function renderModals(semanaState){
  const recipe = semanaState.ui.modal;
  const rec = (semanaState.recetas||[]).find((r)=>String(r.id) === String(recipe?.id||""));
  const buyRows = generarListaCompra({ semana: semanaState });
  const recMap = new Map((semanaState.recetas||[]).map(r=>[String(r.id), r]));
  const listCost = DAYS.reduce((acc, d)=>acc + MEALS.reduce((s,m)=>s + Number(recMap.get(String(semanaState.semana?.[d]?.[m]||""))?.costoEstimado || 0),0),0);

  const historyHtml = (semanaState.historialCompras || []).slice(0, 5).map((h) => `
    <div class="item">
      <div>
        <div class="small"><strong>${new Date(h.ts).toLocaleString()}</strong></div>
        <div class="muted small">${(h.items || []).map(it => `${it.nombre} (${it.cantidad} ${it.unidad})`).join(", ")}</div>
      </div>
    </div>
  `).join("");

  return `
    ${rec ? `
      <div class="modalBackdrop" data-act="close-modal">
        <div class="modal" data-act="modal-content-stop">
          <div class="row" style="justify-content:space-between;align-items:center;"><h3 style="margin:0;">${escapeHtml(rec.nombre)}</h3><button class="iconBtn" data-act="close-modal">Cerrar</button></div>
          <div class="muted">${Number(rec.porciones)} porciones · ${Number(rec.tiempoMin)} min · ${formatMoney(rec.costoEstimado)} ${rec.aptaNinos ? "· 👶" : ""}</div>
          <div class="hr"></div>
          <div class="list">${(rec.ingredientes||[]).map((i)=>`<div class="item"><div>${escapeHtml(i.nombre)}</div><div class="muted">${Number(i.cantidad)} ${escapeHtml(i.unidad)}</div></div>`).join("")}</div>
          <div class="hr"></div>
          <div class="row sem-grid2">
            <select class="sem-input" id="semAssignDay">${DAYS.map(d=>`<option value="${d}">${d}</option>`).join("")}</select>
            <select class="sem-input" id="semAssignMeal">${MEALS.map(m=>`<option value="${m}">${m}</option>`).join("")}</select>
          </div>
          <div class="row"><button class="btn good" data-act="assign-recipe" data-id="${escapeHtml(rec.id)}">Asignar a slot</button><button class="btn danger" data-act="delete-recipe" data-id="${escapeHtml(rec.id)}">Eliminar receta</button></div>
        </div>
      </div>
    ` : ""}

    ${semanaState.ui.shoppingListModal ? `
      <div class="modalBackdrop" data-act="close-shopping">
        <div class="modal" data-act="modal-content-stop">
          <div class="row" style="justify-content:space-between;align-items:center;"><h3 style="margin:0;">Lista de compra</h3><button class="iconBtn" data-act="close-shopping">Cerrar</button></div>
          <div class="muted">Costo plan semanal estimado: ${formatMoney(listCost)}</div>
          <div class="list" style="margin-top:10px; max-height: 40vh; overflow: auto;">
            ${buyRows.length ? buyRows.map((r)=>`<div class="item"><div>${escapeHtml(r.nombre)}</div><div class="muted">${Number(r.cantidad)} ${escapeHtml(r.unidad)}</div></div>`).join("") : '<div class="muted">No faltan ingredientes 🎉</div>'}
          </div>
          <div class="hr"></div>
          <div class="row"><button class="btn good" data-act="save-history" ${buyRows.length ? "" : "disabled"}>Finalizar y Guardar Historial</button></div>
          ${historyHtml ? `<div class="hr"></div><div class="small"><strong>Últimas compras:</strong></div><div class="list" style="max-height: 20vh; overflow: auto;">${historyHtml}</div>` : ""}
        </div>
      </div>
    ` : ""}

    ${semanaState.ui.importModal ? `
      <div class="modalBackdrop" data-act="close-import">
        <div class="modal" data-act="modal-content-stop">
          <div class="row" style="justify-content:space-between;align-items:center;">
            <h3 style="margin:0;">Importar Semana</h3>
            <button class="iconBtn" data-act="close-import">Cerrar</button>
          </div>
          <p class="muted small">Pega el JSON o selecciona un archivo.</p>
          <textarea
            class="sem-import-area"
            placeholder='{ "presupuesto": 280, ... }'
            data-act="import-draft-input"
          >${escapeHtml(semanaState.ui.importJsonDraft || "")}</textarea>
          <div class="row" style="gap:8px; margin-top:10px;">
            <button class="btn primary" data-act="do-import-paste">Importar JSON</button>
            <button class="btn" data-act="import-file-trigger">Buscar archivo</button>
          </div>
        </div>
      </div>
    ` : ""}
  `;
}

export function viewSemana(){
  const { state } = getCtx();
  ensureSemanaShape(state);
  const s = state.semana;

  return `
    <section id="semanaRoot" class="semana-wrap">
      <div class="row sem-subnav">
        <button class="btn ${s.view === "planner" ? "primary" : ""}" data-act="goto" data-view="planner">Plan</button>
        <button class="btn ${s.view === "recetas" ? "primary" : ""}" data-act="goto" data-view="recetas">Recetas</button>
        <button class="btn ${s.view === "despensa" ? "primary" : ""}" data-act="goto" data-view="despensa">Despensa</button>
      </div>
      ${s.view === "planner" ? renderPlanner(s) : ""}
      ${s.view === "recetas" ? renderRecetas(s) : ""}
      ${s.view === "despensa" ? renderDespensa(s) : ""}
      ${renderModals(s)}
    </section>
  `;
}

export function wireSemana(){
  const { state, persist, view, toast } = getCtx();
  ensureSemanaShape(state);
  const root = document.querySelector("#semanaRoot");
  if(!root || root.dataset.wired === "1") return;
  root.dataset.wired = "1";

  root.addEventListener("change", (e)=>{
    const el = e.target;
    if(el.id === "semImportFile"){
      const file = el.files?.[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target.result);
          if(imported && typeof imported === "object"){
             state.semana = imported;
             ensureSemanaShape(state);
             state.semana.ui.importModal = false;
             state.semana.ui.importJsonDraft = "";
             persist();
             view();
             toast("Semana importada ✅");
          }
        } catch(err) {
          toast("Error al importar JSON ❌");
        }
      };
      reader.readAsText(file);
      el.value = "";
    }
  });

  root.addEventListener("input", (e)=>{
    const el = e.target;
    if(!(el instanceof HTMLElement)) return;
    if(!el.matches("[data-field][data-idx]")) return;
    const idx = Number(el.dataset.idx || -1);
    const field = el.dataset.field || "";
    if(idx < 0 || !field) return;
    const draft = state.semana.ui.ingredientDrafts[idx];
    if(!draft) return;
    draft[field] = (field === "cantidad") ? Number(el.value || 0) : el.value;
    persist();
  });

  root.addEventListener("input", (e)=>{
    const el = e.target;
    if(el.dataset.act === "import-draft-input"){
      state.semana.ui.importJsonDraft = el.value;
      persist();
    }
  });

  root.addEventListener("click", async (e)=>{
    const el = e.target?.closest?.("[data-act]");
    if(!el) return;
    const act = el.dataset.act;

    if(act === "modal-content-stop") return;

    if(act === "goto"){
      state.semana.view = el.dataset.view || "planner";
      persist();
      view();
      return;
    }

    if(act === "toggle-day"){
      const day = el.dataset.day;
      const set = new Set(state.semana.expandedDays || []);
      if(set.has(day)) set.delete(day); else set.add(day);
      state.semana.expandedDays = Array.from(set);
      persist();
      view();
      return;
    }

    if(act === "slot-open"){
      state.semana.view = "recetas";
      state.semana.ui.assign = { day: el.dataset.day || "lunes", meal: el.dataset.meal || "desayuno" };
      persist();
      view();
      toast("Elige una receta y asígnala desde su detalle");
      return;
    }

    if(act === "toggle-recipe-form"){
      state.semana.ui.showRecipeForm = !state.semana.ui.showRecipeForm;
      persist();
      view();
      return;
    }

    if(act === "add-ing"){
      state.semana.ui.ingredientDrafts.push({ nombre: "", cantidad: 1, unidad: "und" });
      persist();
      view();
      return;
    }

    if(act === "drop-ing"){
      const idx = Number(el.dataset.idx || -1);
      state.semana.ui.ingredientDrafts = state.semana.ui.ingredientDrafts.filter((_,i)=>i!==idx);
      if(!state.semana.ui.ingredientDrafts.length) state.semana.ui.ingredientDrafts = [{ nombre:"", cantidad:1, unidad:"und" }];
      persist();
      view();
      return;
    }

    if(act === "open-recipe"){
      state.semana.ui.modal = { id: el.dataset.id };
      persist();
      view();
      return;
    }

    if(act === "close-modal"){
      state.semana.ui.modal = null;
      persist();
      view();
      return;
    }

    if(act === "assign-recipe"){
      const rid = el.dataset.id;
      const daySel = document.querySelector("#semAssignDay");
      const mealSel = document.querySelector("#semAssignMeal");
      const day = daySel?.value || state.semana.ui.assign?.day || "lunes";
      const meal = mealSel?.value || state.semana.ui.assign?.meal || "desayuno";
      if(state.semana.semana?.[day] && MEALS.includes(meal)){
        state.semana.semana[day][meal] = rid;
      }
      state.semana.ui.modal = null;
      state.semana.view = "planner";
      persist();
      view();
      toast("Receta asignada ✅");
      return;
    }

    if(act === "delete-recipe"){
      const rid = String(el.dataset.id || "");
      state.semana.recetas = state.semana.recetas.filter((r)=>String(r.id)!==rid);
      DAYS.forEach((d)=> MEALS.forEach((m)=>{ if(String(state.semana.semana?.[d]?.[m]||"")===rid) state.semana.semana[d][m]=null; }));
      state.semana.ui.modal = null;
      persist();
      view();
      return;
    }

    if(act === "toggle-pantry-form"){
      state.semana.ui.showPantryForm = !state.semana.ui.showPantryForm;
      persist();
      view();
      return;
    }

    if(act === "pantry-dec"){
      const id = String(el.dataset.id || "");
      state.semana.despensa = state.semana.despensa
        .map((x)=> String(x.id) === id ? { ...x, cantidad: Math.max(0, Number(x.cantidad||0)-1) } : x)
        .filter((x)=> Number(x.cantidad||0) > 0);
      persist();
      view();
      return;
    }

    if(act === "pantry-del"){
      const id = String(el.dataset.id || "");
      state.semana.despensa = state.semana.despensa.filter((x)=>String(x.id)!==id);
      persist();
      view();
      return;
    }

    if(act === "open-shopping"){
      state.semana.ui.shoppingListModal = true;
      persist();
      view();
      return;
    }

    if(act === "close-shopping"){
      state.semana.ui.shoppingListModal = false;
      persist();
      view();
      return;
    }

    if(act === "save-history"){
      const buyRows = generarListaCompra({ semana: state.semana });
      if(buyRows.length){
        state.semana.historialCompras.unshift({
          ts: Date.now(),
          items: buyRows
        });
        toast("Compra guardada en historial ✅");
      }
      state.semana.ui.shoppingListModal = false;
      persist();
      view();
      return;
    }

    if(act === "analisis-ia"){
      if(!navigator.onLine){
        toast("Sin red: no puedo consultar Gemini ahora.");
        return;
      }
      if(!getSemanaGeminiApiKey()){
        toast("Configura la API key de Gemini en Ajustes → Semana IA.");
        return;
      }
      try{
        toast("Analizando nutrición...");
        const analisis = await generarAnalisisNutricional(state.semana);
        state.semana.analisisNutricional = analisis;
        persist();
        view();
        toast("Análisis nutricional listo ✅");
      }catch(err){
        console.error(err);
        toast("No pude generar el análisis nutricional.");
      }
      return;
    }

    if(act === "clear-analisis"){
      state.semana.analisisNutricional = null;
      persist();
      view();
      return;
    }

    if(act === "plan-ia"){
      if(!navigator.onLine){
        toast("Sin red: no puedo consultar Gemini ahora.");
        return;
      }
      if(!getSemanaGeminiApiKey()){
        toast("Configura la API key de Gemini en Ajustes → Semana IA.");
        return;
      }
      try{
        toast("Generando plan IA...");
        const plan = await generarPlanContingencia(state.semana.despensa || []);
        state.semana.contingencia = Array.isArray(plan) ? plan.slice(0,3) : [];
        persist();
        view();
        toast("Plan de contingencia listo ✅");
      }catch(err){
        console.error(err);
        toast("No pude generar el plan IA.");
      }
      return;
    }

    if(act === "export-json"){
      exportarSemanaJson(getSemanaSchemaTemplate(), "semana_schema.json");
      return;
    }

    if(act === "import-json-trigger"){
      state.semana.ui.importModal = true;
      persist();
      view();
      return;
    }

    if(act === "close-import"){
      state.semana.ui.importModal = false;
      persist();
      view();
      return;
    }

    if(act === "import-file-trigger"){
      root.querySelector("#semImportFile")?.click();
      return;
    }

    if(act === "do-import-paste"){
      const raw = state.semana.ui.importJsonDraft || "";
      console.log("Attempting import with raw:", raw);
      try {
        const imported = JSON.parse(raw);
        if(imported && typeof imported === "object"){
          state.semana = imported;
          ensureSemanaShape(state);
          state.semana.ui.importModal = false;
          state.semana.ui.importJsonDraft = "";
          persist();
          view();
          toast("Semana importada ✅");
        } else {
          toast("JSON inválido ❌");
        }
      } catch(err) {
        toast("Error al parsear JSON ❌");
      }
      return;
    }
  });

  root.addEventListener("submit", (e)=>{
    const form = e.target;
    if(!(form instanceof HTMLFormElement)) return;
    e.preventDefault();

    if(form.id === "semRecipeForm"){
      const fd = new FormData(form);
      const receta = {
        id: `r_${Date.now()}`,
        nombre: String(fd.get("nombre") || "").trim(),
        porciones: Number(fd.get("porciones") || 1),
        aptaNinos: fd.get("aptaNinos") === "on",
        tiempoMin: Number(fd.get("tiempoMin") || 0),
        costoEstimado: Number(fd.get("costoEstimado") || 0),
        ingredientes: (state.semana.ui.ingredientDrafts || [])
          .map((i)=>({ nombre: String(i.nombre||"").trim(), cantidad: Number(i.cantidad||0), unidad: String(i.unidad||"und").trim() }))
          .filter((i)=>i.nombre)
      };
      if(!receta.nombre) return;
      state.semana.recetas.unshift(receta);
      state.semana.ui.showRecipeForm = false;
      state.semana.ui.ingredientDrafts = [{ nombre:"", cantidad:1, unidad:"und" }];
      persist();
      view();
      return;
    }

    if(form.id === "semPantryForm"){
      const fd = new FormData(form);
      const it = {
        id: `d_${Date.now()}`,
        nombre: String(fd.get("nombre") || "").trim(),
        cantidad: Number(fd.get("cantidad") || 0),
        unidad: String(fd.get("unidad") || "und").trim(),
        venceEn: String(fd.get("venceEn") || "").trim() || null,
      };
      if(!it.nombre || !(it.cantidad > 0)) return;
      state.semana.despensa.unshift(it);
      state.semana.ui.showPantryForm = false;
      persist();
      view();
    }
  });
}
