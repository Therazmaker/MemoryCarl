/**
 * MemoryCarl - Tarot Module (Vista de página completa)
 */
import { getOllamaSettings, isOllamaConfigured } from "../services/ollamaClient.js";

const MAJOR_ARCANA = [
  "El Loco", "El Mago", "La Sacerdotisa", "La Emperatriz", "El Emperador",
  "El Sumo Sacerdote", "Los Enamorados", "El Carro", "La Fuerza", "El Ermitaño",
  "La Rueda de la Fortuna", "La Justicia", "El Colgado", "La Muerte", "La Templanza",
  "El Diablo", "La Torre", "La Estrella", "La Luna", "El Sol",
  "El Juicio", "El Mundo"
];

const SUITS = ["Copas", "Oros", "Espadas", "Bastos"];
const RANKS = ["As", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Sota", "Caballo", "Reina", "Rey"];

export const TAROT_CARDS = [
  ...MAJOR_ARCANA.map((name, i) => ({ id: `major_${i}`, name, type: 'major' })),
  ...SUITS.flatMap(suit => RANKS.map(rank => ({
    id: `minor_${suit.toLowerCase()}_${rank.toLowerCase()}`,
    name: `${rank} de ${suit}`,
    type: 'minor'
  })))
];

function escapeHtml(unsafe) {
  return (unsafe || "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function getTarotLog() {
  if (!window.state) window.state = {};
  if (!window.state.tarotLog) {
    window.state.tarotLog = [];
    try {
      const stored = localStorage.getItem("memorycarl_v2_tarot_log");
      if (stored) window.state.tarotLog = JSON.parse(stored);
    } catch(e) {}
  }
  return window.state.tarotLog;
}

// ─── WIDGET para la pantalla Home ───────────────────────────────────────────
export function renderTarotWidget() {
  const log = getTarotLog();
  const todayIso = new Date().toISOString().split('T')[0];
  const todayReadings = log.filter(r => r.dateIso === todayIso);

  return `
    <section class="card homeCard" id="homeTarotCard" style="border-left: 4px solid #a855f7; cursor:pointer;">
      <div class="djp-sc-header">
        <div class="djp-sc-icon">🔮</div>
        <div class="djp-sc-title-block">
          <div class="djp-sc-title">Tarot Consciente</div>
          <div class="djp-sc-sub">${todayReadings.length} lectura(s) hoy</div>
        </div>
        <span style="color:#a855f7; font-size:20px;">›</span>
      </div>
      <div style="padding-top: 10px;">
        <p class="muted" style="margin-bottom: 0; font-size: 13px;">Toca para abrir tu diario de tarot.</p>
      </div>
    </section>
  `;
}

// ─── VISTA COMPLETA DE TAROT ─────────────────────────────────────────────────
let tarotViewState = { screen: 'main' }; // 'main' | 'new' | 'reading' | 'stats'

export function viewTarot() {
  const log = getTarotLog();
  const todayIso = new Date().toISOString().split('T')[0];
  const todayReadings = log.filter(r => r.dateIso === todayIso);
  const optionsHtml = TAROT_CARDS.map(c => `<option value="${c.name}">${c.name}</option>`).join("");

  // ── PANTALLA: NUEVA LECTURA ──
  if (tarotViewState.screen === 'new') {
    return `
      <div class="tarotPage">
        <div class="tarotPageHeader">
          <button class="tarotBackBtn" id="btnTarotBack">← Volver</button>
          <h2 class="tarotPageTitle">✨ Nueva Lectura</h2>
          <div></div>
        </div>
        <div class="tarotPageBody">
          <div id="tarotInputsContainer" class="tarotForm">
            <label class="tarotLabel">Tu pregunta o tema (opcional)</label>
            <textarea id="tarotQuestion" class="tarotTextarea" placeholder="¿Qué debo tener en cuenta sobre...?" rows="3"></textarea>

            <label class="tarotLabel" style="margin-top:20px;">Cartas extraídas de tu mazo</label>

            <div class="tarotCardRow">
              <div class="tarotCardSlot">
                <div class="tarotCardLabel">Pasado</div>
                <select id="tarotCard1" class="tarotSelect"><option value="">-- Carta --</option>${optionsHtml}</select>
              </div>
              <div class="tarotCardSlot">
                <div class="tarotCardLabel">Presente</div>
                <select id="tarotCard2" class="tarotSelect"><option value="">-- Carta --</option>${optionsHtml}</select>
              </div>
              <div class="tarotCardSlot">
                <div class="tarotCardLabel">Futuro</div>
                <select id="tarotCard3" class="tarotSelect"><option value="">-- Carta --</option>${optionsHtml}</select>
              </div>
            </div>

            <button id="btnInterpretTarot" class="tarotMainBtn" style="margin-top:30px;">
              🔮 Interpretar con Carl
            </button>
          </div>

          <div id="tarotLoading" style="display:none; text-align:center; padding: 60px 20px;">
            <div style="font-size:48px; margin-bottom:16px; animation: pulse 1.5s infinite;">🔮</div>
            <div style="color:#c084fc; font-size:16px; font-weight:600;">Carl está leyendo los arcanos...</div>
            <div style="color:#71717a; font-size:13px; margin-top:8px;">Esto puede tardar unos segundos</div>
          </div>

          <div id="tarotResult" style="display:none;">
          </div>
        </div>
      </div>
    `;
  }

  // ── PANTALLA: ESTADÍSTICAS ──
  if (tarotViewState.screen === 'stats') {
    const cardCounts = {};
    log.forEach(r => { (r.cards||[]).forEach(c => { cardCounts[c] = (cardCounts[c] || 0) + 1; }); });
    const sortedCards = Object.entries(cardCounts).sort((a,b) => b[1]-a[1]).slice(0, 10);

    const historyHtml = log.length === 0
      ? `<div class="tarotEmpty">Aún no tienes lecturas registradas.</div>`
      : log.slice().reverse().map(r => `
        <div class="tarotHistoryCard">
          <div class="tarotHistoryMeta">
            <span>${new Date(r.timestamp).toLocaleDateString('es', {weekday:'short', day:'numeric', month:'short'})}</span>
            <span style="color:#71717a; font-size:11px;">${new Date(r.timestamp).toLocaleTimeString('es', {hour:'2-digit', minute:'2-digit'})}</span>
          </div>
          <div class="tarotHistoryQuestion">${escapeHtml(r.question || "Lectura general")}</div>
          <div class="tarotHistoryCards">${(r.cards||[]).join(" · ")}</div>
          <details class="tarotHistoryDetails">
            <summary>Ver interpretación ›</summary>
            <div class="tarotHistoryText">
              ${(window.marked && window.marked.parse) ? window.marked.parse(r.interpretation||'') : escapeHtml(r.interpretation||'').replace(/\n/g, '<br>')}
            </div>
          </details>
        </div>
      `).join("");

    return `
      <div class="tarotPage">
        <div class="tarotPageHeader">
          <button class="tarotBackBtn" id="btnTarotBack">← Volver</button>
          <h2 class="tarotPageTitle">📊 Mi Tarot</h2>
          <div></div>
        </div>
        <div class="tarotPageBody">
          ${sortedCards.length > 0 ? `
            <div class="tarotSection">
              <div class="tarotSectionTitle">Cartas más frecuentes</div>
              <div class="tarotFreqGrid">
                ${sortedCards.map(([name, count]) => `
                  <div class="tarotFreqChip">
                    <span class="tarotFreqName">${name}</span>
                    <span class="tarotFreqCount">×${count}</span>
                  </div>
                `).join("")}
              </div>
            </div>
          ` : ''}

          <div class="tarotSection">
            <div class="tarotSectionTitle">Historial completo (${log.length} lectura${log.length !== 1 ? 's' : ''})</div>
            ${historyHtml}
          </div>
        </div>
      </div>
    `;
  }

  // ── PANTALLA PRINCIPAL ──
  const recentReadings = log.slice(-3).reverse();
  return `
    <div class="tarotPage">
      <div class="tarotPageHeader" style="justify-content:center;">
        <h2 class="tarotPageTitle" style="text-align:center;">🔮 Tarot Consciente</h2>
      </div>
      <div class="tarotPageBody">
        <div class="tarotHero">
          <div class="tarotHeroIcon">🔮</div>
          <p class="tarotHeroText">Saca 3 cartas de tu mazo físico.<br>Carl las interpreta con tu contexto personal.</p>
          <div class="tarotHeroSub">${todayReadings.length} lectura(s) hoy</div>
        </div>

        <button class="tarotMainBtn" id="btnGoNewReading">✨ Nueva Lectura</button>

        ${recentReadings.length > 0 ? `
          <div class="tarotSection" style="margin-top:30px;">
            <div class="tarotSectionTitle">
              Recientes
              <button class="tarotLinkBtn" id="btnGoStats">Ver todo ›</button>
            </div>
            ${recentReadings.map(r => `
              <div class="tarotHistoryCard tarotHistoryCardSmall">
                <div class="tarotHistoryMeta">
                  <span>${new Date(r.timestamp).toLocaleDateString('es', {weekday:'short', day:'numeric', month:'short'})}</span>
                </div>
                <div class="tarotHistoryQuestion">${escapeHtml(r.question || "Lectura general")}</div>
                <div class="tarotHistoryCards">${(r.cards||[]).join(" · ")}</div>
              </div>
            `).join("")}
          </div>
        ` : `
          <div class="tarotEmpty" style="margin-top:30px;">
            Aún no has hecho ninguna lectura. ¡Prueba con tu primera tirada!
          </div>
        `}
      </div>
    </div>
  `;
}

// ─── WIRING: event listeners de la vista ────────────────────────────────────
export function wireTarot(root) {
  // Navegar a nueva lectura
  root.querySelector('#btnGoNewReading')?.addEventListener('click', () => {
    tarotViewState.screen = 'new';
    if (window.renderApp) window.renderApp();
  });

  // Navegar a estadísticas
  root.querySelector('#btnGoStats')?.addEventListener('click', () => {
    tarotViewState.screen = 'stats';
    if (window.renderApp) window.renderApp();
  });

  // Volver
  root.querySelector('#btnTarotBack')?.addEventListener('click', () => {
    tarotViewState.screen = 'main';
    if (window.renderApp) window.renderApp();
  });

  // Interpretar
  root.querySelector('#btnInterpretTarot')?.addEventListener('click', async () => {
    const q = root.querySelector('#tarotQuestion')?.value.trim() || '';
    const c1 = root.querySelector('#tarotCard1')?.value;
    const c2 = root.querySelector('#tarotCard2')?.value;
    const c3 = root.querySelector('#tarotCard3')?.value;

    if (!c1 || !c2 || !c3) {
      alert("Por favor selecciona las 3 cartas que sacaste de tu mazo.");
      return;
    }

    const inputsEl = root.querySelector('#tarotInputsContainer');
    const loadingEl = root.querySelector('#tarotLoading');
    const resultEl = root.querySelector('#tarotResult');
    const btn = root.querySelector('#btnInterpretTarot');

    inputsEl.style.display = 'none';
    btn.style.display = 'none';
    loadingEl.style.display = 'block';
    resultEl.style.display = 'none';

    try {
      const systemPrompt = `Actúa como un lector de Tarot intuitivo y empático. Tu objetivo es interpretar una tirada de 3 cartas (Pasado, Presente, Futuro) basándote en la tradición del Tarot Rider-Waite.

Reglas de interpretación:
1. Contexto: Analiza cómo interactúan las tres cartas entre sí. No las leas como eventos aislados, sino como una narrativa fluida. Relaciona la lectura con la pregunta del usuario. Si no hay pregunta, haz una lectura general.
2. Tono: Mantén un tono místico, reflexivo y de apoyo. Evita ser fatalista; el Tarot es una herramienta de introspección, no de adivinación absoluta.
3. Estructura de respuesta:
   - Introducción: Una frase breve sobre la energía general de la tirada.
   - Análisis detallado:
     • Carta 1 (Pasado/Raíz): Lo que influye desde atrás.
     • Carta 2 (Presente/Desafío): El estado actual o el obstáculo a resolver.
     • Carta 3 (Futuro/Potencial): Hacia dónde apunta la energía si se mantienen las acciones actuales.
   - Síntesis final: Un consejo práctico o una pregunta reflexiva para que el usuario medite.
4. Limitación: Si una carta aparece invertida, interprétala como un bloqueo o una energía que necesita ser canalizada de forma diferente, no como algo 'malo'. Escribe en Markdown de forma limpia.
No incluyas ningún bloque JSON de neuronas al final, solo la lectura.`;

      const userPrompt = `Mis cartas son:
1. ${c1} (Pasado/Base)
2. ${c2} (Presente/Acción)
3. ${c3} (Futuro/Resultado)

Mi pregunta/tema es: ${q || "Lectura general"}`;

      // Usar los mismos settings de Ollama Cloud que usa el NeuroChat
      if (!isOllamaConfigured()) throw new Error("Ollama Cloud no está configurado. Ve a Configuración ⚙️ > Ollama Cloud y activa tu API key.");

      const settings = getOllamaSettings();
      const baseUrl = (settings.baseUrl || "https://ollama.com").replace(/\/+$/, "");
      const url = `${baseUrl}/api/chat`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), settings.timeoutMs || 60000);

      const ollamaRes = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.model || "gpt-oss:120b",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          stream: false,
          options: { temperature: 0.8, num_predict: 1500 }
        }),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!ollamaRes.ok) {
        let errMsg = `HTTP ${ollamaRes.status}`;
        try { const d = await ollamaRes.json(); errMsg = d?.error || errMsg; } catch(_e) {}
        throw new Error(`Error de Ollama Cloud: ${errMsg}`);
      }
      const ollamaData = await ollamaRes.json();
      const interpretation = ollamaData.message?.content || ollamaData.choices?.[0]?.message?.content || "";
      if (!interpretation) throw new Error("Ollama no devolvió contenido. Intenta de nuevo.");

      // Guardar
      const log = getTarotLog();
      const now = new Date();
      log.push({ id: "tarot_" + Date.now(), dateIso: now.toISOString().split('T')[0], timestamp: now.getTime(), question: q, cards: [c1, c2, c3], interpretation });
      
      try {
        localStorage.setItem("memorycarl_v2_tarot_log", JSON.stringify(log));
      } catch(e) { console.error("Error saving tarot log", e); }

      if (window.persist) window.persist();

      const htmlContent = (window.marked && window.marked.parse)
        ? window.marked.parse(interpretation)
        : escapeHtml(interpretation).replace(/\n/g, '<br>');

      loadingEl.style.display = 'none';
      resultEl.style.display = 'block';
      resultEl.innerHTML = `
        <div class="tarotResultCards">
          <div class="tarotResultCard"><div class="tarotResultCardPos">Pasado</div><div class="tarotResultCardName">${c1}</div></div>
          <div class="tarotResultCard"><div class="tarotResultCardPos">Presente</div><div class="tarotResultCardName">${c2}</div></div>
          <div class="tarotResultCard"><div class="tarotResultCardPos">Futuro</div><div class="tarotResultCardName">${c3}</div></div>
        </div>
        <div class="tarotResultText">${htmlContent}</div>
        <button class="tarotMainBtn" id="btnBackFromResult" style="margin-top:20px; background:#27272a; border: 1px solid #3f3f46;">← Nueva lectura</button>
      `;
      root.querySelector('#btnBackFromResult')?.addEventListener('click', () => {
        tarotViewState.screen = 'main';
        if (window.renderApp) window.renderApp();
      });

    } catch (e) {
      loadingEl.style.display = 'none';
      inputsEl.style.display = 'block';
      btn.style.display = 'block';
      alert("Error: " + e.message);
    }
  });
}

