/**
 * Core Music Playback Engine for MemoryCarl.
 * Manages audio element, MediaSession integration for background / lockscreen playback,
 * queue management, shuffle, repeat, and AI playlist builder integration.
 */

import { getAllTracks, toggleFavorite, isFavorite, savePlaylist } from "./musicStore.js";

class MusicEngine {
  constructor() {
    if (typeof window !== "undefined" && typeof Audio !== "undefined") {
      this.audio = new Audio();
      this.audio.preload = "auto";
    } else {
      this.audio = {
        addEventListener: () => {},
        play: async () => {},
        pause: () => {},
        currentTime: 0,
        duration: 0,
        volume: 1
      };
    }

    this.queue = [];
    this.originalQueue = [];
    this.queueIndex = -1;

    this.currentTrack = null;
    this.currentObjectUrl = null;

    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 0;
    this.volume = 1.0;

    this.repeatMode = "none"; // "none" | "one" | "all"
    this.isShuffle = false;
    this.isFav = false;

    this.subscribers = new Set();

    this.initAudioEvents();
    this.initMediaSession();
  }

  initAudioEvents() {
    if (!this.audio || !this.audio.addEventListener) return;

    this.audio.addEventListener("timeupdate", () => {
      this.currentTime = this.audio.currentTime || 0;
      this.duration = this.audio.duration || 0;
      this.updateMediaPositionState();
      this.notifySubscribers();
    });

    this.audio.addEventListener("loadedmetadata", () => {
      this.duration = this.audio.duration || 0;
      this.updateMediaPositionState();
      this.notifySubscribers();
    });

    this.audio.addEventListener("ended", () => {
      this.handleTrackEnded();
    });

    this.audio.addEventListener("play", () => {
      this.isPlaying = true;
      if (typeof navigator !== "undefined" && navigator.mediaSession) {
        navigator.mediaSession.playbackState = "playing";
      }
      this.notifySubscribers();
    });

    this.audio.addEventListener("pause", () => {
      this.isPlaying = false;
      if (typeof navigator !== "undefined" && navigator.mediaSession) {
        navigator.mediaSession.playbackState = "paused";
      }
      this.notifySubscribers();
    });

    this.audio.addEventListener("error", (e) => {
      console.error("Audio element error:", e);
      this.isPlaying = false;
      this.notifySubscribers();
    });
  }

  initMediaSession() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

