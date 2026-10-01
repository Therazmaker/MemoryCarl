import assert from "node:assert";
import test from "node:test";
import { computeDailyLiquidity } from "../src/services/dailyFlowEngine.js";

test("computeDailyLiquidity calculates balance excluding Fergis and archived accounts", () => {
  const rootState = {
    btcPricePen: 318902.44, // 0.00001640 BTC = 5.23 PEN
    financeAccounts: [
      { id: "1", name: "LIGO", balance: 0, type: "fiat" },
      { id: "2", name: "FERGIS", balance: 500, type: "fiat" }, // Fergis tracking account, should be excluded
      { id: "3", name: "BBVA", balance: 0, type: "fiat" },
      { id: "4", name: "BCP", balance: 182.82, type: "fiat" },
      { id: "5", name: "BINANCE", balance: 0.00001640, type: "crypto" },
      { id: "6", name: "MERIENDAS Y PASAJES", balance: 130, type: "fiat" },
      { id: "7", name: "Old Account", balance: 1000, archived: true } // Archived, should be excluded
    ]
  };

  const result = computeDailyLiquidity(rootState);

  // Total calculated balance should be BCP (182.82) + BINANCE (5.23) + MERIENDAS (130) = 318.05
  assert.strictEqual(result.accountsBreakdown.length, 5); // LIGO, BBVA, BCP, BINANCE, MERIENDAS
  assert.strictEqual(result.calculatedBalance, 318.05);
});
