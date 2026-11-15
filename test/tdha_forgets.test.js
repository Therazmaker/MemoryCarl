/**
 * tdha_forgets.test.js — Olvidos de la pestaña TDHA (datos inventados)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectForget, detectLocal, forgetKind, forgetStats } from "../src/tdha/tdhaEngine.js";

const DAY = 86400000;

test("olvido: se detecta qué, de qué tipo y si quedó pendiente", () => {
  assert.deepEqual(detectForget("se me olvidó la billetera en casa"), { what: "la billetera en casa", kind: "objeto", pending: false });
  assert.deepEqual(detectForget("Me olvidé de pagar la luz, tengo que hacerlo mañana"), { what: "pagar la luz", kind: "pago", pending: true });
  assert.equal(detectForget("no me acordé de llamar a mi mamá").kind, "decir");
  assert.equal(detectForget("olvidé lo que iba a decir en la reunión").kind, "decir");
  assert.equal(detectForget("hoy fue un buen día"), null);
  assert.ok(detectLocal("se me olvidó la billetera").signals.includes("olvido"));
  assert.equal(detectLocal("se me olvidó la billetera").state, null, "un olvido solo no es un estado");
  assert.equal(forgetKind("tomar la pastilla"), "medicina");
});

test("olvidos: por tipo, lo que se repite, la hora y con qué activaciones aparecen más", () => {
  const now = new Date(2026, 10, 15, 12).getTime();
  const at = (d, h) => { const x = new Date(now - d * DAY); x.setHours(h, 0, 0, 0); return x.getTime(); };
  const forgets = [
    { ts: at(1, 8), what: "la billetera en casa", kind: "objeto" },
    { ts: at(3, 9), what: "la billetera", kind: "objeto" },
    { ts: at(5, 21), what: "pagar la luz", kind: "pago", pending: true },
  ];
  const entries = [];
  for (let i = 1; i <= 8; i++) entries.push({ id: `e${i}`, ts: at(i, 12), state: "yellow", factors: [1, 3, 5].includes(i) ? ["poco_sueno"] : ["ejercicio"] });
  const s = forgetStats(forgets, entries, { now });
  assert.equal(s.total, 3);
  assert.deepEqual(s.byKind, { objeto: 2, pago: 1 });
  assert.deepEqual(s.repeated[0], { word: "billetera", n: 2 });
  assert.deepEqual(s.parts, { "mañana": 2, "tarde": 0, "noche": 1 });
  assert.equal(s.pending, 1);
  assert.equal(s.related[0].id, "poco_sueno");
  assert.equal(s.related[0].withPct, 100);
});
