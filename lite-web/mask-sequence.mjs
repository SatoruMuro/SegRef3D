export const MASK_MANIFEST_FILENAME = "segref3d-mask-manifest.json";
export const MASK_SCHEMA_VERSION = 2;
export const MASK_SLICE_ORDER = "segref3d-canonical-v1";

const textEncoder = new TextEncoder();
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

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

function writeUint32BigEndian(output, offset, value) {
  new DataView(output.buffer, output.byteOffset, output.byteLength).setUint32(offset, value >>> 0, false);
}

function pngChunk(type, data) {
  const typeBytes = textEncoder.encode(type);
  const output = new Uint8Array(12 + data.length);
  writeUint32BigEndian(output, 0, data.length);
  output.set(typeBytes, 4);
  output.set(data, 8);
  const checksumInput = new Uint8Array(typeBytes.length + data.length);
  checksumInput.set(typeBytes);
  checksumInput.set(data, typeBytes.length);
  writeUint32BigEndian(output, output.length - 4, crc32(checksumInput));
  return output;
}

function concatenate(parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function canonicalMaskFilename(zIndex) {
  if (!Number.isInteger(zIndex) || zIndex < 0) {
    throw new Error("zIndex must be a non-negative integer.");
  }
  return `mask${String(zIndex + 1).padStart(4, "0")}.png`;
}

export function canonicalMaskRecords(images, { prefix = "" } = {}) {
  return images.map((image, zIndex) => ({
    zIndex,
    displaySlice: zIndex + 1,
    filename: canonicalMaskFilename(zIndex),
    path: `${prefix}${canonicalMaskFilename(zIndex)}`,
    image,
  }));
}

export function createMaskManifest(images, {
  prefix = "",
  exportedBy = "SegRef3D Lite",
  edition = "Lite",
} = {}) {
  const records = canonicalMaskRecords(images, { prefix });
  const first = images[0];
  const sharedDimensions = Boolean(first) && images.every(
    (image) => image.width === first.width && image.height === first.height,
  );
  return {
    schemaVersion: MASK_SCHEMA_VERSION,
    sliceCount: images.length,
    width: sharedDimensions ? first.width : null,
    height: sharedDimensions ? first.height : null,
    sliceIndexBase: 1,
    sliceOrder: MASK_SLICE_ORDER,
    exportedBy,
    edition,
    files: records.map((record) => ({
      zIndex: record.zIndex,
      displaySlice: record.displaySlice,
      filename: record.path,
      width: record.image.width,
      height: record.image.height,
      sourceName: record.image.name,
    })),
  };
}

export function validateMaskManifest(manifest) {
  if (
    manifest?.schemaVersion !== MASK_SCHEMA_VERSION || manifest.sliceIndexBase !== 1 ||
    manifest.sliceOrder !== MASK_SLICE_ORDER || !Array.isArray(manifest.files)
  ) {
    throw new Error(`${MASK_MANIFEST_FILENAME} does not declare a supported canonical slice order.`);
  }
  if (manifest.sliceCount !== manifest.files.length) {
    throw new Error(`${MASK_MANIFEST_FILENAME} sliceCount does not match its file list.`);
  }
  manifest.files.forEach((file, zIndex) => {
    const basename = String(file.filename || "").replaceAll("\\", "/").split("/").at(-1);
    if (
      file.zIndex !== zIndex || file.displaySlice !== zIndex + 1 ||
      basename !== canonicalMaskFilename(zIndex)
    ) {
      throw new Error(`${MASK_MANIFEST_FILENAME} contains a non-canonical mapping at z=${zIndex}.`);
    }
  });
  return manifest;
}

export function maskManifestBlob(images, options = {}) {
  return new Blob(
    [`${JSON.stringify(createMaskManifest(images, options), null, 2)}\n`],
    { type: "application/json" },
  );
}

export function exportMappingPreview(images, edgeCount = 3) {
  const records = canonicalMaskRecords(images);
  const indices = records.slice(0, edgeCount).map((record) => record.zIndex);
  const tailStart = Math.max(edgeCount, records.length - edgeCount);
  for (let index = tailStart; index < records.length; index += 1) indices.push(index);
  const lines = indices.map(
    (index) => `volume z=${records[index].zIndex} -> ${records[index].filename}`,
  );
  if (records.length > edgeCount * 2) lines.splice(edgeCount, 0, "...");
  return lines;
}

export async function encodeLabelPng(mask, width, height) {
  if (!(mask instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error("Label PNG input must be a Uint8Array with integer dimensions.");
  }
  if (width < 1 || height < 1 || mask.length !== width * height) {
    throw new Error("Label PNG dimensions do not match the mask length.");
  }
  if (typeof CompressionStream !== "function") {
    throw new Error("This browser cannot encode compressed PNG files.");
  }

  const scanlines = new Uint8Array((width + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const target = row * (width + 1);
    scanlines[target] = 0;
    scanlines.set(mask.subarray(row * width, (row + 1) * width), target + 1);
  }
  const compressed = new Uint8Array(await new Response(
    new Blob([scanlines]).stream().pipeThrough(new CompressionStream("deflate")),
  ).arrayBuffer());
  const ihdr = new Uint8Array(13);
  writeUint32BigEndian(ihdr, 0, width);
  writeUint32BigEndian(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return concatenate([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

export async function createLabelPngEntries(images, {
  prefix = "",
  includeManifest = true,
  exportedBy = "SegRef3D Lite",
  onProgress = () => {},
} = {}) {
  const records = canonicalMaskRecords(images, { prefix });
  const entries = includeManifest
    ? [{
        name: `${prefix}${MASK_MANIFEST_FILENAME}`,
        blob: maskManifestBlob(images, { prefix, exportedBy }),
      }]
    : [];
  for (const record of records) {
    onProgress(record.zIndex + 1, records.length);
    const bytes = await encodeLabelPng(record.image.mask, record.image.width, record.image.height);
    entries.push({ name: record.path, blob: new Blob([bytes], { type: "image/png" }) });
  }
  return entries;
}
