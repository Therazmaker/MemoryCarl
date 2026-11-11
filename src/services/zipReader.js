/**
 * zipReader.js — Lector mínimo de archivos .zip en el navegador (sin librerías)
 * MemoryCarl
 *
 * Lee el directorio central del zip y descomprime una entrada con
 * DecompressionStream("deflate-raw"). Suficiente para exportaciones como la de Day One.
 */

function u16(v, o) { return v.getUint16(o, true); }
function u32(v, o) { return v.getUint32(o, true); }

/** Lista las entradas: [{ name, method, compSize, size, localOffset }] */
export function listZipEntries(buffer) {
  const v = new DataView(buffer);
  // Fin del directorio central: firma 0x06054b50, buscando desde el final
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("El archivo no es un .zip válido.");
  const count = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  const dec = new TextDecoder();
  const out = [];
  for (let k = 0; k < count; k++) {
    if (u32(v, p) !== 0x02014b50) throw new Error("El .zip está dañado.");
    const method = u16(v, p + 10);
    const compSize = u32(v, p + 20);
    const size = u32(v, p + 24);
    const nameLen = u16(v, p + 28);
    const extraLen = u16(v, p + 30);
    const commentLen = u16(v, p + 32);
    const localOffset = u32(v, p + 42);
    const name = dec.decode(new Uint8Array(buffer, p + 46, nameLen));
    out.push({ name, method, compSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Devuelve el contenido de una entrada como texto. */
export async function readZipEntryText(buffer, entry) {
  const v = new DataView(buffer);
  const p = entry.localOffset;
  if (u32(v, p) !== 0x04034b50) throw new Error("El .zip está dañado.");
  const start = p + 30 + u16(v, p + 26) + u16(v, p + 28);
  const data = new Uint8Array(buffer, start, entry.compSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error("Este .zip usa una compresión no soportada.");
  if (typeof DecompressionStream === "undefined") throw new Error("Este navegador no puede abrir .zip; descomprímelo y elige el .json.");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

/** Busca el primer .json del zip (o el que cumpla `match`) y lo devuelve como texto. */
export async function readJsonFromZip(buffer, match = (name) => /\.json$/i.test(name)) {
  const entries = listZipEntries(buffer).filter((e) => !e.name.endsWith("/") && !/^__MACOSX\//.test(e.name));
  const entry = entries.find((e) => match(e.name));
  if (!entry) throw new Error("No encontré un archivo .json dentro del .zip.");
  return { name: entry.name, text: await readZipEntryText(buffer, entry) };
}