    try {
      navigator.mediaSession.setActionHandler("play", () => this.play());
      navigator.mediaSession.setActionHandler("pause", () => this.pause());
      navigator.mediaSession.setActionHandler("previoustrack", () => this.prev());
      navigator.mediaSession.setActionHandler("nexttrack", () => this.next());
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (typeof details.seekTime === "number") {
          this.seek(details.seekTime);
        }
      });
      navigator.mediaSession.setActionHandler("seekbackward", (details) => {
        const skip = details.seekOffset || 10;
        this.seek(Math.max(0, this.currentTime - skip));
      });
      navigator.mediaSession.setActionHandler("seekforward", (details) => {
        const skip = details.seekOffset || 10;
        this.seek(Math.min(this.duration, this.currentTime + skip));
      });
    } catch (e) {
      console.warn("MediaSession action handler setup error:", e);
    }
  }

  updateMediaSessionMetadata() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !this.currentTrack) return;

    try {
      const artwork = [];
      if (this.currentTrack.coverBlobUrl) {
        artwork.push({
          src: this.currentTrack.coverBlobUrl,
          sizes: "512x512",
          type: "image/png"
        });
      } else {
        // Fallback default artwork SVG as Data URI
        artwork.push({
          src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512' viewBox='0 0 512 512'><rect width='512' height='512' fill='%23121212'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='180' fill='%231db954'>🎵</text></svg>",
          sizes: "512x512",
          type: "image/svg+xml"
        });
      }

      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.currentTrack.title || "Canción",
        artist: this.currentTrack.artist || "Artista desconocido",
        album: this.currentTrack.album || "MemoryCarl Player",
        artwork
      });
    } catch (e) {
      console.warn("MediaSession metadata update error:", e);
    }
  }

  updateMediaPositionState() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !("setPositionState" in navigator.mediaSession)) return;
    try {
      if (this.duration && isFinite(this.duration) && this.duration > 0) {
        navigator.mediaSession.setPositionState({
          duration: this.duration,
          playbackRate: this.audio.playbackRate || 1.0,
          position: Math.min(this.currentTime, this.duration)
        });
      }
    } catch (e) {}
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notifySubscribers() {
    const state = this.getState();
    for (const callback of this.subscribers) {
      try { callback(state); } catch (e) { console.error("Subscriber callback error:", e); }
    }
  }

  getState() {
    return {
      currentTrack: this.currentTrack,
      isPlaying: this.isPlaying,
      currentTime: this.currentTime,
      duration: this.duration,
      volume: this.volume,
      repeatMode: this.repeatMode,
      isShuffle: this.isShuffle,
      isFav: this.isFav,
      queue: this.queue,
      queueIndex: this.queueIndex,
      totalQueue: this.queue.length
    };
  }

  async setQueue(tracksList, startIndex = 0, startPlaying = true) {
    if (!Array.isArray(tracksList) || tracksList.length === 0) return;

    this.originalQueue = [...tracksList];

    if (this.isShuffle) {
      this.queue = this.shuffleArray([...tracksList]);
      this.queueIndex = 0;
    } else {
      this.queue = [...tracksList];
      this.queueIndex = Math.max(0, Math.min(tracksList.length - 1, startIndex));
    }

    await this.loadTrackAtIndex(this.queueIndex, startPlaying);
  }

  async loadTrackAtIndex(index, startPlaying = true) {
    if (index < 0 || index >= this.queue.length) return;

    this.queueIndex = index;
    const track = this.queue[index];
    this.currentTrack = track;

    // Release old object URL if created dynamically
    if (this.currentObjectUrl && typeof URL !== "undefined" && URL.revokeObjectURL) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }

    if (track.fileBlob && typeof URL !== "undefined" && URL.createObjectURL) {
      this.currentObjectUrl = URL.createObjectURL(track.fileBlob);
      this.audio.src = this.currentObjectUrl;
    } else if (track.url) {
      this.audio.src = track.url;
    }

    this.isFav = await isFavorite(track.id);
    this.updateMediaSessionMetadata();

    if (startPlaying && this.audio.play) {
      try {
        await this.audio.play();
        this.isPlaying = true;
      } catch (err) {
        console.warn("Autoplay blocked or playback error:", err);
        this.isPlaying = false;
      }
    } else if (this.audio.pause) {
      this.audio.pause();
      this.isPlaying = false;
    }

    this.notifySubscribers();
  }

  async play() {
    if (!this.currentTrack && this.queue.length > 0) {
      await this.loadTrackAtIndex(0, true);
      return;
    }
    if (this.audio && this.audio.play) {
      try {
        await this.audio.play();
        this.isPlaying = true;
      } catch (e) {
        console.warn("Play error:", e);
      }
    }
  }

  pause() {
    if (this.audio && this.audio.pause) {
      this.audio.pause();
    }
    this.isPlaying = false;
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  async next() {
    if (this.queue.length === 0) return;

    if (this.repeatMode === "one" && this.currentTrack) {
      this.seek(0);
      this.play();
      return;
    }

    let nextIndex = this.queueIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.repeatMode === "all") {
        nextIndex = 0;
      } else {
        // Reached end of queue
        this.pause();
        this.seek(0);
        return;
      }
    }

    await this.loadTrackAtIndex(nextIndex, true);
  }

  async prev() {
    if (this.queue.length === 0) return;

    // If played more than 3 seconds, restart current track
    if (this.currentTime > 3) {
      this.seek(0);
      return;
    }

    let prevIndex = this.queueIndex - 1;
    if (prevIndex < 0) {
      if (this.repeatMode === "all") {
        prevIndex = this.queue.length - 1;
      } else {
        prevIndex = 0;
      }
    }

    await this.loadTrackAtIndex(prevIndex, true);
  }

  seek(seconds) {
    if (this.audio && isFinite(seconds)) {
      this.audio.currentTime = Math.max(0, Math.min(this.duration || 0, seconds));
      this.currentTime = this.audio.currentTime;
      this.updateMediaPositionState();
      this.notifySubscribers();
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.audio) this.audio.volume = this.volume;
    this.notifySubscribers();
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;

    if (this.isShuffle && this.queue.length > 0) {
      const current = this.currentTrack;
      const remaining = this.originalQueue.filter(t => t.id !== current?.id);
      const shuffled = this.shuffleArray(remaining);
      if (current) shuffled.unshift(current);
      this.queue = shuffled;
      this.queueIndex = 0;
    } else if (!this.isShuffle && this.originalQueue.length > 0) {
      const current = this.currentTrack;
      this.queue = [...this.originalQueue];
      if (current) {
        this.queueIndex = Math.max(0, this.queue.findIndex(t => t.id === current.id));
      }
    }

    this.notifySubscribers();
  }

  toggleRepeat() {
    if (this.repeatMode === "none") this.repeatMode = "all";
    else if (this.repeatMode === "all") this.repeatMode = "one";
    else this.repeatMode = "none";

    this.notifySubscribers();
  }

  async toggleCurrentFav() {
    if (!this.currentTrack) return;
    const newFavState = await toggleFavorite(this.currentTrack.id);
    this.isFav = newFavState;
    this.notifySubscribers();
    return newFavState;
  }

  async handleTrackEnded() {
    if (this.repeatMode === "one") {
      this.seek(0);
      this.play();
    } else {
      await this.next();
    }
  }

  shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ================= AI PLAYLIST BUILDER =================
  async generateAiPlaylist(promptText, apiKey, provider = "gemini") {
    const allTracks = await getAllTracks();
    if (allTracks.length === 0) {
      throw new Error("No hay canciones en la biblioteca para crear una playlist.");
    }

    const catalogSummary = allTracks.map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      genre: t.genre || ""
    }));

    const systemPrompt = `Eres un DJ inteligente para la app MemoryCarl.
Dada la siguiente lista de canciones disponibles en la biblioteca local del usuario, selecciona las mejores canciones que se adapten a la siguiente solicitud o mood del usuario: "${promptText}".

Catálogo disponible (JSON):
${JSON.stringify(catalogSummary)}

Responde ÚNICAMENTE en formato JSON estricto con la siguiente estructura:
{
  "name": "Nombre creativo de la Playlist",
  "description": "Una breve descripción de la vibra de la playlist",
  "trackIds": ["id1", "id2", ...]
}`;

    let jsonResponse = null;

    if (provider === "gemini" && apiKey) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      if (!res.ok) throw new Error(`Gemini API Error: ${res.statusText}`);
      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      jsonResponse = JSON.parse(rawText);
    } else {
      // Deterministic fallback matching keywords
      const lower = promptText.toLowerCase();
      const matched = allTracks.filter(t => {
        const full = `${t.title} ${t.artist} ${t.genre}`.toLowerCase();
        return lower.split(" ").some(word => word.length > 2 && full.includes(word));
      });

      const selected = matched.length >= 3 ? matched : allTracks.slice(0, Math.min(10, allTracks.length));
      jsonResponse = {
        name: `Mix: ${promptText.slice(0, 20)}`,
        description: `Playlist generada para "${promptText}"`,
        trackIds: selected.map(t => t.id)
      };
    }

    if (jsonResponse && Array.isArray(jsonResponse.trackIds) && jsonResponse.trackIds.length > 0) {
      const playlist = {
        id: `pl_${Date.now()}`,
        name: jsonResponse.name || `Mix ${new Date().toLocaleDateString("es-PE")}`,
        description: jsonResponse.description || "Playlist AI",
        trackIds: jsonResponse.trackIds,
        createdAt: new Date().toISOString()
      };
      await savePlaylist(playlist);
      return playlist;
    }

    throw new Error("No se pudo generar la playlist con las canciones actuales.");
  }
}

export const musicEngine = new MusicEngine();
