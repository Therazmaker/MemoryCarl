/**
 * productGroups.js — Grupos de la biblioteca (Bebidas, Frutas, Carnes, Pollo…)
 * MemoryCarl · Compras
 *
 * Clasifica productos por su nombre con palabras de uso común en Perú. Lo que no reconoce
 * se lo pasa a la IA (Claude o Gemini) para que lo ubique en uno de estos mismos grupos.
 * Lógica pura.
 */

export const PRODUCT_GROUPS = [
  { id: "Bebidas", emoji: "🥤" },
  { id: "Frutas", emoji: "🍎" },
  { id: "Verduras", emoji: "🥬" },
  { id: "Carnes", emoji: "🥩" },
  { id: "Pollo", emoji: "🍗" },
  { id: "Pescados y mariscos", emoji: "🐟" },
  { id: "Lácteos y huevos", emoji: "🥛" },
  { id: "Panadería", emoji: "🥖" },
  { id: "Abarrotes", emoji: "🍚" },
  { id: "Embutidos", emoji: "🥓" },
  { id: "Snacks y dulces", emoji: "🍫" },
  { id: "Comida preparada", emoji: "🍱" },
  { id: "Limpieza", emoji: "🧽" },
  { id: "Higiene personal", emoji: "🧴" },
  { id: "Bebé y niños", emoji: "🍼" },
  { id: "Mascotas", emoji: "🐾" },
  { id: "Otros", emoji: "📦" },
];
export const GROUP_IDS = PRODUCT_GROUPS.map((g) => g.id);
export const groupEmoji = (id) => PRODUCT_GROUPS.find((g) => g.id === id)?.emoji || "📦";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();

// El orden importa: lo más específico primero ("leche de soya" es lácteo, "jugo de naranja" es bebida)
const RULES = [
  ["Bebé y niños", /\b(panal|panales|huggies|pampers|babysec|toallitas humedas|formula infantil|nan|enfagrow|papilla|biberon)\b/],
  ["Mascotas", /\b(perro|gato|mascota|ricocan|ricocat|dog chow|cat chow|mimaskot|arena para gato|whiskas|pedigree)\b/],
  ["Limpieza", /\b(detergente|lejia|clorox|sapolio|ace|ariel|bolivar|opal|lavavajilla|ayudin|limpiatodo|poett|esponja|escoba|trapeador|desinfectante|bolsas de basura|papel toalla|suavizante|downy|cif|pato)\b/],
  ["Higiene personal", /\b(shampoo|champu|jabon|pasta dental|colgate|dental|cepillo de dientes|desodorante|rexona|papel higienico|elite|suave|toalla higienica|toallas higienicas|nosotras|afeitar|gillette|crema corporal|hilo dental|enjuague bucal|algodon|cotonete)\b/],
  ["Embutidos", /\b(jamon|jamonada|salchicha|hot dog|chorizo|tocino|mortadela|pate|nuggets|salame|cabanossi)\b/],
  ["Comida preparada", /\b(menu|pollo a la brasa|a la brasa|broaster|chifa|pizza|hamburguesa|salchipapa|sanguche|sandwich|ceviche|delivery|combo|tamal|anticucho|emoliente|chaufa|aeropuerto|tallarin saltado|lomo saltado)\b/],
  ["Bebidas", /\b(agua|gaseosa|pepsi|coca|cola|inca|inka|fanta|sprite|seven up|7up|guarana|kola|volt|monster|red bull|gatorade|sporade|powerade|cifrut|frugos|pulp|jugo|nectar|chicha|cerveza|pilsen|cristal|cusquena|vino|pisco|ron|whisky|vodka|cafe|nescafe|altomayo|te |te$|infusion|mate|energizante|bebida|refresco|malta|yogurt bebible)\b/],
  ["Lácteos y huevos", /\b(leche|gloria|laive|pura vida|yogurt|yogur|queso|mantequilla|margarina|crema de leche|manjar|huevo|huevos|kefir|requeson)\b/],
  ["Pollo", /\b(pollo|pechuga|pierna de pollo|alitas|alas de pollo|encuentro|menudencia|higado de pollo|molleja|gallina|filete de pollo|milanesa de pollo)\b/],
  ["Pescados y mariscos", /\b(pescado|bonito|jurel|caballa|tollo|perico|lenguado|trucha|salmon|tilapia|atun|sardina|filete de pescado|mariscos|langostino|pota|calamar|choros|conchas)\b/],
  ["Carnes", /\b(carne|res|bistec|lomo|molida|cerdo|chancho|costilla|chuleta|asado|cordero|pavo|guiso|osobuco|sangrecita|higado|bofe|mondongo|cuy)\b/],
  ["Frutas", /\b(platano|banana|manzana|pera|naranja|mandarina|uva|uvas|fresa|fresas|papaya|pina|sandia|melon|mango|maracuya|granadilla|palta|aguacate|durazno|ciruela|kiwi|arandano|arandanos|tuna|lucuma|chirimoya|guanabana|coco|frutas|fruta|limon)\b/],
  ["Verduras", /\b(tomate|cebolla|papa|papas|camote|yuca|zanahoria|lechuga|pepino|zapallo|zapallito|brocoli|coliflor|espinaca|acelga|apio|poro|ajo|aji|rocoto|pimiento|beterraga|choclo|vainita|arveja|habas|culantro|perejil|huacatay|kion|jengibre|col|repollo|vegetales|verduras|champinon|olluco|caigua)\b/],
  ["Panadería", /\b(pan|panes|ciabatta|francés|frances|baguette|integral|bimbo|union|tostadas|pan de molde|keke|queque|bizcocho|empanada|tortilla|croissant|chancay|yema)\b/],
  ["Snacks y dulces", /\b(galleta|galletas|chocolate|sublime|triangulo|cua cua|chips|papitas|lays|doritos|cheetos|piqueo|caramelo|chicle|helado|gomitas|turron|alfajor|cereal en barra|snack|golosina|wafer|morochas|oreo|soda field|ritz|casino|picaras)\b/],
  ["Abarrotes", /\b(arroz|azucar|sal|aceite|fideos|fideo|tallarin|spaghetti|harina|avena|quinua|lentejas|frejol|frijol|garbanzo|pallar|menestra|atun en lata|conserva|mayonesa|ketchup|mostaza|vinagre|sillao|salsa|comino|pimienta|oregano|condimento|sazonador|ajinomoto|caldo|cubito|maicena|gelatina|mermelada|miel|cereal|granola|leche evaporada|pure|mani|pasas|azucar rubia|stevia|polvo de hornear|levadura)\b/],
];

/** Grupo por el nombre, o null si no lo reconoce. */
export function classifyProductName(name = "") {
  const t = ` ${norm(name)} `;
  if (!t.trim()) return null;
  for (const [group, re] of RULES) if (re.test(t)) return group;
  return null;
}

/** ¿Ya está en un grupo de la lista? */
export const isGroup = (cat) => GROUP_IDS.includes(String(cat || ""));

/**
 * Propuesta para agrupar la biblioteca: qué grupo le toca a cada producto.
 * @returns {{ changes: Array<{id, name, from, to}>, unknown: Array<{id, name}> }}
 */
export function proposeGroups(products = []) {
  const changes = [];
  const unknown = [];
  for (const p of products || []) {
    if (!p || !p.name) continue;
    const g = classifyProductName(p.name);
    if (g) { if (p.category !== g) changes.push({ id: p.id, name: p.name, from: p.category || "", to: g }); }
    else if (!isGroup(p.category)) unknown.push({ id: p.id, name: p.name });
  }
  return { changes, unknown };
}