// ─── CSS inyectado dinámicamente ─────────────────────────────────────────────
export function injectTarotStyles() {
  if (document.getElementById('tarot-styles')) return;
  const style = document.createElement('style');
  style.id = 'tarot-styles';
  style.textContent = `
    .tarotPage {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg, #0f0f17);
    }
    .tarotPageHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 1px solid rgba(168,85,247,0.15);
      flex-shrink: 0;
    }
    .tarotPageTitle {
      font-size: 18px;
      font-weight: 700;
      color: #c084fc;
      margin: 0;
    }
    .tarotBackBtn {
      background: none;
      border: none;
      color: #a1a1aa;
      font-size: 14px;
      cursor: pointer;
      padding: 4px 0;
    }
    .tarotPageBody {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px 100px;
    }
    .tarotHero {
      text-align: center;
      padding: 30px 0 20px;
    }
    .tarotHeroIcon { font-size: 56px; margin-bottom: 12px; }
    .tarotHeroText { color: #a1a1aa; font-size: 15px; line-height: 1.5; margin: 0 0 8px; }
    .tarotHeroSub { color: #c084fc; font-size: 13px; font-weight: 600; }
    .tarotMainBtn {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #7c3aed, #a855f7);
      color: #fff;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: 0.3px;
    }
    .tarotForm { display: flex; flex-direction: column; }
    .tarotLabel {
      font-size: 13px;
      font-weight: 600;
      color: #d4d4d8;
      margin-bottom: 8px;
      display: block;
    }
    .tarotTextarea {
      width: 100%;
      background: #1c1c27;
      color: #fff;
      border: 1px solid #3f3f46;
      border-radius: 10px;
      padding: 12px;
      font-family: inherit;
      font-size: 15px;
      resize: none;
      box-sizing: border-box;
    }
    .tarotCardRow {
      display: flex;
      gap: 10px;
      margin-top: 4px;
    }
    .tarotCardSlot { flex: 1; display: flex; flex-direction: column; gap: 6px; }
    .tarotCardLabel {
      font-size: 11px;
      text-transform: uppercase;
      color: #a855f7;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .tarotSelect {
      background: #1c1c27;
      color: #fff;
      border: 1px solid #3f3f46;
      border-radius: 8px;
      padding: 8px 6px;
      font-size: 13px;
      width: 100%;
    }
    .tarotSection { margin-bottom: 24px; }
    .tarotSectionTitle {
      font-size: 13px;
      font-weight: 700;
      color: #71717a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .tarotLinkBtn {
      background: none;
      border: none;
      color: #a855f7;
      font-size: 13px;
      cursor: pointer;
    }
    .tarotHistoryCard {
      background: #1c1c27;
      border: 1px solid #2d2d3d;
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 10px;
    }
    .tarotHistoryMeta { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px; color: #71717a; }
    .tarotHistoryQuestion { font-weight: 600; font-size: 14px; margin-bottom: 6px; color: #e4e4e7; }
    .tarotHistoryCards { color: #c084fc; font-size: 13px; margin-bottom: 8px; }
    .tarotHistoryDetails summary { color: #71717a; font-size: 13px; cursor: pointer; }
    .tarotHistoryText { margin-top: 10px; font-size: 14px; line-height: 1.6; color: #d4d4d8; }
    .tarotFreqGrid { display: flex; flex-wrap: wrap; gap: 8px; }
    .tarotFreqChip {
      background: #1c1c27;
      border: 1px solid #3f3f46;
      border-radius: 20px;
      padding: 5px 12px;
      font-size: 13px;
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .tarotFreqName { color: #e4e4e7; }
    .tarotFreqCount { color: #4ade80; font-weight: 700; }
    .tarotEmpty { color: #71717a; font-size: 14px; text-align: center; padding: 20px 0; }
    .tarotResultCards {
      display: flex;
      gap: 10px;
      margin-bottom: 24px;
      justify-content: center;
    }
    .tarotResultCard {
      flex: 1;
      background: rgba(168,85,247,0.1);
      border: 1px solid rgba(168,85,247,0.3);
      border-radius: 10px;
      padding: 10px 8px;
      text-align: center;
    }
    .tarotResultCardPos { font-size: 10px; text-transform: uppercase; color: #a855f7; font-weight: 700; margin-bottom: 4px; }
    .tarotResultCardName { font-size: 13px; font-weight: 600; color: #f0e6ff; }
    .tarotResultText { font-size: 15px; line-height: 1.7; color: #e4e4e7; }
    @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.1); opacity: 0.8; } }
  `;
  document.head.appendChild(style);
}
