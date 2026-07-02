/**
 * MemoryCarl - Tarot Module
 */

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
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getTarotLog() {
  if (!window.state) window.state = {};
  if (!window.state.tarotLog) window.state.tarotLog = [];
  return window.state.tarotLog;
}

export function renderTarotWidget() {
  const log = getTarotLog();
  const todayIso = new Date().toISOString().split('T')[0];
  const todayReadings = log.filter(r => r.dateIso === todayIso);

  return `
    <section class="card homeCard" id="homeTarotCard" style="border-left: 4px solid #a855f7;">
      <div class="djp-sc-header">
        <div class="djp-sc-icon">🔮</div>
        <div class="djp-sc-title-block">
          <div class="djp-sc-title">Tarot Consciente</div>
          <div class="djp-sc-sub">${todayReadings.length} lectura(s) hoy</div>
        </div>
        <button class="djp-sc-add-btn" id="btnTarotStats" style="font-size:16px;" aria-label="Stats">📊</button>
      </div>
      <div class="tarotWidgetBody" style="padding-top: 10px;">
        <p class="muted" style="margin-bottom: 15px; font-size: 13px;">Saca 3 cartas de tu mazo físico, ingresa tu pregunta y Carl te ayudará a interpretarlas.</p>
        <button class="btnPrimary" id="btnNewTarot" style="width:100%; background-color:#9333ea; border:none;">✨ Nueva Lectura</button>
      </div>
    </section>
  `;
}

