import test from "node:test";
import assert from "node:assert/strict";

import { repairGraphWithClaude } from "../src/neuro/graphRepairEngine.js";
import { saveNeuron, getAllNeurons, hardDeleteNeuron } from "../src/neuro/neuronStore.js";

test("repairGraphWithClaude returns error when Claude is not configured", async () => {
  // Ensure window / localStorage mock if node environment
  if (typeof global.localStorage === "undefined") {
    global.localStorage = {
      store: {},
      getItem(k) { return this.store[k] || null; },
      setItem(k, v) { this.store[k] = String(v); },
      removeItem(k) { delete this.store[k]; },
    };
  }
  localStorage.setItem("memorycarl_neurochat_settings", JSON.stringify({ claudeApiKey: "" }));
  localStorage.setItem("memorycarl_chef_settings", JSON.stringify({ claudeApiKey: "" }));

  const res = await repairGraphWithClaude();
  assert.equal(res.ok, false);
  assert.ok(res.error.includes("Claude API Key"));
});

test("repairGraphWithClaude handles empty graph gracefully", async () => {
  if (typeof global.localStorage === "undefined") {
    global.localStorage = {
      store: {},
      getItem(k) { return this.store[k] || null; },
      setItem(k, v) { this.store[k] = String(v); },
      removeItem(k) { delete this.store[k]; },
    };
  }

  // Clear neurons
  const current = getAllNeurons();
  for (const n of current) hardDeleteNeuron(n.id);

  localStorage.setItem("memorycarl_chef_settings", JSON.stringify({ claudeApiKey: "sk-ant-api03-testkey1234567890" }));

  const res = await repairGraphWithClaude();
  assert.equal(res.ok, true);
  assert.equal(res.deletedCount, 0);
  assert.ok(res.summary.includes("No hay neuronas"));
});
