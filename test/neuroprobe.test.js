import test from "node:test";
import assert from "node:assert/strict";

// Shim localStorage for Node environment if needed
if (typeof globalThis.localStorage === "undefined") {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear()
  };
}

import { getClaudeSettings, isClaudeConfigured } from "../src/services/claudeClient.js";
import { NeuroProbe, PROBE_QUESTION_TYPES } from "../src/chat/neuroprobe.js";
import { saveNeuron } from "../src/neuro/neuronStore.js";

test("NeuroProbe: Configuración de Claude heredada o directa", () => {
  localStorage.clear();
  assert.equal(isClaudeConfigured(), false);

  localStorage.setItem("memorycarl_chef_settings", JSON.stringify({
    claudeApiKey: "sk-ant-api03-testkey-1234567890",
    claudeModel: "claude-haiku-4-5"
  }));

  const settings = getClaudeSettings();
  assert.equal(settings.apiKey, "sk-ant-api03-testkey-1234567890");
  assert.equal(isClaudeConfigured(), true);
});

test("NeuroProbe: Genera preguntas priorizando neuronas activadas", () => {
  localStorage.clear();
  const probe = new NeuroProbe({ cooldownMessages: 1, cooldownMs: 0 });

  // Crear 3 neuronas
  const n1 = {
    id: "neuron_test_1",
    type: "concept",
    weight: 0.8,
    timesActivated: 5,
    triggers: ["productividad", "enfoque"],
    connections: [],
    core: { concept: "Enfoque profundo", domain: "work", summary: "Método de trabajo concentrado" }
  };
  const n2 = {
    id: "neuron_test_2",
    type: "concept",
    weight: 0.8,
    timesActivated: 5,
    triggers: ["productividad", "cansancio"],
    connections: [],
    core: { concept: "Agotamiento mental", domain: "work", summary: "Fatiga al final del día" }
  };
  const n3 = {
    id: "neuron_test_3",
    type: "concept",
    weight: 0.8,
    timesActivated: 2,
    triggers: ["guitarra"],
    connections: [],
    core: { concept: "Guitarra acústica", domain: "hobbies", summary: "Tocar música" }
  };

  saveNeuron(n1);
  saveNeuron(n2);
  saveNeuron(n3);

  // Observar activando n1 y n2
  probe.observe({
    activated: [{ neuron: n1 }, { neuron: n2 }],
    userInput: "Siento que pierdo el enfoque profundo cuando me da agotamiento mental",
    history: []
  });

  const pending = probe.getPendingQuestion();
  assert.ok(pending);
  assert.equal(pending.type, PROBE_QUESTION_TYPES.GAP);
  assert.ok(pending.neuronA.id === "neuron_test_1" || pending.neuronB.id === "neuron_test_1");
  assert.ok(pending.neuronA.id === "neuron_test_2" || pending.neuronB.id === "neuron_test_2");
});

test("NeuroProbe: Fallback local para processAnswer", async () => {
  localStorage.clear();
  const probe = new NeuroProbe();

  probe.requestQuestionOfType(PROBE_QUESTION_TYPES.GENESIS, { domainHint: "personal" });
  const pending = probe.getPendingQuestion();
  assert.ok(pending);

  const res = await probe.processAnswer("En mi vida personal valoro mucho la tranquilidad por las mañanas cuando tomo café.");
  assert.ok(res);
  assert.ok(Array.isArray(res.neuronsCreated));
  assert.equal(res.neuronsCreated.length, 1);
  assert.ok(res.neuronsCreated[0].core.concept.includes("tranquilidad"));
});
