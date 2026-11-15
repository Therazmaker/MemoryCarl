/**
 * tdhaStore.js — Registros y chat de la pestaña TDHA
 * MemoryCarl · NeuroChat › TDHA
 *
 * localStorage "memorycarl_tdha_v1" = { entries: [...], chat: [...] }
 *   entry: { id, ts, state, signals[], factors[], text, source: "chat" | "quick", updatedAt }
 *   chat:  { id, ts, role: "user" | "carl", text, entryId? }
 * Se sube a Supabase como módulo "tdha" (app_modules) y se une por id al bajar.
 */

export const TDHA_KEY = "memorycarl_tdha_v1";

const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(TDHA_KEY) || "null");
    return { entries: Array.isArray(v?.entries) ? v.entries : [], chat: Array.isArray(v?.chat) ? v.chat : [] };
  } catch (_e) { return { entries: [], chat: [] }; }
};
const write = (d) => { try { localStorage.setItem(TDHA_KEY, JSON.stringify(d)); } catch (_e) {} };
const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const loadTdha = read;
export function saveTdha(d) { write({ entries: d.entries || [], chat: (d.chat || []).slice(-400) }); }

export function addEntry(entry) {
  const d = read();
  const e = { id: uid("td"), ts: Date.now(), signals: [], factors: [], ...entry, updatedAt: new Date().toISOString() };
  d.entries.push(e);
  write(d);
  return e;
}

export function updateEntry(id, patch) {
  const d = read();
  const e = d.entries.find((x) => x.id === id);
  if (!e) return null;
  Object.assign(e, patch, { updatedAt: new Date().toISOString() });
  write(d);
  return e;
}

export function deleteEntry(id) {
  const d = read();
  d.entries = d.entries.filter((x) => x.id !== id);
  d.chat = d.chat.map((m) => (m.entryId === id ? { ...m, entryId: null } : m));
  write(d);
}

export function pushChat(msg) {
  const d = read();
  const m = { id: uid("tc"), ts: Date.now(), ...msg };
  d.chat.push(m);
  write(d);
  return m;
}

export function clearChat() { const d = read(); d.chat = []; write(d); }

/** Payload para la nube (null si no hay nada: así no pisa la copia de la nube). */
export function tdhaPayload() {
  const d = read();
  if (!d.entries.length && !d.chat.length) return null;
  return { entries: d.entries, chat: d.chat.slice(-200) };
}

/** Une lo que viene de la nube con lo local (por id; gana el más reciente). */
export function mergeTdha(local, cloud) {
  const byId = new Map((local.entries || []).map((e) => [e.id, e]));
  let changed = false;
  for (const e of cloud?.entries || []) {
    if (!e?.id) continue;
    const cur = byId.get(e.id);
    if (!cur || String(e.updatedAt || "") > String(cur.updatedAt || "")) { byId.set(e.id, e); changed = true; }
  }
  const chatIds = new Set((local.chat || []).map((m) => m.id));
  const chat = [...(local.chat || [])];
  for (const m of cloud?.chat || []) if (m?.id && !chatIds.has(m.id)) { chat.push(m); changed = true; }
  chat.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return { entries: [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)), chat, changed };
}
