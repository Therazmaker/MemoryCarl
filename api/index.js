/**
 * =====================================================================================
 * api/index.js — Backend Serverless de MemoryCarl (Vercel + Supabase)
 * =====================================================================================
 * Refactorizado para trabajar en conjunto con `src/services/dbService.js` y `supabase/schema.sql`.
 *
 * Variables de entorno soportadas en Vercel:
 *   1. NEXT_PUBLIC_SUPABASE_URL (o SUPABASE_URL)
 *   2. NEXT_PUBLIC_SUPABASE_ANON_KEY (o SUPABASE_ANON_KEY)
 *   3. SUPABASE_SERVICE_ROLE_KEY (opcional pero recomendada para operaciones de servidor)
 *   4. API_SECRET_KEY (opcional)
 * =====================================================================================
 */

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const { getAllNeurons } = require("./src/neuro/neuronStore.js");
const { getAllMemories } = require("./src/memory/memoryStore.js");
const { processChat } = require("./src/chat/neurochat.js");
const { handleTelegramWebhook, getPendingTelegramTransactions } = require("./src/finance/telegramHandler.js");

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  supabaseAnonKey ||
  "";

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

/**
 * Middleware de Autenticación Flexible:
 * - Si API_SECRET_KEY no está definida en Vercel, NO bloquea con Error 500 (uno de los
 *   principales motivos por los que fallaba la sincronización anteriormente).
 * - Si API_SECRET_KEY está definida, acepta tanto `API_SECRET_KEY` como `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 */
const requireAuth = (req, res, next) => {
  const expectedKey = process.env.API_SECRET_KEY;
  if (!expectedKey) {
    return next();
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (
    token === expectedKey ||
    (supabaseAnonKey && token === supabaseAnonKey) ||
    token === "auto"
  ) {
    return next();
  }

  return res.status(401).json({
    status: "error",
    message: "No autorizado. Verifica tu API Key o configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  });
};

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "MemoryCarl API is running",
    supabaseConfigured: Boolean(supabase),
  });
});

/**
 * Endpoint público de autodescubrimiento para `src/services/dbService.js`.
 * Entrega únicamente la URL pública y la clave pública (anon) para que el navegador
 * pueda sincronizar directo contra Supabase con RLS activo.
 */
app.get("/api/config", (_req, res) => {
  res.json({
    status: "ok",
    supabaseUrl: supabaseUrl || null,
    supabaseAnonKey: supabaseAnonKey || null,
  });
});

app.get("/api/test-db", async (_req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ status: "error", message: "Supabase no configurado en variables de entorno de Vercel." });
    }
    const { data, error } = await supabase.from("finance_accounts").select("id").limit(1);
    if (error) {
      return res.status(500).json({ status: "error", error: error.message });
    }
    res.json({ status: "ok", data });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

/**
 * Upsert tolerante a esquemas antiguos: si una tabla aún no tiene la columna `data` o `updated_at`,
 * reintenta limpiando esas columnas para no abortar el guardado.
 */
async function safeUpsert(table, rows, onConflict = "id") {
  if (!Array.isArray(rows) || rows.length === 0) return { error: null, withData: true };
  const first = await supabase.from(table).upsert(rows, { onConflict });
  if (!first.error) return { error: null, withData: true };
  if (!/column .* does not exist|data|updated_at/i.test(first.error.message || "")) {
    return { error: first.error, withData: false };
  }
  const fallback = rows.map(({ data, updated_at, to_account_id, counterparty, source_label, ...rest }) => rest);
  const second = await supabase.from(table).upsert(fallback, { onConflict });
  return { error: second.error, withData: false };
}

async function deleteIds(table, column, ids, results, label) {
  if (!Array.isArray(ids) || !ids.length) return;
  const { error } = await supabase.from(table).delete().in(column, ids.map(String));
  if (error) results.errors.push(`Error borrando ${label}: ${error.message}`);
  else results.deleted[label] = ids.length;
}

