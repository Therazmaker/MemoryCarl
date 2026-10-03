import test from "node:test";
import assert from "node:assert/strict";
import { getRegistryUrl, setRegistryUrl, searchSpotiFlacTracks } from "../src/music/spotiflacService.js";

test("SpotiFLAC Registry URL getting and setting", () => {
  const dummyStorage = new Map();
  global.localStorage = {
    getItem: (key) => dummyStorage.get(key) || null,
    setItem: (key, val) => dummyStorage.set(key, val),
    removeItem: (key) => dummyStorage.delete(key)
  };

  const defaultUrl = getRegistryUrl();
  assert.equal(defaultUrl, "https://raw.githubusercontent.com/zarzet/SpotiFLAC-Extension/main/registry.json");

  setRegistryUrl("https://custom-registry.json");
  assert.equal(getRegistryUrl(), "https://custom-registry.json");

  setRegistryUrl(null);
  assert.equal(getRegistryUrl(), "https://raw.githubusercontent.com/zarzet/SpotiFLAC-Extension/main/registry.json");

  delete global.localStorage;
});

test("SpotiFLAC search function returns array for valid queries", async () => {
  const results = await searchSpotiFlacTracks("Daft Punk");
  assert.ok(Array.isArray(results));
  if (results.length > 0) {
    const item = results[0];
    assert.ok(item.title);
    assert.ok(item.artist);
    assert.ok(item.quality);
  }
});
