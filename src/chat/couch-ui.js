/**
 * couch-ui.js — UI y renderizador SVG para la sección Couch (Carta Natal)
 * MemoryCarl / NeuroChat
 */

import {
  ZODIAC_SIGNS,
  PLANETS_CATALOG,
  ASPECT_TYPES,
  getNatalChartData,
  saveNatalChartData,
  resetNatalChartData,
} from "./couchStore.js";
import {
  chartPoints,
  effectiveAspects,
  aspectMode,
  computeAspects,
  hasChartData,
  planetsInHouse,
  HOUSE_THEMES,
  SIGN_RULERS,
} from "./astroChart.js";
import { renderNatalWheel, aspectStyle, ELEMENT_COLORS } from "./natalWheel.js";
import {
  getActivationStats,
  backfillAstroActivations,
  isAstroInPromptEnabled,
  setAstroInPromptEnabled,
  BACKFILL_KEY,
} from "./astroLinks.js";
import { getFullChatHistory } from "./neurochat.js";

export const couchUiState = {
  activeSubTab: "chart", // "chart" | "activations" | "data"
  selectedPlanet: null,  // planeta con la ficha abierta
  hiddenGroups: ["menores"], // grupos de aspectos ocultos en la rueda
  showAllAspects: false, // lista de aspectos completa o solo los más exactos
  periodDays: 30,        // periodo de Activaciones (null = todo)
  openKey: null,         // fila de ranking expandida
  backfillRunning: false,
};

function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Convierte Signo + Grados + Minutos + Segundos en grados eclípticos decimales precisos (0° a 360°)
 */
function getAbsoluteEclipticDegree(signId, degree, minutes = 0, seconds = 0) {
  const signIdx = ZODIAC_SIGNS.findIndex((s) => s.id === signId);
  if (signIdx === -1) return 0;

  const deg = Math.max(0, Math.min(29, parseFloat(degree) || 0));
  const min = Math.max(0, Math.min(59, parseFloat(minutes) || 0)) / 60;
  const sec = Math.max(0, Math.min(59, parseFloat(seconds) || 0)) / 3600;

  return signIdx * 30 + deg + min + sec;
}

/**
 * Formatea grados, minutos y segundos (ej. 12°27'48")
 */
function formatDegrees(degree = 0, minutes = 0, seconds = 0) {
  const d = Math.floor(degree || 0);
  const m = String(Math.floor(minutes || 0)).padStart(2, "0");
  const s = String(Math.floor(seconds || 0)).padStart(2, "0");
  return `${d}°${m}'${s}"`;
}

/**
 * Obtiene el nombre/etiqueta angular de la casa (AC, IC, DC, MC)
 */
function getHouseLabel(houseNum) {
  if (houseNum === 1) return "Casa 1 (AC)";
  if (houseNum === 4) return "Casa 4";
  if (houseNum === 7) return "Casa 7";
  if (houseNum === 10) return "Casa 10 (MC)";
  return `Casa ${houseNum}`;
}

/**
 * Calcula la orbe y tipo (A) Aplicativo / (S) Separativo entre dos planetas para un aspecto
 */
function computeAspectOrbText(asp, chartData) {
  if (asp.orbText) return asp.orbText;

  const p1 = (chartData.planets || []).find((p) => p.planetId === asp.planet1Id);
  const p2 = (chartData.planets || []).find((p) => p.planetId === asp.planet2Id);
  const aspectInfo = ASPECT_TYPES.find((a) => a.id === asp.aspectId);

  if (!p1 || !p2 || !aspectInfo) return "—";

  const deg1 = getAbsoluteEclipticDegree(p1.sign, p1.degree, p1.minutes, p1.seconds);
  const deg2 = getAbsoluteEclipticDegree(p2.sign, p2.degree, p2.minutes, p2.seconds);

  let rawDiff = Math.abs(deg1 - deg2);
  if (rawDiff > 180) rawDiff = 360 - rawDiff;

  const orb = Math.abs(rawDiff - aspectInfo.angle);
  const isApplying = rawDiff <= aspectInfo.angle;
  const status = isApplying ? "A" : "S";

  return `${orb.toFixed(2)}° (${status})`;
}

/**
 * Renderiza el formulario de la Pestaña 2: Casas y Aspectos
 */
