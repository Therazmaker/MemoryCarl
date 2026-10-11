import test from "node:test";
import assert from "node:assert/strict";
import { isFinanceTopic, buildFinanceContext } from "../src/services/financeContextEngine.js";

test("isFinanceTopic detects keywords in user input", () => {
  assert.equal(isFinanceTopic("¿Cuánto he gastado en comida este mes?"), true);
  assert.equal(isFinanceTopic("Tengo dudas sobre mi presupuesto"), true);
  assert.equal(isFinanceTopic("Hola, ¿cómo estás hoy?"), false);
});

test("isFinanceTopic detects finance domain in active neurons", () => {
  const activatedNeurons = [
    { neuron: { id: "n1", core: { concept: "Presupuesto mensual", domain: "finance" } } },
  ];
  assert.equal(isFinanceTopic("Tengo una consulta", activatedNeurons), true);
});

test("buildFinanceContext filters movements within last 30 days and totals accounts", () => {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const mockState = {
    financeAccounts: [
      { id: "acc1", name: "BCP Principal", balance: 1500, currency: "PEN" },
      { id: "acc2", name: "Efectivo", balance: 200, currency: "PEN" },
      { id: "acc3", name: "Fergis", balance: 50, currency: "PEN" }, // should be excluded from total balance
    ],
    financeLedger: [
      { id: "m1", date: new Date(now - 5 * dayMs).toISOString(), type: "expense", amount: -100, category: "Alimentación", note: "Supermercado" },
      { id: "m2", date: new Date(now - 10 * dayMs).toISOString(), type: "income", amount: 1200, category: "Sueldo", note: "Pago quiniela" },
      { id: "m3", date: new Date(now - 45 * dayMs).toISOString(), type: "expense", amount: -300, category: "Viaje", note: "Antiguo" }, // older than 30 days
    ],
  };

  const context = buildFinanceContext({ state: mockState, daysLimit: 30 });

  assert.notEqual(context, null);
  assert.equal(context.totalBalance, 1700);
  assert.equal(context.totalIncome30d, 1200);
  assert.equal(context.totalExpense30d, 100);
  assert.equal(context.net30d, 1100);
  assert.equal(context.movements.length, 2);
  assert.equal(context.movements[0].category, "Alimentación");
});
