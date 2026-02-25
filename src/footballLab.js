
export function initFootballLab(){

  if(!localStorage.getItem("footballDB")){
    localStorage.setItem("footballDB", JSON.stringify({
      teams: [],
      players: [],
      matches: []
    }));
  }

  function getDB(){
    return JSON.parse(localStorage.getItem("footballDB"));
  }

  function saveDB(db){
    localStorage.setItem("footballDB", JSON.stringify(db));
  }

  function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }

  const btn = document.createElement("button");
  btn.innerText = "⚽ Football Lab";
  btn.style.position = "fixed";
  btn.style.bottom = "20px";
  btn.style.right = "20px";
  btn.style.zIndex = "9999";
  btn.style.padding = "10px 14px";
  btn.style.borderRadius = "12px";
  btn.style.border = "none";
  btn.style.background = "#0f172a";
  btn.style.color = "white";
  btn.style.cursor = "pointer";
  document.body.appendChild(btn);

  const modal = document.createElement("div");
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.background = "rgba(0,0,0,0.75)";
  modal.style.display = "none";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";
  modal.style.zIndex = "10000";

  modal.innerHTML = `
  <div style="background:#111;padding:20px;border-radius:16px;width:95%;max-width:900px;color:white;max-height:90%;overflow:auto;">

    <h2>Football Lab V2-B — Match Logger</h2>

    <h3>Seleccionar Jugador</h3>
    <select id="fl_player_select"></select>

    <h3>Datos del Partido</h3>
    <label>Minutos <input id="fl_min" type="number" min="0" max="90" value="90"/></label><br/>
    <label>Goles <input id="fl_goals" type="number" value="0"/></label><br/>
    <label>Asistencias <input id="fl_ast" type="number" value="0"/></label><br/>
    <label>Pases Completados <input id="fl_passc" type="number" value="0"/></label><br/>
    <label>Pases Intentados <input id="fl_passa" type="number" value="0"/></label><br/>
    <label>Duelos Ganados <input id="fl_duelw" type="number" value="0"/></label><br/>
    <label>Duelos Totales <input id="fl_duelt" type="number" value="0"/></label><br/>
    <label>Pérdidas <input id="fl_losses" type="number" value="0"/></label><br/>
    <label>Tarjetas Amarillas <input id="fl_yellow" type="number" value="0"/></label><br/>
    <label>Tarjeta Roja <input id="fl_red" type="number" value="0"/></label><br/><br/>

    <button id="fl_calculate">Calcular & Actualizar Rating</button>

    <div id="fl_result" style="margin-top:15px;"></div>

    <hr/>
    <button id="fl_close">Cerrar</button>
  </div>
  `;

  document.body.appendChild(modal);

  btn.onclick = () => {
    renderPlayers();
    modal.style.display = "flex";
  };

  modal.querySelector("#fl_close").onclick = () => {
    modal.style.display = "none";
  };

  function renderPlayers(){
    const db = getDB();
    const select = modal.querySelector("#fl_player_select");
    select.innerHTML = "";
    db.players.forEach(p=>{
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.innerText = p.name + " (" + p.rating.toFixed(2) + ")";
      select.appendChild(opt);
    });
  }

  modal.querySelector("#fl_calculate").onclick = () => {

    const db = getDB();
    const playerId = parseInt(modal.querySelector("#fl_player_select").value);
    const player = db.players.find(p=>p.id===playerId);
    if(!player) return;

    const minutes = parseFloat(fl_min.value)||0;
    const goals = parseFloat(fl_goals.value)||0;
    const ast = parseFloat(fl_ast.value)||0;
    const passc = parseFloat(fl_passc.value)||0;
    const passa = parseFloat(fl_passa.value)||1;
    const duelw = parseFloat(fl_duelw.value)||0;
    const duelt = parseFloat(fl_duelt.value)||1;
    const losses = parseFloat(fl_losses.value)||0;
    const yellow = parseFloat(fl_yellow.value)||0;
    const red = parseFloat(fl_red.value)||0;

    const minFactor = Math.sqrt(minutes/90);
    const passPct = passc/passa;
    const duelPct = duelw/duelt;

    let score =
      (goals*1.2) +
      (ast*0.8) +
      (passPct*2) +
      (duelPct*1.5) -
      (losses*0.05) -
      (yellow*0.3) -
      (red*1);

    score = score * minFactor;

    score = clamp(score,0,10);

    const expected = player.rating;
    const K = 0.15 * minFactor;

    const newRating = clamp(player.rating + K*(score-expected),0,10);

    player.rating = newRating;

    db.matches.push({
      playerId,
      date: new Date().toISOString(),
      score: score,
      oldRating: expected,
      newRating: newRating
    });

    saveDB(db);

    modal.querySelector("#fl_result").innerHTML =
      "<strong>Performance Score:</strong> " + score.toFixed(2) +
      "<br/><strong>Nuevo Rating:</strong> " + newRating.toFixed(2);

    renderPlayers();
  };

}