function renderDataEditorTab(chartData) {
  const details = chartData.birthDetails || {};

  const signOptions = ZODIAC_SIGNS.map(
    (s) => `<option value="${s.id}">${s.symbol} ${esc(s.name)}</option>`
  ).join("");

  const planetOptions = PLANETS_CATALOG.map(
    (p) => `<option value="${p.id}">${p.symbol} ${esc(p.name)}</option>`
  ).join("");

  const aspectOptions = ASPECT_TYPES.map(
    (a) => `<option value="${a.id}">${a.symbol} ${esc(a.name)} (${a.angle}°)</option>`
  ).join("");

  // Tabla estructurada de planetas agregados (estilo screenshot)
  const planetRowsHtml = (chartData.planets || []).map((p, idx) => {
    const cat = PLANETS_CATALOG.find((item) => item.id === p.planetId);
    const sign = ZODIAC_SIGNS.find((s) => s.id === p.sign);

    const houseDisplay = p.secondaryHouse
      ? `<span class="couchTransitionHouse">${p.house} » ${p.secondaryHouse}</span>`
      : `<span class="couchSingleHouse">${p.house || "—"}</span>`;

    const retroBadge = p.isRetrograde ? `<span class="couchRetroBadge">R</span>` : "";

    return `
      <tr class="couchPlanetsTableRow">
        <td class="couchTableCell couchCellPlanet">
          <span class="couchPlanetSymbol">${cat ? cat.symbol : ""}</span>
          <span class="couchPlanetName">${cat ? esc(cat.name) : esc(p.planetId)}</span>
        </td>
        <td class="couchTableCell couchCellCoords">
          <span class="couchSignSymbol">${sign ? sign.symbol : ""}</span>
          <span class="couchDegText">${formatDegrees(p.degree, p.minutes, p.seconds)}</span>
          ${retroBadge}
        </td>
        <td class="couchTableCell couchCellHouse">${houseDisplay}</td>
        <td class="couchTableCell couchCellActions">
          <button class="ncIconBtn couchBtnRemove" data-remove-planet-idx="${idx}">✕</button>
        </td>
      </tr>
    `;
  }).join("");

  const planetsTableHtml = (chartData.planets || []).length > 0
    ? `
      <table class="couchPlanetsTable">
        <thead>
          <tr>
            <th>Planeta</th>
            <th>Coordenadas</th>
            <th>Casa</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${planetRowsHtml}
        </tbody>
      </table>
    `
    : `<div class="ncSideEmpty">No se han registrado planetas.</div>`;

  // Tabla de Cúspides de las Casas (estilo screenshot Casas (Placidus))
  const houseCuspsTableRows = (chartData.houseCusps || []).map((h) => {
    const sign = ZODIAC_SIGNS.find((s) => s.id === h.sign);
    const label = getHouseLabel(h.house);
    return `
      <tr class="couchPlanetsTableRow">
        <td class="couchTableCell" style="font-weight: 700; color: #f3f4f6;">${esc(label)}</td>
        <td class="couchTableCell couchCellCoords">
          <span class="couchSignSymbol">${sign ? sign.symbol : ""}</span>
          <span class="couchDegText">${formatDegrees(h.degree, h.minutes, h.seconds)}</span>
        </td>
      </tr>
    `;
  }).join("");

  const houseCuspsTableHtml = `
    <table class="couchPlanetsTable" style="margin-bottom: 12px;">
      <thead>
        <tr>
          <th>Casas (Placidus)</th>
          <th>Coordenadas</th>
        </tr>
      </thead>
      <tbody>
        ${houseCuspsTableRows}
      </tbody>
    </table>
  `;

  // Cúspides de las 12 Casas (Campos de edición)
  const cuspsFormHtml = (chartData.houseCusps || []).map((h) => {
    const isAngular = h.house === 1 || h.house === 4 || h.house === 7 || h.house === 10;
    const tag = h.house === 1 ? " (AC)" : h.house === 10 ? " (MC)" : h.house === 7 ? " (DC)" : h.house === 4 ? " (IC)" : "";
    return `
      <div class="couchCuspRow">
        <span class="couchCuspLabel ${isAngular ? "couchCuspLabel--angular" : ""}">Casa ${h.house}${tag}:</span>
        <select class="ncSettingsInput couchCuspSign" data-cusp-house="${h.house}">
          ${ZODIAC_SIGNS.map((s) => `<option value="${s.id}" ${s.id === h.sign ? "selected" : ""}>${s.symbol} ${esc(s.name)}</option>`).join("")}
        </select>
        <input type="number" class="ncSettingsInput couchCuspDeg" data-cusp-house="${h.house}" value="${h.degree ?? 0}" min="0" max="29" placeholder="°" title="Grados" />
        <input type="number" class="ncSettingsInput couchCuspMin" data-cusp-house="${h.house}" value="${h.minutes ?? 0}" min="0" max="59" placeholder="'" title="Minutos" />
        <input type="number" class="ncSettingsInput couchCuspSec" data-cusp-house="${h.house}" value="${h.seconds ?? 0}" min="0" max="59" placeholder='"' title="Segundos" />
      </div>
    `;
  }).join("");

  // Tabla estructurada de Aspectos (estilo screenshot)
  const aspectRowsHtml = (chartData.aspects || []).map((asp, idx) => {
    const p1 = PLANETS_CATALOG.find((item) => item.id === asp.planet1Id);
    const p2 = PLANETS_CATALOG.find((item) => item.id === asp.planet2Id);
    const aType = ASPECT_TYPES.find((item) => item.id === asp.aspectId);
    const orbText = computeAspectOrbText(asp, chartData);

    return `
      <tr class="couchPlanetsTableRow">
        <td class="couchTableCell">
          <span class="couchPlanetSymbol">${p1 ? p1.symbol : ""}</span>
          <span>${p1 ? esc(p1.name) : esc(asp.planet1Id)}</span>
        </td>
        <td class="couchTableCell" style="text-align: center; color: ${aType ? aType.color : "inherit"}; font-size: 16px;">
          <span title="${aType ? esc(aType.name) : ""}">${aType ? aType.symbol : "—"}</span>
        </td>
        <td class="couchTableCell">
          <span class="couchPlanetSymbol">${p2 ? p2.symbol : ""}</span>
          <span>${p2 ? esc(p2.name) : esc(asp.planet2Id)}</span>
        </td>
        <td class="couchTableCell" style="font-family: monospace; font-size: 12px; color: #cbd5e1;">
          ${esc(orbText)}
        </td>
        <td class="couchTableCell couchCellActions">
          <button class="ncIconBtn couchBtnRemove" data-remove-aspect-idx="${idx}">✕</button>
        </td>
      </tr>
    `;
  }).join("");

  const aspectsTableHtml = (chartData.aspects || []).length > 0
    ? `
      <table class="couchPlanetsTable">
        <thead>
          <tr>
            <th>Planeta</th>
            <th style="text-align: center;">Aspecto</th>
            <th>Planeta</th>
            <th>Orbes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${aspectRowsHtml}
        </tbody>
      </table>
    `
    : `<div class="ncSideEmpty">No hay aspectos registrados.</div>`;

  return `
    <div class="couchDataEditor">
      <!-- Sección 1: Datos de Nacimiento -->
      <div class="couchFormSection">
        <div class="couchSectionTitle">👤 Datos de Nacimiento</div>
        <div class="couchGrid2">
          <div>
            <label class="ncSettingsLabel">Nombre / Persona</label>
            <input type="text" id="couchBirthName" class="ncSettingsInput" value="${esc(details.name)}" placeholder="Ej: Carl" />
          </div>
          <div>
            <label class="ncSettingsLabel">Ciudad / País</label>
            <input type="text" id="couchBirthLoc" class="ncSettingsInput" value="${esc(details.location)}" placeholder="Ej: Santiago, Chile" />
          </div>
          <div>
            <label class="ncSettingsLabel">Fecha</label>
            <input type="date" id="couchBirthDate" class="ncSettingsInput" value="${esc(details.date)}" />
          </div>
          <div>
            <label class="ncSettingsLabel">Hora</label>
            <input type="time" id="couchBirthTime" class="ncSettingsInput" value="${esc(details.time)}" />
          </div>
        </div>
      </div>

      <!-- Sección 2: Agregar Planetas -->
      <div class="couchFormSection">
        <div class="couchSectionTitle">🪐 Registrar Posiciones Planetarias</div>
        <div class="couchAddGrid">
          <div>
            <label class="ncSettingsLabel">Planeta</label>
            <select id="couchAddPlanetId" class="ncSettingsInput">${planetOptions}</select>
          </div>
          <div>
            <label class="ncSettingsLabel">Signo</label>
            <select id="couchAddPlanetSign" class="ncSettingsInput">${signOptions}</select>
          </div>
          <div>
            <label class="ncSettingsLabel">Grados / Min / Seg</label>
            <div class="couchDegreeInputs">
              <input type="number" id="couchAddPlanetDeg" class="ncSettingsInput" placeholder="° (0-29)" min="0" max="29" value="0" />
              <input type="number" id="couchAddPlanetMin" class="ncSettingsInput" placeholder="' (0-59)" min="0" max="59" value="0" />
              <input type="number" id="couchAddPlanetSec" class="ncSettingsInput" placeholder='" (0-59)' min="0" max="59" value="0" />
            </div>
          </div>
          <div>
            <label class="ncSettingsLabel">Casa / Transición</label>
            <div class="couchHouseInputs">
              <input type="number" id="couchAddPlanetHouse" class="ncSettingsInput" placeholder="Casa (1-12)" min="1" max="12" value="1" />
              <span class="couchTransitionSymbol">»</span>
              <input type="number" id="couchAddPlanetSecHouse" class="ncSettingsInput" placeholder="2da Casa (opcional)" min="1" max="12" />
            </div>
          </div>
          <div class="couchAddActionWrap">
            <label class="couchRetroLabel"><input type="checkbox" id="couchAddPlanetRetro" /> Retrógrado (R)</label>
            <button class="ncActionBtn ncActionBtnPrimary" id="btnAddPlanet">Agregar Planeta</button>
          </div>
        </div>
        <div class="couchDataList" style="margin-top: 14px;">${planetsTableHtml}</div>
      </div>

      <!-- Sección 3: Cúspides de las 12 Casas -->
      <div class="couchFormSection">
        <div class="couchSectionTitle">🏛️ Cúspides de Casas (Placidus)</div>
        ${houseCuspsTableHtml}
        <details class="couchCuspsDetails" open>
          <summary style="cursor: pointer; font-size: 12px; font-weight: bold; color: #c084fc; margin-bottom: 8px;">✏️ Editar Coordenadas de Casas</summary>
          <div class="couchCuspsHeaderRow">
            <span>Casa</span>
            <span>Signo</span>
            <span>°</span>
            <span>'</span>
            <span>"</span>
          </div>
          <div class="couchCuspsGrid">${cuspsFormHtml}</div>
          <div style="margin-top: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <button class="ncActionBtn ncActionBtnPrimary" id="btnSaveCusps" style="font-size: 12px; padding: 8px 16px;">💾 Guardar Coordenadas de Casas</button>
            <span id="couchCuspsSaveStatus" style="font-size: 12px; font-weight: bold; color: #34d399; display: none;">✓ Coordenadas guardadas</span>
          </div>
        </details>
      </div>

      <!-- Sección 4: Aspectos -->
      <div class="couchFormSection">
        <div class="couchSectionTitle">📐 Aspectos y Orbes</div>
        <div class="couchModeSwitch">
          <button class="couchChip ${aspectMode(chartData) === "auto" ? "couchChip--on" : ""}" data-couch="aspect-mode" data-id="auto">Calculados automáticamente</button>
          <button class="couchChip ${aspectMode(chartData) === "manual" ? "couchChip--on" : ""}" data-couch="aspect-mode" data-id="manual">Los que cargué a mano</button>
        </div>
        ${aspectMode(chartData) === "auto" ? `
          <div class="couchHint">Se calculan solos a partir de tus planetas (orbes: 8° conjunción y oposición, 7° trígono y cuadratura, 5° sextil, 2–3° menores; +2° con Sol o Luna). Tus aspectos manuales se conservan por si vuelves a ese modo.</div>
          <div class="couchDataList">${computeAspects(chartData).length ? `
            <table class="couchPlanetsTable">
              <thead><tr><th>Planeta</th><th style="text-align:center;">Aspecto</th><th>Planeta</th><th>Orbe</th></tr></thead>
              <tbody>${computeAspects(chartData).map((asp) => {
                const p1 = PLANETS_CATALOG.find((item) => item.id === asp.planet1Id);
                const p2 = PLANETS_CATALOG.find((item) => item.id === asp.planet2Id);
                const aType = ASPECT_TYPES.find((item) => item.id === asp.aspectId);
                return `<tr class="couchPlanetsTableRow">
                  <td class="couchTableCell">${p1 ? p1.symbol : ""} ${p1 ? esc(p1.name) : ""}</td>
                  <td class="couchTableCell" style="text-align:center;color:${aType ? aType.color : "inherit"}">${aType ? aType.symbol : ""} ${aType ? esc(aType.name) : ""}</td>
                  <td class="couchTableCell">${p2 ? p2.symbol : ""} ${p2 ? esc(p2.name) : ""}</td>
                  <td class="couchTableCell" style="font-family:monospace;font-size:12px;">${asp.orb.toFixed(2)}°</td>
                </tr>`;
              }).join("")}</tbody>
            </table>` : `<div class="ncSideEmpty">Agrega planetas para calcular aspectos.</div>`}</div>
        ` : `
          <div class="couchAddRow" style="margin-bottom: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
            <select id="couchAddAspP1" class="ncSettingsInput" style="flex: 1; min-width: 110px;">${planetOptions}</select>
            <select id="couchAddAspType" class="ncSettingsInput" style="flex: 1; min-width: 120px;">${aspectOptions}</select>
            <select id="couchAddAspP2" class="ncSettingsInput" style="flex: 1; min-width: 110px;">${planetOptions}</select>
            <button class="ncActionBtn ncActionBtnPrimary" id="btnAddAspect">Agregar Aspecto</button>
          </div>
          <div class="couchDataList">${aspectsTableHtml}</div>
        `}
      </div>

      <div class="couchDangerRow">
        <button class="ncActionBtn" id="btnResetNatalChart" style="color:#fb7185; border-color:rgba(251,113,133,0.3)">Borrar Todo y Reiniciar</button>
      </div>
    </div>
  `;
}

