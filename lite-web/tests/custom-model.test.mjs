import assert from "node:assert/strict";
import test from "node:test";

import {
  INFERENCE_REQUEST_FORMAT,
  applyCustomPrediction,
  createInferenceRequestEntries,
  loadModelZip,
  prepareCanonicalInferenceChannels,
  sha256Hex,
  validateInferenceResultZip,
  validateModelManifest,
  validateSourceCompatibility,
} from "../custom-model.mjs";

import { geometry, modelManifest, modelZip, scalarChannels, validatedModel, resultZip } from "./custom-model-fixtures.mjs";

const REQUEST_ID = "TR3DI_11223344";

test("validates the existing trainref3d-model-1.0 state_dict contract", () => {
  assert.equal(validateModelManifest(modelManifest()).task.target_label_id, 5);
  assert.throws(() => validateModelManifest({ ...modelManifest(), format: "future" }), /format/);
  assert.throws(() => validateModelManifest({
    ...modelManifest(), task: { ...modelManifest().task, target_label_id: 21 },
  }), /1 through 20/);
});

test("Model ZIP validation rejects unsafe or unexpected paths and hashes the complete ZIP", async () => {
  const loaded = await validatedModel();
  assert.match(loaded.sha256, /^[a-f0-9]{64}$/);
  assert.equal(loaded.sha256, await sha256Hex(new Uint8Array(await loaded.blob.arrayBuffer())));
  await assert.rejects(async () => loadModelZip(await modelZip(modelManifest(), [["../model.pt", "x"]])), /Unsafe ZIP path/);
  await assert.rejects(async () => loadModelZip(await modelZip(modelManifest(), [["notes.txt", "x"]])), /unexpected files/);
});

test("scalar request preserves deterministic canonical NIfTI bytes and manifest schema", async () => {
  const model = await validatedModel();
  const options = {
    requestId: REQUEST_ID, model, sourceFormat: "nifti", intensityPolicy: "original_scalar",
    channels: scalarChannels(), width: 4, height: 3, depth: 2, geometry: geometry(),
  };
  const first = await createInferenceRequestEntries(options);
  const second = await createInferenceRequestEntries(options);
  assert.equal(first.manifest.format, INFERENCE_REQUEST_FORMAT);
  assert.equal(first.manifest.model.model_sha256, model.sha256);
  assert.equal(first.manifest.input.source_category, "medical_scalar");
  assert.deepEqual(first.manifest.input.channels.map((item) => item.file), [`input/${REQUEST_ID}_0000.nii`]);
  assert.equal(first.manifest.input.channels[0].sha256, second.manifest.input.channels[0].sha256);
  assert.deepEqual([...first.canonical.channels[0].bytes], [...second.canonical.channels[0].bytes]);
  assert.equal(first.manifest.privacy.dicom_headers_included, false);
});

test("RGB request separates deterministic red, green, and blue scalar channels", async () => {
  const manifest = modelManifest({ sourceCategory: "rgb" });
  const model = await validatedModel(manifest);
  const channels = [0, 1, 2].map((channel) => ({
    name: ["red", "green", "blue"][channel],
    values: Uint8Array.from({ length: 24 }, (_, index) => index + channel * 50), datatype: "uint8",
  }));
  const request = await createInferenceRequestEntries({
    requestId: REQUEST_ID, model, sourceFormat: "jpeg", intensityPolicy: "working_rgb_8bit",
    channels, width: 4, height: 3, depth: 2, geometry: geometry(),
  });
  assert.equal(request.manifest.input.channel_count, 3);
  assert.deepEqual(request.manifest.input.channels.map((item) => item.name), ["red", "green", "blue"]);
  assert.equal(new Set(request.manifest.input.channels.map((item) => item.sha256)).size, 3);
});

test("channel and source-category mismatches are rejected without silent conversion", async () => {
  const scalar = modelManifest();
  assert.throws(() => validateSourceCompatibility(scalar, {
    sourceFormat: "jpeg", channelCount: 3, intensityPolicy: "working_rgb_8bit",
  }), /requires 1 channel/);
  assert.throws(() => validateSourceCompatibility(scalar, {
    sourceFormat: "jpeg", channelCount: 1, intensityPolicy: "working_grayscale_8bit",
  }), /requires medical_scalar/);
});

