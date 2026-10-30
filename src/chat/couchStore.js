/**
 * couchStore.js — Almacenamiento y modelo de datos para Couch (Carta Natal, Casas y Aspectos)
 * MemoryCarl / NeuroChat
 */

const STORAGE_KEY = "memorycarl_couch_natal_chart";

export const ZODIAC_SIGNS = [
  { id: "aries", name: "Aries", symbol: "♈", element: "fuego" },
  { id: "tauro", name: "Tauro", symbol: "♉", element: "tierra" },
  { id: "geminis", name: "Géminis", symbol: "♊", element: "aire" },
  { id: "cancer", name: "Cáncer", symbol: "♋", element: "agua" },
  { id: "leo", name: "Leo", symbol: "♌", element: "fuego" },
  { id: "virgo", name: "Virgo", symbol: "♍", element: "tierra" },
  { id: "libra", name: "Libra", symbol: "♎", element: "aire" },
  { id: "escorpio", name: "Escorpio", symbol: "♏", element: "agua" },
  { id: "sagitario", name: "Sagitario", symbol: "♐", element: "fuego" },
  { id: "capricornio", name: "Capricornio", symbol: "♑", element: "tierra" },
  { id: "acuario", name: "Acuario", symbol: "♒", element: "aire" },
  { id: "piscis", name: "Piscis", symbol: "♓", element: "agua" },
];

export const PLANETS_CATALOG = [
  { id: "sol", name: "Sol", symbol: "☉" },
  { id: "luna", name: "Luna", symbol: "☽" },
  { id: "mercurio", name: "Mercurio", symbol: "☿" },
  { id: "venus", name: "Venus", symbol: "♀" },
  { id: "marte", name: "Marte", symbol: "♂" },
  { id: "jupiter", name: "Júpiter", symbol: "♃" },
  { id: "saturno", name: "Saturno", symbol: "♄" },
  { id: "urano", name: "Urano", symbol: "♅" },
  { id: "neptuno", name: "Neptuno", symbol: "♆" },
  { id: "pluton", name: "Plutón", symbol: "♇" },
  { id: "nodo_norte", name: "Nodo N (m)", symbol: "☊" },
  { id: "nodo_sur", name: "Nodo S", symbol: "☋" },
  { id: "lilith", name: "Lilith (m)", symbol: "⚸" },
  { id: "chiron", name: "Quirón", symbol: "⚷" },
  { id: "ascendente", name: "Ascendente", symbol: "AC" },
  { id: "mediocielo", name: "Medio Cielo", symbol: "MC" },
];

export const ASPECT_TYPES = [
  { id: "conjuncion", name: "Conjunción", symbol: "☌", angle: 0, color: "#a855f7", nature: "neutral" },
  { id: "semisextil", name: "Semi-sextil", symbol: "⚺", angle: 30, color: "#22c55e", nature: "harmony" },
  { id: "sextil", name: "Sextil", symbol: "✱", angle: 60, color: "#3b82f6", nature: "harmony" },
  { id: "cuadratura", name: "Cuadratura", symbol: "□", angle: 90, color: "#f97316", nature: "tension" },
  { id: "trigono", name: "Trígono", symbol: "△", angle: 120, color: "#22c55e", nature: "harmony" },
  { id: "quincuncio", name: "Quincuncio", symbol: "⚮", angle: 150, color: "#eab308", nature: "neutral" },
  { id: "oposicion", name: "Oposición", symbol: "☍", angle: 180, color: "#ef4444", nature: "tension" },
];

export const DEFAULT_NATAL_CHART = {
  birthDetails: {
    name: "",
    date: "",
    time: "",
    location: "",
  },
  planets: [],
  houseCusps: Array.from({ length: 12 }, (_, i) => ({
    house: i + 1,
    sign: ZODIAC_SIGNS[i % 12].id,
    degree: 0,
    minutes: 0,
    seconds: 0,
  })),
  aspects: [],
};

/**
 * Obtiene los datos de la Carta Natal desde localStorage
 */
export function getNatalChartData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_NATAL_CHART));
    const parsed = JSON.parse(raw);
    return {
      birthDetails: { ...DEFAULT_NATAL_CHART.birthDetails, ...(parsed.birthDetails || {}) },
      planets: Array.isArray(parsed.planets) ? parsed.planets : [],
      houseCusps: Array.isArray(parsed.houseCusps) && parsed.houseCusps.length === 12
        ? parsed.houseCusps
        : JSON.parse(JSON.stringify(DEFAULT_NATAL_CHART.houseCusps)),
      aspects: Array.isArray(parsed.aspects) ? parsed.aspects : [],
      ...(parsed.aspectMode === "auto" || parsed.aspectMode === "manual" ? { aspectMode: parsed.aspectMode } : {}),
    };
  } catch (err) {
    console.warn("[CouchStore] Error al leer carta natal:", err);
    return JSON.parse(JSON.stringify(DEFAULT_NATAL_CHART));
  }
}

/**
 * Guarda los datos de la Carta Natal en localStorage
 */
export function saveNatalChartData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error("[CouchStore] Error al guardar carta natal:", err);
    return false;
  }
}

/**
 * Reinicia la Carta Natal
 */
export function resetNatalChartData() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return JSON.parse(JSON.stringify(DEFAULT_NATAL_CHART));
  } catch (err) {
    console.error("[CouchStore] Error al reiniciar carta natal:", err);
    return JSON.parse(JSON.stringify(DEFAULT_NATAL_CHART));
  }
}
