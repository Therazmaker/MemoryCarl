/**
 * Spotify-style Music UI components for MemoryCarl.
 * Includes Mini-Player, Expanded Full Player, Library, Playlist Manager, and AI DJ.
 */

import { musicEngine } from "./musicEngine.js";
import {
  getAllTracks,
  saveTrack,
  saveTracksBatch,
  deleteTrack,
  clearAllTracks,
  getFavoriteTrackIds,
  getAllPlaylists,
  deletePlaylist
} from "./musicStore.js";
import { parseAudioMetadata } from "./id3Parser.js";
import { fetchOnlineCoverArt, generateFallbackCoverSvg } from "./coverArtService.js";

let isFullPlayerOpen = false;
let isMusicHubOpen = false;
let currentTab = "songs"; // "songs" | "playlists" | "ai" | "favorites"
let searchQuery = "";

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

// Ensure container for persistent mini player exists
export function initMusicUi() {
  let miniHost = document.getElementById("musicMiniPlayerHost");
  if (!miniHost) {
    miniHost = document.createElement("div");
    miniHost.id = "musicMiniPlayerHost";
    document.body.appendChild(miniHost);
  }

  musicEngine.subscribe(() => {
    renderMiniPlayer();
    if (isFullPlayerOpen) renderFullPlayer();
    if (isMusicHubOpen) updateMusicHubDynamicContent();
  });

  renderMiniPlayer();
}

// ================= MINI PLAYER =================
export function renderMiniPlayer() {
  const host = document.getElementById("musicMiniPlayerHost");
  if (!host) return;

  const state = musicEngine.getState();
  if (!state.currentTrack) {
    host.innerHTML = "";
    return;
  }

  const track = state.currentTrack;
  const cover = track.coverBlobUrl || "";
  const pct = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;

  host.innerHTML = `
    <div class="spotMiniPlayer" id="spotMiniBar">
      <div class="spotMiniProgress" style="width: ${pct}%;"></div>
      <div class="spotMiniContent">
        <div class="spotMiniCover">
          ${cover ? `<img src="${escapeHtml(cover)}" alt="Cover" />` : `🎵`}
        </div>
        <div class="spotMiniInfo">
          <div class="spotMiniTitle">${escapeHtml(track.title)}</div>
          <div class="spotMiniArtist">${escapeHtml(track.artist)}</div>
        </div>
        <div class="spotMiniBtns">
          <button class="spotIconBtn" id="btnMiniFav" aria-label="Favorito">
            ${state.isFav ? "❤️" : "🤍"}
          </button>
          <button class="spotPlayBtn" id="btnMiniPlay" aria-label="Play/Pause">
            ${state.isPlaying ? "⏸" : "▶"}
          </button>
          <button class="spotIconBtn" id="btnMiniNext" aria-label="Siguiente">
            ⏭
          </button>
        </div>
      </div>
    </div>
  `;

  host.querySelector("#spotMiniBar")?.addEventListener("click", (e) => {
    if (e.target.closest("#btnMiniPlay") || e.target.closest("#btnMiniNext") || e.target.closest("#btnMiniFav")) return;
    openFullPlayer();
  });

  host.querySelector("#btnMiniPlay")?.addEventListener("click", (e) => {
    e.stopPropagation();
    musicEngine.togglePlay();
  });

  host.querySelector("#btnMiniNext")?.addEventListener("click", (e) => {
    e.stopPropagation();
    musicEngine.next();
  });

  host.querySelector("#btnMiniFav")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await musicEngine.toggleCurrentFav();
  });
}

// ================= FULL EXPANDED PLAYER =================
export function openFullPlayer() {
  isFullPlayerOpen = true;
  let modal = document.getElementById("spotFullPlayerModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "spotFullPlayerModal";
    modal.className = "spotFullModal";
    document.body.appendChild(modal);
  }

  renderFullPlayer();
}

export function closeFullPlayer() {
  isFullPlayerOpen = false;
  const modal = document.getElementById("spotFullPlayerModal");
  if (modal) modal.remove();
}

