/**
 * tdhaStore.js — Registros y chat de la pestaña TDHA
 * MemoryCarl · NeuroChat › TDHA
 *
 * localStorage "memorycarl_tdha_v1" = { entries: [...], chat: [...] }
 *   entry: { id, ts, state, signals[], factors[], text, source: "chat" | "quick", updatedAt }
 *   chat:  { id, ts, role: "user" | "carl", text, entryId? }
 * Se sube a Supabase como módulo "tdha" (app_modules) y se une por id al bajar.
 */

import { sameHook } from "./tdhaEngine.js";

export const TDHA_KEY = "memorycarl_tdha_v1";

const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(TDHA_KEY) || "null");
    return { entries: Array.isArray(v?.entries) ? v.entries : [], chat: Array.isArray(v?.chat) ? v.chat : [], hooks: Array.isArray(v?.hooks) ? v.hooks : [], forgets: Array.isArray(v?.forgets) ? v.forgets : [] };
  } catch (_e) { return { entries: [], chat: [], hooks: [], forgets: [] }; }
};
const write = (d) => { try { localStorage.setItem(TDHA_KEY, JSON.stringify(d)); } catch (_e) {} };
const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const loadTdha = read;
export function saveTdha(d) { write({ entries: d.entries || [], chat: (d.chat || []).slice(-400), hooks: d.hooks || [], forgets: d.forgets || [] }); }

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

/** Registra una mención de un enganche (se une con uno parecido; si estaba cerrado, vuelve). */
export function upsertHook(name, ts = Date.now()) {
  const d = read();
  let h = d.hooks.find((x) => sameHook(x.name, name));
  if (h) {
    h.mentions = [...new Set([...(h.mentions || []), ts])].sort((a, b) => a - b);
    h.lastTs = Math.max(h.lastTs || 0, ts);
    if (h.endedTs && ts > h.endedTs) delete h.endedTs;
    h.updatedAt = new Date().toISOString();
  } else {
    h = { id: uid("hk"), name: String(name).trim(), firstTs: ts, lastTs: ts, mentions: [ts], updatedAt: new Date().toISOString() };
    d.hooks.push(h);
  }
  write(d);
  return h;
}

export function updateHook(id, patch) {
  const d = read();
  const h = d.hooks.find((x) => x.id === id);
  if (!h) return null;
  Object.assign(h, patch, { updatedAt: new Date().toISOString() });
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete h[k];
  write(d);
  return h;
}

export function deleteHook(id) { const d = read(); d.hooks = d.hooks.filter((x) => x.id !== id); write(d); }

// ---- Olvidos ----
export function addForget(f) {
  const d = read();
  const x = { id: uid("fg"), ts: Date.now(), kind: "otro", pending: false, resolved: false, ...f, updatedAt: new Date().toISOString() };
  d.forgets.push(x);
  write(d);
  return x;
}
export function updateForget(id, patch) {
  const d = read();
  const x = d.forgets.find((f) => f.id === id);
  if (!x) return null;
  Object.assign(x, patch, { updatedAt: new Date().toISOString() });
  write(d);
  return x;
}
export function deleteForget(id) { const d = read(); d.forgets = d.forgets.filter((f) => f.id !== id); write(d); }

export function clearChat() { const d = read(); d.chat = []; write(d); }

/** Payload para la nube (null si no hay nada: así no pisa la copia de la nube). */
export function tdhaPayload() {
  const d = read();
  if (!d.entries.length && !d.chat.length && !d.hooks.length && !d.forgets.length) return null;
  return { entries: d.entries, chat: d.chat.slice(-200), hooks: d.hooks, forgets: d.forgets };
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
  const hooks = new Map((local.hooks || []).map((h) => [h.id, h]));
  for (const h of cloud?.hooks || []) {
    if (!h?.id) continue;
    const cur = hooks.get(h.id);
    if (!cur || String(h.updatedAt || "") > String(cur.updatedAt || "")) { hooks.set(h.id, h); changed = true; }
  }
  const forgets = new Map((local.forgets || []).map((f) => [f.id, f]));
  for (const f of cloud?.forgets || []) {
    if (!f?.id) continue;
    const cur = forgets.get(f.id);
    if (!cur || String(f.updatedAt || "") > String(cur.updatedAt || "")) { forgets.set(f.id, f); changed = true; }
  }
  return { entries: [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)), chat, hooks: [...hooks.values()], forgets: [...forgets.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)), changed };
}