/**
 * Rueda de la carta natal (se mantiene el nombre para compatibilidad)
 */
export function renderNatalChartSvg(chartData, opts = {}) {
  return `<div class="couchChartContainer">${renderNatalWheel(chartData, opts)}</div>`;
}

const ASPECT_GROUPS = [
  { id: "tension", label: "Tensión", color: "#f87171", hint: "cuadratura, oposición" },
  { id: "armonia", label: "Armonía", color: "#60a5fa", hint: "trígono, sextil" },
  { id: "conjuncion", label: "Conjunción", color: "#c084fc", hint: "planetas juntos" },
  { id: "menores", label: "Menores", color: "#94a3b8", hint: "semisextil, quincuncio" },
];

function signName(id) {
  return ZODIAC_SIGNS.find((s) => s.id === id)?.name || id;
}

function planetName(id) {
  return PLANETS_CATALOG.find((p) => p.id === id)?.name || id;
}

function planetSymbol(id) {
  const s = PLANETS_CATALOG.find((p) => p.id === id)?.symbol || "";
  return s.length === 1 ? `${s}︎` : s;
}

function fmtOrb(orb) {
  return orb == null ? "—" : `${orb.toFixed(1)}°`;
}

// Ficha del planeta seleccionado
function renderPlanetCard(chartData, aspects) {
  const id = couchUiState.selectedPlanet;
  const p = chartPoints(chartData).find((x) => x.id === id);
  if (!p) {
    return `<div class="couchHint">Toca un planeta en la rueda para ver su ficha y resaltar sus aspectos.</div>`;
  }
  const sign = ZODIAC_SIGNS.find((s) => s.id === p.sign);
  const rules = (chartData.houseCusps || []).filter((h) => SIGN_RULERS[h.sign] === p.id).map((h) => h.house);
  const own = aspects.filter((a) => a.planet1Id === p.id || a.planet2Id === p.id);
  return `
    <div class="couchCard">
      <div class="couchCardHead">
        <span class="couchCardGlyph">${planetSymbol(p.id)}</span>
        <div>
          <div class="couchCardTitle">${esc(p.name)} en ${esc(sign?.name || p.sign)} ${formatDegrees(p.raw.degree, p.raw.minutes, p.raw.seconds)}${p.retro ? ` <span class="couchRetroBadge">R</span>` : ""}</div>
          <div class="couchCardSub">${p.house ? `Casa ${p.house} · ${esc(HOUSE_THEMES[p.house])}` : "Casa sin indicar"}${sign ? ` · ${esc(sign.element)}` : ""}</div>
        </div>
        <button class="couchIconBtn" data-couch="select-planet" data-id="" aria-label="Cerrar ficha">✕</button>
      </div>
      ${rules.length ? `<div class="couchCardLine">Rige tu${rules.length > 1 ? "s casas" : " casa"} ${rules.join(" y ")} (${rules.map((h) => esc(HOUSE_THEMES[h])).join("; ")})</div>` : ""}
      ${own.length ? `
        <div class="couchCardAspects">
          ${own.map((a) => {
            const other = a.planet1Id === p.id ? a.planet2Id : a.planet1Id;
            const t = ASPECT_TYPES.find((x) => x.id === a.aspectId);
            const st = aspectStyle(a.aspectId);
            return `<button class="couchChip" data-couch="select-planet" data-id="${esc(other)}" style="--c:${st.color}">
              <span style="color:${st.color}">${t?.symbol || ""}</span> ${esc(t?.name || a.aspectId)} ${planetSymbol(other)} ${esc(planetName(other))} <span class="couchOrb">${fmtOrb(a.orb)}</span>
            </button>`;
          }).join("")}
        </div>` : `<div class="couchCardLine couchMuted">Sin aspectos con los orbes actuales.</div>`}
    </div>`;
}

