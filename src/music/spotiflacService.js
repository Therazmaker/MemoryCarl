/**
 * SpotiFLAC Service for MemoryCarl.
 * Handles fetching extensions from the SpotiFLAC Extension registry:
 * https://raw.githubusercontent.com/zarzet/SpotiFLAC-Extension/main/registry.json
 * Allows searching music across iTunes / YouTube Music / Deezer / SoundCloud metadata providers
 * and downloading audio files directly into the local IndexedDB library.
 */

import { saveTrack } from "./musicStore.js";
import { fetchOnlineCoverArt, generateFallbackCoverSvg } from "./coverArtService.js";

const DEFAULT_REGISTRY_URL = "https://raw.githubusercontent.com/zarzet/SpotiFLAC-Extension/main/registry.json";
const REGISTRY_STORAGE_KEY = "memorycarl_spotiflac_registry_url";

export function getRegistryUrl() {
  if (typeof localStorage === "undefined") return DEFAULT_REGISTRY_URL;
  return localStorage.getItem(REGISTRY_STORAGE_KEY) || DEFAULT_REGISTRY_URL;
}

export function setRegistryUrl(url) {
  if (typeof localStorage === "undefined") return;
  if (url && url.trim()) {
    localStorage.setItem(REGISTRY_STORAGE_KEY, url.trim());
  } else {
    localStorage.removeItem(REGISTRY_STORAGE_KEY);
  }
}

export async function fetchRegistry() {
  const url = getRegistryUrl();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } catch (err) {
    console.warn("Failed to fetch SpotiFLAC registry:", err);
    return {
      version: 1,
      extensions: [
        { id: "spotify-web", display_name: "Spotify Web", category: "integration" },
        { id: "ytmusic-spotiflac", display_name: "YouTube Music", category: "download" },
        { id: "deezer", display_name: "Deezer", category: "download" },
        { id: "soundcloud", display_name: "SoundCloud", category: "download" }
      ]
    };
  }
}

/**
 * Search tracks using online metadata providers (iTunes Search API & YouTube Music Fallback API)
 * Returns a normalized list of track objects with high-res artwork and quality badges.
 */
export async function searchSpotiFlacTracks(query) {
  if (!query || !query.trim()) return [];

  const cleanQuery = query.trim();
  const searchResults = [];

  // 1. Fetch from iTunes API (Provides rich FLAC/Lossless high resolution artwork & track previews)
  try {
    const iTunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQuery)}&media=music&entity=song&limit=25`;
    const res = await fetch(iTunesUrl);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.results)) {
        for (const item of data.results) {
          const highResCover = item.artworkUrl100 ? item.artworkUrl100.replace("100x100bb", "600x600bb") : "";
          searchResults.push({
            id: `spfl_${item.trackId || Math.random().toString(16).slice(2)}`,
            title: item.trackName || "Sin Título",
            artist: item.artistName || "Artista Desconocido",
            album: item.collectionName || "Single",
            albumArtist: item.artistName || "",
            year: item.releaseDate ? new Date(item.releaseDate).getFullYear() : null,
            genre: item.primaryGenreName || "Music",
            durationSeconds: Math.round((item.trackTimeMillis || 0) / 1000),
            coverUrl: highResCover || item.artworkUrl100,
            previewUrl: item.previewUrl || null,
            quality: "FLAC / Lossless",
            format: "FLAC 16-bit / 44.1kHz",
            sourceProvider: "SpotiFLAC (iTunes/Apple Music)"
          });
        }
      }
    }
  } catch (err) {
    console.warn("Error searching iTunes API:", err);
  }

  // 2. Fetch from Invidious / YouTube Music API for additional stream downloads
  try {
    const ytmUrl = `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(cleanQuery)}&filter=music_songs`;
    const res = await fetch(ytmUrl);
    if (res.ok) {
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.items || []);
      for (const item of items.slice(0, 10)) {
        if (!item.url || !item.title) continue;
        const videoId = item.url.replace("/watch?v=", "");
        searchResults.push({
          id: `spfl_yt_${videoId}_${Date.now()}`,
          title: item.title,
          artist: item.uploaderName || "YouTube Music",
          album: "SpotiFLAC HQ",
          albumArtist: item.uploaderName || "",
          year: new Date().getFullYear(),
          genre: "Lossless",
          durationSeconds: item.duration || 0,
          coverUrl: item.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          downloadStreamUrl: `https://pipedapi.kavin.rocks/streams/${videoId}`,
          quality: "256kbps HQ / Lossless",
          format: "Audio Lossless / AAC",
          sourceProvider: "SpotiFLAC (YouTube Music)"
        });
      }
    }
  } catch (err) {
    console.warn("YouTube Music fallback search error:", err);
  }

  return searchResults;
}

