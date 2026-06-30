import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

// Usamos el SERVICE_ROLE_KEY para que el backend tenga permisos completos en la BD
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
