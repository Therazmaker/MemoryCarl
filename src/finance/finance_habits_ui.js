/**
 * finance_habits_ui.js — Pestaña "🧠 Mapa Neuronal" de Finanzas
 * MemoryCarl · Finanzas
 *
 * Resumen del mes en frases, insights, mapa con zoom (hábitos, personas y pozos) y
 * tarjetas por neurona con su detalle: historial, renombrar, unir y marcar necesario/evitable.
 * Las preferencias viven en state.financeMeta.habitPrefs (se sincronizan con finance_extras).
 */

import { buildFinanceNeurons, summarizeFinanceNeurons, normalizePrefs, HABIT_TAGS } from "./finance_habits.js";

const META_KEY = "memorycarl_v2_finance_meta";
const PERSON_COLOR = "#f472b6";
const POOL_COLOR = "#fbbf24";

const ui = {
  selected: null, // key de la neurona abierta
  filter: "all", // all | expense | income | people
  renaming: false,
  merging: false,
  showAll: false,
};

const graph = {
  canvas: null,
  nodes: [],
  edges: [],
  byKey: new Map(),
  cam: { x: 0, y: 0, z: 1 },
  pointers: new Map(),
  pinch: null,
  drag: null,
  moved: false,
  raf: 0,
};

function g() {
  return typeof globalThis !== "undefined" ? globalThis : {};
}

function esc(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `S/ ${v % 1 === 0 ? v : v.toFixed(2)}`;
}

function ledger() {
  const st = g().state || {};
  if (Array.isArray(st.financeLedger)) return st.financeLedger;
  if (Array.isArray(g().window?.FINANCE?.state?.movements)) return g().window.FINANCE.state.movements;
  return [];
}

function accounts() {
  return Array.isArray(g().state?.financeAccounts) ? g().state.financeAccounts : [];
}

export function loadHabitPrefs() {
  return normalizePrefs(g().state?.financeMeta?.habitPrefs);
}

function saveHabitPrefs(prefs) {
  const st = g().state;
  if (!st) return;
  st.financeMeta = { ...(st.financeMeta || {}), habitPrefs: normalizePrefs(prefs) };
  try { localStorage.setItem(META_KEY, JSON.stringify(st.financeMeta)); } catch (_e) {}
  try { g().window?.dbService?.scheduleSync?.(); } catch (_e) {}
}

function model() {
  const prefs = loadHabitPrefs();
  const m = buildFinanceNeurons(ledger(), { prefs, accounts: accounts() });
  return { m, s: summarizeFinanceNeurons(m, { prefs }), prefs };
}

function rerender() {
  if (typeof g().view === "function") g().view();
}

function tagOf(n) {
  return HABIT_TAGS[n.tag] || HABIT_TAGS.variable;
}

function nodeColor(key, m) {
  if (key.startsWith("p:")) return PERSON_COLOR;
  if (key.startsWith("w:")) return POOL_COLOR;
  const n = m.neurons.find((x) => x.key === key);
  return n ? tagOf(n).color : "#94a3b8";
}

