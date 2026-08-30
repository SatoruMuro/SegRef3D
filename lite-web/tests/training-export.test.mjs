import assert from "node:assert/strict";
import test from "node:test";

import { parseNiftiLabelVolume } from "../medical-io.mjs";
import {
  TRAINING_CASE_FORMAT,
  createNiftiScalarVolume,
  createTrainingCaseEntries,
  prepareTrainingSourceChannels,
  readNiftiTrainingVolume,
} from "../training-export.mjs";
import { createZip, parseZip } from "../zip.mjs";

const CASE_ID = "SR3D_a83f21c9";

function geometry(shape = [4, 3, 2]) {
  return {
    shape,
    sourceKind: "test",
    affine: [
      [0, -0.7, 0.1, 12.5],
      [0.5, 0, -0.2, -8.25],
      [0, 0.05, 2.4, 31.75],
      [0, 0, 0, 1],
    ],
  };
}

function masks() {
  return [
    new Uint8Array([0, 1, 2, 5, 0, 0, 0, 0, 0, 0, 0, 0]),
    new Uint8Array([5, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  ];
}

function build(channels, overrides = {}) {
  return createTrainingCaseEntries({
    caseId: CASE_ID,
    sourceFormat: "nifti",
    channels,
    masks: masks(),
    width: 4,
    height: 3,
    geometry: geometry(),
    objectNames: Object.assign([], { 1: "Aorta", 2: "Object 2", 5: "Lesion" }),
    intensityPolicy: "original_scalar",
    ...overrides,
  });
}

async function entryBytes(result, name) {
  const item = result.entries.find((entry) => entry.name === name);
  assert.ok(item, `missing ${name}`);
  return new Uint8Array(await item.blob.arrayBuffer());
}

test("Training scalar volume preserves 4x3x2 values, spacing, affine, and labels", async () => {
  const values = new Int16Array(24);
  for (let index = 0; index < values.length; index += 1) values[index] = index * 7 - 40;
  const result = build([{ name: "scalar", values }]);
  const imageName = `imagesTr/${CASE_ID}_0000.nii`;
  const image = readNiftiTrainingVolume(await entryBytes(result, imageName));
  const label = parseNiftiLabelVolume(
    (await entryBytes(result, `labelsTr/${CASE_ID}.nii`)).buffer,
    `${CASE_ID}.nii`,
  );
  assert.deepEqual(image.shape, [4, 3, 2]);
  assert.deepEqual([...image.values], [...values]);
  assert.deepEqual(label.frames.map((frame) => [...frame]), masks().map((frame) => [...frame]));
  assert.deepEqual(image.spacing.map((value) => Number(value.toFixed(6))), label.spacing.map((value) => Number(value.toFixed(6))));
  image.affine.forEach((row, y) => row.forEach((value, x) => assert.ok(Math.abs(value - label.affine[y][x]) < 1e-5)));
});

test("Training affine retains anisotropic oblique axes and nonzero origin", () => {
  const source = geometry();
  const bytes = createNiftiScalarVolume({
    values: new Float32Array(24), width: 4, height: 3, depth: 2, geometry: source,
  });
  const parsed = readNiftiTrainingVolume(bytes);
  source.affine.forEach((row, y) => row.forEach((value, x) => {
    assert.ok(Math.abs(value - parsed.affine[y][x]) < 1e-5);
  }));
  assert.deepEqual(parsed.geometry.origin.map((value) => Number(value.toFixed(5))), [12.5, -8.25, 31.75]);
  assert.notEqual(parsed.spacing[0], parsed.spacing[1]);
});

test("RGB training export writes red, green, and blue as _0000, _0001, and _0002", async () => {
  const red = Uint8Array.from({ length: 24 }, (_, index) => index);
  const green = Uint8Array.from({ length: 24 }, (_, index) => 100 + index);
  const blue = Uint8Array.from({ length: 24 }, (_, index) => 240 - index);
  const result = build([
    { name: "red", values: red },
    { name: "green", values: green },
    { name: "blue", values: blue },
  ], { sourceFormat: "jpeg", intensityPolicy: "working_rgb_8bit" });
  for (const [index, expected] of [red, green, blue].entries()) {
    const parsed = readNiftiTrainingVolume(await entryBytes(result, `imagesTr/${CASE_ID}_${String(index).padStart(4, "0")}.nii`));
    assert.deepEqual([...parsed.values], [...expected]);
  }
  assert.equal(result.manifest.image.channel_count, 3);
  assert.deepEqual(result.manifest.image.channels.map((item) => item.name), ["red", "green", "blue"]);
});

test("working RGBA frames are split without alpha through the application source-preparation path", async () => {
  const images = Array.from({ length: 2 }, (_, z) => ({
    sourceFormat: "jpeg",
    sourceBitDepth: 8,
    basePixels: Uint8ClampedArray.from({ length: 12 * 4 }, (_, offset) => {
      const channel = offset % 4;
      const pixel = Math.floor(offset / 4);
      return channel === 3 ? 255 : z * 50 + pixel * 3 + channel;
    }),
  }));
  const prepared = await prepareTrainingSourceChannels({
    images, width: 4, height: 3, geometry: geometry(),
  });
  assert.equal(prepared.intensityPolicy, "working_rgb_8bit");
  assert.deepEqual(prepared.channels.map((channel) => channel.name), ["red", "green", "blue"]);
  assert.deepEqual(prepared.channels.map((channel) => channel.values[12]), [50, 51, 52]);
  assert.equal(prepared.channels.some((channel) => channel.values.includes(255)), false);
});

test("non-contiguous mask label IDs remain 0, 1, 2, and 5 without renumbering", async () => {
  const result = build([{ values: new Uint16Array(24) }]);
  const label = parseNiftiLabelVolume(
    (await entryBytes(result, `labelsTr/${CASE_ID}.nii`)).buffer,
    `${CASE_ID}.nii`,
  );
  assert.deepEqual([...new Set(label.frames.flatMap((frame) => [...frame]))].sort((a, b) => a - b), [0, 1, 2, 5]);
  assert.deepEqual(result.manifest.label.objects.map((item) => item.id), [1, 2, 5]);
  assert.deepEqual(result.manifest.label.objects.map((item) => item.name), ["Aorta", "Object 2", "Lesion"]);
});

test("manifest and ZIP carry the versioned one-case training layout", async () => {
  const result = build([{ values: new Float32Array(24) }]);
  const archive = await parseZip(await createZip(result.entries));
  assert.deepEqual(archive.map((item) => item.name).sort(), [
    `imagesTr/${CASE_ID}_0000.nii`,
    `labelsTr/${CASE_ID}.nii`,
    "manifest.json",
  ]);
  const manifestEntry = archive.find((item) => item.name === "manifest.json");
  const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.bytes));
  assert.equal(manifest.format, TRAINING_CASE_FORMAT);
  assert.equal(manifest.case_id, CASE_ID);
  assert.equal(manifest.image.channels[0].file, `imagesTr/${CASE_ID}_0000.nii`);
  assert.equal(manifest.label.file, `labelsTr/${CASE_ID}.nii`);
  assert.deepEqual(manifest.geometry.shape, [4, 3, 2]);
  assert.equal(manifest.privacy.dicom_headers_included, false);
});

