/**
 * graphLayout.js — Distribución del grafo de neuronas (lógica pura, sin dibujar)
 * MemoryCarl / NeuroChat
 *
 * Dos modos:
 *  - "network": red libre. Las conectadas se acercan, el resto se separa; cada nodo
 *    guarda un espacio mínimo para su etiqueta, así no se amontonan.
 *  - "areas": cada dominio (Trabajo, Relaciones, Salud…) forma su propio grupo alrededor
 *    de un centro; las conexiones entre grupos tiran poco, para que los grupos no se mezclen.
 */

export const LAYOUT_MODES = ["network", "areas"];

const LABEL_GAP = 34;       // espacio para el nombre entre nodos vecinos
const SPRING_BASE = 120;

/** Centros de cada dominio en un círculo; el radio de cada grupo crece con su tamaño. */
export function computeAreaAnchors(nodes) {
  const counts = new Map();
  for (const n of nodes) {
    const d = n.domain || "general";
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([domain, count]) => ({
    domain, count, radius: 70 + Math.sqrt(count) * 52,
  }));
  // Empaquetado compacto: el grupo más grande al centro y cada uno siguiente en la posición
  // libre más cercana al centro, tocando a alguno ya puesto (sin anillo vacío en el medio).
  const gap = 130; // deja sitio al halo y al nombre de cada área
  const placed = [];
  const free = (x, y, r) => placed.every((q) => Math.hypot(q.x - x, q.y - y) >= q.radius + r + gap - 0.5);
  for (const g of groups) {
    if (!placed.length) { placed.push({ ...g, x: 0, y: 0 }); continue; }
    let best = null;
    for (const q of placed) {
      for (let k = 0; k < 36; k++) {
        const ang = (k / 36) * Math.PI * 2;
        const d = q.radius + g.radius + gap;
        const x = q.x + Math.cos(ang) * d;
        const y = q.y + Math.sin(ang) * d;
        if (!free(x, y, g.radius)) continue;
        // En el teléfono la vista es más alta que ancha: se prefiere apilar hacia arriba/abajo
        const score = Math.hypot(x * 1.2, y);
        if (!best || score < best.score) best = { x, y, score };
      }
    }
    placed.push({ ...g, x: best ? best.x : 0, y: best ? best.y : 0 });
  }
  const anchors = {};
  for (const g of placed) anchors[g.domain] = { x: g.x, y: g.y, radius: g.radius };
  return anchors;
}

/** Posición inicial de los nodos sin posición. */
export function seedPositions(nodes, edges, pos, { mode = "network", anchors = null } = {}) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source).push(e.target);
    adj.get(e.target).push(e.source);
  }
  const missing = nodes.filter((n) => !pos[n.id]);
  const fresh = missing.length === nodes.length;
  const radius = 80 + Math.sqrt(nodes.length) * 60;
  missing.forEach((n, i) => {
    const angle = i * 2.399963; // ángulo áureo
    if (mode === "areas" && anchors) {
      const a = anchors[n.domain || "general"] || { x: 0, y: 0, radius: 80 };
      const r = a.radius * Math.sqrt(((i % 37) + 0.5) / 37);
      pos[n.id] = { x: a.x + Math.cos(angle) * r, y: a.y + Math.sin(angle) * r };
      return;
    }
    const placed = (adj.get(n.id) || []).map((id) => pos[id]).filter(Boolean);
    if (placed.length && !fresh) {
      const cx = placed.reduce((s, p) => s + p.x, 0) / placed.length;
      const cy = placed.reduce((s, p) => s + p.y, 0) / placed.length;
      pos[n.id] = { x: cx + Math.cos(angle) * 70, y: cy + Math.sin(angle) * 70 };
    } else {
      const r = fresh ? radius * Math.sqrt((i + 0.5) / missing.length) : radius + 60;
      pos[n.id] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    }
  });
  return { fresh, missing };
}

/**
 * Simulación de fuerzas. Mueve `pos` en el lugar; los ids en `pinned` quedan quietos
 * pero siguen empujando a los demás.
 * @param {Array} nodes - { id, domain, numberOfConnections }
 * @param {Array} edges - { source, target }
 * @param {object} pos - id → { x, y }
 * @param {{ mode?: string, pinned?: Set, iterations?: number, sizeOf?: (n)=>number, anchors?: object }} [opts]
 */
