import assert from "node:assert/strict";
import test from "node:test";
import UTIF from "../vendor/utif.module.js";
import { createColorTiffStack, createTiffLabelStack } from "../volume-tools.mjs";

function decode(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const pages = UTIF.decode(buffer);
  return pages.map((page) => {
    UTIF.decodeImage(buffer, page, pages);
    return { page, rgba: [...UTIF.toRGBA8(page)] };
  });
}

const rgbChannels = rgba => [...rgba].filter((_, index) => index % 4 !== 3);

test("Color TIFF preserves every RGB pixel, dimensions and page order as 24-bit RGB", async () => {
  const first = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
    12, 34, 56, 128, 77, 88, 99, 0,
  ]);
  const second = new Uint8Array(first).reverse();
  const progress = [];
  let yields = 0;
  const result = decode(await createColorTiffStack([first, second], 2, 3, {
    onProgress: (...args) => progress.push(args),
    yieldControl: async () => { yields += 1; },
  }));
  assert.equal(result.length, 2);
  for (const [index, { page, rgba }] of result.entries()) {
    assert.equal(page.width, 2);
    assert.equal(page.height, 3);
    assert.deepEqual(page.t258, [8, 8, 8]);
    assert.deepEqual(page.t262, [2]);
    assert.deepEqual(page.t274, [1]);
    assert.deepEqual(page.t277, [3]);
    assert.deepEqual(page.t259, [1]);
    assert.deepEqual(page.t284, [1]);
    assert.equal(Object.hasOwn(page, "t338"), false);
    assert.deepEqual(rgbChannels(rgba), rgbChannels([first, second][index]));
    assert.deepEqual([...page.data], rgbChannels([first, second][index]));
  }
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
  assert.equal(yields, 2);
});

test("alpha is discarded without changing RGB, including fully transparent colors", async () => {
  const source = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0]);
  const opaque = source.map((value, index) => index % 4 === 3 ? 255 : value);
  const bytes = await createColorTiffStack([source, opaque], 3, 1);
  const allOpaqueBytes = await createColorTiffStack([opaque, opaque], 3, 1);
  assert.deepEqual(bytes, allOpaqueBytes, "alpha alone cannot affect output bytes");
  for (const { page, rgba } of decode(bytes)) {
    assert.deepEqual([...page.data], [255, 0, 0, 0, 255, 0, 0, 0, 255]);
    assert.deepEqual(rgbChannels(rgba), rgbChannels(source));
    assert.deepEqual(page.t279, [9], "strip byte count excludes alignment padding");
    assert.equal(page.t273[0] % 2, 0);
  }
  // Classic TIFF requires word-aligned IFD offsets, even with odd RGB strips.
  const view = new DataView(bytes.buffer);
  let offset = view.getUint32(4, true);
  let count = 0;
  while (offset) {
    assert.equal(offset % 2, 0);
    count += 1;
    offset = view.getUint32(offset + 2 + view.getUint16(offset, true) * 12, true);
  }
  assert.equal(count, 2);
  assert.deepEqual([...source], [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0]);
});

test("existing TIFF remains an 8-bit scalar label stack in the same z order", () => {
  const masks = [new Uint8Array([0, 1, 2, 20]), new Uint8Array([4, 3, 2, 1])];
  const result = decode(createTiffLabelStack(masks, 2, 2));
  result.forEach(({ page, rgba }, index) => {
    assert.deepEqual(page.t262, [1]);
    assert.deepEqual(page.t277, [1]);
    assert.deepEqual(rgba, [...masks[index]].flatMap(value => [value, value, value, 255]));
  });
});

test("gray rasters remain gray; source reader ignores masks and display pixels", async () => {
  const original = new Uint8Array([31, 31, 31, 255]);
  const slice = { original, mask: new Uint8Array([20]), display: new Uint8Array([255, 0, 0, 255]) };
  const bytes = await createColorTiffStack([slice], 1, 1, { readRgba: image => image.original });
  assert.deepEqual(decode(bytes)[0].rgba, [...original]);
});

test("Color TIFF rejects invalid dimensions, pixels and classic TIFF overflow", async () => {
  await assert.rejects(createColorTiffStack([], 1, 1), /empty/);
  for (const [width, height] of [[0, 1], [-1, 1], [1, -1], [1.5, 2], [NaN, 1]]) {
    await assert.rejects(createColorTiffStack([new Uint8Array(4)], width, height), /dimensions/);
  }
  await assert.rejects(createColorTiffStack([new Uint8Array(3)], 1, 1), /RGBA dimensions/);
  await assert.rejects(createColorTiffStack([new Float32Array(4)], 1, 1), /RGBA dimensions/);
  await assert.rejects(createColorTiffStack([null], 65536, 32768), /4 GiB/);
});