function sparkline(series, color) {
  const max = Math.max(1, ...series);
  const w = 72;
  const h = 22;
  const step = w / Math.max(1, series.length - 1);
  const pts = series.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
  return `<svg class="fnhSpark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function deltaBadge(n) {
  if (n.delta === null) return n.thisMonth > 0 && n.prevMonth === 0 ? `<span class="fnhDelta fnhDelta--new">nuevo</span>` : "";
  if (n.delta === 0) return `<span class="fnhDelta">=</span>`;
  const up = n.delta > 0;
  // Más gasto = rojo; más ingreso = verde
  const good = n.kind === "income" ? up : !up;
  return `<span class="fnhDelta ${good ? "fnhDelta--good" : "fnhDelta--bad"}">${up ? "▲" : "▼"} ${Math.abs(n.delta)}%</span>`;
}

function freqLabel(n) {
  if (n.count30 >= 2) return `${n.count30} veces en 30 días`;
  if (n.perWeek >= 1) return `${n.perWeek} por semana`;
  return `${n.count} ${n.count === 1 ? "vez" : "veces"}`;
}

function renderCard(n) {
  const t = tagOf(n);
  return `
    <button type="button" class="fnhCard" onclick="fnhSelect('${esc(n.key)}')">
      <div class="fnhCardTop">
        <span class="fnhTag" style="--c:${t.color}">${t.emoji} ${t.label}</span>
        ${n.verdict ? `<span class="fnhVerdict fnhVerdict--${n.verdict}">${n.verdict === "evitable" ? "Evitable" : "Necesario"}</span>` : ""}
      </div>
      <div class="fnhCardName">${esc(n.label)}</div>
      <div class="fnhCardRow">
        <div>
          <div class="fnhCardAmount">${money(n.thisMonth)}</div>
          <div class="fnhCardSub">este mes ${deltaBadge(n)}</div>
        </div>
        ${sparkline(n.series, t.color)}
      </div>
      <div class="fnhCardSub">${esc(freqLabel(n))} · ${money(n.avg)} c/u</div>
    </button>`;
}

/** Solo hay deuda si hubo un préstamo o un fiado; si no, es gasto compartido con esa persona. */
function personHeadline(p) {
  const bal = p.balance;
  if (!(p.loans || p.fiados)) return p.given ? `Gastaste ${money(p.given)} con ${p.label}` : `Te dio ${money(p.received)}`;
  return bal > 0 ? `Te debe ${money(bal)}` : bal < 0 ? `Le debes ${money(-bal)}` : "A mano";
}

function renderPersonCard(p) {
  return `
    <button type="button" class="fnhCard" onclick="fnhSelect('${esc(p.key)}')">
      <div class="fnhCardTop"><span class="fnhTag" style="--c:${PERSON_COLOR}">👤 Persona</span></div>
      <div class="fnhCardName">${esc(p.label)}</div>
      <div class="fnhCardAmount" style="font-size:16px">${esc(personHeadline(p))}</div>
      <div class="fnhCardSub">Diste ${money(p.given)} · recibiste ${money(p.received)} · ${p.count} mov.</div>
    </button>`;
}

function movementRow(mv, m, poolsById) {
  const d = new Date(mv.date);
  const date = d.toLocaleDateString("es", { day: "2-digit", month: "short" });
  const name = String(mv.note || "").split(" · ")[0] || mv.category || "";
  const extra = String(mv.note || "").split(" · ").slice(1).join(" · ");
  const pool = mv.sourceMovementId && poolsById.get(mv.sourceMovementId);
  const bits = [
    mv.counterparty ? `👤 ${esc(mv.counterparty)}` : "",
    mv.reason && mv.reason !== "normal" ? `🎯 ${esc(mv.reason)}` : "",
    pool ? `🪣 ${esc(pool.label)}` : "",
    mv.isLoan ? "🤝 préstamo" : "",
    mv.isFiado ? "📝 fiado" : "",
  ].filter(Boolean).join(" · ");
  return `<div class="fnhMov">
    <span class="fnhMovDate">${esc(date)}</span>
    <span class="fnhMovBody"><b>${esc(name)}</b>${extra ? ` <span class="fnhMuted">${esc(extra)}</span>` : ""}${bits ? `<br><span class="fnhMuted">${bits}</span>` : ""}</span>
    <span class="fnhMovAmt ${mv.type === "income" ? "fnhIn" : ""}">${mv.type === "income" ? "+" : "−"}${money(Math.abs(Number(mv.amount) || 0))}</span>
  </div>`;
}

function topEntries(obj, n = 3) {
  return Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function renderDetail(m) {
  const key = ui.selected;
  if (!key) return "";
  const byId = new Map(ledger().map((x) => [x.id, x]));
  const poolsById = new Map(m.pools.map((p) => [p.id, p]));
  const close = `<button type="button" class="fnhIconBtn" onclick="fnhSelect(null)" aria-label="Cerrar">✕</button>`;

  if (key.startsWith("p:") || key.startsWith("w:")) {
    const isPerson = key.startsWith("p:");
    const item = isPerson ? m.people.find((p) => p.key === key) : m.pools.find((p) => p.key === key);
    if (!item) return "";
    const ids = isPerson ? item.movementIds : ledger().filter((x) => x && !x.archived && (x.id === item.id || x.sourceMovementId === item.id || x.parentPoolId === item.id)).sort((a, b) => new Date(b.date) - new Date(a.date)).map((x) => x.id);
    const linked = m.edges.filter((e) => e.from === key || e.to === key).map((e) => (e.from === key ? e.to : e.from));
    const habits = linked.map((k) => m.neurons.find((n) => n.key === k)).filter(Boolean);
    return `
      <div class="fnhSheet" role="dialog">
        <div class="fnhSheetHead">
          <div><div class="fnhSheetKind">${isPerson ? "👤 Persona" : "🪣 Pozo"}</div><div class="fnhSheetTitle">${esc(item.label)}</div></div>
          ${close}
        </div>
        <div class="fnhStats">
          ${isPerson
            ? `<div><b>${money(item.given)}</b><span>le diste</span></div><div><b>${money(item.received)}</b><span>te dio</span></div>${item.loans || item.fiados ? `<div><b>${money(Math.abs(item.balance))}</b><span>${item.balance >= 0 ? "te debe" : "le debes"}</span></div>` : `<div><b>${item.count}</b><span>movimientos</span></div>`}`
            : `<div><b>${money(item.totalIn)}</b><span>entró</span></div><div><b>${money(item.spent)}</b><span>gastado</span></div><div><b>${money(item.remaining)}</b><span>queda</span></div>`}
        </div>
        ${habits.length ? `<div class="fnhSubTitle">Conectado con</div><div class="fnhChips">${habits.map((h) => `<button type="button" class="fnhChip" style="--c:${tagOf(h).color}" onclick="fnhSelect('${esc(h.key)}')">${esc(h.label)}</button>`).join("")}</div>` : ""}
        <div class="fnhSubTitle">Movimientos</div>
        ${ids.slice(0, 12).map((id) => byId.get(id)).filter(Boolean).map((mv) => movementRow(mv, m, poolsById)).join("") || `<div class="fnhMuted">Sin movimientos.</div>`}
      </div>`;
  }

  const n = m.neurons.find((x) => x.key === key);
  if (!n) return "";
  const t = tagOf(n);
  const linked = m.edges.filter((e) => e.from === key || e.to === key);
  const chips = linked.map((e) => {
    const other = e.from === key ? e.to : e.from;
    const label = other.startsWith("p:") ? `👤 ${m.people.find((p) => p.key === other)?.label || ""}`
      : other.startsWith("w:") ? `🪣 ${m.pools.find((p) => p.key === other)?.label || ""}`
      : `${m.neurons.find((x) => x.key === other)?.label || other}${e.kind === "together" ? ` · ${e.count} días juntos` : ""}`;
    return `<button type="button" class="fnhChip" style="--c:${nodeColor(other, m)}" onclick="fnhSelect('${esc(other)}')">${esc(label)}</button>`;
  }).join("");
  const reasons = topEntries(n.reasons).map(([r, c]) => `${esc(r)} ${c}`).join(" · ");
  const accs = topEntries(n.accounts, 2).map(([a]) => esc(a)).join(", ");
  const payers = { me: "Yo", wife: "Esposa", shared: "Compartido", other: "Otro" };
  const payer = topEntries(n.paidBy, 2).map(([p, c]) => `${payers[p] || esc(p)} ${c}`).join(" · ");
  const mergeTargets = m.neurons.filter((x) => x.key !== key && x.kind === n.kind);

  return `
    <div class="fnhSheet" role="dialog">
      <div class="fnhSheetHead">
        <div>
          <div class="fnhSheetKind"><span class="fnhTag" style="--c:${t.color}">${t.emoji} ${t.label}</span> <span class="fnhMuted">${esc(n.category)}</span></div>
          ${ui.renaming
            ? `<div class="fnhRename"><input id="fnhRenameInput" class="fnhInput" value="${esc(n.label)}" maxlength="40"/><button type="button" class="fnhBtn" onclick="fnhRename('${esc(key)}')">Guardar</button></div>`
            : `<div class="fnhSheetTitle">${esc(n.label)} <button type="button" class="fnhLink" onclick="fnhStartRename()">✎</button></div>`}
        </div>
        ${close}
      </div>
      <div class="fnhStats">
        <div><b>${money(n.thisMonth)}</b><span>este mes ${deltaBadge(n)}</span></div>
        <div><b>${money(n.prevMonth)}</b><span>mes pasado</span></div>
        <div><b>${money(n.avg)}</b><span>promedio</span></div>
      </div>
      <div class="fnhBars">
        ${n.series.map((v, i) => {
          const max = Math.max(1, ...n.series);
          const [y, mo] = n.months[i].split("-");
          const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("es", { month: "short" });
          return `<div class="fnhBar"><i style="height:${Math.round((v / max) * 100)}%;background:${t.color}"></i><span>${esc(label)}</span></div>`;
        }).join("")}
      </div>
      <div class="fnhFacts">
        <div>🔁 ${esc(freqLabel(n))}</div>
        ${reasons ? `<div>🎯 Motivos: ${reasons}</div>` : ""}
        ${payer ? `<div>💳 Pagó: ${payer}${accs ? ` · ${accs}` : ""}</div>` : ""}
      </div>
      ${n.kind === "expense" ? `
      <div class="fnhSubTitle">¿Cómo lo ves?</div>
      <div class="fnhSeg">
        <button type="button" class="${n.verdict === "necesario" ? "on" : ""}" onclick="fnhVerdict('${esc(key)}','necesario')">✅ Necesario</button>
        <button type="button" class="${n.verdict === "evitable" ? "on" : ""}" onclick="fnhVerdict('${esc(key)}','evitable')">✂️ Evitable</button>
      </div>` : ""}
      ${chips ? `<div class="fnhSubTitle">Conexiones</div><div class="fnhChips">${chips}</div>` : ""}
      <div class="fnhSubTitle">Historial</div>
      ${n.movementIds.slice(0, 12).map((id) => byId.get(id)).filter(Boolean).map((mv) => movementRow(mv, m, poolsById)).join("")}
      ${n.count > 12 ? `<div class="fnhMuted" style="padding:6px 0">y ${n.count - 12} más</div>` : ""}
      <div class="fnhSubTitle">Unir con otra neurona</div>
      ${ui.merging
        ? `<div class="fnhRename"><select id="fnhMergeSelect" class="fnhInput">${mergeTargets.map((x) => `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join("")}</select><button type="button" class="fnhBtn" onclick="fnhMerge('${esc(key)}')">Unir</button></div>
           <div class="fnhMuted" style="margin-top:4px">Los movimientos de ${esc(n.label)} pasan a la neurona elegida.</div>`
        : `<button type="button" class="fnhLink" onclick="fnhStartMerge()">Unir ${esc(n.label)} con…</button>`}
      ${Object.keys(loadHabitPrefs().merges).some((k) => loadHabitPrefs().merges[k] === key) ? `<button type="button" class="fnhLink" onclick="fnhUnmerge('${esc(key)}')">Separar lo que uní aquí</button>` : ""}
    </div>`;
}

