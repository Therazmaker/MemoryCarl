/**
 * neuroprobe-ui.js — Componente visual del NeuroProbe
 *
 * Muestra la pregunta del probe como una "burbuja" sutil debajo del chat,
 * con un campo de respuesta inline. No interrumpe el flujo del NeuroChat.
 *
 * Uso en neurochat-ui.js:
 *
 *   import { NeuroProbeUI } from "./neuroprobe-ui.js";
 *   const probeUI = new NeuroProbeUI({ container: document.querySelector("#probe-area") });
 *
 *   // Llamar después de cada mensaje del chat:
 *   probeUI.update(neuroCoreResult);
 *
 *   // O activar manualmente:
 *   probeUI.prompt();
 */

import { neuroProbe, PROBE_QUESTION_TYPES } from "./neuroprobe.js";

// Etiquetas de tipo para mostrar en la UI
const TYPE_LABELS = {
  [PROBE_QUESTION_TYPES.GAP]:      { label: "Gap detectado",       color: "#D85A30", bg: "#FAECE7" },
  [PROBE_QUESTION_TYPES.BRIDGE]:   { label: "Puente posible",      color: "#0F6E56", bg: "#E1F5EE" },
  [PROBE_QUESTION_TYPES.DEPTH]:    { label: "Profundidad",         color: "#3C3489", bg: "#EEEDFE" },
  [PROBE_QUESTION_TYPES.TEMPORAL]: { label: "Refuerzo temporal",   color: "#854F0B", bg: "#FAEEDA" },
  [PROBE_QUESTION_TYPES.GENESIS]:  { label: "Nueva neurona",       color: "#185FA5", bg: "#E6F1FB" },
};

// CSS que se inyecta una sola vez en el documento
const PROBE_CSS = `
.neuroprobe-bubble {
  margin: 8px 0 12px 0;
  border-radius: 12px;
  border: 1px solid #e0deff;
  background: #f9f8ff;
  overflow: hidden;
  transition: opacity 0.3s ease, transform 0.3s ease;
  transform-origin: top;
}
.dark .neuroprobe-bubble {
  border-color: #3C3489;
  background: #16152b;
}
.neuroprobe-bubble.entering {
  opacity: 0;
  transform: scaleY(0.92);
}
.neuroprobe-bubble.visible {
  opacity: 1;
  transform: scaleY(1);
}
.neuroprobe-bubble.exiting {
  opacity: 0;
  transform: scaleY(0.92);
}
.neuroprobe-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 6px;
}
.neuroprobe-orb {
  width: 20px; height: 20px;
  border-radius: 50%;
  background: #EEEDFE;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.neuroprobe-orb-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: #7F77DD;
  animation: probe-pulse 2s ease-in-out infinite;
}
@keyframes probe-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.6; }
}
.neuroprobe-name {
  font-size: 11px;
  font-weight: 500;
  color: #7F77DD;
  letter-spacing: 0.04em;
}
.neuroprobe-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 500;
  margin-left: auto;
}
.neuroprobe-dismiss {
  width: 20px; height: 20px;
  border-radius: 50%;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: #888;
  font-size: 14px;
  padding: 0;
  line-height: 1;
  transition: background 0.15s;
}
.neuroprobe-dismiss:hover { background: rgba(0,0,0,0.06); }
.neuroprobe-question {
  padding: 4px 14px 10px;
  font-size: 13.5px;
  line-height: 1.6;
  color: #2C2C2A;
}
.dark .neuroprobe-question { color: #c2c0b6; }
.neuroprobe-input-row {
  padding: 0 10px 10px;
  display: flex;
  gap: 6px;
  align-items: flex-end;
}
.neuroprobe-textarea {
  flex: 1;
  height: 38px;
  min-height: 38px;
  max-height: 120px;
  box-sizing: border-box;
  resize: none;
  border-radius: 8px;
  border: 1px solid #d1cef5;
  background: white;
  padding: 8px 10px;
  font-size: 16px;
  font-family: inherit;
  line-height: 1.4;
  color: #2C2C2A;
  outline: none;
  overflow-y: auto;
}
.dark .neuroprobe-textarea {
  background: #1e1d38;
  border-color: #3C3489;
  color: #e0deff;
}
.neuroprobe-textarea:focus {
  border-color: #7F77DD;
  box-shadow: 0 0 0 2px #EEEDFE;
}
.neuroprobe-send {
  width: 32px; height: 32px;
  border-radius: 8px;
  border: none;
  background: #7F77DD;
  color: white;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
  font-size: 14px;
}
.neuroprobe-send:hover { background: #534AB7; }
.neuroprobe-send:disabled { background: #c5c2ef; cursor: not-allowed; }
.neuroprobe-result {
  padding: 8px 14px 12px;
  font-size: 12px;
  color: #534AB7;
  border-top: 1px solid #e0deff;
  line-height: 1.6;
}
.dark .neuroprobe-result { color: #AFA9EC; border-color: #3C3489; }
.neuroprobe-neurons-created {
  margin-top: 6px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.neuroprobe-neuron-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #EEEDFE;
  color: #3C3489;
  border: 1px solid #d1cef5;
}
.neuroprobe-draft-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.neuroprobe-btn-accept {
  flex: 1;
  background: #7F77DD;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.neuroprobe-btn-accept:hover { background: #534AB7; }
.neuroprobe-btn-reject {
  flex: 1;
  background: transparent;
  color: #888;
  border: 1px solid #ccc;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.neuroprobe-btn-reject:hover { background: rgba(0,0,0,0.05); }
.dark .neuroprobe-btn-reject { border-color: #555; color: #aaa; }
`;

