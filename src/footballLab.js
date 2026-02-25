
export function initFootballLab(){

  if(!localStorage.getItem("footballDB")){
    localStorage.setItem("footballDB", JSON.stringify({
      teams: [],
      players: [],
      matches: [],
      weights: {
        shots: 1.2,
        passes: 1.0,
        dribbles: 1.0,
        defense: 1.1,
        goalkeeper: 1.3
      }
    }));
  }

  function getDB(){ return JSON.parse(localStorage.getItem("footballDB")); }
  function saveDB(db){ localStorage.setItem("footballDB", JSON.stringify(db)); }
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
        <h2>⚽ Football Lab V3</h2>

        <h3>Pesos del Modelo</h3>
        ${Object.keys(db.weights).map(k=>`
          <label>${k} 
            <input type="range" min="0.5" max="2" step="0.1" value="${db.weights[k]}" id="w_${k}"/>
            <span id="w_val_${k}">${db.weights[k]}</span>
          </label><br/>
        `).join("")}

        <button id="saveWeights">Guardar Pesos</button>

        <hr/>

        <h3>Probabilidad Simple Versus</h3>
        <select id="teamA"></select>
        vs
        <select id="teamB"></select>
        <button id="calcProb">Calcular</button>
        <div id="probResult"></div>

        <hr/>
        <button id="backHome">Volver</button>
      </div>
    `;

    const teamA = document.getElementById("teamA");
    const teamB = document.getElementById("teamB");

    db.teams.forEach(t=>{
      const o1 = document.createElement("option");
      o1.value = t.id;
      o1.innerText = t.name;
      teamA.appendChild(o1);

      const o2 = document.createElement("option");
      o2.value = t.id;
      o2.innerText = t.name;
      teamB.appendChild(o2);
    });

    Object.keys(db.weights).forEach(k=>{
      const slider = document.getElementById("w_"+k);
      slider.oninput = ()=>{
        document.getElementById("w_val_"+k).innerText = slider.value;
      };
    });

    document.getElementById("saveWeights").onclick = ()=>{
      Object.keys(db.weights).forEach(k=>{
        db.weights[k] = parseFloat(document.getElementById("w_"+k).value);
      });
      saveDB(db);
      alert("Pesos guardados.");
    };

    document.getElementById("calcProb").onclick = ()=>{
      const idA = parseInt(teamA.value);
      const idB = parseInt(teamB.value);

      const playersA = db.players.filter(p=>p.teamId===idA);
      const playersB = db.players.filter(p=>p.teamId===idB);

      const avgA = playersA.length ? playersA.reduce((s,p)=>s+p.rating,0)/playersA.length : 0;
      const avgB = playersB.length ? playersB.reduce((s,p)=>s+p.rating,0)/playersB.length : 0;

      const diff = avgA - avgB;

      const probA = 1/(1+Math.exp(-diff));
      const probB = 1-probA;

      document.getElementById("probResult").innerHTML =
        "<strong>"+
        (playersA.length?playersA[0].teamName||"Equipo A":"Equipo A")+
        "</strong>: "+(probA*100).toFixed(1)+"%<br/>"+
        "<strong>"+
        (playersB.length?playersB[0].teamName||"Equipo B":"Equipo B")+
        "</strong>: "+(probB*100).toFixed(1)+"%";
    };

    document.getElementById("backHome").onclick = ()=>{
      location.reload();
    };
  }

}
