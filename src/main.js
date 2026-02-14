console.log("MemoryCarl loaded");
// ====================== NOTIFICATIONS (Firebase Cloud Messaging) ======================
// 1) Firebase Console -> Project settings -> Cloud Messaging -> Web Push certificates -> Generate key pair
// 2) Paste the VAPID public key below
await navigator.serviceWorker.register("./firebase-messaging-sw.js?v=999");

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
  reminders: "memorycarl_v2_reminders",
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
      }
    };

    const url = getSyncUrl();
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });

    let ok = false;
    if (navigator.sendBeacon) ok = navigator.sendBeacon(url, blob);

    if (!ok){
      fetch(url, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        mode: "no-cors"
      }).catch(()=>{});
    }

    // Best-effort: we don't get a response with beacon/no-cors.
    clearDirty();
    localStorage.setItem(SYNC.lastSyncKey, new Date().toISOString());
  }catch(e){
    // Don't block closing the app.
    console.warn("Sync flush failed:", e);
  }
}

// Flush when tab/app is being closed or backgrounded
window.addEventListener("beforeunload", ()=>flushSync("beforeunload"));
document.addEventListener("visibilitychange", ()=>{ if (document.visibilityState === "hidden") flushSync("hidden"); });



// ---- Helpers ----
function uid(prefix="id"){ return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`; }

function load(key, fallback){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch{ return fallback; }
}
function save(key, value){
  localStorage.setItem(key, JSON.stringify(value));
  // Mark dirty only for core data keys (avoid syncing tokens/settings every time)
  if (key === LS.routines || key === LS.shopping || key === LS.reminders) markDirty();
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

// ---- State ----
let state = {
  tab: "routines",
  sheetOpen: (localStorage.getItem("mc_sheet_open")==="1"),
  routines: load(LS.routines, seedRoutines()),
  shopping: load(LS.shopping, seedShopping()),
  reminders: load(LS.reminders, seedReminders()),
};

function persist(){
  save(LS.routines, state.routines);
  save(LS.shopping, state.shopping);
  save(LS.reminders, state.reminders);
}

// ---- Backup (Export/Import) ----
function exportBackup(){
  const payload = {
    v: 2,
    exportedAt: new Date().toISOString(),
    routines: state.routines,
    shopping: state.shopping,
    reminders: state.reminders
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

  return `
    <nav class="bottomNav" role="navigation" aria-label="MemoryCarl navigation">
      ${mk("routines","📝","Rutinas")}
      ${mk("shopping","🛒","Compras")}
      ${mk("reminders","⏰","Reminders")}
      ${mk("learn","🧠","Aprender")}
      ${mk("settings","⚙️","Ajustes")}
    </nav>
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
        ${state.tab==="routines" ? viewRoutines() : ""}
        ${state.tab==="shopping" ? viewShopping() : ""}
        ${state.tab==="reminders" ? viewReminders() : ""}
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

        <div class="muted" style="margin-top:8px;">Backup local (JSON). Útil antes de limpiar cache o cambiar de teléfono.</div>
      </div>

      <div class="fab" id="fab">+</div>
      <div id="toastHost"></div>

      ${bottomNav()}
    </div>
  `;

  
  // Bottom sheet (Settings)
  if(state.tab==="settings"){
    initBottomSheet();
  }
// Bottom nav wiring
  root.querySelectorAll(".bn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      state.tab = btn.dataset.tab;
      view();
    });
  });

  // FAB action per tab (disabled on Learn)
  const fab = root.querySelector("#fab");
  fab.style.display = (state.tab==="learn" || state.tab==="settings") ? "none" : "flex";
  fab.addEventListener("click", ()=>{
    if(state.tab==="routines") openRoutineModal();
    if(state.tab==="shopping") openShoppingModal();
    if(state.tab==="reminders") openReminderModal();
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