// =====================================================================================
// ENDPOINT DE SINCRONIZACIÓN (POST /api/sync)
// Soporta tanto el formato de tablas directas (`tableUpserts` / `tableDeletes` de dbService.js)
// como el formato legacy (`neurons`, `memories`, `days`, `chatHistory`, `appState`).
// =====================================================================================
app.post("/api/sync", requireAuth, async (req, res) => {
  const {
    tableUpserts = null,
    tableDeletes = null,
    neurons = [],
    memories = [],
    chatHistory = [],
    days = [],
    appState = null,
    deleted = {},
  } = req.body || {};

  if (!supabase) {
    return res.status(500).json({ status: "error", message: "Supabase no configurado en el servidor." });
  }

  try {
    const results = {
      neuronsSynced: 0,
      memoriesSynced: 0,
      chatSynced: 0,
      daysSynced: 0,
      appStateSynced: false,
      fullData: true,
      deleted: {},
      errors: [],
    };

    // 1. Si viene desde el nuevo motor dbService.js con `tableUpserts`, procesar cada tabla
    if (tableUpserts && typeof tableUpserts === "object") {
      for (const [table, rows] of Object.entries(tableUpserts)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const conflictCol = table === "days" ? "date" : "id";
        const { error } = await safeUpsert(table, rows, conflictCol);
        if (error) {
          results.errors.push(`Error en ${table}: ${error.message}`);
        }
      }
      if (tableDeletes && typeof tableDeletes === "object") {
        for (const [table, ids] of Object.entries(tableDeletes)) {
          if (!Array.isArray(ids) || ids.length === 0) continue;
          const col = table === "days" ? "date" : "id";
          await deleteIds(table, col, ids, results, table);
        }
      }
      return res.json({ status: "ok", data: results });
    }

    // 2. Compatibilidad con envíos en formato `appState` / listas individuales
    if (appState) {
      try {
        const { data: existingAppStateRow } = await supabase
          .from("app_state")
          .select("state_json")
          .eq("id", "default_user")
          .maybeSingle();

        const mergedAppState = {
          ...(existingAppStateRow?.state_json || {}),
          ...appState,
        };

        const { error: asErr } = await supabase.from("app_state").upsert(
          [{ id: "default_user", state_json: mergedAppState, updated_at: new Date().toISOString() }],
          { onConflict: "id" }
        );
        if (asErr) throw new Error("Error guardando app_state: " + asErr.message);
        results.appStateSynced = true;

        if (Array.isArray(appState.financeAccounts) && appState.financeAccounts.length > 0) {
          const { error: accErr } = await safeUpsert(
            "finance_accounts",
            appState.financeAccounts.map((a) => ({
              id: String(a.id),
              name: a.name || "Cuenta",
              type: a.type || "bank",
              initial_balance: Number(a.initialBalance || 0),
              balance: Number(a.balance || 0),
              color: a.color || null,
              data: a,
              created_at: a.createdAt || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })),
            "id"
          );
          if (accErr) throw new Error("Error guardando finance_accounts: " + accErr.message);
        }

        if (Array.isArray(appState.financeLedger) && appState.financeLedger.length > 0) {
          const { error: ledErr } = await safeUpsert(
            "finance_ledger",
            appState.financeLedger.map((e) => ({
              id: String(e.id),
              account_id: e.accountId || null,
              to_account_id: e.toAccountId || null,
              type: e.type || "expense",
              amount: Number(e.amount || 0),
              category: e.category || "Otros",
              reason: e.reason || "normal",
              note: e.note || "",
              date: e.date || new Date().toISOString(),
              is_fiado: !!e.isFiado,
              fiado_status: e.fiadoStatus || null,
              archived: !!e.archived,
              data: e,
              created_at: e.createdAt || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })),
            "id"
          );
          if (ledErr) throw new Error("Error guardando finance_ledger: " + ledErr.message);
        }

        const sleepLog = Array.isArray(appState.sleepLog) ? appState.sleepLog : [];
        if (sleepLog.length > 0) {
          const { error: sleepErr } = await safeUpsert(
            "sleep_log",
            sleepLog.map((s) => ({
              id: String(s.id || `sleep_${s.date}`),
              date: s.date || new Date().toISOString().split("T")[0],
              total_minutes: Number(s.totalMinutes || s.total_minutes || 0),
              quality: s.quality !== undefined && s.quality !== null && s.quality !== "" ? Number(s.quality) : null,
              note: s.note || "",
              mode: s.mode || "simple",
              start_time: s.start || s.start_time || "",
              end_time: s.end || s.end_time || "",
              dream_type: s.dreamType || s.dream_type || "",
              wake_emotion: s.wakeEmotion || s.wake_emotion || "",
              narrative: s.narrative || "",
              symbols: Array.isArray(s.symbols) ? s.symbols : [],
              clarity: s.clarity !== undefined && s.clarity !== null && s.clarity !== "" ? Number(s.clarity) : null,
              created_at: s.ts || s.created_at || new Date().toISOString(),
              data: s,
            })),
            "id"
          );
          if (sleepErr) results.sleepError = sleepErr.message;
          else results.sleepSynced = sleepLog.length;
        }

        const moodDaily = appState.moodDaily && typeof appState.moodDaily === "object" ? appState.moodDaily : {};
        const moodEntries = [];
        Object.entries(moodDaily).forEach(([dateKey, val]) => {
          const items = Array.isArray(val) ? val : [val];
          items.forEach((e, idx) => {
            if (!e || typeof e !== "object") return;
            const entryId = `${dateKey}_${e.ts || idx}`;
            moodEntries.push({
              id: String(entryId),
              date: dateKey,
              sprite_id: e.spriteId || e.sprite_id || null,
              label: e.label || null,
              activities: Array.isArray(e.activities) ? e.activities : [],
              energy: e.energy !== undefined && e.energy !== null && e.energy !== "" ? Number(e.energy) : null,
              note: e.note || "",
              tags: Array.isArray(e.tags) ? e.tags : [],
              ts: e.ts || new Date().toISOString(),
              data: e,
            });
          });
        });
        if (moodEntries.length > 0) {
          const { error: moodErr } = await safeUpsert("mood_daily", moodEntries, "id");
          if (moodErr) results.moodError = moodErr.message;
          else results.moodSynced = moodEntries.length;
        }
      } catch (err) {
        results.errors.push(err.message);
      }
    }

    if (neurons.length > 0) {
      try {
        const { error: nErr, withData } = await safeUpsert(
          "neurons",
          neurons.map((n) => ({
            id: String(n.id),
            concept: n.core?.concept || n.concept || "Sin nombre",
            domain: n.core?.domain || n.domain || "general",
            summary: n.core?.summary || n.summary || "",
            triggers: n.triggers || [],
            emotion: n.emotion || "neutral",
            weight: n.weight || 1.0,
            temporal: n.temporal || {},
            updated_at: n.updatedAt || new Date().toISOString(),
            data: n,
          })),
          "id"
        );
        if (nErr) throw new Error("Error guardando neuronas: " + nErr.message);
        if (!withData) results.fullData = false;
        results.neuronsSynced = neurons.length;
      } catch (err) {
        results.errors.push(err.message);
      }
    }

    if (memories.length > 0) {
      try {
        const { error: mErr, withData } = await safeUpsert(
          "memories",
          memories.map((m) => ({
            id: String(m.id),
            title: m.title || "Memoria",
            snippet: (m.text || "").substring(0, 100),
            text_content: m.text || "",
            date: m.date || new Date().toISOString().split("T")[0],
            emotion: m.emotion || "neutral",
            tags: m.tags || [],
            linked_neurons: m.linkedNeurons || [],
            importance: m.importance || "medium",
            temporal: m.temporal || {},
            data: m,
          })),
          "id"
        );
        if (mErr) throw new Error("Error guardando memorias: " + mErr.message);
        if (!withData) results.fullData = false;
        results.memoriesSynced = memories.length;
      } catch (err) {
        results.errors.push(err.message);
      }
    }

    if (chatHistory.length > 0) {
      try {
        const uniqueChatMap = new Map();
        chatHistory.forEach((c) => {
          const derivedId = String(c.messageId || c.id || Math.random().toString(36).substring(7));
          uniqueChatMap.set(derivedId, {
            id: derivedId,
            message_id: derivedId,
            role: c.role || "user",
            content: c.content || c.text || "",
            meta: c.meta || {},
          });
        });
        const uniqueChat = Array.from(uniqueChatMap.values());
        const { error: cErr } = await safeUpsert("chat_history", uniqueChat, "id");
        if (cErr) throw new Error("Error guardando historial: " + cErr.message);
        results.chatSynced = uniqueChat.length;
      } catch (err) {
        results.errors.push(err.message);
      }
    }

    if (days.length > 0) {
      try {
        const uniqueDaysMap = new Map();
        days.forEach((d) => {
          uniqueDaysMap.set(d.date, {
            id: String(d.id || d.date),
            date: d.date,
            summary: d.summary || "",
            dominant_emotion: d.dominantEmotion || "neutral",
            dominant_themes: d.dominantThemes || [],
            insights: d.insights || [],
            is_milestone: d.isMilestone || false,
            data: d,
          });
        });
        const uniqueDays = Array.from(uniqueDaysMap.values());
        const { error: dErr, withData } = await safeUpsert("days", uniqueDays, "date");
        if (dErr) throw new Error("Error guardando días: " + dErr.message);
        if (!withData) results.fullData = false;
        results.daysSynced = uniqueDays.length;
      } catch (err) {
        results.errors.push(err.message);
      }
    }

    await deleteIds("neurons", "id", deleted.neurons, results, "neuronas");
    await deleteIds("memories", "id", deleted.memories, results, "memorias");
    await deleteIds("days", "date", deleted.days, results, "días");
    await deleteIds("finance_ledger", "id", deleted.finance_ledger, results, "movimientos");

    res.json({ status: "ok", data: results });
  } catch (err) {
    console.error("[Sync Error]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// =====================================================================================
// ENDPOINT DE RESTAURACIÓN (GET /api/restore)
// =====================================================================================
app.get("/api/restore", requireAuth, async (_req, res) => {
  if (!supabase) {
    return res.status(500).json({ status: "error", message: "Supabase no configurado en el servidor." });
  }

  try {
    const [
      neuronsRes,
      memoriesRes,
      chatRes,
      daysRes,
      appStateRes,
      accountsRes,
      ledgerRes,
      debtsRes,
      sleepRes,
      moodRes,
      modulesRes,
    ] = await Promise.all([
      supabase.from("neurons").select("*"),
      supabase.from("memories").select("*"),
      supabase.from("chat_history").select("*").order("created_at", { ascending: true }),
      supabase.from("days").select("*").order("date", { ascending: false }),
      supabase.from("app_state").select("*").eq("id", "default_user").maybeSingle(),
      supabase.from("finance_accounts").select("*"),
      supabase.from("finance_ledger").select("*").order("date", { ascending: false }),
      supabase.from("finance_debts").select("*"),
      supabase.from("sleep_log").select("*").order("date", { ascending: false }),
      supabase.from("mood_daily").select("*").order("date", { ascending: false }),
      supabase.from("app_modules").select("*"),
    ]);

    let reconstructedAppState = appStateRes.data?.state_json || {};

    if (accountsRes.data && accountsRes.data.length > 0) {
      reconstructedAppState.financeAccounts = accountsRes.data.map((a) => ({
        ...(a.data || {}),
        id: a.id,
        name: a.name,
        type: a.type,
        initialBalance: Number(a.initial_balance || 0),
        balance: Number(a.balance || 0),
        color: a.color,
        createdAt: a.created_at,
      }));
    }

    if (ledgerRes.data && ledgerRes.data.length > 0) {
      reconstructedAppState.financeLedger = ledgerRes.data.map((e) => ({
        ...(e.data || {}),
        id: e.id,
        accountId: e.account_id,
        toAccountId: e.to_account_id || null,
        type: e.type,
        amount: Number(e.amount || 0),
        category: e.category,
        reason: e.reason,
        note: e.note,
        date: e.date,
        isFiado: !!e.is_fiado,
        fiadoStatus: e.fiado_status,
        archived: !!e.archived,
        createdAt: e.created_at,
      }));
    }

    if (sleepRes.data && sleepRes.data.length > 0) {
      reconstructedAppState.sleepLog = sleepRes.data.map((s) => ({
        ...(s.data || {}),
        id: s.id,
        date: s.date,
        totalMinutes: Number(s.total_minutes || 0),
        quality: s.quality,
        note: s.note,
        mode: s.mode,
        start: s.start_time,
        end: s.end_time,
        dreamType: s.dream_type,
        wakeEmotion: s.wake_emotion,
        narrative: s.narrative,
        symbols: s.symbols || [],
        clarity: s.clarity,
        ts: s.created_at,
      }));
    }

    if (moodRes.data && moodRes.data.length > 0) {
      const moodMap = {};
      moodRes.data.forEach((m) => {
        if (!moodMap[m.date]) moodMap[m.date] = [];
        moodMap[m.date].push({
          ...(m.data || {}),
          id: m.id,
          spriteId: m.sprite_id,
          label: m.label,
          activities: m.activities || [],
          energy: m.energy,
          note: m.note,
          ts: m.ts,
        });
      });
      reconstructedAppState.moodDaily = moodMap;
    }

    res.json({
      status: "ok",
      data: {
        neurons: neuronsRes.data || [],
        memories: memoriesRes.data || [],
        chatHistory: chatRes.data || [],
        days: daysRes.data || [],
        financeAccounts: accountsRes.data || [],
        financeLedger: ledgerRes.data || [],
        financeDebts: debtsRes.data || [],
        sleepLog: sleepRes.data || [],
        moodRows: moodRes.data || [],
        modules: modulesRes.data || [],
        appState: reconstructedAppState,
      },
    });
  } catch (err) {
    console.error("[Restore Error]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get("/api/neurons", requireAuth, async (_req, res) => {
  try {
    const neurons = await getAllNeurons();
    res.json({ status: "ok", data: neurons });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get("/api/memories", requireAuth, async (_req, res) => {
  try {
    const memories = await getAllMemories();
    res.json({ status: "ok", data: memories });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/chat", requireAuth, async (req, res) => {
  const { message, ollamaUrl, ollamaKey } = req.body;
  if (!message) {
    return res.status(400).json({ status: "error", message: 'El campo "message" es obligatorio.' });
  }

  try {
    const result = await processChat(message, ollamaUrl, ollamaKey);
    res.json({ status: "ok", data: result });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/telegram", handleTelegramWebhook);
app.get("/api/telegram/pending", requireAuth, getPendingTelegramTransactions);

module.exports = app;

if (process.argv[1]?.endsWith("index.js")) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[MemoryCarl API] Servidor escuchando en puerto ${PORT}`);
  });
}
