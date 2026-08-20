const textEncoder = new TextEncoder();

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
