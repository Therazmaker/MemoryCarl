import assert from "node:assert";

// Unit test to verify that numeric values in swiss or liteTransits objects
// (e.g. transit_moon_house: 3) do not cause a TypeError when calling .trim().

function getFormattedMoonHouse(swiss, liteTransits) {
  return String(swiss?.transit_moon_house ?? liteTransits?.transit_moon_house ?? "").trim();
}

function getFormattedPhase(swiss, liteMoon) {
  return String(swiss?.moon_phase_name ?? liteMoon?.moon_phase_name ?? "").trim();
}

function getFormattedMoonSign(swiss, liteMoon) {
  return String(swiss?.moon_sign ?? liteMoon?.moon_sign ?? "").trim();
}

function getFormattedWhisper(swiss) {
  return String(swiss?.transit_money_whisper ?? "").trim();
}

// Test case 1: Numeric transit_moon_house
{
  const swiss = { transit_moon_house: 3 };
  const house = getFormattedMoonHouse(swiss, null);
  assert.strictEqual(house, "3", "Numeric transit_moon_house should be safely formatted to string '3'");
}

// Test case 2: Numeric transit_moon_house in liteTransits
{
  const swiss = {};
  const liteTransits = { transit_moon_house: 7 };
  const house = getFormattedMoonHouse(swiss, liteTransits);
  assert.strictEqual(house, "7", "Numeric liteTransits.transit_moon_house should be safely formatted to string '7'");
}

// Test case 3: String transit_moon_house with spaces
{
  const swiss = { transit_moon_house: " 10 " };
  const house = getFormattedMoonHouse(swiss, null);
  assert.strictEqual(house, "10", "String transit_moon_house should be trimmed");
}

// Test case 4: Null or undefined
{
  const house = getFormattedMoonHouse(null, null);
  assert.strictEqual(house, "", "Null/undefined objects should yield empty string");
}

// Test case 5: Numeric moon_phase_name or moon_sign or whisper
{
  const swiss = { moon_phase_name: 1, moon_sign: 12, transit_money_whisper: 0 };
  assert.strictEqual(getFormattedPhase(swiss, null), "1");
  assert.strictEqual(getFormattedMoonSign(swiss, null), "12");
  assert.strictEqual(getFormattedWhisper(swiss), "0");
}

console.log("✅ test/transit_moon_house.test.js passed!");
