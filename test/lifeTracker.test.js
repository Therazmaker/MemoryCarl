import test from "node:test";
import assert from "node:assert/strict";

// Mock environment and state
globalThis.state = {
  lifeTasks: [],
  lifeTasksLog: []
};

globalThis.LS = {
  lifeTasks: "memorycarl_v2_life_tasks",
  lifeTasksLog: "memorycarl_v2_life_tasks_log"
};

const mockStore = {};
globalThis.localStorage = {
  getItem: (k) => mockStore[k] ?? null,
  setItem: (k, v) => { mockStore[k] = String(v); },
  removeItem: (k) => { delete mockStore[k]; }
};

globalThis.persist = () => {
  mockStore[LS.lifeTasks] = JSON.stringify(state.lifeTasks);
  mockStore[LS.lifeTasksLog] = JSON.stringify(state.lifeTasksLog);
};

// Functions to test (matching main.js implementations)
function lifeTasksGet() {
  const tasks = Array.isArray(state.lifeTasks) ? state.lifeTasks : [];
  if (!tasks.length) {
    state.lifeTasks = [
      { id: "lt_shower", icon: "🚿", title: "Ducha", category: "higiene", freqDays: 1, lastDone: null, partOfDay: "manana" },
      { id: "lt_teeth", icon: "🦷", title: "Cepillar dientes", category: "higiene", freqDays: 0.5, lastDone: null, partOfDay: "manana" }
    ];
    persist();
    return state.lifeTasks;
  }
  return tasks;
}

function lifeTaskMarkDone(id, forcedTs) {
  const tasks = lifeTasksGet();
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const ts = forcedTs || new Date().toISOString();
  task.lastDone = ts;
  state.lifeTasksLog = state.lifeTasksLog || [];
  state.lifeTasksLog.push({ id, ts });
  persist();
}

function lifeTaskAddCustom(title, icon, freqDays, category, partOfDay) {
  const tasks = lifeTasksGet();
  const id = "lt_custom_" + Date.now();
  tasks.push({ id, icon: icon || "📌", title, freqDays: Number(freqDays) || 7, category: category || "otro", lastDone: null, partOfDay: partOfDay || "cualquier" });
  state.lifeTasks = tasks;
  persist();
  return id;
}

function lifeTaskDelete(id) {
  state.lifeTasks = lifeTasksGet().filter(t => t.id !== id);
  persist();
}

function lifeTaskUpdate(id, updates) {
  const tasks = lifeTasksGet();
  const index = tasks.findIndex(t => t.id === id);
  if (index !== -1) {
    tasks[index] = { ...tasks[index], ...updates };
    state.lifeTasks = tasks;
    persist();
  }
}

function lifeTaskDeleteLogEntry(logIndex) {
  if (!Array.isArray(state.lifeTasksLog)) return;
  if (logIndex >= 0 && logIndex < state.lifeTasksLog.length) {
    const removed = state.lifeTasksLog.splice(logIndex, 1)[0];
    if (removed && removed.id) {
      const task = (state.lifeTasks || []).find(t => t.id === removed.id);
      if (task) {
        const remainingLogs = state.lifeTasksLog.filter(l => l.id === removed.id);
        if (remainingLogs.length > 0) {
          remainingLogs.sort((a, b) => new Date(b.ts) - new Date(a.ts));
          task.lastDone = remainingLogs[0].ts;
        } else {
          task.lastDone = null;
        }
      }
    }
    persist();
  }
}

function lifeTaskDaysSince(task) {
  if (!task.lastDone) return 999;
  return (Date.now() - new Date(task.lastDone).getTime()) / (1000 * 60 * 60 * 24);
}

function lifeTaskUrgency(task) {
  const days = lifeTaskDaysSince(task);
  const ratio = days / (task.freqDays || 1);
  if (ratio >= 1.5) return "critical";
  if (ratio >= 1.0) return "due";
  if (ratio >= 0.75) return "soon";
  return "ok";
}

test("Life Tracker CRUD and Log Deletion Suite", () => {
  // Reset state
  state.lifeTasks = [];
  state.lifeTasksLog = [];

  // 1. Initialize default tasks
  const tasks = lifeTasksGet();
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].title, "Ducha");

  // 2. Add custom habit
  const newId = lifeTaskAddCustom("Lavar carro", "🚗", 7, "hogar", "fin_de_semana");
  assert.equal(state.lifeTasks.length, 3);
  const habit = state.lifeTasks.find(t => t.id === newId);
  assert.equal(habit.title, "Lavar carro");
  assert.equal(habit.freqDays, 7);

  // 3. Update habit
  lifeTaskUpdate(newId, { title: "Lavar camioneta", freqDays: 10 });
  const updated = state.lifeTasks.find(t => t.id === newId);
  assert.equal(updated.title, "Lavar camioneta");
  assert.equal(updated.freqDays, 10);

  // 4. Urgency before completion
  assert.equal(lifeTaskUrgency(updated), "critical"); // Since lastDone is null -> 999 days since

  // 5. Mark done
  const ts1 = "2026-10-01T10:00:00.000Z";
  const ts2 = "2026-10-08T10:00:00.000Z";
  lifeTaskMarkDone(newId, ts1);
  lifeTaskMarkDone(newId, ts2);
  assert.equal(updated.lastDone, ts2);
  assert.equal(state.lifeTasksLog.length, 2);

  // 6. Delete latest log entry and verify lastDone recalculation
  lifeTaskDeleteLogEntry(1); // Deletes ts2 entry
  assert.equal(state.lifeTasksLog.length, 1);
  assert.equal(updated.lastDone, ts1);

  // Deleting remaining log entry sets lastDone to null
  lifeTaskDeleteLogEntry(0);
  assert.equal(state.lifeTasksLog.length, 0);
  assert.equal(updated.lastDone, null);

  // 7. Delete habit
  lifeTaskDelete(newId);
  assert.equal(state.lifeTasks.length, 2);
});
