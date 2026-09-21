
/*************************************
 * Finance Core v2 - Structured System
 *************************************/

import { classifyMovementWithAI } from './finance_ai_classifier.js';
import { updateDebtBalance } from './finance_debt_tracker.js';
import { resolveSourceLink } from './finance_source_links.js';

if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

window.FINANCE = (function(){

  const state = {
    movements: [],
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear()
  };

  Object.defineProperty(state, 'accounts', {
    get: function() {
      if (typeof window !== 'undefined' && window.state && Array.isArray(window.state.financeAccounts)) {
        return window.state.financeAccounts;
      }
      return this._accounts || [];
    },
    set: function(val) {
      this._accounts = val;
      if (typeof window !== 'undefined' && window.state) {
        window.state.financeAccounts = val;
      }
    },
    configurable: true,
    enumerable: true
  });

  /* ===============================
     UTIL
  =============================== */

  function uid(){
    return "id_" + Math.random().toString(36).slice(2) + Date.now();
  }

  function save(){
    try {
      localStorage.setItem("finance_v2_state", JSON.stringify(state));
    } catch (err) {
      console.warn("Storage quota exceeded or error saving finance_v2_state:", err);
    }
  }

  function load(){
  if (typeof localStorage === "undefined") return;
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
    if(!id) return null;
    const globalAccs = (typeof window !== 'undefined' && window.state && Array.isArray(window.state.financeAccounts)) ? window.state.financeAccounts : null;
    if (globalAccs) {
      const found = globalAccs.find(a => a.id === id);
      if (found) return found;
    }
    return state.accounts.find(a => a.id === id);
  }

  /* ===============================
     MOVEMENTS
  =============================== */

  function addMovement({
    id,
    date,
    type,
    amount,
    accountId,
    category,
    reason,
    note,
    neuronRole,
    neuronId,
    archived,
    isFiado,
    fiadoStatus,
    usdGross,
    usdNet,
    usdFee,
    usdExchange,
    usdFixedFee,
    counterparty,
    sourceLabel
  }){

    const acc = getAccount(accountId);

    const mId = id || uid();
    const movement = {
      id: mId,
      date: date || new Date().toISOString(),
      type, // income | expense | transfer
      amount: Number(amount),
      accountId,
      category,
      reason,
      note,
      neuronRole: neuronRole || "auto",
      neuronId: neuronId || `mov_${mId}`,
      archived: !!archived,
      isFiado: !!isFiado,
      fiadoStatus: fiadoStatus || null,
      usdGross: usdGross || null,
      usdNet: usdNet || null,
      usdFee: usdFee || null,
      usdExchange: usdExchange || null,
      usdFixedFee: usdFixedFee || null,
      counterparty: counterparty || null,
      sourceLabel: sourceLabel || null
    };

    if(acc){
      if(type === "expense"){
        acc.balance -= movement.amount;
      }else if(type === "income"){
        acc.balance += movement.amount;
      }
    }

    state.movements.push(movement);
    save();

    classifyMovementWithAI({
      category: movement.category,
      note: movement.note,
      amount: movement.amount,
      direction: movement.type
    }).then(function(aiResult) {
      if (!aiResult) return;
      movement.aiClassification = aiResult;

      // Copy new fields to root — respect manual overrides from FASE 1
      // counterparty: manual override (set before AI call) wins
      if (!movement.counterparty && aiResult.counterparty) {
        movement.counterparty = aiResult.counterparty;
      }
      if (aiResult.debtDirection) movement.debtDirection = aiResult.debtDirection;
      if (aiResult.context) movement.context = aiResult.context;
      // sourceLabel: manual override wins; sourceRef is AI's suggestion
      if (!movement.sourceLabel && aiResult.sourceRef) {
        movement.sourceLabel = aiResult.sourceRef;
      }

      // Update debt balance ledger (pure arithmetic, no AI)
      try { updateDebtBalance(movement); } catch(_) {}
      // Resolve origin link if sourceLabel is set
      try { resolveSourceLink(movement); } catch(_) {}

      save();
      if (typeof window.renderApp === "function") window.renderApp();
    });

    return movement;
  }

  function updateMovement(id, patch){
    const idx = state.movements.findIndex(m => m.id === id);
    if(idx === -1) return null;

    const oldMovement = state.movements[idx];
    const acc = getAccount(oldMovement.accountId);

    // Revert old balance
    if(acc){
      if(oldMovement.type === "expense"){
        acc.balance += oldMovement.amount;
      }else{
        acc.balance -= oldMovement.amount;
      }
    }

    const updatedMovement = { ...oldMovement, ...patch };

    // Apply new balance
    const newAcc = getAccount(updatedMovement.accountId);
    if(newAcc){
      if(updatedMovement.type === "expense"){
        newAcc.balance -= updatedMovement.amount;
      }else{
        newAcc.balance += updatedMovement.amount;
      }
    }

    state.movements[idx] = updatedMovement;
    save();
    return updatedMovement;
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
      const url = urlRaw ? urlRaw.replace(/\/+$/, "") : "https://memory-carl.vercel.app";
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const res = await fetch(`${url}/api/telegram/pending`, {
        method: "GET",
        headers
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
    updateMovement,
    deleteMovement,
    getMonthlyData,
    projection,
    weeklyReview,
    fetchPendingTelegramTransactions
  };

})();