function renderElementBalance(chartData) {
  const counts = { fuego: 0, tierra: 0, aire: 0, agua: 0 };
  for (const p of chartPoints(chartData).filter((x) => !x.isAngle && !["nodo_norte", "nodo_sur", "lilith", "chiron"].includes(x.id))) {
    const el = ZODIAC_SIGNS.find((s) => s.id === p.sign)?.element;
    if (el) counts[el]++;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return `
    <div class="couchSection">
      <div class="couchSectionHead"><h3>Elementos</h3></div>
      <div class="couchBalance">
        ${Object.entries(counts).map(([el, n]) => `
          <div class="couchBalanceRow">
            <span class="couchBalanceLabel">${el[0].toUpperCase() + el.slice(1)}</span>
            <span class="couchBar"><span style="width:${Math.round((n / total) * 100)}%;background:${ELEMENT_COLORS[el]}"></span></span>
            <span class="couchBalanceNum">${n}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

function renderChartTab(chartData) {
  const aspects = effectiveAspects(chartData);
  const hidden = couchUiState.hiddenGroups;
  const countBy = (g) => aspects.filter((a) => aspectStyle(a.aspectId).group === g).length;
  const visibleAll = aspects.filter((a) => !hidden.includes(aspectStyle(a.aspectId).group))
    .sort((x, y) => (x.orb ?? 99) - (y.orb ?? 99));
  const visible = couchUiState.showAllAspects ? visibleAll : visibleAll.slice(0, 12);

  return `
    ${renderNatalChartSvg(chartData, { selected: couchUiState.selectedPlanet, hiddenGroups: hidden })}
    <div class="couchLegend">
      ${ASPECT_GROUPS.map((g) => `
        <button class="couchLegendChip ${hidden.includes(g.id) ? "couchLegendChip--off" : ""}" data-couch="toggle-group" data-id="${g.id}" title="${esc(g.hint)}">
          <span class="couchLegendLine" style="background:${g.color}"></span>${g.label} <span class="couchMuted">${countBy(g.id)}</span>
        </button>`).join("")}
    </div>
    ${renderPlanetCard(chartData, aspects)}
    ${renderElementBalance(chartData)}
    <div class="couchSection">
      <div class="couchSectionHead">
        <h3>Aspectos</h3>
        <span class="couchMuted">${aspectMode(chartData) === "auto" ? "calculados" : "cargados a mano"}</span>
      </div>
      ${visible.length ? `
        <div class="couchAspectList">
          ${visible.map((a) => {
            const t = ASPECT_TYPES.find((x) => x.id === a.aspectId);
            const st = aspectStyle(a.aspectId);
            return `<button class="couchAspectRow" data-couch="select-planet" data-id="${esc(a.planet1Id)}">
              <span>${planetSymbol(a.planet1Id)} ${esc(planetName(a.planet1Id))}</span>
              <span class="couchAspectType" style="color:${st.color}">${t?.symbol || ""} ${esc(t?.name || a.aspectId)}</span>
              <span>${planetSymbol(a.planet2Id)} ${esc(planetName(a.planet2Id))}</span>
              <span class="couchOrb">${fmtOrb(a.orb)}</span>
            </button>`;
          }).join("")}
        </div>
        ${visibleAll.length > 12 ? `<button class="couchChip" data-couch="toggle-all-aspects">${couchUiState.showAllAspects ? "Ver solo los más exactos" : `Ver todos (${visibleAll.length})`}</button>` : ""}` : `<div class="couchHint">No hay aspectos que mostrar.</div>`}
    </div>`;
}

function fmtWhen(ts) {
  try {
    return new Date(ts).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
  } catch (_e) {
    return "";
  }
}

function renderExamples(item) {
  if (!item.examples.length) return "";
  return `
    <div class="couchExamples">
      ${item.examples.map((r) => `
        <div class="couchExample">
          <div class="couchExampleText">“${esc(r.snippet)}”</div>
          <div class="couchExampleMeta">${fmtWhen(r.ts)}</div>
        </div>`).join("")}
    </div>`;
}

function renderRankRow(key, label, sub, item, max) {
  const open = couchUiState.openKey === key;
  return `
    <div class="couchRank ${open ? "couchRank--open" : ""}">
      <button class="couchRankBtn" data-couch="open-key" data-id="${esc(key)}">
        <div class="couchRankTop">
          <span class="couchRankLabel">${label}</span>
          <span class="couchRankCount">${item.count} msj</span>
        </div>
        <span class="couchBar"><span style="width:${Math.max(4, Math.round((item.score / max) * 100))}%"></span></span>
        <div class="couchRankSub">${sub}</div>
      </button>
      ${open ? renderExamples(item) : ""}
    </div>`;
}

function renderActivationsTab(chartData) {
  if (couchUiState.backfillRunning) {
    return `<div class="couchHint">Analizando tu historial de conversaciones…</div>`;
  }
  const days = couchUiState.periodDays;
  const stats = getActivationStats({ days, chart: chartData });
  const houses = stats.houses.filter((h) => h.score > 0).sort((a, b) => b.score - a.score);
  const maxHouse = Math.max(1, ...houses.map((h) => h.score));
  const maxPlanet = Math.max(1, ...stats.planets.map((p) => p.score));
  const heat = {
    houses: Object.fromEntries(stats.houses.map((h) => [h.house, h.score / maxHouse])),
    planets: Object.fromEntries(stats.planets.map((p) => [p.id, p.score / maxPlanet])),
  };
  const chartReady = hasChartData(chartData);
  const promptOn = isAstroInPromptEnabled();

  const periods = [
    { d: 7, label: "7 días" },
    { d: 30, label: "30 días" },
    { d: null, label: "Todo" },
  ];

  return `
    <div class="couchIntro">
      Cada mensaje que le escribes a Carl se cruza con tu carta: si hablas de trabajo se activa tu casa 10 y sus planetas; de pareja, la casa 7 y Venus… Se calcula en tu teléfono, sin gastar tokens.
    </div>
    <div class="couchPeriods">
      ${periods.map((p) => `<button class="couchChip ${days === p.d ? "couchChip--on" : ""}" data-couch="period" data-id="${p.d ?? ""}">${p.label}</button>`).join("")}
      <span class="couchMuted couchPushRight">${stats.total} mensaje${stats.total === 1 ? "" : "s"} vinculado${stats.total === 1 ? "" : "s"}</span>
    </div>
    ${!stats.total ? `<div class="couchHint">Todavía no hay mensajes vinculados en este periodo. Habla con Carl de tu día, tu trabajo, tus relaciones… y aquí verás qué partes de tu carta se activan.</div>` : `
      ${chartReady ? renderNatalChartSvg(chartData, { heat }) : `<div class="couchHint">Completa tu carta en "Datos" para ver el mapa de calor sobre la rueda.</div>`}
      <div class="couchSection">
        <div class="couchSectionHead"><h3>Casas más activas</h3></div>
        ${houses.slice(0, 6).map((h) => renderRankRow(`h${h.house}`, `Casa ${h.house} · ${esc(h.theme)}`,
          `por: ${esc(h.via.join(", "))}${chartReady && planetsInHouse(chartData, h.house).length ? ` · con ${planetsInHouse(chartData, h.house).map((id) => `${planetSymbol(id)} ${esc(planetName(id))}`).join(", ")}` : ""}`,
          h, maxHouse)).join("")}
      </div>
      <div class="couchSection">
        <div class="couchSectionHead"><h3>Planetas más activos</h3></div>
        ${stats.planets.slice(0, 6).map((p) => renderRankRow(`p${p.id}`, `${planetSymbol(p.id)} ${esc(p.name)}`,
          `${esc(p.via.join(" · "))}`, p, maxPlanet)).join("")}
      </div>
    `}
    <div class="couchSection">
      <label class="couchToggle">
        <input type="checkbox" data-couch="toggle-prompt" ${promptOn ? "checked" : ""} ${chartReady ? "" : "disabled"} />
        <span>
          <strong>Carl tiene en cuenta tu carta al responder</strong>
          <span class="couchMuted">Solo cuando el mensaje toca un tema de tu carta se envía un resumen de unos 150–200 tokens. Si está apagado, no se envía nada.</span>
        </span>
      </label>
    </div>`;
}

/**
 * Vista principal de Couch
 */
export function viewCouch() {
  const chartData = getNatalChartData();
  const tab = couchUiState.activeSubTab;

  let bodyHtml = "";
  if (tab === "data") bodyHtml = renderDataEditorTab(chartData);
  else if (tab === "activations") bodyHtml = renderActivationsTab(chartData);
  else bodyHtml = renderChartTab(chartData);

  const tabs = [
    { id: "chart", icon: "🔮", label: "Carta" },
    { id: "activations", icon: "✨", label: "Activaciones" },
    { id: "data", icon: "📝", label: "Datos" },
  ];

  return `
    <div class="couchWrap">
      ${couchCss()}

      <div class="couchHeader">
        <div class="couchHeaderTitle">Couch · Carta natal</div>
        <div class="couchHeaderSub">
          ${chartData.birthDetails.name ? `<strong>${esc(chartData.birthDetails.name)}</strong>` : "Sin datos de nacimiento"}
          ${chartData.birthDetails.date ? ` · ${esc(chartData.birthDetails.date)}` : ""}
          ${chartData.birthDetails.time ? ` · ${esc(chartData.birthDetails.time)}` : ""}
          ${chartData.birthDetails.location ? ` · ${esc(chartData.birthDetails.location)}` : ""}
        </div>
      </div>

      <div class="couchTabs" role="tablist">
        ${tabs.map((t) => `<button class="couchTab ${tab === t.id ? "couchTab--active" : ""}" data-couch="tab" data-id="${t.id}" role="tab" aria-selected="${tab === t.id}">${t.icon} ${t.label}</button>`).join("")}
      </div>

      <div class="couchBody">${bodyHtml}</div>
    </div>
  `;
}

// Analiza el historial una vez (en segundo plano) y vuelve a pintar
async function runBackfillIfNeeded(root) {
  try {
    if (localStorage.getItem(BACKFILL_KEY) === "1" || couchUiState.backfillRunning) return;
  } catch (_e) {
    return;
  }
  couchUiState.backfillRunning = true;
  rerenderCouch(root);
  try {
    const history = await getFullChatHistory();
    backfillAstroActivations(history);
  } catch (err) {
    console.warn("[Couch] No se pudo analizar el historial:", err);
  }
  couchUiState.backfillRunning = false;
  rerenderCouch(root);
}

/**
 * Event Listener Wiring para Couch UI
 */
export function wireCouch(root) {
  const chartData = getNatalChartData();
  const wrap = root.querySelector(".couchWrap");

  wrap?.addEventListener("click", (e) => {
    const target = e.target.closest("[data-couch], [data-planet]");
    if (!target) return;
    if (target.matches("[data-planet]") && !target.matches("[data-couch]")) {
      const id = target.getAttribute("data-planet");
      couchUiState.selectedPlanet = couchUiState.selectedPlanet === id ? null : id;
      rerenderCouch(root);
      return;
    }
    const id = target.dataset.id;
    switch (target.dataset.couch) {
      case "tab":
        couchUiState.activeSubTab = id;
        break;
      case "select-planet":
        couchUiState.selectedPlanet = id || null;
        break;
      case "toggle-group": {
        const set = new Set(couchUiState.hiddenGroups);
        if (set.has(id)) set.delete(id); else set.add(id);
        couchUiState.hiddenGroups = [...set];
        break;
      }
      case "period":
        couchUiState.periodDays = id ? Number(id) : null;
        couchUiState.openKey = null;
        break;
      case "toggle-all-aspects":
        couchUiState.showAllAspects = !couchUiState.showAllAspects;
        break;
      case "open-key":
        couchUiState.openKey = couchUiState.openKey === id ? null : id;
        break;
      case "aspect-mode":
        chartData.aspectMode = id;
        saveNatalChartData(chartData);
        break;
      case "toggle-prompt":
        setAstroInPromptEnabled(target.checked);
        return;
      default:
        return;
    }
    rerenderCouch(root);
  });

  if (couchUiState.activeSubTab === "activations") runBackfillIfNeeded(root);


  if (couchUiState.activeSubTab === "data") {
    const saveDetails = () => {
      chartData.birthDetails = {
        name: root.querySelector("#couchBirthName")?.value || "",
        location: root.querySelector("#couchBirthLoc")?.value || "",
        date: root.querySelector("#couchBirthDate")?.value || "",
        time: root.querySelector("#couchBirthTime")?.value || "",
      };
      saveNatalChartData(chartData);
    };

    ["#couchBirthName", "#couchBirthLoc", "#couchBirthDate", "#couchBirthTime"].forEach((sel) => {
      root.querySelector(sel)?.addEventListener("change", saveDetails);
      root.querySelector(sel)?.addEventListener("input", saveDetails);
    });

    // Agregar Planeta con precisión de minutos/segundos y transición de casa
    root.querySelector("#btnAddPlanet")?.addEventListener("click", () => {
      const planetId = root.querySelector("#couchAddPlanetId")?.value;
      const sign = root.querySelector("#couchAddPlanetSign")?.value;
      const degree = parseFloat(root.querySelector("#couchAddPlanetDeg")?.value) || 0;
      const minutes = parseFloat(root.querySelector("#couchAddPlanetMin")?.value) || 0;
      const seconds = parseFloat(root.querySelector("#couchAddPlanetSec")?.value) || 0;
      const house = parseInt(root.querySelector("#couchAddPlanetHouse")?.value, 10) || 1;
      const secondaryHouse = parseInt(root.querySelector("#couchAddPlanetSecHouse")?.value, 10) || null;
      const isRetrograde = Boolean(root.querySelector("#couchAddPlanetRetro")?.checked);

      if (!planetId || !sign) return;

      chartData.planets.push({
        planetId,
        sign,
        degree,
        minutes,
        seconds,
        house,
        secondaryHouse,
        isRetrograde,
      });

      saveNatalChartData(chartData);
      rerenderCouch(root);
    });

    // Eliminar Planeta
    root.querySelectorAll("[data-remove-planet-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-remove-planet-idx"), 10);
        if (!isNaN(idx)) {
          chartData.planets.splice(idx, 1);
          saveNatalChartData(chartData);
          rerenderCouch(root);
        }
      });
    });

    // Función helper para sincronizar datos de cúspides
    const syncCuspsFromForm = () => {
      root.querySelectorAll(".couchCuspRow").forEach((row) => {
        const signEl = row.querySelector(".couchCuspSign");
        if (!signEl) return;
        const houseNum = parseInt(signEl.getAttribute("data-cusp-house"), 10);
        const cuspObj = chartData.houseCusps.find((h) => h.house === houseNum);
        if (cuspObj) {
          cuspObj.sign = signEl.value || cuspObj.sign;
          cuspObj.degree = parseFloat(row.querySelector(".couchCuspDeg")?.value) || 0;
          cuspObj.minutes = parseFloat(row.querySelector(".couchCuspMin")?.value) || 0;
          cuspObj.seconds = parseFloat(row.querySelector(".couchCuspSec")?.value) || 0;
        }
      });
      saveNatalChartData(chartData);
    };

    // Auto-save en 'input' y 'change' para las cúspides
    root.querySelectorAll(".couchCuspSign, .couchCuspDeg, .couchCuspMin, .couchCuspSec").forEach((el) => {
      const handleCuspChange = () => {
        syncCuspsFromForm();
        const statusEl = root.querySelector("#couchCuspsSaveStatus");
        if (statusEl) {
          statusEl.style.display = "inline";
          statusEl.textContent = "✓ Guardado automático";
          setTimeout(() => { if (statusEl) statusEl.style.display = "none"; }, 2000);
        }
      };
      el.addEventListener("change", handleCuspChange);
      el.addEventListener("input", handleCuspChange);
    });

    // Botón explícito "Guardar Coordenadas de Casas"
    root.querySelector("#btnSaveCusps")?.addEventListener("click", () => {
      syncCuspsFromForm();
      const statusEl = root.querySelector("#couchCuspsSaveStatus");
      if (statusEl) {
        statusEl.style.display = "inline";
        statusEl.textContent = "✓ Coordenadas guardadas";
        setTimeout(() => { if (statusEl) statusEl.style.display = "none"; }, 3000);
      }
      rerenderCouch(root);
    });

    // Agregar Aspecto
    root.querySelector("#btnAddAspect")?.addEventListener("click", () => {
      const planet1Id = root.querySelector("#couchAddAspP1")?.value;
      const aspectId = root.querySelector("#couchAddAspType")?.value;
      const planet2Id = root.querySelector("#couchAddAspP2")?.value;

      if (!planet1Id || !aspectId || !planet2Id) return;
      if (planet1Id === planet2Id) {
        alert("Selecciona dos planetas diferentes para formar un aspecto.");
        return;
      }

      chartData.aspects.push({ planet1Id, aspectId, planet2Id });
      saveNatalChartData(chartData);
      rerenderCouch(root);
    });

    // Eliminar Aspecto
    root.querySelectorAll("[data-remove-aspect-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-remove-aspect-idx"), 10);
        if (!isNaN(idx)) {
          chartData.aspects.splice(idx, 1);
          saveNatalChartData(chartData);
          rerenderCouch(root);
        }
      });
    });

    // Reiniciar
    root.querySelector("#btnResetNatalChart")?.addEventListener("click", () => {
      if (confirm("¿Seguro que deseas borrar todos los datos ingresados de la carta natal?")) {
        resetNatalChartData();
        rerenderCouch(root);
      }
    });
  }
}

