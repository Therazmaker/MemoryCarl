/**
 * closetStore.js
 * Core state management, default wardrobe items, hygiene checks, and persistence for the Closet & Clothing module.
 */

export const LS_CLOSET_KEY = "memorycarl_v2_closet";
export const LS_CLOSET_LOG_KEY = "memorycarl_v2_closet_log";

export const CLOTHING_CATEGORIES = [
  { id: "boxer", label: "Bóxer / Ropa interior", icon: "🩲", defaultMaxUses: 1 },
  { id: "camisa", label: "Camisa / Polo / Camiseta", icon: "👕", defaultMaxUses: 1 },
  { id: "pantalon", label: "Pantalón / Jeans / Short", icon: "👖", defaultMaxUses: 2 },
  { id: "calcetines", label: "Calcetines / Medias", icon: "🧦", defaultMaxUses: 1 },
  { id: "pijama", label: "Pijama / Ropa de dormir", icon: "🛋️", defaultMaxUses: 2 },
  { id: "abrigo", label: "Casaca / Polera / Abrigo", icon: "🧥", defaultMaxUses: 4 },
  { id: "otro", label: "Otro / Accesorio", icon: "🧢", defaultMaxUses: 3 }
];

export const DEFAULT_CLOSET_ITEMS = [
  { id: "c_box_1", code: "BOX-01", name: "Bóxer Negro Algodón", category: "boxer", status: "limpia", usageCount: 0, washCount: 0, lastWashedAt: null, lastWornAt: null },
  { id: "c_box_2", code: "BOX-02", name: "Bóxer Azul Deportivo", category: "boxer", status: "limpia", usageCount: 0, washCount: 0, lastWashedAt: null, lastWornAt: null },
  { id: "c_cam_1", code: "CAM-01", name: "Camiseta Blanca Básica", category: "camisa", status: "limpia", usageCount: 0, washCount: 0, lastWashedAt: null, lastWornAt: null },
  { id: "c_cam_2", code: "CAM-02", name: "Polo Negro Casual", category: "camisa", status: "limpia", usageCount: 0, washCount: 0, lastWashedAt: null, lastWornAt: null },
  { id: "c_pan_1", code: "PAN-01", name: "Jeans Azul Oscuro", category: "pantalon", status: "limpia", usageCount: 0, washCount: 0, lastWashedAt: null, lastWornAt: null },
  { id: "c_pan_2", code: "PAN-02", name: "Pantalón Jogger Gris", category: "pantalon", status: "limpia", usageCount: 0, washCount: 0, lastWashedAt: null, lastWornAt: null },
  { id: "c_socks_1", code: "SOC-01", name: "Calcetines Negros (Par 1)", category: "calcetines", status: "limpia", usageCount: 0, washCount: 0, lastWashedAt: null, lastWornAt: null }
];

export function loadClosetState() {
  try {
    const itemsRaw = localStorage.getItem(LS_CLOSET_KEY);
    const logRaw = localStorage.getItem(LS_CLOSET_LOG_KEY);

    let items = itemsRaw ? JSON.parse(itemsRaw) : null;
    let log = logRaw ? JSON.parse(logRaw) : [];

    if (!Array.isArray(items) || items.length === 0) {
      items = JSON.parse(JSON.stringify(DEFAULT_CLOSET_ITEMS));
      localStorage.setItem(LS_CLOSET_KEY, JSON.stringify(items));
    }

    return { items, log };
  } catch (err) {
    console.error("Error loading closet state:", err);
    return {
      items: JSON.parse(JSON.stringify(DEFAULT_CLOSET_ITEMS)),
      log: []
    };
  }
}

export function saveClosetState(items, log) {
  try {
    if (items) localStorage.setItem(LS_CLOSET_KEY, JSON.stringify(items));
    if (log) localStorage.setItem(LS_CLOSET_LOG_KEY, JSON.stringify(log));
  } catch (err) {
    console.error("Error saving closet state:", err);
  }
}

/**
 * Normaliza una fecha ISO o timestamp a cadena 'YYYY-MM-DD'
 */
export function getDayKey(dateInput = new Date()) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return new Date().toISOString().split("T")[0];
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Registra el uso de prendas para una fecha dada (por defecto hoy).
 * @param {Array<string>} itemIds - IDs de las prendas usadas.
 * @param {Array} currentItems - Lista actual de prendas.
 * @param {Array} currentLog - Historial actual de uso.
 * @param {string} [dateKey] - 'YYYY-MM-DD'
 */
