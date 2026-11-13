/**
 * gemini_day_refine.test.js — "Refinar con Gemini" (pestaña Días) reintenta solo
 * Datos inventados.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { requestGeminiDayRefine } from "../src/services/geminiPremiumClient.js";

const settings = { enabled: true, apiKey: "test-key-123456789", model: "gemini-2.5-flash", timeoutMs: 20000, maxOutputTokens: 4096 };
const GOOD = { improvedSummary: "Día tranquilo con un paseo", correctedEmotion: "joy", refinedThemes: ["paseo"], insights: ["x"] };

const ok = (obj, extra = {}) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: "STOP", ...extra }] }),
  text: async () => "",
});
const fail = (status) => ({ ok: false, status, json: async () => ({}), text: async () => `{"error":{"code":${status}}}` });
const payload = { date: "2026-01-02", rawChat: [{ role: "user", content: "Salí a caminar con Ana", ts: 1 }] };

function seq(responses) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, fetchImpl };
}
const sleep = async () => {};

test("day refine: reintenta tras 503 y devuelve el JSON", async () => {
  const { calls, fetchImpl } = seq([fail(503), ok(GOOD)]);
  const retries = [];
  const out = await requestGeminiDayRefine(payload, { settings, fetchImpl, sleep, onRetry: (r) => retries.push(r.attempt) });
  assert.equal(out.improvedSummary, GOOD.improvedSummary);
  assert.equal(calls.length, 2);
  assert.deepEqual(retries, [2]);
});

test("day refine: JSON cortado (MAX_TOKENS) se reintenta", async () => {
  const cut = { ok: true, status: 200, text: async () => "", json: async () => ({ candidates: [{ content: { parts: [{ text: '{"improvedSummary":"Día con' }] }, finishReason: "MAX_TOKENS" }] }) };
  const { calls, fetchImpl } = seq([cut, ok(GOOD)]);
  const out = await requestGeminiDayRefine(payload, { settings, fetchImpl, sleep });
  assert.equal(out.correctedEmotion, "joy");
  assert.equal(calls.length, 2);
});

test("day refine: timeout / red se reintenta", async () => {
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  const { calls, fetchImpl } = seq([abort, new Error("Failed to fetch"), ok(GOOD)]);
  const out = await requestGeminiDayRefine(payload, { settings, fetchImpl, sleep });
  assert.ok(out.insights);
  assert.equal(calls.length, 3);
});

test("day refine: tras 3 fallos da un mensaje claro", async () => {
  const { calls, fetchImpl } = seq([fail(503)]);
  await assert.rejects(() => requestGeminiDayRefine(payload, { settings, fetchImpl, sleep }), /saturado/);
  assert.equal(calls.length, 3);
});

test("day refine: clave mala (403) no reintenta", async () => {
  const { calls, fetchImpl } = seq([fail(403)]);
  await assert.rejects(() => requestGeminiDayRefine(payload, { settings, fetchImpl, sleep }), /rechazó/);
  assert.equal(calls.length, 1);
});

test("day refine: une varias partes e ignora las de razonamiento", async () => {
  const txt = JSON.stringify(GOOD);
  const multi = { ok: true, status: 200, text: async () => "", json: async () => ({ candidates: [{ content: { parts: [{ text: "pensando…", thought: true }, { text: txt.slice(0, 20) }, { text: txt.slice(20) }] } }] }) };
  const { fetchImpl } = seq([multi]);
  const out = await requestGeminiDayRefine(payload, { settings, fetchImpl, sleep });
  assert.equal(out.improvedSummary, GOOD.improvedSummary);
});

test("day refine: pide JSON, deja espacio de salida, limita el razonamiento y espera más", async () => {
  const { calls, fetchImpl } = seq([ok(GOOD)]);
  await requestGeminiDayRefine(payload, { settings, fetchImpl, sleep });
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.ok(body.generationConfig.maxOutputTokens >= 8192);
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 1024);
  assert.match(body.contents[0].parts[0].text, /Salí a caminar con Ana/);
});

test("day refine: sin clave no llama", async () => {
  const { calls, fetchImpl } = seq([ok(GOOD)]);
  await assert.rejects(() => requestGeminiDayRefine(payload, { settings: { ...settings, apiKey: "" }, fetchImpl, sleep }), /no configurado/);
  assert.equal(calls.length, 0);
});

test("day refine: respuesta bloqueada (SAFETY) no reintenta", async () => {
  const blocked = { ok: true, status: 200, text: async () => "", json: async () => ({ candidates: [{ finishReason: "SAFETY" }] }) };
  const { calls, fetchImpl } = seq([blocked]);
  await assert.rejects(() => requestGeminiDayRefine(payload, { settings, fetchImpl, sleep }), /bloqueó/);
  assert.equal(calls.length, 1);
});
