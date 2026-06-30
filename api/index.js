const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const { getAllNeurons } = require("./src/neuro/neuronStore.js");
const { getAllMemories } = require("./src/memory/memoryStore.js");
const { processChat } = require("./src/chat/neurochat.js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const app = express();
app.use(cors());
app.use(express.json());

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
  const { neurons = [], memories = [], chatHistory = [], days = [] } = req.body;
  if (!supabase) return res.status(500).json({ status: 'error', message: 'Supabase no configurado' });

  try {
    const results = { neuronsSynced: 0, memoriesSynced: 0, chatSynced: 0, daysSynced: 0 };
    
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
      const { error: cErr } = await supabase.from('chat_history').upsert(
        chatHistory.map(c => ({
          id: c.messageId || c.id || Math.random().toString(36).substring(7),
          message_id: c.messageId || c.id || Math.random().toString(36).substring(7),
          role: c.role || 'user',
          content: c.content || c.text || '',
          meta: c.meta || {}
        })), { onConflict: 'id' }
      );
      if (cErr) throw new Error('Error guardando historial: ' + cErr.message);
      results.chatSynced = chatHistory.length;
    }

    if (days.length > 0) {
      const { error: dErr } = await supabase.from('days').upsert(
        days.map(d => ({
          id: d.id || d.date,
          date: d.date,
          summary: d.summary || '',
          dominant_emotion: d.dominantEmotion || 'neutral',
          dominant_themes: d.dominantThemes || [],
          insights: d.insights || [],
          is_milestone: d.isMilestone || false
        })), { onConflict: 'id' }
      );
      if (dErr) throw new Error('Error guardando días: ' + dErr.message);
      results.daysSynced = days.length;
    }

    res.json({ status: 'ok', data: results });
  } catch (err) {
    console.error('[Sync Error]', err);
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

// Exportar para Vercel Serverless Functions
module.exports = app;

// Iniciar servidor local si se corre directamente
if (process.argv[1]?.endsWith('index.js')) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[MemoryCarl API] Servidor escuchando en puerto ${PORT}`);
  });
}
