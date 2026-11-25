/**
 * dailyScales-ui.js — Tarjeta "Bitácora 1–10" del Home
 * Un gráfico de líneas estilo cuaderno: cada línea es una escala del 1 al 10, una columna por día.
 * Sueño y Ánimo salen solos; el resto se marca tocando un día del gráfico (o ＋).
 *
 * ctx (lo pasa main.js) = { sleepLog, moodDaily, moodScoreOf(spriteId), isoDate(Date), onChange() }
 */

import { SCALE_SERIES, loadScales, setDayScales, toggleHidden, buildSeries, fillWithAverage } from "./dailyScalesStore.js";

const RANGE_KEY = "memorycarl_daily_scales_range";
const RANGES = ["month", 7, 14];
const RANGE_LABEL = { month: "Mes", 7: "7d", 14: "14d" };
const DAY_ABBR = ["D", "L", "M", "M", "J", "V", "S"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function getRange() {
  try {
    const v = localStorage.getItem(RANGE_KEY);
    const r = v === "month" ? "month" : Number(v);
    if (RANGES.includes(r)) return r;
  } catch (_e) {}
  return "month";
}
function setRange(n) { try { localStorage.setItem(RANGE_KEY, String(n)); } catch (_e) {} }

// Mes que se está viendo: 0 = el actual, -1 = el anterior… (no se guarda: al volver, es el actual)
let monthOffset = 0;

function monthStart(offset = 0) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 1, 12);
}

/** Todos los días de un mes (los que faltan también). */
function monthDays(isoDate, offset = 0) {
  const first = monthStart(offset);
  const total = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(first.getFullYear(), first.getMonth(), i + 1, 12);
    return { iso: isoDate(d), d };
  });
}

/**
 * Todo lo que se dibuja: días, valores (con huecos rellenados por el promedio) y títulos.
 * En meses pasados todos los días cuentan; en el actual, hasta hoy.
 */
function computeView(ctx, range, offset = 0) {
  const isMonth = range === "month";
  const days = isMonth ? monthDays(ctx.isoDate, offset) : lastDays(range, ctx.isoDate);
  const store = loadScales();
  const series = buildSeries(days.map((d) => d.iso), ctx, store);
  const todayIso = ctx.isoDate(new Date());
  const todayIdx = days.findIndex((d) => d.iso === todayIso);
  const lastPast = days.reduce((k, d, i) => (d.iso <= todayIso ? i : k), -1);
  const filled = {};
  for (const sr of SCALE_SERIES) filled[sr.id] = fillWithAverage(series[sr.id], lastPast);
  const first = days[0]?.d || new Date();
  const title = isMonth ? `${MONTHS_LONG[first.getMonth()]}${first.getFullYear() !== new Date().getFullYear() ? ` ${first.getFullYear()}` : ""}` : `Últimos ${range} días`;
  return { days, store, filled, todayIso, todayIdx, lastPast, title, isMonth };
}

function lastDays(n, isoDate) {
  const out = [];
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push({ iso: isoDate(d), d });
  }
  return out;
}

const fmt = (v) => (v === null || v === undefined ? "–" : Number.isInteger(v) ? String(v) : v.toFixed(1));

