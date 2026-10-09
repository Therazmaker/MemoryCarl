import {
  loadClosetState,
  saveClosetState,
  wearClothingItems,
  markItemsAsLaundry,
  updateClothingItem,
  analyzeClosetHygiene,
  CLOTHING_CATEGORIES,
  getDayKey
} from "./closetStore.js";
import { callClaude, getChefAiSettings } from "../shopping/shoppingAi.js";

/**
 * Renderiza la sección/widget de Ropa & Clóset dentro de la tarjeta Tracker Vital.
 */
export function renderTrackerVitalClosetWidget() {
  const { items, log } = loadClosetState();
  const todayKey = getDayKey();

  const todayLogs = log.filter(l => l.dateKey === todayKey);
  const todayItemIds = new Set(todayLogs.map(l => l.itemId));

  const cleanItems = items.filter(i => i.status === "limpia" || todayItemIds.has(i.id));
  const dirtyCount = items.filter(i => i.status === "sucia").length;

  const wornTodayList = items.filter(i => todayItemIds.has(i.id));

  // Generar etiquetas de prendas usadas hoy
  const wornTagsHtml = wornTodayList.length > 0
    ? wornTodayList.map(item => {
        const cat = CLOTHING_CATEGORIES.find(c => c.id === item.category);
        const icon = cat ? cat.icon : "👕";
        return `<span style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3); border-radius:12px; padding:2px 8px; font-size:11px; display:inline-flex; align-items:center; gap:4px; margin-right:4px; margin-bottom:4px;">
          ${icon} <strong>${item.code}</strong> (${item.name.length > 12 ? item.name.substr(0,10)+'...' : item.name})
        </span>`;
      }).join("")
    : `<span style="color:var(--text-dim, #9ca3af); font-size:12px; font-style:italic;">No has registrado ropa hoy.</span>`;

  // Opciones para el selector rápido de código/prenda
  const cleanOptionsHtml = cleanItems.map(i => {
    const isWorn = todayItemIds.has(i.id);
    const cat = CLOTHING_CATEGORIES.find(c => c.id === i.category);
    const catIcon = cat ? cat.icon : "👕";
    return `<option value="${i.id}" ${isWorn ? "disabled" : ""}>
      ${catIcon} ${i.code} - ${i.name} ${isWorn ? "(Puesta hoy)" : ""}
    </option>`;
  }).join("");

  return `
    <div id="trackerVitalClosetSection" style="margin-top:14px; padding-top:10px; border-top:1px dashed var(--border-color, rgba(255,255,255,0.1));">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <div style="font-weight:600; font-size:13px; display:flex; align-items:center; gap:6px;">
          <span>👔 Ropa de Hoy & Clóset</span>
          ${dirtyCount > 0 ? `<span style="background:rgba(239,68,68,0.15); color:#f87171; font-size:10px; padding:1px 6px; border-radius:10px; border:1px solid rgba(239,68,68,0.3)">🧺 ${dirtyCount} sucias</span>` : ''}
        </div>
        <div style="display:flex; gap:4px;">
          <button class="btn small" id="btnClaudeClosetAi" title="Diagnóstico & Consejos de Claude AI" style="padding:2px 6px; font-size:11px; background:linear-gradient(135deg, #8b5cf6, #ec4899); border:none; color:white; border-radius:6px; font-weight:600;">🤖 Claude AI</button>
          <button class="btn small secondary" id="btnOpenClosetModal" style="padding:2px 8px; font-size:11px;">👔 Clóset</button>
        </div>
      </div>

      <div style="margin-bottom:8px;">
        <div style="font-size:11px; color:var(--text-dim, #9ca3af); margin-bottom:4px;">Prendas en uso hoy:</div>
        <div style="display:flex; flex-wrap:wrap; align-items:center;">
          ${wornTagsHtml}
        </div>
      </div>

      <div style="display:flex; gap:6px; align-items:center;">
        <select id="selectQuickWearItem" class="input" style="font-size:12px; padding:4px 8px; flex:1;">
          <option value="">➕ Seleccionar por código/prenda...</option>
          ${cleanOptionsHtml}
        </select>
        <button class="btn small primary" id="btnQuickWearSubmit" style="padding:4px 10px; font-size:12px; white-space:nowrap;">Ponerse</button>
      </div>
      <div id="closetWidgetFeedback" style="font-size:11px; margin-top:4px; display:none;"></div>
    </div>
  `;
}

