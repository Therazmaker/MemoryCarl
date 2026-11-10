/**
 * finance_commitment_profile_ui.js — Perfil de un compromiso (modal) y minigráfica de tarjeta
 * MemoryCarl · Finanzas
 */

import { buildCommitmentProfile, commitmentMiniStats } from "./finance_commitment_profile.js";

const ui = { templateId: null, selected: null };

function g() {
  return typeof globalThis !== "undefined" ? globalThis : {};
}

function esc(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function fmt(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString("es-PE", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

function data() {
  const st = g().state || {};
  return {
    templates: Array.isArray(st.financeCommitmentTemplates) ? st.financeCommitmentTemplates : [],
    instances: Array.isArray(st.financeCommitmentInstances) ? st.financeCommitmentInstances : [],
    ledger: Array.isArray(st.financeLedger) ? st.financeLedger : [],
  };
}

/** Minigráfica + variación para la tarjeta del compromiso. */
export function commitmentCardSpark(templateId) {
  const { templates, instances, ledger } = data();
  const tpl = templates.find((t) => t.id === templateId);
  if (!tpl) return "";
  const m = commitmentMiniStats(tpl, instances, ledger);
  if (m.paidCount < 2) return "";
  const vals = m.series;
  const max = Math.max(1, ...vals);
  const w = 54;
  const h = 18;
  const step = w / Math.max(1, vals.length - 1);
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
  const d = m.changeVsPrev;
  const badge = d === null || d === 0 ? "" : `<span class="cpDelta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}%</span>`;
  return `<span class="cpSpark"><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="#a78bfa" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>${badge}</span>`;
}

function chartSvg(p) {
  const W = 340;
  const H = 170;
  const padL = 34;
  const padB = 22;
  const padT = 14;
  const n = p.series.length;
  const vals = p.series.flatMap((s) => [s.paid, s.expected || 0]);
  const max = Math.max(1, ...vals) * 1.12;
  const bw = (W - padL - 6) / n;
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, max / 2, max].map((v) => Math.round(v));
  const bars = p.series.map((s, i) => {
    const x = padL + i * bw + bw * 0.18;
    const width = bw * 0.64;
    const top = y(s.paid);
    const sel = ui.selected === s.mk;
    const color = s.paid <= 0 ? "rgba(255,255,255,.08)" : s.onTime === false ? "#fb923c" : s.isCurrent ? "#a78bfa" : "#7c5cff";
    return `<g class="cpBar" onclick="cpSelect('${s.mk}')">
      <rect x="${(padL + i * bw).toFixed(1)}" y="${padT}" width="${bw.toFixed(1)}" height="${H - padT - padB}" fill="transparent"/>
      <rect x="${x.toFixed(1)}" y="${(s.paid > 0 ? top : H - padB - 2).toFixed(1)}" width="${width.toFixed(1)}" height="${(s.paid > 0 ? H - padB - top : 2).toFixed(1)}" rx="3" fill="${color}" ${sel ? 'stroke="#fff" stroke-width="1.5"' : ""}/>
      <text x="${(x + width / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" class="cpAxis ${s.isCurrent ? "cur" : ""}">${esc(s.label.slice(0, 3))}</text>
    </g>`;
  }).join("");
  const exp = p.series.map((s, i) => (s.expected ? `${(padL + i * bw + bw / 2).toFixed(1)},${y(s.expected).toFixed(1)}` : null)).filter(Boolean);
  const avgLine = p.avg ? `<line x1="${padL}" x2="${W - 6}" y1="${y(p.avg).toFixed(1)}" y2="${y(p.avg).toFixed(1)}" stroke="#34d399" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/><text x="${W - 8}" y="${(y(p.avg) - 3).toFixed(1)}" text-anchor="end" class="cpAxis" fill="#34d399">prom.</text>` : "";
  return `<svg class="cpChart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Pagos de los últimos 12 meses">
    ${ticks.map((t) => `<line x1="${padL}" x2="${W - 6}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="rgba(255,255,255,.06)"/><text x="${padL - 4}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end" class="cpAxis">${t >= 1000 ? `${(t / 1000).toFixed(1)}k` : t}</text>`).join("")}
    ${bars}
    ${exp.length > 1 ? `<polyline points="${exp.join(" ")}" fill="none" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="4 3" opacity=".85"/>` : ""}
    ${avgLine}
  </svg>`;
}

function profileHtml() {
  const { templates, instances, ledger } = data();
  const tpl = templates.find((t) => t.id === ui.templateId);
  if (!tpl) return "";
  const p = buildCommitmentProfile(tpl, instances, ledger);
  const sel = p.series.find((s) => s.mk === ui.selected) || p.last || p.series[p.series.length - 1];
  const curInst = instances.find((i) => i.templateId === tpl.id && i.periodKey === p.months[p.months.length - 1]);
  const trendTxt = p.trend === "sube" ? `↗ +S/ ${fmt(Math.abs(p.slope))}/mes` : p.trend === "baja" ? `↘ −S/ ${fmt(Math.abs(p.slope))}/mes` : "→ estable";
  const same = p.max && p.min && Math.abs(p.max.paid - p.min.paid) < 0.01;
  const statusTxt = { paid: "pagado", covered_by_debt: "con deuda", partial: "parcial", pending: "pendiente", overdue: "vencido", postponed: "postergado", cancelled: "cancelado", none: "sin registro" };
  return `
    <div class="cpSheet" role="dialog" aria-label="Perfil de ${esc(tpl.name)}">
      <div class="cpHead">
        <div>
          <div class="cpKind">${esc(tpl.category || "Compromiso")} · día ${Number(tpl.dueDay || 1)} · ${p.variable ? "monto variable" : "monto fijo"}</div>
          <div class="cpTitle">${esc(tpl.name || "Compromiso")}</div>
        </div>
        <button type="button" class="cpX" onclick="cpClose()" aria-label="Cerrar">✕</button>
      </div>

      <div class="cpHero">
        <div><div class="cpBig">S/ ${fmt(p.last?.paid || 0)}</div><div class="cpMuted">último pago${p.last ? ` (${esc(p.last.label)})` : ""}</div></div>
        ${p.changeVsPrev !== null ? `<div class="cpChange ${p.changeVsPrev > 0 ? "up" : p.changeVsPrev < 0 ? "down" : ""}">${p.changeVsPrev > 0 ? "▲" : p.changeVsPrev < 0 ? "▼" : "="} ${Math.abs(p.changeVsPrev)}%<span>vs mes anterior</span></div>` : ""}
      </div>

      ${chartSvg(p)}
      <div class="cpLegend"><span><i style="background:#7c5cff"></i>Pagado</span><span><i style="background:#fb923c"></i>Pagado tarde</span><span><i class="dash" style="border-color:#fbbf24"></i>Esperado</span><span><i class="dash" style="border-color:#34d399"></i>Promedio</span></div>

      ${sel ? `<div class="cpSel">
        <b>${esc(sel.label)}</b> · pagado S/ ${fmt(sel.paid)}${sel.expected !== null ? ` de S/ ${fmt(sel.expected)}` : ""} · ${esc(statusTxt[sel.status] || sel.status)}
        ${sel.paidAt ? ` · el ${new Date(sel.paidAt).getDate()}${sel.onTime === false ? " ⏰ tarde" : sel.onTime ? " ✅ a tiempo" : ""}` : ""}
      </div>` : ""}

      <div class="cpStats">
        <div><b>S/ ${fmt(p.avg)}</b><span>promedio</span></div>
        <div><b>S/ ${fmt(p.max?.paid || 0)}</b><span>más alto${p.max && !same ? ` · ${esc(p.max.label)}` : same ? " · siempre igual" : ""}</span></div>
        <div><b>S/ ${fmt(p.min?.paid || 0)}</b><span>más bajo${p.min && !same ? ` · ${esc(p.min.label)}` : same ? " · siempre igual" : ""}</span></div>
        <div><b>${trendTxt}</b><span>tendencia</span></div>
        <div><b>${p.punctuality === null ? "—" : `${p.punctuality}%`}</b><span>a tiempo${p.timedCount ? ` (${p.onTimeCount}/${p.timedCount})` : ""}</span></div>
        <div><b>S/ ${fmt(p.total12)}</b><span>en 12 meses</span></div>
      </div>

      <div class="cpForecast">🔮 El mes que viene, estimado: <b>S/ ${fmt(p.forecast)}</b>${p.variable ? " (promedio de los últimos 3)" : ""}</div>

      ${p.insights.length ? `<div class="cpInsights">${p.insights.map((i) => `<div class="cpIns cpIns--${i.tone}">${esc(i.text)}</div>`).join("")}</div>` : ""}

      <div class="cpSub">Historial</div>
      <div class="cpHist">
        ${[...p.series].reverse().filter((s) => s.paid > 0 || s.expected !== null).map((s) => `
          <div class="cpRow" onclick="cpSelect('${s.mk}')">
            <span class="cpRowM">${esc(s.label)}</span>
            <span class="cpRowS">${esc(statusTxt[s.status] || s.status)}${s.onTime === false ? " · ⏰" : ""}</span>
            <span class="cpRowA">S/ ${fmt(s.paid)}${s.expected !== null && Math.abs(s.expected - s.paid) > 0.009 ? `<small> / ${fmt(s.expected)}</small>` : ""}</span>
          </div>`).join("") || `<div class="cpMuted">Sin registros todavía.</div>`}
      </div>

      <div class="cpActions">
        ${curInst && !["paid", "covered_by_debt", "cancelled"].includes(String(curInst.status)) ? `<button type="button" class="cpBtn" onclick="cpClose();openFinanceCommitmentPayModal('${esc(curInst.id)}')">💳 Pagar este mes</button>` : ""}
        <button type="button" class="cpBtnGhost" onclick="cpClose();openFinanceCommitmentModalById('${esc(tpl.id)}')">✏️ Editar</button>
      </div>
    </div>`;
}

function render() {
  let host = document.getElementById("cpOverlay");
  if (!ui.templateId) {
    host?.remove();
    return;
  }
  if (!host) {
    host = document.createElement("div");
    host.id = "cpOverlay";
    host.className = "cpOverlay";
    host.addEventListener("click", (e) => { if (e.target === host) actions.cpClose(); });
    document.body.appendChild(host);
  }
  host.innerHTML = `${css()}${profileHtml()}`;
}

const actions = {
  openCommitmentProfile(templateId) {
    ui.templateId = templateId;
    ui.selected = null;
    render();
  },
  cpSelect(mk) {
    ui.selected = mk;
    render();
  },
  cpClose() {
    ui.templateId = null;
    render();
  },
};

if (typeof window !== "undefined") Object.assign(window, actions);

function css() {
  return `<style>
  .cpOverlay { position: fixed; inset: 0; z-index: 9999; background: rgba(5,5,15,.72); backdrop-filter: blur(6px); display: flex; align-items: flex-end; justify-content: center; }
  @media (min-width: 700px) { .cpOverlay { align-items: center; } }
  .cpSheet { width: 100%; max-width: 560px; max-height: 92vh; overflow-y: auto; background: #12102a; border: 1px solid rgba(124,92,255,.35); border-radius: 22px 22px 0 0; padding: 16px 16px 24px; box-sizing: border-box; color: #e5e7eb; }
  @media (min-width: 700px) { .cpSheet { border-radius: 22px; } }
  .cpHead { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
  .cpKind { font-size: 11.5px; color: rgba(255,255,255,.5); }
  .cpTitle { font-size: 22px; font-weight: 800; color: #fff; letter-spacing: -.3px; }
  .cpX { width: 34px; height: 34px; border-radius: 11px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: #e5e7eb; cursor: pointer; flex: none; }
  .cpHero { display: flex; justify-content: space-between; align-items: flex-end; margin: 12px 0 6px; }
  .cpBig { font-size: 28px; font-weight: 800; color: #fff; }
  .cpMuted { font-size: 12px; color: rgba(255,255,255,.5); }
  .cpChange { font-size: 18px; font-weight: 800; text-align: right; display: flex; flex-direction: column; color: #e5e7eb; }
  .cpChange span { font-size: 10.5px; font-weight: 600; color: rgba(255,255,255,.45); }
  .cpChange.up { color: #fb7185; }
  .cpChange.down { color: #34d399; }
  .cpChart { width: 100%; height: 190px; display: block; margin-top: 6px; }
  .cpAxis { font-size: 9px; fill: rgba(255,255,255,.45); }
  .cpAxis.cur { fill: #c4b5fd; font-weight: 700; }
  .cpBar { cursor: pointer; }
  .cpLegend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 10.5px; color: rgba(255,255,255,.6); margin: 2px 0 8px; }
  .cpLegend span { display: inline-flex; align-items: center; gap: 4px; }
  .cpLegend i { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
  .cpLegend i.dash { width: 12px; height: 0; border-top: 2px dashed; border-radius: 0; }
  .cpSel { font-size: 12.5px; background: rgba(124,92,255,.12); border: 1px solid rgba(124,92,255,.3); border-radius: 12px; padding: 8px 10px; }
  .cpStats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
  .cpStats div { background: rgba(255,255,255,.04); border-radius: 12px; padding: 8px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .cpStats b { font-size: 13.5px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cpStats span { font-size: 10.5px; color: rgba(255,255,255,.5); }
  .cpForecast { margin-top: 10px; font-size: 13px; padding: 9px 11px; border-radius: 12px; background: rgba(251,191,36,.08); border: 1px solid rgba(251,191,36,.22); }
  .cpInsights { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .cpIns { font-size: 12.5px; line-height: 1.4; padding: 8px 10px; border-radius: 11px; background: rgba(255,255,255,.04); border-left: 3px solid #94a3b8; }
  .cpIns--up { border-left-color: #fb7185; }
  .cpIns--down, .cpIns--good { border-left-color: #34d399; }
  .cpIns--bad { border-left-color: #fb923c; }
  .cpSub { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: rgba(255,255,255,.5); margin: 14px 0 4px; }
  .cpHist { display: flex; flex-direction: column; }
  .cpRow { display: grid; grid-template-columns: 52px 1fr auto; gap: 8px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.05); font-size: 13px; cursor: pointer; align-items: center; }
  .cpRowM { font-weight: 700; color: #fff; }
  .cpRowS { font-size: 11.5px; color: rgba(255,255,255,.5); }
  .cpRowA { font-weight: 800; color: #fff; text-align: right; }
  .cpRowA small { font-weight: 500; color: rgba(255,255,255,.45); }
  .cpActions { display: flex; gap: 8px; margin-top: 14px; }
  .cpActions > * { flex: 1; }
  .cpBtn { background: #7c5cff; color: #fff; border: none; border-radius: 12px; padding: 11px; font-weight: 800; cursor: pointer; }
  .cpBtnGhost { background: rgba(255,255,255,.06); color: #e5e7eb; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 11px; font-weight: 700; cursor: pointer; }
  .cpSpark { display: inline-flex; align-items: center; gap: 4px; vertical-align: middle; margin-left: 6px; }
  .cpDelta { font-size: 9.5px; font-weight: 800; }
  .cpDelta.up { color: #fb7185; }
  .cpDelta.down { color: #34d399; }
  </style>`;
}

/** Estilos de la minigráfica en las tarjetas (se inyectan una vez). */
export function ensureCommitmentSparkStyles() {
  if (typeof document === "undefined" || document.getElementById("cpSparkStyles")) return;
  const s = document.createElement("style");
  s.id = "cpSparkStyles";
  s.textContent = `.cpSpark{display:inline-flex;align-items:center;gap:4px;vertical-align:middle;margin-left:6px}.cpDelta{font-size:9.5px;font-weight:800}.cpDelta.up{color:#fb7185}.cpDelta.down{color:#34d399}`;
  document.head.appendChild(s);
}
