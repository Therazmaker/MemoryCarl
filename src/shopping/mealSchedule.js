/**
 * mealSchedule.js — Planificador Predictivo de Comidas y Bebidas ("Meal Schedule")
 * MemoryCarl
 *
 * Características:
 * 1. Plan Proyectado por Día / Semana / Mes (Baseline de lo que Carlos cree que va a comer/beber).
 * 2. Resolución de Precios Automática: Busca productos en la biblioteca de productos.
 *    Si un alimento o bebida no existe en la biblioteca, emite alerta de "Precio Faltante" con opción de agregarlo.
 * 3. Inmutabilidad y Seguimiento: El plan base se preserva como referencia ("lo proyectado").
 *    A medida que pasa el tiempo, se registran los consumos reales y el sistema calcula:
 *    - Cumplimiento vs Desvío (ahorró o gastó de más).
 *    - Ajuste automático del gasto restante del mes/quincena.
 * 4. Integración fluida con el Home Card "Tu Flow de Hoy".
 */

export const MEAL_SCHEDULE_LS_KEY = "memorycarl_meal_schedule_v1";
export const SCHEDULE_LOG_LS_KEY = "memorycarl_schedule_consumption_log_v1";

export const MEAL_SLOTS = [
  { id: "desayuno", label: "Desayuno", icon: "🍳" },
  { id: "almuerzo", label: "Almuerzo", icon: "🍲" },
  { id: "cena", label: "Cena", icon: "🥗" },
  { id: "bebidas", label: "Bebidas & Snacks", icon: "⚡" }
];

export const DAYS_OF_WEEK = [
  { id: 1, key: "lunes", label: "Lunes" },
  { id: 2, key: "martes", label: "Martes" },
  { id: 3, key: "miercoles", label: "Miércoles" },
  { id: 4, key: "jueves", label: "Jueves" },
  { id: 5, key: "viernes", label: "Viernes" },
  { id: 6, key: "sabado", label: "Sábado" },
  { id: 0, key: "domingo", label: "Domingo" }
];

/**
 * Normaliza un nombre o clave de día a su clave estándar en minúsculas sin tildes.
 * Soporta variantes con tilde ("miércoles", "sábado"), inglés ("monday") y palabras relativas ("hoy", "mañana").
 * @param {string} key
 * @param {string} [isoDateReference] - 'YYYY-MM-DD' fecha de referencia opcional
 * @returns {string|null} - 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes' | 'sabado' | 'domingo' | null
 */
export function normalizeDayKey(key, isoDateReference = null) {
  if (!key) return null;
  const clean = String(key)
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const dayKeysMap = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

  if (clean === "hoy" || clean === "today") {
    const refDate = isoDateReference ? new Date(isoDateReference + "T12:00:00") : new Date();
    return dayKeysMap[refDate.getDay()] || "lunes";
  }

  if (clean === "manana" || clean === "tomorrow") {
    const refDate = isoDateReference ? new Date(isoDateReference + "T12:00:00") : new Date();
    refDate.setDate(refDate.getDate() + 1);
    return dayKeysMap[refDate.getDay()] || "martes";
  }

  const enMap = {
    monday: "lunes",
    tuesday: "martes",
    wednesday: "miercoles",
    thursday: "jueves",
    friday: "viernes",
    saturday: "sabado",
    sunday: "domingo"
  };
  if (enMap[clean]) return enMap[clean];

  if (dayKeysMap.includes(clean)) return clean;

  return null;
}

/**
 * Carga el horario semanal/plantilla de comidas proyectadas.
 * Formato: { [dayKey]: { desayuno: [items], almuerzo: [items], cena: [items], bebidas: [items] } }
 */
export function loadMealSchedule() {
  if (typeof localStorage === "undefined") return getDefaultSchedule();
  try {
    const raw = localStorage.getItem(MEAL_SCHEDULE_LS_KEY);
    if (!raw) return getDefaultSchedule();
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : getDefaultSchedule();
  } catch (_) {
    return getDefaultSchedule();
  }
}

/**
 * Guarda el horario de comidas proyectadas.
 */
export function saveMealSchedule(schedule) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MEAL_SCHEDULE_LS_KEY, JSON.stringify(schedule));
  } catch (_) {}
}

/**
 * Carga el historial de consumos reales por fecha ('YYYY-MM-DD').
 * Formato: { "YYYY-MM-DD": [ { slotId, name, price, isPlanned, ts } ] }
 */