function injectStyles() {
  if (document.getElementById("dsc-styles")) return;
  const st = document.createElement("style");
  st.id = "dsc-styles";
  st.textContent = `
  .dsc-card{padding-bottom:12px}
  .dsc-head{display:flex;align-items:center;gap:10px}
  .dsc-title{font-weight:800;font-size:15px}
  .dsc-sub{font-size:12px;color:var(--muted)}
  .dsc-head>div:first-child{min-width:0}
  .dsc-ranges{display:flex;gap:4px;margin-left:auto;flex-shrink:0}
  .dsc-range{white-space:nowrap;border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:3px 9px;font-size:11px;cursor:pointer}
  .dsc-range.on{background:rgba(124,92,255,.22);color:#fff;border-color:rgba(124,92,255,.5)}
  .dsc-add{border:1px solid var(--line);background:var(--card2);color:var(--text);border-radius:12px;width:32px;height:32px;font-size:16px;cursor:pointer;flex-shrink:0}
  .dsc-chart{margin-top:10px;border-radius:14px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);overflow:hidden}
  .dsc-chart svg{display:block;width:100%;height:auto}
  .dsc-hit{cursor:pointer}
  .dsc-hit:hover{fill:rgba(255,255,255,.04)}
  .dsc-legend{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .dsc-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:transparent;color:var(--text);border-radius:999px;padding:4px 9px 4px 7px;font-size:12px;cursor:pointer}
  .dsc-chip .dsc-sw{width:14px;height:3px;border-radius:2px;background:var(--c)}
  .dsc-chip b{font-weight:700;color:var(--c)}
  .dsc-chip b.dsc-avg{font-weight:600;opacity:.75}
  .dsc-chip.off{opacity:.38}
  .dsc-chip.off .dsc-sw{background:transparent;border-top:2px dashed var(--c);height:0}
  .dsc-mnav{display:inline-flex;align-items:center;gap:2px}
  .dsc-mnav b{color:var(--text);font-weight:700}
  .dsc-mbtn{border:0;background:transparent;color:var(--text);font-size:15px;line-height:1;padding:0 6px;cursor:pointer}
  .dsc-mbtn:disabled{opacity:.25;cursor:default}
  .dsc-head .dsc-add + .dsc-add{margin-left:-4px}
  .dsc-empty{font-size:12px;color:var(--muted);margin-top:8px;text-align:center}
  .dsc-modal .dsc-mhead{display:flex;align-items:center;gap:8px;margin-bottom:10px}
  .dsc-modal .dsc-mtitle{flex:1;text-align:center;font-weight:800;font-size:15px;text-transform:capitalize}
  .dsc-nav{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:10px;width:32px;height:32px;cursor:pointer}
  .dsc-nav:disabled{opacity:.3;cursor:default}
  .dsc-row{padding:9px 0;border-top:1px solid rgba(255,255,255,.06)}
  .dsc-rowtop{display:flex;align-items:baseline;gap:6px;font-size:13px}
  .dsc-rowtop .dsc-lbl{font-weight:700;color:var(--c)}
  .dsc-rowtop .dsc-hint{font-size:11px;color:var(--muted);flex:1}
  .dsc-rowtop .dsc-val{font-weight:800;color:var(--c);min-width:22px;text-align:right}
  .dsc-pills{display:grid;grid-template-columns:repeat(10,1fr);gap:4px;margin-top:6px}
  .dsc-pill{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:8px;height:30px;font-size:12px;font-weight:700;cursor:pointer;padding:0}
  .dsc-pill.on{background:var(--c);border-color:var(--c);color:#0b0f19}
  .dsc-pill.under{background:color-mix(in srgb, var(--c) 22%, transparent);color:var(--text)}
  .dsc-auto{font-size:12px;color:var(--muted);margin-top:4px}
  .dsc-actions{display:flex;gap:8px;margin-top:12px}
  .dsc-actions .btn{flex:1}
  `;
  document.head.appendChild(st);
}