export function renderFinanceHabitsTab() {
  const { m, s } = model();
  const expenses = m.neurons.filter((n) => n.kind === "expense");
  const incomes = m.neurons.filter((n) => n.kind === "income");
  const empty = !m.neurons.length;
  const monthName = new Date().toLocaleDateString("es", { month: "long" });

  let cards = "";
  if (ui.filter === "people") cards = m.people.map(renderPersonCard).join("") || `<div class="fnhEmpty">Aún no hay personas. Al registrar un movimiento, marca "Persona" para verlas aquí.</div>`;
  else {
    const list = ui.filter === "income" ? incomes : ui.filter === "expense" ? expenses : [...expenses, ...incomes];
    const active = list.filter((n) => n.thisMonth > 0 || n.prevMonth > 0);
    const shown = ui.showAll ? list : (active.length ? active : list).slice(0, 12);
    cards = shown.map(renderCard).join("") || `<div class="fnhEmpty">Sin neuronas en este filtro.</div>`;
    if (!ui.showAll && list.length > shown.length) cards += `<button type="button" class="fnhMore" onclick="fnhShowAll()">Ver las ${list.length} neuronas</button>`;
  }

  return `
    <section class="finSection fnhWrap">
      ${css()}
      <div class="finSectionHead">
        <div class="finSectionTitle">🧠 Mapa Neuronal</div>
      </div>
      ${empty ? `<div class="fnhEmpty">Registra algunos movimientos con nombre (ej. "Café", "Taxi", "Netflix") y aquí aparecerán tus hábitos de dinero, las personas y los pozos conectados.</div>` : `
      <div class="fnhSummary">
        <div class="fnhSummaryTop">
          <div><div class="fnhBig">${money(s.spent)}</div><div class="fnhMuted">gastado en ${esc(monthName)}${s.prevSpent ? ` · mes pasado ${money(s.prevSpent)}` : ""}</div></div>
          ${s.earned ? `<div style="text-align:right"><div class="fnhBig fnhIn">${money(s.earned)}</div><div class="fnhMuted">entró</div></div>` : ""}
        </div>
        ${s.lines.map((l) => `<button type="button" class="fnhLine" ${l.key ? `onclick="fnhSelect('${esc(l.key)}')"` : ""}>${l.icon} ${esc(l.text)}</button>`).join("")}
      </div>

      ${s.insights.length ? `<div class="fnhInsights">${s.insights.slice(0, 4).map((i) => `
        <div class="fnhInsight fnhInsight--${i.priority}">
          <div class="fnhInsightBody" ${i.key ? `onclick="fnhSelect('${esc(i.key)}')"` : ""}><b>${esc(i.title)}</b><br>${esc(i.text)}</div>
          <button type="button" class="fnhIconBtn" onclick="fnhDismiss('${esc(i.id)}')" aria-label="Descartar">✕</button>
        </div>`).join("")}</div>` : ""}

      <div class="fnhMapWrap">
        <canvas id="fnhMap" class="fnhMap"></canvas>
        <div class="fnhMapCtl">
          <button type="button" class="fnhIconBtn" onclick="fnhZoom(1.3)" aria-label="Acercar">＋</button>
          <button type="button" class="fnhIconBtn" onclick="fnhZoom(1/1.3)" aria-label="Alejar">－</button>
          <button type="button" class="fnhIconBtn" onclick="fnhFit()" aria-label="Ver todo">⤢</button>
        </div>
        <div class="fnhLegend">
          ${["fijo", "suscripcion", "hormiga", "antojo", "esencial", "variable", "ingreso"].map((k) => `<span><i style="background:${HABIT_TAGS[k].color}"></i>${HABIT_TAGS[k].label}</span>`).join("")}
          <span><i style="background:${PERSON_COLOR}"></i>Persona</span><span><i style="background:${POOL_COLOR}"></i>Pozo</span>
        </div>
        <div class="fnhMuted fnhMapHint">Pellizca para acercar · toca una neurona para ver su detalle</div>
      </div>

      <div class="fnhFilters">
        ${[["all", "Todo"], ["expense", "Gastos"], ["income", "Ingresos"], ["people", `Personas${m.people.length ? ` (${m.people.length})` : ""}`]].map(([k, l]) => `<button type="button" class="${ui.filter === k ? "on" : ""}" onclick="fnhFilter('${k}')">${l}</button>`).join("")}
      </div>
      <div class="fnhCards">${cards}</div>
      `}
      ${empty ? "" : renderDetail(m)}
    </section>`;
}