/**
 * Conecta los eventos de la sección de Clóset en Tracker Vital.
 */
export function wireTrackerVitalClosetWidget(root, onStateChanged) {
  const btnOpenModal = root.querySelector("#btnOpenClosetModal");
  if (btnOpenModal) {
    btnOpenModal.addEventListener("click", e => {
      e.stopPropagation();
      openClosetModal(onStateChanged);
    });
  }

  const btnClaudeAi = root.querySelector("#btnClaudeClosetAi");
  if (btnClaudeAi) {
    btnClaudeAi.addEventListener("click", e => {
      e.stopPropagation();
      runClaudeHygieneAnalysis(root);
    });
  }

  const btnQuickWear = root.querySelector("#btnQuickWearSubmit");
  if (btnQuickWear) {
    btnQuickWear.addEventListener("click", e => {
      e.stopPropagation();
      const select = root.querySelector("#selectQuickWearItem");
      const itemId = select ? select.value : null;
      if (!itemId) return;

      const { items, log } = loadClosetState();
      const result = wearClothingItems([itemId], items, log);
      saveClosetState(result.items, result.log);

      const feedback = root.querySelector("#closetWidgetFeedback");
      if (feedback) {
        feedback.style.display = "block";
        if (result.warnings.length > 0) {
          feedback.style.color = "#f59e0b";
          feedback.innerHTML = result.warnings.join("<br>");
        } else {
          feedback.style.color = "#22c55e";
          feedback.innerHTML = "✓ Prenda registrada correctamente para el día de hoy.";
        }
      }

      if (typeof onStateChanged === "function") {
        onStateChanged();
      }
    });
  }
}

/**
 * Ejecuta el análisis de higiene con Claude AI.
 */
async function runClaudeHygieneAnalysis(root) {
  const feedback = root.querySelector("#closetWidgetFeedback");
  if (feedback) {
    feedback.style.display = "block";
    feedback.style.color = "#a7f3d0";
    feedback.innerHTML = "⏳ Consultando a Claude AI para diagnóstico de higiene y rotación...";
  }

  try {
    const { items, log } = loadClosetState();
    const settings = getChefAiSettings();

    const apiKey = settings.claudeApiKey || localStorage.getItem("memorycarl_claude_api_key");
    if (!apiKey) {
      if (feedback) {
        feedback.style.color = "#f87171";
        feedback.innerHTML = "⚠️ Configura tu API Key de Claude en la sección Chef AI (⚙️) para usar la IA.";
      }
      return;
    }

    const hygieneInfo = analyzeClosetHygiene(items, log);
    const todayKey = getDayKey();
    const todayLogs = log.filter(l => l.dateKey === todayKey);
    const wornTodayNames = items.filter(i => todayLogs.some(l => l.itemId === i.id)).map(i => `${i.code} (${i.name})`).join(", ");

    const systemPrompt = `Eres el Asistente de Higiene y Vestuario Personal de MemoryCarl.
Tu meta es ayudar al usuario con TDAH / rutina diaria a mantener una excelente higiene de vestuario de manera 100% EMPÁTICA, AMABLE, CONSTRUCTIVA y SIN JUZGAR NUNCA.
Reglas:
- Sé breve y conciso (máximo 3 párrafos cortos o viñetas).
- Da un cumplido o nota alentadora.
- Recomienda amablemente el cambio de ropa si detectas que falta ropa interior o hay ropa sucia.
- Sugiere qué combinar o usar de la ropa limpia disponible.`;

    const userPrompt = `Estado de vestuario hoy (${todayKey}):
- Prendas usadas hoy: ${wornTodayNames || "Ninguna registrada aún"}
- Limpias disponibles: ${hygieneInfo.cleanCount} de ${hygieneInfo.totalCount}
- Sucias acumuladas: ${hygieneInfo.dirtyCount}
- ¿Bóxer/Ropa interior registrada hoy?: ${hygieneInfo.hasBoxerToday ? "Sí" : "No"}
- Alertas detectadas: ${hygieneInfo.warnings.join(" / ") || "Ninguna"}

Por favor dame un diagnóstico amigable, rápido y consejos de ropa para hoy.`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];

    const response = await callClaude(messages, apiKey, settings.claudeModel || "claude-haiku-4-5");

    if (feedback) {
      feedback.style.color = "#e0e7ff";
      feedback.innerHTML = `<div style="background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.3); border-radius:8px; padding:8px; margin-top:6px; font-size:12px; line-height:1.4;">
        <div style="font-weight:bold; color:#a5b4fc; margin-bottom:4px;">🤖 Diagnóstico de Claude:</div>
        ${response.replace(/\n/g, "<br>")}
      </div>`;
    }
  } catch (err) {
    if (feedback) {
      feedback.style.color = "#f87171";
      feedback.innerHTML = `⚠️ Error al consultar Claude AI: ${err.message}`;
    }
  }
}