export function wearClothingItems(itemIds, currentItems, currentLog, dateKey = getDayKey()) {
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return { items: currentItems, log: currentLog, warnings: [] };
  }

  const updatedItems = currentItems.map(item => ({ ...item }));
  const updatedLog = [...currentLog];
  const nowIso = new Date().toISOString();
  const warnings = [];

  // Obtener lo que se usó el día anterior (ayer)
  const baseDate = dateKey ? new Date(`${dateKey}T12:00:00Z`) : new Date();
  const yesterdayDate = new Date(baseDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = getDayKey(yesterdayDate);

  const yesterdayLogs = updatedLog.filter(l => l.dateKey === yesterdayKey);
  const yesterdayItemIds = new Set(yesterdayLogs.map(l => l.itemId));

  itemIds.forEach(id => {
    const item = updatedItems.find(i => i.id === id);
    if (!item) return;

    // Verificar advertencia de repetición
    if (yesterdayItemIds.has(id)) {
      if (item.category === "boxer" || item.category === "calcetines") {
        warnings.push(`⚠️ Estás repitiendo ${item.name} (${item.code}) por 2º día consecutivo. La ropa interior requiere cambio diario.`);
      } else {
        warnings.push(`ℹ️ Repitiendo ${item.name} (${item.code}) del día de ayer.`);
      }
    } else if (item.status === "sucia") {
      warnings.push(`⚠️ La prenda ${item.name} (${item.code}) estaba marcada como sucia antes de reusarla.`);
    }

    item.status = "usada_hoy";
    item.usageCount = (item.usageCount || 0) + 1;
    item.lastWornAt = nowIso;

    // Remover registros duplicados en la misma fecha para evitar inflar el historial
    const existingLogIndex = updatedLog.findIndex(l => l.itemId === id && l.dateKey === dateKey);
    if (existingLogIndex >= 0) {
      updatedLog.splice(existingLogIndex, 1);
    }

    updatedLog.push({
      id: "clog_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
      itemId: id,
      itemCode: item.code,
      category: item.category,
      dateKey,
      timestamp: nowIso
    });
  });

  return { items: updatedItems, log: updatedLog, warnings };
}

/**
 * Cambia el estado de prendas seleccionadas a 'sucia' o 'limpia' (lavado).
 */
export function markItemsAsLaundry(itemIds, currentItems, action = "wash") {
  const nowIso = new Date().toISOString();
  const updatedItems = currentItems.map(item => {
    if (itemIds.includes(item.id)) {
      if (action === "wash" || action === "limpia") {
        return {
          ...item,
          status: "limpia",
          washCount: (item.washCount || 0) + 1,
          lastWashedAt: nowIso
        };
      } else if (action === "sucia") {
        return {
          ...item,
          status: "sucia"
        };
      }
    }
    return item;
  });

  return updatedItems;
}

/**
 * Analiza el estado actual del clóset e historial para evaluar la higiene.
 */
export function analyzeClosetHygiene(items, log, dateKey = getDayKey()) {
  const todayLogs = log.filter(l => l.dateKey === dateKey);
  const todayItemIds = new Set(todayLogs.map(l => l.itemId));

  const baseDate = dateKey ? new Date(`${dateKey}T12:00:00Z`) : new Date();
  const yesterdayDate = new Date(baseDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = getDayKey(yesterdayDate);
  const yesterdayLogs = log.filter(l => l.dateKey === yesterdayKey);
  const yesterdayItemIds = new Set(yesterdayLogs.map(l => l.itemId));

  const warnings = [];
  const suggestions = [];

  // 1. Verificar si se registró ropa interior hoy
  const boxerToday = items.find(i => todayItemIds.has(i.id) && i.category === "boxer");
  if (!boxerToday) {
    warnings.push("No has registrado cambio de ropa interior (bóxer) el día de hoy.");
  } else if (yesterdayItemIds.has(boxerToday.id)) {
    warnings.push(`Llevas el mismo bóxer (${boxerToday.name} - ${boxerToday.code}) que ayer.`);
  }

  // 2. Contar prendas sucias vs limpias
  const totalItems = items.length;
  const cleanItems = items.filter(i => i.status === "limpia");
  const dirtyItems = items.filter(i => i.status === "sucia");
  const wornTodayItems = items.filter(i => todayItemIds.has(i.id) || i.status === "usada_hoy");

  // 3. Recomendar prendas limpias por categoría
  CLOTHING_CATEGORIES.forEach(cat => {
    const cleanInCat = cleanItems.filter(i => i.category === cat.id);
    if (cleanInCat.length === 0) {
      suggestions.push(`⚠️ No tienes ${cat.label.toLowerCase()} limpias disponibles. ¡Hora de hacer colada/lavandería!`);
    }
  });

  return {
    todayWornCount: wornTodayItems.length,
    cleanCount: cleanItems.length,
    dirtyCount: dirtyItems.length,
    totalCount: totalItems,
    hasBoxerToday: !!boxerToday,
    warnings,
    suggestions
  };
}
