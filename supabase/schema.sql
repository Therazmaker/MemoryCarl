-- =====================================================================================
-- MEMORYCARL — ESQUEMA COMPLETO DE SUPABASE (DOBLE CAPA: LOCAL-FIRST + NUBE)
-- =====================================================================================
-- Instrucciones:
-- 1. Entra a tu panel de Supabase -> menú izquierdo "SQL Editor" -> "New query".
-- 2. Copia y pega TODO este archivo y pulsa el botón "Run".
-- 3. Este script es 100% idempotente (usa IF NOT EXISTS y ALTER TABLE ADD COLUMN IF NOT EXISTS),
--    por lo que NO borra ningún dato que ya tengas cargado; solo crea o actualiza las
--    tablas, columnas, índices únicos y políticas RLS necesarias para sincronización instantánea.
-- =====================================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================================
-- 1. CUENTAS FINANCIERAS (finance_accounts)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.finance_accounts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL DEFAULT 'Cuenta',
  type TEXT DEFAULT 'bank',
  initial_balance NUMERIC(14,2) DEFAULT 0,
  balance NUMERIC(14,2) DEFAULT 0,
  color TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.finance_accounts ADD COLUMN IF NOT EXISTS initial_balance NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.finance_accounts ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.finance_accounts ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.finance_accounts ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.finance_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.finance_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- =====================================================================================
