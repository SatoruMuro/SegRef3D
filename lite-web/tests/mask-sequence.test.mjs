import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";

import {
  MASK_MANIFEST_FILENAME,
  MASK_SLICE_ORDER,
  canonicalMaskFilename,
  createLabelPngEntries,
  createMaskManifest,
  encodeLabelPng,
  exportMappingPreview,
  maskManifestBlob,
  validateMaskManifest,
} from "../mask-sequence.mjs";
import { createMaskStorageRecord } from "../storage.mjs";
import { createZip, parseZip } from "../zip.mjs";

function image(name, width, height, points = []) {
  const mask = new Uint8Array(width * height);
  for (const [x, y, value = 1] of points) mask[y * width + x] = value;
  return { name, width, height, mask };
}

function decodeGrayscalePng(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  assert.deepEqual([...bytes.subarray(0, 8)], signature);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat = [];
  let width = 0;
  let height = 0;
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset, false);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false);
      height = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, false);
      assert.equal(data[8], 8);
      assert.equal(data[9], 0);
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const compressed = new Uint8Array(idat.reduce((total, part) => total + part.length, 0));
  let compressedOffset = 0;
  for (const part of idat) {
    compressed.set(part, compressedOffset);
    compressedOffset += part.length;
  }
  const scanlines = new Uint8Array(inflateSync(compressed));
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    assert.equal(scanlines[row * (width + 1)], 0);
    mask.set(scanlines.subarray(row * (width + 1) + 1, (row + 1) * (width + 1)), row * width);
  }
  return { width, height, mask };
}

async function decodedPngEntry(entries, name) {
  const entry = entries.find((item) => item.name === name);
  assert.ok(entry, `${name} should exist`);
  return decodeGrayscalePng(new Uint8Array(await entry.blob.arrayBuffer()));
}

test("five canonical slices export pixel-for-pixel as mask0001 through mask0005", async () => {
  const points = [[0, 0], [4, 0], [2, 2], [0, 4], [4, 4]];
  const images = points.map(([x, y], z) => image(`slice${z + 1}`, 5, 5, [[x, y, z + 1]]));
  const entries = await createLabelPngEntries(images);

  assert.deepEqual(
    entries.filter((entry) => entry.name.endsWith(".png")).map((entry) => entry.name),
    ["mask0001.png", "mask0002.png", "mask0003.png", "mask0004.png", "mask0005.png"],
  );
  for (let z = 0; z < images.length; z += 1) {
    const decoded = await decodedPngEntry(entries, canonicalMaskFilename(z));
    assert.equal(decoded.width, 5);
    assert.equal(decoded.height, 5);
    assert.deepEqual(decoded.mask, images[z].mask);
  }
  const manifestEntry = entries.find((entry) => entry.name === MASK_MANIFEST_FILENAME);
  const manifest = JSON.parse(await manifestEntry.blob.text());
  assert.equal(manifest.sliceOrder, MASK_SLICE_ORDER);
  assert.deepEqual(manifest.files.map((file) => file.zIndex), [0, 1, 2, 3, 4]);
});

test("edge slices and distant z=10/z=400 never move to the reverse filename", async () => {
  assert.equal(canonicalMaskFilename(49), "mask0050.png");
  assert.equal(canonicalMaskFilename(99), "mask0100.png");
  assert.equal(canonicalMaskFilename(399), "mask0400.png");
  assert.equal(canonicalMaskFilename(511), "mask0512.png");
  const depth = 401;
  const images = Array.from({ length: depth }, (_, z) => image(`slice${z + 1}`, 3, 3));
  images[0].mask[0] = 1;
  images[10].mask[1] = 2;
  images[400].mask[8] = 3;
  const entries = await createLabelPngEntries(images);

  assert.equal((await decodedPngEntry(entries, "mask0001.png")).mask[0], 1);
  assert.equal((await decodedPngEntry(entries, "mask0011.png")).mask[1], 2);
  assert.equal((await decodedPngEntry(entries, "mask0401.png")).mask[8], 3);
  assert.equal((await decodedPngEntry(entries, "mask0002.png")).mask.some(Boolean), false);
  assert.deepEqual(exportMappingPreview(images), [
    "volume z=0 -> mask0001.png",
    "volume z=1 -> mask0002.png",
    "volume z=2 -> mask0003.png",
    "...",
    "volume z=398 -> mask0399.png",
    "volume z=399 -> mask0400.png",
    "volume z=400 -> mask0401.png",
  ]);
});

