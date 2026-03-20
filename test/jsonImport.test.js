/**
 * jsonImport.test.js — Tests para el módulo de importación JSON de neuronas
 * MemoryCarl
 */

import test from "node:test";
import assert from "node:assert/strict";

const store = {};
if (typeof localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

function resetStorage() {
  Object.keys(store).forEach((k) => delete store[k]);
}

import {
  parseNeuronJsonInput,
  normalizeImportedNeuronPayload,
  previewNeuronImport,
  importNeuronJson,
  getNeuronSchemaTemplate,
  getNeuronPromptTemplate,
} from "../src/neuro/importer.js";
import { createNeuron } from "../src/neuro/schemas.js";
import { saveNeuron, getNeuronById } from "../src/neuro/neuronStore.js";

// ================================================================
// parseNeuronJsonInput
// ================================================================

test("parseNeuronJsonInput: parsea JSON de objeto simple", () => {
  const raw = JSON.stringify({ type: "memory", core: { concept: "Test", domain: "general", summary: "ok" } });
  const { parsed, error } = parseNeuronJsonInput(raw);
  assert.equal(error, null);
  assert.ok(parsed !== null);
  assert.equal(parsed.type, "memory");
});

test("parseNeuronJsonInput: parsea JSON de array", () => {
  const raw = JSON.stringify([
    { type: "memory", core: { concept: "A", domain: "general", summary: "" } },
    { type: "memory", core: { concept: "B", domain: "general", summary: "" } },
  ]);
  const { parsed, error } = parseNeuronJsonInput(raw);
  assert.equal(error, null);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 2);
});

test("parseNeuronJsonInput: tolera markdown fences ```json ... ```", () => {
  const raw = '```json\n{"type":"memory","core":{"concept":"Fenced","domain":"general","summary":"s"}}\n```';
  const { parsed, error } = parseNeuronJsonInput(raw);
  assert.equal(error, null);
  assert.equal(parsed.core.concept, "Fenced");
});

test("parseNeuronJsonInput: tolera ``` sin json```", () => {
  const raw = "```\n{\"type\":\"memory\",\"core\":{\"concept\":\"Tick\",\"domain\":\"general\",\"summary\":\"s\"}}\n```";
  const { parsed, error } = parseNeuronJsonInput(raw);
  assert.equal(error, null);
  assert.equal(parsed.core.concept, "Tick");
});

test("parseNeuronJsonInput: extrae JSON de texto extra alrededor", () => {
  const raw = 'Aquí va tu neurona:\n{"type":"memory","core":{"concept":"Embedded","domain":"general","summary":"s"}}\nFin.';
  const { parsed, error } = parseNeuronJsonInput(raw);
  assert.equal(error, null);
  assert.equal(parsed.core.concept, "Embedded");
});

test("parseNeuronJsonInput: devuelve error para entrada vacía", () => {
  const { parsed, error } = parseNeuronJsonInput("");
  assert.ok(error !== null);
  assert.equal(parsed, null);
});

test("parseNeuronJsonInput: devuelve error para JSON inválido", () => {
  const { parsed, error } = parseNeuronJsonInput("not json at all");
  assert.ok(error !== null);
  assert.equal(parsed, null);
});

// ================================================================
// normalizeImportedNeuronPayload
// ================================================================

test("normalizeImportedNeuronPayload: acepta neurona única como objeto", () => {
  const raw = { type: "memory", core: { concept: "Solo", domain: "general", summary: "" } };
  const { neurons, error } = normalizeImportedNeuronPayload(raw);
  assert.equal(error, null);
  assert.equal(neurons.length, 1);
});

test("normalizeImportedNeuronPayload: acepta array directo", () => {
  const raw = [
    { type: "memory", core: { concept: "A", domain: "general", summary: "" } },
    { type: "memory", core: { concept: "B", domain: "general", summary: "" } },
  ];
  const { neurons, error } = normalizeImportedNeuronPayload(raw);
  assert.equal(error, null);
  assert.equal(neurons.length, 2);
});