/**
 * Abre el Modal completo de Gestión de Clóset / Armario.
 */
export function openClosetModal(onStateChanged) {
  let modal = document.getElementById("closetManagerModal");
  if (modal) modal.remove();

  modal = document.createElement("div");
  modal.id = "closetManagerModal";
  modal.className = "modal active";
  modal.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.7); z-index:99999; display:flex; align-items:center; justify-content:center; padding:12px;";

  document.body.appendChild(modal);

  let activeTab = "inventory"; // 'inventory' | 'add' | 'history'
  let editingItemId = null;

  const renderModalContent = () => {
    const { items, log } = loadClosetState();
    const todayKey = getDayKey();
    const todayItemIds = new Set(log.filter(l => l.dateKey === todayKey).map(l => l.itemId));

    const cleanCount = items.filter(i => i.status === "limpia").length;
    const wornTodayCount = items.filter(i => todayItemIds.has(i.id) || i.status === "usada_hoy").length;
    const dirtyCount = items.filter(i => i.status === "sucia").length;

    let mainContentHtml = "";

    if (activeTab === "inventory") {
      const itemsListHtml = items.map(item => {
        const cat = CLOTHING_CATEGORIES.find(c => c.id === item.category) || { icon: "👕", label: "Otro" };
        const isWornToday = todayItemIds.has(item.id) || item.status === "usada_hoy";

        let statusBadge = "";
        if (isWornToday) {
          statusBadge = `<span style="background:rgba(59,130,246,0.2); color:#60a5fa; border:1px solid rgba(59,130,246,0.4); font-size:10px; padding:2px 6px; border-radius:10px;">Puesta Hoy</span>`;
        } else if (item.status === "sucia") {
          statusBadge = `<span style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.4); font-size:10px; padding:2px 6px; border-radius:10px;">Sucia 🧺</span>`;
        } else {
          statusBadge = `<span style="background:rgba(34,197,94,0.2); color:#4ade80; border:1px solid rgba(34,197,94,0.4); font-size:10px; padding:2px 6px; border-radius:10px;">Limpia ✨</span>`;
        }

        if (editingItemId === item.id) {
          const catOptionsHtml = CLOTHING_CATEGORIES.map(c => `<option value="${c.id}" ${c.id===item.category?'selected':''}>${c.icon} ${c.label}</option>`).join("");
          return `
            <form id="formEditClothingItem" data-id="${item.id}" style="background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.4); border-radius:8px; padding:10px; margin-bottom:8px;">
              <div style="font-weight:600; font-size:12px; margin-bottom:6px; color:#60a5fa;">✏️ Editar Prenda</div>
              <div style="display:flex; gap:6px; margin-bottom:6px;">
                <input type="text" id="editCode" class="input" value="${item.code}" required style="width:90px; font-family:monospace; text-transform:uppercase; font-size:12px; padding:4px;">
                <input type="text" id="editName" class="input" value="${item.name}" required style="flex:1; font-size:12px; padding:4px;">
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                <select id="editCategory" class="input" style="flex:1; font-size:12px; padding:4px;">
                  ${catOptionsHtml}
                </select>
                <button type="submit" class="btn small primary" style="padding:4px 8px; font-size:11px;">Guardar</button>
                <button type="button" class="btn small secondary" id="btnCancelEdit" style="padding:4px 8px; font-size:11px;">Cancelar</button>
              </div>
            </form>
          `;
        }

        return `
          <div style="background:var(--card-bg, #1e293b); border:1px solid var(--border-color, rgba(255,255,255,0.1)); border-radius:8px; padding:10px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:16px;">${cat.icon}</span>
                <strong style="font-size:13px; font-family:monospace; background:rgba(255,255,255,0.1); padding:1px 5px; border-radius:4px;">${item.code}</strong>
                <span style="font-size:13px; font-weight:600;">${item.name}</span>
                ${statusBadge}
              </div>
              <div style="font-size:11px; color:var(--text-dim, #9ca3af); margin-top:4px;">
                Usos acumulados: <strong>${item.usageCount || 0}</strong> | Lavados: <strong>${item.washCount || 0}</strong>
              </div>
            </div>
            <div style="display:flex; gap:4px; align-items:center;">
              <button class="btn small secondary" data-act="edit-item" data-id="${item.id}" style="padding:2px 6px; font-size:11px;">✏️</button>
              ${item.status === "sucia"
                ? `<button class="btn small primary" data-act="wash-one" data-id="${item.id}" style="padding:2px 6px; font-size:11px;">🧺 Lavar</button>`
                : `<button class="btn small warning" data-act="dirty-one" data-id="${item.id}" style="padding:2px 6px; font-size:11px; background:#f59e0b; color:black; border:none;">🧺 Sucia</button>`
              }
              <button class="btn small danger" data-act="delete-item" data-id="${item.id}" style="padding:2px 6px; font-size:11px; background:#ef4444; color:white; border:none;">🗑️</button>
            </div>
          </div>
        `;
      }).join("");

      mainContentHtml = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div style="font-size:12px; color:var(--text-dim, #9ca3af);">
            Total: <strong>${items.length}</strong> (✨ ${cleanCount} limpias | 👕 ${wornTodayCount} puestas | 🧺 ${dirtyCount} sucias)
          </div>
          ${dirtyCount > 0 ? `<button class="btn small primary" id="btnWashAllLaundry" style="padding:4px 10px; font-size:11px; background:#22c55e;">🧺 Lavar Toda la Colada (${dirtyCount})</button>` : ""}
        </div>
        <div style="max-height:320px; overflow-y:auto; padding-right:4px;">
          ${itemsListHtml || '<div style="text-align:center; color:#9ca3af; padding:20px;">No hay prendas registradas en tu clóset.</div>'}
        </div>
      `;
    } else if (activeTab === "add") {
      const catOptionsHtml = CLOTHING_CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join("");

      mainContentHtml = `
        <form id="formAddClothingItem" style="display:flex; flex-direction:column; gap:10px; padding:4px;">
          <div>
            <label style="font-size:12px; display:block; margin-bottom:2px;">Código de Prenda (ej: BOX-03, CAM-05):</label>
            <input type="text" id="addCode" class="input" placeholder="Ej: BOX-03" required style="width:100%; font-family:monospace; text-transform:uppercase;">
          </div>
          <div>
            <label style="font-size:12px; display:block; margin-bottom:2px;">Nombre / Descripción:</label>
            <input type="text" id="addName" class="input" placeholder="Ej: Bóxer Verde Deportivo" required style="width:100%;">
          </div>
          <div>
            <label style="font-size:12px; display:block; margin-bottom:2px;">Categoría:</label>
            <select id="addCategory" class="input" style="width:100%;">
              ${catOptionsHtml}
            </select>
          </div>
          <button type="submit" class="btn primary" style="margin-top:8px; padding:8px;">➕ Agregar Prenda al Clóset</button>
        </form>
      `;
    } else if (activeTab === "history") {
      const recentLogs = [...log].reverse().slice(0, 20);
      const logRowsHtml = recentLogs.map(l => {
        const item = items.find(i => i.id === l.itemId);
        const name = item ? item.name : l.itemId;
        return `<div style="font-size:12px; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between;">
          <span>📅 <strong>${l.dateKey}</strong> - ${l.itemCode || ''} (${name})</span>
          <span style="color:#9ca3af; font-size:11px;">${new Date(l.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
        </div>`;
      }).join("");

      mainContentHtml = `
        <div style="max-height:320px; overflow-y:auto; padding-right:4px;">
          <div style="font-weight:600; font-size:12px; margin-bottom:8px; color:#a5b4fc;">Historial Reciente de Uso:</div>
          ${logRowsHtml || '<div style="text-align:center; color:#9ca3af; padding:20px;">Sin historial registrado aún.</div>'}
        </div>
      `;
    }

    modal.innerHTML = `
      <div style="background:var(--card-bg-dark, #0f172a); color:var(--text-color, #f8fafc); border:1px solid var(--border-color, rgba(255,255,255,0.15)); border-radius:12px; width:100%; max-width:520px; padding:16px; box-shadow:0 10px 25px rgba(0,0,0,0.5);" data-act="modal-content-stop">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">
          <div style="font-weight:bold; font-size:15px; display:flex; align-items:center; gap:6px;">
            👔 Gestor de Clóset & Higiene Personal
          </div>
          <button class="iconBtn" id="btnCloseClosetModal" style="font-size:16px;">❌</button>
        </div>

        <div style="display:flex; gap:6px; margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:8px;">
          <button class="btn small ${activeTab==='inventory'?'primary':'secondary'}" id="tabClosetInventory" style="flex:1; font-size:11px;">👕 Armario (${items.length})</button>
          <button class="btn small ${activeTab==='add'?'primary':'secondary'}" id="tabClosetAdd" style="flex:1; font-size:11px;">➕ Nueva Prenda</button>
          <button class="btn small ${activeTab==='history'?'primary':'secondary'}" id="tabClosetHistory" style="flex:1; font-size:11px;">📜 Historial</button>
        </div>

        <div>
          ${mainContentHtml}
        </div>
      </div>
    `;

    // Conectar eventos del modal
    modal.querySelector("#btnCloseClosetModal").onclick = () => modal.remove();
    modal.querySelector("#tabClosetInventory").onclick = () => { activeTab = "inventory"; renderModalContent(); };
    modal.querySelector("#tabClosetAdd").onclick = () => { activeTab = "add"; renderModalContent(); };
    modal.querySelector("#tabClosetHistory").onclick = () => { activeTab = "history"; renderModalContent(); };

    const btnWashAll = modal.querySelector("#btnWashAllLaundry");
    if (btnWashAll) {
      btnWashAll.onclick = () => {
        const dirtyIds = items.filter(i => i.status === "sucia").map(i => i.id);
        const updated = markItemsAsLaundry(dirtyIds, items, "wash");
        saveClosetState(updated, log);
        renderModalContent();
        if (typeof onStateChanged === "function") onStateChanged();
      };
    }

    const formAdd = modal.querySelector("#formAddClothingItem");
    if (formAdd) {
      formAdd.onsubmit = (e) => {
        e.preventDefault();
        const code = formAdd.querySelector("#addCode").value.trim().toUpperCase();
        const name = formAdd.querySelector("#addName").value.trim();
        const category = formAdd.querySelector("#addCategory").value;

        if (!code || !name) return;

        const newItem = {
          id: "c_custom_" + Date.now(),
          code,
          name,
          category,
          status: "limpia",
          usageCount: 0,
          washCount: 0,
          lastWashedAt: new Date().toISOString(),
          lastWornAt: null
        };

        const updatedItems = [...items, newItem];
        saveClosetState(updatedItems, log);
        activeTab = "inventory";
        renderModalContent();
        if (typeof onStateChanged === "function") onStateChanged();
      };
    }

    // Eventos delegated para items individuales
    modal.querySelectorAll("[data-act='wash-one']").forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-id");
        const updated = markItemsAsLaundry([id], items, "wash");
        saveClosetState(updated, log);
        renderModalContent();
        if (typeof onStateChanged === "function") onStateChanged();
      };
    });

    modal.querySelectorAll("[data-act='dirty-one']").forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-id");
        const updated = markItemsAsLaundry([id], items, "sucia");
        saveClosetState(updated, log);
        renderModalContent();
        if (typeof onStateChanged === "function") onStateChanged();
      };
    });

    modal.querySelectorAll("[data-act='edit-item']").forEach(btn => {
      btn.onclick = () => {
        editingItemId = btn.getAttribute("data-id");
        renderModalContent();
      };
    });

    const formEdit = modal.querySelector("#formEditClothingItem");
    if (formEdit) {
      formEdit.onsubmit = (e) => {
        e.preventDefault();
        const id = formEdit.getAttribute("data-id");
        const code = formEdit.querySelector("#editCode").value;
        const name = formEdit.querySelector("#editName").value;
        const category = formEdit.querySelector("#editCategory").value;

        const updated = updateClothingItem(id, { code, name, category }, items);
        saveClosetState(updated, log);
        editingItemId = null;
        renderModalContent();
        if (typeof onStateChanged === "function") onStateChanged();
      };

      const btnCancel = formEdit.querySelector("#btnCancelEdit");
      if (btnCancel) {
        btnCancel.onclick = () => {
          editingItemId = null;
          renderModalContent();
        };
      }
    }

    modal.querySelectorAll("[data-act='delete-item']").forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-id");
        if (confirm("¿Seguro que deseas eliminar esta prenda del clóset?")) {
          const updatedItems = items.filter(i => i.id !== id);
          saveClosetState(updatedItems, log);
          renderModalContent();
          if (typeof onStateChanged === "function") onStateChanged();
        }
      };
    });
  };

  renderModalContent();
}
