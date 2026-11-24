/**
 * widgetInbox.js — Buzón de la app de widgets (APK) y resumen para mostrar en ellos
 * MemoryCarl API
 *
 * La APK no puede escribir en la app web (sus datos viven en el teléfono, dentro del navegador),
 * así que deja cada registro en un buzón (tabla widget_inbox). Cuando abres MemoryCarl, la app
 * baja lo pendiente, lo aplica y recién entonces confirma: solo lo confirmado se marca aplicado,
 * así nada se pierde si algo falla a mitad de camino.
 *
 * El resumen (cuentas, categorías, lo que queda hasta el cobro, tareas con hora…) lo publica la
 * app web como módulo "widget_summary" en app_modules; la APK lo lee de aquí.
 *
 * Seguridad: estas rutas exigen la API_SECRET_KEY exacta (no aceptan la clave anónima ni "auto").
 */

const KINDS = ["expense", "journal", "task_done", "task_snooze", "scales"];
// Bitácora 1–10 (lo que se marca a mano; sueño y ánimo salen de sus propios registros)
const SCALE_IDS = ["energy", "stress", "focus", "food", "water", "body"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Revisa y limpia un registro del buzón.
 * @returns {{ ok: true, item: object } | { ok: false, error: string }}
 */
function validateInboxItem(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Registro vacío." };
  const id = String(raw.id || "");
  if (!ID_RE.test(id)) return { ok: false, error: "Falta un id válido (8 a 64 letras, números, - o _)." };
  if (!KINDS.includes(raw.kind)) return { ok: false, error: `Tipo desconocido: ${raw.kind}` };
  const ts = Number(raw.ts);
  const clientTs = Number.isFinite(ts) && ts > 1.5e12 && ts < Date.now() + 86400000 ? ts : Date.now();
  const d = raw.data && typeof raw.data === "object" ? raw.data : {};
  let data;
  switch (raw.kind) {
    case "expense": {
      const amount = Math.round(Number(String(d.amount ?? "").replace(",", ".")) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return { ok: false, error: "Monto inválido." };
      data = { amount, category: str(d.category, 40) || "Otros", accountId: str(d.accountId, 80), note: str(d.note, 200) };
      break;
    }
    case "journal": {
      const text = String(d.text ?? "").trim().slice(0, 4000);
      if (!text) return { ok: false, error: "El texto está vacío." };
      data = { text, mood: str(d.mood, 20) || null };
      break;
    }
    case "scales": {
      const date = String(d.date || "");
      const t = Date.parse(`${date}T12:00:00Z`);
      if (!DATE_RE.test(date) || !Number.isFinite(t)) return { ok: false, error: "Fecha inválida." };
      if (t > Date.now() + 2 * 86400000 || t < Date.now() - 400 * 86400000) return { ok: false, error: "La fecha está fuera de rango." };
      const src = d.values && typeof d.values === "object" ? d.values : {};
      const values = {};
      for (const k of SCALE_IDS) {
        if (src[k] === undefined || src[k] === null || src[k] === "") continue;
        const n = Math.round(Number(src[k]));
        if (!Number.isFinite(n) || n < 1 || n > 10) return { ok: false, error: `Valor inválido en ${k} (va del 1 al 10).` };
        values[k] = n;
      }
      if (!Object.keys(values).length) return { ok: false, error: "No hay ningún valor de la Bitácora." };
      data = { date, values };
      break;
    }
    case "task_done":
    case "task_snooze": {
      const taskId = str(d.taskId, 80);
      if (!taskId) return { ok: false, error: "Falta la tarea." };
      data = { taskId };
      if (raw.kind === "task_snooze") {
        const at = new Date(d.remindAt);
        if (!Number.isFinite(at.getTime())) return { ok: false, error: "Hora inválida." };
        data.remindAt = at.toISOString();
      }
      break;
    }
    default:
      return { ok: false, error: "Tipo desconocido." };
  }
  return { ok: true, item: { id, kind: raw.kind, data, client_ts: new Date(clientTs).toISOString() } };
}

/** Exige la API_SECRET_KEY exacta. */
function requireWidgetKey(req, res, next) {
  const expected = process.env.API_SECRET_KEY;
  if (!expected) {
    return res.status(503).json({ status: "error", message: "Falta configurar API_SECRET_KEY en Vercel para usar los widgets." });
  }
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (token !== expected) return res.status(401).json({ status: "error", message: "API key incorrecta." });
  return next();
}

const missingTable = (err) => /widget_inbox/.test(String(err?.message || "")) && /(does not exist|not find|schema cache)/i.test(String(err?.message || ""));
const tableHint = "Falta crear la tabla widget_inbox en Supabase: corre el bloque 'WIDGETS' de supabase/schema.sql.";

/** Rutas del buzón y del resumen, sobre un cliente de Supabase. */
function mountWidgetRoutes(app, getSupabase) {
  const db = (res) => {
    const s = getSupabase();
    if (!s) res.status(500).json({ status: "error", message: "Supabase no configurado en el servidor." });
    return s;
  };
  const fail = (res, err) => {
    const msg = String(err?.message || err);
    const rls = /row-level security|permission denied/i.test(msg);
    res.status(500).json({
      status: "error",
      message: missingTable(err) ? tableHint
        : rls ? "Supabase no deja escribir en widget_inbox: configura SUPABASE_SERVICE_ROLE_KEY en Vercel (la tabla no es pública a propósito)."
        : msg,
    });
  };

  // La APK deja registros (uno o varios). Reenviar el mismo id no lo duplica.
  app.post("/api/widget/inbox", requireWidgetKey, async (req, res) => {
    const s = db(res);
    if (!s) return;
    const list = Array.isArray(req.body?.items) ? req.body.items : [req.body];
    if (!list.length || list.length > 50) return res.status(400).json({ status: "error", message: "Manda entre 1 y 50 registros." });
    const rows = [];
    const rejected = [];
    for (const raw of list) {
      const v = validateInboxItem(raw);
      if (v.ok) rows.push(v.item);
      else rejected.push({ id: raw?.id || null, error: v.error });
    }
    if (!rows.length) return res.status(400).json({ status: "error", message: rejected[0]?.error || "Nada válido.", rejected });
    try {
      const { error } = await s.from("widget_inbox").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
      res.json({ status: "ok", accepted: rows.map((r) => r.id), rejected });
    } catch (err) {
      fail(res, err);
    }
  });

  // La app web baja lo que falta aplicar
  app.get("/api/widget/inbox/pending", requireWidgetKey, async (_req, res) => {
    const s = db(res);
    if (!s) return;
    try {
      const { data, error } = await s.from("widget_inbox").select("*").is("applied_at", null).order("client_ts", { ascending: true }).limit(200);
      if (error) throw error;
      res.json({ status: "ok", data: data || [] });
    } catch (err) {
      fail(res, err);
    }
  });

  // La app web confirma lo que ya aplicó
  app.post("/api/widget/inbox/ack", requireWidgetKey, async (req, res) => {
    const s = db(res);
    if (!s) return;
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter((x) => ID_RE.test(x)).slice(0, 200);
    if (!ids.length) return res.status(400).json({ status: "error", message: "Faltan ids." });
    try {
      const { error } = await s.from("widget_inbox").update({ applied_at: new Date().toISOString() }).in("id", ids);
      if (error) throw error;
      res.json({ status: "ok", acked: ids.length });
    } catch (err) {
      fail(res, err);
    }
  });

  // Estado de los registros que mandó la APK (para mostrar "✓ aplicado")
  app.get("/api/widget/inbox/status", requireWidgetKey, async (req, res) => {
    const s = db(res);
    if (!s) return;
    const ids = String(req.query.ids || "").split(",").filter((x) => ID_RE.test(x)).slice(0, 100);
    if (!ids.length) return res.json({ status: "ok", data: [] });
    try {
      const { data, error } = await s.from("widget_inbox").select("id, applied_at").in("id", ids);
      if (error) throw error;
      res.json({ status: "ok", data: data || [] });
    } catch (err) {
      fail(res, err);
    }
  });

  // Resumen para los widgets (lo publica la app web)
  app.get("/api/widget/summary", requireWidgetKey, async (_req, res) => {
    const s = db(res);
    if (!s) return;
    try {
      const { data, error } = await s.from("app_modules").select("payload, updated_at").eq("id", "widget_summary").maybeSingle();
      if (error) throw error;
      res.json({ status: "ok", data: data?.payload || null, updatedAt: data?.updated_at || null });
    } catch (err) {
      fail(res, err);
    }
  });
}

module.exports = { validateInboxItem, requireWidgetKey, mountWidgetRoutes, KINDS };