test("normalizeImportedNeuronPayload: acepta wrapper { neurons: [...] }", () => {
  const raw = {
    neurons: [
      { type: "memory", core: { concept: "X", domain: "general", summary: "" } },
    ],
  };
  const { neurons, error } = normalizeImportedNeuronPayload(raw);
  assert.equal(error, null);
  assert.equal(neurons.length, 1);
});

test("normalizeImportedNeuronPayload: devuelve error para payload nulo", () => {
  const { neurons, error } = normalizeImportedNeuronPayload(null);
  assert.ok(error !== null);
  assert.equal(neurons.length, 0);
});

// ================================================================
// previewNeuronImport
// ================================================================

test("previewNeuronImport: clasifica neurona válida como valid", () => {
  resetStorage();
  const raw = [
    createNeuron({ core: { concept: "Preview válida", domain: "general", summary: "resumen" }, type: "memory" }),
  ];
  const { valid, fixable, rejected } = previewNeuronImport(raw);
  assert.equal(valid.length, 1);
  assert.equal(fixable.length, 0);
  assert.equal(rejected.length, 0);
});

test("previewNeuronImport: clasifica objeto no-neurona como rejected", () => {
  resetStorage();
  const { valid, fixable, rejected } = previewNeuronImport(["string invalida"]);
  assert.equal(rejected.length, 1);
});

test("previewNeuronImport: detecta duplicado probable por concepto", () => {
  resetStorage();
  const n = createNeuron({ core: { concept: "Mi Concepto Único", domain: "general", summary: "resumen" }, type: "memory" });
  saveNeuron(n);
  const { valid } = previewNeuronImport([
    createNeuron({ core: { concept: "mi concepto único", domain: "general", summary: "otro resumen" }, type: "memory" }),
  ]);
  // Debe ser valid pero con warning de duplicado
  assert.equal(valid.length, 1);
  assert.ok(valid[0].errors.some((e) => e.toLowerCase().includes("duplicado")));
});

test("previewNeuronImport: devuelve listas vacías para array vacío", () => {
  const result = previewNeuronImport([]);
  assert.equal(result.valid.length, 0);
  assert.equal(result.fixable.length, 0);
  assert.equal(result.rejected.length, 0);
});

// ================================================================
// importNeuronJson
// ================================================================

test("importNeuronJson: importa una sola neurona válida", () => {
  resetStorage();
  const n = createNeuron({ core: { concept: "Import Single", domain: "general", summary: "resumen" }, type: "memory" });
  const result = importNeuronJson([n]);
  assert.equal(result.imported, 1);
  assert.equal(result.merged, 0);
  assert.equal(result.discarded, 0);
  const found = getNeuronById(n.id);
  assert.ok(found !== null);
});

test("importNeuronJson: importa array de neuronas válidas", () => {
  resetStorage();
  const neurons = [
    createNeuron({ core: { concept: "Import A", domain: "general", summary: "a" }, type: "memory" }),
    createNeuron({ core: { concept: "Import B", domain: "work", summary: "b" }, type: "work_context" }),
  ];
  const result = importNeuronJson(neurons);
  assert.equal(result.imported, 2);
});

test("importNeuronJson: descarta duplicados con strategy=discard", () => {
  resetStorage();
  const n = createNeuron({ core: { concept: "Dup Concept", domain: "general", summary: "resumen" }, type: "memory" });
  saveNeuron(n);
  const duplicate = { ...n };
  const result = importNeuronJson([duplicate], { duplicateStrategy: "discard" });
  assert.equal(result.imported, 0);
  assert.equal(result.discarded, 1);
});

test("importNeuronJson: hace merge de duplicado con strategy=merge", () => {
  resetStorage();
  const n = createNeuron({
    id: "merge_test_1",
    core: { concept: "Merge Target", domain: "general", summary: "original" },
    type: "memory",
    triggers: ["trigger_a"],
  });
  saveNeuron(n);
  const incoming = createNeuron({
    id: "merge_test_1",
    core: { concept: "Merge Target", domain: "general", summary: "actualizado" },
    type: "memory",
    triggers: ["trigger_b"],
  });
  const result = importNeuronJson([incoming], { duplicateStrategy: "merge" });
  assert.equal(result.merged, 1);
  assert.equal(result.imported, 0);
  const after = getNeuronById("merge_test_1");
  assert.ok(after !== null);
  assert.ok(after.triggers.includes("trigger_b") || after.core.summary.length > 0);
});

