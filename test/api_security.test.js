/**
 * api_security.test.js — El servidor solo acepta la API_SECRET_KEY y monta las rutas de widgets
 * (revisión del código: express no está instalado en las pruebas)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../api/index.js", import.meta.url), "utf8");
const auth = src.slice(src.indexOf("const requireAuth"), src.indexOf("};", src.indexOf("const requireAuth")) + 2);

test("requireAuth no acepta 'auto' ni la clave pública de Supabase", () => {
  assert.ok(auth.includes("token === expectedKey"));
  assert.ok(!/["']auto["']/.test(auth), "no debe aceptar 'auto'");
  assert.ok(!/supabaseAnonKey/.test(auth), "no debe aceptar la clave pública");
  assert.ok(/if \(!expectedKey\)[\s\S]*?status\(503\)/.test(auth), "sin API_SECRET_KEY se cierra, no se abre");
});

test("las rutas con datos piden la clave y las de widgets están montadas", () => {
  for (const r of ['app.get("/api/restore"', 'app.post("/api/sync"', 'app.get("/api/neurons"', 'app.get("/api/memories"', 'app.get("/api/sleep"', 'app.get("/api/test-db"']) {
    const line = src.split("\n").find((l) => l.includes(r));
    assert.ok(line && line.includes("requireAuth"), `${r} debe usar requireAuth`);
  }
  assert.ok(/\nmountWidgetRoutes\(app, /.test(src), "las rutas de widgets deben estar montadas");
});
