/**
 * MemoryCarl · Dream Journal Pro
 * v1.0.0 — 2026
 *
 * Reemplaza openSleepModal() y openSleepHistoryModal() con versiones pro.
 * Agrega: tipo de sueño, emociones al despertar, narrativa del sueño,
 * tags de símbolos, lucidez, y análisis visual por patrones.
 *
 * Retrocompatible: los registros viejos (totalMinutes, quality, note, start, end)
 * siguen funcionando. Los campos nuevos son opcionales.
 */

// ─── Constantes del sistema ────────────────────────────────────────────────

const DREAM_TYPES = [
  { id: "normal",     label: "Normal",     icon: "🌙" },
  { id: "lucid",      label: "Lúcido",     icon: "✨" },
  { id: "nightmare",  label: "Pesadilla",  icon: "😨" },
  { id: "recurring",  label: "Recurrente", icon: "🔄" },
  { id: "vivid",      label: "Vívido",     icon: "🎨" },
  { id: "prophetic",  label: "Profético",  icon: "🔮" },
];

const WAKE_EMOTIONS = [
  { id: "calm",       label: "Calma",      icon: "🌊" },
  { id: "anxious",    label: "Ansioso",    icon: "😰" },
  { id: "happy",      label: "Feliz",      icon: "😊" },
  { id: "confused",   label: "Confundido", icon: "🌀" },
  { id: "energized",  label: "Energizado", icon: "⚡" },
  { id: "melancholy", label: "Melancólico",icon: "🌧️" },
  { id: "inspired",   label: "Inspirado",  icon: "💡" },
  { id: "scared",     label: "Asustado",   icon: "😱" },
];

const SYMBOL_PRESETS = [
  "agua", "fuego", "vuelo", "caída", "persecución", "casa", "muerte",
  "animal", "luz", "oscuridad", "transformación", "viaje", "persona desconocida",
  "perderse", "dientes", "examen", "dinero", "amor", "guerra", "naturaleza",
];

const CLARITY_LEVELS = [
  { v: 1, label: "Borroso" },
  { v: 2, label: "Parcial" },
  { v: 3, label: "Claro"   },
  { v: 4, label: "Vívido"  },
  { v: 5, label: "Hiper-real" },
];

// ─── Helpers locales ────────────────────────────────────────────────────────