test("importNeuronJson: importa como nueva con strategy=new si hay duplicado", () => {
  resetStorage();
  const n = createNeuron({ core: { concept: "New Strategy", domain: "general", summary: "s" }, type: "memory" });
  saveNeuron(n);
  const dup = { ...n };
  const result = importNeuronJson([dup], { duplicateStrategy: "new" });
  assert.equal(result.imported, 1);
});

test("importNeuronJson: descarta entradas nulas/no-objeto", () => {
  resetStorage();
  const result = importNeuronJson([null, 123, undefined]);
  assert.equal(result.imported, 0);
  assert.ok(result.discarded >= 2); // null and 123 should be discarded
});

test("importNeuronJson: devuelve error para entrada no-array", () => {
  const result = importNeuronJson(null);
  assert.ok(result.errors.length > 0);
});

// ================================================================
// Schema y Prompt templates
// ================================================================

test("getNeuronSchemaTemplate: devuelve JSON válido", () => {
  const template = getNeuronSchemaTemplate();
  assert.ok(typeof template === "string");
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(template); });
  assert.ok(parsed.type !== undefined);
  assert.ok(parsed.core !== undefined);
  assert.ok(parsed.meta !== undefined);
});

test("getNeuronSchemaTemplate: incluye types permitidos", () => {
  const template = getNeuronSchemaTemplate();
  assert.ok(template.includes("manual_context"));
  assert.ok(template.includes("person"));
  assert.ok(template.includes("memory"));
});

test("getNeuronPromptTemplate: devuelve string no vacío con instrucciones", () => {
  const prompt = getNeuronPromptTemplate();
  assert.ok(typeof prompt === "string");
  assert.ok(prompt.length > 100);
  assert.ok(prompt.toLowerCase().includes("schema") || prompt.includes("SCHEMA"));
  assert.ok(prompt.includes("JSON"));
});

test("getNeuronPromptTemplate: incluye emociones y categorías", () => {
  const prompt = getNeuronPromptTemplate();
  assert.ok(prompt.includes("joy"));
  assert.ok(prompt.includes("people"));
});

// ================================================================
// Integración: parseo completo → importación
// ================================================================

test("integración: parseo de markdown fence + importación completa", () => {
  resetStorage();
  const neuronJson = JSON.stringify(
    createNeuron({ core: { concept: "ChatGPT Neuron", domain: "work", summary: "generada externamente" }, type: "manual_context" })
  );
  const raw = "```json\n" + neuronJson + "\n```";

  const { parsed, error } = parseNeuronJsonInput(raw);
  assert.equal(error, null);

  const { neurons, error: normErr } = normalizeImportedNeuronPayload(parsed);
  assert.equal(normErr, null);
  assert.equal(neurons.length, 1);

  const result = importNeuronJson(neurons);
  assert.equal(result.imported, 1);
  assert.equal(result.errors.length, 0);
});

test("integración: parseo de wrapper { neurons: [...] } + importación", () => {
  resetStorage();
  const n1 = createNeuron({ core: { concept: "Wrapper A", domain: "general", summary: "a" }, type: "memory" });
  const n2 = createNeuron({ core: { concept: "Wrapper B", domain: "general", summary: "b" }, type: "memory" });
  const raw = JSON.stringify({ neurons: [n1, n2] });

  const { parsed } = parseNeuronJsonInput(raw);
  const { neurons } = normalizeImportedNeuronPayload(parsed);
  assert.equal(neurons.length, 2);

  const result = importNeuronJson(neurons);
  assert.equal(result.imported, 2);
});

test("neurona importada por JSON tiene feedbackStats y puede recibir like/dislike", () => {
  resetStorage();
  const n = createNeuron({ core: { concept: "Feedback Import", domain: "general", summary: "s" }, type: "memory" });
  importNeuronJson([n]);

  const saved = getNeuronById(n.id);
  assert.ok(saved !== null);
  assert.ok(typeof saved.feedbackStats.likes === "number");
  assert.ok(typeof saved.feedbackStats.dislikes === "number");
});
