export const teamRegex = /\((.*?)\)/;

export const narrativePatterns = [
  {
    type: "shot",
    weight: 4,
    patterns: ["dispara", "remate", "tiro", "disparo", "cabezazo", "shot"]
  },
  {
    type: "big_chance",
    weight: 7,
    patterns: ["gran oportunidad", "que oportunidad", "qué oportunidad", "desde el centro del area", "desde el centro del área", "dentro del area", "dentro del área"]
  },
  {
    type: "save",
    weight: 5,
    patterns: ["parada", "ataj", "bloque", "save"]
  },
  {
    type: "post",
    weight: 6,
    patterns: ["poste", "larguero"]
  },
  {
    type: "corner",
    weight: 2,
    patterns: ["corner", "córner", "saque de esquina"]
  },
  {
    type: "danger_pass",
    weight: 2,
    patterns: ["pase peligroso", "centro peligroso"]
  },
  {
    type: "goal",
    weight: 10,
    patterns: ["gol", "entra en el fondo"]
  },
  {
    type: "foul",
    weight: 1,
    patterns: ["falta", "foul"]
  },
  {
    type: "yellow",
    weight: 1,
    patterns: ["tarjeta amarilla", "yellow card"]
  },
  {
    type: "red",
    weight: 6,
    patterns: ["tarjeta roja", "expulsion", "expulsión", "red card"]
  },
  {
    type: "offside",
    weight: 1,
    patterns: ["fuera de juego", "offside"]
  }
];
