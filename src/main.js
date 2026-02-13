
/* === MemoryCarl Main (Catalog + PEN) === */

console.log("MemoryCarl loaded");

/* ---------- Storage Keys ---------- */
const LS = {
  routines: "memorycarl_v2_routines",
  shopping: "memorycarl_v2_shopping",
  reminders: "memorycarl_v2_reminders",
  catalog: "memorycarl_v2_catalog",
};

/* ---------- Helpers ---------- */
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

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* PEN currency */
function money(n){
  const x = Number(n || 0);
  return x.toLocaleString("es-PE", {
    style:"currency",
    currency:"PEN"
  });
}

/* ---------- Seeds ---------- */
function seedCatalog(){
  return [
    { id: uid("p"), name:"Arroz", price:5.5, store:"Tottus" }
  ];
}

function seedShopping(){
  return [
    { id: uid("l"), name:"Super", items:[] }
  ];
}

function seedReminders(){
  return [];
}

/* ---------- State ---------- */
let state = {
  tab:"shopping",
  shopping: load(LS.shopping, seedShopping()),
  reminders: load(LS.reminders, seedReminders()),
  catalog: load(LS.catalog, seedCatalog()),
};

/* ---------- Persist ---------- */
function persist(){
  save(LS.shopping, state.shopping);
  save(LS.reminders, state.reminders);
  save(LS.catalog, state.catalog);
}

/* ---------- UI ---------- */
function view(){
  const root = document.querySelector("#app");

  root.innerHTML = `
  <div class="app">

    <header class="header">
      <div class="brand">
        <h1>MemoryCarl</h1>
      </div>
      <div class="tabs">
        <div class="tab ${state.tab==="shopping"?"active":""}" data-tab="shopping">Compras</div>
      </div>
    </header>

    <main class="content">
      ${state.tab==="shopping" ? viewShopping() : ""}
    </main>

    <div class="fab" id="fab">+</div>

    <div id="toastHost"></div>
  </div>
  `;

  root.querySelectorAll(".tab").forEach(t=>{
    t.onclick=()=>{
      state.tab=t.dataset.tab;
      view();
    };
  });

  root.querySelector("#fab").onclick=()=>openAddItemModal();

  wireActions(root);
}

/* ---------- Shopping ---------- */
function viewShopping(){
  return `
    <div class="sectionTitle">
      <div>Listas</div>
      <button class="btn" id="btnCatalog">📚 Catálogo</button>
    </div>

    ${state.shopping.map(l=>shoppingCard(l)).join("")}
  `;
}

function shoppingCard(list){

  const total = list.items.reduce((a,i)=>a+i.price*i.qty,0);

  return `
    <section class="card" data-list-id="${list.id}">

      <div class="cardTop">
        <h3>${escapeHtml(list.name)}</h3>
        <div class="chip">${money(total)}</div>
      </div>

      <div class="list">
        ${list.items.map(it=>`
          <div class="item">
            <div class="left">
              <div class="name">${escapeHtml(it.name)}</div>
              <div class="meta">${money(it.price)} × ${it.qty}</div>
            </div>

            <button class="btn danger" data-act="delItem" data-id="${it.id}">Del</button>
          </div>
        `).join("")}
      </div>

    </section>
  `;
}

/* ---------- Catalog Modal ---------- */
function openCatalog(){

  const host=document.querySelector("#app");

  const b=document.createElement("div");
  b.className="modalBackdrop";

  b.innerHTML=`
  <div class="modal">

    <h2>📚 Catálogo</h2>

    <div class="row">
      <button class="btn primary" id="btnAddProd">+ Producto</button>
      <button class="btn" id="btnClose">Cerrar</button>
    </div>

    <div class="hr"></div>

    <div class="list" id="prodList"></div>

  </div>
  `;

  host.appendChild(b);

  const close=()=>b.remove();

  b.querySelector("#btnClose").onclick=close;

  function render(){

    const wrap=b.querySelector("#prodList");

    wrap.innerHTML=state.catalog.map(p=>`
      <div class="item">

        <div class="left">
          <div class="name">${escapeHtml(p.name)}</div>
          <div class="meta">${money(p.price)} · ${escapeHtml(p.store)}</div>
        </div>

        <div class="row">
          <button class="btn" data-e="${p.id}">Edit</button>
          <button class="btn danger" data-d="${p.id}">Del</button>
        </div>

      </div>
    `).join("");

    wrap.querySelectorAll("[data-d]").forEach(b=>{
      b.onclick=()=>{
        const id=b.dataset.d;
        state.catalog=state.catalog.filter(x=>x.id!==id);
        persist();
        render();
      };
    });

    wrap.querySelectorAll("[data-e]").forEach(b=>{
      b.onclick=()=>editProduct(b.dataset.e);
    });
  }

  function editProduct(id){

    const p=state.catalog.find(x=>x.id===id);
    if(!p)return;

    openPromptModal({
      title:"Editar producto",
      fields:[
        {key:"name",label:"Nombre",value:p.name},
        {key:"price",label:"Precio",type:"number",value:p.price},
        {key:"store",label:"Tienda",value:p.store},
      ],
      onSubmit:({name,price,store})=>{
        p.name=name.trim();
        p.price=Number(price||0);
        p.store=store.trim();
        persist();
        render();
      }
    });
  }

  b.querySelector("#btnAddProd").onclick=()=>{

    openPromptModal({
      title:"Nuevo producto",
      fields:[
        {key:"name",label:"Nombre"},
        {key:"price",label:"Precio",type:"number"},
        {key:"store",label:"Tienda"},
      ],
      onSubmit:({name,price,store})=>{

        if(!name.trim())return;

        state.catalog.unshift({
          id:uid("p"),
          name:name.trim(),
          price:Number(price||0),
          store:store.trim()
        });

        persist();
        render();
      }
    });

  };

  render();
}

