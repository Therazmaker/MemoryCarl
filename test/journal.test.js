import test from "node:test";
import assert from "node:assert/strict";

import { createEntry, addEntryToDays, updateEntryInDays, deleteEntryInDays, journalEntries, mergeJournals, buildJournalPromptBlock, parseTags } from "../src/day/journal.js";
import { mergeCloudDays } from "../src/services/cloudRestore.js";
import { todayLocalStr } from "../src/chat/lifeDates.js";

const buildDay = (date) => ({ id: "day_" + date, date, rawChat: [], journal: [], summary: "", status: "open", updatedAt: "2026-01-01T00:00:00Z" });

test("una entrada va a su día, con #etiquetas del texto y sin texto vacío", () => {
  assert.equal(createEntry({ text: "   " }), null);
  const ts = new Date(2026, 10, 8, 9, 12).getTime();
  const e = createEntry({ text: "Llegué tarde #trabajo", mood: "meh", tags: ["Tráfico"], ts });
  assert.deepEqual(e.tags.sort(), ["trabajo", "trafico"]);
  const days = addEntryToDays([], e, buildDay);
  assert.equal(days[0].date, "2026-11-08");
  assert.equal(journalEntries(days)[0].text, "Llegué tarde #trabajo");
  assert.deepEqual(parseTags("#Casa y #SALUD #casa"), ["casa", "salud"]);
});

test("editar y borrar (con lápida, para que no vuelva desde la nube)", () => {
  const e = createEntry({ text: "Hola", ts: new Date(2026, 10, 8, 10).getTime() });
  let days = addEntryToDays([], e, buildDay);
  days = updateEntryInDays(days, e.id, { text: "Hola de nuevo", mood: "good" }).list;
  assert.equal(journalEntries(days)[0].text, "Hola de nuevo");
  assert.equal(journalEntries(days)[0].mood, "good");
  days = deleteEntryInDays(days, e.id).list;
  assert.equal(journalEntries(days).length, 0);
  assert.equal(days[0].journal[0].deleted, true);
});

test("al fusionar con la nube se unen las entradas y gana la edición más reciente", () => {
  const a = { id: "1", ts: 1, text: "local", updatedAt: "2026-11-08T10:00:00Z" };
  const b = { id: "1", ts: 1, text: "nube vieja", updatedAt: "2026-11-07T10:00:00Z" };
  const c = { id: "2", ts: 2, text: "solo nube", updatedAt: "2026-11-07T10:00:00Z" };
  assert.deepEqual(mergeJournals([a], [b, c]).map((e) => e.text), ["local", "solo nube"]);
  const borrado = { id: "1", ts: 1, deleted: true, text: "", updatedAt: "2026-11-09T10:00:00Z" };
  assert.equal(mergeJournals([a], [borrado])[0].deleted, true);

  // Un día de la nube más reciente no borra el diario local
  const local = [{ id: "d", date: "2026-11-08", rawChat: [], journal: [a], summary: "", updatedAt: "2026-11-08T10:00:00Z" }];
  const cloud = [{ date: "2026-11-08", data: { id: "d", date: "2026-11-08", rawChat: [], journal: [c], summary: "Resumen", updatedAt: "2026-11-09T10:00:00Z" } }];
  const { list } = mergeCloudDays(local, cloud);
  assert.deepEqual(list[0].journal.map((e) => e.id), ["1", "2"]);
  assert.equal(list[0].summary, "Resumen");
});

test("el bloque para Carl resume los últimos días y está vacío si no hay nada", () => {
  const now = new Date(2026, 10, 8, 23, 0);
  assert.equal(buildJournalPromptBlock([], { now }), "");
  let days = [];
  days = addEntryToDays(days, createEntry({ text: "Terminé lo de la app", mood: "good", ts: new Date(2026, 10, 8, 22, 5).getTime() }), buildDay);
  days = addEntryToDays(days, createEntry({ text: "Llegué tarde", ts: new Date(2026, 10, 7, 9, 0).getTime() }), buildDay);
  days = addEntryToDays(days, createEntry({ text: "Muy viejo", ts: new Date(2026, 9, 1, 9, 0).getTime() }), buildDay);
  const block = buildJournalPromptBlock(days, { now });
  assert.match(block, /DIARIO DEL USUARIO/);
  assert.match(block, /ayer .*Llegué tarde/);
  assert.match(block, /hoy .*\(bien\): Terminé lo de la app/);
  assert.ok(!block.includes("Muy viejo"));
  assert.ok(block.indexOf("Llegué tarde") < block.indexOf("Terminé"), "orden cronológico");
});