test("project ZIP carries the same canonical PNG mapping and root mask manifest", async () => {
  const images = [image("a", 2, 2, [[0, 0, 7]]), image("b", 2, 2, [[1, 1, 9]])];
  const entries = [
    { name: MASK_MANIFEST_FILENAME, blob: maskManifestBlob(images, { prefix: "label_png/" }) },
    ...await createLabelPngEntries(images, { prefix: "label_png/", includeManifest: false }),
  ];
  const parsed = await parseZip(await (await createZip(entries)).arrayBuffer());
  assert.deepEqual(parsed.map((entry) => entry.name), [
    MASK_MANIFEST_FILENAME,
    "label_png/mask0001.png",
    "label_png/mask0002.png",
  ]);
  const first = decodeGrayscalePng(parsed[1].bytes);
  const last = decodeGrayscalePng(parsed[2].bytes);
  assert.deepEqual(first.mask, images[0].mask);
  assert.deepEqual(last.mask, images[1].mask);
  const manifest = JSON.parse(new TextDecoder().decode(parsed[0].bytes));
  assert.deepEqual(manifest.files.map((file) => file.filename), [
    "label_png/mask0001.png",
    "label_png/mask0002.png",
  ]);
});

test("PNG encode and canonical reconstruction are a voxel-identical save/load round trip", async () => {
  const images = Array.from({ length: 5 }, (_, z) => image(`slice${z + 1}`, 4, 3, [[z % 4, z % 3, z + 1]]));
  const restored = [];
  for (const source of images) {
    restored.push(decodeGrayscalePng(await encodeLabelPng(source.mask, source.width, source.height)).mask);
  }
  restored.forEach((mask, z) => assert.deepEqual(mask, images[z].mask));
});

test("Lite IndexedDB autosave records canonical z metadata without changing mask bytes", () => {
  const mask = new Uint8Array([0, 4, 0, 0]);
  const record = createMaskStorageRecord("project", "slice011", 2, 2, mask, {
    zIndex: 10,
    sliceOrder: MASK_SLICE_ORDER,
  });
  assert.equal(record.zIndex, 10);
  assert.equal(record.sliceOrder, MASK_SLICE_ORDER);
  assert.deepEqual(new Uint8Array(record.mask), mask);
  mask[1] = 9;
  assert.equal(new Uint8Array(record.mask)[1], 4);
});

test("manifest reports non-uniform raster dimensions without inventing a shared grid", () => {
  const manifest = createMaskManifest([image("a", 2, 2), image("b", 3, 2)]);
  assert.equal(manifest.width, null);
  assert.equal(manifest.height, null);
  assert.deepEqual(manifest.files.map((file) => [file.width, file.height]), [[2, 2], [3, 2]]);
});

test("manifest validation accepts project paths but rejects reversed or off-by-one mappings", () => {
  const manifest = createMaskManifest([image("a", 2, 2), image("b", 2, 2)], {
    prefix: "label_png/",
  });
  assert.equal(validateMaskManifest(manifest), manifest);
  const reversed = structuredClone(manifest);
  reversed.files[0].filename = "label_png/mask0002.png";
  assert.throws(() => validateMaskManifest(reversed), /non-canonical mapping at z=0/);
  const offByOne = structuredClone(manifest);
  offByOne.files[1].displaySlice = 3;
  assert.throws(() => validateMaskManifest(offByOne), /non-canonical mapping at z=1/);
});
