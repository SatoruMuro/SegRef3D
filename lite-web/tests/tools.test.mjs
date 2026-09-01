import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustedRgba,
  displayControlRange,
  hexToRgb,
  modalityToRgba,
  rgbAt,
  rgbRaster,
  rgbToHex,
  thresholdRaster,
  windowModalityValue,
} from "../image-tools.mjs";
import {
  createBinaryStl,
  createNiftiLabelVolume,
  createTiffLabelStack,
  createVolInfoCsv,
  cropLabelVolume,
  interpolateLabelVolume,
  interpolateMultiLabelVolume,
  marchingTetrahedra,
  parseVolInfoCsv,
  signedDistanceForLabel,
} from "../volume-tools.mjs";
import { parseNiftiLabelVolume } from "../medical-io.mjs";

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

test("DICOM modality renderer windows negative HU before brightness and contrast", () => {
  const hu = new Float32Array([-1000, -600, 0, 100, 1000]);
  const output = modalityToRgba(hu, {
    windowCenter: -600,
    windowWidth: 1500,
    brightness: 0,
    contrast: 1,
    photometricInterpretation: "MONOCHROME2",
  });
  assert.deepEqual(
    Array.from({ length: hu.length }, (_, index) => output[index * 4]),
    [60, 128, 230, 247, 255],
  );
  assert.equal(windowModalityValue(-2000, -600, 1500), 0);
  assert.equal(windowModalityValue(1000, -600, 1500), 255);
});

test("MONOCHROME1 inverts display bytes without changing modality values", () => {
  const modality = new Float32Array([-1000, 0, 1000]);
  const original = [...modality];
  const mono2 = modalityToRgba(modality, {
    windowCenter: 0,
    windowWidth: 2000,
    photometricInterpretation: "MONOCHROME2",
  });
  const mono1 = modalityToRgba(modality, {
    windowCenter: 0,
    windowWidth: 2000,
    photometricInterpretation: "MONOCHROME1",
  });
  for (let index = 0; index < modality.length; index += 1) {
    assert.equal(mono1[index * 4], 255 - mono2[index * 4]);
  }
  assert.deepEqual([...modality], original);
});

test("DICOM display controls include negative centers and widths above 255", () => {
  assert.deepEqual(
    displayControlRange(
      { minimum: -1187, maximum: 1723 },
      { windowCenter: -600, windowWidth: 1500 },
    ),
    {
      centerMinimum: -1187,
      centerMaximum: 1723,
      centerStep: 0.5,
      widthMaximum: 5820,
      widthStep: 0.5,
    },
  );
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

test("NIfTI export preserves a full oblique affine in sform", () => {
  const affine = [
    [-0.6875, -0.0065, 0.0559, 100.076588],
    [-0.0105, 0.0344, -3.7448, 23.749557],
    [0.006, -0.6866, -0.1883, 137.329995],
    [0, 0, 0, 1],
  ];
  const masks = [new Uint8Array([0, 1, 2, 3]), new Uint8Array([4, 5, 6, 7])];
  const bytes = createNiftiLabelVolume(masks, 2, 2, {
    shape: [2, 2, 2],
    affine,
    sourceKind: "synthetic-oblique",
  });
  const view = new DataView(bytes.buffer);
  assert.equal(view.getInt16(252, true), 0);
  assert.equal(view.getInt16(254, true), 1);
  const parsed = parseNiftiLabelVolume(bytes.buffer, "oblique-labels.nii");
  parsed.affine.forEach((row, y) => row.forEach((value, x) => {
    assert.ok(Math.abs(value - affine[y][x]) < 1e-4, `affine[${y}][${x}]`);
  }));
  assert.deepEqual([...parsed.frames[1]], [4, 5, 6, 7]);
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

test("VolInfo CSV adds an optional affine while retaining legacy import", () => {
  const source = {
    width: 4,
    height: 3,
    depth: 2,
    spacing: [0.7, 0.8, 2.5],
    origin: [12, -4, 8],
    affine: [
      [-0.7, 0.01, 0.2, 12],
      [0.02, 0.8, -0.1, -4],
      [0.03, -0.04, 2.5, 8],
      [0, 0, 0, 1],
    ],
    sourceKind: "dicom",
  };
  const csv = createVolInfoCsv(source);
  assert.match(csv, /IJK to RAS Row 1/);
  assert.match(csv, /Geometry Source/);
  const parsed = parseVolInfoCsv(csv);
  assert.deepEqual(parsed.affine, source.affine);
  assert.deepEqual(parsed.spacing, source.spacing);
  const legacy = csv.split("IJK to RAS Row 1")[0];
  assert.equal(parseVolInfoCsv(legacy).affine, undefined);
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

test("multi-label NIfTI interpolation preserves original slices and label IDs", async () => {
  const masks = Array.from({ length: 3 }, () => new Uint8Array(7 * 7));
  for (let y = 1; y < 4; y += 1) for (let x = 1; x < 4; x += 1) masks[0][y * 7 + x] = 1;
  for (let y = 2; y < 5; y += 1) for (let x = 2; x < 5; x += 1) masks[1][y * 7 + x] = 2;
  for (let y = 3; y < 6; y += 1) for (let x = 3; x < 6; x += 1) masks[2][y * 7 + x] = 3;

  for (const [factor, depth] of [[5, 11], [10, 21]]) {
    const result = await interpolateMultiLabelVolume(masks, 7, 7, factor, {
      yieldControl: async () => {},
    });
    assert.equal(result.depth, depth);
    masks.forEach((mask, index) => assert.deepEqual([...result.masks[index * factor]], [...mask]));
    const labels = new Set(result.masks.flatMap((mask) => [...mask]));
    assert.ok([0, 1, 2, 3].every((label) => labels.has(label)));
    assert.ok([...labels].every((label) => [0, 1, 2, 3].includes(label)));
  }
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
