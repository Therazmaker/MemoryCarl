const { createClient } = require("@supabase/supabase-js");
require("dotenv/config");

// Soporta tanto las variables estándar de Vercel/Next (NEXT_PUBLIC_*) como las clásicas de Node
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

module.exports = { supabase, supabaseUrl, supabaseKey };
