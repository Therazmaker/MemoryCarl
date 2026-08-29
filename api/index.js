const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const { getAllNeurons } = require("./src/neuro/neuronStore.js");
const { getAllMemories } = require("./src/memory/memoryStore.js");
const { processChat } = require("./src/chat/neurochat.js");
const { handleTelegramWebhook, getPendingTelegramTransactions } = require("./src/finance/telegramHandler.js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Middleware de Autenticación
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedKey = process.env.API_SECRET_KEY;
  
  // Si no hay key configurada en el servidor, bloqueamos por seguridad (fail-safe)
  if (!expectedKey) {
    return res.status(500).json({ status: 'error', message: 'API_SECRET_KEY no configurada en el servidor.' });
  }

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return res.status(401).json({ status: 'error', message: 'No autorizado. API Key inválida.' });
  }

  next();
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MemoryCarl API is running' });
});

// Endpoint temporal de prueba de Base de Datos
app.get('/api/test-db', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Supabase no configurado' });
    const { data, error } = await supabase.from('neurons').select('id').limit(1);
    if (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
    res.json({ status: 'ok', data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Endpoint de Sincronización (Backup a Supabase)
app.post('/api/sync', requireAuth, async (req, res) => {
  const { neurons = [], memories = [], chatHistory = [], days = [], appState = null } = req.body;
  if (!supabase) return res.status(500).json({ status: 'error', message: 'Supabase no configurado' });

  try {
    const results = { neuronsSynced: 0, memoriesSynced: 0, chatSynced: 0, daysSynced: 0, appStateSynced: false };
    
    if (neurons.length > 0) {
      const { error: nErr } = await supabase.from('neurons').upsert(
        neurons.map(n => ({
          id: n.id,
          concept: n.core?.concept || 'Sin nombre',
          domain: n.core?.domain || 'general',
          summary: n.core?.summary || '',
          triggers: n.triggers || [],
          emotion: n.emotion || 'neutral',
          weight: n.weight || 1.0,
          temporal: n.temporal || {},
          updated_at: new Date().toISOString()
        })), { onConflict: 'id' }
      );
      if (nErr) throw new Error('Error guardando neuronas: ' + nErr.message);
      results.neuronsSynced = neurons.length;
    }

    if (memories.length > 0) {
      const { error: mErr } = await supabase.from('memories').upsert(
        memories.map(m => ({
          id: m.id,
          title: m.title || 'Memoria',
          snippet: (m.text || '').substring(0, 100),
          text_content: m.text || '',
          date: m.date || new Date().toISOString().split('T')[0],
          emotion: m.emotion || 'neutral',
          tags: m.tags || [],
          linked_neurons: m.linkedNeurons || [],
          importance: m.importance || 'medium',
          temporal: m.temporal || {}
        })), { onConflict: 'id' }
      );
      if (mErr) throw new Error('Error guardando memorias: ' + mErr.message);
      results.memoriesSynced = memories.length;
    }

    if (chatHistory.length > 0) {
      // Usar un mapa para asegurar que no haya duplicados con el mismo ID en el payload
      const uniqueChatMap = new Map();
      chatHistory.forEach(c => {
        const derivedId = c.messageId || c.id || Math.random().toString(36).substring(7);
        uniqueChatMap.set(derivedId, {
          id: derivedId,
          message_id: derivedId,
          role: c.role || 'user',
          content: c.content || c.text || '',
          meta: c.meta || {}
        });
      });
      const uniqueChat = Array.from(uniqueChatMap.values());

      const { error: cErr } = await supabase.from('chat_history').upsert(
        uniqueChat, { onConflict: 'id' }
      );
      if (cErr) throw new Error('Error guardando historial: ' + cErr.message);
      results.chatSynced = uniqueChat.length;
    }

    if (days.length > 0) {
      // Usar un mapa para asegurar que no haya duplicados con la misma fecha en el payload
      const uniqueDaysMap = new Map();
      days.forEach(d => {
        uniqueDaysMap.set(d.date, {
          id: d.id || d.date,
          date: d.date,
          summary: d.summary || '',
          dominant_emotion: d.dominantEmotion || 'neutral',
          dominant_themes: d.dominantThemes || [],
          insights: d.insights || [],
          is_milestone: d.isMilestone || false
        });
      });
      const uniqueDays = Array.from(uniqueDaysMap.values());

      const { error: dErr } = await supabase.from('days').upsert(
        uniqueDays, { onConflict: 'date' }
      );
      if (dErr) throw new Error('Error guardando días: ' + dErr.message);
      results.daysSynced = uniqueDays.length;
    }

    if (appState) {
      // 1. Guardar en app_state de seguridad
      console.log("Sync Payload - Ledger Sample:", appState.financeLedger ? JSON.stringify(appState.financeLedger.slice(0, 3)) : "none");
      const { error: asErr } = await supabase.from('app_state').upsert(
        [{ id: 'default_user', state_json: appState, updated_at: new Date().toISOString() }],
        { onConflict: 'id' }
      );
      if (asErr) throw new Error('Error guardando app_state: ' + asErr.message);
      results.appStateSynced = true;

      // 2. Guardar cuentas individuales en finance_accounts
      if (Array.isArray(appState.financeAccounts) && appState.financeAccounts.length > 0) {
        const { error: accErr } = await supabase.from('finance_accounts').upsert(
          appState.financeAccounts.map(a => ({
            id: a.id,
            name: a.name || 'Cuenta',
            type: a.type || 'bank',
            initial_balance: Number(a.initialBalance || 0),
            balance: Number(a.balance || 0),
            color: a.color || null,
            created_at: a.createdAt || new Date().toISOString()
          })), { onConflict: 'id' }
        );
        if (accErr) throw new Error('Error guardando finance_accounts: ' + accErr.message);
      }

      // 3. Guardar movimientos individuales en finance_ledger
      if (Array.isArray(appState.financeLedger) && appState.financeLedger.length > 0) {
        const { error: ledErr } = await supabase.from('finance_ledger').upsert(
          appState.financeLedger.map(e => ({
            id: e.id,
            account_id: e.accountId,
            type: e.type || 'expense',
            amount: Number(e.amount || 0),
            category: e.category || 'Otros',
            reason: e.reason || 'normal',
            note: e.note || '',
            date: e.date || new Date().toISOString(),
            is_fiado: !!e.isFiado,
            fiado_status: e.fiadoStatus || null,
            archived: !!e.archived,
            created_at: e.createdAt || new Date().toISOString()
          })), { onConflict: 'id' }
        );
        if (ledErr) throw new Error('Error guardando finance_ledger: ' + ledErr.message);
      }
    }

    res.json({ status: 'ok', data: results });
  } catch (err) {
    console.error('[Sync Error]', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Endpoint de Restauración (Supabase → MemoryCarl)
app.get('/api/restore', requireAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ status: 'error', message: 'Supabase no configurado' });

  try {
    const [neuronsRes, memoriesRes, chatRes, daysRes, appStateRes, accountsRes, ledgerRes] = await Promise.all([
      supabase.from('neurons').select('*'),
      supabase.from('memories').select('*'),
      supabase.from('chat_history').select('*').order('created_at', { ascending: true }),
      supabase.from('days').select('*').order('date', { ascending: false }),
      supabase.from('app_state').select('*').eq('id', 'default_user').single(),
      supabase.from('finance_accounts').select('*'),
      supabase.from('finance_ledger').select('*').order('date', { ascending: false })
    ]);

    if (neuronsRes.error) throw new Error('Error leyendo neuronas: ' + neuronsRes.error.message);
    if (memoriesRes.error) throw new Error('Error leyendo memorias: ' + memoriesRes.error.message);
    if (appStateRes.error && appStateRes.error.code !== 'PGRST116') {
      throw new Error('Error leyendo app_state: ' + appStateRes.error.message);
    }

    // Reconstruir el appState prioritariamente desde las tablas dedicadas si tienen datos
    let reconstructedAppState = appStateRes.data?.state_json || null;
    
    if (accountsRes.data && accountsRes.data.length > 0) {
      if (!reconstructedAppState) reconstructedAppState = {};
      
      reconstructedAppState.financeAccounts = accountsRes.data.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        initialBalance: Number(a.initial_balance),
        balance: Number(a.balance),
        color: a.color,
        createdAt: a.created_at
      }));

      if (ledgerRes.data) {
        reconstructedAppState.financeLedger = ledgerRes.data.map(e => ({
          id: e.id,
          accountId: e.account_id,
          type: e.type,
          amount: Number(e.amount),
          category: e.category,
          reason: e.reason,
          note: e.note,
          date: e.date,
          isFiado: !!e.is_fiado,
          fiadoStatus: e.fiado_status,
          archived: !!e.archived,
          createdAt: e.created_at
        }));
      }
    }

    res.json({
      status: 'ok',
      data: {
        neurons: neuronsRes.data || [],
        memories: memoriesRes.data || [],
        chatHistory: chatRes.data || [],
        days: daysRes.data || [],
        appState: reconstructedAppState,
      }
    });
  } catch (err) {
    console.error('[Restore Error]', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Endpoints de Neuronas
app.get('/api/neurons', requireAuth, async (req, res) => {
  try {
    const neurons = await getAllNeurons();
    res.json({ status: 'ok', data: neurons });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Endpoints de Memorias
app.get('/api/memories', requireAuth, async (req, res) => {
  try {
    const memories = await getAllMemories();
    res.json({ status: 'ok', data: memories });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Endpoint Principal de Chat
app.post('/api/chat', requireAuth, async (req, res) => {
  const { message, ollamaUrl, ollamaKey } = req.body;
  if (!message) {
    return res.status(400).json({ status: 'error', message: 'El campo "message" es obligatorio.' });
  }

  try {
    const result = await processChat(message, ollamaUrl, ollamaKey);
    res.json({ status: 'ok', data: result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Endpoint Telegram Webhook (Sin requireAuth ya que Telegram envía peticiones directamente)
app.post('/api/telegram', handleTelegramWebhook);

// Endpoint para obtener transacciones pendientes
app.get('/api/telegram/pending', requireAuth, getPendingTelegramTransactions);

// Exportar para Vercel Serverless Functions
module.exports = app;

// Iniciar servidor local si se corre directamente
if (process.argv[1]?.endsWith('index.js')) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[MemoryCarl API] Servidor escuchando en puerto ${PORT}`);
  });
}
