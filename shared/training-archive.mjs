// Public, dependency-free archive boundary for training workflows (ZIP32 only).
export const CASE_LIMITS = Object.freeze({ archive: 536870912, expanded: 805306368, entries: 16 });
export const DATASET_LIMITS = Object.freeze({ archive: 1073741824, expanded: 1073741824, entries: 65 });
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crcUpdate(crc, bytes) {
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc;
}
export function safeArchivePath(name) {
  if (typeof name !== "string" || name.length > 240 || !/^[A-Za-z0-9_./-]+$/.test(name)
      || name.startsWith("/") || name.split("/").some(p => !p || p === "." || p === "..")) {
    throw new Error(`Unsafe ZIP path: ${String(name).slice(0, 80)}`);
  }
  return name;
}
export async function boundedDecompress(blob, format, limit) {
  if (typeof DecompressionStream !== "function") throw new Error("This browser needs DecompressionStream support.");
  const reader = blob.stream().pipeThrough(new DecompressionStream(format)).getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Expanded data exceeds the safety limit.");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function readSafeZip(source, limits = CASE_LIMITS) {
  const blob = source instanceof Blob ? source : new Blob([source]);
  if (blob.size < 22 || blob.size > limits.archive) throw new Error("ZIP archive size exceeds the safety limit or is incomplete.");
  const tailStart = Math.max(0, blob.size - 65557);
  const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
  let end = tail.byteLength - 22;
  while (end >= 0 && (tail.getUint32(end, true) !== 0x06054b50
    || end + 22 + tail.getUint16(end + 20, true) !== tail.byteLength)) end--;
  if (end < 0) throw new Error("Missing ZIP directory.");
  const count = tail.getUint16(end + 10, true);
  const size = tail.getUint32(end + 12, true);
  const start = tail.getUint32(end + 16, true);
  if (tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true)
      || tail.getUint16(end + 8, true) !== count || count < 1 || count > limits.entries
      || start + size !== tailStart + end) throw new Error("Unsupported ZIP directory or entry count.");
  const directory = new Uint8Array(await blob.slice(start, start + size).arrayBuffer());
  const view = new DataView(directory.buffer);
  const specs = [], seen = new Set();
  let offset = 0, total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > size || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Invalid ZIP directory entry.");
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true), expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > size) throw new Error("Invalid ZIP filename length.");
    const name = safeArchivePath(decoder.decode(directory.subarray(offset + 46, offset + 46 + nameLength)));
    const mode = view.getUint32(offset + 38, true) >>> 16;
    if (seen.has(name.toLowerCase())) throw new Error("Duplicate ZIP path.");
    seen.add(name.toLowerCase());
    if ((flags & ~0x808) || ![0, 8].includes(method) || (mode & 0xf000) === 0xa000
        || view.getUint16(offset + 34, true)) throw new Error("Encrypted, linked or unsupported ZIP entry.");
    total += expanded;
    if (total > limits.expanded || expanded > CASE_LIMITS.expanded || compressed === 0xffffffff) throw new Error("Expanded ZIP exceeds the safety limit.");
    const local = view.getUint32(offset + 42, true);
    if (local + 30 > start) throw new Error("Invalid local ZIP offset.");
    const header = new DataView(await blob.slice(local, local + 30).arrayBuffer());
    const localNameLength = header.getUint16(26, true);
    const dataStart = local + 30 + localNameLength + header.getUint16(28, true);
    const localName = decoder.decode(await blob.slice(local + 30, local + 30 + localNameLength).arrayBuffer());
    if (header.getUint32(0, true) !== 0x04034b50 || header.getUint16(6, true) !== flags
        || header.getUint16(8, true) !== method || localName !== name || dataStart + compressed > start
        || (!(flags & 8) && (header.getUint32(18, true) !== compressed || header.getUint32(22, true) !== expanded))) {
      throw new Error("Local and central ZIP headers disagree.");
    }
    specs.push({ name, method, compressed, expanded, checksum: view.getUint32(offset + 16, true), local, dataStart });
    offset = next;
  }
  if (offset !== size) throw new Error("Invalid ZIP directory size.");
  const ranges = [...specs].sort((a, b) => a.local - b.local);
  for (let i = 1; i < ranges.length; i++) if (ranges[i].local < ranges[i-1].dataStart + ranges[i-1].compressed) throw new Error("Overlapping ZIP entries.");
  const files = new Map();
  for (const spec of specs) {
    const part = blob.slice(spec.dataStart, spec.dataStart + spec.compressed);
    const bytes = spec.method === 0 ? new Uint8Array(await part.arrayBuffer()) : await boundedDecompress(part, "deflate-raw", spec.expanded);
    if (bytes.length !== spec.expanded || ((crcUpdate(0xffffffff, bytes) ^ 0xffffffff) >>> 0) !== spec.checksum) throw new Error("ZIP integrity check failed.");
    files.set(spec.name, bytes);
  }
  return files;
}
// Blob parts reference each original nested ZIP; no full dataset ArrayBuffer copy.
export async function createStoredZip(entries, onProgress = () => {}) {
  if (entries.length > DATASET_LIMITS.entries) throw new Error("Too many dataset cases.");
  const parts = [], central = [], names = new Set();
  let offset = 0;
  for (const entry of entries) {
    safeArchivePath(entry.name);
    if (names.has(entry.name)) throw new Error("Duplicate ZIP entry.");
    names.add(entry.name);
    const name = encoder.encode(entry.name), blob = entry.blob;
    if (offset + blob.size + 76 + 2 * name.length > DATASET_LIMITS.archive) throw new Error("Dataset exceeds the 1 GiB browser limit.");
    let crc = 0xffffffff;
    const reader = blob.stream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      crc = crcUpdate(crc, value);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
    h.setUint16(12, 33, true); h.setUint32(14, crc, true);
    h.setUint32(18, blob.size, true); h.setUint32(22, blob.size, true); h.setUint16(26, name.length, true);
    header.set(name, 30);
    const dir = new Uint8Array(46 + name.length), d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true);
    d.setUint16(8, 0x800, true); d.setUint16(14, 33, true); d.setUint32(16, crc, true);
    d.setUint32(20, blob.size, true); d.setUint32(24, blob.size, true); d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true); dir.set(name, 46);
    parts.push(header, blob); central.push(dir); offset += header.length + blob.size;
    onProgress(entry.name);
  }
  const centralSize = central.reduce((sum, p) => sum + p.length, 0);
  if (offset + centralSize + 22 > DATASET_LIMITS.archive) throw new Error("Dataset exceeds the 1 GiB browser limit.");
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true);
  view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
