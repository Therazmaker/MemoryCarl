import test from "node:test";
import assert from "node:assert/strict";

import { buildPools, expensePoolId, expensesWithoutPool, matchPoolByLabel, poolName } from "../src/finance/finance_pools.js";

const inc = (id, amount, extra = {}) => ({ id, type: "income", amount, date: extra.date || "2026-10-01T10:00:00Z", archived: false, ...extra });
const exp = (id, amount, extra = {}) => ({ id, type: "expense", amount, date: extra.date || "2026-10-05T10:00:00Z", archived: false, ...extra });

test("saldo del pozo: entradas (pozo + recargas) menos gastos, en cualquier fecha", () => {
  const ledger = [
    inc("q1", 1000, { isSourcePool: true, sourcePoolName: "1ra quincena octubre" }),
    inc("r1", 200, { parentPoolId: "q1", date: "2026-10-10T10:00:00Z" }),
    exp("e1", 300, { sourceMovementId: "q1", date: "2026-10-03T10:00:00Z" }),
    exp("e2", 150, { sourceMovementId: "q1", date: "2026-11-02T10:00:00Z" }), // otro mes
    exp("e3", 50, { sourceMovementId: "r1" }), // apunta a la recarga → cuenta para el pozo
    exp("libre", 999),
  ];
  const [p] = buildPools(ledger);
  assert.equal(p.name, "1ra quincena octubre");
  assert.equal(p.totalIn, 1200);
  assert.equal(p.spent, 500);
  assert.equal(p.remaining, 700);
  assert.deepEqual(p.inflows.map((m) => m.id), ["q1", "r1"]);
  assert.deepEqual(p.expenses.map((m) => m.id).sort(), ["e1", "e2", "e3"]);
});

test("datos viejos: recarga con sourceMovementId y gasto con el nombre exacto del pozo", () => {
  const ledger = [
    inc("q1", 500, { isSourcePool: true, sourcePoolName: "Bono" }),
    inc("viejaRecarga", 100, { sourceMovementId: "q1" }),
    exp("porNombre", 40, { sourceLabel: "bono" }),
    exp("parecido", 40, { sourceLabel: "bono de navidad del año pasado" }), // ya no cuenta "por parecido"
  ];
  const [p] = buildPools(ledger);
  assert.equal(p.totalIn, 600);
  assert.deepEqual(p.expenses.map((m) => m.id), ["porNombre"]);
});

test("un gasto enlazado a un ingreso que no es pozo queda sin pozo (visible en 'sin origen')", () => {
  const ledger = [inc("sueldo", 2000), exp("e1", 80, { sourceMovementId: "sueldo" })];
  assert.equal(expensePoolId(ledger, ledger[1]), null);
  assert.deepEqual(expensesWithoutPool(ledger, ledger.filter((m) => m.type === "expense")).map((m) => m.id), ["e1"]);
});

test("archivados y borrados no cuentan; un gasto de un pozo borrado vuelve a 'sin pozo'", () => {
  const ledger = [
    inc("q1", 500, { isSourcePool: true, archived: true }),
    exp("e1", 50, { sourceMovementId: "q1" }),
    exp("e2", 50, { sourceMovementId: "inexistente" }),
  ];
  assert.equal(buildPools(ledger).length, 0);
  assert.equal(expensesWithoutPool(ledger, ledger.slice(1)).length, 2);
});

test("al editar un gasto se puede excluir para ver el saldo sin contarlo dos veces", () => {
  const ledger = [inc("q1", 100, { isSourcePool: true }), exp("e1", 60, { sourceMovementId: "q1" })];
  assert.equal(buildPools(ledger)[0].remaining, 40);
  assert.equal(buildPools(ledger, { excludeId: "e1" })[0].remaining, 100);
});

test("ciclos en recargas no cuelgan el cálculo", () => {
  const ledger = [inc("a", 10, { parentPoolId: "b" }), inc("b", 10, { parentPoolId: "a" }), exp("e", 5, { sourceMovementId: "a" })];
  assert.equal(buildPools(ledger).length, 0);
  assert.equal(expensePoolId(ledger, ledger[2]), null);
});

test("la IA solo enlaza si el texto nombra a un único pozo abierto", () => {
  const ledger = [
    inc("q1", 100, { isSourcePool: true, sourcePoolName: "Quincena 1" }),
    inc("q2", 100, { isSourcePool: true, sourcePoolName: "Bono", poolClosed: true }),
  ];
  assert.equal(matchPoolByLabel(ledger, "lo pagué con la quincena 1"), "q1");
  assert.equal(matchPoolByLabel(ledger, "del bono"), null, "pozo cerrado");
  assert.equal(matchPoolByLabel(ledger, "sueldo"), null);
});

test("nombre del pozo: sourcePoolName, si no la primera parte de la nota", () => {
  assert.equal(poolName({ sourcePoolName: " Bono " }), "Bono");
  assert.equal(poolName({ note: "Pago cliente · transferencia" }), "Pago cliente");
  assert.equal(poolName({}), "Pozo");
});
