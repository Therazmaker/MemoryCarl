console.log("MemoryCarl loaded");

// ---- Firebase Messaging (client) ----
firebase.initializeApp({
  apiKey: "AIzaSyAq9RTNQDnfyxcxn4MbDn61lc7ybkUjtKg",
  authDomain: "memorycarl-3c297.firebaseapp.com",
  projectId: "memorycarl-3c297",
  storageBucket: "memorycarl-3c297.firebasestorage.app",
  messagingSenderId: "731735548765",
  appId: "1:731735548765:web:03d9cf6d2a8c4744fd7eb4"
});

const messaging = firebase.messaging();

async function enableNotifications(){
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
    alert("Permission denied");
    return;
  }

  const swReg = await navigator.serviceWorker.register("./firebase-messaging-sw.js");

  const vapidKey = "REPLACE_WITH_YOUR_VAPID_KEY";

  try {
    const token = await messaging.getToken({
      vapidKey,
      serviceWorkerRegistration: swReg
    });

    localStorage.setItem("memorycarl_fcm_token", token);
    alert("Notifications enabled ✅");
    console.log("FCM Token:", token);

  } catch (err) {
    console.error("Token error:", err);
    alert("Error enabling notifications");
  }
}


// ---- Storage keys ----
const LS = {
  routines: "memorycarl_v2_routines",
  shopping: "memorycarl_v2_shopping",
  reminders: "memorycarl_v2_reminders",
};

function uid(prefix="id"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function load(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch{
    return fallback;
  }
}

function save(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

// ---- Seeds ----
function seedRoutines(){
  return [{
    id: uid("r"),
    title: "Morning Reset",
    times: ["07:00"],
    steps: [],
    active: true,
    lastRun: null,
  }];
}

function seedShopping(){
  return [];
}

function seedReminders(){
  return [];
}

// ---- State ----
let state = {
  tab: "routines",
  routines: load(LS.routines, seedRoutines()),
  shopping: load(LS.shopping, seedShopping()),
  reminders: load(LS.reminders, seedReminders()),
};

function persist(){
  save(LS.routines, state.routines);
  save(LS.shopping, state.shopping);
  save(LS.reminders, state.reminders);
}


// ---- UI ----
function view(){
  const root = document.querySelector("#app");

  root.innerHTML = `
    <div class="app">
      <header class="header">
        <h1>MemoryCarl</h1>
        <div class="tabs">
          <div class="tab ${state.tab==="routines"?"active":""}" data-tab="routines">Rutinas</div>
          <div class="tab ${state.tab==="shopping"?"active":""}" data-tab="shopping">Compras</div>
          <div class="tab ${state.tab==="reminders"?"active":""}" data-tab="reminders">Reminders</div>
        </div>
      </header>

      <main class="content">
        ${state.tab==="routines" ? viewRoutines() : ""}
        ${state.tab==="shopping" ? viewShopping() : ""}
        ${state.tab==="reminders" ? viewReminders() : ""}
      </main>

      <div class="bottomBar">
        <div class="row">
          <button class="btn" id="btnExport">Export</button>

          <label class="btn">
            Import
            <input id="fileImport" type="file" style="display:none">
          </label>

          <button class="btn primary" id="btnNotif">Enable Notifs</button>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll(".tab").forEach(tab=>{
    tab.onclick = ()=>{
      state.tab = tab.dataset.tab;
      view();
    };
  });

  document.getElementById("btnNotif")?.addEventListener("click", enableNotifications);
}


// ---- Views ----
function viewRoutines(){
  return state.routines.map(r=>`
    <div class="card">
      <h3>${r.title}</h3>
      <button onclick="resetRoutine('${r.id}')">Reset</button>
    </div>
  `).join("");
}

function viewShopping(){
  return "<p>Shopping coming soon</p>";
}

function viewReminders(){
  return "<p>Reminders coming soon</p>";
}


// ---- Actions ----
function resetRoutine(id){
  const r = state.routines.find(x=>x.id===id);
  if(!r) return;

  r.lastRun = new Date().toISOString();
  persist();
  view();
}


// ---- Boot ----
persist();
view();
