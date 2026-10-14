import assert from "assert";
import {
  ZODIAC_SIGNS,
  PLANETS_CATALOG,
  ASPECT_TYPES,
  DEFAULT_NATAL_CHART,
} from "../src/chat/couchStore.js";
import {
  renderNatalChartSvg,
} from "../src/chat/couch-ui.js";

console.log("Running Couch Astro Unit Tests...");

// 1. Verify ASPECT_TYPES contains Semi-sextil
const semiSextil = ASPECT_TYPES.find((a) => a.id === "semisextil");
assert.ok(semiSextil, "Semi-sextil aspect type should exist");
assert.strictEqual(semiSextil.angle, 30, "Semi-sextil angle should be 30°");
assert.strictEqual(semiSextil.symbol, "⚺", "Semi-sextil symbol should be ⚺");
console.log("✓ Semi-sextil aspect definition passed");

// 2. Verify Natal Chart SVG rendering with planets and house cusps
const testChart = {
  ...DEFAULT_NATAL_CHART,
  planets: [
    { planetId: "sol", sign: "acuario", degree: 12, minutes: 11, seconds: 22, house: 1 },
    { planetId: "luna", sign: "piscis", degree: 15, minutes: 51, seconds: 20, house: 2 },
  ],
  aspects: [
    { planet1Id: "sol", aspectId: "semisextil", planet2Id: "luna" },
  ],
};

const svgOutput = renderNatalChartSvg(testChart);
assert.ok(svgOutput.includes("svg"), "Should render SVG output");
assert.ok(svgOutput.includes("AC"), "Should render AC tag");
assert.ok(svgOutput.includes("MC"), "Should render MC tag");
assert.ok(svgOutput.includes("☉"), "Should render Sol symbol");
console.log("✓ Couch Natal Chart SVG rendering passed");

console.log("ALL COUCH ASTRO TESTS PASSED! 🎉");