test("Training export rejects image and mask shape or affine mismatch", () => {
  const wrongAffine = geometry();
  wrongAffine.affine = wrongAffine.affine.map((row) => [...row]);
  wrongAffine.affine[0][3] += 2;
  const encoded = createNiftiScalarVolume({
    values: new Int16Array(24), width: 4, height: 3, depth: 2, geometry: wrongAffine,
  });
  assert.throws(
    () => build([{ encodedBytes: encoded, compressed: false }]),
    /geometry mismatch.*affine/i,
  );
  assert.throws(
    () => build([{ values: new Int16Array(12) }]),
    /voxel count/i,
  );
});

test("manifest never copies DICOM PHI metadata supplied by a caller", async () => {
  const result = build([{ values: new Float32Array(24) }], {
    sourceFormat: "dicom",
    sourceMetadata: {
      PatientName: "DOE^JANE",
      PatientID: "MRN-12345",
      BirthDate: "19700101",
      StudyDate: "20260830",
      Institution: "Example Hospital",
      AccessionNumber: "ACC-999",
    },
  });
  const text = new TextDecoder().decode(await entryBytes(result, "manifest.json"));
  for (const forbidden of ["DOE^JANE", "MRN-12345", "19700101", "Example Hospital", "ACC-999", "PatientName", "PatientID"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal(result.manifest.privacy.patient_identifiers_in_manifest, false);
});

test("empty masks remain exportable negative cases", () => {
  const result = build([{ values: new Uint8Array(24) }], {
    masks: [new Uint8Array(12), new Uint8Array(12)],
  });
  assert.equal(result.emptyMask, true);
  assert.deepEqual(result.manifest.label.objects, []);
});
