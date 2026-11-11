/**
 * graphRepairPlan.js — Plan de limpieza del grafo de neuronas (lógica pura)
 * MemoryCarl / NeuroChat
 *
 * 1. buildRepairInput: versión compacta de las neuronas para mandarle a Claude.
 * 2. REPAIR_PLAN_SCHEMA: forma exacta de la respuesta (salida estructurada).
 * 3. validateRepairPlan: descarta todo lo que no sea seguro (ids inventados, borrar
 *    neuronas fijadas o manuales, borrar demasiado, dominios fuera del vocabulario…).
 * 4. applyRepairPlan: aplica el plan sobre una copia y devuelve el grafo nuevo,
 *    con las conexiones de las neuronas fusionadas redirigidas y todas bidireccionales.
 *
 * Nada aquí toca localStorage ni la red.
 */

export const REPAIR_DOMAINS = [
  "general", "personal", "work", "health", "finance", "relationships",
  "habits", "beliefs", "emotions", "learning", "creativity",
];

/** Triggers que no sirven para activar nada: demasiado comunes. */
const GENERIC_TRIGGERS = new Set([
  "yo", "mi", "mis", "me", "tu", "el", "la", "los", "las", "un", "una", "de", "del", "que", "y", "o",
  "en", "con", "por", "para", "es", "son", "fue", "ser", "estar", "hay", "muy", "mas", "más", "pero",
  "algo", "cosa", "cosas", "vida", "dia", "día", "hoy", "ayer", "siempre", "nunca", "todo", "nada",
  "persona", "gente", "general", "tema", "otro", "otra", "bien", "mal",
]);

export const MAX_CONNECTIONS = 30;
export const MAX_TRIGGERS = 20;

const str = (v) => (typeof v === "string" ? v.trim() : "");
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function isProtectedNeuron(n) {
  return Boolean(n?.meta?.pin || n?.pin || n?.type === "manual_context" || n?.type === "identity_anchor" || n?.source === "manual");
}

export function conceptOf(n) {
  return str(n?.core?.concept);
}

/** Nombre de respaldo para una neurona sin concepto: primeras palabras del resumen o del primer trigger. */
export function fallbackConcept(n) {
  const summary = str(n?.core?.summary).replace(/\s+/g, " ");
  if (summary) {
    const firstClause = summary.split(/[.;:\n]/)[0].trim();
    const words = firstClause.split(" ").slice(0, 6).join(" ");
    if (words) return clip(words.charAt(0).toUpperCase() + words.slice(1), 60);
  }
  const trig = (Array.isArray(n?.triggers) ? n.triggers : []).map(str).find(Boolean);
  if (trig) return clip(trig.charAt(0).toUpperCase() + trig.slice(1), 60);
  return "";
}

export function cleanTrigger(t) {
  const v = str(t).toLowerCase().replace(/\s+/g, " ");
  if (!v || v.length < 3 || v.length > 40) return "";
  if (GENERIC_TRIGGERS.has(v)) return "";
  if (/^\d+$/.test(v)) return "";
  return v;
}

/**
 * Versión compacta del grafo: sin listas de conexiones completas (solo el conteo y
 * hasta 5 vecinos por nombre), resúmenes recortados y pocos triggers.
 */
export function buildRepairInput(neurons = []) {
  const live = neurons.filter((n) => n && n.id && !n.deleted && !n.deletedAt);
  const byId = new Map(live.map((n) => [String(n.id), n]));
  return live.map((n) => {
    const conns = (Array.isArray(n.connections) ? n.connections : []).map(String).filter((id) => byId.has(id));
    const row = {
      id: String(n.id),
      c: conceptOf(n),
      t: n.type || "memory",
      d: str(n.core?.domain) || "general",
      s: clip(str(n.core?.summary).replace(/\s+/g, " "), 180),
      tr: (Array.isArray(n.triggers) ? n.triggers : []).map(str).filter(Boolean).slice(0, 6),
      k: conns.length,
      v: conns.slice(0, 5).map((id) => clip(conceptOf(byId.get(id)) || id, 30)),
    };
    if (n.temporal?.isPast || n.temporal?.isHistorical) row.past = true;
    if (isProtectedNeuron(n)) row.fija = true;
    return row;
  });
}

const reasonProp = { type: "string", description: "Motivo breve en español" };

