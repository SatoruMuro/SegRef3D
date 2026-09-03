import assert from "node:assert/strict";
import test from "node:test";

import {
  INFERENCE_REQUEST_FORMAT,
  INFERENCE_RESULT_FORMAT,
  MODEL_FORMAT,
  applyCustomPrediction,
  createInferenceRequestEntries,
  loadModelZip,
  prepareCanonicalInferenceChannels,
  sha256Hex,
  validateInferenceResultZip,
  validateModelManifest,
  validateSourceCompatibility,
} from "../custom-model.mjs";
import { createNiftiScalarVolume } from "../training-export.mjs";
import { createZip } from "../zip.mjs";

const MODEL_ID = "TR3DM_a1b2c3d4";
const REQUEST_ID = "TR3DI_11223344";

function geometry(shape = [4, 3, 2]) {
  const affine = [
    [0.8, -0.1, 0.2, 12.5],
    [0.1, 0.9, -0.3, -8.25],
    [0, 0.2, 2.4, 31.75],
    [0, 0, 0, 1],
  ];
  return {
    shape,
    affine,
    spacing_mm: [0, 1, 2].map((axis) => Math.hypot(affine[0][axis], affine[1][axis], affine[2][axis])),
  };
}

function modelManifest(overrides = {}) {
  const sourceCategory = overrides.sourceCategory || "medical_scalar";
  const channelCount = sourceCategory === "rgb" ? 3 : 1;
  const targetSpacing = [1, 1, 2];
  return {
    format: MODEL_FORMAT,
    model_id: MODEL_ID,
    framework: "MONAI/PyTorch",
    architecture: "3D UNet",
    architecture_config: {
      spatial_dims: 3, in_channels: channelCount, out_channels: 2,
      channels: [8, 16, 32], strides: [2, 2], num_res_units: 1,
      norm: "INSTANCE", act: "PRELU", dropout: 0, bias: true,
    },
    checkpoint_format: "state_dict_and_architecture_config",
    task: { type: "binary_segmentation", target_label_id: 5, target_name: "Tumor" },
    input: { channel_count: channelCount, source_category: sourceCategory, target_spacing_mm: targetSpacing },
    preprocessing: {
      orientation: "RAS", spacing_mm: targetSpacing,
      spacing_policy: "dataset_median_per_RAS_axis", image_interpolation: "bilinear", label_interpolation: "nearest",
      intensity: sourceCategory === "rgb" ? "rgb_divide_255" : "per_volume_percentile_0.5_99.5_clip_then_zscore",
      patch_size: [16, 16, 16],
      inference: { sliding_window_overlap: 0.25, mode: "gaussian", class_selection: "argmax", foreground_channel: 1 },
    },
    training: { epochs_completed: 2 }, dataset: { dataset_id: "TR3D_abcdef12" }, versions: {},
    ...overrides.manifest,
  };
}

async function zip(entries) {
  return createZip(entries.map(([name, value]) => ({
    name,
    blob: new Blob([typeof value === "string" ? value : value], { type: "application/octet-stream" }),
  })));
}

async function modelZip(manifest = modelManifest(), extra = []) {
  return zip([
    ["model.pt", Uint8Array.of(1, 2, 3)],
    ["model_manifest.json", JSON.stringify(manifest)],
    ["training_history.csv", "epoch,loss\n1,1\n"],
    ["validation_metrics.csv", "case_id,dice\na,0\n"],
    ["README.txt", "Research only"],
    ...extra,
  ]);
}

function scalarChannels() {
  return [{ name: "scalar", values: Int16Array.from({ length: 24 }, (_, index) => index * 7 - 50), datatype: "int16" }];
}

async function validatedModel(manifest = modelManifest()) {
  return loadModelZip(await modelZip(manifest));
}

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

async function resultZip({ model, channelSha256, resultGeometry = geometry(), labels = null, mutate = null }) {
  const values = labels || Uint8Array.from({ length: 24 }, (_, index) => index % 5 === 0 ? 5 : 0);
  const prediction = createNiftiScalarVolume({
    values, width: resultGeometry.shape[0], height: resultGeometry.shape[1], depth: resultGeometry.shape[2],
    geometry: resultGeometry, datatype: "uint8",
  });
  const manifest = {
    format: INFERENCE_RESULT_FORMAT, status: "success", request_id: REQUEST_ID,
    model: {
      model_id: model.manifest.model_id, model_sha256: model.sha256,
      target_label_id: 5, target_name: "Tumor",
    },
    source: { channel_count: channelSha256.length, channel_sha256: channelSha256, source_category: "medical_scalar", original_geometry: resultGeometry },
    prediction: {
      file: "prediction.nii", sha256: await sha256Hex(prediction), datatype: "uint8", label_values: [0, 5],
      foreground_voxel_count: values.filter((value) => value === 5).length, geometry: resultGeometry,
    },
    inference: {
      architecture: model.manifest.architecture,
      target_spacing_mm: model.manifest.input.target_spacing_mm,
      preprocessing: model.manifest.preprocessing,
      sliding_window: model.manifest.preprocessing.inference,
      device: "cpu",
    },
    versions: { python: "3.12", torch: "2.8.0", monai: "1.5.1" },
    backend: { source_sha256: "a".repeat(64) }, privacy: { source_images_included: false, model_weights_included: false },
  };
  if (mutate) mutate(manifest);
  return zip([
    ["prediction.nii", prediction], ["inference_result.json", JSON.stringify(manifest)], ["README.txt", "Review prediction"],
  ]);
}

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

  await assert.rejects(async () => validateInferenceResultZip(await resultZip({
    model, channelSha256: fingerprints, mutate: (value) => { value.model.model_id = "TR3DM_deadbeef"; },
  }), { model, channelSha256: fingerprints, geometry: geometry() }), /model ID/);
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