test("valid inference result checks model, source fingerprint, target labels, hash and geometry", async () => {
  const model = await validatedModel();
  const canonical = await prepareCanonicalInferenceChannels({
    channels: scalarChannels(), width: 4, height: 3, depth: 2, geometry: geometry(),
  });
  const fingerprints = canonical.channels.map((item) => item.sha256);
  const result = await validateInferenceResultZip(await resultZip({ model, channelSha256: fingerprints }), {
    model, channelSha256: fingerprints, geometry: geometry(),
  });
  assert.deepEqual(result.prediction.ids, [5]);
  assert.deepEqual(result.modelWarnings, []);

  const differentModel = await validateInferenceResultZip(await resultZip({
    model, channelSha256: fingerprints, mutate: (value) => { value.model.model_id = "TR3DM_deadbeef"; },
  }), { model, channelSha256: fingerprints, geometry: geometry() });
  assert.match(differentModel.modelWarnings.join(" "), /model ID/);
  await assert.rejects(async () => validateInferenceResultZip(await resultZip({ model, channelSha256: ["b".repeat(64)] }), {
    model, channelSha256: fingerprints, geometry: geometry(),
  }), /Source fingerprint/);
  const shifted = geometry();
  shifted.affine = shifted.affine.map((row) => row.slice());
  shifted.affine[0][3] += 1;
  await assert.rejects(async () => validateInferenceResultZip(await resultZip({ model, channelSha256: fingerprints, resultGeometry: shifted }), {
    model, channelSha256: fingerprints, geometry: geometry(),
  }), /geometry mismatch/);
  const wrongLabel = new Uint8Array(24);
  wrongLabel[0] = 2;
  await assert.rejects(async () => validateInferenceResultZip(await resultZip({ model, channelSha256: fingerprints, labels: wrongLabel }), {
    model, channelSha256: fingerprints, geometry: geometry(),
  }), /only background/);
});

test("Merge and Replace preserve other objects and report skipped overlaps", () => {
  const current = [Uint8Array.of(5, 0, 2, 5, 0, 3)];
  const prediction = [Uint8Array.of(0, 5, 5, 5, 0, 5)];
  const merged = applyCustomPrediction(current, prediction, 5, "merge");
  assert.deepEqual([...merged.masks[0]], [5, 5, 2, 5, 0, 3]);
  assert.equal(merged.applied, 1);
  assert.equal(merged.skippedOverlap, 2);
  const replaced = applyCustomPrediction(current, prediction, 5, "replace");
  assert.deepEqual([...replaced.masks[0]], [0, 5, 2, 5, 0, 3]);
  assert.equal(replaced.skippedOverlap, 2);
});

test("empty binary prediction remains a valid negative inference result", async () => {
  const model = await validatedModel();
  const fingerprints = ["c".repeat(64)];
  const result = await validateInferenceResultZip(await resultZip({
    model, channelSha256: fingerprints, labels: new Uint8Array(24),
  }), { model, channelSha256: fingerprints, geometry: geometry() });
  assert.deepEqual(result.prediction.ids, []);
});

test("result imports without a model and restores the manifest target", async () => {
  const model = await validatedModel();
  const channelSha256 = ["c".repeat(64)];
  const result = await validateInferenceResultZip(await resultZip({ model, channelSha256 }), {
    channelSha256, geometry: geometry(),
  });
  assert.equal(result.manifest.model.target_label_id, 5);
  assert.equal(result.manifest.model.target_name, "Tumor");
  assert.deepEqual(result.modelWarnings, []);
});

