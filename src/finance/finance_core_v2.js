
/*************************************
 * Finance Core v2 - Structured System
 *************************************/

window.FINANCE = (function(){

  const state = {
    accounts: [],
    movements: [],
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear()
  };

  /* ===============================
     UTIL
  =============================== */

  function uid(){
    return "id_" + Math.random().toString(36).slice(2) + Date.now();
  }

  function save(){
    localStorage.setItem("finance_v2_state", JSON.stringify(state));
  }

  function load(){
    const raw = localStorage.getItem("finance_v2_state");
    if(raw){
      Object.assign(state, JSON.parse(raw));
    }
  }

  /* ===============================
     ACCOUNTS
  =============================== */

  function createAccount({name, type, balance=0, color=null}){
    const acc = {
      id: uid(),
      name,
      type, // bank | cash | card
      balance: Number(balance),
      color,
      createdAt: new Date().toISOString()
    };
    state.accounts.push(acc);
    save();
    return acc;
  }

  function getAccount(id){
    return state.accounts.find(a => a.id === id);
  }

  /* ===============================
     MOVEMENTS
  =============================== */

  function addMovement({
    date,
    type,
    amount,
    accountId,
    category,
    reason,
    note
  }){

    const acc = getAccount(accountId);
    if(!acc) return;

    const movement = {
      id: uid(),
      date: date || new Date().toISOString(),
      type, // income | expense
      amount: Number(amount),
      accountId,
      category,
      reason,
      note
    };

    if(type === "expense"){
      acc.balance -= movement.amount;
    }else{
      acc.balance += movement.amount;
    }

    state.movements.push(movement);
    save();
    return movement;
  }

  function deleteMovement(id){
    const idx = state.movements.findIndex(m => m.id === id);
    if(idx === -1) return;

    const movement = state.movements[idx];
    const acc = getAccount(movement.accountId);

    if(acc){
      if(movement.type === "expense"){
        acc.balance += movement.amount;
      }else{
        acc.balance -= movement.amount;
      }
    }

    state.movements.splice(idx, 1);
    save();
  }

  /* ===============================
     CHART DATA
  =============================== */

  function getMonthlyData(){

    const days = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
    let expenseAccum = 0;
    let incomeAccum = 0;

    const expenseLine = [];
    const incomeLine = [];

    for(let d=1; d<=days; d++){
      const daily = state.movements.filter(m => {
        const dt = new Date(m.date);
        return dt.getMonth() === state.currentMonth &&
               dt.getFullYear() === state.currentYear &&
               dt.getDate() === d;
      });

      daily.forEach(m => {
        if(m.type === "expense") expenseAccum += m.amount;
        if(m.type === "income") incomeAccum += m.amount;
      });

      expenseLine.push(expenseAccum);
      incomeLine.push(incomeAccum);
    }

    return {
      days: Array.from({length: days}, (_,i)=>i+1),
      expenseLine,
      incomeLine
    };
  }

  /* ===============================
     PROJECTION MODES
  =============================== */

  function projection(mode="normal"){

    const recent = state.movements.slice(-7);
    if(recent.length === 0) return [];

    let avg = 0;

    if(mode === "conservative"){
      avg = recent.slice(-3).reduce((a,b)=>a+b.amount,0) / 3;
    }else if(mode === "realistic"){
      avg = recent.reduce((a,b)=>a+b.amount,0) / recent.length;
    }else{
      avg = state.movements.reduce((a,b)=>a+b.amount,0) / state.movements.length;
    }

    const daysLeft = 30;
    let projection = [];
    let accum = 0;

    for(let i=0;i<daysLeft;i++){
      accum += avg;
      projection.push(accum);
    }

    return projection;
  }

  /* ===============================
     WEEKLY INTELLIGENCE
  =============================== */

  function weeklyReview(){

    const weekAgo = Date.now() - (7*24*60*60*1000);

    const weekMovements = state.movements.filter(m => 
      new Date(m.date).getTime() >= weekAgo
    );

    if(weekMovements.length === 0){
      return "No hubo movimientos esta semana.";
    }

    const byCategory = {};
    weekMovements.forEach(m=>{
      if(!byCategory[m.category]) byCategory[m.category]=0;
      byCategory[m.category]+=m.amount;
    });

    const topCategory = Object.entries(byCategory)
      .sort((a,b)=>b[1]-a[1])[0];

    return `Esta semana destacó ${topCategory[0]} con ${topCategory[1].toFixed(2)}.`;
  }

  /* ===============================
     TELEGRAM SYNC
  =============================== */

  async function fetchPendingTelegramTransactions() {
    try {
      const urlRaw = localStorage.getItem("memorycarl_script_url");
      const apiKey = localStorage.getItem("memorycarl_script_api_key");
      if (!urlRaw || !apiKey) return;

      const url = urlRaw.replace(/\/+$/, "");
      const res = await fetch(`${url}/api/telegram/pending`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      });

      if (!res.ok) throw new Error("Error fetching telegram pending");
      const json = await res.json();
      if (json.status === 'ok' && json.data && json.data.length > 0) {
        
        let addedCount = 0;
        json.data.forEach(t => {
          // Intentar encontrar la cuenta si la dedujo (ej: cash, bank). 
          // Si no, tomar la primera cuenta por defecto.
          let accountId = t.account_id;
          if (accountId === "default" || accountId === "cash" || accountId === "bank") {
            const accs = state.accounts;
            if (accs.length > 0) {
              if (accountId === "cash") {
                const c = accs.find(a => a.type === "cash" || a.name.toLowerCase().includes("efectivo"));
                accountId = c ? c.id : accs[0].id;
              } else if (accountId === "bank") {
                const b = accs.find(a => a.type === "bank" || a.type === "card");
                accountId = b ? b.id : accs[0].id;
              } else {
                accountId = accs[0].id; // Default
              }
            }
          }

          addMovement({
            date: t.created_at || new Date().toISOString(),
            type: t.type,
            amount: t.amount,
            accountId: accountId,
            category: t.category,
            note: t.note || "Vía Telegram",
            reason: ""
          });
          addedCount++;
        });

        if (addedCount > 0 && typeof window.renderApp === "function") {
          window.renderApp();
          if (typeof toast === "function") toast(`📥 ${addedCount} transacciones añadidas desde Telegram`);
        }
      }
    } catch (e) {
      console.error("Telegram Sync Error:", e);
    }
  }

  /* =============================== */

  load();

  return {
    state,
    createAccount,
    addMovement,
    deleteMovement,
    getMonthlyData,
    projection,
    weeklyReview,
    fetchPendingTelegramTransactions
  };

})();
