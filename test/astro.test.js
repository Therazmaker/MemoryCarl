import test from "node:test";
import assert from "node:assert/strict";

const store = {};
global.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

const { absoluteDegree, houseForDegree, computeAspects, effectiveAspects, aspectMode, planetsInHouse, houseRuler, chartSummaryForPrompt } = await import("../src/chat/astroChart.js");
const { detectAstroThemes, recordAstroActivation, backfillAstroActivations, getActivationStats, buildAstroPromptBlock, setAstroInPromptEnabled, ACTIVATIONS_KEY, BACKFILL_KEY } = await import("../src/chat/astroLinks.js");
const { renderNatalWheel, spreadLongitudes } = await import("../src/chat/natalWheel.js");

const signs = ["aries", "tauro", "geminis", "cancer", "leo", "virgo", "libra", "escorpio", "sagitario", "capricornio", "acuario", "piscis"];
const P = (planetId, sign, degree, house) => ({ planetId, sign, degree, minutes: 0, seconds: 0, house });
const chart = {
  birthDetails: {},
  planets: [
    P("sol", "acuario", 12, 9), P("luna", "piscis", 15, 10), P("mercurio", "acuario", 25, 9),
    P("marte", "leo", 10, 3), P("saturno", "piscis", 8, 10), P("venus", "capricornio", 28, 8),
  ],
  // Casas iguales desde 5° Géminis: casa 10 = 5° Piscis → regente Neptuno
  houseCusps: Array.from({ length: 12 }, (_, i) => ({ house: i + 1, sign: signs[(2 + i) % 12], degree: 5, minutes: 0, seconds: 0 })),
  aspects: [],
};

test("grados absolutos y casa de un grado", () => {
  assert.equal(absoluteDegree("acuario", 12), 312);
  assert.equal(houseForDegree(absoluteDegree("geminis", 10), chart.houseCusps), 1);
  assert.equal(houseForDegree(absoluteDegree("geminis", 2), chart.houseCusps), 12);
});

test("aspectos automáticos: oposición Sol–Marte y nada sin sentido", () => {
  const asp = computeAspects(chart);
  const solMarte = asp.find((a) => [a.planet1Id, a.planet2Id].sort().join() === "marte,sol");
  assert.equal(solMarte.aspectId, "oposicion");
  assert.equal(solMarte.orb, 2);
  assert.equal(aspectMode(chart), "auto");
  assert.equal(aspectMode({ ...chart, aspects: [{ planet1Id: "sol", aspectId: "trigono", planet2Id: "luna" }] }), "manual");
  assert.equal(effectiveAspects({ ...chart, aspects: [{ planet1Id: "sol", aspectId: "trigono", planet2Id: "luna" }] }).length, 1);
});

test("planetas en casa y regente", () => {
  assert.deepEqual(planetsInHouse(chart, 10).sort(), ["luna", "saturno"]);
  assert.equal(houseRuler(chart, 10), "neptuno");
});

test("detección de temas en mensajes", () => {
  const t = detectAstroThemes("Discutí con mi novia por plata");
  assert.deepEqual(t.houses.map((h) => h.h).sort((a, b) => a - b), [2, 7]);
  assert.equal(t.planets[0].p, "marte");
  assert.equal(detectAstroThemes("Hola, ¿cómo estás?").houses.length, 0);
  assert.equal(detectAstroThemes("Hoy en el trabajo").houses[0].via, "trabajo");
});

test("estadísticas cruzan lo hablado con la carta", () => {
  localStorage.clear();
  recordAstroActivation({ text: "Mi jefe me presionó en el trabajo", messageId: "m1" });
  recordAstroActivation({ text: "Otra vez el trabajo", messageId: "m2" });
  recordAstroActivation({ text: "Otra vez el trabajo", messageId: "m2" }); // duplicado ignorado
  const stats = getActivationStats({ chart });
  assert.equal(stats.total, 2);
  const c10 = stats.houses.find((h) => h.house === 10);
  assert.equal(c10.count, 2);
  // Luna y Saturno están en la casa 10; Neptuno la rige; Saturno además por "presion"
  const ids = stats.planets.map((p) => p.id);
  assert.ok(ids.includes("luna") && ids.includes("saturno") && ids.includes("neptuno"));
  assert.equal(stats.planets[0].id, "saturno");
});

test("el historial se analiza una sola vez", () => {
  localStorage.clear();
  const msgs = [
    { role: "user", content: "Quiero viajar a Japón", ts: 1, messageId: "a" },
    { role: "assistant", content: "¡Qué bien! El trabajo puede esperar", ts: 2, messageId: "a" },
    { role: "user", content: "hola", ts: 3, messageId: "b" },
  ];
  assert.equal(backfillAstroActivations(msgs), 1);
  assert.equal(localStorage.getItem(BACKFILL_KEY), "1");
  assert.equal(backfillAstroActivations(msgs), 0);
  assert.equal(JSON.parse(localStorage.getItem(ACTIVATIONS_KEY)).length, 1);
});

test("el bloque del prompt solo se envía si está activado y el mensaje toca la carta", () => {
  localStorage.clear();
  assert.equal(buildAstroPromptBlock("me fue mal en el trabajo", chart), "");
  setAstroInPromptEnabled(true);
  assert.equal(buildAstroPromptBlock("hola", chart), "");
  const block = buildAstroPromptBlock("me fue mal en el trabajo", chart);
  assert.match(block, /CARTA NATAL/);
  assert.match(block, /Casa 10 \(carrera y propósito; con Luna, Saturno; regente Neptuno\)/);
  assert.ok(block.length < 900, `bloque demasiado largo: ${block.length}`);
  assert.ok(chartSummaryForPrompt(chart).includes("Sol Acu 12° C9"));
});

test("rueda: el Ascendente queda a la izquierda y los planetas juntos se separan", () => {
  const svg = renderNatalWheel(chart);
  const ac = svg.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>AC<\/text>/);
  assert.ok(ac, "debe dibujar AC");
  assert.ok(Number(ac[1]) < 40, `AC debería estar a la izquierda (x=${ac[1]})`);
  assert.ok(Math.abs(Number(ac[2]) - 260) < 1, "AC a la altura del centro");

  const spread = spreadLongitudes([{ lon: 10 }, { lon: 11 }, { lon: 12 }], 8);
  assert.ok(spread[1] - spread[0] >= 7.9 && spread[2] - spread[1] >= 7.9);
});
