const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
  };
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot open compressed ZIP files.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEndOfCentralDirectory(view) {
  const minimumOffset = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("The ZIP file is incomplete or unsupported.");
}

export async function parseZip(source) {
  const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const view = new DataView(buffer);
  const input = new Uint8Array(buffer);
  if (view.byteLength < 22) throw new Error("The ZIP file is empty or incomplete.");

  const endOffset = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0) throw new Error("Multi-disk ZIP files are unsupported.");
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 files are unsupported.");
  }
  if (entryCount > 10_000) throw new Error("The ZIP file contains too many entries.");

  const entries = [];
  let totalUncompressed = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("The ZIP directory is invalid.");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > view.byteLength) throw new Error("A ZIP entry name is invalid.");
    const name = textDecoder.decode(input.subarray(nameStart, nameEnd)).replaceAll("\\", "/");
    offset = nameEnd + extraLength + commentLength;

    if (flags & 0x0001) throw new Error(`Encrypted ZIP entry is unsupported: ${name}`);
    if (method !== 0 && method !== 8) {
      throw new Error(`Unsupported ZIP compression method ${method}: ${name}`);
    }
    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid ZIP entry: ${name}`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > view.byteLength) throw new Error(`Incomplete ZIP entry: ${name}`);

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > 1_000_000_000) {
      throw new Error("The expanded ZIP data exceeds the 1 GB browser safety limit.");
    }
    if (name.endsWith("/")) continue;

    const compressed = input.slice(dataStart, dataEnd);
    const bytes = method === 0 ? compressed : await inflateRaw(compressed);
    if (bytes.length !== uncompressedSize || crc32(bytes) !== checksum) {
      throw new Error(`ZIP integrity check failed: ${name}`);
    }
    entries.push({ name, bytes, blob: new Blob([bytes]) });
  }
  return entries;
}

export async function createZip(entries) {
  const prepared = [];
  let localSize = 0;
  for (const entry of entries) {
    const name = textEncoder.encode(entry.name.replaceAll("\\", "/"));
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    if (bytes.length > 0xffffffff) throw new Error("A file is too large for ZIP32.");
    const checksum = crc32(bytes);
    const stamp = dosDateTime(entry.modifiedAt ?? new Date());
    prepared.push({ name, bytes, checksum, stamp, offset: localSize });
    localSize += 30 + name.length + bytes.length;
  }

  const centralSize = prepared.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const totalSize = localSize + centralSize + 22;
  if (totalSize > 0xffffffff) throw new Error("ZIP output exceeds the 4 GB browser limit.");
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const output = new Uint8Array(buffer);
  let offset = 0;

  for (const entry of prepared) {
    writeUint32(view, offset, 0x04034b50);
    writeUint16(view, offset + 4, 20);
    writeUint16(view, offset + 6, 0x0800);
    writeUint16(view, offset + 8, 0);
    writeUint16(view, offset + 10, entry.stamp.time);
    writeUint16(view, offset + 12, entry.stamp.date);
    writeUint32(view, offset + 14, entry.checksum);
    writeUint32(view, offset + 18, entry.bytes.length);
    writeUint32(view, offset + 22, entry.bytes.length);
    writeUint16(view, offset + 26, entry.name.length);
    writeUint16(view, offset + 28, 0);
    output.set(entry.name, offset + 30);
    output.set(entry.bytes, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.bytes.length;
  }

  const centralOffset = offset;
  for (const entry of prepared) {
    writeUint32(view, offset, 0x02014b50);
    writeUint16(view, offset + 4, 20);
    writeUint16(view, offset + 6, 20);
    writeUint16(view, offset + 8, 0x0800);
    writeUint16(view, offset + 10, 0);
    writeUint16(view, offset + 12, entry.stamp.time);
    writeUint16(view, offset + 14, entry.stamp.date);
    writeUint32(view, offset + 16, entry.checksum);
    writeUint32(view, offset + 20, entry.bytes.length);
    writeUint32(view, offset + 24, entry.bytes.length);
    writeUint16(view, offset + 28, entry.name.length);
    writeUint16(view, offset + 30, 0);
    writeUint16(view, offset + 32, 0);
    writeUint16(view, offset + 34, 0);
    writeUint16(view, offset + 36, 0);
    writeUint32(view, offset + 38, 0);
    writeUint32(view, offset + 42, entry.offset);
    output.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  }

  writeUint32(view, offset, 0x06054b50);
  writeUint16(view, offset + 4, 0);
  writeUint16(view, offset + 6, 0);
  writeUint16(view, offset + 8, prepared.length);
  writeUint16(view, offset + 10, prepared.length);
  writeUint32(view, offset + 12, offset - centralOffset);
  writeUint32(view, offset + 16, centralOffset);
  writeUint16(view, offset + 20, 0);
  return new Blob([buffer], { type: "application/zip" });
}
