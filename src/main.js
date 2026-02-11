

console.log("MemoryCarl loaded");

const LS = {
  routines: "memorycarl_v1_routines",
  shopping: "memorycarl_v1_shopping",
  reminders: "memorycarl_v1_reminders",
};

function uid(prefix="id"){ return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`; }

function load(key, fallback){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch{ return fallback; }
}
function save(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

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
    items: [{ id: uid("i"), name:"Eggs", price:4.25, qty:1 }]
  }];
}
function seedReminders(){
  return [{ id: uid("m"), text:"Email: follow up", done:false }];
}

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

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function money(n){
  const x = Number(n || 0);
  return x.toLocaleString(undefined, { style:"currency", currency:"USD" });
}

function view(){
  const root = document.querySelector("#app");
  root.innerHTML = `
    <div class="app">
      <header class="header">
        <div class="brand">
          <h1>MemoryCarl</h1>
          <div class="pill">local • phone-first</div>
        </div>
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
        <div class="muted">Tip: en Android (Brave) menú ⋮ → Add to Home Screen.</div>
      </div>

      <div class="fab" id="fab">+</div>
    </div>
  `;

  root.querySelectorAll(".tab").forEach(t=>{
    t.addEventListener("click", ()=>{
      state.tab = t.dataset.tab;
      view();
    });
  });

  root.querySelector("#fab").addEventListener("click", ()=>{
    if(state.tab==="routines") openRoutineModal();
    if(state.tab==="shopping") openShoppingModal();
    if(state.tab==="reminders") openReminderModal();
  });

  wireActions(root);
}

function viewRoutines(){
  return `
    <div class="sectionTitle">
      <div>Rutinas</div>
      <div class="chip">${state.routines.length} total</div>
    </div>
    ${state.routines.map(r => routineCard(r)).join("")}
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
        <button class="btn" data-act="toggleRoutine">${r.active ? "Pause" : "Activate"}</button>
        <button class="btn danger" data-act="deleteRoutine">Delete</button>
      </div>
    </section>
  `;
}

function viewShopping(){
  return `
    <div class="sectionTitle">
      <div>Listas de compras</div>
      <div class="chip">${state.shopping.length} listas</div>
    </div>
    ${state.shopping.map(l => shoppingCard(l)).join("")}
  `;
}

function shoppingCard(list){
  const total = list.items.reduce((acc,it)=> acc + (Number(it.price||0)*Number(it.qty||1)), 0);

  return `
    <section class="card" data-list-id="${list.id}">
      <div class="cardTop">
        <div>
          <h3 class="cardTitle">${escapeHtml(list.name)}</h3>
          <div class="small">Total: <b>${money(total)}</b></div>
        </div>
        <div class="chip">${list.items.length} items</div>
      </div>

      <div class="hr"></div>

      <div class="list">
        ${list.items.map(it => `
          <div class="item">
            <div class="left">
              <div class="name">${escapeHtml(it.name)}</div>
              <div class="meta">${money(it.price)} × ${Number(it.qty||1)} = <b>${money(Number(it.price||0)*Number(it.qty||1))}</b></div>
            </div>
            <div class="row">
              <button class="btn" data-act="editItem" data-item-id="${it.id}">Edit</button>
              <button class="btn danger" data-act="deleteItem" data-item-id="${it.id}">Del</button>
            </div>
          </div>
        `).join("")}
      </div>

      <div class="row" style="margin-top:12px;">
        <button class="btn primary" data-act="addItem">+ Item</button>
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

      // ROUTINES
      const routineEl = btn.closest("[data-routine-id]");
      if(routineEl){
        const rid = routineEl.dataset.routineId;
        const r = state.routines.find(x=>x.id===rid);

        if(act==="toggleStep"){
          const s = r.steps.find(x=>x.id===btn.dataset.stepId);
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
          persist(); view(); return;
        }
        if(act==="toggleRoutine"){
          r.active = !r.active; persist(); view(); return;
        }
        if(act==="deleteRoutine"){
          state.routines = state.routines.filter(x=>x.id!==rid);
          persist(); view(); return;
        }
      }

      // SHOPPING
      const listEl = btn.closest("[data-list-id]");
      if(listEl){
        const lid = listEl.dataset.listId;
        const list = state.shopping.find(x=>x.id===lid);

        if(act==="addItem"){
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
                qty: Math.max(1, Number(qty || 1))
              });
              persist(); view();
            }
          });
          return;
        }

        if(act==="editItem"){
          const it = list.items.find(x=>x.id===btn.dataset.itemId);
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
        if(act==="deleteList"){
          state.shopping = state.shopping.filter(x=>x.id!==lid);
          persist(); view(); return;
        }
      }

      // REMINDERS
      const remEl = btn.closest("[data-reminder-id]");
      if(remEl){
        const mid = remEl.dataset.reminderId;
        const rem = state.reminders.find(x=>x.id===mid);

        if(act==="toggleReminder"){ rem.done = !rem.done; persist(); view(); return; }
        if(act==="deleteReminder"){
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
      const t = title.trim();
      if(!t) return;
      const arr = (times||"").split(",").map(x=>x.trim()).filter(Boolean);
      state.routines.unshift({ id: uid("r"), title:t, times:arr, steps:[], active:true, lastRun:null });
      persist(); view();
    }
  });
}
function openShoppingModal(){
  openPromptModal({
    title:"New shopping list",
    fields:[{key:"name", label:"List name", placeholder:"Pharmacy"}],
    onSubmit: ({name})=>{
      const n = name.trim();
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
      const t = text.trim();
      if(!t) return;
      state.reminders.unshift({ id: uid("m"), text:t, done:false });
      persist(); view();
    }
  });
}

persist();
view();
