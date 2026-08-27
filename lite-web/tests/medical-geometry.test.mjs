import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  makeVolumeGeometry,
  transformGeometryForPreparedImage,
  upsampleGeometryAlongK,
} from "../medical-geometry.mjs";
import { parseNiftiLabelVolume } from "../medical-io.mjs";
import { createNiftiLabelVolume } from "../volume-tools.mjs";


test("Web and desktop parity fixture derives the same spacing, origin, and direction", () => {
  const affine = [
    [-0.6875, -0.0065, 0.0559, 100.076588],
    [-0.0105, 0.0344, -3.7448, 23.749557],
    [0.006, -0.6866, -0.1883, 137.329995],
    [0, 0, 0, 1],
  ];
  const geometry = makeVolumeGeometry({ shape: [320, 320, 25], affine, sourceKind: "parity-fixture" });
  geometry.origin.forEach((value, index) => assert.ok(Math.abs(value - affine[index][3]) < 1e-10));
  const expectedSpacing = [0, 1, 2].map((column) =>
    Math.hypot(affine[0][column], affine[1][column], affine[2][column]));
  geometry.spacing.forEach((value, index) => assert.ok(Math.abs(value - expectedSpacing[index]) < 1e-10));
  geometry.direction.forEach((row, y) => row.forEach((value, x) => {
    assert.ok(Math.abs(value - affine[y][x] / expectedSpacing[x]) < 1e-10);
  }));
});

test("Web and desktop export the same shared affine and label voxels", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("../../test-data/volume_geometry_parity.json", import.meta.url),
    "utf8",
  ));
  const [width, height, depth] = fixture.shape;
  const geometry = makeVolumeGeometry({
    shape: fixture.shape,
    affine: fixture.affine,
    sourceKind: "desktop-web-parity",
  });
  const masks = fixture.labels.map((values) => Uint8Array.from(values));

  const bytes = createNiftiLabelVolume(masks, width, height, geometry);
  const reopened = parseNiftiLabelVolume(bytes.buffer, "parity-labels.nii");

  assert.deepEqual([reopened.width, reopened.height, reopened.depth], [width, height, depth]);
  reopened.affine.forEach((row, y) => row.forEach((value, x) => {
    assert.ok(Math.abs(value - fixture.affine[y][x]) < 1e-5);
  }));
  assert.deepEqual(reopened.frames.map((frame) => [...frame]), fixture.labels);
});

test("resizing and shared-canvas placement update the affine without losing physical coordinates", () => {
  const source = makeVolumeGeometry({
    shape: [2000, 1000, 3],
    affine: [[-0.5, 0, 0, 40], [0, 0.5, 0, -20], [0, 0, 2, 5], [0, 0, 0, 1]],
    sourceKind: "dicom",
  });
  const prepared = transformGeometryForPreparedImage(source, {
    sourceWidth: 2000,
    sourceHeight: 1000,
    contentWidth: 1000,
    contentHeight: 500,
    outputWidth: 1200,
    outputHeight: 700,
    contentX: 100,
    contentY: 100,
  });
  assert.deepEqual(prepared.shape, [1200, 700, 3]);
  const preparedPoint = [350, 200, 1, 1];
  const sourcePoint = [(350 - 100) * 2, (200 - 100) * 2, 1, 1];
  const apply = (affine, point) => affine.map((row) => row.reduce((sum, value, index) => sum + value * point[index], 0));
  const expected = apply(source.affine, sourcePoint);
  const actual = apply(prepared.affine, preparedPoint);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-10));
});

test("5x and 10x K interpolation preserve oblique endpoint world coordinates", () => {
  const spacing = [0.6875, 0.6875, 3.75];
  const direction = [
    [-0.9998, -0.0095, 0.0149],
    [-0.0153, 0.0501, -0.9986],
    [0.0087, -0.9987, -0.0502],
  ];
  for (let column = 0; column < 3; column += 1) {
    const length = Math.hypot(direction[0][column], direction[1][column], direction[2][column]);
    for (let row = 0; row < 3; row += 1) direction[row][column] /= length;
  }
  const affine = direction.map((row, y) => [
    row[0] * spacing[0], row[1] * spacing[1], row[2] * spacing[2],
    [100.076588, 23.749557, 137.329995][y],
  ]);
  affine.push([0, 0, 0, 1]);
  const source = makeVolumeGeometry({ shape: [320, 320, 25], affine, sourceKind: "pelvic-mri" });
  const five = upsampleGeometryAlongK(source, 5);
  const ten = upsampleGeometryAlongK(source, 10);
  assert.deepEqual(five.shape, [320, 320, 121]);
  assert.deepEqual(ten.shape, [320, 320, 241]);
  [0.6875, 0.6875, 0.75].forEach((value, index) => assert.ok(Math.abs(five.spacing[index] - value) < 1e-10));
  [0.6875, 0.6875, 0.375].forEach((value, index) => assert.ok(Math.abs(ten.spacing[index] - value) < 1e-10));
  const apply = (matrix, point) => matrix.map((row) => row.reduce((sum, value, index) => sum + value * point[index], 0));
  for (const [i, j, k] of [[0, 0, 0], [17, 29, 12], [319, 319, 24]]) {
    const expected = apply(source.affine, [i, j, k, 1]);
    const world5 = apply(five.affine, [i, j, k * 5, 1]);
    const world10 = apply(ten.affine, [i, j, k * 10, 1]);
    world5.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-10));
    world10.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-10));
  }
});