export function runForceLayout(nodes, edges, pos, opts = {}) {
  const mode = opts.mode === "areas" ? "areas" : "network";
  const pinned = opts.pinned || new Set();
  const iterations = opts.iterations ?? 300;
  const sizeOf = opts.sizeOf || (() => 12);
  const anchors = mode === "areas" ? opts.anchors || computeAreaAnchors(nodes) : null;

  const live = nodes.filter((n) => pos[n.id]);
  const idx = new Map(live.map((n, i) => [n.id, i]));
  const N = live.length;
  const xs = new Float64Array(N);
  const ys = new Float64Array(N);
  const vx = new Float64Array(N);
  const vy = new Float64Array(N);
  const rad = new Float64Array(N);
  const mass = new Float64Array(N);
  const fixed = new Uint8Array(N);
  const ax = new Float64Array(N);
  const ay = new Float64Array(N);
  const ar = new Float64Array(N); // radio máximo del grupo (modo áreas)
  live.forEach((n, i) => {
    xs[i] = pos[n.id].x;
    ys[i] = pos[n.id].y;
    rad[i] = sizeOf(n);
    mass[i] = 1 + Math.sqrt(n.numberOfConnections || 0) * 0.35;
    fixed[i] = pinned.has(n.id) ? 1 : 0;
    const a = anchors ? anchors[n.domain || "general"] || { x: 0, y: 0 } : { x: 0, y: 0 };
    ax[i] = a.x;
    ay[i] = a.y;
    ar[i] = a.radius || 0;
  });
  const links = [];
  for (const e of edges) {
    const a = idx.get(e.source);
    const b = idx.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const sameArea = live[a].domain === live[b].domain;
    links.push({ a, b, sameArea });
  }
  const deg = new Float64Array(N);
  for (const l of links) { deg[l.a]++; deg[l.b]++; }

  const REPULSION = 2600;
  const GRAVITY = mode === "areas" ? 0.008 : 0.006;
  const DAMPING = 0.78;
  const MAX_SPEED = 22;
  let alpha = 1;

  for (let it = 0; it < iterations; it++) {
    // Repulsión entre todos + espacio mínimo (colisión con margen para la etiqueta)
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = xs[j] - xs[i];
        let dy = ys[j] - ys[i];
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = (i % 7) - 3 + 0.1; dy = (j % 5) - 2 + 0.1; d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2);
        // En "areas" los nodos de grupos distintos se empujan menos de lejos (los separa la gravedad)
        const k = mode === "areas" && live[i].domain !== live[j].domain ? 0.15 : 1;
        let f = (REPULSION * k * mass[i] * mass[j]) / d2;
        const minD = rad[i] + rad[j] + LABEL_GAP;
        if (d < minD) f += (minD - d) * 0.5;
        f *= alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        vx[i] -= fx; vy[i] -= fy;
        vx[j] += fx; vy[j] += fy;
      }
    }
    // Resortes: más largos para los nodos con muchas conexiones (no se apilan alrededor del centro)
    for (const { a, b, sameArea } of links) {
      const dx = xs[b] - xs[a];
      const dy = ys[b] - ys[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = SPRING_BASE + rad[a] + rad[b] + Math.sqrt(deg[a] + deg[b]) * 8;
      const k = mode === "areas" && !sameArea ? 0.004 : 0.05 / Math.sqrt(Math.min(deg[a], deg[b]) || 1);
      const f = (d - rest) * k * alpha;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      vx[a] += fx; vy[a] += fy;
      vx[b] -= fx; vy[b] -= fy;
    }
    for (let i = 0; i < N; i++) {
      if (fixed[i]) { vx[i] = 0; vy[i] = 0; continue; }
      vx[i] = (vx[i] - (xs[i] - ax[i]) * GRAVITY * alpha) * DAMPING;
      vy[i] = (vy[i] - (ys[i] - ay[i]) * GRAVITY * alpha) * DAMPING;
      const s = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      if (s > MAX_SPEED) { vx[i] = (vx[i] / s) * MAX_SPEED; vy[i] = (vy[i] / s) * MAX_SPEED; }
      xs[i] += vx[i];
      ys[i] += vy[i];
      // En "areas" cada nodo se queda dentro de la zona de su grupo
      if (ar[i]) {
        const dx = xs[i] - ax[i];
        const dy = ys[i] - ay[i];
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > ar[i]) { xs[i] = ax[i] + (dx / d) * ar[i]; ys[i] = ay[i] + (dy / d) * ar[i]; }
      }
    }
    alpha = Math.max(0.05, alpha * 0.988);
  }

  live.forEach((n, i) => { pos[n.id] = { x: xs[i], y: ys[i] }; });
  return { anchors };
}

/** Centro y radio de cada dominio según las posiciones actuales (para dibujar su nombre). */
export function areaCentroids(nodes, pos) {
  const acc = new Map();
  for (const n of nodes) {
    const p = pos[n.id];
    if (!p) continue;
    const d = n.domain || "general";
    if (!acc.has(d)) acc.set(d, { domain: d, sx: 0, sy: 0, minY: Infinity, count: 0, pts: [] });
    const g = acc.get(d);
    g.sx += p.x; g.sy += p.y; g.count++;
    g.minY = Math.min(g.minY, p.y);
    g.pts.push(p);
  }
  return [...acc.values()].map((g) => {
    const x = g.sx / g.count;
    const y = g.sy / g.count;
    const r = Math.max(...g.pts.map((p) => Math.hypot(p.x - x, p.y - y)), 30);
    return { domain: g.domain, x, y, r, top: g.minY, count: g.count };
  });
}

/** Distancia mínima entre dos nodos cualquiera (para pruebas y diagnóstico). */
export function minPairDistance(nodes, pos) {
  let best = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = pos[nodes[i].id];
      const b = pos[nodes[j].id];
      if (!a || !b) continue;
      best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return best;
}
