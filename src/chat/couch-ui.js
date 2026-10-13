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
 * Convierte Signo + Grado en grados eclípticos (0° a 360°)
 */
function getAbsoluteEclipticDegree(signId, degree) {
  const signIdx = ZODIAC_SIGNS.findIndex((s) => s.id === signId);
  if (signIdx === -1) return 0;
  const deg = Math.max(0, Math.min(29.99, parseFloat(degree) || 0));
  return signIdx * 30 + deg;
}

/**
 * Convierte grados eclípticos a ángulo en radianes/grados para SVG.
 * En la carta natal tradicional, 0° Aries se ubica usualmente a la izquierda (180° astronómico/trigonométrico)
 * y gira en sentido antihorario.
 */
function eclipticToSvgAngle(eclipticDeg) {
  // 0° Aries en 180° (izquierda), girando en sentido antihorario (restando ángulo)
  const angleDeg = (180 - eclipticDeg + 360) % 360;
  return (angleDeg * Math.PI) / 180;
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

    // SVG Path arc for zodiac sector
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

    // Símbolo del signo al centro de la tajada
    const midAngle = eclipticToSvgAngle(startDeg + 15);
    const rSymbol = (rOuter + rZodiacInner) / 2;
    const sx = cx + rSymbol * Math.cos(midAngle);
    const sy = cy + rSymbol * Math.sin(midAngle) + 5; // offset vertical para alineación centrada

    zodiacSlicesHtml += `
      <path d="${pathD}" fill="${fillColor}" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
      <text x="${sx}" y="${sy}" font-size="16" fill="#f3f4f6" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${sign.symbol}</text>
    `;
  });

  // 2. Cúspides de Casas (1 a 12)
  let houseLinesHtml = "";
  const houseCoords = {}; // Para guardar posición (x,y) de cada planeta en el centro de aspectos

  (chartData.houseCusps || []).forEach((h) => {
    const deg = getAbsoluteEclipticDegree(h.sign, h.degree);
    const angle = eclipticToSvgAngle(deg);

    const xInner = cx + rHousesInner * Math.cos(angle);
    const yInner = cy + rHousesInner * Math.sin(angle);
    const xOuter = cx + rZodiacInner * Math.cos(angle);
    const yOuter = cy + rZodiacInner * Math.sin(angle);

    const isAngular = h.house === 1 || h.house === 4 || h.house === 7 || h.house === 10;
    const strokeWidth = isAngular ? 2 : 1;
    const strokeColor = isAngular ? "rgba(168, 85, 247, 0.8)" : "rgba(255,255,255,0.25)";

    houseLinesHtml += `
      <line x1="${xInner}" y1="${yInner}" x2="${xOuter}" y2="${yOuter}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />
    `;

    // Número de la casa
    const midAngle = eclipticToSvgAngle(deg + 12);
    const rText = rHousesInner + 15;
    const tx = cx + rText * Math.cos(midAngle);
    const ty = cy + rText * Math.sin(midAngle);

    houseLinesHtml += `
      <text x="${tx}" y="${ty}" font-size="10" fill="rgba(255,255,255,0.4)" text-anchor="middle" dominant-baseline="central">${h.house}</text>
    `;
  });

  // 3. Posiciones Planetarias
  let planetsHtml = "";
  const planetPositionsMap = {};

  (chartData.planets || []).forEach((p) => {
    const cat = PLANETS_CATALOG.find((item) => item.id === p.planetId);
    if (!cat) return;

    const absDeg = getAbsoluteEclipticDegree(p.sign, p.degree);
    const angle = eclipticToSvgAngle(absDeg);

    // Punto en el círculo interno para aspectos
    const pxAspect = cx + rAspects * Math.cos(angle);
    const pyAspect = cy + rAspects * Math.sin(angle);
    planetPositionsMap[p.planetId] = { x: pxAspect, y: pyAspect };

    // Símbolo en la franja de planetas
    const rPlanetRing = (rZodiacInner + rHousesInner) / 2;
    const px = cx + rPlanetRing * Math.cos(angle);
    const py = cy + rPlanetRing * Math.sin(angle) + 4;

    const retroText = p.isRetrograde ? "<sub>R</sub>" : "";

    planetsHtml += `
      <g class="couchPlanetGlyph" title="${esc(cat.name)} en ${esc(p.sign)} ${p.degree}°">
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
        <!-- Círculo exterior e interior -->
        <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" />
        <circle cx="${cx}" cy="${cy}" r="${rZodiacInner}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
        <circle cx="${cx}" cy="${cy}" r="${rHousesInner}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
        <circle cx="${cx}" cy="${cy}" r="${rAspects}" fill="rgba(15, 23, 42, 0.6)" stroke="rgba(255,255,255,0.15)" stroke-width="1" />

        <!-- Slices de Signos -->
        ${zodiacSlicesHtml}

        <!-- Líneas de Casas -->
        ${houseLinesHtml}

        <!-- Aspectos -->
        ${aspectLinesHtml}

        <!-- Planetas -->
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
  // Datos Generales
  const details = chartData.birthDetails || {};

  // Opciones de signos
  const signOptions = ZODIAC_SIGNS.map(
    (s) => `<option value="${s.id}">${s.symbol} ${esc(s.name)}</option>`
  ).join("");

  // Opciones de planetas
  const planetOptions = PLANETS_CATALOG.map(
    (p) => `<option value="${p.id}">${p.symbol} ${esc(p.name)}</option>`
  ).join("");

  // Opciones de aspectos
  const aspectOptions = ASPECT_TYPES.map(
    (a) => `<option value="${a.id}">${a.symbol} ${esc(a.name)} (${a.angle}°)</option>`
  ).join("");

  // Tabla/Lista de planetas agregados
  const planetsListHtml = (chartData.planets || []).map((p, idx) => {
    const cat = PLANETS_CATALOG.find((item) => item.id === p.planetId);
    const sign = ZODIAC_SIGNS.find((s) => s.id === p.sign);
    return `
      <div class="couchDataRow">
        <span class="couchDataLabel">${cat ? `${cat.symbol} ${esc(cat.name)}` : esc(p.planetId)}</span>
        <span class="couchDataVal">${sign ? `${sign.symbol} ${esc(sign.name)}` : esc(p.sign)} ${p.degree}° ${p.isRetrograde ? "(R)" : ""} · Casa ${p.house || "—"}</span>
        <button class="ncIconBtn couchBtnRemove" data-remove-planet-idx="${idx}">✕</button>
      </div>
    `;
  }).join("") || `<div class="ncSideEmpty">No se han registrado planetas.</div>`;

  // Filas de cúspides de las 12 Casas
  const cuspsFormHtml = (chartData.houseCusps || []).map((h) => {
    return `
      <div class="couchCuspRow">
        <span class="couchCuspLabel">Casa ${h.house}:</span>
        <select class="ncSettingsInput couchCuspSign" data-cusp-house="${h.house}">
          ${ZODIAC_SIGNS.map((s) => `<option value="${s.id}" ${s.id === h.sign ? "selected" : ""}>${s.symbol} ${esc(s.name)}</option>`).join("")}
        </select>
        <input type="number" class="ncSettingsInput ncSettingsInputSm couchCuspDeg" data-cusp-house="${h.house}" value="${h.degree || 0}" min="0" max="29" step="1" /> °
      </div>
    `;
  }).join("");

  // Lista de aspectos agregados
  const aspectsListHtml = (chartData.aspects || []).map((asp, idx) => {
    const p1 = PLANETS_CATALOG.find((item) => item.id === asp.planet1Id);
    const p2 = PLANETS_CATALOG.find((item) => item.id === asp.planet2Id);
    const aType = ASPECT_TYPES.find((item) => item.id === asp.aspectId);
    return `
      <div class="couchDataRow">
        <span class="couchDataLabel">${p1 ? p1.symbol : ""} vs ${p2 ? p2.symbol : ""}</span>
        <span class="couchDataVal" style="color: ${aType ? aType.color : "inherit"}">${aType ? `${aType.symbol} ${esc(aType.name)}` : esc(asp.aspectId)}</span>
        <button class="ncIconBtn couchBtnRemove" data-remove-aspect-idx="${idx}">✕</button>
      </div>
    `;
  }).join("") || `<div class="ncSideEmpty">No hay aspectos registrados.</div>`;

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
        <div class="couchAddRow">
          <select id="couchAddPlanetId" class="ncSettingsInput">${planetOptions}</select>
          <select id="couchAddPlanetSign" class="ncSettingsInput">${signOptions}</select>
          <input type="number" id="couchAddPlanetDeg" class="ncSettingsInput ncSettingsInputSm" placeholder="Grado 0-29" min="0" max="29" value="0" />
          <input type="number" id="couchAddPlanetHouse" class="ncSettingsInput ncSettingsInputSm" placeholder="Casa 1-12" min="1" max="12" value="1" />
          <label class="couchRetroLabel"><input type="checkbox" id="couchAddPlanetRetro" /> ℞</label>
          <button class="ncActionBtn ncActionBtnPrimary" id="btnAddPlanet">Agregar</button>
        </div>
        <div class="couchDataList">${planetsListHtml}</div>
      </div>

      <!-- Sección 3: Cúspides de las 12 Casas -->
      <div class="couchFormSection">
        <div class="couchSectionTitle">🏛️ Cúspides de Casas</div>
        <div class="couchCuspsGrid">${cuspsFormHtml}</div>
      </div>

      <!-- Sección 4: Registrar Aspectos -->
      <div class="couchFormSection">
        <div class="couchSectionTitle">📐 Registrar Aspectos entre Planetas</div>
        <div class="couchAddRow">
          <select id="couchAddAspP1" class="ncSettingsInput">${planetOptions}</select>
          <select id="couchAddAspType" class="ncSettingsInput">${aspectOptions}</select>
          <select id="couchAddAspP2" class="ncSettingsInput">${planetOptions}</select>
          <button class="ncActionBtn ncActionBtnPrimary" id="btnAddAspect">Agregar</button>
        </div>
        <div class="couchDataList">${aspectsListHtml}</div>
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

      <!-- Header Couch -->
      <div class="couchHeader">
        <div class="couchHeaderTitle">🛋️ Couch Astro — Carta Natal</div>
        <div class="couchHeaderSub">
          ${chartData.birthDetails.name ? `Carta de: <strong>${esc(chartData.birthDetails.name)}</strong>` : "Sin datos de nacimiento"}
          ${chartData.birthDetails.date ? ` · ${esc(chartData.birthDetails.date)}` : ""}
        </div>
      </div>

      <!-- Contenido de la Sub-Pestaña Activa -->
      <div class="couchBody">${bodyHtml}</div>

      <!-- Barra de Navegación Inferior (Mobile/Desktop Bottom Bar) -->
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

  // Cambios de pestañas inferiores
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
    // 1. Guardado automático de datos generales al escribir
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

    // 2. Agregar Planeta
    root.querySelector("#btnAddPlanet")?.addEventListener("click", () => {
      const planetId = root.querySelector("#couchAddPlanetId")?.value;
      const sign = root.querySelector("#couchAddPlanetSign")?.value;
      const degree = parseFloat(root.querySelector("#couchAddPlanetDeg")?.value) || 0;
      const house = parseInt(root.querySelector("#couchAddPlanetHouse")?.value, 10) || 1;
      const isRetrograde = Boolean(root.querySelector("#couchAddPlanetRetro")?.checked);

      if (!planetId || !sign) return;

      chartData.planets.push({ planetId, sign, degree, house, isRetrograde });
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

    // 3. Editar Cúspides de Casas
    root.querySelectorAll(".couchCuspSign, .couchCuspDeg").forEach((el) => {
      el.addEventListener("change", () => {
        const houseNum = parseInt(el.getAttribute("data-cusp-house"), 10);
        const cuspObj = chartData.houseCusps.find((h) => h.house === houseNum);
        if (cuspObj) {
          const row = el.closest(".couchCuspRow");
          if (row) {
            cuspObj.sign = row.querySelector(".couchCuspSign")?.value || cuspObj.sign;
            cuspObj.degree = parseFloat(row.querySelector(".couchCuspDeg")?.value) || 0;
            saveNatalChartData(chartData);
          }
        }
      });
    });

    // 4. Agregar Aspecto
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
  // Si estamos dentro del flujo NeuroChat, refrescar
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

    .couchAddRow { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
    .couchRetroLabel { font-size: 12px; display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .couchDataList { display: flex; flex-direction: column; gap: 6px; }
    .couchDataRow { display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 8px; font-size: 12px; }
    .couchDataLabel { font-weight: 700; }
    .couchDataVal { opacity: 0.8; }
    .couchBtnRemove { padding: 2px 6px; font-size: 11px; color: #fb7185; border-color: rgba(251,113,133,0.3); }

    .couchCuspsGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
    .couchCuspRow { display: flex; align-items: center; gap: 4px; font-size: 11px; background: rgba(255,255,255,0.03); padding: 4px 6px; border-radius: 6px; }
    .couchCuspLabel { font-weight: 700; min-width: 48px; }
    .couchDangerRow { margin-top: 16px; text-align: center; }

    @media (max-width: 600px) {
      .couchGrid2 { grid-template-columns: 1fr; }
      .couchCuspsGrid { grid-template-columns: 1fr 1fr; }
    }
  </style>`;
}
