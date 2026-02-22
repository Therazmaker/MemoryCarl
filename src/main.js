import { computeMoonNow } from "./cosmic_lite.js";
import { getTransitLiteSignals } from "./transit_lite.js";
import { getTransitSwissSignals, swissTransitsAvailable } from "./transit_swiss.js";

console.log("MemoryCarl loaded");
// ===== LocalStorage Keys =====
const KEYS = {
  neuroclawAiUrl: "memorycarl_v2_neuroclaw_ai_url",
  neuroclawAiKey: "memorycarl_v2_neuroclaw_ai_key",
  neuroclawAiLog: "memorycarl_v2_neuroclaw_ai_log",
  neuroclawAiUsage: "memorycarl_v2_neuroclaw_ai_usage",
};

// ====================== NOTIFICATIONS (Firebase Cloud Messaging) ======================
// 1) Firebase Console -> Project settings -> Cloud Messaging -> Web Push certificates -> Generate key pair
// 2) Paste the VAPID public key below
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./firebase-messaging-sw.js?v=999")
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
const LS = {
  routines: "memorycarl_v2_routines",
  shopping: "memorycarl_v2_shopping",
  // Reminders: support legacy plural key too
  reminders: "memorycarl_v2_reminder",
  remindersLegacy: "memorycarl_v2_reminders",

  // Shopping system (library + history)
  products: "memorycarl_v2_products",
  shoppingHistory: "memorycarl_v2_shopping_history",
  inventory: "memorycarl_v2_inventory",

  // Home widgets
  musicToday: "memorycarl_v2_music_today",
  musicLog: "memorycarl_v2_music_log",
  sleepLog: "memorycarl_v2_sleep_log",
  budgetMonthly: "memorycarl_v2_budget_monthly",
  calDraw: "memorycarl_v2_cal_draw",
  house: "memorycarl_v2_house",
  moodDaily: "memorycarl_v2_mood_daily",
  moodSpritesCustom: "memorycarl_v2_mood_sprites_custom",

  // NeuroClaw
  neuroclawFeedback: "memorycarl_v2_neuroclaw_feedback",
  neuroclawLast: "memorycarl_v2_neuroclaw_last",
  neuroclawAiUrl: "memorycarl_v2_neuroclaw_ai_url",
  neuroclawAiKey: "memorycarl_v2_neuroclaw_ai_key",

  // Astrology (local-only)
  natalChart: "memorycarl_v2_natal_chart_json",
  astroProvider: "memorycarl_v2_astro_provider", // 'lite' | 'swiss'
  astroSwissLast: "memorycarl_v2_astro_swiss_last",
  astroSwissSeen: "memorycarl_v2_astro_swiss_seen", // per-day cache
  bubbleFreqMin: "memorycarl_v2_bubble_freq_min",
};
// ---- Sync (Google Apps Script via sendBeacon) ----
const SYNC = {
  urlKey: "memorycarl_script_url",
  apiKeyKey: "memorycarl_script_api_key",
  dirtyKey: "memorycarl_sync_dirty",
  lastSyncKey: "memorycarl_last_sync_at",
};

function getSyncUrl(){ return localStorage.getItem(SYNC.urlKey) || ""; }
function setSyncUrl(u){ localStorage.setItem(SYNC.urlKey, (u||"").trim()); }
function getSyncApiKey(){ return localStorage.getItem(SYNC.apiKeyKey) || ""; }
function setSyncApiKey(k){ localStorage.setItem(SYNC.apiKeyKey, (k||"").trim()); }

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