export function loadScheduleLog() {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(SCHEDULE_LOG_LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

/**
 * Guarda el historial de consumos reales.
 */
export function saveScheduleLog(log) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SCHEDULE_LOG_LS_KEY, JSON.stringify(log));
  } catch (_) {}
}

/**
 * Plantilla por defecto con hábitos realistas de Carlos en Lima.
 */
function getDefaultSchedule() {
  const base = {};
  DAYS_OF_WEEK.forEach(d => {
    base[d.key] = {
      desayuno: [
        { name: "Huevos y Pan", portions: 1, qty: 1, unit: "porción", unitPrice: 3.50, estimatedPrice: 3.50, origin: "Cocinado en casa", notes: "", isCustom: false }
      ],
      almuerzo: [
        { name: "Menú Ejecutivo / Almuerzo", portions: 1, qty: 1, unit: "plato", unitPrice: 14.00, estimatedPrice: 14.00, origin: "Comprado fuera", notes: "", isCustom: false }
      ],
      cena: [
        { name: "Cena ligera en casa", portions: 1, qty: 1, unit: "porción", unitPrice: 5.00, estimatedPrice: 5.00, origin: "Cocinado en casa", notes: "", isCustom: false }
      ],
      bebidas: [
        { name: "Volt", portions: 1, qty: 1, unit: "botella", unitPrice: 2.50, estimatedPrice: 2.50, origin: "Comprado fuera", notes: "", isCustom: false }
      ]
    };
  });
  return base;
}

/**
 * Busca un producto por nombre en la biblioteca de productos de MemoryCarl.
 * Compara case-insensitive y normaliza tildes.
 * @param {string} itemName
 * @param {Array<object>} products - state.products
 * @returns {object|null}
 */