// ---------------------------------------------------------------- Mapa (canvas)

function buildGraphData(m) {
  const nodes = [];
  const recent = m.neurons.filter((n) => n.series.some((v) => v > 0)).slice(0, 40);
  const keep = new Set(recent.map((n) => n.key));
  const maxTotal = Math.max(1, ...recent.map((n) => n.series.reduce((a, b) => a + b, 0)));
  for (const n of recent) {
    const total = n.series.reduce((a, b) => a + b, 0);
    nodes.push({ key: n.key, label: n.label, color: tagOf(n).color, r: 10 + 26 * Math.sqrt(total / maxTotal), kind: n.kind });
  }
  const linked = m.edges.filter((e) => keep.has(e.from) || keep.has(e.to));
  const extra = new Set(linked.flatMap((e) => [e.from, e.to]).filter((k) => !keep.has(k)));
  for (const p of m.people.filter((x) => extra.has(x.key)).slice(0, 15)) {
    nodes.push({ key: p.key, label: p.label, color: PERSON_COLOR, r: 9 + Math.min(10, p.count), kind: "person" });
  }
  for (const p of m.pools.filter((x) => extra.has(x.key)).slice(0, 10)) {
    nodes.push({ key: p.key, label: p.label, color: POOL_COLOR, r: 12 + Math.min(14, Math.sqrt(p.totalIn) / 4), kind: "pool" });
  }
  const has = new Set(nodes.map((n) => n.key));
  const edges = m.edges.filter((e) => has.has(e.from) && has.has(e.to));
  return { nodes, edges };
}

