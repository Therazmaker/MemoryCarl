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
  couchUiState,
} from "../src/chat/couch-ui.js";

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

test("couchStore: default state and saving/loading natal chart with transition houses and precise degrees", () => {
  localStorage.clear();
  const defaultChart = getNatalChartData();
  assert.strictEqual(defaultChart.planets.length, 0);

  const sampleChart = {
    birthDetails: { name: "Carl", date: "1995-05-15", time: "14:30", location: "Santiago" },
    planets: [
      { planetId: "jupiter", sign: "virgo", degree: 12, minutes: 27, seconds: 48, house: 7, secondaryHouse: 8, isRetrograde: true }
    ],
    houseCusps: defaultChart.houseCusps,
    aspects: [],
  };

  saveNatalChartData(sampleChart);
  const loaded = getNatalChartData();
  assert.strictEqual(loaded.planets.length, 1);
  assert.strictEqual(loaded.planets[0].planetId, "jupiter");
  assert.strictEqual(loaded.planets[0].house, 7);
  assert.strictEqual(loaded.planets[0].secondaryHouse, 8);
  assert.strictEqual(loaded.planets[0].minutes, 27);

  resetNatalChartData();
  assert.strictEqual(getNatalChartData().planets.length, 0);
});

test("couch-ui: render planetary table with transition houses and exact degrees", () => {
  const sampleData = {
    birthDetails: { name: "Test" },
    planets: [
      { planetId: "jupiter", sign: "virgo", degree: 12, minutes: 27, seconds: 48, house: 7, secondaryHouse: 8, isRetrograde: true },
      { planetId: "saturno", sign: "acuario", degree: 10, minutes: 8, seconds: 14, house: 12, secondaryHouse: 1, isRetrograde: false }
    ],
    houseCusps: DEFAULT_NATAL_CHART.houseCusps,
    aspects: [],
  };

  saveNatalChartData(sampleData);

  const svgHtml = renderNatalChartSvg(sampleData);
  assert.ok(svgHtml.includes("<svg"));

  couchUiState.activeSubTab = "data";
  const couchViewHtml = viewCouch();
  assert.ok(couchViewHtml.includes("7 » 8"));
  assert.ok(couchViewHtml.includes("12 » 1"));
  assert.ok(couchViewHtml.includes("12°27'48\""));
});
