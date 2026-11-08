/**
 * journal-ui.js — Pestaña "Diario" de NeuroChat
 * MemoryCarl
 *
 * Escribir el día a día sin conversación: Carl no responde, pero lo usa como contexto.
 * Las entradas se guardan dentro de cada día (pestaña Días) y viajan a Supabase con él.
 */

import { addJournalEntry, updateJournalEntry, deleteJournalEntry, getJournalEntries } from "../day/dayStore.js";
import { JOURNAL_MOODS, QUICK_TAGS, moodById } from "../day/journal.js";
import { todayLocalStr } from "./lifeDates.js";
import { recordAstroActivation, replaceAstroActivation } from "./astroLinks.js";

const DRAFT_KEY = "memorycarl_journal_draft";
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Estado de la pestaña (no se guarda: es solo de la vista)
export const journalUiState = {
  monthOffset: 0,     // 0 = mes actual
  filterDate: null,   // YYYY-MM-DD seleccionado en el calendario
  search: "",
  editId: null,
  mood: null,         // ánimo elegido en el editor nuevo
  tags: [],           // etiquetas elegidas en el editor nuevo
  limitDays: 14,      // días mostrados (se amplía con "Ver más")
};

function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readDraft() {
  try { return localStorage.getItem(DRAFT_KEY) || ""; } catch (_e) { return ""; }
}
function writeDraft(text) {
  try { localStorage.setItem(DRAFT_KEY, text); } catch (_e) {}
}