function flushSync(reason="auto"){
  try{
    if (!isDirty()) return;
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
        musicToday: state?.musicToday ?? load(LS.musicToday, null),
        musicLog: state?.musicLog ?? load(LS.musicLog, []),
        sleepLog: state?.sleepLog ?? load(LS.sleepLog, []),
        // Shopping system (library + history)
        products: state?.products ?? load(LS.products, []),
        shoppingHistory: state?.shoppingHistory ?? load(LS.shoppingHistory, []),
        // Inventory (home stock)
        inventory: state?.inventory ?? load(LS.inventory, []),
        // Other useful state
        budgetMonthly: state?.budgetMonthly ?? load(LS.budgetMonthly, null),
        house: state?.house ?? load(LS.house, null),
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

function load(key, fallback){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch{ return fallback; }
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
  localStorage.setItem(key, JSON.stringify(value));
  // Mark dirty only for core data keys (avoid syncing tokens/settings every time)
  if (
    key === LS.routines ||
    key === LS.shopping ||
    key === LS.reminders ||
    key === LS.musicToday ||
    key === LS.musicLog ||
    key === LS.sleepLog ||
    key === LS.products ||
    key === LS.shoppingHistory ||
    key === LS.inventory
  ) markDirty();
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



function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

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
  sheetOpen: (localStorage.getItem("mc_sheet_open")==="1"),
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
  house: load(LS.house, seedHouse()),
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

  // House
  save(LS.house, state.house);

  // NeuroClaw
  try{ save(LS.neuroclawFeedback, state.neuroclawFeedback); }catch(e){}
  try{ save(LS.neuroclawLast, state.neuroclawLast); }catch(e){}

  // Shopping system (added later in file, so guard)
  try{
    if(LS.products) save(LS.products, state.products);
    if(LS.shoppingHistory) save(LS.shoppingHistory, state.shoppingHistory);
    if(LS.inventory) save(LS.inventory, state.inventory);
  }catch(e){}
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
    inventory: state.inventory
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

  // Compat: algunas versiones guardaron reminders en singular
  try{
    if(rem !== undefined){
      localStorage.setItem("memorycarl_v2_reminder", JSON.stringify(rem));
    }
  }catch(e){}

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
      ${mk("house","🧹","Casa")}
      ${mk("routines","📝","Rutinas")}
      ${mk("shopping","🛒","Compras")}
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
          ${mk("settings","⚙️","Ajustes","Backup, sync, etc")}
        </div>
      </div>
    </div>
  `;
}

function view(){
  // Keep a fresh global signals bag (used by NeuroBubble and other small agents)
  try{ refreshGlobalSignals(); }catch(e){}
  const root = document.querySelector("#app");
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
        ${state.tab==="routines" ? viewRoutines() : ""}
        ${state.tab==="shopping" ? viewShopping() : ""}
        ${state.tab==="reminders" ? viewReminders() : ""}
        ${state.tab==="house" ? viewHouse() : ""}
        ${state.tab==="calendar" ? viewCalendar() : ""}
        ${state.tab==="learn" ? viewLearn() : ""}
        ${state.tab==="insights" ? viewInsights() : ""}
        ${state.tab==="settings" ? viewSettings() : ""}
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
            <button class="btn" id="btnExport">Export</button>
            <button class="btn primary" id="btnNotif">Enable Notifs</button>
            <button class="btn" id="btnCopyToken">Copy Token</button>
            <label class="btn" style="cursor:pointer;">
              Import
              <input id="fileImport" type="file" accept="application/json" style="display:none;">
            </label>
          </div>
          <div class="muted" style="margin-top:10px;">Backup local (JSON). Útil antes de limpiar cache o cambiar de teléfono.</div>
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
        : "Swiss: configura NeuroClaw URL+Key";
    }
    if(btnProvSave) btnProvSave.addEventListener("click", async ()=>{
      const v = selProv ? String(selProv.value||"lite") : "lite";
      setAstroProvider(v);
      refreshGlobalSignals();
      if(v === "swiss"){
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
        state.insightsDay = btn.dataset.insDay || "";
        state.insightsDayOpen = true;
        view();
      });
    });
  }

// Insights day modal wiring
  if(state.insightsDayOpen){
    const b = root.querySelector("#insightsDayBackdrop");
    const c = root.querySelector("#btnInsightsDayClose");
    // Animate in + draw radar after DOM is ready
    setTimeout(()=>{ insightsModalIn(); insightsDrawRadar(); }, 0);

    const close = ()=> closeInsightsModalAnimated();
    if(b){
      b.addEventListener("click", (e)=>{ if(e.target===b) close(); });
    }
    if(c) c.addEventListener("click", close);
  }

  
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

  // FAB action per tab (disabled on Learn)
  const fab = root.querySelector("#fab");
  fab.style.display = (state.tab==="learn" || state.tab==="settings") ? "none" : "flex";
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
          <option value="pulse" ${INS_HEAT_MODE==="pulse"?"selected":""}>Pulso</option>
          <option value="sleep" ${INS_HEAT_MODE==="sleep"?"selected":""}>Sueño</option>
          <option value="tasks" ${INS_HEAT_MODE==="tasks"?"selected":""}>Tasks</option>
          <option value="clean" ${INS_HEAT_MODE==="clean"?"selected":""}>Limpieza</option>
          <option value="shop" ${INS_HEAT_MODE==="shop"?"selected":""}>Compras</option>
          <option value="mood" ${INS_HEAT_MODE==="mood"?"selected":""}>Mood</option>
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
          const heat = insightHeat(c.sum, INS_HEAT_MODE, mctx);
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
let INS_HEAT_MODE = localStorage.getItem("mc_ins_heat_mode") || "pulse";
window.insightsSetHeatMode = function(mode){
  INS_HEAT_MODE = String(mode || "pulse");
  localStorage.setItem("mc_ins_heat_mode", INS_HEAT_MODE);
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

  // Sleep
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
      out.shopping = { total: Number(total.toFixed(2)), entries: day.length, itemsCount: day.reduce((a,h)=>a+(Number(h?.totals?.itemsCount)||0),0) };
    }
  }catch(e){}

  // Reminders (done that day if we have ts? fallback: count pending)
  try{
    const rem = Array.isArray(state.reminders) ? state.reminders : [];
    const total = rem.length;
    const done = rem.filter(r=>!!r.done).length;
    out.reminders = { total, done, pending: total-done };
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

  return out;
}

function renderInsightsDayModal(){
  const iso = String(state.insightsDay||"");
  const sum = buildDailySummary(iso) || { iso };

  const moodName = sum.mood ? (()=>{ const s = getMoodSpriteById(sum.mood.spriteId); return s ? `${s.name}` : sum.mood.spriteId; })() : "Sin datos";
  const sleepStr = sum.sleep ? `${Math.round((Number(sum.sleep.totalMinutes)||0)/6)/10}h • Q${escapeHtml(String(sum.sleep.quality||""))}` : "Sin datos";
  const shoppingStr = (sum.shopping && sum.shopping.total>0) ? `${money(sum.shopping.total)} (${sum.shopping.entries} compras)` : "Sin datos";
  const remindersStr = sum.reminders ? `${sum.reminders.done}/${sum.reminders.total}` : "Sin datos";
  const cleaningStr = (sum.cleaning && sum.cleaning.totalMinutes>0) ? `${Math.round(sum.cleaning.totalMinutes)} min (${sum.cleaning.count} sesiones)` : "Sin datos";

  const shopList = (Array.isArray(state.shoppingHistory)? state.shoppingHistory: []).filter(h=>String(h.date)===iso).slice(0,8);
  const cleanList = (state.house && Array.isArray(state.house.sessionHistory)? state.house.sessionHistory: []).filter(h=>String(h.date)===iso).slice(0,8);

  // Normalized values 0..100 for radar
  const v = insightVector(sum);
  return `
    <div class="modalBackdrop neuralBackdrop" id="insightsDayBackdrop" aria-label="Día">
      <div class="neuralModal">
        <div class="neuralCard" id="insightsNeuralCard">
          <div class="row" style="justify-content:space-between;align-items:center;">
            <div>
              <div class="pill small" style="display:inline-flex;gap:6px;align-items:center;">
                <span class="dot"></span>
                <span>Mapa mental diario</span>
              </div>
              <h2 style="margin:8px 0 0;">${escapeHtml(iso)}</h2>
            </div>
            <button class="iconBtn" id="btnInsightsDayClose">Cerrar</button>
          </div>

          <div class="neuralGrid">
            <div class="neuralChartWrap">
              <div class="radarBox"><canvas id="insightsRadarCanvas"></canvas></div>
              <div class="neuralLegend muted">Mood • Sueño • Tasks • Limpieza • Compras</div>
            </div>

            <div class="neuralSummary">
              <div class="neuralChipRow">
                <div class="neuralChip"><span>🙂</span><b>${escapeHtml(String(moodName))}</b></div>
                <div class="neuralChip"><span>😴</span><b>${escapeHtml(String(sleepStr))}</b></div>
                <div class="neuralChip"><span>✅</span><b>${escapeHtml(String(remindersStr))}</b><span class="muted">rem</span></div>
                <div class="neuralChip"><span>🧹</span><b>${escapeHtml(String(cleaningStr))}</b></div>
                <div class="neuralChip"><span>🛒</span><b>${escapeHtml(String(shoppingStr))}</b></div>
              </div>

              ${(sum.mood && sum.mood.note) ? `<div class="noteCard"><div class="muted">Nota mood</div><div>${escapeHtml(sum.mood.note)}</div></div>` : ``}
              ${(sum.sleep && sum.sleep.note) ? `<div class="noteCard"><div class="muted">Nota sueño</div><div>${escapeHtml(sum.sleep.note)}</div></div>` : ``}
            </div>
          </div>

          ${(shopList.length || cleanList.length) ? `
            <div class="hr"></div>
            <div class="list">
              ${shopList.length ? `
                <div class="muted" style="margin:6px 0 4px;">Compras del día</div>
                ${shopList.map(h=>`
                  <div class="item">
                    <div class="left">
                      <div class="name">🛒 ${escapeHtml(h.store||"")}</div>
                      <div class="meta">${money(Number(h?.totals?.total||0))} • ${Number(h?.totals?.itemsCount||0)} items</div>
                    </div>
                  </div>
                `).join("")}
              `:``}

              ${cleanList.length ? `
                <div class="muted" style="margin:10px 0 4px;">Sesiones de limpieza</div>
                ${cleanList.map(s=>`
                  <div class="item">
                    <div class="left">
                      <div class="name">🧹 ${escapeHtml(String(s.status||"ended"))}</div>
                      <div class="meta">${Math.round((Number(s.totalSec)||0)/60)} min • ${Array.isArray(s.logs)?s.logs.length:0} pasos</div>
                    </div>
                  </div>
                `).join("")}
              `:``}
            </div>
          `:``}

        </div>
      </div>
    </div>
  `;
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
          <h2 class="cardTitle">Backup</h2>
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
        Tip: primero usa <b>Export Backup</b>. Restaurar no usa <span class="mono">eval</span>, solo <span class="mono">JSON.parse</span>.
      </div>
    </div>

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
  if(!date || !Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
  return {
    id: String(e.id || uid()),
    ts: String(e.ts || new Date().toISOString()),
    date,
    totalMinutes: Math.round(totalMinutes),
    quality: (e.quality === undefined || e.quality === null || e.quality === "") ? null : Number(e.quality),
    note: String(e.note || ""),
    mode: String(e.mode || "simple"),
    start: e.start ? String(e.start) : "",
    end: e.end ? String(e.end) : ""
  };
}

// ====================== MOOD SPRITES (Daily Emotion) ======================
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

function getMoodEntry(iso){
  const map = (state.moodDaily && typeof state.moodDaily==="object") ? state.moodDaily : {};
  const e = map[String(iso||"")];
  if(!e || typeof e!=="object") return null;
  return {
    iso: String(iso),
    spriteId: e.spriteId ? String(e.spriteId) : "",
    label: e.label ? String(e.label) : "",
    tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
    note: e.note ? String(e.note) : "",
    ts: e.ts ? String(e.ts) : ""
  };
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
  const all = getAllMoodSprites();

  // Only show "face" presets first (incredible..horrible)
  const faceIds = new Set(["incredible","good","meh","bad","horrible"]);
  const faces = all.filter(s=>faceIds.has(String(s.id)));

  let selectedId = existing?.spriteId || "";
  let selectedLabel = existing?.label || "";
  let note = existing?.note || "";
  let tags = new Set(Array.isArray(existing?.tags) ? existing.tags : []);

  // If existing is legacy id, keep it but try to map to a face when opening
  if(selectedId && !faceIds.has(String(selectedId))){
    // keep legacy id but default UI selection to closest face by score
    const sc = getMoodScoreById(selectedId);
    if(sc!=null){
      const best = faces
        .map(f=>({ id:f.id, sc: Math.abs((getMoodScoreById(f.id)||5) - sc) }))
        .sort((a,b)=>a.sc-b.sc)[0];
      if(best?.id) selectedId = best.id;
    }else{
      selectedId = "meh";
    }
  }
  if(!selectedId) selectedId = "meh";

  const getFace = (id)=>faces.find(f=>String(f.id)===String(id)) || null;

  // Default label for selected face
  const ensureLabel = ()=>{
    const f = getFace(selectedId);
    const labels = Array.isArray(f?.labels) ? f.labels : [];
    if(!selectedLabel){
      selectedLabel = labels[0] || String(f?.id||"");
    }else if(labels.length && !labels.includes(selectedLabel)){
      selectedLabel = labels[0];
    }
  };
  ensureLabel();

  const TAG_PRESETS = [
    { id:"sleep",   label:"Sueño malo", icon:"🛏️" },
    { id:"debts",   label:"Deudas", icon:"💸" },
    { id:"work",    label:"Trabajo", icon:"🧰" },
    { id:"family",  label:"Familia", icon:"🏠" },
    { id:"health",  label:"Salud", icon:"🩺" },
    { id:"money",   label:"Dinero", icon:"💰" },
  ];

  backdrop.innerHTML = `
    <div class="modal moodPickerModal v2" role="dialog" aria-label="Mood check-in">
      <div class="modalTop">
        <div>
          <div class="modalTitle">¿Cómo estás?</div>
          <div class="modalSub">${escapeHtml(iso)} · rápido y sin drama</div>
        </div>
        <div class="moodTopActions">
          <button class="iconBtn" id="btnMoodMonth" aria-label="Ver historial">Historial</button>
          <button class="iconBtn" data-close aria-label="Cerrar">✕</button>
        </div>
      </div>

      <div class="moodFaceRow" id="moodFaceRow">
        ${faces.map(f=>{
          const labels = Array.isArray(f.labels) ? f.labels : [];
          const main = labels[0] || f.id;
          const dots = labels.length>1 ? `<div class="moodDots">${labels.map(_=>`<span class="dot"></span>`).join("")}</div>` : `<div class="moodDots"></div>`;
          return `
            <button class="moodFace ${String(f.id)===String(selectedId)?"active":""}" data-face="${escapeHtml(f.id)}" title="${escapeHtml(main)}">
              <img src="${escapeHtml(f.src)}" alt="${escapeHtml(main)}"/>
              <div class="moodFaceLabel">${escapeHtml(main)}</div>
              ${dots}
            </button>
          `;
        }).join("")}
      </div>

      <div class="moodLabelRow" id="moodLabelRow"></div>

      <div class="moodTags">
        <div class="muted" style="margin-bottom:6px;">Tema (opcional)</div>
        <div class="chipRow" id="moodTagChips">
          ${TAG_PRESETS.map(t=>`
            <button class="chip ${tags.has(t.id)?"active":""}" data-tag="${escapeHtml(t.id)}">${escapeHtml(t.icon)} ${escapeHtml(t.label)}</button>
          `).join("")}
        </div>
        <div class="row" style="margin-top:8px;gap:8px;">
          <input class="input" id="moodTagInput" placeholder="Agregar tema (ej: ansiedad, pelea, calma)" />
          <button class="btn ghost" id="btnAddMoodTag">＋</button>
        </div>
      </div>

      <div class="field" style="margin-top:10px;">
        <label>Nota (opcional)</label>
        <textarea id="moodNote" class="input" rows="3" placeholder="Ej: me siento triste y no sé por qué...">${escapeHtml(note)}</textarea>
      </div>

      <div class="row" style="justify-content:space-between;margin-top:12px;">
        <button class="btn ghost" id="btnMoodClear">Quitar</button>
        <div class="row" style="gap:8px;">
          <button class="btn" data-close>Cancel</button>
          <button class="btn primary" id="btnMoodSave">Guardar</button>
        </div>
      </div>
    </div>
  `;

  const close = ()=> {
    if(typeof window.anime==="function"){
      animateSleepModalOut(backdrop, ()=>backdrop.remove());
    }else{
      backdrop.remove();
    }
  };

  backdrop.addEventListener("click", (e)=>{
    if(e.target===backdrop) close();
    if(e.target && e.target.closest("[data-close]")) close();
  });

  host.appendChild(backdrop);
  if(typeof window.anime==="function") animateSleepModalIn(backdrop);

  const faceRow = backdrop.querySelector("#moodFaceRow");
  const labelRow = backdrop.querySelector("#moodLabelRow");
  const tagChips = backdrop.querySelector("#moodTagChips");

  const renderLabels = ()=>{
    const f = getFace(selectedId);
    const labels = Array.isArray(f?.labels) ? f.labels : [];
    if(!labels.length){
      labelRow.innerHTML = "";
      return;
    }
    if(!selectedLabel) selectedLabel = labels[0];
    labelRow.innerHTML = `
      <div class="muted" style="margin-bottom:6px;">Matiz</div>
      <div class="chipRow">
        ${labels.map(l=>`
          <button class="chip ${String(l)===String(selectedLabel)?"active":""}" data-label="${escapeHtml(l)}">${escapeHtml(l)}</button>
        `).join("")}
      </div>
    `;
    labelRow.querySelectorAll("[data-label]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        selectedLabel = btn.getAttribute("data-label") || "";
        renderLabels();
      });
    });
  };

  const refreshFaces = ()=>{
    faceRow.querySelectorAll(".moodFace").forEach(btn=>{
      const id = btn.getAttribute("data-face")||"";
      btn.classList.toggle("active", String(id)===String(selectedId));
    });
  };

  faceRow.querySelectorAll("[data-face]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      selectedId = btn.getAttribute("data-face") || "meh";
      selectedLabel = "";
      ensureLabel();
      refreshFaces();
      renderLabels();
    });
  });

  tagChips?.querySelectorAll("[data-tag]")?.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-tag")||"";
      if(!id) return;
      if(tags.has(id)) tags.delete(id); else tags.add(id);
      btn.classList.toggle("active", tags.has(id));
    });
  });

  backdrop.querySelector("#btnAddMoodTag")?.addEventListener("click", ()=>{
    const inp = backdrop.querySelector("#moodTagInput");
    const v = (inp?.value||"").trim();
    if(!v) return;
    const id = v.toLowerCase().replace(/\s+/g,"_").slice(0,40);
    tags.add(id);

    // add a chip visually (custom)
    const chip = document.createElement("button");
    chip.className = "chip active";
    chip.setAttribute("data-tag", id);
    chip.textContent = "🏷️ " + v;
    chip.addEventListener("click", ()=>{
      if(tags.has(id)) tags.delete(id); else tags.add(id);
      chip.classList.toggle("active", tags.has(id));
    });
    tagChips.appendChild(chip);

    if(inp) inp.value = "";
  });

  backdrop.querySelector("#moodNote")?.addEventListener("input", (e)=>{ note = e.target.value || ""; });

  backdrop.querySelector("#btnMoodClear")?.addEventListener("click", ()=>{
    selectedId = "";
    selectedLabel = "";
    note = "";
    tags = new Set();
    backdrop.querySelector("#moodNote").value = "";
    tagChips.querySelectorAll(".chip").forEach(c=>c.classList.remove("active"));
    labelRow.innerHTML = "";
    refreshFaces();
  });

  backdrop.querySelector("#btnMoodSave")?.addEventListener("click", ()=>{
    setMoodEntry(iso, selectedId, selectedLabel, Array.from(tags), note);
    view();
    if(typeof opts.onSaved==="function") opts.onSaved({ iso, spriteId: selectedId, label: selectedLabel, tags: Array.from(tags), note });
    toast(selectedId ? "Mood guardado ✅" : "Mood eliminado 🧼");
    close();
  });

  backdrop.querySelector("#btnMoodMonth")?.addEventListener("click", ()=>{
    close();
    openMoodMonthModal(iso);
  });

  renderLabels();
}

function openMoodMonthModal(initialIso){
  const host = document.querySelector("#app");
  const backdrop = document.createElement("div");
  backdrop.className = "modalBackdrop";

  const start = initialIso ? new Date(initialIso+"T00:00:00") : new Date();
  if(Number.isNaN(start.getTime())) start.setTime(Date.now());
  start.setHours(0,0,0,0);
  let cursor = new Date(start);
  cursor.setDate(1);

  const close = ()=> {
    if(typeof window.anime==="function"){
      animateSleepModalOut(backdrop, ()=>backdrop.remove());
    }else{
      backdrop.remove();
    }
  };

  const render = ()=>{
    const y = cursor.getFullYear();
    const m = cursor.getMonth(); // 0-based
    const first = new Date(y, m, 1);
    const last = new Date(y, m+1, 0);
    const daysInMonth = last.getDate();
    const startDow = (first.getDay()+6)%7; // Monday=0
    const cells = [];
    for(let i=0;i<startDow;i++) cells.push(null);
    for(let d=1; d<=daysInMonth; d++){
      const dd = new Date(y,m,d);
      cells.push(isoDate(dd));
    }
    while(cells.length % 7 !== 0) cells.push(null);

    const title = first.toLocaleDateString("es-PE", { month:"long", year:"numeric" });
    const map = (state.moodDaily && typeof state.moodDaily==="object") ? state.moodDaily : {};

    const cellHtml = cells.map(iso=>{
      if(!iso) return `<div class="moodCalCell empty"></div>`;
      const e = map[iso];
      const sp = e ? getMoodSpriteById(e.spriteId) : null;
      return `
        <button class="moodCalCell" data-iso="${escapeHtml(iso)}">
          <div class="moodCalNum">${escapeHtml(String(Number(iso.slice(8,10))))}</div>
          ${sp ? `<img class="moodCalImg" src="${escapeHtml(sp.src)}" alt="" />` : `<div class="moodCalEmpty">＋</div>`}
        </button>
      `;
    }).join("");

    // History cards for this month (new solid mood log)
    const monthKey = `${y}-${String(m+1).padStart(2,"0")}`;
    const monthEntries = Object.keys(map).filter(k=>String(k).startsWith(monthKey)).sort((a,b)=>String(b).localeCompare(String(a)));
    const cardsHtml = monthEntries.slice(0, 31).map(iso=>{
      const e = map[iso] || {};
      const sp = getMoodSpriteById(e.spriteId);
      const tags = Array.isArray(e.tags) ? e.tags : [];
      const tagText = tags.map(t=>{
        if(t==="sleep") return "🛏️ Sueño malo";
        if(t==="debts") return "💸 Deudas";
        if(t==="work") return "🧰 Trabajo";
        if(t==="family") return "🏠 Familia";
        if(t==="health") return "🩺 Salud";
        if(t==="money") return "💰 Dinero";
        return "🏷️ " + String(t);
      }).slice(0,4).join(" · ");
      return `
        <div class="moodLogCard" data-iso="${escapeHtml(iso)}">
          <div class="moodLogHead">
            ${sp ? `<img class="moodLogImg" src="${escapeHtml(sp.src)}" alt=""/>` : `<div class="moodLogImg ph">＋</div>`}
            <div class="moodLogMeta">
              <div class="moodLogTitle">${escapeHtml((e.label||sp?.labels?.[0]||sp?.id||"").toString()||"")}</div>
              <div class="moodLogSub">${escapeHtml(iso)}</div>
            </div>
          </div>
          ${tagText ? `<div class="moodLogTags">${escapeHtml(tagText)}</div>` : ``}
          ${e.note ? `<div class="moodLogNote">${escapeHtml(String(e.note))}</div>` : ``}
        </div>
      `;
    }).join("");

    backdrop.innerHTML = `
      <div class="modal moodMonthModal" role="dialog" aria-label="Emociones del mes">
        <div class="modalTop">
          <div>
            <div class="modalTitle">Emociones</div>
            <div class="modalSub">${escapeHtml(title)}</div>
          </div>
          <div class="moodTopActions">
            <button class="iconBtn" id="mPrev" aria-label="Prev">‹</button>
            <button class="iconBtn" id="mNext" aria-label="Next">›</button>
            <button class="iconBtn" data-close aria-label="Cerrar">✕</button>
          </div>
        </div>

        <div class="moodCalHeader">
          ${["L","M","M","J","V","S","D"].map(x=>`<div>${x}</div>`).join("")}
        </div>
        <div class="moodCalGrid">
          ${cellHtml}
        </div>

        <div class="muted" style="margin-top:10px;">Tip: toca un día para elegir/editar su emoción.</div>

        <div class="moodLogSection">
          <div class="moodLogSectionTitle">Registro del mes</div>
          <div class="moodLogList">${cardsHtml || `<div class="muted">Aún no hay registros este mes.</div>`}</div>
        </div>
      </div>
    `;

    backdrop.querySelector("#mPrev")?.addEventListener("click", ()=>{ cursor = new Date(y, m-1, 1); render(); });
    backdrop.querySelector("#mNext")?.addEventListener("click", ()=>{ cursor = new Date(y, m+1, 1); render(); });

    backdrop.querySelectorAll("[data-iso]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const iso = btn.getAttribute("data-iso") || "";
        openMoodPickerModal(iso, { onSaved: ()=>render() });
      });
    });

    backdrop.addEventListener("click", (e)=>{
      if(e.target===backdrop) close();
      if(e.target && e.target.closest("[data-close]")) close();
    });
  };

  host.appendChild(backdrop);
  if(typeof window.anime==="function") animateSleepModalIn(backdrop);
  render();
}
// ====================== /MOOD SPRITES ======================




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
  if(!items.length){
    return `<div class="muted">Registra tu sueño para ver el gráfico 😴</div>`;
  }
  const maxM = series.maxMinutes || 480;
  const toPx = (minutes) => {
    const minH = 14, maxH = 68;
    const ratio = Math.max(0, Math.min(1, minutes / maxM));
    return Math.round(minH + ratio * (maxH - minH));
  };

  // Keep weekday letters stable and aligned with the 7 columns
  const dayLetters = ["D","L","M","M","J","V","S"]; // Domingo..Sábado
  const cols = items.map((x)=>{
    const h = toPx(x.minutes);
    const hrs = (x.minutes/60);
    const label = x.minutes ? `${hrs.toFixed(1)}h` : "0h";
    const d = new Date(x.date + "T00:00:00");
    const ch = dayLetters[d.getDay()] || "·";
    return `
      <div class="sleepCol" title="${escapeHtml(x.date)} • ${escapeHtml(label)}">
        <div class="sleepBar" style="--h:${h}px"></div>
        <div class="sleepLbl">${escapeHtml(ch)}</div>
      </div>
    `;
  }).join("");

  const avgH = (series.avgMinutes || 0) / 60;
  const lastH = (series.lastMinutes || 0) / 60;

  return `
    <div class="sleepMetaRow">
      <div>
        <div class="big">${escapeHtml(lastH ? lastH.toFixed(1) : "0.0")}h</div>
        <div class="small">Última noche · Prom ${escapeHtml(avgH.toFixed(1))}h</div>
      </div>
      <div class="chip">${avgH >= 7 ? "✅" : (avgH >= 6 ? "⚠️" : "🔥")}</div>
    </div>
    <div class="sleepChart" aria-hidden="true">${cols}</div>
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
  const getMoodMini = (iso)=>{
    const e = moodMap[String(iso||"")];
    if(!e || !e.spriteId) return "";
    const sp = getMoodSpriteById(e.spriteId);
    if(!sp) return "";
    return `<img class="dayMoodMini" src="${escapeHtml(sp.src)}" alt="mood" />`;
  };

  const todayIso = isoDate(now);
  const todayMoodEntry = moodMap[todayIso];
  const todayMood = todayMoodEntry ? getMoodSpriteById(todayMoodEntry.spriteId) : null;
  const moodPillInner = todayMood
    ? `<img class="moodPillImg" src="${escapeHtml(todayMood.src)}" alt="Mood" />`
    : `<div class="moodPillPlus">＋</div>`;

  const weekHtml = days.map(x=>`
    <div class="dayPill ${x.isToday ? "today":""}" data-day="${x.iso}">
      <div class="dayNum">${formatDayNum(x.d)}</div>
      <div class="dayAbbr">${dayAbbrEs(x.d.getDay())}</div>
      ${getMoodMini(x.iso)}
    </div>
  `).join("") + `
    <div class="dayPill moodPill" id="homeMoodPill" data-mood-day="${todayIso}">
      ${moodPillInner}
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
      <section class="card homeCard" id="homeSleepCard">
        <div class="cardTop">
          <div>
            <h2 class="cardTitle">Sueño</h2>
            <div class="small">7 días</div>
          </div>
          <button class="iconBtn" id="btnAddSleep" aria-label="Add sleep">＋</button>
        </div>
        <div class="hr"></div>
        ${sleepBars}
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

      ${renderNeuroClawCard()}
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
    <div class="budgetRow">
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

function openSleepModal(opts = {}){
  const host = document.querySelector("#app");
  const modal = document.createElement("div");
  modal.className = "modalBackdrop";

  const editId = opts && opts.editId ? String(opts.editId) : "";
  const existingRaw = editId ? (state.sleepLog || []).find(x=>String(x.id||"")===editId) : null;
  const existing = normalizeSleepEntry(existingRaw);

  const today = existing?.date || isoDate(new Date());
  const defaultMode = existing?.mode === "advanced" ? "advanced" : "simple";
  const defaultHours = existing ? (existing.totalMinutes / 60).toFixed(2).replace(/\.00$/,"") : "";
  const defaultQuality = existing?.quality ? String(existing.quality) : "";
  const defaultStart = existing?.start || "";
  const defaultEnd = existing?.end || "";
  const defaultNote = existing?.note || "";

  modal.innerHTML = `
    <div class="modal" role="dialog" aria-label="Registrar sueño">
      <div class="modalTop">
        <div>
          <div class="modalTitle">${existing ? "Editar sueño" : "Registrar sueño"}</div>
          <div class="modalSub">Simple o avanzado. Guardado local + sync cuando cierre.</div>
        </div>
        <button class="iconBtn" data-close aria-label="Close">✕</button>
      </div>

      <div class="sleepTabs">
        <button class="sleepTab ${defaultMode === "simple" ? "active" : ""}" data-mode="simple">Simple</button>
        <button class="sleepTab ${defaultMode === "advanced" ? "active" : ""}" data-mode="advanced">Avanzado</button>
      </div>

      <div class="field">
        <label>Fecha</label>
        <input id="sleepDate" type="date" value="${today}">
      </div>

      <div id="sleepSimple" style="display:${defaultMode==="simple" ? "" : "none"};">
        <div class="sleepFormRow">
          <div class="field">
            <label>Horas (ej: 7.5)</label>
            <input id="sleepHours" type="number" inputmode="decimal" step="0.25" min="0" max="24" placeholder="7.5" value="${escapeHtml(defaultHours)}">
          </div>
          <div class="field">
            <label>Calidad (1-5)</label>
            <select id="sleepQuality">
              <option value="">-</option>
              <option value="1" ${defaultQuality==="1"?"selected":""}>1</option>
              <option value="2" ${defaultQuality==="2"?"selected":""}>2</option>
              <option value="3" ${defaultQuality==="3"?"selected":""}>3</option>
              <option value="4" ${defaultQuality==="4"?"selected":""}>4</option>
              <option value="5" ${defaultQuality==="5"?"selected":""}>5</option>
            </select>
          </div>
        </div>
      </div>

      <div id="sleepAdvanced" style="display:${defaultMode==="advanced" ? "" : "none"};">
        <div class="sleepFormRow">
          <div class="field">
            <label>Inicio</label>
            <input id="sleepStart" type="time" value="${escapeHtml(defaultStart)}">
          </div>
          <div class="field">
            <label>Fin</label>
            <input id="sleepEnd" type="time" value="${escapeHtml(defaultEnd)}">
          </div>
          <div class="field">
            <label>Calidad (1-5)</label>
            <select id="sleepQuality2">
              <option value="">-</option>
              <option value="1" ${defaultQuality==="1"?"selected":""}>1</option>
              <option value="2" ${defaultQuality==="2"?"selected":""}>2</option>
              <option value="3" ${defaultQuality==="3"?"selected":""}>3</option>
              <option value="4" ${defaultQuality==="4"?"selected":""}>4</option>
              <option value="5" ${defaultQuality==="5"?"selected":""}>5</option>
            </select>
          </div>
        </div>
        <div class="muted" style="margin-top:6px;">Tip: si el fin es menor que el inicio, asumimos que fue al día siguiente.</div>
      </div>

      <div class="field">
        <label>Nota (opcional)</label>
        <textarea id="sleepNote" rows="2" placeholder="Ej: café tarde, sueño ligero, etc.">${escapeHtml(defaultNote)}</textarea>
      </div>

      <div class="row" style="justify-content:flex-end;margin-top:12px;">
        <button class="btn" data-close>Cancel</button>
        <button class="btn primary" id="btnSaveSleep">${existing ? "Guardar cambios" : "Guardar"}</button>
      </div>
    </div>
  `;

  const close = () => {
    animateSleepModalOut(modal, ()=>modal.remove());
  };

  modal.addEventListener("click", (e)=>{
    if (e.target === modal) close();
    if (e.target && e.target.closest("[data-close]")) close();
  });

  // Tabs
  let mode = defaultMode;
  const tabs = modal.querySelectorAll(".sleepTab");
  const simpleEl = modal.querySelector("#sleepSimple");
  const advEl = modal.querySelector("#sleepAdvanced");

  tabs.forEach(t=>{
    t.addEventListener("click", ()=>{
      tabs.forEach(x=>x.classList.remove("active"));
      t.classList.add("active");
      mode = t.getAttribute("data-mode") || "simple";
      simpleEl.style.display = (mode==="simple") ? "" : "none";
      advEl.style.display = (mode==="advanced") ? "" : "none";
    });
  });

  const calcMinutesAdvanced = (dateStr, startStr, endStr) => {
    if(!dateStr || !startStr || !endStr) return 0;
    const [sh, sm] = startStr.split(":").map(Number);
    const [eh, em] = endStr.split(":").map(Number);
    if([sh,sm,eh,em].some(n=>Number.isNaN(n))) return 0;

    const start = new Date(dateStr + "T00:00:00");
    start.setHours(sh, sm, 0, 0);

    const end = new Date(dateStr + "T00:00:00");
    end.setHours(eh, em, 0, 0);

    if(end <= start) end.setDate(end.getDate()+1); // cross midnight
    return Math.round((end - start) / 60000);
  };

  modal.querySelector("#btnSaveSleep")?.addEventListener("click", ()=>{
    const date = (modal.querySelector("#sleepDate").value || "").trim();
    const note = String(modal.querySelector("#sleepNote").value || "").trim();

    let totalMinutes = 0;
    let quality = null;
    let start = "";
    let end = "";

    if(mode === "simple"){
      const hrs = Number(modal.querySelector("#sleepHours").value || 0);
      if(Number.isFinite(hrs) && hrs > 0) totalMinutes = Math.round(hrs * 60);
      const qv = (modal.querySelector("#sleepQuality").value || "").trim();
      quality = qv ? Number(qv) : null;
    } else {
      start = (modal.querySelector("#sleepStart").value || "").trim();
      end = (modal.querySelector("#sleepEnd").value || "").trim();
      totalMinutes = calcMinutesAdvanced(date, start, end);
      const qv = (modal.querySelector("#sleepQuality2").value || "").trim();
      quality = qv ? Number(qv) : null;
    }

    if(!date){
      toast("Elige una fecha 📅");
      return;
    }
    if(!totalMinutes || totalMinutes <= 0){
      toast(mode==="simple" ? "Pon horas válidas 🕒" : "Pon inicio y fin válidos ⏱");
      return;
    }
    if(totalMinutes > 24*60){
      toast("Eso es más de 24h 😅 Revisa");
      return;
    }

    const entry = {
      id: existing?.id || uid(),
      ts: new Date().toISOString(),
      date,
      totalMinutes,
      quality,
      note,
      mode,
      start,
      end
    };

    state.sleepLog = Array.isArray(state.sleepLog) ? state.sleepLog : [];
    if(existing){
      const idx = state.sleepLog.findIndex(x=>String(x.id||"") === existing.id);
      if(idx >= 0) state.sleepLog[idx] = entry;
      else state.sleepLog.push(entry);
    }else{
      state.sleepLog.push(entry);
    }
    // keep it sane
    if(state.sleepLog.length > 1500) state.sleepLog = state.sleepLog.slice(-1500);

    persist();
    view();
    if(typeof opts.onSaved === "function") opts.onSaved(entry);
    toast(existing ? "Sueño actualizado ✅" : "Sueño guardado ✅");
    close();
  });

  host.appendChild(modal);
  animateSleepModalIn(modal);
}

function openSleepHistoryModal(){
  const host = document.querySelector("#app");
  const backdrop = document.createElement("div");
  backdrop.className = "modalBackdrop";
  backdrop.innerHTML = `
    <div class="modal sleepHistoryModal" role="dialog" aria-label="Histórico de sueño">
      <div class="modalTop">
        <div>
          <div class="modalTitle">Histórico de sueño</div>
          <div class="modalSub">Visualiza, busca, edita y exporta tus noches.</div>
        </div>
        <div class="sleepHistoryTopActions">
          <button class="iconBtn" id="btnSleepCsv" aria-label="Exportar CSV">CSV</button>
          <button class="iconBtn" id="btnSleepAdd" aria-label="Agregar">＋</button>
          <button class="iconBtn" data-close aria-label="Cerrar">✕</button>
        </div>
      </div>
      <div id="sleepHistoryContent"></div>
    </div>
  `;

  host.appendChild(backdrop);
  animateSleepModalIn(backdrop);

  const close = ()=> animateSleepModalOut(backdrop, ()=>backdrop.remove());
  backdrop.addEventListener("click", (e)=>{
    if(e.target === backdrop) close();
    if(e.target && e.target.closest("[data-close]")) close();
  });

  const stateView = { range: "30", metric: "hours", query: "" };
  const content = backdrop.querySelector("#sleepHistoryContent");

  const getLog = ()=> (state.sleepLog || [])
    .map(normalizeSleepEntry)
    .filter(Boolean)
    .sort((a,b)=> (a.date === b.date ? (b.ts || "").localeCompare(a.ts || "") : b.date.localeCompare(a.date)));

  const serializeCsv = (rows)=>{
    const esc = (v)=>`"${String(v ?? "").replaceAll('"','""')}"`;
    const head = ["fecha","horas","minutos","calidad","modo","inicio","fin","nota"];
    const body = rows.map(r=>[
      r.date,
      (r.totalMinutes/60).toFixed(2),
      r.totalMinutes,
      r.quality ?? "",
      r.mode,
      r.start || "",
      r.end || "",
      r.note || ""
    ]);
    return [head, ...body].map(row=>row.map(esc).join(",")).join("\n");
  };

  const downloadCsv = (rows)=>{
    if(!rows.length){
      toast("No hay registros para exportar 📭");
      return;
    }
    const csv = serializeCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sleep-history-${isoDate(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("CSV exportado ✅");
  };

  const render = ()=>{
    const full = getLog();
    const q = stateView.query.trim().toLowerCase();
    const filteredBySearch = q
      ? full.filter(x=>x.date.toLowerCase().includes(q) || (x.note || "").toLowerCase().includes(q))
      : full;

    const ranged = stateView.range === "all" ? filteredBySearch : filteredBySearch.filter(x=>{
      const d = parseIsoDate(x.date);
      if(!d) return false;
      const now = new Date();
      now.setHours(0,0,0,0);
      const days = Number(stateView.range) || 30;
      const from = new Date(now);
      from.setDate(from.getDate() - (days - 1));
      return d >= from && d <= now;
    });

    const yesterday = getYesterdayIso();
    const upToYesterday = full.filter(x=>x.date <= yesterday);
    const yesterdayEntry = upToYesterday.find(x=>x.date === yesterday) || null;
    const best = upToYesterday.reduce((acc, x)=> (!acc || x.totalMinutes > acc.totalMinutes) ? x : acc, null);
    const shortest = upToYesterday.reduce((acc, x)=> (!acc || x.totalMinutes < acc.totalMinutes) ? x : acc, null);
    const uniqueSet = new Set(upToYesterday.map(x=>x.date));
    let streak = 0;
    const cursor = parseIsoDate(yesterday);
    while(cursor){
      const ds = isoDate(cursor);
      if(!uniqueSet.has(ds)) break;
      streak += 1;
      cursor.setDate(cursor.getDate()-1);
    }

    const recentAsc = [...ranged].sort((a,b)=>a.date.localeCompare(b.date));
    const points = recentAsc.map(x=> stateView.metric === "quality" ? Number(x.quality || 0) : (x.totalMinutes / 60));
    const maxVal = stateView.metric === "quality" ? 5 : Math.max(8, ...points, 1);
    const minVal = stateView.metric === "quality" ? 0 : 0;
    const chartW = 460;
    const chartH = 160;
    const px = (idx, len)=> len <= 1 ? 18 : Math.round(18 + ((chartW - 36) * idx / (len - 1)));
    const py = (v)=> {
      const ratio = (v - minVal) / Math.max(0.0001, (maxVal - minVal));
      return Math.round(chartH - 18 - ratio * (chartH - 36));
    };

    const chartPoints = recentAsc.map((r,idx)=>({
      x: px(idx, recentAsc.length),
      y: py(points[idx] || 0),
      label: r.date,
      v: points[idx] || 0
    }));
    let dPath = "";
    if(chartPoints.length){
      dPath = `M ${chartPoints[0].x} ${chartPoints[0].y}`;
      for(let i=1;i<chartPoints.length;i++){
        const p0 = chartPoints[i-1];
        const p1 = chartPoints[i];
        const cx = Math.round((p0.x + p1.x)/2);
        dPath += ` Q ${cx} ${p0.y}, ${p1.x} ${p1.y}`;
      }
    }

    const chips = [
      { label: "Última noche", value: yesterdayEntry ? formatSleepDuration(yesterdayEntry.totalMinutes) : "—" },
      { label: "Racha", value: `${streak} noches` },
      { label: "Mejor", value: best ? formatSleepDuration(best.totalMinutes) : "—" },
      { label: "Más corta", value: shortest ? formatSleepDuration(shortest.totalMinutes) : "—" }
    ];

    const rows = ranged.map(x=>`
      <div class="sleepHistoryRow">
        <div class="sleepHistoryRowMain">
          <div class="sleepHistoryDate">${escapeHtml(x.date)}</div>
          <div class="sleepHistoryMeta">${escapeHtml(formatSleepDuration(x.totalMinutes))}${x.quality ? ` · Calidad ${escapeHtml(x.quality)}/5` : ""}</div>
          ${(x.note || "").trim() ? `<div class="sleepHistoryNote">${escapeHtml(x.note)}</div>` : ""}
        </div>
        <div class="sleepHistoryRowActions">
          <button class="iconBtn" data-edit-sleep="${escapeHtml(x.id)}" aria-label="Editar">✎</button>
          <button class="iconBtn" data-del-sleep="${escapeHtml(x.id)}" aria-label="Eliminar">🗑</button>
        </div>
      </div>
    `).join("");

    content.innerHTML = `
      <div class="sleepStatsChips">
        ${chips.map(ch=>`<div class="sleepStatChip"><span>${escapeHtml(ch.label)}</span><strong>${escapeHtml(ch.value)}</strong></div>`).join("")}
      </div>

      <div class="sleepHistoryControls">
        <div class="sleepControlGroup" data-group="range">
          ${[["7","7D"],["30","30D"],["90","90D"],["all","Todo"]].map(([v,t])=>`<button class="sleepPill ${stateView.range===v?"active":""}" data-range="${v}">${t}</button>`).join("")}
        </div>
        <div class="sleepControlGroup" data-group="metric">
          ${[["hours","Horas"],["quality","Calidad"]].map(([v,t])=>`<button class="sleepPill ${stateView.metric===v?"active":""}" data-metric="${v}">${t}</button>`).join("")}
        </div>
      </div>

      <div class="sleepCurveWrap">
        <svg viewBox="0 0 ${chartW} ${chartH}" class="sleepCurveSvg" aria-label="Gráfico de sueño">
          <line x1="14" y1="${chartH-18}" x2="${chartW-14}" y2="${chartH-18}" class="sleepAxis" />
          ${dPath ? `<path d="${dPath}" class="sleepCurvePath" />` : ""}
          ${chartPoints.map(pt=>`<circle cx="${pt.x}" cy="${pt.y}" r="4" class="sleepCurveDot"><title>${escapeHtml(pt.label)} · ${escapeHtml(pt.v.toFixed(stateView.metric==="quality"?0:1))}${stateView.metric==="quality"?"/5":"h"}</title></circle>`).join("")}
        </svg>
      </div>

      <div class="field" style="margin-top:10px;">
        <label>Buscar</label>
        <input id="sleepHistorySearch" class="input" placeholder="Busca por fecha o nota..." value="${escapeHtml(stateView.query)}" />
      </div>

      <div class="sleepHistoryList">
        ${rows || `<div class="muted" style="padding:8px 2px;">Sin registros para este filtro.</div>`}
      </div>
    `;

    content.querySelectorAll("[data-range]").forEach(btn=>btn.addEventListener("click", ()=>{ stateView.range = btn.getAttribute("data-range") || "30"; render(); }));
    content.querySelectorAll("[data-metric]").forEach(btn=>btn.addEventListener("click", ()=>{ stateView.metric = btn.getAttribute("data-metric") || "hours"; render(); }));
    content.querySelector("#sleepHistorySearch")?.addEventListener("input", (e)=>{ stateView.query = e.target.value || ""; render(); });

    content.querySelectorAll("[data-edit-sleep]").forEach(btn=>btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-edit-sleep") || "";
      openSleepModal({ editId: id, onSaved: ()=>render() });
    }));

    content.querySelectorAll("[data-del-sleep]").forEach(btn=>btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-del-sleep") || "";
      const next = (state.sleepLog || []).filter(x=>String(x.id||"") !== id);
      if(next.length === (state.sleepLog || []).length) return;
      state.sleepLog = next;
      persist();
      view();
      toast("Registro eliminado 🗑");
      render();
    }));
  };

  backdrop.querySelector("#btnSleepCsv")?.addEventListener("click", ()=> downloadCsv(getLog()));
  backdrop.querySelector("#btnSleepAdd")?.addEventListener("click", ()=> openSleepModal({ onSaved: ()=>render() }));

  render();
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
  const btnAdd = root.querySelector("#btnAddMusic");
  if(btnAdd) btnAdd.addEventListener("click", openMusicModal);

  const btnSleep = root.querySelector("#btnAddSleep");
  if(btnSleep) btnSleep.addEventListener("click", openSleepModal);
  const sleepCard = root.querySelector("#homeSleepCard");
  if(sleepCard) sleepCard.addEventListener("click", (e)=>{ if(e.target && e.target.closest("#btnAddSleep")) return; openSleepHistoryModal(); });


  // Mood sprites (daily emotion)
  const moodPill = root.querySelector("#homeMoodPill");
  if(moodPill){
    moodPill.addEventListener("click", (e)=>{
      e.preventDefault();
      const iso = moodPill.getAttribute("data-mood-day") || isoDate(new Date());
      openMoodPickerModal(iso, { onSaved: ()=>{} });
    });
  }

  // Pick mood by tapping a day pill (week strip)
  root.querySelectorAll('.dayPill[data-day]').forEach(p=>{
    p.addEventListener("click", ()=>{
      const iso = p.getAttribute("data-day") || "";
      if(!iso) return;
      openMoodPickerModal(iso, { onSaved: ()=>{} });
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

  const budgetCard = root.querySelector("#homeBudgetCard");
  if(budgetCard) budgetCard.addEventListener("click", (e)=>{ if(e.target && e.target.closest("#btnAddBudgetItem")) return; /* no auto-open, keeps card tappable but safe */ });

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


}

function wireCalendar(root){
  const prev = root.querySelector("#calPrev");
  const next = root.querySelector("#calNext");
  if(prev) prev.addEventListener("click", ()=>{ state.calMonthOffset = (state.calMonthOffset||0) - 1; view(); });
  if(next) next.addEventListener("click", ()=>{ state.calMonthOffset = (state.calMonthOffset||0) + 1; view(); });

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

  return `
    <div class="sectionTitle">
      <div>Listas de compras</div>
      <div class="chip">${state.shopping.length} listas</div>
    </div>

    <div class="row" style="margin-bottom:12px;">
      <button class="btn" onclick="openProductLibrary()">📦 Biblioteca</button>
      <button class="btn" data-act="openInventory">🏠 Inventario</button>
      <button class="btn" data-act="openShoppingDashboard">📊 Dashboard</button>
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
    btn.addEventListener("click", ()=>{
      const act = btn.dataset.act;

      // Shopping dashboard navigation
// Inventory tabs
if(act==="invTab"){
  state.inventorySubtab = (btn.dataset.tab === "history") ? "history" : "stock";
  view();
  return;
}
if(act==="invHistPreset"){
  state.inventoryHistPreset = btn.dataset.preset || "30d";
  state.inventorySubtab = "history";
  view();
  return;
}

      if(act==="openShoppingDashboard"){
        state.shoppingSubtab = "dashboard";
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
  const d = isoDate();
  openPromptModal({
    title:"Guardar compra",
    fields:[
      {key:"date", label:"Fecha (YYYY-MM-DD)", value:d},
      {key:"store", label:"Tienda", value:""},
      {key:"notes", label:"Notas", value:""}
    ],
    onSubmit: ({date, store, notes})=>{
      const safeDate = (date||"").trim() || d;
      const sourceListId = `L-${Date.now()}`;
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

      // Stack to inventory (qty increases or new items created)
      applyItemsToInventory_(items);

      // Optional: mark current list as bought to reflect it was committed
      (list.items||[]).forEach(it=>{ it.bought = true; });

      persist();
      toast("Compra guardada ✅");
      state.shoppingSubtab = "dashboard";
      view();
    }
  });
  return;
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
    localStorage.setItem("mc_sheet_open", state.sheetOpen ? "1":"0");

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
state.products = load(LS.products, []);
state.shoppingHistory = load(LS.shoppingHistory, []);
state.inventory = load(LS.inventory, []);
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
  modal.className = "modalBackdrop";

  const products = (state.products||[]).slice();

  modal.innerHTML = `
    <div class="modal">
      <h2>Agregar item</h2>

      <div class="row" style="gap:8px; margin-bottom:10px;">
        <input id="smartItemSearch" class="inp" style="flex:1; min-width:160px;" placeholder="Escribe para buscar… (ej: arroz)" />
        <button class="btn ghost" id="smartItemClose">Cerrar</button>
      </div>

      <div class="small" style="opacity:0.8; margin-bottom:8px;">
        Tip: escribe 2-3 letras y toca una sugerencia. Si el producto es por kg, te pedirá gramos.
      </div>

      <div id="smartItemResults" class="list"></div>

      <div class="hr"></div>

      <div class="row" style="margin-top:12px; gap:8px;">
        <button class="btn primary" id="smartItemManual">+ Manual</button>
      </div>
    </div>
  `;

  host.appendChild(modal);

  const search = modal.querySelector("#smartItemSearch");
  const results = modal.querySelector("#smartItemResults");

  function renderResults(q){
    const query = String(q||"").trim().toLowerCase();
    let matches = products;

    if(query){
      matches = products.filter(p=>{
        const n = String(p.name||"").toLowerCase();
        const c = String(p.category||"").toLowerCase();
        return n.includes(query) || c.includes(query);
      });
    }

    matches = matches.slice(0, 10);

    if(matches.length===0){
      results.innerHTML = `<div class="small" style="padding:10px; opacity:0.8;">No encontré nada. Usa Manual 👇</div>`;
      return;
    }

    results.innerHTML = matches.map(p=>{
      const u = (p.unit||"u").toLowerCase();
      const isKg = (u.includes("kg"));
      const priceLabel = isKg ? `${money(p.price)}/kg` : money(p.price);
      return `
        <div class="item">
          <div class="left">
            <div class="name">${escapeHtml(p.name)}</div>
            <div class="meta">${priceLabel}${p.category?` · ${escapeHtml(p.category)}`:""}</div>
          </div>
          <div class="row">
            <button class="btn primary" data-pick="${p.id}">Elegir</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function close(){
    modal.remove();
  }

  // initial
  renderResults("");

  search.addEventListener("input", ()=> renderResults(search.value));
  modal.querySelector("#smartItemClose").addEventListener("click", close);

  results.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-pick]");
    if(!btn) return;
    const pid = btn.dataset.pick;
    const p = products.find(x=>x.id===pid);
    if(!p) return;

    const u = String(p.unit||"u").toLowerCase();
    const isKg = u.includes("kg");

    if(isKg){
      openPromptModal({
        title:`${p.name} (por kg)`,
        fields:[
          {key:"grams", label:"Gramos", type:"number", value:"500"},
        ],
        onSubmit: ({grams})=>{
          const g = Math.max(1, Number(grams||0));
          const price = calcPriceFromKg(p.price, g);
          list.items.push({
            id: uid("i"),
            name: p.name,
            price: Number(price.toFixed(2)),
            qty: 1,
            bought: false,
            productId: p.id,
            category: p.category || "",
            essential: !!p.essential,
            weight_g: g,
            pricePerKg: Number(p.price||0),
            unit: "g"
          });
          persist(); view(); close();
        }
      });
      return;
    }

    // Unit product
    openPromptModal({
      title:`${p.name}`,
      fields:[
        {key:"qty", label:"Cantidad", type:"number", value:"1"},
        {key:"price", label:"Precio (por unidad)", type:"number", value:String(p.price||0)}
      ],
      onSubmit: ({qty, price})=>{
        const qn = Math.max(1, Number(qty||1));
        const pr = Number(price||0);
        list.items.push({
          id: uid("i"),
          name: p.name,
          price: pr,
          qty: qn,
          bought: false,
          productId: p.id,
          category: p.category || "",
          essential: !!p.essential
        });
        persist(); view(); close();
      }
    });
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
          list.items.push({
            id: uid("i"),
            name: n,
            price: Number(calc.toFixed(2)),
            qty: 1,
            bought:false,
            weight_g: g,
            pricePerKg: pr,
            unit: "g"
          });
        }else{
          list.items.push({
            id: uid("i"),
            name: n,
            price: pr,
            qty: Math.max(1, Number(qty||1)),
            bought:false
          });
        }
        persist(); view(); close();
      }
    });
  });

  // focus
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
  sheet.className = "modalBackdrop";

  sheet.innerHTML = `
    <div class="modal">
      <h2>Biblioteca</h2>

      <div class="row">
        <button class="btn good" onclick="openNewProduct()">+ Nuevo</button>
      </div>

      <div class="list" style="margin-top:12px;">
        ${state.products.map(p=>{
          const trend = priceTrend(p);
          return `
            <div class="item">
              <div class="left">
                <div class="name">${escapeHtml(p.name)}</div>
                <div class="meta">${money(p.price)} ${p.unit?`· ${escapeHtml(p.unit)}`:""} ${p.category?`· ${escapeHtml(p.category)}`:""}</div>
              </div>
              <div class="row">
                <button class="btn" onclick="openProductChart('${p.id}')">📈</button>
                <button class="btn" onclick="editProductDetails('${p.id}')">✏️</button>
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <div class="row" style="margin-top:12px;">
        <button class="btn ghost" onclick="this.closest('.modalBackdrop').remove()">Cerrar</button>
      </div>
    </div>
  `;
  host.appendChild(sheet);
}

// ====================== INVENTORY (Home stock) ======================

function ensureInventory(){
  if(!Array.isArray(state.inventory)) state.inventory = [];
}

function inventoryFindByProductId(productId){
  if(!productId) return null;
  return (state.inventory||[]).find(x=>x.productId===productId) || null;
}

function addInventoryFromProduct(productId){
  ensureInventory();
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
    notes: ""
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
    ],
    onSubmit: ({name, category, qty, unit, minQty, essential, notes})=>{
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
        notes: (notes||"").trim()
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
  openPromptModal({
    title:"Editar inventario",
    fields:[
      {key:"name", label:"Nombre", value: it.name || ""},
      {key:"category", label:"Categoría", value: it.category || ""},
      {key:"qty", label:"Cantidad", type:"number", value: String(it.qty ?? 0)},
      {key:"unit", label:"Unidad", value: it.unit || "u"},
      {key:"minQty", label:"Mínimo", type:"number", value: String(it.minQty ?? 0)},
      {key:"essential", label:"Esencial (1/0)", value: it.essential ? "1" : "0"},
      {key:"notes", label:"Notas", value: it.notes || ""},
    ],
    onSubmit: ({name, category, qty, unit, minQty, essential, notes})=>{
      const n = (name||"").trim();
      if(!n) return;
      it.name = n;
      it.category = (category||"").trim();
      it.qty = Number(qty||0) || 0;
      it.unit = (unit||"u").trim() || "u";
      it.minQty = Number(minQty||0) || 0;
      it.essential = String(essential||"").trim() !== "0";
      it.notes = (notes||"").trim();
      persist();
      view();
    }
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

function viewInventory(){
  ensureInventory();
  const low = (state.inventory||[]).filter(x=>Number(x.minQty||0)>0 && Number(x.qty||0) <= Number(x.minQty||0)).length;
  const linked = (state.inventory||[]).filter(x=>!!x.productId).length;

  const pickRows = (state.products||[]).map(p=>
    `<button class="btn" onclick="addInventoryFromProduct('${p.id}')">+ ${escapeHtml(p.name)} · ${money(p.price||0)}</button>`
  ).join("") || `<div class="muted">No hay productos en Biblioteca.</div>`;

  return `
    <div class="sectionTitle">
      <div>Inventario</div>
      <button class="btn" data-act="backToShoppingLists">← Volver</button>
    </div>

    <div class="row" style="gap:8px; margin:0 0 12px;">
      <button class="btn ${state.inventorySubtab!=="history"?"primary":""}" data-act="invTab" data-tab="stock">📦 Stock</button>
      <button class="btn ${state.inventorySubtab==="history"?"primary":""}" data-act="invTab" data-tab="history">🗓️ Histórico</button>
    </div>

    <div class="row" style="margin:0 0 12px;">
      <div class="chip">${(state.inventory||[]).length} items</div>
      <div class="chip">${linked} link</div>
      <div class="chip">${low} bajo</div>
      <button class="btn good" onclick="addInventoryManual()">+ Manual</button>
    </div>