function renderFullPlayer() {
  const modal = document.getElementById("spotFullPlayerModal");
  if (!modal) return;

  const state = musicEngine.getState();
  if (!state.currentTrack) {
    closeFullPlayer();
    return;
  }

  const track = state.currentTrack;
  const cover = track.coverBlobUrl || "";

  modal.innerHTML = `
    <div class="spotFullContainer">
      <div class="spotFullHeader">
        <button class="spotIconBtnBig" id="btnFullClose">⌄</button>
        <div class="spotFullHeaderTitle">
          <span class="smallMuted">REPRODUCIENDO DESDE BIBLIOTECA</span>
          <span class="spotHeaderAlbum">${escapeHtml(track.album || "MemoryCarl")}</span>
        </div>
        <button class="spotIconBtnBig" id="btnFullHub">📜</button>
      </div>

      <div class="spotFullCoverWrapper">
        ${cover ? `<img src="${escapeHtml(cover)}" class="spotBigCover" alt="Cover" />` : `
          <div class="spotBigCoverPlaceholder">
            <span>🎵</span>
          </div>
        `}
      </div>

      <div class="spotFullMetaRow">
        <div class="spotMetaText">
          <div class="spotFullTitle">${escapeHtml(track.title)}</div>
          <div class="spotFullArtist">${escapeHtml(track.artist)}</div>
        </div>
        <button class="spotIconBtnBig" id="btnFullFav">
          ${state.isFav ? "❤️" : "🤍"}
        </button>
      </div>

      <div class="spotProgressBlock">
        <input type="range" class="spotSeekBar" id="spotSeekBar" min="0" max="${state.duration || 100}" value="${state.currentTime || 0}" step="0.1" />
        <div class="spotTimeLabels">
          <span>${formatTime(state.currentTime)}</span>
          <span>${formatTime(state.duration)}</span>
        </div>
      </div>

      <div class="spotFullControls">
        <button class="spotCtrlBtn ${state.isShuffle ? "active" : ""}" id="btnFullShuffle" title="Aleatorio">
          🔀
        </button>
        <button class="spotCtrlBtn" id="btnFullPrev" title="Anterior">
          ⏮
        </button>
        <button class="spotPlayMainBtn" id="btnFullPlay" title="Play/Pause">
          ${state.isPlaying ? "⏸" : "▶"}
        </button>
        <button class="spotCtrlBtn" id="btnFullNext" title="Siguiente">
          ⏭
        </button>
        <button class="spotCtrlBtn ${state.repeatMode !== "none" ? "active" : ""}" id="btnFullRepeat" title="Repetir">
          ${state.repeatMode === "one" ? "🔂" : "🔁"}
        </button>
      </div>
    </div>
  `;

  modal.querySelector("#btnFullClose")?.addEventListener("click", closeFullPlayer);
  modal.querySelector("#btnFullHub")?.addEventListener("click", () => {
    closeFullPlayer();
    openMusicHubModal();
  });

  modal.querySelector("#btnFullFav")?.addEventListener("click", async () => {
    await musicEngine.toggleCurrentFav();
  });

  modal.querySelector("#btnFullPlay")?.addEventListener("click", () => {
    musicEngine.togglePlay();
  });

  modal.querySelector("#btnFullPrev")?.addEventListener("click", () => {
    musicEngine.prev();
  });

  modal.querySelector("#btnFullNext")?.addEventListener("click", () => {
    musicEngine.next();
  });

  modal.querySelector("#btnFullShuffle")?.addEventListener("click", () => {
    musicEngine.toggleShuffle();
  });

  modal.querySelector("#btnFullRepeat")?.addEventListener("click", () => {
    musicEngine.toggleRepeat();
  });

  const seek = modal.querySelector("#spotSeekBar");
  if (seek) {
    seek.addEventListener("input", (e) => {
      musicEngine.seek(parseFloat(e.target.value));
    });
  }
}

