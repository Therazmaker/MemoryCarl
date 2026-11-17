/**
 * peopleDirectory.js — Directorio fijo de personas (quién es quién)
 * MemoryCarl / NeuroChat
 *
 * Antes, las personas solo llegaban a la IA si su neurona "se activaba" por parecido con el
 * mensaje. Si alguien nuevo aparecía ("Fernanda") la neurona más parecida era otra persona
 * ("Fergis") y la IA las confundía. Este directorio va SIEMPRE en el contexto, con el nombre
 * exacto, quién es para el usuario y sus apodos, y avisa de los nombres que no conoce.
 */

import { stampUpdatedAt } from "./lifeDates.js";
import { markAppStateChanged } from "../services/syncOutbox.js";

export const PEOPLE_KEY = "memorycarl_people_v1";
const MAX_IN_PROMPT = 40;

/** Minúsculas y sin tildes, para comparar nombres. */
export function normName(s = "") {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const cleanAliases = (list, name) => {
  const seen = new Set([normName(name)]);
  const out = [];
  for (const a of Array.isArray(list) ? list : String(list || "").split(",")) {
    const t = String(a || "").trim().slice(0, 40);
    const k = normName(t);
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(0, 8);
};

export function loadPeople() {
  try {
    if (typeof localStorage === "undefined") return [];
    const parsed = JSON.parse(localStorage.getItem(PEOPLE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((p) => p && p.id && p.name) : [];
  } catch (_e) {
    return [];
  }
}

export function savePeople(list) {
  try {
    if (typeof localStorage === "undefined") return;
    stampUpdatedAt(list, loadPeople());
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(list));
    markAppStateChanged();
    if (typeof window !== "undefined" && typeof window.neurochatPushToSupabase === "function") {
      window.neurochatPushToSupabase(false);
    }
  } catch (_e) {
    console.warn("[people] No se pudo guardar el directorio:", _e);
  }
}

/** Todos los nombres con los que se conoce a una persona (nombre + apodos), normalizados. */
export function namesOf(p) {
  return [p?.name, ...(p?.aliases || [])].map(normName).filter(Boolean);
}

/** Persona del directorio que se llama así (por nombre o apodo), o null. */
export function findPerson(name, people = loadPeople()) {
  const k = normName(name);
  if (!k) return null;
  return people.find((p) => !p.deleted && namesOf(p).includes(k)) || null;
}

/**
 * Agrega o actualiza una persona. Lo que el usuario escribió a mano no lo pisa la IA:
 * si la persona la editó el usuario, la IA solo puede sumar apodos.
 * @param {{ name: string, relation?: string, aliases?: string[]|string, note?: string, source?: string, id?: string }} input
 * @returns {object|null}
 */
export function upsertPerson(input = {}, opts = {}) {
  const name = String(input.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name || name.length < 2) return null;
  const list = opts.list || loadPeople();
  const source = input.source || "user";
  const byId = input.id ? list.find((p) => p.id === input.id) : null;
  const existing = byId || list.find((p) => !p.deleted && (namesOf(p).includes(normName(name)) || cleanAliases(input.aliases, name).some((a) => namesOf(p).includes(normName(a)))));
  const relation = String(input.relation || "").trim().slice(0, 120);
  const note = String(input.note || "").trim().slice(0, 200);

  if (existing) {
    const before = JSON.stringify(existing);
    const userOwned = existing.source === "user" && source !== "user";
    if (byId && source === "user") existing.name = name;
    if (relation && (!userOwned || !existing.relation)) existing.relation = relation;
    if (note && (!userOwned || !existing.note)) existing.note = note;
    const extra = source === "user" && byId ? cleanAliases(input.aliases, existing.name) : cleanAliases([...(existing.aliases || []), ...cleanAliases(input.aliases, name), ...(normName(name) !== normName(existing.name) ? [name] : [])], existing.name);
    existing.aliases = extra;
    if (source === "user") existing.source = "user";
    delete existing.deleted;
    if (JSON.stringify(existing) !== before && !opts.list) savePeople(list);
    return existing;
  }

  const person = {
    id: input.id || `person_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    relation,
    aliases: cleanAliases(input.aliases, name),
    ...(note ? { note } : {}),
    source,
    createdAt: new Date().toISOString(),
  };
  list.push(person);
  if (!opts.list) savePeople(list);
  return person;
}

/** Quita a una persona del directorio (queda marcada para que la nube no la devuelva). */
export function deletePerson(id) {
  const list = loadPeople();
  const p = list.find((x) => x.id === id);
  if (!p) return false;
  p.deleted = true;
  savePeople(list);
  return true;
}

const HONORIFICS = /^(señora|senora|sra\.?|señor|senor|sr\.?|don|doña|dona|tía|tia|tío|tio|mi)\s+/i;

/** Nombre propio al inicio del concepto de una neurona de persona ("Lucas: amigo" → "Lucas"). */
export function personNameFromNeuron(n) {
  const concept = String(n?.core?.concept || "").trim();
  if (!concept) return "";
  const head = concept.split(/\s*(?::|\(|—|–|\s-\s|,)\s*/)[0].replace(HONORIFICS, "").trim();
  if (!head || !/^\p{Lu}/u.test(head)) return "";
  const words = head.split(/\s+/);
  if (words.length > 3 || head.length < 3) return "";
  if (head === concept && words.length > 2) return "";
  return head;
}

const isPersonNeuron = (n) => ["person", "relationship"].includes(n?.type) || n?.meta?.manualCategory === "people";

/**
 * Suma al directorio las personas que ya existen como neuronas (para no empezar de cero).
 * No cambia a las que ya están.
 * @returns {number} cuántas se agregaron
 */
export function seedPeopleFromNeurons(neurons = [], opts = {}) {
  const list = opts.list || loadPeople();
  let added = 0;
  for (const n of neurons || []) {
    if (!n || n.deleted || n.feedbackStats?.removed || !isPersonNeuron(n)) continue;
    const name = personNameFromNeuron(n);
    if (!name || findPerson(name, list) || list.some((p) => p.deleted && namesOf(p).includes(normName(name)))) continue;
    const summary = String(n.core?.summary || "").split(/(?<=[.!?])\s/)[0].trim();
    const afterColon = String(n.core?.concept || "").split(":").slice(1).join(":").trim();
    upsertPerson({ name, relation: (afterColon || summary).slice(0, 120), aliases: n.meta?.aliases || [], source: "neurona" }, { list });
    added++;
  }
  if (added && !opts.list) savePeople(list);
  return added;
}

// Palabras que van con mayúscula sin ser nombres de persona
const NOT_NAMES = new Set(`hoy ayer manana tarde noche que pero hola y o me mi mis yo tu tus el la los las un una unos unas ya no si bueno oye ok okay carl gracias creo estoy estaba tengo tenia fue fui es era eso esto ese esa este esta esos esas aqui alla ahi como cuando donde porque por para con sin sobre entre desde hasta lunes martes miercoles jueves viernes sabado domingo enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre dios lima peru navidad ano nuevo semana mes dia vamos voy vas va van hay hice hizo tambien entonces bien mal mucho poco todo nada algo alguien nadie claro listo vale jaja jajaja ah eh uy ufff dale chevere pucha mira sabes tipo osea igual luego despues antes recien apenas siempre nunca casi mama papa hermano hermana hijo hija abuela abuelo tia tio primo prima amigo amiga jefe jefa doctor doctora whatsapp instagram facebook google youtube netflix spotify chatgpt gemini claude ia app gym ok neurochat canasta tdha finanzas`.split(/\s+/));

const levenshtein = (a, b) => {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
};

/** Dos nombres distintos que se pueden confundir: empiezan igual o difieren en pocas letras. */
export function looksAlike(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y || x === y) return false;
  if (x.length >= 3 && y.length >= 3 && x.slice(0, 3) === y.slice(0, 3)) return true;
  return Math.min(x.length, y.length) >= 4 && levenshtein(x, y) <= 2;
}

/**
 * Personas nombradas en un texto: las conocidas, los nombres que no están en el directorio
 * y los que se parecen a alguien conocido sin ser esa persona.
 * @returns {{ known: object[], unknown: string[], lookalikes: Array<{ said: string, person: object }> }}
 */
export function findMentions(text = "", people = loadPeople()) {
  const live = people.filter((p) => !p.deleted);
  const known = [];
  const unknown = [];
  const lookalikes = [];
  const t = normName(text);
  for (const p of live) {
    if (namesOf(p).some((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(t))) known.push(p);
  }
  const words = String(text || "").match(/(^|[\s,;:¿¡("'])(\p{Lu}[\p{Ll}]{2,})(?=$|[\s,;:.!?)"'])/gu) || [];
  const sentenceStart = (idx) => idx === 0 || /[.!?¿¡\n]\s*$/.test(String(text).slice(0, idx));
  let cursor = 0;
  const seen = new Set();
  for (const raw of words) {
    const word = raw.replace(/^[\s,;:¿¡("']+/, "");
    const idx = String(text).indexOf(word, cursor);
    cursor = idx + word.length;
    const k = normName(word);
    if (seen.has(k) || NOT_NAMES.has(k)) continue;
    seen.add(k);
    if (live.some((p) => namesOf(p).includes(k))) continue;
    const alike = live.find((p) => namesOf(p).some((n) => looksAlike(n, k)));
    if (alike) {
      lookalikes.push({ said: word, person: alike });
      unknown.push(word);
    } else if (!sentenceStart(idx)) {
      unknown.push(word);
    }
  }
  return { known, unknown, lookalikes };
}

/**
 * Bloque del prompt: el directorio completo y, para este mensaje, a quién nombra y qué
 * nombres no conoce.
 */
export function buildPeopleBlock(userInput = "", opts = {}) {
  const people = (opts.people || loadPeople()).filter((p) => !p.deleted);
  const m = findMentions(userInput, people);
  if (!people.length && !m.unknown.length) return "";
  const mentioned = new Set(m.known.map((p) => p.id));
  const ordered = [...people].sort((a, b) => (mentioned.has(b.id) - mentioned.has(a.id)) || (b.source === "user") - (a.source === "user") || a.name.localeCompare(b.name));
  const lines = ordered.slice(0, MAX_IN_PROMPT).map((p) => `- ${p.name}${p.aliases?.length ? ` (también le dice: ${p.aliases.join(", ")})` : ""}${p.relation ? ` — ${p.relation}` : ""}${p.note ? `. ${p.note}` : ""}`);
  let out = `\n\n## PERSONAS DE SU VIDA (directorio fijo: quién es quién)\nEscribe cada nombre EXACTAMENTE como aparece aquí. Nunca cambies un nombre por otro parecido ni inventes apodos. Alguien que no está en esta lista es otra persona: no la mezcles con nadie.${lines.length ? `\n${lines.join("\n")}` : "\n(todavía vacío)"}`;
  const notes = [];
  if (m.known.length) notes.push(`- Nombra a: ${m.known.map((p) => `${p.name}${p.relation ? ` (${p.relation})` : ""}`).join("; ")}.`);
  for (const l of m.lookalikes) notes.push(`- "${l.said}" NO es ${l.person.name}: son nombres distintos aunque se parezcan. Llámala/llámalo "${l.said}".`);
  const plainUnknown = m.unknown.filter((u) => !m.lookalikes.some((l) => l.said === u));
  if (plainUnknown.length) notes.push(`- Nombres que no están en el directorio: ${plainUnknown.map((u) => `"${u}"`).join(", ")}. Si es una persona y no sabes quién es, pregúntale de forma natural (y cuando te lo diga, guárdala con upsertPerson).`);
  if (m.lookalikes.length && !plainUnknown.length) notes.push("- Si no sabes quién es, pregúntale de forma natural (y cuando te lo diga, guárdala con upsertPerson).");
  if (notes.length) out += `\n### En este mensaje\n${notes.join("\n")}`;
  return out;
}

/** Une el directorio local con el de la nube (por id; gana el más reciente). */
export function mergePeople(local = [], cloud = []) {
  const map = new Map((local || []).filter((p) => p?.id).map((p) => [p.id, p]));
  let changed = false;
  for (const c of cloud || []) {
    if (!c?.id) continue;
    const l = map.get(c.id);
    if (!l || String(c.updatedAt || "") > String(l.updatedAt || "")) {
      map.set(c.id, c);
      changed = true;
    }
  }
  return { list: [...map.values()], changed };
}
