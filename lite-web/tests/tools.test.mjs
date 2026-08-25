import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustedRgba,
  hexToRgb,
  rgbAt,
  rgbRaster,
  rgbToHex,
  thresholdRaster,
} from "../image-tools.mjs";
import {
  createBinaryStl,
  createNiftiLabelVolume,
  createTiffLabelStack,
  createVolInfoCsv,
  cropLabelVolume,
  interpolateLabelVolume,
  marchingTetrahedra,
  parseVolInfoCsv,
  signedDistanceForLabel,
} from "../volume-tools.mjs";

test("display adjustment preserves alpha and changes RGB channels", () => {
  const source = new Uint8ClampedArray([20, 40, 60, 200, 200, 220, 240, 255]);
  const output = adjustedRgba(source, {
    windowCenter: 127.5,
    windowWidth: 255,
    brightness: 10,
    contrast: 1,
  });
  assert.deepEqual([...output], [30, 50, 70, 200, 210, 230, 250, 255]);
  assert.deepEqual([...source], [20, 40, 60, 200, 200, 220, 240, 255]);
});

test("threshold and RGB extraction produce binary rasters", () => {
  const pixels = new Uint8ClampedArray([
    10, 10, 10, 255,
    120, 130, 140, 255,
    250, 250, 250, 255,
  ]);
  assert.deepEqual([...thresholdRaster(pixels, 100, 200)], [0, 255, 0]);
  assert.deepEqual(
    [...rgbRaster(pixels, { red: 125, green: 125, blue: 135 }, 10)],
    [0, 255, 0],
  );
  assert.deepEqual(rgbAt(pixels, 3, 1, 1, 0), { red: 120, green: 130, blue: 140 });
  assert.equal(rgbToHex({ red: 120, green: 130, blue: 140 }), "#78828c");
  assert.deepEqual(hexToRgb("#78828c"), { red: 120, green: 130, blue: 140 });
});