/** Posiciones fijas: simulación de fuerzas corta y determinista (no se mueve después). */
function layout(nodes, edges) {
  const n = nodes.length;
  nodes.forEach((node, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    const ring = node.kind === "person" ? 260 : node.kind === "pool" ? 200 : node.kind === "income" ? 170 : 80 + (i % 3) * 40;
    node.x = Math.cos(a) * ring;
    node.y = Math.sin(a) * ring;
  });
  const idx = new Map(nodes.map((node, i) => [node.key, i]));
  for (let it = 0; it < 260; it++) {
    const cool = 1 - it / 260;
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy || 0.01;
        const min = a.r + b.r + 28;
        const f = (min * min) / d2 * 0.9 * cool;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        a.x += dx * f; a.y += dy * f;
        b.x -= dx * f; b.y -= dy * f;
      }
    }
    for (const e of edges) {
      const a = nodes[idx.get(e.from)];
      const b = nodes[idx.get(e.to)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const want = a.r + b.r + 60;
      const f = ((d - want) / d) * 0.05 * cool;
      a.x += dx * f; a.y += dy * f;
      b.x -= dx * f; b.y -= dy * f;
    }
    for (const node of nodes) {
      node.x *= 0.995;
      node.y *= 0.995;
    }
  }
}

function worldToScreen(x, y) {
  const c = graph.canvas;
  return [(x - graph.cam.x) * graph.cam.z + c.clientWidth / 2, (y - graph.cam.y) * graph.cam.z + c.clientHeight / 2];
}

function screenToWorld(sx, sy) {
  const c = graph.canvas;
  return [(sx - c.clientWidth / 2) / graph.cam.z + graph.cam.x, (sy - c.clientHeight / 2) / graph.cam.z + graph.cam.y];
}

function fit() {
  const c = graph.canvas;
  if (!c || !graph.nodes.length) return;
  const xs = graph.nodes.flatMap((n) => [n.x - n.r, n.x + n.r]);
  const ys = graph.nodes.flatMap((n) => [n.y - n.r, n.y + n.r]);
  const w = Math.max(...xs) - Math.min(...xs) + 60;
  const h = Math.max(...ys) - Math.min(...ys) + 60;
  graph.cam.x = (Math.max(...xs) + Math.min(...xs)) / 2;
  graph.cam.y = (Math.max(...ys) + Math.min(...ys)) / 2;
  graph.cam.z = Math.min(2.5, Math.max(0.2, Math.min(c.clientWidth / w, c.clientHeight / h)));
}

