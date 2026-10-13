import { test } from "node:test";
import assert from "node:assert";
import {
  getNatalChartData,
  saveNatalChartData,
  resetNatalChartData,
  DEFAULT_NATAL_CHART,
} from "../src/chat/couchStore.js";
import {
  renderNatalChartSvg,
  viewCouch,
} from "../src/chat/couch-ui.js";

// Mock localStorage for node environment
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

global.localStorage = localStorageMock;

test("couchStore: default state and saving/loading natal chart", () => {
  localStorage.clear();
  const defaultChart = getNatalChartData();
  assert.strictEqual(defaultChart.planets.length, 0);
  assert.strictEqual(defaultChart.houseCusps.length, 12);

  const sampleChart = {
    birthDetails: { name: "Carl", date: "1995-05-15", time: "14:30", location: "Santiago" },
    planets: [{ planetId: "sol", sign: "tauro", degree: 24, house: 9, isRetrograde: false }],
    houseCusps: defaultChart.houseCusps,
    aspects: [],
  };

  saveNatalChartData(sampleChart);
  const loaded = getNatalChartData();
  assert.strictEqual(loaded.birthDetails.name, "Carl");
  assert.strictEqual(loaded.planets.length, 1);
  assert.strictEqual(loaded.planets[0].planetId, "sol");

  resetNatalChartData();
  const resetData = getNatalChartData();
  assert.strictEqual(resetData.planets.length, 0);
});

test("couch-ui: render SVG natal chart HTML", () => {
  const sampleData = {
    birthDetails: { name: "Test" },
    planets: [
      { planetId: "sol", sign: "aries", degree: 10, house: 1 },
      { planetId: "luna", sign: "libra", degree: 10, house: 7 },
    ],
    houseCusps: DEFAULT_NATAL_CHART.houseCusps,
    aspects: [{ planet1Id: "sol", aspectId: "oposicion", planet2Id: "luna" }],
  };

  const svgHtml = renderNatalChartSvg(sampleData);
  assert.ok(svgHtml.includes("<svg"));
  assert.ok(svgHtml.includes("couchNatalSvg"));
  assert.ok(svgHtml.includes("☉")); // Sol glyph
  assert.ok(svgHtml.includes("☽")); // Luna glyph

  const couchViewHtml = viewCouch();
  assert.ok(couchViewHtml.includes("Couch Astro — Carta Natal"));
  assert.ok(couchViewHtml.includes("couchBottomBar"));
});