/** SVG del gráfico. */
function chartSvg(days, filled, hidden, todayIso, opts = {}) {
  const n = days.length;
  const big = Boolean(opts.big);
  const W = opts.W || 340, H = opts.H || 178;
  const k = big ? Math.max(1.4, Math.min(2.6, Math.min(W / 340, H / 178))) : 1; // escala de letras y trazos
  const L = big ? 26 * k : 20, R = big ? 10 * k : 8, T = big ? 10 * k : 8, B = big ? 26 * k : 26;
  const cw = (W - L - R) / n;
  const x = (i) => L + cw * (i + 0.5);
  const y = (v) => T + (H - T - B) * (1 - (v - 1) / 9);
  const small = n > 14 && !(big && W > 700);

  let g = "";
  // Renglones 1–10
  for (let v = 1; v <= 10; v++) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,${v === 5 ? 0.13 : 0.06})" stroke-width="1"/>`;
    g += `<text x="${L - 5 * k}" y="${y(v) + 3 * k}" text-anchor="end" font-size="${8 * k}" fill="rgba(255,255,255,.4)">${v}</text>`;
  }
  // Columnas de días; los lunes con línea más marcada (corte de semana)
  days.forEach((d, i) => {
    const x0 = L + cw * i;
    const monday = d.d.getDay() === 1;
    if (d.iso > todayIso) g += `<rect x="${x0}" y="${T}" width="${cw}" height="${H - T - B}" fill="rgba(0,0,0,.18)"/>`;
    if (d.iso === todayIso) g += `<rect x="${x0}" y="${T}" width="${cw}" height="${H - T - B}" fill="rgba(124,92,255,.12)"/>`;
    if (i > 0) g += `<line x1="${x0}" x2="${x0}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,${monday ? 0.28 : 0.05})" stroke-width="${monday ? 1.4 : 1}"/>`;
    if (!small || i % 2 === (n - 1) % 2) {
      g += `<text x="${x(i)}" y="${H - B + 11 * k}" text-anchor="middle" font-size="${8.5 * k}" font-weight="${d.iso === todayIso ? 800 : 500}" fill="rgba(255,255,255,${d.iso === todayIso ? 0.95 : 0.6})">${d.d.getDate()}</text>`;
      g += `<text x="${x(i)}" y="${H - B + 21 * k}" text-anchor="middle" font-size="${7 * k}" fill="rgba(255,255,255,.35)">${DAY_ABBR[d.d.getDay()]}</text>`;
    }
  });
  g += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="rgba(255,255,255,.2)"/>`;

  // Líneas (con un trazo un poco tembloroso, como a mano)
  let lines = "";
  for (const s of SCALE_SERIES) {
    if (hidden.includes(s.id)) continue;
    const f = filled[s.id];
    if (f.avg === null) continue;
    const P = f.values.map((v, i) => [x(i).toFixed(1), y(v).toFixed(1)]);
    // Tramos con dato real: trazo lleno. Si toca un día estimado (promedio): punteado y más tenue
    let solid = "", dashed = "";
    for (let i = 1; i < P.length; i++) {
      const seg = `M${P[i - 1][0]},${P[i - 1][1]}L${P[i][0]},${P[i][1]}`;
      if (f.est[i - 1] || f.est[i]) dashed += seg; else solid += seg;
    }
    // En la pantalla grande la línea se dibuja de punta a punta (sin cortes) para animarla
    let grp = "";
    if (big) {
      const full = P.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join("");
      grp += `<path class="dsw-line" d="${full}" fill="none" stroke="${s.color}" stroke-width="${2.2 * k}" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (dashed) grp += `<path class="dsw-est" d="${dashed}" fill="none" stroke="#0b0f19" stroke-width="${1.2 * k}" stroke-dasharray="${2 * k} ${3 * k}" stroke-linecap="butt" opacity=".55"/>`;
    } else {
      if (solid) grp += `<path d="${solid}" fill="none" stroke="${s.color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/>`;
      if (dashed) grp += `<path d="${dashed}" fill="none" stroke="${s.color}" stroke-width="1.3" stroke-dasharray="3 3" stroke-linecap="round" opacity=".45"/>`;
    }
    const r = big ? 2.6 * k : small ? 1.9 : 2.4;
    P.forEach(([px, py], i) => {
      if (!f.est[i]) grp += `<circle class="${big ? "dsw-dot" : ""}" style="${big ? `--d:${(i / P.length).toFixed(3)}` : ""}" cx="${px}" cy="${py}" r="${r}" fill="${s.color}"/>`;
    });
    lines += big ? `<g class="dsw-series" data-series="${s.id}" style="--c:${s.color}">${grp}</g>` : grp;
  }

  // Zonas tocables por día (solo en la tarjeta)
  let hits = "";
  if (!big) days.forEach((d, i) => {
    if (d.iso > todayIso) return; // los días que no han pasado no se marcan
    hits += `<rect class="dsc-hit" data-dsc-day="${d.iso}" x="${L + cw * i}" y="${T}" width="${cw}" height="${H - T}" fill="transparent"><title>${d.d.getDate()} ${MONTHS[d.d.getMonth()]}</title></rect>`;
  });

  const fid = big ? "dswInk" : "dscInk";
  return `<svg viewBox="0 0 ${W.toFixed ? W.toFixed(0) : W} ${H.toFixed ? H.toFixed(0) : H}" role="img" aria-label="Bitácora 1 a 10, ${n} días">
    <defs><filter id="${fid}" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="${big ? 0.6 : 0.9}" numOctaves="1" seed="4"/><feDisplacementMap in="SourceGraphic" scale="${big ? 1.6 * k : 1.4}"/></filter></defs>
    ${g}<g filter="url(#${fid})">${lines}</g>${hits}
  </svg>`;
}