window.openTarotModal = function() {
  const optionsHtml = TAROT_CARDS.map(c => `<option value="${c.name}">${c.name}</option>`).join("");

  const modalHtml = `
    <div id="tarotModal" class="modalOverlay" style="display:flex; z-index:9999;">
      <div class="modalContent" style="max-width: 500px; background: #18181b; border: 1px solid #3f3f46;">
        <div class="modalHeader" style="border-bottom: 1px solid #3f3f46; padding-bottom:10px; margin-bottom:15px;">
          <h3 style="color:#c084fc;">🔮 Nueva Lectura</h3>
          <button class="closeBtn" onclick="document.getElementById('tarotModal').remove()">×</button>
        </div>
        <div class="modalBody">
          <label style="display:block; margin-bottom:5px; font-weight:bold; font-size:14px; color:#d4d4d8;">Tu pregunta (opcional)</label>
          <textarea id="tarotQuestion" style="width:100%; background:#27272a; color:#fff; border:1px solid #52525b; border-radius:8px; padding:10px; margin-bottom:20px; font-family:inherit; resize:vertical;" placeholder="¿Qué debo tener en cuenta sobre...?" rows="2"></textarea>
          
          <label style="display:block; margin-bottom:10px; font-weight:bold; font-size:14px; color:#d4d4d8;">Cartas extraídas de tu mazo</label>
          <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="width:80px; font-size:12px; color:#a1a1aa; text-align:right;">1. Pasado</span>
              <select id="tarotCard1" style="flex:1; background:#27272a; color:#fff; border:1px solid #52525b; border-radius:6px; padding:8px;"><option value="">-- Selecciona carta --</option>${optionsHtml}</select>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="width:80px; font-size:12px; color:#a1a1aa; text-align:right;">2. Presente</span>
              <select id="tarotCard2" style="flex:1; background:#27272a; color:#fff; border:1px solid #52525b; border-radius:6px; padding:8px;"><option value="">-- Selecciona carta --</option>${optionsHtml}</select>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="width:80px; font-size:12px; color:#a1a1aa; text-align:right;">3. Futuro</span>
              <select id="tarotCard3" style="flex:1; background:#27272a; color:#fff; border:1px solid #52525b; border-radius:6px; padding:8px;"><option value="">-- Selecciona carta --</option>${optionsHtml}</select>
            </div>
          </div>
          
          <div id="tarotLoading" style="display:none; text-align:center; padding: 20px;">
            <div style="color:#c084fc; font-weight:bold; margin-bottom:10px; font-size:18px;">✨</div>
            <div style="color:#a1a1aa; font-size:14px;">Carl está interpretando los arcanos...</div>
          </div>
          
          <div id="tarotResult" style="display:none; background:#27272a; border-radius:8px; padding:15px; border: 1px solid #3f3f46; margin-bottom:15px;"></div>
          
          <button id="btnInterpretTarot" class="btnPrimary" style="width:100%; background-color:#9333ea; border:none; padding:12px;">Interpretar con Carl</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  document.getElementById("btnInterpretTarot").addEventListener("click", async () => {
    const q = document.getElementById("tarotQuestion").value.trim();
    const c1 = document.getElementById("tarotCard1").value;
    const c2 = document.getElementById("tarotCard2").value;
    const c3 = document.getElementById("tarotCard3").value;

    if (!c1 || !c2 || !c3) {
      alert("Por favor selecciona las 3 cartas que sacaste de tu mazo.");
      return;
    }

    const btn = document.getElementById("btnInterpretTarot");
    const loading = document.getElementById("tarotLoading");
    const resultDiv = document.getElementById("tarotResult");
    
    btn.style.display = "none";
    loading.style.display = "block";
    resultDiv.style.display = "none";

    try {
      const systemPrompt = `Eres Carl, la inteligencia personal del usuario. Actúa como un lector de tarot analítico y psicológico. 
El usuario ha sacado 3 cartas de su mazo físico.
Instrucciones:
1. Analiza las cartas sacadas y cómo se relacionan entre sí en posiciones de Pasado, Presente y Futuro/Resultado.
2. Relaciona la lectura con la pregunta del usuario. Si no hay pregunta, haz una lectura general.
3. Termina con un consejo práctico breve.
4. Usa un tono reflexivo, profundo y empático. Escribe en Markdown de forma limpia y organizada.`;

      const userPrompt = `Mis cartas son:
1. ${c1} (Pasado/Base)
2. ${c2} (Presente/Acción)
3. ${c3} (Futuro/Resultado)

Mi pregunta/tema es: ${q || "Lectura general"}`;

      const ollamaUrl = localStorage.getItem("memorycarl_ollama_url") || "http://127.0.0.1:11434";
      const ollamaModel = localStorage.getItem("memorycarl_ollama_model") || "llama3";
      
      const ollamaRes = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          stream: false
        })
      });

      if (!ollamaRes.ok) throw new Error("No se pudo conectar a Ollama localmente. Verifica que la aplicación de Ollama esté abierta y corriendo.");
      
      const ollamaData = await ollamaRes.json();
      const interpretation = ollamaData.message.content;

      // Save reading
      const log = getTarotLog();
      const now = new Date();
      const reading = {
        id: "tarot_" + Date.now(),
        dateIso: now.toISOString().split('T')[0],
        timestamp: now.getTime(),
        question: q,
        cards: [c1, c2, c3],
        interpretation
      };
      log.push(reading);
      if (window.persist) window.persist();
      
      // Attempt to refresh the home widget stats if we are on the home tab
      if (window.renderApp) setTimeout(window.renderApp, 100);

      const htmlContent = (window.marked && window.marked.parse) 
        ? window.marked.parse(interpretation) 
        : escapeHtml(interpretation).replace(/\n/g, '<br>');

      loading.style.display = "none";
      resultDiv.style.display = "block";
      resultDiv.innerHTML = `
        <div style="text-align:center; margin-bottom:15px; font-size:13px; color:#c084fc;">
          <span style="background:rgba(192,132,252,0.1); padding:4px 8px; border-radius:12px; margin:0 4px;">${c1}</span>
          <span style="background:rgba(192,132,252,0.1); padding:4px 8px; border-radius:12px; margin:0 4px;">${c2}</span>
          <span style="background:rgba(192,132,252,0.1); padding:4px 8px; border-radius:12px; margin:0 4px;">${c3}</span>
        </div>
        <div class="ncMsgBubble--md" style="font-size:14px; line-height:1.5;">
          ${htmlContent}
        </div>
      `;
      btn.style.display = "block";
      btn.textContent = "Cerrar Lectura";
      btn.onclick = () => { document.getElementById('tarotModal').remove(); };

    } catch (e) {
      loading.style.display = "none";
      btn.style.display = "block";
      alert("Error: " + e.message);
    }
  });
};

window.openTarotStatsModal = function() {
  const log = getTarotLog();
  
  if (log.length === 0) {
    alert("Aún no tienes lecturas de Tarot registradas.");
    return;
  }

  const cardCounts = {};
  log.forEach(r => {
    (r.cards||[]).forEach(c => {
      cardCounts[c] = (cardCounts[c] || 0) + 1;
    });
  });
  
  const sortedCards = Object.entries(cardCounts).sort((a,b) => b[1] - a[1]).slice(0, 8);
  
  const historyHtml = log.slice(-15).reverse().map(r => `
    <div style="background: #27272a; padding: 12px; border-radius: 8px; margin-bottom: 12px; border:1px solid #3f3f46;">
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <div style="font-size: 12px; color: #a1a1aa;">${new Date(r.timestamp).toLocaleString()}</div>
      </div>
      <div style="font-weight: bold; margin-bottom: 8px; font-size:14px;">${escapeHtml(r.question || "Lectura general")}</div>
      <div style="color: #c084fc; font-size: 13px; margin-bottom: 10px;">${(r.cards||[]).join(" • ")}</div>
      <details style="font-size:13px; color:#d4d4d8;">
        <summary style="cursor:pointer; outline:none; color:#a1a1aa;">Ver interpretación</summary>
        <div style="margin-top:10px; line-height:1.5;">
          ${(window.marked && window.marked.parse) ? window.marked.parse(r.interpretation||'') : escapeHtml(r.interpretation||'').replace(/\n/g, '<br>')}
        </div>
      </details>
    </div>
  `).join("");

  const statsHtml = `
    <div id="tarotStatsModal" class="modalOverlay" style="display:flex; z-index:9999;">
      <div class="modalContent" style="max-width: 550px; background: #18181b; border: 1px solid #3f3f46; max-height: 90vh; overflow-y:auto;">
        <div class="modalHeader" style="border-bottom: 1px solid #3f3f46; padding-bottom:10px; margin-bottom:15px;">
          <h3 style="color:#c084fc;">📊 Estadísticas de Tarot</h3>
          <button class="closeBtn" onclick="document.getElementById('tarotStatsModal').remove()">×</button>
        </div>
        <div class="modalBody">
          <h4 style="margin-bottom:10px; color:#e4e4e7;">Tus cartas más frecuentes</h4>
          <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom: 25px;">
            ${sortedCards.map(c => `<div style="background:#27272a; border:1px solid #52525b; padding:6px 12px; border-radius:16px; font-size:13px;">${c[0]} <span style="color:#4ade80; font-weight:bold; margin-left:4px;">x${c[1]}</span></div>`).join("")}
          </div>
          
          <h4 style="margin-bottom:10px; color:#e4e4e7;">Historial Reciente (Últimas 15)</h4>
          <div>
            ${historyHtml}
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', statsHtml);
};
