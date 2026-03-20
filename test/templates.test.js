/**
 * templates.test.js — Tests para funciones de schema y prompt de neuronas
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

import {
  getNeuronSchemaTemplate,
  getNeuronPromptTemplate,
  getCombinedSchemaAndPrompt,
  copyNeuronSchemaToClipboard,
  copyNeuronPromptToClipboard,
  copyNeuronSchemaAndPrompt,
} from "../src/neuro/importer.js";

// ================================================================
// getNeuronSchemaTemplate
// ================================================================

test("getNeuronSchemaTemplate: devuelve JSON válido parseable", () => {
  const template = getNeuronSchemaTemplate();
  assert.ok(typeof template === "string");
  assert.ok(template.length > 0);
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(template); });
  assert.ok(parsed !== null && parsed !== undefined);
});

test("getNeuronSchemaTemplate: incluye campo type", () => {
  const template = getNeuronSchemaTemplate();
  const parsed = JSON.parse(template);
  assert.ok(parsed.type !== undefined && parsed.type !== null);
});

test("getNeuronSchemaTemplate: incluye campo core con concept, domain, summary", () => {
  const template = getNeuronSchemaTemplate();
  const parsed = JSON.parse(template);
  assert.ok(parsed.core !== undefined);
  assert.ok(parsed.core.concept !== undefined);
  assert.ok(parsed.core.domain !== undefined);
  assert.ok(parsed.core.summary !== undefined);
});

test("getNeuronSchemaTemplate: incluye campo meta con priority, pin, manualCategory", () => {
  const template = getNeuronSchemaTemplate();
  const parsed = JSON.parse(template);
  assert.ok(parsed.meta !== undefined);
  assert.ok(parsed.meta.priority !== undefined);
  assert.ok(parsed.meta.pin !== undefined);
  assert.ok(parsed.meta.manualCategory !== undefined);
});

test("getNeuronSchemaTemplate: incluye triggers y evidence como arrays", () => {
  const template = getNeuronSchemaTemplate();
  const parsed = JSON.parse(template);
  assert.ok(Array.isArray(parsed.triggers));
  assert.ok(Array.isArray(parsed.evidence));
});

test("getNeuronSchemaTemplate: incluye campo source con kind y ref", () => {
  const template = getNeuronSchemaTemplate();
  const parsed = JSON.parse(template);
  assert.ok(parsed.source !== undefined);
  assert.ok(parsed.source.kind !== undefined);
  assert.ok(parsed.source.ref !== undefined);
});

test("getNeuronSchemaTemplate: no hay undefined ni null en el JSON resultante", () => {
  const template = getNeuronSchemaTemplate();
  assert.ok(!template.includes("undefined"));
  const parsed = JSON.parse(template);
  // Top-level fields must be present
  ["type", "core", "triggers", "emotion", "evidence", "source", "meta"].forEach((field) => {
    assert.notEqual(parsed[field], undefined, `Field ${field} should not be undefined`);
    assert.notEqual(parsed[field], null, `Field ${field} should not be null`);
  });
});

// ================================================================
// getNeuronPromptTemplate
// ================================================================

test("getNeuronPromptTemplate: devuelve string no vacío", () => {
  const prompt = getNeuronPromptTemplate();
  assert.ok(typeof prompt === "string");
  assert.ok(prompt.length > 100);
});

test("getNeuronPromptTemplate: contiene reglas sobre JSON y no markdown", () => {
  const prompt = getNeuronPromptTemplate();
  assert.ok(prompt.includes("JSON") || prompt.includes("json"));
  assert.ok(prompt.toLowerCase().includes("markdown") || prompt.toLowerCase().includes("schema"));
});

test("getNeuronPromptTemplate: contiene el schema embebido", () => {
  const prompt = getNeuronPromptTemplate();
  assert.ok(prompt.includes("concept"));
  assert.ok(prompt.includes("domain"));
  assert.ok(prompt.includes("summary"));
});

test("getNeuronPromptTemplate: no es undefined ni null", () => {
  const prompt = getNeuronPromptTemplate();
  assert.notEqual(prompt, undefined);
  assert.notEqual(prompt, null);
  assert.ok(prompt.length > 0);
});

// ================================================================
// getCombinedSchemaAndPrompt
// ================================================================

test("getCombinedSchemaAndPrompt: devuelve string no vacío", () => {
  const combined = getCombinedSchemaAndPrompt();
  assert.ok(typeof combined === "string");
  assert.ok(combined.length > 0);
});

test("getCombinedSchemaAndPrompt: incluye sección de schema", () => {
  const combined = getCombinedSchemaAndPrompt();
  assert.ok(combined.includes("SCHEMA") || combined.includes("schema"));
});

test("getCombinedSchemaAndPrompt: incluye sección de prompt", () => {
  const combined = getCombinedSchemaAndPrompt();
  assert.ok(combined.includes("PROMPT") || combined.includes("prompt"));
});

test("getCombinedSchemaAndPrompt: incluye contenido de schema y prompt", () => {
  const combined = getCombinedSchemaAndPrompt();
  const schema = getNeuronSchemaTemplate();
  const prompt = getNeuronPromptTemplate();
  assert.ok(combined.includes(schema));
  assert.ok(combined.includes(prompt));
});

test("getCombinedSchemaAndPrompt: no es undefined ni null", () => {
  const combined = getCombinedSchemaAndPrompt();
  assert.notEqual(combined, undefined);
  assert.notEqual(combined, null);
});

// ================================================================
// Clipboard functions (sin DOM — verifican retorno string correcto)
// ================================================================

test("copyNeuronSchemaToClipboard: devuelve objeto con success y message", async () => {
  const result = await copyNeuronSchemaToClipboard();
  assert.ok(typeof result === "object");
  assert.ok(typeof result.success === "boolean");
  assert.ok(typeof result.message === "string");
  assert.ok(result.message.length > 0);
});

test("copyNeuronPromptToClipboard: devuelve objeto con success y message", async () => {
  const result = await copyNeuronPromptToClipboard();
  assert.ok(typeof result === "object");
  assert.ok(typeof result.success === "boolean");
  assert.ok(typeof result.message === "string");
  assert.ok(result.message.length > 0);
});

test("copyNeuronSchemaAndPrompt: devuelve objeto con success y message", async () => {
  const result = await copyNeuronSchemaAndPrompt();
  assert.ok(typeof result === "object");
  assert.ok(typeof result.success === "boolean");
  assert.ok(typeof result.message === "string");
  assert.ok(result.message.length > 0);
});

test("copyNeuronSchemaToClipboard: message no es vacío ni undefined", async () => {
  const result = await copyNeuronSchemaToClipboard();
  assert.notEqual(result.message, "");
  assert.notEqual(result.message, undefined);
  assert.notEqual(result.message, null);
});

test("copyNeuronPromptToClipboard: message no es vacío ni undefined", async () => {
  const result = await copyNeuronPromptToClipboard();
  assert.notEqual(result.message, "");
  assert.notEqual(result.message, undefined);
  assert.notEqual(result.message, null);
});

test("copyNeuronSchemaAndPrompt: message no es vacío ni undefined", async () => {
  const result = await copyNeuronSchemaAndPrompt();
  assert.notEqual(result.message, "");
  assert.notEqual(result.message, undefined);
  assert.notEqual(result.message, null);
});
