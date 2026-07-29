import assert from "node:assert/strict";
import test from "node:test";

import { makeOutputPlan, outputChunks, parseNifti } from "../nifti.mjs";

function syntheticNifti() {
  const dimensions = [3, 2, 2];
  const voxOffset = 352;
  const data = Uint8Array.from([
    1, 2, 3,
    4, 5, 6,
    7, 8, 9,
    10, 11, 12,
  ]);
  const bytes = new Uint8Array(voxOffset + data.length);
  const view = new DataView(bytes.buffer);

  view.setInt32(0, 348, true);
  view.setInt16(40, 3, true);
  dimensions.forEach((value, index) => view.setInt16(42 + index * 2, value, true));
  view.setInt16(70, 2, true);
  view.setInt16(72, 8, true);
  view.setFloat32(80, 0.5, true);
  view.setFloat32(84, 0.75, true);
  view.setFloat32(88, 6, true);
  view.setFloat32(108, voxOffset, true);
  view.setInt16(254, 1, true);
  view.setFloat32(280, 0.5, true);
  view.setFloat32(300, 0.75, true);
  view.setFloat32(320, 6, true);
  bytes.set([0x6e, 0x2b, 0x31, 0], 344);
  bytes.set(data, voxOffset);
  return bytes.buffer;
}

function joinChunks(chunks) {
  const values = [...chunks];
  const byteLength = values.reduce((sum, value) => sum + value.byteLength, 0);
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

test("parses a 3D uint8 labelmap and finds its sparse axis", () => {
  const parsed = parseNifti(syntheticNifti(), "sample.nii");
  assert.deepEqual(parsed.dimensions, [3, 2, 2]);
  assert.deepEqual(parsed.spacing, [0.5, 0.75, 6]);
  assert.equal(parsed.autoAxis, "z");
  assert.deepEqual(parsed.labels.values, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test("inserts blank z slices while preserving anchor slices and physical extent", () => {
  const parsed = parseNifti(syntheticNifti(), "sample.nii");
  const plan = makeOutputPlan(parsed, "z", 3);
  const output = joinChunks(outputChunks(parsed, plan));
  const outputView = new DataView(output.buffer);
  const outputData = output.subarray(parsed.voxOffset);

  assert.deepEqual(plan.dimensions, [3, 2, 4]);
  assert.equal(plan.spacing[2], 2);
  assert.equal(outputView.getInt16(46, true), 4);
  assert.equal(outputView.getFloat32(88, true), 2);
  assert.equal(outputView.getFloat32(320, true), 2);
  assert.deepEqual(
    [...outputData],
    [
      1, 2, 3, 4, 5, 6,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      7, 8, 9, 10, 11, 12,
    ],
  );
  assert.equal((parsed.dimensions[2] - 1) * parsed.spacing[2], 6);
  assert.equal((plan.dimensions[2] - 1) * plan.spacing[2], 6);
});

test("supports inserting blanks along x", () => {
  const parsed = parseNifti(syntheticNifti(), "sample.nii");
  const plan = makeOutputPlan(parsed, "x", 2);
  const output = joinChunks(outputChunks(parsed, plan)).subarray(parsed.voxOffset);

  assert.deepEqual(plan.dimensions, [5, 2, 2]);
  assert.deepEqual(
    [...output],
    [
      1, 0, 2, 0, 3,
      4, 0, 5, 0, 6,
      7, 0, 8, 0, 9,
      10, 0, 11, 0, 12,
    ],
  );
});

test("supports inserting blanks along y", () => {
  const parsed = parseNifti(syntheticNifti(), "sample.nii");
  const plan = makeOutputPlan(parsed, "y", 2);
  const output = joinChunks(outputChunks(parsed, plan)).subarray(parsed.voxOffset);

  assert.deepEqual(plan.dimensions, [3, 3, 2]);
  assert.deepEqual(
    [...output],
    [
      1, 2, 3,
      0, 0, 0,
      4, 5, 6,
      7, 8, 9,
      0, 0, 0,
      10, 11, 12,
    ],
  );
});