/** Esquema JSON de la respuesta (output_config.format). */
export const REPAIR_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "deletions", "merges", "updates", "connections"],
  properties: {
    summary: { type: "string", description: "Resumen en español de lo que se propone, 1-3 frases" },
    deletions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "reason"],
        properties: { id: { type: "string" }, reason: reasonProp },
      },
    },
    merges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["keepId", "removeIds", "concept", "summary", "reason"],
        properties: {
          keepId: { type: "string" },
          removeIds: { type: "array", items: { type: "string" } },
          concept: { type: "string", description: "Nombre final, o vacío para dejar el actual" },
          summary: { type: "string", description: "Resumen unificado, o vacío para dejar el actual" },
          reason: reasonProp,
        },
      },
    },
    updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "concept", "summary", "domain", "addTriggers", "removeTriggers", "reason"],
        properties: {
          id: { type: "string" },
          concept: { type: "string", description: "Nombre nuevo, o vacío para no cambiarlo" },
          summary: { type: "string", description: "Resumen nuevo, o vacío para no cambiarlo" },
          domain: { type: "string", description: "Uno del vocabulario, o vacío para no cambiarlo" },
          addTriggers: { type: "array", items: { type: "string" } },
          removeTriggers: { type: "array", items: { type: "string" } },
          reason: reasonProp,
        },
      },
    },
    connections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["a", "b", "reason"],
        properties: { a: { type: "string" }, b: { type: "string" }, reason: reasonProp },
      },
    },
  },
};

export const REPAIR_SYSTEM_PROMPT = `Eres el jardinero del grafo de memoria personal de una app. Cada neurona es un recuerdo, persona, hábito, creencia o tema de la vida del usuario. Tu trabajo es proponer una limpieza conservadora; el usuario revisará el plan antes de aplicarlo.

Formato de cada neurona: id, c (nombre/concepto), t (tipo), d (dominio), s (resumen), tr (triggers), k (cuántas conexiones tiene), v (nombres de algunas vecinas), past (ya es pasado), fija (protegida: no se borra ni se fusiona dentro de otra).

Propón, solo cuando estés seguro:
1. deletions: neuronas basura (vacías, sin sentido, ruido técnico). Nunca borres información real del usuario solo por ser corta.
2. merges: neuronas que son claramente LA MISMA persona, lugar o tema. keepId es la que queda (la más completa o con más conexiones); removeIds se funden en ella. Dos personas distintas con el mismo nombre NO se fusionan.
3. updates: nombres vacíos o poco claros (toda neurona con c vacío debe recibir un nombre corto aquí o borrarse), dominios fuera del vocabulario, triggers genéricos que sobran y triggers útiles que faltan. Deja vacío lo que no cambie.
4. connections: pares de neuronas que deberían estar conectadas y no lo están (familia, trabajo y sus proyectos, hábito y su meta). Máximo 40.

Reglas:
- Usa solo ids que existan en la lista.
- Dominios permitidos: ${REPAIR_DOMAINS.join(", ")}.
- Nombres de neurona cortos (2-6 palabras), en español, como los usaría el usuario.
- No inventes datos que no estén en los resúmenes.
- Si el grafo ya está bien, devuelve listas vacías. Es mejor proponer poco y bien.`;

/**
 * Limpia el plan que devolvió Claude. Devuelve { plan, warnings }.
 * @param {object} raw - respuesta parseada
 * @param {Array} neurons - neuronas actuales
 * @param {{ maxDeleteRatio?: number, maxConnections?: number }} [opts]
 */
