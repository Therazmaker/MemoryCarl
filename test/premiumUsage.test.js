/**
 * premiumUsage.test.js — Tests para el módulo premiumUsage.js
 * MemoryCarl / NeuroChat Phase 2
 */

import test from "node:test";
import assert from "node:assert/strict";

// ---- Mock localStorage ----
const store = {};
if (typeof localStorage === "undefined") {
  globalThis.localStorage = {
    getItem:    (k)    => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    clear:      ()     => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

function resetStorage() {
  Object.keys(store).forEach((k) => delete store[k]);
}

import {
  getPremiumUsageToday,
  incrementPremiumUsage,
  canUsePremiumCall,
  getPremiumUsageState,
  resetPremiumUsageIfNeeded,
} from "../src/neuro/premiumUsage.js";

const STORAGE_KEY = "memorycarl_premium_usage";

// ================================================================
// Basic state
// ================================================================

test("getPremiumUsageToday returns 0 with no prior usage", () => {
  resetStorage();
  assert.equal(getPremiumUsageToday(), 0);
});

test("getPremiumUsageState returns complete state object", () => {
  resetStorage();
  const s = getPremiumUsageState();
  assert.ok("date"      in s);
  assert.ok("used"      in s);
  assert.ok("remaining" in s);
  assert.ok("limit"     in s);
  assert.ok("canUse"    in s);
  assert.ok(Array.isArray(s.events));
  assert.equal(s.used, 0);
  assert.equal(s.canUse, true);
});

test("getPremiumUsageState date matches today", () => {
  resetStorage();
  const s = getPremiumUsageState();
  const today = new Date();
  const expected = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  assert.equal(s.date, expected);
});

// ================================================================
// increment
// ================================================================

test("incrementPremiumUsage increments used count", () => {
  resetStorage();
  assert.equal(getPremiumUsageToday(), 0);
  incrementPremiumUsage();
  assert.equal(getPremiumUsageToday(), 1);
  incrementPremiumUsage();
  assert.equal(getPremiumUsageToday(), 2);
});

test("incrementPremiumUsage records event with metadata", () => {
  resetStorage();
  incrementPremiumUsage({ reason: "test_reason", inputLabel: "high", inputPreview: "some preview text" });
  const s = getPremiumUsageState();
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].reason, "test_reason");
  assert.equal(s.events[0].inputLabel, "high");
  assert.ok(s.events[0].inputPreview.includes("some preview"));
  assert.ok(s.events[0].timestamp);
});

test("incrementPremiumUsage truncates long inputPreview", () => {
  resetStorage();
  const longText = "a".repeat(200);
  incrementPremiumUsage({ inputPreview: longText });
  const s = getPremiumUsageState();
  assert.ok(s.events[0].inputPreview.length <= 80);
});

// ================================================================
// canUsePremiumCall
// ================================================================

test("canUsePremiumCall returns true when under limit", () => {
  resetStorage();
  assert.equal(canUsePremiumCall(), true);
});

test("canUsePremiumCall returns false when limit reached", () => {
  resetStorage();
  // Simulate reaching the limit (default 20)
  // Inject a state with used === limit directly
  const today = new Date();
  const date = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  store[STORAGE_KEY] = JSON.stringify({ date, used: 20, limit: 20, events: [] });
  assert.equal(canUsePremiumCall(), false);
});

test("canUsePremiumCall with custom limit", () => {
  resetStorage();
  // Inject state with 5 used
  const today = new Date();
  const date = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  store[STORAGE_KEY] = JSON.stringify({ date, used: 5, limit: 10, events: [] });
  assert.equal(canUsePremiumCall({ limit: 10 }), true);
  store[STORAGE_KEY] = JSON.stringify({ date, used: 10, limit: 10, events: [] });
  assert.equal(canUsePremiumCall({ limit: 10 }), false);
});

// ================================================================
// reset on day change
// ================================================================

test("resetPremiumUsageIfNeeded resets when date is old", () => {
  resetStorage();
  // Inject a state from yesterday
  store[STORAGE_KEY] = JSON.stringify({ date: "2000-01-01", used: 15, limit: 20, events: [] });
  resetPremiumUsageIfNeeded();
  assert.equal(getPremiumUsageToday(), 0);
});

test("resetPremiumUsageIfNeeded does not reset when date is today", () => {
  resetStorage();
  const today = new Date();
  const date = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  store[STORAGE_KEY] = JSON.stringify({ date, used: 7, limit: 20, events: [] });
  const didReset = resetPremiumUsageIfNeeded();
  assert.equal(didReset, false);
  assert.equal(getPremiumUsageToday(), 7);
});

test("auto-reset occurs when state has old date", () => {
  resetStorage();
  store[STORAGE_KEY] = JSON.stringify({ date: "1999-12-31", used: 19, limit: 20, events: [] });
  // Reading state should automatically reset
  const count = getPremiumUsageToday();
  assert.equal(count, 0);
});

// ================================================================
// Corrupted storage
// ================================================================

test("handles corrupted localStorage gracefully", () => {
  resetStorage();
  store[STORAGE_KEY] = "NOT_VALID_JSON{{{";
  assert.doesNotThrow(() => {
    const s = getPremiumUsageState();
    assert.equal(s.used, 0);
    assert.equal(s.canUse, true);
  });
});

test("handles null localStorage value gracefully", () => {
  resetStorage();
  // No key at all
  assert.doesNotThrow(() => {
    const s = getPremiumUsageState();
    assert.equal(s.used, 0);
  });
});

test("handles partial/missing fields in stored state", () => {
  resetStorage();
  const today = new Date();
  const date = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  // Missing 'events' and 'limit' fields
  store[STORAGE_KEY] = JSON.stringify({ date, used: 3 });
  const s = getPremiumUsageState();
  assert.equal(s.used, 3);
  assert.ok(Array.isArray(s.events));
  assert.ok(s.limit > 0);
});

// ================================================================
// remaining calculation
// ================================================================

test("remaining = limit - used", () => {
  resetStorage();
  const today = new Date();
  const date = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  store[STORAGE_KEY] = JSON.stringify({ date, used: 8, limit: 20, events: [] });
  const s = getPremiumUsageState();
  assert.equal(s.remaining, 12);
});