${state.inventorySubtab==="history" ? viewInventoryHistory() : `
  <div class="row" style="margin:0 0 12px;">
    <div class="chip">${(state.inventory||[]).length} items</div>
    <div class="chip">${linked} link</div>
    <div class="chip">${low} bajo</div>
    <button class="btn good" onclick="addInventoryManual()">+ Manual</button>
  </div>

  <section class="card">
    <div class="cardTop">
      <div>
        <h3 class="cardTitle">Agregar desde Biblioteca</h3>
        <div class="small">Conecta inventario con precios</div>
      </div>
    </div>
    <div class="hr"></div>
    <div class="grid">${pickRows}</div>
  </section>

  <section class="card">
    <div class="cardTop">
      <div>
        <h3 class="cardTitle">Tu inventario</h3>
        <div class="small">Marca mínimos para alertas</div>
      </div>
    </div>
    <div class="hr"></div>
    <div class="list">
      ${(state.inventory||[]).map(it=>{
        const isLow = Number(it.minQty||0)>0 && Number(it.qty||0) <= Number(it.minQty||0);
        const badge = isLow ? `<span class="chip" style="border-color:rgba(255,80,80,.35);color:rgba(255,170,170,.95)">Bajo</span>` : ``;
        const link = it.productId ? `🔗` : `📝`;
        return `
          <div class="item">
            <div class="left">
              <div class="name">${link} ${it.essential?"⭐":""} ${escapeHtml(it.name)}</div>
              <div class="meta">${escapeHtml(it.category||"-")} · ${Number(it.qty||0)} ${escapeHtml(it.unit||"u")} · min ${Number(it.minQty||0)} ${badge}</div>
            </div>
            <div class="row">
              <button class="btn" onclick="addInventoryToList('${it.id}')">➕ Lista</button>
              <button class="btn" onclick="editInventoryItem('${it.id}')">Edit</button>
              <button class="btn danger" onclick="deleteInventoryItem('${it.id}')">Del</button>
            </div>
          </div>
        `;
      }).join("") || `<div class="muted">Aún no tienes items.</div>`}
    </div>
  </section>
`}

  `;
}

// Expose inventory functions for inline onclick
window.addInventoryFromProduct = addInventoryFromProduct;
window.addInventoryManual = addInventoryManual;
window.editInventoryItem = editInventoryItem;
window.deleteInventoryItem = deleteInventoryItem;
window.addInventoryToList = addInventoryToList;

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
  new Chart(ctx, {
    type:'line',
    data:{
      labels:labels,
      datasets:[{
        data:prices,
        borderColor:'#7c5cff',
        tension:.3
      }]
    },
    options:{responsive:true, plugins:{legend:{display:false}}}
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
  const map = new Map();
  for(const e of (history||[])){
    if(!e.date) continue;
    if(!inRange(e.date, start, end)) continue;
    const v = Number(e.totals?.total || 0);
    map.set(e.date, (map.get(e.date)||0) + v);
  }
  const dates = [...map.keys()].sort();
  const totals = dates.map(d=>map.get(d));
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
      drawLineChart(canvas, daily.dates, daily.totals);
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