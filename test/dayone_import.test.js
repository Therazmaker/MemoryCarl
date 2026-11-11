import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import { parseDayOneExport, buildMemoriesFromDayOne, splitTitleAndBody, localDateOf } from "../src/memory/dayoneImport.js";
import { readJsonFromZip } from "../src/services/zipReader.js";

const entry = (uuid, text, creationDate, extra = {}) => ({ uuid, text, creationDate, timeZone: "America/Lima", starred: false, isPinned: false, ...extra });

const neurons = [
  { id: "n_lucas", type: "person", core: { concept: "Lucas", domain: "relationships", summary: "Amigo" }, triggers: ["lucas", "amigo"] },
  { id: "n_lucas_trab", type: "work_context", core: { concept: "Lucas: su trabajo en la tienda", domain: "work", summary: "" }, triggers: ["lucas", "tienda"] },
  { id: "n_marta", type: "person", core: { concept: "Señora Marta", domain: "relationships", summary: "Vecina" }, triggers: ["marta"] },
  { id: "n_deudas", type: "pattern", core: { concept: "Deudas", domain: "finance", summary: "" }, triggers: ["deuda", "préstamo"] },
];

const entries = [
  entry("AAA1", "# Día con Lucas\n\nFuimos con Lucas al parque\\. Hablamos de la tienda y de su préstamo.", "2023-05-02T03:30:00Z"),
  entry("AAA2", "# Visita\n\nLa señora Marta trajo pan. ![](dayone-moment://XYZ)", "2023-06-10T15:00:00Z", { tags: ["Familia"] }),
  entry("AAA3", "", "2023-06-11T15:00:00Z"),
  entry("AAA4", "![](dayone-moment://ABC)", "2023-06-12T15:00:00Z"),
  entry("AAA5", "# Visita\n\nLa señora Marta trajo pan. ![](dayone-moment://XYZ)", "2023-06-13T15:00:00Z"),
  entry("AAA6", "Pagué una deuda y otro préstamo. Me siento más liviano con las cuentas.", "2024-01-20T20:00:00Z", { starred: true }),
];

test("título, cuerpo y fecha local", () => {
  assert.deepEqual(splitTitleAndBody("# Hola\n\nTexto \\- con escape ![](dayone-moment://Z)"), { title: "Hola", body: "Texto - con escape" });
  assert.equal(localDateOf("2023-05-02T03:30:00Z", "America/Lima"), "2023-05-01", "de noche en Lima sigue siendo el día anterior");
  assert.throws(() => parseDayOneExport({ foo: 1 }), /Day One/);
});

test("cada entrada es una memoria; se omiten vacías, solo-foto y repetidas", () => {
  const { memories, skipped, range } = buildMemoriesFromDayOne(entries, { neurons });
  assert.equal(memories.length, 3);
  assert.deepEqual(skipped, { empty: 1, duplicate: 1, photoOnly: 1, already: 0 });
  assert.deepEqual(range, { from: "2023-05-01", to: "2024-01-20" });
  const m = memories[0];
  assert.equal(m.id, "mem_dayone_aaa1");
  assert.equal(m.title, "Día con Lucas");
  assert.ok(!m.text.startsWith("#") && m.text.includes("parque."));
  assert.equal(m.source, "dayone");
  assert.equal(m.temporal.stage, "past");
  assert.equal(memories[1].tags[0], "Familia", "las etiquetas de Day One se conservan primero");
  assert.equal(memories[2].importance, "high", "las destacadas quedan como importantes");
});

test("enlaces a neuronas: el nombre va solo a la neurona de la persona", () => {
  const { memories } = buildMemoriesFromDayOne(entries, { neurons });
  assert.deepEqual(memories[0].linkedNeurons.includes("n_lucas"), true);
  // "Lucas: su trabajo…" no se lleva el nombre, y un solo trigger ("tienda") no alcanza
  assert.ok(!memories[0].linkedNeurons.includes("n_lucas_trab"));
  assert.deepEqual(memories[1].linkedNeurons, ["n_marta"], "\"Señora Marta\" se reconoce como Marta");
  assert.ok(memories[2].linkedNeurons.includes("n_deudas"), "dos triggers (deuda + préstamo) bastan");
});

test("volver a importar el mismo archivo no duplica", () => {
  const first = buildMemoriesFromDayOne(entries, { neurons });
  const again = buildMemoriesFromDayOne(entries, { neurons, existingIds: first.memories.map((m) => m.id) });
  assert.equal(again.memories.length, 0);
  assert.equal(again.skipped.already, 3);
});

// Zip mínimo (una entrada deflate) para probar el lector
function makeZip(name, text) {
  const data = Buffer.from(text, "utf8");
  const comp = zlib.deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + comp.length;
  const cd = Buffer.concat([central, nameBuf]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(cdOffset, 16);
  const all = Buffer.concat([local, nameBuf, comp, cd, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}

test("lee el .json dentro de un .zip", async () => {
  const json = JSON.stringify({ metadata: { version: "1.0" }, entries: [entry("Z1", "# Hola\n\nUn día tranquilo en casa", "2023-01-01T12:00:00Z")] });
  const { name, text } = await readJsonFromZip(makeZip("Diario.json", json));
  assert.equal(name, "Diario.json");
  assert.equal(parseDayOneExport(text).length, 1);
});