function dayLabel(date) {
  const today = todayLocalStr();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const d = new Date(`${date}T12:00:00`);
  const pretty = `${WEEKDAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
  if (date === today) return `Hoy · ${pretty}`;
  if (date === todayLocalStr(y)) return `Ayer · ${pretty}`;
  return pretty[0].toUpperCase() + pretty.slice(1) + (d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "");
}

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function normalize(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Texto con los #hashtags resaltados
function renderText(text) {
  return esc(text).replace(/#([\p{L}\p{N}_]+)/gu, '<span class="jrHash">#$1</span>').replace(/\n/g, "<br>");
}

function renderComposer() {
  const s = journalUiState;
  return `
    <div class="jrComposer">
      <textarea id="jrText" class="jrText" rows="3" placeholder="¿Qué pasó? Escribe lo que quieras… (Ctrl+Enter para guardar)">${esc(readDraft())}</textarea>
      <div class="jrChips" aria-label="Cómo te sientes">
        ${JOURNAL_MOODS.map((m) => `<button type="button" class="jrMood ${s.mood === m.id ? "jrMood--on" : ""}" data-jr="mood" data-id="${m.id}" title="${esc(m.label)}">${m.emoji}</button>`).join("")}
      </div>
      <div class="jrChips">
        ${QUICK_TAGS.map((t) => `<button type="button" class="jrTag ${s.tags.includes(t) ? "jrTag--on" : ""}" data-jr="tag" data-id="${t}">#${t}</button>`).join("")}
      </div>
      <div class="jrComposerFoot">
        <span class="jrHint">Solo para ti. Carl no responde, pero lo tiene en cuenta.</span>
        <button type="button" class="jrSave" data-jr="save">Guardar</button>
      </div>
    </div>`;
}

function renderCalendar(entries) {
  const s = journalUiState;
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + s.monthOffset);
  const year = base.getFullYear();
  const month = base.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // lunes primero
  const byDate = new Map();
  for (const e of entries) {
    const list = byDate.get(e.date) || [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const today = todayLocalStr();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span class="jrCalCell jrCalCell--empty"></span>');
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const list = byDate.get(date) || [];
    const mood = list.map((e) => moodById(e.mood)).find(Boolean);
    cells.push(`
      <button type="button" class="jrCalCell ${list.length ? "jrCalCell--has" : ""} ${date === today ? "jrCalCell--today" : ""} ${s.filterDate === date ? "jrCalCell--sel" : ""}" data-jr="day" data-id="${date}" ${list.length ? "" : "disabled"}>
        <span>${d}</span>
        ${mood ? `<i>${mood.emoji}</i>` : list.length ? "<b></b>" : ""}
      </button>`);
  }
  return `
    <div class="jrCal">
      <div class="jrCalHead">
        <button type="button" class="jrIconBtn" data-jr="month" data-id="-1" aria-label="Mes anterior">‹</button>
        <span>${MONTHS[month][0].toUpperCase() + MONTHS[month].slice(1)} ${year}</span>
        <button type="button" class="jrIconBtn" data-jr="month" data-id="1" aria-label="Mes siguiente" ${s.monthOffset >= 0 ? "disabled" : ""}>›</button>
      </div>
      <div class="jrCalGrid">
        ${["L", "M", "X", "J", "V", "S", "D"].map((w) => `<span class="jrCalW">${w}</span>`).join("")}
        ${cells.join("")}
      </div>
    </div>`;
}

function renderEntry(e) {
  const mood = moodById(e.mood);
  if (journalUiState.editId === e.id) {
    return `
      <div class="jrEntry jrEntry--edit" data-entry="${esc(e.id)}">
        <textarea class="jrText" data-jr-edit-text rows="3">${esc(e.text)}</textarea>
        <div class="jrChips">
          ${JOURNAL_MOODS.map((m) => `<button type="button" class="jrMood ${e.mood === m.id ? "jrMood--on" : ""}" data-jr="edit-mood" data-id="${m.id}">${m.emoji}</button>`).join("")}
        </div>
        <div class="jrComposerFoot">
          <button type="button" class="jrLink jrLink--danger" data-jr="delete" data-id="${esc(e.id)}">Borrar</button>
          <span>
            <button type="button" class="jrLink" data-jr="edit-cancel">Cancelar</button>
            <button type="button" class="jrSave" data-jr="edit-save" data-id="${esc(e.id)}">Guardar</button>
          </span>
        </div>
      </div>`;
  }
  return `
    <div class="jrEntry" data-entry="${esc(e.id)}">
      <div class="jrEntryTime">${timeOf(e.ts)}</div>
      <div class="jrEntryMood">${mood ? mood.emoji : ""}</div>
      <div class="jrEntryBody">
        <div class="jrEntryText">${renderText(e.text)}</div>
        ${(e.tags || []).filter((t) => !e.text.toLowerCase().includes(`#${t}`)).length
          ? `<div class="jrEntryTags">${e.tags.filter((t) => !e.text.toLowerCase().includes(`#${t}`)).map((t) => `<span class="jrHash">#${esc(t)}</span>`).join(" ")}</div>`
          : ""}
      </div>
      <button type="button" class="jrIconBtn jrEntryEdit" data-jr="edit" data-id="${esc(e.id)}" aria-label="Editar">✎</button>
    </div>`;
}

export function viewJournal() {
  const s = journalUiState;
  const all = getJournalEntries();
  const q = normalize(s.search.trim());
  let shown = all;
  if (s.filterDate) shown = shown.filter((e) => e.date === s.filterDate);
  if (q) shown = shown.filter((e) => normalize(e.text).includes(q) || (e.tags || []).some((t) => t.includes(q.replace(/^#/, ""))));

  const groups = [];
  for (const e of shown) {
    const g = groups[groups.length - 1];
    if (g && g.date === e.date) g.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }
  const visible = s.filterDate || q ? groups : groups.slice(0, s.limitDays);

  return `
    <div class="jrWrap">
      ${journalCss()}
      <div class="jrHeader">
        <div class="jrTitle">📓 Diario</div>
        <div class="jrSub">${all.length ? `${all.length} entrada${all.length === 1 ? "" : "s"}` : "Tu día a día, en tus palabras"}</div>
      </div>

      ${renderComposer()}

      <div class="jrTools">
        ${renderCalendar(all)}
        <div class="jrSearchRow">
          <input type="search" id="jrSearch" class="jrSearch" placeholder="Buscar en el diario o #etiqueta" value="${esc(s.search)}" />
          ${s.filterDate ? `<button type="button" class="jrLink" data-jr="clear-day">Ver todos los días</button>` : ""}
        </div>
      </div>

      <div class="jrList">
        ${visible.length ? visible.map((g) => `
          <section class="jrDay">
            <div class="jrDayHead">
              <span>${esc(dayLabel(g.date))}</span>
              <span class="jrDayMoods">${g.items.map((e) => moodById(e.mood)?.emoji || "").join("")}</span>
            </div>
            ${[...g.items].sort((a, b) => a.ts - b.ts).map(renderEntry).join("")}
          </section>`).join("")
          : `<div class="jrEmpty">${all.length ? "No hay entradas que coincidan." : "Aún no has escrito nada. Empieza con algo simple: cómo amaneciste, qué hiciste, qué te pasó."}</div>`}
        ${!s.filterDate && !q && groups.length > s.limitDays ? `<button type="button" class="jrMore" data-jr="more">Ver días anteriores</button>` : ""}
      </div>
    </div>`;
}

/**
 * Conecta los eventos de la pestaña.
 * @param {HTMLElement} root
 * @param {() => void} rerender
 */
export function wireJournal(root, rerender) {
  const wrap = root.querySelector(".jrWrap");
  if (!wrap) return;
  const s = journalUiState;
  const textEl = wrap.querySelector("#jrText");

  const save = () => {
    const text = textEl?.value || "";
    const entry = addJournalEntry({ text, mood: s.mood, tags: s.tags });
    if (!entry) { textEl?.focus(); return; }
    // Suma a las activaciones de la carta natal (cálculo local, sin tokens)
    try { recordAstroActivation({ text: entry.text, messageId: entry.id, ts: entry.ts }); } catch (_e) {}
    writeDraft("");
    s.mood = null;
    s.tags = [];
    s.filterDate = null;
    rerender();
    setTimeout(() => root.querySelector("#jrText")?.focus(), 0);
  };

  textEl?.addEventListener("input", () => {
    writeDraft(textEl.value);
    textEl.style.height = "auto";
    textEl.style.height = `${Math.min(textEl.scrollHeight, 320)}px`;
  });
  textEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  });

  let searchTimer = null;
  wrap.querySelector("#jrSearch")?.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const val = e.target.value;
    searchTimer = setTimeout(() => {
      s.search = val;
      rerender();
      const input = root.querySelector("#jrSearch");
      if (input) { input.focus(); input.setSelectionRange(val.length, val.length); }
    }, 250);
  });

  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-jr]");
    if (!btn) return;
    const id = btn.dataset.id;
    switch (btn.dataset.jr) {
      case "save":
        save();
        return;
      case "mood":
        s.mood = s.mood === id ? null : id;
        // Solo se actualizan los botones para no perder el texto ni el foco
        wrap.querySelectorAll('[data-jr="mood"]').forEach((b) => b.classList.toggle("jrMood--on", b.dataset.id === s.mood));
        return;
      case "tag":
        s.tags = s.tags.includes(id) ? s.tags.filter((t) => t !== id) : [...s.tags, id];
        btn.classList.toggle("jrTag--on", s.tags.includes(id));
        return;
      case "month":
        s.monthOffset = Math.min(0, s.monthOffset + Number(id));
        break;
      case "day":
        s.filterDate = s.filterDate === id ? null : id;
        break;
      case "clear-day":
        s.filterDate = null;
        break;
      case "more":
        s.limitDays += 14;
        break;
      case "edit":
        s.editId = id;
        break;
      case "edit-cancel":
        s.editId = null;
        break;
      case "edit-mood": {
        const box = btn.closest(".jrEntry");
        const on = btn.classList.contains("jrMood--on");
        box.querySelectorAll('[data-jr="edit-mood"]').forEach((b) => b.classList.remove("jrMood--on"));
        if (!on) btn.classList.add("jrMood--on");
        return;
      }
      case "edit-save": {
        const box = btn.closest(".jrEntry");
        const text = box.querySelector("[data-jr-edit-text]")?.value || "";
        if (!text.trim()) return;
        const mood = box.querySelector('[data-jr="edit-mood"].jrMood--on')?.dataset.id || null;
        if (updateJournalEntry(id, { text, mood })) {
          const saved = getJournalEntries().find((x) => x.id === id);
          try { replaceAstroActivation({ messageId: id, text: saved?.text || "", ts: saved?.ts }); } catch (_e) {}
        }
        s.editId = null;
        break;
      }
      case "delete":
        if (!confirm("¿Borrar esta entrada del diario?")) return;
        deleteJournalEntry(id);
        try { replaceAstroActivation({ messageId: id }); } catch (_e) {}
        s.editId = null;
        break;
      default:
        return;
    }
    rerender();
  });
}

function journalCss() {
  return `<style id="journalStyles">
  .jrWrap { max-width: 720px; margin: 0 auto; padding: 4px 2px 60px; display: flex; flex-direction: column; gap: 14px; }
  .jrTitle { font-size: 22px; font-weight: 800; letter-spacing: -.3px; color: #fef3c7; }
  .jrSub { font-size: 13px; opacity: .6; margin-top: 2px; }

  .jrComposer {
    display: flex; flex-direction: column; gap: 10px; padding: 14px;
    background: linear-gradient(160deg, rgba(251,191,36,.10), rgba(255,255,255,.03));
    border: 1px solid rgba(251,191,36,.28); border-radius: 18px;
  }
  .jrText {
    width: 100%; box-sizing: border-box; resize: none; min-height: 72px;
    background: rgba(0,0,0,.25); color: #fff; border: 1px solid rgba(255,255,255,.1); border-radius: 12px;
    padding: 12px; font: inherit; font-size: 15px; line-height: 1.5; outline: none;
  }
  .jrText:focus { border-color: rgba(251,191,36,.6); }
  .jrChips { display: flex; flex-wrap: wrap; gap: 6px; }
  .jrMood { font-size: 20px; width: 40px; height: 40px; border-radius: 12px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); cursor: pointer; opacity: .55; }
  .jrMood--on { opacity: 1; background: rgba(251,191,36,.22); border-color: rgba(251,191,36,.7); }
  .jrTag { font-size: 12px; padding: 5px 10px; border-radius: 20px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); color: #d1d5db; cursor: pointer; }
  .jrTag--on { background: rgba(251,191,36,.2); border-color: rgba(251,191,36,.6); color: #fde68a; font-weight: 700; }
  .jrComposerFoot { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
  .jrHint { font-size: 11px; opacity: .55; }
  .jrSave { background: #f59e0b; color: #1c1917; border: none; border-radius: 12px; padding: 9px 18px; font-weight: 800; font-size: 14px; cursor: pointer; }
  .jrLink { background: none; border: none; color: #fcd34d; font-size: 13px; cursor: pointer; padding: 6px 8px; }
  .jrLink--danger { color: #fb7185; }
  .jrIconBtn { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: #e5e7eb; border-radius: 10px; width: 32px; height: 32px; cursor: pointer; font-size: 16px; }
  .jrIconBtn:disabled { opacity: .3; cursor: default; }

  .jrTools { display: flex; flex-direction: column; gap: 10px; }
  .jrCal { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 10px 12px; }
  .jrCalHead { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 14px; margin-bottom: 8px; }
  .jrCalGrid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .jrCalW { text-align: center; font-size: 10px; opacity: .45; font-weight: 700; }
  .jrCalCell { position: relative; height: 38px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; border-radius: 10px; background: transparent; border: 1px solid transparent; color: rgba(255,255,255,.4); font-size: 12px; padding: 0; }
  .jrCalCell--has { color: #fff; background: rgba(251,191,36,.08); border-color: rgba(251,191,36,.2); cursor: pointer; }
  .jrCalCell--today { outline: 1px solid rgba(255,255,255,.35); }
  .jrCalCell--sel { background: rgba(251,191,36,.3); border-color: #f59e0b; }
  .jrCalCell i { font-style: normal; font-size: 11px; line-height: 1; }
  .jrCalCell b { width: 5px; height: 5px; border-radius: 50%; background: #f59e0b; }
  .jrSearchRow { display: flex; gap: 8px; align-items: center; }
  .jrSearch { flex: 1; min-width: 0; background: rgba(255,255,255,.05); color: #fff; border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 9px 12px; font-size: 14px; outline: none; }

  .jrList { display: flex; flex-direction: column; gap: 16px; }
  .jrDayHead { display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: #fcd34d; opacity: .85; margin-bottom: 6px; }
  .jrDayMoods { letter-spacing: 2px; font-size: 13px; }
  .jrEntry { display: grid; grid-template-columns: 44px 24px 1fr auto; gap: 6px; align-items: start; padding: 10px 6px 10px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
  .jrEntryTime { font-size: 12px; opacity: .55; padding-top: 2px; font-variant-numeric: tabular-nums; }
  .jrEntryMood { font-size: 16px; }
  .jrEntryText { font-size: 15px; line-height: 1.5; word-break: break-word; }
  .jrEntryTags { margin-top: 4px; font-size: 12px; }
  .jrHash { color: #fcd34d; }
  .jrEntryEdit { width: 28px; height: 28px; font-size: 13px; opacity: .6; }
  .jrEntry--edit { display: flex; flex-direction: column; gap: 8px; padding: 10px; background: rgba(255,255,255,.04); border-radius: 14px; border: 1px solid rgba(251,191,36,.3); }
  .jrEmpty { font-size: 14px; opacity: .6; line-height: 1.5; padding: 18px; text-align: center; border: 1px dashed rgba(255,255,255,.15); border-radius: 16px; }
  .jrMore { align-self: center; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); color: #e5e7eb; border-radius: 12px; padding: 8px 16px; cursor: pointer; }
  </style>`;
}
