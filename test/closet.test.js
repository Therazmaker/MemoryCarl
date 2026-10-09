import assert from "assert";
import {
  LS_CLOSET_KEY,
  LS_CLOSET_LOG_KEY,
  DEFAULT_CLOSET_ITEMS,
  loadClosetState,
  saveClosetState,
  wearClothingItems,
  markItemsAsLaundry,
  analyzeClosetHygiene,
  getDayKey
} from "../src/services/closetStore.js";

// Mock localStorage for Node environment
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

global.localStorage = localStorageMock;

console.log("Running Closet Store Unit Tests...");

// Test 1: Default Closet Initialization
localStorage.clear();
const initialState = loadClosetState();
assert.strictEqual(initialState.items.length, DEFAULT_CLOSET_ITEMS.length, "Should initialize default closet items");
assert.strictEqual(initialState.log.length, 0, "Initial log should be empty");

// Test 2: Wear Clothing Items
const wearResult = wearClothingItems(["c_box_1", "c_cam_1"], initialState.items, initialState.log, "2025-05-10");
assert.strictEqual(wearResult.items.find(i => i.id === "c_box_1").status, "usada_hoy");
assert.strictEqual(wearResult.items.find(i => i.id === "c_box_1").usageCount, 1);
assert.strictEqual(wearResult.log.length, 2);

// Test 3: Repeating Boxer on Consecutive Days triggers warning
const wearResultDay2 = wearClothingItems(["c_box_1"], wearResult.items, wearResult.log, "2025-05-11");
assert.strictEqual(wearResultDay2.warnings.length, 1);
assert(wearResultDay2.warnings[0].includes("2º día consecutivo"), "Warning should alert on consecutive undergarment reuse");

// Test 4: Laundry status transitions
const washedItems = markItemsAsLaundry(["c_box_1"], wearResultDay2.items, "wash");
const washedBoxer = washedItems.find(i => i.id === "c_box_1");
assert.strictEqual(washedBoxer.status, "limpia");
assert.strictEqual(washedBoxer.washCount, 1);

// Test 5: Hygiene Analysis
const analysis = analyzeClosetHygiene(washedItems, wearResultDay2.log, "2025-05-11");
assert.strictEqual(typeof analysis.cleanCount, "number");
assert.strictEqual(typeof analysis.dirtyCount, "number");

console.log("✅ All Closet Store Unit Tests passed successfully!");