/* ---------- Add Item ---------- */
function openAddItemModal(){

  const opts = state.catalog.map(p=>
    `<option value="${p.id}">${escapeHtml(p.name)} (${money(p.price)})</option>`
  ).join("");

  const host=document.querySelector("#app");

  const b=document.createElement("div");
  b.className="modalBackdrop";

  b.innerHTML=`
  <div class="modal">

    <h2>Nuevo Item</h2>

    <div class="grid">

      <div>
        <div class="muted">Catálogo</div>
        <select class="input" id="selCat">
          <option value="">-- Manual --</option>
          ${opts}
        </select>
      </div>

      <input class="input" id="iName" placeholder="Nombre">
      <input class="input" id="iPrice" type="number" placeholder="Precio">
      <input class="input" id="iQty" type="number" value="1">

    </div>

    <div class="row">
      <button class="btn ghost" id="btnCancel">Cancelar</button>
      <button class="btn primary" id="btnSave">Guardar</button>
    </div>

  </div>
  `;

  host.appendChild(b);

  const close=()=>b.remove();

  b.querySelector("#btnCancel").onclick=close;

  const sel=b.querySelector("#selCat");
  const name=b.querySelector("#iName");
  const price=b.querySelector("#iPrice");

  sel.onchange=()=>{

    const p=state.catalog.find(x=>x.id===sel.value);
    if(!p)return;

    name.value=p.name;
    price.value=p.price;
  };

  b.querySelector("#btnSave").onclick=()=>{

    if(!name.value.trim())return;

    const list=state.shopping[0];

    list.items.push({
      id:uid("i"),
      name:name.value.trim(),
      price:Number(price.value||0),
      qty:Number(b.querySelector("#iQty").value||1)
    });

    persist();
    view();
    close();
  };

}

/* ---------- Prompt Modal ---------- */
function openPromptModal({title,fields,onSubmit}){

  const host=document.querySelector("#app");

  const b=document.createElement("div");
  b.className="modalBackdrop";

  b.innerHTML=`
  <div class="modal">

    <h2>${escapeHtml(title)}</h2>

    <div class="grid" id="fWrap"></div>

    <div class="row">
      <button class="btn ghost" id="c">Cancel</button>
      <button class="btn primary" id="s">Save</button>
    </div>

  </div>
  `;

  host.appendChild(b);

  const wrap=b.querySelector("#fWrap");

  wrap.innerHTML=fields.map(f=>`
    <div>
      <div class="muted">${f.label}</div>
      <input class="input" data-k="${f.key}" type="${f.type||"text"}" value="${f.value||""}">
    </div>
  `).join("");

  b.querySelector("#c").onclick=()=>b.remove();

  b.querySelector("#s").onclick=()=>{

    const data={};

    fields.forEach(f=>{
      data[f.key]=b.querySelector(`[data-k="${f.key}"]`).value;
    });

    onSubmit(data);
    b.remove();
  };
}

/* ---------- Wire ---------- */
function wireActions(root){

  root.querySelector("#btnCatalog")?.addEventListener("click",openCatalog);

  root.querySelectorAll("[data-act]").forEach(b=>{

    b.onclick=()=>{

      if(b.dataset.act==="delItem"){

        const id=b.dataset.id;

        state.shopping.forEach(l=>{
          l.items=l.items.filter(x=>x.id!==id);
        });

        persist();
        view();
      }
    };
  });
}

/* ---------- Toast ---------- */
let toastTimer=null;
function toast(msg){

  clearTimeout(toastTimer);

  const host=document.querySelector("#toastHost");
  if(!host)return;

  host.innerHTML=`<div style="
    position:fixed;
    left:50%;
    bottom:90px;
    transform:translateX(-50%);
    background:rgba(0,0,0,.6);
    padding:10px 14px;
    border-radius:14px;
    font-weight:800;
  ">${escapeHtml(msg)}</div>`;

  toastTimer=setTimeout(()=>host.innerHTML="",1200);
}

/* ---------- Init ---------- */
persist();
view();
