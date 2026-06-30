import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

import { getAllNeurons } from "./src/neuro/neuronStore.js";
import { getAllMemories } from "./src/memory/memoryStore.js";
import { processChat } from "./src/chat/neurochat.js";

const app = express();
app.use(cors());
app.use(express.json());

// Inicializar Supabase Cliente (con service_role para tener acceso completo)
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    const { data, error } = await supabase.from('neurons').select('id').limit(1);
    if (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
    res.json({ status: 'ok', data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
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
export default app;

// Iniciar servidor local si se corre directamente
if (process.argv[1]?.endsWith('index.js')) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[MemoryCarl API] Servidor escuchando en puerto ${PORT}`);
  });
}
