import { initFootballLab } from "./footballLab_v8e.js?v=2001";
import { viewNeuroChat, wireNeuroChat } from "./chat/neurochat-ui.js";
import { viewDayCalendar, wireDayCalendar, viewDayDetail, wireDayDetail, dayUiState } from "./day/day-calendar-ui.js";
import { getAllDays as getDaysForEngine } from "./day/dayStore.js";
import { viewSemana, wireSemana, seedSemana } from "./semana/semana.js";
import { renderTarotWidget, viewTarot, wireTarot, injectTarotStyles } from "./tarot/tarot.js";
import { sendShoppingAiMessage, generateDaySummary, formatDayLabel, todayISO } from "./shopping/shoppingAi.js";

/* ===== PWA Rescue / Reset =====
   Si la app se queda pegada (cache/estado viejo), abre:
   https://therazmaker.github.io/MemoryCarl/?reset=1
   Esto limpia localStorage + caches + desregistra service workers y recarga.
*/
(function mcPwaRescueInit(){
  // Flag that the main UI has rendered at least once
  if(!window.__mcBoot) window.__mcBoot = { done:false, ts: Date.now() };

  function cssBtn(){
    return "border:0;border-radius:12px;padding:8px 12px;font-weight:800;cursor:pointer;";
  }

  function showRescueBanner(reason){
    try{
      if(document.getElementById('mcRescueBanner')) return;
      const d = document.createElement('div');
      d.id = 'mcRescueBanner';
      d.style.position = 'fixed';
      d.style.left = '12px';
      d.style.right = '12px';
      d.style.bottom = '12px';
      d.style.zIndex = 99999;
      d.style.padding = '10px 12px';
      d.style.borderRadius = '14px';
      d.style.background = 'rgba(20,20,28,0.92)';
      d.style.color = '#fff';
      d.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      d.style.fontSize = '13px';
      d.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
      d.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;">
          <div style="line-height:1.25;min-width:0">
            <div style="font-weight:900">MemoryCarl: modo rescate</div>
            <div style="opacity:.85;white-space:normal">Si se quedó en “cargando”, prueba limpiar caché primero. ${reason?`<span style="opacity:.7">(${reason})</span>`:''}</div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button id="mcRescueSoft" style="${cssBtn()}background:#2b73ff;color:#fff;">Reset caché</button>
            <button id="mcRescueHard" style="${cssBtn()}background:#fff;color:#111;">Reset total</button>
          </div>
        </div>`;
      document.body.appendChild(d);
      document.getElementById('mcRescueSoft').onclick = ()=> mcSoftResetCache();
      document.getElementById('mcRescueHard').onclick = ()=> mcHardResetAll();
    }catch(_e){}
  }

  async function mcSoftResetCache(){
    try{
      // unregister SWs (including firebase-messaging)
      if('serviceWorker' in navigator){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r=>r.unregister()));
      }
      // delete caches
      if('caches' in window){
        const keys = await caches.keys();
        await Promise.all(keys.map(k=>caches.delete(k)));
      }
    }catch(_e){}
    // reload without query
    try{
      const u = new URL(location.href);
      u.searchParams.delete('reset');
      u.searchParams.delete('safe');
      location.replace(u.toString());
    }catch(_e){ location.reload(); }
  }

  async function mcHardResetAll(){
    try{
      await mcSoftResetCache();
      try{ localStorage.clear(); }catch(_e){}
    }catch(_e){}
    try{
      const u = new URL(location.href);
      u.searchParams.delete('reset');
      u.searchParams.delete('safe');
      location.replace(u.toString());
    }catch(_e){ location.reload(); }
  }

  // URL reset: ?reset=1 => soft reset (preserve data)
  try{
    const u = new URL(location.href);
    if(u.searchParams.has('reset')){
      document.documentElement.style.opacity = '0.9';
      mcSoftResetCache();
      return;
    }
  }catch(_e){}

  // Global errors => offer rescue
  window.addEventListener('error', ()=> showRescueBanner('error JS'));
  window.addEventListener('unhandledrejection', ()=> showRescueBanner('promesa rechazada'));

  // If in 6s the app hasn't rendered, offer rescue anyway
  setTimeout(()=>{
    if(window.__mcBoot && window.__mcBoot.done) return;
    showRescueBanner('arranque no completado');
  }, 6000);
})()
;

window.__MC_VERSION__ = "invcal-v1-2026-02-24a";

import { computeMoonNow } from "./cosmic_lite.js";
import { getTransitLiteSignals } from "./transit_lite.js";
import { getTransitSwissSignals, swissTransitsAvailable, getSwissDailyCached, swissDailyAvailable } from "./transit_swiss.js";
import "./finance/neuron_financiera.js";
import "./sleep_radial_chart.js";
import "./sleep_journal_pro.js";

console.log("MemoryCarl loaded");
// ===== LocalStorage Keys =====
const KEYS = {
  neuroclawAiUrl: "memorycarl_v2_neuroclaw_ai_url",
  neuroclawAiKey: "memorycarl_v2_neuroclaw_ai_key",
  neuroclawAiLog: "memorycarl_v2_neuroclaw_ai_log",
  neuroclawAiUsage: "memorycarl_v2_neuroclaw_ai_usage",
  swissAstroUrl: "memorycarl_v2_swiss_astro_url",
  swissAstroKey: "memorycarl_v2_swiss_astro_key",
};

// ====================== NOTIFICATIONS (Firebase Cloud Messaging) ======================
// 1) Firebase Console -> Project settings -> Cloud Messaging -> Web Push certificates -> Generate key pair
// 2) Paste the VAPID public key below
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./firebase-messaging-sw.js?v=1003")
    .then(reg => {
      console.log("SW registered:", reg.scope);

      // Si hay una versión nueva esperando, la activa rápido
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });

      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            sw.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    })
    .catch(err => console.error("SW registration failed:", err));
}

const FCM_VAPID_KEY = "BFJYKOYqIzBN7eaGvOOhK6Iwfk7KqVt-6Bv27vnYqIpO2rlUBh-ZyL1_zDpZ-9s0272hiXic54w0Q5Rdgl1M84A";
const FIREBASE_CONFIG = {'apiKey': 'AIzaSyAq9RTNQDnfyxcxn4MbDn61lc7ybkUjtKg', 'authDomain': 'memorycarl-3c297.firebaseapp.com', 'projectId': 'memorycarl-3c297', 'storageBucket': 'memorycarl-3c297.firebasestorage.app', 'messagingSenderId': '731735548765', 'appId': '1:731735548765:web:03d9cf6d2a8c4744fd7eb4'};

// firebase-app-compat + firebase-messaging-compat are loaded via index.html <script> tags.
let messaging = null;

function initFirebaseMessaging(){
  try {
    if (!window.firebase) return;
    if (!firebase.apps || firebase.apps.length === 0) firebase.initializeApp(FIREBASE_CONFIG);
    messaging = firebase.messaging();
  } catch (e) {
    console.warn("Firebase init error:", e);
  }
}

async function enableNotifications(){
  try {
    initFirebaseMessaging();

    if (!messaging) {
      alert("Firebase Messaging not loaded. Check index.html scripts.");
      return;
    }
    if (!("serviceWorker" in navigator)) {
      alert("ServiceWorker not supported");
      return;
    }
    if (!("Notification" in window)) {
      alert("Notifications not supported");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      alert("Permission not granted");
      return;
    }

    // GitHub Pages: use relative path so it works under /MemoryCarl/
    const swReg = await navigator.serviceWorker.register("./firebase-messaging-sw.js");

    if (!FCM_VAPID_KEY || FCM_VAPID_KEY.includes("REPLACE_WITH_YOUR_VAPID_KEY")) {
      alert("Missing VAPID key. Paste it in src/main.js (FCM_VAPID_KEY).");
      return;
    }

    const token = await messaging.getToken({
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: swReg
    });

    localStorage.setItem("memorycarl_fcm_token", token);
    toast("Notifs enabled ✅");
    console.log("FCM token:", token);
  } catch (err) {
    console.error("Enable notifs error:", err);
    alert("Error enabling notifications. Check console.");
  }
}

function copyFcmToken(){
  const token = localStorage.getItem("memorycarl_fcm_token") || "";
  if (!token) {
    toast("No token yet");
    return;
  }
  navigator.clipboard?.writeText(token)
    .then(()=>toast("Token copied ✅"))
    .catch(()=>alert(token));
}
// ====================== END NOTIFICATIONS ======================

// ---- Storage keys ----
window.INS_HEAT_MODE = window.INS_HEAT_MODE || (localStorage.getItem("mc_ins_heat_mode") || "pulse");
const LS = {
  routines: "memorycarl_v2_routines",
  shopping: "memorycarl_v2_shopping",
  // Reminders: support legacy plural key too
  reminders: "memorycarl_v2_reminder",
  remindersLegacy: "memorycarl_v2_reminders",

  // Shopping system (library + history)
  products: "memorycarl_v2_products",
  shoppingHistory: "memorycarl_v2_shopping_history",
  shoppingAiChat: "memorycarl_v2_shopping_ai_chat",
  shoppingAiDays: "memorycarl_v2_shopping_ai_days",
  shoppingAiDayDate: "memorycarl_v2_shopping_ai_day_date",
  inventory: "memorycarl_v2_inventory",
  inventoryLots: "memorycarl_v2_inventory_lots",

  // Home widgets
  musicToday: "memorycarl_v2_music_today",
  musicLog: "memorycarl_v2_music_log",
  sleepLog: "memorycarl_v2_sleep_log",
  budgetMonthly: "memorycarl_v2_budget_monthly",
  calDraw: "memorycarl_v2_cal_draw",
  house: "memorycarl_v2_house",
  semana: "memorycarl_v2_semana",
  semanaGeminiApiKey: "memorycarl_v2_semana_gemini_api_key",
  moodDaily: "memorycarl_v2_mood_daily",
  moodSpritesCustom: "memorycarl_v2_mood_sprites_custom",
  moodActivityCats: "memorycarl_v2_mood_activity_cats",
  lifeTasks: "memorycarl_v2_life_tasks",
  lifeTasksLog: "memorycarl_v2_life_tasks_log",

  // NeuroClaw
  neuroclawFeedback: "memorycarl_v2_neuroclaw_feedback",
  neuroclawLast: "memorycarl_v2_neuroclaw_last",
  neuroclawAiUrl: "memorycarl_v2_neuroclaw_ai_url",
  neuroclawAiKey: "memorycarl_v2_neuroclaw_ai_key",

  // Tarot
  tarotGeminiKey: "memorycarl_v2_tarot_gemini_key",
  tarotGeminiModel: "memorycarl_v2_tarot_gemini_model",

  // Astrology (local-only)
  natalChart: "memorycarl_v2_natal_chart_json",
  astroProvider: "memorycarl_v2_astro_provider", // 'lite' | 'swiss'
  astroSwissLast: "memorycarl_v2_astro_swiss_last",
  astroSwissSeen: "memorycarl_v2_astro_swiss_seen", // per-day cache
  bubbleFreqMin: "memorycarl_v2_bubble_freq_min",
  lunarMoneyLog: "memorycarl_v2_lunar_money_log",
};
// ---- Sync (Google Apps Script via sendBeacon) ----
const SYNC = {
  urlKey: "memorycarl_script_url",
  apiKeyKey: "memorycarl_script_api_key",
  dirtyKey: "memorycarl_sync_dirty",
  lastSyncKey: "memorycarl_last_sync_at",
};

function ensureSyncConfigured(){
  // Returns true only when sync is configured; used to avoid runtime ReferenceError.
  const url = getSyncUrl();
  const key = getSyncApiKey();
  return !!(url && key);
}

function getSyncUrl(){ return localStorage.getItem(SYNC.urlKey) || ""; }
function setSyncUrl(u){ localStorage.setItem(SYNC.urlKey, (u||"").trim()); }
function getSyncApiKey(){ return localStorage.getItem(SYNC.apiKeyKey) || ""; }
function setSyncApiKey(k){ localStorage.setItem(SYNC.apiKeyKey, (k||"").trim()); }

function getSemanaGeminiApiKey(){
  try{ return (localStorage.getItem(LS.semanaGeminiApiKey) || "").trim(); }
  catch(_e){ return ""; }
}
function setSemanaGeminiApiKey(k){
  try{
    localStorage.setItem(LS.semanaGeminiApiKey, String(k || "").trim());
    return true;
  }catch(err){
    if(isQuotaExceededError(err)) return false;
    throw err;
  }
}

// ---- Astrology (Cosmic Lite) ----
function loadNatalChart(){
  try{
    const raw = localStorage.getItem(LS.natalChart);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed !== "object") return null;
    return parsed;
  }catch(e){
    return null;
  }
}

function saveNatalChart(obj){
  try{ localStorage.setItem(LS.natalChart, JSON.stringify(obj)); return true; }catch(e){ return false; }
}

function clearNatalChart(){
  try{ localStorage.removeItem(LS.natalChart); }catch(e){}
}

function getCosmicLiteSignals(now = new Date()){
  const m = computeMoonNow(now);
  const natal = loadNatalChart();
  return {
    ...m,
    natal_loaded: !!natal,
    natal_name: natal?.meta?.name || "",
    natal_version: natal?.v || 0,
  };
}

function refreshGlobalSignals(){
  // For NeuroBubble + other modules that want a single signals bag.
  const base = (state && state.neuroclawLast && state.neuroclawLast.signals && typeof state.neuroclawLast.signals === "object")
    ? state.neuroclawLast.signals
    : {};
  const cosmic = getCosmicLiteSignals(new Date());
  const transitLite = getTransitLiteSignals(new Date());
  const swiss = loadSwissLast();
  // If swiss exists, it overrides transit_* keys.
  window.__MC_STATE__ = Object.assign({}, base, cosmic, transitLite, (swiss||{}));
  return window.__MC_STATE__;
}

function getAstroProvider(){
  const p = (localStorage.getItem(LS.astroProvider) || "lite").trim();
  return (p === "swiss") ? "swiss" : "lite";
}

function setAstroProvider(p){
  localStorage.setItem(LS.astroProvider, (p === "swiss") ? "swiss" : "lite");
}

function loadSwissLast(){
  try{
    const raw = localStorage.getItem(LS.astroSwissLast);
    if(!raw) return null;
    const obj = JSON.parse(raw);
    if(!obj || typeof obj !== "object") return null;
    return obj;
  }catch(e){
    return null;
  }
}

function saveSwissLast(obj){
  try{ localStorage.setItem(LS.astroSwissLast, JSON.stringify(obj)); }catch(e){}
}

function todayKey(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const da = String(d.getDate()).padStart(2,"0");
  return `${y}${m}${da}`;
}

function loadSeenSet(){
  try{
    const raw = localStorage.getItem(LS.astroSwissSeen);
    if(!raw) return { day: todayKey(), seen: [] };
    const obj = JSON.parse(raw);
    if(!obj || typeof obj !== "object") return { day: todayKey(), seen: [] };
    if(obj.day !== todayKey()) return { day: todayKey(), seen: [] };
    if(!Array.isArray(obj.seen)) obj.seen = [];
    return obj;
  }catch(e){
    return { day: todayKey(), seen: [] };
  }
}

function saveSeenSet(obj){
  try{ localStorage.setItem(LS.astroSwissSeen, JSON.stringify(obj)); }catch(e){}
}

async function refreshSwissTransitsUI({forceSpeak=false} = {}){
  if(getAstroProvider() !== "swiss") return;
  if(!swissTransitsAvailable()) return;

  const natal = loadNatalChart();
  const now = new Date();
  try{
    const swiss = await getTransitSwissSignals({ now, natal });
    if(!swiss) return;

    saveSwissLast(swiss);
    refreshGlobalSignals();

    // Update Lunar Money log (for Home card)
    try{ upsertLunarMoneyTodayFromSwiss(swiss); }catch(e){}

    // Update settings labels if present
    const lab = document.querySelector("#astroTransitLabel");
    if(lab) lab.textContent = swiss.transit_top || "";
    const hint = document.querySelector("#astroHint");
    if(hint) hint.textContent = swiss.transit_hint || "Bubble puede usar esto como contexto, no como destino.";
    const chip = document.querySelector("#chipTransitEngine");
    if(chip) chip.textContent = swiss.transit_engine || "swiss";

    // Notify (once per day per headline)
    const headline = swiss?.transit_events?.[0];
    const orb = typeof headline?.orb === "number" ? headline.orb : null;
    const key = headline ? `${headline.tp}_${headline.aspect}_${headline.natal}` : "";

    const seen = loadSeenSet();
    const isNew = key && !seen.seen.includes(key);
    const isTight = (orb !== null) ? (orb <= 1.6) : false;
    if((forceSpeak || (isNew && isTight)) && swiss.transit_hint){
      seen.seen.push(key);
      saveSeenSet(seen);
      toast(`🪐 Tránsito activo: ${swiss.transit_top}`);
      if(window.NeuroBubble && window.NeuroBubble.say){
        window.NeuroBubble.say({ mood:"calm", text: swiss.transit_hint, micro:"Micro: respira 3 veces y elige 1 intención." });
      }
    }

    // Lunar money whisper (reflective, not advice)
    const mw = (swiss.transit_money_whisper || "").trim();
    if(mw){
      const mk = `MONEY_${todayKey()}_${(swiss.moon_phase_name||"")}_${(swiss.transit_moon_house||"")}`;
      const hasSaid = seen.seen.includes(mk);
      const spend24 = Number(window.__MC_STATE__?.spend_24h_total ?? window.__MC_STATE__?.spend_24h ?? 0);
      const isSpendHot = isFinite(spend24) && spend24 > 0;
      const isFullMoon = (swiss.moon_phase_name||"").toLowerCase().includes("llena");

      // Speak once per day, but allow a gentle extra nudge if full moon + spending happened.
      const should = forceSpeak || (!hasSaid) || (isFullMoon && isSpendHot && !seen.seen.includes(mk+"_HOT"));
      if(should && window.NeuroBubble && window.NeuroBubble.say){
        const key2 = (isFullMoon && isSpendHot) ? (mk+"_HOT") : mk;
        seen.seen.push(key2);
        saveSeenSet(seen);
        toast("🌙 Finanzas lunares: mira a Bubble");
        window.NeuroBubble.say({ mood:"calm", text: mw, micro:"Micro (2 min): anota 1 gasto y 1 regla para hoy." });
      }
    }
  }catch(e){
    // keep silent; swiss is optional
    console.warn("[AstroSwiss] refresh failed", e);
  }
}


async function ensureSwissDailyLoaded({ force=false } = {}){
  if(!swissDailyAvailable()) return;
  // Prevent render -> wire -> load loops.
  // When Swiss is configured, this function can be triggered during wiring.
  // Calling view() synchronously would re-wire and call this again, freezing the boot.
  if(!force && state?.swissDailyLoading) return;
  const now = new Date();
  const today = isoDate(now);

  // Already loaded today
  if(!force && state?.swissDaily && (state.swissDaily.date === today || state.swissDaily._iso === today)) return;

  // If not configured, skip (and don't spam prompts unless user explicitly asks)
  if(!getSwissAstroUrl() || !getSwissAstroKey()) return;

  try{
    state.swissDailyLoading = true;
    state.swissDailyError = "";
    // Schedule UI update to avoid synchronous render loops during event wiring
    try{ setTimeout(()=>view(), 0); }catch(_e){}

    const data = await getSwissDailyCached({ now, forceRefresh: force });
    if(!data){
      state.swissDailyError = "No se pudo obtener datos (revisa URL/Key o CORS).";
      state.swissDailyLoading = false;
      view();
      return;
    }
    // normalize helper
    data._iso = data.date || today;
    state.swissDaily = data;
    state.swissDailyTs = Date.now();
    state.swissDailyLoading = false;
    view();
  }catch(e){
    state.swissDailyError = "Error cargando Swiss.";
    state.swissDailyLoading = false;
    view();
  }
}

function openSwissDailyModal(){
  const d = state?.swissDaily;
  const trans = (d && Array.isArray(d.transits)) ? d.transits : [];
  const body = `
    <div class="sectionTitle">
      <div>Visión lunar</div>
      <div class="chip">${escapeHtml(d?.date || isoDate(new Date()))}</div>
    </div>

    <div class="card">
      <div class="kv">
        <div class="k">Luna</div>
        <div class="v"><b>${escapeHtml(d?.moon_sign || "—")}</b> <span class="small">${typeof d?.moon_phase==="number" ? `(${Math.round(d.moon_phase*100)}%)` : ""}</span></div>
      </div>
      <div class="kv">
        <div class="k">Mensaje</div>
        <div class="v">${escapeHtml(d?.message || "—")}</div>
      </div>
      <div class="hr"></div>
      <div class="small" style="opacity:.9;margin-bottom:8px;">Tránsitos (top)</div>
      ${trans.length ? `<ul class="swissList">${trans.map(t=>`<li>${escapeHtml(String(t))}</li>`).join("")}</ul>` : `<div class="muted">Sin tránsitos.</div>`}
    </div>
  `;
  openSheet(body);
}


// ---- Lunar Money Card (Home) ----
function getSpend24h(){
  const s = (window.__MC_STATE__ && typeof window.__MC_STATE__==="object") ? window.__MC_STATE__ : refreshGlobalSignals();
  const v = (s.spend_24h_total ?? s.spend_24h ?? s.spend_1d_total ?? 0);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function loadLunarMoneyLog(){
  try{
    const raw = localStorage.getItem(LS.lunarMoneyLog);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch(e){
    return [];
  }
}

function saveLunarMoneyLog(arr){
  try{ localStorage.setItem(LS.lunarMoneyLog, JSON.stringify(Array.isArray(arr)?arr:[])); }catch(e){}
}

function upsertLunarMoneyTodayFromSwiss(swiss){
  if(!swiss || typeof swiss!=="object") return;
  const day = todayKey();
  const spend = getSpend24h();
  const natal = loadNatalChart();
  const house2 = (natal && Array.isArray(natal.houses)) ? natal.houses.find(h=>Number(h.house)===2) : null;
  const house2Sign = house2?.sign ? String(house2.sign) : "";

  const entry = {
    day,
    ts: Date.now(),
    moon_phase_name: swiss.moon_phase_name || "",
    moon_sign: swiss.moon_sign || "",
    moon_house: swiss.transit_moon_house || "",
    spend_24h: spend,
    house2_sign: house2Sign,
    whisper: (swiss.transit_money_whisper || "").trim()
  };

  const log = loadLunarMoneyLog().filter(x=>x && typeof x==="object");
  const i = log.findIndex(x=>x.day===day);
  if(i>=0) log[i] = { ...log[i], ...entry };
  else log.unshift(entry);

  // keep last 90 days
  saveLunarMoneyLog(log.slice(0, 90));
}

function renderLunarMoneyCard(){
  const swiss = loadSwissLast() || {};
  const spend = getSpend24h();
  const natal = loadNatalChart();
  const house2 = (natal && Array.isArray(natal.houses)) ? natal.houses.find(h=>Number(h.house)===2) : null;
  const house2Sign = house2?.sign ? String(house2.sign) : "—";
  const regencia = (house2Sign.toLowerCase()==="pisces" || house2Sign.toLowerCase()==="piscis") ? "Neptuno / Júpiter" : "";

  const phase = (swiss.moon_phase_name || "").trim();
  const msign = (swiss.moon_sign || "").trim();
  const mhouse = (swiss.transit_moon_house || "").trim();
  const whisper = (swiss.transit_money_whisper || "").trim();

  const topLine = [
    phase ? `🌙 ${phase}` : "",
    msign ? `Luna en ${msign}` : "",
    mhouse ? `Casa ${mhouse}` : ""
  ].filter(Boolean).join(" • ") || "Activa Swiss y recalcula para ver tu clima lunar de hoy.";

  const spendLine = `Gasto 24h: <b>S/ ${escapeHtml(String(Math.round(spend*100)/100))}</b>`;
  const houseLine = `Casa 2: <b>${escapeHtml(house2Sign)}</b>${regencia ? ` <span class=\"muted\">(${escapeHtml(regencia)})</span>` : ""}`;

  return `
    <section class="card homeCard homeWide" id="homeLunarMoneyCard">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">Luna & Dinero 🌙💸</h2>
          <div class="small">${topLine}</div>
        </div>
        <div class="row" style="gap:8px;">
          <button class="iconBtn" id="btnLunarMoneyRefresh" aria-label="Refresh">⟲</button>
          <button class="iconBtn" id="btnLunarMoneyHistory" aria-label="History">🗓️</button>
        </div>
      </div>
      <div class="hr"></div>
      <div class="small" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
        <div>${spendLine}</div>
        <div class="dot">•</div>
        <div>${houseLine}</div>
      </div>

      <div class="hr"></div>

      ${whisper ? `
        <div style="line-height:1.45">${escapeHtml(whisper).replace(/\n/g,"<br>")}</div>
        <div class="muted" style="margin-top:10px;">No es consejo financiero. Es lectura simbólica + tu data de gasto.</div>
      ` : `
        <div class="muted">Aún no hay whisper. Pulsa ⟲ para recalcular con Swiss.</div>
      `}
    </section>
  `;
}

function openLunarMoneyHistoryModal(){
  const host = document.querySelector("#app");
  if(!host) return;

  const log = loadLunarMoneyLog();
  const rows = log.slice(0, 30).map(e=>{
    const d = String(e.day||"");
    const pretty = d.length===8 ? `${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)}` : d;
    const spend = Number(e.spend_24h||0);
    const line1 = [e.moon_phase_name?`🌙 ${e.moon_phase_name}`:"", e.moon_sign?`Luna en ${e.moon_sign}`:"", e.moon_house?`Casa ${e.moon_house}`:""]
      .filter(Boolean).join(" • ");
    const w = (e.whisper||"").trim();
    return `
      <div class="card" style="margin:10px 0;">
        <div class="cardTop" style="padding:12px 12px 6px;">
          <div>
            <div class="cardTitle" style="font-size:16px;">${escapeHtml(pretty)}</div>
            <div class="small">${escapeHtml(line1 || "—")}</div>
          </div>
          <div class="chip">S/ ${escapeHtml(String(Math.round(spend*100)/100))}</div>
        </div>
        <div class="hr"></div>
        <div style="padding:10px 12px;line-height:1.35;">
          ${w ? escapeHtml(w).replace(/\n/g,"<br>") : `<span class="muted">Sin whisper guardado.</span>`}
        </div>
      </div>
    `;
  }).join("") || `<div class="muted">Aún no hay histórico. Pulsa ⟲ en la card para generar el de hoy.</div>`;

  const modal = document.createElement("div");
  modal.className = "modalBackdrop";
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-label="Histórico Lunar & Dinero">
      <div class="modalTop">
        <div>
          <div class="modalTitle">Histórico: Luna & Dinero 🌙💸</div>
          <div class="modalSub">30 días máx • Seguimiento diario (no consejo financiero)</div>
        </div>
        <button class="iconBtn" id="btnLmClose" aria-label="Close">✕</button>
      </div>
      <div class="hr"></div>
      <div style="max-height:70vh;overflow:auto;padding-right:6px;">${rows}</div>
    </div>
  `;
  host.appendChild(modal);

  const close = ()=> modal.remove();
  modal.addEventListener("click",(e)=>{ if(e.target===modal) close(); });
  modal.querySelector("#btnLmClose")?.addEventListener("click", close);
}
// ---- END Lunar Money Card ----

// ---- NeuroClaw Cloud AI (optional) ----

function ensureNeuroAiConfig(){
  // Prompts once if missing. User can cancel to keep using local-only NeuroClaw.
  let url = getNeuroAiUrl();
  let key = getNeuroAiKey();

  // If already configured, nothing to do.
  if(url && key) return { url, key, ok: true };

  // Ask user if they want to connect to cloud AI
  const want = window.confirm("¿Quieres conectar NeuroClaw con tu AI en la nube (Gemini)?\n\nEsto es opcional: si cancelas, NeuroClaw seguirá funcionando solo con reglas locales.");
  if(!want) return { url:"", key:"", ok:false };

  url = (window.prompt("Pega tu Cloud Run URL base (sin /insight):", url || "") || "").trim();
  if(url && url.endsWith("/")) url = url.slice(0,-1);

  key = (window.prompt("Pega tu MC_API_KEY (header x-mc-key):", key || "") || "").trim();

  if(url) localStorage.setItem(KEYS.neuroclawAiUrl, url);
  if(key) localStorage.setItem(KEYS.neuroclawAiKey, key);

  return { url, key, ok: !!(url && key) };
}

function getNeuroAiUrl(){ return (localStorage.getItem(KEYS.neuroclawAiUrl) || "").trim(); }
function setNeuroAiUrl(u){ localStorage.setItem(KEYS.neuroclawAiUrl, (u||"").trim()); }
function getNeuroAiKey(){ return (localStorage.getItem(KEYS.neuroclawAiKey) || "").trim(); }
function setNeuroAiKey(k){ localStorage.setItem(KEYS.neuroclawAiKey, (k||"").trim()); }


function ensureNeuroAiConfigured(){
  let url = getNeuroAiUrl();
  let key = getNeuroAiKey();
  if(url && key) return true;

  const ok = confirm("¿Quieres conectar NeuroClaw a tu AI en la nube (Cloud Run)?\n\nEsto permite insights tipo Gemini. Puedes decir que no y seguir solo con reglas.");
  if(!ok) return false;

  url = prompt("Pega la URL base de tu servicio Cloud Run (sin /insight):", url || "");
  if(url) setNeuroAiUrl(url);

  key = prompt("Pega tu MC_API_KEY (x-mc-key) para ese servicio:", key || "");
  if(key) setNeuroAiKey(key);

  return !!(getNeuroAiUrl() && getNeuroAiKey());
}

function getSwissAstroUrl(){ return (localStorage.getItem(KEYS.swissAstroUrl) || "").trim().replace(/\/+$/,""); }
function setSwissAstroUrl(u){ localStorage.setItem(KEYS.swissAstroUrl, (u||"").trim()); }
function getSwissAstroKey(){ return (localStorage.getItem(KEYS.swissAstroKey) || "").trim(); }
function setSwissAstroKey(k){ localStorage.setItem(KEYS.swissAstroKey, (k||"").trim()); }

function ensureSwissAstroConfigured(){
  let url = getSwissAstroUrl();
  let key = getSwissAstroKey();
  if(url && key) return true;

  const ok = confirm("Para usar Swiss Astro necesitas conectar tu servicio (Cloud Run).\n\n¿Configurar ahora?");
  if(!ok) return false;

  url = prompt("Pega la URL base de tu Swiss Astro (Cloud Run), sin ruta extra:", url || "");
  if(url) setSwissAstroUrl(url.replace(/\/+$/,""));

  key = prompt("Pega tu MC_API_KEY (header x-mc-key) para Swiss Astro:", key || "");
  if(key) setSwissAstroKey(key);

  return !!(getSwissAstroUrl() && getSwissAstroKey());
}


// ====================== NEUROCLAW AI LOG (localStorage) ======================

function getNeuroAiUsage(){
  try{
    const raw = localStorage.getItem(KEYS.neuroclawAiUsage);
    const obj = raw ? JSON.parse(raw) : null;
    return (obj && typeof obj === "object") ? obj : null;
  }catch(e){
    return null;
  }
}
function saveNeuroAiUsage(obj){
  try{ localStorage.setItem(KEYS.neuroclawAiUsage, JSON.stringify(obj || {})); }catch(e){}
}
function getNeuroAiCallsToday(){
  const today = (typeof getTodayIso === "function") ? getTodayIso() : new Date().toISOString().slice(0,10);
  const u = getNeuroAiUsage();
  if(!u || u.date !== today) return 0;
  return Number(u.count || 0) || 0;
}
function canNeuroAiCall(){
  return getNeuroAiCallsToday() < 3;
}
function incNeuroAiCalls(){
  const today = (typeof getTodayIso === "function") ? getTodayIso() : new Date().toISOString().slice(0,10);
  const u = getNeuroAiUsage();
  const base = (u && u.date === today) ? u : { date: today, count: 0, first_ts: Date.now() };
  base.count = (Number(base.count || 0) || 0) + 1;
  base.last_ts = Date.now();
  saveNeuroAiUsage(base);
  return base.count;
}
function resetNeuroAiCallsToday(){
  const today = (typeof getTodayIso === "function") ? getTodayIso() : new Date().toISOString().slice(0,10);
  saveNeuroAiUsage({ date: today, count: 0, first_ts: Date.now(), last_ts: null, reset_ts: Date.now() });
}

function getAiLog(){
  try{
    const raw = localStorage.getItem(KEYS.neuroclawAiLog);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch(e){
    return [];
  }
}

function saveAiLog(arr){
  try{ localStorage.setItem(KEYS.neuroclawAiLog, JSON.stringify(arr || [])); }catch(e){}
}

// entry: {id, ts, window_days, signals_snapshot, human, raw, user_rating, user_note}
function appendAiLog(entry){
  const log = getAiLog();
  log.unshift(entry);
  // límite para no crecer infinito
  if(log.length > 200) log.length = 200;
  saveAiLog(log);
  return entry;
}

function rateAiLog(id, rating, note=""){
  const log = getAiLog();
  const it = log.find(x => x && x.id === id);
  if(it){
    it.user_rating = rating;  // +1 / 0 / -1
    it.user_note = (note || "").slice(0, 500);
    it.rated_ts = Date.now();
    saveAiLog(log);
    return true;
  }
  return false;
}
async function neuroclawCallCloudAI({signals, now}){
  const ok = ensureNeuroAiConfigured();
  const url = getNeuroAiUrl();
  const key = getNeuroAiKey();

  console.log("[NeuroClawAI] call start", {
    ok,
    url,
    hasKey: !!key,
    signals
  });

  if(!ok || !url || !key){
    console.warn("[NeuroClawAI] missing config");
    return null;
  }

  // Minimal summary to keep tokens low.
  const summary = {
    days: 7,
    localTime: (now||new Date()).toISOString(),
    note: "MemoryCarl NeuroClaw insight",
  };

  try{
    const endpoint = url.replace(/\/+$/,'') + "/insight";

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mc-key": key,
      },
      body: JSON.stringify({ summary, signals }),
    });

    console.log("[NeuroClawAI] response status", res.status);

    let data = null;
    try{ data = await res.json(); }
    catch(e){
      const txt = await res.text().catch(()=> "");
      console.error("[NeuroClawAI] non-json body", txt);
      return null;
    }

    if(!res.ok){
      console.error("[NeuroClawAI] error json", data);
      return null;
    }

    console.log("[NeuroClawAI] json", data);
    return data;

  }catch(err){
    console.error("[NeuroClawAI] fetch failed", err);
    return null;
  }
}

// ====================== NeuroClaw AI (local fallback / learning) ======================
// When Cloud AI is capped (3/day) or unavailable, we still want a reflective voice.
// This function reuses the saved AI log as "memory" and blends it with current signals.
function neuroclawLocalFallbackAI({signals, now} = {}){
  const ts = Date.now();
  const log = getAiLog();
  const recent = Array.isArray(log) ? log.slice(0, 3) : [];

  // Helper: safely read numbers
  const num = (v)=>{
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Pull a couple of key signals if present
  const sleep3 = num(signals?.sleep_avg_3d_hours);
  const sleep7 = num(signals?.sleep_avg_7d_hours);
  const clean7 = num(signals?.cleaning_minutes_7d);
  const spend1 = num(signals?.spend_1d_total);
  const spend7 = num(signals?.spend_7d_total);
  const remOpen = num(signals?.reminders_open);

  // Compare with last snapshot, if we have one
  const prevSig = recent?.[0]?.signals_snapshot || null;
  const delta = (k)=>{
    const a = num(signals?.[k]);
    const b = num(prevSig?.[k]);
    if(a==null || b==null) return null;
    return a - b;
  };

  const dClean = delta('cleaning_minutes_7d');
  const dSpend1 = delta('spend_1d_total');
  const dRem = delta('reminders_open');

  // Build reflective narrative (short, calm, actionable)
  const lines = [];
  lines.push('Hoy entro en modo local: no voy a gastar más llamadas externas, pero sí puedo pensar con lo que ya guardamos.');

  // Anchor in concrete signals
  const facts = [];
  if(sleep3!=null) facts.push(`sueño 3d ≈ ${sleep3.toFixed(1)}h`);
  else if(sleep7!=null) facts.push(`sueño 7d ≈ ${sleep7.toFixed(1)}h`);
  if(clean7!=null) facts.push(`limpieza 7d ≈ ${Math.round(clean7)} min`);
  if(spend1!=null) facts.push(`gasto 24h ≈ ${spend1.toFixed(2)}`);
  else if(spend7!=null) facts.push(`gasto 7d ≈ ${spend7.toFixed(2)}`);
  if(remOpen!=null) facts.push(`pendientes ≈ ${Math.round(remOpen)}`);
  if(facts.length) lines.push(`Señales: ${facts.join(' · ')}.`);

  // Simple trend notes
  const trendBits = [];
  if(dClean!=null) trendBits.push(dClean>0 ? 'más constancia en limpieza' : (dClean<0 ? 'menos limpieza que la última vez' : 'limpieza estable'));
  if(dSpend1!=null) trendBits.push(dSpend1>0 ? 'gasto reciente subió' : (dSpend1<0 ? 'gasto reciente bajó' : 'gasto estable'));
  if(dRem!=null) trendBits.push(dRem>0 ? 'más pendientes abiertos' : (dRem<0 ? 'menos pendientes abiertos' : 'pendientes estables'));
  if(trendBits.length) lines.push(`Tendencia vs tu última lectura guardada: ${trendBits.join(' · ')}.`);

  // Reuse a tiny excerpt of previous "human" as memory (no long quotes)
  const memorySeeds = recent
    .map(x => (x && typeof x.human === 'string') ? x.human.trim() : '')
    .filter(Boolean)
    .slice(0, 2)
    .map(t => t.replace(/\s+/g,' ').slice(0, 160));

  if(memorySeeds.length){
    lines.push('Ecos de tus últimas visiones:');
    memorySeeds.forEach((t,i)=> lines.push(`• ${t}${t.length>=160?'…':''}`));
  }

  // Gentle prompt / question
  const q = [];
  if(remOpen!=null && remOpen>=8) q.push('¿Qué 1 cosa pequeña, si la terminas hoy, te devuelve sensación de control?');
  if(spend1!=null && spend1>0) q.push('Si tuvieras que ponerle un nombre emocional a ese gasto, ¿cuál sería?');
  if(clean7!=null && clean7>0) q.push('¿Qué parte de la casa se sintió “más liviana” después de limpiar?');
  if(!q.length) q.push('¿Qué necesitas escuchar hoy: claridad, calma, o impulso?');
  lines.push(`Pregunta: ${q[0]}`);

  // Micro-action
  lines.push('Micro-acción (3 min): abre tu presupuesto mensual y escribe solo 1 cosa: “lo que más me pesa” y “lo que más me libera”. Nada más.');

  const human = lines.join('\n');
  const ai = {
    human,
    raw: {
      source: 'local_fallback',
      used_logs: recent.map(x=>x?.id).filter(Boolean),
      ts,
    }
  };
  return ai;
}



// ===== Full Backup helpers (cloud restore-ready) =====
function mcSafeJsonParse(raw){
  try{ return JSON.parse(raw); }catch(e){ return null; }
}
function getMcLocalStorageRaw(){
  // Capture ALL MemoryCarl/app keys (including settings/creds) so restore can be exact.
  const out = {};
  try{
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(!k) continue;
      if(k.startsWith("memorycarl_") || k.startsWith("mc_")){
        out[k] = localStorage.getItem(k);
      }
    }
  }catch(e){}
  return out;
}

function restoreMcLocalStorageRaw(lsRaw){
  if(!lsRaw || typeof lsRaw !== "object") return false;
  const incoming = Object.entries(lsRaw).filter(([k])=> typeof k === "string" && (k.startsWith("memorycarl_") || k.startsWith("mc_")));
  if(!incoming.length) return false;
  try{
    const toRemove = [];
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(!k) continue;
      if(k.startsWith("memorycarl_") || k.startsWith("mc_")) toRemove.push(k);
    }
    toRemove.forEach(k=> localStorage.removeItem(k));
    incoming.forEach(([k,v])=>{
      if(v === null || v === undefined) return;
      localStorage.setItem(k, String(v));
    });
    return true;
  }catch(e){
    console.warn("restoreMcLocalStorageRaw failed", e);
    return false;
  }
}

const BRAIN_BACKUP_KIND = "footballlab_brain_backup";
const BRAIN_BACKUP_VERSION = 1;

function isBrainRelatedLocalStorageKey(key = ""){
  return (
    key === "footballDB" ||
    key.startsWith("footballLab_") ||
    key.startsWith("FL_") ||
    key.startsWith("BRAIN_") ||
    key.startsWith("brain_") ||
    key.startsWith("hybrid_brain_")
  );
}

function isQuotaExceededError(err){
  if(!err) return false;
  return err.name === "QuotaExceededError" || err.code === 22 || err.code === 1014;
}

function pruneFootballLabCacheKeysForImport(){
  const keysToDelete = [];
  for(let i=0;i<localStorage.length;i++){
    const k = localStorage.key(i);
    if(!k) continue;
    if(
      k === "footballLab_competitions" ||
      k.startsWith("footballLab_teams_") ||
      k.startsWith("team_profile_") ||
      k.startsWith("match_events_") ||
      k.startsWith("match_momentum_") ||
      k.startsWith("lpe_")
    ){
      keysToDelete.push(k);
    }
  }
  keysToDelete.forEach((k)=>{
    try{ localStorage.removeItem(k); }catch(_e){}
  });
}

function buildCompactBrainStateCandidates(raw){
  const parsed = mcSafeJsonParse(raw);
  if(!parsed || typeof parsed !== "object") return [];

  const base = {
    ...parsed,
    mne: {
      ...(parsed.mne && typeof parsed.mne === "object" ? parsed.mne : {}),
      phasePredictions: {},
      phaseObservations: {},
      lsfForecasts: {},
      learningLog: Array.isArray(parsed?.mne?.learningLog) ? parsed.mne.learningLog.slice(-100) : [],
      lsfEvalHistory: Array.isArray(parsed?.mne?.lsfEvalHistory) ? parsed.mne.lsfEvalHistory.slice(-120) : [],
      claudeExchange: {
        ...(parsed?.mne?.claudeExchange && typeof parsed.mne.claudeExchange === "object" ? parsed.mne.claudeExchange : {}),
        trainingNotes: Array.isArray(parsed?.mne?.claudeExchange?.trainingNotes) ? parsed.mne.claudeExchange.trainingNotes.slice(-60) : [],
        patterns: Array.isArray(parsed?.mne?.claudeExchange?.patterns) ? parsed.mne.claudeExchange.patterns.slice(-80) : [],
        candidateRules: Array.isArray(parsed?.mne?.claudeExchange?.candidateRules) ? parsed.mne.claudeExchange.candidateRules.slice(-80) : [],
        learningAudit: {
          audits: Array.isArray(parsed?.mne?.claudeExchange?.learningAudit?.audits) ? parsed.mne.claudeExchange.learningAudit.audits.slice(-120) : []
        }
      }
    }
  };

  const memories = parsed.memories && typeof parsed.memories === "object" ? parsed.memories : {};
  const teams = Object.keys(memories);
  const limits = [100, 60, 40, 25, 15, 10, 5];
  const candidates = [];

  limits.forEach((limit)=>{
    const compactedMemories = {};
    teams.forEach((teamId)=>{
      const rows = Array.isArray(memories[teamId]) ? memories[teamId] : [];
      compactedMemories[teamId] = rows.slice(-limit);
    });
    candidates.push(JSON.stringify({ ...base, memories: compactedMemories }));
  });

  candidates.push(JSON.stringify({ ...base, memories: {} }));
  return candidates;
}

function restoreBrainLocalStorageKeyWithFallback(key, raw){
  try{
    localStorage.setItem(key, String(raw));
    return { compacted: false, attempted: false };
  }catch(err){
    if(!isQuotaExceededError(err) || key !== "FL_BRAIN_V2") throw err;
  }

  pruneFootballLabCacheKeysForImport();
  try{
    localStorage.setItem(key, String(raw));
    return { compacted: false, attempted: true };
  }catch(err){
    if(!isQuotaExceededError(err)) throw err;
  }

  const compactCandidates = buildCompactBrainStateCandidates(raw);
  for(const candidate of compactCandidates){
    try{
      localStorage.setItem(key, candidate);
      return { compacted: true, attempted: true };
    }catch(err){
      if(!isQuotaExceededError(err)) throw err;
    }
  }

  throw new Error("No hay espacio suficiente para restaurar FL_BRAIN_V2 incluso con compactación automática.");
}

function hasSensitiveKeyName(key = ""){
  return /(token|apikey|api_key|secret|auth|bearer|password|credential)/i.test(String(key || ""));
}

function sanitizeSecrets(input, keyName = ""){
  if(hasSensitiveKeyName(keyName)) return "[REDACTED]";
  if(Array.isArray(input)) return input.map((item)=>sanitizeSecrets(item));
  if(input && typeof input === "object"){
    const out = {};
    Object.entries(input).forEach(([key, value])=>{
      out[key] = sanitizeSecrets(value, key);
    });
    return out;
  }
  return input;
}

function openDB(name, version, upgradeCallback){
  return new Promise((resolve, reject)=>{
    try{
      const req = (version === undefined || version === null)
        ? indexedDB.open(name)
        : indexedDB.open(name, version);
      req.onupgradeneeded = ()=>{
        if(typeof upgradeCallback === "function") upgradeCallback(req.result, req.transaction);
      };
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error || new Error(`No se pudo abrir IndexedDB: ${name}`));
    }catch(err){
      reject(err);
    }
  });
}

async function openDBWithRequiredStores(dbName, storeNames = []){
  let db = await openDB(dbName);
  const missingStores = storeNames.filter((storeName)=>!db.objectStoreNames.contains(storeName));
  if(!missingStores.length) return db;

  const nextVersion = Number(db.version || 1) + 1;
  db.close();

  db = await openDB(dbName, nextVersion, (upgradeDb)=>{
    missingStores.forEach((storeName)=>{
      if(!upgradeDb.objectStoreNames.contains(storeName)){
        upgradeDb.createObjectStore(storeName, { keyPath: "teamId" });
      }
    });
  });

  return db;
}

function idbGetAll(db, storeName){
  return new Promise((resolve, reject)=>{
    try{
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = ()=>resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = ()=>reject(req.error || new Error(`No se pudo leer store ${storeName}`));
    }catch(err){
      reject(err);
    }
  });
}

function idbClearStore(db, storeName){
  return new Promise((resolve, reject)=>{
    try{
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).clear();
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>reject(tx.error || new Error(`No se pudo limpiar store ${storeName}`));
    }catch(err){
      reject(err);
    }
  });
}

function idbPutMany(db, storeName, rows = []){
  return new Promise((resolve, reject)=>{
    try{
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      (Array.isArray(rows) ? rows : []).forEach((row)=>store.put(row));
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>reject(tx.error || new Error(`No se pudo escribir store ${storeName}`));
    }catch(err){
      reject(err);
    }
  });
}

async function collectBrainBackupData(){
  const localStorageDump = {};
  const localStorageParsed = {};
  let hasLocal = false;

  try{
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(!k || !isBrainRelatedLocalStorageKey(k)) continue;
      const raw = localStorage.getItem(k);
      localStorageDump[k] = raw;
      localStorageParsed[k] = mcSafeJsonParse(raw) ?? raw;
      hasLocal = true;
    }
  }catch(_e){}

  const indexedDbDump = {};
  let hasIndexedDB = false;
  const dbCandidates = ["footballLabTeamPacks"];
  try{
    if(typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function"){
      const dbList = await indexedDB.databases();
      (dbList || []).forEach((row)=>{
        const name = String(row?.name || "");
        if(name && (name.includes("footballLab") || name.includes("FL_") || name.includes("brain"))){
          dbCandidates.push(name);
        }
      });
    }
  }catch(_e){}

  for(const dbName of [...new Set(dbCandidates)].filter(Boolean)){
    try{
      const db = await openDB(dbName);
      const stores = Array.from(db.objectStoreNames || []);
      const storeDump = {};
      for(const storeName of stores){
        const rows = await idbGetAll(db, storeName);
        if(rows.length){
          storeDump[storeName] = rows;
          hasIndexedDB = true;
        }
      }
      db.close();
      if(Object.keys(storeDump).length) indexedDbDump[dbName] = storeDump;
    }catch(_e){}
  }

  const footballDb = localStorageParsed.footballDB && typeof localStorageParsed.footballDB === "object"
    ? localStorageParsed.footballDB
    : {};
  const brainState = localStorageParsed.FL_BRAIN_V2 && typeof localStorageParsed.FL_BRAIN_V2 === "object"
    ? localStorageParsed.FL_BRAIN_V2
    : {};

  return {
    kind: BRAIN_BACKUP_KIND,
    version: BRAIN_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: (typeof window !== "undefined" && window.__mcBoot?.version) ? String(window.__mcBoot.version) : "unknown",
    schema: {
      brainVersion: String(brainState?.schemaVersion || footballDb?.learning?.schemaVersion || "v2"),
      notes: "Backup completo Brain v2"
    },
    data: {
      brainState,
      teamPacksIndex: localStorageParsed.FL_TEAMPACKS_INDEX || {},
      teamPacksStore: indexedDbDump?.footballLabTeamPacks?.packs || localStorageParsed.FL_TEAMPACKS || {},
      globalPatternEngine: brainState?.gpe || null,
      settings: sanitizeSecrets(footballDb?.settings || {}),
      calibration: {
        learning: footballDb?.learning || {},
        mne: brainState?.mne || {},
        trainingReport: localStorageParsed.hybrid_brain_training_report || localStorageParsed.brain_meta_default || {}
      },
      localStorageDump,
      indexedDbDump,
      meta: {
        source: "local",
        storage: hasIndexedDB && hasLocal ? "mixed" : hasIndexedDB ? "indexeddb" : "localstorage"
      }
    }
  };
}

function downloadJson(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function restoreBrainData(data){
  const incomingLocalDump = (data?.localStorageDump && typeof data.localStorageDump === "object") ? data.localStorageDump : {};
  const incomingIndexedDump = (data?.indexedDbDump && typeof data.indexedDbDump === "object") ? data.indexedDbDump : {};
  const keysToReplace = Object.keys(incomingLocalDump).filter(isBrainRelatedLocalStorageKey);

  for(let i=0;i<localStorage.length;i++){
    const key = localStorage.key(i);
    if(key && isBrainRelatedLocalStorageKey(key) && !keysToReplace.includes(key)) keysToReplace.push(key);
  }

  keysToReplace.forEach((key)=>{
    try{ localStorage.removeItem(key); }catch(_e){}
  });

  let brainCompacted = false;
  Object.entries(incomingLocalDump).forEach(([key, raw])=>{
    if(!isBrainRelatedLocalStorageKey(key)) return;
    if(raw === undefined || raw === null) return;
    const result = restoreBrainLocalStorageKeyWithFallback(key, raw);
    if(result?.compacted) brainCompacted = true;
  });

  for(const [dbName, stores] of Object.entries(incomingIndexedDump)){
    const storeNames = Object.keys(stores || {});
    if(!storeNames.length) continue;
    const db = await openDBWithRequiredStores(dbName, storeNames);
    for(const storeName of storeNames){
      await idbClearStore(db, storeName);
      await idbPutMany(db, storeName, stores[storeName]);
    }
    db.close();
  }

  return { compacted: brainCompacted };
}

async function importBrainBackupFromFile(file){
  const currentSnapshot = await collectBrainBackupData();
  const text = await file.text();
  let parsed;
  try{
    parsed = JSON.parse(text);
  }catch(_e){
    throw new Error("JSON inválido: no se pudo parsear el archivo.");
  }

  if(parsed?.kind !== BRAIN_BACKUP_KIND) throw new Error("Backup inválido: kind no soportado.");
  if(Number(parsed?.version) !== BRAIN_BACKUP_VERSION) throw new Error("Backup inválido: versión no soportada.");
  if(!parsed?.data || typeof parsed.data !== "object" || !parsed.data.brainState){
    throw new Error("Backup inválido: falta data.brainState.");
  }

  try{
    const restoreResult = await restoreBrainData(parsed.data);
    return {
      ...parsed,
      restoreMeta: {
        compacted: Boolean(restoreResult?.compacted)
      }
    };
  }catch(err){
    await restoreBrainData(currentSnapshot.data);
    throw err;
  }
}

function mcLoadAny(key, fallback){
  try{ return load(key, fallback); }catch(e){ return fallback; }
}
function flushSync(reason="auto"){
  try{
    if (!isDirty() && !["beforeunload","hidden"].includes(reason)) return;
    // For close/background events we still try a last-chance backup, even if dirty flag missed something.
if (!getSyncUrl() && !ensureSyncConfigured()) return;

    const payload = {
      app: "MemoryCarl",
      v: 2,
      ts: new Date().toISOString(),
      reason,
      apiKey: getSyncApiKey() || undefined,
      data: {

routines: state?.routines ?? load(LS.routines, []),
shopping: state?.shopping ?? load(LS.shopping, []),
reminders: state?.reminders ?? load(LS.reminders, []),

// Home widgets
musicToday: state?.musicToday ?? load(LS.musicToday, null),
musicLog: state?.musicLog ?? load(LS.musicLog, []),
sleepLog: state?.sleepLog ?? load(LS.sleepLog, []),
budgetMonthly: state?.budgetMonthly ?? load(LS.budgetMonthly, null),
calDraw: state?.calDraw ?? load(LS.calDraw, null),
house: state?.house ?? load(LS.house, null),
moodDaily: state?.moodDaily ?? load(LS.moodDaily, null),
moodSpritesCustom: state?.moodSpritesCustom ?? load(LS.moodSpritesCustom, null),

// Shopping system (library + history)
products: state?.products ?? load(LS.products, []),
shoppingHistory: state?.shoppingHistory ?? load(LS.shoppingHistory, []),

// Inventory (home stock)
inventory: state?.inventory ?? load(LS.inventory, []),
inventoryLots: state?.inventoryLots ?? load(LS.inventoryLots, []),

// NeuroClaw + Astro (local caches)
neuroclawFeedback: state?.neuroclawFeedback ?? load(LS.neuroclawFeedback, []),
neuroclawLast: state?.neuroclawLast ?? load(LS.neuroclawLast, null),
neuroclawAiLog: mcLoadAny("memorycarl_v2_neuroclaw_ai_log", []),
neuroclawAiUsage: mcLoadAny("memorycarl_v2_neuroclaw_ai_usage", null),
lunarMoneyLog: mcLoadAny(LS.lunarMoneyLog, []),
natalChart: mcLoadAny(LS.natalChart, null),
astroProvider: localStorage.getItem(LS.astroProvider) || "lite",
astroSwissLast: mcLoadAny(LS.astroSwissLast, null),
astroSwissSeen: mcLoadAny(LS.astroSwissSeen, null),

// Finance Core (IMPORTANT)
finance_accounts: mcLoadAny("memorycarl_v2_finance_accounts", []),
finance_ledger: mcLoadAny("memorycarl_v2_finance_ledger", []),
finance_debts: mcLoadAny("memorycarl_v2_finance_debts", []),
finance_commitments: mcLoadAny("memorycarl_v2_finance_commitments", []),
finance_obligations: mcLoadAny("memorycarl_v2_finance_obligations", []),
finance_payment_sources: mcLoadAny("memorycarl_v2_finance_payment_sources", []),
finance_transactions: mcLoadAny("memorycarl_v2_finance_transactions", []),
finance_internal_balances: mcLoadAny("memorycarl_v2_finance_internal_balances", []),
finance_insights: mcLoadAny("memorycarl_v2_finance_insights", []),
finance_commitment_templates: mcLoadAny("memorycarl_v2_finance_commitment_templates", []),
finance_commitment_instances: mcLoadAny("memorycarl_v2_finance_commitment_instances", []),
finance_loan_usage_ledger: mcLoadAny("memorycarl_v2_finance_loan_usage_ledger", []),
finance_schema_version: mcLoadAny("memorycarl_v2_finance_schema_version", 1),
finance_categories: mcLoadAny("memorycarl_v2_finance_categories", []),
finance_meta: mcLoadAny("memorycarl_v2_finance_meta", null),
finance_projection_mode: localStorage.getItem("memorycarl_v2_finance_projection_mode") || "",
finance_resetAt: localStorage.getItem("memorycarl_v2_finance_resetAt") || "",

// Settings/credentials needed for full recovery (kept in lsRaw too)
neuroclawAiUrl: localStorage.getItem(LS.neuroclawAiUrl) || "",
neuroclawAiKey: localStorage.getItem(LS.neuroclawAiKey) || "",
swissAstroUrl: localStorage.getItem("memorycarl_v2_swiss_astro_url") || "",
swissAstroKey: localStorage.getItem("memorycarl_v2_swiss_astro_key") || "",
syncUrl: getSyncUrl() || "",
syncApiKey: getSyncApiKey() || "",

// Absolute restore: raw localStorage dump for exact recovery
lsRaw: getMcLocalStorageRaw(),
      }
    };

    const url = getSyncUrl();
    const blob = new Blob([JSON.stringify(payload)], { type: "text/plain" });

    const setLastError = (err) => {
      const msg = (err && (err.message || err.toString())) ? (err.message || err.toString()) : String(err);
      console.warn("Sync send failed:", msg);
      localStorage.setItem("memorycarl_last_sync_error", msg);
      // Keep dirty so we can retry later
    };

    // 1) Prefer sendBeacon (best for close/background)
    if (navigator.sendBeacon){
      const queued = navigator.sendBeacon(url, blob);
      if (queued){
        clearDirty();
        localStorage.setItem(SYNC.lastSyncKey, new Date().toISOString());
        localStorage.removeItem("memorycarl_last_sync_error");
        return;
      }
    }

    // 2) Fallback to fetch keepalive. (Still best-effort with no-cors)
    fetch(url, {
      method: "POST",
      body: JSON.stringify(payload),
      keepalive: true,
      mode: "no-cors"
    })
    .then(() => {
      clearDirty();
      localStorage.setItem(SYNC.lastSyncKey, new Date().toISOString());
      localStorage.removeItem("memorycarl_last_sync_error");
    })
    .catch((err) => {
      // Common case: net::ERR_BLOCKED_BY_CLIENT (adblock/privacy extension)
      setLastError(err);
    });

  }catch(e){
    console.warn("Sync flush failed:", e);
    localStorage.setItem("memorycarl_last_sync_error", e?.message || String(e));
  }
}


// Flush when tab/app is being closed or backgrounded
window.addEventListener("beforeunload", ()=>flushSync("beforeunload"));
document.addEventListener("visibilitychange", ()=>{ if (document.visibilityState === "hidden") flushSync("hidden"); });
// Expose quick debug helpers in console
window.MemoryCarlSync = {
  flush: (reason="manual") => flushSync(reason),
  status: () => ({
    url: getSyncUrl(),
    dirty: isDirty(),
    lastSyncAt: localStorage.getItem(SYNC.lastSyncKey) || "",
    lastError: localStorage.getItem("memorycarl_last_sync_error") || ""
  })
};




// ---- Helpers ----
function uid(prefix="id"){ return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`; }

// ---- IndexedDB overflow (fallback when localStorage quota is exceeded) ----
const MC_IDB_FALLBACK = {
  dbName: "memorycarl_v2_storage",
  version: 1,
  store: "kv",
};
const mcIdbCache = new Map();
let mcIdbReady = false;

function mcCanUseIndexedDB(){
  return typeof indexedDB !== "undefined";
}

function mcOpenFallbackDb(){
  return new Promise((resolve, reject) => {
    if(!mcCanUseIndexedDB()) return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(MC_IDB_FALLBACK.dbName, MC_IDB_FALLBACK.version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(MC_IDB_FALLBACK.store)){
        db.createObjectStore(MC_IDB_FALLBACK.store, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

async function mcIdbPut(key, payload){
  const db = await mcOpenFallbackDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(MC_IDB_FALLBACK.store, "readwrite");
    tx.objectStore(MC_IDB_FALLBACK.store).put({ key, payload, updatedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("IndexedDB put failed"));
  });
  db.close();
}

async function mcIdbDelete(key){
  const db = await mcOpenFallbackDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(MC_IDB_FALLBACK.store, "readwrite");
    tx.objectStore(MC_IDB_FALLBACK.store).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
  });
  db.close();
}

async function mcBootstrapIdbCache(){
  if(!mcCanUseIndexedDB()) return;
  try{
    const db = await mcOpenFallbackDb();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(MC_IDB_FALLBACK.store, "readonly");
      const req = tx.objectStore(MC_IDB_FALLBACK.store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error("IndexedDB getAll failed"));
    });
    rows.forEach((row) => {
      if(row && typeof row.key === "string"){
        mcIdbCache.set(row.key, row.payload);
      }
    });
    db.close();
    mcIdbReady = true;
  }catch(err){
    console.warn("[MemoryCarl] IndexedDB fallback init failed:", err);
  }
}
mcBootstrapIdbCache();

function load(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(raw) return JSON.parse(raw);
  }catch(_err){}

  if(mcIdbReady && mcIdbCache.has(key)){
    try{ return JSON.parse(mcIdbCache.get(key)); }
    catch(_err){}
  }
  return fallback;
}

function loadAny(keys, fallback){
  for(const k of (keys||[])){
    if(!k) continue;
    try{
      const raw = localStorage.getItem(k);
      if(raw) return JSON.parse(raw);
    }catch(e){}
  }
  return fallback;
}
function save(key, value){
  const payload = JSON.stringify(value);
  try{
    localStorage.setItem(key, payload);
    if(mcIdbCache.has(key)){
      mcIdbCache.delete(key);
      mcIdbDelete(key).catch(()=>{});
    }
    // Mark dirty for any MemoryCarl data key (we throttle sends elsewhere).
    if(typeof key === "string" && key.startsWith("memorycarl_")) markDirty();
    return true;
  }catch(err){
    if(!isQuotaExceededError(err)) throw err;

    // Fallback: prune heavy weekly planner payload to prevent app crash.
    if(key === LS.semana){
      const compactSemana = compactSemanaState(value);
      try{
        localStorage.setItem(key, JSON.stringify(compactSemana));
        if(mcIdbCache.has(key)){
          mcIdbCache.delete(key);
          mcIdbDelete(key).catch(()=>{});
        }
        if(typeof key === "string" && key.startsWith("memorycarl_")) markDirty();
        return true;
      }catch(err2){
        if(!isQuotaExceededError(err2)) throw err2;
      }
    }

    if(typeof key === "string" && key.startsWith("memorycarl_") && mcCanUseIndexedDB()){
      mcIdbCache.set(key, payload);
      mcIdbPut(key, payload).catch((idbErr)=>{
        console.warn(`[MemoryCarl] localStorage quota exceeded for key "${key}" and IndexedDB fallback failed.`, idbErr);
      });
      markDirty();
      return true;
    }

    console.warn(`[MemoryCarl] localStorage quota exceeded for key "${key}". Save skipped.`);
    return false;
  }
}

function compactSemanaState(value){
  const fallback = seedSemana();
  const semana = (value && typeof value === "object") ? value : fallback;
  const ui = (semana.ui && typeof semana.ui === "object") ? semana.ui : fallback.ui;
  return {
    ...semana,
    recetas: Array.isArray(semana.recetas) ? semana.recetas.slice(-80) : [],
    despensa: Array.isArray(semana.despensa) ? semana.despensa.slice(-160) : [],
    contingencia: Array.isArray(semana.contingencia) ? semana.contingencia.slice(-12) : [],
    historialCompras: Array.isArray(semana.historialCompras) ? semana.historialCompras.slice(-10) : [],
    geminiCache: (semana.geminiCache && typeof semana.geminiCache === "object")
      ? Object.fromEntries(Object.entries(semana.geminiCache).slice(-20))
      : {},
    messages: Array.isArray(semana.messages) ? semana.messages.slice(-20) : [],
    ui: {
      ...ui,
      ingredientDrafts: Array.isArray(ui.ingredientDrafts) && ui.ingredientDrafts.length
        ? ui.ingredientDrafts.slice(0, 4)
        : [{ nombre: "", cantidad: 1, unidad: "und" }],
    },
  };
}

// ===== Dirty flag (required by save/persist) =====
function markDirty(){
  try{ localStorage.setItem(SYNC.dirtyKey, "1"); }catch(e){}
}
function clearDirty(){
  try{ localStorage.setItem(SYNC.dirtyKey, "0"); }catch(e){}
}
function isDirty(){
  try{ return (localStorage.getItem(SYNC.dirtyKey) || "0") === "1"; }catch(e){ return false; }
}


// Ensure ANY direct localStorage write to MemoryCarl keys marks dirty (some modules bypass save()).
(function mcPatchLocalStorageSetItem(){
  try{
    if(window.__mc_ls_patched) return;
    window.__mc_ls_patched = true;
    const _set = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(k, v){
      _set(k, v);
      try{
        if(typeof k === "string" && k.startsWith("memorycarl_")){
          if(k !== SYNC.dirtyKey && k !== SYNC.lastSyncKey && k !== "memorycarl_last_sync_error"){
            markDirty();
          }
        }
      }catch(e){}
    };
  }catch(e){}
})();



function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

// Escape for HTML attribute values inside template strings.
// HTML-escape + escape backticks to avoid breaking template literals.
function escapeAttr(str){
  return escapeHtml(str).replaceAll('`', '&#096;');
}

// main.js is loaded as an ES module. Inline onclick="..." handlers execute in
// the global scope, so expose a couple of safe helpers.
try{ window.escapeHtml = escapeHtml; window.escapeAttr = escapeAttr; }catch(e){}

// ===== Modal helper (global, for inline onclick handlers) =====
function ensureModalRoot(){
  let root = document.getElementById("modalRoot");
  if(!root){
    root = document.createElement("div");
    root.id = "modalRoot";
    root.style.position = "fixed";
    root.style.inset = "0";
    root.style.zIndex = "9999";
    root.style.display = "none";
    document.body.appendChild(root);
  }
  return root;
}

function showModal(html){
  const root = ensureModalRoot();
  root.innerHTML = html || "";
  root.style.display = "block";
  try{ document.body.style.overflow = "hidden"; }catch(e){}
}

function closeModal(ev){
  if(ev && ev.target && !(ev.target.classList && ev.target.classList.contains("modalOverlay"))){
    return;
  }
  const root = ensureModalRoot();
  root.innerHTML = "";
  root.style.display = "none";
  try{ document.body.style.overflow = ""; }catch(e){}
}

document.addEventListener("keydown", (e)=>{
  if(e.key === "Escape") closeModal();
});

try{ window.showModal = showModal; window.closeModal = closeModal; }catch(e){}

function money(n){
  const x = Number(n || 0);
  return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(x);
}

function parseTimesCsv(s){
  return (s || "")
    .split(",")
    .map(x=>x.trim())
    .filter(Boolean)
    .map(t=>{
      const m = /^(\d{1,2}):(\d{2})$/.exec(t);
      if(!m) return t;
      const hh = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2,"0");
      const mm = String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2,"0");
      return `${hh}:${mm}`;
    });
}

// ---- Seeds ----
function seedRoutines(){
  return [{
    id: uid("r"),
    title: "Morning Reset",
    times: ["07:00"],
    steps: [
      { id: uid("s"), text: "Water", done:false },
      { id: uid("s"), text: "Stretch 5 min", done:false },
      { id: uid("s"), text: "Plan top 3 tasks", done:false }
    ],
    active: true,
    lastRun: null,
  }];
}

function seedShopping(){
  return [{
    id: uid("l"),
    name: "Super",
    items: [{ id: uid("i"), name:"Eggs", price:4.25, qty:1, bought:false }]
  }];
}

function seedReminders(){
  return [{ id: uid("m"), text:"Email: follow up", done:false }];
}

function seedHouse(){
  // Seed based on your described layout (can be edited anytime in Config)
  // Levels: "light" (daily/regular) vs "deep" (weekly/deep clean)
  return {
    mode: "light", // "light" | "deep"
    zones: [
      // Layout (from your sketch): Cocina/Sala at top, then service core, then rooms.
      { id: uid("z"), name: "Sala", order: 1, priority: 4 },
      { id: uid("z"), name: "Cocina", order: 2, priority: 5 },
      { id: uid("z"), name: "Lavandería", order: 3, priority: 3 },
      { id: uid("z"), name: "Baño pequeño", order: 4, priority: 5 },
      { id: uid("z"), name: "Pasillo", order: 5, priority: 3 },
      { id: uid("z"), name: "Cuarto Mathias", order: 6, priority: 3 },
      { id: uid("z"), name: "Cuarto Frederick", order: 7, priority: 3 },
      { id: uid("z"), name: "Baño grande", order: 8, priority: 5 },
      { id: uid("z"), name: "Cuarto Principal", order: 9, priority: 4 },
      // Not a cleanable zone, but useful for the future mini-map (void/open space)
      { id: uid("z"), name: "Vacío (doble altura)", order: 99, priority: 1 },
    ],
    tasks: [
      // Global quick wins
      { id: uid("t"), zoneId: null, name: "Recolectar basura (toda la casa)", minutes: 5, freqDays: 2, type: "global", level: "light", priority: 5, lastDone: "" },
      { id: uid("t"), zoneId: null, name: "Recoger objetos fuera de lugar (reset)", minutes: 8, freqDays: 2, type: "global", level: "light", priority: 4, lastDone: "" },

      // Sala
      { id: uid("t"), zoneId: "ZONE_SALA", name: "Mesa de comer: limpiar superficie", minutes: 5, freqDays: 2, type: "surface", level: "light", priority: 4, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_SALA", name: "Escritorio Fergis: ordenar + limpiar", minutes: 7, freqDays: 3, type: "surface", level: "light", priority: 4, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_SALA", name: "Sala: piso (barrer/aspirar)", minutes: 8, freqDays: 4, type: "floor", level: "light", priority: 3, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_SALA", name: "Sala: polvo profundo (repisa/esquinas)", minutes: 12, freqDays: 7, type: "deep", level: "deep", priority: 3, lastDone: "" },

      // Cocina
      { id: uid("t"), zoneId: "ZONE_COCINA", name: "Platos + fregadero (reset)", minutes: 10, freqDays: 1, type: "wet", level: "light", priority: 5, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_COCINA", name: "Mesón/encimera: limpiar + desinfectar", minutes: 6, freqDays: 1, type: "surface", level: "light", priority: 5, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_COCINA", name: "Cocina/estufa: limpiar superficie", minutes: 8, freqDays: 3, type: "wet", level: "light", priority: 4, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_COCINA", name: "Nevera: limpiar exterior + agarraderas", minutes: 6, freqDays: 7, type: "surface", level: "deep", priority: 3, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_COCINA", name: "Cocina: piso (barrer/trapear)", minutes: 10, freqDays: 3, type: "floor", level: "light", priority: 4, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_COCINA", name: "Cocina: deep (microondas/azulejos/grasita)", minutes: 18, freqDays: 7, type: "deep", level: "deep", priority: 4, lastDone: "" },

      // Pasillo
      { id: uid("t"), zoneId: "ZONE_PASILLO", name: "Pasillo: piso (barrer)", minutes: 6, freqDays: 5, type: "floor", level: "light", priority: 3, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_PASILLO", name: "Pasillo: quitar cosas acumuladas", minutes: 6, freqDays: 7, type: "organize", level: "deep", priority: 3, lastDone: "" },

      // Lavandería
      { id: uid("t"), zoneId: "ZONE_LAV", name: "Lavandería: ordenar (ropa/insumos)", minutes: 8, freqDays: 7, type: "organize", level: "deep", priority: 3, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_LAV", name: "Lavandería: limpiar superficie + polvo", minutes: 6, freqDays: 7, type: "surface", level: "deep", priority: 2, lastDone: "" },

      // Baño pequeño (WC + lavamanos)
      { id: uid("t"), zoneId: "ZONE_BS", name: "Baño pequeño: lavamanos + espejo (rápido)", minutes: 6, freqDays: 3, type: "wet", level: "light", priority: 5, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_BS", name: "Baño pequeño: WC (rápido)", minutes: 6, freqDays: 3, type: "wet", level: "light", priority: 5, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_BS", name: "Baño pequeño: deep (paredes/puerta/piso)", minutes: 15, freqDays: 7, type: "deep", level: "deep", priority: 4, lastDone: "" },

      // Cuarto Frederick (juguetes)
      { id: uid("t"), zoneId: "ZONE_FRED", name: "Juguetes: recoger y dejar ordenado", minutes: 10, freqDays: 1, type: "organize", level: "light", priority: 4, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_FRED", name: "Frederick: piso (barrer/aspirar)", minutes: 8, freqDays: 7, type: "floor", level: "deep", priority: 2, lastDone: "" },

      // Cuarto Mathias
      { id: uid("t"), zoneId: "ZONE_MATH", name: "Mathias: tender cama", minutes: 3, freqDays: 1, type: "surface", level: "light", priority: 3, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_MATH", name: "Mathias: escritorio (orden + polvo)", minutes: 8, freqDays: 4, type: "surface", level: "light", priority: 3, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_MATH", name: "Mathias: piso (barrer/aspirar)", minutes: 8, freqDays: 7, type: "floor", level: "deep", priority: 2, lastDone: "" },

      // Cuarto Principal
      { id: uid("t"), zoneId: "ZONE_MAIN", name: "Principal: tender cama", minutes: 3, freqDays: 1, type: "surface", level: "light", priority: 4, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_MAIN", name: "Principal: escritorio (orden + limpiar)", minutes: 8, freqDays: 4, type: "surface", level: "light", priority: 4, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_MAIN", name: "Principal: piso (barrer/aspirar)", minutes: 9, freqDays: 7, type: "floor", level: "deep", priority: 2, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_MAIN", name: "Principal: gabetero/closet (mini organización)", minutes: 15, freqDays: 14, type: "organize", level: "deep", priority: 2, lastDone: "" },

      // Baño grande (con ducha)
      { id: uid("t"), zoneId: "ZONE_BB", name: "Baño grande: lavamanos + espejo", minutes: 7, freqDays: 3, type: "wet", level: "light", priority: 5, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_BB", name: "Baño grande: WC", minutes: 7, freqDays: 3, type: "wet", level: "light", priority: 5, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_BB", name: "Baño grande: ducha (paredes/piso)", minutes: 15, freqDays: 7, type: "deep", level: "deep", priority: 5, lastDone: "" },
      { id: uid("t"), zoneId: "ZONE_BB", name: "Baño grande: piso (trapear)", minutes: 8, freqDays: 7, type: "floor", level: "deep", priority: 4, lastDone: "" },
    ],
    // Mini-map data (Option B: draggable blocks + connections)
    map: {
      nodes: {}, // zoneId -> {x,y}
      edges: [], // {a,b}
      connectMode: false,
      selected: null,
      anim: { active:false, idx:0, path:[] }
    },
    // UI state
    subtab: "route" // "route" | "map" | "manage"
  };
}

function normalizeHouse(){
  // Ensures house data has required shapes and maps seed placeholder zone ids
  if(!state.house || typeof state.house !== "object") state.house = seedHouse();
  state.house.zones = Array.isArray(state.house.zones) ? state.house.zones : [];
  state.house.tasks = Array.isArray(state.house.tasks) ? state.house.tasks : [];
  state.house.sessionHistory = Array.isArray(state.house.sessionHistory) ? state.house.sessionHistory : [];
  // UI flags
  if(typeof state.house.historyOpen !== "boolean") state.house.historyOpen = false;

  // If tasks still reference placeholders, map them once.
  const byName = new Map(state.house.zones.map(z=>[z.name.toLowerCase(), z.id]));
  const map = {
    "ZONE_SALA": byName.get("sala") || null,
    "ZONE_COCINA": byName.get("cocina") || null,
    "ZONE_LAV": byName.get("lavandería") || byName.get("lavanderia") || null,
    "ZONE_BS": byName.get("baño pequeño") || byName.get("bano pequeño") || byName.get("baño pequeno") || byName.get("bano pequeno") || null,
    "ZONE_PASILLO": byName.get("pasillo") || null,
    "ZONE_FRED": byName.get("cuarto frederick") || byName.get("frederick") || null,
    "ZONE_MATH": byName.get("cuarto mathias") || byName.get("mathias") || null,
    "ZONE_MAIN": byName.get("cuarto principal") || byName.get("principal") || null,
    "ZONE_BB": byName.get("baño grande") || byName.get("bano grande") || null,
    "ZONE_VOID": byName.get("vacío (doble altura)") || byName.get("vacio (doble altura)") || byName.get("vacío") || byName.get("vacio") || null
  };
  let changed = false;
  state.house.tasks.forEach(t=>{
    if(typeof t.zoneId === "string" && map[t.zoneId]){
      t.zoneId = map[t.zoneId];
      changed = true;
    }
    if(typeof t.minutes !== "number") t.minutes = Number(t.minutes)||0;
    if(typeof t.freqDays !== "number") t.freqDays = Number(t.freqDays)||0;
    if(typeof t.lastDone !== "string") t.lastDone = (t.lastDone||"");
    if(!t.type) t.type = "misc";
    if(!t.level) t.level = ((t.type||"")==="deep") ? "deep" : "light";
    if(typeof t.priority !== "number") t.priority = Number(t.priority)||0;
  });
  if(!state.house.subtab) state.house.subtab = "route";
  if(!state.house.mode) state.house.mode = "light";

  // Ensure map structure exists (for the mini-game map)
  if(!state.house.map || typeof state.house.map !== "object"){
    state.house.map = { nodes:{}, edges:[], connectMode:false, selected:null, anim:{active:false, idx:0, path:[]} };
    changed = true;
  }
  state.house.map.nodes = (state.house.map.nodes && typeof state.house.map.nodes === "object") ? state.house.map.nodes : {};
  state.house.map.edges = Array.isArray(state.house.map.edges) ? state.house.map.edges : [];
  if(typeof state.house.map.connectMode !== "boolean") state.house.map.connectMode = false;
  if(!state.house.map.anim || typeof state.house.map.anim !== "object") state.house.map.anim = {active:false, idx:0, path:[]};
  if(!Array.isArray(state.house.map.anim.path)) state.house.map.anim.path = [];

  // Details per zone (subzones, notes, etc.)
  if(!state.house.details || typeof state.house.details !== "object"){ 
    state.house.details = {};
    changed = true;
  }

  // UI state for Casa
  if(!state.house.ui || typeof state.house.ui !== "object"){ 
    state.house.ui = { zoneSheet: { open:false, zoneId:null, tab:"light" } };
    changed = true;
  }
  if(!state.house.ui.zoneSheet || typeof state.house.ui.zoneSheet !== "object"){ 
    state.house.ui.zoneSheet = { open:false, zoneId:null, tab:"light" };
    changed = true;
  }
  if(typeof state.house.ui.zoneSheet.open !== "boolean") state.house.ui.zoneSheet.open = false;
  if(typeof state.house.ui.zoneSheet.tab !== "string") state.house.ui.zoneSheet.tab = "light";

  // Ensure task has subzoneId (optional)
  state.house.tasks.forEach(t=>{ if(t.subzoneId === undefined) t.subzoneId = null; });

  if(changed) persist();
}

// ---- State ----
let state = {
  tab: "home",
  moreOpen: false,
  sheetOpen: (() => {
    try{
      if(localStorage.getItem("mc_sheet_open")==="1") return true;
      return sessionStorage.getItem("mc_sheet_open")==="1";
    }catch(_e){
      return false;
    }
  })(),
  routines: load(LS.routines, seedRoutines()),
  shopping: load(LS.shopping, seedShopping()),
  reminders: loadAny([LS.reminders, LS.remindersLegacy], seedReminders()),
  // Home
  musicToday: load(LS.musicToday, null),
  musicLog: load(LS.musicLog, []),
  sleepLog: load(LS.sleepLog, []),
  budgetMonthly: load(LS.budgetMonthly, []),
  calDraw: load(LS.calDraw, {}),
  // Mood (daily sprite + note)
  moodDaily: load(LS.moodDaily, {}),
  moodSpritesCustom: load(LS.moodSpritesCustom, []),
  moodActivityCats: load(LS.moodActivityCats, null),
  lifeTasks: load(LS.lifeTasks, []),
  lifeTasksLog: load(LS.lifeTasksLog, []),
  house: load(LS.house, seedHouse()),
  semana: load(LS.semana, seedSemana()),
  // Insights UI
  insightsMonthOffset: 0,
  insightsDayOpen: false,
  insightsDay: "",
  calMonthOffset: 0,
  musicCursor: 0,
  neuroDebugOpen: false,
  // NeuroClaw
  neuroclawFeedback: load(LS.neuroclawFeedback, []),
  neuroclawLast: load(LS.neuroclawLast, { ts:"", signals:null, suggestions:[] }),
  // Shopping AI
  shoppingAiChat: load(LS.shoppingAiChat, []),
  shoppingAiDays: load(LS.shoppingAiDays, []),
  shoppingAiDayDate: load(LS.shoppingAiDayDate, ""),
  // Tarot Settings
  tarotGeminiKey: load(LS.tarotGeminiKey, ""),
  tarotGeminiModel: load(LS.tarotGeminiModel, "gemini-2.0-flash"),
};

normalizeHouse();

function persist(){
  save(LS.routines, state.routines);
  save(LS.shopping, state.shopping);
  save(LS.reminders, state.reminders);
  try{ localStorage.removeItem(LS.remindersLegacy); }catch(e){}
  save(LS.musicToday, state.musicToday);
  save(LS.musicLog, state.musicLog);
  save(LS.sleepLog, state.sleepLog);
  save(LS.budgetMonthly, state.budgetMonthly);
  save(LS.calDraw, state.calDraw);

  // Mood
  save(LS.moodDaily, state.moodDaily);
  save(LS.moodSpritesCustom, state.moodSpritesCustom);
  if(state.moodActivityCats) save(LS.moodActivityCats, state.moodActivityCats);
  if(state.lifeTasks) save(LS.lifeTasks, state.lifeTasks);
  if(state.lifeTasksLog) save(LS.lifeTasksLog, state.lifeTasksLog);

  // House
  save(LS.house, state.house);
  save(LS.semana, state.semana);

  // NeuroClaw
  try{ save(LS.neuroclawFeedback, state.neuroclawFeedback); }catch(e){}
  try{ save(LS.neuroclawLast, state.neuroclawLast); }catch(e){}

  // Shopping AI
  if(state.shoppingAiChat !== undefined) save(LS.shoppingAiChat, state.shoppingAiChat);
  if(state.shoppingAiDays !== undefined) save(LS.shoppingAiDays, state.shoppingAiDays);
  if(state.shoppingAiDayDate !== undefined) save(LS.shoppingAiDayDate, state.shoppingAiDayDate);

  // Tarot
  if(state.tarotGeminiKey !== undefined) save(LS.tarotGeminiKey, state.tarotGeminiKey);
  if(state.tarotGeminiModel !== undefined) save(LS.tarotGeminiModel, state.tarotGeminiModel);

  // Shopping system (added later in file, so guard)
  try{
    if(LS.products) save(LS.products, state.products);
    if(LS.shoppingHistory) save(LS.shoppingHistory, state.shoppingHistory);
    if(LS.inventory) save(LS.inventory, state.inventory);
    if(LS.inventoryLots) save(LS.inventoryLots, state.inventoryLots||[]);
  }catch(e){}

  // Finance (guard: LS keys defined later)
  try{
    if(LS.financeLedger) save(LS.financeLedger, state.financeLedger||[]);
    if(LS.financeAccounts) save(LS.financeAccounts, state.financeAccounts||[]);
    if(LS.financeResetAt) save(LS.financeResetAt, state.financeResetAt||null);
    if(LS.financeDebts) save(LS.financeDebts, state.financeDebts||[]);
    if(LS.financeCommitments) save(LS.financeCommitments, state.financeCommitments||[]);
    if(LS.financeObligations) save(LS.financeObligations, state.financeObligations||[]);
    if(LS.financePaymentSources) save(LS.financePaymentSources, state.financePaymentSources||[]);
    if(LS.financeTransactions) save(LS.financeTransactions, state.financeTransactions||[]);
    if(LS.financeInternalBalances) save(LS.financeInternalBalances, state.financeInternalBalances||[]);
    if(LS.financeInsights) save(LS.financeInsights, state.financeInsights||[]);
    if(LS.financeSchemaVersion) save(LS.financeSchemaVersion, Number(state.financeSchemaVersion||2));
    if(LS.financeCommitmentTemplates) save(LS.financeCommitmentTemplates, state.financeCommitmentTemplates||[]);
    if(LS.financeCommitmentInstances) save(LS.financeCommitmentInstances, state.financeCommitmentInstances||[]);
    if(LS.financeLoanUsageLedger) save(LS.financeLoanUsageLedger, state.financeLoanUsageLedger||[]);
    if(LS.financeMeta) save(LS.financeMeta, state.financeMeta||{});
  }catch(e){}
}

function exposeWeekCtx(){
  window.state = state;
  window.persist = persist;
  window.view = view;
  window.__MC_WEEK_CTX__ = { state, persist, view, toast };
}

// ---- Backup (Export/Import) ----
function exportBackup(){
  const payload = {
    v: 2,
    exportedAt: new Date().toISOString(),
    routines: state.routines,
    shopping: state.shopping,
    reminders: state.reminders,
    musicToday: state.musicToday,
    musicLog: state.musicLog,
    sleepLog: state.sleepLog,
    budgetMonthly: state.budgetMonthly,
    calDraw: state.calDraw,
    house: state.house,
    moodDaily: state.moodDaily,
    moodSpritesCustom: state.moodSpritesCustom,
    products: state.products,
    shoppingHistory: state.shoppingHistory,
    inventory: state.inventory,
    inventoryLots: state.inventoryLots,
    financeAccounts: state.financeAccounts,
    financeLedger: state.financeLedger,
    financeDebts: state.financeDebts,
    financeCommitments: state.financeCommitments,
    financeObligations: state.financeObligations,
    financePaymentSources: state.financePaymentSources,
    financeTransactions: state.financeTransactions,
    financeInternalBalances: state.financeInternalBalances,
    financeInsights: state.financeInsights,
    financeSchemaVersion: state.financeSchemaVersion,
    financeCommitmentTemplates: state.financeCommitmentTemplates,
    financeCommitmentInstances: state.financeCommitmentInstances,
    financeLoanUsageLedger: state.financeLoanUsageLedger,
    financeMeta: state.financeMeta
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `memorycarl_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportBrainV2(){
  try{
    const payload = await collectBrainBackupData();
    const ts = new Date();
    const pad = (n)=>String(n).padStart(2, "0");
    const filename = `footballlab-brain-backup-v1-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.json`;
    downloadJson(filename, payload);
    toast("Backup descargado ✅");
  }catch(err){
    console.error(err);
    toast("Error al exportar backup ❌");
  }
}

function importBackup(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if(!data || typeof data !== "object") throw new Error("Invalid file");

      const routines = Array.isArray(data.routines) ? data.routines : [];
      const shopping = Array.isArray(data.shopping) ? data.shopping : [];
      const reminders = Array.isArray(data.reminders) ? data.reminders : [];
      const house = (data.house && typeof data.house === "object") ? data.house : null;
      const moodDaily = (data.moodDaily && typeof data.moodDaily === "object") ? data.moodDaily : {};
      const moodSpritesCustom = Array.isArray(data.moodSpritesCustom) ? data.moodSpritesCustom : [];
      const products = Array.isArray(data.products) ? data.products : [];
      const shoppingHistory = Array.isArray(data.shoppingHistory) ? data.shoppingHistory : [];
      const inventory = Array.isArray(data.inventory) ? data.inventory : [];
      const inventoryLots = Array.isArray(data.inventoryLots) ? data.inventoryLots : [];

      // Finance
      const financeAccounts = Array.isArray(data.financeAccounts) ? data.financeAccounts : [];
      const financeLedger = Array.isArray(data.financeLedger) ? data.financeLedger : [];
      const financeDebts = Array.isArray(data.financeDebts) ? data.financeDebts : [];
      const financeCommitments = Array.isArray(data.financeCommitments) ? data.financeCommitments : [];
      const financeObligations = Array.isArray(data.financeObligations) ? data.financeObligations : [];
      const financePaymentSources = Array.isArray(data.financePaymentSources) ? data.financePaymentSources : [];
      const financeTransactions = Array.isArray(data.financeTransactions) ? data.financeTransactions : [];
      const financeInternalBalances = Array.isArray(data.financeInternalBalances) ? data.financeInternalBalances : [];
      const financeInsights = Array.isArray(data.financeInsights) ? data.financeInsights : [];
      const financeCommitmentTemplates = Array.isArray(data.financeCommitmentTemplates) ? data.financeCommitmentTemplates : [];
      const financeCommitmentInstances = Array.isArray(data.financeCommitmentInstances) ? data.financeCommitmentInstances : [];
      const financeLoanUsageLedger = Array.isArray(data.financeLoanUsageLedger) ? data.financeLoanUsageLedger : [];
      const financeSchemaVersion = Number(data.financeSchemaVersion || 1);
      const financeMeta = (data.financeMeta && typeof data.financeMeta==="object") ? data.financeMeta : {};


      routines.forEach(r=>{
        r.id ||= uid("r");
        r.times = Array.isArray(r.times) ? r.times : [];
        r.steps = Array.isArray(r.steps) ? r.steps : [];
        r.steps.forEach(s=>{ s.id ||= uid("s"); s.done = !!s.done; });
        r.active = (r.active !== false);
      });
      shopping.forEach(l=>{
        l.id ||= uid("l");
        l.items = Array.isArray(l.items) ? l.items : [];
        l.items.forEach(it=>{
          it.id ||= uid("i");
          it.price = Number(it.price || 0);
          it.qty = Math.max(1, Number(it.qty || 1));
          it.bought = !!it.bought;
        });
      });
      reminders.forEach(m=>{
        m.id ||= uid("m");
        m.done = !!m.done;
      });

      state.routines = routines;
      state.shopping = shopping;
      state.reminders = reminders;
      if(house){ state.house = house; normalizeHouse(); }
      state.moodDaily = moodDaily;
      state.moodSpritesCustom = moodSpritesCustom;
      state.products = products;
      state.shoppingHistory = shoppingHistory;
      state.inventory = inventory;
      state.inventoryLots = inventoryLots;

      // Finance apply
      // IMPORTANT: Do NOT import/overwrite accounts from backups/snapshots.
      // We only import ledger/debts/commitments so historical charts work,
      // while keeping current accounts (balances) independent.
      if(financeLedger.length) state.financeLedger = financeSanitizeImportedLedger(financeLedger, { detachAccounts:true });
      state.financeDebts = financeDebts;
      state.financeCommitments = financeCommitments;
      state.financeObligations = financeObligations;
      state.financePaymentSources = financePaymentSources;
      state.financeTransactions = financeTransactions;
      state.financeInternalBalances = financeInternalBalances;
      state.financeInsights = financeInsights;
      state.financeCommitmentTemplates = financeCommitmentTemplates;
      state.financeCommitmentInstances = financeCommitmentInstances;
      state.financeLoanUsageLedger = financeLoanUsageLedger;
      state.financeSchemaVersion = financeSchemaVersion;
      state.financeMeta = financeMeta;
      try{ financeRecomputeBalances(); }catch(_e){}


      // Home widgets
      state.musicToday = (data.musicToday && typeof data.musicToday === "object") ? data.musicToday : load(LS.musicToday, null);
      state.musicLog = Array.isArray(data.musicLog) ? data.musicLog : load(LS.musicLog, []);
      state.sleepLog = Array.isArray(data.sleepLog) ? data.sleepLog : load(LS.sleepLog, []);
      state.budgetMonthly = Array.isArray(data.budgetMonthly) ? data.budgetMonthly : load(LS.budgetMonthly, []);
      state.calDraw = (data.calDraw && typeof data.calDraw === "object") ? data.calDraw : load(LS.calDraw, {});
      if(!house) state.house = load(LS.house, seedHouse());
      state.musicCursor = 0;

      persist();
      view();
      toast("Backup imported ✅");
    }catch(e){
      toast("Invalid backup ❌");
    }
  };
  reader.readAsText(file);
}

async function importBrainV2(file){
  if(!file) return;
  if(!confirm("Esto reemplazará el cerebro actual. ¿Deseas continuar?")) return;
  try{
    const imported = await importBrainBackupFromFile(file);
    if(imported?.restoreMeta?.compacted){
      toast("Backup restaurado con compactación por espacio limitado ⚠️");
    }else if(String(imported?.schema?.brainVersion || "") !== "v2"){
      toast("Importado, pero algunos campos pueden ser ignorados ⚠️");
    }else{
      toast("Backup restaurado. Recargando datos… ✅");
    }
    setTimeout(()=>location.reload(), 260);
  }catch(err){
    console.error(err);
    alert(err?.message || "No se pudo importar el backup.");
  }
}


function restoreFromSnapshotText(rawText){
  const text = (rawText || "").trim();
  if(!text){ alert("Pega un JSON primero."); return; }

  let snap;
  try{
    snap = JSON.parse(text);
  }catch(e){
    console.error("restoreFromSnapshotText JSON.parse failed", e);
    alert("JSON inválido. Asegúrate de pegarlo completo (de { hasta }).");
    return;
  }

  // Soportar formatos:
  // 1) STATE_SNAPSHOT: {app,v,ts,reason,data:{...}}
  // 2) Export Backup: {v, exportedAt, routines, shopping, ...}
  // 3) Data directo: {routines, shopping, ...}
  const payload = (snap && typeof snap === "object" && snap.data && typeof snap.data === "object") ? snap.data : snap;


// If we have a raw localStorage dump, restore EXACTLY and reload.
// This fixes the "snapshot vs export" mismatch by bringing back every key.
if(payload && typeof payload === "object" && payload.lsRaw && typeof payload.lsRaw === "object"){
  const ok = restoreMcLocalStorageRaw(payload.lsRaw);
  if(ok){
    try{ toast("Restore completo aplicado ✅ (recargando)"); }catch(e){}
    setTimeout(()=>location.reload(), 250);
    return;
  }
}

  // Backup rápido (in-memory) por si el usuario quiere copiarlo
  try{
    window.__mc_last_restore_payload = payload;
  }catch(e){}

  const apply = (keyName, value) => {
    if(value === undefined) return;
    try{ state[keyName] = value; }catch(e){}
    try{
      const lsKey = (LS && LS[keyName]) ? LS[keyName] : null;
      if(lsKey) save(lsKey, value);
    }catch(e){}
  };

  // Módulos principales
  apply("routines", payload.routines);
  apply("shopping", payload.shopping);
  // Reminders: soportar reminders/reminder
  const rem = (payload.reminders !== undefined) ? payload.reminders : (payload.reminder !== undefined ? payload.reminder : undefined);
  apply("reminders", rem);

  apply("musicToday", payload.musicToday);
  apply("musicLog", payload.musicLog);
  apply("sleepLog", payload.sleepLog);
  apply("budgetMonthly", payload.budgetMonthly);
  apply("calDraw", payload.calDraw);
  apply("house", payload.house);
  apply("moodDaily", payload.moodDaily);
  apply("moodSpritesCustom", payload.moodSpritesCustom);

  // Shopping rebuilt module keys (si existen en esta versión)
  if(payload.products !== undefined){ try{ LS.products = LS.products || "memorycarl_v2_products"; }catch(e){} apply("products", payload.products); }
  if(payload.shoppingHistory !== undefined){ try{ LS.shoppingHistory = LS.shoppingHistory || "memorycarl_v2_shopping_history"; }catch(e){} apply("shoppingHistory", payload.shoppingHistory); }
  if(payload.inventory !== undefined){ try{ LS.inventory = LS.inventory || "memorycarl_v2_inventory"; }catch(e){} apply("inventory", payload.inventory); }
if(payload.inventoryLots !== undefined){ try{ LS.inventoryLots = LS.inventoryLots || "memorycarl_v2_inventory_lots"; }catch(e){} apply("inventoryLots", payload.inventoryLots); }


// Finance Core
const finApplyRaw = (lsKey, value) => {
  if(value === undefined) return;
  try{ localStorage.setItem(lsKey, JSON.stringify(value)); }catch(e){}
};
if(payload.finance_accounts !== undefined) finApplyRaw("memorycarl_v2_finance_accounts", payload.finance_accounts);
if(payload.finance_ledger !== undefined) finApplyRaw("memorycarl_v2_finance_ledger", payload.finance_ledger);
if(payload.finance_debts !== undefined) finApplyRaw("memorycarl_v2_finance_debts", payload.finance_debts);
if(payload.finance_commitments !== undefined) finApplyRaw("memorycarl_v2_finance_commitments", payload.finance_commitments);
if(payload.finance_obligations !== undefined) finApplyRaw("memorycarl_v2_finance_obligations", payload.finance_obligations);
if(payload.finance_payment_sources !== undefined) finApplyRaw("memorycarl_v2_finance_payment_sources", payload.finance_payment_sources);
if(payload.finance_transactions !== undefined) finApplyRaw("memorycarl_v2_finance_transactions", payload.finance_transactions);
if(payload.finance_internal_balances !== undefined) finApplyRaw("memorycarl_v2_finance_internal_balances", payload.finance_internal_balances);
if(payload.finance_insights !== undefined) finApplyRaw("memorycarl_v2_finance_insights", payload.finance_insights);
if(payload.finance_commitment_templates !== undefined) finApplyRaw("memorycarl_v2_finance_commitment_templates", payload.finance_commitment_templates);
if(payload.finance_commitment_instances !== undefined) finApplyRaw("memorycarl_v2_finance_commitment_instances", payload.finance_commitment_instances);
if(payload.finance_loan_usage_ledger !== undefined) finApplyRaw("memorycarl_v2_finance_loan_usage_ledger", payload.finance_loan_usage_ledger);
if(payload.finance_schema_version !== undefined) finApplyRaw("memorycarl_v2_finance_schema_version", payload.finance_schema_version);
if(payload.finance_categories !== undefined) finApplyRaw("memorycarl_v2_finance_categories", payload.finance_categories);
if(payload.finance_meta !== undefined) finApplyRaw("memorycarl_v2_finance_meta", payload.finance_meta);
if(payload.finance_projection_mode !== undefined) try{ localStorage.setItem("memorycarl_v2_finance_projection_mode", String(payload.finance_projection_mode||"")); }catch(e){}
if(payload.finance_resetAt !== undefined) try{ localStorage.setItem("memorycarl_v2_finance_resetAt", String(payload.finance_resetAt||"")); }catch(e){}

  // Compat: algunas versiones guardaron reminders en singular
  try{
    if(rem !== undefined){
      localStorage.setItem("memorycarl_v2_reminder", JSON.stringify(rem));
    }
  }catch(e){}

  

// Credenciales / Settings (opcional)
if(payload.syncUrl !== undefined) try{ setSyncUrl(payload.syncUrl); }catch(e){}
if(payload.syncApiKey !== undefined) try{ setSyncApiKey(payload.syncApiKey); }catch(e){}
if(payload.neuroclawAiUrl !== undefined) try{ localStorage.setItem(LS.neuroclawAiUrl, String(payload.neuroclawAiUrl||"")); }catch(e){}
if(payload.neuroclawAiKey !== undefined) try{ localStorage.setItem(LS.neuroclawAiKey, String(payload.neuroclawAiKey||"")); }catch(e){}
if(payload.swissAstroUrl !== undefined) try{ localStorage.setItem("memorycarl_v2_swiss_astro_url", String(payload.swissAstroUrl||"")); }catch(e){}
if(payload.swissAstroKey !== undefined) try{ localStorage.setItem("memorycarl_v2_swiss_astro_key", String(payload.swissAstroKey||"")); }catch(e){}
// Registrar evento
  try{
    const evKey = "memorycarl_v2_event_log";
    const ev = load(evKey, []);
    ev.push({
      id: "ev_restore_" + Date.now(),
      ts: new Date().toISOString(),
      type: "restore_from_snapshot",
      source: (snap && snap.reason) ? "STATE_SNAPSHOT" : "backup_json",
      snapshot_ts: snap?.ts || null,
      snapshot_reason: snap?.reason || null
    });
    save(evKey, ev);
  }catch(e){}

  try{ toast("Restore aplicado ✅ (recargando)"); }catch(e){}
  setTimeout(()=>location.reload(), 250);
}





// ---- Snapshot import (from Google Sheet via Apps Script) ----
function syncCfgLabelText(){
  const url = getSyncUrl();
  const key = getSyncApiKey();
  if(!url) return "Sync: (no configurado)";
  const short = url.length > 44 ? (url.slice(0,34) + "…" + url.slice(-8)) : url;
  return `Sync: ${short}${key ? " • key✅" : ""}`;
}

function openSyncConfig(){
  const currentUrl = getSyncUrl();
  const url = prompt("Apps Script Web App URL (termina en /exec):", currentUrl || "");
  if(url !== null) setSyncUrl(url);
  const currentKey = getSyncApiKey();
  const k = prompt("API key (opcional, si tu script lo requiere):", currentKey || "");
  if(k !== null) setSyncApiKey(k);
}

async function fetchLatestSnapshotFromSheet(){
  // Requiere que tu Apps Script soporte GET con CORS y devuelva JSON/text.
  if(!getSyncUrl() && !ensureSyncConfigured()){
    toast("Sync no configurado");
    return;
  }

  const base = getSyncUrl();
  const apiKey = getSyncApiKey();
  const url = base + (base.includes("?") ? "&" : "?") + "action=latest_snapshot" + (apiKey ? ("&apiKey=" + encodeURIComponent(apiKey)) : "");

  try{
    toast("Buscando snapshot…");
    const res = await fetch(url, { method:"GET", cache:"no-store", mode:"cors" });
    const txt = await res.text();

    // Puede venir como {ok:true,snapshot:{...}} o directamente el snapshot JSON
    let obj;
    try{ obj = JSON.parse(txt); }catch(e){ obj = null; }

    const snap = (obj && typeof obj === "object" && (obj.snapshot || obj.data || obj.app)) 
      ? (obj.snapshot || obj) 
      : null;

    if(!snap){
      // Si no pudimos parsear, igual lo dejamos como texto en el textarea para copia manual
      const ta = document.querySelector("#restoreSnapText");
      if(ta) ta.value = txt;
      alert("No pude detectar un snapshot JSON automático. Igual pegué la respuesta en el cuadro para que lo revises.");
      return;
    }

    const pretty = JSON.stringify(snap, null, 2);
    const ta = document.querySelector("#restoreSnapText");
    if(ta) ta.value = pretty;

    toast("Snapshot cargado ✅");
  }catch(e){
    console.warn("fetchLatestSnapshotFromSheet failed", e);
    alert(
      "No pude leer el snapshot desde el Sheet.\n\n" +
      "Causas comunes:\n" +
      "• Tu Apps Script no está devolviendo CORS (Access-Control-Allow-Origin)\n" +
      "• El Web App requiere autenticación\n\n" +
      "Solución rápida:\n" +
      "1) Abre el Apps Script URL en una pestaña y copia el JSON\n" +
      "2) Pégalo aquí y dale Restaurar"
    );
  }
}


// ---- UI ----
function bottomNav(){
  const mk = (tab, icon, label) => `
    <button class="bn ${state.tab===tab ? "active":""}" data-tab="${tab}" aria-label="${escapeHtml(label)}">
      <div class="bnIcon">${icon}</div>
      <div class="bnLabel">${escapeHtml(label)}</div>
    </button>
  `;

  const mkMore = () => `
    <button class="bn ${(["reminders","calendar","learn","settings"].includes(state.tab) || state.moreOpen) ? "active" : ""}" data-more="1" aria-label="Más">
      <div class="bnIcon">⋯</div>
      <div class="bnLabel">Más</div>
    </button>
  `;

  return `
    <nav class="bottomNav" role="navigation" aria-label="MemoryCarl navigation">
      ${mk("home","🏠","Home")}
      ${mk("neurochat","🧠","NeuroChat")}
      ${/* mk("semana","🍽️","Semana") — comentado para dar paso a NeuroChat */ ""}
      ${mk("house","🧹","Casa")}
      ${mk("routines","📝","Rutinas")}
      ${mk("shopping","🛒","Compras")}
      ${mk("finance","💰","Finanzas")}
      ${mkMore()}
    </nav>
  `;
}

function renderMoreModal(){
  const mk = (tab, icon, label, sub) => `
    <button class="item" data-more-tab="${escapeHtml(tab)}" style="justify-content:space-between;">
      <div class="row" style="gap:10px;align-items:center;">
        <div class="tag">${icon}</div>
        <div>
          <div style="font-weight:800;">${escapeHtml(label)}</div>
          ${sub ? `<div class="muted" style="margin-top:2px;">${escapeHtml(sub)}</div>` : ``}
        </div>
      </div>
      <div class="muted">›</div>
    </button>
  `;

  return `
    <div class="modalBackdrop" id="moreBackdrop" aria-label="Más">
      <div class="modal">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <h2 style="margin:0;">Más</h2>
          <button class="iconBtn" id="btnMoreClose">Cerrar</button>
        </div>

        <div class="list" style="margin-top:12px;">
          ${mk("reminders","⏰","Reminders","Pendientes + notifs")}
          ${mk("calendar","📅","Calendario","Dibuja X, notas")}
          ${mk("learn","🧠","Aprender","Mini contenido")}
          ${mk("insights","📊","Insights","Todo por día")}
          ${mk("football","⚽","Football Lab","Equipos, jugadores, ratings")}
          ${mk("neurochat","💬","NeuroChat","Conversación con memoria viva")}
          ${mk("settings","⚙️","Ajustes","Backup, sync, etc")}
        </div>
      </div>
    </div>
  `;
}

function view(){
  window.renderApp = view; // Expose for other modules to trigger re-renders
  try{ if(window.__mcBoot && !window.__mcBoot.done) window.__mcBoot.done = true; }catch(_e){}
  // Keep a fresh global signals bag (used by NeuroBubble and other small agents)
  try{ refreshGlobalSignals(); }catch(e){}
  const root = document.querySelector("#app");
  exposeWeekCtx();
  root.innerHTML = `
    <div class="app ${state.tab==="settings" ? "hasSheet":""}">
      <header class="header">
        <div class="brand">
          <h1>MemoryCarl</h1>
          <div class="pill">local • phone-first</div>
        </div>
      </header>

      <main class="content">
        ${state.tab==="home" ? viewHome() : ""}
        ${state.tab==="semana" ? viewSemana() : ""}
        ${state.tab==="routines" ? viewRoutines() : ""}
        ${state.tab==="shopping" ? viewShopping() : ""}
        ${state.tab==="reminders" ? viewReminders() : ""}
        ${state.tab==="house" ? viewHouse() : ""}
        ${state.tab==="calendar" ? viewCalendar() : ""}
        ${state.tab==="learn" ? viewLearn() : ""}
        ${state.tab==="insights" ? viewInsights() : ""}
        ${state.tab==="finance" ? viewFinance() : ""}
        ${state.tab==="settings" ? viewSettings() : ""}
        ${state.tab==="football" ? viewFootball() : ""}
        ${state.tab==="neurochat" ? viewNeuroChat() : ""}
        ${state.tab==="tarot" ? viewTarot() : ""}
        ${state.tab==="dayengine" ? (dayUiState.view === "detail" && dayUiState.selectedDayId
          ? viewDayDetail(getDaysForEngine().find(d => d.id === dayUiState.selectedDayId) || null)
          : viewDayCalendar()) : ""}
      </main>

      ${state.tab==="settings" ? `
      <div class="sheetScrim" id="sheetScrim" aria-hidden="true"></div>
      <section class="bottomSheet" id="bottomSheet" aria-label="Settings actions panel">
        <div class="sheetHandle" id="sheetHandle" role="button" tabindex="0" aria-expanded="false">
          <div class="handleBar" aria-hidden="true"></div>
          <div class="sheetHandleRow">
            <div class="sheetTitle">Acciones</div>
            <button class="iconBtn" id="sheetToggle" aria-label="Toggle actions panel">▴</button>
          </div>
        </div>
        <div class="sheetBody">
          <div class="row" style="margin:0;">
            <button class="btn primary" id="btnBrainExport">Exportar cerebro (backup)</button>
            <label class="btn" style="cursor:pointer;">
              Importar cerebro (restaurar)
              <input id="fileBrainImport" type="file" accept="application/json" style="display:none;">
            </label>
            <button class="btn" id="btnExport">Export</button>
            <button class="btn primary" id="btnNotif">Enable Notifs</button>
            <button class="btn" id="btnCopyToken">Copy Token</button>
            <label class="btn" style="cursor:pointer;">
              Import
              <input id="fileImport" type="file" accept="application/json" style="display:none;">
            </label>
          </div>
          <div class="muted" style="margin-top:10px;">Exportar/Importar cerebro crea un backup completo de FootballLab/Brain v2 (IndexedDB + localStorage) y recarga la app tras restaurar.</div>
        </div>
      </section>` : ""}

      <div class="fab" id="fab">+</div>
      <div id="toastHost"></div>

      ${renderHouseZoneSheet()}

      ${state.house && state.house.historyOpen ? renderHouseHistoryModal() : ""}
      ${state.insightsDayOpen ? renderInsightsDayModal() : ""}

      ${state.neuroDebugOpen ? renderNeuroDebugModal() : ""}

      ${bottomNav()}

      ${state.moreOpen ? renderMoreModal() : ""}
    </div>
  `;

  
  // Bottom sheet (Settings)
  if(state.tab==="settings"){
    initBottomSheet();

    const btnCopy = root.querySelector("#btnNcAiCopy");
    if(btnCopy){
      btnCopy.addEventListener("click", async ()=>{
        const log = getAiLog();
        const payload = JSON.stringify({ exportedAt: Date.now(), log }, null, 2);
        try{
          await navigator.clipboard.writeText(payload);
          if(typeof toast==="function") toast("JSON copiado ✅");
        }catch(e){
          // Fallback
          try{
            const ta = document.createElement("textarea");
            ta.value = payload;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
            if(typeof toast==="function") toast("JSON copiado ✅");
          }catch(_e){
            alert("No pude copiar. Abre consola y usa getAiLog()");
          }
        }
      });
    }

    const btnDl = root.querySelector("#btnNcAiDownload");
    if(btnDl){
      btnDl.addEventListener("click", ()=>{
        const log = getAiLog();
        const payload = JSON.stringify({ exportedAt: Date.now(), log }, null, 2);
        const blob = new Blob([payload], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const today = (typeof getTodayIso === "function") ? getTodayIso() : new Date().toISOString().slice(0,10);
        a.href = url;
        a.download = `neuroclaw_ai_log_${today}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(()=>URL.revokeObjectURL(url), 1500);
        try{ if(typeof toast==="function") toast("Descargando… 📦"); }catch(e){}
      });
    }

    const btnReset = root.querySelector("#btnNcAiReset");
    if(btnReset){
      btnReset.addEventListener("click", ()=>{
        resetNeuroAiCallsToday();
        try{ if(typeof toast==="function") toast("Contador reseteado (hoy) ✅"); }catch(e){}
        view();
      });
    }

    const semanaKeyInp = root.querySelector("#semanaGeminiApiKey");
    const btnSemanaKeySave = root.querySelector("#btnSemanaGeminiSave");
    const btnSemanaKeyClear = root.querySelector("#btnSemanaGeminiClear");
    if(semanaKeyInp){
      semanaKeyInp.value = getSemanaGeminiApiKey();
    }
    if(btnSemanaKeySave){
      btnSemanaKeySave.addEventListener("click", ()=>{
        const next = semanaKeyInp ? String(semanaKeyInp.value || "").trim() : "";
        const ok = setSemanaGeminiApiKey(next);
        if(!ok){
          try{ toast("No pude guardar la key (sin espacio local)."); }catch(_e){}
          return;
        }
        try{ toast(next ? "API key de Semana guardada ✅" : "API key de Semana vaciada"); }catch(_e){}
      });
    }
    if(btnSemanaKeyClear){
      btnSemanaKeyClear.addEventListener("click", ()=>{
        const ok = setSemanaGeminiApiKey("");
        if(semanaKeyInp) semanaKeyInp.value = "";
        if(!ok){
          try{ toast("No pude limpiar la key (sin espacio local)."); }catch(_e){}
          return;
        }
        try{ toast("API key de Semana eliminada 🧽"); }catch(_e){}
      });
    }

    // ---- Astro (Cosmic Lite) wiring ----
    const taNatal = root.querySelector("#natalJsonText");
    if(taNatal){
      const existing = loadNatalChart();
      if(existing) taNatal.value = JSON.stringify(existing, null, 2);
    }

    const fileNatal = root.querySelector("#fileNatal");
    if(fileNatal) fileNatal.addEventListener("change", async (e)=>{
      const f = e.target.files?.[0];
      if(!f) return;
      try{
        const txt = await f.text();
        if(taNatal) taNatal.value = txt;
        try{ toast("JSON cargado. Dale Guardar ✅"); }catch(_e){}
      }catch(err){
        console.warn("Natal file read failed", err);
        try{ toast("No pude leer ese archivo 😅"); }catch(_e){}
      }
      e.target.value = "";
    });

    const chipNatal = root.querySelector("#chipNatalStatus");
    const btnNatalSave = root.querySelector("#btnNatalSave");
    if(btnNatalSave) btnNatalSave.addEventListener("click", ()=>{
      const raw = (taNatal && taNatal.value) ? taNatal.value.trim() : "";
      if(!raw){
        try{ toast("Pega un JSON primero ✍️"); }catch(_e){}
        return;
      }
      try{
        const parsed = JSON.parse(raw);
        const ok = saveNatalChart(parsed);
        if(!ok) throw new Error("save failed");
        refreshGlobalSignals();
        if(chipNatal) chipNatal.textContent = "Carta ✅";
        try{ toast("Carta guardada ✅"); }catch(_e){}
      }catch(err){
        console.warn("Natal JSON invalid", err);
        alert("JSON inválido. Revisa comas, llaves y comillas.");
      }
    });

    const btnNatalDl = root.querySelector("#btnNatalDownload");
    if(btnNatalDl) btnNatalDl.addEventListener("click", ()=>{
      const natal = loadNatalChart();
      if(!natal){
        try{ toast("Aún no hay carta guardada"); }catch(_e){}
        return;
      }
      const payload = JSON.stringify(natal, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `memorycarl_natal_chart_${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 1500);
    });

    const btnNatalReset = root.querySelector("#btnNatalReset");
    if(btnNatalReset) btnNatalReset.addEventListener("click", ()=>{
      if(!confirm("Resetear carta natal guardada en este dispositivo?")) return;
      clearNatalChart();
      refreshGlobalSignals();
      if(chipNatal) chipNatal.textContent = "Sin carta";
      if(taNatal) taNatal.value = "";
      try{ toast("Reseteado 🧽"); }catch(_e){}
    });

    const btnAstroRefresh = root.querySelector("#btnAstroRefresh");
    if(btnAstroRefresh) btnAstroRefresh.addEventListener("click", async ()=>{
      const sig = refreshGlobalSignals();
      const label = root.querySelector("#astroTodayLabel");
      if(label) label.textContent = `${sig.moon_phase_name} • Luna en ${sig.moon_sign}`;
      const tlabel = root.querySelector("#astroTransitLabel");
      if(tlabel) tlabel.textContent = sig.transit_top || "";
      await refreshSwissTransitsUI({ forceSpeak:false });
      try{ toast("Listo 🌙"); }catch(_e){}
    });

    const btnAstroTestBubble = root.querySelector("#btnAstroTestBubble");
    if(btnAstroTestBubble) btnAstroTestBubble.addEventListener("click", ()=>{
      // Trigger a normal bubble read (same as tapping the bubble)
      const el = document.querySelector("#neuroBubble");
      if(el){
        el.dispatchEvent(new MouseEvent("click", { bubbles:true }));
      }else{
        alert("No encontré Bubble en pantalla. Vuelve a Home y asegúrate que aparece.");
      }

    });

    // Bubble whisper frequency (minutes)
    const selFreq = root.querySelector("#bubbleFreq");
    const btnFreqSave = root.querySelector("#btnBubbleFreqSave");
    if(selFreq){
      // load saved
      try{
        const raw = localStorage.getItem(LS.bubbleFreqMin) || localStorage.getItem("mc_bubble_cooldown_min");
        const v = raw ? String(raw) : "60";
        selFreq.value = ["30","60","120","240"].includes(v) ? v : "60";
      }catch(e){}
    }
    if(btnFreqSave){
      btnFreqSave.addEventListener("click", ()=>{
        const v = selFreq ? String(selFreq.value||"60") : "60";
        try{ localStorage.setItem(LS.bubbleFreqMin, v); }catch(e){}
        // legacy key
        try{ localStorage.setItem("mc_bubble_cooldown_min", v); }catch(e){}
        try{ if(typeof toast==="function") toast("Bubble actualizado 🫧"); }catch(e){}
      });
    }

    // Astro provider wiring
    const selProv = root.querySelector("#astroProvider");
    const btnProvSave = root.querySelector("#btnAstroProviderSave");
    const swissStatus = root.querySelector("#astroSwissStatus");
    if(selProv){
      selProv.value = getAstroProvider();
    }
    if(swissStatus){
      swissStatus.textContent = swissTransitsAvailable()
        ? "Swiss listo ✅"
        : "Swiss: configura Swiss Astro URL+Key";
    }
    if(btnProvSave) btnProvSave.addEventListener("click", async ()=>{
      const v = selProv ? String(selProv.value||"lite") : "lite";
      setAstroProvider(v);
      refreshGlobalSignals();
      if(v === "swiss"){
        if(!ensureSwissAstroConfigured()){
          // revert to lite if user cancels
          setAstroProvider("lite");
          if(selProv) selProv.value = "lite";
          refreshGlobalSignals();
          if(swissStatus) swissStatus.textContent = "Swiss: no configurado";
          toast("Swiss cancelado");
          return;
        }
        await refreshSwissTransitsUI({ forceSpeak:true });
      }else{
        const sig = refreshGlobalSignals();
        const lab = root.querySelector("#astroTransitLabel");
        if(lab) lab.textContent = sig.transit_top || "";
        const chip = root.querySelector("#chipTransitEngine");
        if(chip) chip.textContent = "lite_v1";
      }
      try{ toast("Motor guardado ✅"); }catch(_e){}
    });

    const btnSwissPing = root.querySelector("#btnAstroSwissPing");
    if(btnSwissPing) btnSwissPing.addEventListener("click", async ()=>{
      await refreshSwissTransitsUI({ forceSpeak:true });
    });

  }

  
  // Insights wiring
  if(state.tab==="insights"){
    const prev = root.querySelector("#btnInsPrev");
    const next = root.querySelector("#btnInsNext");
    if(prev) prev.addEventListener("click", ()=>{ state.insightsMonthOffset = (Number(state.insightsMonthOffset)||0) - 1; view(); });
    if(next) next.addEventListener("click", ()=>{ state.insightsMonthOffset = (Number(state.insightsMonthOffset)||0) + 1; view(); });
    root.querySelectorAll("[data-ins-day]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const iso = btn.dataset.insDay || "";
        if(iso) openInsightsDayOverlay(iso);
      });
    });
  }

// Insights day modal wiring — now handled inside openInsightsDayOverlay() DOM overlay

  
  // NeuroClaw wiring (Home + Debug modal)
  if(state.tab==="home"){
    const btnN = root.querySelector("#btnNeuroAnalyze");
    if(btnN){
      btnN.addEventListener("click", (e)=>{
        // Open debug modal and (re)run analysis
        state.neuroDebugOpen = true;
        persist();
        try{ ensureNeuroAiConfigured(); }catch(_e){}
        neuroclawRunNow({ animate:true });
        view();
      });
    }
    root.querySelectorAll("[data-neuro-rate][data-neuro-id]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.dataset.neuroId || "";
        const rate = btn.dataset.neuroRate || "";
        if(!id || !rate) return;
        state.neuroclawFeedback = Array.isArray(state.neuroclawFeedback) ? state.neuroclawFeedback : [];
        state.neuroclawFeedback.push({ id, rate, ts: Date.now() });
        persist();
        try{ toast(rate==="up" ? "Guardado 👍" : "Guardado 👎"); }catch(e){}
      });
    });
  }

  if(state.neuroDebugOpen){
    const b = root.querySelector("#neuroDbgBackdrop");
    const c = root.querySelector("#btnNeuroDbgClose");
    const r = root.querySelector("#btnNeuroDbgRerun");
    const cp = root.querySelector("#btnNeuroDbgCopy");
    const close = ()=>{ state.neuroDebugOpen=false; persist(); view(); };
    if(b) b.addEventListener("click",(e)=>{ if(e.target===b) close(); });
    if(c) c.addEventListener("click", close);
    if(r) r.addEventListener("click", ()=>{ neuroclawRunNow({ animate:true }); });
    if(cp) cp.addEventListener("click", async ()=>{
      try{
        const sig = state.neuroclawLast?.signals || {};
        await navigator.clipboard.writeText(JSON.stringify(sig, null, 2));
        try{ toast("Señales copiadas ✅"); }catch(e){}
      }catch(e){
        console.warn("Clipboard failed", e);
        try{ toast("No pude copiar 😅"); }catch(_){}
      }
    });
  }

  // House history modal wiring + button
  if(state.tab==="house"){
    const btnH = root.querySelector("#btnHouseHistory");
    if(btnH) btnH.addEventListener("click", ()=>{
      state.house = state.house || seedHouse();
      state.house.historyOpen = true;
      view();
    });
  }
  if(state.house && state.house.historyOpen){
    const b = root.querySelector("#houseHistoryBackdrop");
    if(b){
      b.addEventListener("click",(e)=>{ if(e.target===b){ state.house.historyOpen=false; view(); }});
    }
    const c = root.querySelector("#btnHouseHistoryClose");
    if(c) c.addEventListener("click", ()=>{ state.house.historyOpen=false; view(); });
    root.querySelectorAll("[data-house-history-clear]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        if(confirm("Borrar historial de sesiones?")){
          state.house.sessionHistory = [];
          state.house.historyOpen = false;
          persist(); view();
        }
      });
    });
  }

  // Shopping AI wiring
  if(state.tab === "shopping" && state.shoppingSubtab === "ai"){
    const btnSend = root.querySelector("#btnShopAiSend");
    const btnClear = root.querySelector("#btnShopAiClear");
    const btnCloseDay = root.querySelector("#btnShopAiCloseDay");
    const inp = root.querySelector("#shopAiMsgInp");

    // Auto-archive check: if date changed, archive old chat?
    // The user requested to manually close it, so we rely on the button.

    const doSend = async () => {
      const text = inp ? inp.value.trim() : "";
      if(!text) return;

      const typing = root.querySelector("#shopAiTyping");
      if(typing) typing.style.display = "block";
      if(inp) { inp.value = ""; inp.disabled = true; }
      if(btnSend) btnSend.disabled = true;

      try {
        const products = Array.isArray(state.products) ? state.products : [];
        const pastDays = Array.isArray(state.shoppingAiDays) ? state.shoppingAiDays : [];
        const inventory = Array.isArray(state.inventory) ? state.inventory : [];

        // Set day date if empty
        if(!state.shoppingAiDayDate) state.shoppingAiDayDate = todayISO();

        const result = await sendShoppingAiMessage(
          text,
          Array.isArray(state.shoppingAiChat) ? state.shoppingAiChat : [],
          products,
          pastDays,
          inventory
        );
        state.shoppingAiChat = result.newChat;
        
        // Handle inventory deduction
        if (result.actions && Array.isArray(result.actions.consume)) {
          let deductedMsgs = [];
          result.actions.consume.forEach(item => {
            if (!item.name || !item.qty) return;
            const invItem = inventory.find(i => i.name.toLowerCase() === item.name.toLowerCase());
            if (invItem) {
              const currentQty = Number(invItem.qty) || 0;
              const deductQty = Number(item.qty) || 0;
              invItem.qty = Math.max(0, currentQty - deductQty);
              deductedMsgs.push(`${invItem.name} (-${deductQty})`);
            }
          });
          
          if (deductedMsgs.length > 0) {
            toast(`Chef AI descontó de inventario: ${deductedMsgs.join(", ")}`);
          }
        }
        
        persist();
      } catch (err) {
        alert("Chef AI: " + err.message);
      } finally {
        if(typing) typing.style.display = "none";
        if(inp) inp.disabled = false;
        if(btnSend) btnSend.disabled = false;
        view();
        setTimeout(() => {
          const log = document.getElementById("shopAiChatLog");
          if(log) log.scrollTop = log.scrollHeight;
        }, 50);
      }
    };

    if(btnSend) btnSend.addEventListener("click", doSend);
    if(inp){
      inp.addEventListener("keydown", (e) => {
        if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); doSend(); }
      });
    }
    if(btnClear){
      btnClear.addEventListener("click", () => {
        if(confirm("¿Borrar el historial del Chef AI? Perderás el contexto de la conversación.")){
          state.shoppingAiChat = [];
          state.shoppingAiDayDate = "";
          persist();
          view();
        }
      });
    }
    if(btnCloseDay){
      btnCloseDay.addEventListener("click", async () => {
        if(!confirm("¿Cerrar el registro de este día y guardarlo en el historial?")) return;
        
        const btn = btnCloseDay;
        const oldText = btn.innerHTML;
        btn.innerHTML = "Generando resumen...";
        btn.disabled = true;

        try {
          const chat = state.shoppingAiChat || [];
          const products = state.products || [];
          
          const result = await generateDaySummary(chat, products);
          
          const newDay = {
            date: state.shoppingAiDayDate || todayISO(),
            closedAt: new Date().toISOString(),
            messages: chat,
            summary: result.summary,
            estimatedCost: result.estimatedCost,
            editedNotes: ""
          };

          if(!Array.isArray(state.shoppingAiDays)) state.shoppingAiDays = [];
          state.shoppingAiDays.push(newDay);
          
          // Clear current chat
          state.shoppingAiChat = [];
          state.shoppingAiDayDate = "";
          persist();
          
          toast("Día cerrado y guardado en el Historial ✅");
          state.shoppingSubtab = "history";
          view();
        } catch(e) {
          alert("Error al cerrar el día: " + e.message);
          btn.innerHTML = oldText;
          btn.disabled = false;
        }
      });
    }

    setTimeout(() => {
      const log = document.getElementById("shopAiChatLog");
      if(log) log.scrollTop = log.scrollHeight;
    }, 50);
  }

  // Shopping AI History wiring
  if(state.tab === "shopping" && state.shoppingSubtab === "history"){
    root.querySelectorAll(".btnSaveDayNote").forEach(btn => {
      btn.addEventListener("click", () => {
        const dStr = btn.dataset.date;
        const txta = root.querySelector(`.shopAiDayNote[data-date="${dStr}"]`);
        if(!txta) return;
        
        const day = state.shoppingAiDays.find(x => x.date === dStr);
        if(day){
          day.editedNotes = txta.value.trim();
          persist();
          toast("Notas guardadas ✅");
        }
      });
    });
  }

  // Bottom nav wiring

  root.querySelectorAll(".bn[data-tab]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      state.tab = btn.dataset.tab;
      state.moreOpen = false;
      view();
    });
  });

  const moreBtn = root.querySelector('.bn[data-more="1"]');
  if(moreBtn) moreBtn.addEventListener("click", ()=>{
    state.moreOpen = true;
    view();
  });

  const moreBackdrop = root.querySelector("#moreBackdrop");
  if(moreBackdrop){
    moreBackdrop.addEventListener("click", (e)=>{
      if(e.target === moreBackdrop){ state.moreOpen = false; view(); }
    });
    const closeBtn = moreBackdrop.querySelector("#btnMoreClose");
    if(closeBtn) closeBtn.addEventListener("click", ()=>{ state.moreOpen = false; view(); });
    moreBackdrop.querySelectorAll("[data-more-tab]").forEach(x=>{
      x.addEventListener("click", ()=>{
        const t = x.getAttribute("data-more-tab") || "home";
        state.moreOpen = false;
        state.tab = t;
        view();
      });
    });
  }



  // Football Lab tab init
  if(state.tab==="football"){
    try{ initFootballTab(root); }catch(e){ console.error(e); }
  }
  // NeuroChat tab init
  if(state.tab==="neurochat"){
    try{ wireNeuroChat(root); }catch(e){ console.error(e); }
  }
  // Tarot tab init
  if(state.tab==="tarot"){
    try{ injectTarotStyles(); wireTarot(root); }catch(e){ console.error(e); }
  }
  // Daily Memory Engine tab init
  if(state.tab==="dayengine"){
    try{
      const rerender = () => render();
      if(dayUiState.view === "detail"){
        wireDayDetail(root, rerender);
      } else {
        wireDayCalendar(root, rerender);
      }
    }catch(e){ console.error(e); }
  }
  if(state.tab==="semana"){
    try{ wireSemana(); }catch(e){ console.error(e); }
  }
  // FAB action per tab (disabled on Learn)
  const fab = root.querySelector("#fab");
  if(fab){
    fab.style.display = (state.tab==="learn" || state.tab==="settings" || state.tab==="neurochat" || state.tab==="dayengine" || state.tab==="semana") ? "none" : "flex";
    fab.addEventListener("click", ()=>{
    if(state.tab==="home") openMusicModal();
    if(state.tab==="routines") openRoutineModal();
    if(state.tab==="shopping") openShoppingModal();
    if(state.tab==="reminders") openReminderModal();
		if(state.tab==="house") openHouseTaskModal();
	    if(state.tab==="calendar") openCalendarDrawModal(isoDate(new Date()));
  });

  
  const btnMergeCfg = root.querySelector("#btnMergeCfg");
  if(btnMergeCfg) btnMergeCfg.addEventListener("click", openMergeCfgModal);

  const btnMergeCfgReset = root.querySelector("#btnMergeCfgReset");
  if(btnMergeCfgReset) btnMergeCfgReset.addEventListener("click", ()=>{
    localStorage.removeItem("mc_merge_cfg_override");
    toast("🧽 Merge config reseteada");
  });


// Merge Lab: Sprite Manager + Leaderboard
const bestEl = root.querySelector("#mcMergeBestSettingsVal");
if(bestEl){
  const v = parseInt(localStorage.getItem("mc_merge_best_score")||"0",10);
  bestEl.textContent = String(Number.isFinite(v)?v:0);
}

const btnMergeSprites = root.querySelector("#btnMergeSprites");
if(btnMergeSprites) btnMergeSprites.addEventListener("click", openMergeSpriteManagerModal);

const btnMergeSpritesReset = root.querySelector("#btnMergeSpritesReset");
if(btnMergeSpritesReset) btnMergeSpritesReset.addEventListener("click", async ()=>{
  await mcSpriteIdbClear();
  toast("🧽 Sprites reseteados");
});

const btnMergeBestReset = root.querySelector("#btnMergeBestReset");
if(btnMergeBestReset) btnMergeBestReset.addEventListener("click", ()=>{
  localStorage.removeItem("mc_merge_best_score");
  const el = root.querySelector("#mcMergeBestSettingsVal");
  if(el) el.textContent = "0";
  toast("🧽 Best reseteado");
});


const btnExport = root.querySelector("#btnExport");
  if(btnExport) btnExport.addEventListener("click", exportBackup);
  const btnExportInline = root.querySelector("#btnExportInline");
  if(btnExportInline) btnExportInline.addEventListener("click", exportBackup);

  const btnBrainExport = root.querySelector("#btnBrainExport");
  if(btnBrainExport) btnBrainExport.addEventListener("click", exportBrainV2);
  const btnBrainExportInline = root.querySelector("#btnBrainExportInline");
  if(btnBrainExportInline) btnBrainExportInline.addEventListener("click", exportBrainV2);

  const btnNotif = root.querySelector("#btnNotif");
  if(btnNotif) btnNotif.addEventListener("click", enableNotifications);

  const btnCopyToken = root.querySelector("#btnCopyToken");
  if(btnCopyToken) btnCopyToken.addEventListener("click", copyFcmToken);

  const fileImport = root.querySelector("#fileImport");
  if(fileImport) fileImport.addEventListener("change", (e)=>{
    const f = e.target.files?.[0];
    if(f) importBackup(f);
    e.target.value = "";
  });
  const fileImportInline = root.querySelector("#fileImportInline");
  if(fileImportInline) fileImportInline.addEventListener("change", (e)=>{
    const f = e.target.files?.[0];
    if(f) importBackup(f);
    e.target.value = "";
  });

  const fileBrainImport = root.querySelector("#fileBrainImport");
  if(fileBrainImport) fileBrainImport.addEventListener("change", (e)=>{
    const f = e.target.files?.[0];
    if(f) importBrainV2(f);
    e.target.value = "";
  });
  const fileBrainImportInline = root.querySelector("#fileBrainImportInline");
  if(fileBrainImportInline) fileBrainImportInline.addEventListener("change", (e)=>{
    const f = e.target.files?.[0];
    if(f) importBrainV2(f);
    e.target.value = "";
  });

  const btnRestore = root.querySelector("#btnRestoreFromSnap");
  if(btnRestore) btnRestore.addEventListener("click", ()=>{
    const ta = root.querySelector("#restoreSnapText");
    const raw = ta ? ta.value : "";
    restoreFromSnapshotText(raw);
  });

  const btnClearSnap = root.querySelector("#btnClearSnap");
  if(btnClearSnap) btnClearSnap.addEventListener("click", ()=>{
    const ta = root.querySelector("#restoreSnapText");
    if(ta) ta.value = "";
    try{ toast("Limpio ✅"); }catch(e){}
  });

  const btnFetchSnap = root.querySelector("#btnFetchLatestSnap");
  if(btnFetchSnap) btnFetchSnap.addEventListener("click", async ()=>{
    await fetchLatestSnapshotFromSheet();
    // update label (in case sync config changed)
    const lbl = root.querySelector("#syncCfgLabel");
    if(lbl) lbl.textContent = syncCfgLabelText();
  });

  const btnSyncCfg = root.querySelector("#btnSyncCfg");
  if(btnSyncCfg) btnSyncCfg.addEventListener("click", ()=>{
    openSyncConfig();
    const lbl = root.querySelector("#syncCfgLabel");
    if(lbl) lbl.textContent = syncCfgLabelText();
    toast("Sync guardado ✅");
  });

  const syncLbl = root.querySelector("#syncCfgLabel");
  if(syncLbl) syncLbl.textContent = syncCfgLabelText();


  wireActions(root);
  if(state.tab==="home") wireHome(root);
  if(state.tab==="house") wireHouse(root);
	  if(state.tab==="calendar") wireCalendar(root);
  if(state.tab==="insights") wireInsights(root);
  wireHouseZoneSheet(root);

  // Re-open house runner modal after render if it was open
  try{
    if(state?.house?.session?.active && state?.house?.session?.runner?.open){
      setTimeout(()=> openHouseSessionRunnerModal(), 0);
    }
  }catch(e){}
}




function viewInsights(){
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + (Number(state.insightsMonthOffset)||0), 1);
  const year = d.getFullYear();
  const month = d.getMonth();
  const monthLabel = d.toLocaleString(undefined, { month: "long", year: "numeric" });

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDow = (first.getDay()+6)%7; // Monday=0

  const cells = [];
  for(let i=0;i<startDow;i++) cells.push({ blank:true });
  for(let day=1; day<=last.getDate(); day++){
    const dd = new Date(year, month, day);
    const iso = isoDate(dd);
    const sum = buildDailySummary(iso);
    cells.push({ blank:false, day, iso, sum, isToday: iso===isoDate(now) });
  }

    const mctx = computeInsightsMonthContext(cells);

const wk = ["L","M","X","J","V","S","D"].map(x=>`<div class="calWk">${x}</div>`).join("");

  return `
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <div>
          <h2 style="margin:0;">Insights</h2>
          <div class="muted">Calendario global. Click en un día para ver todo.</div>
        </div>
        <div class="row" style="gap:8px;">
          <button class="btn ghost" id="btnInsPrev">‹</button>
          <div class="pill" style="min-width:160px;text-align:center;">${escapeHtml(monthLabel)}</div>
          <button class="btn ghost" id="btnInsNext">›</button>
        </div>
      </div>

      <div class="hr"></div>

      <div class="insTrendCard">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div>
            <div class="muted">Estado del mes</div>
            <div style="font-weight:800;">Pulso diario (informativo)</div>
          </div>
          <div class="pill small">Mood • Sueño • Tasks • Limpieza • Compras</div>
        </div>
        <canvas id="insightsMonthChart" height="110"></canvas>
      </div>


      <div class="row" style="justify-content:space-between;align-items:center;margin-top:10px;">
        <div class="chip">🔥 Heatmap</div>
        <select id="insHeatMode" class="input" style="max-width:220px" onchange="insightsSetHeatMode(this.value)">
          <option value="pulse" ${window.INS_HEAT_MODE==="pulse"?"selected":""}>Pulso</option>
          <option value="sleep" ${window.INS_HEAT_MODE==="sleep"?"selected":""}>Sueño</option>
          <option value="tasks" ${window.INS_HEAT_MODE==="tasks"?"selected":""}>Tasks</option>
          <option value="clean" ${window.INS_HEAT_MODE==="clean"?"selected":""}>Limpieza</option>
          <option value="shop" ${window.INS_HEAT_MODE==="shop"?"selected":""}>Compras</option>
          <option value="mood" ${window.INS_HEAT_MODE==="mood"?"selected":""}>Mood</option>
        </select>
      </div>
      <div class="insCal">
        ${wk}
        ${cells.map(c=>{
          if(c.blank) return `<div class="calDay blank"></div>`;
          const icons = buildInsightIcons(c.sum);
          const dna = buildInsightDNA(c.sum);
          const moneyStr = (c.sum && c.sum.shopping && c.sum.shopping.total>0) ? `<div class="calMini money">🛒 ${money(c.sum.shopping.total)}</div>` : ``;
          const cleanStr = (c.sum && c.sum.cleaning && c.sum.cleaning.totalMinutes>0) ? `<div class="calMini">🧹 ${Math.round(c.sum.cleaning.totalMinutes)}m</div>` : ``;
          const heat = insightHeat(c.sum, window.INS_HEAT_MODE, mctx);
          return `
            <button class="calDay ${c.isToday?"today":""} ${heat>0?"heat":""}" style="--heat:${heat.toFixed(3)}" data-ins-day="${c.iso}">
              <div class="calNum">${c.day}</div>
              <div class="calIcons">${icons}</div>
              <div class="calDNA">${dna}</div>
              ${moneyStr}
              ${cleanStr}
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function buildInsightIcons(sum){
  if(!sum) return "";
  let out = "";
  if(sum.mood && sum.mood.spriteId) out += "🙂";
  if(sum.sleep && sum.sleep.totalMinutes) out += "😴";
  if(sum.shopping && sum.shopping.total>0) out += "🛒";
  if(sum.reminders && (sum.reminders.total>0)) out += "⏰";
  if(sum.cleaning && sum.cleaning.count>0) out += "🧹";
  return out ? `<span>${out}</span>` : "";
}

// =====================
// Insights V2 (Neural Minimal)
// =====================
// Heatmap mode for Insights calendar
window.INS_HEAT_MODE = window.INS_HEAT_MODE || (localStorage.getItem("mc_ins_heat_mode") || "pulse");
window.insightsSetHeatMode = function(mode){
  window.INS_HEAT_MODE = String(mode || "pulse");
  localStorage.setItem("mc_ins_heat_mode", window.INS_HEAT_MODE);
  // re-render insights if we are on that tab
  if(state && state.tab === "insights") view();
};


let _insightsMonthChart = null;
let _insightsRadarChart = null;

function clamp01(x){ x = Number(x)||0; return x<0?0:(x>1?1:x); }
function clamp100(x){ x = Number(x)||0; return x<0?0:(x>100?100:x); }

function insightVector(sum){
  // Returns {mood,sleep,tasks,cleaning,shopping} each 0..100
  const mood = sum?.mood?.value != null ? clamp100((Number(sum.mood.value)||0) * 10) : (sum?.mood?.spriteId ? 60 : 0); // fallback
  const sleepH = sum?.sleep?.totalMinutes != null ? (Number(sum.sleep.totalMinutes)||0)/60 : 0;
  const sleep = clamp100((sleepH/8) * 100);

  const tasksTotal = Number(sum?.reminders?.total||0);
  const tasksDone  = Number(sum?.reminders?.done||0);
  const tasks = tasksTotal>0 ? clamp100((tasksDone/tasksTotal)*100) : 0;

  const cleanMin = Number(sum?.cleaning?.totalMinutes||0);
  const cleaning = clamp100((cleanMin/45) * 100); // 45min = 100 (tunable)

  const shopTotal = Number(sum?.shopping?.total||0);
  // informative intensity: relative to 150 soles/day cap
  const shopping = clamp100((shopTotal/150) * 100);

  return { mood, sleep, tasks, cleaning, shopping };
}

function buildInsightDNA(sum){
  if(!sum) return "";
  const v = insightVector(sum);
  const bars = [
    {k:"mood", em:"🙂", v:v.mood},
    {k:"sleep", em:"😴", v:v.sleep},
    {k:"tasks", em:"✅", v:v.tasks},
    {k:"clean", em:"🧹", v:v.cleaning},
    {k:"shop", em:"🛒", v:v.shopping},
  ];
  return `<div class="dna" aria-label="ADN del día">
    ${bars.map(b=>`<i class="dnaBar dna-${b.k}" style="--h:${Math.round(b.v)}" title="${b.em} ${Math.round(b.v)}"></i>`).join("")}
  </div>`;
}

function insightDayPulse(sum){
  // Informative composite 0..100
  const v = insightVector(sum);
  const vals = [v.mood, v.sleep, v.tasks, v.cleaning, v.shopping].filter(x=>x>0);
  if(!vals.length) return 0;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}

function computeInsightsMonthContext(cells){
  let maxShop = 0, maxSleep = 0, maxClean = 0, maxPulse = 0, maxMood = 0;
  for(const c of (cells||[])){
    if(!c || c.blank) continue;
    const sum = c.sum;
    const shop = Number(sum?.shopping?.total||0);
    const sleep = Number(sum?.sleep?.totalMinutes||0);
    const clean = Number(sum?.cleaning?.totalMinutes||0);
    const moodV = sum?.mood?.value != null ? (Number(sum.mood.value)||0)*10 : (sum?.mood?.spriteId ? 60 : 0);
    const pulse = sum ? insightDayPulse(sum) : 0;
    if(shop > maxShop) maxShop = shop;
    if(sleep > maxSleep) maxSleep = sleep;
    if(clean > maxClean) maxClean = clean;
    if(pulse > maxPulse) maxPulse = pulse;
    if(moodV > maxMood) maxMood = moodV;
  }
  return { maxShop, maxSleep, maxClean, maxPulse, maxMood };
}

function insightHeat(sum, mode, ctx){
  if(!sum) return 0;
  const v = insightVector(sum);
  const m = String(mode||"pulse");
  const c = ctx || {};
  const safeDiv = (a,b)=> (b>0 ? (a/b) : 0);

  if(m === "sleep") return clamp01(safeDiv(Number(sum?.sleep?.totalMinutes||0), Number(c.maxSleep||0)));
  if(m === "tasks") return clamp01((v.tasks||0)/100);
  if(m === "clean") return clamp01(safeDiv(Number(sum?.cleaning?.totalMinutes||0), Number(c.maxClean||0)));
  if(m === "shop") return clamp01(safeDiv(Number(sum?.shopping?.total||0), Number(c.maxShop||0)));
  if(m === "mood") return clamp01(safeDiv((sum?.mood?.value != null ? (Number(sum.mood.value)||0)*10 : (sum?.mood?.spriteId?60:0)), Number(c.maxMood||0)));

  // pulse (default) normalized to month max
  return clamp01(safeDiv(insightDayPulse(sum), Number(c.maxPulse||0)));
}


function wireInsights(root){
  // Month chart
  setTimeout(()=> insightsDrawMonthChart(), 0);

  // Subtle entrance
  setTimeout(()=>{
    try{
      if(typeof anime!=="undefined"){
        anime({
          targets: ".insTrendCard",
          opacity: [0,1],
          translateY: [8,0],
          duration: 520,
          easing: "easeOutExpo"
        });
        anime({
          targets: ".insCal .calDay:not(.blank)",
          opacity: [0,1],
          translateY: [6,0],
          delay: anime.stagger(8),
          duration: 420,
          easing: "easeOutQuad"
        });
      }
    }catch(e){}
  }, 0);
}

function insightsDrawMonthChart(){
  const canvas = document.getElementById("insightsMonthChart");
  if(!canvas || typeof Chart==="undefined") return;

  // Hard-stop Chart.js responsive resize loops (some browsers can trigger an infinite growth
  // cycle when a responsive canvas lives inside auto-sized containers).
  try{
    canvas.style.height = "120px";
    canvas.style.width = "100%";
    canvas.height = 120;
  }catch(e){}

  // Build month series from the currently rendered grid
  const dayBtns = Array.from(document.querySelectorAll("[data-ins-day]"));
  const labels = [];
  const data = [];
  for(const btn of dayBtns){
    const iso = btn.dataset.insDay;
    if(!iso) continue;
    const sum = buildDailySummary(String(iso));
    const pulse = sum ? insightDayPulse(sum) : 0;
    labels.push(iso.slice(8,10));
    data.push(Math.round(pulse));
  }

  try{ if(_insightsMonthChart){ _insightsMonthChart.destroy(); _insightsMonthChart=null; } }catch(e){}

  _insightsMonthChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Pulso",
        data,
        tension: 0.35,
        fill: true,
        pointRadius: 2.5,
        pointHoverRadius: 5,
        borderWidth: 2,
      }]
    },
    options: {
      // IMPORTANT: keep charts non-responsive to avoid runaway ResizeObserver loops.
      // We control size via explicit canvas height + CSS.
      responsive: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "rgba(255,255,255,.55)" } },
        y: { beginAtZero: true, max: 100, ticks: { color: "rgba(255,255,255,.55)" } }
      }
    }
  });
  }

  // Small "draw" vibe
  try{
    if(typeof anime!=="undefined"){
      anime({
        targets: canvas,
        opacity: [0,1],
        duration: 420,
        easing: "easeOutQuad"
      });
    }
  }catch(e){}
}

function insightsModalIn(){
  const card = document.getElementById("insightsNeuralCard");
  if(!card || typeof anime==="undefined") return;
  anime({
    targets: card,
    opacity: [0,1],
    scale: [0.92, 1],
    translateY: [12, 0],
    duration: 520,
    easing: "easeOutExpo"
  });
}

function closeInsightsModalAnimated(){
  const card = document.getElementById("insightsNeuralCard");
  const backdrop = document.getElementById("insightsDayBackdrop");
  if(!card || typeof anime==="undefined"){
    state.insightsDayOpen = false; view(); return;
  }
  anime({
    targets: card,
    opacity: [1,0],
    scale: 0.96,
    translateY: 10,
    duration: 260,
    easing: "easeInQuad",
    complete: ()=>{
      try{ if(typeof anime!=="undefined"){ anime.remove("#insightsRadarCanvas"); } }catch(e){}
      try{ if(_insightsRadarChart){ _insightsRadarChart.destroy(); _insightsRadarChart=null; } }catch(e){}
      state.insightsDayOpen = false;
      view();
    }
  });
  if(backdrop){
    anime({ targets: backdrop, opacity: [1,0], duration: 260, easing: "linear" });
  }
}

function insightsDrawRadar(){
  const canvas = document.getElementById("insightsRadarCanvas");
  if(!canvas || typeof Chart==="undefined") return;

  // Prevent responsive resize loops by locking the canvas size.
  // The wrapper (.radarBox) has a fixed height in CSS.
  try{
    canvas.style.height = "100%";
    canvas.style.width  = "100%";
    // If the wrapper exists, use its pixel height.
    const wrap = canvas.parentElement;
    const h = wrap ? (wrap.getBoundingClientRect().height || 260) : 260;
    canvas.height = Math.round(h);
  }catch(e){}

  const sum = buildDailySummary(String(state.insightsDay||"")) || null;
  const v = sum ? insightVector(sum) : {mood:0,sleep:0,tasks:0,cleaning:0,shopping:0};

  try{ if(_insightsRadarChart){ _insightsRadarChart.destroy(); _insightsRadarChart=null; } }catch(e){}

  _insightsRadarChart = new Chart(canvas.getContext("2d"), {
    type: "radar",
    data: {
      labels: ["Mood","Sueño","Tasks","Limpieza","Compras"],
      datasets: [{
        label: "Día",
        data: [v.mood, v.sleep, v.tasks, v.cleaning, v.shopping],
        borderWidth: 2,
        pointRadius: 2.8,
        pointHoverRadius: 5,
        fill: true
      }]
    },
    options: {
      // IMPORTANT: keep charts non-responsive to avoid runaway ResizeObserver loops.
      responsive: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: { display: false },
          grid: { color: "rgba(255,255,255,.10)" },
          angleLines: { color: "rgba(255,255,255,.10)" },
          pointLabels: { color: "rgba(255,255,255,.75)", font: { size: 12, weight: "600" } }
        }
      },
      animation: { duration: 700 }
    }
  });

  // Tiny pulse
  try{
    if(typeof anime!=="undefined"){
      anime({
        targets: canvas,
        opacity: [0,1],
        duration: 420,
        easing: "easeOutQuad"
      });
    }
  }catch(e){}
}

function buildDailySummary(iso){
  const out = { iso };

  // Mood
  try{
    const e = getMoodEntry(iso);
    if(e && e.spriteId) out.mood = e;
  }catch(e){}

  // Sleep / Dream Journal (from sleepLog array)
  try{
    const sl = Array.isArray(state.sleepLog) ? state.sleepLog : [];
    const entry = sl.find(x=>String(x.date)===String(iso));
    if(entry) out.sleep = entry;
  }catch(e){}

  // Shopping (history entries are dated)
  try{
    const hist = Array.isArray(state.shoppingHistory) ? state.shoppingHistory : [];
    const day = hist.filter(h=>String(h.date)===String(iso));
    if(day.length){
      const total = day.reduce((a,h)=> a + (Number(h?.totals?.total)||0), 0);
      out.shopping = { total: Number(total.toFixed(2)), entries: day.length, items: day, itemsCount: day.reduce((a,h)=>a+(Number(h?.totals?.itemsCount)||0),0) };
    }
  }catch(e){}

  // Reminders for that specific day
  try{
    const rem = Array.isArray(state.reminders) ? state.reminders : [];
    const dayRem = rem.filter(r=>String(r.dueDate||r.date||"").startsWith(iso));
    const allRem = rem;
    const total = allRem.length;
    const done = allRem.filter(r=>!!r.done).length;
    out.reminders = { total, done, pending: total-done, dayItems: dayRem };
  }catch(e){}

  // Cleaning sessions (Casa)
  try{
    const hh = state.house && Array.isArray(state.house.sessionHistory) ? state.house.sessionHistory : [];
    const day = hh.filter(h=>String(h.date)===String(iso));
    if(day.length){
      const totalSec = day.reduce((a,h)=>a+(Number(h.totalSec)||0),0);
      out.cleaning = { count: day.length, totalMinutes: totalSec/60, sessions: day };
    }
  }catch(e){}

  // Tarot readings
  try{
    const tarotLog = Array.isArray(state.tarotLog) ? state.tarotLog : [];
    const dayTarot = tarotLog.filter(r=>String(r.dateIso||r.date||"").startsWith(iso));
    if(dayTarot.length) out.tarot = { count: dayTarot.length, readings: dayTarot };
  }catch(e){}

  // Finance transactions
  try{
    const ledger = Array.isArray(state.finance_ledger) ? state.finance_ledger : [];
    const transactions = Array.isArray(state.finance_transactions) ? state.finance_transactions : [];
    const allTx = [...ledger, ...transactions];
    const dayTx = allTx.filter(t=>String(t.date||t.ts||"").startsWith(iso));
    if(dayTx.length){
      const income = dayTx.filter(t=>t.type==="income"||t.amount>0).reduce((a,t)=>a+Math.abs(Number(t.amount||0)),0);
      const expense = dayTx.filter(t=>t.type==="expense"||t.amount<0).reduce((a,t)=>a+Math.abs(Number(t.amount||0)),0);
      out.finance = { count: dayTx.length, income, expense, items: dayTx.slice(0,10) };
    }
  }catch(e){}

  return out;
}

function openInsightsDayOverlay(iso){
  // Remove existing overlay if any
  const existing = document.getElementById("insightsDayOverlay");
  if(existing) existing.remove();

  const sum = buildDailySummary(iso) || { iso };

  const getMoodLabel = ()=>{
    if(!sum.mood) return "Sin registro";
    const s = getMoodSpriteById(sum.mood.spriteId);
    return s ? s.name : (sum.mood.spriteId || "?");
  };

  const sleepStr = sum.sleep
    ? `${(Math.round((Number(sum.sleep.totalMinutes)||0)/6)/10).toFixed(1)}h` + (sum.sleep.quality ? ` · Q${sum.sleep.quality}/5` : "")
    : null;

  const dreamStr = sum.sleep && sum.sleep.narrative ? sum.sleep.narrative.slice(0,120) + (sum.sleep.narrative.length>120?"…":"") : null;
  const dreamType = sum.sleep && sum.sleep.dreamType ? sum.sleep.dreamType : null;

  const shopList = sum.shopping?.items || [];
  const cleanList = sum.cleaning?.sessions || [];
  const tarotList = sum.tarot?.readings || [];
  const financeItems = sum.finance?.items || [];

  const section = (icon, title, content) => `
    <div style="margin-bottom:14px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(124,92,255,0.8);margin-bottom:8px;font-family:'JetBrains Mono',monospace;">${icon} ${title}</div>
      ${content}
    </div>`;

  const chip = (label, val) => val
    ? `<div style="display:flex;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.08);margin-bottom:6px;font-size:13px;"><span style="color:rgba(255,255,255,0.5);">${label}</span><span style="color:#fff;font-weight:700;">${val}</span></div>`
    : "";

  const hasData = sum.mood || sum.sleep || sum.shopping || sum.cleaning || sum.tarot || sum.finance;

  const overlay = document.createElement("div");
  overlay.id = "insightsDayOverlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:1500;background:rgba(6,5,15,0.85);backdrop-filter:blur(8px);display:flex;align-items:flex-end;justify-content:center;padding:0;overflow:hidden;";

  const panel = document.createElement("div");
  panel.style.cssText = "width:100%;max-width:520px;max-height:90vh;overflow-y:auto;background:#0d0c1a;border:1px solid rgba(124,92,255,0.22);border-radius:20px 20px 0 0;padding:24px 20px 36px;box-shadow:0 -24px 80px rgba(0,0,0,0.7);transform:translateY(30px);opacity:0;transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1),opacity 0.25s ease;scrollbar-width:thin;scrollbar-color:rgba(124,92,255,0.3) transparent;";

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(124,92,255,0.8);margin-bottom:4px;font-family:'JetBrains Mono',monospace;">📅 TODO POR DÍA</div>
        <div style="font-size:24px;font-weight:900;color:#fff;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">${iso}</div>
      </div>
      <button id="insOverlayClose" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.7);border-radius:10px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;">✕ Cerrar</button>
    </div>

    ${!hasData ? `<div style="text-align:center;padding:30px 0;color:rgba(255,255,255,0.3);font-size:14px;">Sin actividad registrada este día 🌙</div>` : ""}

    ${sum.mood ? section("🙂", "Estado de ánimo",
      chip("Emoción", getMoodLabel()) +
      chip("Energía", sum.mood.energy ? `${sum.mood.energy}/5` : null) +
      (sum.mood.note ? `<div style="padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.07);font-size:12px;color:rgba(255,255,255,0.6);margin-top:4px;">${escapeHtml(sum.mood.note)}</div>` : "")
    ) : ""}

    ${sum.sleep ? section("😴", "Sueño",
      chip("Duración", sleepStr) +
      chip("Tipo de sueño", dreamType) +
      chip("Calidad", sum.sleep.quality ? `${sum.sleep.quality}/5` : null) +
      chip("Claridad lúcida", sum.sleep.clarity ? `${sum.sleep.clarity}/5` : null) +
      (sum.sleep.lucidMoment ? `<div style="padding:6px 12px;background:rgba(124,92,255,0.1);border-radius:8px;border:1px solid rgba(124,92,255,0.3);font-size:12px;color:rgba(124,92,255,0.9);margin-bottom:6px;">✨ Sueño lúcido</div>` : "") +
      (dreamStr ? `<div style="padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.07);font-size:12px;color:rgba(255,255,255,0.6);margin-top:4px;font-style:italic;">${escapeHtml(dreamStr)}</div>` : "")
    ) : ""}

    ${tarotList.length ? section("🃏", "Tarot",
      tarotList.map(r=>`
        <div style="padding:10px 12px;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.08);margin-bottom:6px;">
          <div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:4px;">${escapeHtml((r.cards||[]).map(c=>c.name||c).join(" · ") || "Tirada")}</div>
          ${r.interpretation ? `<div style="font-size:11px;color:rgba(255,255,255,0.5);line-height:1.5;">${escapeHtml(r.interpretation.slice(0,150))}${r.interpretation.length>150?"…":""}</div>` : ""}
        </div>`).join("")
    ) : ""}

    ${sum.finance ? section("💰", "Finanzas",
      chip("Ingresos", sum.finance.income > 0 ? money(sum.finance.income) : null) +
      chip("Gastos", sum.finance.expense > 0 ? money(sum.finance.expense) : null) +
      financeItems.slice(0,5).map(t=>`
        <div style="display:flex;justify-content:space-between;padding:6px 12px;background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:4px;font-size:12px;">
          <span style="color:rgba(255,255,255,0.6);">${escapeHtml(t.description||t.concept||t.label||"")}</span>
          <span style="color:${t.amount>0?"#4ADE80":"#F87171"};font-weight:700;">${money(Math.abs(t.amount||0))}</span>
        </div>`).join("")
    ) : ""}

    ${shopList.length ? section("🛒", "Compras",
      shopList.slice(0,6).map(h=>`
        <div style="display:flex;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.08);margin-bottom:6px;">
          <span style="color:rgba(255,255,255,0.8);font-size:13px;">${escapeHtml(h.store||"")}</span>
          <span style="color:#fff;font-weight:700;font-size:13px;">${money(Number(h?.totals?.total||0))}</span>
        </div>`).join("")
    ) : ""}

    ${cleanList.length ? section("🧹", "Limpieza",
      cleanList.map(s=>`
        <div style="display:flex;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.08);margin-bottom:6px;">
          <span style="color:rgba(255,255,255,0.8);font-size:13px;">${escapeHtml(String(s.status||"Sesión"))}</span>
          <span style="color:rgba(255,255,255,0.6);font-size:12px;">${Math.round((Number(s.totalSec)||0)/60)} min</span>
        </div>`).join("")
    ) : ""}
  `;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(()=>{ panel.style.transform="translateY(0)"; panel.style.opacity="1"; });

  // Close handlers
  const close = ()=>{
    panel.style.transform="translateY(30px)";
    panel.style.opacity="0";
    setTimeout(()=>overlay.remove(), 300);
  };
  overlay.addEventListener("click", e=>{ if(e.target===overlay) close(); });
  panel.querySelector("#insOverlayClose")?.addEventListener("click", close);
}

function renderInsightsDayModal(){
  // Legacy: now using openInsightsDayOverlay, this is kept for backward compat
  return "";
}

function renderHouseHistoryModal(){
  const hist = (state.house && Array.isArray(state.house.sessionHistory)) ? state.house.sessionHistory : [];
  const byDate = {};
  for(const h of hist){
    const d = String(h.date||"");
    if(!byDate[d]) byDate[d]=[];
    byDate[d].push(h);
  }
  const dates = Object.keys(byDate).sort().reverse().slice(0,30);

  return `
    <div class="modalBackdrop" id="houseHistoryBackdrop" aria-label="Historial de casa">
      <div class="modal">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <h2 style="margin:0;">Historial 🧹</h2>
          <div class="row" style="gap:8px;">
            <button class="btn danger" data-house-history-clear="1">Borrar</button>
            <button class="iconBtn" id="btnHouseHistoryClose">Cerrar</button>
          </div>
        </div>
        <div class="muted" style="margin-top:6px;">Últimas sesiones guardadas (local).</div>

        <div class="list" style="margin-top:12px;">
          ${dates.length ? dates.map(d=>{
            const rows = byDate[d]||[];
            const totalMin = rows.reduce((a,x)=>a+(Number(x.totalSec)||0),0)/60;
            return `
              <div class="item" style="align-items:flex-start;">
                <div class="left">
                  <div class="name">${escapeHtml(d)} • <b>${Math.round(totalMin)} min</b></div>
                  <div class="meta">${rows.length} sesiones</div>
                </div>
              </div>
            `;
          }).join("") : `<div class="muted">Aún no hay historial.</div>`}
        </div>
      </div>
    </div>
  `;
}

function viewSettings(){
  const token = localStorage.getItem("memorycarl_fcm_token") || "";
  const perm = (window.Notification && Notification.permission) ? Notification.permission : "unsupported";
  const permLabel = perm === "granted" ? "Enabled ✅" : (perm === "denied" ? "Blocked ⛔" : (perm === "default" ? "Not enabled" : "Unsupported"));
  const tokenLabel = token ? `${token.slice(0,18)}…${token.slice(-10)}` : "No token yet";

  return `
    <div class="sectionTitle">
      <div>Ajustes</div>
      <div class="chip">backup • notifs • datos</div>
    </div>

    
    <div class="card">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">NeuroClaw AI</h2>
          <div class="small">Controla cuántas llamadas haces a Gemini y guarda el JSON para aprendizaje.</div>
        </div>
        <div class="chip">${getNeuroAiCallsToday()}/3 hoy</div>
      </div>
      <div class="hr"></div>
      <div class="kv">
        <div class="k">Límite diario</div>
        <div class="v">3 llamadas/día (manual)</div>
      </div>
      <div class="kv">
        <div class="k">Llamadas hoy</div>
        <div class="v"><b>${getNeuroAiCallsToday()}</b> / 3</div>
      </div>
      <div class="kv">
        <div class="k">Logs guardados</div>
        <div class="v">${getAiLog().length}</div>
      </div>

      <div class="btnRow" style="margin-top:10px;flex-wrap:wrap;gap:10px;">
        <button class="btn" id="btnNcAiCopy">Copiar JSON log</button>
        <button class="btn" id="btnNcAiDownload">Descargar JSON</button>
        <button class="btn ghost" id="btnNcAiReset">Reset contador (hoy)</button>
      </div>

      <div class="small" style="margin-top:10px;opacity:.85;">
        Tip: si quieres entrenar, este log guarda <span class="mono">signals_snapshot</span> + respuesta de Gemini + tu rating.
      </div>
    </div>

    <div class="card">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">Semana IA (Gemini)</h2>
          <div class="small">API key usada por “Plan IA” en la pestaña Semana.</div>
        </div>
      </div>
      <div class="hr"></div>
      <div class="kv">
        <div class="k">API key</div>
        <div class="v">
          <input id="semanaGeminiApiKey" class="inp mono" type="password" placeholder="AIza..." autocomplete="off" />
        </div>
      </div>
      <div class="btnRow" style="margin-top:10px;flex-wrap:wrap;gap:10px;">
        <button class="btn" id="btnSemanaGeminiSave">Guardar key</button>
        <button class="btn ghost" id="btnSemanaGeminiClear">Limpiar</button>
      </div>
      <div class="small" style="margin-top:10px;opacity:.85;">
        Si está vacía, Semana intentará usar <span class="mono">VITE_GEMINI_KEY</span> (build).
      </div>
    </div>

    <div class="card">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">Astro (Cosmic Lite) 🌙</h2>
          <div class="small">Nivel 1 (local) + opción Swiss Ephemeris (NeuroClaw) para tránsitos precisos.</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
          <div class="chip" id="chipTransitEngine">${escapeHtml((loadSwissLast()?.transit_engine) || "lite_v1")}</div>
          <div class="chip" id="chipNatalStatus">${loadNatalChart() ? "Carta ✅" : "Sin carta"}</div>
        </div>
      </div>
      <div class="hr"></div>

      <div class="kv">
        <div class="k">Hoy</div>
        <div class="v"><b id="astroTodayLabel">${escapeHtml(`${getCosmicLiteSignals().moon_phase_name} • Luna en ${getCosmicLiteSignals().moon_sign}`)}</b></div>
      </div>
      <div class="kv">
        <div class="k">Tránsitos</div>
        <div class="v small"><span id="astroTransitLabel">${escapeHtml(getTransitLiteSignals().transit_top || "Activa tu carta natal para ver casas y aspectos.")}</span></div>
      </div>

      <div class="kv">
        <div class="k">Motor</div>
        <div class="v small">
          <select id="astroProvider" class="inp" style="max-width:220px;">
            <option value="lite">Lite (local)</option>
            <option value="swiss">Swiss (NeuroClaw)</option>
          </select>
          <button class="btn ghost" id="btnAstroProviderSave" style="margin-left:10px;">Guardar</button>
          <span class="small" id="astroSwissStatus" style="margin-left:10px;opacity:.85;"></span>
        </div>
      </div>
      <div class="kv">
        <div class="k">Lectura</div>
        <div class="v small" id="astroHint">Bubble puede usar esto como contexto, no como destino.</div>
      </div>

      <div class="kv">
        <div class="k">Bubble</div>
        <div class="v small">
          <span style="opacity:.9;">Frecuencia de susurros</span>
          <select id="bubbleFreq" class="inp" style="margin-left:10px;max-width:180px;">
            <option value="30">Cada 30 min</option>
            <option value="60">Cada 1 hora</option>
            <option value="120">Cada 2 horas</option>
            <option value="240">Cada 4 horas</option>
          </select>
          <button class="btn ghost" id="btnBubbleFreqSave" style="margin-left:10px;">Guardar</button>
        </div>
      </div>

      <div class="hr"></div>
      <div class="small" style="margin-bottom:8px;">Carta natal (JSON)</div>
      <textarea id="natalJsonText" class="ta mono" rows="8" placeholder='Pega aquí tu carta natal en JSON (te crearé el formato).'></textarea>

      <div class="btnRow" style="margin-top:10px;flex-wrap:wrap;gap:10px;">
        <label class="btn" style="cursor:pointer;">
          Subir JSON
          <input id="fileNatal" type="file" accept="application/json" style="display:none;">
        </label>
        <button class="btn" id="btnNatalSave">Guardar</button>
        <button class="btn" id="btnNatalDownload">Descargar</button>
        <button class="btn ghost" id="btnNatalReset">Reset</button>
      </div>

      <div class="btnRow" style="margin-top:10px;flex-wrap:wrap;gap:10px;">
        <button class="btn" id="btnAstroRefresh">Recalcular hoy</button>
        <button class="btn" id="btnAstroSwissPing">Probar Swiss</button>
        <button class="btn primary" id="btnAstroTestBubble">Probar Bubble</button>
      </div>

      <div class="note" style="margin-top:10px;">
        Tip: si eliges <b>Swiss (NeuroClaw)</b>, necesitas tu backend con endpoint <span class="mono">/astro/transits</span>. En este ZIP viene un folder listo para deploy.
      </div>
    </div>

<div class="card">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">Backup & Restore (Brain v2)</h2>
          <div class="small">Exporta/Importa tu data local en JSON antes de limpiar cache o cambiar de teléfono.</div>
        </div>
      </div>
      <div class="hr"></div>
      <div class="kv">
        <div class="k">Almacenamiento</div>
        <div class="v">Local (este dispositivo)</div>
      </div>
      <div class="kv">
        <div class="k">Recomendación</div>
        <div class="v">Export semanal o antes de updates</div>
      </div>
      <div class="btnRow" style="margin-top:10px;flex-wrap:wrap;gap:10px;">
        <button class="btn primary" id="btnBrainExportInline">Exportar cerebro (backup)</button>
        <label class="btn" style="cursor:pointer;">
          Importar cerebro (restaurar)
          <input id="fileBrainImportInline" type="file" accept="application/json" style="display:none;">
        </label>
        <button class="btn" id="btnExportInline">Export backup</button>
        <label class="btn" style="cursor:pointer;">
          Import backup
          <input id="fileImportInline" type="file" accept="application/json" style="display:none;">
        </label>
      </div>
      <div class="note" style="margin-top:10px;">Exportar/Importar cerebro crea un backup completo de FootballLab/Brain v2 (IndexedDB + localStorage) y recarga la app tras restaurar.</div>
    </div>

    <div class="card">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">Restaurar desde Snapshot</h2>
          <div class="small">Pega el <span class="mono">payload_json</span> de <span class="mono">STATE_SNAPSHOT</span> (Sheets) o un backup exportado por la app. Se restaura localStorage y se recarga.</div>
        </div>
      </div>
      <div class="hr"></div>
      <textarea id="restoreSnapText" class="ta mono" rows="8" placeholder='Pega aquí el JSON completo (empieza con { y termina con }).'></textarea>
      <div class="row" style="margin:10px 0 0;">
        <button class="btn" id="btnRestoreFromSnap">Restaurar</button>
        <button class="btn ghost" id="btnClearSnap">Limpiar</button>
      </div>
      <div class="note" style="margin-top:10px;">
        Tip: primero usa <b>Export backup</b>. Restaurar no usa <span class="mono">eval</span>, solo <span class="mono">JSON.parse</span>.
      </div>
    </div>

    <div class="card">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">Notificaciones</h2>
          <div class="small">Activa push (Firebase) y guarda tu token para pruebas o automatizaciones.</div>
        </div>
      </div>
      <div class="hr"></div>
      <div class="kv">
        <div class="k">Estado</div>
        <div class="v">${permLabel}</div>
      </div>
      <div class="kv">
        <div class="k">Token</div>
        <div class="v mono">${escapeHtml(tokenLabel)}</div>
      </div>

      <div class="note">
        Tip: si queda en <span class="mono">Blocked</span>, revisa permisos del navegador para este sitio y vuelve a intentar.
      </div>
    </div>

    <div class="card">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">Interfaz</h2>
          <div class="small">Pequeños detalles para que se sienta como app.</div>
        </div>
      </div>
      <div class="hr"></div>
      <div class="kv">
        <div class="k">Barra inferior</div>
        <div class="v">Fija (modo app)</div>
      </div>
      <div class="kv">
        <div class="k">Acciones rápidas</div>
        <div class="v">Se muestran abajo en este tab</div>
      </div>
    </div>

    <div class="card">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">Merge Lab <span class="chip">v7.6</span></h2>
          <div class="small">Config del juego (fondo, sprites, radios, spawnPool). Se guarda en este dispositivo.</div>
        </div>
      </div>
      <div class="hr"></div>
      <div class="row" style="margin:0;">
        <button class="btn" id="btnMergeCfg">Editar config</button>
        <button class="btn" id="btnMergeCfgReset">Reset</button>
      </div>
      <div class="note" style="margin-top:10px;">
        Tip: <span class="mono">spawnPool: 4</span> significa que solo salen random las primeras 4 piezas.
      </div>
<div class="card">
  <div class="cardTop">
    <div>
      <h2 class="cardTitle">Sprites</h2>
      <div class="small">Sube tu pack de 10/11 PNG y el juego los usa sin redeploy (se guarda en este dispositivo).</div>
    </div>
  </div>
  <div class="hr"></div>
  <div class="row" style="margin:0;">
    <button class="btn" id="btnMergeSprites">Abrir Sprite Manager</button>
    <button class="btn" id="btnMergeSpritesReset">Reset sprites</button>
  </div>
  <div class="note" style="margin-top:10px;">
    Tip: puedes exportar/importar el pack para pasarlo al teléfono.
  </div>
</div>

<div class="card">
  <div class="cardTop">
    <div>
      <h2 class="cardTitle">Leaderboard</h2>
      <div class="small">Tu mejor score local del Merge Lab.</div>
    </div>
  </div>
  <div class="hr"></div>
  <div class="kv">
    <div class="k">Best</div>
    <div class="v"><b id="mcMergeBestSettingsVal">0</b></div>
  </div>
  <div class="row" style="margin:0;">
    <button class="btn" id="btnMergeBestReset">Reset best</button>
  </div>
</div>

  `;
}

function viewLearn(){
  return `
    <div class="sectionTitle">
      <div>Aprender</div>
      <div class="chip">quiz + glosario</div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;gap:10px;">
        <div>
          <div style="font-weight:800;">LearnQuest 🧭</div>
          <div class="small">Aventura épica para aprender JS/DOM con niveles en JSON</div>
        </div>
        <button class="btn" onclick="openLearnQuest()">Abrir</button>
      </div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;gap:10px;">
        <div>
          <div style="font-weight:800;">CalcQuest ⚡</div>
          <div class="small">Hacker-neón: reconstruye HTML/CSS/JS y termina con una calculadora real</div>
        </div>
        <button class="btn" onclick="openCalcQuest()">Abrir</button>
      </div>
    </div>

    <div class="card">
      <div class="small">
        Este módulo te hace preguntas sobre la estructura de MemoryCarl.
        Cada respuesta puede abrir una “ficha” para que escribas tu explicación en 1 línea.
      </div>
      <div class="hr"></div>

      <div class="learnFrame">
        <iframe
          title="MemoryCarl Learn"
          src="./learn/"
          loading="lazy"
          referrerpolicy="no-referrer"
        ></iframe>
      </div>

      <div class="small" style="margin-top:10px;">
        Tip: si actualizas el quiz, solo refresca esta pestaña.
      </div>
    </div>
  `;
}



function openLearnQuest(){
  // Reuse modal styles from style.css
  const b = document.createElement("div");
  b.className = "modalBackdrop";
  b.innerHTML = `
    <div class="modal" style="max-width:900px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <h2 style="margin:4px 0 10px;">LearnQuest 🧭</h2>
        <button class="btn" id="lqCloseBtn" style="padding:8px 10px;">Cerrar</button>
      </div>
      <div class="learnFrame" style="height:75vh;">
        <iframe title="LearnQuest" src="./learnquest/" loading="lazy" referrerpolicy="no-referrer"></iframe>
      </div>
      <div class="small" style="margin-top:10px;opacity:.8;">
        Tip: Puedes importar niveles .json desde el botón “📂 Importar nivel” dentro de LearnQuest.
      </div>
    </div>
  `;
  document.body.appendChild(b);
  const close = ()=>b.remove();
  b.addEventListener("click",(e)=>{ if(e.target===b) close(); });
  b.querySelector("#lqCloseBtn").addEventListener("click", close);
}
window.openLearnQuest = openLearnQuest;

function openCalcQuest(){
  const b = document.createElement("div");
  b.className = "modalBackdrop";
  b.innerHTML = `
    <div class="modal calcquestModal" style="max-width:1000px;max-height:90vh;overflow:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <h2 style="margin:4px 0 10px;">CalcQuest ⚡</h2>
        <button class="btn" id="cqCloseBtn" style="padding:8px 10px;">Cerrar</button>
      </div>
      <div class="learnFrame" style="height:72vh;min-height:420px;">
        <iframe title="CalcQuest" src="./calcquest/" loading="lazy" referrerpolicy="no-referrer"></iframe>
      </div>
      <div class="small" style="margin-top:10px;opacity:.8;">
        Tip: Los niveles guardan tu código en localStorage. Usa “EXPORT” para llevarte tu calculadora a un entorno real.
      </div>
    </div>
  `;
  document.body.appendChild(b);
  const close = ()=>b.remove();
  b.addEventListener("click",(e)=>{ if(e.target===b) close(); });
  b.querySelector("#cqCloseBtn").addEventListener("click", close);
}
window.openCalcQuest = openCalcQuest;






// ---- HOME ----
function dayAbbrEs(d){
  // d: 0=Sun..6=Sat
  return ["D","L","M","M","J","V","S"][d] || "";
}

function startOfWeekMonday(date=new Date()){
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun
  const diff = (day === 0 ? -6 : 1 - day); // move to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

function formatDayNum(date){ return String(date.getDate()); }

function getTodayIso(){ return isoDate(new Date()); }


function normalizeSleepEntry(e){
  if(!e || typeof e !== "object") return null;
  const date = String(e.date || "").slice(0,10);
  const totalMinutes = Number(e.totalMinutes ?? e.total_minutes ?? 0);
  if(!date || !Number.isFinite(totalMinutes)) return null;
  if(totalMinutes <= 0 && !e.narrative && !e.dreamType) return null;
  return {
    id: String(e.id || uid()),
    ts: String(e.ts || new Date().toISOString()),
    date,
    totalMinutes: Math.round(totalMinutes),
    quality: (e.quality === undefined || e.quality === null || e.quality === "") ? null : Number(e.quality),
    note: String(e.note || ""),
    mode: String(e.mode || "simple"),
    start: e.start ? String(e.start) : "",
    end: e.end ? String(e.end) : "",
    dreamType: e.dreamType ? String(e.dreamType) : "",
    wakeEmotion: e.wakeEmotion ? String(e.wakeEmotion) : "",
    narrative: String(e.narrative || ""),
    symbols: Array.isArray(e.symbols) ? e.symbols.map(String) : [],
    clarity: (e.clarity === undefined || e.clarity === null || e.clarity === "") ? null : Number(e.clarity),
    lucidMoment: Boolean(e.lucidMoment),
  };
}

// ====================== MOOD SPRITES (Daily Emotion) ======================
// ── Mood SVG Faces ──────────────────────────────────────────────────────────
// Color palette per emotion
const _MOOD_COLORS = {
  incredible: { bg:"#FFCE47", ring:"#F5A800", pupil:"#1C1433", shine:"#fff" },
  good:       { bg:"#5DDBA8", ring:"#28B982", pupil:"#0F3D2C", shine:"#fff" },
  meh:        { bg:"#8FA8C8", ring:"#5B7FA8", pupil:"#1E2D42", shine:"rgba(255,255,255,.7)" },
  bad:        { bg:"#7B8FD4", ring:"#4A5FBB", pupil:"#0F1A3D", shine:"rgba(255,255,255,.6)" },
  horrible:   { bg:"#E8604A", ring:"#C0382A", pupil:"#2A0A04", shine:"rgba(255,255,255,.5)" },
};

function _buildMoodSvg(id, size=48){
  const c = _MOOD_COLORS[id] || _MOOD_COLORS.meh;
  const s = size;
  const cx = s/2, cy = s/2, r = s/2 - 1.5;
  // Eye positions scaled
  const ex = s*0.335, ey = s*0.4, er = s*0.075;
  const ex2 = s - ex;
  const shine = er * 0.38;
  // Mouth
  const my = s*0.645;
  const mw = s*0.26;

  let mouthPath = "";
  if(id === "incredible"){
    // Big open smile
    mouthPath = `<path d="M${cx-mw*1.1} ${my} Q${cx} ${my+mw*1.3} ${cx+mw*1.1} ${my}" stroke="${c.pupil}" stroke-width="${s*0.048}" stroke-linecap="round" fill="rgba(255,255,255,.2)"/>`;
  } else if(id === "good"){
    // Smile
    mouthPath = `<path d="M${cx-mw} ${my} Q${cx} ${my+mw*0.9} ${cx+mw} ${my}" stroke="${c.pupil}" stroke-width="${s*0.045}" stroke-linecap="round" fill="none"/>`;
  } else if(id === "meh"){
    // Flat
    mouthPath = `<line x1="${cx-mw}" y1="${my+s*0.02}" x2="${cx+mw}" y2="${my+s*0.02}" stroke="${c.pupil}" stroke-width="${s*0.045}" stroke-linecap="round"/>`;
  } else if(id === "bad"){
    // Frown
    mouthPath = `<path d="M${cx-mw} ${my+s*0.05} Q${cx} ${my-s*0.06} ${cx+mw} ${my+s*0.05}" stroke="${c.pupil}" stroke-width="${s*0.045}" stroke-linecap="round" fill="none"/>`;
  } else if(id === "horrible"){
    // Deep frown + teeth hint
    mouthPath = `<path d="M${cx-mw*1.1} ${my+s*0.06} Q${cx} ${my-s*0.1} ${cx+mw*1.1} ${my+s*0.06}" stroke="${c.pupil}" stroke-width="${s*0.048}" stroke-linecap="round" fill="rgba(0,0,0,.15)"/>`;
  }

  // Eyebrows
  let brows = "";
  if(id === "incredible"){
    brows = `<path d="M${ex-er*1.5} ${ey-er*2.8} Q${ex} ${ey-er*3.5} ${ex+er*1.5} ${ey-er*2.8}" stroke="${c.pupil}" stroke-width="${s*0.04}" stroke-linecap="round" fill="none"/>
             <path d="M${ex2-er*1.5} ${ey-er*2.8} Q${ex2} ${ey-er*3.5} ${ex2+er*1.5} ${ey-er*2.8}" stroke="${c.pupil}" stroke-width="${s*0.04}" stroke-linecap="round" fill="none"/>`;
  } else if(id === "bad" || id === "horrible"){
    brows = `<path d="M${ex-er*1.4} ${ey-er*2.4} L${ex+er*1.4} ${ey-er*3.4}" stroke="${c.pupil}" stroke-width="${s*0.04}" stroke-linecap="round" fill="none"/>
             <path d="M${ex2+er*1.4} ${ey-er*2.4} L${ex2-er*1.4} ${ey-er*3.4}" stroke="${c.pupil}" stroke-width="${s*0.04}" stroke-linecap="round" fill="none"/>`;
  } else if(id === "meh"){
    brows = `<line x1="${ex-er*1.3}" y1="${ey-er*2.8}" x2="${ex+er*1.3}" y2="${ey-er*2.8}" stroke="${c.pupil}" stroke-width="${s*0.035}" stroke-linecap="round"/>
             <line x1="${ex2-er*1.3}" y1="${ey-er*2.8}" x2="${ex2+er*1.3}" y2="${ey-er*2.8}" stroke="${c.pupil}" stroke-width="${s*0.035}" stroke-linecap="round"/>`;
  }

  // Cheeks for good/incredible
  let cheeks = "";
  if(id === "incredible"){
    cheeks = `<circle cx="${cx-mw*0.95}" cy="${my-s*0.03}" r="${s*0.065}" fill="rgba(255,150,80,.28)"/>
              <circle cx="${cx+mw*0.95}" cy="${my-s*0.03}" r="${s*0.065}" fill="rgba(255,150,80,.28)"/>`;
  } else if(id === "good"){
    cheeks = `<circle cx="${cx-mw*0.85}" cy="${my-s*0.04}" r="${s*0.055}" fill="rgba(255,150,100,.2)"/>
              <circle cx="${cx+mw*0.85}" cy="${my-s*0.04}" r="${s*0.055}" fill="rgba(255,150,100,.2)"/>`;
  }

  return `<svg viewBox="0 0 ${s} ${s}" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${c.bg}" stroke="${c.ring}" stroke-width="1.5"/>
    ${cheeks}
    <circle cx="${ex}" cy="${ey}" r="${er}" fill="${c.pupil}"/>
    <circle cx="${ex2}" cy="${ey}" r="${er}" fill="${c.pupil}"/>
    <circle cx="${ex+shine}" cy="${ey-shine}" r="${shine}" fill="${c.shine}"/>
    <circle cx="${ex2+shine}" cy="${ey-shine}" r="${shine}" fill="${c.shine}"/>
    ${brows}
    ${mouthPath}
  </svg>`;
}

const _MOOD_SVGS = {
  incredible: _buildMoodSvg("incredible", 48),
  good:       _buildMoodSvg("good", 48),
  meh:        _buildMoodSvg("meh", 48),
  bad:        _buildMoodSvg("bad", 48),
  horrible:   _buildMoodSvg("horrible", 48),
};
const _MOOD_SVG_MINI = {
  incredible: _buildMoodSvg("incredible", 20),
  good:       _buildMoodSvg("good", 20),
  meh:        _buildMoodSvg("meh", 20),
  bad:        _buildMoodSvg("bad", 20),
  horrible:   _buildMoodSvg("horrible", 20),
};
function _getMoodSvg(id, mini=false){ 
  const map = mini ? _MOOD_SVG_MINI : _MOOD_SVGS;
  const faceId = ["incredible","good","meh","bad","horrible"].includes(id) ? id : "meh";
  return map[faceId] || map["meh"] || ""; 
}

const DEFAULT_MOOD_PRESETS = [
  // "Face" selector (like your reference app)
  // Each preset can have multiple labels (shown as dots under the face)
  { id:"incredible", src:"./src/emotions/Happy.png",   labels:["increíble"], score:9 },
  { id:"good",      src:"./src/emotions/Pleased.png", labels:["bien","ok","normal"], score:7 },
  { id:"meh",       src:"./src/emotions/Confused.png",labels:["meh"], score:5 },
  { id:"bad",       src:"./src/emotions/Sad.png",     labels:["mal","triste","cansado"], score:3 },
  { id:"horrible",  src:"./src/emotions/WTF.png",     labels:["horrible"], score:1 },

  // Legacy ids (so your old entries still render nicely)
  { id:"sad",       src:"./src/emotions/Sad.png",     labels:["sad"], score:3 },
  { id:"wtf",       src:"./src/emotions/WTF.png",     labels:["wtf"], score:1 },
  { id:"happy",     src:"./src/emotions/Happy.png",   labels:["happy"], score:9 },
  { id:"pleased",   src:"./src/emotions/Pleased.png", labels:["pleased"], score:7 },
  { id:"confused",  src:"./src/emotions/Confused.png",labels:["confused"], score:5 },
  { id:"angry",     src:"./src/emotions/Angry.png",   labels:["angry"], score:2 },
  { id:"irritated", src:"./src/emotions/Irritated.png",labels:["irritated"], score:2 },
];

function getAllMoodSprites(){
  const custom = Array.isArray(state.moodSpritesCustom) ? state.moodSpritesCustom : [];
  // custom sprites may include: {id, src, labels:[...], score:number}
  return [...DEFAULT_MOOD_PRESETS, ...custom];
}

function getMoodSpriteById(id){
  if(!id) return null;
  const all = getAllMoodSprites();
  return all.find(s=>String(s.id)===String(id)) || null;
}

function getMoodScoreById(id){
  const s = getMoodSpriteById(id);
  const n = Number(s?.score);
  return Number.isFinite(n) ? n : null;
}

function getMoodEntries(iso){
  const map = (state.moodDaily && typeof state.moodDaily==="object") ? state.moodDaily : {};
  const e = map[String(iso||"")];
  if(!e) return [];
  
  // Backward compatibility: if it's a single object (not an array), wrap it
  const entries = Array.isArray(e) ? e : [e];
  
  return entries.map(entry => ({
    iso: String(iso),
    spriteId: entry.spriteId ? String(entry.spriteId) : "",
    label: entry.label ? String(entry.label) : "",
    tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
    activities: Array.isArray(entry.activities) ? entry.activities.map(String) : [],
    energy: entry.energy ?? 0,
    note: entry.note ? String(entry.note) : "",
    ts: entry.ts ? String(entry.ts) : ""
  }));
}

function getMoodEntry(iso){
  const entries = getMoodEntries(iso);
  if(entries.length === 0) return null;
  return entries[entries.length - 1]; // Return the latest one for legacy usage
}

function setMoodEntry(iso, spriteId, label="", tags=[], note=""){
  const key = String(iso||"");
  state.moodDaily = (state.moodDaily && typeof state.moodDaily==="object") ? state.moodDaily : {};
  if(!spriteId){
    delete state.moodDaily[key];
  }else{
    state.moodDaily[key] = {
      spriteId: String(spriteId),
      label: String(label||""),
      tags: Array.isArray(tags) ? tags.map(String).filter(Boolean) : [],
      note: String(note||""),
      ts: new Date().toISOString()
    };
  }
  persist();
}

function readFilesAsDataUrls(fileList, cb){
  const files = Array.from(fileList || []);
  if(!files.length){ cb([]); return; }
  const out = [];
  let done = 0;
  files.forEach(f=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      out.push({ name: f.name, dataUrl: String(reader.result||"") });
      done++;
      if(done===files.length) cb(out);
    };
    reader.onerror = ()=>{
      done++;
      if(done===files.length) cb(out);
    };
    reader.readAsDataURL(f);
  });
}

function openMoodPickerModal(iso, opts={}){
  const host = document.querySelector("#app");
  const backdrop = document.createElement("div");
  backdrop.className = "modalBackdrop";

  const existing = getMoodEntry(iso);
  const faceIds = ["incredible","good","meh","bad","horrible"];
  const all = getAllMoodSprites();
  const faces = faceIds.map(id=>all.find(s=>String(s.id)===id)).filter(Boolean);

  // Always start blank for a new entry in the array
  let selectedId  = "";
  let activities  = new Set();
  let energy      = 0;
  let note        = "";

  // Map legacy ids → face ids
  if(selectedId && !faceIds.includes(selectedId)){
    const sc = getMoodScoreById(selectedId);
    if(sc!=null){
      const best = faces.map(f=>({id:f.id,d:Math.abs((getMoodScoreById(f.id)||5)-sc)})).sort((a,b)=>a.d-b.d)[0];
      selectedId = best?.id || "meh";
    } else selectedId="meh";
  }

  const FACE_COLORS = {
    incredible:"#4ADE80", good:"#86EFAC", meh:"#60A5FA", bad:"#FBBF24", horrible:"#F87171"
  };
  const FACE_LABELS = {
    incredible:"increíble", good:"bien", meh:"meh", bad:"mal", horrible:"horrible"
  };

  // Activity categories — mirrors your Daylio setup (loaded from state or default)
  const ACTIVITY_CATS_DEFAULT = [
    {
      id:"rutina", label:"Rutina", icon:"⭐",
      items:[
        {id:"tarot",      icon:"🔮", label:"Tarot"},
        {id:"dibujo",     icon:"🎨", label:"Dibujos"},
        {id:"fergis",     icon:"💜", label:"Fergis"},
        {id:"trading",    icon:"📈", label:"Trading"},
        {id:"musica",     icon:"🎵", label:"Música"},
        {id:"tiktok",     icon:"📱", label:"TikTok"},
        {id:"lectura",    icon:"📖", label:"Lectura"},
        {id:"meditacion", icon:"🧘", label:"Meditación"},
      ]
    },
    {
      id:"trabajo", label:"Trabajo", icon:"💼",
      items:[
        {id:"work",       icon:"💼", label:"Trabajo"},
        {id:"claims",     icon:"🗂️", label:"Claims"},
        {id:"clases",     icon:"📚", label:"Clases"},
        {id:"upwork",     icon:"💻", label:"Upwork"},
        {id:"deudas",     icon:"💸", label:"Deudas"},
        {id:"itinerario", icon:"🗺️", label:"Itinerario"},
      ]
    },
    {
      id:"sueno", label:"Sueño", icon:"🌙",
      items:[
        {id:"buen_sueno",       icon:"😴", label:"Buen sueño"},
        {id:"sueno_malo",       icon:"😵", label:"Sueño malo"},
        {id:"sueno_temprano",   icon:"🌛", label:"Sueño temprano"},
        {id:"sueno_tarde",      icon:"🌜", label:"Sueño tarde"},
      ]
    },
    {
      id:"salud", label:"Salud", icon:"🌿",
      items:[
        {id:"ejercicio",  icon:"🏃", label:"Ejercicio"},
        {id:"comer_rico", icon:"🥗", label:"Comer rico"},
        {id:"agua",       icon:"💧", label:"Agua"},
        {id:"enfermedad", icon:"🤒", label:"Enfermedad"},
        {id:"descanso",   icon:"🛋️", label:"Descanso"},
      ]
    },
    {
      id:"hogar", label:"Hogar", icon:"🏠",
      items:[
        {id:"limpiar",   icon:"🧹", label:"Limpiar"},
        {id:"cocinar",   icon:"🍳", label:"Cocinar"},
        {id:"compras",   icon:"🛒", label:"Compras"},
        {id:"familia",   icon:"👨‍👩‍👧", label:"Familia"},
        {id:"parrilla",  icon:"🥩", label:"Parrilla"},
      ]
    },
    {
      id:"ocio", label:"Ocio", icon:"🎮",
      items:[
        {id:"videojuegos",icon:"🎮", label:"Videojuegos"},
        {id:"serie",      icon:"📺", label:"Serie/Película"},
        {id:"salir",      icon:"🚶", label:"Salir"},
        {id:"estoico",    icon:"📜", label:"Diario Estoico"},
        {id:"nuevo_alquiler",icon:"🏡",label:"Nuevo Alquiler"},
      ]
    },
  ];

  // Use persisted categories (deep-cloned so edits don't affect the default)
  let ACTIVITY_CATS = state.moodActivityCats
    ? JSON.parse(JSON.stringify(state.moodActivityCats))
    : JSON.parse(JSON.stringify(ACTIVITY_CATS_DEFAULT));

  const saveActivityCats = () => {
    state.moodActivityCats = JSON.parse(JSON.stringify(ACTIVITY_CATS));
    save(LS.moodActivityCats, state.moodActivityCats);
  };

  const ENERGY_LABELS = ["","Agotado","Bajo","Regular","Bueno","Al 100"];
  const ENERGY_COLORS = ["","#F87171","#FBBF24","#60A5FA","#86EFAC","#4ADE80"];

  const close = ()=>{
    if(typeof window.anime==="function") animateSleepModalOut(backdrop,()=>backdrop.remove());
    else backdrop.remove();
  };

  // ── STEP 1: Face selector ─────────────────────────────────────────────────
  const renderStep1 = ()=>{
    const dateLabel = (()=>{
      try{ return new Date(iso+"T00:00:00").toLocaleDateString("es-PE",{weekday:"long",day:"numeric",month:"long"}); }
      catch{ return iso; }
    })();

    backdrop.innerHTML = `
      <div class="mpm-panel mpm-s1" role="dialog">
        <div class="mpm-s1-top">
          <button class="mpm-icon-btn" id="mpmHistBtn">📋</button>
          <button class="mpm-icon-btn" data-close>✕</button>
        </div>
        <div class="mpm-s1-title">¿Cómo estás?</div>
        <div class="mpm-s1-date">${escapeHtml(dateLabel)}</div>
        <div class="mpm-s1-faces" id="mpmS1Faces">
          ${faces.map(f=>`
            <button class="mpm-s1-face ${selectedId===f.id?"active":""}"
              data-face="${f.id}"
              style="--fc:${FACE_COLORS[f.id]||'#888'}">
              <div class="mpm-s1-face-svg">${_getMoodSvg(f.id,false)}</div>
              <div class="mpm-s1-face-lbl">${FACE_LABELS[f.id]||f.id}</div>
            </button>
          `).join("")}
        </div>
      </div>
    `;

    backdrop.addEventListener("click", e=>{ if(e.target===backdrop) close(); if(e.target?.closest("[data-close]")) close(); });
    backdrop.querySelector("#mpmHistBtn")?.addEventListener("click",()=>{ close(); openMoodMonthModal(iso); });

    backdrop.querySelectorAll("[data-face]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        selectedId = btn.getAttribute("data-face")||"meh";
        renderStep2();
      });
    });
  };

  // ── STEP 2: Activities + Energy + Note ───────────────────────────────────
  const renderStep2 = ()=>{
    const color = FACE_COLORS[selectedId]||"#888";
    const label = FACE_LABELS[selectedId]||selectedId;

    backdrop.innerHTML = `
      <div class="mpm-panel mpm-s2" role="dialog">

        <!-- Top bar -->
        <div class="mpm-s2-top">
          <button class="mpm-s2-back" id="mpmBack">
            <div class="mpm-s2-back-face" style="--fc:${color}">${_getMoodSvg(selectedId,false)}</div>
            <span class="mpm-s2-back-lbl" style="color:${color}">${escapeHtml(label)}</span>
          </button>
          <button class="mpm-s2-save" id="mpmSave">Guardar ✓</button>
        </div>

        <div class="mpm-s2-subtitle">¿Qué hiciste hoy?</div>

        <!-- Activity categories -->
        <div class="mpm-cats" id="mpmCats">
          ${ACTIVITY_CATS.map(cat=>`
            <div class="mpm-cat" data-cat="${cat.id}">
              <div class="mpm-cat-header">
                <span class="mpm-cat-icon">${cat.icon}</span>
                <span class="mpm-cat-label">${escapeHtml(cat.label)}</span>
                <button class="mpm-cat-add-item" data-add-item="${cat.id}" title="Agregar categoría">＋</button>
                <button class="mpm-cat-toggle" data-toggle="${cat.id}">▾</button>
              </div>
              <div class="mpm-cat-grid" id="mpmCatGrid_${cat.id}">
                ${cat.items.map(it=>`
                  <button class="mpm-act ${activities.has(it.id)?"active":""}"
                    data-act="${it.id}"
                    style="${activities.has(it.id)?`--ac:${color}`:''}">
                    <span class="mpm-act-icon">${it.icon}</span>
                    <span class="mpm-act-lbl">${escapeHtml(it.label)}</span>
                  </button>
                `).join("")}
              </div>
              <div class="mpm-new-item-form" id="mpmNewItemForm_${cat.id}" style="display:none">
                <input class="mpm-new-item-icon" data-icon-input="${cat.id}" type="text" maxlength="4" placeholder="🌟" value="">
                <input class="mpm-new-item-label" data-label-input="${cat.id}" type="text" maxlength="30" placeholder="Nombre...">
                <button class="mpm-new-item-confirm" data-confirm-item="${cat.id}">✓</button>
                <button class="mpm-new-item-cancel" data-cancel-item="${cat.id}">✕</button>
              </div>
            </div>
          `).join("")}

          <!-- New group button -->
          <button class="mpm-add-group-btn" id="mpmAddGroupBtn">＋ Nuevo grupo</button>
          <div class="mpm-new-group-form" id="mpmNewGroupForm" style="display:none">
            <input class="mpm-new-item-icon" id="mpmNewGroupIcon" type="text" maxlength="4" placeholder="🏷️" value="">
            <input class="mpm-new-item-label" id="mpmNewGroupLabel" type="text" maxlength="30" placeholder="Nombre del grupo...">
            <button class="mpm-new-item-confirm" id="mpmNewGroupConfirm">✓</button>
            <button class="mpm-new-item-cancel" id="mpmNewGroupCancel">✕</button>
          </div>
        </div>

        <!-- Energy -->
        <div class="mpm-s2-section">
          <div class="mpm-s2-section-title">⚡ Energía</div>
          <div class="mpm-energy-pills" id="mpmEnergyPills">
            ${ENERGY_LABELS.slice(1).map((lbl,i)=>{
              const v=i+1;
              const ec=ENERGY_COLORS[v];
              return `<button class="mpm-epill ${energy===v?"active":""}" data-ev="${v}" style="--ec:${ec}">
                <span class="mpm-epill-num">${v}</span>
                <span class="mpm-epill-lbl">${lbl}</span>
              </button>`;
            }).join("")}
          </div>
        </div>

        <!-- Note -->
        <div class="mpm-s2-section">
          <div class="mpm-s2-section-title">📝 Nota <span class="mpm-optional">opcional</span></div>
          <textarea class="mpm-textarea" id="mpmNote" rows="3" placeholder="¿Algo en especial hoy?...">${escapeHtml(note)}</textarea>
        </div>

        <div style="height:8px"></div>
      </div>
    `;

    backdrop.addEventListener("click", e=>{ if(e.target===backdrop) close(); if(e.target?.closest("[data-close]")) close(); });

    // Back
    backdrop.querySelector("#mpmBack")?.addEventListener("click", renderStep1);

    // Activity toggles
    backdrop.querySelectorAll("[data-act]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const id=btn.getAttribute("data-act")||"";
        if(activities.has(id)) activities.delete(id); else activities.add(id);
        btn.classList.toggle("active",activities.has(id));
        btn.style.setProperty("--ac", activities.has(id)?color:"");
      });
    });

    // Category collapse
    backdrop.querySelectorAll("[data-toggle]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const catId=btn.getAttribute("data-toggle")||"";
        const grid=backdrop.querySelector(`#mpmCatGrid_${catId}`);
        const catEl=btn.closest(".mpm-cat");
        if(!grid) return;
        const collapsed=catEl?.classList.toggle("collapsed");
        btn.textContent = collapsed?"▸":"▾";
      });
    });

    // Add item to category — show inline form
    const hideAllForms = () => {
      backdrop.querySelectorAll(".mpm-new-item-form, .mpm-new-group-form").forEach(f=>{ f.style.display="none"; });
    };
    const mkId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

    backdrop.querySelectorAll("[data-add-item]").forEach(btn=>{
      btn.addEventListener("click", e=>{
        e.stopPropagation();
        const catId=btn.getAttribute("data-add-item")||"";
        // Hide all other open forms first
        hideAllForms();
        const form=backdrop.querySelector(`#mpmNewItemForm_${catId}`);
        if(form){
          form.style.display="flex";
          form.querySelector("[data-icon-input]")?.focus();
        }
      });
    });

    // Confirm add item
    backdrop.querySelectorAll("[data-confirm-item]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const catId=btn.getAttribute("data-confirm-item")||"";
        const form=backdrop.querySelector(`#mpmNewItemForm_${catId}`);
        const iconEl=form?.querySelector("[data-icon-input]");
        const labelEl=form?.querySelector("[data-label-input]");
        const icon=(iconEl?.value||"").trim()||"⭐";
        const label=(labelEl?.value||"").trim();
        if(!label){ labelEl?.focus(); return; }
        const id=mkId("custom_"+catId);
        const cat=ACTIVITY_CATS.find(c=>c.id===catId);
        if(cat){ cat.items.push({id, icon, label}); }
        saveActivityCats();
        renderStep2();
      });
    });

    // Cancel add item
    backdrop.querySelectorAll("[data-cancel-item]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const catId=btn.getAttribute("data-cancel-item")||"";
        const form=backdrop.querySelector(`#mpmNewItemForm_${catId}`);
        if(form){ form.style.display="none"; }
      });
    });

    // Show new group form
    backdrop.querySelector("#mpmAddGroupBtn")?.addEventListener("click", e=>{
      e.stopPropagation();
      hideAllForms();
      const form=backdrop.querySelector("#mpmNewGroupForm");
      if(form){
        form.style.display="flex";
        backdrop.querySelector("#mpmNewGroupIcon")?.focus();
      }
    });

    // Confirm new group
    backdrop.querySelector("#mpmNewGroupConfirm")?.addEventListener("click", ()=>{
      const icon=(backdrop.querySelector("#mpmNewGroupIcon")?.value||"").trim()||"🏷️";
      const label=(backdrop.querySelector("#mpmNewGroupLabel")?.value||"").trim();
      if(!label){ backdrop.querySelector("#mpmNewGroupLabel")?.focus(); return; }
      const id=mkId("grp");
      ACTIVITY_CATS.push({id, icon, label, items:[]});
      saveActivityCats();
      renderStep2();
    });

    // Cancel new group
    backdrop.querySelector("#mpmNewGroupCancel")?.addEventListener("click", ()=>{
      const form=backdrop.querySelector("#mpmNewGroupForm");
      if(form){ form.style.display="none"; }
    });

    // Energy
    backdrop.querySelectorAll("[data-ev]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const v=Number(btn.getAttribute("data-ev")||0);
        energy = energy===v?0:v;
        backdrop.querySelectorAll("[data-ev]").forEach(b=>{
          b.classList.toggle("active",Number(b.getAttribute("data-ev"))===energy);
        });
      });
    });

    // Note
    backdrop.querySelector("#mpmNote")?.addEventListener("input",e=>{ note=e.target.value||""; });

    // Save
    backdrop.querySelector("#mpmSave")?.addEventListener("click",()=>{
      state.moodDaily = (state.moodDaily && typeof state.moodDaily==="object") ? state.moodDaily : {};
      const key=String(iso||"");
      
      let arr = Array.isArray(state.moodDaily[key]) ? state.moodDaily[key] : (state.moodDaily[key] ? [state.moodDaily[key]] : []);
      
      if(selectedId) {
        arr.push({
          spriteId: selectedId,
          label: FACE_LABELS[selectedId]||selectedId,
          activities: Array.from(activities),
          energy,
          note,
          ts: new Date().toISOString()
        });
        state.moodDaily[key] = arr;
      }
      persist(); view();
      if(typeof opts.onSaved==="function") opts.onSaved({iso,spriteId:selectedId,activities:Array.from(activities),energy,note});
      toast("Mood guardado ✅");
      close();
    });
  };

  // Start
  if(selectedId) renderStep2(); else renderStep1();

  host.appendChild(backdrop);
  if(typeof window.anime==="function") animateSleepModalIn(backdrop);
}

window.renderGithubHeatmap = function renderGithubHeatmap(year, dataMap) {
  // dataMap is { '2026-07-07': { color: '#ff0', intensity: 1, label: '3h' }, ... }
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const startDow = (start.getDay() + 6) % 7; // Lunes=0, Dom=6
  const cells = [];
  
  // Pad beginning
  for(let i=0; i<startDow; i++) cells.push(null);
  
  // Days
  for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)){
    cells.push(isoDate(d));
  }
  
  // Pad end
  while(cells.length % 7 !== 0) cells.push(null);
  
  // Build columns (53 weeks)
  const columns = [];
  for(let i=0; i<cells.length; i+=7) {
    columns.push(cells.slice(i, i+7));
  }
  
  // Months row
  const monthLabels = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  let curMonth = -1;
  const monthHtml = columns.map(col => {
    const firstValid = col.find(d => d);
    if(firstValid) {
      const m = Number(firstValid.split("-")[1]) - 1;
      if(m !== curMonth) {
        curMonth = m;
        return `<div class="gh-month-label" style="width:15px;flex-shrink:0;overflow:visible;">${monthLabels[m]}</div>`;
      }
    }
    return `<div class="gh-month-label" style="width:15px;flex-shrink:0;"></div>`;
  }).join("");

  const gridHtml = columns.map(col => {
    const cellsHtml = col.map(iso => {
      if(!iso) return `<div class="gh-cell" style="opacity:0"></div>`;
      const d = dataMap[iso];
      const color = d?.color || "transparent";
      const border = d?.color ? "none" : "1px solid rgba(255,255,255,0.05)";
      const title = d?.label ? `${iso}: ${d.label}` : `${iso}: Sin registro`;
      return `<div class="gh-cell" style="background:${color};border:${border};box-sizing:border-box;" title="${title}"></div>`;
    }).join("");
    return `<div class="gh-col" style="display:flex;flex-direction:column;gap:3px;width:12px;flex-shrink:0;">${cellsHtml}</div>`;
  }).join("");

  return `
    <div class="gh-heatmap-wrapper">
      <div class="gh-heatmap-title">🔥 Mapa Anual ${year}</div>
      <div class="gh-heatmap-scroll">
        <div class="gh-months-row" style="display:flex;padding-left:16px;gap:0;">${monthHtml}</div>
        <div style="display:flex;gap:4px">
          <div style="display:flex;flex-direction:column;justify-content:space-between;font-size:9px;color:rgba(255,255,255,0.3);padding:2px 0;width:12px;flex-shrink:0;text-align:right;">
            <div>L</div><div>X</div><div>V</div><div>D</div>
          </div>
          <div class="gh-heatmap-grid" style="display:flex;gap:3px;">${gridHtml}</div>
        </div>
      </div>
    </div>
  `;
}

function openMoodMonthModal(initialIso){
  const host = document.querySelector("#app");
  const backdrop = document.createElement("div");
  backdrop.className = "modalBackdrop";

  const start = initialIso ? new Date(initialIso+"T00:00:00") : new Date();
  if(Number.isNaN(start.getTime())) start.setTime(Date.now());
  start.setHours(0,0,0,0);
  let cursor = new Date(start); cursor.setDate(1);
  let activeTab = "calendar";

  const FACE_SCORE = {incredible:5,good:4,meh:3,bad:2,horrible:1};
  const FACE_COLOR = {incredible:"#4ADE80",good:"#86EFAC",meh:"#60A5FA",bad:"#FBBF24",horrible:"#F87171"};
  const FACE_LABEL = {incredible:"Increíble",good:"Bien",meh:"Meh",bad:"Mal",horrible:"Horrible"};
  const ENERGY_COLORS = ["","#F87171","#FBBF24","#60A5FA","#86EFAC","#4ADE80"];

  const close = ()=>{
    if(typeof window.anime==="function") animateSleepModalOut(backdrop,()=>backdrop.remove());
    else backdrop.remove();
  };

  const getMonthEntries = (y,m)=>{
    const map = (state.moodDaily && typeof state.moodDaily==="object") ? state.moodDaily : {};
    const monthKey = `${y}-${String(m+1).padStart(2,"0")}`;
    let out = [];
    Object.keys(map).forEach(k => {
      if(String(k).startsWith(monthKey)){
         const arr = Array.isArray(map[k]) ? map[k] : [map[k]];
         arr.forEach((e, idx) => out.push({ iso: k, arrayIndex: idx, ...e }));
      }
    });
    return out.sort((a,b)=>a.iso.localeCompare(b.iso) || (a.ts||"").localeCompare(b.ts||""));
  };

  const render = ()=>{
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const first = new Date(y,m,1);
    const title = first.toLocaleDateString("es-PE",{month:"long",year:"numeric"});
    const map = (state.moodDaily && typeof state.moodDaily==="object") ? state.moodDaily : {};
    const entries = getMonthEntries(y,m);

    // ── Calendar tab ──
    const calHtml = ()=>{
      const last = new Date(y,m+1,0);
      const daysInMonth = last.getDate();
      const startDow = (first.getDay()+6)%7;
      const cells = [];
      for(let i=0;i<startDow;i++) cells.push(null);
      for(let d=1;d<=daysInMonth;d++) cells.push(isoDate(new Date(y,m,d)));
      while(cells.length%7!==0) cells.push(null);

      const cellHtml = cells.map(iso=>{
        if(!iso) return `<div class="moodCalCell empty"></div>`;
        const arr = Array.isArray(map[iso]) ? map[iso] : (map[iso] ? [map[iso]] : []);
        const e = arr.length ? arr[arr.length-1] : null;
        const sp = e ? getMoodSpriteById(e.spriteId) : null;
        const svgFace = sp ? _getMoodSvg(sp.id,true) : "";
        const en = e?.energy||0;
        const enBar = en>0 ? `<div class="mmcal-en" style="width:${en*20}%;background:${ENERGY_COLORS[en]||'#60A5FA'}"></div>` : "";
        return `<button class="moodCalCell ${sp?"has-mood":""}" data-iso="${escapeHtml(iso)}">
          <div class="moodCalNum">${escapeHtml(String(Number(iso.slice(8,10))))}</div>
          ${svgFace?`<div class="moodCalSvg">${svgFace}</div>`:`<div class="moodCalEmpty">＋</div>`}
          ${enBar}
        </button>`;
      }).join("");

      return `
        <div class="moodCalHeader">${["L","M","M","J","V","S","D"].map(x=>`<div>${x}</div>`).join("")}</div>
        <div class="moodCalGrid">${cellHtml}</div>
        <div class="mmcal-tip">Toca un día para editar su emoción</div>
      `;
    };

    // ── Gráficos tab ──
    const chartsHtml = ()=>{
      if(!entries.length) return `<div class="mmh-empty">Sin registros este mes.</div>`;

      // 0. Heatmap Anual
      const heatmapData = {};
      Object.keys(map).forEach(iso => {
        if(!iso.startsWith(String(y))) return;
        const arr = Array.isArray(map[iso]) ? map[iso] : [map[iso]];
        const last = arr[arr.length-1];
        if(last && last.spriteId) {
          heatmapData[iso] = {
            color: FACE_COLOR[last.spriteId] || "#60A5FA",
            label: FACE_LABEL[last.spriteId] || last.spriteId
          };
        }
      });
      const ghHtml = renderGithubHeatmap(y, heatmapData);

      // 1. Mood line chart (SVG)
      const scored = entries.map(e=>({ iso:e.iso, sc:FACE_SCORE[e.spriteId]||3, color:FACE_COLOR[e.spriteId]||"#60A5FA", en:Number(e.energy)||0 }));
      const W=320, H=80, PAD=10;
      const scMin=1, scMax=5;
      const pts = scored.map((d,i)=>({
        x: PAD + i*(W-PAD*2)/(Math.max(scored.length-1,1)),
        y: PAD + (scMax-d.sc)/(scMax-scMin)*(H-PAD*2)
      }));
      const polyline = pts.map(p=>`${p.x},${p.y}`).join(" ");
      // fill area
      const area = pts.length>1
        ? `M${pts[0].x},${H-PAD} `+pts.map(p=>`L${p.x},${p.y}`).join(" ")+` L${pts[pts.length-1].x},${H-PAD} Z`
        : "";
      const moodLineSvg = `
        <svg viewBox="0 0 ${W} ${H}" class="mmchart-svg" preserveAspectRatio="none">
          <defs>
            <linearGradient id="mlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#7C5CFF" stop-opacity=".35"/>
              <stop offset="100%" stop-color="#7C5CFF" stop-opacity="0"/>
            </linearGradient>
          </defs>
          ${area?`<path d="${area}" fill="url(#mlGrad)"/>`:""}
          ${pts.length>1?`<polyline points="${polyline}" fill="none" stroke="#7C5CFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`:""}
          ${pts.map((p,i)=>`<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${scored[i].color}" stroke="#0b0a18" stroke-width="1.5"/>`).join("")}
        </svg>
        <div class="mmchart-axis">
          ${[0,Math.floor((entries.length-1)/2),entries.length-1].map(i=>entries[i]?`<span>${entries[i].iso.slice(8)}</span>`:"").join("")}
        </div>
      `;

      // 2. Mood frequency donut-ish (horizontal bars)
      const counts = {};
      entries.forEach(e=>{ const id=e.spriteId||"meh"; counts[id]=(counts[id]||0)+1; });
      const total = entries.length;
      const freqBars = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([id,n])=>`
        <div class="mmfreq-row">
          <div class="mmfreq-face">${_getMoodSvg(id,true)}</div>
          <div class="mmfreq-track">
            <div class="mmfreq-fill" style="width:${Math.round(n/total*100)}%;background:${FACE_COLOR[id]||'#888'}"></div>
          </div>
          <div class="mmfreq-count">${n}×</div>
        </div>
      `).join("");

      // 3. Energy avg per day (bar chart SVG)
      const enData = entries.filter(e=>e.energy>0);
      let energySection = "";
      if(enData.length>0){
        const EW=320, EH=60, EP=8;
        const bw = Math.max(4, (EW-EP*2)/Math.max(enData.length,1) - 3);
        const bars = enData.map((e,i)=>{
          const bh = (e.energy/5)*(EH-EP*2);
          const bx = EP + i*((EW-EP*2)/Math.max(enData.length,1));
          const by = EH-EP-bh;
          return `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" fill="${ENERGY_COLORS[e.energy]||'#60A5FA'}" opacity=".85"/>`;
        }).join("");
        const avgEn = enData.reduce((s,e)=>s+e.energy,0)/enData.length;
        energySection = `
          <div class="mmchart-card">
            <div class="mmchart-title">⚡ Energía promedio <span class="mmchart-stat">${avgEn.toFixed(1)}/5</span></div>
            <svg viewBox="0 0 ${EW} ${EH}" class="mmchart-svg" style="height:60px" preserveAspectRatio="none">
              ${bars}
            </svg>
          </div>
        `;
      }

      // 4. Activities top
      const actCount = {};
      entries.forEach(e=>{ (Array.isArray(e.activities)?e.activities:[]).forEach(a=>{ actCount[a]=(actCount[a]||0)+1; }); });
      const topActs = Object.entries(actCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
      const actSection = topActs.length ? `
        <div class="mmchart-card">
          <div class="mmchart-title">🏃 Actividades del mes</div>
          <div class="mmact-grid">
            ${topActs.map(([id,n])=>{
              const allItems = [
                {id:"tarot",icon:"🔮"},{id:"dibujo",icon:"🎨"},{id:"fergis",icon:"💜"},
                {id:"trading",icon:"📈"},{id:"musica",icon:"🎵"},{id:"tiktok",icon:"📱"},
                {id:"lectura",icon:"📖"},{id:"meditacion",icon:"🧘"},{id:"work",icon:"💼"},
                {id:"claims",icon:"🗂️"},{id:"clases",icon:"📚"},{id:"upwork",icon:"💻"},
                {id:"deudas",icon:"💸"},{id:"itinerario",icon:"🗺️"},{id:"buen_sueno",icon:"😴"},
                {id:"sueno_malo",icon:"😵"},{id:"sueno_temprano",icon:"🌛"},{id:"sueno_tarde",icon:"🌜"},
                {id:"ejercicio",icon:"🏃"},{id:"comer_rico",icon:"🥗"},{id:"agua",icon:"💧"},
                {id:"enfermedad",icon:"🤒"},{id:"descanso",icon:"🛋️"},{id:"limpiar",icon:"🧹"},
                {id:"cocinar",icon:"🍳"},{id:"compras",icon:"🛒"},{id:"familia",icon:"👨‍👩‍👧"},
                {id:"parrilla",icon:"🥩"},{id:"videojuegos",icon:"🎮"},{id:"serie",icon:"📺"},
                {id:"salir",icon:"🚶"},{id:"estoico",icon:"📜"},{id:"nuevo_alquiler",icon:"🏡"},
              ];
              const item = allItems.find(x=>x.id===id)||{icon:"🏷️"};
              return `<div class="mmact-item">
                <div class="mmact-icon">${item.icon}</div>
                <div class="mmact-n">${n}</div>
              </div>`;
            }).join("")}
          </div>
        </div>
      ` : "";

      // 5. Streak calc
      const allDays = Object.keys(map).sort();
      let streak=0, maxStreak=0, cur=0;
      const today = isoDate(new Date());
      
      const getIsoEntry = (isoKey) => {
        const a = Array.isArray(map[isoKey]) ? map[isoKey] : (map[isoKey] ? [map[isoKey]] : []);
        return a.length ? a[a.length-1] : null;
      };

      // count backward from today
      let d=new Date(); 
      while(true){
        const iso=isoDate(d);
        if(getIsoEntry(iso)?.spriteId){ streak++; d.setDate(d.getDate()-1); }
        else break;
      }
      // max streak
      let prev=null, ms=0;
      allDays.forEach(iso=>{ if(getIsoEntry(iso)?.spriteId){ ms++; maxStreak=Math.max(maxStreak,ms); } else ms=0; });
      const streakSection = `
        <div class="mmchart-card mmstreak-card">
          <div class="mmstreak-row">
            <div class="mmstreak-block">
              <div class="mmstreak-num">${streak}</div>
              <div class="mmstreak-lbl">🔥 Racha actual</div>
            </div>
            <div class="mmstreak-block">
              <div class="mmstreak-num">${maxStreak}</div>
              <div class="mmstreak-lbl">🏆 Mejor racha</div>
            </div>
            <div class="mmstreak-block">
              <div class="mmstreak-num">${entries.length}</div>
              <div class="mmstreak-lbl">📅 Este mes</div>
            </div>
          </div>
        </div>
      `;

      return `
        ${streakSection}
        ${ghHtml}
        <div class="mmchart-card">
          <div class="mmchart-title">📈 Estado de ánimo</div>
          <div class="mmchart-yaxis">
            ${["incredible","good","meh","bad","horrible"].map(id=>`<div class="mmchart-yface">${_getMoodSvg(id,true)}</div>`).join("")}
          </div>
          ${moodLineSvg}
        </div>
        <div class="mmchart-card">
          <div class="mmchart-title">📊 Frecuencia del mes</div>
          ${freqBars}
        </div>
        ${energySection}
        ${actSection}
      `;
    };

    // ── Registro tab ──
    const registroHtml = ()=>{
      if(!entries.length) return `<div class="mmh-empty">Sin registros este mes.</div>`;
      return entries.slice().reverse().map(e=>{
        const sp = getMoodSpriteById(e.spriteId);
        const svgFace = sp?_getMoodSvg(sp.id,false):"";
        const en = Number(e.energy)||0;
        const enDots = en>0?Array.from({length:5},(_,i)=>`<div class="mml-en-dot ${i<en?"on":""}" style="${i<en?"--ec:"+ENERGY_COLORS[en]:""}"></div>`).join(""):"";
        const acts = Array.isArray(e.activities)?e.activities:[];
        const allItems2 = [{id:"tarot",icon:"🔮",label:"Tarot"},{id:"dibujo",icon:"🎨",label:"Dibujos"},{id:"fergis",icon:"💜",label:"Fergis"},{id:"trading",icon:"📈",label:"Trading"},{id:"musica",icon:"🎵",label:"Música"},{id:"tiktok",icon:"📱",label:"TikTok"},{id:"lectura",icon:"📖",label:"Lectura"},{id:"meditacion",icon:"🧘",label:"Meditación"},{id:"work",icon:"💼",label:"Trabajo"},{id:"claims",icon:"🗂️",label:"Claims"},{id:"clases",icon:"📚",label:"Clases"},{id:"upwork",icon:"💻",label:"Upwork"},{id:"deudas",icon:"💸",label:"Deudas"},{id:"itinerario",icon:"🗺️",label:"Itinerario"},{id:"buen_sueno",icon:"😴",label:"Buen sueño"},{id:"sueno_malo",icon:"😵",label:"Sueño malo"},{id:"sueno_temprano",icon:"🌛",label:"Sueño temprano"},{id:"sueno_tarde",icon:"🌜",label:"Sueño tarde"},{id:"ejercicio",icon:"🏃",label:"Ejercicio"},{id:"comer_rico",icon:"🥗",label:"Comer rico"},{id:"agua",icon:"💧",label:"Agua"},{id:"enfermedad",icon:"🤒",label:"Enfermedad"},{id:"descanso",icon:"🛋️",label:"Descanso"},{id:"limpiar",icon:"🧹",label:"Limpiar"},{id:"cocinar",icon:"🍳",label:"Cocinar"},{id:"compras",icon:"🛒",label:"Compras"},{id:"familia",icon:"👨‍👩‍👧",label:"Familia"},{id:"parrilla",icon:"🥩",label:"Parrilla"},{id:"videojuegos",icon:"🎮",label:"Videojuegos"},{id:"serie",icon:"📺",label:"Serie"},{id:"salir",icon:"🚶",label:"Salir"},{id:"estoico",icon:"📜",label:"Estoico"},{id:"nuevo_alquiler",icon:"🏡",label:"Nuevo Alquiler"}];
        const actChips = acts.slice(0,6).map(a=>{ const it=allItems2.find(x=>x.id===a)||{icon:"🏷️",label:a}; return `<span class="mml-tag-chip">${it.icon} ${escapeHtml(it.label)}</span>`; }).join("");
        const dateLabel = (()=>{ try{ return new Date(e.iso+"T00:00:00").toLocaleDateString("es-PE",{weekday:"short",day:"numeric",month:"short"}); }catch{return e.iso;} })();
        return `
          <div class="moodLogCard mml-card" data-iso="${escapeHtml(e.iso)}">
            <div class="mml-head">
              <div class="mml-face">${svgFace}</div>
              <div class="mml-meta">
                <div class="mml-label" style="color:${FACE_COLOR[e.spriteId]||'#fff'}">${escapeHtml(FACE_LABEL[e.spriteId]||e.label||"—")}</div>
                <div class="mml-date">${escapeHtml(dateLabel)}</div>
                ${en>0?`<div class="mml-energy-row">${enDots}<span class="mml-en-num">⚡${en}/5</span></div>`:""}
              </div>
              <button class="iconBtn mml-delete-btn" data-del-iso="${escapeHtml(e.iso)}" data-del-idx="${e.arrayIndex}" aria-label="Eliminar" style="margin-left:auto; color:#ef4444; font-size:16px;">🗑️</button>
            </div>
            ${actChips?`<div class="mml-tags">${actChips}</div>`:""}
            ${e.note?`<div class="mml-note">"${escapeHtml(String(e.note))}"</div>`:""}
          </div>
        `;
      }).join("");
    };

    const TABS = [{id:"calendar",label:"📅 Mes"},{id:"charts",label:"📊 Stats"},{id:"registro",label:"📋 Log"}];

    backdrop.innerHTML = `
      <div class="mmh-panel" role="dialog">
        <div class="mmh-top">
          <div>
            <div class="mmh-title">Emociones</div>
            <div class="mmh-sub">${escapeHtml(title)}</div>
          </div>
          <div style="display:flex;gap:7px;align-items:center">
            <button class="mpm-icon-btn" id="mmPrev">‹</button>
            <button class="mpm-icon-btn" id="mmNext">›</button>
            <button class="mpm-icon-btn" data-close>✕</button>
          </div>
        </div>
        <div class="mmh-tabs">
          ${TABS.map(t=>`<button class="mmh-tab ${t.id===activeTab?"active":""}" data-tab="${t.id}">${t.label}</button>`).join("")}
        </div>
        <div class="mmh-body" id="mmhBody">
          ${activeTab==="calendar" ? calHtml() : activeTab==="charts" ? chartsHtml() : registroHtml()}
        </div>
      </div>
    `;

    backdrop.querySelector("#mmPrev")?.addEventListener("click",()=>{ cursor=new Date(y,m-1,1); render(); });
    backdrop.querySelector("#mmNext")?.addEventListener("click",()=>{ cursor=new Date(y,m+1,1); render(); });
    backdrop.querySelectorAll("[data-tab]").forEach(btn=>{
      btn.addEventListener("click",()=>{ activeTab=btn.getAttribute("data-tab")||"calendar"; render(); });
    });
    backdrop.querySelectorAll("[data-iso]").forEach(btn=>{
      btn.addEventListener("click",()=>{ openMoodPickerModal(btn.getAttribute("data-iso")||"",{onSaved:()=>render()}); });
    });
    backdrop.querySelectorAll(".mml-delete-btn").forEach(btn=>{
      btn.addEventListener("click",(e)=>{
        e.stopPropagation();
        const iso = btn.getAttribute("data-del-iso");
        const idx = Number(btn.getAttribute("data-del-idx"));
        if(!iso || isNaN(idx)) return;
        if(confirm("¿Estás seguro de que deseas eliminar este registro de emoción?")) {
          const arr = state.moodDaily[iso];
          if(Array.isArray(arr)) {
            arr.splice(idx, 1);
            if(arr.length === 0) delete state.moodDaily[iso];
            persist();
            render();
            if(typeof window.view === "function") window.view();
          }
        }
      });
    });
    backdrop.addEventListener("click",e=>{ if(e.target===backdrop) close(); if(e.target?.closest("[data-close]")) close(); });
  };

  host.appendChild(backdrop);
  if(typeof window.anime==="function") animateSleepModalIn(backdrop);
  render();
}

function getSleepSeries(days=7){
  const n = Math.max(1, Math.min(31, Number(days)||7));
  const today = new Date();
  const dates = [];
  for(let i=n-1;i>=0;i--){
    const d = new Date(today);
    d.setDate(today.getDate()-i);
    dates.push(isoDate(d));
  }

  const map = new Map();
  const log = (state.sleepLog || []).map(normalizeSleepEntry).filter(Boolean);

  for(const e of log){
    map.set(e.date, (map.get(e.date)||0) + e.totalMinutes);
  }

  const items = dates.map(date => ({ date, minutes: map.get(date)||0 }));
  const maxMinutes = Math.max(60, ...items.map(x=>x.minutes), 8*60); // keep chart readable vs 8h baseline
  const avgMinutes = items.reduce((s,x)=>s+x.minutes,0) / items.length;
  const last = items[items.length-1]?.minutes || 0;

  return { items, maxMinutes, avgMinutes, lastMinutes: last };
}


function getSleepWeekSeries(){
  // Current week view (Sunday..Saturday) so bars match D L M M J V S
  const today = new Date();
  const start = new Date(today);
  // JS getDay(): 0=Sun..6=Sat
  start.setDate(today.getDate() - today.getDay());

  const dates = Array.from({length:7}, (_,i)=>{
    const d = new Date(start);
    d.setDate(start.getDate()+i);
    return isoDate(d);
  });

  const map = new Map();
  const log = (state.sleepLog || []).map(normalizeSleepEntry).filter(Boolean);
  for(const e of log){
    map.set(e.date, (map.get(e.date)||0) + e.totalMinutes);
  }

  const items = dates.map(date => ({ date, minutes: map.get(date)||0 }));
  // Keep chart readable vs an 8h baseline
  const maxMinutes = Math.max(60, ...items.map(x=>x.minutes), 8*60);

  // Average only over recorded nights in this 7-day window (ignore zeros)
  const recorded = items.filter(x=>x.minutes > 0);
  const avgMinutes = recorded.length ? (recorded.reduce((s,x)=>s+x.minutes,0) / recorded.length) : 0;

  // "Última noche" = yesterday if present, else most recent recorded night up to today
  const todayIso = isoDate(today);
  const y = new Date(today); y.setDate(today.getDate()-1);
  const yIso = isoDate(y);
  let lastMinutes = map.get(yIso) || 0;

  if(!lastMinutes){
    // find latest recorded entry within the window up to today
    for(let i=items.length-1;i>=0;i--){
      if(items[i].date <= todayIso && items[i].minutes > 0){
        lastMinutes = items[i].minutes;
        break;
      }
    }
  }

  return { items, maxMinutes, avgMinutes, lastMinutes };
}




function renderSleepBars(series){
  const items = series?.items || [];
  const maxM = series?.maxMinutes || 480;
  const avgH = (series?.avgMinutes || 0) / 60;
  const lastH = (series?.lastMinutes || 0) / 60;

  const qualityIcon = avgH >= 7 ? "✦" : (avgH >= 5.5 ? "◈" : "◇");
  const qualityLabel = avgH >= 7 ? "Bien" : (avgH >= 5.5 ? "Regular" : "Bajo");

  const dayLetters = ["D","L","M","M","J","V","S"];

  const maxBarH = 52, minBarH = 4;

  const cols = items.map((x) => {
    const ratio = maxM > 0 ? Math.max(0, Math.min(1, x.minutes / maxM)) : 0;
    const barH = x.minutes > 0 ? Math.round(minBarH + ratio * (maxBarH - minBarH)) : minBarH;
    const hrs = (x.minutes / 60).toFixed(1);
    const d = new Date(x.date + "T00:00:00");
    const ch = dayLetters[d.getDay()] || "·";
    const isEmpty = x.minutes === 0;
    const isGood = x.minutes >= 7 * 60;
    return `
      <div class="djp-sc-col" title="${escapeHtml(x.date)} · ${escapeHtml(hrs)}h">
        <div class="djp-sc-bar ${isEmpty ? "empty" : isGood ? "good" : ""}" style="--bh:${barH}px"></div>
        <div class="djp-sc-lbl">${escapeHtml(ch)}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="djp-sc-meta">
      <div class="djp-sc-big">${escapeHtml(lastH > 0 ? lastH.toFixed(1) : "0.0")}<span class="djp-sc-unit">h</span></div>
      <div class="djp-sc-meta-right">
        <div class="djp-sc-badge ${avgH >= 7 ? "good" : avgH >= 5.5 ? "mid" : "low"}">${qualityIcon} ${qualityLabel}</div>
        <div class="djp-sc-avg">Prom ${escapeHtml(avgH.toFixed(1))}h / noche</div>
      </div>
    </div>
    <div class="djp-sc-chart">${cols || `<div class="djp-sc-empty">Sin datos esta semana</div>`}</div>
  `;
}

function getMusicDisplay(){
  const log = Array.isArray(state.musicLog) ? state.musicLog : [];
  const cursor = Math.max(0, Math.min(log.length-1, Number(state.musicCursor||0)));
  const todayIso = getTodayIso();

  // Prefer today's explicit record if date matches
  if (state.musicToday && state.musicToday.date === todayIso){
    return { item: state.musicToday, mode:"today", cursor:0, total: log.length };
  }
  if (log.length === 0){
    return { item: null, mode:"empty", cursor:0, total:0 };
  }
  return { item: log[cursor], mode:"log", cursor, total: log.length };
}

// ====================== NeuroClaw (local suggestions engine) ======================
function neuroclawRunNow({ animate=true } = {}){
  try{
    const now = new Date();
    const runner = (window.NeuroClaw && window.NeuroClaw.run) ? window.NeuroClaw.run : null;
    if(!runner){
      console.warn("NeuroClaw: engine not loaded (window.NeuroClaw.run missing)");
      try{ if(typeof toast==="function") toast("NeuroClaw no cargó 😅"); }catch(e){}
      return;
    }
    try{ if(typeof toast==="function") toast("NeuroClaw: analizando…"); }catch(e){}

    const maybePromise = runner({
      sleepLog: state.sleepLog || [],
      moodDaily: state.moodDaily || {},
      reminders: state.reminders || [],
      shoppingHistory: state.shoppingHistory || [],
      house: state.house || {},
      now,
    });

    const handleOut = async (out)=>{
      state.neuroclawLast = out;
      state.neuroclawLastViewedAt = Date.now();
      try{ saveState(); }catch(e){}
      try{ view(); }catch(e){}
      try{ if(typeof toast==="function") toast("NeuroClaw listo ✅"); }catch(e){}

      // Optional: Cloud AI follow-up (does not replace local rules)
      try{
        const cfg = ensureNeuroAiConfig();
        const url = (cfg && cfg.url) ? cfg.url : getNeuroAiUrl();
        const key = (cfg && cfg.key) ? cfg.key : getNeuroAiKey();
        if(url && key && out && out.signals){
          try{ if(typeof toast==="function") toast("NeuroClaw AI: consultando…"); }catch(e){}
          // Show AI progress directly inside the Home card.
          state.neuroclawAiLoading = true;
          try{ saveState(); }catch(e){}
          try{ view(); }catch(e){}

          // Daily limit: max 3 Cloud AI calls/day (protect free tier)
          if(!canNeuroAiCall()){
            // Fallback: generate a reflective insight using stored AI logs as memory (no external call).
            const aiTs = Date.now();
            const ai = neuroclawLocalFallbackAI({ signals: out.signals, now });
            state.neuroclawAiLoading = false;
            state.neuroclawLast = Object.assign({}, state.neuroclawLast, { ai, aiTs });

            try{
              const id = "local_" + new Date(aiTs).toISOString();
              appendAiLog({
                id,
                ts: aiTs,
                window_days: 7,
                signals_snapshot: out.signals || {},
                human: ai?.human || "",
                raw: ai?.raw || { source: 'local_fallback' },
                user_rating: null,
                user_note: "",
              });
            }catch(e){}

            try{ saveState(); }catch(e){}
            try{ view(); }catch(e){}
            try{ if(typeof toast==="function") toast("NeuroClaw AI: límite 3/3, usando memoria local 🧠"); }catch(e){}
            return;
          }
          incNeuroAiCalls();
          let ai = await neuroclawCallCloudAI({ signals: out.signals, now });
          const aiTs = Date.now();
          state.neuroclawAiLoading = false;

          // If Cloud AI fails, fallback locally (still uses stored log).
          if(!ai){
            ai = neuroclawLocalFallbackAI({ signals: out.signals, now });
          }

          state.neuroclawLast = Object.assign({}, state.neuroclawLast, { ai, aiTs });

try{
  if(ai && (ai.human || ai.raw)){
    const id = "ai_" + new Date(aiTs).toISOString();
    appendAiLog({
      id,
      ts: aiTs,
      window_days: (ai.raw && ai.raw.window_days) ? ai.raw.window_days : 7,
      signals_snapshot: out.signals || {},
      human: ai.human || "",
      raw: ai.raw || {},
      user_rating: null,
      user_note: "",
    });
  }
}catch(e){}

try{ saveState(); }catch(e){}
try{ view(); }catch(e){}
          try{ if(typeof toast==="function") toast("NeuroClaw AI listo 🤖✅"); }catch(e){}
        }
      }catch(err){
        console.warn(err);
        state.neuroclawAiLoading = false;
        try{ saveState(); }catch(e){}
        try{ view(); }catch(e){}
        try{ if(typeof toast==="function") toast("NeuroClaw AI falló (ver consola)"); }catch(e){}
      }
    };

    if(maybePromise && typeof maybePromise.then === "function"){
      maybePromise.then(handleOut).catch(err=>{
        console.error("NeuroClaw run error", err);
        try{ if(typeof toast==="function") toast("NeuroClaw error (ver consola)"); }catch(e){}
      });
    }else{
      // support sync engines too
      handleOut(maybePromise);
    }
  }catch(e){
    console.error("NeuroClaw error", e);
    try{ if(typeof toast==="function") toast("NeuroClaw error (ver consola)"); }catch(_){}
  }
}

function neuroclawTopSuggestions(limit=3){
  const s = (state.neuroclawLast && Array.isArray(state.neuroclawLast.suggestions)) ? state.neuroclawLast.suggestions : [];
  return s.slice(0, limit);
}

function neuroclawBadge(p){
  const k = String(p||"low").toLowerCase();
  if(k==="high") return `<span class="neuroBadge high">Alta</span>`;
  if(k==="medium") return `<span class="neuroBadge med">Media</span>`;
  return `<span class="neuroBadge low">Baja</span>`;
}


function renderNeuroClawAIBlock(){
  const loading = !!state?.neuroclawAiLoading;
  const ai = state?.neuroclawLast?.ai || null;

  // If we're loading, show a visible block even if we don't have ai content yet.
  if(loading){
    return `
      <div class="hr"></div>
      <div class="ncAi ncAiLoading">
        <div class="ncAiHead">
          <div class="ncAiTitle">NeuroClaw AI</div>
          <div class="ncAiMeta">Procesando…</div>
        </div>
        <div class="ncAiBody">
          <div class="ncAiText">Estoy leyendo tus señales y armando patrones<span class="ncDots"><span>.</span><span>.</span><span>.</span></span></div>
        </div>
      </div>
    `;
  }

  if(!ai) return "";

  const human = (ai.human || "").trim();
  const rawTxt = (!human && ai.raw) ? JSON.stringify(ai.raw, null, 2) : "";
  if(!human && !rawTxt) return "";

  const tsMs = Number(state?.neuroclawLast?.aiTs || 0) || 0;
  const stamp = tsMs ? new Date(tsMs).toLocaleString("es-PE",{hour:"2-digit",minute:"2-digit"}) : "";
  const model = (ai.raw && ai.raw.model) ? String(ai.raw.model) : "";
  const meta = [stamp, model ? ("🤖 " + model) : ""].filter(Boolean).join(" • ");

  return `
      <div class="hr"></div>
      <div class="ncAi">
        <div class="ncAiHead">
          <div class="ncAiTitle">NeuroClaw AI</div>
          <div class="ncAiMeta">${escapeHtml(meta)}</div>
        </div>
        <div class="ncAiBody">
          <div class="ncAiText">${escapeHtml(human || rawTxt).replace(/\n/g,"<br>")}</div>
        </div>
      </div>
    `;
}

// ===== LIFE TRACKER (TDA & Hábitos Vitales) =====

const LIFE_TRACKER_DEFAULT_TASKS = [
  { id:"lt_hair",    icon:"💇", title:"Lavar el pelo",      category:"higiene",  freqDays:3,  lastDone:null },
  { id:"lt_nails",   icon:"💅", title:"Cortar uñas",        category:"higiene",  freqDays:14, lastDone:null },
  { id:"lt_laundry", icon:"👕", title:"Lavar ropa",         category:"hogar",    freqDays:7,  lastDone:null },
  { id:"lt_kitchen", icon:"🍽️", title:"Limpiar cocina",     category:"hogar",    freqDays:3,  lastDone:null },
  { id:"lt_dishes",  icon:"🫧", title:"Fregar",             category:"hogar",    freqDays:1,  lastDone:null },
  { id:"lt_room",    icon:"🧹", title:"Ordenar cuarto",     category:"hogar",    freqDays:5,  lastDone:null },
  { id:"lt_shower",  icon:"🚿", title:"Ducha",              category:"higiene",  freqDays:1,  lastDone:null },
  { id:"lt_teeth",   icon:"🦷", title:"Cepillar dientes",   category:"higiene",  freqDays:0.5,lastDone:null },
];

function lifeTasksGet() {
  const tasks = Array.isArray(state.lifeTasks) ? state.lifeTasks : [];
  if(!tasks.length) {
    state.lifeTasks = JSON.parse(JSON.stringify(LIFE_TRACKER_DEFAULT_TASKS));
    persist();
    return state.lifeTasks;
  }
  return tasks;
}

function lifeTaskMarkDone(id) {
  const tasks = lifeTasksGet();
  const t = tasks.find(x=>x.id===id);
  if(t) { 
    const ts = new Date().toISOString();
    t.lastDone = ts; 
    state.lifeTasksLog = state.lifeTasksLog || [];
    state.lifeTasksLog.push({ id, ts });
    persist(); 
  }
}

function lifeTaskAddCustom(title, icon, freqDays, category) {
  const tasks = lifeTasksGet();
  tasks.push({ id:"lt_custom_"+Date.now(), icon: icon||"📌", title, category: category||"otro", freqDays: Number(freqDays)||7, lastDone:null, type:"habit" });
  state.lifeTasks = tasks;
  persist();
}

function lifeEventAdd(title, icon, dueDate, note, category) {
  const tasks = lifeTasksGet();
  tasks.push({
    id: "lt_evt_"+Date.now(),
    icon: icon||"📅",
    title,
    category: category||"evento",
    type: "event",
    dueDate,           // ISO date string "YYYY-MM-DD"
    note: note||"",
    done: false,
    followUpSent: false, // Carl asked how it went
    lastDone: null
  });
  state.lifeTasks = tasks;
  persist();
}

function lifeTaskDelete(id) {
  state.lifeTasks = (state.lifeTasks||[]).filter(x=>x.id!==id);
  persist();
}

function lifeTaskDaysSince(task) {
  if(!task.lastDone) return Infinity;
  const ms = Date.now() - new Date(task.lastDone).getTime();
  return ms / (1000*60*60*24);
}

function lifeTaskUrgency(task) {
  const since = lifeTaskDaysSince(task);
  const ratio = task.freqDays > 0 ? since / task.freqDays : Infinity;
  if(ratio >= 1.5) return "critical";  // muy atrasado
  if(ratio >= 1.0) return "due";       // vencido hoy
  if(ratio >= 0.7) return "soon";      // próximamente
  return "ok";
}

function renderLifeTrackerCard() {
  const tasks = lifeTasksGet();
  const todayIso = new Date().toISOString().split("T")[0];
  const tomorrowIso = new Date(Date.now()+86400000).toISOString().split("T")[0];

  // ── Events (one-time) ──
  const events = tasks.filter(t => t.type==="event");
  const habits  = tasks.filter(t => t.type!=="event");

  const upcomingEvents = events
    .filter(e => !e.done && e.dueDate >= todayIso)
    .sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const needFollowUp = events
    .filter(e => !e.done && !e.followUpSent && e.dueDate < todayIso);
  const pastDoneEvents = events
    .filter(e => e.done)
    .sort((a,b)=>b.dueDate.localeCompare(a.dueDate))
    .slice(0, 3);

  const evtDateLabel = (iso) => {
    if(iso===todayIso) return "🔴 Hoy";
    if(iso===tomorrowIso) return "🟡 Mañana";
    try{ return new Date(iso+"T00:00:00").toLocaleDateString("es-PE",{weekday:"short",day:"numeric",month:"short"}); }catch{ return iso; }
  };

  const eventsHtml = upcomingEvents.length || needFollowUp.length ? `
    <div class="lt-events-section">
      <div class="lt-section-title">📅 Eventos & Compromisos</div>
      ${needFollowUp.map(e => `
        <div class="lt-event-row lt-event-followup" data-lt-evt-id="${escapeHtml(e.id)}">
          <div class="lt-event-icon">${e.icon}</div>
          <div class="lt-event-info">
            <div class="lt-event-title">${escapeHtml(e.title)}</div>
            <div class="lt-event-date" style="color:#a78bfa">Carl quiere saber cómo te fue 💜</div>
          </div>
          <div style="display:flex;align-items:center;">
            <button class="lt-evt-done-btn" data-lt-evt-done="${escapeHtml(e.id)}" title="Marcar como hecho">✓</button>
            <button class="lt-del-btn" data-lt-del="${escapeHtml(e.id)}" title="Eliminar" style="border:none;background:transparent;color:#71717a;font-size:14px;padding:0 0 0 8px;">🗑</button>
          </div>
        </div>
      `).join("")}
      ${upcomingEvents.map(e => `
        <div class="lt-event-row" data-lt-evt-id="${escapeHtml(e.id)}">
          <div class="lt-event-icon">${e.icon}</div>
          <div class="lt-event-info">
            <div class="lt-event-title">${escapeHtml(e.title)}</div>
            <div class="lt-event-date">${escapeHtml(evtDateLabel(e.dueDate))}${e.note ? ` · ${escapeHtml(e.note)}` : ""}</div>
          </div>
          <div style="display:flex;align-items:center;">
            <button class="lt-evt-done-btn" data-lt-evt-done="${escapeHtml(e.id)}" title="Hecho">✓</button>
            <button class="lt-del-btn" data-lt-del="${escapeHtml(e.id)}" title="Eliminar" style="border:none;background:transparent;color:#71717a;font-size:14px;padding:0 0 0 8px;">🗑</button>
          </div>
        </div>
      `).join("")}
    </div>
  ` : "";
  
  // Auto-suggest payments from finance ledger
  const ledger = Array.isArray(state.finance_ledger) ? state.finance_ledger : (Array.isArray(state.financeLedger) ? state.financeLedger : []);
  const debtCategories = ["deudas","servicios","compromisos","tarjeta","pago","credito","seguro","renta","alquiler"];
  const paymentTasks = [];
  const seen = new Set();
  ledger.forEach(e => {
    const cat = String(e.category||"").toLowerCase();
    if(!debtCategories.some(d=>cat.includes(d))) return;
    const key = e.description ? String(e.description).substring(0,30).toLowerCase() : cat;
    if(seen.has(key)) return;
    seen.add(key);
    // Check if already in lifeTasks
    const alreadyExists = tasks.some(t=>t.title.toLowerCase().includes(key.substring(0,10)));
    if(!alreadyExists) paymentTasks.push({ name: e.description||e.category, category: cat });
  });

  // Sort habits by urgency
  const sorted = [...habits].sort((a,b) => {
    const order = { critical:0, due:1, soon:2, ok:3 };
    return order[lifeTaskUrgency(a)] - order[lifeTaskUrgency(b)];
  });

  const urgencyColor = { critical:"#ef4444", due:"#f97316", soon:"#eab308", ok:"#22c55e" };
  const urgencyLabel = { critical:"¡Atrasado!", due:"Hoy", soon:"Pronto", ok:"Al día" };

  const taskRows = sorted.map(t => {
    const urg = lifeTaskUrgency(t);
    const color = urgencyColor[urg];
    const sinceStr = t.lastDone ? (() => {
      const d = lifeTaskDaysSince(t);
      if(d < 1) return "Hoy";
      if(d < 2) return "Ayer";
      return `hace ${Math.floor(d)}d`;
    })() : "Nunca";
    return `
      <div class="lt-task-row lt-${urg}" data-lt-id="${escapeHtml(t.id)}">
        <div class="lt-task-icon">${t.icon}</div>
        <div class="lt-task-info">
          <div class="lt-task-title">${escapeHtml(t.title)}</div>
          <div class="lt-task-since" style="color:${color}">${urgencyLabel[urg]} · ${escapeHtml(sinceStr)}</div>
        </div>
        <div style="display:flex;align-items:center;">
          <button class="lt-done-btn" data-lt-done="${escapeHtml(t.id)}" title="Marcar como hecho" style="border-color:${color};color:${color}">✓</button>
          <button class="lt-del-btn" data-lt-del="${escapeHtml(t.id)}" title="Eliminar" style="border:none;background:transparent;color:#71717a;font-size:14px;padding:0 0 0 10px;">🗑</button>
        </div>
      </div>
    `;
  }).join("");

  const criticalCount = sorted.filter(t=>lifeTaskUrgency(t)==="critical"||lifeTaskUrgency(t)==="due").length;
  const totalAlerts = criticalCount + needFollowUp.length;

  return `
    <section class="card homeCard homeWide lifeTrackerCard" id="homeLifeTracker">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">🧠 Tracker Vital</h2>
          <div class="small">${totalAlerts > 0 ? `<span style="color:#ef4444;font-weight:700">${totalAlerts} alerta${totalAlerts>1?"s":""}</span>` : "Todo al día ✅"}</div>
        </div>
        <div>
          <button class="iconBtn" id="btnLifeTrackerStats" title="Estadísticas" style="margin-right:8px;font-size:16px;">📊</button>
          <button class="iconBtn" id="btnAddLifeTask" title="Agregar">＋</button>
        </div>
      </div>
      <div class="hr"></div>
      ${eventsHtml}
      <div class="lt-section-title" style="margin-top:${eventsHtml?"12px":"0"}">🔁 Hábitos Vitales</div>
      <div class="lt-task-list">
        ${taskRows}
      </div>
      ${paymentTasks.length ? `
        <div class="lt-suggestions">
          <div class="lt-sug-title">💡 Carl detectó pagos recurrentes. ¿Agregarlos?</div>
          ${paymentTasks.slice(0,3).map(p=>`
            <button class="lt-sug-btn" data-lt-suggest="${escapeHtml(JSON.stringify(p))}">
              💸 ${escapeHtml(p.name)}
            </button>
          `).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function wireLifeTracker(root) {
  // Mark habit done
  root.querySelectorAll("[data-lt-done]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      lifeTaskMarkDone(btn.getAttribute("data-lt-done"));
      view();
    });
  });

  // Delete habit or event
  root.querySelectorAll("[data-lt-del]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      if(confirm("¿Eliminar este elemento del Tracker Vital?")) {
        lifeTaskDelete(btn.getAttribute("data-lt-del"));
        view();
      }
    });
  });

  // Mark event done (check/uncheck)
  root.querySelectorAll("[data-lt-evt-done]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.getAttribute("data-lt-evt-done");
      const tasks = lifeTasksGet();
      const evt = tasks.find(x=>x.id===id);
      if(evt) {
        const ts = new Date().toISOString();
        evt.done = true;
        evt.lastDone = ts;
        state.lifeTasksLog = state.lifeTasksLog || [];
        state.lifeTasksLog.push({ id, ts });
        persist();
        // Open NeuroChat with follow-up prompt
        const title = evt.title;
        state.tab = "neurochat";
        view();
        setTimeout(() => {
          const inp = document.querySelector("#neuroChatInput");
          if(inp) {
            inp.value = `¿Cómo te fue en: ${title}?`;
            inp.dispatchEvent(new Event("input", { bubbles: true }));
          }
          // Auto send
          const sendBtn = document.querySelector("#neuroChatSend");
          if(sendBtn) sendBtn.click();
        }, 600);
      }
    });
  });

  // Add task/event button
  const btnAdd = root.querySelector("#btnAddLifeTask");
  if(btnAdd) btnAdd.addEventListener("click", () => openLifeTaskModal());

  // Stats button
  const btnStats = root.querySelector("#btnLifeTrackerStats");
  if(btnStats) btnStats.addEventListener("click", () => openLifeTrackerStatsModal());

  // Suggest from finance
  root.querySelectorAll("[data-lt-suggest]").forEach(btn => {
    btn.addEventListener("click", () => {
      try {
        const p = JSON.parse(btn.getAttribute("data-lt-suggest"));
        lifeTaskAddCustom(p.name, "💸", 30, p.category);
        view();
      } catch(e){}
    });
  });
}

function openLifeTaskModal() {
  const host = document.querySelector("#app");
  const bd = document.createElement("div");
  bd.className = "modalBackdrop";
  const todayIso = new Date().toISOString().split("T")[0];
  const tomorrowIso = new Date(Date.now()+86400000).toISOString().split("T")[0];
  bd.innerHTML = `
    <div class="modal" style="max-width:380px">
      <div class="modalHeader"><span>➕ Agregar al Tracker</span><button class="mpm-icon-btn" data-close>✕</button></div>
      <div class="modalBody" style="display:flex;flex-direction:column;gap:0">
        <!-- Tabs -->
        <div class="lt-modal-tabs">
          <button class="lt-modal-tab active" data-lttab="habit">🔁 Hábito recurrente</button>
          <button class="lt-modal-tab" data-lttab="event">📅 Evento único</button>
        </div>

        <!-- Habit form -->
        <div id="ltHabitForm" style="display:flex;flex-direction:column;gap:12px;padding-top:16px">
          <input class="input" id="ltTitle" placeholder="Ej: Lavar el carro" />
          <div style="display:flex;gap:8px">
            <input class="input" id="ltIcon" placeholder="Ícono 🧹" style="width:70px;text-align:center"/>
            <input class="input" id="ltFreq" type="number" min="1" placeholder="Cada X días" style="flex:1"/>
          </div>
          <select class="input" id="ltCat">
            <option value="higiene">🧴 Higiene</option>
            <option value="hogar">🏠 Hogar</option>
            <option value="pago">💸 Pago/Deuda</option>
            <option value="salud">💊 Salud</option>
            <option value="otro">📌 Otro</option>
          </select>
          <button class="btn primary" id="ltSaveHabit">Guardar hábito</button>
        </div>

        <!-- Event form -->
        <div id="ltEventForm" style="display:none;flex-direction:column;gap:12px;padding-top:16px">
          <input class="input" id="ltEvtTitle" placeholder="Ej: Entrevista de trabajo" />
          <div style="display:flex;gap:8px">
            <input class="input" id="ltEvtIcon" placeholder="Ícono 💼" style="width:70px;text-align:center"/>
            <input class="input" id="ltEvtDate" type="date" value="${tomorrowIso}" style="flex:1"/>
          </div>
          <input class="input" id="ltEvtNote" placeholder="Nota (opcional): empresa, lugar..." />
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:rgba(255,255,255,0.6);cursor:pointer">
            <input type="checkbox" id="ltEvtFollowup" checked style="width:16px;height:16px"/> Que Carl me pregunte cómo me fue
          </label>
          <button class="btn primary" id="ltSaveEvent">Guardar evento</button>
        </div>
      </div>
    </div>
  `;
  // Tab switching
  bd.querySelectorAll(".lt-modal-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      bd.querySelectorAll(".lt-modal-tab").forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      const which = tab.getAttribute("data-lttab");
      bd.querySelector("#ltHabitForm").style.display = which==="habit" ? "flex" : "none";
      bd.querySelector("#ltEventForm").style.display = which==="event" ? "flex" : "none";
    });
  });
  bd.addEventListener("click", e => { if(e.target===bd||e.target.closest("[data-close]")) bd.remove(); });
  bd.querySelector("#ltSaveHabit").addEventListener("click", () => {
    const title = bd.querySelector("#ltTitle").value.trim();
    if(!title) return;
    lifeTaskAddCustom(title, bd.querySelector("#ltIcon").value.trim()||"📌", Number(bd.querySelector("#ltFreq").value)||7, bd.querySelector("#ltCat").value);
    bd.remove(); view();
  });
  bd.querySelector("#ltSaveEvent").addEventListener("click", () => {
    const title = bd.querySelector("#ltEvtTitle").value.trim();
    const dueDate = bd.querySelector("#ltEvtDate").value;
    if(!title || !dueDate) return;
    const t = bd.querySelector("lt_followup") ? bd.querySelector("#ltEvtFollowup").checked : true;
    lifeEventAdd(title, bd.querySelector("#ltEvtIcon").value.trim()||"📅", dueDate, bd.querySelector("#ltEvtNote").value.trim(), "evento");
    bd.remove(); view();
    toast("Evento guardado. Carl te preguntará cómo te fue 💜");
  });
  host.appendChild(bd);
}

function openLifeTrackerStatsModal() {
  const host = document.querySelector("#app");
  const bd = document.createElement("div");
  bd.className = "modalBackdrop";

  const tasks = lifeTasksGet();
  const habits = tasks.filter(t => t.type!=="event");
  const log = Array.isArray(state.lifeTasksLog) ? state.lifeTasksLog : [];

  // 1. Salud del sistema (Distribución de urgencias)
  let ok=0, soon=0, due=0, crit=0;
  habits.forEach(t => {
    const u = lifeTaskUrgency(t);
    if(u==="critical") crit++;
    else if(u==="due") due++;
    else if(u==="soon") soon++;
    else ok++;
  });
  const total = habits.length || 1;
  const pctOk = Math.round((ok/total)*100);
  const healthHtml = `
    <div class="mmchart-card" style="margin-bottom:12px;">
      <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px;font-weight:700;text-transform:uppercase;">Salud de Hábitos</div>
      <div style="display:flex;align-items:center;gap:16px;">
        <div style="width:60px;height:60px;border-radius:50%;background:conic-gradient(#22c55e ${pctOk}%, #ef4444 0);display:flex;align-items:center;justify-content:center;">
          <div style="width:48px;height:48px;border-radius:50%;background:#1e1e1e;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;">${pctOk}%</div>
        </div>
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;">
          <div style="color:#22c55e">● ${ok} Al día</div>
          <div style="color:#eab308">● ${soon} Pronto</div>
          <div style="color:#f97316">● ${due} Hoy</div>
          <div style="color:#ef4444">● ${crit} Atrasados</div>
        </div>
      </div>
    </div>
  `;

  // 2. Actividad últimos 7 días (Gráfico de barras simple usando divs)
  const today = new Date();
  today.setHours(0,0,0,0);
  const weekData = Array.from({length:7}, (_,i) => {
    const d = new Date(today.getTime() - (6-i)*86400000);
    return { iso: isoDate(d), count:0, dateStr: d.toLocaleDateString("es-PE",{weekday:"short"}) };
  });
  log.forEach(l => {
    const iso = String(l.ts).split("T")[0];
    const wd = weekData.find(w => w.iso === iso);
    if(wd) wd.count++;
  });
  const maxCount = Math.max(1, ...weekData.map(w=>w.count));
  const weekHtml = `
    <div class="mmchart-card" style="margin-bottom:12px;">
      <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:12px;font-weight:700;text-transform:uppercase;">Actividad (7 días)</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;height:80px;padding-top:10px;border-bottom:1px solid rgba(255,255,255,0.1);">
        ${weekData.map(w => {
          const h = (w.count / maxCount) * 100;
          return `
            <div style="display:flex;flex-direction:column;align-items:center;flex:1;">
              <div style="color:rgba(255,255,255,0.8);font-size:10px;font-weight:700;margin-bottom:4px">${w.count>0?w.count:""}</div>
              <div style="width:14px;background:#a78bfa;border-radius:4px 4px 0 0;height:${h}%;min-height:2px;transition:height 0.3s"></div>
            </div>
          `;
        }).join("")}
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;">
        ${weekData.map(w => `<div style="flex:1;text-align:center;font-size:9px;color:rgba(255,255,255,0.4);text-transform:uppercase;">${w.dateStr}</div>`).join("")}
      </div>
    </div>
  `;

  // 3. Hábito más atrasado (El que tiene el ratio más alto de urgencia)
  const mostOverdue = [...habits].filter(t=>t.freqDays>0).sort((a,b)=>{
    const ratioA = lifeTaskDaysSince(a)/a.freqDays;
    const ratioB = lifeTaskDaysSince(b)/b.freqDays;
    return ratioB - ratioA;
  })[0];
  const overdueHtml = mostOverdue ? `
    <div class="mmchart-card">
      <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px;font-weight:700;text-transform:uppercase;">El más olvidado</div>
      <div style="display:flex;align-items:center;gap:12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);padding:10px;border-radius:12px;">
        <div style="font-size:24px;">${mostOverdue.icon}</div>
        <div>
          <div style="font-size:14px;font-weight:700;color:#ef4444">${escapeHtml(mostOverdue.title)}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.6)">Debería ser cada ${mostOverdue.freqDays} días.</div>
        </div>
      </div>
    </div>
  ` : "";

  bd.innerHTML = `
    <div class="modal" style="max-width:380px;background:#1e1e1e">
      <div class="modalHeader"><span>📊 Stats del Tracker</span><button class="mpm-icon-btn" data-close>✕</button></div>
      <div class="modalBody" style="display:flex;flex-direction:column;gap:0;">
        ${healthHtml}
        ${weekHtml}
        ${overdueHtml}
      </div>
    </div>
  `;
  bd.addEventListener("click", e => { if(e.target===bd||e.target.closest("[data-close]")) bd.remove(); });
  host.appendChild(bd);
}

function renderNeuroClawCard(){

  const items = neuroclawTopSuggestions(3);
  const has = items.length>0;
  const loading = !!state?.neuroclawAiLoading;
  const ts = state.neuroclawLast?.ts ? new Date(state.neuroclawLast.ts) : null;
  const stamp = ts ? ts.toLocaleString("es-PE",{hour:"2-digit",minute:"2-digit"}) : "";
  return `
    <section class="card homeCard" id="homeNeuroCard">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">NeuroClaw</h2>
          <div class="small">${loading ? "Analizando…" : (has ? `Sugerencias • ${escapeHtml(stamp)}` : "Sin señales aún")}</div>
        </div>
        <button class="iconBtn" id="btnNeuroAnalyze" aria-label="Analyze">🧠</button>
      </div>
      <div class="hr"></div>
      ${has ? `
        <div class="neuroList">
          ${items.map(it=>`
            <div class="neuroItem" data-neuro-id="${escapeHtml(it.id)}">
              <div class="neuroRow">
                <div class="neuroMsg">${escapeHtml(it.message || it.title || "")}</div>
                ${neuroclawBadge(it.priority)}
              </div>
              <div class="neuroActions">
                <button class="miniBtn" data-neuro-rate="up" data-neuro-id="${escapeHtml(it.id)}">👍</button>
                <button class="miniBtn" data-neuro-rate="down" data-neuro-id="${escapeHtml(it.id)}">👎</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `
        <div class="muted">Registra sueño y mood unos días, y dale 🧠 para analizar.</div>
      `}
    ${renderNeuroClawAIBlock()}
    </section>
  `;
}


function renderSwissAstroCard(){
  const loading = !!state?.swissDailyLoading;
  const err = state?.swissDailyError || "";
  const d = state?.swissDaily || null;

  const sub = loading
    ? "Invocando…"
    : (d ? `${(typeof d.moon_phase==="number" ? Math.round(d.moon_phase*100) + "%" : "—")} • Luna en ${d.moon_sign || "?"}` : (swissDailyAvailable() ? "Listo para hoy" : "Configura Swiss"));

  const msg = d ? (d.message || (Array.isArray(d.transits) ? d.transits[0] : "") || "") : "";
  const body = loading
    ? `<div class="muted">Buscando tu visión lunar del día…</div>`
    : (err ? `<div class="muted">⚠ ${escapeHtml(err)}</div>` : (msg ? `<div class="swissMsg">${escapeHtml(msg)}</div>` : `<div class="muted">Sin datos aún.</div>`));

  return `
    <section class="card homeCard" id="homeSwissAstroCard">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">Visión lunar</h2>
          <div class="small">${escapeHtml(sub)}</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="iconBtn" id="btnSwissRefresh" aria-label="Refresh">⟳</button>
          <button class="iconBtn" id="btnSwissDetails" aria-label="Details">↗</button>
        </div>
      </div>
      <div class="hr"></div>
      ${body}
    </section>
  `;
}



function renderNeuroDebugModal(){
  const last = state.neuroclawLast || null;
  const signals = last && last.signals ? last.signals : null;
  const suggestions = last && Array.isArray(last.suggestions) ? last.suggestions : [];
  const ts = last && last.ts ? new Date(last.ts) : null;
  const stamp = ts ? ts.toLocaleString("es-PE") : "";
  const running = !last;

  const sigRows = signals ? Object.keys(signals).sort().map(k=>{
    const v = signals[k];
    const vv = (typeof v==="number") ? (Math.round(v*100)/100) : v;
    return `<div class="neuroDbgRow"><div class="neuroDbgK">${escapeHtml(k)}</div><div class="neuroDbgV">${escapeHtml(String(vv))}</div></div>`;
  }).join("") : `<div class="muted">${running ? "Aún no hay análisis. Dale 🧠 en Home." : "Sin señales."}</div>`;

  const sugRows = suggestions.length ? suggestions.map(s=>`
    <div class="neuroDbgSug">
      <div class="neuroDbgSugTop">
        <div class="neuroDbgSugMsg">${escapeHtml(s.message || "")}</div>
        ${neuroclawBadge(s.priority)}
      </div>
      ${s.why ? `<div class="muted">${escapeHtml(String(s.why))}</div>` : ``}
    </div>
  `).join("") : `<div class="muted">${running ? "" : "Ninguna regla se activó. Eso también es buena señal 😄"}</div>`;

  return `
  <div class="modalBackdrop" id="neuroDbgBackdrop">
    <div class="modal" role="dialog" aria-label="NeuroClaw Debug">
      <div class="modalTop">
        <div>
          <div class="modalTitle">NeuroClaw: Qué está pensando</div>
          <div class="modalSub">${stamp ? `Último análisis: ${escapeHtml(stamp)}` : "Ejecuta un análisis para ver señales y reglas."}</div>
        </div>
        <button class="iconBtn" id="btnNeuroDbgClose" aria-label="Close">✕</button>
      </div>

      <div class="hr"></div>

      <div class="neuroDbgGrid">
        <div class="neuroDbgCol">
          <div class="neuroDbgH">Señales</div>
          <div class="neuroDbgBox">${sigRows}</div>
        </div>
        <div class="neuroDbgCol">
          <div class="neuroDbgH">Sugerencias activas</div>
          <div class="neuroDbgBox">${sugRows}</div>
        </div>
      </div>

      <div class="row" style="margin-top:12px;">
        <button class="btn" id="btnNeuroDbgRerun">Re-analizar 🧠</button>
        <button class="btn" id="btnNeuroDbgCopy">Copiar señales</button>
      </div>
    </div>
  </div>
  `;
}


function viewHome(){
  const now = new Date();
  const monday = startOfWeekMonday(now);
  const days = Array.from({length:7}, (_,i)=>{
    const d = new Date(monday);
    d.setDate(monday.getDate()+i);
    const iso = isoDate(d);
    const isToday = iso === isoDate(now);
    return { iso, d, isToday };
  });

  const music = getMusicDisplay();
  const m = music.item;
  const mTitle = m ? (m.song || m.title || "") : "";
  const mArtist = m ? (m.artist || "") : "";
  const mMood = m ? (m.mood || "") : "";
  const mIntensity = (m && (m.intensity !== undefined && m.intensity !== null && m.intensity !== "")) ? Number(m.intensity) : null;
  const hasMusic = !!mTitle;

  const pending = (state.reminders||[]).filter(x=>!x.done).slice(0,3);
  const remindersHtml = pending.length ? pending.map(r=>`
    <label class="homeCheck">
      <input type="checkbox" data-rem="${escapeHtml(r.id)}" />
      <span>${escapeHtml(r.text)}</span>
    </label>
  `).join("") : `<div class="muted">Sin pendientes 🎈</div>`;

  const moodMap = (state.moodDaily && typeof state.moodDaily==="object") ? state.moodDaily : {};
  
  // Get mood entries supporting both old (object) and new (array) format
  const getEntriesForDay = (iso) => {
    const e = moodMap[String(iso||"")];
    if(!e) return [];
    return Array.isArray(e) ? e : [e];
  };

  const getMoodMini = (iso)=>{
    const entries = getEntriesForDay(iso);
    if(!entries.length) return "";
    // For days with multiple moods, show stacked mini faces
    const faces = entries.map(e => {
      const svg = _getMoodSvg(e.spriteId, true);
      return svg ? svg : "";
    }).filter(Boolean).slice(0, 2).join(""); // show at most 2 mini faces
    if(!faces) return "";
    return `<div class="dayMoodMini djp-mood-mini">${faces}</div>`;
  };

  const todayIso = isoDate(now);
  const todayEntries = getEntriesForDay(todayIso);

  // Format time from ISO timestamp
  const fmtTime = (ts) => {
    if(!ts) return "";
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: true });
    } catch(e){ return ""; }
  };

  const FACE_COLORS_MAP = {
    incredible:"#4ADE80", good:"#86EFAC", meh:"#60A5FA", bad:"#FBBF24", horrible:"#F87171"
  };
  const FACE_LABEL_MAP = {
    incredible:"Increíble", good:"Bien", meh:"Meh", bad:"Mal", horrible:"Horrible"
  };

  // Build timeline rows for today's moods
  const moodTimelineRows = todayEntries.map(entry => {
    const svg = _getMoodSvg(entry.spriteId, false);
    const color = FACE_COLORS_MAP[entry.spriteId] || "#7c5cff";
    const label = entry.label || FACE_LABEL_MAP[entry.spriteId] || entry.spriteId;
    const timeStr = fmtTime(entry.ts);
    const acts = (entry.activities||[]).slice(0,3).join(" · ");
    return `
      <div class="moodTimelineRow">
        <div class="moodTimelineFace" style="--fc:${color}">${svg||"😶"}</div>
        <div class="moodTimelineInfo">
          <div class="moodTimelineLabel" style="color:${color}">${escapeHtml(label)}</div>
          ${acts ? `<div class="moodTimelineActs">${escapeHtml(acts)}</div>` : ""}
        </div>
        <div class="moodTimelineTime">${escapeHtml(timeStr)}</div>
      </div>
    `;
  }).join("");

  const weekHtml = days.map(x=>`
    <div class="dayPill ${x.isToday ? "today":""}" data-day="${x.iso}">
      <div class="dayNum">${formatDayNum(x.d)}</div>
      <div class="dayAbbr">${dayAbbrEs(x.d.getDay())}</div>
      ${getMoodMini(x.iso)}
    </div>
  `).join("") + `
    <div class="dayPill moodPill" id="homeMoodPill" data-mood-day="${todayIso}">
      ${todayEntries.length ? `<div class="djp-mood-pill-face">${_getMoodSvg(todayEntries[todayEntries.length-1].spriteId, false)}</div>` : `<div class="moodPillPlus">＋</div>`}
      <div class="dayAbbr">Mood</div>
    </div>
  `;



const sleepSeries = getSleepWeekSeries();
const sleepBars = renderSleepBars(sleepSeries);

  return `
    <div class="homeTop">
      <div class="homeHello">
        <div class="homeHelloText">Hola Carlos</div>
        <div class="homeHelloSub">${escapeHtml(now.toLocaleDateString("es-PE",{weekday:"long", month:"long", day:"numeric"}))}</div>
      </div>
      <div class="weekStrip" role="list" aria-label="Week">
        ${weekHtml}
      </div>
    </div>

    <div class="homeGrid">
      <section class="card homeCard djp-sleep-card" id="homeSleepCard">
        <div class="djp-sc-header">
          <div class="djp-sc-icon">🌙</div>
          <div class="djp-sc-title-block">
            <div class="djp-sc-title">Sueño</div>
            <div class="djp-sc-sub">7 días</div>
          </div>
          <button class="djp-sc-add-btn" id="btnAddSleep" aria-label="Add sleep">＋</button>
        </div>
        ${sleepBars}
      </section>
      ${renderTarotWidget()}

      <section class="card homeCard homeMoodCard" id="homeMoodCard">
        <div class="cardTop">
          <div>
            <h2 class="cardTitle">😊 Emociones</h2>
            <div class="small">${todayEntries.length ? `${todayEntries.length} registro${todayEntries.length>1?"s":""} hoy` : "Sin registros hoy"}</div>
          </div>
          <button class="iconBtn" id="btnAddMoodEntry" title="Registrar emoción">＋</button>
        </div>
        <div class="hr"></div>
        <div class="moodTimeline" id="moodTimeline">
          ${moodTimelineRows || `<div class="muted" style="text-align:center;padding:16px 0;">Toca ＋ para registrar cómo te sientes</div>`}
        </div>
      </section>

      <section class="card homeCard" id="homeRemindersCard">
        <div class="cardTop">
          <div>
            <h2 class="cardTitle">Reminders</h2>
            <div class="small">Hoy</div>
          </div>
          <button class="iconBtn" id="btnGoReminders" aria-label="Go reminders">↗</button>
        </div>
        <div class="hr"></div>
        <div class="homeChecks">
          ${remindersHtml}
        </div>
      </section>

      ${renderSwissAstroCard()}

      ${renderNeuroClawCard()}
      ${renderLifeTrackerCard()}
    </div>

    <section class="card homeCard homeWide musicSplitCard" id="homeMusicCard">
      <div class="musicSplit">
        <div class="musicLeft">
          <div class="musicLeftTop">
            <div>
              <div class="musicKicker">MÚSICA FAVORITA</div>
              <div class="musicHint">${hasMusic ? (music.mode==="log" ? `Historial ${music.cursor+1}/${music.total}` : `Hoy`) : "Toca + para registrar"}</div>
            </div>
            <div class="musicLeftBtns">
              <button class="musicMini" id="btnMusicPrev" ${music.total<=1 ? "disabled":""} aria-label="Prev">⏮</button>
              <button class="musicPlay" id="btnMusicPlay" ${hasMusic ? "":"disabled"} aria-label="Play">▶</button>
              <button class="musicMini" id="btnMusicNext" ${music.total<=1 ? "disabled":""} aria-label="Next">⏭</button>
              <button class="musicAdd" id="btnAddMusic" aria-label="Add">＋</button>
            </div>
          </div>

          ${hasMusic ? `
            <div class="musicBig">${escapeHtml(mTitle)}</div>
            <div class="musicMetaLine">
              ${mArtist ? `<span>${escapeHtml(mArtist)}</span>` : `<span class="muted">Artista</span>`}
              ${m.album ? `<span class="dot">•</span><span>${escapeHtml(m.album)}</span>` : ``}
            </div>
            <div class="musicMetaLine" style="margin-top:6px;">
              ${mMood ? `<span>${escapeHtml(mMood)}</span>` : ``}
              ${mMood && (mIntensity !== null && !Number.isNaN(mIntensity)) ? `<span class="dot">•</span>` : ``}
              ${mIntensity !== null && !Number.isNaN(mIntensity) ? `<span>${escapeHtml(String(mIntensity))}/10</span>` : ``}
            </div>
            ${m.note ? `<div class="musicNote">${escapeHtml(m.note)}</div>` : ``}
          ` : `
            <div class="musicEmpty">¿Qué canción te está pegando hoy? 🎧</div>
          `}
        </div>

        <div class="musicRight" ${hasMusic && (m.coverUrl||"") ? `` : `data-empty="1"`}>
          ${hasMusic && (m.coverUrl||"") ? `
            <img class="musicCover" src="${escapeHtml(m.coverUrl)}" alt="Cover" loading="lazy" referrerpolicy="no-referrer" />
          ` : `
            <div class="musicCoverPlaceholder">
              <div class="musicCoverEmoji">🎛️</div>
              <div class="musicCoverText">Pega un URL de portada</div>
            </div>
          `}
        </div>
      </div>
    </section>

    <section class="card homeCard homeWide" id="homeBudgetCard">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">Presupuesto mensual</h2>
          <div class="small">Pagos de fin de mes</div>
        </div>
        <button class="iconBtn" id="btnAddBudgetItem" aria-label="Add budget item">＋</button>
      </div>
      <div class="hr"></div>
      ${renderBudgetMonthly()}
    </section>

    ${renderLunarMoneyCard()}

    <section class="card homeCard homeWide" id="homeMergeCard">
      <div class="cardTop">
        <div>
          <h2 class="cardTitle">Merge Lab <span class="chip">v7.6</span></h2>
          <div class="small">Suelta y fusiona (pantalla completa)</div>
        </div>
        <button class="iconBtn" id="btnOpenMergeGame" aria-label="Open merge game">🎮</button>
      </div>
      <div class="hr"></div>
      <div class="small" style="line-height:1.35">
        Un mini juego dentro de MemoryCarl: toca para soltar piezas, si se tocan dos iguales se transforman en la siguiente.
        No hay presión… excepto la línea roja 😅
      </div>
    </section>

  `;
}

function normalizeMoney(v){
  const n = Number(String(v||"").replace(/[^0-9.,-]/g,"").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function getBudgetMonthly(){
  const arr = Array.isArray(state.budgetMonthly) ? state.budgetMonthly : [];
  // normalize
  return arr.map(x=>({
    id: x.id || uid("b"),
    name: String(x.name||"").trim(),
    amount: Number(x.amount||0),
    dueDay: x.dueDay ? Number(x.dueDay) : null,
  })).filter(x=>x.name);
}

function renderBudgetMonthly(){
  const items = getBudgetMonthly();
  const total = items.reduce((s,x)=>s + (Number(x.amount)||0), 0);
  const fmt = (n)=> (Number(n)||0).toLocaleString("es-PE",{minimumFractionDigits:2, maximumFractionDigits:2});
  const list = items.length ? items.map(x=>`
    <div class="budgetRow"  >
      <div class="budgetName">${escapeHtml(x.name)}</div>
      <div class="budgetAmt">S/ ${escapeHtml(fmt(x.amount))}</div>
      <button class="miniDanger" data-budget-del="${escapeHtml(x.id)}" aria-label="Delete">✕</button>
    </div>
  `).join("") : `<div class="muted">Toca ＋ para agregar tus pagos del mes 💸</div>`;

  return `
    <div class="budgetTop">
      <div class="budgetTotal">Total: <strong>S/ ${escapeHtml(fmt(total))}</strong></div>
      <div class="budgetCount">${items.length ? `${items.length} ítem(s)` : ""}</div>
    </div>
    <div class="budgetList">${list}</div>
  `;
}

function openBudgetModal(){
  const host = document.querySelector("#app");
  const modal = document.createElement("div");
  modal.className = "modalBackdrop";

  modal.innerHTML = `
    <div class="modal" role="dialog" aria-label="Agregar pago mensual">
      <div class="modalTop">
        <div>
          <div class="modalTitle">Agregar pago mensual</div>
          <div class="modalSub">Registra lo que debes pagar a fin de mes. (Local + sync)</div>
        </div>
        <button class="iconBtn" data-close aria-label="Close">✕</button>
      </div>

      <div class="formGrid">
        <label class="field">
          <div class="label">Concepto</div>
          <input id="bName" type="text" placeholder="Ej: Internet, alquiler, tarjeta..." />
        </label>

        <label class="field">
          <div class="label">Monto (S/)</div>
          <input id="bAmt" type="text" inputmode="decimal" placeholder="Ej: 120.50" />
        </label>

        <label class="field">
          <div class="label">Día (opcional)</div>
          <input id="bDay" type="number" min="1" max="31" placeholder="Ej: 30" />
          <div class="hint">Si lo dejas vacío: fin de mes.</div>
        </label>

        <label class="field">
          <div class="label">Nota (opcional)</div>
          <input id="bNote" type="text" placeholder="Ej: se paga por app, recordar promo..." />
        </label>
      </div>

      <div class="row" style="justify-content:flex-end; gap:10px; margin-top:14px;">
        <button class="btn" data-close>Cancelar</button>
        <button class="btn primary" id="bSave">Guardar</button>
      </div>
    </div>
  `;

  host.appendChild(modal);

  const close = ()=> modal.remove();
  modal.addEventListener("click",(e)=>{
    if(e.target === modal) close();
    if(e.target && e.target.matches("[data-close]")) close();
  });

  const elName = modal.querySelector("#bName");
  const elAmt = modal.querySelector("#bAmt");
  const elDay = modal.querySelector("#bDay");
  const elNote = modal.querySelector("#bNote");
  elName && elName.focus();

  modal.querySelector("#bSave")?.addEventListener("click", ()=>{
    const name = String(elName?.value||"").trim();
    const amount = normalizeMoney(elAmt?.value||"");
    const dueDay = elDay?.value ? Math.max(1, Math.min(31, Number(elDay.value))) : null;
    const note = String(elNote?.value||"").trim();

    if(!name || !amount){
      toast("Falta concepto o monto ✍️");
      return;
    }

    const items = getBudgetMonthly();
    items.push({ id: uid("b"), name, amount, dueDay, note });
    state.budgetMonthly = items;
    persist();
    view();
    toast("Pago agregado ✅");
    close();
  });
}

function formatSleepDuration(minutes){
  const mins = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if(!h) return `${m}m`;
  if(!m) return `${h}h`;
  return `${h}h ${String(m).padStart(2,"0")}m`;
}

function parseIsoDate(iso){
  if(!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if(Number.isNaN(d.getTime())) return null;
  d.setHours(0,0,0,0);
  return d;
}

function getYesterdayIso(){
  const d = new Date();
  d.setDate(d.getDate()-1);
  return isoDate(d);
}

function isAnimeAvailable(){
  return typeof window !== "undefined" && typeof window.anime === "function";
}

function animateSleepModalIn(backdrop){
  if(!isAnimeAvailable()) return;
  const panel = backdrop.querySelector(".sleepHistoryModal") || backdrop.querySelector(".modal");
  window.anime.remove([backdrop, panel]);
  window.anime({ targets: backdrop, opacity:[0,1], duration:180, easing:"linear" });
  if(panel){
    window.anime({ targets: panel, translateY:[18,0], opacity:[0,1], duration:260, easing:"easeOutQuad" });
  }
}

function animateSleepModalOut(backdrop, done){
  if(!isAnimeAvailable()){
    done();
    return;
  }
  const panel = backdrop.querySelector(".sleepHistoryModal") || backdrop.querySelector(".modal");
  const anim = window.anime({
    targets: panel || backdrop,
    translateY:[0,18],
    opacity:[1,0],
    duration:180,
    easing:"easeInQuad",
    complete: done
  });
  if(!anim) done();
}

// ─── Dream Journal Pro: openSleepModal ────────────────────────────────────

const _DJP_TYPES = [
  { id:"normal",    label:"Normal",    icon:"🌙" },
  { id:"lucid",     label:"Lúcido",    icon:"✨" },
  { id:"nightmare", label:"Pesadilla", icon:"😨" },
  { id:"recurring", label:"Recurrente",icon:"🔄" },
  { id:"vivid",     label:"Vívido",    icon:"🎨" },
  { id:"prophetic", label:"Profético", icon:"🔮" },
];
const _DJP_EMOTIONS = [
  { id:"calm",       label:"Calma",       icon:"🌊" },
  { id:"anxious",    label:"Ansioso",     icon:"😰" },
  { id:"happy",      label:"Feliz",       icon:"😊" },
  { id:"confused",   label:"Confundido",  icon:"🌀" },
  { id:"energized",  label:"Energizado",  icon:"⚡" },
  { id:"melancholy", label:"Melancólico", icon:"🌧️" },
  { id:"inspired",   label:"Inspirado",   icon:"💡" },
  { id:"scared",     label:"Asustado",    icon:"😱" },
];
const _DJP_CLARITY = [
  {v:1,label:"Borroso"},{v:2,label:"Parcial"},{v:3,label:"Claro"},
  {v:4,label:"Vívido"},{v:5,label:"Hiper-real"},
];
const _DJP_SYMBOLS = [
  "agua","fuego","vuelo","caída","persecución","casa","muerte",
  "animal","luz","oscuridad","transformación","viaje","persona desconocida",
  "perderse","dientes","examen","dinero","amor","guerra","naturaleza",
];

function _djpInjectStyles(){
  if(document.getElementById("djp-styles")) return;
  const s = document.createElement("style");
  s.id = "djp-styles";
  s.textContent = `
.djp-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(6,5,15,.82);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:12px}
.djp-panel{width:100%;max-width:520px;max-height:92vh;overflow-y:auto;background:#0d0c1a;border:1px solid rgba(124,92,255,.22);border-radius:20px;padding:24px 22px 28px;box-shadow:0 24px 80px rgba(0,0,0,.7);scrollbar-width:thin;scrollbar-color:rgba(124,92,255,.3) transparent;opacity:0;transform:translateY(18px);transition:opacity .22s ease,transform .22s ease}
.djp-panel.visible{opacity:1;transform:translateY(0)}
.djp-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px}
.djp-title{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1.5px;color:#fff;line-height:1}
.djp-sub{font-size:12px;color:rgba(255,255,255,.4);margin-top:4px;font-family:'JetBrains Mono',monospace}
.djp-close{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.6);border-radius:10px;width:32px;height:32px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:background .15s;flex-shrink:0}
.djp-close:hover{background:rgba(255,255,255,.12);color:#fff}
.djp-section{margin-bottom:18px}
.djp-label{font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(124,92,255,.8);margin-bottom:8px;font-family:'JetBrains Mono',monospace}
.djp-pill-grid{display:flex;flex-wrap:wrap;gap:7px}
.djp-pill{padding:7px 13px;border-radius:20px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:rgba(255,255,255,.75);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:5px;white-space:nowrap}
.djp-pill:hover{border-color:rgba(124,92,255,.4);background:rgba(124,92,255,.1)}
.djp-pill.active{border-color:rgba(124,92,255,.7);background:rgba(124,92,255,.22);color:#fff}
.djp-clarity-row{display:flex;gap:6px}
.djp-clarity-btn{flex:1;padding:8px 4px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:rgba(255,255,255,.5);font-size:10px;font-weight:700;text-align:center;cursor:pointer;transition:all .15s;line-height:1.3}
.djp-clarity-btn:hover{border-color:rgba(124,92,255,.4)}
.djp-clarity-btn.active{border-color:rgba(124,92,255,.7);background:rgba(124,92,255,.22);color:#fff}
.djp-symbol-input-row{display:flex;gap:8px;margin-bottom:8px}
.djp-symbol-input{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:9px 12px;color:#fff;font-size:13px;outline:none;transition:border-color .15s}
.djp-symbol-input:focus{border-color:rgba(124,92,255,.5)}
.djp-symbol-add{background:rgba(124,92,255,.2);border:1px solid rgba(124,92,255,.4);border-radius:10px;padding:9px 14px;color:#fff;font-weight:700;cursor:pointer;font-size:16px;transition:background .15s}
.djp-symbol-add:hover{background:rgba(124,92,255,.35)}
.djp-symbol-tag{padding:5px 10px;border-radius:14px;background:rgba(124,92,255,.15);border:1px solid rgba(124,92,255,.3);color:rgba(255,255,255,.8);font-size:11px;font-weight:600;display:flex;align-items:center;gap:5px}
.djp-symbol-remove{background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:13px;padding:0;line-height:1;transition:color .12s}
.djp-symbol-remove:hover{color:#ff6b6b}
.djp-preset-hint{font-size:10px;color:rgba(255,255,255,.3);margin-bottom:6px}
.djp-preset-grid{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px}
.djp-preset-chip{padding:4px 9px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.45);font-size:10px;cursor:pointer;transition:all .12s}
.djp-preset-chip:hover{background:rgba(124,92,255,.12);border-color:rgba(124,92,255,.3);color:rgba(255,255,255,.8)}
.djp-narrative{width:100%;min-height:90px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:11px 13px;color:#fff;font-size:13px;line-height:1.55;resize:none;outline:none;box-sizing:border-box;transition:border-color .15s;font-family:'DM Sans',sans-serif}
.djp-narrative:focus{border-color:rgba(124,92,255,.5)}
.djp-timing-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.djp-field label{display:block;font-size:10px;color:rgba(255,255,255,.45);margin-bottom:5px;font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:.8px}
.djp-field input,.djp-field select{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:9px 11px;color:#fff;font-size:13px;outline:none;box-sizing:border-box;transition:border-color .15s;-webkit-appearance:none}
.djp-field input:focus,.djp-field select:focus{border-color:rgba(124,92,255,.5)}
.djp-field select option{background:#1a1828}
.djp-field input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(.6)}
.djp-footer{display:flex;gap:10px;justify-content:flex-end;margin-top:22px}
.djp-btn{padding:10px 20px;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer;transition:all .15s;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff}
.djp-btn:hover{background:rgba(255,255,255,.12)}
.djp-btn.primary{background:rgba(124,92,255,.3);border-color:rgba(124,92,255,.6);color:#fff}
.djp-btn.primary:hover{background:rgba(124,92,255,.5)}
.djp-lucid-toggle{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);cursor:pointer;transition:all .15s}
.djp-lucid-toggle:hover{border-color:rgba(124,92,255,.3);background:rgba(124,92,255,.07)}
.djp-lucid-toggle.active{border-color:rgba(124,92,255,.6);background:rgba(124,92,255,.15)}
.djp-lucid-icon{font-size:18px}
.djp-lucid-text{flex:1}
.djp-lucid-title{font-weight:700;font-size:13px;color:#fff}
.djp-lucid-desc{font-size:11px;color:rgba(255,255,255,.4);margin-top:2px}
.djp-lucid-check{width:20px;height:20px;border-radius:6px;border:1px solid rgba(124,92,255,.4);background:rgba(124,92,255,.1);display:flex;align-items:center;justify-content:center;font-size:12px;color:rgba(124,92,255,.8)}
.djp-lucid-toggle.active .djp-lucid-check{background:rgba(124,92,255,.4);color:#fff}
.djp-divider{height:1px;background:rgba(255,255,255,.07);margin:18px 0}
.djp-hist-panel{width:100%;max-width:580px;max-height:92vh;overflow:hidden;display:flex;flex-direction:column;background:#0d0c1a;border:1px solid rgba(124,92,255,.22);border-radius:20px;box-shadow:0 24px 80px rgba(0,0,0,.7);opacity:0;transform:translateY(18px);transition:opacity .22s ease,transform .22s ease}
.djp-hist-panel.visible{opacity:1;transform:translateY(0)}
.djp-hist-top{padding:20px 22px 0;flex-shrink:0}
.djp-hist-scroll{flex:1;overflow-y:auto;padding:16px 22px 24px;scrollbar-width:thin;scrollbar-color:rgba(124,92,255,.3) transparent}
.djp-hist-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px}
.djp-hist-actions{display:flex;gap:8px;align-items:center}
.djp-hist-action-btn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:6px 12px;color:rgba(255,255,255,.7);font-size:11px;font-weight:700;cursor:pointer;transition:background .15s}
.djp-hist-action-btn:hover{background:rgba(255,255,255,.12)}
.djp-stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
.djp-stat{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px;text-align:center}
.djp-stat-val{font-size:16px;font-weight:900;color:#fff;font-family:'Bebas Neue',sans-serif;letter-spacing:.5px;line-height:1}
.djp-stat-lbl{font-size:9px;color:rgba(255,255,255,.4);margin-top:3px;font-family:'JetBrains Mono',monospace;letter-spacing:.8px;text-transform:uppercase}
.djp-tabs{display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:10px}
.djp-tab{padding:7px 14px;border-radius:10px;border:1px solid transparent;background:transparent;color:rgba(255,255,255,.45);font-size:12px;font-weight:700;cursor:pointer;transition:all .15s;font-family:'JetBrains Mono',monospace}
.djp-tab:hover{color:rgba(255,255,255,.8)}
.djp-tab.active{background:rgba(124,92,255,.2);border-color:rgba(124,92,255,.45);color:#fff}
.djp-chart-wrap{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:14px;margin-bottom:14px}
.djp-chart-controls{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.djp-range-btn{padding:5px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:transparent;color:rgba(255,255,255,.5);font-size:10px;font-weight:700;cursor:pointer;font-family:'JetBrains Mono',monospace;transition:all .15s}
.djp-range-btn.active{background:rgba(124,92,255,.22);border-color:rgba(124,92,255,.5);color:#fff}
.djp-pattern-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.djp-pattern-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:12px}
.djp-pattern-title{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:rgba(124,92,255,.7);font-family:'JetBrains Mono',monospace;margin-bottom:10px}
.djp-bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.djp-bar-label{font-size:10px;color:rgba(255,255,255,.6);width:60px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.djp-bar-fill-wrap{flex:1;height:6px;background:rgba(255,255,255,.07);border-radius:4px;overflow:hidden}
.djp-bar-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,rgba(124,92,255,.7),rgba(124,92,255,1))}
.djp-bar-count{font-size:10px;color:rgba(255,255,255,.4);width:18px;text-align:right;flex-shrink:0}
.djp-hist-list{display:flex;flex-direction:column;gap:8px}
.djp-hist-row{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:12px 14px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;transition:border-color .15s}
.djp-hist-row:hover{border-color:rgba(124,92,255,.25)}
.djp-hist-main{flex:1;min-width:0}
.djp-hist-date{font-weight:900;font-size:13px;color:#fff;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.djp-hist-type-badge{font-size:10px;padding:2px 7px;border-radius:8px;background:rgba(124,92,255,.18);border:1px solid rgba(124,92,255,.3);color:rgba(124,92,255,.9);font-weight:700}
.djp-hist-meta{font-size:11px;color:rgba(255,255,255,.45);margin-top:3px}
.djp-hist-symbols{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.djp-hist-symbol{font-size:9px;padding:2px 7px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.5)}
.djp-hist-narrative{font-size:11px;color:rgba(255,255,255,.6);margin-top:6px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.djp-hist-row-actions{display:flex;gap:5px}
.djp-icon-btn{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.6);transition:all .15s}
.djp-icon-btn:hover{background:rgba(255,255,255,.12);color:#fff}
.djp-icon-btn.del:hover{background:rgba(255,60,60,.15);border-color:rgba(255,60,60,.3);color:#ff6b6b}
.djp-search{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:9px 13px;color:#fff;font-size:12px;outline:none;box-sizing:border-box;margin-bottom:12px;transition:border-color .15s}
.djp-search:focus{border-color:rgba(124,92,255,.5)}
.djp-empty{text-align:center;padding:28px 0;color:rgba(255,255,255,.25);font-size:13px}
@media(max-width:480px){.djp-stats-grid{grid-template-columns:repeat(2,1fr)}.djp-pattern-grid{grid-template-columns:1fr}.djp-timing-row{grid-template-columns:1fr}}
  `;
  document.head.appendChild(s);
}

function _djpCalcMinutes(dateStr, startStr, endStr){
  if(!dateStr||!startStr||!endStr) return 0;
  const [sh,sm]=startStr.split(":").map(Number);
  const [eh,em]=endStr.split(":").map(Number);
  if([sh,sm,eh,em].some(n=>Number.isNaN(n))) return 0;
  const s=new Date(`${dateStr}T00:00:00`); s.setHours(sh,sm,0,0);
  const e=new Date(`${dateStr}T00:00:00`); e.setHours(eh,em,0,0);
  if(e<=s) e.setDate(e.getDate()+1);
  return Math.round((e-s)/60000);
}

function openSleepModal(opts={}){
  _djpInjectStyles();
  const host=document.querySelector("#app")||document.body;
  const editId=opts?.editId?String(opts.editId):"";
  const existingRaw=editId?(state?.sleepLog||[]).find(x=>String(x.id||"")===editId):null;
  const ex=existingRaw?normalizeSleepEntry(existingRaw):null;
  const today=ex?.date||isoDate(new Date());

  const form={
    date:today,
    quality:ex?.quality?String(ex.quality):"",
    start:ex?.start||"",
    end:ex?.end||"",
    note:ex?.note||"",
    narrative:ex?.narrative||"",
    dreamType:ex?.dreamType||"",
    wakeEmotion:ex?.wakeEmotion||"",
    symbols:[...(ex?.symbols||[])],
    clarity:ex?.clarity||null,
    lucidMoment:ex?.lucidMoment||false,
  };

  const backdrop=document.createElement("div");
  backdrop.className="djp-backdrop";

  const renderForm=()=>{
    backdrop.innerHTML=`
      <div class="djp-panel" id="djpPanel">
        <div class="djp-header">
          <div>
            <div class="djp-title">${ex?"Editar Sueño":"Registrar Sueño"}</div>
            <div class="djp-sub">Dream Journal · ${escapeHtml(form.date)}</div>
          </div>
          <button class="djp-close" id="djpClose">✕</button>
        </div>

        <div class="djp-section">
          <div class="djp-label">Tipo de sueño</div>
          <div class="djp-pill-grid">
            ${_DJP_TYPES.map(t=>`<button class="djp-pill ${form.dreamType===t.id?"active":""}" data-type="${t.id}">${t.icon} ${escapeHtml(t.label)}</button>`).join("")}
          </div>
        </div>

        <div class="djp-section">
          <div class="djp-label">Emoción al despertar</div>
          <div class="djp-pill-grid">
            ${_DJP_EMOTIONS.map(e=>`<button class="djp-pill ${form.wakeEmotion===e.id?"active":""}" data-emotion="${e.id}">${e.icon} ${escapeHtml(e.label)}</button>`).join("")}
          </div>
        </div>

        <div class="djp-section">
          <div class="djp-label">Claridad del recuerdo</div>
          <div class="djp-clarity-row">
            ${_DJP_CLARITY.map(c=>`<button class="djp-clarity-btn ${form.clarity===c.v?"active":""}" data-clarity="${c.v}">${c.v}<br><span style="font-size:9px">${escapeHtml(c.label)}</span></button>`).join("")}
          </div>
        </div>

        <div class="djp-section">
          <div class="djp-lucid-toggle ${form.lucidMoment?"active":""}" id="djpLucid">
            <div class="djp-lucid-icon">✨</div>
            <div class="djp-lucid-text">
              <div class="djp-lucid-title">Momento de lucidez</div>
              <div class="djp-lucid-desc">Hubo consciencia dentro del sueño</div>
            </div>
            <div class="djp-lucid-check">${form.lucidMoment?"✓":""}</div>
          </div>
        </div>

        <div class="djp-section">
          <div class="djp-label">Narrativa del sueño</div>
          <textarea class="djp-narrative" id="djpNarrative" rows="4" placeholder="Describe lo que recordás... lugares, personas, sensaciones, secuencias...">${escapeHtml(form.narrative)}</textarea>
        </div>

        <div class="djp-section">
          <div class="djp-label">Símbolos y arquetipos</div>
          <div class="djp-preset-hint">Atajos rápidos:</div>
          <div class="djp-preset-grid">
            ${_DJP_SYMBOLS.map(s=>`<button class="djp-preset-chip" data-preset="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("")}
          </div>
          <div class="djp-symbol-input-row">
            <input class="djp-symbol-input" id="djpSymInput" placeholder="Símbolo personalizado..."/>
            <button class="djp-symbol-add" id="djpSymAdd">＋</button>
          </div>
          <div class="djp-pill-grid" id="djpSymTags">
            ${form.symbols.map(s=>`<span class="djp-symbol-tag">${escapeHtml(s)}<button class="djp-symbol-remove" data-rm="${escapeHtml(s)}">×</button></span>`).join("")}
          </div>
        </div>

        <div class="djp-divider"></div>

        <div class="djp-section">
          <div class="djp-label">Duración y calidad</div>
          <div class="djp-timing-row">
            <div class="djp-field"><label>Fecha</label><input type="date" id="djpDate" value="${escapeHtml(form.date)}"></div>
            <div class="djp-field"><label>Calidad (1–5)</label>
              <select id="djpQuality">
                <option value="">—</option>
                ${[1,2,3,4,5].map(n=>`<option value="${n}" ${form.quality===String(n)?"selected":""}>${n}</option>`).join("")}
              </select>
            </div>
            <div class="djp-field"><label>Hora inicio</label><input type="time" id="djpStart" value="${escapeHtml(form.start)}"></div>
            <div class="djp-field"><label>Hora fin</label><input type="time" id="djpEnd" value="${escapeHtml(form.end)}"></div>
          </div>
          <div class="djp-field" style="margin-top:10px;">
            <label>Nota rápida</label>
            <input type="text" id="djpNote" placeholder="café tarde, ruido, calor..." value="${escapeHtml(form.note)}">
          </div>
        </div>

        <div class="djp-footer">
          <button class="djp-btn" id="djpCancel">Cancelar</button>
          <button class="djp-btn primary" id="djpSave">${ex?"Guardar cambios":"Guardar sueño 🌙"}</button>
        </div>
      </div>
    `;
    requestAnimationFrame(()=>{ backdrop.querySelector("#djpPanel")?.classList.add("visible"); });
    wireForm();
  };

  const close=()=>{
    const p=backdrop.querySelector("#djpPanel");
    if(p){ p.style.transition="opacity .18s,transform .18s"; p.style.opacity="0"; p.style.transform="translateY(14px)"; }
    setTimeout(()=>backdrop.remove(),200);
  };

  const refreshSymTags=()=>{
    const c=backdrop.querySelector("#djpSymTags");
    if(!c) return;
    c.innerHTML=form.symbols.map(s=>`<span class="djp-symbol-tag">${escapeHtml(s)}<button class="djp-symbol-remove" data-rm="${escapeHtml(s)}">×</button></span>`).join("");
    c.querySelectorAll("[data-rm]").forEach(b=>b.addEventListener("click",()=>{ form.symbols=form.symbols.filter(x=>x!==b.getAttribute("data-rm")); refreshSymTags(); }));
  };

  const wireForm=()=>{
    const g=id=>backdrop.querySelector(`#${id}`);

    g("djpClose")?.addEventListener("click",close);
    g("djpCancel")?.addEventListener("click",close);
    backdrop.addEventListener("click",e=>{ if(e.target===backdrop) close(); });

    backdrop.querySelectorAll("[data-type]").forEach(b=>b.addEventListener("click",()=>{
      form.dreamType=form.dreamType===b.getAttribute("data-type")?"":b.getAttribute("data-type");
      backdrop.querySelectorAll("[data-type]").forEach(x=>x.classList.toggle("active",x.getAttribute("data-type")===form.dreamType));
    }));

    backdrop.querySelectorAll("[data-emotion]").forEach(b=>b.addEventListener("click",()=>{
      form.wakeEmotion=form.wakeEmotion===b.getAttribute("data-emotion")?"":b.getAttribute("data-emotion");
      backdrop.querySelectorAll("[data-emotion]").forEach(x=>x.classList.toggle("active",x.getAttribute("data-emotion")===form.wakeEmotion));
    }));

    backdrop.querySelectorAll("[data-clarity]").forEach(b=>b.addEventListener("click",()=>{
      const v=Number(b.getAttribute("data-clarity"));
      form.clarity=form.clarity===v?null:v;
      backdrop.querySelectorAll("[data-clarity]").forEach(x=>x.classList.toggle("active",Number(x.getAttribute("data-clarity"))===form.clarity));
    }));

    const lucid=g("djpLucid");
    lucid?.addEventListener("click",()=>{
      form.lucidMoment=!form.lucidMoment;
      lucid.classList.toggle("active",form.lucidMoment);
      const chk=lucid.querySelector(".djp-lucid-check");
      if(chk) chk.textContent=form.lucidMoment?"✓":"";
    });

    backdrop.querySelectorAll("[data-preset]").forEach(b=>b.addEventListener("click",()=>{
      const s=b.getAttribute("data-preset");
      if(s&&!form.symbols.includes(s)){ form.symbols.push(s); refreshSymTags(); }
    }));

    const symInput=g("djpSymInput");
    const addSym=()=>{
      const s=(symInput?.value||"").trim().toLowerCase();
      if(s&&!form.symbols.includes(s)){ form.symbols.push(s); refreshSymTags(); if(symInput) symInput.value=""; }
    };
    g("djpSymAdd")?.addEventListener("click",addSym);
    symInput?.addEventListener("keydown",e=>{ if(e.key==="Enter"){e.preventDefault();addSym();} });

    // attach initial symbol remove buttons
    refreshSymTags();

    g("djpSave")?.addEventListener("click",()=>{
      const date=(g("djpDate")?.value||"").trim();
      const quality=(g("djpQuality")?.value||"").trim();
      const start=(g("djpStart")?.value||"").trim();
      const end=(g("djpEnd")?.value||"").trim();
      const note=(g("djpNote")?.value||"").trim();
      const narrative=(g("djpNarrative")?.value||"").trim();

      if(!date){ toast("Elige una fecha 📅"); return; }

      let totalMinutes=0;
      if(start&&end) totalMinutes=_djpCalcMinutes(date,start,end);
      if(!totalMinutes&&!narrative&&!form.dreamType){ toast("Agrega hora inicio/fin, o escribe algo del sueño 🌙"); return; }
      if(totalMinutes>24*60){ toast("Más de 24h 😅 Revisa"); return; }

      const entry={
        id:ex?.id||uid(),
        ts:new Date().toISOString(),
        date,
        totalMinutes:totalMinutes||(ex?.totalMinutes||0),
        quality:quality?Number(quality):null,
        note,
        mode:"advanced",
        start,
        end,
        narrative,
        dreamType:form.dreamType,
        wakeEmotion:form.wakeEmotion,
        symbols:[...form.symbols],
        clarity:form.clarity,
        lucidMoment:form.lucidMoment,
      };

      state.sleepLog=Array.isArray(state.sleepLog)?state.sleepLog:[];
      if(ex){
        const idx=state.sleepLog.findIndex(x=>String(x.id||"")===ex.id);
        if(idx>=0) state.sleepLog[idx]=entry;
        else state.sleepLog.push(entry);
      } else {
        state.sleepLog.push(entry);
      }
      if(state.sleepLog.length>1500) state.sleepLog=state.sleepLog.slice(-1500);
      persist(); view();
      if(typeof opts.onSaved==="function") opts.onSaved(entry);
      toast(ex?"Sueño actualizado ✅":"Sueño guardado 🌙");
      close();
    });
  };

  renderForm();
  host.appendChild(backdrop);
}

// ─── Dream Journal Pro: openSleepHistoryModal ──────────────────────────────

function openSleepHistoryModal(){
  _djpInjectStyles();
  const host=document.querySelector("#app")||document.body;
  const backdrop=document.createElement("div");
  backdrop.className="djp-backdrop";

  backdrop.innerHTML=`
    <div class="djp-hist-panel" id="djpHistPanel">
      <div class="djp-hist-top">
        <div class="djp-hist-header">
          <div>
            <div class="djp-title">Dream Journal</div>
            <div class="djp-sub">Historial · Patrones · Análisis</div>
          </div>
          <div class="djp-hist-actions">
            <button class="djp-hist-action-btn" id="djpHistCsv">CSV</button>
            <button class="djp-hist-action-btn" id="djpHistAdd">＋ Nuevo</button>
            <button class="djp-close" id="djpHistClose">✕</button>
          </div>
        </div>
        <div class="djp-stats-grid" id="djpStatGrid"></div>
        <div class="djp-tabs">
          <button class="djp-tab active" data-tab="log">📋 Registros</button>
          <button class="djp-tab" data-tab="patterns">🔮 Patrones</button>
          <button class="djp-tab" data-tab="chart">📈 Gráfico</button>
        </div>
      </div>
      <div class="djp-hist-scroll" id="djpHistContent"></div>
    </div>
  `;

  host.appendChild(backdrop);
  requestAnimationFrame(()=>{ backdrop.querySelector("#djpHistPanel")?.classList.add("visible"); });

  const close=()=>{
    const p=backdrop.querySelector("#djpHistPanel");
    if(p){ p.style.transition="opacity .18s,transform .18s"; p.style.opacity="0"; p.style.transform="translateY(14px)"; }
    setTimeout(()=>backdrop.remove(),200);
  };

  backdrop.querySelector("#djpHistClose")?.addEventListener("click",close);
  backdrop.addEventListener("click",e=>{ if(e.target===backdrop) close(); });

  const uiSt={tab:"log",range:"30",query:""};

  const getLog=()=>(state?.sleepLog||[]).map(normalizeSleepEntry).filter(Boolean).sort((a,b)=>b.date.localeCompare(a.date));

  const getFiltered=()=>{
    const full=getLog();
    const q=uiSt.query.trim().toLowerCase();
    const filt=q?full.filter(x=>x.date.includes(q)||(x.note||"").toLowerCase().includes(q)||(x.narrative||"").toLowerCase().includes(q)||x.symbols.some(s=>s.toLowerCase().includes(q))):full;
    if(uiSt.range==="all") return filt;
    const days=Number(uiSt.range)||30;
    const from=new Date(); from.setDate(from.getDate()-(days-1)); from.setHours(0,0,0,0);
    return filt.filter(x=>new Date(x.date+"T00:00:00")>=from);
  };

  const renderStats=()=>{
    const all=getLog();
    const rec=getFiltered().filter(x=>x.totalMinutes>0);
    const avg=rec.length?rec.reduce((s,x)=>s+x.totalMinutes,0)/rec.length:0;
    const lucidAll=all.filter(x=>x.lucidMoment);
    const uniqueDates=new Set(all.map(x=>x.date));
    let streak=0; const cur=new Date(); cur.setDate(cur.getDate()-1);
    while(true){ const ds=isoDate(cur); if(!uniqueDates.has(ds)) break; streak++; cur.setDate(cur.getDate()-1); }
    const g=backdrop.querySelector("#djpStatGrid");
    if(!g) return;
    g.innerHTML=[
      {v:all.length,l:"Total"},
      {v:formatSleepDuration(avg),l:"Prom. horas"},
      {v:`${streak}🔥`,l:"Racha"},
      {v:lucidAll.length,l:"Lúcidos"},
    ].map(s=>`<div class="djp-stat"><div class="djp-stat-val">${escapeHtml(String(s.v))}</div><div class="djp-stat-lbl">${escapeHtml(s.l)}</div></div>`).join("");
  };

  const renderLog=()=>{
    const rows=getFiltered();
    const c=backdrop.querySelector("#djpHistContent");
    if(!c) return;

    const allLogs = getLog();
    const heatmapData = {};
    const year = new Date().getFullYear();
    allLogs.forEach(r => {
      if(!r.date.startsWith(String(year))) return;
      let color = "rgba(124,92,255,0.2)"; 
      if(r.totalMinutes > 0) {
        const h = r.totalMinutes / 60;
        if(h >= 8) color = "#4ADE80";
        else if(h >= 6) color = "#86EFAC";
        else if(h >= 4) color = "#FBBF24";
        else color = "#F87171";
      }
      heatmapData[r.date] = {
        color,
        label: r.totalMinutes ? formatSleepDuration(r.totalMinutes) : "Sin duración"
      };
    });
    const ghHtml = renderGithubHeatmap(year, heatmapData);

    const tMap=Object.fromEntries(_DJP_TYPES.map(t=>[t.id,t]));
    const eMap=Object.fromEntries(_DJP_EMOTIONS.map(e=>[e.id,e]));
    c.innerHTML=`
      ${ghHtml}
      <div class="djp-chart-controls" style="margin-bottom:10px;">
        ${[["7","7D"],["30","30D"],["90","90D"],["all","Todo"]].map(([v,t])=>`<button class="djp-range-btn ${uiSt.range===v?"active":""}" data-range="${v}">${t}</button>`).join("")}
      </div>
      <input class="djp-search" id="djpSearch" placeholder="Buscar por fecha, nota, símbolo..." value="${escapeHtml(uiSt.query)}">
      <div class="djp-hist-list">
        ${rows.length?rows.map(r=>{
          const ti=tMap[r.dreamType]; const ei=eMap[r.wakeEmotion];
          return `<div class="djp-hist-row">
            <div class="djp-hist-main">
              <div class="djp-hist-date">
                ${escapeHtml(r.date)}
                ${ti?`<span class="djp-hist-type-badge">${ti.icon} ${escapeHtml(ti.label)}</span>`:""}
                ${r.lucidMoment?`<span class="djp-hist-type-badge">✨ Lúcido</span>`:""}
              </div>
              <div class="djp-hist-meta">
                ${r.totalMinutes?formatSleepDuration(r.totalMinutes):"Sin duración"}
                ${r.quality?` · Q${r.quality}/5`:""}
                ${ei?` · ${ei.icon} ${escapeHtml(ei.label)}`:""}
                ${r.clarity?` · Claridad ${r.clarity}/5`:""}
              </div>
              ${r.symbols.length?`<div class="djp-hist-symbols">${r.symbols.map(s=>`<span class="djp-hist-symbol">${escapeHtml(s)}</span>`).join("")}</div>`:""}
              ${r.narrative?`<div class="djp-hist-narrative">${escapeHtml(r.narrative)}</div>`:""}
            </div>
            <div class="djp-hist-row-actions">
              <button class="djp-icon-btn" data-edit="${escapeHtml(r.id)}">✎</button>
              <button class="djp-icon-btn del" data-del="${escapeHtml(r.id)}">🗑</button>
            </div>
          </div>`;
        }).join(""):`<div class="djp-empty">Sin registros para este período.</div>`}
      </div>
    `;
    c.querySelectorAll("[data-range]").forEach(b=>b.addEventListener("click",()=>{ uiSt.range=b.getAttribute("data-range")||"30"; renderLog(); renderStats(); }));
    c.querySelector("#djpSearch")?.addEventListener("input",e=>{ uiSt.query=e.target.value||""; renderLog(); });
    c.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>{ openSleepModal({editId:b.getAttribute("data-edit"),onSaved:()=>{ renderStats(); renderActive(); }}); }));
    c.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{
      state.sleepLog=(state.sleepLog||[]).filter(x=>String(x.id||"")!==b.getAttribute("data-del"));
      persist(); view(); toast("Registro eliminado 🗑"); renderStats(); renderActive();
    }));
  };

  const renderPatterns=()=>{
    const all=getLog();
    const c=backdrop.querySelector("#djpHistContent");
    if(!c) return;
    const symCount={};
    all.forEach(r=>r.symbols.forEach(s=>{ symCount[s]=(symCount[s]||0)+1; }));
    const topSym=Object.entries(symCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const typeCount={};
    all.forEach(r=>{ if(r.dreamType) typeCount[r.dreamType]=(typeCount[r.dreamType]||0)+1; });
    const tMap=Object.fromEntries(_DJP_TYPES.map(t=>[t.id,t]));
    const topTypes=Object.entries(typeCount).sort((a,b)=>b[1]-a[1]);
    const emCount={};
    all.forEach(r=>{ if(r.wakeEmotion) emCount[r.wakeEmotion]=(emCount[r.wakeEmotion]||0)+1; });
    const eMap=Object.fromEntries(_DJP_EMOTIONS.map(e=>[e.id,e]));
    const topEm=Object.entries(emCount).sort((a,b)=>b[1]-a[1]);
    const maxS=topSym[0]?.[1]||1; const maxT=topTypes[0]?.[1]||1; const maxE=topEm[0]?.[1]||1;
    const lucid=all.filter(x=>x.lucidMoment);
    c.innerHTML=`
      <div class="djp-pattern-grid">
        <div class="djp-pattern-card">
          <div class="djp-pattern-title">🔮 Símbolos frecuentes</div>
          ${topSym.length?topSym.map(([s,n])=>`<div class="djp-bar-row"><div class="djp-bar-label" title="${escapeHtml(s)}">${escapeHtml(s)}</div><div class="djp-bar-fill-wrap"><div class="djp-bar-fill" style="width:${Math.round((n/maxS)*100)}%"></div></div><div class="djp-bar-count">${n}</div></div>`).join(""):`<div style="color:rgba(255,255,255,.3);font-size:11px">Sin datos aún</div>`}
        </div>
        <div class="djp-pattern-card">
          <div class="djp-pattern-title">🌙 Tipos de sueño</div>
          ${topTypes.length?topTypes.map(([id,n])=>`<div class="djp-bar-row"><div class="djp-bar-label">${tMap[id]?.icon||""} ${escapeHtml(tMap[id]?.label||id)}</div><div class="djp-bar-fill-wrap"><div class="djp-bar-fill" style="width:${Math.round((n/maxT)*100)}%"></div></div><div class="djp-bar-count">${n}</div></div>`).join(""):`<div style="color:rgba(255,255,255,.3);font-size:11px">Sin datos aún</div>`}
        </div>
        <div class="djp-pattern-card">
          <div class="djp-pattern-title">💫 Emociones al despertar</div>
          ${topEm.length?topEm.slice(0,6).map(([id,n])=>`<div class="djp-bar-row"><div class="djp-bar-label">${eMap[id]?.icon||""} ${escapeHtml(eMap[id]?.label||id)}</div><div class="djp-bar-fill-wrap"><div class="djp-bar-fill" style="width:${Math.round((n/maxE)*100)}%"></div></div><div class="djp-bar-count">${n}</div></div>`).join(""):`<div style="color:rgba(255,255,255,.3);font-size:11px">Sin datos aún</div>`}
        </div>
        <div class="djp-pattern-card">
          <div class="djp-pattern-title">📊 Resumen global</div>
          <div class="djp-bar-row" style="margin-bottom:10px"><div style="flex:1;font-size:11px;color:rgba(255,255,255,.6)">Total sueños</div><div style="font-weight:900;font-size:15px;color:#fff">${all.length}</div></div>
          <div class="djp-bar-row" style="margin-bottom:10px"><div style="flex:1;font-size:11px;color:rgba(255,255,255,.6)">Lúcidos</div><div style="font-weight:900;font-size:15px;color:rgba(124,92,255,.9)">${lucid.length} <span style="font-size:10px;opacity:.6">(${all.length?((lucid.length/all.length)*100).toFixed(0):0}%)</span></div></div>
          <div class="djp-bar-row" style="margin-bottom:10px"><div style="flex:1;font-size:11px;color:rgba(255,255,255,.6)">Pesadillas</div><div style="font-weight:900;font-size:15px;color:rgba(255,100,100,.8)">${all.filter(r=>r.dreamType==="nightmare").length}</div></div>
          <div class="djp-bar-row"><div style="flex:1;font-size:11px;color:rgba(255,255,255,.6)">Con narrativa</div><div style="font-weight:900;font-size:15px;color:rgba(80,200,140,.8)">${all.filter(r=>r.narrative).length}</div></div>
        </div>
      </div>
    `;
  };

  const renderChart=()=>{
    const c=backdrop.querySelector("#djpHistContent");
    if(!c) return;
    const rows=getFiltered().filter(x=>x.totalMinutes>0).reverse();
    const W=460,H=150;
    const maxH=Math.max(8*60,...rows.map(x=>x.totalMinutes),1);
    const px=(i,len)=>len<=1?W/2:Math.round(18+((W-36)*i/(len-1)));
    const py=v=>Math.round(H-18-((v/maxH)*(H-36)));
    const pts=rows.map((r,i)=>({x:px(i,rows.length),y:py(r.totalMinutes),r}));
    let path="";
    if(pts.length>1){
      path=`M ${pts[0].x} ${pts[0].y}`;
      for(let i=1;i<pts.length;i++){ const cx=Math.round((pts[i-1].x+pts[i].x)/2); path+=` Q ${cx} ${pts[i-1].y}, ${pts[i].x} ${pts[i].y}`; }
    }
    const allLogs = getLog();
    const heatmapData = {};
    const year = new Date().getFullYear();
    allLogs.forEach(r => {
      if(!r.date.startsWith(String(year))) return;
      let color = "rgba(124,92,255,0.2)"; // default light purple
      if(r.totalMinutes > 0) {
        const h = r.totalMinutes / 60;
        if(h >= 8) color = "#4ADE80"; // green
        else if(h >= 6) color = "#86EFAC"; // light green
        else if(h >= 4) color = "#FBBF24"; // yellow
        else color = "#F87171"; // red
      }
      heatmapData[r.date] = {
        color,
        label: r.totalMinutes ? formatSleepDuration(r.totalMinutes) : "Sin duración"
      };
    });
    const ghHtml = renderGithubHeatmap(year, heatmapData);

    c.innerHTML=`
      <div class="djp-chart-controls">
        ${[["7","7D"],["30","30D"],["90","90D"],["all","Todo"]].map(([v,t])=>`<button class="djp-range-btn ${uiSt.range===v?"active":""}" data-range="${v}">${t}</button>`).join("")}
      </div>
      <div class="djp-chart-wrap" style="margin-bottom:16px;">
        <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px;font-weight:700;text-transform:uppercase;">Curva de sueño</div>
        ${rows.length?`
          <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
            <defs><linearGradient id="djpGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(124,92,255,.3)"/>
              <stop offset="100%" stop-color="rgba(124,92,255,0)"/>
            </linearGradient></defs>
            <line x1="14" y1="${H-18}" x2="${W-14}" y2="${H-18}" stroke="rgba(255,255,255,.15)" stroke-width="1"/>
            ${path?`<path d="${path} L ${pts[pts.length-1].x} ${H-18} L ${pts[0].x} ${H-18} Z" fill="url(#djpGrad)"/>
            <path d="${path}" fill="none" stroke="rgba(124,92,255,.9)" stroke-width="2.5" stroke-linecap="round"/>`:``}
            ${pts.map(pt=>`<circle cx="${pt.x}" cy="${pt.y}" r="3.5" fill="#fff" stroke="rgba(124,92,255,.9)" stroke-width="2"><title>${escapeHtml(pt.r.date)} · ${formatSleepDuration(pt.r.totalMinutes)}</title></circle>`).join("")}
          </svg>
        `:`<div class="djp-empty">Sin datos con duración en este período.</div>`}
      </div>
      ${ghHtml}
    `;
    c.querySelectorAll("[data-range]").forEach(b=>b.addEventListener("click",()=>{ uiSt.range=b.getAttribute("data-range")||"30"; renderChart(); renderStats(); }));
  };

  const renderActive=()=>{
    if(uiSt.tab==="log") renderLog();
    else if(uiSt.tab==="patterns") renderPatterns();
    else renderChart();
  };

  backdrop.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{
    backdrop.querySelectorAll("[data-tab]").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    uiSt.tab=b.getAttribute("data-tab")||"log";
    renderActive();
  }));

  backdrop.querySelector("#djpHistCsv")?.addEventListener("click",()=>{
    const rows=getLog();
    if(!rows.length){ toast("No hay registros 📭"); return; }
    const esc=v=>`"${String(v??"")}"`; 
    const head=["fecha","horas","minutos","calidad","tipo","emocion","claridad","lucido","simbolos","narrativa","nota","inicio","fin"];
    const body=rows.map(r=>[r.date,(r.totalMinutes/60).toFixed(2),r.totalMinutes,r.quality??"",r.dreamType,r.wakeEmotion,r.clarity??"",r.lucidMoment?"si":"no",r.symbols.join("|"),r.narrative,r.note,r.start,r.end]);
    const csv=[head,...body].map(row=>row.map(esc).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`dream-journal-${isoDate(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast("CSV exportado ✅");
  });

  backdrop.querySelector("#djpHistAdd")?.addEventListener("click",()=>{ openSleepModal({onSaved:()=>{ renderStats(); renderActive(); }}); });

  renderStats();
  renderActive();
}



function openMusicModal(){
  const host = document.querySelector("#app");
  const modal = document.createElement("div");
  modal.className = "modalBackdrop";

  modal.innerHTML = `
    <div class="modal">
      <h2>Tema Fav. (registrar)</h2>
      <div class="grid">
        <input class="input" id="mcSong" placeholder="Canción (obligatorio)" />
        <input class="input" id="mcArtist" placeholder="Artista (opcional)" />
        <input class="input" id="mcAlbum" placeholder="Álbum (opcional)" />
        <input class="input" id="mcMood" placeholder="Mood tag (opcional) ej: calma, power" />
        <input class="input" id="mcIntensity" type="number" min="1" max="10" step="1" placeholder="Intensidad (1-10, opcional)" />
        <input class="input" id="mcCoverUrl" placeholder="Cover URL (opcional)" />
        <input class="input" id="mcLinkUrl" placeholder="Link (Spotify/YouTube) (opcional)" />
        <textarea class="input" id="mcNote" placeholder="Nota (opcional)" rows="3"></textarea>
      </div>
      <div class="row" style="margin-top:12px;">
        <button class="btn ghost" id="btnCancel">Cancelar</button>
        <button class="btn primary" id="btnSave">Guardar</button>
      </div>
      <div class="muted" style="margin-top:10px;">Tip: si solo pones canción, ya sirve. Lo demás es extra.</div>
    </div>
  `;

  host.appendChild(modal);

  const close = ()=> modal.remove();
  modal.addEventListener("click", (e)=>{ if(e.target===modal) close(); });
  modal.querySelector("#btnCancel").addEventListener("click", close);

  modal.querySelector("#btnSave").addEventListener("click", ()=>{
    const song = modal.querySelector("#mcSong").value.trim();
    const artist = modal.querySelector("#mcArtist").value.trim();
    const album = modal.querySelector("#mcAlbum").value.trim();
    const mood = modal.querySelector("#mcMood").value.trim();
    const intensityRaw = modal.querySelector("#mcIntensity").value.trim();
    const coverUrlRaw = modal.querySelector("#mcCoverUrl").value.trim();
    const linkUrlRaw = modal.querySelector("#mcLinkUrl").value.trim();
    const note = modal.querySelector("#mcNote").value.trim();

    if(!song){
      toast("Falta la canción 🎵");
      return;
    }

    const intensity = intensityRaw ? Math.max(1, Math.min(10, Number(intensityRaw))) : null;

    const normUrl = (u)=>{
      if(!u) return "";
      try{
        const url = new URL(u);
        return url.toString();
      }catch{
        return "";
      }
    };
    const coverUrl = normUrl(coverUrlRaw);
    const linkUrl = normUrl(linkUrlRaw);

    const entry = {
      id: uid("t"),
      ts: new Date().toISOString(),
      date: getTodayIso(),
      song,
      artist,
      album,
      mood,
      intensity,
      coverUrl,
      linkUrl,
      note
    };

    state.musicLog = Array.isArray(state.musicLog) ? state.musicLog : [];
    state.musicLog.unshift(entry);
    state.musicToday = { ...entry, updatedAt: new Date().toISOString() };
    state.musicCursor = 0;
    persist();
    view();
    toast("Tema guardado ✅");
    close();
  });
}

function navigateMusic(delta){
  const log = Array.isArray(state.musicLog) ? state.musicLog : [];
  if(log.length <= 1) return;
  const next = Math.max(0, Math.min(log.length-1, Number(state.musicCursor||0) + delta));
  state.musicCursor = next;
  view();
}

function wireHome(root){
  const openSleepEntryModal = (opts={})=>{
    const fn = (typeof window.openSleepModal === "function") ? window.openSleepModal : openSleepModal;
    return fn(opts);
  };
  const openSleepHistory = ()=>{
    const fn = (typeof window.openSleepHistoryModal === "function") ? window.openSleepHistoryModal : openSleepHistoryModal;
    return fn();
  };

  const btnAdd = root.querySelector("#btnAddMusic");
  if(btnAdd) btnAdd.addEventListener("click", openMusicModal);

  const btnSleep = root.querySelector("#btnAddSleep");
  if(btnSleep) btnSleep.addEventListener("click", ()=>openSleepEntryModal());
  const sleepCard = root.querySelector("#homeSleepCard");
  if(sleepCard) sleepCard.addEventListener("click", (e)=>{ if(e.target && e.target.closest("#btnAddSleep")) return; openSleepHistory(); });

  // Navegar a la página de Tarot al tocar la card del Home
  const tarotCard = root.querySelector("#homeTarotCard");
  if(tarotCard) tarotCard.addEventListener("click", () => {
    state.tab = "tarot";
    injectTarotStyles();
    view();
  });

  // Mood sprites (daily emotion) — week strip pill
  const moodPill = root.querySelector("#homeMoodPill");
  if(moodPill){
    moodPill.addEventListener("click", (e)=>{
      e.preventDefault();
      const iso = moodPill.getAttribute("data-mood-day") || isoDate(new Date());
      openMoodPickerModal(iso, { onSaved: ()=>view() });
    });
  }

  // + button on the mood card
  const btnAddMoodEntry = root.querySelector("#btnAddMoodEntry");
  if(btnAddMoodEntry){
    btnAddMoodEntry.addEventListener("click", (e)=>{
      e.stopPropagation();
      openMoodPickerModal(isoDate(new Date()), { onSaved: ()=>view() });
    });
  }

  // Pick mood by tapping a day pill (week strip)
  root.querySelectorAll('.dayPill[data-day]').forEach(p=>{
    p.addEventListener("click", ()=>{
      const iso = p.getAttribute("data-day") || "";
      if(!iso) return;
      openMoodPickerModal(iso, { onSaved: ()=>view() });
    });
  });


  const prev = root.querySelector("#btnMusicPrev");
  const next = root.querySelector("#btnMusicNext");
  if(prev) prev.addEventListener("click", ()=>navigateMusic(1)); // older
  if(next) next.addEventListener("click", ()=>navigateMusic(-1)); // newer

  const play = root.querySelector("#btnMusicPlay");
  if(play) play.addEventListener("click", ()=>{
    const music = getMusicDisplay();
    const m = music.item;
    const link = m && (m.linkUrl || "");
    if(link){
      window.open(link, "_blank", "noopener,noreferrer");
      return;
    }
    toast("Agrega un link (Spotify/YouTube) en el registro 🎧");
  });

  const cover = root.querySelector(".musicCover");
  if(cover) cover.addEventListener("click", ()=>{
    const music = getMusicDisplay();
    const m = music.item;
    const link = m && (m.linkUrl || "");
    if(link) window.open(link, "_blank", "noopener,noreferrer");
  });

  const goRem = root.querySelector("#btnGoReminders");
  if(goRem) goRem.addEventListener("click", ()=>{ state.tab="reminders"; view(); });

  // reminder quick toggles
  root.querySelectorAll('input[type="checkbox"][data-rem]').forEach(cb=>{
    cb.addEventListener("change", ()=>{
      const id = cb.getAttribute("data-rem");
      const r = (state.reminders||[]).find(x=>x.id===id);
      if(!r) return;
      r.done = cb.checked;
      persist();
      // keep view, update small section
      view();
    });
  });

  // budget monthly
  const btnBudget = root.querySelector("#btnAddBudgetItem");
  if(btnBudget) btnBudget.addEventListener("click", (e)=>{ e.stopPropagation(); openBudgetModal(); });

  // Life Tracker events
  wireLifeTracker(root);

  const budgetCard = root.querySelector("#homeBudgetCard");
  if(budgetCard) budgetCard.addEventListener("click", (e)=>{ if(e.target && e.target.closest("#btnAddBudgetItem")) return; /* no auto-open, keeps card tappable but safe */ });

  // lunar money
  const btnLmRef = root.querySelector("#btnLunarMoneyRefresh");
  if(btnLmRef) btnLmRef.addEventListener("click", async (e)=>{
    e.stopPropagation();
    await refreshSwissTransitsUI({ forceSpeak: true });
    view();
  });

  const btnLmHist = root.querySelector("#btnLunarMoneyHistory");
  if(btnLmHist) btnLmHist.addEventListener("click", (e)=>{ e.stopPropagation(); openLunarMoneyHistoryModal(); });

  const lmCard = root.querySelector("#homeLunarMoneyCard");
  if(lmCard) lmCard.addEventListener("click", (e)=>{ if(e.target && e.target.closest("#btnLunarMoneyRefresh, #btnLunarMoneyHistory")) return; openLunarMoneyHistoryModal(); });

  // merge lab
  const btnMerge = root.querySelector("#btnOpenMergeGame");
  if(btnMerge) btnMerge.addEventListener("click", (e)=>{ e.stopPropagation(); openMergeGame(); });

  const mergeCard = root.querySelector("#homeMergeCard");
  if(mergeCard) mergeCard.addEventListener("click", (e)=>{ if(e.target && e.target.closest("#btnOpenMergeGame")) return; openMergeGame(); });


  root.querySelectorAll("[data-budget-del]").forEach(btn=>{
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const id = btn.getAttribute("data-budget-del");
      state.budgetMonthly = getBudgetMonthly().filter(x=>x.id!==id);
      persist();
      view();
      toast("Eliminado 🧹");
    });
  });



  // Swiss Astro (daily) - Home card wiring
  const swissCard = root.querySelector("#homeSwissAstroCard");
  if(swissCard){
    const btnRef = swissCard.querySelector("#btnSwissRefresh");
    const btnDet = swissCard.querySelector("#btnSwissDetails");
    if(btnRef) btnRef.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); ensureSwissDailyLoaded({ force:true }); });
    if(btnDet) btnDet.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); openSwissDailyModal(); });
    swissCard.addEventListener("click", (e)=>{
      if(e.target && e.target.closest("#btnSwissRefresh")) return;
      if(e.target && e.target.closest("#btnSwissDetails")) return;
      openSwissDailyModal();
    });
  }

  // Auto-load once per day when configured (silent)
  try{
    if(!state?.swissDaily && getSwissAstroUrl() && getSwissAstroKey()){
      ensureSwissDailyLoaded({ force:false });
    }else if(state?.swissDaily && getSwissAstroUrl() && getSwissAstroKey()){
      // if cached day differs, refresh silently
      const today = isoDate(new Date());
      const d = state.swissDaily;
      const dd = d?.date || d?._iso || "";
      if(dd && dd !== today) ensureSwissDailyLoaded({ force:false });
    }
  }catch(e){}

}

function wireCalendar(root){
  const prev = root.querySelector("#calPrev");
  const next = root.querySelector("#calNext");
  if(prev) prev.addEventListener("click", ()=>{ state.calMonthOffset = (state.calMonthOffset||0) - 1; view(); });
  if(next) next.addEventListener("click", ()=>{ state.calMonthOffset = (state.calMonthOffset||0) + 1; view(); });


  // Swiss Astro (daily)
  const swissCard = root.querySelector("#homeSwissAstroCard");
  if(swissCard){
    const btnRef = swissCard.querySelector("#btnSwissRefresh");
    const btnDet = swissCard.querySelector("#btnSwissDetails");
    if(btnRef) btnRef.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); ensureSwissDailyLoaded({ force:true }); });
    if(btnDet) btnDet.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); openSwissDailyModal(); });
    swissCard.addEventListener("click", (e)=>{ 
      if(e.target && e.target.closest("#btnSwissRefresh")) return;
      if(e.target && e.target.closest("#btnSwissDetails")) return;
      openSwissDailyModal(); 
    });
  }

  // Auto-load once when you enter Home (if configured)
  ensureSwissDailyLoaded().catch(()=>{});


  root.querySelectorAll("[data-cal-day]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const iso = btn.dataset.calDay;
      if(!iso) return;
      openCalendarDrawModal(iso);
    });
  });
}
// ---- END HOME ----

function viewRoutines(){
  const sorted = [...state.routines].sort((a,b)=>{
    const ta = (a.times?.[0] || "99:99");
    const tb = (b.times?.[0] || "99:99");
    return ta.localeCompare(tb) || (a.title||"").localeCompare(b.title||"");
  });

  return `
    <div class="sectionTitle">
      <div>Rutinas</div>
      <div class="chip">${sorted.length} total</div>
    </div>
    ${sorted.map(r => routineCard(r)).join("")}
  `;
}

function routineCard(r){
  const done = r.steps.filter(s=>s.done).length;
  const total = r.steps.length;
  const times = r.times?.length ? r.times.join(" • ") : "No time";
  const last = r.lastRun ? new Date(r.lastRun).toLocaleString() : "Never";

  return `
    <section class="card" data-routine-id="${r.id}">
      <div class="cardTop">
        <div>
          <h3 class="cardTitle">${escapeHtml(r.title)}</h3>
          <div class="small">🕒 ${escapeHtml(times)} · ✅ ${done}/${total} · 🗓️ ${escapeHtml(last)}</div>
        </div>
        <div class="chip">${r.active ? "Active" : "Paused"}</div>
      </div>

      <div class="hr"></div>

      <div class="list">
        ${r.steps.map(s => `
          <div class="item">
            <div class="left">
              <div class="name">${s.done ? "✅" : "⬜"} ${escapeHtml(s.text)}</div>
              <div class="meta">${s.done ? "Done" : "Pending"}</div>
            </div>
            <div class="row">
              <button class="btn ${s.done ? "ghost" : "primary"}" data-act="toggleStep" data-step-id="${s.id}">
                ${s.done ? "Undo" : "Done"}
              </button>
              <button class="btn danger" data-act="deleteStep" data-step-id="${s.id}">Del</button>
            </div>
          </div>
        `).join("")}
      </div>

      <div class="row" style="margin-top:12px;">
        <button class="btn primary" data-act="addStep">+ Step</button>
        <button class="btn good" data-act="resetRoutine">Reset</button>
        <button class="btn" data-act="editRoutine">Edit</button>
        <button class="btn" data-act="toggleRoutine">${r.active ? "Pause" : "Activate"}</button>
        <button class="btn danger" data-act="deleteRoutine">Delete</button>
      </div>
    </section>
  `;
}

function viewShopping(){
  const sub = state.shoppingSubtab || "lists";
  const histCount = (state.shoppingHistory||[]).length;

  if(sub === "dashboard"){
    return viewShoppingDashboard();
  }

  if(sub === "inventory"){
    return viewInventory();
  }

  if(sub === "ai"){
    return viewShoppingAssistant();
  }

  if(sub === "history"){
    return viewShoppingHistory();
  }

  return `
    <div class="sectionTitle">
      <div>Listas de compras</div>
      <div class="chip">${state.shopping.length} listas</div>
    </div>

    <div class="row" style="margin-bottom:12px;">
      <button class="btn" onclick="openProductLibrary()">📦 Biblioteca</button>
      <button class="btn" data-act="openInventory">🏠 Inventario</button>
      <button class="btn" data-act="openShoppingDashboard">📊 Dashboard</button>
      <button class="btn" data-act="openShoppingAi">🤖 Asistente</button>
      <button class="btn" data-act="openShoppingHistory">📅 Historial</button>
      <div class="chip">hist: ${histCount}</div>
    </div>

    ${state.shopping.map(l => shoppingCard(l)).join("")}
  `;
}



function shoppingItemMeta(it){
  const price = Number(it.price||0);
  const qty = Number(it.qty||1);
  const total = price * qty;

  if(it.weight_g){
    const g = Number(it.weight_g||0);
    const perKg = (it.pricePerKg!=null) ? Number(it.pricePerKg||0) : null;
    const perTxt = (perKg!=null && perKg>0) ? ` · ${money(perKg)}/kg` : "";
    return `${money(price)} · ${g}g${perTxt} = <b>${money(total)}</b>`;
  }

  return `${money(price)} × ${qty} = <b>${money(total)}</b>`;
}

function shoppingCard(list){
  const totalAll = list.items.reduce((acc,it)=> acc + (Number(it.price||0)*Number(it.qty||1)), 0);
  const totalPending = list.items
    .filter(it=>!it.bought)
    .reduce((acc,it)=> acc + (Number(it.price||0)*Number(it.qty||1)), 0);

  return `
    <section class="card" data-list-id="${list.id}">
      <div class="cardTop">
        <div>
          <h3 class="cardTitle">${escapeHtml(list.name)}</h3>
          <div class="small">Pending: <b>${money(totalPending)}</b> · Total: <b>${money(totalAll)}</b></div>
        </div>
        <div class="chip">${list.items.length} items</div>
      </div>

      <div class="hr"></div>

      <div class="list">
        ${list.items.map(it => `
          <div class="item">
            <div class="left">
              <div class="name">${it.bought ? "✅" : "⬜"} ${escapeHtml(it.name)}</div>
              <div class="meta">${shoppingItemMeta(it)}</div>
            </div>
            <div class="row">
              <button class="btn ${it.bought ? "ghost" : "good"}" data-act="toggleBought" data-item-id="${it.id}">${it.bought ? "Undo" : "Bought"}</button>
              <button class="btn" data-act="editItem" data-item-id="${it.id}">Edit</button>
              <button class="btn danger" data-act="deleteItem" data-item-id="${it.id}">Del</button>
            </div>
          </div>
        `).join("")}
      </div>

      <div class="row" style="margin-top:12px;">
        <button class="btn primary" data-act="addItem">+ Item</button>
        <button class="btn" data-act="renameList">Rename</button>
        <button class="btn good" data-act="savePurchase">Guardar día</button>
        <button class="btn danger" data-act="deleteList">Delete list</button>
      </div>
    </section>
  `;
}

function viewReminders(){
  const open = state.reminders.filter(r=>!r.done).length;
  return `
    <div class="sectionTitle">
      <div>Reminders</div>
      <div class="chip">${open} open</div>
    </div>
    ${state.reminders.map(r => `
      <section class="card" data-reminder-id="${r.id}">
        <div class="cardTop">
          <div>
            <h3 class="cardTitle">${r.done ? "✅" : "⬜"} ${escapeHtml(r.text)}</h3>
            <div class="small">${r.done ? "Completed" : "Pending"}</div>
          </div>
          <div class="row">
            <button class="btn ${r.done ? "ghost" : "primary"}" data-act="toggleReminder">${r.done ? "Undo" : "Done"}</button>
            <button class="btn danger" data-act="deleteReminder">Del</button>
          </div>
        </div>
      </section>
    `).join("")}
  `;
}

// ---- Calendar (big canvas + mini preview) ----
// ====================== HOUSE CLEANING (Casa) ======================
function getHouseZonesSorted(){
  normalizeHouse();
  const zones = state.house.zones.slice();
  zones.sort((a,b)=>{
    const pa = Number(a.priority)||0;
    const pb = Number(b.priority)||0;
    if(pb !== pa) return pb - pa; // higher priority first
    return (Number(a.order)||0) - (Number(b.order)||0);
  });
  return zones;
}
function getHouseZoneName(zoneId){
  if(!zoneId) return "Global";
  const z = (state.house.zones||[]).find(x=>x.id===zoneId);
  return z ? z.name : "Zona";
}


function getHouseZoneIdByName(name){
  const n = String(name||"").toLowerCase();
  const z = (state.house.zones||[]).find(x=> String(x.name||"").toLowerCase()===n);
  return z ? z.id : null;
}

function ensureZoneDetails(zoneId){
  normalizeHouse();
  if(!zoneId) return null;
  if(!state.house.details[zoneId] || typeof state.house.details[zoneId] !== "object"){
    state.house.details[zoneId] = { subzones: [], notes: "" };
  }
  const d = state.house.details[zoneId];
  if(!Array.isArray(d.subzones)) d.subzones = [];
  if(typeof d.notes !== "string") d.notes = String(d.notes||"");

  // Seed common subzones if empty
  if(d.subzones.length===0){
    const zn = getHouseZoneName(zoneId).toLowerCase();
    const seed = (names)=> names.map((nm,i)=>({id:uid('sz'), name:nm, order:i+1}));
    if(zn.includes('cocina')) d.subzones = seed(["Mesón", "Lavaplatos", "Cocina/Estufa", "Nevera", "Piso"]);
    else if(zn.includes('sala')) d.subzones = seed(["Mesa comedor", "Escritorio", "Piso", "Basura/Recoger"]);
    else if(zn.includes('pasillo')) d.subzones = seed(["Piso", "Paredes", "Puertas"]);
    else if(zn.includes('lavander')) d.subzones = seed(["Lavadora", "Tendedero", "Piso"]);
    else if(zn.includes('baño') || zn.includes('bano')){
      if(zn.includes('peque')) d.subzones = seed(["WC", "Lavamanos", "Espejo", "Piso"]);
      else d.subzones = seed(["Ducha", "WC", "Lavamanos", "Espejo", "Piso"]);
    }
    else if(zn.includes('frederick')) d.subzones = seed(["Juguetes", "Piso", "Ropa"]);
    else if(zn.includes('mathias')) d.subzones = seed(["Cama", "Closet", "Escritorio", "Piso"]);
    else if(zn.includes('principal') || zn.includes('carlos') || zn.includes('fergis')) d.subzones = seed(["Cama", "Closet", "Escritorio", "Gabetero", "Piso"]);
    else if(zn.includes('vac')) d.subzones = seed(["Landmark"]);
  }

  d.subzones.forEach((s,i)=>{ if(!s.id) s.id=uid('sz'); if(!s.name) s.name='Subzona'; if(typeof s.order!=='number') s.order=i+1; });
  d.subzones.sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
  return d;
}

function openHouseZoneSheet(zoneId){
  normalizeHouse();
  if(!zoneId) return;
  ensureZoneDetails(zoneId);
  state.house.ui.zoneSheet.open = true;
  state.house.ui.zoneSheet.zoneId = zoneId;
  if(!state.house.ui.zoneSheet.tab) state.house.ui.zoneSheet.tab = 'light';
  persist();
  view();
}

function closeHouseZoneSheet(){
  normalizeHouse();
  state.house.ui.zoneSheet.open = false;
  state.house.ui.zoneSheet.zoneId = null;
  persist();
  view();
}

function zoneProgress(zoneId, todayStr, level){
  const tasks = (state.house.tasks||[]).filter(t=>t.zoneId===zoneId && (level==='deep' ? (t.level||'light')==='deep' : (t.level||'light')!=='deep'));
  if(tasks.length===0) return {done:0,total:0,pct:0};
  const done = tasks.filter(t=>!!t.lastDone && !isTaskDue(t, todayStr)).length;
  const pct = Math.round((done/tasks.length)*100);
  return {done,total:tasks.length,pct};
}

function renderHouseZoneSheet(){
  normalizeHouse();
  const ui = state.house.ui && state.house.ui.zoneSheet;
  if(!ui || !ui.open || !ui.zoneId) return '';
  const todayStr = isoDate(new Date());
  const zid = ui.zoneId;
  const zname = getHouseZoneName(zid);
  const tab = ui.tab || 'light';
  const d = ensureZoneDetails(zid);

  const mkTab = (k,l)=>`<button class="segBtn ${tab===k?'active':''}" data-zone-tab="${escapeHtml(k)}">${escapeHtml(l)}</button>`;

  const tasks = (state.house.tasks||[]).filter(t=>t.zoneId===zid);
  const tasksForTab = tasks.filter(t=> tab==='deep' ? (t.level||'light')==='deep' : (tab==='light' ? (t.level||'light')!=='deep' : true));

  const bySub = new Map();
  (d.subzones||[]).forEach(sz=> bySub.set(sz.id, []));
  const misc = [];
  tasksForTab.forEach(t=>{
    if(t.subzoneId && bySub.has(t.subzoneId)) bySub.get(t.subzoneId).push(t);
    else misc.push(t);
  });

  const sorter = (a,b)=>{
    const ra=(Number(a.priority)||0), rb=(Number(b.priority)||0);
    if(rb!==ra) return rb-ra;
    return (a.name||'').localeCompare(b.name||'');
  };
  for(const [k,arr] of bySub){ arr.sort(sorter); }
  misc.sort(sorter);

  const progL = zoneProgress(zid, todayStr, 'light');
  const progD = zoneProgress(zid, todayStr, 'deep');
  const prog = (tab==='deep') ? progD : (tab==='light' ? progL : {done:0,total:0,pct:0});

  const renderTask = (t)=>{
    const done = !!(t.lastDone && !isTaskDue(t, todayStr));
    return `
      <div class="item">
        <label class="row" style="gap:10px;align-items:flex-start;">
          <input type="checkbox" data-zone-task-done="${escapeHtml(t.id)}" ${done?'checked':''}>
          <div style="flex:1;">
            <div style="font-weight:700;">${escapeHtml(t.name)}</div>
            <div class="muted" style="margin-top:2px;">${Number(t.minutes)||0} min • cada ${Number(t.freqDays)||0} días • pri ${Number(t.priority)||0}</div>
          </div>
          <button class="btn ghost" data-zone-edit-task="${escapeHtml(t.id)}">Edit</button>
        </label>
      </div>
    `;
  };

  const subBlocks = (d.subzones||[]).map(sz=>{
    const arr = bySub.get(sz.id) || [];
    return `
      <div class="zoneSection">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div style="font-weight:800;">${escapeHtml(sz.name)}</div>
          <button class="btn ghost" data-zone-add-task="${escapeHtml(sz.id)}">+ Tarea</button>
        </div>
        <div class="list" style="margin-top:8px;">
          ${arr.length? arr.map(renderTask).join('') : `<div class="item"><div class="muted">Sin tareas aquí (aún).</div></div>`}
        </div>
      </div>
    `;
  }).join('');

  const miscBlock = `
    <div class="zoneSection">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <div style="font-weight:800;">General</div>
        <button class="btn ghost" data-zone-add-task="">+ Tarea</button>
      </div>
      <div class="list" style="margin-top:8px;">
        ${misc.length? misc.map(renderTask).join('') : `<div class="item"><div class="muted">Nada en General.</div></div>`}
      </div>
    </div>
  `;

  const detailsTab = `
    <div class="zoneSection">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <div style="font-weight:800;">Subzonas</div>
        <button class="btn" id="btnAddSubzone">+ Subzona</button>
      </div>
      <div class="list" style="margin-top:10px;">
        ${(d.subzones||[]).map(sz=>`
          <div class="item">
            <div class="row" style="justify-content:space-between;align-items:center;gap:10px;">
              <div>
                <div style="font-weight:800;">${escapeHtml(sz.name)}</div>
                <div class="muted">order ${Number(sz.order)||0}</div>
              </div>
              <div class="row" style="gap:8px;">
                <button class="btn ghost" data-subzone-edit="${escapeHtml(sz.id)}">Edit</button>
                <button class="btn ghost" data-subzone-del="${escapeHtml(sz.id)}">Del</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="zoneSection" style="margin-top:12px;">
      <div style="font-weight:800;margin-bottom:6px;">Notas</div>
      <textarea class="input" id="zoneNotes" rows="4" placeholder="Tips, productos, reglas…">${escapeHtml(d.notes||'')}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:10px;">
        <button class="btn primary" id="btnSaveZoneNotes">Guardar</button>
      </div>
    </div>
  `;

  return `
    <div class="sideScrim show" id="zoneScrim" aria-hidden="false"></div>
    <aside class="sideSheet open" id="zoneSheet" aria-label="Zona">
      <div class="sideHead">
        <div>
          <div class="muted" style="font-weight:900;">Zona</div>
          <div class="sideTitle">${escapeHtml(zname)}</div>
        </div>
        <button class="iconBtn" id="btnZoneClose">Cerrar</button>
      </div>

      <div class="sideBody">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div class="seg" style="margin:0;">
            ${mkTab('light','Ligera')}
            ${mkTab('deep','Profunda')}
            ${mkTab('details','Detalles')}
          </div>
          ${tab!=='details' ? `<div class="pill">${prog.done}/${prog.total} • ${prog.pct}%</div>` : ``}
        </div>

        ${tab!=='details' ? `
          <div class="progress" style="margin-top:10px;"><div class="progressBar" style="width:${prog.pct}%;"></div></div>
          <div class="row" style="justify-content:space-between;align-items:center;margin-top:10px;">
            <div class="muted">Tareas por subzona</div>
            <button class="btn" id="btnAddZoneTask">+ Tarea</button>
          </div>
          ${subBlocks}
          ${miscBlock}
        ` : detailsTab}
      </div>
    </aside>
  `;
}

function daysBetween(aStr, bStr){
  // aStr, bStr = YYYY-MM-DD
  try{
    const a = new Date(aStr+"T00:00:00");
    const b = new Date(bStr+"T00:00:00");
    return Math.floor((b-a)/86400000);
  }catch(e){ return 999999; }
}
function isTaskDue(task, todayStr){
  const f = Number(task.freqDays)||0;
  if(f <= 0) return true; // if not set, always show
  const last = (task.lastDone||"").trim();
  if(!last) return true;
  return daysBetween(last, todayStr) >= f;
}
function getHouseDueTasks(todayStr){
  normalizeHouse();
  const all = state.house.tasks || [];
  const mode = state.house.mode || "light";
  return all
    .filter(t=> isTaskDue(t, todayStr))
    .filter(t=> mode==="deep" ? true : (t.level||"light")!=="deep");
}
function buildHouseRoute(todayStr){
  const due = getHouseDueTasks(todayStr);
  const mode = state.house.mode || "light";

  const overdueScore = (t)=>{
    const f = Number(t.freqDays)||0;
    const last = (t.lastDone||"").trim();
    if(!f) return 0;
    if(!last) return 999; // never done => very overdue
    const d = daysBetween(last, todayStr) - f;
    return d;
  };

  // 1) Globals first
  const globals = due.filter(t=> (t.type||"") === "global" || !t.zoneId);

  // 2) Zones in order
  const zones = getHouseZonesSorted();
  const zoneBuckets = zones.map(z=>{
    const list = due.filter(t=>t.zoneId===z.id && (t.type||"")!=="global");
    return {zone:z, tasks:list};
  }).filter(b=>b.tasks.length>0);

  // 3) Sort tasks inside zones
  // In deep mode, we float deep-clean items earlier, but still keep a sensible flow.
  const pri = mode==="deep"
    ? {deep:1, surface:2, wet:3, organize:4, misc:5, floor:6}
    : {surface:1, wet:2, organize:3, misc:4, floor:5, deep:9};
  zoneBuckets.forEach(b=>{
    b.tasks.sort((a,b2)=>{
      const pa = (pri[a.type]||9) - (pri[b2.type]||9);
      if(pa !== 0) return pa;
      const oa = overdueScore(a);
      const ob = overdueScore(b2);
      if(ob !== oa) return ob - oa;
      const ra = Number(a.priority)||0;
      const rb = Number(b2.priority)||0;
      if(rb !== ra) return rb - ra;
      return (a.name||"").localeCompare(b2.name||"");
    });
  });

  const steps = [];
  globals
    .slice()
    .sort((a,b)=>{
      const ob = overdueScore(b) - overdueScore(a);
      if(ob !== 0) return ob;
      return (Number(b.priority)||0) - (Number(a.priority)||0);
    })
    .forEach(t=>{
    steps.push({kind:"task", taskId:t.id, zoneId:null, text:t.name, minutes:Number(t.minutes)||0});
  });
  zoneBuckets.forEach(b=>{
    steps.push({kind:"zone", zoneId:b.zone.id, text:`Zona: ${b.zone.name}`});
    b.tasks.forEach(t=>{
      steps.push({kind:"task", taskId:t.id, zoneId:b.zone.id, text:t.name, minutes:Number(t.minutes)||0});
    });
  });

  // If nothing due, propose a tiny reset
  if(steps.length===0){
    steps.push({kind:"tip", text:"Hoy estás al día ✅ Si quieres, haz 5 min de reset: basura + ordenar 10 cosas."});
  }

  return steps;
}

function houseCardSummary(todayStr){
  const due = getHouseDueTasks(todayStr);
  const mins = due.reduce((s,t)=> s + (Number(t.minutes)||0), 0);
  return {count: due.length, mins};
}

// ---------------------- HOUSE MAP (Mini game) ----------------------
function ensureHouseMapLayout(){
  normalizeHouse();
  const m = state.house.map;
  if(!m.nodes) m.nodes = {};
  if(!Array.isArray(m.edges)) m.edges = [];

  const byLower = new Map((state.house.zones||[]).map(z=>[String(z.name||"").toLowerCase(), z.id]));
  const id = (nm)=> byLower.get(String(nm).toLowerCase());

  // Default positions (roughly matching your sketch). Units are px in the map container.
  const defaults = [
    ["Cocina", 30, 40],
    ["Sala", 220, 40],
    ["Lavandería", 35, 180],
    ["Baño pequeño", 145, 180],
    ["Pasillo", 170, 280],
    ["Cuarto Mathias", 45, 315],
    ["Cuarto Frederick", 240, 250],
    ["Baño grande", 55, 430],
    ["Cuarto Principal", 240, 470],
    ["Vacío (doble altura)", 240, 360],
  ];

  defaults.forEach(([name,x,y])=>{
    const zid = id(name);
    if(!zid) return;
    if(!m.nodes[zid] || typeof m.nodes[zid] !== "object") m.nodes[zid] = {x, y};
    if(typeof m.nodes[zid].x !== "number") m.nodes[zid].x = x;
    if(typeof m.nodes[zid].y !== "number") m.nodes[zid].y = y;
  });

  // Default connections (graph). Only create if empty.
  if((m.edges||[]).length === 0){
    const add = (aName, bName)=>{
      const a = id(aName), b = id(bName);
      if(!a || !b) return;
      m.edges.push({a, b});
    };
    add("Sala","Cocina");
    add("Sala","Pasillo");
    add("Cocina","Lavandería");
    add("Lavandería","Baño pequeño");
    add("Lavandería","Pasillo");
    add("Baño pequeño","Pasillo");
    add("Pasillo","Cuarto Mathias");
    add("Pasillo","Cuarto Frederick");
    add("Pasillo","Baño grande");
    add("Baño grande","Cuarto Principal");
    add("Pasillo","Cuarto Principal");
    // The void is just a landmark
    add("Vacío (doble altura)","Cuarto Frederick");
    add("Vacío (doble altura)","Baño grande");
  }

  persist();
}

function houseAdj(){
  const m = state.house.map;
  const g = new Map();
  (state.house.zones||[]).forEach(z=> g.set(z.id, []));
  (m.edges||[]).forEach(e=>{
    if(!e || !e.a || !e.b) return;
    if(!g.has(e.a)) g.set(e.a, []);
    if(!g.has(e.b)) g.set(e.b, []);
    g.get(e.a).push(e.b);
    g.get(e.b).push(e.a);
  });
  return g;
}

function houseShortestPath(start, goal){
  if(!start || !goal) return [];
  if(start === goal) return [start];
  const g = houseAdj();
  const q = [start];
  const prev = new Map();
  prev.set(start, null);
  while(q.length){
    const cur = q.shift();
    const ns = g.get(cur) || [];
    for(const nxt of ns){
      if(prev.has(nxt)) continue;
      prev.set(nxt, cur);
      if(nxt === goal){
        // reconstruct
        const path = [goal];
        let p = cur;
        while(p){ path.push(p); p = prev.get(p); }
        path.reverse();
        return path;
      }
      q.push(nxt);
    }
  }
  // If disconnected, just jump.
  return [start, goal];
}

function houseRouteZones(todayStr){
  const route = buildHouseRoute(todayStr);
  const zones = [];
  route.forEach(st=>{
    if(st.kind !== "task") return;
    const zid = st.zoneId || null;
    if(!zid) return;
    if(zones[zones.length-1] !== zid) zones.push(zid);
  });
  // Deduplicate keeping order
  const seen = new Set();
  const uniq = [];
  zones.forEach(z=>{ if(!seen.has(z)){ seen.add(z); uniq.push(z); } });
  return uniq;
}

function computeAnimPath(todayStr){
  ensureHouseMapLayout();
  const m = state.house.map;
  const seq = houseRouteZones(todayStr);
  // Start from Sala if present
  const sala = (state.house.zones||[]).find(z=>String(z.name||"").toLowerCase()==="sala");
  const start = sala ? sala.id : (seq[0] || null);
  const targets = [start, ...seq.filter(z=>z!==start)];

  const full = [];
  for(let i=0;i<targets.length-1;i++){
    const a = targets[i], b = targets[i+1];
    const p = houseShortestPath(a,b);
    if(i===0) full.push(...p);
    else full.push(...p.slice(1));
  }
  m.anim = { active:false, idx:0, path: full };
  persist();
}

function startHouseMapAnim(todayStr){
  ensureHouseMapLayout();
  const m = state.house.map;
  if(!m.anim || !Array.isArray(m.anim.path) || m.anim.path.length===0) computeAnimPath(todayStr);
  m.anim.active = true;
  m.anim.idx = 0;
  persist();

  // Stop any prior timer
  if(window.__houseMapTimer){ clearInterval(window.__houseMapTimer); window.__houseMapTimer = null; }
  window.__houseMapTimer = setInterval(()=>{
    if(!state.house?.map?.anim?.active){ clearInterval(window.__houseMapTimer); window.__houseMapTimer=null; return; }
    state.house.map.anim.idx = Math.min(state.house.map.anim.path.length-1, (Number(state.house.map.anim.idx)||0)+1);
    persist();
    view();
    if(state.house.map.anim.idx >= state.house.map.anim.path.length-1){
      state.house.map.anim.active = false;
      persist();
      clearInterval(window.__houseMapTimer);
      window.__houseMapTimer = null;
    }
  }, 650);
}

function stopHouseMapAnim(){
  if(state.house?.map?.anim){ state.house.map.anim.active = false; state.house.map.anim.idx = 0; }
  if(window.__houseMapTimer){ clearInterval(window.__houseMapTimer); window.__houseMapTimer=null; }
  persist();
}

function toggleHouseEdge(a,b){
  const m = state.house.map;
  if(!a || !b || a===b) return;
  const key = (x,y)=> (x<y) ? `${x}|${y}` : `${y}|${x}`;
  const k = key(a,b);
  const idx = (m.edges||[]).findIndex(e=> e && key(e.a,e.b)===k);
  if(idx>=0){ m.edges.splice(idx,1); }
  else { m.edges.push({a,b}); }
  persist();
}

function renderHouseMap(todayStr){
  ensureHouseMapLayout();
  const m = state.house.map;
  const nodes = m.nodes || {};
  const edges = m.edges || [];
  const anim = m.anim || {active:false, idx:0, path:[]};
  const animNow = (anim.path||[])[Number(anim.idx)||0];

  const nodeHtml = getHouseZonesSorted().map(z=>{
    const pos = nodes[z.id] || {x:20,y:20};
    const isSel = m.selected === z.id;
    const isActive = animNow === z.id;
    const cls = ["mapNode", isSel?"selected":"", isActive?"active":""].join(" ");
    return `
      <div class="${cls}" data-map-node="${escapeHtml(z.id)}" style="left:${Number(pos.x)||0}px; top:${Number(pos.y)||0}px;">
        <div class="mapNodeTitle">${escapeHtml(z.name)}</div>
        <div class="mapNodeMeta">pri ${Number(z.priority)||0}</div>
      </div>
    `;
  }).join("");

  // SVG lines
  const lineHtml = edges.map(e=>{
    const a = nodes[e.a];
    const b = nodes[e.b];
    if(!a || !b) return "";
    const x1 = (Number(a.x)||0) + 60;
    const y1 = (Number(a.y)||0) + 28;
    const x2 = (Number(b.x)||0) + 60;
    const y2 = (Number(b.y)||0) + 28;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  }).join("");

  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;font-size:18px;">Mapa (modo juego)</div>
          <div class="muted">Arrastra zonas. Activa Conectar para crear rutas. Luego anima el recorrido.</div>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap;">
          <button class="btn ${m.connectMode?"primary":""}" id="btnMapConnect">${m.connectMode?"Conectar: ON":"Conectar"}</button>
          <button class="btn ghost" id="btnMapAuto">Auto-layout</button>
          <button class="btn" id="btnMapAnim">Animar ruta</button>
          <button class="btn ghost" id="btnMapStop">Stop</button>
        </div>
      </div>

      <div class="mapWrap" id="houseMap">
        <svg class="mapSvg" id="houseMapSvg" xmlns="http://www.w3.org/2000/svg">
          ${lineHtml}
        </svg>
        ${nodeHtml}
      </div>

      <div class="muted" style="margin-top:10px;">
        Tip: en Conectar, toca 2 zonas para crear/quitar una conexión.
      </div>
    </div>
  `;
}

function redrawHouseMapSvg(root){
  const svg = root.querySelector("#houseMapSvg");
  if(!svg) return;
  const m = state.house.map;
  const nodes = m.nodes || {};
  const edges = m.edges || [];
  const lines = edges.map(e=>{
    const a = nodes[e.a];
    const b = nodes[e.b];
    if(!a || !b) return "";
    const x1 = (Number(a.x)||0) + 60;
    const y1 = (Number(a.y)||0) + 28;
    const x2 = (Number(b.x)||0) + 60;
    const y2 = (Number(b.y)||0) + 28;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  }).join("");
  svg.innerHTML = lines;
}
// -------------------- END HOUSE MAP (Mini game) -------------------

function viewHouse(){
  normalizeHouse();
  const todayStr = isoDate(new Date());
  const sub = state.house.subtab || "route";
  const mode = state.house.mode || "light";
  const sum = houseCardSummary(todayStr);

  const mkSeg = (key, label) => `
    <button class="segBtn ${sub===key?"active":""}" data-house-sub="${escapeHtml(key)}">${escapeHtml(label)}</button>
  `;

  const route = buildHouseRoute(todayStr);
  const session = state.house.session || null;
  const hasSession = session && session.active && Array.isArray(session.route);
  const prog = houseSessionProgress(todayStr);

  const totalRouteMins = route.reduce((s,st)=> s + (Number(st.minutes)||0), 0);

  return `
    <section>
      <div class="card">
        <div class="cardHead">
          <div>
            <h2>Casa</h2>
            <div class="muted">Sistema mínimo funcional. Luego lo convertimos en mini juego 🎮</div>
          </div>
          <div class="pill">${sum.count} pendientes • ~${sum.mins} min</div>
        </div>

        <div class="seg" style="margin-top:10px;">
          ${mkSeg("route","Ruta")}
          ${mkSeg("map","Mapa")}
          ${mkSeg("manage","Config")}
        </div>
      </div>

      ${sub==="route" ? `
        <div class="card">
          <div class="row" style="justify-content:space-between;align-items:flex-end;">
            <div>
              <div class="muted">Hoy (${escapeHtml(todayStr)})</div>
              <div style="font-weight:700;font-size:18px;margin-top:2px;">Ruta óptima</div>
              <div class="muted" style="margin-top:4px;">Modo: ${mode==="deep" ? "Profunda semanal" : "Ligera"} • Orden: global → zonas (prioridad + flujo)</div>
            </div>
            <div class="row">
              <button class="btn" id="btnHouseStart">${hasSession ? "Continuar" : "Iniciar"}</button>
              <button class="btn ghost" id="btnHouseHistory">Historial</button>
              <button class="btn ghost" id="btnHouseReset">Reset</button>
            </div>
          </div>

          <div class="row" style="justify-content:space-between;align-items:center;margin-top:10px;gap:10px;flex-wrap:wrap;">
            <div class="seg" style="margin:0;">
              <button class="segBtn ${mode==="light"?"active":""}" data-house-mode="light">Ligera</button>
              <button class="segBtn ${mode==="deep"?"active":""}" data-house-mode="deep">Profunda</button>
            </div>
            <div class="muted">Tiempo estimado: ~${totalRouteMins} min</div>
          </div>

          ${prog ? `
          <div style="margin-top:10px;">
            <div class="row" style="justify-content:space-between;align-items:center;">
              <div class="muted">Progreso sesión</div>
              <div class="pill">${prog.done}/${prog.total} • ${prog.pct}%</div>
            </div>
            <div class="progress" aria-label="House progress">
              <div class="progressBar" style="width:${prog.pct}%;"></div>
            </div>
          </div>` : ``}

          <div class="list" style="margin-top:12px;">
            ${route.map((st, i)=>{
              if(st.kind==="zone"){
                return `<div class="item"><div class="tag">${escapeHtml(st.text)}</div></div>`;
              }
              if(st.kind==="tip"){
                return `<div class="item"><div class="muted">${escapeHtml(st.text)}</div></div>`;
              }
              // task
              const t = (state.house.tasks||[]).find(x=>x.id===st.taskId) || {};
              const done = !!(t.lastDone && !isTaskDue(t, todayStr));
              return `
                <div class="item">
                  <label class="row" style="gap:10px;align-items:flex-start;">
                    <input type="checkbox" data-house-done="${escapeHtml(st.taskId)}" ${done ? "checked":""}>
                    <div style="flex:1;">
                      <div style="font-weight:650;">${escapeHtml(st.text)}</div>
                      <div class="muted" style="margin-top:2px;">${escapeHtml(getHouseZoneName(st.zoneId))} • ${Number(st.minutes)||0} min • cada ${Number(t.freqDays)||0} días • ${escapeHtml((t.level||"light")==="deep"?"profunda":"ligera")} • pri ${Number(t.priority)||0}</div>
                    </div>
                    <button class="btn ghost" data-house-edit-task="${escapeHtml(st.taskId)}">Edit</button>
                  </label>
                </div>
              `;
            }).join("")}
          </div>

          ${hasSession ? `
          <div class="card" style="margin-top:14px;">
            ${renderHouseSession()}
          </div>` : ``}
        </div>
      ` : (sub==="map" ? `
        ${renderHouseMap(todayStr)}
      ` : `
        <div class="card">
          <div class="row" style="justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:700;font-size:18px;">Zonas</div>
              <div class="muted">Define tu mapa lógico (luego lo dibujamos)</div>
            </div>
            <button class="btn" id="btnAddZone">+ Zona</button>
          </div>

          <div class="list" style="margin-top:12px;">
            ${getHouseZonesSorted().map(z=>`
              <div class="item">
                <div style="flex:1;">
                  <div style="font-weight:650;">${escapeHtml(z.name)}</div>
                  <div class="muted">Orden: ${Number(z.order)||0} • Priority: ${Number(z.priority)||0}</div>
                </div>
                <button class="btn ghost" data-house-edit-zone="${escapeHtml(z.id)}">Edit</button>
                <button class="btn ghost" data-house-del-zone="${escapeHtml(z.id)}">Del</button>
              </div>
            `).join("")}
            ${getHouseZonesSorted().length===0 ? `<div class="item"><div class="muted">Crea tu primera zona.</div></div>` : ``}
          </div>

          <div class="divider" style="margin:14px 0;"></div>

          <div class="row" style="justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:700;font-size:18px;">Tareas</div>
              <div class="muted">Frecuencia + minutos. Eso es todo.</div>
            </div>
            <button class="btn" id="btnAddTask">+ Tarea</button>
          </div>

          <div class="list" style="margin-top:12px;">
            ${renderHouseTasksList()}
          </div>
        </div>
      `)}
    </section>
  `;
}

function renderHouseTasksList(){
  const zones = getHouseZonesSorted();
  const tasks = state.house.tasks || [];

  const group = (title, items) => `
    <div class="item"><div class="tag">${escapeHtml(title)}</div></div>
    ${items.map(t=>`
      <div class="item">
        <div style="flex:1;">
          <div style="font-weight:650;">${escapeHtml(t.name)}</div>
          <div class="muted">${escapeHtml(getHouseZoneName(t.zoneId))} • ${Number(t.minutes)||0} min • cada ${Number(t.freqDays)||0} días • ${escapeHtml((t.level||"light")==="deep"?"profunda":"ligera")} • pri ${Number(t.priority)||0}</div>
        </div>
        <button class="btn ghost" data-house-edit-task="${escapeHtml(t.id)}">Edit</button>
        <button class="btn ghost" data-house-del-task="${escapeHtml(t.id)}">Del</button>
      </div>
    `).join("")}
  `;

  const globals = tasks.filter(t=> (t.type||"")==="global" || !t.zoneId);
  let html = "";
  if(globals.length) html += group("Global", globals);

  zones.forEach(z=>{
    const items = tasks.filter(t=>t.zoneId===z.id && (t.type||"")!=="global");
    if(items.length) html += group(z.name, items);
  });

  if(!html){
    html = `<div class="item"><div class="muted">Agrega tareas para empezar.</div></div>`;
  }
  return html;
}

function startHouseSession(){
  const todayStr = isoDate(new Date());
  const route = buildHouseRoute(todayStr);
  state.house.session = {
    active: true,
    date: todayStr,
    idx: 0,
    route
  };
  persist();
  view();
}
function resetHouseSession(){
  if(state.house.session){
    state.house.session.active = false;
    persist();
    view();
  }
}


// ====================== HOUSE SESSION RUNNER MODAL (v7.10) ======================
let houseSessionRunnerInterval = null;

function openHouseSessionRunnerModal(){
  const s = state.house.session;
  if(!s || !s.active) return;

  // mark runner open
  s.runner = s.runner || {};
  s.runner.open = true;
  persist();

  const host = document.querySelector("#app");
  // remove existing
  const old = document.querySelector("#houseSessionRunnerBackdrop");
  if(old) old.remove();

  const b = document.createElement("div");
  b.className = "modalBackdrop";
  b.id = "houseSessionRunnerBackdrop";
  b.style.alignItems = "center"; // center modal
  b.innerHTML = `
    <div class="modal houseRunner">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:800;font-size:16px;">Ruta Casa</div>
          <div class="muted" id="houseRunnerSub"></div>
        </div>
        <button class="btn ghost" data-hr="close">Cerrar</button>
      </div>

      <div class="houseRunnerStage" id="houseRunnerStage" style="margin-top:12px;"></div>

      <div class="houseRunnerFooter" style="margin-top:14px;">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div class="muted" id="houseRunnerProgress"></div>
          <div class="row" style="gap:8px;">
            <button class="btn ghost" data-hr="history">Histórico</button>
            <button class="btn ghost" data-hr="end">Terminar</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(b);

  // close behavior
  b.addEventListener("click", (e)=>{
    if(e.target === b) closeHouseSessionRunnerModal();
  });
  b.querySelector('[data-hr="close"]').addEventListener("click", closeHouseSessionRunnerModal);
  b.querySelector('[data-hr="end"]').addEventListener("click", ()=>{
    finishHouseSession("manual_end");
    closeHouseSessionRunnerModal(true);
    toast("Sesión terminada ✅");
    view();
  });
  b.querySelector('[data-hr="history"]').addEventListener("click", ()=>{
    openHouseSessionHistoryModal();
  });

  // animate in (optional)
  if(window.anime){
    anime({
      targets: ".modal.houseRunner",
      translateY: [18, 0],
      opacity: [0, 1],
      duration: 280,
      easing: "easeOutQuad"
    });
  }

  renderHouseRunnerStage();
  startHouseRunnerTick();
}

function closeHouseSessionRunnerModal(skipPersist=false){
  const b = document.querySelector("#houseSessionRunnerBackdrop");
  if(!b) return;

  const s = state.house.session;
  if(s && s.runner) s.runner.open = false;
  if(!skipPersist) persist();

  stopHouseRunnerTick();

  if(window.anime){
    anime({
      targets: ".modal.houseRunner",
      translateY: [0, 18],
      opacity: [1, 0],
      duration: 220,
      easing: "easeInQuad",
      complete: ()=> b.remove()
    });
  }else{
    b.remove();
  }
}

function stopHouseRunnerTick(){
  if(houseSessionRunnerInterval){
    clearInterval(houseSessionRunnerInterval);
    houseSessionRunnerInterval = null;
  }
}

function startHouseRunnerTick(){
  stopHouseRunnerTick();
  houseSessionRunnerInterval = setInterval(()=>{
    const s = state.house.session;
    if(!s || !s.active) { stopHouseRunnerTick(); return; }
    if(!s.runner || !s.runner.open) return;

    // Only tick if current is task
    const cur = s.route?.[s.idx];
    if(!cur || cur.kind !== "task") return;

    const now = Date.now();
    const startAt = Number(s.runner.stepStartAt||0);
    if(!startAt) return;
    const elapsed = Math.max(0, Math.floor((now - startAt)/1000));
    const planned = Number(s.runner.plannedSec||0);
    const extra = Number(s.runner.extraSec||0);
    const total = planned + extra;
    const left = Math.max(0, total - elapsed);

    // update UI
    const el = document.querySelector("#houseRunnerCountdown");
    if(el) el.textContent = fmtMMSS(left);
    const bar = document.querySelector("#houseRunnerBar");
    if(bar && total>0){
      const pct = Math.max(0, Math.min(100, Math.round((elapsed/total)*100)));
      bar.style.width = pct + "%";
    }

    // auto-advance when time is done
    if(total>0 && left<=0){
      houseSessionAdvance({reason:"timer_end", markDone:false});
    }
  }, 250);
}

function fmtMMSS(sec){
  sec = Math.max(0, Number(sec)||0);
  const m = Math.floor(sec/60);
  const s = sec%60;
  return `${m}:${String(s).padStart(2,"0")}`;
}

function ensureRunnerForCurrent(){
  const s = state.house.session;
  if(!s || !s.active) return;
  s.runner = s.runner || {};
  const cur = s.route?.[s.idx];

  // Update subtitle/progress
  const taskSteps = (s.route||[]).filter(x=>x.kind==="task");
  const doneCount = taskSteps.filter(st=>{
    const t = (state.house.tasks||[]).find(x=>x.id===st.taskId);
    return (t?.lastDone||"") === s.date;
  }).length;

  const sub = document.querySelector("#houseRunnerSub");
  if(sub) sub.textContent = `${s.date} • ${state.house.mode||"light"}`;

  const prog = document.querySelector("#houseRunnerProgress");
  if(prog) prog.textContent = `${doneCount}/${taskSteps.length} hechas • Paso ${s.idx+1}/${(s.route||[]).length}`;

  // If current step is a task, init timer if changed
  if(cur && cur.kind==="task"){
    const taskId = cur.taskId;
    if(s.runner.taskId !== taskId || s.runner.stepIdx !== s.idx){
      s.runner.taskId = taskId;
      s.runner.stepIdx = s.idx;
      s.runner.plannedSec = Math.max(0, (Number(cur.minutes)||0) * 60);
      s.runner.extraSec = 0;
      s.runner.stepStartAt = Date.now();
      persist();
      // cute loading transition
      if(window.anime){
        const stage = document.querySelector("#houseRunnerStage");
        if(stage){
          anime({
            targets: stage,
            opacity: [1, 0],
            duration: 120,
            easing: "easeInQuad",
            complete: ()=>{
              renderHouseRunnerStage(true);
              anime({targets: stage, opacity:[0,1], duration:160, easing:"easeOutQuad"});
            }
          });
          return;
        }
      }
    }
  }
}

function houseSessionAdvance({reason, markDone}){
  const s = state.house.session;
  if(!s || !s.active) return;
  const cur = s.route?.[s.idx];

  // finalize current task timing (if task)
  if(cur && cur.kind==="task"){
    const now = Date.now();
    const startAt = Number(s.runner?.stepStartAt||0);
    const elapsedSec = startAt ? Math.max(1, Math.floor((now-startAt)/1000)) : 0;
    const entry = {
      at: new Date().toISOString(),
      date: s.date,
      stepIdx: s.idx,
      taskId: cur.taskId,
      zoneId: cur.zoneId||null,
      plannedSec: Number(s.runner?.plannedSec||0),
      extraSec: Number(s.runner?.extraSec||0),
      actualSec: elapsedSec,
      reason: reason || "advance",
      done: !!markDone
    };
    s.logs = Array.isArray(s.logs) ? s.logs : [];
    s.logs.push(entry);

    if(markDone){
      markHouseTaskDone(cur.taskId, s.date);
    }
  }

  // advance to next
  s.idx = Math.min((s.route||[]).length, (Number(s.idx)||0) + 1);

  if(s.idx >= (s.route||[]).length){
    finishHouseSession("completed");
    toast("Ruta completada ✅");
    closeHouseSessionRunnerModal(true);
    view();
    return;
  }

  persist();
  renderHouseRunnerStage();
}

function finishHouseSession(status){
  const s = state.house.session;
  if(!s || !s.active) return;

  const logs = Array.isArray(s.logs) ? s.logs : [];
  const totalSec = logs.reduce((a,x)=>a + (Number(x.actualSec)||0), 0);

  state.house.sessionHistory = Array.isArray(state.house.sessionHistory) ? state.house.sessionHistory : [];
  state.house.sessionHistory.unshift({
    id: "hs_" + Math.random().toString(16).slice(2) + "_" + Date.now(),
    date: s.date,
    status: status || "ended",
    totalSec,
    logs
  });
  // cap history
  state.house.sessionHistory = state.house.sessionHistory.slice(0, 60);

  s.active = false;
  if(s.runner) s.runner.open = false;

  persist();
}

function renderHouseRunnerStage(force=false){
  const s = state.house.session;
  if(!s || !s.active) return;

  const stage = document.querySelector("#houseRunnerStage");
  if(!stage) return;

  ensureRunnerForCurrent();

  const cur = s.route?.[s.idx];
  if(!cur){
    stage.innerHTML = `<div class="muted">Sin pasos.</div>`;
    return;
  }

  if(cur.kind === "zone"){
    stage.innerHTML = `
      <div class="houseRunnerCard">
        <div class="tag">${escapeHtml(cur.text)}</div>
        <div class="muted" style="margin-top:8px;">Entrando a zona</div>
        <div class="row" style="justify-content:flex-end;margin-top:12px;">
          <button class="btn" data-hr="next">Continuar</button>
        </div>
      </div>
    `;
    stage.querySelector('[data-hr="next"]').addEventListener("click", ()=> houseSessionAdvance({reason:"zone_next", markDone:false}));
    return;
  }

  if(cur.kind === "tip"){
    stage.innerHTML = `
      <div class="houseRunnerCard">
        <div class="muted">${escapeHtml(cur.text)}</div>
        <div class="row" style="justify-content:flex-end;margin-top:12px;">
          <button class="btn" data-hr="next">Ok</button>
        </div>
      </div>
    `;
    stage.querySelector('[data-hr="next"]').addEventListener("click", ()=> houseSessionAdvance({reason:"tip_next", markDone:false}));
    return;
  }

  // task card
  const plannedSec = Number(s.runner?.plannedSec||0);
  const extraSec = Number(s.runner?.extraSec||0);
  const total = plannedSec + extraSec;
  stage.innerHTML = `
    <div class="houseRunnerCard">
      <div style="font-weight:850;font-size:18px;line-height:1.2;">${escapeHtml(cur.text)}</div>
      <div class="muted" style="margin-top:6px;">${escapeHtml(getHouseZoneName(cur.zoneId))} • ${Number(cur.minutes)||0} min</div>

      <div class="houseRunnerTimer" style="margin-top:12px;">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div class="muted">Tiempo</div>
          <div style="font-weight:850;font-size:18px;" id="houseRunnerCountdown">${fmtMMSS(total)}</div>
        </div>
        <div class="progress" style="margin-top:10px;">
          <div class="progressBar" id="houseRunnerBar" style="width:0%;"></div>
        </div>
        <div class="row" style="gap:10px;margin-top:10px;flex-wrap:wrap;">
          <button class="btn ghost" data-hr="extend">Extender +5m</button>
          <button class="btn ghost" data-hr="skip">Saltar</button>
          <button class="btn ghost" data-hr="edit">Editar</button>
        </div>
      </div>

      <div class="row" style="gap:10px;margin-top:14px;">
        <button class="btn" data-hr="done">Listo ✅</button>
        <button class="btn ghost" data-hr="next">Siguiente</button>
      </div>
    </div>
  `;

  stage.querySelector('[data-hr="extend"]').addEventListener("click", ()=>{
    s.runner.extraSec = Number(s.runner.extraSec||0) + 300;
    persist();
    renderHouseRunnerStage();
    toast("Extendido +5 min ⏳");
  });
  stage.querySelector('[data-hr="skip"]').addEventListener("click", ()=>{
    houseSessionAdvance({reason:"skipped", markDone:false});
  });
  stage.querySelector('[data-hr="edit"]').addEventListener("click", ()=>{
    closeHouseSessionRunnerModal(true);
    openHouseTaskModal(cur.taskId);
  });
  stage.querySelector('[data-hr="done"]').addEventListener("click", ()=>{
    houseSessionAdvance({reason:"manual_done", markDone:true});
  });
  stage.querySelector('[data-hr="next"]').addEventListener("click", ()=>{
    houseSessionAdvance({reason:"manual_next", markDone:false});
  });
}

function openHouseSessionHistoryModal(){
  const list = Array.isArray(state.house.sessionHistory) ? state.house.sessionHistory : [];
  const host = document.querySelector("#app");
  const b = document.createElement("div");
  b.className = "modalBackdrop";
  b.id = "houseSessionHistoryBackdrop";
  b.style.alignItems = "center";
  const rows = list.slice(0, 20).map(s=>{
    const min = Math.round((Number(s.totalSec||0)/60));
    const status = s.status || "ended";
    return `<div class="row" style="justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);">
      <div>
        <div style="font-weight:750;">${escapeHtml(s.date)}</div>
        <div class="muted">${escapeHtml(status)} • ${min} min • ${Array.isArray(s.logs)?s.logs.length:0} pasos</div>
      </div>
    </div>`;
  }).join("") || `<div class="muted" style="padding:10px 0;">Aún no hay sesiones.</div>`;

  b.innerHTML = `
    <div class="modal houseRunner">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:800;font-size:16px;">Histórico Casa</div>
          <div class="muted">Tus últimas sesiones</div>
        </div>
        <button class="btn ghost" data-hh="close">Cerrar</button>
      </div>
      <div style="margin-top:12px;max-height:60vh;overflow:auto;">
        ${rows}
      </div>
    </div>
  `;
  document.body.appendChild(b);
  b.addEventListener("click",(e)=>{ if(e.target===b) b.remove(); });
  b.querySelector('[data-hh="close"]').addEventListener("click", ()=> b.remove());

  if(window.anime){
    anime({targets: ".modal.houseRunner", translateY:[18,0], opacity:[0,1], duration:260, easing:"easeOutQuad"});
  }
}

function houseSessionProgress(todayStr){
  const s = state.house.session;
  if(!s || !s.active || !Array.isArray(s.route)) return null;
  const taskSteps = s.route.filter(x=>x.kind==="task");
  const total = taskSteps.length;
  let done = 0;
  taskSteps.forEach(st=>{
    const t = (state.house.tasks||[]).find(x=>x.id===st.taskId);
    if(t && !isTaskDue(t, todayStr)) done += 1;
  });
  const pct = total ? Math.round((done/total)*100) : 0;
  return {done, total, pct};
}

function renderHouseSession(){
  const s = state.house.session;
  if(!s || !s.active) return "";
  const route = s.route || [];
  const idx = Math.min(Math.max(0, Number(s.idx)||0), Math.max(0, route.length-1));
  const current = route[idx] || {};
  const doneCount = route.filter(st=>{
    if(st.kind!=="task") return false;
    const t = (state.house.tasks||[]).find(x=>x.id===st.taskId) || {};
    return !!t.lastDone && !isTaskDue(t, s.date);
  }).length;
  const taskCount = route.filter(st=>st.kind==="task").length;
  const pct = taskCount ? Math.round((doneCount/taskCount)*100) : 0;

  return `
    <div class="row" style="justify-content:space-between;align-items:center;">
      <div>
        <div style="font-weight:700;">Mini sesión</div>
        <div class="muted">${doneCount}/${taskCount} • ${pct}%</div>
      </div>
      <button class="btn ghost" id="btnHouseEnd">Terminar</button>
    </div>
    <div class="progress" style="margin-top:10px;">
      <div class="progressBar" style="width:${pct}%;"></div>
    </div>

    <div style="margin-top:12px;">
      ${current.kind==="zone" ? `<div class="tag">${escapeHtml(current.text)}</div>` : ``}
      ${current.kind==="tip" ? `<div class="muted">${escapeHtml(current.text)}</div>` : ``}
      ${current.kind==="task" ? `
        <div style="font-weight:750;font-size:18px;">${escapeHtml(current.text)}</div>
        <div class="muted" style="margin-top:4px;">${escapeHtml(getHouseZoneName(current.zoneId))} • ${Number(current.minutes)||0} min</div>
        <div class="row" style="gap:10px;margin-top:10px;">
          <button class="btn" data-house-session-done="${escapeHtml(current.taskId)}">Marcar hecho</button>
          <button class="btn ghost" data-house-edit-task="${escapeHtml(current.taskId)}">Edit</button>
        </div>
      ` : ``}
    </div>

    <div class="row" style="justify-content:space-between;margin-top:12px;">
      <button class="btn ghost" id="btnHousePrev">Prev</button>
      <div class="muted">${idx+1}/${route.length}</div>
      <button class="btn" id="btnHouseNext">Next</button>
    </div>
  `;
}

function openHouseZoneModal(editId=null){
  normalizeHouse();
  const z = editId ? (state.house.zones||[]).find(x=>x.id===editId) : null;
  openPromptModal({
    title: z ? "Edit zone" : "New zone",
    fields:[
      {key:"name", label:"Name", placeholder:"Ej: Cocina", value: z?.name || ""},
      {key:"order", label:"Order (1..)", type:"number", placeholder:"1", value: (z?.order ?? (getHouseZonesSorted().length+1))},
      {key:"priority", label:"Priority (1..5)", type:"number", placeholder:"3", value: (z?.priority ?? 3)}
    ],
    onSubmit: ({name, order, priority})=>{
      const n = (name||"").trim();
      const o = Number(order)||0;
      const p = Math.min(5, Math.max(1, Number(priority)||3));
      if(!n){ toast("Pon un nombre"); return; }
      if(z){
        z.name = n;
        z.order = o || z.order || 0;
        z.priority = p;
      }else{
        state.house.zones.push({ id: uid("z"), name:n, order:o || (state.house.zones.length+1), priority:p });
      }
      persist(); view(); toast("Zona guardada ✅");
    }
  });
}

function openHouseTaskModal(editId=null, defaults=null){
  normalizeHouse();
  const t = editId ? (state.house.tasks||[]).find(x=>x.id===editId) : null;

  const zones = getHouseZonesSorted();
  const host = document.querySelector("#app");
  const b = document.createElement("div");
  b.className = "modalBackdrop";

  const zoneOptions = [
    `<option value="">Global</option>`,
    ...zones.map(z=>`<option value="${escapeHtml(z.id)}">${escapeHtml(z.name)}</option>`)
  ].join("");

  const typeOptions = [
    ["global","Global"],
    ["surface","Superficies"],
    ["wet","Húmedo"],
    ["floor","Piso"],
    ["organize","Organizar"],
    ["deep","Deep"],
    ["misc","Misc"]
  ].map(([v,l])=>`<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join("");

  b.innerHTML = `
    <div class="modal">
      <h2>${escapeHtml(t ? "Edit task" : "New task")}</h2>

      <div class="grid">
        <div>
          <div class="muted" style="margin:2px 0 6px;">Nombre</div>
          <input class="input" id="htName" value="${escapeHtml(t?.name||"")}" placeholder="Ej: Barrer piso">
        </div>
        <div>
          <div class="muted" style="margin:2px 0 6px;">Zona</div>
          <select class="input" id="htZone">${zoneOptions}</select>
        </div>
        <div>
          <div class="muted" style="margin:2px 0 6px;">Detalle</div>
          <select class="input" id="htSub"></select>
        </div>
        <div>
          <div class="muted" style="margin:2px 0 6px;">Tipo</div>
          <select class="input" id="htType">${typeOptions}</select>
        </div>
        <div>
          <div class="muted" style="margin:2px 0 6px;">Minutos</div>
          <input class="input" id="htMin" type="number" value="${escapeHtml(String(t?.minutes ?? 5))}">
        </div>
        <div>
          <div class="muted" style="margin:2px 0 6px;">Frecuencia (días)</div>
          <input class="input" id="htFreq" type="number" value="${escapeHtml(String(t?.freqDays ?? 7))}">
        </div>
        <div>
          <div class="muted" style="margin:2px 0 6px;">Nivel</div>
          <select class="input" id="htLevel">
            <option value="light">Ligera</option>
            <option value="deep">Profunda</option>
          </select>
        </div>
        <div>
          <div class="muted" style="margin:2px 0 6px;">Priority (1..5)</div>
          <input class="input" id="htPri" type="number" value="${escapeHtml(String(t?.priority ?? 3))}">
        </div>
      </div>

      <div class="row" style="margin-top:12px;">
        <button class="btn ghost" data-m="cancel">Cancel</button>
        <button class="btn primary" data-m="save">Save</button>
      </div>
      <div class="muted" style="margin-top:10px;">Tip: si freq=1, sale diario.</div>
    </div>
  `;
  host.appendChild(b);

  const close = ()=> b.remove();
  b.addEventListener("click",(e)=>{ if(e.target===b) close(); });

  const zoneSel = b.querySelector("#htZone");
  const typeSel = b.querySelector("#htType");
  const lvlSel = b.querySelector("#htLevel");
  const subSel = b.querySelector("#htSub");
  // preselect zone/subzone
  const preZone = t?.zoneId || (defaults && defaults.zoneId) || "";
  zoneSel.value = preZone;

  const fillSubzones = ()=>{
    const zid = (zoneSel.value||'').trim();
    if(!zid){
      subSel.innerHTML = `<option value="">(sin detalle)</option>`;
      subSel.value = '';
      return;
    }
    ensureZoneDetails(zid);
    const d = state.house.details[zid];
    const opts = [`<option value="">(General)</option>`, ...(d.subzones||[]).map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`)].join('');
    subSel.innerHTML = opts;
    const preSub = t?.subzoneId || (defaults && defaults.subzoneId) || '';
    subSel.value = preSub || '';
  };
  fillSubzones();
  zoneSel.addEventListener('change', ()=>{ fillSubzones(); });

  typeSel.value = t?.type || (t?.zoneId ? "surface" : "global");
  lvlSel.value = t?.level || ((t?.type||"")==="deep" ? "deep" : "light");
  b.querySelector("#htPri").value = String(t?.priority ?? 3);

  b.querySelector('[data-m="cancel"]').addEventListener("click", close);
  b.querySelector('[data-m="save"]').addEventListener("click", ()=>{
    const name = (b.querySelector("#htName").value||"").trim();
    const zoneId = (zoneSel.value||"").trim() || null;
    const subzoneId = (subSel.value||"").trim() || null;
    const type = (typeSel.value||"").trim() || "misc";
    const minutes = Number((b.querySelector("#htMin").value||"").trim()) || 0;
    const freqDays = Number((b.querySelector("#htFreq").value||"").trim()) || 0;
    const level = (lvlSel.value||"light").trim() || "light";
    const priority = Math.min(5, Math.max(1, Number((b.querySelector("#htPri").value||"").trim()) || 3));

    if(!name){ toast("Pon un nombre"); return; }
    if(minutes<0 || freqDays<0){ toast("Valores inválidos"); return; }

    // If type=global, force zoneId null
    const finalZoneId = (type==="global") ? null : zoneId;
    const finalSubzoneId = finalZoneId ? subzoneId : null;
    const finalLevel = (type==="deep") ? "deep" : level;

    if(t){
      t.name = name; t.zoneId = finalZoneId; t.subzoneId = finalSubzoneId; t.type = type; t.minutes = minutes; t.freqDays = freqDays;
      t.level = finalLevel; t.priority = priority;
    }else{
      state.house.tasks.push({ id: uid("t"), name, zoneId: finalZoneId, subzoneId: finalSubzoneId, type, minutes, freqDays, level: finalLevel, priority, lastDone:"" });
    }
    persist(); view(); toast("Tarea guardada ✅");
    close();
  });
}

function markHouseTaskDone(taskId, dateStr){
  const t = (state.house.tasks||[]).find(x=>x.id===taskId);
  if(!t) return;
  t.lastDone = dateStr;
  persist();
}

function deleteHouseZone(zoneId){
  const z = (state.house.zones||[]).find(x=>x.id===zoneId);
  if(!z) return;
  const tasks = (state.house.tasks||[]).filter(t=>t.zoneId===zoneId);
  if(tasks.length){
    const ok = confirm(`Esta zona tiene ${tasks.length} tareas. ¿Borrar todo?`);
    if(!ok) return;
    state.house.tasks = (state.house.tasks||[]).filter(t=>t.zoneId!==zoneId);
  }
  state.house.zones = (state.house.zones||[]).filter(x=>x.id!==zoneId);
  persist(); view(); toast("Zona borrada 🧹");
}

function deleteHouseTask(taskId){
  state.house.tasks = (state.house.tasks||[]).filter(t=>t.id!==taskId);
  persist(); view(); toast("Tarea borrada 🧼");
}

function wireHouse(root){
  normalizeHouse();

  // mode switch (light vs deep)
  root.querySelectorAll("[data-house-mode]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const m = btn.getAttribute("data-house-mode") || "light";
      state.house.mode = (m==="deep") ? "deep" : "light";
      // Changing mode changes the route, so end any active session
      if(state.house.session && state.house.session.active){
        state.house.session.active = false;
      }
      persist();
      view();
    });
  });

  // subtab switch
  root.querySelectorAll("[data-house-sub]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      state.house.subtab = btn.getAttribute("data-house-sub") || "route";
      persist();
      view();
    });
  });

  // route actions
  const startBtn = root.querySelector("#btnHouseStart");
  if(startBtn) startBtn.addEventListener("click", ()=>{
    const s = state.house.session;
    if(!s || !s.active){
      startHouseSession();
    }
    openHouseSessionRunnerModal();
  });
  const resetBtn = root.querySelector("#btnHouseReset");
  if(resetBtn) resetBtn.addEventListener("click", ()=> resetHouseSession());

  // session controls
  const endBtn = root.querySelector("#btnHouseEnd");
  if(endBtn) endBtn.addEventListener("click", ()=> resetHouseSession());
  const prevBtn = root.querySelector("#btnHousePrev");
  if(prevBtn) prevBtn.addEventListener("click", ()=>{
    const s = state.house.session; if(!s||!s.active) return;
    s.idx = Math.max(0, (Number(s.idx)||0)-1); persist(); view();
  });
  const nextBtn = root.querySelector("#btnHouseNext");
  if(nextBtn) nextBtn.addEventListener("click", ()=>{
    const s = state.house.session; if(!s||!s.active) return;
    s.idx = Math.min((s.route||[]).length-1, (Number(s.idx)||0)+1); persist(); view();
  });

  root.querySelectorAll("[data-house-session-done]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const taskId = btn.getAttribute("data-house-session-done");
      const s = state.house.session;
      const dateStr = (s && s.date) ? s.date : isoDate(new Date());
      markHouseTaskDone(taskId, dateStr);
      // move next
      if(s && s.active){
        s.idx = Math.min((s.route||[]).length-1, (Number(s.idx)||0)+1);
        persist();
      }
      view();
      toast("Hecho ✅");
    });
  });

  // mark done checkboxes (route list)
  root.querySelectorAll("[data-house-done]").forEach(cb=>{
    cb.addEventListener("change", ()=>{
      const taskId = cb.getAttribute("data-house-done");
      const todayStr = isoDate(new Date());
      if(cb.checked){
        markHouseTaskDone(taskId, todayStr);
        toast("Hecho ✅");
      }else{
        const t = (state.house.tasks||[]).find(x=>x.id===taskId);
        if(t){ t.lastDone = ""; persist(); }
        toast("Reabierto");
      }
      view();
    });
  });

  // manage actions
  const btnAddZone = root.querySelector("#btnAddZone");
  if(btnAddZone) btnAddZone.addEventListener("click", ()=> openHouseZoneModal());
  const btnAddTask = root.querySelector("#btnAddTask");
  if(btnAddTask) btnAddTask.addEventListener("click", ()=> openHouseTaskModal());

  root.querySelectorAll("[data-house-edit-zone]").forEach(btn=>{
    btn.addEventListener("click", ()=> openHouseZoneModal(btn.getAttribute("data-house-edit-zone")));
  });
  root.querySelectorAll("[data-house-del-zone]").forEach(btn=>{
    btn.addEventListener("click", ()=> deleteHouseZone(btn.getAttribute("data-house-del-zone")));
  });

  root.querySelectorAll("[data-house-edit-task]").forEach(btn=>{
    btn.addEventListener("click", ()=> openHouseTaskModal(btn.getAttribute("data-house-edit-task")));
  });
  root.querySelectorAll("[data-house-del-task]").forEach(btn=>{
    btn.addEventListener("click", ()=> deleteHouseTask(btn.getAttribute("data-house-del-task")));
  });

  // ---------------- Map (mini game) wiring ----------------
  const btnConnect = root.querySelector("#btnMapConnect");
  if(btnConnect) btnConnect.addEventListener("click", ()=>{
    state.house.map.connectMode = !state.house.map.connectMode;
    state.house.map.selected = null;
    persist();
    view();
  });
  const btnAuto = root.querySelector("#btnMapAuto");
  if(btnAuto) btnAuto.addEventListener("click", ()=>{
    // Reset positions to defaults and keep edges
    state.house.map.nodes = {};
    ensureHouseMapLayout();
    toast("Auto layout ✅");
    view();
  });
  const btnAnim = root.querySelector("#btnMapAnim");
  if(btnAnim) btnAnim.addEventListener("click", ()=>{
    const todayStr = isoDate(new Date());
    computeAnimPath(todayStr);
    startHouseMapAnim(todayStr);
    toast("Animando ruta 🎮");
  });
  const btnStop = root.querySelector("#btnMapStop");
  if(btnStop) btnStop.addEventListener("click", ()=>{
    stopHouseMapAnim();
    view();
  });

  // Node interactions
  const mapWrap = root.querySelector("#houseMap");
  if(mapWrap){
    redrawHouseMapSvg(root);
    root.querySelectorAll("[data-map-node]").forEach(node=>{
      const zoneId = node.getAttribute("data-map-node");

      // Click = select/connect
      node.addEventListener("click", (ev)=>{
        ev.stopPropagation();
        if(state.house.map.connectMode){
          const sel = state.house.map.selected;
          if(!sel){
            state.house.map.selected = zoneId;
            persist();
            view();
            return;
          }
          if(sel === zoneId){
            state.house.map.selected = null;
            persist();
            view();
            return;
          }
          toggleHouseEdge(sel, zoneId);
          state.house.map.selected = null;
          persist();
          view();
          toast("Conexión actualizada");
          return;
        }
        state.house.map.selected = zoneId;
        persist();
        openHouseZoneSheet(zoneId);
      });

      // Drag
      node.addEventListener("pointerdown", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        node.setPointerCapture?.(ev.pointerId);
        const startX = ev.clientX;
        const startY = ev.clientY;
        const pos = state.house.map.nodes[zoneId] || {x:0,y:0};
        const ox = Number(pos.x)||0;
        const oy = Number(pos.y)||0;

        const onMove = (e)=>{
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          const nx = Math.max(0, ox + dx);
          const ny = Math.max(0, oy + dy);
          state.house.map.nodes[zoneId] = {x:nx, y:ny};
          node.style.left = nx + "px";
          node.style.top = ny + "px";
          redrawHouseMapSvg(root);
        };
        const onUp = ()=>{
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          persist();
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
    });

    // Click on empty map clears selection
    mapWrap.addEventListener("click", ()=>{
      if(state.house.map.connectMode) return;
      state.house.map.selected = null;
      persist();
      view();
    });
  }
}
// ====================== END HOUSE CLEANING ======================



function wireHouseZoneSheet(root){
  normalizeHouse();
  const scrim = root.querySelector('#zoneScrim');
  const sheet = root.querySelector('#zoneSheet');
  if(!scrim || !sheet) return;

  const closeBtn = root.querySelector('#btnZoneClose');
  const close = ()=> closeHouseZoneSheet();

  scrim.addEventListener('click', close);
  closeBtn && closeBtn.addEventListener('click', close);

  // Esc closes
  if(!window.__zoneSheetEsc){
    window.__zoneSheetEsc = true;
    window.addEventListener('keydown', (e)=>{
      if(e.key==='Escape' && state?.house?.ui?.zoneSheet?.open){
        closeHouseZoneSheet();
      }
    });
  }

  // Tabs
  root.querySelectorAll('[data-zone-tab]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state.house.ui.zoneSheet.tab = btn.getAttribute('data-zone-tab') || 'light';
      persist();
      view();
    });
  });

  const zid = state.house.ui.zoneSheet.zoneId;

  // Add task (zone wide)
  const addZoneTask = root.querySelector('#btnAddZoneTask');
  if(addZoneTask) addZoneTask.addEventListener('click', ()=> openHouseTaskModal(null, {zoneId:zid, subzoneId:null}));

  root.querySelectorAll('[data-zone-add-task]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const sz = (btn.getAttribute('data-zone-add-task')||'').trim() || null;
      openHouseTaskModal(null, {zoneId:zid, subzoneId:sz});
    });
  });

  // Task done toggles
  root.querySelectorAll('[data-zone-task-done]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const taskId = cb.getAttribute('data-zone-task-done');
      const todayStr = isoDate(new Date());
      if(cb.checked){
        markHouseTaskDone(taskId, todayStr);
        toast('Hecho ✅');
      }else{
        const t = (state.house.tasks||[]).find(x=>x.id===taskId);
        if(t){ t.lastDone=''; persist(); }
        toast('Reabierto');
      }
      view();
    });
  });

  root.querySelectorAll('[data-zone-edit-task]').forEach(btn=>{
    btn.addEventListener('click', ()=> openHouseTaskModal(btn.getAttribute('data-zone-edit-task')));
  });

  // Subzones CRUD (Detalles)
  const btnAddSub = root.querySelector('#btnAddSubzone');
  if(btnAddSub){
    btnAddSub.addEventListener('click', ()=>{
      openPromptModal({
        title:'New subzone',
        fields:[
          {key:'name', label:'Name', placeholder:'Ej: Mesón'},
          {key:'order', label:'Order (1..)', type:'number', placeholder:'1'}
        ],
        onSubmit: ({name, order})=>{
          const n=(name||'').trim();
          if(!n){ toast('Pon un nombre'); return; }
          const d = ensureZoneDetails(zid);
          d.subzones.push({id:uid('sz'), name:n, order:Number(order)|| (d.subzones.length+1)});
          persist(); view(); toast('Subzona guardada ✅');
        }
      });
    });
  }

  root.querySelectorAll('[data-subzone-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const sid = btn.getAttribute('data-subzone-edit');
      const d = ensureZoneDetails(zid);
      const sz = (d.subzones||[]).find(x=>x.id===sid);
      if(!sz) return;
      openPromptModal({
        title:'Edit subzone',
        fields:[
          {key:'name', label:'Name', placeholder:'', value:sz.name||''},
          {key:'order', label:'Order (1..)', type:'number', placeholder:'', value:String(sz.order||1)}
        ],
        onSubmit: ({name, order})=>{
          const n=(name||'').trim();
          if(!n){ toast('Pon un nombre'); return; }
          sz.name=n; sz.order=Number(order)||sz.order||1;
          persist(); view(); toast('Actualizado ✅');
        }
      });
    });
  });

  root.querySelectorAll('[data-subzone-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const sid = btn.getAttribute('data-subzone-del');
      const d = ensureZoneDetails(zid);
      const hasTasks = (state.house.tasks||[]).some(t=>t.zoneId===zid && t.subzoneId===sid);
      if(hasTasks){
        const ok = confirm('Hay tareas en esta subzona. ¿Moverlas a General y borrar?');
        if(!ok) return;
        (state.house.tasks||[]).forEach(t=>{ if(t.zoneId===zid && t.subzoneId===sid) t.subzoneId=null; });
      }
      d.subzones = (d.subzones||[]).filter(x=>x.id!==sid);
      persist(); view(); toast('Subzona borrada 🧽');
    });
  });

  // Notes save
  const btnSaveNotes = root.querySelector('#btnSaveZoneNotes');
  if(btnSaveNotes){
    btnSaveNotes.addEventListener('click', ()=>{
      const ta = root.querySelector('#zoneNotes');
      const d = ensureZoneDetails(zid);
      d.notes = (ta?.value||'').trim();
      persist(); toast('Notas guardadas ✅');
    });
  }
}

function viewCalendar(){
  const base = new Date();
  const d = new Date(base.getFullYear(), base.getMonth() + (state.calMonthOffset||0), 1);
  const y = d.getFullYear();
  const m = d.getMonth();
  const monthName = d.toLocaleDateString("es-PE", { month:"long", year:"numeric" });

  // Sunday-first grid
  const firstDow = new Date(y, m, 1).getDay(); // 0=Sun
  const start = new Date(y, m, 1);
  start.setDate(1 - firstDow);

  const cells = Array.from({length:42}, (_,i)=>{
    const cd = new Date(start);
    cd.setDate(start.getDate()+i);
    const iso = isoDate(cd);
    const inMonth = cd.getMonth()===m;
    const dayNum = cd.getDate();
    const preview = (state.calDraw && state.calDraw[iso]) ? state.calDraw[iso] : "";
    return { iso, inMonth, dayNum, preview };
  });

  const dow = ["D","L","M","M","J","V","S"].map(x=>`<div class="calDow">${x}</div>`).join("");
  const grid = cells.map(c=>`
    <button class="calCell ${c.inMonth?"":"out"}" data-cal-day="${escapeHtml(c.iso)}" aria-label="${escapeHtml(c.iso)}">
      <div class="calNum">${c.inMonth ? c.dayNum : ""}</div>
      ${c.preview ? `<img class="calPreview" src="${escapeHtml(c.preview)}" alt="" loading="lazy" />` : ""}
    </button>
  `).join("");

  return `
    <div class="sectionTitle">
      <div>Calendario</div>
      <div class="chip">dibuja encima ✍️</div>
    </div>

    <section class="card">
      <div class="calTop">
        <button class="iconBtn" id="calPrev" aria-label="Prev month">⟵</button>
        <div class="calMonth">${escapeHtml(monthName.charAt(0).toUpperCase()+monthName.slice(1))}</div>
        <button class="iconBtn" id="calNext" aria-label="Next month">⟶</button>
      </div>
      <div class="calDowRow">${dow}</div>
      <div class="calGrid">${grid}</div>
      <div class="muted" style="margin-top:10px;">Tip: toca un día para abrir el canvas grande. Luego verás el preview mini en la celda.</div>
    </section>
  `;
}

function openCalendarDrawModal(dateIso){
  const host = document.querySelector("#app");
  const modal = document.createElement("div");
  modal.className = "modalBackdrop";

  modal.innerHTML = `
    <div class="modal modalWide" role="dialog" aria-label="Dibujo del día">
      <div class="modalTop">
        <div>
          <div class="modalTitle">${escapeHtml(dateIso)}</div>
          <div class="modalSub">Dibuja con el dedo. Guarda y verás un preview mini en el calendario.</div>
        </div>
        <button class="iconBtn" id="btnCloseCal" aria-label="Close">✕</button>
      </div>

      <div class="calCanvasWrap">
        <canvas id="calCanvas" width="900" height="900"></canvas>
      </div>

      <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap;">
        <button class="btn" id="btnCalClear">Borrar</button>
        <button class="btn" id="btnCalUndo">Undo</button>
        <button class="btn" id="btnCalX">X roja</button>

        <div class="calTools">
          <div class="calPalette" aria-label="Palette">
            <button class="dot isActive" data-cal-color="#ff3b30" title="Rojo" style="--dot:#ff3b30"></button>
            <button class="dot" data-cal-color="#ffffff" title="Blanco" style="--dot:#ffffff"></button>
            <button class="dot" data-cal-color="#8b5cf6" title="Morado" style="--dot:#8b5cf6"></button>
            <button class="dot" data-cal-color="#22c55e" title="Verde" style="--dot:#22c55e"></button>
            <button class="dot" data-cal-color="#38bdf8" title="Cian" style="--dot:#38bdf8"></button>
            <button class="dot" data-cal-color="#f59e0b" title="Ámbar" style="--dot:#f59e0b"></button>
          </div>
          <div class="calSize">
            <span class="small muted">Grosor</span>
            <input id="calSize" type="range" min="2" max="32" step="1" value="10" />
          </div>
        </div>

        <div style="flex:1"></div>
        <button class="btn primary" id="btnCalSave">Guardar</button>
      </div>
    </div>
  `;

  host.appendChild(modal);

  const canvas = modal.querySelector("#calCanvas");
  const ctx = canvas.getContext("2d");
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Fit canvas visually (square)
  const fit = ()=>{
    const wrap = modal.querySelector(".calCanvasWrap");
    const w = wrap.clientWidth;
    canvas.style.width = w + "px";
    canvas.style.height = w + "px";
  };
  fit();
  window.addEventListener("resize", fit);

  // ---- Drawing state ----
  const stroke = { color: "#ff3b30", w: 10 };
  let drawing = false;
  let last = null;
  let currentStroke = null; // {color,w,pts:[[x,y],...]}
  let strokes = [];         // history for undo
  let baseImg = null;       // existing image snapshot (from previous saves)

  function pos(e){
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy];
  }

  function drawStrokePath(st){
    if(!st || !st.pts || st.pts.length < 2) return;
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.w;
    ctx.beginPath();
    ctx.moveTo(st.pts[0][0], st.pts[0][1]);
    for(let i=1;i<st.pts.length;i++){
      ctx.lineTo(st.pts[i][0], st.pts[i][1]);
    }
    ctx.stroke();
  }

  function renderAll(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(baseImg){
      ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
    }
    for(const st of strokes){
      drawStrokePath(st);
    }
  }

  // Load existing drawing as base image
  const existing = (state.calDraw && state.calDraw[dateIso]) ? state.calDraw[dateIso] : "";
  if(existing){
    const img = new Image();
    img.onload = ()=>{
      baseImg = img;
      renderAll();
    };
    img.src = existing;
  } else {
    renderAll();
  }

  // Pointer drawing
  canvas.addEventListener("pointerdown", (e)=>{
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    last = p;
    currentStroke = { color: stroke.color, w: stroke.w, pts: [p] };
  });

  canvas.addEventListener("pointermove", (e)=>{
    if(!drawing || !currentStroke) return;
    const p = pos(e);
    currentStroke.pts.push(p);

    // draw incremental segment for smooth feel
    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth = currentStroke.w;
    ctx.beginPath();
    ctx.moveTo(last[0], last[1]);
    ctx.lineTo(p[0], p[1]);
    ctx.stroke();

    last = p;
  });

  function end(){
    if(!drawing) return;
    drawing = false;
    last = null;

    if(currentStroke && currentStroke.pts.length > 1){
      strokes.push(currentStroke);
    }
    currentStroke = null;
  }

  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  // Close
  function close(){
    window.removeEventListener("resize", fit);
    modal.remove();
  }
  modal.querySelector("#btnCloseCal").addEventListener("click", close);
  modal.addEventListener("click", (e)=>{ if(e.target===modal) close(); });

  // Tools
  modal.querySelector("#btnCalClear").addEventListener("click", ()=>{
    baseImg = null;
    strokes = [];
    renderAll();
    toast("Borrado 🧽");
  });

  modal.querySelector("#btnCalUndo").addEventListener("click", ()=>{
    if(strokes.length === 0){
      toast("Nada que deshacer");
      return;
    }
    strokes.pop();
    renderAll();
  });

  modal.querySelector("#btnCalX").addEventListener("click", ()=>{
    const a1 = [canvas.width*0.2, canvas.height*0.2];
    const b1 = [canvas.width*0.8, canvas.height*0.8];
    const a2 = [canvas.width*0.8, canvas.height*0.2];
    const b2 = [canvas.width*0.2, canvas.height*0.8];

    strokes.push({ color: stroke.color, w: Math.max(stroke.w, 14), pts: [a1,b1] });
    strokes.push({ color: stroke.color, w: Math.max(stroke.w, 14), pts: [a2,b2] });
    renderAll();
  });

  const size = modal.querySelector("#calSize");
  if(size){
    size.addEventListener("input", ()=>{
      stroke.w = Number(size.value || 10);
    });
  }

  modal.querySelectorAll("[data-cal-color]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const c = btn.getAttribute("data-cal-color");
      if(!c) return;
      stroke.color = c;

      modal.querySelectorAll("[data-cal-color]").forEach(b=>b.classList.remove("isActive"));
      btn.classList.add("isActive");
    });
  });

  // Save
  modal.querySelector("#btnCalSave").addEventListener("click", ()=>{
    try{
      // Ensure everything is rendered
      renderAll();
      const dataUrl = canvas.toDataURL("image/png");
      state.calDraw ||= {};
      state.calDraw[dateIso] = dataUrl;
      persist();
      view();
      toast("Guardado ✅");
      close();
    }catch(e){
      console.warn(e);
      toast("No se pudo guardar ❌");
    }
  });
}

function wireActions(root){
  root.querySelectorAll("[data-act]").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      const act = btn.dataset.act;

      if(act==="fbOpenLab"){
        try{
          if(!window.__FOOTBALL_LAB__){
            try{ initFootballLab(); }catch(e){ console.warn(e); }
          }
          if(window.__FOOTBALL_LAB__?.open){
            window.__FOOTBALL_LAB__.open("home");
            return;
          }
          // fallback
          initFootballTab(document.getElementById("app"));
          return;
        }catch(e){
          console.error(e);
          toast("No pude abrir Football Lab ❌");
          return;
        }
      }


      // Shopping dashboard navigation
// Inventory tabs
if(act==="invTab"){
  state.inventorySubtab = (btn.dataset.tab === "history") ? "history" : (btn.dataset.tab === "calendar" ? "calendar" : "actual");
  view();
  return;
}

// Note: data-inv-act and data-inv-cat are handled by the delegated
// document listener at the bottom of the file — not here.
if(act==="invHistPreset"){
  state.inventoryHistPreset = btn.dataset.preset || "30d";
  state.inventorySubtab = "history";
  view();
  return;
}
if(act==="invCalNav"){
  state.inventoryCalOffset = Number(state.inventoryCalOffset||0) + Number(btn.dataset.dir||0);
  state.inventorySubtab = "calendar";
  view();
  return;
}


if(act==="invFilter"){
  state.invFilters ||= { low:false, out:false, lot:false, nolot:false, fav:false };
  const k = btn.dataset.key || "";
  if(k in state.invFilters){
    state.invFilters[k] = !state.invFilters[k];
    // mutually exclusive pairs
    if(k==="lot" && state.invFilters.lot) state.invFilters.nolot = false;
    if(k==="nolot" && state.invFilters.nolot) state.invFilters.lot = false;
    if(k==="low" && state.invFilters.low) state.invFilters.out = false;
    if(k==="out" && state.invFilters.out) state.invFilters.low = false;
  }
  view();
  return;
}
if(act==="invToggleCat"){
  const cat = btn.dataset.cat || "";
  state.invCatOpen ||= {};
  state.invCatOpen[cat] = !state.invCatOpen[cat];
  view();
  return;
}
if(act==="invMode"){
  state.invViewMode = (btn.dataset.mode==="cards") ? "cards" : "compact";
  view();
  return;
}

      if(act==="openShoppingDashboard"){
        state.shoppingSubtab = "dashboard";
        view();
        return;
      }
      if(act==="openShoppingAi"){
        state.shoppingSubtab = "ai";
        view();
        setTimeout(() => {
          const log = document.getElementById("shopAiChatLog");
          if(log) log.scrollTop = log.scrollHeight;
        }, 50);
        return;
      }
      if(act==="openShoppingHistory"){
        state.shoppingSubtab = "history";
        view();
        return;
      }
      if(act==="openInventory"){
        state.shoppingSubtab = "inventory";
        view();
        return;
      }
      if(act==="backToShoppingLists"){
        state.shoppingSubtab = "lists";
        view();
        return;
      }
      if(act==="setShopDashPreset"){
        state.shoppingDashPreset = btn.dataset.preset || "7d";
        view();
        return;
      }

      const routineEl = btn.closest("[data-routine-id]");
      if(routineEl){
        const rid = routineEl.dataset.routineId;
        const r = state.routines.find(x=>x.id===rid);
        if(!r) return;

        if(act==="toggleStep"){
          const s = r.steps.find(x=>x.id===btn.dataset.stepId);
          if(!s) return;
          s.done = !s.done; persist(); view(); return;
        }
        if(act==="deleteStep"){
          r.steps = r.steps.filter(x=>x.id!==btn.dataset.stepId);
          persist(); view(); return;
        }
        if(act==="addStep"){
          openPromptModal({
            title:"New step",
            fields:[{key:"text", label:"Step text", placeholder:"Example: Meditate 3 min"}],
            onSubmit: ({text})=>{
              if(!text.trim()) return;
              r.steps.push({ id: uid("s"), text:text.trim(), done:false });
              persist(); view();
            }
          });
          return;
        }
        if(act==="resetRoutine"){
          r.steps.forEach(s=>s.done=false);
          r.lastRun = new Date().toISOString();
          persist(); view();
          toast("Routine reset ✅");
          return;
        }
        if(act==="editRoutine"){
          openPromptModal({
            title:"Edit routine",
            fields:[
              {key:"title", label:"Title", value: r.title},
              {key:"times", label:"Times (comma)", value: (r.times||[]).join(", ")}
            ],
            onSubmit: ({title, times})=>{
              const t = (title||"").trim();
              if(!t) return;
              r.title = t;
              r.times = parseTimesCsv(times);
              persist(); view();
              toast("Updated ✅");
            }
          });
          return;
        }
        if(act==="toggleRoutine"){
          r.active = !r.active; persist(); view(); return;
        }
        if(act==="deleteRoutine"){
          if(!confirm("Delete this routine?")) return;
          state.routines = state.routines.filter(x=>x.id!==rid);
          persist(); view(); return;
        }
      }

      const listEl = btn.closest("[data-list-id]");
      if(listEl){
        const lid = listEl.dataset.listId;
        const list = state.shopping.find(x=>x.id===lid);
        if(!list) return;

        if(act==="addItem"){
          openSmartAddItem(lid);
          return;
        }
        if(act==="toggleBought"){
          const it = list.items.find(x=>x.id===btn.dataset.itemId);
          if(!it) return;
          it.bought = !it.bought;
          persist(); view();
          return;
        }
        if(act==="editItem"){
          const it = list.items.find(x=>x.id===btn.dataset.itemId);
          if(!it) return;

          const isWeighted = !!it.weight_g;
          const fields = [
            {key:"name", label:"Item", value: it.name},
          ];

          if(isWeighted){
            fields.push({key:"pricePerKg", label:"Precio por kg", type:"number", value:String(it.pricePerKg ?? it.price ?? 0)});
            fields.push({key:"grams", label:"Gramos", type:"number", value:String(it.weight_g ?? 500)});
          }else{
            fields.push({key:"price", label:"Price", type:"number", value: String(it.price ?? 0)});
            fields.push({key:"qty", label:"Qty", type:"number", value: String(it.qty ?? 1)});
          }

          openPromptModal({
            title:"Edit item",
            fields,
            onSubmit: (vals)=>{
              const name = (vals.name||"").trim();
              if(!name) return;
              it.name = name;

              if(isWeighted){
                const ppk = Number(vals.pricePerKg||0);
                const g = Math.max(1, Number(vals.grams||0));
                it.pricePerKg = ppk;
                it.weight_g = g;
                it.qty = 1;
                it.price = Number(calcPriceFromKg(ppk, g).toFixed(2));
                it.unit = "g";
              }else{
                it.price = Number(vals.price || 0);
                it.qty = Math.max(1, Number(vals.qty || 1));
              }

              persist(); view();
            }
          });
          return;
        }
        if(act==="deleteItem"){
          list.items = list.items.filter(x=>x.id!==btn.dataset.itemId);
          persist(); view(); return;
        }
        if(act==="renameList"){
          openPromptModal({
            title:"Rename list",
            fields:[{key:"name", label:"List name", value: list.name}],
            onSubmit: ({name})=>{
              const n = (name||"").trim();
              if(!n) return;
              list.name = n;
              persist(); view();
            }
          });
          return;
        }
if(act==="savePurchase"){
  // SMART INVENTORY CHECK: before saving, detect items already in Actual
  ensureInventory();
  ensureInventoryLots();
  const listItemsForCheck = (list.items||[]);
  const itemsInCocina = listItemsForCheck.filter(it=>{
    const pid = (it.productId||"").trim();
    if(pid) return (state.inventory||[]).some(inv=>inv.productId===pid);
    const nk = normName_(it.name);
    return (state.inventory||[]).some(inv=>!inv.productId && normName_(inv.name)===nk);
  });

  if(itemsInCocina.length > 0){
    // Show smart dialog before saving
    openSmartPurchaseInventoryModal({
      items: itemsInCocina,
      onContinue: (decisions)=>{
        // decisions: [{it, action: "restock"|"add"|"skip"}]
        doSavePurchase_({list, decisions});
      }
    });
    return;
  }

  // No items in cocina → save directly
  doSavePurchase_({list, decisions:[]});
  return;
}

function doSavePurchase_({list, decisions}){
  const d = isoDate();
  const defaultAccountId = state.financeLastMarketAccountId || state.financeLastAccountId || (state.financeAccounts||[])[0]?.id || "";
  openShoppingSavePurchaseModal({
    defaultDate: d,
    defaultStore: "",
    defaultNotes: "",
    defaultAccountId,
    onSubmit: ({date, store, notes, mkfin, accountId})=>{
      const safeDate = (date||"").trim() || d;
      const sourceListId = `L-${Date.now()}`;
      const now = new Date().toISOString();
      const items = (list.items||[]).map(it=>({
        id: uid("i"),
        name: it.name,
        price: Number(it.price||0),
        qty: Math.max(1, Number(it.qty||1)),
        category: (it.category||"").trim(),
        productId: (it.productId||"").trim(),
        essential: !!it.essential,
        unit: (it.unit||"").trim(),
        sourceListId
      }));
      const totals = calcEntryTotals(items);
      state.shoppingHistory.unshift({
        id: uid("sh"),
        date: safeDate,
        store: (store||"").trim(),
        notes: (notes||"").trim(),
        sourceListId,
        items,
        totals
      });

      // Apply smart inventory decisions
      ensureInventory();
      ensureInventoryLots();
      for(const item of items){
        const pid = item.productId;
        const decision = decisions.find(d=>{
          const dpid = (d.it.productId||"").trim();
          if(dpid && pid) return dpid === pid;
          return normName_(d.it.name)===normName_(item.name);
        });
        const action = decision?.action || "add";

        const existing = pid
          ? (state.inventory||[]).find(inv=>inv.productId===pid)
          : (state.inventory||[]).find(inv=>!inv.productId && normName_(inv.name)===normName_(item.name));

        if(action==="restock"){
          // Close old lots → open new one → reset level to 100%
          (state.inventoryLots||[]).filter(l=>!l.finishedAt && (pid ? l.productId===pid : normName_(l.name)===normName_(item.name))).forEach(l=>{ l.finishedAt = now; });
          if(existing){ existing.levelPct=100; existing.lastCheck=now.slice(0,10); }
          state.inventoryLots.unshift({ id:uid("lot"), productId:pid||"", name:item.name, category:item.category||"", qty:item.qty, unit:item.unit||"u", boughtAt:now, finishedAt:null, source:"shopping", sourceListId, store:(store||"").trim(), note:"" });
        } else if(action==="add"){
          // Normal: increment qty, add lot
          if(existing){ existing.qty = Number(existing.qty||0) + item.qty; }
          else {
            state.inventory.unshift({ id:uid("inv"), productId:pid||"", name:item.name, category:item.category||"", qty:item.qty, unit:item.unit||"u", minQty:0, essential:!!item.essential, notes:"", levelPct:"", refillPointPct:25, lastCheck:"" });
          }
          state.inventoryLots.unshift({ id:uid("lot"), productId:pid||"", name:item.name, category:item.category||"", qty:item.qty, unit:item.unit||"u", boughtAt:now, finishedAt:null, source:"shopping", sourceListId, store:(store||"").trim(), note:"" });
        }
        // "skip" → no inventory change
      }

      // For items NOT in decisions (not in cocina previously), apply normally
      const decidedNames = new Set(decisions.map(d=>(d.it.productId||normName_(d.it.name))));
      const undecided = items.filter(it=>{
        const key = it.productId || normName_(it.name);
        return !decidedNames.has(key);
      });
      applyItemsToInventory_(undecided);
      applyItemsToInventoryLots_(undecided, { boughtAtISO: now, sourceListId, store:(store||"").trim() });

      (list.items||[]).forEach(it=>{ it.bought = true; });

      if(mkfin && (state.financeAccounts||[]).length){
        const accId = accountId || defaultAccountId;
        const dateISO = `${safeDate}T12:00:00`;
        financeEnsureShoppingExpense_({ sourceListId, dateISO, amount: totals.total, accountId: accId, store:(store||"").trim(), notes:(notes||"").trim() });
      }

      persist();
      toast("Compra guardada ✅");
      state.shoppingSubtab = "dashboard";
      view();
    }
  });
}

// Smart modal: asks what to do with items already in Actual
function openSmartPurchaseInventoryModal({ items, onContinue }){
  const host = document.querySelector("#app");
  const b = document.createElement("div");
  b.className = "modalBackdrop slBackdrop";

  // Default decision: restock (most common scenario)
  const decisions = items.map(it=>({ it, action:"restock" }));

  function render(){
    b.innerHTML = `
      <div class="modal slModal" style="padding:0;gap:0;">
        <div class="slHeader" style="padding:16px 20px 12px;">
          <div class="slTitle">🤔 Detecté reposiciones</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="slQPConfirm spiSaveTop" id="spiContinueTop">Guardar ✓</button>
            <button class="slCloseBtn" id="spiClose">✕</button>
          </div>
        </div>
        <div style="font-size:13px;color:rgba(255,255,255,.55);padding:0 20px 12px;line-height:1.6;flex-shrink:0;">
          Compraste ${items.length} producto${items.length>1?"s que ya están":"que ya está"} en tu cocina.<br>
          ¿Qué hago con cada uno?
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;padding:0 20px 10px;overflow-y:auto;flex:1 1 0;min-height:0;">
          ${decisions.map((dec,i)=>{
            const inv = (state.inventory||[]).find(inv=> dec.it.productId ? inv.productId===dec.it.productId : normName_(inv.name)===normName_(dec.it.name));
            const curPct = (inv?.levelPct===0||inv?.levelPct) ? Math.round(Number(inv.levelPct)) : null;
            const pctTxt = curPct!==null ? ` · cocina al ${curPct}%` : "";
            return `
              <div class="spiItem">
                <div class="spiItemName">${escapeHtml(dec.it.name)}<span class="spiItemSub">${pctTxt}</span></div>
                <div class="spiActions">
                  <button class="spiBtn ${dec.action==="restock"?"spiActive":""}" data-spi-i="${i}" data-spi-act="restock">
                    🔄 Repuse<span class="spiBtnSub">Nuevo paquete</span>
                  </button>
                  <button class="spiBtn ${dec.action==="add"?"spiActive":""}" data-spi-i="${i}" data-spi-act="add">
                    ➕ Añadí más<span class="spiBtnSub">Suma al lote</span>
                  </button>
                  <button class="spiBtn ${dec.action==="skip"?"spiActive":""}" data-spi-i="${i}" data-spi-act="skip">
                    ⏭ Ignorar<span class="spiBtnSub">Sin cambio</span>
                  </button>
                </div>
              </div>`;
          }).join("")}
        </div>
        <div class="slQPActions">
          <button class="slQPCancel" id="spiCancel">Cancelar</button>
          <button class="slQPConfirm" id="spiContinue">Continuar →</button>
        </div>
      </div>`;

    b.querySelectorAll("[data-spi-act]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const idx = Number(btn.dataset.spiI);
        decisions[idx].action = btn.dataset.spiAct;
        render();
      });
    });
    b.querySelector("#spiClose").addEventListener("click",()=>b.remove());
    b.querySelector("#spiCancel").addEventListener("click",()=>b.remove());
    b.querySelector("#spiContinue").addEventListener("click",()=>{ b.remove(); onContinue(decisions); });
    b.querySelector("#spiContinueTop").addEventListener("click",()=>{ b.remove(); onContinue(decisions); });
  }

  host.appendChild(b);
  render();
}


        if(act==="deleteList"){
          if(!confirm("Delete this list?")) return;
          state.shopping = state.shopping.filter(x=>x.id!==lid);
          persist(); view(); return;
        }
      }

      const remEl = btn.closest("[data-reminder-id]");
      if(remEl){
        const mid = remEl.dataset.reminderId;
        const rem = state.reminders.find(x=>x.id===mid);
        if(!rem) return;

        if(act==="toggleReminder"){ rem.done = !rem.done; persist(); view(); return; }
        if(act==="deleteReminder"){
          if(!confirm("Delete this reminder?")) return;
          state.reminders = state.reminders.filter(x=>x.id!==mid);
          persist(); view(); return;
        }
      }
    });
  });
}

function openPromptModal({title, fields, onSubmit}){
  const host = document.querySelector("#app");
  const b = document.createElement("div");
  b.className = "modalBackdrop";
  b.innerHTML = `
    <div class="modal">
      <h2>${escapeHtml(title)}</h2>
      <div class="grid" id="fields"></div>
      <div class="row" style="margin-top:12px;">
        <button class="btn ghost" data-m="cancel">Cancel</button>
        <button class="btn primary" data-m="save">Save</button>
      </div>
      <div class="muted" style="margin-top:10px;">Saved in localStorage.</div>
    </div>
  `;
  host.appendChild(b);

  const wrap = b.querySelector("#fields");
  wrap.innerHTML = fields.map(f=>{
    const type = f.type || "text";
    const value = escapeHtml(f.value ?? "");
    return `
      <div>
        <div class="muted" style="margin:2px 0 6px;">${escapeHtml(f.label)}</div>
        <input class="input" data-k="${escapeHtml(f.key)}" type="${escapeHtml(type)}" value="${value}" placeholder="${escapeHtml(f.placeholder || "")}">
      </div>
    `;
  }).join("");

  const close = ()=> b.remove();
  b.addEventListener("click",(e)=>{ if(e.target===b) close(); });
  b.querySelector('[data-m="cancel"]').addEventListener("click", close);
  b.querySelector('[data-m="save"]').addEventListener("click", ()=>{
    const data = {};
    fields.forEach(f=>{
      const input = b.querySelector(`[data-k="${CSS.escape(f.key)}"]`);
      data[f.key] = input ? input.value : "";
    });
    onSubmit?.(data);
    close();
  });

  const first = b.querySelector("input");
  if(first) first.focus();
}

// Shopping → Finance connector (Phase 4)
function openShoppingSavePurchaseModal({defaultDate, defaultStore, defaultNotes, defaultAccountId, onSubmit}){
  const host = document.querySelector("#app") || document.body;
  const b = document.createElement("div");
  b.className = "modalBackdrop";

  const accounts = (state.financeAccounts||[]);
  const hasFinance = accounts.length>0;
  const accOptions = hasFinance
    ? accounts.map(a=>`<option value="${a.id}" ${a.id===defaultAccountId?'selected':''}>${escapeHtml(a.name)} (${escapeHtml(a.type||'')})</option>`).join("")
    : "";

  b.innerHTML = `
    <div class="modal" role="dialog" aria-label="Guardar compra">
      <h2>Guardar compra</h2>

      <div class="grid" style="gap:12px;">
        <div>
          <div class="muted" style="margin:2px 0 6px;">Fecha</div>
          <input class="input" data-k="date" type="date" value="${escapeHtml(defaultDate||'')}" />
        </div>
        <div>
          <div class="muted" style="margin:2px 0 6px;">Tienda</div>
          <input class="input" data-k="store" type="text" value="${escapeHtml(defaultStore||'')}" placeholder="Mass / Metro / ..." />
        </div>
        <div style="grid-column: 1 / -1;">
          <div class="muted" style="margin:2px 0 6px;">Notas</div>
          <input class="input" data-k="notes" type="text" value="${escapeHtml(defaultNotes||'')}" placeholder="(opcional)" />
        </div>

        <div style="grid-column: 1 / -1;">
          <label style="display:flex; align-items:center; gap:10px; user-select:none;">
            <input type="checkbox" data-k="mkfin" ${hasFinance?'checked':''} ${hasFinance?'':'disabled'} />
            <span>Crear gasto automático en Finanzas (Mercado)</span>
          </label>
          ${hasFinance ? '' : '<div class="muted" style="margin-top:6px;">(Crea una cuenta en Finanzas para activar esto.)</div>'}
        </div>

        ${hasFinance ? `
          <div style="grid-column: 1 / -1;">
            <div class="muted" style="margin:2px 0 6px;">Cuenta (Finanzas)</div>
            <select class="input" data-k="accountId">${accOptions}</select>
          </div>
        ` : ''}
      </div>

      <div class="row" style="margin-top:12px;">
        <button class="btn ghost" data-m="cancel">Cancelar</button>
        <button class="btn primary" data-m="save">Guardar</button>
      </div>
      <div class="muted" style="margin-top:10px;">Compra guardada en historial. Si activas Finanzas, también crea el movimiento.</div>
    </div>
  `;
  host.appendChild(b);

  const close = ()=> b.remove();
  b.addEventListener("click",(e)=>{ if(e.target===b) close(); });
  b.querySelector('[data-m="cancel"]').addEventListener("click", close);
  b.querySelector('[data-m="save"]').addEventListener("click", ()=>{
    const get = (k)=>{
      const el = b.querySelector(`[data-k="${CSS.escape(k)}"]`);
      if(!el) return "";
      if(el.type==="checkbox") return !!el.checked;
      return el.value;
    };
    onSubmit?.({
      date: get('date'),
      store: get('store'),
      notes: get('notes'),
      mkfin: !!get('mkfin'),
      accountId: get('accountId')
    });
    close();
  });

  const first = b.querySelector("input");
  if(first) first.focus();
}

function financeEnsureShoppingExpense_({sourceListId, dateISO, amount, accountId, store, notes}){
  if(!sourceListId) return null;
  if(!(state.financeAccounts||[]).length) return null;
  const exists = (state.financeLedger||[]).some(e=>e && !e.archived && e.source==="shopping" && e.sourceListId===sourceListId);
  if(exists) return null;

  const noteParts = [];
  if(store) noteParts.push(`Shopping · ${store}`);
  if(notes) noteParts.push(notes);
  const note = noteParts.join(" · ");

  const entry = addFinanceEntry({
    type: "expense",
    amount: Number(amount||0),
    accountId,
    category: "Mercado",
    reason: "planificado",
    note,
    date: dateISO
  });
  if(entry){
    entry.source = "shopping";
    entry.sourceListId = sourceListId;
    entry.store = store || "";
    persist();
  }
  return entry;
}

function openRoutineModal(){
  openPromptModal({
    title:"New routine",
    fields:[
      {key:"title", label:"Title", placeholder:"Evening wind-down"},
      {key:"times", label:"Times (comma)", placeholder:"07:00, 19:00"}
    ],
    onSubmit: ({title, times})=>{
      const t = (title||"").trim();
      if(!t) return;
      state.routines.unshift({
        id: uid("r"),
        title:t,
        times: parseTimesCsv(times),
        steps: [],
        active: true,
        lastRun: null
      });
      persist(); view();
    }
  });
}

function openShoppingModal(){
  openPromptModal({
    title:"New shopping list",
    fields:[{key:"name", label:"List name", placeholder:"Pharmacy"}],
    onSubmit: ({name})=>{
      const n = (name||"").trim();
      if(!n) return;
      state.shopping.unshift({ id: uid("l"), name:n, items:[] });
      persist(); view();
    }
  });
}

function openReminderModal(){
  openPromptModal({
    title:"New reminder",
    fields:[{key:"text", label:"Reminder", placeholder:"Pay electricity bill"}],
    onSubmit: ({text})=>{
      const t = (text||"").trim();
      if(!t) return;
      state.reminders.unshift({ id: uid("m"), text:t, done:false });
      persist(); view();
    }
  });
}

let toastTimer = null;
function toast(msg){
  clearTimeout(toastTimer);
  let host = document.querySelector("#toastHost");
  if(!host) return;
  host.innerHTML = `<div style="
    position:fixed;left:50%;bottom:calc(var(--navH) + 92px);transform:translateX(-50%);
    background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.18);
    color:rgba(255,255,255,.92);padding:10px 12px;border-radius:14px;
    backdrop-filter:blur(10px);z-index:50;box-shadow:0 10px 30px rgba(0,0,0,.35);
    font-weight:800;font-size:13px;max-width:85%;text-align:center;
  ">${escapeHtml(msg)}</div>`;
  toastTimer = setTimeout(()=>{ host.innerHTML = ""; }, 1400);
}

function initBottomSheet(){
  const sheet = document.querySelector("#bottomSheet");
  const scrim = document.querySelector("#sheetScrim");
  const handle = document.querySelector("#sheetHandle");
  const toggleBtn = document.querySelector("#sheetToggle");
  if(!sheet || !handle) return;

  const PEEK = 62; // px visible when closed

  function measureClosedY(){
    const h = sheet.getBoundingClientRect().height;
    return Math.max(0, h - PEEK);
  }

  function setOpen(open, opts = { animate:true }){
    state.sheetOpen = !!open;
    try{
      localStorage.setItem("mc_sheet_open", state.sheetOpen ? "1":"0");
    }catch(err){
      if(isQuotaExceededError(err)){
        try{
          sessionStorage.setItem("mc_sheet_open", state.sheetOpen ? "1":"0");
        }catch(_e){}
      }else{
        throw err;
      }
    }

    const closedY = measureClosedY();
    sheet.classList.toggle("open", state.sheetOpen);
    scrim?.classList.toggle("show", state.sheetOpen);
    handle.setAttribute("aria-expanded", state.sheetOpen ? "true":"false");

    const y = state.sheetOpen ? 0 : closedY;
    if(opts.animate){
      sheet.style.transition = "transform 220ms ease";
      scrim && (scrim.style.transition = "opacity 220ms ease");
    }else{
      sheet.style.transition = "none";
      scrim && (scrim.style.transition = "none");
    }
    sheet.style.transform = `translateY(${y}px)`;
    if(toggleBtn) toggleBtn.textContent = state.sheetOpen ? "▾" : "▴";
  }

  // Init position
  setOpen(state.sheetOpen, { animate:false });

  // Toggle on click
  const onToggle = (e)=>{ e?.preventDefault?.(); setOpen(!state.sheetOpen); };
  toggleBtn?.addEventListener("click", (e)=>{ e.stopPropagation(); onToggle(e); });
  handle.addEventListener("click", (e)=>{ if(e.target===toggleBtn) return; onToggle(e); });
  handle.addEventListener("keydown", (e)=>{ if(e.key==="Enter"||e.key===" "){ onToggle(e); }});
  scrim?.addEventListener("click", ()=> setOpen(false));

  // Drag to open/close
  let dragging = false;
  let startY = 0;
  let startTranslate = 0;

  const getCurrentTranslate = ()=>{
    const m = /translateY\(([-\d.]+)px\)/.exec(sheet.style.transform || "");
    return m ? parseFloat(m[1]) : (state.sheetOpen ? 0 : measureClosedY());
  };

  const onDown = (e)=>{
    dragging = true;
    sheet.style.transition = "none";
    scrim && (scrim.style.transition = "none");
    startY = e.clientY;
    startTranslate = getCurrentTranslate();
    sheet.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e)=>{
    if(!dragging) return;
    const dy = e.clientY - startY;
    const closedY = measureClosedY();
    let next = startTranslate + dy;
    next = Math.max(0, Math.min(closedY, next));
    sheet.style.transform = `translateY(${next}px)`;
    if(scrim){
      const t = 1 - (next / closedY);
      scrim.style.opacity = String(Math.max(0, Math.min(1, t)));
      scrim.classList.add("show");
    }
  };

  const onUp = ()=>{
    if(!dragging) return;
    dragging = false;
    const closedY = measureClosedY();
    const current = getCurrentTranslate();
    const shouldOpen = current < closedY * 0.5;
    setOpen(shouldOpen, { animate:true });
  };

  handle.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  // Re-measure on resize (orientation changes)
  window.addEventListener("resize", ()=> setOpen(state.sheetOpen, { animate:false }));
}

/* INIT_RENDER_MOVED
persist();
view();
// INIT_NEUROCLAW
neuroclawRunNow({ animate:false });

// Astro: always compute local signals; Swiss overlay is optional.
try{ refreshGlobalSignals(); }catch(e){}
// Swiss transits: initial pull + periodic refresh (in-app notifications)
try{
  // Kick once on load (non-blocking)
  setTimeout(()=>{ refreshSwissTransitsUI({ forceSpeak:false }); }, 1200);

  // Refresh cadence: min(bubbleFreq, 60) minutes. Default 60.
  const readFreqMin = ()=>{
    try{
      const raw = localStorage.getItem(LS.bubbleFreqMin) || localStorage.getItem("mc_bubble_cooldown_min") || "60";
      const v = Number(raw||60);
      if(!isFinite(v) || v<=0) return 60;
      return Math.max(15, Math.min(60, v));
    }catch(e){
      return 60;
    }
  };
  let tickMs = readFreqMin() * 60 * 1000;
  setInterval(()=>{
    // provider can change live
    refreshSwissTransitsUI({ forceSpeak:false });
  }, tickMs);
}catch(e){}
*/


/* ====================== REBUILT SHOPPING MODULE ====================== */

LS.products = "memorycarl_v2_products";
LS.shoppingHistory = "memorycarl_v2_shopping_history";
LS.inventory = "memorycarl_v2_inventory";
LS.inventoryLots = "memorycarl_v2_inventory_lots";
state.products = load(LS.products, []);
state.shoppingHistory = load(LS.shoppingHistory, []);
state.inventory = load(LS.inventory, []);
state.inventoryLots = load(LS.inventoryLots, []);
state.shoppingSubtab = state.shoppingSubtab || "lists";
state.shoppingDashPreset = state.shoppingDashPreset || "7d";

const _persistBase = persist;
persist = function(){
  _persistBase();
  save(LS.products, state.products);
  save(LS.shoppingHistory, state.shoppingHistory);
  save(LS.inventory, state.inventory);
};

function priceTrend(product){
  if(!product.history || product.history.length === 0) return null;
  const first = product.history[0].price;
  const last = product.price;
  const diff = last - first;
  const percent = first ? ((diff/first)*100).toFixed(1) : 0;
  return { diff, percent };
}




function calcPriceFromKg(pricePerKg, grams){
  const p = Number(pricePerKg||0);
  const g = Number(grams||0);
  if(!p || !g) return 0;
  return (p * (g/1000));
}

function openSmartAddItem(listId){
  const list = state.shopping.find(x=>x.id===listId);
  if(!list) return;

  const host = document.querySelector("#app");
  const modal = document.createElement("div");
  modal.className = "modalBackdrop slBackdrop";

  const products = (state.products||[]).slice();

  // Build category chips from products
  const cats = [...new Set(products.map(p=>(p.category||"").trim()).filter(Boolean))].sort();

  modal.innerHTML = `
    <div class="modal slModal">
      <div class="slHeader">
        <div class="slTitle">Agregar a lista</div>
        <button class="slCloseBtn" id="smartItemClose">✕</button>
      </div>

      <div class="slSearchRow">
        <span class="slSearchIcon">🔍</span>
        <input id="smartItemSearch" class="slSearchInput" placeholder="Buscar producto…" autocomplete="off" />
      </div>

      <div class="slCatRow" id="slCatRow">
        <button class="slCat slCatActive" data-cat="">Todo</button>
        ${cats.map(c=>`<button class="slCat" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}
      </div>

      <div id="smartItemResults" class="slResults"></div>

      <div class="slManualRow">
        <button class="slManualBtn" id="smartItemManual">＋ Añadir manual</button>
      </div>
    </div>
  `;

  host.appendChild(modal);

  const search = modal.querySelector("#smartItemSearch");
  const results = modal.querySelector("#smartItemResults");
  const catRow = modal.querySelector("#slCatRow");

  let activeCat = "";

  function renderResults(q, cat){
    const query = String(q||"").trim().toLowerCase();
    let matches = products;

    if(cat){
      matches = matches.filter(p=> (p.category||"").trim() === cat);
    }
    if(query){
      matches = matches.filter(p=>{
        const n = String(p.name||"").toLowerCase();
        const c = String(p.category||"").toLowerCase();
        return n.includes(query) || c.includes(query);
      });
    }

    if(matches.length===0){
      results.innerHTML = `<div class="slEmpty">No encontré nada<br><span>Usa "Añadir manual" 👇</span></div>`;
      return;
    }

    results.innerHTML = matches.map(p=>{
      const u = (p.unit||"u").toLowerCase();
      const isKg = u.includes("kg");
      const priceLabel = isKg ? `${money(p.price)}/kg` : money(p.price);
      const cat = p.category ? `<span class="slItemCat">${escapeHtml(p.category)}</span>` : "";
      const ess = p.essential ? `<span class="slEss">⭐</span>` : "";
      return `
        <button class="slItem" data-pick="${p.id}">
          <div class="slItemInfo">
            <div class="slItemName">${ess}${escapeHtml(p.name)}</div>
            <div class="slItemMeta">${priceLabel}${cat ? " · " : ""}${cat}</div>
          </div>
          <div class="slItemAdd">+</div>
        </button>
      `;
    }).join("");
  }

  function close(){
    modal.remove();
  }

  // initial render
  renderResults("", "");

  search.addEventListener("input", ()=> renderResults(search.value, activeCat));

  catRow.addEventListener("click", (e)=>{
    const btn = e.target.closest(".slCat");
    if(!btn) return;
    activeCat = btn.dataset.cat;
    catRow.querySelectorAll(".slCat").forEach(b=> b.classList.toggle("slCatActive", b===btn));
    renderResults(search.value, activeCat);
  });

  modal.querySelector("#smartItemClose").addEventListener("click", close);

  results.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-pick]");
    if(!btn) return;
    const pid = btn.dataset.pick;
    const p = products.find(x=>x.id===pid);
    if(!p) return;

    const u = String(p.unit||"u").toLowerCase();
    const isKg = u.includes("kg");

    // Show inline quick-add panel
    const existing = modal.querySelector(".slQuickPanel");
    if(existing) existing.remove();

    const panel = document.createElement("div");
    panel.className = "slQuickPanel";
    if(isKg){
      panel.innerHTML = `
        <div class="slQPTitle">${escapeHtml(p.name)} <span class="slQPSub">${money(p.price)}/kg</span></div>
        <div class="slQPRow">
          <label class="slQPLabel">Gramos</label>
          <div class="slQPCounter">
            <button class="slQPBtn" data-step="-100">−</button>
            <input class="slQPInput" id="qpVal" type="number" value="500" min="50" step="50" />
            <button class="slQPBtn" data-step="100">+</button>
          </div>
          <div class="slQPCalc" id="qpCalc">${money(calcPriceFromKg(p.price,500))}</div>
        </div>
        <div class="slQPActions">
          <button class="slQPCancel" id="qpCancel">Cancelar</button>
          <button class="slQPConfirm" id="qpConfirm">Añadir ✓</button>
        </div>
      `;
      modal.querySelector(".slModal").appendChild(panel);
      const inp = panel.querySelector("#qpVal");
      const calc = panel.querySelector("#qpCalc");
      panel.querySelectorAll("[data-step]").forEach(b=>{
        b.addEventListener("click",()=>{
          inp.value = Math.max(50, (Number(inp.value)||500) + Number(b.dataset.step));
          calc.textContent = money(calcPriceFromKg(p.price, Number(inp.value)));
        });
      });
      inp.addEventListener("input",()=>{
        calc.textContent = money(calcPriceFromKg(p.price, Number(inp.value)||0));
      });
      panel.querySelector("#qpCancel").addEventListener("click",()=> panel.remove());
      panel.querySelector("#qpConfirm").addEventListener("click",()=>{
        const g = Math.max(1, Number(inp.value||0));
        const price = calcPriceFromKg(p.price, g);
        list.items.push({ id:uid("i"), name:p.name, price:Number(price.toFixed(2)), qty:1, bought:false, productId:p.id, category:p.category||"", essential:!!p.essential, weight_g:g, pricePerKg:Number(p.price||0), unit:"g" });
        persist(); view();
        panel.remove();
        toast(`${p.name} añadido ✅`);
      });
    } else {
      panel.innerHTML = `
        <div class="slQPTitle">${escapeHtml(p.name)} <span class="slQPSub">${money(p.price)} c/u</span></div>
        <div class="slQPRow">
          <label class="slQPLabel">Cantidad</label>
          <div class="slQPCounter">
            <button class="slQPBtn" data-step="-1">−</button>
            <input class="slQPInput" id="qpQty" type="number" value="1" min="1" step="1" />
            <button class="slQPBtn" data-step="1">+</button>
          </div>
          <div class="slQPCalc" id="qpCalc">${money(p.price)}</div>
        </div>
        <div class="slQPRow">
          <label class="slQPLabel">Precio</label>
          <input class="slQPInput slQPPriceInput" id="qpPrice" type="number" value="${p.price||0}" min="0" step="0.01" />
        </div>
        <div class="slQPActions">
          <button class="slQPCancel" id="qpCancel">Cancelar</button>
          <button class="slQPConfirm" id="qpConfirm">Añadir ✓</button>
        </div>
      `;
      modal.querySelector(".slModal").appendChild(panel);
      const qtyInp = panel.querySelector("#qpQty");
      const priceInp = panel.querySelector("#qpPrice");
      const calc = panel.querySelector("#qpCalc");
      const updateCalc = ()=> calc.textContent = money((Number(priceInp.value)||0) * (Number(qtyInp.value)||1));
      panel.querySelectorAll("[data-step]").forEach(b=>{
        b.addEventListener("click",()=>{ qtyInp.value = Math.max(1,(Number(qtyInp.value)||1)+Number(b.dataset.step)); updateCalc(); });
      });
      priceInp.addEventListener("input", updateCalc);
      qtyInp.addEventListener("input", updateCalc);
      panel.querySelector("#qpCancel").addEventListener("click",()=> panel.remove());
      panel.querySelector("#qpConfirm").addEventListener("click",()=>{
        const qn = Math.max(1, Number(qtyInp.value||1));
        const pr = Number(priceInp.value||0);
        list.items.push({ id:uid("i"), name:p.name, price:pr, qty:qn, bought:false, productId:p.id, category:p.category||"", essential:!!p.essential });
        persist(); view();
        panel.remove();
        toast(`${p.name} ×${qn} añadido ✅`);
      });
    }
    panel.scrollIntoView({ behavior:"smooth", block:"nearest" });
  });

  modal.querySelector("#smartItemManual").addEventListener("click", ()=>{
    openPromptModal({
      title:"Item manual",
      fields:[
        {key:"name", label:"Nombre", placeholder:"Ej: Tomate"},
        {key:"mode", label:"Modo (u o kg)", value:"u"},
        {key:"price", label:"Precio (si u = precio unitario / si kg = precio por kg)", type:"number", value:"0"},
        {key:"qty", label:"Cantidad (si u)", type:"number", value:"1"},
        {key:"grams", label:"Gramos (si kg)", type:"number", value:"500"},
      ],
      onSubmit: ({name, mode, price, qty, grams})=>{
        const n = (name||"").trim();
        if(!n) return;
        const m = String(mode||"u").toLowerCase();
        const pr = Number(price||0);

        if(m.includes("kg")){
          const g = Math.max(1, Number(grams||0));
          const calc = calcPriceFromKg(pr, g);
          list.items.push({ id:uid("i"), name:n, price:Number(calc.toFixed(2)), qty:1, bought:false, weight_g:g, pricePerKg:pr, unit:"g" });
        }else{
          list.items.push({ id:uid("i"), name:n, price:pr, qty:Math.max(1,Number(qty||1)), bought:false });
        }
        persist(); view(); close();
      }
    });
  });

  // focus search
  setTimeout(()=> search.focus(), 80);
}

function openProductPicker(listId){
  const list = state.shopping.find(x=>x.id===listId);
  if(!list) return;

  const host = document.querySelector("#app");
  const modal = document.createElement("div");
  modal.className = "modalBackdrop";

  modal.innerHTML = `
    <div class="modal">
      <h2>Seleccionar producto</h2>
      <div class="grid">
        ${state.products.map(p=>`
          <button class="btn" onclick="addProductToShoppingList('${listId}','${p.id}')">
            ${escapeHtml(p.name)} · ${money(p.price)}
          </button>
        `).join("")}
      </div>

      <div class="row" style="margin-top:12px;">
        <button class="btn primary" onclick="openManualItemPrompt('${listId}')">+ Manual</button>
        <button class="btn ghost" onclick="this.closest('.modalBackdrop').remove()">Cancelar</button>
      </div>
    </div>
  `;

  host.appendChild(modal);
}

function openManualItemPrompt(listId){
  const list = state.shopping.find(x=>x.id===listId);
  if(!list) return;

  const backdrop = document.querySelector('.modalBackdrop');
  if(backdrop) backdrop.remove();

  openPromptModal({
    title:"Add item",
    fields:[
      {key:"name", label:"Item", placeholder:"Milk"},
      {key:"price", label:"Price", placeholder:"4.25", type:"number"},
      {key:"qty", label:"Qty", placeholder:"1", type:"number"},
    ],
    onSubmit: ({name, price, qty})=>{
      if(!name.trim()) return;
      list.items.push({
        id: uid("i"),
        name: name.trim(),
        price: Number(price || 0),
        qty: Math.max(1, Number(qty || 1)),
        bought: false
      });
      persist(); view();
    }
  });
}

function addProductToShoppingList(listId, productId){
  const list = state.shopping.find(x=>x.id===listId);
  const product = state.products.find(x=>x.id===productId);
  if(!list || !product) return;

  const u = String(product.unit||"u").toLowerCase();
  const isKg = u.includes("kg");

  if(isKg){
    // Default 500g if picked from old picker
    const g = 500;
    const price = calcPriceFromKg(product.price, g);
    list.items.push({
      id: uid("i"),
      name: product.name,
      price: Number(price.toFixed(2)),
      qty: 1,
      bought: false,
      productId: product.id,
      category: product.category || "",
      essential: !!product.essential,
      weight_g: g,
      pricePerKg: Number(product.price||0),
      unit: "g"
    });
  }else{
    list.items.push({
      id: uid("i"),
      name: product.name,
      price: Number(product.price || 0),
      qty: 1,
      bought: false,
      productId: product.id,
      category: product.category || "",
      essential: !!product.essential,
      unit: product.unit || "u"
    });
  }

  const backdrop = document.querySelector('.modalBackdrop');
  if(backdrop) backdrop.remove();

  persist();
  view();
}
function openProductLibrary(){
  const host = document.querySelector("#app");
  const sheet = document.createElement("div");
  sheet.className = "modalBackdrop libBackdrop";

  const cats = [...new Set((state.products||[]).map(p=>(p.category||"").trim()).filter(Boolean))].sort();

  function buildHTML(q, cat){
    const query = String(q||"").trim().toLowerCase();
    let prods = state.products || [];
    if(cat) prods = prods.filter(p=>(p.category||"").trim()===cat);
    if(query) prods = prods.filter(p=> (p.name||"").toLowerCase().includes(query) || (p.category||"").toLowerCase().includes(query));

    const catChips = `
      <button class="slCat ${!cat?"slCatActive":""}" data-libcat="">Todo <span class="slCatCount">${(state.products||[]).length}</span></button>
      ${cats.map(c=>{
        const n = (state.products||[]).filter(p=>(p.category||"").trim()===c).length;
        return `<button class="slCat ${cat===c?"slCatActive":""}" data-libcat="${escapeHtml(c)}">${escapeHtml(c)} <span class="slCatCount">${n}</span></button>`;
      }).join("")}
    `;

    const cards = prods.length === 0
      ? `<div class="libEmpty">Sin productos<br><span>Crea el primero 👆</span></div>`
      : prods.map(p=>{
          const trend = priceTrend(p);
          const trendHtml = trend
            ? (trend.diff > 0
                ? `<span class="libTrendUp">▲ ${trend.percent}%</span>`
                : trend.diff < 0
                  ? `<span class="libTrendDown">▼ ${Math.abs(trend.percent)}%</span>`
                  : ``)
            : ``;
          const ess = p.essential ? `<span class="libEss">⭐</span>` : ``;
          const u = String(p.unit||"u").toLowerCase();
          const isKg = u.includes("kg");
          const priceLabel = isKg ? `${money(p.price)}/kg` : money(p.price);
          return `
            <div class="libCard">
              <div class="libCardTop">
                <div class="libCardName">${ess}${escapeHtml(p.name)}</div>
                ${trendHtml}
              </div>
              <div class="libCardMeta">${priceLabel}${p.unit?` · ${escapeHtml(p.unit)}`:""}${p.store?` · ${escapeHtml(p.store)}`:""}</div>
              ${p.category?`<div class="libCardCat">${escapeHtml(p.category)}</div>`:""}
              <div class="libCardActions">
                <button class="libActBtn libActChart" data-lib-chart="${p.id}">📈</button>
                <button class="libActBtn libActEdit" data-lib-edit="${p.id}">✏️ Editar</button>
              </div>
            </div>
          `;
        }).join("");

    return { catChips, cards, count: prods.length };
  }

  sheet.innerHTML = `
    <div class="modal libModal">
      <div class="slHeader">
        <div class="slTitle">📦 Biblioteca</div>
        <button class="slCloseBtn" id="libClose">✕</button>
      </div>

      <div class="libToolbar">
        <div class="libSearchWrap">
          <span class="slSearchIcon">🔍</span>
          <input id="libSearch" class="slSearchInput" placeholder="Buscar producto…" autocomplete="off" />
        </div>
        <button class="libNewBtn" id="libNewBtn">＋ Nuevo</button>
      </div>

      <div class="slCatRow" id="libCatRow">
        <button class="slCat slCatActive" data-libcat="">Todo <span class="slCatCount">${(state.products||[]).length}</span></button>
        ${cats.map(c=>{
          const n = (state.products||[]).filter(p=>(p.category||"").trim()===c).length;
          return `<button class="slCat" data-libcat="${escapeHtml(c)}">${escapeHtml(c)} <span class="slCatCount">${n}</span></button>`;
        }).join("")}
      </div>

      <div id="libCards" class="libGrid"></div>
    </div>
  `;

  host.appendChild(sheet);

  let activeCat = "";
  const searchEl = sheet.querySelector("#libSearch");
  const cardsEl = sheet.querySelector("#libCards");
  const catRow = sheet.querySelector("#libCatRow");

  function render(){
    const { catChips, cards } = buildHTML(searchEl.value, activeCat);
    catRow.innerHTML = catChips;
    catRow.querySelectorAll("[data-libcat]").forEach(b=>{
      b.classList.toggle("slCatActive", b.dataset.libcat===activeCat);
    });
    cardsEl.innerHTML = cards;
  }

  render();

  searchEl.addEventListener("input", render);

  catRow.addEventListener("click", e=>{
    const b = e.target.closest("[data-libcat]");
    if(!b) return;
    activeCat = b.dataset.libcat;
    render();
  });

  sheet.querySelector("#libClose").addEventListener("click", ()=> sheet.remove());
  sheet.querySelector("#libNewBtn").addEventListener("click", ()=>{ openNewProduct(); });

  cardsEl.addEventListener("click", e=>{
    const chartBtn = e.target.closest("[data-lib-chart]");
    if(chartBtn){ openProductChart(chartBtn.dataset.libChart); return; }
    const editBtn = e.target.closest("[data-lib-edit]");
    if(editBtn){ editProductDetails(editBtn.dataset.libEdit); render(); return; }
  });

  setTimeout(()=> searchEl.focus(), 80);
}

// ====================== INVENTORY (Home stock) ======================

function ensureInventory(){
  if(!Array.isArray(state.inventory)) state.inventory = [];
  if(!Array.isArray(state.inventoryLots)) state.inventoryLots = [];
  // defaults for new % tracking
  (state.inventory||[]).forEach(it=>{
    if(it.refillPointPct == null) it.refillPointPct = 25;
    if(it.levelPct == null) it.levelPct = "";
    if(it.lastCheck == null) it.lastCheck = "";
  });
}

function inventoryFindByProductId(productId){
  if(!productId) return null;
  return (state.inventory||[]).find(x=>x.productId===productId) || null;
}

function addInventoryFromProduct(productId){
  ensureInventory();
  ensureInventoryLots();
  state.inventorySubtab = state.inventorySubtab || "actual";
  const p = state.products.find(x=>x.id===productId);
  if(!p) return;
  const existing = inventoryFindByProductId(productId);
  if(existing){
    existing.qty = Number(existing.qty||0) + 1;
    persist();
    toast("Inventario: +1 ✅");
    view();
    return;
  }
  state.inventory.unshift({
    id: uid("inv"),
    productId: p.id,
    name: p.name,
    category: p.category || "",
    qty: 1,
    unit: p.unit || "u",
    minQty: 0,
    essential: !!p.essential,
    notes: "",
    levelPct: "",
    refillPointPct: 25,
    lastCheck: ""
  });
  persist();
  toast("Agregado al inventario ✅");
  view();
}

function addInventoryManual(){
  ensureInventory();
  openPromptModal({
    title:"Nuevo en inventario",
    fields:[
      {key:"name", label:"Nombre"},
      {key:"category", label:"Categoría (opcional)", value:""},
      {key:"qty", label:"Cantidad", type:"number", value:"1"},
      {key:"unit", label:"Unidad (u, kg, L)", value:"u"},
      {key:"minQty", label:"Mínimo para alerta", type:"number", value:"0"},
      {key:"essential", label:"Esencial (1/0)", value:"1"},
      {key:"notes", label:"Notas", value:""},
      {key:"levelPct", label:"% actual (0-100)", type:"number", value:""},
      {key:"refillPointPct", label:"% para alerta (ej 25)", type:"number", value:"25"},
    ],
    onSubmit: ({name, category, qty, unit, minQty, essential, notes, levelPct, refillPointPct})=>{
      const n = (name||"").trim();
      if(!n) return;
      state.inventory.unshift({
        id: uid("inv"),
        productId: "",
        name: n,
        category: (category||"").trim(),
        qty: Number(qty||0) || 0,
        unit: (unit||"u").trim() || "u",
        minQty: Number(minQty||0) || 0,
        essential: String(essential||"").trim() !== "0",
        notes: (notes||"").trim(),
        levelPct: String(levelPct||"").trim(),
        refillPointPct: Number(refillPointPct||25) || 25,
        lastCheck: ""
      });
      persist();
      view();
    }
  });
}

function editInventoryItem(invId){
  ensureInventory();
  const it = state.inventory.find(x=>x.id===invId);
  if(!it) return;

  const host = document.querySelector("#app");
  const b = document.createElement("div");
  b.className = "modalBackdrop slBackdrop";

  b.innerHTML = `
    <div class="modal slModal" style="padding:20px;gap:0;">
      <div class="slHeader" style="padding:0 0 14px;">
        <div class="slTitle">✏️ Editar producto</div>
        <button class="slCloseBtn" id="eiClose">✕</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">
        <div>
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px;">Nombre</div>
          <input id="eiName" class="textInput" value="${escapeHtml(it.name||"")}" style="width:100%;box-sizing:border-box;">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px;">Categoría</div>
            <input id="eiCat" class="textInput" value="${escapeHtml(it.category||"")}" style="width:100%;box-sizing:border-box;">
          </div>
          <div>
            <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px;">Unidad</div>
            <input id="eiUnit" class="textInput" value="${escapeHtml(it.unit||"u")}" style="width:100%;box-sizing:border-box;">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px;">% actual</div>
            <input id="eiPct" type="number" min="0" max="100" class="textInput" value="${(it.levelPct===0||it.levelPct)?it.levelPct:""}" style="width:100%;box-sizing:border-box;">
          </div>
          <div>
            <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px;">% alerta</div>
            <input id="eiRefill" type="number" min="0" max="100" class="textInput" value="${it.refillPointPct??25}" style="width:100%;box-sizing:border-box;">
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px;background:rgba(255,255,255,.04);border-radius:12px;">
          <input id="eiEssential" type="checkbox" ${it.essential?"checked":""} style="width:18px;height:18px;accent-color:#7c5cff;">
          <span style="font-size:14px;font-weight:700;">⭐ Esencial</span>
        </label>
      </div>

      <div class="slQPActions" style="justify-content:space-between;">
        <button id="eiDelete" style="background:rgba(248,113,113,.15);border:1.5px solid rgba(248,113,113,.4);color:#f87171;border-radius:12px;padding:12px 16px;font-weight:800;font-size:14px;cursor:pointer;">🗑 Eliminar</button>
        <div style="display:flex;gap:8px;">
          <button class="slQPCancel" id="eiCancel">Cancelar</button>
          <button class="slQPConfirm" id="eiSave">Guardar</button>
        </div>
      </div>
    </div>`;

  host.appendChild(b);

  b.querySelector("#eiClose").addEventListener("click", ()=>b.remove());
  b.querySelector("#eiCancel").addEventListener("click", ()=>b.remove());

  b.querySelector("#eiDelete").addEventListener("click", ()=>{
    if(!confirm(`¿Eliminar "${it.name}" de la cocina?`)) return;
    state.inventory = state.inventory.filter(x=>x.id!==invId);
    persist();
    b.remove();
    toast("Eliminado ✅");
    view();
  });

  b.querySelector("#eiSave").addEventListener("click", ()=>{
    const name = b.querySelector("#eiName").value.trim();
    if(!name){ toast("Ponle un nombre"); return; }
    it.name = name;
    it.category = b.querySelector("#eiCat").value.trim();
    it.unit = b.querySelector("#eiUnit").value.trim() || "u";
    it.essential = b.querySelector("#eiEssential").checked;
    const pctRaw = b.querySelector("#eiPct").value.trim();
    it.levelPct = pctRaw==="" ? "" : Math.max(0, Math.min(100, Number(pctRaw)));
    it.refillPointPct = Number(b.querySelector("#eiRefill").value||25)||25;
    if(it.levelPct!=="" && !Number.isNaN(Number(it.levelPct))){
      it.lastCheck = new Date().toISOString().slice(0,10);
    }
    persist();
    b.remove();
    view();
  });
}

function deleteInventoryItem(invId){
  ensureInventory();
  if(!confirm("Eliminar este item del inventario?")) return;
  state.inventory = state.inventory.filter(x=>x.id!==invId);
  persist();
  view();
}

function addInventoryToList(invId){
  const it = (state.inventory||[]).find(x=>x.id===invId);
  if(!it) return;
  // pick first list by default
  const lid = state.shopping?.[0]?.id;
  if(!lid){
    toast("Crea una lista primero");
    return;
  }
  const list = state.shopping.find(x=>x.id===lid);
  if(!list) return;
  // If linked to a product, use its current price
  let price = 0;
  if(it.productId){
    const p = state.products.find(x=>x.id===it.productId);
    price = Number(p?.price||0);
  }
  list.items.push({
    id: uid("i"),
    name: it.name,
    price,
    qty: 1,
    bought:false,
    productId: it.productId || "",
    category: it.category || "",
    essential: !!it.essential
  });
  persist();
  toast("Agregado a la lista ✅");
  view();
}



function parseIsoDateToMs_(iso){
  try{
    const s = String(iso||"").trim();
    if(!s) return 0;
    // YYYY-MM-DD
    const [y,m,d] = s.split("-").map(n=>Number(n));
    if(!y||!m||!d) return 0;
    return new Date(y, m-1, d).getTime();
  }catch(e){ return 0; }
}

function getShoppingHistoryWindow_(days){
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + 24*60*60*1000;
  const start = end - (Number(days||7) * 24*60*60*1000);
  return {start, end};
}

function buildInventoryPurchaseStats_(days){
  const win = getShoppingHistoryWindow_(days);
  const hist = (state.shoppingHistory||[]);
  const byKey = {};

  for(const entry of hist){
    const t = parseIsoDateToMs_(entry.date);
    if(!t || t < win.start || t >= win.end) continue;

    const items = entry.items || [];
    const seenInThisEntry = new Set(); // count "times bought" per entry/day
    for(const it of items){
      const key = (it.productId && String(it.productId).trim()) ? ("p:"+String(it.productId).trim()) : ("n:"+String(it.name||"").trim().toLowerCase());
      if(!byKey[key]){
        byKey[key] = {
          key,
          productId: (it.productId||"").trim(),
          name: it.name || "Item",
          category: (it.category||"").trim(),
          unit: (it.unit||"").trim() || "u",
          times: 0,
          qty: 0,
          spent: 0
        };
      }
      const row = byKey[key];
      const q = Math.max(1, Number(it.qty||1));
      const price = Number(it.price||0);
      row.qty += q;
      row.spent += price * q;

      if(!seenInThisEntry.has(key)){
        row.times += 1;
        seenInThisEntry.add(key);
      }
    }
  }

  const arr = Object.values(byKey);
  // If product exists in library, prefer latest name/category
  arr.forEach(r=>{
    if(r.productId){
      const p = (state.products||[]).find(x=>x.id===r.productId);
      if(p){
        r.name = p.name || r.name;
        r.category = p.category || r.category;
        r.unit = p.unit || r.unit;
      }
    }
  });

  arr.sort((a,b)=> (b.times - a.times) || (b.spent - a.spent) || (String(a.name).localeCompare(String(b.name))));
  return arr;
}

function viewInventoryHistory(){
  const preset = state.inventoryHistPreset || "30d";
  const days = preset==="7d" ? 7 : preset==="15d" ? 15 : 30;
  const rows = buildInventoryPurchaseStats_(days);

  return `
    <section class="card">
      <div class="cardTop">
        <div>
          <h3 class="cardTitle">Histórico de compras</h3>
          <div class="small">Cuántas veces compraste cada producto en los últimos ${days} días</div>
        </div>
      </div>
      <div class="hr"></div>

      <div class="row" style="gap:8px; margin-bottom:10px;">
        <button class="btn ${preset==="7d"?"primary":""}" data-act="invHistPreset" data-preset="7d">7D</button>
        <button class="btn ${preset==="15d"?"primary":""}" data-act="invHistPreset" data-preset="15d">15D</button>
        <button class="btn ${preset==="30d"?"primary":""}" data-act="invHistPreset" data-preset="30d">30D</button>
        <div class="chip">${rows.length} productos</div>
      </div>

      <div class="list">
        ${rows.map(r=>`
          <div class="item">
            <div class="left">
              <div class="name">${escapeHtml(r.name)}</div>
              <div class="meta">${escapeHtml(r.category||"-")} · <b>${r.times}</b> veces · qty ${Number(r.qty||0)} · ${money(r.spent)}</div>
            </div>
          </div>
        `).join("") || `<div class="muted">No hay compras guardadas en este rango.</div>`}
      </div>
    </section>
  `;
}



function ensureInventoryLots(){
  state.inventoryLots = Array.isArray(state.inventoryLots) ? state.inventoryLots : [];
}

function lotProductKey_(lot){
  const pid = String(lot?.productId||"").trim();
  if(pid) return `pid:${pid}`;
  const name = (lot?.name||"").trim();
  return `nm:${normName_(name)}`;
}

function invGetConsumptionStats_(lots){
  // returns map key -> { avgDays, samples, lastBoughtAt, lastFinishedAt }
  const map = new Map();
  const done = (lots||[]).filter(l=>l?.boughtAt && l?.finishedAt);
  // newest first
  done.sort((a,b)=>String(b.finishedAt||"").localeCompare(String(a.finishedAt||"")));
  for(const l of done){
    const key = lotProductKey_(l);
    const ba = Date.parse(l.boughtAt);
    const fa = Date.parse(l.finishedAt);
    if(!isFinite(ba) || !isFinite(fa) || fa<=ba) continue;
    const days = (fa - ba) / (1000*60*60*24);
    const cur = map.get(key) || { samples:[], lastBoughtAt:null, lastFinishedAt:null };
    if(cur.samples.length < 6) cur.samples.push(days);
    if(!cur.lastBoughtAt) cur.lastBoughtAt = l.boughtAt;
    if(!cur.lastFinishedAt) cur.lastFinishedAt = l.finishedAt;
    map.set(key, cur);
  }
  // finalize avg
  const out = new Map();
  for(const [k,v] of map.entries()){
    const samples = v.samples.filter(x=>isFinite(x) && x>0);
    const avg = samples.length ? (samples.reduce((a,b)=>a+b,0)/samples.length) : null;
    out.set(k, {
      avgDays: avg ? Math.max(1, avg) : null,
      samples: samples.length,
      lastBoughtAt: v.lastBoughtAt,
      lastFinishedAt: v.lastFinishedAt
    });
  }
  return out;
}

function invMonthGrid_(year, monthIdx){
  // monthIdx: 0-11
  const first = new Date(year, monthIdx, 1);
  const startDow = (first.getDay()+6)%7; // Monday=0
  const start = new Date(year, monthIdx, 1 - startDow);
  const days = [];
  for(let i=0;i<42;i++){
    const d = new Date(start);
    d.setDate(start.getDate()+i);
    days.push(d);
  }
  return { first, days };
}

function fmtYMD_(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const da = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}

function openFinishLotModal(productKey){
  ensureInventoryLots();
  const openLots = (state.inventoryLots||[]).filter(l=>{
    if(l.finishedAt) return false;
    return lotProductKey_(l) === productKey;
  });

  if(!openLots.length){
    toast("No hay lotes activos para este producto.");
    return;
  }

  const host = document.querySelector("#app");
  const b = document.createElement("div");
  b.className = "modalBackdrop";

  const now = new Date();
  const nowDate = fmtYMD_(now);
  const nowTime = String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");

  b.innerHTML = `
    <div class="modal modalWide">
      <h2>Marcar como “Se acabó”</h2>
      <div class="small">Selecciona el lote y coloca la fecha/hora real. Esto alimenta la predicción.</div>
      <div class="hr"></div>

      <div class="grid" style="grid-template-columns: 1fr 1fr;">
        <div>
          <div class="muted" style="margin:2px 0 6px;">Lote activo</div>
          <select class="input" id="lotPick">
            ${openLots.map(l=>{
              const label = `${escapeHtml(l.name||"Item")} · ${Number(l.qty||0)} ${escapeHtml(l.unit||"u")} · comprado ${escapeHtml(String(l.boughtAt||"").slice(0,16).replace("T"," "))}`;
              return `<option value="${escapeHtml(l.id)}">${label}</option>`;
            }).join("")}
          </select>
        </div>
        <div>
          <div class="muted" style="margin:2px 0 6px;">Fecha de fin</div>
          <div class="row" style="gap:8px;">
            <input class="input" id="finDate" type="date" value="${nowDate}">
            <input class="input" id="finTime" type="time" value="${nowTime}">
          </div>
        </div>
      </div>

      <div class="row" style="margin-top:12px; gap:8px;">
        <button class="btn ghost" data-m="cancel">Cancelar</button>
        <button class="btn primary" data-m="save">Guardar</button>
      </div>
    </div>
  `;

  host.appendChild(b);

  b.addEventListener("click",(e)=>{
    const t = e.target.closest("[data-m]");
    if(!t) return;
    const act = t.dataset.m;
    if(act==="cancel"){ b.remove(); return; }
    if(act==="save"){
      const lotId = b.querySelector("#lotPick")?.value;
      const d = b.querySelector("#finDate")?.value;
      const tm = b.querySelector("#finTime")?.value || "12:00";
      if(!lotId || !d){ toast("Completa la fecha."); return; }
      const iso = `${d}T${tm}:00`;
      const lot = (state.inventoryLots||[]).find(x=>x.id===lotId);
      if(lot){
        lot.finishedAt = iso;
        persist();
        toast("Lote cerrado ✅");
        b.remove();
        view();
      }
    }
  });
}

function viewInventoryCalendar(){
  ensureInventoryLots();
  ensureInventory();

  const lots = (state.inventoryLots||[]);
  const stats = invGetConsumptionStats_(lots);

  // All closed lots sorted by finish date (newest first)
  const closed = lots.filter(l=>l?.boughtAt && l?.finishedAt)
    .sort((a,b)=>String(b.finishedAt||"").localeCompare(String(a.finishedAt||"")));

  // Active lots with predictions
  const activeLots = lots.filter(l=>l?.boughtAt && !l.finishedAt);

  // Group closed by product for timeline
  const byProduct = new Map();
  for(const l of closed){
    const key = lotProductKey_(l);
    if(!byProduct.has(key)) byProduct.set(key, { name:l.name||"Item", lots:[] });
    byProduct.get(key).lots.push(l);
  }

  // For each product build a row with bars
  // We'll show a simple swimlane: each lot = a pill with duration
  const productRows = [...byProduct.entries()].slice(0, 20).map(([key, data])=>{
    const st = stats.get(key);
    const avgDays = st?.avgDays ? Math.round(st.avgDays) : null;
    const samples = st?.samples || 0;

    const pills = data.lots.slice(0,6).map(l=>{
      const ba = Date.parse(l.boughtAt);
      const fa = Date.parse(l.finishedAt);
      const days = isFinite(ba)&&isFinite(fa) ? Math.round((fa-ba)/(1000*60*60*24)) : null;
      const startLabel = String(l.boughtAt||"").slice(5,10); // MM-DD
      const color = days===null ? "#555" : days <= (avgDays||999)*0.7 ? "#34d399" : days >= (avgDays||0)*1.3 ? "#f87171" : "#7c5cff";
      return `<div class="calLot" style="border-color:${color};color:${color}" title="${escapeHtml(startLabel)}">
        ${days!==null ? days+"d" : "?"}<span class="calLotDate">${escapeHtml(startLabel)}</span>
      </div>`;
    }).join("");

    const avgBadge = avgDays ? `<span class="invStatChip" style="background:rgba(124,92,255,.2);color:rgba(124,92,255,.9)">~${avgDays}d avg · ${samples} muestras</span>` : "";

    // Active lot prediction
    const activePred = activeLots.filter(l=>lotProductKey_(l)===key).map(l=>{
      if(!st?.avgDays) return "";
      const ba = Date.parse(l.boughtAt);
      if(!isFinite(ba)) return "";
      const pred = new Date(ba + st.avgDays*24*60*60*1000);
      const dLeft = Math.round((pred.getTime()-Date.now())/(1000*60*60*1000)); // hours
      const dDays = Math.round(dLeft/24);
      const color = dDays<=0?"#f87171":dDays<=3?"#fbbf24":"#34d399";
      const label = dDays<=0?"⛔ ya debería acabar":`~${dDays}d restantes`;
      return `<span class="calActivePred" style="color:${color}">📦 ${escapeHtml(label)}</span>`;
    }).join("");

    return `
      <div class="calProductRow">
        <div class="calProductHead">
          <div class="calProductName">${escapeHtml(data.name)}</div>
          ${avgBadge}
          ${activePred}
        </div>
        <div class="calLots">${pills || '<span style="opacity:.4;font-size:12px">Sin historial cerrado aún</span>'}</div>
      </div>
    `;
  }).join("") || `<div class="invEmpty">Sin historial de duración aún<br><span>Registra productos en Actual y marca "Se acabó" cuando terminen</span></div>`;

  // Quick close buttons for active lots
  const openGroups = new Map();
  for(const l of activeLots){
    const key = lotProductKey_(l);
    const cur = openGroups.get(key) || { name:l.name||"Item", count:0 };
    cur.count++;
    openGroups.set(key, cur);
  }
  const closeBtns = [...openGroups.entries()].slice(0,10).map(([k,v])=>
    `<button class="invA invA-fin" style="flex:none;margin-bottom:4px;" onclick="openFinishLotModal('${escapeHtml(k)}')">⛔ Se acabó · ${escapeHtml(v.name)}</button>`
  ).join("") || `<div class="invEmpty" style="padding:14px">Sin lotes activos</div>`;

  return `
    <section class="card" style="margin-bottom:12px;">
      <div class="cardTop">
        <div>
          <h3 class="cardTitle">⛔ Marcar como "Se acabó"</h3>
          <div class="small">¿Terminaste algo hoy?</div>
        </div>
      </div>
      <div class="hr"></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;padding-top:4px;">
        ${closeBtns}
      </div>
    </section>

    <section class="card">
      <div class="cardTop">
        <div>
          <h3 class="cardTitle">⏱ Duración por producto</h3>
          <div class="small">Cada píldora = un lote. Verde = duró menos, rojo = duró más de lo normal.</div>
        </div>
      </div>
      <div class="hr"></div>
      <div class="calTimeline">
        ${productRows}
      </div>
    </section>
  `;
}

function viewInventory(){
  ensureInventory();
  ensureInventoryLots();
  if(!state.invQuery) state.invQuery = "";
  if(!state.invCat) state.invCat = "";

  const inv = (state.inventory||[]);
  const lots = (state.inventoryLots||[]);
  const stats = invGetConsumptionStats_(lots);

  // ---- helpers ----
  function pkey_(it){ return it.productId ? ("pid:"+String(it.productId)) : ("nm:"+normName_(it.name)); }
  function hasActiveLot_(it){ return (lots||[]).some(l=>!l.finishedAt && lotProductKey_(l)===pkey_(it)); }

  function stockStatus_(it){
    const pctRaw = (it.levelPct===0||it.levelPct) ? Number(it.levelPct) : null;
    const pct = (pctRaw===null||Number.isNaN(pctRaw)) ? null : pctRaw;
    const refill = Number(it.refillPointPct??it.refillPct??25);
    if(pct!=null){ if(pct<=0) return "out"; if(refill>0&&pct<=refill) return "low"; return "ok"; }
    const qty = Number(it.qty||0); const min = Number(it.minQty||0);
    if(qty<=0) return "out"; if(min>0&&qty<=min) return "low"; return "ok";
  }

  function avgDays_(it){
    const s = stats.get(pkey_(it));
    return s?.avgDays ?? null;
  }

  function daysLeft_(it){
    const avg = avgDays_(it);
    const s = (stats.get(pkey_(it)));
    if(!avg || !s?.lastBoughtAt) return null;
    const boughtMs = Date.parse(s.lastBoughtAt);
    if(!isFinite(boughtMs)) return null;
    const elapsed = (Date.now()-boughtMs)/(1000*60*60*24);
    const left = avg - elapsed;
    return Math.max(0, Math.round(left));
  }

  // ---- filter ----
  const q = String(state.invQuery||"").trim().toLowerCase();
  const activeCat = String(state.invCat||"").trim();
  const allCats = [...new Set(inv.map(x=>(x.category||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));

  const filtered = inv.filter(it=>{
    if(activeCat && (it.category||"").trim()!==activeCat) return false;
    if(q){ const hay=`${it.name||""} ${it.category||""}`.toLowerCase(); if(!hay.includes(q)) return false; }
    return true;
  });

  // Status summary
  const outN = inv.filter(x=>stockStatus_(x)==="out").length;
  const lowN = inv.filter(x=>stockStatus_(x)==="low").length;
  const urgentN = outN+lowN;

  // Sort: out first, low second, then by days-left asc, then name
  const statusRank = {out:0,low:1,ok:2};
  const sorted = filtered.slice().sort((a,b)=>{
    const ra=statusRank[stockStatus_(a)]??9, rb=statusRank[stockStatus_(b)]??9;
    if(ra!==rb) return ra-rb;
    const da=daysLeft_(a)??999, db=daysLeft_(b)??999;
    if(da!==db) return da-db;
    return String(a.name||"").localeCompare(String(b.name||""),"es",{sensitivity:"base"});
  });

  // ---- render each item card ----
  function renderCard(it){
    const status = stockStatus_(it);
    const lot = hasActiveLot_(it);
    const avg = avgDays_(it);
    const left = daysLeft_(it);
    const pk = pkey_(it);
    const linked = !!it.productId;

    const pct = (it.levelPct===0||it.levelPct) ? Number(it.levelPct) : null;

    // Status color class
    const cc = status==="out" ? "invC-out" : status==="low" ? "invC-low" : "invC-ok";

    // Durability bar
    let durBar = "";
    if(avg && left!==null){
      const pctBar = Math.min(100, Math.round((left/avg)*100));
      const barColor = left<=2 ? "#f87171" : left<=5 ? "#fbbf24" : "#34d399";
      durBar = `
        <div class="invDurRow">
          <div class="invDurBar">
            <div class="invDurFill" style="width:${pctBar}%;background:${barColor}"></div>
          </div>
          <div class="invDurLabel" style="color:${barColor}">${left===0?"Hoy":"~"+left+"d"}</div>
        </div>`;
    }

    // Level pct arc display
    let levelDisp = "";
    if(pct!==null){
      const pctColor = pct<=10?"#f87171":pct<=30?"#fbbf24":"#34d399";
      levelDisp = `<div class="invPctBadge" style="border-color:${pctColor};color:${pctColor}">${Math.round(pct)}%</div>`;
    }

    // Stats line
    let statsLine = "";
    if(avg){ statsLine = `<span class="invStatChip">⏱ ${Math.round(avg)}d avg</span>`; }
    if(lot){ statsLine += `<span class="invStatChip invStatLot">🧾 lote</span>`; }
    if(it.essential){ statsLine += `<span class="invStatChip invStatEss">⭐ esencial</span>`; }

    return `
      <div class="invCard2 ${cc}" data-inv-id="${it.id}">
        <div class="invC2Top">
          <div class="invC2Left">
            <div class="invC2Name">${escapeHtml(it.name)}</div>
            <div class="invC2Sub">${escapeHtml(it.category||"")}${it.unit?` · ${escapeHtml(it.unit)}`:""}</div>
            ${statsLine ? `<div class="invC2Stats">${statsLine}</div>` : ""}
          </div>
          <div class="invC2Right">
            ${levelDisp}
            <div class="invC2Status ${cc}Label">${status==="out"?"⛔":"status"==="low"?"⚠️":"✓"}</div>
          </div>
        </div>
        ${durBar}
        <div class="invC2Actions">
          <button class="invA invA-list" data-inv-act="toList" data-iid="${it.id}" title="Añadir a lista">🛒</button>
          <button class="invA invA-fin" data-inv-act="finish" data-pkey="${escapeHtml(pk)}" title="Se acabó">Se acabó</button>
          <button class="invA invA-pct" data-inv-act="setPct" data-iid="${it.id}" title="Actualizar nivel">%</button>
          <button class="invA invA-edit" data-inv-act="edit" data-iid="${it.id}" title="Editar">✏️</button>
        </div>
      </div>
    `;
  }

  // ---- cat chips ----
  const catChips = `
    <button class="slCat ${!activeCat?"slCatActive":""}" data-inv-cat="">Todo <span class="slCatCount">${inv.length}</span></button>
    ${allCats.map(c=>{
      const cn = inv.filter(x=>(x.category||"").trim()===c).length;
      const hasAlert = inv.filter(x=>(x.category||"").trim()===c&&stockStatus_(x)!=="ok").length>0;
      return `<button class="slCat ${activeCat===c?"slCatActive":""}" data-inv-cat="${escapeHtml(c)}">${hasAlert?"🔴 ":""}${escapeHtml(c)} <span class="slCatCount">${cn}</span></button>`;
    }).join("")}
  `;

  // ---- summary banner ----
  const banner = urgentN>0 ? `
    <div class="invBanner ${outN>0?"invBannerRed":"invBannerYellow"}">
      ${outN>0?`<span>⛔ ${outN} agotado</span>`:""}
      ${lowN>0?`<span>⚠️ ${lowN} bajo stock</span>`:""}
      <span class="invBannerAction" data-inv-act="filterUrgent">Ver urgentes →</span>
    </div>
  ` : `<div class="invBanner invBannerGreen">✅ Todo el inventario en orden</div>`;

  const subtab = state.inventorySubtab || "actual";

  return `
    <div class="sectionTitle">
      <div>🏠 Cocina</div>
      <div style="display:flex;gap:8px;">
        <button class="btn" style="background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.3);color:#f87171;font-size:12px;" data-inv-act="clearCocina">🗑 Limpiar</button>
        <button class="btn" data-act="backToShoppingLists">← Volver</button>
      </div>
    </div>

    <div class="invTabRow">
      <button class="invTab ${subtab==="actual"?"invTabActive":""}" data-act="invTab" data-tab="actual">Actual</button>
      <button class="invTab ${subtab==="history"?"invTabActive":""}" data-act="invTab" data-tab="history">Historial</button>
      <button class="invTab ${subtab==="calendar"?"invTabActive":""}" data-act="invTab" data-tab="calendar">Calendario</button>
    </div>

    ${subtab==="history" ? viewInventoryHistory() : subtab==="calendar" ? viewInventoryCalendar() : `

    ${banner}

    <div class="invTopBar">
      <div class="invSearchWrap">
        <span>🔍</span>
        <input class="invSearchIn" placeholder="Buscar…" value="${escapeHtml(state.invQuery||"")}" oninput="setInvQuery(this.value)" />
      </div>
      <button class="invAddBtn" data-inv-act="addFromLib">＋ Agregar</button>
    </div>

    <div class="slCatRow" id="invCatRow">
      ${catChips}
    </div>

    <div class="invGrid" id="invGrid">
      ${sorted.length ? sorted.map(renderCard).join("") : `<div class="invEmpty">Sin items${q||activeCat?" con ese filtro":""}<br><span>Toca ＋ Agregar para añadir</span></div>`}
    </div>

    `}
  `;
}
/* ====================== SMART INVENTORY HELPERS ====================== */

// Modal: update % level for an inventory item
function openInvPctModal(invId){
  ensureInventory();
  const it = (state.inventory||[]).find(x=>x.id===invId);
  if(!it) return;

  const host = document.querySelector("#app");
  const b = document.createElement("div");
  b.className = "modalBackdrop slBackdrop";

  const curPct = (it.levelPct===0||it.levelPct) ? Number(it.levelPct) : 100;

  b.innerHTML = `
    <div class="modal slModal" style="padding:20px;">
      <div class="slHeader" style="padding:0 0 16px;">
        <div class="slTitle">📊 ${escapeHtml(it.name)}</div>
        <button class="slCloseBtn" id="invPctClose">✕</button>
      </div>
      <div style="font-size:13px;color:rgba(255,255,255,.5);margin-bottom:16px;">¿Cuánto queda? Desliza o toca los botones.</div>
      <div class="invPctSliderWrap">
        <input type="range" min="0" max="100" step="5" value="${curPct}" class="invPctSlider" id="invPctSlider" />
        <div class="invPctSliderVal" id="invPctVal">${curPct}%</div>
      </div>
      <div class="invPctQuickRow">
        <button class="invPctQ" data-v="0">⛔ Vacío</button>
        <button class="invPctQ" data-v="25">25%</button>
        <button class="invPctQ" data-v="50">50%</button>
        <button class="invPctQ" data-v="75">75%</button>
        <button class="invPctQ" data-v="100">🆕 Lleno</button>
      </div>
      <div class="slQPActions" style="margin-top:18px;">
        <button class="slQPCancel" id="invPctCancel">Cancelar</button>
        <button class="slQPConfirm" id="invPctSave">Guardar ✓</button>
      </div>
    </div>
  `;
  host.appendChild(b);

  const slider = b.querySelector("#invPctSlider");
  const valEl = b.querySelector("#invPctVal");
  const close = ()=>b.remove();

  slider.addEventListener("input",()=>{ valEl.textContent=slider.value+"%"; });
  b.querySelectorAll(".invPctQ").forEach(q=>{
    q.addEventListener("click",()=>{ slider.value=q.dataset.v; valEl.textContent=slider.value+"%"; });
  });
  b.querySelector("#invPctClose").addEventListener("click", close);
  b.querySelector("#invPctCancel").addEventListener("click", close);
  b.querySelector("#invPctSave").addEventListener("click",()=>{
    it.levelPct = Number(slider.value);
    it.lastCheck = new Date().toISOString().slice(0,10);

    // If went from >0 to 0, offer to mark lot as finished
    if(it.levelPct===0){
      const pk = it.productId ? ("pid:"+String(it.productId)) : ("nm:"+normName_(it.name));
      const hasLot = (state.inventoryLots||[]).some(l=>!l.finishedAt && lotProductKey_(l)===pk);
      if(hasLot){
        persist(); close();
        openFinishLotModal(pk);
        return;
      }
    }
    persist();
    toast(`${it.name}: ${it.levelPct}% ✅`);
    close();
    view();
  });
}
window.openInvPctModal = openInvPctModal;

// Modal: Add to inventory from biblioteca (with smart "reponer vs nuevo lote" flow)
function openInvAddFromLibModal(){
  ensureInventory();
  ensureInventoryLots();

  const host = document.querySelector("#app");
  const b = document.createElement("div");
  b.className = "modalBackdrop libBackdrop";

  const products = (state.products||[]).slice();
  const cats = [...new Set(products.map(p=>(p.category||"").trim()).filter(Boolean))].sort();
  let activeCat = "";

  function buildRows(q, cat){
    let prods = products;
    if(cat) prods = prods.filter(p=>(p.category||"").trim()===cat);
    if(q) prods = prods.filter(p=>(p.name||"").toLowerCase().includes(q.toLowerCase())||
                                   (p.category||"").toLowerCase().includes(q.toLowerCase()));
    if(!prods.length) return `<div class="invEmpty">Sin resultados<br><span>Crea productos en Biblioteca primero</span></div>`;
    return prods.map(p=>{
      const inv = (state.inventory||[]).find(x=>x.productId===p.id);
      const inInv = !!inv;
      const pct = (inv?.levelPct===0||inv?.levelPct) ? Number(inv.levelPct) : null;
      const pctTxt = pct!==null ? `<span class="invStatChip" style="margin-left:4px">${Math.round(pct)}%</span>` : "";
      const statusBadge = inInv
        ? `<span class="invStatChip ${pct===0||pct<=10?"invStatLot":""}">En cocina${pctTxt}</span>`
        : `<span class="invStatChip" style="opacity:.5">Nuevo</span>`;
      return `
        <button class="slItem" data-inv-pick="${p.id}">
          <div class="slItemInfo">
            <div class="slItemName">${p.essential?"⭐":""} ${escapeHtml(p.name)}</div>
            <div class="slItemMeta">${money(p.price||0)}${p.unit?` · ${escapeHtml(p.unit)}`:""}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
            ${statusBadge}
            <div class="slItemAdd">+</div>
          </div>
        </button>`;
    }).join("");
  }

  b.innerHTML = `
    <div class="modal libModal">
      <div class="slHeader">
        <div class="slTitle">🏠 Agregar a cocina</div>
        <button class="slCloseBtn" id="invLibClose">✕</button>
      </div>
      <div class="slSearchRow">
        <span class="slSearchIcon">🔍</span>
        <input id="invLibSearch" class="slSearchInput" placeholder="Buscar producto…" autocomplete="off" />
      </div>
      <div class="slCatRow" id="invLibCatRow">
        <button class="slCat slCatActive" data-il-cat="">Todo</button>
        ${cats.map(c=>`<button class="slCat" data-il-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}
      </div>
      <div id="invLibResults" class="slResults"></div>
    </div>
  `;
  host.appendChild(b);

  const searchEl = b.querySelector("#invLibSearch");
  const resultsEl = b.querySelector("#invLibResults");
  const catRow = b.querySelector("#invLibCatRow");
  const close = ()=>b.remove();

  function render(){ resultsEl.innerHTML = buildRows(searchEl.value, activeCat); }
  render();

  searchEl.addEventListener("input", render);
  b.querySelector("#invLibClose").addEventListener("click", close);

  catRow.addEventListener("click", e=>{
    const btn = e.target.closest("[data-il-cat]");
    if(!btn) return;
    activeCat = btn.dataset.ilCat;
    catRow.querySelectorAll("[data-il-cat]").forEach(x=>x.classList.toggle("slCatActive", x===btn));
    render();
  });

  resultsEl.addEventListener("click", e=>{
    const btn = e.target.closest("[data-inv-pick]");
    if(!btn) return;
    const pid = btn.dataset.invPick;
    const p = products.find(x=>x.id===pid);
    if(!p) return;

    const existing = (state.inventory||[]).find(x=>x.productId===pid);
    const pkey = "pid:"+pid;
    const hasActiveLot = (state.inventoryLots||[]).some(l=>!l.finishedAt && l.productId===pid);
    const curPct = (existing?.levelPct===0||existing?.levelPct) ? Number(existing.levelPct) : null;

    // Smart flow: if product already in inventory with low/0 level → ask
    if(existing && curPct!==null && curPct<=30 && !hasActiveLot){
      // Show smart dialog: reponer o nuevo lote?
      openInvSmartRestockModal({ p, existing, pkey, onDone: ()=>{ close(); view(); } });
      return;
    }

    // Default: open pct panel
    openInvPickQtyModal({ p, existing, pkey, onDone: ()=>{ close(); view(); } });
  });

  setTimeout(()=>searchEl.focus(), 80);
}
window.openInvAddFromLibModal = openInvAddFromLibModal;

// Panel: pick qty & level when adding to inventory
function openInvPickQtyModal({ p, existing, pkey, onDone }){
  const host = document.querySelector("#app");
  const b = document.createElement("div");
  b.className = "modalBackdrop slBackdrop";

  b.innerHTML = `
    <div class="modal slModal" style="padding:20px;">
      <div class="slHeader" style="padding:0 0 14px;">
        <div class="slTitle">➕ ${escapeHtml(p.name)}</div>
        <button class="slCloseBtn" id="invQClose">✕</button>
      </div>
      <div class="slQPRow">
        <label class="slQPLabel">Nivel</label>
        <div class="slQPCounter">
          <button class="slQPBtn" data-step="-10">−</button>
          <input class="slQPInput" id="invQPct" type="number" min="0" max="100" step="10" value="100" />
          <button class="slQPBtn" data-step="10">+</button>
        </div>
        <div class="slQPCalc" id="invQPctVal">100%</div>
      </div>
      <div class="invPctQuickRow" style="margin-top:10px;">
        <button class="invPctQ" data-v="100">🆕 Lleno</button>
        <button class="invPctQ" data-v="75">75%</button>
        <button class="invPctQ" data-v="50">Mitad</button>
      </div>
      <div class="slQPActions" style="margin-top:18px;">
        <button class="slQPCancel" id="invQCancel">Cancelar</button>
        <button class="slQPConfirm" id="invQSave">Añadir ✓</button>
      </div>
    </div>`;
  host.appendChild(b);

  const inp = b.querySelector("#invQPct");
  const valEl = b.querySelector("#invQPctVal");
  const close = ()=>b.remove();

  const update = ()=>{ valEl.textContent=(Number(inp.value)||0)+"%"; };
  b.querySelectorAll("[data-step]").forEach(bt=>{
    bt.addEventListener("click",()=>{ inp.value=Math.max(0,Math.min(100,(Number(inp.value)||0)+Number(bt.dataset.step))); update(); });
  });
  b.querySelectorAll(".invPctQ").forEach(q=>{ q.addEventListener("click",()=>{ inp.value=q.dataset.v; update(); }); });
  inp.addEventListener("input", update);
  b.querySelector("#invQClose").addEventListener("click", close);
  b.querySelector("#invQCancel").addEventListener("click", close);
  b.querySelector("#invQSave").addEventListener("click",()=>{
    const pct = Math.max(0,Math.min(100,Number(inp.value)||100));
    const now = new Date().toISOString();
    if(existing){
      existing.levelPct = pct;
      existing.lastCheck = now.slice(0,10);
    } else {
      state.inventory.unshift({
        id: uid("inv"), productId: p.id, name: p.name,
        category: p.category||"", qty:1, unit: p.unit||"u",
        minQty:0, essential:!!p.essential, notes:"",
        levelPct: pct, refillPointPct:25, lastCheck: now.slice(0,10)
      });
    }
    // Create lot
    state.inventoryLots.unshift({
      id: uid("lot"), productId: p.id, name: p.name,
      category: p.category||"", qty:1, unit: p.unit||"u",
      boughtAt: now, finishedAt: null, source:"manual", store:"", note:""
    });
    persist();
    toast(`${p.name} en cocina ✅`);
    close();
    onDone?.();
  });
}

// Smart restock modal: ¿repones (sigue el lote) o es un producto nuevo (nuevo lote)?
function openInvSmartRestockModal({ p, existing, pkey, onDone }){
  const host = document.querySelector("#app");
  const b = document.createElement("div");
  b.className = "modalBackdrop slBackdrop";

  const curPct = (existing?.levelPct===0||existing?.levelPct) ? Math.round(Number(existing.levelPct)) : 0;

  b.innerHTML = `
    <div class="modal slModal" style="padding:20px;">
      <div class="slHeader" style="padding:0 0 14px;">
        <div class="slTitle">🤔 ${escapeHtml(p.name)}</div>
        <button class="slCloseBtn" id="invRClose">✕</button>
      </div>
      <div style="font-size:13px;color:rgba(255,255,255,.6);margin-bottom:20px;line-height:1.6;">
        Tienes este producto en cocina al <b style="color:#fbbf24">${curPct}%</b>.<br>
        ¿Compraste más?
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="invRestockBtn invRestockRepon" id="invRRepon">
          <div style="font-size:18px">🔄</div>
          <div>
            <div style="font-weight:900;font-size:15px;">Repuse / Abrí un nuevo paquete</div>
            <div style="font-size:12px;opacity:.7;margin-top:2px;">Cierra el lote anterior y empieza uno nuevo.<br>Esto mejora la predicción de duración.</div>
          </div>
        </button>
        <button class="invRestockBtn invRestockAdd" id="invRAdd">
          <div style="font-size:18px">➕</div>
          <div>
            <div style="font-weight:900;font-size:15px;">Solo actualizo el nivel</div>
            <div style="font-size:12px;opacity:.7;margin-top:2px;">El lote actual continúa. Solo cambio el %.</div>
          </div>
        </button>
      </div>
    </div>`;
  host.appendChild(b);

  const close = ()=>b.remove();
  b.querySelector("#invRClose").addEventListener("click", close);

  b.querySelector("#invRRepon").addEventListener("click",()=>{
    // Close old lots, open new one
    const now = new Date().toISOString();
    (state.inventoryLots||[]).filter(l=>!l.finishedAt && l.productId===p.id).forEach(l=>{ l.finishedAt = now; });
    state.inventoryLots.unshift({
      id:uid("lot"), productId:p.id, name:p.name,
      category:p.category||"", qty:1, unit:p.unit||"u",
      boughtAt:now, finishedAt:null, source:"restock", store:"", note:""
    });
    if(existing){ existing.levelPct=100; existing.lastCheck=now.slice(0,10); }
    persist();
    toast(`${p.name} repuesto ✅ — lote nuevo`);
    close(); onDone?.();
  });

  b.querySelector("#invRAdd").addEventListener("click",()=>{
    close();
    openInvPickQtyModal({ p, existing, pkey, onDone });
  });
}
window.openInvSmartRestockModal = openInvSmartRestockModal;

// Expose inventory functions for inline onclick
window.addInventoryFromProduct = addInventoryFromProduct;
window.addInventoryManual = addInventoryManual;
window.editInventoryItem = editInventoryItem;
window.deleteInventoryItem = deleteInventoryItem;
window.addInventoryToList = addInventoryToList;

// Inventory UI helpers
function setInvQuery(v){
  state.invQuery = String(v||"");
  view();
}
window.setInvQuery = setInvQuery;

// % Manual (Daily Check)
function updateInventoryPct(invId, value){
  ensureInventory();
  const it = (state.inventory||[]).find(x=>x.id===invId);
  if(!it) return;

  const pct = Number(String(value||"").trim());
  if(Number.isNaN(pct) || pct<0 || pct>100){
    toast("Porcentaje inválido (0-100)");
    view();
    return;
  }
  it.levelPct = Math.round(pct);
  it.lastCheck = new Date().toISOString().slice(0,10);
  if(it.refillPointPct == null) it.refillPointPct = 25;
  persist();
  view();
}
window.updateInventoryPct = updateInventoryPct;

function markInventoryChecked(invId){
  ensureInventory();
  const it = (state.inventory||[]).find(x=>x.id===invId);
  if(!it) return;
  it.lastCheck = new Date().toISOString().slice(0,10);
  persist();
  toast("Revisado hoy ✅");
  view();
}
window.markInventoryChecked = markInventoryChecked;


function openNewProduct(){
  openPromptModal({
    title:"Nuevo producto",
    fields:[
      {key:"name", label:"Nombre"},
      {key:"price", label:"Precio", type:"number"},
      {key:"store", label:"Tienda"},
      {key:"category", label:"Categoría", value:""},
      {key:"unit", label:"Unidad (u, kg, L)", value:"u"},
      {key:"essential", label:"Esencial (1/0)", value:"1"}
    ],
    onSubmit: ({name, price, store, category, unit, essential})=>{
      state.products.unshift({
        id: uid("p"),
        name:name,
        price:Number(price||0),
        store:store,
        category:(category||"").trim(),
        unit:(unit||"u").trim() || "u",
        essential: String(essential||"").trim() !== "0",
        history:[]
      });
      persist(); view();
    }
  });
}

function editProductPrice(productId){
  const p = state.products.find(x=>x.id===productId);
  if(!p) return;

  openPromptModal({
    title:"Actualizar precio",
    fields:[
      {key:"price", label:"Nuevo precio", type:"number", value:String(p.price)}
    ],
    onSubmit: ({price})=>{
      const old = p.price;
      const np = Number(price||0);
      if(old !== np){
        p.history = p.history || [];
        p.history.push({ price: old, date:new Date().toISOString() });
        p.price = np;
      }
      persist(); view();
    }
  });
}

function editProductDetails(productId){
  const p = state.products.find(x=>x.id===productId);
  if(!p) return;

  openPromptModal({
    title:"Editar producto",
    fields:[
      {key:"name", label:"Nombre", value:String(p.name||"")},
      {key:"category", label:"Categoría", value:String(p.category||"")},
      {key:"unit", label:"Unidad (u, kg, L)", value:String(p.unit||"u")},
      {key:"price", label:(String(p.unit||"u").toLowerCase().includes("kg") ? "Precio por kg" : "Precio"), type:"number", value:String(p.price||0)},
      {key:"store", label:"Tienda", value:String(p.store||"")},
      {key:"essential", label:"Esencial (1/0)", value:(p.essential? "1":"0")}
    ],
    onSubmit: (vals)=>{
      const name = (vals.name||"").trim();
      if(!name) return;
      p.name = name;
      p.category = (vals.category||"").trim();
      p.unit = (vals.unit||"u").trim() || "u";
      p.store = (vals.store||"").trim();
      p.essential = String(vals.essential||"").trim() !== "0";

      const np = Number(vals.price||0);
      if(Number(p.price||0) !== np){
        p.history = p.history || [];
        p.history.push({ price: Number(p.price||0), date:new Date().toISOString() });
      }
      p.price = np;

      // propagate to inventory items linked by productId
      (state.inventory||[]).forEach(inv=>{
        if(inv.productId===p.id){
          inv.name = p.name;
          inv.category = p.category || inv.category;
          inv.unit = p.unit || inv.unit;
          inv.essential = !!p.essential;
        }
      });

      persist(); view();
    }
  });
}
window.editProductDetails = editProductDetails;


function openProductChart(productId){
  const p = state.products.find(x=>x.id===productId);
  if(!p) return;

  const history = p.history || [];
  const prices = history.map(h=>h.price).concat([p.price]);
  const labels = history.map(h=>new Date(h.date).toLocaleDateString()).concat(["Actual"]);

  const host = document.querySelector("#app");
  const modal = document.createElement("div");
  modal.className = "modalBackdrop";

  modal.innerHTML = `
    <div class="modal">
      <h2>${escapeHtml(p.name)}</h2>
      <canvas id="chart"></canvas>
      <div class="row" style="margin-top:12px;">
        <button class="btn ghost" onclick="this.closest('.modalBackdrop').remove()">Cerrar</button>
      </div>
    </div>
  `;

  host.appendChild(modal);

  const ctx = modal.querySelector("#chart").getContext("2d");
  try{ if(_dailyExpenseChart){ _dailyExpenseChart.destroy(); _dailyExpenseChart=null; } }catch(e){}

  _dailyExpenseChart = new Chart(ctx, {
    type:'line',
    data:{
      labels:labels,
      datasets:[{
        data:prices,
        borderColor:'#7c5cff',
        tension:.3
      }]
    },
    options:{responsive:false, plugins:{legend:{display:false}}}
  });
}

/* ====================== END SHOPPING REBUILD ====================== */



/* ===== Expose shopping functions globally for inline onclick ===== */
window.openProductLibrary = openProductLibrary;
window.openNewProduct = openNewProduct;
window.editProductPrice = editProductPrice;
window.openProductChart = openProductChart;
// Needed because this file runs as a module; inline onclick needs globals.
window.addProductToShoppingList = addProductToShoppingList;
window.openManualItemPrompt = openManualItemPrompt;

/* Render after module definitions */
persist();
view();
// INIT_NEUROCLAW
neuroclawRunNow({ animate:false });


// ---------- Shopping analytics helpers ----------
function isoDate(d=new Date()){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const da=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}

function calcEntryTotals(items){
  const byCategory = {};
  let total = 0;
  for(const it of (items||[])){
    const qty = Math.max(1, Number(it.qty||1));
    const price = Number(it.price||0);
    const cat = (it.category||"Other").trim() || "Other";
    const line = qty*price;
    total += line;
    byCategory[cat] = (byCategory[cat]||0) + line;
  }
  return {
    total: Number(total.toFixed(2)),
    itemsCount: (items||[]).length,
    byCategory
  };
}

function presetRange(preset){
  const end = new Date();
  const start = new Date(end);
  if(preset==="7d") start.setDate(end.getDate()-6);
  else if(preset==="15d") start.setDate(end.getDate()-14);
  else if(preset==="30d") start.setDate(end.getDate()-29);
  else if(preset==="thisMonth"){
    start.setDate(1);
  }else if(preset==="lastMonth"){
    start.setMonth(end.getMonth()-1);
    start.setDate(1);
    end.setMonth(start.getMonth()+1);
    end.setDate(0); // last day of prev month relative to original end
  }else{
    start.setDate(end.getDate()-6);
  }
  return { start: isoDate(start), end: isoDate(end) };
}

function inRange(dateStr, start, end){
  return dateStr >= start && dateStr <= end;
}

function dailySeries(history, start, end){
  // Returns a dense daily series (includes zero-days) between start/end (inclusive).
  const map = new Map();
  for(const e of (history||[])){
    if(!e.date) continue;
    if(!inRange(e.date, start, end)) continue;
    const v = Number(e.totals?.total || e.total || 0);
    map.set(e.date, (map.get(e.date)||0) + v);
  }

  const dates = [];
  const totals = [];
  try{
    const d0 = new Date(start + "T00:00:00");
    const d1 = new Date(end + "T00:00:00");
    for(let d = new Date(d0); d <= d1; d.setDate(d.getDate()+1)){
      const k = isoDate(d);
      dates.push(k);
      totals.push(Number(map.get(k) || 0));
    }
  }catch(e){
    // Fallback: sparse keys
    const ks = [...map.keys()].sort();
    for(const k of ks){
      dates.push(k);
      totals.push(Number(map.get(k) || 0));
    }
  }
  return { dates, totals };
}

function parseIsoDate_(s){
  // s: YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||""));
  if(!m) return null;
  const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
  if(Number.isNaN(d.getTime())) return null;
  return d;
}

function weekStartIso(dateStr){
  const d = parseIsoDate_(dateStr);
  if(!d) return "";
  // Monday as start of week
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0) ? -6 : (1 - day);
  d.setDate(d.getDate() + diff);
  return isoDate(d);
}

function weeklySeries(history, start, end){
  const map = new Map();
  for(const e of (history||[])){
    if(!e.date) continue;
    if(!inRange(e.date, start, end)) continue;
    const wk = weekStartIso(e.date);
    const v = Number(e.totals?.total || 0);
    map.set(wk, (map.get(wk)||0) + v);
  }
  const weeks = [...map.keys()].sort();
  const totals = weeks.map(w=>map.get(w));
  return { weeks, totals };
}

function emergencyBudgetWeekly(history, lookbackWeeks=12){
  // Uses last N weeks (including current) and returns the minimum weekly spend.
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (lookbackWeeks*7 - 1));
  const range = { start: isoDate(start), end: isoDate(end) };
  const w = weeklySeries(history||[], range.start, range.end);
  if(!w.totals.length) return { min:0, minWeek:"", avg:0, range };
  const sum = w.totals.reduce((a,b)=>a+b,0);
  const avg = sum / w.totals.length;
  let min = Infinity, minWeek = "";
  for(let i=0;i<w.totals.length;i++){
    if(w.totals[i] < min){ min = w.totals[i]; minWeek = w.weeks[i]; }
  }
  if(min===Infinity) min = 0;
  return { min, minWeek, avg, range };
}

function summarize(dates, totals){
  const sum = totals.reduce((a,b)=>a+b,0);
  const avg = totals.length ? sum/totals.length : 0;
  let max=-Infinity, maxDate=null;
  let min=Infinity, minDate=null;
  for(let i=0;i<totals.length;i++){
    const v=totals[i];
    if(v>max){ max=v; maxDate=dates[i]; }
    if(v<min){ min=v; minDate=dates[i]; }
  }
  if(max===-Infinity){ max=0; }
  if(min===Infinity){ min=0; }
  return { sum, avg, max, maxDate, min, minDate };
}

function aggregateCategories(history, start, end){
  const byCat = {};
  for(const e of (history||[])){
    if(!e.date) continue;
    if(!inRange(e.date, start, end)) continue;
    const cats = e.totals?.byCategory || {};
    for(const [cat, amt] of Object.entries(cats)){
      byCat[cat] = (byCat[cat]||0) + Number(amt||0);
    }
  }
  return byCat;
}

function topStores(history, start, end, topN=3){
  const map = new Map();
  for(const e of (history||[])){
    if(!e.date) continue;
    if(!inRange(e.date, start, end)) continue;
    const s = (e.store||"").trim();
    if(!s) continue;
    map.set(s, (map.get(s)||0)+1);
  }
  return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0, topN);
}

function topProducts(history, start, end, topN=5){
  const map = new Map(); // key(productId|name)-> {name, count, spend}
  for(const e of (history||[])){
    if(!e.date) continue;
    if(!inRange(e.date, start, end)) continue;
    for(const it of (e.items||[])){
      const name = (it.name||"").trim();
      if(!name) continue;
      const key = (it.productId && String(it.productId).trim()) ? `pid:${String(it.productId).trim()}` : `nm:${name.toLowerCase()}`;
      const qty = Math.max(1, Number(it.qty||1));
      const price = Number(it.price||0);
      const spend = qty*price;
      const prev = map.get(key) || { name, count:0, spend:0 };
      prev.count += qty;
      prev.spend += spend;
      map.set(key, prev);
    }
  }
  return [...map.values()].sort((a,b)=>b.spend-a.spend).slice(0, topN);
}

function normName_(s){
  return String(s||"").toLowerCase().trim().replace(/\s+/g, " ");
}

function applyItemsToInventory_(items){
  state.inventory = Array.isArray(state.inventory) ? state.inventory : [];
  state.products = Array.isArray(state.products) ? state.products : [];

  for(const it of (items||[])){
    const qty = Math.max(1, Number(it.qty||1));
    if(!qty) continue;

    const pid = String(it.productId||"").trim();
    const name = (it.name||"").trim();
    if(!name && !pid) continue;

    const prod = pid ? state.products.find(p=>String(p.id)===pid) : null;
    const unit = (String(it.unit||"").trim() || String(prod?.unit||"").trim() || "u");
    const category = (String(it.category||"").trim() || String(prod?.category||"").trim() || "Other");
    const essential = (typeof it.essential === "boolean") ? it.essential : !!(prod?.essential);

    let inv = null;
    if(pid){
      inv = state.inventory.find(x=>String(x.productId||"").trim()===pid);
    }
    if(!inv){
      const nk = normName_(name);
      inv = state.inventory.find(x=>!String(x.productId||"").trim() && normName_(x.name)===nk);
    }

    if(inv){
      inv.qty = Number(inv.qty||0) + qty;
      if(!inv.unit) inv.unit = unit;
      if(!inv.category) inv.category = category;
      if(essential && !inv.essential) inv.essential = true;
    }else{
      state.inventory.unshift({
        id: uid("inv"),
        productId: pid,
        name: name || (prod?.name||"Item"),
        category,
        qty,
        unit,
        essential,
        minQty: 0,
        notes: ""
      });
    }
  }
}


function ensureInventoryLots_(){
  state.inventoryLots = Array.isArray(state.inventoryLots) ? state.inventoryLots : [];
}

function invLotKey_(it){
  const pid = String(it?.productId||"").trim();
  const name = (it?.name||"").trim();
  if(pid) return `pid:${pid}`;
  return `nm:${normName_(name)}`;
}

function applyItemsToInventoryLots_(items, meta){
  ensureInventoryLots_();
  meta = meta && typeof meta==="object" ? meta : {};
  const boughtAtISO = meta.boughtAtISO || new Date().toISOString();
  const sourceListId = String(meta.sourceListId||"").trim();
  const store = String(meta.store||"").trim();

  for(const it of (items||[])){
    const qty = Math.max(1, Number(it.qty||1));
    if(!qty) continue;

    const pid = String(it.productId||"").trim();
    const name = (it.name||"").trim();
    if(!name && !pid) continue;

    const prod = pid ? (state.products||[]).find(p=>String(p.id)===pid) : null;
    const unit = (String(it.unit||"").trim() || String(prod?.unit||"").trim() || "u");
    const category = (String(it.category||"").trim() || String(prod?.category||"").trim() || "Other");

    state.inventoryLots.unshift({
      id: uid("lot"),
      productId: pid,
      name: name || (prod?.name||"Item"),
      category,
      qty,
      unit,
      boughtAt: boughtAtISO,
      finishedAt: null,
      source: "shopping",
      sourceListId: sourceListId || null,
      store: store || null,
      note: ""
    });
  }
}

function drawLineChart(canvas, labels, values){
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth * (window.devicePixelRatio||1);
  const h = canvas.height = 160 * (window.devicePixelRatio||1);
  ctx.clearRect(0,0,w,h);

  const pad = 18*(window.devicePixelRatio||1);
  const xs = pad, xe = w - pad;
  const ys = pad, ye = h - pad;

  // axes baseline
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = "rgba(255,255,255,.12)";
  ctx.lineWidth = 2*(window.devicePixelRatio||1);
  ctx.beginPath();
  ctx.moveTo(xs, ye);
  ctx.lineTo(xe, ye);
  ctx.stroke();

  const n = values.length;
  if(n===0) return;

  const maxV = Math.max(...values, 1);
  const minV = Math.min(...values, 0);
  const span = (maxV-minV) || 1;

  const xAt = (i)=> xs + ( (xe-xs) * (n===1 ? 0 : i/(n-1)) );
  const yAt = (v)=> ye - ((v-minV)/span) * (ye-ys);

  // line
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(124,92,255,.85)";
  ctx.lineWidth = 3*(window.devicePixelRatio||1);
  ctx.beginPath();
  for(let i=0;i<n;i++){
    const x=xAt(i), y=yAt(values[i]);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();

  // points
  ctx.fillStyle = "rgba(124,92,255,.95)";
  for(let i=0;i<n;i++){
    const x=xAt(i), y=yAt(values[i]);
    ctx.beginPath();
    ctx.arc(x,y,4*(window.devicePixelRatio||1),0,Math.PI*2);
    ctx.fill();
  }
}


function _esDowShort(d){
  // d: Date
  const names = ["dom.","lun.","mar.","mié.","jue.","vie.","sáb."];
  return names[d.getDay()] || "";
}

function drawBarChart(canvas, labels, values, { mode="weekday" } = {}){
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = (window.devicePixelRatio||1);

  // Use fixed logical height, scale by dpr for crispness
  const w = canvas.width = Math.max(1, canvas.clientWidth) * dpr;
  const h = canvas.height = 170 * dpr;
  ctx.clearRect(0,0,w,h);

  const padL = 18*dpr;
  const padR = 12*dpr;
  const padT = 16*dpr;
  const padB = 28*dpr;

  const xs = padL, xe = w - padR;
  const ys = padT, ye = h - padB;

  // baseline
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "rgba(255,255,255,.14)";
  ctx.lineWidth = 2*dpr;
  ctx.beginPath();
  ctx.moveTo(xs, ye);
  ctx.lineTo(xe, ye);
  ctx.stroke();

  const vals = (values||[]).map(v=>Number(v||0));
  const maxV = Math.max(1, ...vals);
  const n = Math.max(1, vals.length);

  const gap = Math.max(4*dpr, Math.min(10*dpr, (xe-xs) / (n*6)));
  const barW = Math.max(6*dpr, Math.min(44*dpr, ((xe-xs) - gap*(n-1)) / n));

  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.font = `${12*dpr}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;

  // bars
  for(let i=0;i<n;i++){
    const v = vals[i];
    const x = xs + i*(barW+gap);
    const bh = (v/maxV) * (ye-ys);
    const y = ye - bh;

    // bar fill (MemoryCarl accent-ish)
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "rgba(255,58,142,.92)";
    const r = Math.min(10*dpr, barW/3, bh/3);
    roundRect(ctx, x, y, barW, bh, r);
    ctx.fill();

    // value label on top (only if >0)
    if(v > 0){
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "rgba(255,255,255,.92)";
      const txt = "S/. " + Math.round(v);
      ctx.fillText(txt, x + barW/2, y - 4*dpr);
    }

    // x label
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "rgba(255,255,255,.70)";
    let lab = labels[i] || "";
    if(mode==="weekday"){
      try{
        const dd = new Date(String(lab) + "T00:00:00");
        lab = _esDowShort(dd);
      }catch(e){}
    }else if(mode==="daynum"){
      try{
        const dd = new Date(String(lab) + "T00:00:00");
        lab = String(dd.getDate());
      }catch(e){}
    }
    ctx.textBaseline = "top";
    ctx.fillText(lab, x + barW/2, ye + 6*dpr);
    ctx.textBaseline = "bottom";
  }
}

// Rounded rect helper used by bar chart
function roundRect(ctx, x, y, w, h, r){
  const rr = Math.max(0, Math.min(r, w/2, h/2));
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}


function openShoppingCategoryModal(category, preset){
  const range = presetRange(preset || (state.shoppingDashPreset||"7d"));
  const start = range.start;
  const end = range.end;

  const host = document.querySelector("#app");
  const modal = document.createElement("div");
  modal.className = "modalBackdrop";

  const rows = {};
  (state.shoppingHistory||[]).forEach(entry=>{
    const d = String(entry.date||"");
    if(d < start || d > end) return;
    (entry.items||[]).forEach(it=>{
      const cat = (it.category||"").trim() || "other";
      if(cat !== category) return;
      const key = (it.productId && String(it.productId).trim()) ? ("p:"+String(it.productId).trim()) : ("n:"+String(it.name||"").trim().toLowerCase());
      if(!rows[key]){
        rows[key] = { key, name: it.name, productId:(it.productId||"").trim(), times:0, qty:0, spent:0, unit:(it.unit||"") };
      }
      const q = Math.max(1, Number(it.qty||1));
      const price = Number(it.price||0);
      rows[key].qty += q;
      rows[key].spent += price * q;
      rows[key].times += 1;
    });
  });

  let arr = Object.values(rows);
  arr.forEach(r=>{
    if(r.productId){
      const p = (state.products||[]).find(x=>x.id===r.productId);
      if(p){
        r.name = p.name || r.name;
        r.unit = p.unit || r.unit;
      }
    }
  });
  arr.sort((a,b)=> (b.spent-a.spent) || (b.times-a.times));

  modal.innerHTML = `
    <div class="modal">
      <div class="cardTop">
        <div>
          <h2 style="margin:0;">Categoría: ${escapeHtml(category)}</h2>
          <div class="small">${escapeHtml(start)} → ${escapeHtml(end)}</div>
        </div>
        <button class="btn ghost" data-x="1">Cerrar</button>
      </div>

      <div class="hr"></div>

      <div class="list">
        ${arr.map(r=>{
          const p = r.productId ? (state.products||[]).find(x=>x.id===r.productId) : null;
          const canEdit = !!p;
          return `
            <div class="item">
              <div class="left">
                <div class="name">${escapeHtml(r.name)}</div>
                <div class="meta"><b>${money(r.spent)}</b> · ${r.times} regs · qty ${Number(r.qty||0)} ${escapeHtml(r.unit||"")}</div>
              </div>
              <div class="row">
                ${canEdit ? `<button class="btn" onclick="editProductDetails('${p.id}')">Editar</button>` : ``}
              </div>
            </div>
          `;
        }).join("") || `<div class="muted">No hay items en esta categoría.</div>`}
      </div>

      <div class="muted" style="margin-top:10px;">
        Tip: para arreglar cosas en <b>other</b>, entra a Biblioteca y edita la categoría/unidad.
      </div>
    </div>
  `;
  host.appendChild(modal);
  modal.querySelector('[data-x="1"]').addEventListener("click", ()=>modal.remove());
  modal.addEventListener("click",(e)=>{ if(e.target===modal) modal.remove(); });
}
window.openShoppingCategoryModal = openShoppingCategoryModal;

function viewShoppingAssistant(){
  const chat = Array.isArray(state.shoppingAiChat) ? state.shoppingAiChat : [];

  // Check if Ollama is configured (same as NeuroChat checks)
  let ollamaEnabled = false;
  try {
    const s = JSON.parse(localStorage.getItem("memorycarl_ollama_settings") || "{}");
    ollamaEnabled = !!(s.enabled && s.apiKey && s.apiKey.trim().length > 10);
  } catch(_){}

  const notConfiguredBanner = !ollamaEnabled ? `
    <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:12px 14px;margin-bottom:12px;font-size:13px;color:rgba(245,158,11,0.9);">
      ⚠️ <b>Ollama Cloud no configurado.</b> Ve a <b>NeuroChat → ⚙️ Configuración</b> y activa Ollama con tu API Key. El Chef AI usa la misma conexión.
    </div>
  ` : "";

  return `
    <div class="sectionTitle" style="margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <button class="iconBtn" onclick="state.shoppingSubtab='lists';view();" title="Volver">‹</button>
        <div>🤖 Chef AI</div>
      </div>
      <div class="chip" style="background:rgba(124,92,255,0.15);color:#a78bfa;">Ollama Cloud</div>
    </div>

    ${notConfiguredBanner}

    <div class="card" style="display:flex;flex-direction:column;height:calc(100vh - 200px);max-height:600px;padding:0;overflow:hidden;">
      <div id="shopAiChatLog" style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;">
        ${chat.length === 0 ? `
          <div style="text-align:center;color:rgba(255,255,255,0.35);margin-top:30px;">
            <div style="font-size:40px;margin-bottom:12px;">🍳</div>
            <div style="font-size:15px;font-weight:600;margin-bottom:6px;color:rgba(255,255,255,0.6);">Chef AI listo</div>
            <div style="font-size:13px;line-height:1.5;">Dime qué comiste hoy y calculo el costo.<br>O pídeme un plan de comidas económico.</div>
          </div>
        ` : chat.map(msg => `
          <div style="display:flex;flex-direction:column;align-items:${msg.role==='user'?'flex-end':'flex-start'};">
            <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:3px;padding:0 4px;">${msg.role==='user'?'Tú':'🤖 Chef AI'}</div>
            <div style="background:${msg.role==='user'?'rgba(124,92,255,0.25)':'rgba(255,255,255,0.06)'};border:1px solid ${msg.role==='user'?'rgba(124,92,255,0.5)':'rgba(255,255,255,0.1)'};padding:10px 13px;border-radius:${msg.role==='user'?'14px 14px 4px 14px':'14px 14px 14px 4px'};max-width:88%;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(msg.content)}</div>
          </div>
        `).join("")}
        <div id="shopAiTyping" style="display:none;color:rgba(255,255,255,0.4);font-size:13px;padding:4px 2px;">🤖 El chef está pensando…</div>
      </div>

      <div style="padding:10px 12px;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:8px;align-items:flex-end;background:rgba(0,0,0,0.15);">
        <textarea id="shopAiMsgInp" class="input" placeholder="Ej: Desayuné 2 huevos y pan bimbo…" style="flex:1;min-height:42px;max-height:120px;resize:none;line-height:1.4;"></textarea>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn" id="btnShopAiSend" style="white-space:nowrap;">Enviar ↵</button>
          ${chat.length > 0 ? `
            <div style="display:flex;gap:6px;">
              <button class="btn good" id="btnShopAiCloseDay" style="font-size:11px;flex:1;padding:6px 0;">Cerrar día ✓</button>
              <button class="btn danger" id="btnShopAiClear" style="font-size:11px;padding:6px 8px;" title="Borrar chat actual">🗑️</button>
            </div>
          ` : ""}
        </div>
      </div>
    </div>
  `;
}

function viewShoppingHistory(){
  const days = Array.isArray(state.shoppingAiDays) ? state.shoppingAiDays : [];
  
  if (days.length === 0) {
    return `
      <div class="sectionTitle" style="margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <button class="iconBtn" onclick="state.shoppingSubtab='lists';view();" title="Volver">‹</button>
          <div>📅 Historial del Chef AI</div>
        </div>
      </div>
      <div class="emptyState" style="margin-top:40px;">
        <div style="font-size:40px;margin-bottom:10px;">📆</div>
        No hay días guardados aún.<br><br>
        Usa el Chef AI y toca "Cerrar día ✓" para guardar tu registro diario.
      </div>
    `;
  }

  // Sort newest first
  const sorted = [...days].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return `
    <div class="sectionTitle" style="margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <button class="iconBtn" onclick="state.shoppingSubtab='lists';view();" title="Volver">‹</button>
        <div>📅 Historial del Chef AI</div>
      </div>
      <div class="chip">${days.length} días</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:12px;">
      ${sorted.map((d, i) => `
        <div class="card" style="padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
            <div style="font-weight:600;color:#c084fc;">${formatDayLabel(d.date)}</div>
            <div style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.8);">S/ ${Number(d.estimatedCost||0).toFixed(2)}</div>
          </div>
          
          <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-bottom:10px;line-height:1.5;">
            ${escapeHtml(d.summary || "Sin resumen.")}
          </div>

          <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px;">Tus notas o correcciones para el AI:</div>
          <textarea class="input shopAiDayNote" data-date="${d.date}" placeholder="Ej: No comí 2 huevos, fueron 3..." style="width:100%;min-height:50px;font-size:13px;margin-bottom:8px;">${escapeHtml(d.editedNotes || "")}</textarea>
          
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:11px;color:rgba(255,255,255,0.4);">${d.messages ? d.messages.length : 0} msgs</div>
            <div style="display:flex;gap:6px;">
              <button class="btn danger" style="padding:4px 8px;font-size:11px;" onclick="if(confirm('¿Borrar registro de este día?')) { state.shoppingAiDays.splice(${state.shoppingAiDays.findIndex(x=>x.date===d.date)},1); persist(); view(); }">Borrar</button>
              <button class="btn good btnSaveDayNote" data-date="${d.date}" style="padding:4px 10px;font-size:11px;">Guardar notas</button>
            </div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}


function viewShoppingDashboard(){
  const preset = state.shoppingDashPreset || "7d";
  const range = presetRange(preset);
  const daily = dailySeries(state.shoppingHistory||[], range.start, range.end);
  const sum = summarize(daily.dates, daily.totals);
  const weekly = weeklySeries(state.shoppingHistory||[], range.start, range.end);
  const weeklySum = summarize(weekly.weeks, weekly.totals);
  const emer = emergencyBudgetWeekly(state.shoppingHistory||[], 12);
  const cats = aggregateCategories(state.shoppingHistory||[], range.start, range.end);
  const stores = topStores(state.shoppingHistory||[], range.start, range.end, 3);
  const products = topProducts(state.shoppingHistory||[], range.start, range.end, 5);

  const catRows = Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>{
    const pct = sum.sum ? (v/sum.sum*100) : 0;
    return `<button class="kvBtn" onclick="openShoppingCategoryModal(\'${escapeHtml(c)}\', \'${preset}\')"><div class="k">${escapeHtml(c)}</div><div class="v"><b>${money(v)}</b> · ${pct.toFixed(0)}%</div></button>`;
  }).join("") || `<div class="muted">No hay datos en este rango.</div>`;

  const storeRows = stores.map(([s,c])=>`<div class="kv"><div class="k">${escapeHtml(s)}</div><div class="v">${c} compras</div></div>`).join("") || `<div class="muted">Sin tiendas.</div>`;
  const prodRows = products.map(p=>`<div class="kv"><div class="k">${escapeHtml(p.name)}</div><div class="v"><b>${money(p.spend)}</b> · ${p.count} u.</div></div>`).join("") || `<div class="muted">Sin productos.</div>`;

  return `
    <div class="sectionTitle">
      <div>Compras · Dashboard</div>
      <button class="btn" data-act="backToShoppingLists">← Volver</button>
    </div>

    <div class="row" style="margin:0 0 12px;">
      <button class="btn ${preset==="7d"?"primary":""}" data-act="setShopDashPreset" data-preset="7d">7D</button>
      <button class="btn ${preset==="15d"?"primary":""}" data-act="setShopDashPreset" data-preset="15d">15D</button>
      <button class="btn ${preset==="30d"?"primary":""}" data-act="setShopDashPreset" data-preset="30d">30D</button>
      <button class="btn ${preset==="thisMonth"?"primary":""}" data-act="setShopDashPreset" data-preset="thisMonth">Este mes</button>
      <button class="btn ${preset==="lastMonth"?"primary":""}" data-act="setShopDashPreset" data-preset="lastMonth">Mes pasado</button>
    </div>

    <section class="card">
      <div class="cardTop">
        <div>
          <h3 class="cardTitle">Gasto diario</h3>
          <div class="small">${escapeHtml(range.start)} → ${escapeHtml(range.end)}</div>
        </div>
        <div class="chip">${daily.dates.length} días</div>
      </div>
      <div class="hr"></div>
      <canvas id="shopDailyChart" class="shopChart" style="width:100%;height:160px"></canvas>
      <div class="hr"></div>
      <div class="kv"><div class="k">Total</div><div class="v"><b>${money(sum.sum)}</b></div></div>
      <div class="kv"><div class="k">Promedio diario</div><div class="v"><b>${money(sum.avg)}</b></div></div>
      <div class="kv"><div class="k">Máximo</div><div class="v"><b>${money(sum.max)}</b> · ${escapeHtml(sum.maxDate||"-")}</div></div>
      <div class="kv"><div class="k">Mínimo</div><div class="v"><b>${money(sum.min)}</b> · ${escapeHtml(sum.minDate||"-")}</div></div>
    </section>

    <section class="card">
      <div class="cardTop">
        <div>
          <h3 class="cardTitle">Vista semanal</h3>
          <div class="small">Agrupado por semana (inicio lunes)</div>
        </div>
        <div class="chip">${weekly.weeks.length} sem</div>
      </div>
      <div class="hr"></div>
      <div class="kv"><div class="k">Total semanal (rango)</div><div class="v"><b>${money(weeklySum.sum)}</b></div></div>
      <div class="kv"><div class="k">Promedio por semana</div><div class="v"><b>${money(weeklySum.avg)}</b></div></div>
      <div class="kv"><div class="k">Semana mínima (rango)</div><div class="v"><b>${money(weeklySum.min)}</b> · ${escapeHtml(weeklySum.minDate||"-")}</div></div>
      <div class="hr"></div>
      <div class="kv"><div class="k">Plan emergencia (mínimo 12 sem)</div><div class="v"><b>${money(emer.min)}</b> · ${escapeHtml(emer.minWeek||"-")}</div></div>
      <div class="muted" style="margin-top:8px;">Tip: si quieres que el plan sea más estricto, marca ⭐ esenciales en Inventario/Biblioteca.</div>
    </section>

    <div class="grid2">
      <section class="card">
        <div class="cardTop">
          <div>
            <h3 class="cardTitle">Categorías</h3>
            <div class="small">Distribución por monto</div>
          </div>
        </div>
        <div class="hr"></div>
        ${catRows}
      </section>

      <section class="card">
        <div class="cardTop">
          <div>
            <h3 class="cardTitle">Tiendas frecuentes</h3>
            <div class="small">Top 3</div>
          </div>
        </div>
        <div class="hr"></div>
        ${storeRows}
      </section>
    </div>

    <section class="card">
      <div class="cardTop">
        <div>
          <h3 class="cardTitle">Top productos</h3>
          <div class="small">Top 5 por gasto</div>
        </div>
      </div>
      <div class="hr"></div>
      ${prodRows}
    </section>
  `;
}

// draw chart after each render when dashboard is visible
const _viewBase = view;
view = function(){
  _viewBase();
  try{
    if(state.tab==="shopping" && (state.shoppingSubtab||"lists")==="dashboard"){
      const preset = state.shoppingDashPreset || "7d";
      const range = presetRange(preset);
      const daily = dailySeries(state.shoppingHistory||[], range.start, range.end);
      const canvas = document.getElementById("shopDailyChart");
      drawBarChart(canvas, daily.dates, daily.totals, { mode: (preset==="30d"||preset==="thisMonth"||preset==="lastMonth") ? "daynum" : "weekday" });
    }
  }catch(e){
    console.warn("Dashboard chart render failed", e);
  }
};


// ====================== MERGE GAME INTEGRATION ======================
function openMergeGameFull(){
  const container = document.getElementById("mergeContainer");
  if(!container) return;

  container.style.display = "block";
  container.style.position = "fixed";
  container.style.inset = "0";
  container.style.width = "100vw";
  container.style.height = "100vh";
  container.style.background = "#0B0F19";
  container.style.zIndex = "9999";

  // Ensure scripts are present even if the initial load order was blocked or cached oddly (mobile Brave can do this).
  async function loadScriptOnce(src){
    return new Promise((resolve, reject)=>{
      // Already loaded?
      const existing = Array.from(document.scripts||[]).find(s => (s.src||"").includes(src));
      if(existing) return resolve(true);
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = ()=> resolve(true);
      s.onerror = (e)=> reject(e);
      document.head.appendChild(s);
    });
  }

  async function ensureMergeDeps(){
    // Matter.js might be blocked by Brave Shields when loaded from CDN. If so, we can't run the game.
    if(typeof window.Matter === "undefined"){
      try{
        // Try a secondary CDN as a best-effort fallback.
        await loadScriptOnce("https://unpkg.com/matter-js@0.19.0/build/matter.min.js");
      }catch(e){}
    }

    if(typeof window.initMergeGame !== "function"){
      try{
        await loadScriptOnce("./src/merge/merge.js");
      }catch(e){}
    }

    return (typeof window.initMergeGame === "function") && (typeof window.Matter !== "undefined");
  }

  // Force a reflow, then init on the next frame so measurements are correct.
  void container.offsetHeight;

  ensureMergeDeps().then((ok)=>{
    if(ok){
      requestAnimationFrame(()=> window.initMergeGame("mergeContainer"));
    }else{
      console.warn("MergeLab deps missing. If you're on Brave mobile, disable Shields for this site to allow matter-js.");
      container.innerHTML = `
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:#fff;font-family:system-ui;background:#0B0F19;">
          <div style="max-width:520px">
            <div style="font-size:18px;font-weight:700;margin-bottom:10px">Merge Lab no pudo cargar</div>
            <div style="opacity:.85;line-height:1.35">
              Tu navegador bloqueó el motor del juego (Matter.js). En Brave móvil, suele ser por Shields.
              <br><br>
              Prueba: <b>Brave Shields → Off</b> para este sitio, y recarga.
            </div>
            <div style="margin-top:14px;opacity:.7;font-size:12px">v7.10</div>
          </div>
        </div>`;
    }
  }).catch((e)=>{
    console.warn("MergeLab deps load failed", e);
  });

  document.addEventListener("keydown", escCloseMerge);
}

function escCloseMerge(e){
  if(e.key === "Escape"){
    closeMergeGameFull();
  }
}

function closeMergeGameFull(){
  const container = document.getElementById("mergeContainer");
  if(!container) return;

  container.innerHTML = "";
  container.style.display = "none";
  document.removeEventListener("keydown", escCloseMerge);
}

// Back-compat aliases (in case any onclick uses old names)
window.openMergeGameFull = openMergeGameFull;
window.closeMergeGameFull = closeMergeGameFull;
window.openMergeGame = openMergeGameFull;
window.closeMergeGame = closeMergeGameFull;
function openMergeGame(){ return openMergeGameFull(); }
function closeMergeGame(){ return closeMergeGameFull(); }

// Event delegation for the Home button 🎮
document.addEventListener("click", function(e){
  const btn = e.target.closest("#btnOpenMergeGame");
  if(btn){
    openMergeGameFull();
  }
});

// ====================== INVENTORY DELEGATED EVENTS ======================
// Handles data-inv-act, data-inv-cat, data-inv-pick — these have no data-act
// so wireActions never catches them. This listener covers the whole document.
document.addEventListener("click", function(e){

  // --- Category chips (slCat buttons with data-inv-cat) ---
  const catBtn = e.target.closest("[data-inv-cat]");
  if(catBtn){
    state.invCat = catBtn.dataset.invCat;
    view();
    return;
  }

  // --- Action buttons inside inventory cards (data-inv-act) ---
  const actBtn = e.target.closest("[data-inv-act]");
  if(actBtn){
    const act = actBtn.dataset.invAct;
    if(act==="toList"){   addInventoryToList(actBtn.dataset.iid); return; }
    if(act==="finish"){   openFinishLotModal(actBtn.dataset.pkey); return; }
    if(act==="edit"){     editInventoryItem(actBtn.dataset.iid); return; }
    if(act==="setPct"){   openInvPctModal(actBtn.dataset.iid); return; }
    if(act==="addFromLib"){ openInvAddFromLibModal(); return; }
    if(act==="clearCocina"){
      if(!confirm("¿Limpiar toda la cocina? Esto borra todos los productos y lotes. No se puede deshacer.")) return;
      state.inventory = [];
      state.inventoryLots = [];
      persist();
      toast("Cocina limpia 🧹");
      view();
      return;
    }
    if(act==="filterUrgent"){
      state.invQuery=""; state.invCat="";
      view(); return;
    }
  }

  // --- Product picker inside openInvAddFromLibModal (data-inv-pick) ---
  // (handled inside the modal itself, no action needed here)
});

// ====================== END MERGE GAME ======================



function openMergeCfgModal(){
  const existing = document.querySelector("#mergeCfgBackdrop");
  if(existing) existing.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "modalBackdrop";
  backdrop.id = "mergeCfgBackdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h2>Merge Lab Config (JSON)</h2>
      <div class="small muted">Se aplica al abrir el juego. Si el JSON está mal, se ignora.</div>
      <div class="grid" style="margin-top:10px;">
        <textarea id="mergeCfgText" class="input" style="height:260px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;"></textarea>
        <div class="row" style="margin:0; justify-content:flex-end;">
          <button class="btn" id="mergeCfgCancel">Cerrar</button>
          <button class="btn primary" id="mergeCfgSave">Guardar</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const ta = backdrop.querySelector("#mergeCfgText");
  const local = localStorage.getItem("mc_merge_cfg_override");
  if(local){
    ta.value = local;
  }else{
    // load default file for convenience
    fetch("./src/merge/merge_config.json").then(r=>r.text()).then(t=>ta.value=t).catch(()=>{
      ta.value = JSON.stringify({spawnPool:4, background:"./src/merge/assets/bg.png", items:[]}, null, 2);
    });
  }

  function close(){
    backdrop.remove();
  }

  backdrop.addEventListener("click", (e)=>{
    if(e.target === backdrop) close();
  });

  backdrop.querySelector("#mergeCfgCancel").addEventListener("click", close);

  backdrop.querySelector("#mergeCfgSave").addEventListener("click", ()=>{
    try{
      const parsed = JSON.parse(ta.value);
      localStorage.setItem("mc_merge_cfg_override", JSON.stringify(parsed, null, 2));
      toast("✅ Merge config guardada");
      close();
    }catch(err){
      toast("❌ JSON inválido");
    }
  });
}

// ====================== MERGE LAB: SPRITE MANAGER (IndexedDB) ======================
const MC_SPR_DB = { name: "mc_merge_sprites_db", store: "sprites", ver: 1 };

function mcSpriteIdbOpen(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(MC_SPR_DB.name, MC_SPR_DB.ver);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains(MC_SPR_DB.store)){
        db.createObjectStore(MC_SPR_DB.store, { keyPath: "id" });
      }
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

async function mcSpriteIdbPut(id, blob, meta={}){
  const db = await mcSpriteIdbOpen();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(MC_SPR_DB.store, "readwrite");
    const st = tx.objectStore(MC_SPR_DB.store);
    const req = st.put({ id, blob, meta, updatedAt: Date.now() });
    req.onsuccess = ()=>resolve(true);
    req.onerror = ()=>reject(req.error);
  });
}

async function mcSpriteIdbGetAll(){
  try{
    const db = await mcSpriteIdbOpen();
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(MC_SPR_DB.store, "readonly");
      const st = tx.objectStore(MC_SPR_DB.store);
      const req = st.getAll();
      req.onsuccess = ()=>resolve(req.result || []);
      req.onerror = ()=>reject(req.error);
    });
  }catch(e){ return []; }
}

async function mcSpriteIdbClear(){
  try{
    const db = await mcSpriteIdbOpen();
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(MC_SPR_DB.store, "readwrite");
      const st = tx.objectStore(MC_SPR_DB.store);
      const req = st.clear();
      req.onsuccess = ()=>resolve(true);
      req.onerror = ()=>reject(req.error);
    });
  }catch(e){ return false; }
}

function blobToDataURL(blob){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>resolve(fr.result);
    fr.onerror = ()=>reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataURL){
  const parts = String(dataURL||"").split(",");
  const meta = parts[0] || "";
  const b64 = parts[1] || "";
  const mime = (meta.match(/data:(.*?);base64/)||[])[1] || "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function exportSpritePack(){
  const rows = await mcSpriteIdbGetAll();
  const out = [];
  for(const r of rows){
    const dataURL = await blobToDataURL(r.blob);
    out.push({ id: r.id, dataURL, meta: r.meta || {}, updatedAt: r.updatedAt || Date.now() });
  }
  const pack = { kind:"mc_merge_sprite_pack", version:"v7.6", exportedAt: new Date().toISOString(), items: out };
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `merge_sprites_pack_${Date.now()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}

async function importSpritePack(file){
  const txt = await file.text();
  const pack = JSON.parse(txt);
  if(!pack || pack.kind !== "mc_merge_sprite_pack" || !Array.isArray(pack.items)) throw new Error("Invalid pack");
  for(const it of pack.items){
    if(!it.id || !it.dataURL) continue;
    const blob = dataURLToBlob(it.dataURL);
    await mcSpriteIdbPut(String(it.id), blob, it.meta || {});
  }
  toast("✅ Pack importado");
}

function openMergeSpriteManagerModal(){
  const existing = document.querySelector("#mergeSpritesBackdrop");
  if(existing) existing.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "modalBackdrop";
  backdrop.id = "mergeSpritesBackdrop";

  backdrop.innerHTML = `
    <div class="modal">
      <h2>Sprite Manager (Merge Lab) <span class="chip">v7.6</span></h2>
      <div class="small muted">Sube tus PNG (10/11 items). Se guarda en este dispositivo (IndexedDB).</div>

      <div class="grid" style="margin-top:10px; gap:10px;">
        <div class="row" style="margin:0; align-items:center; gap:8px;">
          <label class="small" style="opacity:.85;">Slots</label>
          <select id="mcSprCount" class="input" style="width:110px;">
            <option value="10">10 items</option>
            <option value="11" selected>11 items</option>
          </select>

          <input id="mcSprFiles" type="file" class="input" multiple accept="image/png,image/webp,image/jpeg" webkitdirectory directory style="flex:1;" />
        </div>

        <div id="mcSprGrid" class="grid" style="grid-template-columns:repeat(3, 1fr); gap:10px;"></div>

        <div class="row" style="margin:0; justify-content:space-between; flex-wrap:wrap; gap:8px;">
          <div class="row" style="margin:0; gap:8px;">
            <button class="btn" id="mcSprExport">Export pack</button>
            <label class="btn" style="display:inline-flex; align-items:center; gap:8px; cursor:pointer;">
              Import pack
              <input id="mcSprImport" type="file" accept="application/json" style="display:none;">
            </label>
          </div>
          <div class="row" style="margin:0; gap:8px;">
            <button class="btn" id="mcSprClose">Cerrar</button>
            <button class="btn primary" id="mcSprApply">Guardar</button>
          </div>
        </div>

        <div class="note">
          Tip: Si eliges una carpeta, nombra tus archivos <span class="mono">item_0.png ... item_10.png</span> para que se auto-asignen.
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const grid = backdrop.querySelector("#mcSprGrid");
  const selCount = backdrop.querySelector("#mcSprCount");
  const fileInput = backdrop.querySelector("#mcSprFiles");

  const state = { count: 11, slots: [] };

  function mkSlot(i, url=null){
    return `
      <div class="card" style="padding:10px;">
        <div class="row" style="margin:0; justify-content:space-between; align-items:center;">
          <div class="small muted">Item ${i}</div>
          <div class="chip mono">item_${i}</div>
        </div>
        <div class="hr"></div>
        <div style="display:flex; justify-content:center; align-items:center; height:86px;">
          <div style="width:72px; height:72px; border-radius:18px; border:1px solid rgba(255,255,255,.12);
            background:${url?`url(${url}) center/contain no-repeat`:"rgba(255,255,255,.04)"};">
          </div>
        </div>
      </div>
    `;
  }

  async function refreshFromDb(){
    const rows = await mcSpriteIdbGetAll();
    const map = new Map(rows.map(r=>[r.id, r]));
    state.slots = [];
    for(let i=0;i<state.count;i++){
      const row = map.get(`sprite:item_${i}`);
      if(row && row.blob){
        const url = URL.createObjectURL(row.blob);
        state.slots.push({ i, blob: row.blob, url, fromDb:true });
      }else{
        state.slots.push({ i, blob: null, url: null, fromDb:false });
      }
    }
    renderGrid();
  }

  function clearTempUrls(){
    try{
      state.slots.forEach(s=>{ if(s.url && !s.fromDb) URL.revokeObjectURL(s.url); });
    }catch(e){}
  }

  function renderGrid(){
    grid.innerHTML = state.slots.map(s=>mkSlot(s.i, s.url)).join("");
  }

  async function close(){
    clearTempUrls();
    backdrop.remove();
  }

  backdrop.addEventListener("click", (e)=>{ if(e.target === backdrop) close(); });
  backdrop.querySelector("#mcSprClose").addEventListener("click", close);

  // events
  selCount.addEventListener("change", async ()=>{
    state.count = parseInt(selCount.value,10) || 11;
    await refreshFromDb();
  });

  fileInput.addEventListener("change", async ()=>{
    const files = Array.from(fileInput.files||[]);
    if(!files.length) return;

    // Try map by item_N in filename; else assign sequentially by name sort
    const byName = new Map();
    for(const f of files){
      const m = f.name.match(/item[_-]?(\d+)/i);
      if(m) byName.set(parseInt(m[1],10), f);
    }
    const sorted = files.slice().sort((a,b)=>a.name.localeCompare(b.name));
    let seqIdx = 0;

    for(let i=0;i<state.count;i++){
      const f = byName.get(i) || sorted[seqIdx++] || null;
      if(!f) continue;
      const blob = f;
      // decode friendly: keep as file blob
      const url = URL.createObjectURL(blob);
      const slot = state.slots.find(s=>s.i===i);
      if(slot && slot.url && !slot.fromDb) URL.revokeObjectURL(slot.url);
      if(slot){
        slot.blob = blob;
        slot.url = url;
        slot.fromDb = false;
      }
    }
    renderGrid();
    toast("📦 Sprites cargados (preview)");
  });

  backdrop.querySelector("#mcSprExport").addEventListener("click", exportSpritePack);

  const imp = backdrop.querySelector("#mcSprImport");
  imp.addEventListener("change", async ()=>{
    const f = imp.files?.[0];
    if(!f) return;
    try{
      await importSpritePack(f);
      await refreshFromDb();
    }catch(e){
      toast("❌ Pack inválido");
      console.error(e);
    }finally{
      imp.value = "";
    }
  });

  backdrop.querySelector("#mcSprApply").addEventListener("click", async ()=>{
    // store blobs
    let saved = 0;
    for(const s of state.slots){
      if(s.blob){
        await mcSpriteIdbPut(`sprite:item_${s.i}`, s.blob, { name: (s.blob.name||`item_${s.i}`) });
        saved++;
      }
    }
    // persist desired count in merge config override (optional)
    try{
      const raw = localStorage.getItem("mc_merge_cfg_override");
      if(raw){
        const cfg = JSON.parse(raw);
        cfg.items = cfg.items || [];
        cfg.version = "v7.6";
        localStorage.setItem("mc_merge_cfg_override", JSON.stringify(cfg, null, 2));
      }
    }catch(e){}
    toast(`✅ Guardado (${saved})`);
    close();
    // Suggest reload game to apply
    toast("Tip: cierra y abre el juego para aplicar");
  });

  // initial
  state.count = 11;
  refreshFromDb();
}
// ====================== END SPRITE MANAGER ======================

/* ====================== FINANCE TAB ====================== */

LS.financeLedger = "memorycarl_v2_finance_ledger";
LS.financeAccounts = "memorycarl_v2_finance_accounts";
LS.financeResetAt = "memorycarl_v2_finance_resetAt";
LS.financeDebts = "memorycarl_v2_finance_debts";
LS.financeCommitments = "memorycarl_v2_finance_commitments";
LS.financeObligations = "memorycarl_v2_finance_obligations";
LS.financePaymentSources = "memorycarl_v2_finance_payment_sources";
LS.financeTransactions = "memorycarl_v2_finance_transactions";
LS.financeInternalBalances = "memorycarl_v2_finance_internal_balances";
LS.financeInsights = "memorycarl_v2_finance_insights";
LS.financeSchemaVersion = "memorycarl_v2_finance_schema_version";
LS.financeCommitmentTemplates = "memorycarl_v2_finance_commitment_templates";
LS.financeCommitmentInstances = "memorycarl_v2_finance_commitment_instances";
LS.financeLoanUsageLedger = "memorycarl_v2_finance_loan_usage_ledger";
LS.financeRoadmap = "memorycarl_v2_finance_roadmap";

state.financeLedger = load(LS.financeLedger, []);
state.financeAccounts = load(LS.financeAccounts, []);
state.financeResetAt = load(LS.financeResetAt, null);
state.financeDebts = load(LS.financeDebts, []);
state.financeCommitments = load(LS.financeCommitments, []);
state.financeObligations = load(LS.financeObligations, []);
state.financePaymentSources = load(LS.financePaymentSources, []);
state.financeTransactions = load(LS.financeTransactions, []);
state.financeInternalBalances = load(LS.financeInternalBalances, []);
state.financeInsights = load(LS.financeInsights, []);
state.financeSchemaVersion = load(LS.financeSchemaVersion, 1);
state.financeCommitmentTemplates = load(LS.financeCommitmentTemplates, []);
state.financeCommitmentInstances = load(LS.financeCommitmentInstances, []);
state.financeLoanUsageLedger = load(LS.financeLoanUsageLedger, []);
state.financeRoadmap = load(LS.financeRoadmap, {});


// Quick finance wipe via URL: ?finreset=1 (useful when you want to start clean)
try{
  const qs = new URLSearchParams(location.search||"");
  if(qs.get("finreset")==="1"){
    // wipe only finance keys; keep rest of app
    state.financeLedger = [];
    state.financeAccounts = [];
    state.financeResetAt = isoDate(new Date());
    state.financeBaselineAt = isoDate(new Date());
    state.financeMonthOffset = 0;
    // do not auto-clear meta
    persist();
  }
}catch(e){}

const _persistFinanceWrap = persist;
persist = function(){
  _persistFinanceWrap();
  save(LS.financeLedger, state.financeLedger);
  save(LS.financeAccounts, state.financeAccounts);
  save(LS.financeResetAt, state.financeResetAt);
  try{ save(LS.financeDebts, state.financeDebts); }catch(_e){}
  try{ save(LS.financeObligations, state.financeObligations||[]); }catch(_e){}
  try{ save(LS.financePaymentSources, state.financePaymentSources||[]); }catch(_e){}
  try{ save(LS.financeTransactions, state.financeTransactions||[]); }catch(_e){}
  try{ save(LS.financeInternalBalances, state.financeInternalBalances||[]); }catch(_e){}
  try{ save(LS.financeInsights, state.financeInsights||[]); }catch(_e){}
  try{ save(LS.financeSchemaVersion, Number(state.financeSchemaVersion||2)); }catch(_e){}
  try{ save(LS.financeCommitmentTemplates, state.financeCommitmentTemplates||[]); }catch(_e){}
  try{ save(LS.financeCommitmentInstances, state.financeCommitmentInstances||[]); }catch(_e){}
  try{ save(LS.financeLoanUsageLedger, state.financeLoanUsageLedger||[]); }catch(_e){}
  try{ save(LS.financeMeta, state.financeMeta); }catch(_e){}
  try{ save(LS.financeCategories, state.financeCategories); }catch(_e){}
  try{ save(LS.financeRoadmap, state.financeRoadmap||{}); }catch(_e){}
  try{ localStorage.setItem("memorycarl_v2_finance_projection_mode", String(state.financeProjectionMode||"normal")); }catch(_e){}
};



/* ===== Finance: balances derived + reset-to-zero (keeps history archived) ===== */

function financeMigrateV2(){
  // accounts: add initialBalance + defaults if missing
  (state.financeAccounts||[]).forEach(a=>{
    if(a.initialBalance === undefined || a.initialBalance === null){
      // preserve current balance as baseline so nothing "breaks" after update
      a.initialBalance = Number(a.balance||0);
    }
    if(!a.type) a.type = "bank";
    if(a.color === undefined) a.color = null;
    if(!a.createdAt) a.createdAt = new Date().toISOString();
  });

  // ledger: add archived flag if missing
  (state.financeLedger||[]).forEach(e=>{
    if(e.archived === undefined) e.archived = false;
    if(e.reason === undefined) e.reason = "normal";
  });

  if(state.financeResetAt === undefined) state.financeResetAt = null;
  if(state.financeBaselineAt === undefined) state.financeBaselineAt = null;

  // debts: defaults
  if(!Array.isArray(state.financeDebts)) state.financeDebts = [];
  (state.financeDebts||[]).forEach(d=>{
    if(!d.id) d.id = uid("debt_");
    if(!d.name) d.name = "Deuda";
    if(d.balance === undefined || d.balance === null) d.balance = Number(d.originalBalance||0);
    if(d.originalBalance === undefined || d.originalBalance === null) d.originalBalance = Number(d.balance||0);
    if(!d.provider) d.provider = "";
    if(!d.type) d.type = "loan"; // loan | card | app
    if(d.apr === undefined) d.apr = null;
    if(d.monthlyDue === undefined || d.monthlyDue === null) d.monthlyDue = 0;
    if(d.dueDay === undefined || d.dueDay === null) d.dueDay = 30;
    if(!d.status) d.status = (Number(d.balance||0) <= 0 ? "closed" : "active");
    if(!d.createdAt) d.createdAt = new Date().toISOString();
  });

  if(!Array.isArray(state.financeCommitmentTemplates)) state.financeCommitmentTemplates = [];
  if(!Array.isArray(state.financeCommitmentInstances)) state.financeCommitmentInstances = [];
  if(!Array.isArray(state.financeLoanUsageLedger)) state.financeLoanUsageLedger = [];

  persist();
}

function financeEnsureMissionControlStructures(){
  if(!Array.isArray(state.financeObligations)) state.financeObligations = [];
  if(!Array.isArray(state.financePaymentSources)) state.financePaymentSources = [];
  if(!Array.isArray(state.financeTransactions)) state.financeTransactions = [];
  if(!Array.isArray(state.financeInternalBalances)) state.financeInternalBalances = [];
  if(!Array.isArray(state.financeInsights)) state.financeInsights = [];

  if(!(state.financePaymentSources||[]).length){
    state.financePaymentSources = [
      { id: uid("fps"), name:"Efectivo", sourceType:"cash", owner:"me", affectsMyCashflow:true, createsInternalDebt:false, isActive:true },
      { id: uid("fps"), name:"Cuenta bancaria", sourceType:"bank", owner:"me", affectsMyCashflow:true, createsInternalDebt:false, isActive:true },
      { id: uid("fps"), name:"Tarjeta propia", sourceType:"credit_card", owner:"me", affectsMyCashflow:false, createsInternalDebt:false, isActive:true },
      { id: uid("fps"), name:"Tarjeta esposa", sourceType:"credit_card", owner:"wife", affectsMyCashflow:false, createsInternalDebt:true, isActive:true },
      { id: uid("fps"), name:"Tercero", sourceType:"third_party", owner:"other", affectsMyCashflow:false, createsInternalDebt:true, isActive:true }
    ];
  }

  if(!(state.financeObligations||[]).length && Array.isArray(state.financeCommitments)){
    state.financeObligations = state.financeCommitments.map(c=>({
      id: c.id || uid("obl"),
      name: c.name || "Compromiso",
      category: c.group || "General",
      type: "essential_fixed",
      amountExpected: Number(c.amount||0),
      dueDate: Number(c.dueDay||1),
      recurrence: "monthly",
      priority: "high",
      isActive: c.active!==false,
      status: "pending",
      notes: c.note || "",
      legacyCommitmentId: c.id || null
    }));
  }

  if(!(state.financeTransactions||[]).length && Array.isArray(state.financeLedger)){
    state.financeTransactions = state.financeLedger.map(e=>({
      id: e.id || uid("txn"),
      date: e.date || new Date().toISOString(),
      amount: Number(e.amount||0),
      direction: e.type === "income" ? "inflow" : "outflow",
      obligationId: null,
      sourceId: null,
      paidBy: "me",
      responsibleParty: "me",
      impactMode: e.type === "income" ? "income" : "direct_expense",
      notes: e.note || "",
      tags: [],
      archived: !!e.archived,
      legacyLedgerId: e.id || null
    }));
  }

  state.financeSchemaVersion = 3;
}

function financeGetMonthKeyFromIso(iso){
  const d = new Date(iso || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  return `${y}-${m}`;
}

function financeMissionControlModel(monthKey){
  financeEnsureMissionControlStructures();
  const mk = monthKey || getCurrentMonthKey();
  const tx = (state.financeTransactions||[]).filter(t=> financeGetMonthKeyFromIso(t.date)===mk && !t.archived);
  const incomeConfirmed = tx.filter(t=>t.direction==='inflow').reduce((s,t)=>s+Number(t.amount||0),0);
  const paidNow = tx.filter(t=>t.direction==='outflow').reduce((s,t)=>s+Number(t.amount||0),0);
  const obligations = (state.financeObligations||[]).filter(o=>o.isActive!==false);
  const obligationsMonth = obligations.reduce((s,o)=>s+Number(o.amountExpected||0),0);
  const pending = Math.max(0, obligationsMonth - paidNow);
  const foreignUse = tx.filter(t=>String(t.impactMode||'').includes('internal_debt')).reduce((s,t)=>s+Number(t.amount||0),0);
  const internalDebt = (state.financeInternalBalances||[]).filter(b=>b.balanceType==='owed_by_me').reduce((s,b)=>s+Number(b.currentAmount||0),0);
  const realAvailable = (state.financeAccounts||[]).reduce((s,a)=>s+Number(a.balance||0),0);
  const essential = obligations.filter(o=>String(o.type||'').includes('essential') || String(o.type||'').includes('debt')).reduce((s,o)=>s+Number(o.amountExpected||0),0);
  const margin = incomeConfirmed - essential;
  const riskScore = pending > incomeConfirmed ? 'ALTO' : (pending > incomeConfirmed*0.6 ? 'MEDIO' : 'BAJO');

  const upcoming = obligations.map(o=>{
    const day = Number(o.dueDate||1);
    const due = new Date(`${mk}-${String(Math.max(1,Math.min(31,day))).padStart(2,'0')}T12:00:00`);
    const diff = Math.ceil((due.getTime()-Date.now())/(24*60*60*1000));
    const bucket = diff<=0 ? 'hoy' : (diff<=7?'esta semana':(diff<=14?'urgente':'postergable'));
    return {...o, due, bucket};
  }).sort((a,b)=>a.due-b.due);

  return {mk,incomeConfirmed,obligationsMonth,paidNow,pending,realAvailable,foreignUse,internalDebt,margin,riskScore,upcoming,tx};
}

function financeGenerateInsights(monthKey){
  const m = financeMissionControlModel(monthKey);
  const list = [];
  if(m.upcoming.length){
    const u = m.upcoming[0];
    list.push({ id: uid('ins'), createdAt:new Date().toISOString(), level:'warning', title:'Prioridad inmediata', message:`Esta semana tu prioridad es cubrir ${u.name} (S/ ${_financeFmt(u.amountExpected)}).`, relatedIds:[u.id], status:'open' });
  }
  if(m.foreignUse>0){
    list.push({ id: uid('ins'), createdAt:new Date().toISOString(), level:'urgent', title:'Uso de dinero ajeno', message:`Ya cargaste S/ ${_financeFmt(m.foreignUse)} a fuentes de terceros este mes.`, relatedIds:[], status:'open' });
  }
  list.push({ id: uid('ins'), createdAt:new Date().toISOString(), level:(m.margin<0?'urgent':'info'), title:'Margen real del mes', message:`Tu margen real después de esenciales es S/ ${_financeFmt(m.margin)}.`, relatedIds:[], status:'open' });
  state.financeInsights = list;
  return list;
}

function financePreviewImpact({amount,impactMode,sourceId,responsibleParty}){
  const src = (state.financePaymentSources||[]).find(s=>s.id===sourceId);
  const amt = Number(amount||0);
  if((impactMode==='internal_debt') || (src && src.createsInternalDebt) || (responsibleParty && responsibleParty!=='me')){
    return `Esto NO reducirá tu caja real ahora, pero aumentará tu deuda interna en S/ ${_financeFmt(amt)}.`;
  }
  if(impactMode==='income') return `Esto aumentará tu caja real en S/ ${_financeFmt(amt)}.`;
  return `Esto reducirá tu caja real en S/ ${_financeFmt(amt)}.`;
}

function financeUpsertInternalBalance(personKey, delta){
  if(!personKey || !delta) return;
  const idx = (state.financeInternalBalances||[]).findIndex(b=>b.personKey===personKey && b.balanceType==='owed_by_me');
  if(idx===-1){
    state.financeInternalBalances.unshift({ id:uid('ib'), personKey, balanceType:'owed_by_me', currentAmount:Number(delta||0), updatedAt:new Date().toISOString(), notes:'' });
  }else{
    state.financeInternalBalances[idx].currentAmount = Number(state.financeInternalBalances[idx].currentAmount||0)+Number(delta||0);
    state.financeInternalBalances[idx].updatedAt = new Date().toISOString();
  }
}

function financeAddUnifiedTransaction(tx){
  financeEnsureMissionControlStructures();
  const item = {
    id: uid('txn'),
    date: tx.date || new Date().toISOString(),
    amount: financeParseAmount(tx.amount),
    direction: tx.direction || 'outflow',
    obligationId: tx.obligationId || null,
    sourceId: tx.sourceId || null,
    paidBy: tx.paidBy || 'me',
    responsibleParty: tx.responsibleParty || 'me',
    impactMode: tx.impactMode || (tx.direction==='inflow'?'income':'direct_expense'),
    notes: tx.notes || '',
    tags: Array.isArray(tx.tags)?tx.tags:[],
    archived:false
  };
  state.financeTransactions.unshift(item);
  if(item.direction==='outflow' && item.impactMode==='internal_debt'){
    const person = item.paidBy==='wife' ? 'wife' : (item.paidBy||'other');
    financeUpsertInternalBalance(person, item.amount);
  }
  persist();
  return item;
}

function financeSyncLedgerToUnified(entry){
  if(!entry || entry.__skipUnifiedSync) return;
  financeAddUnifiedTransaction({
    id: uid('txn'),
    date: entry.date,
    amount: entry.amount,
    direction: entry.type==='income'?'inflow':'outflow',
    paidBy:'me',
    responsibleParty:'me',
    impactMode: entry.type==='income'?'income':'direct_expense',
    notes: entry.note || '',
    tags:[entry.category||'']
  });
}

function financeParseAmount(raw){
  // Robust parse for mobile/desktop:
  // "42" => 42
  // "42,50" => 42.5
  // "S/ 1,234.56" => 1234.56
  // "1.234,56" => 1234.56
  if(raw === null || raw === undefined) return 0;
  let v = String(raw).trim();
  if(!v) return 0;

  // Keep digits, separators and minus
  v = v.replace(/[^0-9,\.\-]/g, "");

  const hasComma = v.includes(",");
  const hasDot = v.includes(".");

  if(hasComma && hasDot){
    // Decide last separator as decimal
    const lastComma = v.lastIndexOf(",");
    const lastDot = v.lastIndexOf(".");
    if(lastComma > lastDot){
      // comma decimal, dots thousands
      v = v.replace(/\./g, "");
      v = v.replace(/,/g, ".");
    }else{
      // dot decimal, commas thousands
      v = v.replace(/,/g, "");
    }
  }else if(hasComma){
    // comma decimal
    v = v.replace(/,/g, ".");
  }
  // else: dot or plain digits OK

  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function financeNormalizeType(t){
  const s = String(t||"").toLowerCase().trim();
  if(["income","ingreso","in","+","plus","entrada"].includes(s)) return "income";
  if(["expense","gasto","out","-","minus","salida"].includes(s)) return "expense";
  // Default: expense to avoid silently inflating balances
  return s || "expense";
}

// Sanitize imported ledger entries so charts work and mobile parsing stays consistent.
// Optionally detach entries from accounts so imported history does not affect balances.
function financeSanitizeImportedLedger(list, opts){
  const detachAccounts = !!(opts && opts.detachAccounts);
  const out = [];
  (Array.isArray(list)?list:[]).forEach(raw=>{
    if(!raw || typeof raw !== "object") return;
    const e = {...raw};
    e.id ||= uid("fin");
    e.type = financeNormalizeType(e.type);
    e.amount = financeParseAmount(e.amount);
    // keep date as string; charts use slice(0,10)
    e.date = (e.date ? String(e.date) : new Date().toISOString());
    e.archived = !!e.archived;
    if(detachAccounts){
      delete e.accountId;
      delete e.account;
    }
    out.push(e);
  });
  return out;
}


function financeActiveLedger(){
  return (state.financeLedger||[]).filter(e=>!e.archived);
}

function financeRecomputeBalances(){
  const sums = {};
  (financeActiveLedger()||[]).forEach(e=>{
    const accId = e.accountId;
    if(!accId) return;
    if(sums[accId] === undefined) sums[accId] = 0;
    const amt = Number(e.amount||0);
    if(e.type === "expense") sums[accId] -= amt;
    else if(e.type === "income") sums[accId] += amt;
    // transfers handled elsewhere later
  });

  (state.financeAccounts||[]).forEach(a=>{
    const base = Number(a.initialBalance||0);
    const delta = Number(sums[a.id]||0);
    a.balance = base + delta;
  });
}

function financeResetToZero(){
  // archive all existing entries so history stays but balances start fresh
  (state.financeLedger||[]).forEach(e=>{ e.archived = true; });

  // reset baseline to zero so you can set initial later
  (state.financeAccounts||[]).forEach(a=>{
    a.initialBalance = 0;
    a.balance = 0;
  });

  state.financeResetAt = isoDate(new Date());
  persist();
  view();
  toast("Finanzas reiniciadas a cero ✅ (historial archivado)");
}

function financeResetToZeroConfirm(){
  const ok = confirm("¿Reiniciar finanzas a cero?\n\n• NO borra tu historial: lo archiva.\n• Tus cuentas quedan en 0 para que pongas saldo inicial.\n\n¿Continuar?");
  if(ok) financeResetToZero();
}


function financeSetCurrentAsBaseline(){
  // Make sure balances are current before freezing baseline
  try{ financeRecomputeBalances(); }catch(e){}

  // Archive existing active ledger so history stays but no longer affects balances
  (state.financeLedger||[]).forEach(e=>{ if(!e.archived) e.archived = true; });

  // Freeze current balances as the new baseline
  (state.financeAccounts||[]).forEach(a=>{
    a.initialBalance = Number(a.balance||0);
  });

  state.financeBaselineAt = isoDate(new Date());
  persist();
  view();
  toast("Saldos actuales guardados como iniciales ✅ (historial archivado)");
}

function financeSetCurrentAsBaselineConfirm(){
  const ok = confirm(
    "¿Usar los saldos actuales como punto de inicio?\n\n" +
    "• NO borra historial: lo archiva.\n" +
    "• Tus saldos actuales se guardan como saldo inicial.\n" +
    "• Desde aquí, todo lo nuevo se registrará como movimientos.\n\n" +
    "¿Continuar?"
  );
  if(ok) financeSetCurrentAsBaseline();
}

function financeHardResetAll(){
  // FULL WIPE: accounts + ledger. Use when starting fresh.
  state.financeLedger = [];
  state.financeAccounts = [];
  state.financeResetAt = isoDate(new Date());
  state.financeBaselineAt = isoDate(new Date());
  state.financeMonthOffset = 0;
  // keep financeMeta (expected income) by default
  persist();
  view();
  toast("Finanzas borradas ✅ (inicio limpio)");
}

function financeHardResetAllConfirm(){
  const ok = confirm(
    "⚠️ Borrar TODO en Finanzas y empezar de cero?\n\n" +
    "• Borra cuentas y movimientos.\n" +
    "• No se puede deshacer.\n\n" +
    "¿Continuar?"
  );
  if(ok) financeHardResetAll();
}


// run migration once
try{ financeMigrateV2(); financeEnsureMissionControlStructures(); financeRecomputeBalances(); }catch(e){ console.warn("[Finance] migrate/recompute fail", e); }

/* ===== Finance CRUD ===== */

function addFinanceAccount({name, type="bank", balance=0, color=null}){
  const acc = {
    id: uid("acc"),
    name: String(name||"Cuenta").trim(),
    type: (type==="cash"||type==="card"||type==="bank") ? type : "bank",
    initialBalance: Number(balance||0),
    balance: Number(balance||0),
    color: color || null,
    createdAt: new Date().toISOString()
  };
  state.financeAccounts.push(acc);
  persist();
  view();
  return acc;
}

function addFinanceEntry({type, amount, accountId, category, reason, note, date, neuronRole}){
  const acc = state.financeAccounts.find(a=>a.id===accountId);
  if(!acc) return null;

  const amt = financeParseAmount(amount);
  const entryDate = date || new Date().toISOString();
  const tnorm = financeNormalizeType(type);
  const entryId = uid("fin");
  const resolvedNeuronRole = String(neuronRole||"auto").trim() || "auto";

  const entry = {
    id: entryId,
    date: entryDate, // ISO string
    type: tnorm, // income | expense
    amount: amt,
    accountId,
    category: category||"Otros",
    reason: reason||"normal",
    note: note||"",
    neuronRole: resolvedNeuronRole,
    neuronId: `mov_${entryId}`,
    archived: false
  };

  state.financeLedger.unshift(entry);

  // Remember last used account(s) for convenience defaults.
  // (Works even when main.js is loaded as a module.)
  state.financeLastAccountId = accountId;
  if(String(category||"").toLowerCase()==="mercado") state.financeLastMarketAccountId = accountId;

  financeRecomputeBalances();
  financeSyncLedgerToUnified(entry);
  persist();
  view();
  return entry;
}

function updateFinanceEntry(id, patch){
  const idx = (state.financeLedger||[]).findIndex(e=>e.id===id);
  if(idx===-1) return null;
  const cur = state.financeLedger[idx];

  // apply patch
  const next = {
    ...cur,
    ...patch,
  };
  // normalize
  if(next.amount !== undefined) next.amount = financeParseAmount(next.amount);
  if(next.type !== undefined) next.type = financeNormalizeType(next.type);
  if(next.date) next.date = String(next.date);
  if(next.category) next.category = String(next.category);
  if(next.reason) next.reason = String(next.reason);
  if(next.note !== undefined) next.note = String(next.note||"");
  if(next.neuronRole !== undefined) next.neuronRole = String(next.neuronRole||"auto");

  state.financeLedger[idx] = next;
  financeRecomputeBalances();
  persist();
  view();
  return next;
}

function deleteFinanceEntry(id){
  const idx = (state.financeLedger||[]).findIndex(e=>e.id===id);
  if(idx===-1) return;
  state.financeLedger.splice(idx,1);
  financeRecomputeBalances();
  persist();
  view();
}


function financeMonthData(){
  const now = new Date();
  const ym = now.toISOString().slice(0,7);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();

  let income = 0;
  let expense = 0;

  const fergisAccountIds = (state.financeAccounts||[])
    .filter(a => String(a.name||"").toLowerCase().includes("fergis"))
    .map(a => a.id);

  (financeActiveLedger()||[]).forEach(e=>{
    if(fergisAccountIds.includes(e.accountId)) return; // Exclude Fergis from global stats
    if(String(e.date||"").startsWith(ym)){
      if(e.type==="income") income += Number(e.amount||0);
      if(e.type==="expense") expense += Number(e.amount||0);
    }
  });

  const today = now.getDate();
  const dailyAvg = today ? expense/today : 0;
  const projected = dailyAvg * daysInMonth;

  return {income, expense, projected};
}



function openFinanceAccountModal(prefill=null){
  const draft = Object.assign({
    id: null,
    name: "",
    type: "bank",
    balance: 0,
    color: ""
  }, prefill||{});

  const host = document.querySelector('#app') || document.body;
  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop finAccBackdrop';
  backdrop.innerHTML = `
    <div class="modal finAccModal" role="dialog" aria-label="Cuenta">
      <div class="finAccTop">
        <div class="finAccTopTitle">${draft.id ? "Editar cuenta" : "Nueva cuenta"}</div>
        <button class="iconBtn" id="finAccClose" aria-label="Cerrar">✕</button>
      </div>

      <div class="finAccScroll">
        <label class="finAccField">
          <div class="finAccLabel">Nombre</div>
          <input id="finAccName" type="text" placeholder="Ej: BCP, Billetera, Tarjeta" value="${escapeHtml(draft.name)}"/>
        </label>

        <label class="finAccField">
          <div class="finAccLabel">Tipo</div>
          <select id="finAccType">
            <option value="bank" ${draft.type==="bank"?"selected":""}>Banco</option>
            <option value="cash" ${draft.type==="cash"?"selected":""}>Efectivo</option>
            <option value="card" ${draft.type==="card"?"selected":""}>Tarjeta</option>
          </select>
        </label>

        <label class="finAccField">
          <div class="finAccLabel">Saldo inicial</div>
          <input id="finAccBalance" type="number" inputmode="decimal" value="${Number(draft.balance||0)}" />
          <div class="muted" style="margin-top:6px">Tip: esto define tu “punto cero” real. Luego los movimientos ajustan el saldo.</div>
        </label>

        <label class="finAccField">
          <div class="finAccLabel">Color (opcional)</div>
          <input id="finAccColor" type="color" value="${draft.color || "#4b7bec"}" />
        </label>

        <div class="finAccSpacer"></div>
      </div>

      <div class="finAccBottom">
        <button class="btn" id="finAccSave">${draft.id ? "Guardar" : "Crear cuenta"}</button>
      </div>
    </div>
  `;

  host.appendChild(backdrop);

  const close = ()=> backdrop.remove();
  backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) close(); });
  backdrop.querySelector('#finAccClose')?.addEventListener('click', close);

  backdrop.querySelector('#finAccSave')?.addEventListener('click', ()=>{
    const name = (backdrop.querySelector('#finAccName')?.value||'').trim();
    const type = (backdrop.querySelector('#finAccType')?.value||'bank').trim();
    const bal = Number(backdrop.querySelector('#finAccBalance')?.value||0);
    const color = (backdrop.querySelector('#finAccColor')?.value||'').trim();

    if(!name){ toast("Pon un nombre"); return; }

    if(draft.id){
      const acc = (state.financeAccounts||[]).find(a=>a.id===draft.id);
      if(!acc){ toast("Cuenta no encontrada"); close(); return; }
      acc.name = name;
      acc.type = type;
      acc.color = color || null;
      acc.initialBalance = bal;
      financeRecomputeBalances();
      persist();
      view();
      toast("Cuenta actualizada ✅");
    }else{
      addFinanceAccount({name, type, balance: bal, color});
      toast("Cuenta creada ✅");
    }

    close();
  });

  setTimeout(()=> backdrop.querySelector('#finAccName')?.focus(), 50);
}


function financeAccountStats(accountId) {
  const ledger = financeActiveLedger() || [];
  const now = new Date();
  const currentMonth = now.toISOString().slice(0,7);
  
  const getWeekKey = (dStr) => {
    const d = new Date(dStr);
    const day = d.getDay() || 7;
    d.setHours(-24 * (day - 1));
    return d.toISOString().slice(0,10);
  };
  
  let monthExpense = 0;
  let monthIncome = 0;
  let weekStats = {};
  
  ledger.forEach(e => {
    if(e.accountId !== accountId) return;
    if(!e.date) return;
    
    const dStr = String(e.date);
    const amt = Number(e.amount||0);
    const isExpense = e.type === "expense";
    
    if (dStr.startsWith(currentMonth)) {
      if(isExpense) monthExpense += amt;
      else monthIncome += amt;
      
      const wKey = getWeekKey(dStr);
      if(!weekStats[wKey]) weekStats[wKey] = { expense: 0, income: 0 };
      if(isExpense) weekStats[wKey].expense += amt;
      else weekStats[wKey].income += amt;
    }
  });

  const sortedWeeks = Object.keys(weekStats).sort().reverse().map(wk => ({
    weekStart: wk,
    expense: weekStats[wk].expense,
    income: weekStats[wk].income
  }));

  return { monthExpense, monthIncome, sortedWeeks, currentMonth };
}

function openFinanceAccountDetails(accountId) {
  const acc = (state.financeAccounts||[]).find(a=>a.id===accountId);
  if(!acc) return;
  
  const stats = financeAccountStats(accountId);
  const isFergis = String(acc.name||"").toLowerCase().includes("fergis");
  const fmt = _financeFmt;
  
  const host = document.body;
  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop finAccBackdrop';
  
  const weeksHtml = stats.sortedWeeks.map((w) => {
    return `
      <div class="finAccDetailsRow">
        <div class="finAccDetailsLabel">Semana del ${w.weekStart}</div>
        <div class="finAccDetailsValRow">
          <div class="finAccDetailsVal exp">S/ ${fmt(w.expense)}</div>
          ${!isFergis ? `<div class="finAccDetailsVal inc">+ S/ ${fmt(w.income)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  backdrop.innerHTML = `
    <div class="modal finAccDetailsModal" role="dialog" aria-label="Detalles de Cuenta">
      <div class="finEntryTop">
        <button class="iconBtn" id="finAccDetClose" aria-label="Cerrar">←</button>
        <div class="finEntryTopTitle">${escapeHtml(acc.name)}</div>
        <button class="iconBtn" id="finAccDetEdit" title="Editar">✏️</button>
      </div>

      <div class="finEntryScroll">
        <div class="finAccDetailsHero">
          <div class="finAccDetailsHeroLabel">${isFergis ? 'Uso este mes' : 'Saldo Actual'}</div>
          <div class="finAccDetailsHeroVal">S/ ${fmt(isFergis ? stats.monthExpense : acc.balance)}</div>
        </div>

        ${!isFergis ? `
        <div class="finAccDetailsStatsRow">
          <div class="finAccDetailsStat">
            <div class="statLabel">Ingresos del mes</div>
            <div class="statVal inc">+ S/ ${fmt(stats.monthIncome)}</div>
          </div>
          <div class="finAccDetailsStat">
            <div class="statLabel">Gastos del mes</div>
            <div class="statVal exp">- S/ ${fmt(stats.monthExpense)}</div>
          </div>
        </div>
        ` : ''}

        <div class="finAccDetailsTitle">Desglose Semanal</div>
        <div class="finAccDetailsList">
          ${weeksHtml || '<div class="muted" style="text-align:center;padding:20px;">Sin movimientos este mes</div>'}
        </div>
      </div>
    </div>
  `;

  host.appendChild(backdrop);
  const close = ()=> backdrop.remove();
  backdrop.querySelector('#finAccDetClose').addEventListener('click', close);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) close(); });
  backdrop.querySelector('#finAccDetEdit').addEventListener('click', ()=>{ 
    close(); 
    openFinanceAccountEdit(accountId); 
  });
}

function openFinanceAccountEdit(accountId){
  const acc = (state.financeAccounts||[]).find(a=>a.id===accountId);
  if(!acc) return;
  openFinanceAccountModal({
    id: acc.id,
    name: acc.name||"",
    type: acc.type||"bank",
    balance: acc.initialBalance ?? acc.balance ?? 0,
    color: acc.color || ""
  });
}

function openFinanceTypeModal(){
  const host = document.body;
  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop finTypeBackdrop';
  backdrop.innerHTML = `
    <div class="modal finTypeModal" role="dialog" aria-label="Tipo de movimiento">
      <div class="finEntryTop">
        <button class="iconBtn" id="finTypeClose" aria-label="Cerrar">←</button>
        <div class="finEntryTopTitle">¿Qué tipo de movimiento?</div>
      </div>
      <div class="finTypeBtnsRow">
        <button class="finTypeChoiceBtn expense" id="finTypeExpense">
          <span class="finTypeIcon">💸</span>
          <span>Gasto</span>
        </button>
        <button class="finTypeChoiceBtn income" id="finTypeIncome">
          <span class="finTypeIcon">💰</span>
          <span>Ingreso</span>
        </button>
      </div>
    </div>
  `;
  host.appendChild(backdrop);
  const close = ()=> backdrop.remove();
  backdrop.querySelector('#finTypeClose').addEventListener('click', close);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) close(); });
  backdrop.querySelector('#finTypeExpense').addEventListener('click', ()=>{ close(); openFinanceEntryModal(null, 'expense'); });
  backdrop.querySelector('#finTypeIncome').addEventListener('click', ()=>{ close(); openFinanceEntryModal(null, 'income'); });
}

function openFinanceEntryModal(existingId=null, typeOverride=null){
  financeEnsureMissionControlStructures();
  if(!(state.financeAccounts||[]).length){
    alert("Primero crea una cuenta");
    return;
  }

  const existing = existingId ? (state.financeLedger||[]).find(e=>e.id===existingId) : null;

  const now = new Date();
  const isoDate = now.toISOString().slice(0,10);
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');

  // split note => name + note (we store name inside note using " · ")
  const splitNote = (s)=>{
    const txt = String(s||"");
    const i = txt.indexOf(" · ");
    if(i===-1) return {name: txt, note:""};
    return {name: txt.slice(0,i).trim(), note: txt.slice(i+3).trim()};
  };

  const existingSplit = existing ? splitNote(existing.note||"") : {name:"", note:""};

  // default draft
  const draft = {
    type: (existing?.type) || typeOverride || "expense",
    name: existingSplit.name,
    amount: existing ? String(Number(existing.amount||0)) : "",
    currency: "PEN",
    date: (existing?.date ? String(existing.date).slice(0,10) : isoDate),
    time: (existing?.date ? String(existing.date).slice(11,16) : `${hh}:${mm}`),
    scheduled: false,
    category: (existing?.category) || "Otros",
    reason: (existing?.reason) || "normal",
    accountId: (existing?.accountId) || (state.financeAccounts||[])[0]?.id,
    sourceId: (state.financePaymentSources||[])[0]?.id || "",
    paidBy: "me",
    responsibleParty: "me",
    impactMode: ((existing?.type)==="income"?"income":"direct_expense"),
    neuronRole: (existing?.neuronRole) || "auto",
    note: existingSplit.note
  };

  const host = document.body;
  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop finEntryBackdrop';
  backdrop.innerHTML = `
    <div class="modal finEntryModal" role="dialog" aria-label="${existing ? "Editar movimiento" : "Añadir movimiento"}">
      <div class="finEntryTop">
        <button class="iconBtn" id="finEntryClose" aria-label="Volver">←</button>
        <div class="finEntryTopTitle">${existing ? "Editar" : "Añadir"}</div>
        ${existing ? `<button class="iconBtn" id="finEntryDelete" title="Eliminar">🗑️</button>` : ""}
        <button class="iconBtn" id="finEntryPlusOne" title="+1">+1</button>
      </div>

      <div class="finEntryScroll">

        <div class="finEntryField finEntryName">
          <input id="finEntryName" type="text" placeholder="Nombre" value="${escapeHtml(draft.name)}" />
          <button class="iconBtn" id="finEntryAttach" title="Adjuntar">📎</button>
        </div>

        <div class="finEntryDateRow">
          <div class="finEntryDateChip">
            <span>📅</span>
            <input id="finEntryDate" type="date" value="${draft.date}" />
          </div>
          <div class="finEntryDateChip">
            <span>🕒</span>
            <input id="finEntryTime" type="time" value="${draft.time}" />
          </div>
          <button class="finEntryScheduleBtn" id="finEntrySchedule">Programar</button>
        </div>

        <div class="finEntryAmountRow">
          <div class="finEntrySign ${draft.type==='expense' ? 'expense' : 'income'}" id="finEntrySign">${draft.type==='expense' ? '−' : '+'}</div>
          <!-- NOTE: use type=text + inputmode=decimal to avoid mobile locale quirks with type=number -->
          <input id="finEntryAmount" type="text" inputmode="decimal" placeholder="0.00" value="${escapeHtml(draft.amount)}" />
          <button class="iconBtn" id="finEntryCalc" title="Calculadora">🧮</button>
          <button class="finEntryCurrency" id="finEntryCurrency">${draft.currency}</button>
        </div>

        <div class="finEntryPickRow finEntryPickClickable" id="finEntryCategoryRow">
          <div class="finEntryPickIcon" id="finEntryCategoryIcon">${escapeHtml(financeCategoryIcon(draft.category))}</div>
          <div class="finEntryPickText">
            <div class="finEntryPickLabel">Categoría</div>
            <div class="finEntryPickValue" id="finEntryCategoryValue">${escapeHtml(draft.category||"Otros")}</div>
          </div>
          <div class="finEntryPickArrow">▾</div>
        </div>

        <div class="finEntryPickRow">
          <div class="finEntryPickIcon">⚑</div>
          <div class="finEntryPickText">
            <div class="finEntryPickLabel">Motivo</div>
            <div class="finEntryPickValue">
              <select id="finEntryReason">
                ${[
                  ["planificado","Planificado"],
                  ["impulso","Impulso"],
                  ["emergencia","Emergencia"],
                  ["normal","Normal"]
                ].map(r=>`<option value="${r[0]}" ${r[0]=== (draft.reason||"normal")?'selected':''}>${r[1]}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <div class="finEntryPickRow">
          <div class="finEntryPickIcon">💳</div>
          <div class="finEntryPickText">
            <div class="finEntryPickLabel">Cuenta</div>
            <div class="finEntryPickValue">
              <select id="finEntryAccount">
                ${(state.financeAccounts||[]).map(a=>`<option value="${a.id}" ${a.id===draft.accountId?'selected':''}>${escapeHtml(a.name)} (${a.type||''})</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <div class="finEntryPickRow" id="finEntrySplitRow">
          <div class="finEntryPickIcon">≡</div>
          <div class="finEntryPickText">
            <div class="finEntryPickLabel">Dividir</div>
            <div class="finEntryPickValue muted">Pronto</div>
          </div>
        </div>

        <div class="finEntryPickRow" id="finEntryStateRow">
          <div class="finEntryPickIcon">▦</div>
          <div class="finEntryPickText">
            <div class="finEntryPickLabel">Estado</div>
            <div class="finEntryPickValue muted">Normal</div>
          </div>
        </div>

        <div class="finEntryPickRow" id="finEntryTagRow">
          <div class="finEntryPickIcon">#</div>
          <div class="finEntryPickText">
            <div class="finEntryPickLabel">Etiqueta</div>
            <div class="finEntryPickValue muted">(opcional)</div>
          </div>
        </div>

        <div class="finEntryPickRow">
          <div class="finEntryPickIcon">🧠</div>
          <div class="finEntryPickText">
            <div class="finEntryPickLabel">Rol neuronal</div>
            <div class="finEntryPickValue">
              <select id="finEntryNeuronRole">
                ${[
                  ["auto","Automático"],
                  ["trigger","Gatillo"],
                  ["habit","Hábito"],
                  ["risk","Alerta"],
                  ["opportunity","Oportunidad"]
                ].map(r=>`<option value="${r[0]}" ${r[0]===(draft.neuronRole||"auto")?'selected':''}>${r[1]}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <div class="finEntryPickRow">
          <div class="finEntryPickIcon">🏦</div>
          <div class="finEntryPickText">
            <div class="finEntryPickLabel">Fuente de pago</div>
            <div class="finEntryPickValue">
              <select id="finEntrySource">
                ${(state.financePaymentSources||[]).filter(s=>s.isActive!==false).map(s=>`<option value="${s.id}">${escapeHtml(s.name)} (${s.owner})</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <div class="row" style="gap:10px">
          <div class="finEntryField" style="flex:1">
            <label class="fieldLabel">Quién pagó</label>
            <select id="finEntryPaidBy" class="textInput">
              <option value="me">Yo</option><option value="wife">Esposa</option><option value="shared">Compartido</option><option value="other">Otro</option>
            </select>
          </div>
          <div class="finEntryField" style="flex:1">
            <label class="fieldLabel">Responsabilidad real</label>
            <select id="finEntryResponsible" class="textInput">
              <option value="me">Yo</option><option value="wife">Esposa</option><option value="shared">Compartido</option><option value="other">Otro</option>
            </select>
          </div>
        </div>

        <div class="finEntryField" style="margin-top:8px">
          <label class="fieldLabel">Tipo de impacto</label>
          <select id="finEntryImpact" class="textInput">
            <option value="direct_expense">Gasto directo</option>
            <option value="internal_debt">Deuda interna</option>
            <option value="shared_expense">Gasto compartido</option>
            <option value="reimbursement">Reembolso</option>
            <option value="debt_payment">Pago de deuda</option>
            <option value="income">Ingreso</option>
          </select>
        </div>

        <div class="finDebtHint" id="finImpactPreview" style="margin-top:8px"></div>

        <div class="finEntryNote">
          <textarea id="finEntryNote" placeholder="Nota">${escapeHtml(draft.note)}</textarea>
        </div>

        <div class="finEntrySpacer"></div>
      </div>

      <div class="finEntryBottomBar">
        <div class="finEntryTypeBtns">
          <button class="finEntryTypeBtn ${draft.type==='expense'?'active':''}" data-type="expense">GASTOS</button>
          <button class="finEntryTypeBtn ${draft.type==='income'?'active':''}" data-type="income">INGRESOS</button>
          <button class="finEntryTypeBtn" data-type="transfer">TRANSFERIR</button>
        </div>
        <button class="finEntrySave" id="finEntrySave" aria-label="Guardar">💾</button>
      </div>
    </div>
  `;

  host.appendChild(backdrop);

  const close = ()=> backdrop.remove();
  backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) close(); });
  backdrop.querySelector('#finEntryClose')?.addEventListener('click', close);

  // delete (edit mode)
  backdrop.querySelector('#finEntryDelete')?.addEventListener('click', ()=>{
    if(!existing) return;
    const ok = confirm('¿Eliminar este movimiento?');
    if(!ok) return;
    deleteFinanceEntry(existing.id);
    toast('Eliminado ✅');
    close();
  });

  // basic affordances
  backdrop.querySelector('#finEntryAttach')?.addEventListener('click', ()=> toast('Adjuntos: pronto ✨'));
  backdrop.querySelector('#finEntryCalc')?.addEventListener('click', ()=> toast('Calculadora: pronto ✨'));
  backdrop.querySelector('#finEntryPlusOne')?.addEventListener('click', ()=>{
    const a = backdrop.querySelector('#finEntryAmount');
    const cur = financeParseAmount(a?.value||0);
    if(a) a.value = (cur + 1).toFixed(2);
  });
  backdrop.querySelector('#finEntrySchedule')?.addEventListener('click', ()=>{
    draft.scheduled = !draft.scheduled;
    toast(draft.scheduled ? 'Programado ✅' : 'Sin programación');
  });

  // Category picker (Phase 5)
  backdrop.querySelector('#finEntryCategoryRow')?.addEventListener('click', ()=>{
    financeOpenCategoryPicker({
      title: 'Categorías',
      onPick: (cat)=>{
        draft.category = cat?.name || 'Otros';
        const v = backdrop.querySelector('#finEntryCategoryValue');
        const ic = backdrop.querySelector('#finEntryCategoryIcon');
        if(v) v.textContent = draft.category;
        if(ic) ic.textContent = financeCategoryIcon(draft.category);
      }
    });
  });

  function setType(t){
    draft.type = t;
    const sign = backdrop.querySelector('#finEntrySign');
    if(sign){
      sign.textContent = (t==='expense' ? '−' : '+');
      sign.classList.toggle('expense', t==='expense');
      sign.classList.toggle('income', t==='income');
    }
    backdrop.querySelectorAll('.finEntryTypeBtn').forEach(b=>{
      b.classList.toggle('active', b.getAttribute('data-type')===t);
    });
  }

  backdrop.querySelectorAll('.finEntryTypeBtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const t = btn.getAttribute('data-type');
      if(t==='transfer') return toast('Transferir: siguiente fase 😼');
      setType(t);
    });
  });

  const sourceSel = backdrop.querySelector('#finEntrySource');
  const paidBySel = backdrop.querySelector('#finEntryPaidBy');
  const responsibleSel = backdrop.querySelector('#finEntryResponsible');
  const impactSel = backdrop.querySelector('#finEntryImpact');
  const amountEl = backdrop.querySelector('#finEntryAmount');
  if(sourceSel) sourceSel.value = draft.sourceId || sourceSel.value;
  if(paidBySel) paidBySel.value = draft.paidBy || 'me';
  if(responsibleSel) responsibleSel.value = draft.responsibleParty || 'me';
  if(impactSel) impactSel.value = draft.impactMode || (draft.type==='income'?'income':'direct_expense');
  function refreshImpactPreview(){
    const target = backdrop.querySelector('#finImpactPreview');
    if(!target) return;
    const amt = financeParseAmount(amountEl?.value||0);
    target.textContent = financePreviewImpact({
      amount: amt,
      impactMode: impactSel?.value || draft.impactMode,
      sourceId: sourceSel?.value || draft.sourceId,
      responsibleParty: responsibleSel?.value || draft.responsibleParty
    });
  }
  [sourceSel,paidBySel,responsibleSel,impactSel,amountEl].forEach(el=> el && el.addEventListener('input', refreshImpactPreview));
  refreshImpactPreview();

  // save
backdrop.querySelector('#finEntrySave')?.addEventListener('click', ()=>{
  const name = (backdrop.querySelector('#finEntryName')?.value||'').trim();
  const rawAmount = (backdrop.querySelector('#finEntryAmount')?.value||'');
  const amount = financeParseAmount(rawAmount);
  const category = (draft.category||'Otros');
  const reason = (backdrop.querySelector('#finEntryReason')?.value||'normal');
  const accountId = (backdrop.querySelector('#finEntryAccount')?.value||draft.accountId);
  const noteText = (backdrop.querySelector('#finEntryNote')?.value||'').trim();
  const sourceId = (backdrop.querySelector('#finEntrySource')?.value||'');
  const paidBy = (backdrop.querySelector('#finEntryPaidBy')?.value||'me');
  const responsibleParty = (backdrop.querySelector('#finEntryResponsible')?.value||'me');
  const impactMode = (backdrop.querySelector('#finEntryImpact')?.value|| (draft.type==='income'?'income':'direct_expense'));
  const neuronRole = (backdrop.querySelector('#finEntryNeuronRole')?.value || draft.neuronRole || 'auto');

  if(!amount || amount<=0){
    console.warn('[Finance] invalid amount', { rawAmount, amount });
    toast('Pon un monto válido');
    return;
  }

  const dval = (backdrop.querySelector('#finEntryDate')?.value || isoDate);
  const tval = (backdrop.querySelector('#finEntryTime')?.value || draft.time || "00:00");
  const dateISO = `${dval}T${tval}:00`;

  // NOTE: guardamos "Nombre" como parte de note para mantener el esquema simple
  const note = name ? (noteText ? `${name} · ${noteText}` : name) : noteText;

  if(existing){
    updateFinanceEntry(existing.id, {
      type: draft.type,
      amount,
      accountId,
      category,
      reason,
      note,
      date: dateISO,
      neuronRole
    });
    financeAddUnifiedTransaction({ date: dateISO, amount, direction: draft.type==='income'?'inflow':'outflow', obligationId:null, sourceId, paidBy, responsibleParty, impactMode, notes: note, tags:[category] });
    toast('Actualizado ✅');
  }else{
    addFinanceEntry({
      type: draft.type,
      amount,
      accountId,
      category,
      reason,
      note,
      date: dateISO,
      neuronRole
    });
    financeAddUnifiedTransaction({ date: dateISO, amount, direction: draft.type==='income'?'inflow':'outflow', obligationId:null, sourceId, paidBy, responsibleParty, impactMode, notes: note, tags:[category] });
    toast('Guardado ✅');
    // Auto-update neural map and open neuron modal pre-filled with this movement
    try {
      if (typeof window.neuronasRunDayUpdate === 'function') window.neuronasRunDayUpdate();
    } catch(_e) {}
    setTimeout(() => {
      try {
        if (typeof window.neuronasOpenAddModal === 'function') {
          const neuronTipo = draft.type === 'income' ? 'ingreso' : draft.type === 'transfer' ? 'pasivo' : 'consumo';
          window.neuronasOpenAddModal({ nombre: name || category, monto: amount, tipo: neuronTipo });
        }
      } catch(_e) {}
    }, 300);
  }
  close();
});


  // focus
  setTimeout(()=>{ backdrop.querySelector('#finEntryName')?.focus(); }, 50);
}

LS.financeMeta = "memorycarl_v2_finance_meta";
state.financeMeta = load(LS.financeMeta, {});
if(state.financeMonthOffset===undefined) state.financeMonthOffset = 0;

// Finance Categories + Projection Mode (Phase 5)
LS.financeCategories = "memorycarl_v2_finance_categories";
state.financeCategories = load(LS.financeCategories, null);
try{
  const pm = localStorage.getItem("memorycarl_v2_finance_projection_mode");
  if(pm) state.financeProjectionMode = pm;
}catch(e){}
if(!state.financeProjectionMode) state.financeProjectionMode = "normal"; // conservative | normal | realistic

function financeInitCategories(){
  if(state.financeCategories && Array.isArray(state.financeCategories.groups)) return;
  state.financeCategories = {
    v: 1,
    groups: [
      { id:"home", name:"Casa", items:[
        { id:"rent", name:"Alquiler", icon:"🏢", color:"#ff4d4d" },
        { id:"school", name:"Colegio", icon:"🎓", color:"#ff4d4d" },
        { id:"bday", name:"Cumpleaños", icon:"👨‍👩‍👧", color:"#ff4d4d" },
        { id:"internet", name:"Internet", icon:"📶", color:"#ff4d4d" },
        { id:"gas", name:"Gas", icon:"🔥", color:"#ff4d4d" }
      ]},
      { id:"food", name:"Comida", items:[
        { id:"market", name:"Mercado", icon:"🛒", color:"#ff4d4d" },
        { id:"bodegas", name:"Bodegas", icon:"🛒", color:"#ff4d4d" },
        { id:"drinks", name:"Bebidas", icon:"🥤", color:"#ff4d4d" }
      ]},
      { id:"health", name:"Salud", items:[
        { id:"meds", name:"Medicamentos", icon:"💊", color:"#ff4d4d" },
        { id:"therapy", name:"Psicología", icon:"🧠", color:"#ff4d4d" }
      ]},
      { id:"other", name:"Otros", items:[
        { id:"other", name:"Otros", icon:"●", color:"#ff4d4d" }
      ]}
    ]
  };
  persist();
}

function financeFlattenCategories(){
  financeInitCategories();
  const out = [];
  (state.financeCategories.groups||[]).forEach(g=>{
    (g.items||[]).forEach(it=> out.push({ ...it, groupId:g.id, groupName:g.name }));
  });
  return out;
}

function financeFindCategoryByName(name){
  const n = String(name||"").trim().toLowerCase();
  if(!n) return null;
  return financeFlattenCategories().find(c=> String(c.name||"").toLowerCase()===n) || null;
}

function financeCategoryIcon(name){
  const c = financeFindCategoryByName(name);
  return c?.icon || _financeIconForCategory(name);
}

function _ensureFcStyles(){if(!document.getElementById('fcStyles')){
  const s = document.createElement('style');
  s.id = 'fcStyles';
  s.textContent = `
    @keyframes fcFadeIn{from{opacity:0}to{opacity:1}}
    @keyframes fcSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fcPop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}

    /* ── Main picker screen ── */
    .finCatBackdrop{
      position:fixed;inset:0;z-index:900;
      background:#0b0f19;
      display:flex;flex-direction:column;
      animation:fcFadeIn .16s ease;
    }
    .fcp-topbar{
      display:flex;align-items:center;gap:12px;
      padding:14px 16px 10px;
      border-bottom:1px solid rgba(255,255,255,.08);
      position:sticky;top:0;z-index:2;
      background:rgba(11,15,25,.95);
      backdrop-filter:blur(10px);
    }
    .fcp-back{
      width:36px;height:36px;border-radius:50%;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(255,255,255,.05);
      color:rgba(255,255,255,.8);cursor:pointer;
      font-size:18px;display:flex;align-items:center;justify-content:center;
      transition:background .14s;flex-shrink:0;
    }
    .fcp-back:hover{background:rgba(255,255,255,.12)}
    .fcp-title{font-size:16px;font-weight:600;flex:1}
    .fcp-new-btn{
      padding:8px 14px;border-radius:20px;border:none;
      background:linear-gradient(135deg,#7c5cff,#5b3fd4);
      color:#fff;font-size:13px;font-weight:600;cursor:pointer;
      box-shadow:0 3px 10px rgba(124,92,255,.35);
      transition:opacity .14s,transform .1s;white-space:nowrap;
    }
    .fcp-new-btn:hover{opacity:.88;transform:translateY(-1px)}

    .fcp-search-wrap{
      padding:12px 16px 8px;
      position:sticky;top:60px;z-index:1;
      background:rgba(11,15,25,.9);
      backdrop-filter:blur(8px);
    }
    .fcp-search{
      display:flex;align-items:center;gap:8px;
      background:rgba(255,255,255,.07);
      border:1px solid rgba(255,255,255,.1);
      border-radius:14px;padding:9px 13px;
      transition:border .15s;
    }
    .fcp-search:focus-within{border-color:rgba(124,92,255,.5)}
    .fcp-search input{
      background:none;border:none;outline:none;
      color:#fff;font-size:14px;flex:1;
    }
    .fcp-search input::placeholder{color:rgba(255,255,255,.3)}

    .fcp-body{
      flex:1;overflow-y:auto;padding:4px 16px 100px;
    }
    .fcp-group-block{margin-bottom:6px}
    .fcp-group-header{
      display:flex;align-items:center;justify-content:space-between;
      padding:14px 2px 8px;
    }
    .fcp-group-name{
      font-size:11px;letter-spacing:.8px;text-transform:uppercase;
      color:rgba(255,255,255,.4);font-weight:600;
    }
    .fcp-group-count{
      font-size:11px;color:rgba(255,255,255,.25);
    }
    .fcp-grid{
      display:grid;grid-template-columns:repeat(4,1fr);gap:8px;
    }
    .fcp-item{
      display:flex;flex-direction:column;align-items:center;gap:6px;
      padding:12px 6px 10px;
      background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.07);
      border-radius:16px;cursor:pointer;
      transition:background .14s,border-color .14s,transform .12s;
      text-align:center;
    }
    .fcp-item:hover{
      background:rgba(255,255,255,.09);
      border-color:rgba(255,255,255,.15);
      transform:translateY(-2px);
    }
    .fcp-item:active{transform:scale(.95)}
    .fcp-icon{
      width:46px;height:46px;border-radius:14px;
      display:flex;align-items:center;justify-content:center;
      font-size:22px;
      box-shadow:0 4px 12px rgba(0,0,0,.3);
    }
    .fcp-label{
      font-size:11px;color:rgba(255,255,255,.75);
      line-height:1.2;word-break:break-word;max-width:70px;
    }
    .fcp-empty{
      text-align:center;padding:48px 16px;
      color:rgba(255,255,255,.3);font-size:14px;
    }
    .fcp-empty-icon{font-size:36px;margin-bottom:10px}

    /* ── Floating modal (nueva cat / nuevo grupo) ── */
    .fc-overlay{
      position:fixed;inset:0;z-index:9999;
      display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,.6);
      backdrop-filter:blur(6px);
      padding:16px;
      animation:fcFadeIn .18s ease;
    }
    .fc-sheet{
      background:linear-gradient(180deg,rgba(30,24,50,.98),rgba(15,12,28,.99));
      border:1px solid rgba(255,255,255,.12);
      border-radius:24px;
      width:100%;max-width:480px;
      box-shadow:0 20px 60px rgba(0,0,0,.6);
      overflow:hidden;
      animation:fcSlideUp .24s cubic-bezier(.34,1.4,.64,1);
      max-height:85vh;
      display:flex;flex-direction:column;
    }
    .fc-drag{
      width:40px;height:4px;border-radius:2px;
      background:rgba(255,255,255,.2);
      margin:10px auto 0;
    }
    .fc-sh-head{
      display:flex;align-items:center;justify-content:space-between;
      padding:14px 18px 12px;
      border-bottom:1px solid rgba(255,255,255,.07);
    }
    .fc-sh-title{font-size:15px;font-weight:700;letter-spacing:.1px}
    .fc-sh-close{
      width:28px;height:28px;border-radius:50%;
      border:none;background:rgba(255,255,255,.08);
      color:rgba(255,255,255,.6);cursor:pointer;font-size:15px;
      display:flex;align-items:center;justify-content:center;
      transition:background .14s;
    }
    .fc-sh-close:hover{background:rgba(255,255,255,.16)}
    .fc-sh-body{padding:16px 18px;overflow-y:auto;flex:1;min-height:0;}
    .fc-lbl{
      font-size:10px;color:rgba(255,255,255,.4);
      letter-spacing:.7px;text-transform:uppercase;
      margin-bottom:6px;margin-top:14px;
    }
    .fc-lbl:first-child{margin-top:0}
    .fc-inp{
      width:100%;padding:11px 13px;
      background:rgba(255,255,255,.07);
      border:1px solid rgba(255,255,255,.11);
      border-radius:13px;color:#fff;font-size:14px;
      outline:none;transition:border .15s,background .15s;
    }
    .fc-inp:focus{border-color:rgba(124,92,255,.6);background:rgba(124,92,255,.07)}
    .fc-inp::placeholder{color:rgba(255,255,255,.25)}
    .fc-inp.err{border-color:#fb7185 !important}

    /* Group dropdown */
    .fc-grp-select{
      width:100%;padding:11px 13px;
      background:rgba(255,255,255,.07);
      border:1px solid rgba(255,255,255,.11);
      border-radius:13px;color:#fff;font-size:14px;
      outline:none;cursor:pointer;
      appearance:none;-webkit-appearance:none;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='rgba(255,255,255,0.4)' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
      background-repeat:no-repeat;
      background-position:right 13px center;
      padding-right:36px;
      transition:border .15s;
    }
    .fc-grp-select:focus{border-color:rgba(124,92,255,.6)}
    .fc-grp-select option{background:#1a1530;color:#fff}

    /* Preview */
    .fc-preview{
      display:flex;align-items:center;gap:12px;
      background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.08);
      border-radius:15px;padding:12px 14px;margin-bottom:14px;
    }
    .fc-prev-icon{
      width:46px;height:46px;border-radius:14px;
      display:flex;align-items:center;justify-content:center;
      font-size:24px;transition:all .18s;flex-shrink:0;
      box-shadow:0 4px 12px rgba(0,0,0,.3);
    }
    .fc-prev-name{font-size:14px;font-weight:600}
    .fc-prev-grp{font-size:11px;color:rgba(255,255,255,.4);margin-top:2px}

    /* Icon grid */
    .fc-icon-grid{
      display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:4px;
    }
    .fc-ic-btn{
      aspect-ratio:1;border-radius:11px;border:1.5px solid transparent;
      background:rgba(255,255,255,.06);cursor:pointer;font-size:19px;
      display:flex;align-items:center;justify-content:center;
      transition:all .13s;
    }
    .fc-ic-btn:hover{background:rgba(255,255,255,.13);transform:scale(1.1)}
    .fc-ic-btn.active{
      border-color:var(--fc-acc,#7c5cff);
      background:rgba(124,92,255,.2);
      transform:scale(1.12);
    }

    /* Color palette */
    .fc-palette{display:flex;gap:8px;flex-wrap:wrap;}
    .fc-dot{
      width:28px;height:28px;border-radius:50%;cursor:pointer;
      border:2.5px solid transparent;transition:all .13s;
      box-shadow:0 2px 6px rgba(0,0,0,.35);
    }
    .fc-dot:hover{transform:scale(1.18)}
    .fc-dot.active{border-color:#fff;transform:scale(1.22)}

    /* Sheet footer */
    .fc-sh-footer{
      display:flex;gap:10px;flex-shrink:0;
      padding:12px 18px 20px;
      border-top:1px solid rgba(255,255,255,.06);
      background:rgba(15,12,28,.98);
    }
    .fc-btn-sec{
      flex:1;padding:12px;border-radius:13px;
      border:1px solid rgba(255,255,255,.1);
      background:rgba(255,255,255,.04);color:rgba(255,255,255,.65);
      font-size:14px;cursor:pointer;transition:background .14s;
    }
    .fc-btn-sec:hover{background:rgba(255,255,255,.09)}
    .fc-btn-pri{
      flex:2;padding:12px;border-radius:13px;border:none;
      background:linear-gradient(135deg,#7c5cff,#5b3fd4);
      color:#fff;font-size:14px;font-weight:700;cursor:pointer;
      box-shadow:0 4px 16px rgba(124,92,255,.4);
      transition:opacity .14s,transform .1s;
    }
    .fc-btn-pri:hover{opacity:.88;transform:translateY(-1px)}
    .fc-btn-pri:active{transform:scale(.97)}
  `;
  document.head.appendChild(s);
}
}

function financeOpenCategoryPicker({title="Categorías", onPick, allowNew=true}={}){
  financeInitCategories();
  const host = document.querySelector('#app') || document.body;
  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop finCatBackdrop';

  // ── Shared palette & icons constants ──────────────────────────────────
  const FC_PALETTE = [
    '#7c5cff','#36d399','#fb7185','#fbbf24','#38bdf8',
    '#f472b6','#a3e635','#fb923c','#e879f9','#34d399',
    '#60a5fa','#f87171','#4ade80','#facc15','#a78bfa'
  ];
  const FC_ICONS = ['🏠','🍔','🚗','🎮','💊','📚','✈️','🎁','💡','👗','🐾','💪','🎵','📱','🛒','💸','🏋️','🎨','🧴','🏥','🔧','📦','🍺','☕','🌿','🧾','🎓','🏦'];

  _ensureFcStyles();


  // ── Main screen HTML ───────────────────────────────────────────────────
  backdrop.innerHTML = `
    <div class="fcp-topbar">
      <button class="fcp-back" id="finCatClose">←</button>
      <div class="fcp-title">${escapeHtml(title)}</div>
      ${allowNew ? `<button class="fcp-new-btn" id="finCatNewBtn">＋ Nueva</button>` : ''}
    </div>
    <div class="fcp-search-wrap">
      <div class="fcp-search">
        <span style="font-size:15px;opacity:.5">🔎</span>
        <input id="finCatSearchInput" placeholder="Buscar categoría…">
      </div>
    </div>
    <div class="fcp-body" id="finCatBody"></div>
  `;

  host.appendChild(backdrop);
  const close = ()=> backdrop.remove();
  backdrop.querySelector('#finCatClose')?.addEventListener('click', close);

  const body  = backdrop.querySelector('#finCatBody');
  const input = backdrop.querySelector('#finCatSearchInput');

  // ── Render main grid ───────────────────────────────────────────────────
  function render(filter=""){
    const f = String(filter||"").trim().toLowerCase();
    const groups = (state.financeCategories.groups||[]).map(g=>{
      const items = (g.items||[]).filter(it=>
        !f || String(it.name||"").toLowerCase().includes(f)
      );
      return {g, items};
    }).filter(x=>x.items.length);

    if(!groups.length){
      body.innerHTML = `
        <div class="fcp-empty">
          <div class="fcp-empty-icon">🗂️</div>
          ${f ? 'Sin resultados para "'+escapeHtml(f)+'"' : 'Aún no hay categorías.<br>Toca <b>＋ Nueva</b> para empezar.'}
        </div>`;
      return;
    }

    body.innerHTML = groups.map(({g,items})=>`
      <div class="fcp-group-block">
        <div class="fcp-group-header">
          <div class="fcp-group-name">${escapeHtml(g.name)}</div>
          <div class="fcp-group-count">${items.length} ${items.length===1?'categoría':'categorías'}</div>
        </div>
        <div class="fcp-grid">
          ${items.map(it=>`
            <button class="fcp-item" data-name="${escapeHtml(it.name)}">
              <div class="fcp-icon" style="background:${escapeHtml(it.color||'#7c5cff')}">${escapeHtml(it.icon||'●')}</div>
              <div class="fcp-label">${escapeHtml(it.name)}</div>
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');

    body.querySelectorAll('.fcp-item').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const nm = btn.getAttribute('data-name')||'';
        const cat = financeFindCategoryByName(nm)||{name:nm,icon:'●'};
        try{ onPick && onPick(cat); }catch(_){}
        close();
      });
    });
  }

  input?.addEventListener('input', ()=> render(input.value));
  render("");

  // ── Open "Nueva Categoría" sheet ───────────────────────────────────────
  if(allowNew){
    backdrop.querySelector('#finCatNewBtn')?.addEventListener('click', ()=>{
      openNewCategorySheet({ onSaved: ()=> render(input?.value||'') });
    });
  }
}

// ── Modal: Nueva Categoría (bottom sheet) ─────────────────────────────────
function openNewCategorySheet({ onSaved }={}){
  const PALETTE = [
    '#7c5cff','#36d399','#fb7185','#fbbf24','#38bdf8',
    '#f472b6','#a3e635','#fb923c','#e879f9','#34d399',
    '#60a5fa','#f87171','#4ade80','#facc15','#a78bfa'
  ];
  const ICONS = ['🏠','🍔','🚗','🎮','💊','📚','✈️','🎁','💡','👗','🐾','💪','🎵','📱','🛒','💸','🏋️','🎨','🧴','🏥','🔧','📦','🍺','☕','🌿','🧾','🎓','🏦'];

  let selColor = PALETTE[0];
  let selIcon  = ICONS[0];

  const overlay = document.createElement('div');
  overlay.className = 'fc-overlay';

  const getGroups = ()=> (state.financeCategories.groups||[]);
  const buildGroupOptions = ()=> getGroups().map(g=>
    `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`
  ).join('') + `<option value="__new__">＋ Crear nuevo grupo…</option>`;

  overlay.innerHTML = `
    <div class="fc-sheet">
      <div class="fc-drag"></div>
      <div class="fc-sh-head">
        <div class="fc-sh-title">✨ Nueva Categoría</div>
        <button class="fc-sh-close" id="fcShClose">✕</button>
      </div>
      <div class="fc-sh-body">

        <!-- Preview -->
        <div class="fc-preview">
          <div class="fc-prev-icon" id="fcPrevIcon" style="background:${selColor}">${selIcon}</div>
          <div>
            <div class="fc-prev-name" id="fcPrevName">Nombre de categoría</div>
            <div class="fc-prev-grp" id="fcPrevGrp">Sin grupo</div>
          </div>
        </div>

        <!-- Nombre -->
        <div class="fc-lbl">Nombre</div>
        <input class="fc-inp" id="fcName" placeholder="ej: Delivery, Netflix, Gasolina…" maxlength="32">

        <!-- Grupo (dropdown) -->
        <div class="fc-lbl" style="display:flex;align-items:center;justify-content:space-between">
          <span>Grupo</span>
        </div>
        <select class="fc-grp-select" id="fcGroupSel">
          ${buildGroupOptions()}
        </select>

        <!-- Icono -->
        <div class="fc-lbl">Icono</div>
        <div class="fc-icon-grid" id="fcIconGrid">
          ${ICONS.map((ic,i)=>`
            <button class="fc-ic-btn${i===0?' active':''}" data-icon="${ic}">${ic}</button>
          `).join('')}
        </div>

        <!-- Color -->
        <div class="fc-lbl">Color</div>
        <div class="fc-palette" id="fcPalette" style="margin-bottom:8px">
          ${PALETTE.map((c,i)=>`
            <div class="fc-dot${i===0?' active':''}" data-color="${c}" style="background:${c}"></div>
          `).join('')}
        </div>

      </div>
      <div class="fc-sh-footer">
        <button class="fc-btn-sec" id="fcShCancel">Cancelar</button>
        <button class="fc-btn-pri" id="fcShSave">Guardar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeSheet = ()=> overlay.remove();
  overlay.querySelector('#fcShClose').addEventListener('click', closeSheet);
  overlay.querySelector('#fcShCancel').addEventListener('click', closeSheet);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) closeSheet(); });

  const elName    = overlay.querySelector('#fcName');
  const elGrpSel  = overlay.querySelector('#fcGroupSel');
  const elPrevIcon= overlay.querySelector('#fcPrevIcon');
  const elPrevName= overlay.querySelector('#fcPrevName');
  const elPrevGrp = overlay.querySelector('#fcPrevGrp');

  const updatePreview = ()=>{
    elPrevIcon.style.background = selColor;
    elPrevIcon.textContent = selIcon;
    elPrevName.textContent = elName.value.trim() || 'Nombre de categoría';
    const selOpt = elGrpSel.options[elGrpSel.selectedIndex];
    elPrevGrp.textContent = (selOpt && selOpt.value !== '__new__') ? selOpt.text : 'Sin grupo';
  };

  elName.addEventListener('input', updatePreview);

  // Group dropdown — intercept "＋ Crear nuevo grupo…"
  elGrpSel.addEventListener('change', ()=>{
    if(elGrpSel.value === '__new__'){
      elGrpSel.value = getGroups()[0]?.id || '__new__'; // reset while modal opens
      openNewGroupSheet({
        onSaved: (newGrp)=>{
          // Rebuild options and select new group
          const opts = getGroups().map(g=>
            `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`
          ).join('') + `<option value="__new__">＋ Crear nuevo grupo…</option>`;
          elGrpSel.innerHTML = opts;
          elGrpSel.value = newGrp.id;
          updatePreview();
        }
      });
    } else {
      updatePreview();
    }
  });

  // Icon selection
  overlay.querySelector('#fcIconGrid').addEventListener('click', e=>{
    const btn = e.target.closest('.fc-ic-btn');
    if(!btn) return;
    overlay.querySelectorAll('.fc-ic-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    selIcon = btn.dataset.icon;
    updatePreview();
  });

  // Color selection
  overlay.querySelector('#fcPalette').addEventListener('click', e=>{
    const dot = e.target.closest('.fc-dot');
    if(!dot) return;
    overlay.querySelectorAll('.fc-dot').forEach(d=>d.classList.remove('active'));
    dot.classList.add('active');
    selColor = dot.dataset.color;
    overlay.style.setProperty('--fc-acc', selColor);
    updatePreview();
  });

  // Save
  overlay.querySelector('#fcShSave').addEventListener('click', ()=>{
    const nm = (elName.value||'').trim();
    if(!nm){ elName.classList.add('err'); elName.focus(); return; }
    elName.classList.remove('err');

    const selVal = elGrpSel.value;
    let grp = getGroups().find(g=> g.id === selVal);
    if(!grp){
      // Fallback: create "Otros"
      grp = { id:'g_'+Date.now(), name:'Otros', items:[] };
      state.financeCategories.groups.push(grp);
    }
    grp.items = grp.items||[];
    grp.items.push({ id:'c_'+Date.now(), name:nm, icon:selIcon, color:selColor });
    persist();
    if(onSaved) onSaved();
    closeSheet();
  });

  setTimeout(()=> elName.focus(), 100);
}

// ── Modal: Nuevo Grupo (bottom sheet) ─────────────────────────────────────
function openNewGroupSheet({ onSaved }={}){
  const GRP_PALETTE = [
    '#7c5cff','#36d399','#fb7185','#fbbf24','#38bdf8',
    '#f472b6','#a3e635','#fb923c','#e879f9','#60a5fa'
  ];
  const GRP_ICONS = ['🏠','🍽️','💊','🚌','🎉','👔','💰','📦','🌟','🎯','📁','🔑'];

  let selColor = GRP_PALETTE[0];
  let selIcon  = GRP_ICONS[0];

  const overlay = document.createElement('div');
  overlay.className = 'fc-overlay';
  overlay.style.zIndex = '10000';

  overlay.innerHTML = `
    <div class="fc-sheet">
      <div class="fc-drag"></div>
      <div class="fc-sh-head">
        <div class="fc-sh-title">📁 Nuevo Grupo</div>
        <button class="fc-sh-close" id="fgClose">✕</button>
      </div>
      <div class="fc-sh-body">

        <div class="fc-preview">
          <div class="fc-prev-icon" id="fgPrevIcon" style="background:${selColor};border-radius:50%">${selIcon}</div>
          <div>
            <div class="fc-prev-name" id="fgPrevName">Nombre del grupo</div>
            <div class="fc-prev-grp">Agrupa tus categorías</div>
          </div>
        </div>

        <div class="fc-lbl">Nombre del grupo</div>
        <input class="fc-inp" id="fgName" placeholder="ej: Casa, Comida, Salud…" maxlength="24">

        <div class="fc-lbl">Icono representativo</div>
        <div class="fc-icon-grid" id="fgIconGrid" style="grid-template-columns:repeat(6,1fr)">
          ${GRP_ICONS.map((ic,i)=>`
            <button class="fc-ic-btn${i===0?' active':''}" data-icon="${ic}">${ic}</button>
          `).join('')}
        </div>

        <div class="fc-lbl">Color del grupo</div>
        <div class="fc-palette" id="fgPalette" style="margin-bottom:8px">
          ${GRP_PALETTE.map((c,i)=>`
            <div class="fc-dot${i===0?' active':''}" data-color="${c}" style="background:${c}"></div>
          `).join('')}
        </div>

      </div>
      <div class="fc-sh-footer">
        <button class="fc-btn-sec" id="fgCancel">Cancelar</button>
        <button class="fc-btn-pri" id="fgSave">Crear grupo</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeSheet = ()=> overlay.remove();
  overlay.querySelector('#fgClose').addEventListener('click', closeSheet);
  overlay.querySelector('#fgCancel').addEventListener('click', closeSheet);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) closeSheet(); });

  const elName    = overlay.querySelector('#fgName');
  const elPrevIcon= overlay.querySelector('#fgPrevIcon');
  const elPrevName= overlay.querySelector('#fgPrevName');

  const updatePreview = ()=>{
    elPrevIcon.style.background = selColor;
    elPrevIcon.textContent = selIcon;
    elPrevName.textContent = elName.value.trim() || 'Nombre del grupo';
  };
  elName.addEventListener('input', updatePreview);

  overlay.querySelector('#fgIconGrid').addEventListener('click', e=>{
    const btn = e.target.closest('.fc-ic-btn');
    if(!btn) return;
    overlay.querySelectorAll('#fgIconGrid .fc-ic-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    selIcon = btn.dataset.icon;
    updatePreview();
  });

  overlay.querySelector('#fgPalette').addEventListener('click', e=>{
    const dot = e.target.closest('.fc-dot');
    if(!dot) return;
    overlay.querySelectorAll('#fgPalette .fc-dot').forEach(d=>d.classList.remove('active'));
    dot.classList.add('active');
    selColor = dot.dataset.color;
    updatePreview();
  });

  overlay.querySelector('#fgSave').addEventListener('click', ()=>{
    const nm = (elName.value||'').trim();
    if(!nm){ elName.classList.add('err'); elName.focus(); return; }
    elName.classList.remove('err');

    const newGrp = { id:'g_'+Date.now(), name:nm, icon:selIcon, color:selColor, items:[] };
    state.financeCategories.groups = state.financeCategories.groups||[];
    state.financeCategories.groups.push(newGrp);
    persist();
    if(onSaved) onSaved(newGrp);
    closeSheet();
  });

  setTimeout(()=> elName.focus(), 100);
}

function setFinanceMeta(month, expectedIncome, targetSavings){
  state.financeMeta[month] = {
    expectedIncome: Number(expectedIncome||0),
    targetSavings: Number(targetSavings||0)
  };
  persist();
  view();
}

function getCurrentMonthKey(){
  const off = Number(state.financeMonthOffset||0);
  const d = new Date();
  d.setMonth(d.getMonth()+off);
  return d.toISOString().slice(0,7);
}

function financeShiftMonth(delta){
  state.financeMonthOffset = Number(state.financeMonthOffset||0) + Number(delta||0);
  persist();
  view();
}

function financeResetMonth(){
  state.financeMonthOffset = 0;
  persist();
  view();
}

function financeSetProjectionMode(mode){
  const m = String(mode||"normal");
  if(!["conservative","normal","realistic"].includes(m)) return;
  state.financeProjectionMode = m;
  persist();
  view();
}
try{ window.financeSetProjectionMode = financeSetProjectionMode; }catch(e){}

function financeMonthDataAdvanced(){
  const off = Number(state.financeMonthOffset||0);
  const base = new Date();
  base.setMonth(base.getMonth()+off);

  const monthKey = base.toISOString().slice(0,7);
  const daysInMonth = new Date(base.getFullYear(), base.getMonth()+1, 0).getDate();

  let income = 0;
  let expense = 0;

  const dailyIncome = Array(daysInMonth).fill(0);
  const dailyExpense = Array(daysInMonth).fill(0);

  const fergisAccountIds = (state.financeAccounts||[])
    .filter(a => String(a.name||"").toLowerCase().includes("fergis"))
    .map(a => a.id);

  (financeActiveLedger()||[]).forEach(e=>{
    if(fergisAccountIds.includes(e.accountId)) return; // Exclude Fergis from global projections
    const ds = String(e.date||"");
    if(ds.startsWith(monthKey)){
      const parts = ds.slice(0,10).split("-");
      const day = Math.max(0, Math.min(daysInMonth-1, Number(parts[2]||"1") - 1));
      if(e.type==="income"){
        const v = Number(e.amount||0);
        income += v;
        dailyIncome[day] += v;
      }
      if(e.type==="expense"){
        const v = Number(e.amount||0);
        expense += v;
        dailyExpense[day] += v;
      }
    }
  });

  const accIncome = [];
  const accExpense = [];
  let sumI = 0;
  let sumE = 0;

  for(let i=0;i<daysInMonth;i++){
    sumI += dailyIncome[i];
    sumE += dailyExpense[i];
    accIncome.push(sumI);
    accExpense.push(sumE);
  }

  // Projection line (expense). Only for current month; for other months show real.
  const isCurrentMonth = (off===0);
  const today = new Date().getDate();
  let dailyAvg = 0;
  if(isCurrentMonth && today){
    const mode = String(state.financeProjectionMode||"normal");
    const n = (mode==="conservative") ? 3 : (mode==="realistic" ? 7 : today);
    const take = Math.max(1, Math.min(n, today));
    const startIdx = Math.max(0, (today - take));
    let sum = 0;
    for(let i=startIdx; i<today; i++) sum += Number(dailyExpense[i]||0);
    dailyAvg = sum / take;
  }
  const remainingDays = Math.max(0, daysInMonth - today);
  const projectedTotal = isCurrentMonth ? (expense + dailyAvg * remainingDays) : expense;

  const accProjected = [];
  for(let i=0;i<daysInMonth;i++){
    if(isCurrentMonth && (i+1) <= today){
      accProjected.push(accExpense[i]);
    }else if(isCurrentMonth){
      const daysFuture = (i+1) - today;
      accProjected.push(accExpense[Math.max(0,today-1)] + dailyAvg*daysFuture);
    }else{
      accProjected.push(accExpense[i]);
    }
  }

  const meta = state.financeMeta[monthKey] || {expectedIncome:0,targetSavings:0};

  return {
    monthKey,
    income,
    expense,
    projected: isCurrentMonth ? projectedTotal : expense,
    accIncome,
    accExpense,
    accProjected,
    daysInMonth,
    isCurrentMonth,
    meta
  };
}

function financeAccountIncomeFlow(accountId, monthKey){
  const accId = String(accountId||"");
  const mk = String(monthKey||"");
  if(!accId || !mk) return 0;

  return (financeActiveLedger()||[]).reduce((sum, entry)=>{
    if(String(entry.accountId||"") !== accId) return sum;
    if(entry.type !== "income") return sum;
    if(!String(entry.date||"").startsWith(mk)) return sum;
    return sum + Math.max(0, Number(entry.amount||0));
  }, 0);
}

function financeAccountExpenseFlow(accountId, monthKey){
  const accId = String(accountId||"");
  const mk = String(monthKey||"");
  if(!accId || !mk) return 0;

  return (financeActiveLedger()||[]).reduce((sum, entry)=>{
    if(String(entry.accountId||"") !== accId) return sum;
    if(entry.type !== "expense") return sum;
    if(!String(entry.date||"").startsWith(mk)) return sum;
    return sum + Math.max(0, Number(entry.amount||0));
  }, 0);
}


/* ===== Finance UI: sub-tabs (Principal / Movimientos / Recordatorios) ===== */
if(!state.financeSubTab) state.financeSubTab = "main";

function setFinanceSubTab(tab){
  state.financeSubTab = tab;
  persist();
  view();
}

function _financeFmt(n){
  return (Number(n)||0).toLocaleString("es-PE",{minimumFractionDigits:2, maximumFractionDigits:2});
}

function _financeWeekdayUpperShort(date){
  // "dom." -> "DOM."
  const w = date.toLocaleDateString("es-PE",{weekday:"short"});
  // keep dot if present
  return (w.endsWith(".") ? w : (w + ".")).toUpperCase();
}

function _financeDateHeader(dateStr){
  // Append T00:00:00 so the date is parsed as local time, not UTC midnight
  // (browsers parse bare YYYY-MM-DD strings as UTC, causing off-by-one errors
  // for users in negative UTC offsets).
  const d = new Date(dateStr + "T00:00:00");
  if(isNaN(d.getTime())) return String(dateStr||"");
  const wd = _financeWeekdayUpperShort(d);
  const rest = d.toLocaleDateString("es-PE",{day:"2-digit", month:"long", year:"numeric"});
  return `${wd} ${rest}`;
}

function _financeSortLedgerNewToOld(entries){
  // ledger is already newest-first (unshift), but we sort by date desc to be safe
  return (entries||[]).map((e,idx)=>({e,idx})).sort((a,b)=>{
    const ta = new Date(a.e.date).getTime();
    const tb = new Date(b.e.date).getTime();
    if(tb!==ta) return tb-ta;
    return a.idx-b.idx; // stable: newer first
  }).map(x=>x.e);
}

function _financeBalanceAfterMap(entriesNewToOld){
  // For each account, start from current balance and roll backwards
  const running = {};
  (state.financeAccounts||[]).forEach(a=>{ running[a.id] = Number(a.balance||0); });

  const afterById = {};
  (entriesNewToOld||[]).forEach(e=>{
    const accId = e.accountId;
    const amt = Number(e.amount||0);
    const cur = (running[accId] ?? 0);
    afterById[e.id] = cur;

    // rollback to "before this entry" for next (older) line
    if(e.type==="expense") running[accId] = cur + amt;
    else if(e.type==="income") running[accId] = cur - amt;
  });

  return afterById;
}

function _financeIconForCategory(cat){
  const c = String(cat||"").toLowerCase();
  if(c.includes("comida") || c.includes("rest") || c.includes("charcut") || c.includes("super")) return "🏠";
  if(c.includes("bodega") || c.includes("mass") || c.includes("merc") || c.includes("market")) return "🛒";
  if(c.includes("internet") || c.includes("entel") || c.includes("tel")) return "📶";
  if(c.includes("med") || c.includes("salud") || c.includes("farm")) return "💊";
  if(c.includes("bebida")) return "🥤";
  if(c.includes("transp") || c.includes("taxi") || c.includes("bus")) return "🚌";
  return "•";
}

function _financeGroupByDay(entries){
  const groups = {};
  (entries||[]).forEach(e=>{
    const key = String(e.date||"").slice(0,10);
    if(!groups[key]) groups[key] = [];
    groups[key].push(e);
  });
  // keep day order new->old
  return Object.keys(groups).sort((a,b)=> (new Date(b).getTime() - new Date(a).getTime()))
    .map(k=>({day:k, items: _financeSortLedgerNewToOld(groups[k])}));
}

function renderFinanceMovements(){
  const fmt = _financeFmt;

  const all = _financeSortLedgerNewToOld(financeActiveLedger()||[]);

  const afterMap = _financeBalanceAfterMap(all);
  const accName = (id)=>{
    const a = (state.financeAccounts||[]).find(x=>x.id===id);
    return a ? a.name : "Cuenta";
  };

  const groups = _financeGroupByDay(all);

  if(!groups.length){
    return `<div class="muted">Sin movimientos todavía.</div>`;
  }

  return groups.map(g=>{
    const netDay = g.items.reduce((s,e)=>{
      const amt = Number(e.amount||0);
      return s + (e.type==="income" ? amt : -amt);
    }, 0);
    const totalCls = netDay >= 0 ? "positive" : "negative";
    return `
      <div class="finDayGroup">
        <div class="finDayHeader">
          <span>${_financeDateHeader(g.day)}</span>
          <span class="finDayTotal ${totalCls}">${netDay<0?"-":""}S/. ${fmt(Math.abs(netDay))}</span>
        </div>

        ${g.items.map(e=>{
          const amt = Number(e.amount||0);
          const isExp = e.type==="expense";
          const amtCls = isExp ? "negative" : "positive";
          const title = e.category || (isExp ? "Gasto" : "Ingreso");
          const sub = e.note || " ";
          const balAfter = afterMap[e.id];
          return `
            <div class="finMovItem" style="cursor:pointer" onclick="openFinanceEntryModal('${e.id}')" title="Editar">
              <div class="finMovIcon ${isExp?"expense":"income"}">${escapeHtml(financeCategoryIcon(title))}</div>

              <div class="finMovInfo">
                <div class="finMovTitle">${escapeHtml(title)}</div>
                <div class="finMovSub">${escapeHtml(sub)}</div>
              </div>

              <div class="finMovAmtWrap">
                <div class="finMovAmt ${amtCls}">${isExp?"-":""}S/. ${fmt(amt)}</div>
                <div class="finMovBal">${escapeHtml(accName(e.accountId))} S/. ${fmt(balAfter)}</div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }).join("");
}

// expose
try{ window.setFinanceSubTab = setFinanceSubTab; }catch(e){}
try{ window.financeShiftMonth = financeShiftMonth; window.financeResetMonth = financeResetMonth; }catch(e){}
try{ window.financeHardResetAllConfirm = financeHardResetAllConfirm; }catch(e){}

// ===============================
// Finance Phase 3 — Weekly Intelligence Engine
// ===============================
if(!state.financeWeekly) state.financeWeekly = { lastRunDay: null, reports: [] };

function _financeTodayKey(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}

function _financeIsSunday(d){
  return (d.getDay && d.getDay() === 0);
}

function _financeStartOfDay(d){
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}

function _financeEndOfDay(d){
  const x = new Date(d);
  x.setHours(23,59,59,999);
  return x;
}

function _financeGetMostRecentSunday(refDate){
  const d = new Date(refDate);
  const day = d.getDay(); // 0 sunday
  const diff = day; // days since sunday
  d.setDate(d.getDate() - diff);
  return _financeStartOfDay(d);
}

function _financeGetWeekRangeEndingSunday(refDate){
  // week = Mon..Sun, ending at the most recent Sunday (or today if Sunday)
  const sunday = _financeGetMostRecentSunday(refDate);
  const start = new Date(sunday);
  start.setDate(sunday.getDate() - 6);
  return { start: _financeStartOfDay(start), end: _financeEndOfDay(sunday) };
}

function _financeFilterMovementsInRange(range){
  const led = financeActiveLedger() || [];
  return led.filter(m=>{
    const t = new Date(m.date).getTime();
    return t >= range.start.getTime() && t <= range.end.getTime();
  });
}

function _financeSum(arr, fn){
  return (arr||[]).reduce((s,x)=> s + Number(fn?fn(x):x||0), 0);
}

function _financeByKey(arr, keyFn, valFn){
  const out = {};
  (arr||[]).forEach(x=>{
    const k = keyFn(x);
    out[k] = (out[k]||0) + Number(valFn?valFn(x):1);
  });
  return out;
}

function financeWeeklyComputeReport({refDate=null}={}){
  const now = refDate ? new Date(refDate) : new Date();
  const r1 = _financeGetWeekRangeEndingSunday(now);

  const prevRef = new Date(r1.start);
  prevRef.setDate(prevRef.getDate() - 1);
  const r0 = _financeGetWeekRangeEndingSunday(prevRef);

  const w1 = _financeFilterMovementsInRange(r1);
  const w0 = _financeFilterMovementsInRange(r0);

  const w1Exp = w1.filter(m=>m.type==="expense");
  const w1Inc = w1.filter(m=>m.type==="income");
  const w0Exp = w0.filter(m=>m.type==="expense");

  if(!w1.length){
    return {
      id: "wk_" + Date.now(),
      createdAt: new Date().toISOString(),
      range: { start: r1.start.toISOString().slice(0,10), end: r1.end.toISOString().slice(0,10) },
      title: "Semana en silencio",
      bullets: ["No hubo movimientos esta semana. Si fue intencional, perfecto. Si no, registra aunque sea lo grande para que el análisis tenga material."],
      stats: { expense:0, income:0, tx:0 }
    };
  }

  const expTotal = _financeSum(w1Exp, m=>m.amount);
  const incTotal = _financeSum(w1Inc, m=>m.amount);

  const planned = w1Exp.filter(m=> String(m.reason||"").toLowerCase().includes("plan"));
  const impulse = w1Exp.filter(m=> String(m.reason||"").toLowerCase().includes("impul"));
  const emergency = w1Exp.filter(m=> String(m.reason||"").toLowerCase().includes("emerg"));
  const plannedTotal = _financeSum(planned, m=>m.amount);
  const impulseTotal = _financeSum(impulse, m=>m.amount);
  const emergencyTotal = _financeSum(emergency, m=>m.amount);

  const late = w1Exp.filter(m=>{
    const dt = new Date(m.date);
    return !isNaN(dt.getTime()) && dt.getHours() >= 21;
  });
  const lateCount = late.length;
  const lateTotal = _financeSum(late, m=>m.amount);

  const catTotals = _financeByKey(w1Exp, m=> (m.category||"Otros"), m=>m.amount);
  const catCounts = _financeByKey(w1Exp, m=> (m.category||"Otros"), _=>1);

  const topCat = Object.entries(catTotals).sort((a,b)=>b[1]-a[1])[0] || ["Otros",0];
  const topCatName = topCat[0];
  const topCatAmount = topCat[1];

  const prevCatTotals = _financeByKey(w0Exp, m=> (m.category||"Otros"), m=>m.amount);
  let breaker = {cat: topCatName, delta: (topCatAmount - (prevCatTotals[topCatName]||0))};
  Object.keys(catTotals).forEach(cat=>{
    const delta = catTotals[cat] - (prevCatTotals[cat]||0);
    if(delta > breaker.delta) breaker = {cat, delta};
  });

  const breakerCount = catCounts[breaker.cat] || 0;
  const breakerAvg = breakerCount ? (catTotals[breaker.cat]/breakerCount) : 0;
  const breakerWhy = (breakerCount >= 4 && breakerAvg < (expTotal*0.15)) ? "por frecuencia" : "por monto";

  const wins = Object.keys(prevCatTotals).map(cat=>{
    return {cat, delta: (catTotals[cat]||0) - (prevCatTotals[cat]||0)};
  }).filter(x=>x.delta < 0).sort((a,b)=>a.delta - b.delta).slice(0,3);

  const bullets = [];
  bullets.push(`Gasto semanal: **S/ ${_financeFmt(expTotal)}** · Ingreso: **S/ ${_financeFmt(incTotal)}** · Movimientos: **${w1.length}**.`);
  if(plannedTotal || impulseTotal || emergencyTotal){
    bullets.push(`Planificado: **S/ ${_financeFmt(plannedTotal)}** · Impulso: **S/ ${_financeFmt(impulseTotal)}** · Emergencia: **S/ ${_financeFmt(emergencyTotal)}**.`);
  }
  bullets.push(`Categoría dominante: **${escapeHtml(topCatName)}** con **S/ ${_financeFmt(topCatAmount)}**.`);
  bullets.push(`La categoría que más “rompió” fue **${escapeHtml(breaker.cat)}** (${breakerWhy}). Variación vs semana anterior: **S/ ${_financeFmt(breaker.delta)}**.`);
  if(lateCount){
    bullets.push(`Gastos después de las 9pm: **${lateCount}** (S/ ${_financeFmt(lateTotal)}). Si quieres recortar fácil: aquí suelen haber fugas.`);
  }else{
    bullets.push(`Cero gastos después de las 9pm ✅. Ese patrón suele proteger el presupuesto.`);
  }
  if(wins.length){
    bullets.push(`Mejoras vs semana anterior: ${wins.map(w=>`**${escapeHtml(w.cat)}** (-S/ ${_financeFmt(Math.abs(w.delta))})`).join(" · ")}.`);
  }

  return {
    id: "wk_" + Date.now(),
    createdAt: new Date().toISOString(),
    range: { start: r1.start.toISOString().slice(0,10), end: r1.end.toISOString().slice(0,10) },
    title: `Análisis semanal (${r1.start.toLocaleDateString("es-PE",{day:"2-digit",month:"short"})} → ${r1.end.toLocaleDateString("es-PE",{day:"2-digit",month:"short"})})`,
    bullets,
    stats: { expense: expTotal, income: incTotal, tx: w1.length, lateCount, breaker: breaker.cat }
  };
}

function financeWeeklyGenerateNow(){
  const rep = financeWeeklyComputeReport();
  state.financeWeekly.reports = [rep].concat(state.financeWeekly.reports||[]).slice(0,12);
  state.financeWeekly.lastRunDay = _financeTodayKey();
  persist();
  view();
  toast("Análisis semanal generado ✨");
  return rep;
}

function financeWeeklyMaybeAutoRun(){
  const today = new Date();
  if(!_financeIsSunday(today)) return;
  const key = _financeTodayKey();
  if(state.financeWeekly.lastRunDay === key) return;
  financeWeeklyGenerateNow();
}

try{ window.financeWeeklyGenerateNow = financeWeeklyGenerateNow; }catch(e){}

function financeToggleWeeklyHistory(){
  state.financeWeekly.showHistory = !state.financeWeekly.showHistory;
  persist();
  view();
}
try{ window.financeToggleWeeklyHistory = financeToggleWeeklyHistory; }catch(e){}

function renderFinanceWeeklyCard(){
  const r = (state.financeWeekly.reports||[])[0];
  if(!r){
    return `
      <div class="muted">Aún no hay análisis. Se genera automáticamente los domingos, o puedes tocar ✨.</div>
      <div style="margin-top:8px" class="muted">Tip: registra categoría + razón (plan/impulso/emergencia) para que la lectura sea más precisa.</div>
    `;
  }

  const bullets = (r.bullets||[]).map(b=> `<div class="finWeeklyBullet">• ${b}</div>`).join("");
  const show = !!state.financeWeekly.showHistory;
  const historyBtn = `<button class="chipBtn" onclick="financeToggleWeeklyHistory()">${show?"Ocultar":"Ver"} historial</button>`;

  let historyHtml = "";
  if(show){
    const rest = (state.financeWeekly.reports||[]).slice(1);
    historyHtml = rest.length ? `
      <div class="hr" style="margin:10px 0"></div>
      <div class="muted" style="margin-bottom:6px">Historial</div>
      ${rest.map(h=>{
        const t = escapeHtml(h.title||"Semana");
        const s = (h.stats||{});
        return `<div class="finWeeklyHistRow">
          <div>${t}</div>
          <div class="muted">Gasto S/ ${_financeFmt(s.expense||0)} · Ingreso S/ ${_financeFmt(s.income||0)}</div>
        </div>`;
      }).join("")}
    ` : `<div class="muted" style="margin-top:8px">Sin historial todavía.</div>`;
  }

  return `
    <div class="finWeeklyTopRow">
      <div><strong>${escapeHtml(r.title||"Análisis")}</strong></div>
      <div>${historyBtn}</div>
    </div>
    <div style="margin-top:8px">${bullets}</div>
    ${historyHtml}
  `;
}


/* ====================== FINANCE: DEBTS (Dashboard) ====================== */

function financeDebtsActive(){
  return (state.financeDebts||[]).filter(d=>String(d.status||"active")!=="archived");
}

function financeDebtSafeNum(x){
  const n = Number(x);
  return isFinite(n) ? n : 0;
}

function financeFmtPEN(n){
  return (financeDebtSafeNum(n)||0).toLocaleString("es-PE",{minimumFractionDigits:2, maximumFractionDigits:2});
}

function financeDebtIncomeVsPaymentsUI(){
  const monthKey = getCurrentMonthKey();
  const meta = (state.financeMeta||{})[monthKey] || {expectedIncome:0,targetSavings:0};
  const expectedIncome = financeDebtSafeNum(meta.expectedIncome||0);
  const monthly = financeDebtMonthlyTotal();
  const gap = expectedIncome - monthly;

  const gapCls = gap >= 0 ? "pos" : "neg";
  const gapLabel = gap >= 0 ? "Te queda" : "Te falta";

  return `
    <div class="finDebtIncomeBox">
      <div class="grid2" style="gap:10px">
        <label class="finField">
          <div class="muted" style="margin-bottom:6px">Ingreso esperado (mes)</div>
          <input id="finExpectedIncomeInput" class="finInput" inputmode="decimal" placeholder="2800" value="${expectedIncome||""}">
        </label>

        <div class="finDebtStat" style="align-self:end">
          <div class="muted">Pago mensual de deudas</div>
          <div class="big">S/ ${financeFmtPEN(monthly)}</div>
        </div>
      </div>

      <div class="finGapRow">
        <div class="muted">${gapLabel}</div>
        <div class="finGapVal ${gapCls}">S/ ${financeFmtPEN(Math.abs(gap))}</div>
      </div>

      <div style="height:140px; margin-top:10px">
        <canvas id="financeDebtChart" width="320" height="140"></canvas>
      </div>
    </div>
  `;
}



function financeDebtTotalBalance(){
  return financeDebtsActive().reduce((s,d)=> s + Math.max(0, financeDebtSafeNum(d.balance)), 0);
}

function financeDebtMonthlyTotal(){
  return financeDebtsActive().filter(d=>String(d.status||"active")==="active").reduce((s,d)=> s + financeDebtSafeNum(d.monthlyDue), 0);
}

function financeDebtNextDueISO(dueDay){
  const dd = Math.min(31, Math.max(1, Number(dueDay||30)));
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const daysInThisMonth = new Date(y, m+1, 0).getDate();
  const day = Math.min(dd, daysInThisMonth);
  let due = new Date(y, m, day, 12, 0, 0);
  if(due.getTime() < now.getTime() - 12*3600*1000){
    // next month
    const y2 = (m===11)? (y+1) : y;
    const m2 = (m===11)? 0 : (m+1);
    const dim2 = new Date(y2, m2+1, 0).getDate();
    const day2 = Math.min(dd, dim2);
    due = new Date(y2, m2, day2, 12, 0, 0);
  }
  return due.toISOString().slice(0,10);
}

function financeDebtDueLabel(iso){
  try{
    const d = new Date(iso);
    return d.toLocaleDateString("es-PE", { weekday:"short", day:"2-digit", month:"short" });
  }catch(e){ return iso; }
}

function financeDebtStatusChip(d){
  const st = String(d.status||"active");
  if(st==="closed") return `<span class="chip chipGood">Pagada</span>`;
  return `<span class="chip chipWarn">Activa</span>`;
}

function financeDebtProgress(d){
  const orig = Math.max(0.01, financeDebtSafeNum(d.originalBalance||d.balance||0));
  const bal = Math.max(0, financeDebtSafeNum(d.balance));
  const paid = Math.max(0, orig - bal);
  const pct = Math.max(0, Math.min(100, Math.round((paid/orig)*100)));
  return {orig, bal, paid, pct};
}


// ===== Finance Commitments (Servicios / gastos fijos) + Pillars =====
function financeEnsureCommitments(){
  if(!Array.isArray(state.financeCommitments)) state.financeCommitments = [];
  if(!Array.isArray(state.financeCommitmentGroups)) state.financeCommitmentGroups = ["Hogar","Servicios","Suscripciones","Salud","Otros"];
  if(!Array.isArray(state.financeCommitmentTemplates)) state.financeCommitmentTemplates = [];
  if(!Array.isArray(state.financeCommitmentInstances)) state.financeCommitmentInstances = [];
  if(!Array.isArray(state.financeLoanUsageLedger)) state.financeLoanUsageLedger = [];

  (state.financePaymentSources||[]).forEach(s=>{
    if(s.isDebtInstrument === undefined){
      s.isDebtInstrument = ["loan","credit_card","third_party"].includes(String(s.sourceType||""));
    }
  });

  if(!(state.financeCommitmentTemplates||[]).length && (state.financeCommitments||[]).length){
    state.financeCommitmentTemplates = state.financeCommitments.map(c=>({
      id: c.id || uid("ctpl"),
      legacyCommitmentId: c.id || null,
      name: c.name || "Compromiso",
      category: c.group || "Otros",
      recurrence: "monthly",
      dueDay: Math.max(1, Math.min(31, Number(c.dueDay||1))),
      amountMode: "fixed",
      baseAmount: Number(c.amount||0),
      lastKnownAmount: Number(c.amount||0),
      autoCreateMonthly: true,
      isActive: c.active!==false,
      notes: c.note || "",
      createdAt: c.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
  }

  // Clean up orphaned instances whose template has been deleted (run after migrations)
  const _knownTplIds = new Set((state.financeCommitmentTemplates||[]).map(t=>t.id));
  state.financeCommitmentInstances = (state.financeCommitmentInstances||[]).filter(i=>_knownTplIds.has(i.templateId));

  // Clean up orphaned obligations whose commitment template has been deleted
  if(Array.isArray(state.financeObligations) && state.financeObligations.length){
    const _oblAllowedIds = new Set();
    (state.financeCommitmentTemplates||[]).forEach(t=>{
      _oblAllowedIds.add(t.id);
      if(t.legacyCommitmentId) _oblAllowedIds.add(t.legacyCommitmentId);
    });
    state.financeObligations = state.financeObligations.filter(o =>
      _oblAllowedIds.has(o.id) || (o.legacyCommitmentId && _oblAllowedIds.has(o.legacyCommitmentId))
    );
  }

  const monthKey = getCurrentMonthKey();
  const now = new Date();
  for(const t of (state.financeCommitmentTemplates||[])){
    if(t.isActive===false || t.autoCreateMonthly===false) continue;
    const exists = (state.financeCommitmentInstances||[]).some(i=>i.templateId===t.id && i.periodKey===monthKey);
    if(exists) continue;
    const expected = String(t.amountMode||"fixed")==="variable" ? Number(t.lastKnownAmount||t.baseAmount||0) : Number(t.baseAmount||0);
    state.financeCommitmentInstances.unshift({
      id: uid("cmi"),
      templateId: t.id,
      periodKey: monthKey,
      label: `${t.name} ${monthKey}`,
      expectedAmount: expected,
      actualAmount: null,
      dueDate: `${monthKey}-${String(Math.max(1, Math.min(31, Number(t.dueDay||1)))).padStart(2,'0')}`,
      status: "pending",
      paidAmount: 0,
      paidAt: null,
      paymentSourceId: null,
      linkedDebtId: null,
      notes: "",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
  }

  // Backward compatibility: seed legacy list from templates if empty.
  if(!(state.financeCommitments||[]).length && (state.financeCommitmentTemplates||[]).length){
    state.financeCommitments = state.financeCommitmentTemplates.map(t=>({
      id: t.legacyCommitmentId || t.id,
      name: t.name,
      group: t.category,
      amount: Number(t.baseAmount||0),
      dueDay: Number(t.dueDay||1),
      note: t.notes || "",
      createdAt: t.createdAt || new Date().toISOString(),
      active: t.isActive!==false
    }));
  }
}

function financeCommitmentTemplateById(id){
  return (state.financeCommitmentTemplates||[]).find(x=>x.id===id);
}

function financeCommitmentStatusChip(st){
  const v = String(st||"pending");
  const map = {
    pending:["⏳","Pendiente"], paid:["✅","Pagado"], partial:["🟡","Parcial"], overdue:["⚠️","Vencido"], postponed:["⏭️","Postergado"], covered_by_debt:["💳","Cubierto con deuda"], cancelled:["⛔","Cancelado"]
  };
  const [ico,label] = map[v] || map.pending;
  return `<span class="chip chipWarn">${ico} ${label}</span>`;
}

function financeCommitmentMonthModel(monthKey){
  financeEnsureCommitments();
  const mk = monthKey || getCurrentMonthKey();
  const instances = (state.financeCommitmentInstances||[])
    .filter(i=>i.periodKey===mk)
    .map(i=> ({...i, template: financeCommitmentTemplateById(i.templateId)}))
    .sort((a,b)=> new Date(a.dueDate)-new Date(b.dueDate));
  const total = instances.reduce((s,i)=>s+Number(i.expectedAmount||0),0);
  const paid = instances.reduce((s,i)=>s+Number(i.paidAmount||0),0);
  const pending = instances.filter(i=>["pending","partial","overdue","postponed"].includes(String(i.status||"pending"))).reduce((s,i)=>s+Math.max(0, Number(i.expectedAmount||0)-Number(i.paidAmount||0)),0);
  const overdue = instances.filter(i=>String(i.status||"")==="overdue").reduce((s,i)=>s+Math.max(0, Number(i.expectedAmount||0)-Number(i.paidAmount||0)),0);
  const coveredByDebt = instances.filter(i=>String(i.status||"")==="covered_by_debt").reduce((s,i)=>s+Number(i.paidAmount||0),0);
  const resolved = instances.filter(i=>["paid","covered_by_debt","cancelled"].includes(String(i.status||""))).length;
  return {mk,instances,total,paid,pending,overdue,coveredByDebt,resolutionPct: instances.length?Math.round((resolved/instances.length)*100):0};
}

function financeComputePillars(monthKey){
  const ledger = financeActiveLedger();
  const mk = monthKey || getCurrentMonthKey();

  const isInMonth = (iso)=>{
    try{
      const d = new Date(iso);
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,"0");
      return `${y}-${m}`===mk;
    }catch(e){ return false; }
  };

  const fergisAccountIds = (state.financeAccounts||[])
    .filter(a => String(a.name||"").toLowerCase().includes("fergis"))
    .map(a => a.id);

  let market=0, services=0, debts=0, other=0;
  for(const e of ledger){
    if(e.archived) continue;
    if(fergisAccountIds.includes(e.accountId)) continue; // Exclude from global pillars
    if(e.type!=="expense") continue;
    if(!isInMonth(e.date)) continue;

    const cat = String(e.category||"").toLowerCase();
    const kind = String(e.kind||"").toLowerCase();

    if(cat==="mercado" || cat==="market" || kind==="shopping_auto") market += Number(e.amount||0);
    else if(cat==="deudas" || kind==="debt_payment") debts += Number(e.amount||0);
    else if(cat==="servicios" || cat==="compromisos" || kind==="commitment_payment") services += Number(e.amount||0);
    else other += Number(e.amount||0);
  }

  try{
    const plannedDebts = (state.financeDebts||[]).filter(d=>String(d.status||"active")!=="closed").reduce((sum,d)=> sum + (Number(d.monthlyDue||0) || 0), 0);
    const plannedCommitments = financeCommitmentMonthModel(mk).instances.reduce((sum,i)=>sum + Number(i.expectedAmount||0),0);
    debts += plannedDebts;
    services += plannedCommitments;
  }catch(_e){}

  return {market, services, debts, other};
}

function openFinanceCommitmentModal(existing){
  financeEnsureCommitments();
  _ensureFcStyles();
  const t = existing || { id: uid("ctpl"), name:"", category:"Hogar", dueDay:1, amountMode:"fixed", baseAmount:0, lastKnownAmount:0, notes:"", isActive:true, autoCreateMonthly:true, recurrence:"monthly" };
  const groups = (state.financeCommitmentGroups||["Hogar","Servicios","Salud","Transporte","Suscripciones","Otros"]);
  const REC_OPTS = [['monthly','Mensual'],['weekly','Semanal'],['bimonthly','Quincenal'],['once','Una vez']];

  const overlay = document.createElement('div');
  overlay.className = 'fc-overlay';
  overlay.innerHTML = `
    <div class="fc-sheet" style="max-height:85vh">
      <div class="fc-drag"></div>
      <div class="fc-sh-head">
        <div class="fc-sh-title">${existing ? '✏️ Editar compromiso' : '📋 Nuevo compromiso'}</div>
        <button class="fc-sh-close" id="cmtShClose">✕</button>
      </div>
      <div class="fc-sh-body" style="overflow-y:auto;flex:1;min-height:0">

        <div class="cmt-field">
          <div class="cmt-field-label">Nombre</div>
          <input class="cmt-inp" id="cmtName" placeholder="ej: Alquiler, Netflix, Luz…" value="${escapeAttr(t.name||'')}" maxlength="48">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="cmt-field">
            <div class="cmt-field-label">Categoría</div>
            <select class="cmt-inp" id="cmtGroup" style="appearance:auto">
              ${groups.map(g=>`<option value="${escapeAttr(g)}" ${t.category===g?'selected':''}>${escapeHtml(g)}</option>`).join('')}
            </select>
          </div>
          <div class="cmt-field">
            <div class="cmt-field-label">Día de vencimiento</div>
            <input class="cmt-inp" id="cmtDay" type="number" min="1" max="31" value="${Number(t.dueDay||1)}" placeholder="1-31">
          </div>
        </div>

        <div class="cmt-field">
          <div class="cmt-field-label">Frecuencia</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap" id="cmtRecWrap">
            ${REC_OPTS.map(([v,l])=>`<button type="button" class="cmt-rec-opt ${String(t.recurrence||'monthly')===v?'active':''}" data-rec="${v}">${l}</button>`).join('')}
          </div>
          <input type="hidden" id="cmtRecurrence" value="${escapeAttr(t.recurrence||'monthly')}">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="cmt-field">
            <div class="cmt-field-label">Monto</div>
            <select class="cmt-inp" id="cmtAmountMode" style="appearance:auto">
              <option value="fixed" ${String(t.amountMode||'fixed')==='fixed'?'selected':''}>Fijo</option>
              <option value="variable" ${String(t.amountMode||'fixed')==='variable'?'selected':''}>Variable</option>
            </select>
          </div>
          <div class="cmt-field">
            <div class="cmt-field-label">Monto base (S/)</div>
            <input class="cmt-inp" id="cmtAmount" type="number" step="0.01" min="0" value="${Number(t.baseAmount||0)}" placeholder="0.00">
          </div>
        </div>

        <div class="cmt-field">
          <div class="cmt-field-label">Nota (opcional)</div>
          <textarea class="cmt-inp" id="cmtNote" rows="2" placeholder="Detalles, cuenta, referencia…" style="resize:vertical">${escapeHtml(t.notes||'')}</textarea>
        </div>

        <div style="display:flex;gap:18px;margin-bottom:14px">
          <label style="display:flex;align-items:center;gap:7px;font-size:12px;color:rgba(255,255,255,.6);cursor:pointer">
            <input type="checkbox" id="cmtActive" ${t.isActive!==false?'checked':''} style="accent-color:#7c5cff;width:15px;height:15px">
            Activo
          </label>
          <label style="display:flex;align-items:center;gap:7px;font-size:12px;color:rgba(255,255,255,.6);cursor:pointer">
            <input type="checkbox" id="cmtAuto" ${t.autoCreateMonthly!==false?'checked':''} style="accent-color:#7c5cff;width:15px;height:15px">
            Auto-crear cada mes
          </label>
        </div>

      </div>
      <div class="fc-sh-footer" style="${existing?'justify-content:space-between':''}">
        ${existing ? `<button class="fc-btn-sec" id="cmtDelBtn" style="color:#fb7185;border-color:rgba(251,113,133,.3)">🗑️ Eliminar</button>` : ''}
        <button class="fc-btn-pri" id="cmtSaveBtn" style="flex:2">Guardar</button>
      </div>
    </div>
  `;

  // Inject cmt-field styles if needed (reuses fc-sheet styles already in DOM)
  if(!document.getElementById('cmtModalStyles')){
    const s = document.createElement('style');
    s.id = 'cmtModalStyles';
    s.textContent = `
      .cmt-field{ margin-bottom:14px }
      .cmt-field-label{ font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:6px }
      .cmt-inp{ width:100%;padding:11px 13px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);border-radius:12px;color:#fff;font-size:14px;outline:none;transition:border .15s }
      .cmt-inp:focus{ border-color:rgba(124,92,255,.6) }
      .cmt-inp::placeholder{ color:rgba(255,255,255,.25) }
      .cmt-inp.err{ border-color:#fb7185 }
      .cmt-rec-opt{ padding:7px 13px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:rgba(255,255,255,.6);font-size:12px;font-weight:600;cursor:pointer;transition:all .13s }
      .cmt-rec-opt.active{ background:rgba(124,92,255,.2);border-color:rgba(124,92,255,.5);color:#a78bfa }
    `;
    document.head.appendChild(s);
  }

  document.body.appendChild(overlay);

  const closeSheet = ()=> overlay.remove();
  overlay.querySelector('#cmtShClose').addEventListener('click', closeSheet);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) closeSheet(); });

  // Recurrence buttons
  overlay.querySelector('#cmtRecWrap').addEventListener('click', e=>{
    const btn = e.target.closest('.cmt-rec-opt');
    if(!btn) return;
    overlay.querySelectorAll('.cmt-rec-opt').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    overlay.querySelector('#cmtRecurrence').value = btn.dataset.rec;
  });

  // Delete
  overlay.querySelector('#cmtDelBtn')?.addEventListener('click', ()=>{
    if(!confirm('¿Eliminar este compromiso?')) return;
    financeEnsureCommitments();
    state.financeCommitmentTemplates = (state.financeCommitmentTemplates||[]).filter(x=>x.id!==t.id);
    state.financeCommitments = (state.financeCommitments||[]).filter(x=>x.id!==t.id);
    state.financeCommitmentInstances = (state.financeCommitmentInstances||[]).filter(x=>x.templateId!==t.id);
    const legacyId = t.legacyCommitmentId;
    state.financeObligations = (state.financeObligations||[]).filter(o=>o.id!==t.id && o.id!==legacyId && o.legacyCommitmentId!==t.id && o.legacyCommitmentId!==legacyId);
    persist(); closeSheet(); view();
  });

  // Save
  overlay.querySelector('#cmtSaveBtn').addEventListener('click', ()=>{
    const nameEl = overlay.querySelector('#cmtName');
    const name = (nameEl.value||'').trim();
    if(!name){ nameEl.classList.add('err'); nameEl.focus(); return; }
    nameEl.classList.remove('err');

    const group = (overlay.querySelector('#cmtGroup').value||'Otros').trim();
    const dueDay = Math.max(1, Math.min(31, Number(overlay.querySelector('#cmtDay').value||1)));
    const recurrence = overlay.querySelector('#cmtRecurrence').value || 'monthly';
    const amountMode = overlay.querySelector('#cmtAmountMode').value || 'fixed';
    const baseAmount = Number(overlay.querySelector('#cmtAmount').value||0);
    const notes = (overlay.querySelector('#cmtNote').value||'').trim();
    const isActive = !!overlay.querySelector('#cmtActive').checked;
    const autoCreateMonthly = !!overlay.querySelector('#cmtAuto').checked;

    const arr = state.financeCommitmentTemplates;
    const idx = arr.findIndex(x=>x.id===t.id);
    const nowIso = new Date().toISOString();
    const base = (idx>=0 ? arr[idx] : {id:t.id, createdAt:nowIso});
    const obj = {...base, name, category:group, recurrence, dueDay, amountMode, baseAmount, lastKnownAmount:Number(base.lastKnownAmount??baseAmount), autoCreateMonthly, isActive, notes, updatedAt:nowIso};
    if(idx>=0) arr[idx]=obj; else arr.unshift(obj);

    // legacy sync
    const legacy = (state.financeCommitments||[]);
    const li = legacy.findIndex(x=>x.id===t.id || x.id===obj.legacyCommitmentId);
    const legacyObj = { id: obj.legacyCommitmentId || obj.id, name, group, dueDay, amount:baseAmount, note:notes, active:isActive, createdAt:base.createdAt||nowIso };
    if(li>=0) legacy[li]=legacyObj; else legacy.unshift(legacyObj);
    obj.legacyCommitmentId = legacyObj.id;

    // sync obligations so Mission Control stays up to date
    if(!Array.isArray(state.financeObligations)) state.financeObligations = [];
    const oblId = legacyObj.id;
    const oblIdx = (state.financeObligations).findIndex(o=>o.id===oblId || o.id===obj.id || o.legacyCommitmentId===oblId);
    const oblObj = { id: oblId, name, category:group, type:'essential_fixed', amountExpected:Number(baseAmount||0), dueDate:Number(dueDay||1), recurrence, priority:'high', isActive, status:'pending', notes, legacyCommitmentId:oblId };
    if(oblIdx>=0) state.financeObligations[oblIdx]=oblObj; else state.financeObligations.push(oblObj);

    persist(); closeSheet(); view();
  });

  setTimeout(()=> overlay.querySelector('#cmtName')?.focus(), 100);
}

function saveFinanceCommitment(id){
  financeEnsureCommitments();
  const name = (document.querySelector("#cmtName")?.value||"").trim();
  if(!name){ alert("Ponle un nombre al compromiso."); return; }
  const group = (document.querySelector("#cmtGroup")?.value||"Otros").trim();
  const dueDay = Math.max(1, Math.min(31, Number(document.querySelector("#cmtDay")?.value||1)));
  const amountMode = (document.querySelector("#cmtAmountMode")?.value||"fixed");
  const baseAmount = Number(document.querySelector("#cmtAmount")?.value||0);
  const notes = (document.querySelector("#cmtNote")?.value||"").trim();
  const isActive = !!document.querySelector("#cmtActive")?.checked;
  const autoCreateMonthly = !!document.querySelector("#cmtAuto")?.checked;

  const arr = state.financeCommitmentTemplates;
  const i = arr.findIndex(x=>x.id===id);
  const nowIso = new Date().toISOString();
  const base = (i>=0 ? arr[i] : {id, createdAt: nowIso});
  const obj = {...base, name, category:group, recurrence:"monthly", dueDay, amountMode, baseAmount, lastKnownAmount:Number(base.lastKnownAmount??baseAmount), autoCreateMonthly, isActive, notes, updatedAt: nowIso};
  if(i>=0) arr[i]=obj; else arr.unshift(obj);

  const legacy = (state.financeCommitments||[]);
  const li = legacy.findIndex(x=>x.id===id || x.id===obj.legacyCommitmentId);
  const legacyObj = { id: obj.legacyCommitmentId || obj.id, name, group, dueDay, amount: baseAmount, note: notes, active:isActive, createdAt: base.createdAt || nowIso };
  if(li>=0) legacy[li]=legacyObj; else legacy.unshift(legacyObj);
  obj.legacyCommitmentId = legacyObj.id;

  // sync obligations so Mission Control stays up to date
  if(!Array.isArray(state.financeObligations)) state.financeObligations = [];
  const oblId = legacyObj.id;
  const oblIdx = (state.financeObligations).findIndex(o=>o.id===oblId || o.id===obj.id || o.legacyCommitmentId===oblId);
  const oblObj = { id: oblId, name, category:group, type:'essential_fixed', amountExpected:Number(baseAmount||0), dueDate:Number(dueDay||1), recurrence:'monthly', priority:'high', isActive, status:'pending', notes, legacyCommitmentId:oblId };
  if(oblIdx>=0) state.financeObligations[oblIdx]=oblObj; else state.financeObligations.push(oblObj);

  persist(); closeModal(); view();
}

function deleteFinanceCommitment(id){
  if(!confirm("¿Eliminar este compromiso?")) return;
  financeEnsureCommitments();
  const tpl = (state.financeCommitmentTemplates||[]).find(x=>x.id===id);
  state.financeCommitmentTemplates = (state.financeCommitmentTemplates||[]).filter(x=>x.id!==id);
  state.financeCommitments = (state.financeCommitments||[]).filter(x=>x.id!==id);
  state.financeCommitmentInstances = (state.financeCommitmentInstances||[]).filter(x=>x.templateId!==id);
  const legacyId = tpl?.legacyCommitmentId;
  state.financeObligations = (state.financeObligations||[]).filter(o=>o.id!==id && o.id!==legacyId && o.legacyCommitmentId!==id && o.legacyCommitmentId!==legacyId);
  persist(); closeModal(); view();
}

function financeCommitmentPaidInMonth(commitmentId, monthKey){
  const mk = monthKey || getCurrentMonthKey();
  return (state.financeCommitmentInstances||[]).some(i=>i.periodKey===mk && i.templateId===commitmentId && ["paid","covered_by_debt"].includes(String(i.status||"")));
}

function openFinanceCommitmentPayModal(id){
  const model = financeCommitmentMonthModel(getCurrentMonthKey());
  const c = model.instances.find(i=>i.id===id || i.templateId===id);
  if(!c) return;
  const tmpl = c.template || {name:"Compromiso"};
  const srcOptions = (state.financePaymentSources||[]).filter(s=>s.isActive!==false).map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  const statuses = ["pending","paid","partial","overdue","postponed","covered_by_debt","cancelled"];
  const hist = (state.financeCommitmentInstances||[]).filter(i=>i.templateId===c.templateId && i.id!==c.id).sort((a,b)=> String(b.periodKey).localeCompare(String(a.periodKey))).slice(0,6).map(h=>`<div class="dueRow"><div>${h.periodKey} · S/ ${_financeFmt(h.expectedAmount||0)}</div><div class="muted">${h.status} · pagado S/ ${_financeFmt(h.paidAmount||0)}</div></div>`).join("") || `<div class="muted">Sin historial.</div>`;
  const html = `<div class="modalOverlay" onclick="closeModal(event)"><div class="modal modalBig" onclick="event.stopPropagation()"><div class="modalHeader"><div class="modalTitle">${escapeHtml(tmpl.name)} · ${c.periodKey}</div><button class="iconBtn" onclick="closeModal()">✕</button></div><div class="modalBody modalScroll"><div class="muted">Último monto conocido: S/ ${_financeFmt(tmpl.lastKnownAmount||tmpl.baseAmount||0)}</div><label class="fieldLabel" style="margin-top:10px">Monto esperado mes</label><input id="cmtInstExpected" type="number" step="0.01" class="textInput" value="${Number(c.expectedAmount||0)}" /><label class="fieldLabel" style="margin-top:10px">Monto pagado</label><input id="cmtPayAmt" type="number" step="0.01" class="textInput" value="${Number(c.paidAmount||0)}" /><div class="row" style="gap:10px;margin-top:10px"><div style="flex:1"><label class="fieldLabel">Estado</label><select id="cmtPayStatus" class="textInput">${statuses.map(st=>`<option value="${st}" ${String(c.status)===st?'selected':''}>${st}</option>`).join("")}</select></div><div style="flex:1"><label class="fieldLabel">Fuente</label><select id="cmtPaySource" class="textInput"><option value="">—</option>${srcOptions}</select></div></div><label class="fieldLabel" style="margin-top:10px">Fecha pago</label><input id="cmtPayDate" type="date" class="textInput" value="${(c.paidAt||new Date().toISOString()).slice(0,10)}" /><label class="fieldLabel" style="margin-top:10px">Nota</label><textarea id="cmtPayNote" class="textInput" rows="3">${escapeHtml(c.notes||"")}</textarea><div class="hr" style="margin:12px 0"></div><div><strong>Historial reciente</strong></div>${hist}</div><div class="modalFooter"><div></div><button class="btn primary" onclick="saveFinanceCommitmentPayment('${c.id}')">Guardar</button></div></div></div>`;
  showModal(html);
  setTimeout(()=>{ const el=document.querySelector('#cmtPaySource'); if(el) el.value=c.paymentSourceId||""; },0);
}

function saveFinanceCommitmentPayment(instanceId){
  financeEnsureCommitments();
  const inst = (state.financeCommitmentInstances||[]).find(x=>x.id===instanceId);
  if(!inst) return;
  const expectedAmount = Number(document.querySelector("#cmtInstExpected")?.value||inst.expectedAmount||0);
  const paidAmount = Number(document.querySelector("#cmtPayAmt")?.value||0);
  const date = document.querySelector("#cmtPayDate")?.value || new Date().toISOString().slice(0,10);
  const status = (document.querySelector("#cmtPayStatus")?.value||"pending");
  const sourceId = document.querySelector("#cmtPaySource")?.value || null;
  const noteExtra = (document.querySelector("#cmtPayNote")?.value||"").trim();
  const src = (state.financePaymentSources||[]).find(s=>s.id===sourceId);
  const t = financeCommitmentTemplateById(inst.templateId);

  inst.expectedAmount = expectedAmount;
  inst.actualAmount = paidAmount || inst.actualAmount;
  inst.paidAmount = paidAmount;
  inst.paidAt = paidAmount>0 ? new Date(`${date}T12:00:00`).toISOString() : null;
  inst.paymentSourceId = sourceId;
  inst.notes = noteExtra;
  inst.status = status;
  inst.updatedAt = new Date().toISOString();

  if(t){ t.lastKnownAmount = expectedAmount || t.lastKnownAmount || t.baseAmount; t.updatedAt = new Date().toISOString(); }

  if(paidAmount>0){
    addFinanceEntry({
      type: "expense",
      amount: paidAmount,
      accountId: state.financeLastAccountId || (state.financeAccounts||[])[0]?.id,
      category: "Servicios",
      reason: "planificado",
      note: `Compromisos · ${(t?.name||'Compromiso')}${noteExtra?(" · "+noteExtra):""}`,
      date: new Date(`${date}T12:00:00`).toISOString(),
      kind: "commitment_payment",
      commitmentId: inst.templateId,
      commitmentInstanceId: inst.id,
      paymentSourceId: sourceId,
      usedDebtSource: !!(src && (src.isDebtInstrument || src.sourceType==="loan"))
    });
  }

  if(paidAmount>0 && src && (src.isDebtInstrument || src.sourceType==="loan")){
    state.financeLoanUsageLedger.unshift({
      id: uid("loanuse"),
      sourceId: src.id,
      commitmentInstanceId: inst.id,
      amount: paidAmount,
      date: new Date(`${date}T12:00:00`).toISOString(),
      usageType: "bill_payment",
      note: noteExtra || ""
    });
  }

  persist();
  closeModal();
  view();
}

function renderFinanceCommitmentsTab(){
  const fmt = _financeFmt;
  const model = financeCommitmentMonthModel(getCurrentMonthKey());
  const now = new Date();

  // Inject styles once
  if(!document.getElementById('cmtStyles')){
    const s = document.createElement('style');
    s.id = 'cmtStyles';
    s.textContent = `
      .cmt-wrap{ display:flex;flex-direction:column;gap:12px;padding-bottom:20px }
      .cmt-summary{ display:grid;grid-template-columns:repeat(3,1fr);gap:8px }
      .cmt-sum-card{ background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:10px 12px }
      .cmt-sum-val{ font-size:16px;font-weight:800;margin-bottom:2px }
      .cmt-sum-lbl{ font-size:10px;color:rgba(255,255,255,.4);letter-spacing:.3px }
      .cmt-sum-card.c-green .cmt-sum-val{ color:#36d399 }
      .cmt-sum-card.c-yellow .cmt-sum-val{ color:#fbbf24 }
      .cmt-sum-card.c-red .cmt-sum-val{ color:#fb7185 }
      .cmt-sum-card.c-purple .cmt-sum-val{ color:#7c5cff }
      .cmt-prog-wrap{ background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:12px 14px }
      .cmt-prog-top{ display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px }
      .cmt-prog-pct{ font-weight:700;color:#7c5cff }
      .cmt-prog-track{ height:8px;background:rgba(255,255,255,.07);border-radius:4px;overflow:hidden }
      .cmt-prog-fill{ height:100%;border-radius:4px;background:linear-gradient(90deg,#7c5cff,#36d399);transition:width .4s }
      .cmt-group-head{ font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:rgba(255,255,255,.35);font-weight:700;padding:4px 0 8px }
      .cmt-card{ background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;overflow:hidden;margin-bottom:8px }
      .cmt-card:last-child{ margin-bottom:0 }
      .cmt-card-main{ display:flex;align-items:center;gap:12px;padding:13px 14px;cursor:pointer;transition:background .13s }
      .cmt-card-main:hover{ background:rgba(255,255,255,.03) }
      .cmt-card-left{ display:flex;align-items:center;gap:10px;flex:1;min-width:0 }
      .cmt-status-dot{ width:10px;height:10px;border-radius:50%;flex-shrink:0 }
      .cmt-info{ flex:1;min-width:0 }
      .cmt-name{ font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
      .cmt-meta{ font-size:11px;color:rgba(255,255,255,.38);margin-top:2px }
      .cmt-right{ text-align:right;flex-shrink:0 }
      .cmt-amt{ font-size:14px;font-weight:800 }
      .cmt-paid{ font-size:10px;color:rgba(255,255,255,.35);margin-top:1px }
      .cmt-card-actions{ display:flex;border-top:1px solid rgba(255,255,255,.06) }
      .cmt-action-btn{ flex:1;padding:9px;font-size:11px;font-weight:600;background:none;border:none;color:rgba(255,255,255,.5);cursor:pointer;transition:background .13s,color .13s;letter-spacing:.2px }
      .cmt-action-btn:hover{ background:rgba(255,255,255,.05);color:#fff }
      .cmt-action-btn.pay{ color:#7c5cff }
      .cmt-action-btn.pay:hover{ background:rgba(124,92,255,.1) }
      .cmt-action-btn.edit{ border-left:1px solid rgba(255,255,255,.06) }
      .cmt-action-btn.del{ color:#fb7185;border-left:1px solid rgba(255,255,255,.06) }
      .cmt-action-btn.del:hover{ background:rgba(251,113,133,.08) }
      .cmt-rec-badge{ font-size:9px;font-weight:700;letter-spacing:.4px;padding:2px 6px;border-radius:6px;display:inline-block;background:rgba(124,92,255,.15);color:#a78bfa;border:1px solid rgba(124,92,255,.2);margin-left:6px;vertical-align:middle }
      .cmt-add-btn{ width:100%;padding:13px;border-radius:14px;border:1.5px dashed rgba(124,92,255,.35);background:rgba(124,92,255,.05);color:rgba(124,92,255,.9);font-size:13px;font-weight:600;cursor:pointer;transition:background .14s,border-color .14s }
      .cmt-add-btn:hover{ background:rgba(124,92,255,.1);border-color:rgba(124,92,255,.55) }
    `;
    document.head.appendChild(s);
  }

  const statusColor = st => {
    if(st==='paid'||st==='covered_by_debt') return '#36d399';
    if(st==='overdue') return '#fb7185';
    if(st==='partial') return '#fbbf24';
    return 'rgba(255,255,255,.25)';
  };
  const statusLabel = st => {
    const map = {paid:'Pagado',covered_by_debt:'Con deuda',overdue:'Vencido',partial:'Parcial',pending:'Pendiente',postponed:'Postergado',cancelled:'Cancelado'};
    return map[st]||st;
  };

  const bucketOrder = ['hoy','esta semana','urgente','postergable'];
  const buckets = {};
  model.instances.forEach(i=>{
    const due = new Date(`${i.dueDate}T12:00:00`);
    const diff = Math.floor((due-now)/(24*60*60*1000));
    if(["pending","partial"].includes(String(i.status||"pending")) && due < now) i.status = "overdue";
    const b = diff<=0?'hoy':(diff<=7?'esta semana':(diff<=14?'urgente':'postergable'));
    if(!buckets[b]) buckets[b]=[];
    buckets[b].push(i);
  });

  const bucketLabel = {'hoy':'\uD83D\uDCC5 Para hoy','esta semana':'\u26A1 Esta semana','urgente':'\u23F0 Pr\u00F3ximos 14 d\u00EDas','postergable':'\uD83D\uDCC6 Resto del mes'};

  const instRows = bucketOrder.filter(b=>buckets[b]?.length).map(b=>`
    <div class="cmt-group-head">${bucketLabel[b]}</div>
    ${buckets[b].map(i=>{
      const tmpl = i.template||{};
      const recLabel = tmpl.recurrence==='monthly'?'mensual':(tmpl.recurrence==='weekly'?'semanal':(tmpl.recurrence||''));
      const tplId = escapeAttr(i.templateId||i.id||'');
      return `
        <div class="cmt-card">
          <div class="cmt-card-main" onclick="openFinanceCommitmentPayModal('${i.id}')">
            <div class="cmt-card-left">
              <div class="cmt-status-dot" style="background:${statusColor(i.status)}"></div>
              <div class="cmt-info">
                <div class="cmt-name">${escapeHtml(tmpl.name||i.label||'Compromiso')}${recLabel?`<span class="cmt-rec-badge">${recLabel}</span>`:''}</div>
                <div class="cmt-meta">${escapeHtml(tmpl.category||'General')} &middot; d&iacute;a ${Number(tmpl.dueDay||1)} &middot; ${statusLabel(i.status)}</div>
              </div>
            </div>
            <div class="cmt-right">
              <div class="cmt-amt" style="color:${statusColor(i.status)}">S/ ${fmt(i.expectedAmount||0)}</div>
              <div class="cmt-paid">pagado S/ ${fmt(i.paidAmount||0)}</div>
            </div>
          </div>
          <div class="cmt-card-actions">
            <button class="cmt-action-btn pay" onclick="event.stopPropagation();openFinanceCommitmentPayModal('${i.id}')">&#x1F4B3; Pagar</button>
            <button class="cmt-action-btn edit" onclick="event.stopPropagation();openFinanceCommitmentModalById('${tplId}')">&#x270F;&#xFE0F; Editar</button>
            <button class="cmt-action-btn del" onclick="event.stopPropagation();deleteFinanceCommitment('${tplId}')">&#x1F5D1;&#xFE0F;</button>
          </div>
        </div>
      `;
    }).join('')}
  `).join('');

  const resolvedPct = model.resolutionPct||0;

  return `
    <div class="cmt-wrap">
      <div class="cmt-summary">
        <div class="cmt-sum-card c-purple"><div class="cmt-sum-val">S/ ${fmt(model.total)}</div><div class="cmt-sum-lbl">Total mes</div></div>
        <div class="cmt-sum-card c-green"><div class="cmt-sum-val">S/ ${fmt(model.paid)}</div><div class="cmt-sum-lbl">Pagado</div></div>
        <div class="cmt-sum-card ${model.pending>0?'c-yellow':''}"><div class="cmt-sum-val">S/ ${fmt(model.pending)}</div><div class="cmt-sum-lbl">Pendiente</div></div>
        <div class="cmt-sum-card ${(model.overdue||0)>0?'c-red':''}"><div class="cmt-sum-val">S/ ${fmt(model.overdue||0)}</div><div class="cmt-sum-lbl">Vencido</div></div>
        <div class="cmt-sum-card"><div class="cmt-sum-val">S/ ${fmt(model.coveredByDebt)}</div><div class="cmt-sum-lbl">Con deuda</div></div>
        <div class="cmt-sum-card c-green"><div class="cmt-sum-val">${resolvedPct}%</div><div class="cmt-sum-lbl">Resuelto</div></div>
      </div>
      <div class="cmt-prog-wrap">
        <div class="cmt-prog-top"><span>Compromisos resueltos este mes</span><span class="cmt-prog-pct">${resolvedPct}%</span></div>
        <div class="cmt-prog-track"><div class="cmt-prog-fill" style="width:${resolvedPct}%"></div></div>
      </div>
      ${instRows || '<div style="text-align:center;padding:32px 16px;color:rgba(255,255,255,.3)"><div style="font-size:36px;margin-bottom:10px">&#x1F4CB;</div><div style="font-size:13px">Sin compromisos para este mes.</div></div>'}
      <button class="cmt-add-btn" onclick="openFinanceCommitmentModal()">&#xFF0B; Nuevo compromiso</button>
    </div>
  `;
}

function openFinanceCommitmentModalById(id){
  const c = (state.financeCommitmentTemplates||[]).find(x=>x.id===id);
  if(!c) return;
  openFinanceCommitmentModal(c);
}

try{
  window.openFinanceCommitmentModal = openFinanceCommitmentModal;
  window.openFinanceCommitmentModalById = openFinanceCommitmentModalById;
  window.openFinanceCommitmentPayModal = openFinanceCommitmentPayModal;
  window.saveFinanceCommitment = saveFinanceCommitment;
  window.deleteFinanceCommitment = deleteFinanceCommitment;
  window.saveFinanceCommitmentPayment = saveFinanceCommitmentPayment;
}catch(e){}

// Draw pillars chart after finance render
let _financePillarsChart = null;
function financeDrawPillarsChart(){
  const canvas = document.getElementById("financePillarsChart");
  if(!canvas || !window.Chart) return;
  const monthKey = getCurrentMonthKey();
  const p = financeComputePillars(monthKey);
  try{ if(_financePillarsChart){ _financePillarsChart.destroy(); _financePillarsChart=null; } }catch(e){}
  const ctx = canvas.getContext("2d");
  _financePillarsChart = new Chart(ctx,{
    type:"bar",
    data:{
      labels:["Mercado","Servicios","Deudas","Otros"],
      datasets:[{label:"S/", data:[p.market,p.services,p.debts,p.other]}]
    },
    options:{
      responsive:false,
      maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        y:{beginAtZero:true}
      }
    }
  });
}

function openFinanceDebtModal(existing){
  const d = existing ? {...existing} : {
    id: null,
    name: "",
    provider: "",
    type: "app",
    originalBalance: "",
    balance: "",
    monthlyDue: "",
    dueDay: 30,
    apr: "",
    status: "active",
  };

  const host = document.querySelector('#app') || document.body;
  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:900px;max-height:90vh;overflow:auto" role="dialog" aria-label="Deuda">
      <div class="modalTop">
        <div>
          <div class="modalTitle">${existing ? 'Editar deuda' : 'Nueva deuda'}</div>
          <div class="modalSub">Registra lo que debes y lo que toca pagar cada mes.</div>
        </div>
        <button class="iconBtn" id="finDebtClose">✕</button>
      </div>
      <div class="hr"></div>

      <div class="grid2" style="gap:10px">
        <div class="field">
          <div class="label">Nombre</div>
          <input id="finDebtName" type="text" value="${escapeHtml(d.name||'')}" placeholder="Solventa / Kashin / Tarjeta..." />
        </div>
        <div class="field">
          <div class="label">Proveedor (opcional)</div>
          <input id="finDebtProvider" type="text" value="${escapeHtml(d.provider||'')}" placeholder="Yape, banco, app..." />
        </div>

        <div class="field">
          <div class="label">Tipo</div>
          <select id="finDebtType">
            ${[
              ['loan','Préstamo'],
              ['card','Tarjeta'],
              ['app','App / Microcrédito']
            ].map(x=>`<option value="${x[0]}" ${x[0]===String(d.type||'app')?'selected':''}>${x[1]}</option>`).join('')}
          </select>
        </div>

        <div class="field">
          <div class="label">Día de pago (1-31)</div>
          <input id="finDebtDueDay" type="number" min="1" max="31" value="${escapeHtml(String(d.dueDay||30))}" />
        </div>

        <div class="field">
          <div class="label">Saldo (deuda actual)</div>
          <input id="finDebtBalance" type="number" inputmode="decimal" value="${escapeHtml(String(d.balance||''))}" placeholder="0.00" />
        </div>

        <div class="field">
          <div class="label">Pago mensual (mínimo / cuota)</div>
          <input id="finDebtMonthlyDue" type="number" inputmode="decimal" value="${escapeHtml(String(d.monthlyDue||''))}" placeholder="0.00" />
        </div>

        <div class="field">
          <div class="label">APR / Interés (opcional)</div>
          <input id="finDebtApr" type="number" inputmode="decimal" value="${escapeHtml(String(d.apr||''))}" placeholder="%" />
        </div>
        <div class="field" style="grid-column:1/-1">
          <div class="label">Ruleteo (opcional)</div>
          <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">
            <label class="row" style="gap:6px;align-items:center">
              <input id="finDebtRolloverEnabled" type="checkbox" ${d.rolloverEnabled ? 'checked' : ''} />
              <span>Se puede ruletear</span>
            </label>
            <div class="row" style="gap:6px;align-items:center">
              <span class="muted">Recibes</span>
              <input id="finDebtRolloverPayout" type="number" inputmode="decimal" style="max-width:140px" value="${escapeHtml(String(d.rolloverPayout ?? ''))}" placeholder="0.00" />
            </div>
            <div class="row" style="gap:6px;align-items:center">
              <span class="muted">Confiabilidad</span>
              <input id="finDebtRolloverReliability" type="number" inputmode="decimal" min="0" max="1" step="0.05" style="max-width:120px" value="${escapeHtml(String(d.rolloverReliability ?? ''))}" placeholder="0-1" />
            </div>
          </div>
          <div class="muted">Ej: Kashin 0.95 / 400, Solventa 0.95 / 450, Yape 0.55 / 300.</div>
        </div>


        <div class="field">
          <div class="label">Estado</div>
          <select id="finDebtStatus">
            ${[
              ['active','Activa'],
              ['closed','Pagada'],
              ['archived','Archivada']
            ].map(x=>`<option value="${x[0]}" ${x[0]===String(d.status||'active')?'selected':''}>${x[1]}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="hr" style="margin-top:12px"></div>
      <div class="row" style="gap:10px;justify-content:flex-end">
        <button class="btn" id="finDebtCancel">Cancelar</button>
        <button class="btn primary" id="finDebtSave">Guardar</button>
      </div>
    </div>
  `;
  host.appendChild(backdrop);
  const close = ()=> backdrop.remove();
  backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) close(); });
  backdrop.querySelector('#finDebtClose')?.addEventListener('click', close);
  backdrop.querySelector('#finDebtCancel')?.addEventListener('click', close);

  backdrop.querySelector('#finDebtSave')?.addEventListener('click', ()=>{
    const name = (backdrop.querySelector('#finDebtName')?.value||"").trim();
    if(!name){ alert('Ponle un nombre a la deuda'); return; }
    const provider = (backdrop.querySelector('#finDebtProvider')?.value||"").trim();
    const type = String(backdrop.querySelector('#finDebtType')?.value||'app');
    const dueDay = Math.min(31, Math.max(1, Number(backdrop.querySelector('#finDebtDueDay')?.value||30)));
    const balance = financeDebtSafeNum(backdrop.querySelector('#finDebtBalance')?.value);
    const monthlyDue = financeDebtSafeNum(backdrop.querySelector('#finDebtMonthlyDue')?.value);
    const aprRaw = (backdrop.querySelector('#finDebtApr')?.value||"").trim();
    const apr = aprRaw==="" ? null : financeDebtSafeNum(aprRaw);
    const status = String(backdrop.querySelector('#finDebtStatus')?.value||'active');
    const rolloverEnabled = !!(backdrop.querySelector('#finDebtRolloverEnabled')?.checked);
    const rolloverPayout = financeDebtSafeNum(backdrop.querySelector('#finDebtRolloverPayout')?.value);
    const rolloverReliabilityRaw = (backdrop.querySelector('#finDebtRolloverReliability')?.value||"").trim();
    const rolloverReliability = rolloverReliabilityRaw==="" ? null : Math.max(0, Math.min(1, financeDebtSafeNum(rolloverReliabilityRaw)));


    if(existing){
      existing.name = name;
      existing.provider = provider;
      existing.type = type;
      existing.dueDay = dueDay;
      existing.monthlyDue = monthlyDue;
      existing.apr = apr;
      existing.status = status;
      existing.rolloverEnabled = rolloverEnabled;
      existing.rolloverPayout = rolloverPayout || null;
      existing.rolloverReliability = (rolloverReliability===null? null : rolloverReliability);
      // If user edits balance, keep it.
      existing.balance = balance;
      if(existing.originalBalance === undefined || existing.originalBalance === null) existing.originalBalance = balance;
    }else{
      const id = uid('debt_');
      state.financeDebts.unshift({
        id,
        name,
        provider,
        type,
        originalBalance: balance,
        balance,
        monthlyDue,
        dueDay,
        apr,
        status,
        rolloverEnabled,
        rolloverPayout: rolloverPayout || null,
        rolloverReliability: (rolloverReliability===null? null : rolloverReliability),
        createdAt: new Date().toISOString(),
      });
    }
    persist();
    close();
    view();
  });
}

function openFinanceDebtPayModal(debtId){
  const debt = (state.financeDebts||[]).find(d=>d.id===debtId);
  if(!debt) return;
  if(!(state.financeAccounts||[]).length){ alert('Crea una cuenta primero'); return; }

  const now = new Date();
  const iso = now.toISOString().slice(0,10);
  const host = document.querySelector('#app') || document.body;
  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:720px;max-height:90vh;overflow:auto" role="dialog" aria-label="Registrar pago">
      <div class="modalTop">
        <div>
          <div class="modalTitle">Registrar pago</div>
          <div class="modalSub">${escapeHtml(debt.name)} · saldo S/ ${_financeFmt(debt.balance)}</div>
        </div>
        <button class="iconBtn" id="finPayClose">✕</button>
      </div>
      <div class="hr"></div>

      <div class="grid2" style="gap:10px">
        <div class="field">
          <div class="label">Fecha</div>
          <input id="finPayDate" type="date" value="${iso}" />
        </div>
        <div class="field">
          <div class="label">Monto pagado</div>
          <input id="finPayAmount" type="number" inputmode="decimal" placeholder="0.00" value="${escapeHtml(String(debt.monthlyDue||''))}" />
        </div>
        <div class="field" style="grid-column:1/-1">
          <div class="label">Cuenta</div>
          <select id="finPayAccount">
            ${(state.financeAccounts||[]).map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="grid-column:1/-1">
          <div class="label">Nota (opcional)</div>
          <input id="finPayNote" type="text" placeholder="Ej: cuota febrero" />
        </div>
      </div>

      <div class="hr" style="margin-top:12px"></div>
      <div class="row" style="gap:10px;justify-content:flex-end">
        <button class="btn" id="finPayCancel">Cancelar</button>
        <button class="btn primary" id="finPaySave">Guardar</button>
      </div>
    </div>
  `;
  host.appendChild(backdrop);
  const close = ()=> backdrop.remove();
  backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) close(); });
  backdrop.querySelector('#finPayClose')?.addEventListener('click', close);
  backdrop.querySelector('#finPayCancel')?.addEventListener('click', close);

  backdrop.querySelector('#finPaySave')?.addEventListener('click', ()=>{
    const date = String(backdrop.querySelector('#finPayDate')?.value||iso);
    const amount = financeDebtSafeNum(backdrop.querySelector('#finPayAmount')?.value);
    if(!(amount>0)){ alert('Monto inválido'); return; }
    const accountId = String(backdrop.querySelector('#finPayAccount')?.value||'');
    const noteExtra = (backdrop.querySelector('#finPayNote')?.value||'').trim();

    // Update debt balance
    debt.balance = Math.max(0, financeDebtSafeNum(debt.balance) - amount);
    if(debt.balance<=0) debt.status = 'closed';

    // Also log as finance expense
    const entry = {
      id: uid('fin_'),
      date,
      type: 'expense',
      amount,
      accountId,
      category: 'Deudas',
      reason: 'planificado',
      note: `Pago deuda: ${debt.name}${noteExtra?(' · '+noteExtra):''}`,
      debtId: debt.id,
      kind: 'debt_payment',
      archived: false,
    };
    state.financeLedger.unshift(entry);
    financeRecomputeBalances();
    persist();
    close();
    view();
  });
}

let _financeDebtChart = null;
function financeBindDebtIncomeInput(){
  const el = document.getElementById('finExpectedIncomeInput');
  if(!el) return;
  if(el.dataset.bound==="1") return;
  el.dataset.bound = "1";
  el.addEventListener('input', ()=>{
    const monthKey = getCurrentMonthKey();
    const meta = state.financeMeta[monthKey] || {expectedIncome:0,targetSavings:0};
    const raw = String(el.value||"").replace(/[^0-9.,-]/g,'').replace(',','.');
    const val = Number(raw||0);
    setFinanceMeta(monthKey, isFinite(val)?val:0, meta.targetSavings||0);
    try{ financeDrawDebtChart(); }catch(_e){}
  });
}

function financeDrawDebtChart(){
  const canvas = document.getElementById('financeDebtChart');
  if(!canvas || typeof Chart==='undefined') return;
  const monthKey = getCurrentMonthKey();
  const meta = (state.financeMeta||{})[monthKey] || {expectedIncome:0};
  const income = financeDebtSafeNum(meta.expectedIncome||0);
  const monthly = financeDebtMonthlyTotal();
  const gap = income - monthly;

  try{ if(_financeDebtChart){ _financeDebtChart.destroy(); _financeDebtChart = null; } }catch(e){}

  _financeDebtChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Ingreso esperado', 'Pagos de deuda', 'Gap'],
      datasets: [{
        label: 'S/',
        data: [income, monthly, gap],
        borderWidth: 1,
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      plugins: { legend: { display:false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

/* ====================== FINANCE: DEBTS (Vencimientos + Plan + Simulador) ====================== */

function financeDebtPlannerGet(monthKey){
  state.financeDebtPlanner = state.financeDebtPlanner || {};
  if(!state.financeDebtPlanner[monthKey]){
    state.financeDebtPlanner[monthKey] = {
      strategy: 'snowball', // snowball | avalanche
      extraMonthly: 0,      // extra payment per month (above minimums)
      externalMonthly: 0,   // extra income (ej: emprendimiento Fergis) para cubrir intereses/extra
      includeInterest: true
    };
  }
  return state.financeDebtPlanner[monthKey];
}

function financeDebtPlannerSet(monthKey, patch){
  const cur = financeDebtPlannerGet(monthKey);
  Object.assign(cur, patch||{});
  persist();
  view();
}

function financeDebtUpcomingItems(){
  const now = new Date();
  const todayISO = now.toISOString().slice(0,10);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0);
  const weekEnd = new Date(start.getTime() + 7*24*3600*1000);
  const y = now.getFullYear();
  const m = now.getMonth();

  const actives = financeDebtsActive().filter(d=>String(d.status||'active')==='active');
  const items = actives.map(d=>{
    const dueISO = financeDebtNextDueISO(d.dueDay);
    const dueDate = new Date(dueISO+'T12:00:00');
    return {
      id: d.id,
      name: d.name,
      dueISO,
      dueDate,
      dueLabel: financeDebtDueLabel(dueISO),
      amount: financeDebtSafeNum(d.monthlyDue||0),
      balance: financeDebtSafeNum(d.balance||0),
      apr: financeDebtSafeNum(d.apr||0)
    };
  }).sort((a,b)=> a.dueDate - b.dueDate);

  const inWeek = items.filter(it=> it.dueDate >= start && it.dueDate < weekEnd);
  const inMonth = items.filter(it=> it.dueDate.getFullYear()===y && it.dueDate.getMonth()===m);

  return { todayISO, inWeek, inMonth, all: items };
}

function financeDebtChooseTarget(debts, strategy){
  const list = debts.filter(d=>d.balance>0.01);
  if(!list.length) return null;
  if(strategy==='avalanche'){
    // highest APR first; fallback by balance
    list.sort((a,b)=>{
      const da = financeDebtSafeNum(a.apr||0);
      const db = financeDebtSafeNum(b.apr||0);
      if(db!==da) return db-da;
      return (b.balance||0)-(a.balance||0);
    });
    return list[0];
  }
  // snowball: smallest balance first
  list.sort((a,b)=> (a.balance||0)-(b.balance||0));
  return list[0];
}

function financeDebtSimulate({strategy, extraMonthly, externalMonthly, includeInterest}){
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const debts0 = financeDebtsActive()
    .filter(d=>String(d.status||'active')==='active')
    .map(d=>({
      id: d.id,
      name: d.name,
      apr: financeDebtSafeNum(d.apr||0),
      due: financeDebtSafeNum(d.monthlyDue||0),
      balance: Math.max(0, financeDebtSafeNum(d.balance||0))
    }))
    .filter(d=>d.balance>0);

  const out = {
    months: 0,
    finishISO: null,
    totalInterest: 0,
    totalPaid: 0,
    steps: [],
    ok: debts0.length>0
  };
  if(!out.ok){
    out.finishISO = now.toISOString().slice(0,10);
    return out;
  }

  // Safety caps to avoid infinite loops on bad inputs
  const MAX_MONTHS = 240;

  let debts = debts0;
  let freed = 0; // freed minimums from paid-off debts (snowball effect)
  let monthCursor = new Date(startMonth.getTime());

  for(let month=0; month<MAX_MONTHS; month++){
    // check done
    const remaining = debts.reduce((s,d)=> s + d.balance, 0);
    if(remaining <= 0.01){
      out.months = month;
      out.finishISO = monthCursor.toISOString().slice(0,10);
      break;
    }

    // accrue interest (monthly)
    if(includeInterest){
      for(const d of debts){
        const apr = financeDebtSafeNum(d.apr||0);
        if(apr>0 && d.balance>0){
          const i = d.balance * (apr/100) / 12;
          d.balance += i;
          out.totalInterest += i;
        }
      }
    }

    // pay minimums
    let paidThisMonth = 0;
    for(const d of debts){
      if(d.balance<=0) continue;
      const pay = Math.min(d.balance, Math.max(0, d.due||0));
      d.balance -= pay;
      paidThisMonth += pay;
      if(d.balance<=0.01){
        // debt paid: free its minimum payment for next months
        freed += Math.max(0, d.due||0);
        d.balance = 0;
      }
    }

    // extra pool this month
    let extraPool = Math.max(0, financeDebtSafeNum(extraMonthly||0)) + Math.max(0, financeDebtSafeNum(externalMonthly||0)) + freed;

    // allocate extra to target debt (then next)
    while(extraPool>0.01){
      const target = financeDebtChooseTarget(debts, strategy);
      if(!target) break;
      const pay = Math.min(target.balance, extraPool);
      target.balance -= pay;
      paidThisMonth += pay;
      extraPool -= pay;
      if(target.balance<=0.01){
        freed += Math.max(0, target.due||0);
        target.balance = 0;
      }
    }

    out.totalPaid += paidThisMonth;

    // record first 3 months as steps preview
    if(out.steps.length<3){
      const snapshot = debts
        .filter(d=>d.balance>0.01)
        .sort((a,b)=> b.balance-a.balance)
        .slice(0,5)
        .map(d=> `${d.name}: S/ ${_financeFmt(d.balance)}`);
      out.steps.push({
        monthISO: monthCursor.toISOString().slice(0,10),
        paid: paidThisMonth,
        remaining: debts.reduce((s,d)=> s + d.balance, 0),
        top: snapshot
      });
    }

    // advance month
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth()+1, 1);
  }

  if(!out.finishISO){
    out.months = MAX_MONTHS;
    out.finishISO = monthCursor.toISOString().slice(0,10);
  }
  return out;
}

function financeDebtRenderUpcoming(){
  const fmt = _financeFmt;
  const u = financeDebtUpcomingItems();

  function itemRow(it){
    return `
      <div class="finDueRow">
        <div class="finDueLeft">
          <div class="finDueTitle">${escapeHtml(it.name)}</div>
          <div class="muted">Vence: ${escapeHtml(it.dueLabel)} · saldo S/ ${fmt(it.balance)}</div>
        </div>
        <div class="finDueAmt">S/ ${fmt(it.amount)}</div>
      </div>
    `;
  }

  const weekHtml = u.inWeek.length ? u.inWeek.map(itemRow).join('') : `<div class="muted">Nada en los próximos 7 días.</div>`;
  const monthHtml = u.inMonth.length ? u.inMonth.map(itemRow).join('') : `<div class="muted">Sin vencimientos este mes (según día de pago).</div>`;

  const weekTotal = u.inWeek.reduce((s,x)=> s + financeDebtSafeNum(x.amount), 0);
  const monthTotal = u.inMonth.reduce((s,x)=> s + financeDebtSafeNum(x.amount), 0);

  return `
    <div class="grid2" style="gap:10px">
      <div class="finDueBox">
        <div class="finDueHead">
          <div><strong>Esta semana</strong></div>
          <div class="muted">S/ ${fmt(weekTotal)}</div>
        </div>
        ${weekHtml}
      </div>
      <div class="finDueBox">
        <div class="finDueHead">
          <div><strong>Este mes</strong></div>
          <div class="muted">S/ ${fmt(monthTotal)}</div>
        </div>
        ${monthHtml}
      </div>
    </div>
  `;
}


/* ====================== FINANCE: DEBTS (Modo Supervivencia / Ruleteo) ====================== */

function financeDebtSumCash(){
  return (state.financeAccounts||[]).reduce((s,a)=> s + financeDebtSafeNum(a.balance||0), 0);
}

// Estimate next 7 days market spending using last 14 days average of Mercado expenses
function financeEstimateNext7dMarket(){
  const ledger = financeActiveLedger() || [];
  const now = new Date();
  const start = new Date(now.getTime() - 14*24*3600*1000);
  const byDay = {};
  for(const e of ledger){
    if(!e || e.archived) continue;
    if(String(e.type||'')!=='expense') continue;
    if(String(e.category||'')!=='Mercado') continue;
    const dt = new Date(String(e.date||''));
    if(!(dt instanceof Date) || isNaN(dt)) continue;
    if(dt < start) continue;
    const k = dt.toISOString().slice(0,10);
    byDay[k] = (byDay[k]||0) + financeDebtSafeNum(e.amount||0);
  }
  const days = Object.keys(byDay).length || 0;
  const total = Object.values(byDay).reduce((s,x)=> s + financeDebtSafeNum(x), 0);
  const avgPerDay = days ? (total / days) : 0;
  return Math.max(0, avgPerDay * 7);
}

function financeCommitmentNextDueISO(dueDay){
  return financeDebtNextDueISO(dueDay);
}

function financeCommitmentsUpcomingItems(){
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0);
  const weekEnd = new Date(start.getTime() + 7*24*3600*1000);
  const y = now.getFullYear();
  const m = now.getMonth();

  const actives = (state.financeCommitments||[]).filter(c=>c && c.active!==false);
  const items = actives.map(c=>{
    const dueISO = financeCommitmentNextDueISO(c.dueDay);
    const dueDate = new Date(dueISO+'T12:00:00');
    return {
      id: c.id,
      name: c.name,
      dueISO,
      dueDate,
      dueLabel: financeDebtDueLabel(dueISO),
      amount: financeDebtSafeNum(c.amount||0),
      balance: financeDebtSafeNum(c.amount||0)
    };
  }).sort((a,b)=> a.dueDate - b.dueDate);

  const inWeek = items.filter(it=> it.dueDate >= start && it.dueDate < weekEnd);
  const inMonth = items.filter(it=> it.dueDate.getFullYear()===y && it.dueDate.getMonth()===m);

  return { inWeek, inMonth, all: items };
}

function financeDebtGetRolloverInfo(d){
  const name = String(d?.name||'');
  const base = { enabled: !!d?.rolloverEnabled, payout: financeDebtSafeNum(d?.rolloverPayout||0), reliability: (d?.rolloverReliability===null||d?.rolloverReliability===undefined) ? null : financeDebtSafeNum(d?.rolloverReliability) };

  // smart defaults (your current reality)
  if(!base.enabled){
    if(name==='Kashin') base.enabled = true;
    if(name==='Solventa') base.enabled = true;
    if(name==='Yape') base.enabled = true;
  }
  if(!(base.payout>0)){
    if(name==='Kashin') base.payout = 400;
    if(name==='Solventa') base.payout = 450;
    if(name==='Yape') base.payout = 300;
  }
  if(base.reliability===null){
    if(name==='Kashin') base.reliability = 0.95;
    if(name==='Solventa') base.reliability = 0.95;
    if(name==='Yape') base.reliability = 0.55;
    if(base.reliability===null) base.reliability = 0.8;
  }
  base.reliability = Math.max(0, Math.min(1, financeDebtSafeNum(base.reliability||0)));
  return base;
}

function financeDebtSurvivalAnalyze(){
  const cash = financeDebtSumCash();
  const marketReserve = financeEstimateNext7dMarket();

  const debU = financeDebtUpcomingItems();
  const cmtU = financeCommitmentsUpcomingItems();

  const weekDebts = debU.inWeek || [];
  const weekCmts = cmtU.inWeek || [];
  const weekDebtTotal = weekDebts.reduce((s,x)=> s + financeDebtSafeNum(x.amount||0), 0);
  const weekCmtTotal = weekCmts.reduce((s,x)=> s + financeDebtSafeNum(x.amount||0), 0);
  const obligations = weekDebtTotal + weekCmtTotal;

  const deficit = Math.max(0, (obligations + marketReserve) - cash);

  const rollCandidates = financeDebtsActive()
    .filter(d=>String(d.status||'active')==='active')
    .map(d=>{
      const r = financeDebtGetRolloverInfo(d);
      return {
        id: d.id,
        name: d.name,
        due: financeDebtSafeNum(d.monthlyDue||0),
        payout: financeDebtSafeNum(r.payout||0),
        reliability: financeDebtSafeNum(r.reliability||0),
        enabled: !!r.enabled
      };
    })
    .filter(x=>x.enabled && x.payout>0);

  rollCandidates.sort((a,b)=>{
    if(b.reliability!==a.reliability) return b.reliability-a.reliability;
    return b.payout-a.payout;
  });

  let coveredRiskAdj = 0;
  let coveredNom = 0;
  const chosen = [];
  for(const c of rollCandidates){
    if(coveredRiskAdj >= deficit && coveredNom >= deficit) break;
    chosen.push(c);
    coveredNom += c.payout;
    coveredRiskAdj += c.payout * c.reliability;
  }

  const status = deficit>0 ? 'survival' : 'stable';
  const rollRateHint = deficit>0 ? Math.min(0.99, (deficit / Math.max(1, obligations+marketReserve))) : 0;

  return {
    status,
    cash,
    marketReserve,
    obligations,
    weekDebtTotal,
    weekCmtTotal,
    deficit,
    rollCandidates,
    chosen,
    coveredNom,
    coveredRiskAdj,
    rollRateHint
  };
}

function renderFinanceDebtSurvivalBox(){
  const fmt = _financeFmt;
  const a = financeDebtSurvivalAnalyze();

  const badge = a.status==='survival'
    ? `<span class="chipDanger">Supervivencia</span>`
    : `<span class="chipGood">Estable</span>`;

  const deficitLine = a.deficit>0
    ? `<div class="finDebtHint bad" style="margin-top:10px">Hueco semanal estimado: <strong>S/ ${fmt(a.deficit)}</strong>. Esto incluye compromisos + deudas que vencen en 7 días y una reserva de Mercado de S/ ${fmt(a.marketReserve)}.</div>`
    : `<div class="finDebtHint good" style="margin-top:10px">Esta semana estás cubierto. Reserva Mercado estimada: <strong>S/ ${fmt(a.marketReserve)}</strong>.</div>`;

  const chosenHtml = (a.chosen||[]).length ? a.chosen.map(c=>{
    const risk = c.payout * c.reliability;
    const netCost = Math.max(0, financeDebtSafeNum(c.due) - financeDebtSafeNum(c.payout));
    return `
      <div class="finDueRow">
        <div class="finDueLeft">
          <div class="finDueTitle">🔁 ${escapeHtml(c.name)} <span class="muted">(confiab. ${(c.reliability||0).toFixed(2)})</span></div>
          <div class="muted">Pagas S/ ${fmt(c.due)} y normalmente recibes S/ ${fmt(c.payout)} (neto -S/ ${fmt(netCost)}). Cobertura ajustada ≈ S/ ${fmt(risk)}.</div>
        </div>
        <div class="finDueAmt">S/ ${fmt(c.payout)}</div>
      </div>
    `;
  }).join('') : `<div class="muted">Sin sugerencias de ruleteo por ahora.</div>`;

  const coverLine = a.deficit>0
    ? `<div class="muted" style="margin-top:8px">Cobertura sugerida: <strong>S/ ${fmt(a.coveredNom)}</strong> (ajustada por confiabilidad ≈ <strong>S/ ${fmt(a.coveredRiskAdj)}</strong>).</div>`
    : ``;

  const saveHint = a.status==='survival'
    ? `<div class="muted" style="margin-top:10px">Regla de escudo: si hoy entra un ingreso real, guarda <strong>5%</strong> antes de repartir (aunque sea poquito). Cuando pases a estable: 10%.</div>`
    : `<div class="muted" style="margin-top:10px">Regla de escudo: si entra un ingreso extra esta semana, guarda <strong>10%</strong> y el resto lo usas para acelerar la deuda objetivo.</div>`;

  return `
    <div class="finPlanBox">
      <div class="cardTop" style="margin-top:0">
        <h3 class="cardTitle" style="font-size:14px">Modo Supervivencia (Ruleteo)</h3>
        <div class="row" style="gap:8px;align-items:center">${badge}</div>
      </div>
      <div class="hr"></div>

      <div class="grid2" style="gap:10px">
        <div class="finDebtStat">
          <div class="muted">Caja actual</div>
          <div class="big">S/ ${fmt(a.cash)}</div>
        </div>
        <div class="finDebtStat">
          <div class="muted">Obligaciones 7d</div>
          <div class="big">S/ ${fmt(a.obligations)}</div>
        </div>
      </div>

      ${deficitLine}

      <div class="hr" style="margin-top:12px"></div>
      <div class="muted" style="margin-bottom:6px">Sugerencia de ruleteo (si hace falta)</div>
      <div class="finDueBox" style="padding:10px">${chosenHtml}</div>

      ${coverLine}
      ${saveHint}
    </div>
  `;
}

try{ window.financeDebtSurvivalAnalyze = financeDebtSurvivalAnalyze; }catch(_e){}

function financeDebtPlanUI(){
  const fmt = _financeFmt;
  const monthKey = getCurrentMonthKey();
  const plan = financeDebtPlannerGet(monthKey);
  const meta = (state.financeMeta||{})[monthKey] || {expectedIncome:0};
  const income = financeDebtSafeNum(meta.expectedIncome||0);
  const minPays = financeDebtMonthlyTotal();
  const baseGap = income - minPays;

  const extra = financeDebtSafeNum(plan.extraMonthly||0);
  const ext = financeDebtSafeNum(plan.externalMonthly||0);
  const pool = Math.max(0, baseGap) + extra + ext;

  const sim = financeDebtSimulate({
    strategy: plan.strategy,
    extraMonthly: extra,
    externalMonthly: ext,
    includeInterest: !!plan.includeInterest
  });

  const target = financeDebtChooseTarget(
    financeDebtsActive().filter(d=>String(d.status||'active')==='active').map(d=>({
      id:d.id, name:d.name, apr:d.apr, balance:financeDebtSafeNum(d.balance), due:financeDebtSafeNum(d.monthlyDue)
    })),
    plan.strategy
  );

  const targetLine = target
    ? (plan.strategy==='avalanche'
      ? `Prioridad: <strong>${escapeHtml(target.name)}</strong> (APR más alto)`
      : `Prioridad: <strong>${escapeHtml(target.name)}</strong> (saldo más pequeño)`)
    : `Sin deudas activas.`;

  const finishLbl = (function(){
    try{
      const d = new Date(sim.finishISO);
      return d.toLocaleDateString('es-PE', {month:'short', year:'numeric'});
    }catch(e){ return sim.finishISO; }
  })();

  const steps = sim.steps.map(s=>{
    const lines = (s.top||[]).map(t=>`<div class="muted">· ${t}</div>`).join('');
    return `
      <div class="finSimStep">
        <div><strong>${escapeHtml(s.monthISO)}</strong> · pagas S/ ${fmt(s.paid)} · queda S/ ${fmt(s.remaining)}</div>
        ${lines ? `<div style="margin-top:6px">${lines}</div>` : ``}
      </div>
    `;
  }).join('');

  const interestNote = plan.includeInterest
    ? `<div class="muted">Incluye interés aproximado (APR/12 si está registrado). Si una deuda no tiene APR, se asume 0%.</div>`
    : `<div class="muted">Simulación sin interés (solo amortización). Útil para tener un estimado rápido.</div>`;

  const extHint = `<div class="muted">Tip: el ingreso externo (emprendimiento de Fergis) puede ir directo a cubrir intereses o acelerar la deuda objetivo.</div>`;

  return `
    <div class="finPlanBox">
      <div class="cardTop" style="margin-top:0">
        <h3 class="cardTitle" style="font-size:14px">Plan y simulación</h3>
      </div>
      <div class="hr"></div>

      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="chipBtn ${plan.strategy==='snowball'?'active':''}" onclick="financeDebtSetStrategy('snowball')">Snowball</button>
        <button class="chipBtn ${plan.strategy==='avalanche'?'active':''}" onclick="financeDebtSetStrategy('avalanche')">Avalanche</button>

        <label class="row" style="gap:6px;align-items:center;margin-left:auto">
          <input type="checkbox" ${plan.includeInterest?'checked':''} onchange="financeDebtToggleInterest(this.checked)" />
          <span class="muted">interés</span>
        </label>
      </div>

      <div class="grid2" style="gap:10px;margin-top:10px">
        <div class="field">
          <div class="label">Extra mensual (tú)</div>
          <input type="number" inputmode="decimal" value="${escapeHtml(String(extra))}" oninput="financeDebtSetExtraMonthly(this.value)" placeholder="0.00" />
          <div class="muted">Pago adicional que puedes meter encima de mínimos.</div>
        </div>
        <div class="field">
          <div class="label">Extra mensual externo (Fergis)</div>
          <input type="number" inputmode="decimal" value="${escapeHtml(String(ext))}" oninput="financeDebtSetExternalMonthly(this.value)" placeholder="0.00" />
          ${extHint}
        </div>
      </div>

      <div class="hr" style="margin-top:12px"></div>

      <div class="finPlanSummary">
        <div>${targetLine}</div>
        <div class="muted" style="margin-top:6px">Pool estimado para acelerar: <strong>S/ ${fmt(pool)}</strong> (gap positivo + extras)</div>
        <div class="muted" style="margin-top:6px">Deuda libre en aprox: <strong>${sim.months}</strong> meses (≈ ${escapeHtml(finishLbl)})</div>
        <div class="muted" style="margin-top:6px">Interés estimado total: <strong>S/ ${fmt(sim.totalInterest)}</strong></div>
      </div>

      <div style="margin-top:10px">${interestNote}</div>

      <div class="hr" style="margin-top:12px"></div>
      <div class="muted" style="margin-bottom:6px">Vista previa (primeros meses)</div>
      ${steps || `<div class="muted">Agrega al menos 1 deuda activa con saldo para simular.</div>`}
    </div>
  `;
}

function financeDebtSetStrategy(s){
  const monthKey = getCurrentMonthKey();
  financeDebtPlannerSet(monthKey, {strategy: String(s||'snowball')});
}
function financeDebtSetExtraMonthly(v){
  const monthKey = getCurrentMonthKey();
  financeDebtPlannerSet(monthKey, {extraMonthly: financeDebtSafeNum(v)});
}
function financeDebtSetExternalMonthly(v){
  const monthKey = getCurrentMonthKey();
  financeDebtPlannerSet(monthKey, {externalMonthly: financeDebtSafeNum(v)});
}
function financeDebtToggleInterest(flag){
  const monthKey = getCurrentMonthKey();
  financeDebtPlannerSet(monthKey, {includeInterest: !!flag});
}

try{
  window.financeDebtSetStrategy = financeDebtSetStrategy;
  window.financeDebtSetExtraMonthly = financeDebtSetExtraMonthly;
  window.financeDebtSetExternalMonthly = financeDebtSetExternalMonthly;
  window.financeDebtToggleInterest = financeDebtToggleInterest;
}catch(e){}


function renderFinanceDebtsTab(){
  const fmt = _financeFmt;
  const monthKey = getCurrentMonthKey();
  const meta = (state.financeMeta||{})[monthKey] || {expectedIncome:0};

  const totalBal = financeDebtTotalBalance();
  const monthly = financeDebtMonthlyTotal();
  const income = financeDebtSafeNum(meta.expectedIncome||0);
  const gap = income - monthly;

  const debts = financeDebtsActive();
  const list = debts
    .sort((a,b)=>{
      const sa = String(a.status||'active');
      const sb = String(b.status||'active');
      if(sa!==sb) return sa==='active' ? -1 : 1;
      return financeDebtSafeNum(b.balance) - financeDebtSafeNum(a.balance);
    })
    .map(d=>{
      const p = financeDebtProgress(d);
      const dueIso = financeDebtNextDueISO(d.dueDay);
      const dueLbl = financeDebtDueLabel(dueIso);
      return `
        <div class="finDebtRow">
          <div class="finDebtLeft" onclick="openFinanceDebtModalById('${d.id}')" style="cursor:pointer">
            <div class="finDebtTitle">${escapeHtml(d.name)} ${financeDebtStatusChip(d)}</div>
            <div class="muted">Pago: S/ ${fmt(d.monthlyDue||0)} · vence: ${escapeHtml(dueLbl)} · saldo: S/ ${fmt(d.balance||0)}</div>
            <div class="finDebtBar"><div class="finDebtBarFill" style="width:${p.pct}%"></div></div>
          </div>
          <div class="finDebtActions">
            <button class="iconBtn" title="Registrar pago" onclick="openFinanceDebtPayModal('${d.id}')">💸</button>
            <button class="iconBtn" title="Editar" onclick="openFinanceDebtModalById('${d.id}')">✏️</button>
            <button class="iconBtn" title="Borrar deuda" onclick="deleteFinanceDebt('${d.id}')">🗑️</button>
          </div>
        </div>
      `;
    }).join('') || `<div class="muted">Sin deudas registradas. Agrega tu primera deuda para empezar el plan.</div>`;

  const hint = (gap<0)
    ? `<div class="finDebtHint bad">Te faltan <strong>S/ ${fmt(Math.abs(gap))}</strong> para cubrir solo deudas este mes. Vamos a usar esto para decidir prioridades y recortar fugas.</div>`
    : `<div class="finDebtHint good">Bien: te sobran <strong>S/ ${fmt(gap)}</strong> después de cubrir deudas. Eso puede ir a acelerar una deuda (snowball/avalancha).</div>`;

  return `
    <section class="card homeCard homeWide">
      <div class="cardTop">
        <h2 class="cardTitle">Deudas</h2>
        <div class="row" style="gap:8px">
          <button class="iconBtn" title="Nueva deuda" onclick="openFinanceDebtModal()">＋</button>
        </div>
      </div>
      <div class="hr"></div>

      <div class="grid2" style="gap:10px">
        <div class="finDebtStat">
          <div class="muted">Total deuda</div>
          <div class="big">S/ ${fmt(totalBal)}</div>
        </div>
        <div class="finDebtStat">
          <div class="muted">Pago mensual total</div>
          <div class="big">S/ ${fmt(monthly)}</div>
        </div>
      </div>

      <div style="margin-top:10px">
        ${hint}
      </div>

      <div class="hr" style="margin-top:12px"></div>
      <div class="cardTop" style="margin-top:2px">
        <h3 class="cardTitle" style="font-size:14px">Ingreso vs pagos</h3>
      </div>
      ${financeDebtIncomeVsPaymentsUI()}

      <div class="hr" style="margin-top:12px"></div>
      <div class="cardTop" style="margin-top:2px">
        <h3 class="cardTitle" style="font-size:14px">Calendario de vencimientos</h3>
      </div>
      <div class="finDueWrap">
        ${financeDebtRenderUpcoming()}
      </div>

      <div class="hr" style="margin-top:12px"></div>
      ${renderFinanceDebtSurvivalBox()}

      <div class="hr" style="margin-top:12px"></div>
      ${financeDebtPlanUI()}

      <div class="hr" style="margin-top:12px"></div>
      <div class="cardTop" style="margin-top:2px">
        <h3 class="cardTitle" style="font-size:14px">Tus deudas</h3>
      </div>
      <div class="finDebtList">${list}</div>
    </section>
  `;
}

function openFinanceDebtModalById(id){
  const d = (state.financeDebts||[]).find(x=>x.id===id);
  if(!d) return;
  openFinanceDebtModal(d);
}

function deleteFinanceDebt(id){
  const debt = (state.financeDebts||[]).find(x=>x.id===id);
  if(!debt) return;
  if(!confirm(`¿Borrar la deuda "${debt.name}"?`)) return;
  state.financeDebts = (state.financeDebts||[]).filter(x=>x.id!==id);
  persist();
  view();
}

try{
  window.openFinanceDebtModal = openFinanceDebtModal;
  window.openFinanceDebtModalById = openFinanceDebtModalById;
  window.openFinanceDebtPayModal = openFinanceDebtPayModal;
  window.deleteFinanceDebt = deleteFinanceDebt;
}catch(e){}

function renderFinanceMissionControl(){
  const m = financeMissionControlModel(getCurrentMonthKey());
  const insights = financeGenerateInsights(m.mk);
  const fmt = _financeFmt;

  // Inject styles once
  if(!document.getElementById('mcStyles')){
    const s = document.createElement('style');
    s.id = 'mcStyles';
    s.textContent = `
      .mc-wrap{ display:flex;flex-direction:column;gap:14px;padding-bottom:16px; }

      /* ── Header card ── */
      .mc-hero{
        background:linear-gradient(135deg,rgba(124,92,255,.25),rgba(54,211,153,.12));
        border:1px solid rgba(124,92,255,.3);
        border-radius:20px;padding:18px 16px 14px;
      }
      .mc-hero-top{ display:flex;align-items:center;justify-content:space-between;margin-bottom:14px }
      .mc-hero-label{ font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:rgba(255,255,255,.45);font-weight:600 }
      .mc-risk{
        font-size:11px;font-weight:700;letter-spacing:.5px;
        padding:4px 10px;border-radius:20px;
      }
      .mc-risk.low{ background:rgba(54,211,153,.18);color:#36d399;border:1px solid rgba(54,211,153,.3) }
      .mc-risk.mid{ background:rgba(251,191,36,.18);color:#fbbf24;border:1px solid rgba(251,191,36,.3) }
      .mc-risk.high{ background:rgba(251,113,133,.18);color:#fb7185;border:1px solid rgba(251,113,133,.3) }

      .mc-balance{ font-size:32px;font-weight:800;letter-spacing:-1px;margin-bottom:4px }
      .mc-balance-sub{ font-size:12px;color:rgba(255,255,255,.4) }

      .mc-stats{ display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px }
      .mc-stat{
        background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);
        border-radius:13px;padding:10px 10px 8px;text-align:center;
      }
      .mc-stat-val{ font-size:15px;font-weight:700;margin-bottom:2px }
      .mc-stat-lbl{ font-size:10px;color:rgba(255,255,255,.4);letter-spacing:.3px }
      .mc-stat.accent .mc-stat-val{ color:#7c5cff }
      .mc-stat.good .mc-stat-val{ color:#36d399 }
      .mc-stat.warn .mc-stat-val{ color:#fb7185 }

      /* Progress bar */
      .mc-progress-wrap{ margin-top:14px }
      .mc-progress-label{
        display:flex;justify-content:space-between;
        font-size:11px;color:rgba(255,255,255,.45);margin-bottom:6px;
      }
      .mc-progress-track{
        height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden;
      }
      .mc-progress-fill{
        height:100%;border-radius:3px;
        background:linear-gradient(90deg,#7c5cff,#36d399);
        transition:width .4s ease;
      }

      /* ── Priority list ── */
      .mc-section{
        background:rgba(255,255,255,.04);
        border:1px solid rgba(255,255,255,.08);
        border-radius:18px;overflow:hidden;
      }
      .mc-section-head{
        display:flex;align-items:center;justify-content:space-between;
        padding:13px 16px;border-bottom:1px solid rgba(255,255,255,.06);
      }
      .mc-section-title{ font-size:13px;font-weight:700;letter-spacing:.2px }
      .mc-section-action{
        font-size:11px;color:#7c5cff;cursor:pointer;
        padding:4px 10px;border-radius:10px;
        background:rgba(124,92,255,.12);border:1px solid rgba(124,92,255,.2);
        font-weight:600;transition:background .14s;
      }
      .mc-section-action:hover{ background:rgba(124,92,255,.22) }

      .mc-priority-item{
        display:flex;align-items:center;gap:12px;
        padding:12px 16px;
        border-bottom:1px solid rgba(255,255,255,.05);
        cursor:pointer;transition:background .14s;
      }
      .mc-priority-item:last-child{ border-bottom:none }
      .mc-priority-item:hover{ background:rgba(255,255,255,.04) }
      .mc-priority-dot{
        width:10px;height:10px;border-radius:50%;flex-shrink:0;
      }
      .mc-priority-info{ flex:1;min-width:0 }
      .mc-priority-name{ font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
      .mc-priority-meta{ font-size:11px;color:rgba(255,255,255,.4);margin-top:1px }
      .mc-priority-amt{ font-size:14px;font-weight:700;white-space:nowrap }
      .mc-priority-badge{
        font-size:10px;font-weight:700;letter-spacing:.3px;
        padding:2px 7px;border-radius:8px;white-space:nowrap;
      }
      .badge-hoy{ background:rgba(251,113,133,.2);color:#fb7185 }
      .badge-semana{ background:rgba(251,191,36,.2);color:#fbbf24 }
      .badge-urgente{ background:rgba(251,191,36,.12);color:#fbbf24 }
      .badge-post{ background:rgba(255,255,255,.07);color:rgba(255,255,255,.4) }

      /* ── Sources grid ── */
      .mc-sources{ display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:12px 14px; }
      .mc-source-item{
        background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);
        border-radius:12px;padding:10px 12px;
      }
      .mc-source-name{ font-size:12px;font-weight:600;margin-bottom:2px }
      .mc-source-meta{ font-size:10px;color:rgba(255,255,255,.35) }

      /* ── Insights ── */
      .mc-insight{
        display:flex;gap:10px;align-items:flex-start;
        padding:11px 14px;
        border-bottom:1px solid rgba(255,255,255,.05);
      }
      .mc-insight:last-child{ border-bottom:none }
      .mc-insight-dot{ width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:4px }
      .mc-insight-title{ font-size:12px;font-weight:700;margin-bottom:2px }
      .mc-insight-msg{ font-size:11px;color:rgba(255,255,255,.5);line-height:1.5 }
    `;
    document.head.appendChild(s);
  }

  const riskClass = m.riskScore==='BAJO' ? 'low' : (m.riskScore==='MEDIO' ? 'mid' : 'high');
  const paidPct = m.obligationsMonth > 0 ? Math.min(100, Math.round((m.paidNow/m.obligationsMonth)*100)) : 0;
  const marginColor = m.margin >= 0 ? '#36d399' : '#fb7185';

  const bucketDot = b => b==='hoy'?'#fb7185':(b==='esta semana'?'#fbbf24':'#7c5cff');
  const bucketBadge = b => {
    if(b==='hoy') return '<span class="mc-priority-badge badge-hoy">HOY</span>';
    if(b==='esta semana') return '<span class="mc-priority-badge badge-semana">ESTA SEMANA</span>';
    if(b==='urgente') return '<span class="mc-priority-badge badge-urgente">URGENTE</span>';
    return '<span class="mc-priority-badge badge-post">DESPUÉS</span>';
  };

  const priorityItems = (m.upcoming||[]).slice(0,8).map(o=>`
    <div class="mc-priority-item" onclick="setFinanceSubTab('commitments')" title="Ver compromisos">
      <div class="mc-priority-dot" style="background:${bucketDot(o.bucket)}"></div>
      <div class="mc-priority-info">
        <div class="mc-priority-name">${escapeHtml(o.name)}</div>
        <div class="mc-priority-meta">${escapeHtml(o.category||'General')} · día ${Number(o.dueDate||1)}</div>
      </div>
      ${bucketBadge(o.bucket)}
      <div class="mc-priority-amt" style="color:${bucketDot(o.bucket)}">S/ ${fmt(o.amountExpected||0)}</div>
    </div>
  `).join('') || `<div style="padding:20px 16px;text-align:center;color:rgba(255,255,255,.3);font-size:13px">Sin obligaciones activas.<br><span style="font-size:11px">Crea compromisos en la pestaña Compromisos.</span></div>`;

  const insightItems = (insights||[]).map(i=>{
    const col = i.level==='urgent'?'#fb7185':(i.level==='warning'?'#fbbf24':'#7c5cff');
    return `
      <div class="mc-insight">
        <div class="mc-insight-dot" style="background:${col}"></div>
        <div>
          <div class="mc-insight-title">${escapeHtml(i.title)}</div>
          <div class="mc-insight-msg">${escapeHtml(i.message)}</div>
        </div>
      </div>
    `;
  }).join('');

  const sourceItems = (state.financePaymentSources||[]).filter(s=>s.isActive!==false).map(s=>`
    <div class="mc-source-item">
      <div class="mc-source-name">${escapeHtml(s.name)}</div>
      <div class="mc-source-meta">${escapeHtml(s.sourceType)} · ${escapeHtml(s.owner)}</div>
    </div>
  `).join('') || `<div style="padding:12px 16px;color:rgba(255,255,255,.3);font-size:12px">Sin fuentes configuradas</div>`;

  return `
    <div class="mc-wrap">

      <!-- Hero card -->
      <div class="mc-hero">
        <div class="mc-hero-top">
          <div class="mc-hero-label">🛰 Mission Control · ${escapeHtml(m.mk)}</div>
          <div class="mc-risk ${riskClass}">RIESGO ${escapeHtml(m.riskScore)}</div>
        </div>
        <div class="mc-balance" style="color:${marginColor}">S/ ${fmt(Math.abs(m.margin))}</div>
        <div class="mc-balance-sub">${m.margin>=0?'margen disponible después de esenciales':'déficit estimado del mes'}</div>
        <div class="mc-stats">
          <div class="mc-stat good">
            <div class="mc-stat-val">S/ ${fmt(m.incomeConfirmed)}</div>
            <div class="mc-stat-lbl">Ingreso</div>
          </div>
          <div class="mc-stat accent">
            <div class="mc-stat-val">S/ ${fmt(m.obligationsMonth)}</div>
            <div class="mc-stat-lbl">Obligaciones</div>
          </div>
          <div class="mc-stat warn">
            <div class="mc-stat-val">S/ ${fmt(m.pending)}</div>
            <div class="mc-stat-lbl">Pendiente</div>
          </div>
          <div class="mc-stat">
            <div class="mc-stat-val">S/ ${fmt(m.paidNow)}</div>
            <div class="mc-stat-lbl">Pagado</div>
          </div>
          <div class="mc-stat">
            <div class="mc-stat-val">S/ ${fmt(m.realAvailable)}</div>
            <div class="mc-stat-lbl">Disponible</div>
          </div>
          <div class="mc-stat ${m.internalDebt>0?'warn':''}">
            <div class="mc-stat-val">S/ ${fmt(m.internalDebt)}</div>
            <div class="mc-stat-lbl">Deuda int.</div>
          </div>
        </div>
        <div class="mc-progress-wrap">
          <div class="mc-progress-label">
            <span>Compromisos pagados</span>
            <span>${paidPct}%</span>
          </div>
          <div class="mc-progress-track">
            <div class="mc-progress-fill" style="width:${paidPct}%"></div>
          </div>
        </div>
      </div>

      <!-- Prioridades inmediatas -->
      <div class="mc-section">
        <div class="mc-section-head">
          <div class="mc-section-title">⚡ Prioridades inmediatas</div>
          <div class="mc-section-action" onclick="setFinanceSubTab('commitments')">Ver todos →</div>
        </div>
        ${priorityItems}
      </div>

      <!-- Asistente -->
      ${insightItems ? `
      <div class="mc-section">
        <div class="mc-section-head">
          <div class="mc-section-title">💡 Asistente</div>
        </div>
        ${insightItems}
      </div>` : ''}

      <!-- Fuentes de pago -->
      <div class="mc-section">
        <div class="mc-section-head">
          <div class="mc-section-title">💳 Fuentes de pago</div>
        </div>
        <div class="mc-sources">${sourceItems}</div>
      </div>

    </div>
  `;
}




async function financeFetchTelegramPending() {
  try {
    const fetchUrl = `https://memory-carl.vercel.app/api/telegram/pending`;
    // We use basic fetch, you might want to add token auth later if it's protected, 
    // but right now it looks unprotected or relies on cookies.
    const res = await fetch(fetchUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    if (!res.ok) throw new Error("Error fetching telegram pending");
    const json = await res.json();
    
    if (json.status === 'ok' && json.data && json.data.length > 0) {
      let addedCount = 0;
      json.data.forEach(t => {
        // Resolve accountId
        let accountId = t.account_id;
        if (accountId === "default" || accountId === "cash" || accountId === "bank") {
          const accs = state.financeAccounts || [];
          if (accs.length > 0) {
            if (accountId === "cash") {
              const c = accs.find(a => a.type === "cash" || String(a.name).toLowerCase().includes("efectivo"));
              accountId = c ? c.id : accs[0].id;
            } else if (accountId === "bank") {
              const b = accs.find(a => a.type === "bank" || a.type === "card");
              accountId = b ? b.id : accs[0].id;
            } else {
              accountId = accs[0].id; // Default
            }
          }
        }

        // Add to main.js state using addFinanceEntry
        const entry = addFinanceEntry({
          date: t.created_at || new Date().toISOString(),
          type: t.type,
          amount: t.amount,
          accountId: accountId,
          category: t.category,
          note: t.note || "Vía Telegram",
          reason: "telegram",
          neuronRole: "auto"
        });
        
        if (entry) addedCount++;
      });

      if (addedCount > 0) {
        toast(`📥 ${addedCount} transacciones añadidas desde Telegram`);
        view(); // re-render UI
      }
    }
  } catch (e) {
    console.error("Telegram Sync Error:", e);
  }
}

function viewFinance(){
  const fmt = _financeFmt;
  const d = financeMonthDataAdvanced();
  const monthKey = getCurrentMonthKey();
  const meta = d.meta || {expectedIncome:0,targetSavings:0};
  const finPillars = financeComputePillars(monthKey);


  // header tabs (Principal / Movimientos / Recordatorios / Deudas)
  const topTabs = `
    <div class="finTopTabs">
      <button class="finTopTab ${state.financeSubTab==="main"?"active":""}" onclick="setFinanceSubTab('main')">Principal</button>
      <button class="finTopTab ${state.financeSubTab==="mission"?"active":""}" onclick="setFinanceSubTab('mission')">Mission Control</button>
      <button class="finTopTab ${state.financeSubTab==="movements"?"active":""}" onclick="setFinanceSubTab('movements')">Movimientos</button>
      <button class="finTopTab ${state.financeSubTab==="reminders"?"active":""}" onclick="setFinanceSubTab('reminders')">Recordatorios</button>
      <button class="finTopTab ${state.financeSubTab==="debts"?"active":""}" onclick="setFinanceSubTab('debts')">Deudas</button>
      <button class="finTopTab ${state.financeSubTab==="commitments"?"active":""}" onclick="setFinanceSubTab('commitments')">Compromisos</button>
      <button class="finTopTab ${state.financeSubTab==="roadmap"?"active":""}" onclick="setFinanceSubTab('roadmap')">🗺️ Hoja de Ruta</button>
      <button class="finTopTab ${state.financeSubTab==="neuronal"?"active":""}" onclick="setFinanceSubTab('neuronal')">🧠 Mapa Neuronal</button>
    </div>
  `;

  // Principal content — redesigned
  const totalBalance = (state.financeAccounts||[]).reduce((s,a)=>s+Number(a.balance||0),0);
  const savings = d.income - d.expense;
  const savingsPct = meta.expectedIncome > 0 ? Math.round((savings / meta.expectedIncome) * 100) : null;
  const spentPct = meta.expectedIncome > 0 ? Math.min(100, Math.round((d.expense / meta.expectedIncome) * 100)) : null;

  const accountCards = (state.financeAccounts||[]).map(a=>{
    const bal = Number(a.balance||0);
    const isFergisAccount = String(a.name||"").toLowerCase().includes("fergis");
    // Show expenses for Fergis account instead of income, since it's used to track what Carlos spends for her
    const monthFergisFlow = isFergisAccount ? financeAccountExpenseFlow(a.id, monthKey) : 0;
    const shownValue = isFergisAccount ? monthFergisFlow : bal;
    const isPos = isFergisAccount ? true : (shownValue >= 0); // Force positive look (green/neutral) for Fergis flow
    const balanceLabel = isFergisAccount ? "Uso del mes" : "Saldo";
    return `
      <div class="finAccCard" onclick="openFinanceAccountDetails('${a.id}')">
        <div class="finAccName">${escapeHtml(a.name)}</div>
        <div class="finAccBal ${isPos?'finAccPos':'finAccNeg'}">S/ ${fmt(shownValue)}</div>
        <div class="finAccHint">${balanceLabel}</div>
      </div>`;
  }).join("") || `<div class="finAccEmpty">Sin cuentas · <span onclick="openFinanceAccountModal()" style="color:#7c5cff;cursor:pointer">Agregar +</span></div>`;

  const pillarsData = [
    { icon:"🛒", label:"Mercado",   val: finPillars.market   },
    { icon:"🧾", label:"Servicios", val: finPillars.services  },
    { icon:"💳", label:"Deudas",    val: finPillars.debts     },
    { icon:"📦", label:"Otros",     val: finPillars.other     },
  ];
  const pillarsTotal = pillarsData.reduce((s,p)=>s+p.val,0) || 1;
  const pillarsRows = pillarsData.map(p=>{
    const pct = Math.round((p.val/pillarsTotal)*100);
    const w = Math.max(4, pct);
    return `
      <div class="finPillarRow">
        <div class="finPillarLeft">
          <span class="finPillarIcon">${p.icon}</span>
          <span class="finPillarLabel">${p.label}</span>
        </div>
        <div class="finPillarBar">
          <div class="finPillarFill" style="width:${w}%"></div>
        </div>
        <div class="finPillarVal">S/ ${fmt(p.val)}</div>
      </div>`;
  }).join("");

  const principalHtml = `

    <!-- CUENTAS TOP -->
    <section class="finSection">
      <div class="finSectionHead">
        <div class="finSectionTitle">💳 Cuentas</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="finIconBtn" title="Mes anterior" onclick="financeShiftMonth(-1)">◀</button>
          <button class="finIconBtn" title="Mes actual" onclick="financeResetMonth()">●</button>
          <button class="finIconBtn" title="Mes siguiente" onclick="financeShiftMonth(1)">▶</button>
          <button class="finIconBtn" title="Agregar cuenta" onclick="openFinanceAccountModal()">＋</button>
          <button class="finIconBtn" title="Más opciones" onclick="openFinanceImport()">⬆</button>
        </div>
      </div>
      <div class="finAccGrid">
        ${accountCards}
      </div>
      <div class="finTotalRow">
        <span class="finTotalLabel">Total</span>
        <span class="finTotalVal ${totalBalance>=0?'finAccPos':'finAccNeg'}">S/ ${fmt(totalBalance)}</span>
      </div>
    </section>

    <!-- RESUMEN DEL MES -->
    <section class="finSection">
      <div class="finSectionHead">
        <div class="finSectionTitle">📊 Este mes</div>
        <button class="finIconBtn" onclick="openFinanceMetaModal()">⚙️</button>
      </div>
      <div class="finStatsGrid">
        <div class="finStatBox finStatIncome">
          <div class="finStatIcon">📥</div>
          <div class="finStatVal">S/ ${fmt(d.income)}</div>
          <div class="finStatLabel">Ingreso</div>
        </div>
        <div class="finStatBox finStatExpense">
          <div class="finStatIcon">📤</div>
          <div class="finStatVal">S/ ${fmt(d.expense)}</div>
          <div class="finStatLabel">Gasto</div>
        </div>
        <div class="finStatBox ${savings>=0?'finStatSavings':'finStatNeg'}">
          <div class="finStatIcon">${savings>=0?'💰':'⚠️'}</div>
          <div class="finStatVal">S/ ${fmt(Math.abs(savings))}</div>
          <div class="finStatLabel">${savings>=0?'Ahorro':'Déficit'}</div>
        </div>
      </div>
      ${spentPct!==null ? `
      <div class="finBudgetBar">
        <div class="finBudgetBarInner">
          <div class="finBudgetFill ${spentPct>90?'finBudgetDanger':spentPct>70?'finBudgetWarn':''}" style="width:${spentPct}%"></div>
        </div>
        <div class="finBudgetMeta">${spentPct}% del presupuesto · meta S/ ${fmt(meta.expectedIncome)}</div>
      </div>` : ""}
    </section>

    <!-- GASTOS DIARIOS (7d) -->
    <section class="finSection">
      <div class="finSectionHead">
        <div class="finSectionTitle">📅 Últimos 7 días</div>
      </div>
      <canvas id="dailyExpenseChart" height="110" style="width:100%;max-width:100%;height:110px;display:block;"></canvas>
    </section>

    <!-- PILARES -->
    <section class="finSection">
      <div class="finSectionHead">
        <div class="finSectionTitle">🏛 Pilares del mes</div>
        <button class="finIconBtn" onclick="setFinanceSubTab('commitments')">⚡</button>
      </div>
      ${pillarsRows}
      <canvas id="financePillarsChart" height="0" style="display:none"></canvas>
    </section>

    <!-- PROYECCIÓN -->
    <section class="finSection">
      <div class="finSectionHead">
        <div class="finSectionTitle">📈 Proyección</div>
        <div style="display:flex;gap:4px;">
          <button class="finModeBtn ${state.financeProjectionMode==='conservative'?'finModeBtnActive':''}" onclick="financeSetProjectionMode('conservative')">Cons.</button>
          <button class="finModeBtn ${(!state.financeProjectionMode||state.financeProjectionMode==='normal')?'finModeBtnActive':''}" onclick="financeSetProjectionMode('normal')">Normal</button>
          <button class="finModeBtn ${state.financeProjectionMode==='realistic'?'finModeBtnActive':''}" onclick="financeSetProjectionMode('realistic')">Real</button>
        </div>
      </div>
      <div class="finProjRow">
        <div class="finProjItem"><span class="finProjLabel">Gasto real</span><span class="finProjVal">S/ ${fmt(d.expense)}</span></div>
        <div class="finProjItem"><span class="finProjLabel">Proyectado</span><span class="finProjVal">S/ ${fmt(d.projected)}</span></div>
        <div class="finProjItem"><span class="finProjLabel">Balance proy.</span><span class="finProjVal ${(d.income-d.projected)>=0?'finAccPos':'finAccNeg'}">S/ ${fmt(d.income - d.projected)}</span></div>
      </div>
      <div class="finProjectionChartWrap">
        <canvas id="financeChart" class="finProjectionChart" height="130"></canvas>
      </div>
    </section>

    <!-- ANÁLISIS SEMANAL -->
    <section class="finSection">
      <div class="finSectionHead">
        <div class="finSectionTitle">🧠 Análisis semanal</div>
        <button class="finIconBtn" onclick="financeWeeklyGenerateNow()">✨</button>
      </div>
      ${renderFinanceWeeklyCard()}
    </section>
  `;

  // Movimientos content (lista unificada: ingresos y gastos juntos)

  const movList = `
    <section class="card homeCard homeWide finMovCard">
      <div class="cardTop">
        <h2 class="cardTitle">Movimientos</h2>
        <button class="iconBtn" onclick="openFinanceTypeModal()">＋</button>
      </div>
      <div class="hr"></div>
      <div id="financeMovementsList" class="finMovList">
        ${renderFinanceMovements()}
      </div>
    </section>
  `;

  const remindersHtml = `
    <section class="card homeCard homeWide">
      <div class="cardTop">
        <h2 class="cardTitle">Recordatorios</h2>
        <button class="iconBtn" onclick="toast('Pronto: recordatorios financieros ✨')">＋</button>
      </div>
      <div class="hr"></div>
      <div class="muted">Aquí vamos a poner pagos, suscripciones, vencimientos y alertas.</div>
    </section>
  `;

  const debtsHtml = `
    ${renderFinanceDebtsTab()}
  `;

  const commitmentsHtml = `
    ${renderFinanceCommitmentsTab()}
  `;

  const missionHtml = renderFinanceMissionControl();

  const roadmapHtml = (typeof renderFinanceRoadmapTab === 'function') ? renderFinanceRoadmapTab() : '';

  const neuronalHtml = (typeof renderMapaNeuronal === 'function') ? renderMapaNeuronal() : '';

  const body = (state.financeSubTab==="movements")
    ? movList
    : (state.financeSubTab==="reminders" ? remindersHtml
      : (state.financeSubTab==="debts" ? debtsHtml
        : (state.financeSubTab==="commitments" ? commitmentsHtml
          : (state.financeSubTab==="mission" ? missionHtml
            : (state.financeSubTab==="roadmap" ? roadmapHtml
              : (state.financeSubTab==="neuronal" ? neuronalHtml : principalHtml))))));

  return `
    ${topTabs}
    ${body}
  `;
}


function openFinanceMetaModal(){
  const month = getCurrentMonthKey();
  const current = state.financeMeta[month] || {};
  const inc = prompt("Ingreso esperado del mes:", current.expectedIncome||0);
  const sav = prompt("Meta de ahorro:", current.targetSavings||0);
  setFinanceMeta(month, inc, sav);
}

let _financeMonthChart = null;
let _financeMonthChartCanvas = null;
let _financeMonthChartObserver = null;
let _financeMonthChartResizeRaf = 0;
let _financeMonthChartWindowResize = null;
let _financeMonthChartLastSize = { width: 0, height: 0 };

function financeProjectionCleanupObserver(){
  try{
    if(_financeMonthChartResizeRaf){
      cancelAnimationFrame(_financeMonthChartResizeRaf);
      _financeMonthChartResizeRaf = 0;
    }
    if(_financeMonthChartObserver){
      _financeMonthChartObserver.disconnect();
      _financeMonthChartObserver = null;
      console.debug("[ProjectionChart] observer disconnected");
    }
    if(_financeMonthChartWindowResize){
      window.removeEventListener("resize", _financeMonthChartWindowResize);
      _financeMonthChartWindowResize = null;
      console.debug("[ProjectionChart] observer disconnected");
    }
  }catch(_e){}
}

function financeProjectionDestroyChart(){
  financeProjectionCleanupObserver();
  try{
    if(_financeMonthChart){
      _financeMonthChart.destroy();
      _financeMonthChart = null;
      console.debug("[ProjectionChart] destroyed old instance");
    }
  }catch(_e){}
  _financeMonthChartCanvas = null;
  _financeMonthChartLastSize = { width: 0, height: 0 };
}

function financeProjectionRequestResize(canvas){
  if(!_financeMonthChart || !canvas) return;
  if(_financeMonthChartResizeRaf) cancelAnimationFrame(_financeMonthChartResizeRaf);
  _financeMonthChartResizeRaf = requestAnimationFrame(()=>{
    _financeMonthChartResizeRaf = 0;
    const host = canvas.parentElement || canvas;
    const width = Math.max(0, Math.round(host.clientWidth || 0));
    const height = Math.max(0, Math.round(host.clientHeight || canvas.height || 0));
    if(!width || !height) return;
    if(_financeMonthChartLastSize.width === width && _financeMonthChartLastSize.height === height){
      console.debug("[ProjectionChart] resize ignored same size");
      return;
    }
    _financeMonthChartLastSize = { width, height };
    _financeMonthChart.resize(width, height);
    console.debug("[ProjectionChart] resize applied", { width, height });
  });
}

function financeProjectionBindResize(canvas){
  financeProjectionCleanupObserver();
  if(typeof ResizeObserver === "function"){
    _financeMonthChartObserver = new ResizeObserver(()=> financeProjectionRequestResize(canvas));
    _financeMonthChartObserver.observe(canvas.parentElement || canvas);
  }else{
    _financeMonthChartWindowResize = ()=> financeProjectionRequestResize(canvas);
    window.addEventListener("resize", _financeMonthChartWindowResize);
  }
  financeProjectionRequestResize(canvas);
}

function financeDrawMonthChart(){
  const canvas = document.getElementById("financeChart");
  if(!canvas || typeof Chart==="undefined") return;

  const d = financeMonthDataAdvanced();
  const labels = Array.from({length:d.daysInMonth}, (_,i)=> i+1);

  try{
    canvas.style.maxWidth = "100%";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
  }catch(_e){}

  if(_financeMonthChart && _financeMonthChartCanvas === canvas){
    _financeMonthChart.data.labels = labels;
    _financeMonthChart.data.datasets[0].data = d.accExpense;
    _financeMonthChart.data.datasets[1].data = d.accProjected;
    _financeMonthChart.data.datasets[2].data = d.accIncome;
    _financeMonthChart.update("none");
    console.debug("[ProjectionChart] skipped re-init");
    financeProjectionRequestResize(canvas);
    return;
  }

  if(_financeMonthChart){
    financeProjectionDestroyChart();
  }

  _financeMonthChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Gasto real",
          data: d.accExpense,
          tension: 0.3,
          pointRadius: 0,
          borderColor: "rgba(248,113,113,0.9)",
          backgroundColor: "rgba(248,113,113,0.08)",
          fill: true,
          borderWidth: 2,
        },
        {
          label: "Proyección",
          data: d.accProjected,
          tension: 0.3,
          pointRadius: 0,
          borderDash: [5,4],
          borderColor: "rgba(251,191,36,0.7)",
          borderWidth: 2,
        },
        {
          label: "Ingreso",
          data: d.accIncome,
          tension: 0.3,
          pointRadius: 0,
          borderColor: "rgba(52,211,153,0.8)",
          borderWidth: 2,
        }
      ]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: "rgba(255,255,255,0.5)", font: { size: 11 }, boxWidth: 12, padding: 12 }
        }
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 8, color: "rgba(255,255,255,0.3)", font: { size: 10 } },
          grid: { color: "rgba(255,255,255,0.04)" },
          border: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: "rgba(255,255,255,0.3)", font: { size: 10 }, callback: v => `S/${v}` },
          grid: { color: "rgba(255,255,255,0.05)" },
          border: { display: false }
        }
      }
    }
  });
  _financeMonthChartCanvas = canvas;
  console.debug("[ProjectionChart] init");
  financeProjectionBindResize(canvas);
}

const _viewFinanceWrap = view;
view = function(){
  _viewFinanceWrap();
  try{
    if(state.tab==="finance"){
      setTimeout(()=>{ 
        try{ financeWeeklyMaybeAutoRun(); }catch(_e){}
        try{ financeDrawMonthChart(); }catch(_e){} 
        try{ renderDailyExpenseChart(); }catch(_e){} 
        try{ if(state.financeSubTab==='main') financeDrawPillarsChart(); }catch(_e){}
        try{ if(state.financeSubTab==='debts') financeDrawDebtChart(); }catch(_e){}
        try{ if(state.financeSubTab==='debts') financeBindDebtIncomeInput(); }catch(_e){}
        try{ if(state.financeSubTab==='neuronal') neuronasInitGrafo(); }catch(_e){}
        try{ financeFetchTelegramPending(); }catch(_e){}
      }, 0);
    }else{
      financeProjectionDestroyChart();
    }
  }catch(e){}
};

function getLast7DaysExpenseData(){
  const now = new Date();
  const labels = [];
  const values = [];
  
  for(let i=6;i>=0;i--){
    const d = new Date(now);
    d.setDate(now.getDate()-i);
    const key = d.toISOString().slice(0,10);
    const label = d.toLocaleDateString("es-PE",{weekday:"short"});
    
    const total = (financeActiveLedger()||[])
      .filter(e=>e.type==="expense" && String(e.date||"").slice(0,10)===key)
      .reduce((s,e)=>s+Number(e.amount||0),0);
    
    labels.push(label);
    values.push(total);
  }
  
  return {labels, values};
}



function importFinanceSeed(data){
  try{
    // IMPORTANT: Do NOT import/overwrite accounts. Only import historical movements.
    if(data.financeLedger) state.financeLedger = financeSanitizeImportedLedger(data.financeLedger, { detachAccounts:true });
    if(data.financeDebts) state.financeDebts = Array.isArray(data.financeDebts) ? data.financeDebts : state.financeDebts;
    if(data.financeCommitments) state.financeCommitments = Array.isArray(data.financeCommitments) ? data.financeCommitments : state.financeCommitments;
    if(data.financeObligations) state.financeObligations = Array.isArray(data.financeObligations) ? data.financeObligations : state.financeObligations;
    if(data.financePaymentSources) state.financePaymentSources = Array.isArray(data.financePaymentSources) ? data.financePaymentSources : state.financePaymentSources;
    if(data.financeTransactions) state.financeTransactions = Array.isArray(data.financeTransactions) ? data.financeTransactions : state.financeTransactions;
    if(data.financeInternalBalances) state.financeInternalBalances = Array.isArray(data.financeInternalBalances) ? data.financeInternalBalances : state.financeInternalBalances;
    if(data.financeInsights) state.financeInsights = Array.isArray(data.financeInsights) ? data.financeInsights : state.financeInsights;
    if(data.financeSchemaVersion) state.financeSchemaVersion = Number(data.financeSchemaVersion || state.financeSchemaVersion || 2);

    // ensure new fields exist
    try{ financeMigrateV2(); financeEnsureMissionControlStructures(); }catch(_e){}
    try{ financeRecomputeBalances(); }catch(_e){}

    persist();
    view();
    alert("Base financiera importada correctamente.");
  }catch(e){
    alert("Error al importar.");
  }
}

function openFinanceImport(){
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = e=>{
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = ev=>{
      const data = JSON.parse(ev.target.result);
      importFinanceSeed(data);
    };
    reader.readAsText(file);
  };
  input.click();
}



let _dailyExpenseChart = null;

function renderDailyExpenseChart(){
  const ctx = document.getElementById("dailyExpenseChart");
  if(!ctx || typeof Chart === "undefined") return;

  // Lock canvas height to avoid responsive resize loops that can make this
  // section grow infinitely on some mobile layout passes.
  try{
    ctx.style.width = "100%";
    ctx.style.maxWidth = "100%";
    ctx.style.height = "110px";
    ctx.height = 110;
  }catch(_e){}
  
  const d = getLast7DaysExpenseData();

  try{ if(_dailyExpenseChart){ _dailyExpenseChart.destroy(); _dailyExpenseChart = null; } }catch(_e){}

  const maxVal = Math.max(...d.values, 1);
  _dailyExpenseChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: d.labels,
      datasets: [{
        label: "Gastos",
        data: d.values,
        backgroundColor: d.values.map(v => v === maxVal ? "rgba(248,113,113,0.85)" : "rgba(124,92,255,0.55)"),
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => `S/ ${ctx.raw.toFixed(2)}` }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "rgba(255,255,255,0.4)", font: { size: 11, weight: "700" } },
          border: { display: false }
        },
        y: {
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "rgba(255,255,255,0.3)", font: { size: 10 }, callback: v => `S/${v}` },
          border: { display: false }
        }
      }
    }
  });
}

const _viewFinanceChartWrap = view;
view = function(){
  _viewFinanceChartWrap();
  try{
    if(state.tab==="finance"){
      renderDailyExpenseChart();
    }
  }catch(e){}
};



/* ===== Finance: expose handlers for inline onclick (module scope -> window) ===== */
try{
  Object.assign(window, {
    openFinishLotModal,
    openFinanceImport,
    openFinanceMetaModal,
    openFinanceAccountModal,
    openFinanceAccountEdit,
    openFinanceEntryModal,
    financeResetToZeroConfirm,
    financeSetCurrentAsBaselineConfirm
  });
}catch(e){}

// finance handlers (module-safe)
try{
  window.financeResetToZeroConfirm = financeResetToZeroConfirm;
  window.financeSetCurrentAsBaselineConfirm = financeSetCurrentAsBaselineConfirm;
  window.financeHardResetAllConfirm = financeHardResetAllConfirm;
  window.financeShiftMonth = financeShiftMonth;
  window.financeResetMonth = financeResetMonth;
  window.openFinanceAccountModal = openFinanceAccountModal;
  window.openFinanceAccountDetails = openFinanceAccountDetails;
  window.openFinanceAccountEdit = openFinanceAccountEdit;
  window.openFinanceEntryModal = openFinanceEntryModal;
  window.openFinanceTypeModal = openFinanceTypeModal;
}catch(e){}


/* =========================
   FOOTBALL LAB (V2-Clean UI) — V2-A + Match Logger integrated as a proper tab
   Storage: localStorage["footballDB"]
   ========================= */

function fbGetDB(){
  const seed = {
    settings: { currentSeason: "", apiSportsKey: "" },
    teams: [],
    players: [],
    matches: []
  };
  const raw = localStorage.getItem("footballDB");
  if(!raw){
    localStorage.setItem("footballDB", JSON.stringify(seed));
    return seed;
  }
  try{
    const db = JSON.parse(raw);
    if(!db.settings || typeof db.settings !== "object") db.settings = {};
    if(typeof db.settings.currentSeason !== "string") db.settings.currentSeason = "";
    if(typeof db.settings.apiSportsKey !== "string") db.settings.apiSportsKey = "";
    if(!Array.isArray(db.teams)) db.teams=[];
    if(!Array.isArray(db.players)) db.players=[];
    if(!Array.isArray(db.matches)) db.matches=[];
    return db;
  }catch(e){
    try{ localStorage.setItem("footballDB_corrupt_backup", raw); }catch(_e){}
    localStorage.setItem("footballDB", JSON.stringify(seed));
    return seed;
  }
}
function fbSaveDB(db){
  localStorage.setItem("footballDB", JSON.stringify(db));
}

function fbClamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

function fbPerfScore10(stats){
  // Lightweight, SofaScore-inspired philosophy:
  // actions with different weights; normalized by minutes; penalty for cards/errors.
  const minutes = +stats.minutes || 0;
  const goals   = +stats.goals || 0;
  const assists = +stats.assists || 0;

  const passC = +stats.passC || 0;
  const passA = Math.max(1, +stats.passA || 1);
  const duelW = +stats.duelW || 0;
  const duelT = Math.max(1, +stats.duelT || 1);

  const shotsOn = +stats.shotsOn || 0;
  const recov   = +stats.recoveries || 0;
  const losses  = +stats.losses || 0;

  const yellow  = +stats.yellow || 0;
  const red     = +stats.red || 0;

  const minFactor = Math.sqrt(fbClamp(minutes/90, 0, 1)); // soft normalization
  const passPct = fbClamp(passC/passA, 0, 1);
  const duelPct = fbClamp(duelW/duelT, 0, 1);

  // Base score components (0..10-ish before clamp)
  // Note: this is intentionally interpretable; we can calibrate per position later.
  let score =
    (goals*1.25) +
    (assists*0.85) +
    (shotsOn*0.25) +
    (passPct*2.0) +
    (duelPct*1.4) +
    (recov*0.05) -
    (losses*0.05) -
    (yellow*0.3) -
    (red*1.2);

  score = score * minFactor;

  // Keep within 0..10
  return fbClamp(score, 0, 10);
}

function fbUpdatePlayerRating(player, matchScore10, minutes){
  const expected = +player.rating || 5.0;
  const minFactor = Math.sqrt(fbClamp((+minutes||0)/90, 0, 1));
  const K = 0.18 * minFactor; // smooth: full match ~0.18 max adjustment per game
  const next = fbClamp(expected + K*(matchScore10 - expected), 0, 10);
  return { old: expected, next };
}

function viewFootball(){
  // Simple launcher UI. The full Football Lab UI is rendered by footballLab_v8e.js via window.__FOOTBALL_LAB__.open()
  const db = fbGetDB();
  const season = escapeHtml(db?.settings?.currentSeason || "");
  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <div>
          <div class="muted small">Modo estudio</div>
          <div style="font-size:22px;font-weight:900;">⚽ Football Lab</div>
          <div class="muted small" style="margin-top:4px;">Temporada: <b>${season}</b></div>
        </div>
        <button class="btn" data-act="fbOpenLab">Abrir</button>
      </div>
      <div class="muted" style="margin-top:10px; line-height:1.35;">
        Aquí vive el laboratorio completo: equipos, XI, logger y simulaciones.
      </div>
    </div>
  `;
}


function initFootballTab(root){
  // Football Lab (V6e) now uses the full Lab UI (openLab) instead of the legacy tab UI.
  try{
    // Ensure module init ran (creates DB + exposes window.__FOOTBALL_LAB__).
    // If a previous boot got stuck half-way, force one clean retry.
    if(!window.__FOOTBALL_LAB__?.open){
      try{ initFootballLab(); }catch(e){ console.warn(e); }
    }
    if(!window.__FOOTBALL_LAB__?.open){
      try{ window.__footballLabInitialized = false; }catch(e){}
      try{ initFootballLab(); }catch(e){ console.warn(e); }
    }
    // Open the lab "home" view (this replaces #app content with the lab UI)
    if(window.__FOOTBALL_LAB__?.open){
      window.__FOOTBALL_LAB__.open("home");
      return;
    }
    console.error("[FootballLab] API unavailable after retry", {
      initialized: !!window.__footballLabInitialized,
      hasApi: !!window.__FOOTBALL_LAB__,
      hasOpen: !!window.__FOOTBALL_LAB__?.open,
      file: window.FOOTBALL_LAB_FILE || null
    });
  }catch(e){ console.error(e); }

  // Fallback UI if something blocks the lab
  const app = document.getElementById("app");
  if(app){
    app.innerHTML = `
      <div class="card">
        <div style="font-weight:900;font-size:16px;">⚽ Football Lab</div>
        <div class="muted" style="margin-top:6px;">No pude abrir el Lab. Revisa consola para errores.</div>
      </div>
    `;
  }
}


window.addEventListener("DOMContentLoaded", ()=>{ try{ initFootballLab(); }catch(e){ console.error(e); } });

/* ===== Finance Roadmap v1 — inlined ===== */

function _roadmapSave(){
  try{ localStorage.setItem(LS.financeRoadmap, JSON.stringify(state.financeRoadmap)); }catch(_e){}
}

function roadmapGetMonth(mk){
  if(!state.financeRoadmap[mk]){
    state.financeRoadmap[mk] = {
      sueldo: 0,
      fergisIncome: 0,
      fergisTarget: null,
      order: [],
      activeView: 'cascade'
    };
  }
  return state.financeRoadmap[mk];
}

function roadmapSet(mk, patch){
  const cur = roadmapGetMonth(mk);
  Object.assign(cur, patch);
  _roadmapSave();
  view();
}

function roadmapSetOrder(mk, order){
  roadmapGetMonth(mk).order = order;
  _roadmapSave();
  view();
}

function roadmapBuildItems(mk){
  const plan = roadmapGetMonth(mk);
  const commitments = (state.financeCommitments||[])
    .filter(c => c && c.active !== false)
    .map(c => ({
      id: c.id,
      type: 'commitment',
      name: c.name || '—',
      amount: financeDebtSafeNum(c.amount||0),
      dueDay: c.dueDay || null,
      deferrable: false
    }));
  const debts = (financeDebtsActive ? financeDebtsActive() : (state.financeDebts||[]))
    .filter(d => String(d.status||'active') === 'active')
    .map(d => ({
      id: d.id,
      type: 'debt',
      name: d.name || '—',
      amount: financeDebtSafeNum(d.monthlyDue||0),
      balance: financeDebtSafeNum(d.balance||0),
      dueDay: d.dueDay || null,
      deferrable: false
    }));
  const allById = {};
  [...commitments, ...debts].forEach(x => { allById[x.id] = x; });
  const savedOrder = plan.order || [];
  savedOrder.forEach(o => {
    if(allById[o.id]) allById[o.id].deferrable = !!o.deferrable;
  });
  const orderedIds = savedOrder.map(o => o.id).filter(id => allById[id]);
  const newIds = Object.keys(allById).filter(id => !orderedIds.includes(id));
  const finalOrder = [...orderedIds, ...newIds];
  return finalOrder.map((id, idx) => ({ ...allById[id], priority: idx }));
}

function roadmapSimulate(mk){
  const plan = roadmapGetMonth(mk);
  const items = roadmapBuildItems(mk);
  const totalIncome = financeDebtSafeNum(plan.sueldo||0) + financeDebtSafeNum(plan.fergisIncome||0);
  let remaining = totalIncome;
  const steps = [];
  for(const item of items){
    const pay = Math.min(remaining, Math.max(0, item.amount));
    const canPay = remaining >= item.amount;
    remaining = Math.max(0, remaining - item.amount);
    steps.push({ ...item, pay, canPay, remainingAfter: remaining, isFergisTarget: item.id === plan.fergisTarget });
  }
  const fergisItem = steps.find(s => s.id === plan.fergisTarget);
  const fergisAmt = financeDebtSafeNum(plan.fergisIncome||0);
  return { steps, remaining, totalIncome, fergisItem, fergisAmt };
}

function roadmapCashflow(mk){
  const plan = roadmapGetMonth(mk);
  const items = roadmapBuildItems(mk);
  const weeklyIncome = financeDebtSafeNum(plan.sueldo||0) / 4;
  const fergisWeekly = financeDebtSafeNum(plan.fergisIncome||0) / 4;
  const weeks = [1,2,3,4].map(w => {
    const wItems = items.filter(it => {
      if(!it.dueDay) return w === 1;
      const day = Number(it.dueDay);
      if(day <= 7)  return w === 1;
      if(day <= 14) return w === 2;
      if(day <= 21) return w === 3;
      return w === 4;
    });
    const totalOut = wItems.reduce((s,x) => s + x.amount, 0);
    const income = weeklyIncome + fergisWeekly;
    return { week: w, items: wItems, income, totalOut, balance: income - totalOut };
  });
  return weeks;
}

function renderFinanceRoadmapTab(){
  const mk = getCurrentMonthKey();
  const plan = roadmapGetMonth(mk);
  const sim = roadmapSimulate(mk);
  const fmt = _financeFmt;
  const tabs = ['cascade','timeline','cashflow'];
  const tabLabels = { cascade:'💧 Cascada', timeline:'📅 Calendario', cashflow:'📊 Flujo semanal' };
  const activeView = plan.activeView || 'cascade';
  const tabBtns = tabs.map(t => `
    <button class="rmTab ${activeView===t?'rmTabActive':''}"
      onclick="roadmapSetView('${mk}','${t}')">${tabLabels[t]}</button>
  `).join('');
  const sueldo = financeDebtSafeNum(plan.sueldo||0);
  const fergis = financeDebtSafeNum(plan.fergisIncome||0);
  const totalIn = sueldo + fergis;
  const incomePanel = `
    <div class="rmIncomePanel">
      <div class="rmIncomePanelTitle">💰 Ingresos del mes</div>
      <div class="rmIncomeGrid">
        <div class="rmIncomeRow">
          <div class="rmIncomeIcon">🧑</div>
          <div class="rmIncomeInfo">
            <div class="rmIncomeLabel">Tu sueldo</div>
            <input class="rmIncomeInput" type="number" inputmode="decimal"
              placeholder="0.00" value="${sueldo||''}"
              oninput="roadmapSetIncome('${mk}','sueldo',this.value)" />
          </div>
          <div class="rmIncomeAmt">S/ ${fmt(sueldo)}</div>
        </div>
        <div class="rmIncomeRow">
          <div class="rmIncomeIcon">💜</div>
          <div class="rmIncomeInfo">
            <div class="rmIncomeLabel">Fergis</div>
            <input class="rmIncomeInput" type="number" inputmode="decimal"
              placeholder="0.00" value="${fergis||''}"
              oninput="roadmapSetIncome('${mk}','fergisIncome',this.value)" />
          </div>
          <div class="rmIncomeAmt">S/ ${fmt(fergis)}</div>
        </div>
      </div>
      <div class="rmIncomeTotalRow">
        <span class="muted">Total disponible</span>
        <strong class="rmIncomeTotal">S/ ${fmt(totalIn)}</strong>
      </div>
    </div>
  `;
  let viewBody = '';
  if(activeView === 'cascade')  viewBody = _roadmapCascadeView(mk, sim, fmt);
  if(activeView === 'timeline') viewBody = _roadmapTimelineView(mk, sim, fmt);
  if(activeView === 'cashflow') viewBody = _roadmapCashflowView(mk, fmt);
  const debtOptions = (financeDebtsActive ? financeDebtsActive() : [])
    .filter(d => String(d.status||'active')==='active')
    .map(d => `<option value="${d.id}" ${plan.fergisTarget===d.id?'selected':''}>${escapeHtml(d.name)} (S/ ${fmt(financeDebtSafeNum(d.monthlyDue||0))})</option>`)
    .join('');
  const fergisAssign = fergis > 0 ? `
    <div class="rmFergisBox">
      <div class="rmFergisTitle">💜 Asignación Fergis — S/ ${fmt(fergis)}</div>
      <div class="muted" style="margin-bottom:8px">¿A qué deuda/compromiso va este ingreso?</div>
      <select class="rmFergisSelect" onchange="roadmapSetFergisTarget('${mk}',this.value)">
        <option value="">— Sin asignar —</option>
        ${debtOptions}
      </select>
      ${plan.fergisTarget ? `<div class="rmFergisNote">✅ S/ ${fmt(fergis)} asignado para reforzar el pago de <strong>${escapeHtml((typeof financeDebtsActive==='function' ? financeDebtsActive() : []).find(d=>d.id===plan.fergisTarget)?.name||'')}</strong></div>` : ''}
    </div>
  ` : '';
  const deferTotal = sim.steps.filter(s=>s.deferrable).reduce((a,s)=>a+s.amount,0);
  const freeAfterDeferring = sim.remaining + deferTotal;
  const freeColor = sim.remaining >= 0 ? 'rmFreeGood' : 'rmFreeBad';
  const freeSummary = `
    <div class="rmFreeSummary ${freeColor}">
      <div class="rmFreeLabel">${sim.remaining >= 0 ? '✅ Libre después de todo' : '⚠️ Déficit estimado'}</div>
      <div class="rmFreeAmt">S/ ${fmt(Math.abs(sim.remaining))}</div>
      ${sim.remaining < 0 ? `<div class="muted" style="margin-top:4px">Faltan S/ ${fmt(Math.abs(sim.remaining))} para cubrir todos los compromisos.</div>` : `<div class="muted" style="margin-top:4px">Puedes ahorrar, acelerar una deuda o guardarlo.</div>`}
      ${deferTotal > 0 ? `<div class="rmDeferHint" style="margin-top:8px">Si aplazas los ítems marcados, tu libre quedaría en S/ ${fmt(Math.abs(freeAfterDeferring))}${freeAfterDeferring < 0 ? ' (déficit)' : ''}.</div>` : ''}
    </div>
  `;
  return `
    <section class="card homeCard homeWide rmWrap">
      <div class="cardTop">
        <h2 class="cardTitle">🗺️ Hoja de Ruta Mensual</h2>
      </div>
      <div class="hr"></div>
      ${incomePanel}
      <div class="hr" style="margin-top:12px"></div>
      ${fergisAssign}
      ${fergisAssign ? '<div class="hr" style="margin-top:12px"></div>' : ''}
      <div class="rmTabBar">${tabBtns}</div>
      <div class="rmViewBody">
        ${viewBody}
      </div>
      <div class="hr" style="margin-top:12px"></div>
      ${freeSummary}
    </section>
    ${_roadmapStyles()}
  `;
}

function _roadmapCascadeView(mk, sim, fmt){
  const items = roadmapBuildItems(mk);
  if(!items.length) return `<div class="muted" style="padding:16px">Agrega compromisos o deudas para ver la cascada de pagos.</div>`;
  const rows = sim.steps.map((s, idx) => {
    const pct = sim.totalIncome > 0 ? Math.max(0, Math.min(100, (s.remainingAfter / sim.totalIncome) * 100)) : 0;
    const chip = s.deferrable
      ? `<span class="rmChipDefer">aplazable</span>`
      : `<span class="rmChipFixed">fijo</span>`;
    const status = s.canPay ? `<span class="rmStatusOk">✓</span>` : `<span class="rmStatusBad">✗</span>`;
    const fergisTag = s.isFergisTarget ? `<span class="rmChipFergis">💜 Fergis</span>` : '';
    return `
      <div class="rmCascadeRow" data-id="${s.id}">
        <div class="rmCascadeLeft">
          <div class="rmCascadeOrder">${idx+1}</div>
          <div class="rmCascadeInfo">
            <div class="rmCascadeName">
              ${status} ${escapeHtml(s.name)}
              <span class="rmCascadeType">${s.type==='commitment'?'💼':'💳'}</span>
              ${chip} ${fergisTag}
            </div>
            <div class="muted">Pago: S/ ${fmt(s.amount)} · queda S/ ${fmt(s.remainingAfter)} después</div>
            <div class="rmCascadeBar">
              <div class="rmCascadeBarFill" style="width:${pct.toFixed(1)}%"></div>
            </div>
          </div>
        </div>
        <div class="rmCascadeRight">
          <div class="rmCascadeAmt ${s.canPay?'rmAmtOk':'rmAmtBad'}">S/ ${fmt(s.amount)}</div>
          <div class="rmDeferToggle">
            <label class="rmToggleLabel">
              <input type="checkbox" ${s.deferrable?'checked':''}
                onchange="roadmapToggleDeferrable('${mk}','${s.id}',this.checked)" />
              <span class="muted" style="font-size:10px">aplazar</span>
            </label>
          </div>
          <div class="rmMoveButtons">
            <button class="rmMoveBtn" title="Subir" onclick="roadmapMoveItem('${mk}','${s.id}',-1)">▲</button>
            <button class="rmMoveBtn" title="Bajar" onclick="roadmapMoveItem('${mk}','${s.id}',1)">▼</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  const deferTotal = sim.steps.filter(s=>s.deferrable).reduce((a,s)=>a+s.amount,0);
  const deferHint = deferTotal > 0
    ? `<div class="rmDeferHint">Si aplazas los ítems marcados, liberas S/ ${fmt(deferTotal)} adicionales.</div>`
    : '';
  return `<div class="rmCascadeList">${rows}</div>${deferHint}`;
}

function _roadmapTimelineView(mk, sim, fmt){
  const items = roadmapBuildItems(mk);
  const weeks = { '1-7':[], '8-14':[], '15-21':[], '22-31':[] };
  const weekLabels = { '1-7':'Semana 1 (días 1–7)', '8-14':'Semana 2 (días 8–14)', '15-21':'Semana 3 (días 15–21)', '22-31':'Semana 4 (días 22–31)' };
  items.forEach(it => {
    const day = Number(it.dueDay||1);
    const key = day<=7 ? '1-7' : day<=14 ? '8-14' : day<=21 ? '15-21' : '22-31';
    weeks[key].push(it);
  });
  const weekIncome = financeDebtSafeNum(roadmapGetMonth(mk).sueldo||0) / 4;
  const fergisWeekly = financeDebtSafeNum(roadmapGetMonth(mk).fergisIncome||0) / 4;
  const weekCards = Object.entries(weeks).map(([key, wItems]) => {
    const total = wItems.reduce((s,x)=>s+x.amount,0);
    const income = weekIncome + fergisWeekly;
    const ok = income >= total;
    const rows = wItems.map(it=>`
      <div class="rmTimelineItem">
        <span class="rmTimelineIcon">${it.type==='commitment'?'💼':'💳'}</span>
        <span class="rmTimelineName">${escapeHtml(it.name)}</span>
        <span class="rmTimelineAmt">S/ ${fmt(it.amount)}</span>
        ${it.deferrable?`<span class="rmChipDefer">aplazable</span>`:''}
      </div>
    `).join('') || `<div class="muted" style="padding:6px 0">Sin pagos esta semana</div>`;
    return `
      <div class="rmWeekCard ${ok?'rmWeekOk':'rmWeekBad'}">
        <div class="rmWeekHead">
          <div class="rmWeekLabel">${weekLabels[key]}</div>
          <div class="rmWeekBalance ${ok?'':'rmAmtBad'}">
            ${ok ? `+S/ ${fmt(income-total)}` : `-S/ ${fmt(total-income)}`}
          </div>
        </div>
        <div class="rmWeekIncome muted">Ingreso semanal estimado: S/ ${fmt(income)}</div>
        ${rows}
        <div class="rmWeekTotal">Total salida: S/ ${fmt(total)}</div>
      </div>
    `;
  }).join('');
  return `<div class="rmTimelineGrid">${weekCards}</div>`;
}

function _roadmapCashflowView(mk, fmt){
  const weeks = roadmapCashflow(mk);
  let accumulated = 0;
  const maxIncome = Math.max(...weeks.map(x=>x.income+0.01));
  const rows = weeks.map(w => {
    accumulated += w.balance;
    const isPos = accumulated >= 0;
    return `
      <div class="rmCfRow">
        <div class="rmCfWeek">S${w.week}</div>
        <div class="rmCfBars">
          <div class="rmCfBarIn" style="width:${(w.income / maxIncome * 100).toFixed(1)}%"></div>
          <div class="rmCfBarOut" style="width:${(w.totalOut / maxIncome * 100).toFixed(1)}%"></div>
        </div>
        <div class="rmCfNums">
          <span class="rmCfIn">+${fmt(w.income)}</span>
          <span class="rmCfOut">-${fmt(w.totalOut)}</span>
        </div>
        <div class="rmCfAcum ${isPos?'rmCfPos':'rmCfNeg'}">S/ ${fmt(accumulated)}</div>
      </div>
    `;
  }).join('');
  const itemLegend = roadmapBuildItems(mk).slice(0,8).map(it=>`
    <div class="rmCfItem">
      <span>${it.type==='commitment'?'💼':'💳'}</span>
      <span>${escapeHtml(it.name)}</span>
      <span class="rmCfItemAmt">S/ ${fmt(it.amount)}</span>
    </div>
  `).join('');
  return `
    <div class="rmCfWrap">
      <div class="rmCfLegend">
        <span class="rmCfLegIn">■ Entrada</span>
        <span class="rmCfLegOut">■ Salida</span>
      </div>
      <div class="rmCfChart">${rows}</div>
      <div class="hr" style="margin:10px 0"></div>
      <div class="muted" style="margin-bottom:6px;font-size:11px">Ítems por semana</div>
      <div class="rmCfItemList">${itemLegend}</div>
    </div>
  `;
}

function roadmapSetView(mk, viewKey){
  roadmapGetMonth(mk).activeView = viewKey;
  _roadmapSave();
  view();
}

function roadmapSetIncome(mk, key, val){
  roadmapGetMonth(mk)[key] = financeDebtSafeNum(val);
  _roadmapSave();
  clearTimeout(window._rmInputTimer);
  window._rmInputTimer = setTimeout(()=>{ try{ view(); }catch(_e){} }, 400);
}

function roadmapSetFergisTarget(mk, id){
  roadmapGetMonth(mk).fergisTarget = id || null;
  _roadmapSave();
  view();
}

function roadmapToggleDeferrable(mk, id, flag){
  const order = roadmapBuildItems(mk).map(it => ({
    id: it.id,
    deferrable: it.id === id ? !!flag : !!it.deferrable
  }));
  roadmapGetMonth(mk).order = order;
  _roadmapSave();
  view();
}

function roadmapMoveItem(mk, id, delta){
  const items = roadmapBuildItems(mk);
  const idx = items.findIndex(x=>x.id===id);
  if(idx === -1) return;
  const newIdx = Math.max(0, Math.min(items.length-1, idx+delta));
  if(newIdx === idx) return;
  const arr = [...items];
  const [moved] = arr.splice(idx,1);
  arr.splice(newIdx,0,moved);
  roadmapGetMonth(mk).order = arr.map(x=>({ id:x.id, deferrable:!!x.deferrable }));
  _roadmapSave();
  view();
}

try{
  window.roadmapSetView = roadmapSetView;
  window.roadmapSetIncome = roadmapSetIncome;
  window.roadmapSetFergisTarget = roadmapSetFergisTarget;
  window.roadmapToggleDeferrable = roadmapToggleDeferrable;
  window.roadmapMoveItem = roadmapMoveItem;
  window.renderFinanceRoadmapTab = renderFinanceRoadmapTab;
}catch(e){}

function _roadmapStyles(){
  if(document.getElementById('_rmStyles')) return '';
  const s = document.createElement('style');
  s.id = '_rmStyles';
  s.textContent = `
  .rmWrap { padding-bottom: 20px; }
  .rmIncomePanel {
    background: rgba(124,92,255,.08);
    border: 1px solid rgba(124,92,255,.2);
    border-radius: 16px;
    padding: 14px 16px;
    margin-top: 12px;
  }
  .rmIncomePanelTitle {
    font-size: 12px; font-weight: 700; letter-spacing: .6px;
    text-transform: uppercase; color: rgba(255,255,255,.45); margin-bottom: 12px;
  }
  .rmIncomeGrid { display: flex; flex-direction: column; gap: 10px; }
  .rmIncomeRow { display: flex; align-items: center; gap: 10px; }
  .rmIncomeIcon { font-size: 20px; flex-shrink: 0; width: 28px; text-align: center; }
  .rmIncomeInfo { flex: 1; min-width: 0; }
  .rmIncomeLabel { font-size: 11px; color: rgba(255,255,255,.4); margin-bottom: 4px; }
  .rmIncomeInput {
    width: 100%; max-width: 140px;
    background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12);
    border-radius: 8px; padding: 6px 10px;
    color: inherit; font-size: 14px; font-weight: 600;
    outline: none;
  }
  .rmIncomeInput:focus { border-color: rgba(124,92,255,.5); background: rgba(124,92,255,.1); }
  .rmIncomeAmt { font-size: 16px; font-weight: 700; white-space: nowrap; min-width: 80px; text-align: right; }
  .rmIncomeTotalRow {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 12px; padding-top: 10px;
    border-top: 1px solid rgba(255,255,255,.08);
  }
  .rmIncomeTotal { font-size: 20px; font-weight: 800; color: #36d399; }
  .rmTabBar { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0 10px; }
  .rmTab {
    padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 600;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
    color: rgba(255,255,255,.55); cursor: pointer; transition: all .15s;
  }
  .rmTab:hover { background: rgba(255,255,255,.1); color: #fff; }
  .rmTabActive {
    background: rgba(124,92,255,.25) !important;
    border-color: rgba(124,92,255,.5) !important;
    color: #c4b5fd !important;
  }
  .rmCascadeList { display: flex; flex-direction: column; gap: 2px; }
  .rmCascadeRow {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 6px; border-radius: 12px;
    transition: background .12s;
  }
  .rmCascadeRow:hover { background: rgba(255,255,255,.04); }
  .rmCascadeLeft { display: flex; gap: 10px; flex: 1; min-width: 0; }
  .rmCascadeOrder {
    width: 24px; height: 24px; border-radius: 50%;
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; flex-shrink: 0; margin-top: 2px;
  }
  .rmCascadeInfo { flex: 1; min-width: 0; }
  .rmCascadeName {
    font-size: 13px; font-weight: 600;
    display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  }
  .rmCascadeType { font-size: 12px; }
  .rmCascadeBar {
    height: 3px; background: rgba(255,255,255,.07);
    border-radius: 2px; overflow: hidden; margin-top: 6px;
  }
  .rmCascadeBarFill {
    height: 100%; background: linear-gradient(90deg,#7c5cff,#36d399);
    border-radius: 2px; transition: width .4s ease;
  }
  .rmCascadeRight {
    display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
    flex-shrink: 0;
  }
  .rmCascadeAmt { font-size: 15px; font-weight: 700; }
  .rmAmtOk  { color: #36d399; }
  .rmAmtBad { color: #fb7185; }
  .rmStatusOk  { color: #36d399; }
  .rmStatusBad { color: #fb7185; }
  .rmMoveButtons { display: flex; gap: 2px; }
  .rmMoveBtn {
    width: 22px; height: 22px; border-radius: 6px;
    background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
    font-size: 9px; cursor: pointer; color: rgba(255,255,255,.5);
    display: flex; align-items: center; justify-content: center;
    transition: background .12s;
  }
  .rmMoveBtn:hover { background: rgba(255,255,255,.14); color: #fff; }
  .rmDeferToggle { display: flex; align-items: center; gap: 4px; }
  .rmToggleLabel { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  .rmChipFixed  { font-size: 10px; padding: 2px 7px; border-radius: 8px; background: rgba(251,113,133,.15); color: #fb7185; font-weight: 700; }
  .rmChipDefer  { font-size: 10px; padding: 2px 7px; border-radius: 8px; background: rgba(251,191,36,.15); color: #fbbf24; font-weight: 700; }
  .rmChipFergis { font-size: 10px; padding: 2px 7px; border-radius: 8px; background: rgba(168,85,247,.2); color: #c084fc; font-weight: 700; }
  .rmDeferHint  { font-size: 12px; color: #fbbf24; margin-top: 10px; padding: 8px 12px; background: rgba(251,191,36,.08); border-radius: 10px; border: 1px solid rgba(251,191,36,.2); }
  .rmTimelineGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media(max-width:480px){ .rmTimelineGrid { grid-template-columns: 1fr; } }
  .rmWeekCard {
    border-radius: 14px; padding: 12px 14px;
    border: 1px solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.03);
  }
  .rmWeekOk  { border-color: rgba(54,211,153,.2) !important; }
  .rmWeekBad { border-color: rgba(251,113,133,.25) !important; }
  .rmWeekHead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .rmWeekLabel { font-size: 12px; font-weight: 700; }
  .rmWeekBalance { font-size: 13px; font-weight: 700; color: #36d399; }
  .rmWeekIncome { font-size: 11px; margin-bottom: 8px; }
  .rmWeekTotal { font-size: 11px; font-weight: 600; margin-top: 8px; color: rgba(255,255,255,.45); }
  .rmTimelineItem {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,.05);
    font-size: 12px;
  }
  .rmTimelineItem:last-child { border-bottom: none; }
  .rmTimelineIcon { flex-shrink: 0; }
  .rmTimelineName { flex: 1; }
  .rmTimelineAmt { font-weight: 600; white-space: nowrap; }
  .rmCfWrap { padding: 4px 0; }
  .rmCfLegend { display: flex; gap: 14px; margin-bottom: 10px; font-size: 11px; }
  .rmCfLegIn  { color: #36d399; }
  .rmCfLegOut { color: #fb7185; }
  .rmCfChart { display: flex; flex-direction: column; gap: 8px; }
  .rmCfRow { display: grid; grid-template-columns: 28px 1fr 110px 80px; align-items: center; gap: 8px; }
  .rmCfWeek { font-size: 11px; font-weight: 700; color: rgba(255,255,255,.4); }
  .rmCfBars { display: flex; flex-direction: column; gap: 3px; }
  .rmCfBarIn  { height: 6px; background: #36d399; border-radius: 3px; min-width: 4px; transition: width .4s; }
  .rmCfBarOut { height: 6px; background: #fb7185; border-radius: 3px; min-width: 4px; transition: width .4s; }
  .rmCfNums { display: flex; flex-direction: column; gap: 2px; font-size: 11px; }
  .rmCfIn  { color: #36d399; }
  .rmCfOut { color: #fb7185; }
  .rmCfAcum { font-size: 13px; font-weight: 700; text-align: right; }
  .rmCfPos { color: #36d399; }
  .rmCfNeg { color: #fb7185; }
  .rmCfItemList { display: flex; flex-direction: column; gap: 4px; }
  .rmCfItem {
    display: flex; align-items: center; gap: 8px; font-size: 12px;
    padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,.05);
  }
  .rmCfItem:last-child { border-bottom: none; }
  .rmCfItemAmt { margin-left: auto; font-weight: 600; }
  .rmFergisBox {
    background: rgba(168,85,247,.08);
    border: 1px solid rgba(168,85,247,.2);
    border-radius: 14px; padding: 14px 16px; margin-top: 12px;
  }
  .rmFergisTitle { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
  .rmFergisSelect {
    width: 100%; padding: 8px 10px; border-radius: 10px;
    background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12);
    color: inherit; font-size: 13px; outline: none;
  }
  .rmFergisSelect:focus { border-color: rgba(168,85,247,.5); }
  .rmFergisNote {
    margin-top: 8px; font-size: 12px; color: #c084fc;
    padding: 6px 10px; background: rgba(168,85,247,.1); border-radius: 8px;
  }
  .rmFreeSummary {
    border-radius: 14px; padding: 14px 16px; margin-top: 12px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .rmFreeGood { background: rgba(54,211,153,.1); border: 1px solid rgba(54,211,153,.25); }
  .rmFreeBad  { background: rgba(251,113,133,.1); border: 1px solid rgba(251,113,133,.25); }
  .rmFreeLabel { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
  .rmFreeAmt { font-size: 28px; font-weight: 800; letter-spacing: -1px; }
  .rmFreeGood .rmFreeAmt { color: #36d399; }
  .rmFreeBad  .rmFreeAmt { color: #fb7185; }
  `;
  document.head.appendChild(s);
  return '';
}