test("without a model, all case identity and prediction integrity failures remain hard errors", async (t) => {
  const model = await validatedModel();
  const channelSha256 = ["c".repeat(64)];
  const cases = [
    ["format", m => { m.format = "future"; }, /format/],
    ["status", m => { m.status = "failed"; }, /status/],
    ["request ID", m => { m.request_id = "invalid"; }, /request_id/],
    ["prediction file", m => { m.prediction.file = "missing.nii"; }, /missing/],
    ["prediction hash", m => { m.prediction.sha256 = "0".repeat(64); }, /SHA-256/],
    ["declared datatype", m => { m.prediction.datatype = "float32"; }, /uint8/],
    ["labels", m => { m.prediction.label_values = [0, 1]; }, /label_values/],
    ...[0, 21, 1.5, "2"].map(id => [`target ${id}`, m => { m.model.target_label_id = id; }, /target label/]),
    ["model ID", m => { m.model.model_id = "bad"; }, /model ID/],
    ["source fingerprint", m => { m.source.channel_sha256 = ["d".repeat(64)]; }, /Source fingerprint/],
    ["channel count", m => { m.source.channel_count = 3; }, /fingerprints/],
    ["missing original geometry", m => { delete m.source.original_geometry; }, /geometry/],
    ["original geometry", m => { m.source.original_geometry.affine[0][3] += 1; }, /geometry mismatch/],
    ["shape", m => { m.prediction.geometry.shape[0] += 1; }, /geometry mismatch/],
    ["spacing", m => { m.prediction.geometry.spacing_mm[0] += 1; }, /Spacing/],
    ["affine", m => { m.prediction.geometry.affine[0][3] += 1; }, /geometry mismatch/],
    ["origin", m => { m.prediction.geometry.origin_mm = [0, 0, 0]; }, /Origin/],
    ["orientation", m => { m.prediction.geometry.orientation = "LPI"; }, /Orientation/],
  ];
  for (const [name, mutate, error] of cases) {
    await t.test(name, async () => {
      await assert.rejects(async () => validateInferenceResultZip(await resultZip({ model, channelSha256, mutate }), {
        channelSha256, geometry: geometry(),
      }), error);
    });
  }
  const shifted = geometry();
  shifted.affine[0][3] += 1;
  await assert.rejects(async () => validateInferenceResultZip(await resultZip({ model, channelSha256, resultGeometry: shifted }), {
    channelSha256, geometry: geometry(),
  }), /geometry mismatch/);
  await assert.rejects(async () => validateInferenceResultZip(await resultZip({ model, channelSha256, labels: new Uint8Array(24).fill(2) }), {
    channelSha256, geometry: geometry(),
  }), /only background/);
});

test("model provenance mismatches are warnings only after strict source validation", async () => {
  const model = await validatedModel();
  const channelSha256 = ["c".repeat(64)];
  const selected = structuredClone({ manifest: model.manifest, sha256: model.sha256 });
  selected.manifest.model_id = "TR3DM_deadbeef";
  selected.sha256 = "d".repeat(64);
  selected.manifest.task = { ...selected.manifest.task, target_label_id: 2, target_name: "Other target" };
  selected.manifest.preprocessing.patch_size = [32, 32, 32];
  const result = await validateInferenceResultZip(await resultZip({ model, channelSha256 }), {
    model: selected, channelSha256, geometry: geometry(),
  });
  assert.equal(result.manifest.model.target_label_id, 5);
  assert.equal(result.modelWarnings.length, 2);
  await assert.rejects(async () => validateInferenceResultZip(await resultZip({ model, channelSha256 }), {
    model: selected, channelSha256: ["e".repeat(64)], geometry: geometry(),
  }), /Source fingerprint/);
  const shifted = geometry();
  shifted.affine[0][3] += 1;
  await assert.rejects(async () => validateInferenceResultZip(await resultZip({ model, channelSha256 }), {
    model: selected, channelSha256, geometry: shifted,
  }), /geometry mismatch/);
});

test("no-model result validation rejects non-uint8 NIfTI and unsafe ZIP members", async () => {
  const model = await validatedModel();
  const channelSha256 = ["c".repeat(64)];
  const options = { channelSha256, geometry: geometry() };
  await assert.rejects(async () => validateInferenceResultZip(await resultZip({
    model, channelSha256, datatype: "int16",
  }), options), /uint8/);
  for (const [name, error] of [["../escape.txt", /Unsafe ZIP path/], ["unexpected.txt", /unexpected files/], ["prediction.nii", /Duplicate|duplicate/]]) {
    await assert.rejects(async () => validateInferenceResultZip(await resultZip({
      model, channelSha256, extra: [[name, "invalid"]],
    }), options), error);
  }
});

test("request creation still requires a validated compatible model", async () => {
  const options = { channels: scalarChannels(), width: 4, height: 3, depth: 2, geometry: geometry(),
    sourceFormat: "nifti", intensityPolicy: "original_scalar" };
  await assert.rejects(createInferenceRequestEntries(options), /validated Model ZIP/);
  await assert.rejects(createInferenceRequestEntries({ ...options, model: await validatedModel(modelManifest({ sourceCategory: "rgb" })) }), /requires 3 channel/);
});
