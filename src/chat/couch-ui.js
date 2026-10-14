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

export const couchUiState = {
  activeSubTab: "chart", // "chart" | "data" | "interpretation"
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
 * Convierte grados eclípticos a ángulo en radianes para SVG.
 * 0° Aries se ubica a la izquierda (180° trigonométrico) y gira en sentido antihorario.
 */
function eclipticToSvgAngle(eclipticDeg) {
  const angleDeg = (180 - eclipticDeg + 360) % 360;
  return (angleDeg * Math.PI) / 180;
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
 * Renderiza el gráfico SVG de la Carta Natal
 */
export function renderNatalChartSvg(chartData) {
  const width = 500;
  const height = 500;
  const cx = width / 2;
  const cy = height / 2;

  const rOuter = 230;
  const rZodiacInner = 190;
  const rHousesInner = 130;
  const rAspects = 125;

  // Pre-calcular grados absolutos para cúspides de casas
  const houseCuspsMap = (chartData.houseCusps || []).map((h) => ({
    ...h,
    absDeg: getAbsoluteEclipticDegree(h.sign, h.degree, h.minutes, h.seconds),
  }));

  // 1. Dibuja rueda del zodíaco (12 signos)
  let zodiacSlicesHtml = "";
  ZODIAC_SIGNS.forEach((sign, idx) => {
    const startDeg = idx * 30;
    const endDeg = (idx + 1) * 30;

    const startAngle = eclipticToSvgAngle(startDeg);
    const endAngle = eclipticToSvgAngle(endDeg);

    const x1Outer = cx + rOuter * Math.cos(startAngle);
    const y1Outer = cy + rOuter * Math.sin(startAngle);
    const x2Outer = cx + rOuter * Math.cos(endAngle);
    const y2Outer = cy + rOuter * Math.sin(endAngle);

    const x1Inner = cx + rZodiacInner * Math.cos(startAngle);
    const y1Inner = cy + rZodiacInner * Math.sin(startAngle);
    const x2Inner = cx + rZodiacInner * Math.cos(endAngle);
    const y2Inner = cy + rZodiacInner * Math.sin(endAngle);

    const pathD = `
      M ${x1Inner} ${y1Inner}
      L ${x1Outer} ${y1Outer}
      A ${rOuter} ${rOuter} 0 0 0 ${x2Outer} ${y2Outer}
      L ${x2Inner} ${y2Inner}
      A ${rZodiacInner} ${rZodiacInner} 0 0 1 ${x1Inner} ${y1Inner}
      Z
    `;

    const elemColors = {
      fuego: "rgba(239, 68, 68, 0.15)",
      tierra: "rgba(234, 179, 8, 0.15)",
      aire: "rgba(59, 130, 246, 0.15)",
      agua: "rgba(34, 197, 94, 0.15)",
    };
    const fillColor = elemColors[sign.element] || "rgba(255,255,255,0.05)";

    const midAngle = eclipticToSvgAngle(startDeg + 15);
    const rSymbol = (rOuter + rZodiacInner) / 2;
    const sx = cx + rSymbol * Math.cos(midAngle);
    const sy = cy + rSymbol * Math.sin(midAngle) + 5;

    zodiacSlicesHtml += `
      <path d="${pathD}" fill="${fillColor}" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
      <text x="${sx}" y="${sy}" font-size="16" fill="#f3f4f6" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${sign.symbol}</text>
    `;
  });

  // 2. Cúspides de Casas (1 a 12)
  let houseLinesHtml = "";

  houseCuspsMap.forEach((h, i) => {
    const deg = h.absDeg;
    const angle = eclipticToSvgAngle(deg);

    const xInner = cx + rHousesInner * Math.cos(angle);
    const yInner = cy + rHousesInner * Math.sin(angle);
    const xOuter = cx + rZodiacInner * Math.cos(angle);
    const yOuter = cy + rZodiacInner * Math.sin(angle);

    const isAngular = h.house === 1 || h.house === 4 || h.house === 7 || h.house === 10;
    const strokeWidth = isAngular ? 2.5 : 1;
    const strokeColor = isAngular ? "#c084fc" : "rgba(255,255,255,0.3)";

    // Extensión exterior para ángulos AC, MC, etc.
    const xLabelExt = cx + (rZodiacInner + 18) * Math.cos(angle);
    const yLabelExt = cy + (rZodiacInner + 18) * Math.sin(angle);

    houseLinesHtml += `
      <line x1="${xInner}" y1="${yInner}" x2="${xOuter}" y2="${yOuter}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />
    `;

    // Etiqueta de la casa
    if (isAngular) {
      const angularTag = h.house === 1 ? "AC" : h.house === 10 ? "MC" : h.house === 7 ? "DC" : "IC";
      houseLinesHtml += `
        <text x="${xLabelExt}" y="${yLabelExt}" font-size="11" font-weight="bold" fill="#c084fc" text-anchor="middle" dominant-baseline="central">${angularTag}</text>
      `;
    }

    // Calcular el ángulo medio con la siguiente casa para colocar el número de casa centrado
    const nextCusp = houseCuspsMap[(i + 1) % 12];
    let nextDeg = nextCusp ? nextCusp.absDeg : deg + 30;
    if (nextDeg < deg) nextDeg += 360;
    const midSectorDeg = (deg + nextDeg) / 2;
    const midAngle = eclipticToSvgAngle(midSectorDeg % 360);

    const rText = rHousesInner + 15;
    const tx = cx + rText * Math.cos(midAngle);
    const ty = cy + rText * Math.sin(midAngle);

    houseLinesHtml += `
      <text x="${tx}" y="${ty}" font-size="10" font-weight="600" fill="rgba(255,255,255,0.6)" text-anchor="middle" dominant-baseline="central">${h.house}</text>
    `;
  });

  // 3. Posiciones Planetarias
  let planetsHtml = "";
  const planetPositionsMap = {};

  (chartData.planets || []).forEach((p) => {
    const cat = PLANETS_CATALOG.find((item) => item.id === p.planetId);
    if (!cat) return;

    const absDeg = getAbsoluteEclipticDegree(p.sign, p.degree, p.minutes, p.seconds);
    const angle = eclipticToSvgAngle(absDeg);

    const pxAspect = cx + rAspects * Math.cos(angle);
    const pyAspect = cy + rAspects * Math.sin(angle);
    planetPositionsMap[p.planetId] = { x: pxAspect, y: pyAspect };

    const rPlanetRing = (rZodiacInner + rHousesInner) / 2;
    const px = cx + rPlanetRing * Math.cos(angle);
    const py = cy + rPlanetRing * Math.sin(angle) + 4;

    planetsHtml += `
      <g class="couchPlanetGlyph" title="${esc(cat.name)} en ${esc(p.sign)} ${formatDegrees(p.degree, p.minutes, p.seconds)}">
        <circle cx="${cx + rAspects * Math.cos(angle)}" cy="${cy + rAspects * Math.sin(angle)}" r="3" fill="#a855f7" />
        <line x1="${cx + rAspects * Math.cos(angle)}" y1="${cy + rAspects * Math.sin(angle)}" x2="${cx + rHousesInner * Math.cos(angle)}" y2="${cy + rHousesInner * Math.sin(angle)}" stroke="rgba(168, 85, 247, 0.4)" stroke-dasharray="2,2" />
        <text x="${px}" y="${py}" font-size="15" fill="#e0e7ff" text-anchor="middle" dominant-baseline="central" font-weight="bold">${cat.symbol}</text>
      </g>
    `;
  });

  // 4. Aspectos entre planetas (Líneas centrales)
  let aspectLinesHtml = "";
  (chartData.aspects || []).forEach((asp) => {
    const pos1 = planetPositionsMap[asp.planet1Id];
    const pos2 = planetPositionsMap[asp.planet2Id];
    if (!pos1 || !pos2) return;

    const aspectInfo = ASPECT_TYPES.find((a) => a.id === asp.aspectId);
    const color = aspectInfo ? aspectInfo.color : "rgba(255,255,255,0.4)";

    aspectLinesHtml += `
      <line x1="${pos1.x}" y1="${pos1.y}" x2="${pos2.x}" y2="${pos2.y}" stroke="${color}" stroke-width="1.5" stroke-opacity="0.85" />
    `;
  });

  const emptyNotice = (!chartData.planets || chartData.planets.length === 0)
    ? `<text x="${cx}" y="${cy}" font-size="12" fill="rgba(255,255,255,0.3)" text-anchor="middle">Carta Vacía — Agrega planetas en 'Casas y Aspectos'</text>`
    : "";

  return `
    <div class="couchChartContainer">
      <svg viewBox="0 0 ${width} ${height}" class="couchNatalSvg">
        <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" />
        <circle cx="${cx}" cy="${cy}" r="${rZodiacInner}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
        <circle cx="${cx}" cy="${cy}" r="${rHousesInner}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
        <circle cx="${cx}" cy="${cy}" r="${rAspects}" fill="rgba(15, 23, 42, 0.6)" stroke="rgba(255,255,255,0.15)" stroke-width="1" />

        ${zodiacSlicesHtml}
        ${houseLinesHtml}
        ${aspectLinesHtml}
        ${planetsHtml}
        ${emptyNotice}
      </svg>
    </div>
  `;
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

      <!-- Sección 4: Registrar Aspectos -->
      <div class="couchFormSection">
        <div class="couchSectionTitle">📐 Aspectos y Orbes</div>
        <div class="couchAddRow" style="margin-bottom: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
          <select id="couchAddAspP1" class="ncSettingsInput" style="flex: 1; min-width: 110px;">${planetOptions}</select>
          <select id="couchAddAspType" class="ncSettingsInput" style="flex: 1; min-width: 120px;">${aspectOptions}</select>
          <select id="couchAddAspP2" class="ncSettingsInput" style="flex: 1; min-width: 110px;">${planetOptions}</select>
          <button class="ncActionBtn ncActionBtnPrimary" id="btnAddAspect">Agregar Aspecto</button>
        </div>
        <div class="couchDataList">${aspectsTableHtml}</div>
      </div>

      <div class="couchDangerRow">
        <button class="ncActionBtn" id="btnResetNatalChart" style="color:#fb7185; border-color:rgba(251,113,133,0.3)">Borrar Todo y Reiniciar</button>
      </div>
    </div>
  `;
}

/**
 * Renderiza el placeholder para la Pestaña 3: Interpretación
 */
function renderInterpretationTab() {
  return `
    <div class="couchInterpretationWrap">
      <div class="ncWelcome">
        <div class="ncWelcomeIcon">📜</div>
        <div class="ncWelcomeTitle">Interpretación Astral</div>
        <div class="ncWelcomeSub">Próximamente: Podrás redactar y generar interpretaciones psicológicas y astrológicas detalladas para tu carta natal.</div>
      </div>
    </div>
  `;
}

/**
 * Vista principal de Couch
 */
export function viewCouch() {
  const chartData = getNatalChartData();

  const isChartTab = couchUiState.activeSubTab === "chart";
  const isDataTab = couchUiState.activeSubTab === "data";
  const isInterpTab = couchUiState.activeSubTab === "interpretation";

  let bodyHtml = "";
  if (isChartTab) bodyHtml = renderNatalChartSvg(chartData);
  else if (isDataTab) bodyHtml = renderDataEditorTab(chartData);
  else if (isInterpTab) bodyHtml = renderInterpretationTab();

  return `
    <div class="couchWrap">
      ${couchCss()}

      <div class="couchHeader">
        <div class="couchHeaderTitle">🛋️ Couch Astro — Carta Natal</div>
        <div class="couchHeaderSub">
          ${chartData.birthDetails.name ? `Carta de: <strong>${esc(chartData.birthDetails.name)}</strong>` : "Sin datos de nacimiento"}
          ${chartData.birthDetails.date ? ` · ${esc(chartData.birthDetails.date)}` : ""}
        </div>
      </div>

      <div class="couchBody">${bodyHtml}</div>

      <div class="couchBottomBar">
        <button class="couchBarBtn ${isChartTab ? "couchBarBtn--active" : ""}" id="btnCouchSubChart">
          <span class="couchBarIcon">🔮</span>
          <span class="couchBarLabel">Carta Natal</span>
        </button>
        <button class="couchBarBtn ${isDataTab ? "couchBarBtn--active" : ""}" id="btnCouchSubData">
          <span class="couchBarIcon">📝</span>
          <span class="couchBarLabel">Casas y Aspectos</span>
        </button>
        <button class="couchBarBtn ${isInterpTab ? "couchBarBtn--active" : ""} couchBarBtn--disabled" id="btnCouchSubInterp" title="Próximamente">
          <span class="couchBarIcon">📜</span>
          <span class="couchBarLabel">Interpretación</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * Event Listener Wiring para Couch UI
 */
export function wireCouch(root) {
  const chartData = getNatalChartData();

  root.querySelector("#btnCouchSubChart")?.addEventListener("click", () => {
    couchUiState.activeSubTab = "chart";
    rerenderCouch(root);
  });
  root.querySelector("#btnCouchSubData")?.addEventListener("click", () => {
    couchUiState.activeSubTab = "data";
    rerenderCouch(root);
  });
  root.querySelector("#btnCouchSubInterp")?.addEventListener("click", () => {
    couchUiState.activeSubTab = "interpretation";
    rerenderCouch(root);
  });

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
    .couchWrap { display: flex; flex-direction: column; gap: 12px; margin-bottom: 60px; }
    .couchHeader { background: rgba(168, 85, 247, 0.12); border: 1px solid rgba(168, 85, 247, 0.25); border-radius: 14px; padding: 12px 16px; }
    .couchHeaderTitle { font-size: 16px; font-weight: 800; color: #f3e8ff; }
    .couchHeaderSub { font-size: 12px; opacity: 0.7; margin-top: 2px; }

    .couchChartContainer { display: flex; justify-content: center; align-items: center; padding: 10px; background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; }
    .couchNatalSvg { width: 100%; max-width: 460px; height: auto; max-height: 460px; }

    .couchBottomBar { position: fixed; bottom: 0; left: 0; right: 0; background: #111827; border-top: 1px solid rgba(255,255,255,0.12); display: flex; justify-content: space-around; padding: 6px 12px; z-index: 100; max-width: 900px; margin: 0 auto; }
    .couchBarBtn { flex: 1; background: none; border: none; color: rgba(255,255,255,0.5); display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; padding: 6px; border-radius: 8px; font-size: 11px; }
    .couchBarBtn--active { color: #c084fc; background: rgba(168, 85, 247, 0.15); font-weight: 700; }
    .couchBarBtn--disabled { opacity: 0.35; cursor: not-allowed; }
    .couchBarIcon { font-size: 18px; }

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
