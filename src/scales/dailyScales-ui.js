/**
 * dailyScales-ui.js — Tarjeta "Bitácora 1–10" del Home
 * Un gráfico de líneas estilo cuaderno: cada línea es una escala del 1 al 10, una columna por día.
 * Sueño y Ánimo salen solos; el resto se marca tocando un día del gráfico (o ＋).
 *
 * ctx (lo pasa main.js) = { sleepLog, moodDaily, moodScoreOf(spriteId), isoDate(Date), onChange() }
 */

import { SCALE_SERIES, loadScales, setDayScales, toggleHidden, buildSeries } from "./dailyScalesStore.js";

const RANGE_KEY = "memorycarl_daily_scales_range";
const RANGES = [7, 14, 30];
const DAY_ABBR = ["D", "L", "M", "M", "J", "V", "S"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function getRange() {
  try { const n = Number(localStorage.getItem(RANGE_KEY)); if (RANGES.includes(n)) return n; } catch (_e) {}
  return 14;
}
function setRange(n) { try { localStorage.setItem(RANGE_KEY, String(n)); } catch (_e) {} }

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
  .dsc-ranges{display:flex;gap:4px;margin-left:auto}
  .dsc-range{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:3px 9px;font-size:11px;cursor:pointer}
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
  .dsc-chip.off{opacity:.38}
  .dsc-chip.off .dsc-sw{background:transparent;border-top:2px dashed var(--c);height:0}
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
function chartSvg(days, series, hidden, todayIso) {
  const n = days.length;
  const W = 340, H = 178, L = 20, R = 8, T = 8, B = 26;
  const cw = (W - L - R) / n;
  const x = (i) => L + cw * (i + 0.5);
  const y = (v) => T + (H - T - B) * (1 - (v - 1) / 9);
  const small = n > 14;

  let g = "";
  // Renglones 1–10
  for (let v = 1; v <= 10; v++) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,${v === 5 ? 0.13 : 0.06})" stroke-width="1"/>`;
    g += `<text x="${L - 5}" y="${y(v) + 3}" text-anchor="end" font-size="8" fill="rgba(255,255,255,.4)">${v}</text>`;
  }
  // Columnas de días; los lunes con línea más marcada (corte de semana)
  days.forEach((d, i) => {
    const x0 = L + cw * i;
    const monday = d.d.getDay() === 1;
    if (d.iso === todayIso) g += `<rect x="${x0}" y="${T}" width="${cw}" height="${H - T - B}" fill="rgba(124,92,255,.12)"/>`;
    if (i > 0) g += `<line x1="${x0}" x2="${x0}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,${monday ? 0.28 : 0.05})" stroke-width="${monday ? 1.4 : 1}"/>`;
    if (!small || i % 2 === (n - 1) % 2) {
      g += `<text x="${x(i)}" y="${H - B + 11}" text-anchor="middle" font-size="8.5" font-weight="${d.iso === todayIso ? 800 : 500}" fill="rgba(255,255,255,${d.iso === todayIso ? 0.95 : 0.6})">${d.d.getDate()}</text>`;
      g += `<text x="${x(i)}" y="${H - B + 21}" text-anchor="middle" font-size="7" fill="rgba(255,255,255,.35)">${DAY_ABBR[d.d.getDay()]}</text>`;
    }
  });
  g += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="rgba(255,255,255,.2)"/>`;

  // Líneas (con un trazo un poco tembloroso, como a mano)
  let lines = "";
  for (const s of SCALE_SERIES) {
    if (hidden.includes(s.id)) continue;
    const vals = series[s.id];
    // Se une a través de un día vacío suelto (como en el papel); se corta si faltan 2 o más
    const pts = [];
    let seg = [];
    let gap = 0;
    vals.forEach((v, i) => {
      if (v === null) { gap++; if (gap >= 2 && seg.length) { pts.push(seg); seg = []; } return; }
      gap = 0;
      seg.push([x(i), y(v)]);
    });
    if (seg.length) pts.push(seg);
    for (const sg of pts) {
      if (sg.length > 1) {
        lines += `<polyline points="${sg.map((p) => p.map((c) => c.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="${s.color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/>`;
      }
      for (const [px, py] of sg) lines += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${small ? 1.8 : 2.4}" fill="${s.color}"/>`;
    }
  }

  // Zonas tocables por día
  let hits = "";
  days.forEach((d, i) => {
    hits += `<rect class="dsc-hit" data-dsc-day="${d.iso}" x="${L + cw * i}" y="${T}" width="${cw}" height="${H - T}" fill="transparent"><title>${d.d.getDate()} ${MONTHS[d.d.getMonth()]}</title></rect>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bitácora 1 a 10 de los últimos ${n} días">
    <defs><filter id="dscInk" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="4"/><feDisplacementMap in="SourceGraphic" scale="1.4"/></filter></defs>
    ${g}<g filter="url(#dscInk)">${lines}</g>${hits}
  </svg>`;
}

export function renderDailyScalesCard(ctx) {
  injectStyles();
  const range = getRange();
  const days = lastDays(range, ctx.isoDate);
  const store = loadScales();
  const series = buildSeries(days.map((d) => d.iso), ctx, store);
  const todayIso = ctx.isoDate(new Date());
  const hasAny = SCALE_SERIES.some((s) => series[s.id].some((v) => v !== null));
  const lastIdx = days.length - 1;

  const chips = SCALE_SERIES.map((s) => {
    const today = series[s.id][lastIdx];
    const off = store.hidden.includes(s.id);
    return `<button class="dsc-chip ${off ? "off" : ""}" data-dsc-toggle="${s.id}" style="--c:${s.color}" title="${off ? "Mostrar" : "Ocultar"} ${s.label}">
      <span class="dsc-sw"></span>${s.icon} ${s.label}${today !== null ? ` <b>${fmt(today)}</b>` : ""}
    </button>`;
  }).join("");

  return `
    <section class="card homeCard homeWide dsc-card" id="homeScalesCard">
      <div class="dsc-head">
        <div>
          <div class="dsc-title">📓 Bitácora 1–10</div>
          <div class="dsc-sub">Toca un día para marcarlo</div>
        </div>
        <div class="dsc-ranges">
          ${RANGES.map((r) => `<button class="dsc-range ${r === range ? "on" : ""}" data-dsc-range="${r}">${r}d</button>`).join("")}
        </div>
        <button class="dsc-add" id="btnDscToday" title="Marcar hoy">＋</button>
      </div>
      <div class="dsc-chart">${chartSvg(days, series, store.hidden, todayIso)}</div>
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
    if (r) { setRange(Number(r.getAttribute("data-dsc-range"))); ctx.onChange?.(); return; }
    const t = e.target.closest("[data-dsc-toggle]");
    if (t) { toggleHidden(t.getAttribute("data-dsc-toggle")); ctx.onChange?.(); return; }
    if (e.target.closest("#btnDscToday")) { openDailyScalesModal(ctx.isoDate(new Date()), ctx); return; }
    const day = e.target.closest("[data-dsc-day]");
    if (day) openDailyScalesModal(day.getAttribute("data-dsc-day"), ctx);
  });
}
