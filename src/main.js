console.log("MemoryCarl loaded");
// ====================== NOTIFICATIONS (Firebase Cloud Messaging) ======================
// 1) Firebase Console -> Project settings -> Cloud Messaging -> Web Push certificates -> Generate key pair
// 2) Paste the VAPID public key below
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("../firebase-messaging-sw.js?v=999")
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
    const swReg = await navigator.serviceWorker.register("../firebase-messaging-sw.js");

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
  reminders: "memorycarl_v2_reminders",
  // Home widgets
  musicToday: "memorycarl_v2_music_today",
  musicLog: "memorycarl_v2_music_log",
  sleepLog: "memorycarl_v2_sleep_log", // reserved (connect later)
  budgetMonthly: "memorycarl_v2_budget_monthly",
  calDraw: "memorycarl_v2_cal_draw",
  house: "memorycarl_v2_house"
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

function markDirty(){
  localStorage.setItem(SYNC.dirtyKey, "1");
}
function clearDirty(){
  localStorage.setItem(SYNC.dirtyKey, "0");
}
function isDirty(){
  return (localStorage.getItem(SYNC.dirtyKey) || "0") === "1";
}

function ensureSyncConfigured(){
  let url = getSyncUrl();
  if (!url){
    url = prompt("Paste your Apps Script Web App URL (ends with /exec). Leave blank to keep local-only:", "");
    if (url) setSyncUrl(url);
  }
  return !!getSyncUrl();
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
function save(key, value){
  localStorage.setItem(key, JSON.stringify(value));
  // Mark dirty only for core data keys (avoid syncing tokens/settings every time)
  if (key === LS.routines || key === LS.shopping || key === LS.reminders || key === LS.musicToday || key === LS.musicLog || key === LS.sleepLog) markDirty();
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

  if(changed) persist();
}

// ---- State ----
let state = {
  tab: "home",
  moreOpen: false,
  sheetOpen: (localStorage.getItem("mc_sheet_open")==="1"),
  routines: load(LS.routines, seedRoutines()),
  shopping: load(LS.shopping, seedShopping()),
  reminders: load(LS.reminders, seedReminders()),
  // Home
  musicToday: load(LS.musicToday, null),
  musicLog: load(LS.musicLog, []),
  sleepLog: load(LS.sleepLog, []),
  budgetMonthly: load(LS.budgetMonthly, []),
  calDraw: load(LS.calDraw, {}),
  house: load(LS.house, seedHouse()),
  calMonthOffset: 0,
  musicCursor: 0,
};

normalizeHouse();

function persist(){
  save(LS.routines, state.routines);
  save(LS.shopping, state.shopping);
  save(LS.reminders, state.reminders);
  save(LS.musicToday, state.musicToday);
  save(LS.musicLog, state.musicLog);
  save(LS.sleepLog, state.sleepLog);
  save(LS.budgetMonthly, state.budgetMonthly);
  save(LS.calDraw, state.calDraw);
  save(LS.house, state.house);
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
    house: state.house
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
          ${mk("settings","⚙️","Ajustes","Backup, sync, etc")}
        </div>
      </div>
    </div>
  `;
}

function view(){
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

      ${bottomNav()}

      ${state.moreOpen ? renderMoreModal() : ""}
    </div>
  `;

  
  // Bottom sheet (Settings)
  if(state.tab==="settings"){
    initBottomSheet();
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

  wireActions(root);
  if(state.tab==="home") wireHome(root);
  if(state.tab==="house") wireHouse(root);
	  if(state.tab==="calendar") wireCalendar(root);
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
  `;
}

function viewLearn(){
  return `
    <div class="sectionTitle">
      <div>Aprender</div>
      <div class="chip">quiz + glosario</div>
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
  const maxMinutes = Math.max(60, ...items.map(x=>x.minutes), 8*60);
  const avgMinutes = items.reduce((s,x)=>s+x.minutes,0) / items.length;
  const last = items[items.length-1]?.minutes || 0;
  return { items, maxMinutes, avgMinutes, lastMinutes: last };
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

  const weekHtml = days.map(x=>`
    <div class="dayPill ${x.isToday ? "today":""}" data-day="${x.iso}">
      <div class="dayNum">${formatDayNum(x.d)}</div>
      <div class="dayAbbr">${dayAbbrEs(x.d.getDay())}</div>
    </div>
  `).join("");


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

function openSleepModal(){
  const host = document.querySelector("#app");
  const modal = document.createElement("div");
  modal.className = "modalBackdrop";

  const today = isoDate(new Date());

  modal.innerHTML = `
    <div class="modal" role="dialog" aria-label="Registrar sueño">
      <div class="modalTop">
        <div>
          <div class="modalTitle">Registrar sueño</div>
          <div class="modalSub">Simple o avanzado. Guardado local + sync cuando cierre.</div>
        </div>
        <button class="iconBtn" data-close aria-label="Close">✕</button>
      </div>

      <div class="sleepTabs">
        <button class="sleepTab active" data-mode="simple">Simple</button>
        <button class="sleepTab" data-mode="advanced">Avanzado</button>
      </div>

      <div class="field">
        <label>Fecha</label>
        <input id="sleepDate" type="date" value="${today}">
      </div>

      <div id="sleepSimple">
        <div class="sleepFormRow">
          <div class="field">
            <label>Horas (ej: 7.5)</label>
            <input id="sleepHours" type="number" inputmode="decimal" step="0.25" min="0" max="24" placeholder="7.5">
          </div>
          <div class="field">
            <label>Calidad (1-5)</label>
            <select id="sleepQuality">
              <option value="">-</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
          </div>
        </div>
      </div>

      <div id="sleepAdvanced" style="display:none;">
        <div class="sleepFormRow">
          <div class="field">
            <label>Inicio</label>
            <input id="sleepStart" type="time">
          </div>
          <div class="field">
            <label>Fin</label>
            <input id="sleepEnd" type="time">
          </div>
          <div class="field">
            <label>Calidad (1-5)</label>
            <select id="sleepQuality2">
              <option value="">-</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
          </div>
        </div>
        <div class="muted" style="margin-top:6px;">Tip: si el fin es menor que el inicio, asumimos que fue al día siguiente.</div>
      </div>

      <div class="field">
        <label>Nota (opcional)</label>
        <textarea id="sleepNote" rows="2" placeholder="Ej: café tarde, sueño ligero, etc."></textarea>
      </div>

      <div class="row" style="justify-content:flex-end;margin-top:12px;">
        <button class="btn" data-close>Cancel</button>
        <button class="btn primary" id="btnSaveSleep">Guardar</button>
      </div>
    </div>
  `;

  const close = () => modal.remove();

  modal.addEventListener("click", (e)=>{
    if (e.target === modal) close();
    if (e.target && e.target.closest("[data-close]")) close();
  });

  // Tabs
  let mode = "simple";
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

    const minutes = Math.round((end - start) / 60000);
    return minutes;
  };

  modal.querySelector("#btnSaveSleep").addEventListener("click", ()=>{
    const date = (modal.querySelector("#sleepDate").value || "").trim();
    const note = (modal.querySelector("#sleepNote").value || "").trim();

    let totalMinutes = 0;
    let quality = null;
    let start = "", end = "";

    if(mode === "simple"){
      const hrs = Number((modal.querySelector("#sleepHours").value || "").trim());
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
      id: uid(),
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
    state.sleepLog.push(entry);
    // keep it sane
    if(state.sleepLog.length > 1500) state.sleepLog = state.sleepLog.slice(-1500);

    persist();
    view();
    toast("Sueño guardado ✅");
    close();
  });

  host.appendChild(modal);
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
  if(sleepCard) sleepCard.addEventListener("click", (e)=>{ if(e.target && e.target.closest("#btnAddSleep")) return; openSleepModal(); });

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

  return `
    <div class="sectionTitle">
      <div>Listas de compras</div>
      <div class="chip">${state.shopping.length} listas</div>
    </div>

    <div class="row" style="margin-bottom:12px;">
      <button class="btn" onclick="openProductLibrary()">📦 Biblioteca</button>
      <button class="btn" data-act="openShoppingDashboard">📊 Dashboard</button>
      <div class="chip">hist: ${histCount}</div>
    </div>

    ${state.shopping.map(l => shoppingCard(l)).join("")}
  `;
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
              <div class="meta">${money(it.price)} × ${Number(it.qty||1)} = <b>${money(Number(it.price||0)*Number(it.qty||1))}</b></div>
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

function openHouseTaskModal(editId=null){
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
  zoneSel.value = t?.zoneId || "";
  typeSel.value = t?.type || (t?.zoneId ? "surface" : "global");
  lvlSel.value = t?.level || ((t?.type||"")==="deep" ? "deep" : "light");
  b.querySelector("#htPri").value = String(t?.priority ?? 3);

  b.querySelector('[data-m="cancel"]').addEventListener("click", close);
  b.querySelector('[data-m="save"]').addEventListener("click", ()=>{
    const name = (b.querySelector("#htName").value||"").trim();
    const zoneId = (zoneSel.value||"").trim() || null;
    const type = (typeSel.value||"").trim() || "misc";
    const minutes = Number((b.querySelector("#htMin").value||"").trim()) || 0;
    const freqDays = Number((b.querySelector("#htFreq").value||"").trim()) || 0;
    const level = (lvlSel.value||"light").trim() || "light";
    const priority = Math.min(5, Math.max(1, Number((b.querySelector("#htPri").value||"").trim()) || 3));

    if(!name){ toast("Pon un nombre"); return; }
    if(minutes<0 || freqDays<0){ toast("Valores inválidos"); return; }

    // If type=global, force zoneId null
    const finalZoneId = (type==="global") ? null : zoneId;
    const finalLevel = (type==="deep") ? "deep" : level;

    if(t){
      t.name = name; t.zoneId = finalZoneId; t.type = type; t.minutes = minutes; t.freqDays = freqDays;
      t.level = finalLevel; t.priority = priority;
    }else{
      state.house.tasks.push({ id: uid("t"), name, zoneId: finalZoneId, type, minutes, freqDays, level: finalLevel, priority, lastDone:"" });
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
    if(s && s.active) { view(); return; }
    startHouseSession();
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
        view();
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
      if(act==="openShoppingDashboard"){
        state.shoppingSubtab = "dashboard";
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
          if(state.products && state.products.length){
            openProductPicker(lid);
            return;
          }
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
          openPromptModal({
            title:"Edit item",
            fields:[
              {key:"name", label:"Item", value: it.name},
              {key:"price", label:"Price", type:"number", value: String(it.price ?? 0)},
              {key:"qty", label:"Qty", type:"number", value: String(it.qty ?? 1)},
            ],
            onSubmit: ({name, price, qty})=>{
              if(!name.trim()) return;
              it.name = name.trim();
              it.price = Number(price || 0);
              it.qty = Math.max(1, Number(qty || 1));
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
      const items = (list.items||[]).map(it=>({
        id: uid("i"),
        name: it.name,
        price: Number(it.price||0),
        qty: Math.max(1, Number(it.qty||1)),
        category: (it.category||"").trim(),
      }));
      const totals = calcEntryTotals(items);
      state.shoppingHistory.unshift({
        id: uid("sh"),
        date: safeDate,
        store: (store||"").trim(),
        notes: (notes||"").trim(),
        items,
        totals
      });
      persist();
      toast("Compra guardada ✅");
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
*/


/* ====================== REBUILT SHOPPING MODULE ====================== */

LS.products = "memorycarl_v2_products";
LS.shoppingHistory = "memorycarl_v2_shopping_history";
state.products = load(LS.products, []);
state.shoppingHistory = load(LS.shoppingHistory, []);
state.shoppingSubtab = state.shoppingSubtab || "lists";
state.shoppingDashPreset = state.shoppingDashPreset || "7d";

const _persistBase = persist;
persist = function(){
  _persistBase();
  save(LS.products, state.products);
  save(LS.shoppingHistory, state.shoppingHistory);
};

function priceTrend(product){
  if(!product.history || product.history.length === 0) return null;
  const first = product.history[0].price;
  const last = product.price;
  const diff = last - first;
  const percent = first ? ((diff/first)*100).toFixed(1) : 0;
  return { diff, percent };
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

  list.items.push({
    id: uid("i"),
    name: product.name,
    price: Number(product.price || 0),
    qty: 1,
    bought: false
  });

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
                <div class="meta">${money(p.price)}</div>
              </div>
              <div class="row">
                <button class="btn" onclick="openProductChart('${p.id}')">📈</button>
                <button class="btn" onclick="editProductPrice('${p.id}')">Edit</button>
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

function openNewProduct(){
  openPromptModal({
    title:"Nuevo producto",
    fields:[
      {key:"name", label:"Nombre"},
      {key:"price", label:"Precio", type:"number"},
      {key:"store", label:"Tienda"}
    ],
    onSubmit: ({name, price, store})=>{
      state.products.unshift({
        id: uid("p"),
        name:name,
        price:Number(price||0),
        store:store,
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
  const map = new Map(); // name-> {name, count, spend}
  for(const e of (history||[])){
    if(!e.date) continue;
    if(!inRange(e.date, start, end)) continue;
    for(const it of (e.items||[])){
      const name = (it.name||"").trim();
      if(!name) continue;
      const key = name.toLowerCase();
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

function viewShoppingDashboard(){
  const preset = state.shoppingDashPreset || "7d";
  const range = presetRange(preset);
  const daily = dailySeries(state.shoppingHistory||[], range.start, range.end);
  const sum = summarize(daily.dates, daily.totals);
  const cats = aggregateCategories(state.shoppingHistory||[], range.start, range.end);
  const stores = topStores(state.shoppingHistory||[], range.start, range.end, 3);
  const products = topProducts(state.shoppingHistory||[], range.start, range.end, 5);

  const catRows = Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>{
    const pct = sum.sum ? (v/sum.sum*100) : 0;
    return `<div class="kv"><div class="k">${escapeHtml(c)}</div><div class="v"><b>${money(v)}</b> · ${pct.toFixed(0)}%</div></div>`;
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
