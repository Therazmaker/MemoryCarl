import assert from "assert";
import { parseAudioMetadata } from "../src/music/id3Parser.js";
import { musicEngine } from "../src/music/musicEngine.js";

async function runMusicTests() {
  console.log("Running Music Player Unit Tests...");

  // 1. Test ID3 Fallback parsing
  const mockFile = {
    name: "MySong.mp3",
    type: "audio/mpeg",
    slice: () => ({
      arrayBuffer: async () => new ArrayBuffer(100)
    })
  };

  const meta = await parseAudioMetadata(mockFile);
  assert.strictEqual(meta.title, "MySong");
  assert.strictEqual(meta.artist, "Artista desconocido");
  console.log("✓ ID3 Fallback Parsing passed");

  // 2. Test Music Engine queue and state management
  const track1 = { id: "t1", title: "Song 1", artist: "Artist 1", url: "song1.mp3" };
  const track2 = { id: "t2", title: "Song 2", artist: "Artist 2", url: "song2.mp3" };
  const track3 = { id: "t3", title: "Song 3", artist: "Artist 3", url: "song3.mp3" };

  await musicEngine.setQueue([track1, track2, track3], 0, false);
  const state = musicEngine.getState();

  assert.strictEqual(state.queue.length, 3);
  assert.strictEqual(state.currentTrack.id, "t1");
  assert.strictEqual(state.queueIndex, 0);
  console.log("✓ Music Engine Queue initialization passed");

  // 3. Test Navigation (Next / Prev)
  await musicEngine.next();
  const state2 = musicEngine.getState();
  assert.strictEqual(state2.currentTrack.id, "t2");
  assert.strictEqual(state2.queueIndex, 1);
  console.log("✓ Music Engine Next navigation passed");

  await musicEngine.prev();
  const state3 = musicEngine.getState();
  assert.strictEqual(state3.currentTrack.id, "t1");
  assert.strictEqual(state3.queueIndex, 0);
  console.log("✓ Music Engine Prev navigation passed");

  // 4. Test Repeat Mode Toggle
  assert.strictEqual(musicEngine.repeatMode, "none");
  musicEngine.toggleRepeat();
  assert.strictEqual(musicEngine.repeatMode, "all");
  musicEngine.toggleRepeat();
  assert.strictEqual(musicEngine.repeatMode, "one");
  musicEngine.toggleRepeat();
  assert.strictEqual(musicEngine.repeatMode, "none");
  console.log("✓ Music Engine Repeat mode toggle passed");

  // 5. Test Shuffle Toggle
  assert.strictEqual(musicEngine.isShuffle, false);
  musicEngine.toggleShuffle();
  assert.strictEqual(musicEngine.isShuffle, true);
  musicEngine.toggleShuffle();
  assert.strictEqual(musicEngine.isShuffle, false);
  console.log("✓ Music Engine Shuffle toggle passed");

  console.log("ALL MUSIC TESTS PASSED! 🎉");
}

runMusicTests().catch(err => {
  console.error("Music Tests Failed:", err);
  process.exit(1);
});
