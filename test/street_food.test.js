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

test("próximo cobro: último día hábil hasta el 15 y hasta fin de mes", () => {
  // diciembre 2026: el 15 es martes, el 31 jueves
  assert.equal(nextPayday(new Date(2026, 11, 9)).day, 15);
  assert.equal(nextPayday(new Date(2026, 11, 9)).daysLeft, 6);
  assert.equal(nextPayday(new Date(2026, 11, 15)).day, 31);
  assert.equal(nextPayday(new Date(2026, 11, 31)).date.getMonth(), 0);
  // noviembre 2026: el 15 cae domingo → se cobra el viernes 13
  assert.equal(nextPayday(new Date(2026, 10, 9)).day, 13);
  assert.equal(nextPayday(new Date(2026, 10, 9)).label, "el vie 13");
  // ese viernes ya se cobró: el siguiente es el lunes 30
  assert.equal(nextPayday(new Date(2026, 10, 13)).day, 30);
  assert.equal(nextPayday(new Date(2026, 10, 14)).day, 30);
  // fin de mes en domingo (mayo 2026: 31 domingo) → viernes 29
  assert.equal(nextPayday(new Date(2026, 4, 20)).day, 29);
});

test("lo libre hasta el cobro descuenta lo que vence antes y la comida de casa", () => {
  const items = [
    { name: "Luz", dueDay: 12, status: "pending", amount: 80, pendingAmount: 80 },
    { name: "Internet", dueDay: 20, status: "pending", amount: 100, pendingAmount: 100 },
    { name: "Agua", dueDay: 5, status: "paid", amount: 40, pendingAmount: 0 },
    { name: "Préstamo", dueDay: 3, status: "pending", amount: 150, pendingAmount: 50 },
  ];
  const rw = runway({ availableCash: 400, items, now: new Date(2026, 11, 9), homeFoodPerWeek: 140 });
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

import { parseRoutineText, looksLikeRoutine, routineDaysUntil, routinesOf, daysLabel } from "../src/finance/routines.js";

test("rutinas: se leen de una frase y se apartan hasta el cobro", () => {
  const t = "Mis bebidas del trabajo: Volt 2.50 y café 3 de lunes a viernes";
  assert.ok(looksLikeRoutine(t));
  assert.ok(!looksLikeRoutine("arroz\nhuevos"));
  const r = parseRoutineText(t);
  assert.deepEqual(r.map((x) => [x.name, x.price, x.qty]), [["Volt", 2.5, 1], ["Café", 3, 1]]);
  assert.deepEqual(r[0].days, [1, 2, 3, 4, 5]);
  assert.equal(r[0].label, "Trabajo");
  assert.deepEqual(parseRoutineText("todos los días 2 volt a 2.50").map((x) => [x.name, x.qty, x.price, x.days.length]), [["Volt", 2, 2.5, 7]]);
  // lunes 9 → cobro el 15 (domingo): lun-vie = 5 días
  assert.equal(routineDaysUntil([1, 2, 3, 4, 5], new Date(2026, 10, 9), new Date(2026, 10, 15)), 5);
  assert.equal(daysLabel([1, 2, 3, 4, 5]), "lunes a viernes");
  const routines = routinesOf([{ id: "v", name: "Volt", price: 2.5, routine: { qty: 1, days: [1, 2, 3, 4, 5] } }, { id: "x", name: "Arroz", price: 20 }]);
  // miércoles 9 dic → cobro martes 15: mié, jue, vie, lun = 4 días de trabajo
  const rw = runway({ availableCash: 400, items: [], now: new Date(2026, 11, 9), homeFoodPerWeek: 140, routines });
  assert.equal(rw.routine.total, 10);
  assert.equal(rw.extra, 400 - 120 - 10);
  // un gasto que se come la rutina queda en "no"
  assert.equal(impact(rw, 275).status, "no");
});

import { parseSpendIntent } from "../src/finance/streetFood.js";

test("gasto: 'voy a comprar almuerzo… cuesta 12.10 más una Pepsi 750ml a 2.90' suma 15 y no cuenta los ml", () => {
  const r = parseSpendIntent("Voy a comprar almuerzo para mi solo en la calle. Cuesta 12.10 más una Pepsi 750ml a 2.90", new Date(2026, 0, 5, 13));
  assert.equal(r.amount, 15);
  assert.equal(r.mealType, "almuerzo");
});

test("gasto: frases que no son un gasto de comida no se toman", () => {
  assert.equal(parseSpendIntent("Hoy pagaron así que faltan 15 para el próximo pago. Quedan 1250"), null);
  assert.equal(parseSpendIntent("2 kg arroz"), null);
  assert.equal(parseSpendIntent("Mis bebidas del trabajo: Volt 2.50 y café 3 de lunes a viernes"), null);
});

test("gasto: personas y monto", () => {
  assert.equal(parseSpendIntent("vamos a cenar chifa para 4 personas, sale 80").amount, 80);
  assert.equal(parseSpendIntent("me alcanza para una pizza 45?").amount, 45);
});

test("gasto: 'para 4' es gente, y '2 pollos a 30' es cantidad × precio", () => {
  assert.equal(parseSpendIntent("vamos a cenar chifa para 4, sale 80").amount, 80);
  assert.equal(parseSpendIntent("quiero pedir 2 pollos a 30").amount, 60);
});