function rerenderCouch(root) {
  const container = root.querySelector(".nchatWrap");
  if (!container) return;
  const activeTabContent = container.querySelector(".couchWrap");
  if (activeTabContent) {
    activeTabContent.outerHTML = viewCouch();
    wireCouch(root);
  }
}

function couchCss() {
  return `<style id="couchStyles">
    .couchWrap { display: flex; flex-direction: column; gap: 14px; margin: 0 auto 60px; max-width: 760px; width: 100%; }
    .couchHeader { padding: 2px 2px 0; }
    .couchHeaderTitle { font-size: 22px; font-weight: 800; letter-spacing: -.3px; color: #f5f3ff; }
    .couchHeaderSub { font-size: 13px; opacity: 0.65; margin-top: 3px; }

    .couchTabs { display: flex; gap: 4px; padding: 4px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 14px; }
    .couchTab { flex: 1; background: none; border: none; color: rgba(255,255,255,.6); font-size: 13px; font-weight: 600; padding: 9px 6px; border-radius: 10px; cursor: pointer; white-space: nowrap; }
    .couchTab--active { background: rgba(168,85,247,.22); color: #f3e8ff; font-weight: 800; }
    .couchBody { display: flex; flex-direction: column; gap: 14px; }

    .couchChartContainer { display: flex; justify-content: center; align-items: center; padding: 6px; background: radial-gradient(circle at center, rgba(124,58,237,.12), rgba(15,13,25,.6) 70%); border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; }
    .couchNatalSvg { width: 100%; max-width: 520px; height: auto; touch-action: manipulation; }
    .couchPlanet { cursor: pointer; }
    .couchPlanet text { pointer-events: none; }

    .couchLegend { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
    .couchLegendChip { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); color: #e5e7eb; border-radius: 20px; padding: 5px 11px; font-size: 12px; cursor: pointer; }
    .couchLegendChip--off { opacity: .4; text-decoration: line-through; }
    .couchLegendLine { width: 16px; height: 3px; border-radius: 2px; }

    .couchSection { display: flex; flex-direction: column; gap: 8px; }
    .couchSectionHead { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .couchSectionHead h3 { margin: 0; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .7px; opacity: .6; }
    .couchMuted { opacity: .55; font-size: 12px; font-weight: 500; }
    .couchHint, .couchIntro { font-size: 13px; line-height: 1.5; opacity: .7; padding: 12px 14px; border: 1px dashed rgba(255,255,255,.14); border-radius: 14px; }
    .couchIntro { border-style: solid; background: rgba(168,85,247,.07); border-color: rgba(168,85,247,.22); opacity: .9; }
    .couchPushRight { margin-left: auto; }

    .couchCard { background: rgba(168,85,247,.08); border: 1px solid rgba(168,85,247,.28); border-radius: 16px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .couchCardHead { display: flex; align-items: center; gap: 12px; }
    .couchCardHead > div { flex: 1; min-width: 0; }
    .couchCardGlyph { font-size: 28px; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 12px; background: rgba(0,0,0,.25); }
    .couchCardTitle { font-size: 15px; font-weight: 800; }
    .couchCardSub, .couchCardLine { font-size: 12px; opacity: .75; }
    .couchCardAspects { display: flex; flex-wrap: wrap; gap: 6px; }
    .couchIconBtn { background: none; border: none; color: rgba(255,255,255,.5); font-size: 15px; cursor: pointer; padding: 4px 6px; }
    .couchChip { display: inline-flex; align-items: center; gap: 5px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); color: #e5e7eb; border-radius: 20px; padding: 5px 11px; font-size: 12px; cursor: pointer; }
    .couchChip--on { background: rgba(168,85,247,.28); border-color: rgba(192,132,252,.6); color: #f3e8ff; font-weight: 700; }
    .couchOrb { font-family: monospace; font-size: 11px; opacity: .6; }

    .couchAspectList { display: flex; flex-direction: column; gap: 4px; }
    .couchAspectRow { display: grid; grid-template-columns: 1fr auto 1fr auto; gap: 8px; align-items: center; text-align: left; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07); color: #e5e7eb; border-radius: 10px; padding: 7px 10px; font-size: 12px; cursor: pointer; }
    .couchAspectType { font-weight: 700; white-space: nowrap; }

    .couchBalance { display: flex; flex-direction: column; gap: 6px; }
    .couchBalanceRow { display: grid; grid-template-columns: 56px 1fr 20px; gap: 8px; align-items: center; font-size: 12px; }
    .couchBalanceNum { text-align: right; opacity: .7; }
    .couchBar { display: block; height: 8px; background: rgba(255,255,255,.07); border-radius: 6px; overflow: hidden; }
    .couchBar > span { display: block; height: 100%; border-radius: 6px; background: linear-gradient(90deg, #f59e0b, #f97316); }
    .couchBalance .couchBar > span { opacity: .85; }

    .couchPeriods { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .couchRank { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; overflow: hidden; }
    .couchRank--open { border-color: rgba(245,158,11,.4); }
    .couchRankBtn { width: 100%; text-align: left; background: none; border: none; color: inherit; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; cursor: pointer; }
    .couchRankTop { display: flex; justify-content: space-between; gap: 8px; }
    .couchRankLabel { font-size: 14px; font-weight: 700; }
    .couchRankCount { font-size: 12px; opacity: .6; white-space: nowrap; }
    .couchRankSub { font-size: 11px; opacity: .55; }
    .couchExamples { display: flex; flex-direction: column; gap: 6px; padding: 0 12px 12px; }
    .couchExample { background: rgba(0,0,0,.2); border-radius: 10px; padding: 8px 10px; }
    .couchExampleText { font-size: 13px; line-height: 1.4; }
    .couchExampleMeta { font-size: 11px; opacity: .5; margin-top: 3px; }

    .couchToggle { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 14px; cursor: pointer; font-size: 13px; }
    .couchToggle > span { display: flex; flex-direction: column; gap: 3px; }
    .couchToggle input { margin-top: 3px; width: 18px; height: 18px; accent-color: #a855f7; flex-shrink: 0; }
    .couchModeSwitch { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }

    .couchFormSection { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px; margin-bottom: 12px; }
    .couchSectionTitle { font-size: 13px; font-weight: 800; opacity: 0.85; margin-bottom: 10px; color: #e9d5ff; }
    .couchGrid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

    .couchAddGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; align-items: end; }
    .couchDegreeInputs, .couchHouseInputs { display: flex; gap: 4px; align-items: center; }
    .couchTransitionSymbol { font-weight: bold; color: #ef4444; }
    .couchAddActionWrap { display: flex; flex-direction: column; gap: 6px; justify-content: flex-end; }
    .couchRetroLabel { font-size: 12px; display: flex; align-items: center; gap: 4px; cursor: pointer; color: #60a5fa; }

    /* Planetary Table styling matching user screenshot */
    .couchPlanetsTable { width: 100%; border-collapse: collapse; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; overflow: hidden; font-size: 13px; }
    .couchPlanetsTable th { text-align: left; padding: 8px 12px; background: rgba(255,255,255,0.05); font-size: 11px; text-transform: uppercase; color: rgba(255,255,255,0.6); border-bottom: 1px solid rgba(255,255,255,0.1); }
    .couchPlanetsTableRow { border-bottom: 1px dashed rgba(255,255,255,0.08); }
    .couchPlanetsTableRow:last-child { border-bottom: none; }
    .couchTableCell { padding: 8px 12px; vertical-align: middle; }
    .couchCellPlanet { display: flex; align-items: center; gap: 6px; font-weight: bold; }
    .couchPlanetSymbol { font-size: 16px; color: #e0e7ff; }
    .couchSignSymbol { font-size: 15px; color: #38bdf8; margin-right: 4px; }
    .couchDegText { font-family: monospace; font-size: 12px; }
    .couchRetroBadge { font-size: 10px; font-weight: bold; color: #38bdf8; margin-left: 4px; }
    .couchTransitionHouse { color: #ef4444; font-weight: bold; }
    .couchSingleHouse { font-weight: bold; color: #ef4444; }

    .couchCuspsHeaderRow { display: grid; grid-template-columns: minmax(75px, 1fr) minmax(90px, 1.2fr) minmax(42px, 0.6fr) minmax(42px, 0.6fr) minmax(42px, 0.6fr); gap: 6px; font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.6); text-transform: uppercase; padding: 4px 8px; margin-bottom: 4px; }
    .couchCuspsGrid { display: flex; flex-direction: column; gap: 6px; }
    .couchCuspRow { display: grid; grid-template-columns: minmax(75px, 1fr) minmax(90px, 1.2fr) minmax(42px, 0.6fr) minmax(42px, 0.6fr) minmax(42px, 0.6fr); gap: 6px; align-items: center; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.12); padding: 6px 8px; border-radius: 8px; }
    .couchCuspLabel { font-size: 11px; font-weight: 700; color: #f3f4f6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .couchCuspLabel--angular { color: #c084fc; font-weight: 800; }

    /* Estilos explícitos de alta visibilidad para inputs y selects */
    .couchWrap select.ncSettingsInput,
    .couchWrap input.ncSettingsInput {
      background-color: #1e293b !important;
      color: #ffffff !important;
      border: 1px solid rgba(255, 255, 255, 0.25) !important;
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 12px;
      font-weight: 600;
      width: 100%;
      box-sizing: border-box;
      outline: none;
      -webkit-appearance: none;
      appearance: none;
    }

    .couchWrap select.ncSettingsInput {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%23c084fc' viewBox='0 0 24 24'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E") !important;
      background-repeat: no-repeat !important;
      background-position: right 4px center !important;
      background-size: 16px 16px !important;
      padding-right: 20px !important;
    }

    .couchWrap select.ncSettingsInput option {
      background-color: #0f172a !important;
      color: #ffffff !important;
    }

    .couchWrap input.ncSettingsInput:focus,
    .couchWrap select.ncSettingsInput:focus {
      border-color: #c084fc !important;
      box-shadow: 0 0 0 2px rgba(192, 132, 252, 0.3) !important;
    }

    .couchWrap input[type="number"].ncSettingsInput {
      text-align: center;
      padding: 6px 2px;
    }

    .couchDangerRow { margin-top: 16px; text-align: center; }

    @media (max-width: 600px) {
      .couchGrid2 { grid-template-columns: 1fr; }
      .couchCuspsHeaderRow,
      .couchCuspRow { grid-template-columns: minmax(65px, 0.9fr) minmax(80px, 1.1fr) minmax(36px, 0.5fr) minmax(36px, 0.5fr) minmax(36px, 0.5fr); gap: 4px; padding: 4px 6px; }
      .couchCuspLabel { font-size: 10px; }
      .couchWrap select.ncSettingsInput,
      .couchWrap input.ncSettingsInput { font-size: 11px; padding: 4px; }
    }
  </style>`;
}