test("NIfTI export writes dimensions, spacing, and label voxels", () => {
  const bytes = createNiftiLabelVolume(
    [new Uint8Array([0, 1, 2, 3]), new Uint8Array([4, 5, 6, 7])],
    2,
    2,
    [0.5, 0.75, 2],
    [10, -20, 30.5],
  );
  const view = new DataView(bytes.buffer);
  assert.equal(view.getInt32(0, true), 348);
  assert.equal(view.getInt16(42, true), 2);
  assert.equal(view.getInt16(44, true), 2);
  assert.equal(view.getInt16(46, true), 2);
  assert.equal(view.getFloat32(80, true), 0.5);
  assert.equal(view.getFloat32(84, true), 0.75);
  assert.equal(view.getFloat32(88, true), 2);
  assert.equal(view.getFloat32(292, true), 10);
  assert.equal(view.getFloat32(308, true), -20);
  assert.equal(view.getFloat32(324, true), 30.5);
  assert.deepEqual([...bytes.slice(352)], [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("VolInfo CSV matches the desktop six-row format and round-trips metadata", () => {
  const source = {
    width: 540,
    height: 795,
    depth: 138,
    spacing: [0.004985571, 0.004985571, 0.036],
    origin: [-12.5, 3, 42.25],
  };
  const csv = createVolInfoCsv(source);
  assert.equal(
    csv,
    "Width,Height,Depth\r\n" +
      "540,795,138\r\n" +
      "X Spacing,Y Spacing,Z Spacing\r\n" +
      "0.004985571,0.004985571,0.036\r\n" +
      "X Origin,Y Origin,Z Origin\r\n" +
      "-12.5,3,42.25\r\n",
  );
  assert.deepEqual(parseVolInfoCsv(`\uFEFF${csv}`), source);
  assert.throws(
    () => parseVolInfoCsv(csv.replace("0.036", "0")),
    /positive numbers/,
  );
});

test("multi-page TIFF export chains one IFD per mask slice", () => {
  const bytes = createTiffLabelStack(
    [new Uint8Array([0, 1, 2, 3]), new Uint8Array([4, 5, 6, 7])],
    2,
    2,
  );
  const view = new DataView(bytes.buffer);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "II");
  assert.equal(view.getUint16(2, true), 42);
  const firstIfd = view.getUint32(4, true);
  assert.equal(view.getUint16(firstIfd, true), 9);
  const secondIfd = view.getUint32(firstIfd + 2 + 9 * 12, true);
  assert.ok(secondIfd > firstIfd);
  assert.equal(view.getUint32(secondIfd + 2 + 9 * 12, true), 0);
});

test("signed-distance interpolation bridges moving shapes between slices", () => {
  const left = new Uint8Array([
    0, 0, 0, 0, 0,
    0, 1, 1, 0, 0,
    0, 1, 1, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
  ]);
  const right = new Uint8Array([
    0, 0, 0, 0, 0,
    0, 0, 1, 1, 0,
    0, 0, 1, 1, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
  ]);
  const signed = signedDistanceForLabel(left, 5, 5, 1);
  assert.ok(signed[6] < 0);
  assert.ok(signed[0] > 0);
  const interpolated = interpolateLabelVolume([left, right], 5, 5, 1, 5);
  assert.equal(interpolated.depth, 6);
  assert.deepEqual([...interpolated.data.slice(0, 25)], [...left].map((value) => (value ? 1 : 0)));
  assert.deepEqual([...interpolated.data.slice(-25)], [...right].map((value) => (value ? 1 : 0)));
  assert.ok(interpolated.data.slice(2 * 25, 3 * 25).some((value) => value === 1));

  const tenfold = interpolateLabelVolume([left, right], 5, 5, 1, 10);
  assert.equal(tenfold.depth, 11);
  assert.deepEqual([...tenfold.data.slice(0, 25)], [...left].map((value) => (value ? 1 : 0)));
  assert.deepEqual([...tenfold.data.slice(-25)], [...right].map((value) => (value ? 1 : 0)));
});

test("label-volume cropping preserves masks and reports the original XY offset", () => {
  const first = new Uint8Array(8 * 6);
  const second = new Uint8Array(8 * 6);
  first[2 * 8 + 3] = 2;
  second[4 * 8 + 5] = 2;
  first[0] = 1;
  const cropped = cropLabelVolume([first, second], 8, 6, 2, 1);
  assert.equal(cropped.width, 5);
  assert.equal(cropped.height, 5);
  assert.equal(cropped.offsetX, 2);
  assert.equal(cropped.offsetY, 1);
  assert.equal(cropped.masks[0][1 * 5 + 1], 2);
  assert.equal(cropped.masks[1][3 * 5 + 3], 2);
  assert.equal(cropLabelVolume([first, second], 8, 6, 3), null);
});

test("marching tetrahedra creates a readable binary STL surface", () => {
  const volume = new Uint8Array(8);
  volume[0] = 1;
  const triangles = marchingTetrahedra(volume, 2, 2, 2, [1, 1, 2]);
  assert.ok(triangles.length > 0);
  const stl = createBinaryStl(triangles, "Obj 1");
  assert.equal(new DataView(stl.buffer).getUint32(80, true), triangles.length);
  assert.equal(stl.length, 84 + triangles.length * 50);
});

test("marching tetrahedra applies a crop origin without changing surface topology", () => {
  const volume = new Uint8Array(8);
  volume[0] = 1;
  const base = marchingTetrahedra(volume, 2, 2, 2, [0.5, 2, 3]);
  const shifted = marchingTetrahedra(volume, 2, 2, 2, [0.5, 2, 3], [10, 20, 0]);
  assert.equal(shifted.length, base.length);
  for (let triangleIndex = 0; triangleIndex < base.length; triangleIndex += 1) {
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
      assert.equal(shifted[triangleIndex][vertexIndex][0], base[triangleIndex][vertexIndex][0] + 10);
      assert.equal(shifted[triangleIndex][vertexIndex][1], base[triangleIndex][vertexIndex][1] + 20);
      assert.equal(shifted[triangleIndex][vertexIndex][2], base[triangleIndex][vertexIndex][2]);
    }
  }
});