export function validateRepairPlan(raw, neurons = [], opts = {}) {
  const maxDeleteRatio = opts.maxDeleteRatio ?? 0.15;
  const maxNewConnections = opts.maxConnections ?? 60;
  const live = neurons.filter((n) => n && n.id && !n.deleted && !n.deletedAt);
  const byId = new Map(live.map((n) => [String(n.id), n]));
  const warnings = [];
  const touched = new Set(); // ids que se borran o se funden dentro de otra

  const r = raw && typeof raw === "object" ? raw : {};

  // --- Fusiones ---
  const merges = [];
  for (const m of Array.isArray(r.merges) ? r.merges : []) {
    const keepId = str(m?.keepId);
    if (!byId.has(keepId) || touched.has(keepId)) continue;
    const removeIds = [...new Set((Array.isArray(m?.removeIds) ? m.removeIds : []).map(str))]
      .filter((id) => id && id !== keepId && byId.has(id) && !touched.has(id) && !merges.some((x) => x.keepId === id));
    const safe = removeIds.filter((id) => {
      if (isProtectedNeuron(byId.get(id))) { warnings.push(`No se fusiona "${conceptOf(byId.get(id)) || id}": está fijada.`); return false; }
      return true;
    });
    if (!safe.length) continue;
    safe.forEach((id) => touched.add(id));
    merges.push({
      keepId,
      removeIds: safe,
      concept: clip(str(m?.concept), 80),
      summary: clip(str(m?.summary), 600),
      reason: clip(str(m?.reason), 200),
    });
  }

  // --- Borrados ---
  const maxDeletes = Math.max(1, Math.ceil(live.length * maxDeleteRatio));
  const deletions = [];
  for (const d of Array.isArray(r.deletions) ? r.deletions : []) {
    const id = str(typeof d === "string" ? d : d?.id);
    if (!byId.has(id) || touched.has(id) || merges.some((m) => m.keepId === id)) continue;
    if (isProtectedNeuron(byId.get(id))) { warnings.push(`No se borra "${conceptOf(byId.get(id)) || id}": está fijada.`); continue; }
    if (deletions.length >= maxDeletes) { warnings.push(`Se limitaron los borrados a ${maxDeletes} para no perder información.`); break; }
    touched.add(id);
    deletions.push({ id, reason: clip(str(d?.reason), 200) });
  }

  // --- Cambios ---
  const updates = [];
  const seenUpd = new Map();
  for (const u of Array.isArray(r.updates) ? r.updates : []) {
    const id = str(u?.id);
    const n = byId.get(id);
    if (!n || touched.has(id)) continue;
    const concept = clip(str(u?.concept), 80);
    const summary = clip(str(u?.summary), 600);
    const domainRaw = str(u?.domain).toLowerCase();
    const domain = REPAIR_DOMAINS.includes(domainRaw) ? domainRaw : "";
    if (domainRaw && !domain) warnings.push(`Dominio "${domainRaw}" ignorado (no existe en la app).`);
    const current = new Set((n.triggers || []).map((t) => str(t).toLowerCase()));
    const addTriggers = [...new Set((Array.isArray(u?.addTriggers) ? u.addTriggers : []).map(cleanTrigger))].filter((t) => t && !current.has(t));
    const removeTriggers = [...new Set((Array.isArray(u?.removeTriggers) ? u.removeTriggers : []).map((t) => str(t).toLowerCase()))].filter((t) => t && current.has(t));
    const upd = {
      id,
      concept: concept && concept !== conceptOf(n) ? concept : "",
      summary: summary && summary !== str(n.core?.summary) ? summary : "",
      domain: domain && domain !== str(n.core?.domain) ? domain : "",
      addTriggers,
      removeTriggers,
      reason: clip(str(u?.reason), 200),
    };
    if (!upd.concept && !upd.summary && !upd.domain && !addTriggers.length && !removeTriggers.length) continue;
    if (seenUpd.has(id)) {
      const prev = seenUpd.get(id);
      prev.concept ||= upd.concept; prev.summary ||= upd.summary; prev.domain ||= upd.domain;
      prev.addTriggers = [...new Set([...prev.addTriggers, ...addTriggers])];
      prev.removeTriggers = [...new Set([...prev.removeTriggers, ...removeTriggers])];
      continue;
    }
    seenUpd.set(id, upd);
    updates.push(upd);
  }

  // Ninguna neurona queda sin nombre: si Claude no la nombró ni la borró, se nombra con su resumen
  // o se borra si no tiene nada.
  const keepConcepts = new Map(merges.map((m) => [m.keepId, m.concept]));
  for (const n of live) {
    const id = String(n.id);
    if (touched.has(id) || conceptOf(n) || keepConcepts.get(id) || seenUpd.get(id)?.concept) continue;
    const name = fallbackConcept(n);
    if (name) {
      const upd = seenUpd.get(id);
      if (upd) upd.concept = name;
      else {
        const nu = { id, concept: name, summary: "", domain: "", addTriggers: [], removeTriggers: [], reason: "No tenía nombre; se toma de su resumen." };
        seenUpd.set(id, nu);
        updates.push(nu);
      }
    } else if (!isProtectedNeuron(n)) {
      touched.add(id);
      deletions.push({ id, reason: "Neurona vacía: sin nombre, resumen ni triggers." });
    }
  }

  // --- Conexiones nuevas ---
  const gone = new Set([...touched]);
  const redirect = new Map();
  for (const m of merges) for (const id of m.removeIds) redirect.set(id, m.keepId);
  const resolve = (id) => redirect.get(id) || id;
  const connected = (a, b) => (byId.get(a)?.connections || []).map(String).includes(b) || (byId.get(b)?.connections || []).map(String).includes(a);
  const connections = [];
  const pairSeen = new Set();
  for (const c of Array.isArray(r.connections) ? r.connections : []) {
    const a = resolve(str(c?.a));
    const b = resolve(str(c?.b));
    if (!a || !b || a === b || !byId.has(a) || !byId.has(b) || gone.has(a) && !redirect.has(a) || deletions.some((d) => d.id === a || d.id === b)) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (pairSeen.has(key) || connected(a, b)) continue;
    if (connections.length >= maxNewConnections) break;
    pairSeen.add(key);
    connections.push({ a, b, reason: clip(str(c?.reason), 200) });
  }

  return {
    plan: { summary: clip(str(r.summary), 800), deletions, merges, updates, connections },
    warnings: [...new Set(warnings)],
  };
}