function _djpEsc(str) {
  return String(str ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function _djpUid() {
  return "djp_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

function _djpIsoDate(d) {
  const dt = d || new Date();
  return dt.toISOString().slice(0, 10);
}

function _djpCalcMinutes(dateStr, startStr, endStr) {
  if (!dateStr || !startStr || !endStr) return 0;
  const [sh, sm] = startStr.split(":").map(Number);
  const [eh, em] = endStr.split(":").map(Number);
  if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return 0;
  const s = new Date(`${dateStr}T00:00:00`);
  s.setHours(sh, sm, 0, 0);
  const e = new Date(`${dateStr}T00:00:00`);
  e.setHours(eh, em, 0, 0);
  if (e <= s) e.setDate(e.getDate() + 1);
  return Math.round((e - s) / 60000);
}

function _djpFmt(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (!h) return `${min}m`;
  if (!min) return `${h}h`;
  return `${h}h ${String(min).padStart(2,"0")}m`;
}

function _djpAnimate(el, props, opts = {}) {
  if (typeof window.anime === "function") {
    window.anime({ targets: el, ...props, ...opts });
  }
}

function _djpNormalize(e) {
  if (!e || typeof e !== "object") return null;
  const date = String(e.date || "").slice(0, 10);
  const totalMinutes = Number(e.totalMinutes ?? e.total_minutes ?? 0);
  if (!date || !Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
  return {
    id: String(e.id || _djpUid()),
    ts: String(e.ts || new Date().toISOString()),
    date,
    totalMinutes: Math.round(totalMinutes),
    quality: (e.quality == null || e.quality === "") ? null : Number(e.quality),
    note: String(e.note || ""),
    mode: String(e.mode || "simple"),
    start: e.start ? String(e.start) : "",
    end: e.end ? String(e.end) : "",
    // campos pro
    dreamType: e.dreamType ? String(e.dreamType) : "",
    wakeEmotion: e.wakeEmotion ? String(e.wakeEmotion) : "",
    narrative: String(e.narrative || ""),
    symbols: Array.isArray(e.symbols) ? e.symbols.map(String) : [],
    clarity: (e.clarity == null || e.clarity === "") ? null : Number(e.clarity),
    lucidMoment: Boolean(e.lucidMoment),
  };
}

// ─── CSS inyectado ──────────────────────────────────────────────────────────

function _djpInjectStyles() {
  if (document.getElementById("djp-styles")) return;
  const style = document.createElement("style");
  style.id = "djp-styles";
  style.textContent = `
/* ── Dream Journal Pro ── */
.djp-backdrop {
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(6,5,15,0.82);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 12px;
}
.djp-panel {
  width: 100%; max-width: 520px;
  max-height: 92vh; overflow-y: auto;
  background: #0d0c1a;
  border: 1px solid rgba(124,92,255,0.22);
  border-radius: 20px;
  padding: 24px 22px 28px;
  position: relative;
  box-shadow: 0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(124,92,255,0.08);
  scrollbar-width: thin;
  scrollbar-color: rgba(124,92,255,.3) transparent;
  opacity: 0; transform: translateY(18px);
}
.djp-panel.visible {
  opacity: 1; transform: translateY(0);
  transition: opacity .22s ease, transform .22s ease;
}
.djp-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  margin-bottom: 18px;
}
.djp-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 26px; letter-spacing: 1.5px;
  color: #fff; line-height: 1;
}
.djp-sub {
  font-size: 12px; color: rgba(255,255,255,.4);
  margin-top: 4px; font-family: 'JetBrains Mono', monospace;
}
.djp-close {
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.1);
  color: rgba(255,255,255,.6);
  border-radius: 10px; width: 32px; height: 32px;
  cursor: pointer; font-size: 16px; display: flex;
  align-items: center; justify-content: center;
  transition: background .15s;
  flex-shrink: 0;
}
.djp-close:hover { background: rgba(255,255,255,.12); color: #fff; }

/* Sections */
.djp-section {
  margin-bottom: 18px;
}
.djp-label {
  font-size: 10px; font-weight: 700;
  letter-spacing: 1.2px; text-transform: uppercase;
  color: rgba(124,92,255,.8);
  margin-bottom: 8px;
  font-family: 'JetBrains Mono', monospace;
}

/* Pill grids */
.djp-pill-grid {
  display: flex; flex-wrap: wrap; gap: 7px;
}
.djp-pill {
  padding: 7px 13px; border-radius: 20px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.04);
  color: rgba(255,255,255,.75);
  font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all .15s;
  display: flex; align-items: center; gap: 5px;
  white-space: nowrap;
}
.djp-pill:hover {
  border-color: rgba(124,92,255,.4);
  background: rgba(124,92,255,.1);
}
.djp-pill.active {
  border-color: rgba(124,92,255,.7);
  background: rgba(124,92,255,.22);
  color: #fff;
}

/* Clarity slider */
.djp-clarity-row {
  display: flex; gap: 6px; align-items: stretch;
}
.djp-clarity-btn {
  flex: 1; padding: 8px 4px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,.1);
  background: rgba(255,255,255,.04);
  color: rgba(255,255,255,.5);
  font-size: 10px; font-weight: 700;
  text-align: center; cursor: pointer;
  transition: all .15s; line-height: 1.2;
}
.djp-clarity-btn:hover { border-color: rgba(124,92,255,.4); }
.djp-clarity-btn.active {
  border-color: rgba(124,92,255,.7);
  background: rgba(124,92,255,.22);
  color: #fff;
}

/* Symbol tags */
.djp-symbol-input-row {
  display: flex; gap: 8px; margin-bottom: 8px;
}
.djp-symbol-input {
  flex: 1; background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 10px; padding: 9px 12px;
  color: #fff; font-size: 13px;
  outline: none; transition: border-color .15s;
}
.djp-symbol-input:focus { border-color: rgba(124,92,255,.5); }
.djp-symbol-add {
  background: rgba(124,92,255,.2);
  border: 1px solid rgba(124,92,255,.4);
  border-radius: 10px; padding: 9px 14px;
  color: #fff; font-weight: 700; cursor: pointer;
  font-size: 16px; transition: background .15s;
}
.djp-symbol-add:hover { background: rgba(124,92,255,.35); }
.djp-symbol-tag {
  padding: 5px 10px; border-radius: 14px;
  background: rgba(124,92,255,.15);
  border: 1px solid rgba(124,92,255,.3);
  color: rgba(255,255,255,.8);
  font-size: 11px; font-weight: 600;
  display: flex; align-items: center; gap: 5px;
  cursor: default;
}
.djp-symbol-remove {
  background: none; border: none;
  color: rgba(255,255,255,.4);
  cursor: pointer; font-size: 13px;
  padding: 0; line-height: 1;
  transition: color .12s;
}
.djp-symbol-remove:hover { color: #ff6b6b; }
.djp-preset-hint {
  font-size: 10px; color: rgba(255,255,255,.3);
  margin-bottom: 6px;
}
.djp-preset-grid {
  display: flex; flex-wrap: wrap; gap: 5px;
  margin-bottom: 10px;
}
.djp-preset-chip {
  padding: 4px 9px; border-radius: 12px;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.08);
  color: rgba(255,255,255,.45);
  font-size: 10px; cursor: pointer;
  transition: all .12s;
}
.djp-preset-chip:hover {
  background: rgba(124,92,255,.12);
  border-color: rgba(124,92,255,.3);
  color: rgba(255,255,255,.8);
}

/* Narrative */
.djp-narrative {
  width: 100%;
  min-height: 90px;
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 12px;
  padding: 11px 13px;
  color: #fff; font-size: 13px;
  line-height: 1.55; resize: none;
  outline: none; box-sizing: border-box;
  transition: border-color .15s;
  font-family: 'DM Sans', sans-serif;
}
.djp-narrative:focus { border-color: rgba(124,92,255,.5); }

/* Sleep timing row */
.djp-timing-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}
.djp-field label {
  display: block; font-size: 10px;
  color: rgba(255,255,255,.45); margin-bottom: 5px;
  font-family: 'JetBrains Mono', monospace; font-weight: 600;
  letter-spacing: .8px;
}
.djp-field input, .djp-field select {
  width: 100%; background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 10px; padding: 9px 11px;
  color: #fff; font-size: 13px; outline: none;
  box-sizing: border-box; transition: border-color .15s;
  appearance: none; -webkit-appearance: none;
}
.djp-field input:focus, .djp-field select:focus {
  border-color: rgba(124,92,255,.5);
}
.djp-field select option { background: #1a1828; }
.djp-field input[type="date"]::-webkit-calendar-picker-indicator {
  filter: invert(.6);
}

/* Footer */
.djp-footer {
  display: flex; gap: 10px;
  justify-content: flex-end; margin-top: 22px;
}
.djp-btn {
  padding: 10px 20px; border-radius: 12px;
  font-weight: 700; font-size: 13px;
  cursor: pointer; transition: all .15s;
  border: 1px solid rgba(255,255,255,.15);
  background: rgba(255,255,255,.06); color: #fff;
}
.djp-btn:hover { background: rgba(255,255,255,.12); }
.djp-btn.primary {
  background: rgba(124,92,255,.3);
  border-color: rgba(124,92,255,.6);
  color: #fff;
}
.djp-btn.primary:hover { background: rgba(124,92,255,.5); }

/* Lucid toggle */
.djp-lucid-toggle {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: 12px;
  border: 1px solid rgba(255,255,255,.1);
  background: rgba(255,255,255,.03);
  cursor: pointer; transition: all .15s;
}
.djp-lucid-toggle:hover {
  border-color: rgba(124,92,255,.3);
  background: rgba(124,92,255,.07);
}
.djp-lucid-toggle.active {
  border-color: rgba(124,92,255,.6);
  background: rgba(124,92,255,.15);
}
.djp-lucid-icon { font-size: 18px; }
.djp-lucid-text { flex: 1; }
.djp-lucid-title {
  font-weight: 700; font-size: 13px; color: #fff;
}
.djp-lucid-desc {
  font-size: 11px; color: rgba(255,255,255,.4); margin-top: 2px;
}
.djp-lucid-check {
  width: 20px; height: 20px;
  border-radius: 6px;
  border: 1px solid rgba(124,92,255,.4);
  background: rgba(124,92,255,.1);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: rgba(124,92,255,.8);
}
.djp-lucid-toggle.active .djp-lucid-check {
  background: rgba(124,92,255,.4);
  color: #fff;
}

/* ── History Modal ─────────────────────────────────────────── */
.djp-hist-panel {
  width: 100%; max-width: 580px;
  max-height: 92vh; overflow: hidden;
  display: flex; flex-direction: column;
  background: #0d0c1a;
  border: 1px solid rgba(124,92,255,.22);
  border-radius: 20px;
  box-shadow: 0 24px 80px rgba(0,0,0,.7);
  opacity: 0; transform: translateY(18px);
}
.djp-hist-panel.visible {
  opacity: 1; transform: translateY(0);
  transition: opacity .22s ease, transform .22s ease;
}
.djp-hist-top {
  padding: 20px 22px 0;
  flex-shrink: 0;
}
.djp-hist-scroll {
  flex: 1; overflow-y: auto;
  padding: 16px 22px 24px;
  scrollbar-width: thin;
  scrollbar-color: rgba(124,92,255,.3) transparent;
}
.djp-hist-header {
  display: flex; align-items: flex-start;
  justify-content: space-between; margin-bottom: 16px;
}
.djp-hist-actions { display: flex; gap: 8px; align-items: center; }
.djp-hist-action-btn {
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 10px; padding: 6px 12px;
  color: rgba(255,255,255,.7); font-size: 11px;
  font-weight: 700; cursor: pointer;
  transition: background .15s;
}
.djp-hist-action-btn:hover { background: rgba(255,255,255,.12); }

/* Stats chips */
.djp-stats-grid {
  display: grid; grid-template-columns: repeat(4,1fr); gap: 8px;
  margin-bottom: 14px;
}
.djp-stat {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 12px; padding: 10px 10px;
  text-align: center;
}
.djp-stat-val {
  font-size: 16px; font-weight: 900; color: #fff;
  font-family: 'Bebas Neue', sans-serif; letter-spacing: .5px;
  line-height: 1;
}
.djp-stat-lbl {
  font-size: 9px; color: rgba(255,255,255,.4);
  margin-top: 3px; font-family: 'JetBrains Mono', monospace;
  letter-spacing: .8px; text-transform: uppercase;
}

/* Tabs */
.djp-tabs {
  display: flex; gap: 6px; margin-bottom: 14px;
  border-bottom: 1px solid rgba(255,255,255,.08);
  padding-bottom: 10px;
}
.djp-tab {
  padding: 7px 14px; border-radius: 10px;
  border: 1px solid transparent;
  background: transparent; color: rgba(255,255,255,.45);
  font-size: 12px; font-weight: 700; cursor: pointer;
  transition: all .15s; font-family: 'JetBrains Mono', monospace;
}
.djp-tab:hover { color: rgba(255,255,255,.8); }
.djp-tab.active {
  background: rgba(124,92,255,.2);
  border-color: rgba(124,92,255,.45);
  color: #fff;
}

/* Chart */
.djp-chart-wrap {
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 14px; padding: 14px;
  margin-bottom: 14px;
}
.djp-chart-controls {
  display: flex; gap: 6px; flex-wrap: wrap;
  margin-bottom: 10px;
}
.djp-range-btn {
  padding: 5px 11px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.1);
  background: transparent; color: rgba(255,255,255,.5);
  font-size: 10px; font-weight: 700; cursor: pointer;
  font-family: 'JetBrains Mono', monospace;
  transition: all .15s;
}
.djp-range-btn.active {
  background: rgba(124,92,255,.22);
  border-color: rgba(124,92,255,.5);
  color: #fff;
}

/* Pattern analysis */
.djp-pattern-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 10px; margin-bottom: 14px;
}
.djp-pattern-card {
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 12px; padding: 12px;
}
.djp-pattern-title {
  font-size: 9px; text-transform: uppercase;
  letter-spacing: 1px; color: rgba(124,92,255,.7);
  font-family: 'JetBrains Mono', monospace;
  margin-bottom: 10px;
}
.djp-bar-row {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 6px;
}
.djp-bar-label {
  font-size: 10px; color: rgba(255,255,255,.6);
  width: 60px; flex-shrink: 0; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.djp-bar-fill-wrap {
  flex: 1; height: 6px; background: rgba(255,255,255,.07);
  border-radius: 4px; overflow: hidden;
}
.djp-bar-fill {
  height: 100%; border-radius: 4px;
  background: linear-gradient(90deg, rgba(124,92,255,.7), rgba(124,92,255,1));
  transition: width .4s ease;
}
.djp-bar-count {
  font-size: 10px; color: rgba(255,255,255,.4);
  width: 18px; text-align: right; flex-shrink: 0;
}

/* History list */
.djp-hist-list { display: flex; flex-direction: column; gap: 8px; }
.djp-hist-row {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 12px; padding: 12px 14px;
  display: flex; align-items: flex-start;
  justify-content: space-between; gap: 10px;
  transition: border-color .15s;
}
.djp-hist-row:hover { border-color: rgba(124,92,255,.25); }
.djp-hist-main { flex: 1; min-width: 0; }
.djp-hist-date {
  font-weight: 900; font-size: 13px; color: #fff;
  display: flex; align-items: center; gap: 7px;
}
.djp-hist-type-badge {
  font-size: 10px; padding: 2px 7px; border-radius: 8px;
  background: rgba(124,92,255,.18);
  border: 1px solid rgba(124,92,255,.3);
  color: rgba(124,92,255,.9);
  font-weight: 700;
}
.djp-hist-meta {
  font-size: 11px; color: rgba(255,255,255,.45);
  margin-top: 3px;
}
.djp-hist-symbols {
  display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;
}
.djp-hist-symbol {
  font-size: 9px; padding: 2px 7px; border-radius: 8px;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.1);
  color: rgba(255,255,255,.5);
}
.djp-hist-narrative {
  font-size: 11px; color: rgba(255,255,255,.6);
  margin-top: 6px; line-height: 1.45;
  white-space: pre-wrap; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.djp-hist-row-actions { display: flex; gap: 5px; }
.djp-icon-btn {
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 8px; width: 28px; height: 28px;
  cursor: pointer; font-size: 12px;
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,.6); transition: all .15s;
}
.djp-icon-btn:hover { background: rgba(255,255,255,.12); color: #fff; }
.djp-icon-btn.del:hover { background: rgba(255,60,60,.15); border-color: rgba(255,60,60,.3); color: #ff6b6b; }

/* Search */
.djp-search {
  width: 100%; background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px; padding: 9px 13px;
  color: #fff; font-size: 12px; outline: none;
  box-sizing: border-box; margin-bottom: 12px;
  transition: border-color .15s;
}
.djp-search:focus { border-color: rgba(124,92,255,.5); }
.djp-empty {
  text-align: center; padding: 28px 0;
  color: rgba(255,255,255,.25); font-size: 13px;
}
.djp-divider {
  height: 1px; background: rgba(255,255,255,.07);
  margin: 18px 0;
}

@media(max-width:480px){
  .djp-stats-grid { grid-template-columns: repeat(2,1fr); }
  .djp-pattern-grid { grid-template-columns: 1fr; }
  .djp-timing-row { grid-template-columns: 1fr; }
}
  `;
  document.head.appendChild(style);
}

// ─── openSleepModal (PRO) ───────────────────────────────────────────────────

window.openSleepModal = function(opts = {}) {
  _djpInjectStyles();
  const host = document.querySelector("#app") || document.body;

  const editId = opts?.editId ? String(opts.editId) : "";
  const existingRaw = editId ? (window.state?.sleepLog || []).find(x => String(x.id || "") === editId) : null;
  const ex = existingRaw ? _djpNormalize(existingRaw) : null;

  const today = ex?.date || _djpIsoDate();

  // State local del form
  const form = {
    date: today,
    mode: ex?.mode || "advanced",
    hours: ex ? ((ex.totalMinutes / 60).toFixed(2).replace(/\.00$/, "")) : "",
    quality: ex?.quality ? String(ex.quality) : "",
    start: ex?.start || "",
    end: ex?.end || "",
    note: ex?.note || "",
    narrative: ex?.narrative || "",
    dreamType: ex?.dreamType || "",
    wakeEmotion: ex?.wakeEmotion || "",
    symbols: [...(ex?.symbols || [])],
    clarity: ex?.clarity || null,
    lucidMoment: ex?.lucidMoment || false,
  };

  const backdrop = document.createElement("div");
  backdrop.className = "djp-backdrop";

  function renderForm() {
    backdrop.innerHTML = `
      <div class="djp-panel" id="djpPanel">
        <div class="djp-header">
          <div>
            <div class="djp-title">${ex ? "Editar Sueño" : "Registrar Sueño"}</div>
            <div class="djp-sub">Dream Journal Pro · ${_djpEsc(form.date)}</div>
          </div>
          <button class="djp-close" id="djpClose">✕</button>
        </div>

        <!-- TIPO DE SUEÑO -->
        <div class="djp-section">
          <div class="djp-label">Tipo de sueño</div>
          <div class="djp-pill-grid" id="djpTypeGrid">
            ${DREAM_TYPES.map(t => `
              <button class="djp-pill ${form.dreamType === t.id ? "active" : ""}" data-type="${t.id}">
                ${t.icon} ${_djpEsc(t.label)}
              </button>
            `).join("")}
          </div>
        </div>

        <!-- EMOCIÓN AL DESPERTAR -->
        <div class="djp-section">
          <div class="djp-label">Emoción al despertar</div>
          <div class="djp-pill-grid" id="djpEmotionGrid">
            ${WAKE_EMOTIONS.map(e => `
              <button class="djp-pill ${form.wakeEmotion === e.id ? "active" : ""}" data-emotion="${e.id}">
                ${e.icon} ${_djpEsc(e.label)}
              </button>
            `).join("")}
          </div>
        </div>

        <!-- CLARIDAD -->
        <div class="djp-section">
          <div class="djp-label">Claridad del recuerdo</div>
          <div class="djp-clarity-row">
            ${CLARITY_LEVELS.map(c => `
              <button class="djp-clarity-btn ${form.clarity === c.v ? "active" : ""}" data-clarity="${c.v}">
                ${c.v}<br>${_djpEsc(c.label)}
              </button>
            `).join("")}
          </div>
        </div>

        <!-- SUEÑO LÚCIDO -->
        <div class="djp-section">
          <div class="djp-lucid-toggle ${form.lucidMoment ? "active" : ""}" id="djpLucidToggle">
            <div class="djp-lucid-icon">✨</div>
            <div class="djp-lucid-text">
              <div class="djp-lucid-title">Momento de lucidez</div>
              <div class="djp-lucid-desc">Hubo consciencia dentro del sueño</div>
            </div>
            <div class="djp-lucid-check">${form.lucidMoment ? "✓" : ""}</div>
          </div>
        </div>

        <!-- NARRATIVA -->
        <div class="djp-section">
          <div class="djp-label">Narrativa del sueño</div>
          <textarea class="djp-narrative" id="djpNarrative"
            placeholder="Describe lo que recordás del sueño... personas, lugares, sensaciones, secuencias..."
            rows="4">${_djpEsc(form.narrative)}</textarea>
        </div>

        <!-- SÍMBOLOS -->
        <div class="djp-section">
          <div class="djp-label">Símbolos y arquetipos</div>
          <div class="djp-preset-hint">Atajos rápidos:</div>
          <div class="djp-preset-grid" id="djpPresets">
            ${SYMBOL_PRESETS.map(s => `
              <button class="djp-preset-chip" data-preset="${_djpEsc(s)}">${_djpEsc(s)}</button>
            `).join("")}
          </div>
          <div class="djp-symbol-input-row">
            <input class="djp-symbol-input" id="djpSymbolInput" placeholder="Agregar símbolo personalizado..." />
            <button class="djp-symbol-add" id="djpSymbolAdd">＋</button>
          </div>
          <div class="djp-pill-grid" id="djpSymbolTags">
            ${form.symbols.map(s => `
              <span class="djp-symbol-tag">
                ${_djpEsc(s)}
                <button class="djp-symbol-remove" data-remove="${_djpEsc(s)}">×</button>
              </span>
            `).join("")}
          </div>
        </div>

        <div class="djp-divider"></div>

        <!-- TIEMPO DE SUEÑO -->
        <div class="djp-section">
          <div class="djp-label">Duración y calidad</div>
          <div class="djp-timing-row">
            <div class="djp-field">
              <label>Fecha</label>
              <input type="date" id="djpDate" value="${_djpEsc(form.date)}">
            </div>
            <div class="djp-field">
              <label>Calidad (1–5)</label>
              <select id="djpQuality">
                <option value="">—</option>
                ${[1,2,3,4,5].map(n => `<option value="${n}" ${form.quality === String(n) ? "selected" : ""}>${n}</option>`).join("")}
              </select>
            </div>
            <div class="djp-field">
              <label>Hora inicio</label>
              <input type="time" id="djpStart" value="${_djpEsc(form.start)}">
            </div>
            <div class="djp-field">
              <label>Hora fin</label>
              <input type="time" id="djpEnd" value="${_djpEsc(form.end)}">
            </div>
          </div>
          <div class="djp-field" style="margin-top:10px;">
            <label>Nota rápida (opcional)</label>
            <input type="text" id="djpNote"
              placeholder="café tarde, calor, ruido externo..."
              value="${_djpEsc(form.note)}">
          </div>
        </div>

        <!-- FOOTER -->
        <div class="djp-footer">
          <button class="djp-btn" id="djpCancel">Cancelar</button>
          <button class="djp-btn primary" id="djpSave">
            ${ex ? "Guardar cambios" : "Guardar sueño"} 🌙
          </button>
        </div>
      </div>
    `;

    // Animate in
    requestAnimationFrame(() => {
      const panel = backdrop.querySelector("#djpPanel");
      if (panel) panel.classList.add("visible");
    });

    wireForm();
  }

  function wireForm() {
    const get = id => backdrop.querySelector(`#${id}`);

    // Close
    const close = () => {
      const panel = backdrop.querySelector("#djpPanel");
      if (panel) {
        panel.style.transition = "opacity .18s ease, transform .18s ease";
        panel.style.opacity = "0";
        panel.style.transform = "translateY(14px)";
      }
      setTimeout(() => backdrop.remove(), 200);
    };
    get("djpClose")?.addEventListener("click", close);
    get("djpCancel")?.addEventListener("click", close);
    backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });

    // Type pills
    backdrop.querySelectorAll("[data-type]").forEach(btn => {
      btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-type");
        form.dreamType = form.dreamType === t ? "" : t;
        backdrop.querySelectorAll("[data-type]").forEach(b => b.classList.toggle("active", b.getAttribute("data-type") === form.dreamType));
      });
    });

    // Emotion pills
    backdrop.querySelectorAll("[data-emotion]").forEach(btn => {
      btn.addEventListener("click", () => {
        const e = btn.getAttribute("data-emotion");
        form.wakeEmotion = form.wakeEmotion === e ? "" : e;
        backdrop.querySelectorAll("[data-emotion]").forEach(b => b.classList.toggle("active", b.getAttribute("data-emotion") === form.wakeEmotion));
      });
    });

    // Clarity
    backdrop.querySelectorAll("[data-clarity]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = Number(btn.getAttribute("data-clarity"));
        form.clarity = form.clarity === v ? null : v;
        backdrop.querySelectorAll("[data-clarity]").forEach(b => b.classList.toggle("active", Number(b.getAttribute("data-clarity")) === form.clarity));
      });
    });

    // Lucid toggle
    const lucidToggle = get("djpLucidToggle");
    lucidToggle?.addEventListener("click", () => {
      form.lucidMoment = !form.lucidMoment;
      lucidToggle.classList.toggle("active", form.lucidMoment);
      const check = lucidToggle.querySelector(".djp-lucid-check");
      if (check) check.textContent = form.lucidMoment ? "✓" : "";
    });

    // Symbol presets
    backdrop.querySelectorAll("[data-preset]").forEach(btn => {
      btn.addEventListener("click", () => {
        const s = btn.getAttribute("data-preset");
        if (s && !form.symbols.includes(s)) {
          form.symbols.push(s);
          refreshSymbolTags();
        }
      });
    });

    // Symbol add
    const symbolInput = get("djpSymbolInput");
    const addSymbol = () => {
      const s = (symbolInput?.value || "").trim().toLowerCase();
      if (s && !form.symbols.includes(s)) {
        form.symbols.push(s);
        refreshSymbolTags();
        if (symbolInput) symbolInput.value = "";
      }
    };
    get("djpSymbolAdd")?.addEventListener("click", addSymbol);
    symbolInput?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addSymbol(); } });

    // Save
    get("djpSave")?.addEventListener("click", () => {
      const date = (get("djpDate")?.value || "").trim();
      const quality = (get("djpQuality")?.value || "").trim();
      const start = (get("djpStart")?.value || "").trim();
      const end = (get("djpEnd")?.value || "").trim();
      const note = (get("djpNote")?.value || "").trim();
      const narrative = (get("djpNarrative")?.value || "").trim();

      if (!date) { _djpToast("Elige una fecha 📅"); return; }

      let totalMinutes = 0;
      if (start && end) {
        totalMinutes = _djpCalcMinutes(date, start, end);
      }
      if (!totalMinutes && start && end) {
        _djpToast("Revisa las horas de inicio/fin ⏱"); return;
      }
      if (!totalMinutes) {
        // fallback: ask for direct hours only if neither start/end nor narrative
        if (!narrative && !form.dreamType) {
          _djpToast("Agrega hora inicio/fin, o al menos una nota del sueño 🌙"); return;
        }
        totalMinutes = 0; // allow saving with 0 if there's narrative
      }
      if (totalMinutes > 24 * 60) { _djpToast("Más de 24h 😅 Revisa"); return; }

      const entry = {
        id: ex?.id || _djpUid(),
        ts: new Date().toISOString(),
        date,
        totalMinutes: totalMinutes || (ex?.totalMinutes || 0),
        quality: quality ? Number(quality) : null,
        note,
        mode: "advanced",
        start,
        end,
        narrative,
        dreamType: form.dreamType,
        wakeEmotion: form.wakeEmotion,
        symbols: [...form.symbols],
        clarity: form.clarity,
        lucidMoment: form.lucidMoment,
      };

      window.state = window.state || {};
      window.state.sleepLog = Array.isArray(window.state.sleepLog) ? window.state.sleepLog : [];

      if (ex) {
        const idx = window.state.sleepLog.findIndex(x => String(x.id || "") === ex.id);
        if (idx >= 0) window.state.sleepLog[idx] = entry;
        else window.state.sleepLog.push(entry);
      } else {
        window.state.sleepLog.push(entry);
      }
      if (window.state.sleepLog.length > 1500) window.state.sleepLog = window.state.sleepLog.slice(-1500);

      if (typeof window.persist === "function") window.persist();
      if (typeof window.view === "function") window.view();
      if (typeof opts.onSaved === "function") opts.onSaved(entry);
      _djpToast(ex ? "Sueño actualizado ✅" : "Sueño guardado 🌙");
      close();
    });
  }

  function refreshSymbolTags() {
    const container = backdrop.querySelector("#djpSymbolTags");
    if (!container) return;
    container.innerHTML = form.symbols.map(s => `
      <span class="djp-symbol-tag">
        ${_djpEsc(s)}
        <button class="djp-symbol-remove" data-remove="${_djpEsc(s)}">×</button>
      </span>
    `).join("");
    container.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        const s = btn.getAttribute("data-remove");
        form.symbols = form.symbols.filter(x => x !== s);
        refreshSymbolTags();
      });
    });
  }

  renderForm();
  // After first render, attach remove listeners
  setTimeout(() => {
    backdrop.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        const s = btn.getAttribute("data-remove");
        form.symbols = form.symbols.filter(x => x !== s);
        refreshSymbolTags();
      });
    });
  }, 50);

  host.appendChild(backdrop);
};