function injectCSS() {
  if (document.getElementById("neuroprobe-styles")) return;
  const style = document.createElement("style");
  style.id = "neuroprobe-styles";
  style.textContent = PROBE_CSS;
  document.head.appendChild(style);
}

export class NeuroProbeUI {
  constructor({ container, onAnswer } = {}) {
    injectCSS();
    this._container = container || this._createDefaultContainer();
    this._onAnswer = onAnswer || null;
    this._bubble = null;
    this._textarea = null;
    this._resultDiv = null;
  }

  _createDefaultContainer() {
    // Si no se pasa un contenedor, crear uno flotante al final del chat
    const div = document.createElement("div");
    div.id = "neuroprobe-container";
    div.style.cssText = "margin: 0 auto; max-width: 720px; padding: 0 16px;";
    document.body.appendChild(div);
    return div;
  }

  /**
   * Llama a esto después de cada sendMessage() para que el probe observe
   * y decida si mostrar una pregunta.
   */
  update(neuroCoreResult) {
    neuroProbe.observe({
      activated: neuroCoreResult?.activated || [],
      generated: neuroCoreResult?.generated || [],
      userInput: neuroCoreResult?.userInput || "",
    });

    const question = neuroProbe.getPendingQuestion();
    if (question && !this._bubble) {
      // Pequeño delay para no interrumpir la respuesta del chat
      setTimeout(() => this._showQuestion(question), 1200);
    }
  }

  /**
   * Muestra una pregunta que ya fue generada externamente (por neuroprobe.observe()).
   * Llamado desde neurochat-ui.js cuando result.probeQuestion viene definido.
   */
  showFromExternal(question) {
    if (!question || this._bubble) return;
    setTimeout(() => this._showQuestion(question), 1200);
  }

  /**
   * Fuerza mostrar una pregunta ahora.
   */
  prompt(type = null) {
    let question;
    if (type) {
      question = neuroProbe.requestQuestionOfType(type);
    } else {
      question = neuroProbe.forceQuestion();
    }
    if (question) this._showQuestion(question);
    return question;
  }

