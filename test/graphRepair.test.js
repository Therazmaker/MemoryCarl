import test from "node:test";
import assert from "node:assert/strict";

import { repairGraphWithClaude, safeParseJSON } from "../src/neuro/graphRepairEngine.js";
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

test("safeParseJSON correctly parses valid JSON and handles markdown code blocks", () => {
  const jsonRaw = '{\n  "summary": "OK",\n  "deletions": ["nrn_1"]\n}';
  const parsed1 = safeParseJSON(jsonRaw);
  assert.equal(parsed1.summary, "OK");
  assert.deepEqual(parsed1.deletions, ["nrn_1"]);

  const jsonMarkdown = '```json\n{\n  "summary": "OK"\n}\n```';
  const parsed2 = safeParseJSON(jsonMarkdown);
  assert.equal(parsed2.summary, "OK");
});

test("safeParseJSON handles trailing commas and truncated JSON structures", () => {
  // Trailing comma
  const trailingCommaJson = '{\n  "summary": "OK",\n  "deletions": ["nrn_1",],\n}';
  const parsedTrailing = safeParseJSON(trailingCommaJson);
  assert.equal(parsedTrailing.summary, "OK");

  // Truncated array and unclosed object
  const truncatedJson = '{\n  "summary": "Reparación completada",\n  "deletions": ["id1", "id2"],\n  "merges": [\n    {\n      "sourceId": "nrn_a",\n      "targetId": "nrn_b"';
  const parsedTruncated = safeParseJSON(truncatedJson);
  assert.equal(parsedTruncated.summary, "Reparación completada");
  assert.equal(parsedTruncated.merges[0].sourceId, "nrn_a");
});