export function planIsEmpty(plan) {
  return !plan || (!plan.deletions?.length && !plan.merges?.length && !plan.updates?.length && !plan.connections?.length);
}

/**
 * Aplica un plan ya validado. No muta las neuronas recibidas.
 * Devuelve { neurons, removedIds, mergedInto, stats }.
 */
export function applyRepairPlan(neurons = [], plan = {}, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const all = neurons.filter(Boolean).map((n) => ({
    ...n,
    core: { ...(n.core || {}) },
    triggers: Array.isArray(n.triggers) ? [...n.triggers] : [],
    connections: Array.isArray(n.connections) ? n.connections.map(String) : [],
  }));
  const byId = new Map(all.map((n) => [String(n.id), n]));
  const mergedInto = {};
  const removed = new Set();
  const stats = { deleted: 0, merged: 0, updated: 0, connected: 0, fixedLinks: 0 };

  for (const m of plan.merges || []) {
    const keep = byId.get(m.keepId);
    if (!keep) continue;
    for (const rid of m.removeIds || []) {
      const src = byId.get(rid);
      if (!src || removed.has(rid)) continue;
      keep.triggers = [...new Set([...keep.triggers, ...src.triggers.map((t) => str(t).toLowerCase()).filter(Boolean)])];
      keep.connections = [...new Set([...keep.connections, ...src.connections])];
      if (typeof src.weight === "number") keep.weight = Math.max(typeof keep.weight === "number" ? keep.weight : 0, src.weight);
      if (typeof src.timesActivated === "number") keep.timesActivated = (keep.timesActivated || 0) + src.timesActivated;
      if (!str(keep.core.summary) && str(src.core?.summary)) keep.core.summary = src.core.summary;
      if (!str(keep.core.concept) && str(src.core?.concept)) keep.core.concept = src.core.concept;
      mergedInto[rid] = String(keep.id);
      removed.add(rid);
      stats.merged++;
    }
    if (m.concept) keep.core.concept = m.concept;
    if (m.summary) keep.core.summary = m.summary;
    keep.updatedAt = now;
  }

  for (const d of plan.deletions || []) {
    if (!byId.has(d.id) || removed.has(d.id)) continue;
    removed.add(d.id);
    stats.deleted++;
  }

  for (const u of plan.updates || []) {
    const n = byId.get(u.id);
    if (!n || removed.has(u.id)) continue;
    if (u.concept) n.core.concept = u.concept;
    if (u.summary) n.core.summary = u.summary;
    if (u.domain) n.core.domain = u.domain;
    if (u.removeTriggers?.length) {
      const drop = new Set(u.removeTriggers.map((t) => str(t).toLowerCase()));
      n.triggers = n.triggers.filter((t) => !drop.has(str(t).toLowerCase()));
    }
    if (u.addTriggers?.length) n.triggers = [...new Set([...n.triggers, ...u.addTriggers])];
    n.updatedAt = now;
    stats.updated++;
  }

  const resolve = (id) => {
    let cur = String(id);
    const seen = new Set();
    while (mergedInto[cur] && !seen.has(cur)) { seen.add(cur); cur = mergedInto[cur]; }
    return cur;
  };

  const kept = all.filter((n) => !removed.has(String(n.id)));
  const keptById = new Map(kept.map((n) => [String(n.id), n]));

  // Redirigir conexiones a fusionadas, quitar rotas y auto-conexiones
  for (const n of kept) {
    const before = n.connections.length;
    const next = [];
    for (const raw of n.connections) {
      const id = resolve(raw);
      if (id === String(n.id) || !keptById.has(id) || next.includes(id)) continue;
      next.push(id);
    }
    if (next.length !== before || next.some((id, i) => id !== n.connections[i])) stats.fixedLinks++;
    n.connections = next;
  }

  for (const c of plan.connections || []) {
    const a = keptById.get(resolve(c.a));
    const b = keptById.get(resolve(c.b));
    if (!a || !b || a === b) continue;
    if (!a.connections.includes(String(b.id))) a.connections.push(String(b.id));
    if (!b.connections.includes(String(a.id))) b.connections.push(String(a.id));
    stats.connected++;
  }

  // Todas bidireccionales
  for (const n of kept) {
    for (const id of n.connections) {
      const other = keptById.get(id);
      if (other && !other.connections.includes(String(n.id))) {
        other.connections.push(String(n.id));
        stats.fixedLinks++;
      }
    }
  }

  for (const n of kept) {
    n.triggers = n.triggers.slice(0, MAX_TRIGGERS);
    n.numberOfConnections = n.connections.length;
  }

  return { neurons: kept, removedIds: [...removed], mergedInto, stats };
}