function draw() {
  graph.raf = 0;
  const c = graph.canvas;
  if (!c || !c.isConnected) return;
  const dpr = Math.min(2, g().devicePixelRatio || 1);
  const W = c.clientWidth;
  const H = c.clientHeight;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const sel = ui.selected;
  const near = new Set();
  if (sel) {
    near.add(sel);
    for (const e of graph.edges) {
      if (e.from === sel) near.add(e.to);
      if (e.to === sel) near.add(e.from);
    }
  }
  const z = graph.cam.z;
  for (const e of graph.edges) {
    const a = graph.byKey.get(e.from);
    const b = graph.byKey.get(e.to);
    if (!a || !b) continue;
    const [x1, y1] = worldToScreen(a.x, a.y);
    const [x2, y2] = worldToScreen(b.x, b.y);
    const on = !sel || (near.has(e.from) && near.has(e.to) && (e.from === sel || e.to === sel));
    ctx.strokeStyle = e.kind === "person" ? PERSON_COLOR : e.kind === "pool" ? POOL_COLOR : "#cbd5e1";
    ctx.globalAlpha = on ? (sel ? 0.85 : 0.35) : 0.06;
    ctx.lineWidth = Math.max(1, Math.min(4, (e.kind === "together" ? e.count / 2 : 1 + Math.log10(1 + e.amount))) * Math.min(1.5, z));
    if (e.kind === "together") ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const n of graph.nodes) {
    const [x, y] = worldToScreen(n.x, n.y);
    const r = n.r * z;
    if (x < -r - 80 || x > W + r + 80 || y < -r - 40 || y > H + r + 40) continue;
    const dim = sel && !near.has(n.key);
    ctx.globalAlpha = dim ? 0.18 : 1;
    ctx.fillStyle = n.color;
    ctx.beginPath();
    if (n.kind === "pool") ctx.roundRect?.(x - r, y - r, r * 2, r * 2, r * 0.35) ?? ctx.rect(x - r, y - r, r * 2, r * 2);
    else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (n.key === sel) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (n.kind === "person") {
      ctx.fillStyle = "#1f0a16";
      ctx.font = `${Math.max(9, r * 0.9)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("👤", x, y + 1);
    }
    const showLabel = r >= 9 || n.key === sel || near.has(n.key);
    if (showLabel) {
      ctx.fillStyle = dim ? "rgba(255,255,255,.3)" : "#f8fafc";
      ctx.font = `600 ${Math.round(Math.min(15, Math.max(10, 9 + z * 2)))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label;
      ctx.fillText(label, x, y + r + 4);
    }
  }
  ctx.globalAlpha = 1;
}

function requestDraw() {
  if (!graph.raf) graph.raf = requestAnimationFrame(draw);
}

function hit(sx, sy) {
  const [wx, wy] = screenToWorld(sx, sy);
  let best = null;
  let bestD = Infinity;
  for (const n of graph.nodes) {
    const d = Math.hypot(n.x - wx, n.y - wy);
    const reach = n.r + 10 / graph.cam.z;
    if (d <= reach && d < bestD) { best = n; bestD = d; }
  }
  return best;
}

function zoomAround(sx, sy, factor) {
  const [wx, wy] = screenToWorld(sx, sy);
  graph.cam.z = Math.min(4, Math.max(0.15, graph.cam.z * factor));
  const [nx, ny] = screenToWorld(sx, sy);
  graph.cam.x += wx - nx;
  graph.cam.y += wy - ny;
  requestDraw();
}

function wireCanvas(c) {
  const pos = (e) => {
    const r = c.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  c.addEventListener("pointerdown", (e) => {
    c.setPointerCapture?.(e.pointerId);
    graph.pointers.set(e.pointerId, pos(e));
    graph.moved = false;
    if (graph.pointers.size === 2) {
      const [a, b] = [...graph.pointers.values()];
      graph.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: graph.cam.z };
    } else {
      graph.drag = { start: pos(e), cam: { ...graph.cam } };
    }
  });
  c.addEventListener("pointermove", (e) => {
    if (!graph.pointers.has(e.pointerId)) return;
    graph.pointers.set(e.pointerId, pos(e));
    if (graph.pointers.size === 2 && graph.pinch) {
      const [a, b] = [...graph.pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const target = Math.min(4, Math.max(0.15, graph.pinch.z * (d / Math.max(1, graph.pinch.d))));
      zoomAround(mid[0], mid[1], target / graph.cam.z);
      graph.moved = true;
      return;
    }
    if (graph.drag) {
      const [x, y] = pos(e);
      const dx = x - graph.drag.start[0];
      const dy = y - graph.drag.start[1];
      if (Math.abs(dx) + Math.abs(dy) > 6) graph.moved = true;
      graph.cam.x = graph.drag.cam.x - dx / graph.cam.z;
      graph.cam.y = graph.drag.cam.y - dy / graph.cam.z;
      requestDraw();
    }
  });
  const end = (e) => {
    const wasTap = graph.pointers.size === 1 && !graph.moved;
    const p = graph.pointers.get(e.pointerId);
    graph.pointers.delete(e.pointerId);
    if (graph.pointers.size < 2) graph.pinch = null;
    if (!graph.pointers.size) graph.drag = null;
    if (wasTap && p && e.type === "pointerup") {
      const n = hit(p[0], p[1]);
      g().fnhSelect?.(n ? n.key : null);
    }
  };
  c.addEventListener("pointerup", end);
  c.addEventListener("pointercancel", end);
  c.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [x, y] = pos(e);
    zoomAround(x, y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
}

let lastSignature = "";

/** Se llama después de cada render de la pestaña. */
export function initFinanceHabitsMap() {
  const c = typeof document !== "undefined" ? document.getElementById("fnhMap") : null;
  if (!c) return;
  const { m } = model();
  const { nodes, edges } = buildGraphData(m);
  const signature = nodes.map((n) => `${n.key}:${Math.round(n.r)}`).join(",") + "|" + edges.length;
  const reuse = signature === lastSignature && graph.nodes.length;
  if (reuse) {
    // Misma red: se conservan posiciones y cámara
    const old = new Map(graph.nodes.map((n) => [n.key, n]));
    nodes.forEach((n) => { const o = old.get(n.key); n.x = o.x; n.y = o.y; });
  } else {
    layout(nodes, edges);
  }
  graph.canvas = c;
  graph.nodes = nodes;
  graph.edges = edges;
  graph.byKey = new Map(nodes.map((n) => [n.key, n]));
  graph.pointers.clear();
  wireCanvas(c);
  if (!reuse) fit();
  lastSignature = signature;
  if (!nodes.length) {
    c.style.display = "none";
    return;
  }
  requestDraw();
  // Al abrir una neurona, se centra en ella
  const sel = ui.selected && graph.byKey.get(ui.selected);
  if (sel && reuse) {
    graph.cam.x = sel.x;
    graph.cam.y = sel.y;
    graph.cam.z = Math.max(graph.cam.z, 1.1);
    requestDraw();
  }
}

// ---------------------------------------------------------------- Acciones

function scrollToSheet() {
  setTimeout(() => {
    try { document.querySelector(".fnhSheet")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_e) {}
  }, 60);
}

const actions = {
  fnhSelect(key) {
    ui.selected = key || null;
    ui.renaming = false;
    ui.merging = false;
    rerender();
    if (key) scrollToSheet();
  },
  fnhFilter(f) {
    ui.filter = f;
    ui.showAll = false;
    rerender();
  },
  fnhShowAll() {
    ui.showAll = true;
    rerender();
  },
  fnhVerdict(key, v) {
    const p = loadHabitPrefs();
    // null (no borrar) para que al sincronizar no vuelva el valor viejo de la nube
    p.verdicts[key] = p.verdicts[key] === v ? null : v;
    saveHabitPrefs(p);
    rerender();
  },
  fnhStartRename() {
    ui.renaming = true;
    rerender();
    setTimeout(() => document.getElementById("fnhRenameInput")?.focus(), 30);
  },
  fnhRename(key) {
    const val = String(document.getElementById("fnhRenameInput")?.value || "").trim().slice(0, 40);
    const p = loadHabitPrefs();
    p.labels[key] = val || null;
    saveHabitPrefs(p);
    ui.renaming = false;
    rerender();
  },
  fnhStartMerge() {
    ui.merging = true;
    rerender();
  },
  fnhMerge(key) {
    const target = document.getElementById("fnhMergeSelect")?.value;
    if (!target || target === key) return;
    const p = loadHabitPrefs();
    p.merges[key] = target;
    // Lo que apuntaba a la neurona unida ahora apunta al destino
    for (const k of Object.keys(p.merges)) if (p.merges[k] === key) p.merges[k] = target;
    if (p.merges[target]) p.merges[target] = null;
    saveHabitPrefs(p);
    ui.merging = false;
    ui.selected = target;
    rerender();
  },
  fnhUnmerge(key) {
    const p = loadHabitPrefs();
    for (const k of Object.keys(p.merges)) if (p.merges[k] === key) p.merges[k] = null;
    saveHabitPrefs(p);
    rerender();
  },
  fnhDismiss(id) {
    const p = loadHabitPrefs();
    if (!p.dismissed.includes(id)) p.dismissed = [...p.dismissed, id].slice(-200);
    saveHabitPrefs(p);
    rerender();
  },
  fnhZoom(f) {
    const c = graph.canvas;
    if (c) zoomAround(c.clientWidth / 2, c.clientHeight / 2, f);
  },
  fnhFit() {
    fit();
    requestDraw();
  },
};

if (typeof window !== "undefined") Object.assign(window, actions);

function css() {
  return `<style id="fnhStyles">
  .fnhWrap { position: relative; }
  .fnhMuted { font-size: 12px; opacity: .6; }
  .fnhIn { color: #4ade80; }
  .fnhEmpty { padding: 18px; border: 1px dashed rgba(255,255,255,.15); border-radius: 14px; font-size: 13px; opacity: .75; line-height: 1.5; text-align: center; }
  .fnhSummary { background: linear-gradient(150deg, rgba(124,92,255,.18), rgba(255,255,255,.03)); border: 1px solid rgba(124,92,255,.3); border-radius: 18px; padding: 14px; display: flex; flex-direction: column; gap: 6px; }
  .fnhSummaryTop { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 4px; }
  .fnhBig { font-size: 24px; font-weight: 800; letter-spacing: -.5px; }
  .fnhLine { text-align: left; background: rgba(0,0,0,.18); border: 1px solid rgba(255,255,255,.06); color: inherit; border-radius: 12px; padding: 9px 11px; font-size: 13.5px; line-height: 1.35; cursor: pointer; }
  .fnhInsights { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
  .fnhInsight { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,.04); border-left: 3px solid #94a3b8; font-size: 13px; line-height: 1.4; }
  .fnhInsight--alto { border-left-color: #f87171; }
  .fnhInsight--medio { border-left-color: #fbbf24; }
  .fnhInsight--bajo { border-left-color: #60a5fa; }
  .fnhInsightBody { flex: 1; cursor: pointer; }
  .fnhIconBtn { flex: none; width: 30px; height: 30px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: #e5e7eb; cursor: pointer; font-size: 14px; }
  .fnhMapWrap { position: relative; margin-top: 14px; border-radius: 18px; overflow: hidden; background: radial-gradient(circle at 50% 40%, #1b1640, #0b0b18 75%); border: 1px solid rgba(255,255,255,.08); }
  .fnhMap { display: block; width: 100%; height: 340px; touch-action: none; cursor: grab; }
  .fnhMapCtl { position: absolute; top: 10px; right: 10px; display: flex; flex-direction: column; gap: 6px; }
  .fnhLegend { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 8px 12px 0; font-size: 11px; opacity: .8; }
  .fnhLegend span { display: inline-flex; align-items: center; gap: 4px; }
  .fnhLegend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .fnhMapHint { padding: 4px 12px 10px; font-size: 11px; }
  .fnhFilters { display: flex; gap: 6px; margin: 14px 0 10px; overflow-x: auto; }
  .fnhFilters button { flex: none; border-radius: 20px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: #d1d5db; padding: 6px 12px; font-size: 13px; cursor: pointer; }
  .fnhFilters button.on { background: #7c5cff; border-color: #7c5cff; color: #fff; font-weight: 700; }
  .fnhCards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .fnhCard { text-align: left; color: inherit; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 11px; display: flex; flex-direction: column; gap: 4px; cursor: pointer; min-width: 0; }
  .fnhCardTop { display: flex; gap: 4px; flex-wrap: wrap; }
  .fnhTag { font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 10px; color: var(--c); background: color-mix(in srgb, var(--c) 18%, transparent); white-space: nowrap; }
  .fnhVerdict { font-size: 10.5px; padding: 2px 7px; border-radius: 10px; background: rgba(255,255,255,.08); }
  .fnhVerdict--evitable { color: #fca5a5; }
  .fnhVerdict--necesario { color: #86efac; }
  .fnhCardName { font-weight: 700; font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fnhCardRow { display: flex; justify-content: space-between; align-items: flex-end; gap: 6px; }
  .fnhCardAmount { font-size: 18px; font-weight: 800; }
  .fnhCardSub { font-size: 11.5px; opacity: .65; }
  .fnhSpark { flex: none; opacity: .9; }
  .fnhDelta { font-size: 10.5px; font-weight: 700; margin-left: 2px; }
  .fnhDelta--bad { color: #f87171; }
  .fnhDelta--good { color: #4ade80; }
  .fnhDelta--new { color: #fbbf24; }
  .fnhMore { grid-column: 1 / -1; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: #e5e7eb; padding: 9px; cursor: pointer; }
  .fnhSheet { margin-top: 14px; padding: 14px; border-radius: 18px; background: #14122a; border: 1px solid rgba(124,92,255,.4); box-shadow: 0 10px 30px rgba(0,0,0,.35); scroll-margin-top: 70px; }
  .fnhSheetHead { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
  .fnhSheetKind { font-size: 12px; margin-bottom: 4px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .fnhSheetTitle { font-size: 20px; font-weight: 800; }
  .fnhStats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 12px 0 8px; }
  .fnhStats div { background: rgba(255,255,255,.05); border-radius: 12px; padding: 8px; display: flex; flex-direction: column; gap: 2px; }
  .fnhStats b { font-size: 15px; }
  .fnhStats span { font-size: 11px; opacity: .65; }
  .fnhBars { display: flex; gap: 6px; height: 70px; align-items: flex-end; margin: 6px 0 10px; }
  .fnhBar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 3px; }
  .fnhBar i { width: 100%; border-radius: 6px 6px 2px 2px; min-height: 2px; opacity: .85; }
  .fnhBar span { font-size: 10px; opacity: .55; }
  .fnhFacts { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; opacity: .85; }
  .fnhSubTitle { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; opacity: .55; margin: 14px 0 6px; }
  .fnhSeg { display: flex; gap: 6px; }
  .fnhSeg button { flex: 1; padding: 9px; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: #e5e7eb; cursor: pointer; font-size: 13px; }
  .fnhSeg button.on { background: rgba(124,92,255,.35); border-color: #7c5cff; font-weight: 700; }
  .fnhChips { display: flex; flex-wrap: wrap; gap: 6px; }
  .fnhChip { font-size: 12px; padding: 5px 10px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--c) 55%, transparent); background: color-mix(in srgb, var(--c) 14%, transparent); color: #f1f5f9; cursor: pointer; }
  .fnhMov { display: grid; grid-template-columns: 52px 1fr auto; gap: 8px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.06); font-size: 13px; align-items: start; }
  .fnhMovDate { font-size: 11.5px; opacity: .55; padding-top: 1px; }
  .fnhMovBody { min-width: 0; word-break: break-word; }
  .fnhMovAmt { font-weight: 700; white-space: nowrap; }
  .fnhRename { display: flex; gap: 6px; margin-top: 4px; }
  .fnhInput { flex: 1; min-width: 0; background: rgba(0,0,0,.3); color: #fff; border: 1px solid rgba(255,255,255,.15); border-radius: 10px; padding: 8px 10px; font-size: 14px; }
  .fnhBtn { background: #7c5cff; color: #fff; border: none; border-radius: 10px; padding: 8px 14px; font-weight: 700; cursor: pointer; }
  .fnhLink { background: none; border: none; color: #a78bfa; cursor: pointer; font-size: 13px; padding: 4px 0; }
  </style>`;
}
