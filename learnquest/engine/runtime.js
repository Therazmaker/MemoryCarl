import { parseProgram } from "./parser.js";
import { applyAction } from "./rules.js";
import { evaluateGoals } from "./goals.js";

export function createRuntime({ level, state, onUpdate, onLog, onError, onWin }){
  let queue = [];
  let running = false;

  const emitUpdate = ()=> onUpdate?.(state);

  function reset(newState){
    running = false;
    queue = [];
    if(newState){
      // mutate reference object for UI
      Object.keys(state).forEach(k=>delete state[k]);
      Object.assign(state, newState);
    }
    state.status = "idle";
    emitUpdate();
  }

  function loadProgram(code){
    const res = parseProgram(code, level.allowed);
    if(!res.ok){
      state.status = "error";
      onError?.(res.error);
      emitUpdate();
      return false;
    }
    queue = res.actions;
    return true;
  }

  async function step(){
    if(queue.length === 0) return;
    const action = queue.shift();
    const r = applyAction(level, state, action);

    if(!r.ok){
      state.status = "error";
      onError?.(`Línea ${action._line}: ${r.error}`);
      emitUpdate();
      running = false;
      queue = [];
      return;
    }

    if(r.msg) onLog?.(`✅ Línea ${action._line}: ${r.msg}`);

    const g = evaluateGoals(level, state);
    if(g.win){
      state.status = "win";
      onWin?.(g);
      emitUpdate();
      running = false;
      queue = [];
      return;
    }

    emitUpdate();
  }

  async function run({ delayMs=220 }={}){
    if(running) return;
    running = true;
    state.status = "running";
    emitUpdate();

    while(running && queue.length){
      // eslint-disable-next-line no-await-in-loop
      await step();
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r=>setTimeout(r, delayMs));
      if(state.status === "error" || state.status === "win") break;
    }

    if(state.status === "running"){
      state.status = "idle";
      emitUpdate();
    }
    running = false;
  }

  return { reset, loadProgram, step, run, getQueueLen:()=>queue.length };
}
