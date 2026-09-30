/**
 * Lightweight ID3v2 / Metadata parser for MP3 & audio files in pure JS.
 * Extracts Title, Artist, Album, Year, Genre, and Embedded Cover Art (APIC frame).
 */

export async function parseAudioMetadata(file) {
  const fallback = {
    title: file.name.replace(/\.[^/.]+$/, ""),
    artist: "Artista desconocido",
    album: "Álbum desconocido",
    year: "",
    genre: "",
    duration: 0,
    coverBlobUrl: null
  };

  try {
    // Read first 128KB of the file for ID3v2 headers
    const slice = file.slice(0, 131072);
    const arrayBuffer = await slice.arrayBuffer();
    const view = new DataView(arrayBuffer);

    // Check ID3 magic bytes "ID3"
    if (
      arrayBuffer.byteLength < 10 ||
      view.getUint8(0) !== 0x49 || // 'I'
      view.getUint8(1) !== 0x44 || // 'D'
      view.getUint8(2) !== 0x33    // '3'
    ) {
      return fallback;
    }

    const version = view.getUint8(3); // 3 for ID3v2.3, 4 for ID3v2.4
    const flags = view.getUint8(5);
    const tagSize = parseSyncsafe32(view, 6);

    let offset = 10;
    // Check for extended header
    if ((flags & 0x40) !== 0 && version >= 3) {
      const extSize = parseSyncsafe32(view, 10);
      offset += extSize;
    }

    const metadata = { ...fallback };
    const maxOffset = Math.min(arrayBuffer.byteLength - 10, offset + tagSize);

    while (offset < maxOffset) {
      // Need at least 10 bytes for frame header
      if (offset + 10 > arrayBuffer.byteLength) break;

      let frameId = "";
      for (let i = 0; i < 4; i++) {
        const charCode = view.getUint8(offset + i);
        if (charCode >= 32 && charCode <= 126) {
          frameId += String.fromCharCode(charCode);
        }
      }

      if (frameId.length < 4 || frameId.charCodeAt(0) === 0) break;

      let frameSize = 0;
      if (version === 4) {
        frameSize = parseSyncsafe32(view, offset + 4);
      } else {
        frameSize = view.getUint32(offset + 4, false);
      }

      if (frameSize <= 0 || offset + 10 + frameSize > arrayBuffer.byteLength) {
        break;
      }

      const frameDataOffset = offset + 10;

      if (frameId === "TIT2" || frameId === "TT2") {
        metadata.title = parseTextFrame(view, frameDataOffset, frameSize) || metadata.title;
      } else if (frameId === "TPE1" || frameId === "TP1") {
        metadata.artist = parseTextFrame(view, frameDataOffset, frameSize) || metadata.artist;
      } else if (frameId === "TALB" || frameId === "TAL") {
        metadata.album = parseTextFrame(view, frameDataOffset, frameSize) || metadata.album;
      } else if (frameId === "TYER" || frameId === "TDRC") {
        metadata.year = parseTextFrame(view, frameDataOffset, frameSize) || metadata.year;
      } else if (frameId === "TCON") {
        metadata.genre = parseTextFrame(view, frameDataOffset, frameSize) || metadata.genre;
      } else if (frameId === "APIC" || frameId === "PIC") {
        const cover = parseApicFrame(view, frameDataOffset, frameSize);
        if (cover) {
          metadata.coverBlobUrl = cover;
        }
      }

      offset += 10 + frameSize;
    }

    return metadata;
  } catch (err) {
    console.warn("ID3 parsing error:", err);
    return fallback;
  }
}

function parseSyncsafe32(view, offset) {
  const b0 = view.getUint8(offset);
  const b1 = view.getUint8(offset + 1);
  const b2 = view.getUint8(offset + 2);
  const b3 = view.getUint8(offset + 3);
  return (b0 << 21) | (b1 << 14) | (b2 << 7) | b3;
}

function parseTextFrame(view, offset, length) {
  if (length <= 1) return "";
  const encoding = view.getUint8(offset);
  const dataOffset = offset + 1;
  const dataLength = length - 1;

  try {
    const bytes = new Uint8Array(view.buffer, view.byteOffset + dataOffset, dataLength);
    let decoderName = "iso-8859-1";
    if (encoding === 1) decoderName = "utf-16";
    else if (encoding === 2) decoderName = "utf-16be";
    else if (encoding === 3) decoderName = "utf-8";

    const text = new TextDecoder(decoderName).decode(bytes);
    return text.replace(/\0/g, "").trim();
  } catch (e) {
    return "";
  }
}

function parseApicFrame(view, offset, length) {
  try {
    const encoding = view.getUint8(offset);
    let cursor = offset + 1;

    // Read MIME type (null terminated ASCII string)
    let mimeType = "";
    while (cursor < offset + length) {
      const charCode = view.getUint8(cursor);
      cursor++;
      if (charCode === 0) break;
      mimeType += String.fromCharCode(charCode);
    }

    if (!mimeType) mimeType = "image/jpeg";

    // Picture type (1 byte)
    cursor++; // skip picture type

    // Description (null terminated)
    if (encoding === 1 || encoding === 2) {
      // UTF-16
      while (cursor + 1 < offset + length) {
        const b1 = view.getUint8(cursor);
        const b2 = view.getUint8(cursor + 1);
        cursor += 2;
        if (b1 === 0 && b2 === 0) break;
      }
    } else {
      // ISO-8859-1 / UTF-8
      while (cursor < offset + length) {
        const b1 = view.getUint8(cursor);
        cursor++;
        if (b1 === 0) break;
      }
    }

    const imageLength = offset + length - cursor;
    if (imageLength <= 0) return null;

    const imgBytes = new Uint8Array(view.buffer, view.byteOffset + cursor, imageLength);
    let binary = "";
    const len = imgBytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(imgBytes[i]);
    }
    const base64 = btoa(binary);
    return `data:${mimeType};base64,${base64}`;
  } catch (e) {
    return null;
  }
}