export function renderDailyScalesCard(ctx) {
  injectStyles();
  const range = getRange();
  if (range !== "month") monthOffset = 0;
  const { days, store, filled, todayIso, todayIdx, title, isMonth } = computeView(ctx, range, monthOffset);
  const hasAny = SCALE_SERIES.some((s) => filled[s.id].avg !== null);
  const sub = isMonth
    ? `<span class="dsc-mnav"><button class="dsc-mbtn" data-dsc-month="-1" aria-label="Mes anterior">‹</button><b>${title}</b><button class="dsc-mbtn" data-dsc-month="1" ${monthOffset >= 0 ? "disabled" : ""} aria-label="Mes siguiente">›</button></span>`
    : "Toca un día para marcarlo";

  const chips = SCALE_SERIES.map((s) => {
    const f = filled[s.id];
    const today = todayIdx >= 0 && !f.est[todayIdx] ? f.values[todayIdx] : null; // en meses pasados: el promedio
    const off = store.hidden.includes(s.id);
    const val = today !== null ? ` <b>${fmt(today)}</b>` : f.avg !== null ? ` <b class="dsc-avg">≈${fmt(f.avg)}</b>` : "";
    return `<button class="dsc-chip ${off ? "off" : ""}" data-dsc-toggle="${s.id}" style="--c:${s.color}" title="${off ? "Mostrar" : "Ocultar"} ${s.label}${f.avg !== null ? ` · promedio ${fmt(f.avg)}` : ""}">
      <span class="dsc-sw"></span>${s.icon} ${s.label}${val}
    </button>`;
  }).join("");

  return `
    <section class="card homeCard homeWide dsc-card" id="homeScalesCard">
      <div class="dsc-head">
        <div>
          <div class="dsc-title">📓 Bitácora 1–10</div>
          <div class="dsc-sub">${sub}</div>
        </div>
        <div class="dsc-ranges">
          ${RANGES.map((r) => `<button class="dsc-range ${r === range ? "on" : ""}" data-dsc-range="${r}">${RANGE_LABEL[r]}</button>`).join("")}
        </div>
        <button class="dsc-add" id="btnDscBig" title="Ver en pantalla grande" aria-label="Pantalla grande">⛶</button>
        <button class="dsc-add" id="btnDscToday" title="Marcar hoy">＋</button>
      </div>
      <div class="dsc-chart">${chartSvg(days, filled, store.hidden, todayIso)}</div>
      ${hasAny ? "" : `<div class="dsc-empty">Aún no hay datos. Toca ＋ y marca cómo va tu día del 1 al 10.</div>`}
      <div class="dsc-legend">${chips}</div>
    </section>
  `;
}