  _showQuestion(question) {
    if (this._bubble) this._removeBubble();

    const typeInfo = TYPE_LABELS[question.type] || TYPE_LABELS[PROBE_QUESTION_TYPES.GAP];

    const bubble = document.createElement("div");
    bubble.className = "neuroprobe-bubble entering";
    bubble.innerHTML = `
      <div class="neuroprobe-header">
        <div class="neuroprobe-orb"><div class="neuroprobe-orb-dot"></div></div>
        <span class="neuroprobe-name">NeuroProbe</span>
        <span class="neuroprobe-badge" style="background:${typeInfo.bg};color:${typeInfo.color}">${typeInfo.label}</span>
        <button class="neuroprobe-dismiss" title="Omitir">×</button>
      </div>
      <div class="neuroprobe-question">${question.text}</div>
      <div class="neuroprobe-input-row">
        <textarea class="neuroprobe-textarea" placeholder="Escribe aquí..." rows="1"></textarea>
        <button class="neuroprobe-send" title="Enviar">→</button>
      </div>
    `;

    // Eventos
    bubble.querySelector(".neuroprobe-dismiss").addEventListener("click", () => {
      neuroProbe.dismiss();
      this._removeBubble();
    });

    const textarea = bubble.querySelector(".neuroprobe-textarea");
    const sendBtn  = bubble.querySelector(".neuroprobe-send");

    // Auto-resize
    textarea.addEventListener("input", () => {
      textarea.style.height = "38px";
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
    });

    // Enter para enviar (Shift+Enter = nueva línea)
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this._sendAnswer(textarea.value, sendBtn, bubble);
      }
    });

    sendBtn.addEventListener("click", () => {
      this._sendAnswer(textarea.value, sendBtn, bubble);
    });

    this._container.appendChild(bubble);
    this._bubble = bubble;
    this._textarea = textarea;

    // Animación de entrada
    requestAnimationFrame(() => {
      bubble.classList.remove("entering");
      bubble.classList.add("visible");
    });
  }

  async _sendAnswer(text, sendBtn, bubble) {
    if (!text.trim()) return;

    sendBtn.disabled = true;
    this._textarea.disabled = true;

    try {
      const result = await neuroProbe.processAnswer(text);

      if (result.socraticTurn) {
        // Multi-turno: actuliazar UI con nueva pregunta interactiva
        const questionDiv = bubble.querySelector(".neuroprobe-question");
        questionDiv.textContent = result.message;
        
        // Reset input
        this._textarea.value = "";
        this._textarea.style.height = "38px";
        sendBtn.disabled = false;
        this._textarea.disabled = false;
        this._textarea.focus();
        return; 
      }

      const inputRow = bubble.querySelector(".neuroprobe-input-row");
      if (inputRow) inputRow.remove();

      const resultDiv = document.createElement("div");
      resultDiv.className = "neuroprobe-result";

      if (result.draftReady) {
        resultDiv.innerHTML = `
          <span>${result.summary}</span><br/>
          <p style="margin: 8px 0; color: #3C3489; font-weight: bold;">
            Propuesta: "${result.proposedNeuron?.core?.concept}"
          </p>
          <div class="neuroprobe-draft-actions">
            <button class="neuroprobe-btn-reject">Descartar</button>
            <button class="neuroprobe-btn-accept">Guardar Neurona</button>
          </div>
        `;
        bubble.appendChild(resultDiv);

        const btnAccept = resultDiv.querySelector(".neuroprobe-btn-accept");
        const btnReject = resultDiv.querySelector(".neuroprobe-btn-reject");

        btnAccept.addEventListener("click", async () => {
          btnAccept.disabled = true;
          btnReject.disabled = true;
          btnAccept.textContent = "Guardando...";
          const finalRes = await neuroProbe.acceptDraft();
          resultDiv.innerHTML = `<span>${finalRes.summary}</span>`;
          setTimeout(() => this._removeBubble(), 3000);
        });

        btnReject.addEventListener("click", () => {
          neuroProbe.dismiss();
          this._removeBubble();
        });
        return;
      }

      // Finalización local clásica
      let html = `<span>${result.summary}</span>`;

      if (result.neuronsCreated && result.neuronsCreated.length > 0) {
        html += `<div class="neuroprobe-neurons-created">`;
        for (const n of result.neuronsCreated) {
          html += `<span class="neuroprobe-neuron-tag">✦ ${n.core.concept}</span>`;
        }
        html += `</div>`;
      }

      resultDiv.innerHTML = html;
      bubble.appendChild(resultDiv);

      if (this._onAnswer) {
        this._onAnswer(result);
      }

      // Auto-cerrar después de 4 segundos
      setTimeout(() => this._removeBubble(), 4000);

    } catch (err) {
      sendBtn.disabled = false;
      if (this._textarea) this._textarea.disabled = false;
      console.error("[NeuroProbeUI] Error procesando respuesta:", err);
    }
  }

  _removeBubble() {
    if (!this._bubble) return;
    const bubble = this._bubble;
    bubble.classList.remove("visible");
    bubble.classList.add("exiting");
    setTimeout(() => {
      if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
    }, 300);
    this._bubble = null;
    this._textarea = null;
  }

  /**
   * Limpia el probe completamente.
   */
  destroy() {
    this._removeBubble();
    if (this._container && this._container.id === "neuroprobe-container") {
      this._container.remove();
    }
  }
}

export default NeuroProbeUI;
