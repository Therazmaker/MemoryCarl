
export function initFootballLab(){

  if(!localStorage.getItem("footballDB")){
    localStorage.setItem("footballDB", JSON.stringify({
      teams: [],
      players: []
    }));
  }

  function getDB(){ return JSON.parse(localStorage.getItem("footballDB")); }
  function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }

  const moreBtn = document.querySelector("#moreBtn");
  if(moreBtn){
    const labBtn = document.createElement("button");
    labBtn.innerText = "⚽ Football Lab";
    labBtn.className = "more-item";
    labBtn.onclick = openLab;
    moreBtn.parentElement.appendChild(labBtn);
  }

  function openLab(){
    const db = getDB();
    const root = document.getElementById("app");

    root.innerHTML = `
      <div style="padding:20px;">
        <h2>⚽ Football Lab V4</h2>

        <h3>Formación</h3>
        <select id="formation">
          <option value="433">4-3-3</option>
          <option value="442">4-4-2</option>
          <option value="343">3-4-3</option>
        </select>

        <h3>Equipo Local</h3>
        <select id="teamHome"></select>

        <h3>Equipo Visitante</h3>
        <select id="teamAway"></select>

        <button id="calc">Calcular Probabilidad</button>

        <div id="output" style="margin-top:20px;"></div>

        <hr/>
        <button onclick="location.reload()">Volver</button>
      </div>
    `;

    const teamHome = document.getElementById("teamHome");
    const teamAway = document.getElementById("teamAway");

    db.teams.forEach(t=>{
      const o1 = document.createElement("option");
      o1.value = t.id;
      o1.innerText = t.name;
      teamHome.appendChild(o1);

      const o2 = document.createElement("option");
      o2.value = t.id;
      o2.innerText = t.name;
      teamAway.appendChild(o2);
    });

    document.getElementById("calc").onclick = ()=>{

      const homeId = parseInt(teamHome.value);
      const awayId = parseInt(teamAway.value);

      const homePlayers = db.players.filter(p=>p.teamId===homeId);
      const awayPlayers = db.players.filter(p=>p.teamId===awayId);

      function computeStrength(players){

        let attack=0, defense=0, control=0;

        players.forEach(p=>{
          if(["ST","LW","RW","CAM"].includes(p.position)){
            attack += p.rating;
          }
          if(["CB","LB","RB","CDM","GK"].includes(p.position)){
            defense += p.rating;
          }
          if(["CM","CAM","CDM"].includes(p.position)){
            control += p.rating;
          }
        });

        attack = attack / (players.length||1);
        defense = defense / (players.length||1);
        control = control / (players.length||1);

        const total = 0.4*attack + 0.4*defense + 0.2*control;

        return {attack, defense, control, total};
      }

      const H = computeStrength(homePlayers);
      const A = computeStrength(awayPlayers);

      const homeAdv = 0.05;
      const homeTotal = H.total * (1+homeAdv);
      const awayTotal = A.total;

      const diff = homeTotal - awayTotal;

      const pHome = 1/(1+Math.exp(-diff));
      const drawBase = 0.28;
      const pDraw = drawBase * Math.exp(-Math.abs(diff));
      const pAway = 1 - pHome;

      const norm = pHome + pDraw + pAway;

      document.getElementById("output").innerHTML = `
        <h3>Resultado Probabilístico</h3>
        <strong>Home Win:</strong> ${(pHome/norm*100).toFixed(1)}%<br/>
        <strong>Draw:</strong> ${(pDraw/norm*100).toFixed(1)}%<br/>
        <strong>Away Win:</strong> ${(pAway/norm*100).toFixed(1)}%

        <hr/>
        <strong>Home Strength:</strong> ${homeTotal.toFixed(2)}<br/>
        <strong>Away Strength:</strong> ${awayTotal.toFixed(2)}<br/>
      `;
    };
  }
}