-- 2. MOVIMIENTOS FINANCIEROS / LIBRO MAYOR (finance_ledger)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.finance_ledger (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT,
  to_account_id TEXT,
  type TEXT NOT NULL DEFAULT 'expense',
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  category TEXT DEFAULT 'Otros',
  reason TEXT DEFAULT 'normal',
  note TEXT DEFAULT '',
  date TEXT NOT NULL,
  is_fiado BOOLEAN DEFAULT FALSE,
  fiado_status TEXT,
  archived BOOLEAN DEFAULT FALSE,
  counterparty TEXT,
  source_label TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Si existía una clave foránea estricta hacia finance_accounts que bloqueaba sincronización fuera de orden, la relajamos:
ALTER TABLE public.finance_ledger DROP CONSTRAINT IF EXISTS finance_ledger_account_id_fkey;
ALTER TABLE public.finance_ledger ADD COLUMN IF NOT EXISTS to_account_id TEXT;
ALTER TABLE public.finance_ledger ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT 'normal';
ALTER TABLE public.finance_ledger ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
ALTER TABLE public.finance_ledger ADD COLUMN IF NOT EXISTS is_fiado BOOLEAN DEFAULT FALSE;
ALTER TABLE public.finance_ledger ADD COLUMN IF NOT EXISTS fiado_status TEXT;
ALTER TABLE public.finance_ledger ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;
ALTER TABLE public.finance_ledger ADD COLUMN IF NOT EXISTS counterparty TEXT;
ALTER TABLE public.finance_ledger ADD COLUMN IF NOT EXISTS source_label TEXT;
ALTER TABLE public.finance_ledger ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.finance_ledger ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.finance_ledger ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_finance_ledger_date ON public.finance_ledger(date DESC);

-- =====================================================================================
-- 3. DEUDAS, COMPROMISOS Y OBLIGACIONES (finance_debts)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.finance_debts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind TEXT DEFAULT 'debt', -- 'debt' | 'commitment' | 'obligation' | 'template' | 'instance'
  name TEXT NOT NULL DEFAULT 'Compromiso',
  amount NUMERIC(14,2) DEFAULT 0,
  balance NUMERIC(14,2) DEFAULT 0,
  status TEXT DEFAULT 'active',
  due_date TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.finance_debts ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'debt';
ALTER TABLE public.finance_debts ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.finance_debts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.finance_debts ADD COLUMN IF NOT EXISTS due_date TEXT;
ALTER TABLE public.finance_debts ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.finance_debts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- =====================================================================================
-- 4. REGISTRO DE SUEÑO Y DIARIO ONÍRICO (sleep_log)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.sleep_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  date TEXT NOT NULL,
  total_minutes INTEGER DEFAULT 0,
  quality NUMERIC(5,2),
  note TEXT DEFAULT '',
  mode TEXT DEFAULT 'simple',
  start_time TEXT DEFAULT '',
  end_time TEXT DEFAULT '',
  dream_type TEXT DEFAULT '',
  wake_emotion TEXT DEFAULT '',
  narrative TEXT DEFAULT '',
  symbols JSONB DEFAULT '[]'::jsonb,
  clarity NUMERIC(5,2),
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS total_minutes INTEGER DEFAULT 0;
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS quality NUMERIC(5,2);
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'simple';
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS start_time TEXT DEFAULT '';
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS end_time TEXT DEFAULT '';
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS dream_type TEXT DEFAULT '';
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS wake_emotion TEXT DEFAULT '';
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS narrative TEXT DEFAULT '';
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS symbols JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS clarity NUMERIC(5,2);
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.sleep_log ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_sleep_log_date ON public.sleep_log(date DESC);

-- =====================================================================================
-- 5. ESTADO DE ÁNIMO Y ENERGÍA DIARIA (mood_daily)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.mood_daily (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  date TEXT NOT NULL,
  sprite_id TEXT,
  label TEXT,
  activities JSONB DEFAULT '[]'::jsonb,
  energy NUMERIC(5,2),
  note TEXT DEFAULT '',
  tags JSONB DEFAULT '[]'::jsonb,
  ts TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.mood_daily ADD COLUMN IF NOT EXISTS sprite_id TEXT;
ALTER TABLE public.mood_daily ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE public.mood_daily ADD COLUMN IF NOT EXISTS activities JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.mood_daily ADD COLUMN IF NOT EXISTS energy NUMERIC(5,2);
ALTER TABLE public.mood_daily ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
ALTER TABLE public.mood_daily ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.mood_daily ADD COLUMN IF NOT EXISTS ts TEXT;
ALTER TABLE public.mood_daily ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.mood_daily ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.mood_daily ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_mood_daily_date ON public.mood_daily(date DESC);

-- =====================================================================================
-- 6. NEURONAS DE NEUROCHAT (neurons)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.neurons (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type TEXT DEFAULT 'memory',
  concept TEXT NOT NULL DEFAULT 'Sin nombre',
  domain TEXT DEFAULT 'general',
  summary TEXT DEFAULT '',
  triggers JSONB DEFAULT '[]'::jsonb,
  connections JSONB DEFAULT '[]'::jsonb,
  emotion TEXT DEFAULT 'neutral',
  weight NUMERIC(6,4) DEFAULT 1.0,
  temporal JSONB DEFAULT '{}'::jsonb,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.neurons ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'memory';
ALTER TABLE public.neurons ADD COLUMN IF NOT EXISTS concept TEXT DEFAULT 'Sin nombre';
ALTER TABLE public.neurons ADD COLUMN IF NOT EXISTS domain TEXT DEFAULT 'general';
ALTER TABLE public.neurons ADD COLUMN IF NOT EXISTS summary TEXT DEFAULT '';
ALTER TABLE public.neurons ADD COLUMN IF NOT EXISTS triggers JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.neurons ADD COLUMN IF NOT EXISTS connections JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.neurons ADD COLUMN IF NOT EXISTS emotion TEXT DEFAULT 'neutral';
ALTER TABLE public.neurons ADD COLUMN IF NOT EXISTS weight NUMERIC(6,4) DEFAULT 1.0;
ALTER TABLE public.neurons ADD COLUMN IF NOT EXISTS temporal JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.neurons ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.neurons ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.neurons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- =====================================================================================
-- 7. MEMORIAS DE NEUROCHAT (memories)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.memories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title TEXT DEFAULT 'Memoria',
  snippet TEXT DEFAULT '',
  text_content TEXT DEFAULT '',
  date TEXT,
  emotion TEXT DEFAULT 'neutral',
  tags JSONB DEFAULT '[]'::jsonb,
  linked_neurons JSONB DEFAULT '[]'::jsonb,
  importance TEXT DEFAULT 'medium',
  temporal JSONB DEFAULT '{}'::jsonb,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS title TEXT DEFAULT 'Memoria';
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS snippet TEXT DEFAULT '';
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS text_content TEXT DEFAULT '';
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS date TEXT;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS emotion TEXT DEFAULT 'neutral';
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS linked_neurons JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS importance TEXT DEFAULT 'medium';
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS temporal JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- =====================================================================================
-- 8. DÍAS E HISTORIAL DIARIO DE NEUROCHAT (days)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.days (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  date TEXT UNIQUE NOT NULL,
  summary TEXT DEFAULT '',
  dominant_emotion TEXT DEFAULT 'neutral',
  dominant_themes JSONB DEFAULT '[]'::jsonb,
  insights JSONB DEFAULT '[]'::jsonb,
  is_milestone BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'open',
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.days ADD COLUMN IF NOT EXISTS summary TEXT DEFAULT '';
ALTER TABLE public.days ADD COLUMN IF NOT EXISTS dominant_emotion TEXT DEFAULT 'neutral';
ALTER TABLE public.days ADD COLUMN IF NOT EXISTS dominant_themes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.days ADD COLUMN IF NOT EXISTS insights JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.days ADD COLUMN IF NOT EXISTS is_milestone BOOLEAN DEFAULT FALSE;
ALTER TABLE public.days ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open';
ALTER TABLE public.days ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.days ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.days ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS idx_days_date ON public.days(date);

-- =====================================================================================
-- 9. HISTORIAL DE MENSAJES DE CHAT (chat_history)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.chat_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_id TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  content TEXT NOT NULL DEFAULT '',
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.chat_history ADD COLUMN IF NOT EXISTS message_id TEXT;
ALTER TABLE public.chat_history ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE public.chat_history ADD COLUMN IF NOT EXISTS content TEXT DEFAULT '';
ALTER TABLE public.chat_history ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.chat_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.chat_history ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_history_message_id ON public.chat_history(message_id);

-- =====================================================================================
-- 10. ESTADO DE LA APP Y MÓDULOS (app_state & app_modules)
-- Guarda de forma atómica cada módulo (semana, casa, rutinas, compras, despensa,
-- recordatorios, hechos, hilos, closet, configuración financiera, etc.)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.app_state (
  id TEXT PRIMARY KEY DEFAULT 'default_user',
  state_json JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.app_state ADD COLUMN IF NOT EXISTS state_json JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.app_state ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.app_modules (
  id TEXT PRIMARY KEY, -- ej: 'routines', 'semana', 'house', 'shopping', 'inventory', 'reminders', 'life_facts', 'open_threads', 'finance_meta', 'closet'
  module_name TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.app_modules ADD COLUMN IF NOT EXISTS module_name TEXT;
ALTER TABLE public.app_modules ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.app_modules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- =====================================================================================
-- 11. BANDEJA DE ENTRADA DE TELEGRAM (telegram_inbox)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.telegram_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'expense',
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  category TEXT DEFAULT 'Otros',
  note TEXT DEFAULT '',
  account_id TEXT DEFAULT 'default',
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.telegram_inbox ADD COLUMN IF NOT EXISTS processed BOOLEAN DEFAULT FALSE;

-- =====================================================================================
-- 12. PERMISOS RLS (ROW LEVEL SECURITY) — ACCESO TOTAL PARA SINCRONIZACIÓN FLUIDA
-- =====================================================================================
ALTER TABLE public.finance_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sleep_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.neurons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_inbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acceso total finance_accounts" ON public.finance_accounts;
CREATE POLICY "Acceso total finance_accounts" ON public.finance_accounts FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total finance_ledger" ON public.finance_ledger;
CREATE POLICY "Acceso total finance_ledger" ON public.finance_ledger FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total finance_debts" ON public.finance_debts;
CREATE POLICY "Acceso total finance_debts" ON public.finance_debts FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total sleep_log" ON public.sleep_log;
CREATE POLICY "Acceso total sleep_log" ON public.sleep_log FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total mood_daily" ON public.mood_daily;
CREATE POLICY "Acceso total mood_daily" ON public.mood_daily FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total neurons" ON public.neurons;
CREATE POLICY "Acceso total neurons" ON public.neurons FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total memories" ON public.memories;
CREATE POLICY "Acceso total memories" ON public.memories FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total days" ON public.days;
CREATE POLICY "Acceso total days" ON public.days FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total chat_history" ON public.chat_history;
CREATE POLICY "Acceso total chat_history" ON public.chat_history FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total app_state" ON public.app_state;
CREATE POLICY "Acceso total app_state" ON public.app_state FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total app_modules" ON public.app_modules;
CREATE POLICY "Acceso total app_modules" ON public.app_modules FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total telegram_inbox" ON public.telegram_inbox;
CREATE POLICY "Acceso total telegram_inbox" ON public.telegram_inbox FOR ALL USING (true) WITH CHECK (true);
