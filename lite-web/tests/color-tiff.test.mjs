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

test("Color TIFF round-trips every RGBA pixel, dimensions, alpha and page order", async () => {
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
    assert.deepEqual(page.t258, [8, 8, 8, 8]);
    assert.deepEqual(page.t262, [2]);
    assert.deepEqual(page.t274, [1]);
    assert.deepEqual(page.t338, [2]);
    assert.deepEqual(rgba, [...[first, second][index]]);
  }
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
  assert.equal(yields, 2);
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
  await assert.rejects(createColorTiffStack([null], 32768, 32768), /4 GiB/);
});