// ================= MUSIC HUB / LIBRARY MODAL =================
export function openMusicHubModal() {
  isMusicHubOpen = true;
  let modal = document.getElementById("spotMusicHubModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "spotMusicHubModal";
    modal.className = "spotHubModalBackdrop";
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="spotHubModal">
      <div class="spotHubHeader">
        <div class="spotHubTitleBlock">
          <h2>🎧 Tu Música</h2>
          <span class="spotSub">Reproductor Local & DJ AI</span>
        </div>
        <button class="iconBtn" id="btnHubClose" style="font-size:20px;">✕</button>
      </div>

      <div class="spotHubTabs">
        <button class="spotTabBtn ${currentTab === "songs" ? "active" : ""}" data-tab="songs">🎶 Canciones</button>
        <button class="spotTabBtn ${currentTab === "playlists" ? "active" : ""}" data-tab="playlists">📁 Playlists</button>
        <button class="spotTabBtn ${currentTab === "ai" ? "active" : ""}" data-tab="ai">🤖 DJ AI</button>
        <button class="spotTabBtn ${currentTab === "favorites" ? "active" : ""}" data-tab="favorites">❤️ Favoritos</button>
      </div>

      <div id="spotHubBody" class="spotHubBody">
        <!-- Dynamic content -->
      </div>
    </div>
  `;

  modal.querySelector("#btnHubClose")?.addEventListener("click", closeMusicHub);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeMusicHub();
  });

  modal.querySelectorAll(".spotTabBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentTab = btn.dataset.tab;
      modal.querySelectorAll(".spotTabBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      updateMusicHubDynamicContent();
    });
  });

  updateMusicHubDynamicContent();
}

export function closeMusicHub() {
  isMusicHubOpen = false;
  const modal = document.getElementById("spotMusicHubModal");
  if (modal) modal.remove();
}

async function updateMusicHubDynamicContent() {
  const container = document.getElementById("spotHubBody");
  if (!container) return;

  if (currentTab === "songs") {
    const allTracks = await getAllTracks();
    const filtered = allTracks.filter(t => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        (t.title || "").toLowerCase().includes(q) ||
        (t.artist || "").toLowerCase().includes(q) ||
        (t.album || "").toLowerCase().includes(q)
      );
    });

    container.innerHTML = `
      <div class="spotHubSearchRow">
        <input type="text" id="spotSearchInput" class="spotSearchInput" placeholder="🔍 Buscar canción, artista..." value="${escapeHtml(searchQuery)}" />
        <label class="spotImportBtn" title="Importar archivos o carpeta">
          📂 Importar
          <input type="file" id="spotFileInput" accept="audio/*" multiple webkitdirectory style="display:none;" />
        </label>
        <label class="spotImportBtnSecondary" title="Importar archivos individuales">
          📄 Archivos
          <input type="file" id="spotSingleFileInput" accept="audio/*" multiple style="display:none;" />
        </label>
      </div>

      <div class="spotTrackList">
        ${filtered.length > 0 ? filtered.map((track, idx) => {
          const isPlayingThis = musicEngine.currentTrack?.id === track.id;
          return `
            <div class="spotTrackRow ${isPlayingThis ? "playing" : ""}" data-track-id="${track.id}">
              <div class="spotTrackCover">
                ${track.coverBlobUrl ? `<img src="${escapeHtml(track.coverBlobUrl)}" alt="" />` : `🎵`}
              </div>
              <div class="spotTrackInfo">
                <div class="spotTrackTitle">${escapeHtml(track.title)}</div>
                <div class="spotTrackSub">${escapeHtml(track.artist)} • ${escapeHtml(track.album || "Sin Álbum")}</div>
              </div>
              <div class="spotTrackActions">
                <button class="spotTrackBtn btnDeleteTrack" data-id="${track.id}" title="Eliminar">🗑️</button>
              </div>
            </div>
          `;
        }).join("") : `
          <div class="spotEmptyState">
            <div style="font-size:40px;">🎧</div>
            <div>No hay canciones guardadas.</div>
            <div class="smallMuted">Haz clic en <b>Importar</b> para añadir tus canciones MP3 desde tu almacenamiento interno.</div>
          </div>
        `}
      </div>

      ${allTracks.length > 0 ? `
        <div style="margin-top:12px; text-align:right;">
          <button class="btn ghost" id="btnClearLibrary" style="color:#ef4444; font-size:12px;">Limpiar biblioteca</button>
        </div>
      ` : ""}
    `;

    const searchInp = container.querySelector("#spotSearchInput");
    if (searchInp) {
      searchInp.addEventListener("input", (e) => {
        searchQuery = e.target.value;
        updateMusicHubDynamicContent();
      });
    }

    const handleFilesImport = async (e) => {
      const files = Array.from(e.target.files || []).filter(f => f.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(f.name));
      if (files.length === 0) return;

      container.innerHTML = `
        <div class="spotLoadingState">
          <div style="font-size:32px;">⏳</div>
          <div>Procesando ${files.length} archivo(s)...</div>
          <div class="smallMuted">Extrayendo metadatos y guardando en almacenamiento interno (IndexedDB)...</div>
        </div>
      `;

      const batch = [];
      for (const file of files) {
        const meta = await parseAudioMetadata(file);
        let cover = meta.coverBlobUrl;
        if (!cover) {
          cover = await fetchOnlineCoverArt(meta.title, meta.artist);
        }
        if (!cover) {
          cover = generateFallbackCoverSvg(meta.title, meta.artist);
        }
        batch.push({
          id: `tr_${Math.random().toString(16).slice(2)}_${Date.now()}`,
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          genre: meta.genre,
          coverBlobUrl: cover,
          fileBlob: file,
          fileName: file.name,
          addedAt: new Date().toISOString()
        });
      }

      await saveTracksBatch(batch);
      const updatedList = await getAllTracks();
      await musicEngine.setQueue(updatedList, 0, false);
      updateMusicHubDynamicContent();
    };

    container.querySelector("#spotFileInput")?.addEventListener("change", handleFilesImport);
    container.querySelector("#spotSingleFileInput")?.addEventListener("change", handleFilesImport);

    container.querySelectorAll(".spotTrackRow").forEach(row => {
      row.addEventListener("click", async (e) => {
        if (e.target.closest(".btnDeleteTrack")) return;
        const id = row.dataset.trackId;
        const idx = filtered.findIndex(t => t.id === id);
        if (idx !== -1) {
          await musicEngine.setQueue(filtered, idx, true);
          openFullPlayer();
        }
      });
    });

    container.querySelectorAll(".btnDeleteTrack").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        await deleteTrack(id);
        updateMusicHubDynamicContent();
      });
    });

    container.querySelector("#btnClearLibrary")?.addEventListener("click", async () => {
      if (confirm("¿Estás seguro de eliminar todas las canciones importadas?")) {
        await clearAllTracks();
        updateMusicHubDynamicContent();
      }
    });

  } else if (currentTab === "playlists") {
    const playlists = await getAllPlaylists();
    container.innerHTML = `
      <div class="spotPlaylistList">
        ${playlists.length > 0 ? playlists.map(pl => `
          <div class="spotPlaylistCard" data-pl-id="${pl.id}">
            <div class="spotPlInfo">
              <div class="spotPlName">${escapeHtml(pl.name)}</div>
              <div class="spotPlSub">${escapeHtml(pl.description || "")} • ${pl.trackIds.length} canciones</div>
            </div>
            <div class="spotPlActions">
              <button class="spotTrackBtn btnPlayPl" data-id="${pl.id}">▶</button>
              <button class="spotTrackBtn btnDeletePl" data-id="${pl.id}">🗑️</button>
            </div>
          </div>
        `).join("") : `
          <div class="spotEmptyState">
            <div style="font-size:40px;">📁</div>
            <div>No hay playlists creadas aún.</div>
            <div class="smallMuted">Usa la pestaña <b>DJ AI</b> para generar playlists inteligentes basadas en tus gustos o mood.</div>
          </div>
        `}
      </div>
    `;

    container.querySelectorAll(".btnPlayPl").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const pl = playlists.find(p => p.id === id);
        if (!pl) return;
        const allTracks = await getAllTracks();
        const plTracks = allTracks.filter(t => pl.trackIds.includes(t.id));
        if (plTracks.length > 0) {
          await musicEngine.setQueue(plTracks, 0, true);
          openFullPlayer();
        }
      });
    });

    container.querySelectorAll(".btnDeletePl").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        await deletePlaylist(id);
        updateMusicHubDynamicContent();
      });
    });

  } else if (currentTab === "ai") {
    container.innerHTML = `
      <div class="spotAiSection">
        <div class="spotAiHero">
          <div style="font-size:36px;">🤖</div>
          <div style="font-weight:800; font-size:16px;">DJ AI Assistant</div>
          <div class="smallMuted">Genera playlists automáticas ordenando tu música local según tu ánimo o actividad.</div>
        </div>

        <div class="spotAiForm">
          <label style="font-size:12px; font-weight:700; color:#b3b3b3;">¿Qué quieres escuchar hoy?</label>
          <input type="text" id="spotAiPromptInp" class="spotSearchInput" placeholder="Ej: Música relajante para estudiar, Rock para entrenar..." />
          <button class="btn primary" id="btnGenerateAiPl" style="width:100%; margin-top:8px;">✨ Crear Playlist con AI</button>
        </div>

        <div id="spotAiResultHost"></div>
      </div>
    `;

    container.querySelector("#btnGenerateAiPl")?.addEventListener("click", async () => {
      const inp = container.querySelector("#spotAiPromptInp");
      const resultHost = container.querySelector("#spotAiResultHost");
      const promptText = inp ? inp.value.trim() : "";
      if (!promptText) return;

      resultHost.innerHTML = `<div class="spotLoadingState">✨ Creando tu mix inteligente...</div>`;

      try {
        const apiKey = localStorage.getItem("memorycarl_v2_semana_gemini_api_key") || "";
        const playlist = await musicEngine.generateAiPlaylist(promptText, apiKey, apiKey ? "gemini" : "local");

        resultHost.innerHTML = `
          <div class="spotAiResultCard">
            <div style="font-size:18px; font-weight:800; color:#1db954;">✅ ¡Playlist lista!</div>
            <div style="font-size:14px; font-weight:700; margin-top:4px;">${escapeHtml(playlist.name)}</div>
            <div style="font-size:12px; color:#b3b3b3; margin-top:2px;">${escapeHtml(playlist.description)}</div>
            <button class="btn primary" id="btnPlayAiPl" style="margin-top:10px;">▶ Reproducir ahora</button>
          </div>
        `;

        resultHost.querySelector("#btnPlayAiPl")?.addEventListener("click", async () => {
          const allTracks = await getAllTracks();
          const plTracks = allTracks.filter(t => playlist.trackIds.includes(t.id));
          if (plTracks.length > 0) {
            await musicEngine.setQueue(plTracks, 0, true);
            openFullPlayer();
          }
        });

      } catch (err) {
        resultHost.innerHTML = `<div style="color:#ef4444; font-size:12px; margin-top:10px;">❌ Error: ${escapeHtml(err.message)}</div>`;
      }
    });

  } else if (currentTab === "favorites") {
    const favIds = await getFavoriteTrackIds();
    const allTracks = await getAllTracks();
    const favTracks = allTracks.filter(t => favIds.includes(t.id));

    container.innerHTML = `
      <div class="spotTrackList">
        ${favTracks.length > 0 ? favTracks.map((track, idx) => `
          <div class="spotTrackRow" data-track-id="${track.id}">
            <div class="spotTrackCover">
              ${track.coverBlobUrl ? `<img src="${escapeHtml(track.coverBlobUrl)}" alt="" />` : `🎵`}
            </div>
            <div class="spotTrackInfo">
              <div class="spotTrackTitle">${escapeHtml(track.title)}</div>
              <div class="spotTrackSub">${escapeHtml(track.artist)} • ${escapeHtml(track.album || "")}</div>
            </div>
          </div>
        `).join("") : `
          <div class="spotEmptyState">
            <div style="font-size:40px;">❤️</div>
            <div>Aún no tienes canciones favoritas.</div>
            <div class="smallMuted">Toca el corazón mientras escuchas una canción para guardarla aquí.</div>
          </div>
        `}
      </div>
    `;

    container.querySelectorAll(".spotTrackRow").forEach(row => {
      row.addEventListener("click", async () => {
        const id = row.dataset.trackId;
        const idx = favTracks.findIndex(t => t.id === id);
        if (idx !== -1) {
          await musicEngine.setQueue(favTracks, idx, true);
          openFullPlayer();
        }
      });
    });
  }
}