export function findProductInLibrary(itemName = "", products = []) {
  if (!itemName || !Array.isArray(products)) return null;
  const clean = itemName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  
  // 1. Coincidencia exacta
  let match = products.find(p => {
    const pName = String(p.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    return pName === clean;
  });
  if (match) return match;

  // 2. Coincidencia parcial (subcadena)
  match = products.find(p => {
    const pName = String(p.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    return pName.includes(clean) || clean.includes(pName);
  });
  return match || null;
}

/**
 * Resuelve y calcula los costos de una lista de items comparando contra la biblioteca.
 * Reporta items faltantes para que el usuario sea alertado.
 * @param {Array<object>} items - [ { name, qty, estimatedPrice } ]
 * @param {Array<object>} products - state.products
 * @returns {{ resolvedItems: Array<object>, totalCost: number, missingItems: Array<object> }}
 */
export function resolveScheduleItems(items = [], products = []) {
  let totalCost = 0;
  const missingItems = [];
  const resolvedItems = (items || []).map(it => {
    const name = String(it.name || "").trim();
    const portions = Math.max(0.1, Number(it.portions ?? it.qty) || 1);
    const qty = portions;
    const unit = String(it.unit || "porción").trim();
    const origin = String(it.origin || "Comprado fuera").trim();
    const notes = String(it.notes || "").trim();

    const prod = findProductInLibrary(name, products);

    let unitPrice = 0;
    let foundInLibrary = false;

    const explicitPrice = [it.unitPrice, it.estimatedPrice, it.costPerPortion].find(
      val => typeof val === "number" && !isNaN(val) && val > 0
    );

    if (explicitPrice !== undefined) {
      unitPrice = explicitPrice;
      foundInLibrary = !!(prod && typeof prod.price === "number" && prod.price === explicitPrice);
      if (!foundInLibrary) {
        missingItems.push({ name, currentPrice: unitPrice, isCustom: true });
      }
    } else if (prod && typeof prod.price === "number" && !isNaN(prod.price)) {
      unitPrice = prod.price;
      foundInLibrary = true;
    } else {
      missingItems.push({ name, currentPrice: 0, isCustom: false });
    }

    const itemTotal = Number((unitPrice * portions).toFixed(2));
    totalCost += itemTotal;

    return {
      name,
      portions,
      qty,
      unit,
      origin,
      notes,
      unitPrice,
      estimatedPrice: unitPrice,
      totalPrice: itemTotal,
      foundInLibrary,
      productId: prod?.id || null,
      tier: prod?.tier || "base_diario"
    };
  });

  return {
    resolvedItems,
    totalCost: Number(totalCost.toFixed(2)),
    missingItems
  };
}

/**
 * Obtiene el resumen proyectado completo de un día según el horario.
 * @param {string} dayKey - 'lunes' | 'martes' ...
 * @param {Array<object>} products
 */
export function getDayScheduleSummary(dayKey = "lunes", products = []) {
  const schedule = loadMealSchedule();
  const dayPlan = schedule[dayKey] || { desayuno: [], almuerzo: [], cena: [], bebidas: [] };

  const bySlot = {};
  let dayTotalCost = 0;
  const allMissing = [];

  MEAL_SLOTS.forEach(slot => {
    const rawItems = dayPlan[slot.id] || [];
    const res = resolveScheduleItems(rawItems, products);
    bySlot[slot.id] = {
      slotId: slot.id,
      label: slot.label,
      icon: slot.icon,
      items: res.resolvedItems,
      slotTotal: res.totalCost
    };
    dayTotalCost += res.totalCost;
    allMissing.push(...res.missingItems);
  });

  return {
    dayKey,
    bySlot,
    dayTotalCost: Number(dayTotalCost.toFixed(2)),
    missingItems: allMissing,
    hasMissingPrices: allMissing.length > 0
  };
}

/**
 * Obtiene el plan proyectado semanal completo y el presupuesto estimado.
 * @param {Array<object>} products
 */
export function getWeeklyScheduleSummary(products = []) {
  const schedule = loadMealSchedule();
  let weeklyTotal = 0;
  const daysSummary = [];
  const globalMissing = new Map();

  DAYS_OF_WEEK.forEach(d => {
    const daySum = getDayScheduleSummary(d.key, products);
    weeklyTotal += daySum.dayTotalCost;
    daysSummary.push({
      ...d,
      summary: daySum
    });
    daySum.missingItems.forEach(m => {
      if (!globalMissing.has(m.name.toLowerCase())) {
        globalMissing.set(m.name.toLowerCase(), m);
      }
    });
  });

  return {
    daysSummary,
    weeklyTotalCost: Number(weeklyTotal.toFixed(2)),
    monthlyEstimatedCost: Number((weeklyTotal * 4.285).toFixed(2)), // ~30 días
    missingItems: Array.from(globalMissing.values())
  };
}

/**
 * Registra que una comida o bebida proyectada (o no proyectada) fue realmente consumida en una fecha.
 * @param {string} isoDate - 'YYYY-MM-DD'
 * @param {object} item - { slotId, name, price, isPlanned }
 */
export function logActualConsumption(isoDate, item) {
  if (!isoDate || !item || !item.name) return;
  const log = loadScheduleLog();
  if (!Array.isArray(log[isoDate])) log[isoDate] = [];

  log[isoDate].push({
    id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    slotId: item.slotId || "almuerzo",
    name: item.name,
    price: Number(item.price) || 0,
    isPlanned: item.isPlanned !== false,
    ts: new Date().toISOString()
  });

  saveScheduleLog(log);
}

/**
 * Obtiene la comparación entre lo PROYECTADO y lo REAL para una fecha específica.
 * @param {string} isoDate - 'YYYY-MM-DD'
 * @param {Array<object>} products - state.products
 */
export function getPlannedVsActualForDate(isoDate, products = []) {
  const dateObj = new Date(isoDate + "T12:00:00");
  const dayIdx = dateObj.getDay();
  const dayConfig = DAYS_OF_WEEK.find(d => d.id === dayIdx) || DAYS_OF_WEEK[0];
  
  const planned = getDayScheduleSummary(dayConfig.key, products);
  const log = loadScheduleLog();
  const actualItems = log[isoDate] || [];

  const actualTotal = actualItems.reduce((acc, it) => acc + (Number(it.price) || 0), 0);
  const delta = Number((actualTotal - planned.dayTotalCost).toFixed(2));

  return {
    isoDate,
    dayConfig,
    planned,
    actualItems,
    plannedTotal: planned.dayTotalCost,
    actualTotal: Number(actualTotal.toFixed(2)),
    delta, // Positivo = gastó más de lo previsto; Negativo = ahorró
    status: delta > 0 ? "exceeded" : (actualItems.length > 0 ? "optimized" : "pending")
  };
}

/**
 * Determina si la porción de comida casera debe preservarse para mañana cuando se registra un gasto de almuerzo fuera.
 * @param {Array<object>} [movements] - Lista de movimientos de gasto del día
 * @returns {boolean} true si hubo gasto de almuerzo fuera ese día.
 */
export function isHomeLunchPreserved(movements = []) {
  if (!Array.isArray(movements) || movements.length === 0) return false;
  return movements.some(m => {
    const text = `${m.category || ""} ${m.note || ""}`.toLowerCase();
    return /almuerzo|comida|menu|menú|restaurante/.test(text);
  });
}
