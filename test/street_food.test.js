import test from "node:test";
import assert from "node:assert/strict";

import { guessMealType, streetNote, mealTypeOf, nextPayday, runway, impact, streetPatterns, streetEntries, STREET_CATEGORY } from "../src/finance/streetFood.js";

test("adivina el tipo de comida por texto y por hora", () => {
  assert.equal(guessMealType("lonchera de los niños"), "merienda_ninos");
  assert.equal(guessMealType("café en la oficina"), "snack_trabajo");
  assert.equal(guessMealType("pollo a la brasa"), "cena");
  assert.equal(guessMealType("algo", new Date(2026, 10, 13, 8, 0)), "desayuno");
  assert.equal(guessMealType("algo", new Date(2026, 10, 13, 13, 0)), "almuerzo");
  assert.equal(guessMealType("algo", new Date(2026, 10, 13, 21, 0)), "cena");
  assert.equal(mealTypeOf({ note: streetNote("merienda_ninos", "galletas"), date: "2026-11-13T21:00:00" }), "merienda_ninos");
});

test("próximo cobro: 15 o último día", () => {
  assert.equal(nextPayday(new Date(2026, 10, 9)).day, 15);
  assert.equal(nextPayday(new Date(2026, 10, 9)).daysLeft, 6);
  assert.equal(nextPayday(new Date(2026, 10, 15)).day, 30);
  assert.equal(nextPayday(new Date(2026, 10, 30)).date.getMonth(), 11);
});

test("lo libre hasta el cobro descuenta lo que vence antes y la comida de casa", () => {
  const items = [
    { name: "Luz", dueDay: 12, status: "pending", amount: 80, pendingAmount: 80 },
    { name: "Internet", dueDay: 20, status: "pending", amount: 100, pendingAmount: 100 },
    { name: "Agua", dueDay: 5, status: "paid", amount: 40, pendingAmount: 0 },
    { name: "Préstamo", dueDay: 3, status: "pending", amount: 150, pendingAmount: 50 },
  ];
  const rw = runway({ availableCash: 400, items, now: new Date(2026, 10, 9), homeFoodPerWeek: 140 });
  assert.equal(rw.pending, 130, "luz + lo que falta del préstamo; internet vence después del cobro");
  assert.equal(rw.free, 270);
  assert.equal(rw.payday.daysLeft, 6);
  assert.equal(rw.homeFoodNeed, 120);
  assert.equal(rw.extra, 150);
  assert.equal(impact(rw, 45).status, "ok");
  assert.equal(impact(rw, 140).status, "justo");
  assert.equal(impact(rw, 160).status, "no");
  assert.equal(impact(rw, 45).perDayAfter, 37.5);
});

test("patrones: semana contra lo normal, día que se repite y 'mejor no'", () => {
  const now = new Date(2026, 10, 14, 20); // sábado
  const E = (y, m, d, h, amount, type, desc = "") => ({ type: "expense", category: STREET_CATEGORY, amount, date: new Date(y, m, d, h).toISOString(), note: streetNote(type, desc) });
  const entries = [
    // esta semana (lun 9 – sáb 14): 3 cenas
    E(2026, 10, 10, 21, 40, "cena"), E(2026, 10, 12, 21, 35, "cena"), E(2026, 10, 13, 21, 50, "cena"),
    // semanas anteriores: una cena los viernes
    E(2026, 10, 6, 21, 40, "cena"), E(2026, 9, 30, 21, 40, "cena"), E(2026, 9, 23, 21, 40, "cena"),
    E(2026, 10, 5, 16, 8, "merienda_ninos"),
    { type: "expense", category: "Mercado", amount: 99, date: new Date(2026, 10, 10).toISOString(), note: "mercado" },
  ];
  const se = streetEntries(entries);
  assert.equal(se.length, 7);
  const p = streetPatterns(se, { now, skipped: [{ ts: new Date(2026, 10, 11).getTime(), amount: 45 }] });
  assert.equal(p.week.cena.count, 3);
  assert.equal(p.week.cena.total, 125);
  assert.ok(p.insights.some((i) => /ya van 3 cenas/.test(i)));
  assert.ok(p.insights.some((i) => /viernes/.test(i)));
  assert.ok(p.insights.some((i) => /mejor no/.test(i) && /45/.test(i)));
});
