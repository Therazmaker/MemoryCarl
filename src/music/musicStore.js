/**
 * IndexedDB storage for MemoryCarl Music Player.
 * Stores audio file Blobs, Track Metadata, Playlists, Favorites, and Play History.
 */

const DB_NAME = "memorycarl_music_db";
const DB_VERSION = 1;

let dbPromise = null;

function openMusicDB() {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = req.result;

      // Track files & metadata
      if (!db.objectStoreNames.contains("tracks")) {
        const trackStore = db.createObjectStore("tracks", { keyPath: "id" });
        trackStore.createIndex("title", "title", { unique: false });
        trackStore.createIndex("artist", "artist", { unique: false });
        trackStore.createIndex("album", "album", { unique: false });
        trackStore.createIndex("addedAt", "addedAt", { unique: false });
      }

      // Playlists
      if (!db.objectStoreNames.contains("playlists")) {
        const playlistStore = db.createObjectStore("playlists", { keyPath: "id" });
        playlistStore.createIndex("name", "name", { unique: false });
      }

      // Favorites
      if (!db.objectStoreNames.contains("favorites")) {
        db.createObjectStore("favorites", { keyPath: "trackId" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open Music IndexedDB"));
  });

  return dbPromise;
}

export async function saveTrack(trackData) {
  const db = await openMusicDB();
  if (!db) return trackData.id;

  return new Promise((resolve, reject) => {
    const tx = db.transaction("tracks", "readwrite");
    const store = tx.objectStore("tracks");
    const req = store.put(trackData);
    req.onsuccess = () => resolve(trackData.id);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTracksBatch(tracksArray) {
  const db = await openMusicDB();
  if (!db) return tracksArray.length;

  return new Promise((resolve, reject) => {
    const tx = db.transaction("tracks", "readwrite");
    const store = tx.objectStore("tracks");
    for (const track of tracksArray) {
      store.put(track);
    }
    tx.oncomplete = () => resolve(tracksArray.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllTracks() {
  const db = await openMusicDB();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction("tracks", "readonly");
    const store = tx.objectStore("tracks");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getTrackById(id) {
  const db = await openMusicDB();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const tx = db.transaction("tracks", "readonly");
    const store = tx.objectStore("tracks");
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTrack(id) {
  const db = await openMusicDB();
  if (!db) return true;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(["tracks", "favorites"], "readwrite");
    tx.objectStore("tracks").delete(id);
    tx.objectStore("favorites").delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllTracks() {
  const db = await openMusicDB();
  if (!db) return true;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(["tracks", "playlists", "favorites"], "readwrite");
    tx.objectStore("tracks").clear();
    tx.objectStore("playlists").clear();
    tx.objectStore("favorites").clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ================= FAVORITES =================

export async function toggleFavorite(trackId) {
  const db = await openMusicDB();
  const isFav = await isFavorite(trackId);
  if (!db) return !isFav;

  return new Promise((resolve, reject) => {
    const tx = db.transaction("favorites", "readwrite");
    const store = tx.objectStore("favorites");
    if (isFav) {
      store.delete(trackId);
    } else {
      store.put({ trackId, addedAt: new Date().toISOString() });
    }
    tx.oncomplete = () => resolve(!isFav);
    tx.onerror = () => reject(tx.error);
  });
}

export async function isFavorite(trackId) {
  const db = await openMusicDB();
  if (!db) return false;

  return new Promise((resolve, reject) => {
    const tx = db.transaction("favorites", "readonly");
    const store = tx.objectStore("favorites");
    const req = store.get(trackId);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getFavoriteTrackIds() {
  const db = await openMusicDB();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction("favorites", "readonly");
    const store = tx.objectStore("favorites");
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []).map(r => r.trackId));
    req.onerror = () => reject(req.error);
  });
}

// ================= PLAYLISTS =================

export async function savePlaylist(playlist) {
  const db = await openMusicDB();
  if (!db) return playlist.id;

  return new Promise((resolve, reject) => {
    const tx = db.transaction("playlists", "readwrite");
    const store = tx.objectStore("playlists");
    const req = store.put(playlist);
    req.onsuccess = () => resolve(playlist.id);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllPlaylists() {
  const db = await openMusicDB();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction("playlists", "readonly");
    const store = tx.objectStore("playlists");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deletePlaylist(id) {
  const db = await openMusicDB();
  if (!db) return true;

  return new Promise((resolve, reject) => {
    const tx = db.transaction("playlists", "readwrite");
    const store = tx.objectStore("playlists");
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(tx.error);
  });
}