// ─── Toast helper ───────────────────────────────────────────────────────────

function _djpToast(msg) {
  // reuse existing toast if available
  if (typeof window.toast === "function") { window.toast(msg); return; }
  const t = document.createElement("div");
  t.style.cssText = `
    position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
    background:#1a1828;border:1px solid rgba(124,92,255,.4);
    color:#fff;padding:10px 18px;border-radius:14px;font-size:13px;
    font-weight:700;z-index:9999;pointer-events:none;
    box-shadow:0 8px 28px rgba(0,0,0,.5);
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// ─── openSleepHistoryModal (PRO) ────────────────────────────────────────────

window.openSleepHistoryModal = function() {
  _djpInjectStyles();
  const host = document.querySelector("#app") || document.body;

  const backdrop = document.createElement("div");
  backdrop.className = "djp-backdrop";

  backdrop.innerHTML = `
    <div class="djp-hist-panel" id="djpHistPanel">
      <div class="djp-hist-top">
        <div class="djp-hist-header">
          <div>
            <div class="djp-title">Dream Journal</div>
            <div class="djp-sub">Historial · Análisis · Patrones</div>
          </div>
          <div class="djp-hist-actions">
            <button class="djp-hist-action-btn" id="djpHistCsv">CSV</button>
            <button class="djp-hist-action-btn" id="djpHistAdd">＋ Nuevo</button>
            <button class="djp-close" id="djpHistClose">✕</button>
          </div>
        </div>
        <div class="djp-stats-grid" id="djpStatGrid"></div>
        <div class="djp-tabs">
          <button class="djp-tab active" data-tab="log">📋 Registros</button>
          <button class="djp-tab" data-tab="patterns">🔮 Patrones</button>
          <button class="djp-tab" data-tab="chart">📈 Gráfico</button>
          <button class="djp-tab" data-tab="radial">🌀 Radial</button>
        </div>
      </div>
      <div class="djp-hist-scroll" id="djpHistContent"></div>
    </div>
  `;

  host.appendChild(backdrop);

  requestAnimationFrame(() => {
    const panel = backdrop.querySelector("#djpHistPanel");
    if (panel) panel.classList.add("visible");
  });

  const close = () => {
    const panel = backdrop.querySelector("#djpHistPanel");
    if (panel) {
      panel.style.transition = "opacity .18s ease, transform .18s ease";
      panel.style.opacity = "0";
      panel.style.transform = "translateY(14px)";
    }
    setTimeout(() => backdrop.remove(), 200);
  };

  backdrop.querySelector("#djpHistClose")?.addEventListener("click", close);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });

  const uiState = { tab: "log", range: "30", query: "" };

  const getLog = () =>
    (window.state?.sleepLog || [])
      .map(_djpNormalize).filter(Boolean)
      .sort((a, b) => b.date.localeCompare(a.date));

  const getFiltered = () => {
    const full = getLog();
    const q = uiState.query.trim().toLowerCase();
    const filtered = q
      ? full.filter(x =>
          x.date.includes(q) ||
          (x.note || "").toLowerCase().includes(q) ||
          (x.narrative || "").toLowerCase().includes(q) ||
          x.symbols.some(s => s.toLowerCase().includes(q))
        )
      : full;

    if (uiState.range === "all") return filtered;
    const days = Number(uiState.range) || 30;
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);
    return filtered.filter(x => {
      const d = new Date(x.date + "T00:00:00");
      return d >= from;
    });
  };

  // ── Stats ────────────────────────────────────────────────────────────────
  const renderStats = () => {
    const all = getLog();
    const recent = getFiltered();
    const withMinutes = recent.filter(x => x.totalMinutes > 0);
    const avg = withMinutes.length
      ? withMinutes.reduce((s, x) => s + x.totalMinutes, 0) / withMinutes.length
      : 0;
    const lucidCount = all.filter(x => x.lucidMoment).length;
    const nightmare = all.filter(x => x.dreamType === "nightmare").length;

    // Streak
    const uniqueDates = new Set(all.map(x => x.date));
    let streak = 0;
    const cur = new Date(); cur.setDate(cur.getDate() - 1);
    while (true) {
      const ds = _djpIsoDate(cur);
      if (!uniqueDates.has(ds)) break;
      streak++;
      cur.setDate(cur.getDate() - 1);
    }

    const grid = backdrop.querySelector("#djpStatGrid");
    if (!grid) return;
    grid.innerHTML = [
      { v: all.length, l: "Total" },
      { v: _djpFmt(avg), l: "Prom. horas" },
      { v: `${streak}🔥`, l: "Racha" },
      { v: lucidCount, l: "Lúcidos" },
    ].map(s => `
      <div class="djp-stat">
        <div class="djp-stat-val">${_djpEsc(String(s.v))}</div>
        <div class="djp-stat-lbl">${_djpEsc(s.l)}</div>
      </div>
    `).join("");
  };

  // ── Tab: Log ─────────────────────────────────────────────────────────────
  const renderLog = () => {
    const rows = getFiltered();
    const content = backdrop.querySelector("#djpHistContent");
    if (!content) return;

    const typeMap = Object.fromEntries(DREAM_TYPES.map(t => [t.id, t]));
    const emotionMap = Object.fromEntries(WAKE_EMOTIONS.map(e => [e.id, e]));

    content.innerHTML = `
      <div class="djp-chart-controls" style="margin-bottom:10px;">
        ${[["7","7D"],["30","30D"],["90","90D"],["all","Todo"]].map(([v,t]) => `
          <button class="djp-range-btn ${uiState.range === v ? "active" : ""}" data-range="${v}">${t}</button>
        `).join("")}
      </div>
      <input class="djp-search" id="djpSearch" placeholder="Buscar por fecha, nota, símbolo..." value="${_djpEsc(uiState.query)}">
      <div class="djp-hist-list" id="djpHistList">
        ${rows.length ? rows.map(r => {
          const typeInfo = typeMap[r.dreamType];
          const emInfo = emotionMap[r.wakeEmotion];
          return `
            <div class="djp-hist-row">
              <div class="djp-hist-main">
                <div class="djp-hist-date">
                  ${_djpEsc(r.date)}
                  ${typeInfo ? `<span class="djp-hist-type-badge">${typeInfo.icon} ${_djpEsc(typeInfo.label)}</span>` : ""}
                  ${r.lucidMoment ? `<span class="djp-hist-type-badge">✨ Lúcido</span>` : ""}
                </div>
                <div class="djp-hist-meta">
                  ${r.totalMinutes ? _djpFmt(r.totalMinutes) : "Sin duración"}
                  ${r.quality ? ` · Q${r.quality}/5` : ""}
                  ${emInfo ? ` · ${emInfo.icon} ${_djpEsc(emInfo.label)}` : ""}
                  ${r.clarity ? ` · Claridad ${r.clarity}/5` : ""}
                </div>
                ${r.symbols.length ? `
                  <div class="djp-hist-symbols">
                    ${r.symbols.map(s => `<span class="djp-hist-symbol">${_djpEsc(s)}</span>`).join("")}
                  </div>
                ` : ""}
                ${r.narrative ? `<div class="djp-hist-narrative">${_djpEsc(r.narrative)}</div>` : ""}
              </div>
              <div class="djp-hist-row-actions">
                <button class="djp-icon-btn" data-edit="${_djpEsc(r.id)}" title="Editar">✎</button>
                <button class="djp-icon-btn del" data-del="${_djpEsc(r.id)}" title="Eliminar">🗑</button>
              </div>
            </div>
          `;
        }).join("") : `<div class="djp-empty">Sin registros para este período.</div>`}
      </div>
    `;

    // Range
    content.querySelectorAll("[data-range]").forEach(btn => {
      btn.addEventListener("click", () => {
        uiState.range = btn.getAttribute("data-range") || "30";
        renderLog();
        renderStats();
      });
    });

    // Search
    content.querySelector("#djpSearch")?.addEventListener("input", e => {
      uiState.query = e.target.value || "";
      renderLog();
    });

    // Edit
    content.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-edit");
        window.openSleepModal({ editId: id, onSaved: () => { renderStats(); renderActive(); } });
      });
    });

    // Delete
    content.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-del");
        window.state.sleepLog = (window.state.sleepLog || []).filter(x => String(x.id || "") !== id);
        if (typeof window.persist === "function") window.persist();
        if (typeof window.view === "function") window.view();
        _djpToast("Registro eliminado 🗑");
        renderStats();
        renderActive();
      });
    });
  };

  // ── Tab: Patterns ─────────────────────────────────────────────────────────
  const renderPatterns = () => {
    const all = getLog();
    const content = backdrop.querySelector("#djpHistContent");
    if (!content) return;

    // Symbol frequency
    const symbolCount = {};
    all.forEach(r => r.symbols.forEach(s => {
      symbolCount[s] = (symbolCount[s] || 0) + 1;
    }));
    const topSymbols = Object.entries(symbolCount)
      .sort((a, b) => b[1] - a[1]).slice(0, 8);

    // Dream type freq
    const typeCount = {};
    all.forEach(r => {
      if (r.dreamType) typeCount[r.dreamType] = (typeCount[r.dreamType] || 0) + 1;
    });
    const typeMap = Object.fromEntries(DREAM_TYPES.map(t => [t.id, t]));
    const topTypes = Object.entries(typeCount).sort((a, b) => b[1] - a[1]);

    // Wake emotion freq
    const emotionCount = {};
    all.forEach(r => {
      if (r.wakeEmotion) emotionCount[r.wakeEmotion] = (emotionCount[r.wakeEmotion] || 0) + 1;
    });
    const emotionMap = Object.fromEntries(WAKE_EMOTIONS.map(e => [e.id, e]));
    const topEmotions = Object.entries(emotionCount).sort((a, b) => b[1] - a[1]);

    // Lucid rate
    const withType = all.filter(r => r.dreamType);
    const lucidAll = all.filter(r => r.lucidMoment);
    const lucidRate = all.length ? ((lucidAll.length / all.length) * 100).toFixed(0) : 0;

    const maxSymbol = topSymbols[0]?.[1] || 1;
    const maxType = topTypes[0]?.[1] || 1;
    const maxEmotion = topEmotions[0]?.[1] || 1;

    content.innerHTML = `
      <div class="djp-pattern-grid">
        <div class="djp-pattern-card">
          <div class="djp-pattern-title">🔮 Símbolos frecuentes</div>
          ${topSymbols.length ? topSymbols.map(([s, n]) => `
            <div class="djp-bar-row">
              <div class="djp-bar-label" title="${_djpEsc(s)}">${_djpEsc(s)}</div>
              <div class="djp-bar-fill-wrap">
                <div class="djp-bar-fill" style="width:${Math.round((n/maxSymbol)*100)}%"></div>
              </div>
              <div class="djp-bar-count">${n}</div>
            </div>
          `).join("") : `<div style="color:rgba(255,255,255,.3);font-size:11px;">Sin datos aún</div>`}
        </div>

        <div class="djp-pattern-card">
          <div class="djp-pattern-title">🌙 Tipos de sueño</div>
          ${topTypes.length ? topTypes.map(([id, n]) => `
            <div class="djp-bar-row">
              <div class="djp-bar-label" title="${_djpEsc(typeMap[id]?.label || id)}">${typeMap[id]?.icon || ""} ${_djpEsc(typeMap[id]?.label || id)}</div>
              <div class="djp-bar-fill-wrap">
                <div class="djp-bar-fill" style="width:${Math.round((n/maxType)*100)}%"></div>
              </div>
              <div class="djp-bar-count">${n}</div>
            </div>
          `).join("") : `<div style="color:rgba(255,255,255,.3);font-size:11px;">Sin datos aún</div>`}
        </div>

        <div class="djp-pattern-card">
          <div class="djp-pattern-title">💫 Emociones al despertar</div>
          ${topEmotions.length ? topEmotions.slice(0,6).map(([id, n]) => `
            <div class="djp-bar-row">
              <div class="djp-bar-label">${emotionMap[id]?.icon || ""} ${_djpEsc(emotionMap[id]?.label || id)}</div>
              <div class="djp-bar-fill-wrap">
                <div class="djp-bar-fill" style="width:${Math.round((n/maxEmotion)*100)}%"></div>
              </div>
              <div class="djp-bar-count">${n}</div>
            </div>
          `).join("") : `<div style="color:rgba(255,255,255,.3);font-size:11px;">Sin datos aún</div>`}
        </div>

        <div class="djp-pattern-card">
          <div class="djp-pattern-title">📊 Resumen global</div>
          <div class="djp-bar-row" style="margin-bottom:10px;">
            <div style="flex:1;font-size:11px;color:rgba(255,255,255,.6);">Total sueños</div>
            <div style="font-weight:900;font-size:15px;color:#fff;">${all.length}</div>
          </div>
          <div class="djp-bar-row" style="margin-bottom:10px;">
            <div style="flex:1;font-size:11px;color:rgba(255,255,255,.6);">Lúcidos</div>
            <div style="font-weight:900;font-size:15px;color:rgba(124,92,255,.9);">${lucidAll.length} <span style="font-size:10px;opacity:.6;">(${lucidRate}%)</span></div>
          </div>
          <div class="djp-bar-row" style="margin-bottom:10px;">
            <div style="flex:1;font-size:11px;color:rgba(255,255,255,.6);">Pesadillas</div>
            <div style="font-weight:900;font-size:15px;color:rgba(255,100,100,.8);">${all.filter(r=>r.dreamType==="nightmare").length}</div>
          </div>
          <div class="djp-bar-row">
            <div style="flex:1;font-size:11px;color:rgba(255,255,255,.6);">Con narrativa</div>
            <div style="font-weight:900;font-size:15px;color:rgba(80,200,140,.8);">${all.filter(r=>r.narrative).length}</div>
          </div>
        </div>
      </div>
    `;
  };

  // ── Tab: Chart ────────────────────────────────────────────────────────────
  const renderChart = () => {
    const content = backdrop.querySelector("#djpHistContent");
    if (!content) return;

    const rows = getFiltered().filter(x => x.totalMinutes > 0).reverse();
    const W = 460, H = 150;
    const maxH = Math.max(8 * 60, ...rows.map(x => x.totalMinutes), 1);
    const px = (i, len) => len <= 1 ? W / 2 : Math.round(18 + ((W - 36) * i / (len - 1)));
    const py = v => Math.round(H - 18 - ((v / maxH) * (H - 36)));

    const pts = rows.map((r, i) => ({ x: px(i, rows.length), y: py(r.totalMinutes), r }));
    let path = "";
    if (pts.length > 1) {
      path = `M ${pts[0].x} ${pts[0].y}`;
      for (let i = 1; i < pts.length; i++) {
        const cx = Math.round((pts[i-1].x + pts[i].x) / 2);
        path += ` Q ${cx} ${pts[i-1].y}, ${pts[i].x} ${pts[i].y}`;
      }
    }

    content.innerHTML = `
      <div class="djp-chart-controls">
        ${[["7","7D"],["30","30D"],["90","90D"],["all","Todo"]].map(([v,t]) => `
          <button class="djp-range-btn ${uiState.range === v ? "active" : ""}" data-range="${v}">${t}</button>
        `).join("")}
      </div>
      <div class="djp-chart-wrap">
        ${rows.length ? `
          <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;">
            <defs>
              <linearGradient id="djpGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="rgba(124,92,255,.3)"/>
                <stop offset="100%" stop-color="rgba(124,92,255,0)"/>
              </linearGradient>
            </defs>
            <line x1="14" y1="${H-18}" x2="${W-14}" y2="${H-18}" stroke="rgba(255,255,255,.15)" stroke-width="1"/>
            ${path ? `
              <path d="${path} L ${pts[pts.length-1].x} ${H-18} L ${pts[0].x} ${H-18} Z"
                fill="url(#djpGrad)"/>
              <path d="${path}" fill="none"
                stroke="rgba(124,92,255,.9)" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round"/>
            ` : ""}
            ${pts.map(pt => `
              <circle cx="${pt.x}" cy="${pt.y}" r="3.5" fill="#fff"
                stroke="rgba(124,92,255,.9)" stroke-width="2">
                <title>${_djpEsc(pt.r.date)} · ${_djpFmt(pt.r.totalMinutes)}</title>
              </circle>
            `).join("")}
          </svg>
        ` : `<div class="djp-empty">Sin datos con duración en este período.</div>`}
      </div>
    `;

    content.querySelectorAll("[data-range]").forEach(btn => {
      btn.addEventListener("click", () => {
        uiState.range = btn.getAttribute("data-range") || "30";
        renderChart();
        renderStats();
      });
    });
  };

  // ── Tab switching ─────────────────────────────────────────────────────────
  const renderActive = () => {
    if (uiState.tab === "log") renderLog();
    else if (uiState.tab === "patterns") renderPatterns();
    else if (uiState.tab === "chart") renderChart();
    else if (uiState.tab === "radial") window.DJP_Radial?.render(content, getFiltered());
  };

  backdrop.querySelectorAll("[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      backdrop.querySelectorAll("[data-tab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      uiState.tab = btn.getAttribute("data-tab") || "log";
      renderActive();
    });
  });

  // ── CSV ───────────────────────────────────────────────────────────────────
  backdrop.querySelector("#djpHistCsv")?.addEventListener("click", () => {
    const rows = getLog();
    if (!rows.length) { _djpToast("No hay registros 📭"); return; }
    const esc = v => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const head = ["fecha","horas","minutos","calidad","tipo","emocion","claridad","lucido","simbolos","narrativa","nota","inicio","fin"];
    const body = rows.map(r => [
      r.date,
      (r.totalMinutes / 60).toFixed(2),
      r.totalMinutes,
      r.quality ?? "",
      r.dreamType,
      r.wakeEmotion,
      r.clarity ?? "",
      r.lucidMoment ? "si" : "no",
      r.symbols.join("|"),
      r.narrative,
      r.note,
      r.start,
      r.end,
    ]);
    const csv = [head, ...body].map(row => row.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `dream-journal-${_djpIsoDate()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    _djpToast("CSV exportado ✅");
  });

  // ── Add new ───────────────────────────────────────────────────────────────
  backdrop.querySelector("#djpHistAdd")?.addEventListener("click", () => {
    window.openSleepModal({ onSaved: () => { renderStats(); renderActive(); } });
  });

  // Initial render
  renderStats();
  renderActive();
};
