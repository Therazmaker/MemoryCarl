-- =========================================================
-- ESQUEMA DE BASE DE DATOS SUPABASE PARA MEMORYCARL & NEUROCHAT
-- Ejecuta este código en el SQL Editor de tu Dashboard de Supabase
-- =========================================================

-- 1. Tabla de Neuronas
CREATE TABLE IF NOT EXISTS public.neurons (
  id TEXT PRIMARY KEY,
  concept TEXT DEFAULT 'Sin nombre',
  domain TEXT DEFAULT 'general',
  summary TEXT DEFAULT '',
  triggers JSONB DEFAULT '[]'::jsonb,
  emotion TEXT DEFAULT 'neutral',
  weight NUMERIC DEFAULT 1.0,
  temporal JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de Memorias
CREATE TABLE IF NOT EXISTS public.memories (
  id TEXT PRIMARY KEY,
  title TEXT DEFAULT 'Memoria',
  snippet TEXT DEFAULT '',
  text_content TEXT DEFAULT '',
  date TEXT,
  emotion TEXT DEFAULT 'neutral',
  tags JSONB DEFAULT '[]'::jsonb,
  linked_neurons JSONB DEFAULT '[]'::jsonb,
  importance TEXT DEFAULT 'medium',
  temporal JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabla de Historial de Chat
CREATE TABLE IF NOT EXISTS public.chat_history (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  role TEXT DEFAULT 'user',
  content TEXT DEFAULT '',
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabla de Días (Resúmenes diarios)
CREATE TABLE IF NOT EXISTS public.days (
  id TEXT PRIMARY KEY,
  date TEXT UNIQUE,
  summary TEXT DEFAULT '',
  dominant_emotion TEXT DEFAULT 'neutral',
  dominant_themes JSONB DEFAULT '[]'::jsonb,
  insights JSONB DEFAULT '[]'::jsonb,
  is_milestone BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabla de Estado General de la App (app_state)
CREATE TABLE IF NOT EXISTS public.app_state (
  id TEXT PRIMARY KEY,
  state_json JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabla de Cuentas Financieras
CREATE TABLE IF NOT EXISTS public.finance_accounts (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT 'Cuenta',
  type TEXT DEFAULT 'bank',
  initial_balance NUMERIC DEFAULT 0,
  balance NUMERIC DEFAULT 0,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Tabla de Libro de Movimientos Financieros (finance_ledger)
CREATE TABLE IF NOT EXISTS public.finance_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  type TEXT DEFAULT 'expense',
  amount NUMERIC DEFAULT 0,
  category TEXT DEFAULT 'Otros',
  reason TEXT DEFAULT 'normal',
  note TEXT DEFAULT '',
  date TEXT,
  is_fiado BOOLEAN DEFAULT FALSE,
  fiado_status TEXT,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Tabla de Registros de Sueño
CREATE TABLE IF NOT EXISTS public.sleep_log (
  id TEXT PRIMARY KEY,
  date TEXT,
  total_minutes NUMERIC DEFAULT 0,
  quality NUMERIC,
  note TEXT DEFAULT '',
  mode TEXT DEFAULT 'simple',
  start_time TEXT,
  end_time TEXT,
  dream_type TEXT,
  wake_emotion TEXT,
  narrative TEXT DEFAULT '',
  symbols JSONB DEFAULT '[]'::jsonb,
  clarity NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB DEFAULT '{}'::jsonb
);

-- 9. Tabla de Estado de Ánimo Diario (mood_daily)
CREATE TABLE IF NOT EXISTS public.mood_daily (
  id TEXT PRIMARY KEY,
  date TEXT,
  sprite_id TEXT,
  label TEXT,
  activities JSONB DEFAULT '[]'::jsonb,
  energy NUMERIC,
  note TEXT DEFAULT '',
  tags JSONB DEFAULT '[]'::jsonb,
  ts TIMESTAMPTZ DEFAULT NOW(),
  data JSONB DEFAULT '{}'::jsonb
);

-- Desactivar RLS o permitir acceso público/service role para facilitar sincronización
ALTER TABLE public.neurons DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.days DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_ledger DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sleep_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_daily DISABLE ROW LEVEL SECURITY;