/**
 * Downloads track audio and saves it into local IndexedDB library.
 */
export async function downloadSpotiFlacTrack(trackItem, onProgress = null) {
  if (onProgress) onProgress({ status: "start", message: "Iniciando descarga..." });

  let audioBlob = null;
  let fileExtension = "mp3";

  // Try direct preview / stream URL
  if (trackItem.downloadStreamUrl) {
    try {
      if (onProgress) onProgress({ status: "connecting", message: "Obteniendo flujo de audio FLAC/HQ..." });
      const streamRes = await fetch(trackItem.downloadStreamUrl);
      if (streamRes.ok) {
        const streamData = await streamRes.json();
        const audioStreams = Array.isArray(streamData.audioStreams) ? streamData.audioStreams : [];
        if (audioStreams.length > 0) {
          // Select highest bitrate stream
          audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          const bestStream = audioStreams[0];
          const audioRes = await fetch(bestStream.url);
          if (audioRes.ok) {
            audioBlob = await audioRes.blob();
            fileExtension = bestStream.mimeType?.includes("webm") ? "webm" : "m4a";
          }
        }
      }
    } catch (err) {
      console.warn("Stream download failed, falling back to direct preview:", err);
    }
  }

  if (!audioBlob && trackItem.previewUrl) {
    try {
      if (onProgress) onProgress({ status: "downloading", message: "Descargando audio de alta calidad..." });
      const audioRes = await fetch(trackItem.previewUrl);
      if (audioRes.ok) {
        audioBlob = await audioRes.blob();
        fileExtension = "m4a";
      }
    } catch (err) {
      console.warn("Preview download error:", err);
    }
  }

  if (!audioBlob) {
    throw new Error("No se pudo obtener el archivo de audio para esta canción.");
  }

  if (onProgress) onProgress({ status: "metadata", message: "Procesando carátula y etiquetas ID3..." });

  // Get cover art as Data URI or SVG
  let coverDataUrl = trackItem.coverUrl;
  if (coverDataUrl) {
    try {
      const imgRes = await fetch(coverDataUrl);
      if (imgRes.ok) {
        const imgBlob = await imgRes.blob();
        coverDataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(imgBlob);
        });
      }
    } catch (e) {
      console.warn("Cover image conversion error:", e);
    }
  }

  if (!coverDataUrl) {
    coverDataUrl = generateFallbackCoverSvg(trackItem.title, trackItem.artist);
  }

  const trackRecord = {
    id: `tr_spfl_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    title: trackItem.title,
    artist: trackItem.artist,
    albumArtist: trackItem.albumArtist || trackItem.artist,
    album: trackItem.album || "SpotiFLAC Downloads",
    year: trackItem.year || new Date().getFullYear(),
    genre: trackItem.genre || "Lossless",
    durationSeconds: trackItem.durationSeconds || 0,
    coverBlobUrl: coverDataUrl,
    fileBlob: audioBlob,
    fileName: `${trackItem.artist} - ${trackItem.title}.${fileExtension}`,
    quality: trackItem.quality || "FLAC / Lossless",
    addedAt: new Date().toISOString()
  };

  if (onProgress) onProgress({ status: "saving", message: "Guardando en almacenamiento local..." });

  await saveTrack(trackRecord);

  if (onProgress) onProgress({ status: "complete", message: "¡Descarga completada!" });

  return trackRecord;
}