export function openDailyScalesModal(iso, ctx) {
  injectStyles();
  const todayIso = ctx.isoDate(new Date());
  const [yy, mm, dd] = iso.split("-").map(Number);
  const date = new Date(yy, mm - 1, dd, 12);
  const store = loadScales();
  const saved = store.days[iso] || {};
  const auto = buildSeries([iso], ctx, store);
  const draft = {};
  for (const s of SCALE_SERIES) if (!s.auto) draft[s.id] = saved[s.id] ?? null;

  const bd = document.createElement("div");
  bd.className = "modalBackdrop";
  const close = () => bd.remove();

  const rowHtml = (s) => {
    if (s.auto) {
      const v = auto[s.id][0];
      return `<div class="dsc-row" style="--c:${s.color}">
        <div class="dsc-rowtop"><span class="dsc-lbl">${s.icon} ${s.label}</span><span class="dsc-hint">${s.hint}</span><span class="dsc-val">${fmt(v)}</span></div>
        ${v === null ? `<div class="dsc-auto">${s.id === "sleep" ? "Sin registro de sueño ese día." : "Sin caras registradas ese día."}</div>` : ""}
      </div>`;
    }
    const v = draft[s.id];
    const fromMood = s.id === "energy" && v === null ? auto.energy[0] : null;
    return `<div class="dsc-row" style="--c:${s.color}" data-dsc-row="${s.id}">
      <div class="dsc-rowtop"><span class="dsc-lbl">${s.icon} ${s.label}</span><span class="dsc-hint">${s.hint}</span><span class="dsc-val">${fmt(v)}</span></div>
      <div class="dsc-pills">${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<button class="dsc-pill ${v === n ? "on" : v !== null && n < v ? "under" : ""}" data-dsc-pick="${s.id}" data-v="${n}">${n}</button>`).join("")}</div>
      ${fromMood !== null ? `<div class="dsc-auto">Sin marcar: el gráfico usa ${fmt(fromMood)} (la energía de tus caras).</div>` : ""}
    </div>`;
  };

  const paint = () => {
    const prev = new Date(date); prev.setDate(date.getDate() - 1);
    const next = new Date(date); next.setDate(date.getDate() + 1);
    bd.innerHTML = `
      <div class="modal dsc-modal" style="max-width:420px">
        <div class="dsc-mhead">
          <button class="dsc-nav" data-dsc-go="${ctx.isoDate(prev)}" aria-label="Día anterior">‹</button>
          <div class="dsc-mtitle">${iso === todayIso ? "Hoy · " : ""}${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}</div>
          <button class="dsc-nav" data-dsc-go="${ctx.isoDate(next)}" ${iso >= todayIso ? "disabled" : ""} aria-label="Día siguiente">›</button>
        </div>
        ${SCALE_SERIES.map(rowHtml).join("")}
        <div class="dsc-actions">
          <button class="btn" data-close>Cancelar</button>
          <button class="btn primary" id="dscSave">Guardar</button>
        </div>
      </div>`;
  };
  paint();

  bd.addEventListener("click", (e) => {
    if (e.target === bd || e.target.closest("[data-close]")) return close();
    const pick = e.target.closest("[data-dsc-pick]");
    if (pick) {
      const id = pick.getAttribute("data-dsc-pick");
      const n = Number(pick.getAttribute("data-v"));
      draft[id] = draft[id] === n ? null : n; // tocar el mismo número lo borra
      const st = bd.querySelector(".modal").scrollTop;
      paint();
      bd.querySelector(".modal").scrollTop = st;
      return;
    }
    const go = e.target.closest("[data-dsc-go]");
    if (go && !go.disabled) {
      setDayScales(iso, draft);
      close();
      openDailyScalesModal(go.getAttribute("data-dsc-go"), ctx);
      ctx.onChange?.();
      return;
    }
    if (e.target.closest("#dscSave")) {
      setDayScales(iso, draft);
      close();
      ctx.onChange?.();
    }
  });
  document.body.appendChild(bd);
}

export function wireDailyScalesCard(root, ctx) {
  const card = root.querySelector("#homeScalesCard");
  if (!card) return;
  card.addEventListener("click", (e) => {
    const r = e.target.closest("[data-dsc-range]");
    if (r) { const v = r.getAttribute("data-dsc-range"); setRange(v === "month" ? "month" : Number(v)); ctx.onChange?.(); return; }
    const t = e.target.closest("[data-dsc-toggle]");
    if (t) { toggleHidden(t.getAttribute("data-dsc-toggle")); ctx.onChange?.(); return; }
    const mb = e.target.closest("[data-dsc-month]");
    if (mb) { if (!mb.disabled) { monthOffset = Math.min(0, monthOffset + Number(mb.getAttribute("data-dsc-month"))); ctx.onChange?.(); } return; }
    if (e.target.closest("#btnDscBig")) { openScalesWallpaper(ctx); return; }
    if (e.target.closest("#btnDscToday")) { openDailyScalesModal(ctx.isoDate(new Date()), ctx); return; }
    const day = e.target.closest("[data-dsc-day]");
    if (day) openDailyScalesModal(day.getAttribute("data-dsc-day"), ctx);
  });
}

// ============================================================================
// Pantalla grande ("wallpaper"): el mes a pantalla completa, con las líneas
// dibujándose solas, fondo que respira y una escala destacada a la vez.
// Tocar la pantalla muestra/oculta los controles; tocar una escala la deja fija.
// ============================================================================

function injectWallpaperStyles() {
  if (document.getElementById("dsw-styles")) return;
  const st = document.createElement("style");
  st.id = "dsw-styles";
  st.textContent = `
  .dsw{position:fixed;inset:0;z-index:9999;background:#070a14;color:#fff;overflow:hidden;display:flex;flex-direction:column;
    padding:max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left));
    animation:dswIn .5s ease both;font-family:inherit;user-select:none;-webkit-user-select:none}
  @keyframes dswIn{from{opacity:0}to{opacity:1}}
  .dsw-bg{position:absolute;inset:-20%;pointer-events:none;filter:blur(40px);opacity:.55}
  .dsw-bg i{position:absolute;width:55%;height:55%;border-radius:50%;background:radial-gradient(circle, var(--c) 0%, transparent 65%);animation:dswFloat 28s ease-in-out infinite alternate}
  .dsw-bg i:nth-child(1){left:0;top:5%;--c:rgba(124,92,255,.55)}
  .dsw-bg i:nth-child(2){right:0;top:30%;--c:rgba(244,114,182,.35);animation-duration:34s;animation-delay:-8s}
  .dsw-bg i:nth-child(3){left:25%;bottom:0;--c:rgba(56,189,248,.3);animation-duration:40s;animation-delay:-15s}
  @keyframes dswFloat{0%{transform:translate(0,0) scale(1)}50%{transform:translate(8%,-6%) scale(1.15)}100%{transform:translate(-6%,8%) scale(.95)}}
  .dsw-stars{position:absolute;inset:0;pointer-events:none;opacity:.5;background-image:radial-gradient(1px 1px at 12% 18%,#fff8,transparent),radial-gradient(1px 1px at 72% 12%,#fff6,transparent),radial-gradient(1.5px 1.5px at 38% 72%,#fff5,transparent),radial-gradient(1px 1px at 88% 64%,#fff7,transparent),radial-gradient(1px 1px at 55% 40%,#fff4,transparent),radial-gradient(1px 1px at 22% 88%,#fff6,transparent);animation:dswTw 6s ease-in-out infinite alternate}
  @keyframes dswTw{from{opacity:.25}to{opacity:.6}}
  .dsw-top,.dsw-legend,.dsw-focus{position:relative;transition:opacity .6s ease, transform .6s ease}
  .dsw-top{display:flex;align-items:center;gap:8px}
  .dsw-title{font-size:clamp(20px,4.5vw,40px);font-weight:800;letter-spacing:-.5px;flex:1;min-width:0}
  .dsw-title small{display:block;font-size:clamp(11px,1.8vw,14px);font-weight:500;opacity:.6;letter-spacing:0}
  .dsw-btn{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:#fff;border-radius:12px;min-width:40px;height:40px;font-size:18px;cursor:pointer;backdrop-filter:blur(6px)}
  .dsw-btn:disabled{opacity:.25}
  .dsw-chart{position:relative;flex:1;min-height:0;margin-top:6px}
  .dsw-chart svg{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);width:100%;height:var(--chart-h,100%)}
  .dsw-series{transition:opacity .9s ease, filter .9s ease}
  .dsw-line{stroke-dasharray:var(--len,3000);stroke-dashoffset:var(--len,3000);animation:dswDraw 2.4s cubic-bezier(.6,.05,.3,1) forwards;animation-delay:var(--delay,0s)}
  @keyframes dswDraw{to{stroke-dashoffset:0}}
  .dsw-est{opacity:0;animation:dswFade .8s ease forwards;animation-delay:calc(var(--delay,0s) + 2.2s)}
  @keyframes dswFade{to{opacity:.55}}
  .dsw-dot{opacity:0;transform-box:fill-box;transform-origin:center;animation:dswPop .5s ease forwards;animation-delay:calc(var(--delay,0s) + var(--d,0) * 2.2s)}
  @keyframes dswPop{0%{opacity:0;transform:scale(0)}70%{opacity:1;transform:scale(1.5)}100%{opacity:1;transform:scale(1)}}
  .dsw.has-focus .dsw-series{opacity:.18}
  .dsw.has-focus .dsw-series.on{opacity:1;filter:drop-shadow(0 0 6px var(--c)) drop-shadow(0 0 14px var(--c))}
  .dsw-focus{position:absolute;right:max(14px, env(safe-area-inset-right));top:calc(max(10px, env(safe-area-inset-top)) + 54px);text-align:right;pointer-events:none}
  .dsw-focus .f-name{font-size:clamp(13px,2.2vw,18px);font-weight:700;color:var(--c)}
  .dsw-focus .f-val{font-size:clamp(34px,8vw,72px);font-weight:900;line-height:1;color:var(--c);text-shadow:0 0 24px var(--c)}
  .dsw-focus .f-sub{font-size:clamp(10px,1.6vw,13px);opacity:.6}
  .dsw-focus.swap{animation:dswSwap .7s ease}
  @keyframes dswSwap{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:none}}
  .dsw-legend{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:6px}
  .dsw-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;border-radius:999px;padding:6px 11px;font-size:13px;cursor:pointer;backdrop-filter:blur(6px)}
  .dsw-chip i{width:16px;height:3px;border-radius:2px;background:var(--c);box-shadow:0 0 8px var(--c)}
  .dsw-chip.on{border-color:var(--c);background:color-mix(in srgb, var(--c) 22%, transparent)}
  .dsw-chip.locked::after{content:"📌";font-size:11px}
  .dsw.idle .dsw-top,.dsw.idle .dsw-legend{opacity:0;transform:translateY(-6px);pointer-events:none}
  .dsw.idle .dsw-legend{transform:translateY(6px)}
  .dsw-rotate{display:none;text-align:center;font-size:12px;opacity:.55;margin-top:4px}
  @media (orientation: portrait){ .dsw-rotate{display:block} }
  .dsw.idle .dsw-rotate{opacity:0}
  .dsw-hint{position:absolute;left:50%;bottom:max(14px, env(safe-area-inset-bottom));transform:translateX(-50%);font-size:12px;opacity:0;pointer-events:none;transition:opacity .6s}
  .dsw.idle .dsw-hint{opacity:.35}
  @media (prefers-reduced-motion: reduce){
    .dsw-bg i,.dsw-stars{animation:none}
    .dsw-line{animation:none;stroke-dashoffset:0}
    .dsw-est,.dsw-dot{animation:none;opacity:1}
  }`;
  document.head.appendChild(st);
}

export function openScalesWallpaper(ctx) {
  injectStyles();
  injectWallpaperStyles();
  let offset = monthOffset;
  let focusIdx = -1;     // escala destacada (en el ciclo)
  let locked = null;     // escala fijada por el usuario
  let cycleTimer = null;
  let idleTimer = null;
  let view = null;

  const el = document.createElement("div");
  el.className = "dsw";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Bitácora en pantalla grande");
  el.innerHTML = `
    <div class="dsw-bg"><i></i><i></i><i></i></div><div class="dsw-stars"></div>
    <div class="dsw-top">
      <button class="dsw-btn" data-w="prev" aria-label="Mes anterior">‹</button>
      <div class="dsw-title"></div>
      <button class="dsw-btn" data-w="next" aria-label="Mes siguiente">›</button>
      <button class="dsw-btn" data-w="close" aria-label="Cerrar">✕</button>
    </div>
    <div class="dsw-focus"></div>
    <div class="dsw-chart"></div>
    <div class="dsw-legend"></div>
    <div class="dsw-rotate">↻ Gira el teléfono para verlo más grande</div>
    <div class="dsw-hint">Toca la pantalla para ver los controles</div>`;
  document.body.appendChild(el);
  const $ = (sel) => el.querySelector(sel);

  // Series con datos este mes (las que se pueden destacar)
  const visibleSeries = () => SCALE_SERIES.filter((sr) => !view.store.hidden.includes(sr.id) && view.filled[sr.id].avg !== null);

  const showFocus = (id, animate = true) => {
    const box = $(".dsw-focus");
    el.querySelectorAll(".dsw-series").forEach((g) => g.classList.toggle("on", g.dataset.series === id));
    el.querySelectorAll(".dsw-chip").forEach((c) => {
      c.classList.toggle("on", c.dataset.id === id);
      c.classList.toggle("locked", c.dataset.id === locked);
    });
    el.classList.toggle("has-focus", Boolean(id));
    const sr = SCALE_SERIES.find((x) => x.id === id);
    if (!sr) { box.innerHTML = ""; return; }
    const f = view.filled[id];
    const today = view.todayIdx >= 0 && !f.est[view.todayIdx] ? f.values[view.todayIdx] : null;
    const realCount = f.est.filter((e, i) => !e && i <= view.lastPast).length;
    box.style.setProperty("--c", sr.color);
    box.innerHTML = `<div class="f-name">${sr.icon} ${sr.label}</div><div class="f-val">${fmt(f.avg)}</div><div class="f-sub">promedio · ${realCount} día${realCount === 1 ? "" : "s"} marcado${realCount === 1 ? "" : "s"}${today !== null ? ` · hoy ${fmt(today)}` : ""}</div>`;
    if (animate) { box.classList.remove("swap"); void box.offsetWidth; box.classList.add("swap"); }
  };

  const nextFocus = () => {
    if (locked) return;
    const list = visibleSeries();
    if (!list.length) return showFocus(null);
    focusIdx = (focusIdx + 1) % list.length;
    showFocus(list[focusIdx].id);
  };

  const startCycle = () => {
    clearInterval(cycleTimer);
    // Primero se ven todas dibujándose; después empieza a destacar de a una
    cycleTimer = setTimeout(() => {
      nextFocus();
      cycleTimer = setInterval(nextFocus, 7000);
    }, 3800);
  };

  const render = () => {
    view = computeView(ctx, "month", offset);
    const marked = SCALE_SERIES.filter((sr) => view.filled[sr.id].avg !== null).length;
    $(".dsw-title").innerHTML = `${view.title}<small>📓 Bitácora 1–10 · ${marked ? "punteado = promedio de los días sin marcar" : "sin datos este mes"}</small>`;
    $('[data-w="next"]').disabled = offset >= 0;
    $(".dsw-legend").innerHTML = visibleSeries().map((sr) => `<button class="dsw-chip" data-id="${sr.id}" style="--c:${sr.color}"><i></i>${sr.icon} ${sr.label}</button>`).join("");
    // Se mide DESPUÉS de poner título y leyenda, para que el gráfico llene lo que queda
    const box = $(".dsw-chart");
    const W = Math.max(320, box.clientWidth);
    // En vertical no se estira hasta el techo: queda proporcionado y centrado (mejor girar el teléfono)
    const H = Math.max(200, Math.min(box.clientHeight, W < box.clientHeight ? W * 1.1 : box.clientHeight));
    box.style.setProperty("--chart-h", `${H}px`);
    box.innerHTML = chartSvg(view.days, view.filled, view.store.hidden, view.todayIso, { big: true, W, H });
    // Largo de cada línea para animar el trazo; cada escala empieza un poco después
    box.querySelectorAll(".dsw-series").forEach((g, i) => {
      const delay = `${(i * 0.18).toFixed(2)}s`;
      g.style.setProperty("--delay", delay);
      const line = g.querySelector(".dsw-line");
      if (line) {
        try { line.style.setProperty("--len", String(Math.ceil(line.getTotalLength()) + 2)); } catch (_e) {}
      }
    });
    focusIdx = -1;
    if (locked && !visibleSeries().some((sr) => sr.id === locked)) locked = null;
    showFocus(locked, false);
    startCycle();
  };

  // Controles: se esconden solos para que quede como fondo de pantalla
  const wake = () => {
    el.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => el.classList.add("idle"), 4500);
  };

  let closed = false;
  const close = (fromBack = false) => {
    if (closed) return;
    closed = true;
    clearInterval(cycleTimer); clearTimeout(cycleTimer); clearTimeout(idleTimer);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("popstate", onBack);
    // Si se cerró con ✕, se quita también el paso que agregamos al historial
    if (!fromBack && history.state?.dsw) { try { history.back(); } catch (_e) {} }
    document.removeEventListener("keydown", onKey);
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_e) {}
    try { screen.orientation?.unlock?.(); } catch (_e) {}
    el.remove();
    monthOffset = offset;
    ctx.onChange?.();
  };

  let rt = null;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(render, 200); };
  const onKey = (e) => {
    if (e.key === "Escape") close(false);
    if (e.key === "ArrowLeft") { offset -= 1; render(); }
    if (e.key === "ArrowRight" && offset < 0) { offset += 1; render(); }
  };
  // El botón "atrás" del teléfono cierra la pantalla grande (en vez de salir de la app)
  const onBack = () => close(true);
  try { history.pushState({ ...(history.state || {}), dsw: true }, ""); } catch (_e) {}
  window.addEventListener("popstate", onBack);
  window.addEventListener("resize", onResize);
  document.addEventListener("keydown", onKey);

  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-w]");
    const chip = e.target.closest(".dsw-chip");
    if (el.classList.contains("idle") && !b && !chip) { wake(); return; }
    wake();
    if (b) {
      const w = b.dataset.w;
      if (w === "close") return close(false);
      if (w === "prev") { offset -= 1; render(); }
      if (w === "next" && offset < 0) { offset += 1; render(); }
      return;
    }
    if (chip) {
      const id = chip.dataset.id;
      locked = locked === id ? null : id;
      clearInterval(cycleTimer); clearTimeout(cycleTimer);
      if (locked) showFocus(locked);
      else { showFocus(null); startCycle(); }
    }
  });

  // Pantalla completa de verdad (si el teléfono lo deja) y, si se puede, horizontal
  try {
    const req = el.requestFullscreen?.({ navigationUI: "hide" });
    req?.then?.(() => { try { screen.orientation?.lock?.("landscape").catch(() => {}); } catch (_e) {} }).catch?.(() => {});
  } catch (_e) {}
  requestAnimationFrame(() => { render(); wake(); });
}
