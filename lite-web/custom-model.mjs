import { CASE_LIMITS, readSafeZip } from "../shared/training-archive.mjs?v=1";
import {
  inspectNifti,
  orientation,
  sameGeometry,
  sourceCategory,
  validateGeometry,
} from "../shared/training-case.mjs?v=1";
import {
  assertSameGeometry,
  createNiftiScalarVolume,
  readNiftiTrainingVolume,
} from "./training-export.mjs?v=1";

export const MODEL_FORMAT = "trainref3d-model-1.0";
export const INFERENCE_REQUEST_FORMAT = "trainref3d-inference-request-1.0";
export const INFERENCE_RESULT_FORMAT = "trainref3d-inference-result-1.0";
export const INFERENCE_GEOMETRY_TOLERANCE = 1e-5;

const MODEL_LIMITS = Object.freeze({ archive: 1073741824, expanded: 1073741824, entries: 8 });
const REQUEST_LIMITS = Object.freeze({ archive: 1073741824, expanded: 1073741824, entries: 6 });
const RESULT_LIMITS = Object.freeze({ archive: 536870912, expanded: 805306368, entries: 4 });
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const SOURCE_CATEGORIES = new Set(["medical_scalar", "grayscale_8bit", "rgb"]);

function bytesView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("Expected binary data.");
}

function jsonBytes(value) {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function requiredText(value, name, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${name}.`);
  return value;
}

function requiredArray(value, name, length = null) {
  if (!Array.isArray(value) || (length !== null && value.length !== length)) throw new Error(`Invalid ${name}.`);
  return value;
}

function finitePositiveArray(value, name, length = 3) {
  requiredArray(value, name, length);
  if (value.some((item) => typeof item !== "number" || !Number.isFinite(item) || item <= 0)) {
    throw new Error(`Invalid ${name}.`);
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactMembers(files, expected, description) {
  if (files.size !== expected.size || [...files.keys()].some((name) => !expected.has(name))) {
    throw new Error(`${description} contains missing or unexpected files.`);
  }
}

function decodeJson(bytes, name, limit = 1048576) {
  if (!bytes || bytes.length > limit) throw new Error(`Missing or oversized ${name}.`);
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw new Error(`Invalid ${name}: ${error.message}`);
  }
}

export async function sha256Hex(input) {
  const bytes = bytesView(input);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function createInferenceRequestId(random = globalThis.crypto) {
  const bytes = new Uint8Array(4);
  random.getRandomValues(bytes);
  return `TR3DI_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function isModelId(value) {
  return typeof value === "string" && /^TR3DM_[a-f0-9]{8,32}$/i.test(value);
}

export function isInferenceRequestId(value) {
  return typeof value === "string" && /^TR3DI_[a-f0-9]{8,32}$/i.test(value);
}

export function validateModelManifest(manifest) {
  if (!manifest || manifest.format !== MODEL_FORMAT || !isModelId(manifest.model_id)) {
    throw new Error("Unsupported TrainRef3D model format or model_id.");
  }
  if (manifest.framework !== "MONAI/PyTorch" || manifest.architecture !== "3D UNet") {
    throw new Error("Only the TrainRef3D MONAI 3D UNet architecture is supported.");
  }
  const task = manifest.task;
  if (task?.type !== "binary_segmentation" || !Number.isInteger(task.target_label_id)
      || task.target_label_id < 1 || task.target_label_id > 20) {
    throw new Error("Model target_label_id must be an integer from 1 through 20.");
  }
  requiredText(task.target_name, "model target name", 80);
  const input = manifest.input;
  if (![1, 3].includes(input?.channel_count) || !SOURCE_CATEGORIES.has(input.source_category)) {
    throw new Error("Model input channel count or source category is unsupported.");
  }
  if ((input.channel_count === 3) !== (input.source_category === "rgb")) {
    throw new Error("Model input channels and source category disagree.");
  }
  finitePositiveArray(input.target_spacing_mm, "model target spacing");
  const architecture = manifest.architecture_config;
  if (!architecture || architecture.spatial_dims !== 3 || architecture.in_channels !== input.channel_count
      || architecture.out_channels !== 2 || !Array.isArray(architecture.channels)
      || architecture.channels.length < 2 || architecture.channels.some((value) => !Number.isInteger(value) || value < 1)
      || !Array.isArray(architecture.strides) || architecture.strides.length !== architecture.channels.length - 1
      || architecture.strides.some((value) => !Number.isInteger(value) || value < 1)
      || !Number.isInteger(architecture.num_res_units) || architecture.num_res_units < 0) {
    throw new Error("Invalid model architecture_config.");
  }
  requiredText(architecture.norm, "architecture norm", 32);
  requiredText(architecture.act, "architecture activation", 32);
  if (typeof architecture.dropout !== "number" || architecture.dropout < 0 || architecture.dropout >= 1
      || typeof architecture.bias !== "boolean") throw new Error("Invalid model architecture options.");
  if (manifest.checkpoint_format !== "state_dict_and_architecture_config") {
    throw new Error("Only weights-only TrainRef3D state_dict checkpoints are supported.");
  }
  const preprocessing = manifest.preprocessing;
  if (preprocessing?.orientation !== "RAS"
      || preprocessing.spacing_policy !== "dataset_median_per_RAS_axis"
      || preprocessing.image_interpolation !== "bilinear"
      || preprocessing.label_interpolation !== "nearest"
      || !sameJson(preprocessing.spacing_mm, input.target_spacing_mm)) {
    throw new Error("Unsupported model orientation or spacing preprocessing contract.");
  }
  const expectedIntensity = input.source_category === "rgb"
    ? "rgb_divide_255"
    : "per_volume_percentile_0.5_99.5_clip_then_zscore";
  if (preprocessing.intensity !== expectedIntensity) {
    throw new Error("Model intensity preprocessing is incompatible with its source category.");
  }
  finitePositiveArray(preprocessing.patch_size, "model inference patch size");
  const inference = preprocessing.inference;
  if (!inference || typeof inference.sliding_window_overlap !== "number"
      || inference.sliding_window_overlap < 0 || inference.sliding_window_overlap >= 1
      || !["constant", "gaussian"].includes(inference.mode)
      || inference.class_selection !== "argmax" || inference.foreground_channel !== 1) {
    throw new Error("Invalid model sliding-window inference contract.");
  }
  return manifest;
}

export async function loadModelZip(source) {
  const blob = source instanceof Blob ? source : new Blob([source]);
  const files = await readSafeZip(blob, MODEL_LIMITS);
  const expected = new Set([
    "model.pt", "model_manifest.json", "training_history.csv", "validation_metrics.csv", "README.txt",
  ]);
  exactMembers(files, expected, "Model ZIP");
  const manifest = validateModelManifest(decodeJson(files.get("model_manifest.json"), "model_manifest.json"));
  if (!files.get("model.pt")?.length) throw new Error("Model ZIP has an empty model.pt.");
  return { manifest, sha256: await sha256Hex(new Uint8Array(await blob.arrayBuffer())), files, blob };
}

function canonicalGeometry(geometry, shape) {
  const affine = geometry?.affine?.map((row) => row.map(Number));
  const spacing = geometry?.spacing_mm || geometry?.spacing || (affine
    ? [0, 1, 2].map((axis) => Math.hypot(affine[0][axis], affine[1][axis], affine[2][axis]))
    : null);
  return validateGeometry({
    shape: shape.map(Number),
    spacing_mm: spacing?.map(Number),
    affine,
    origin_mm: affine ? [affine[0][3], affine[1][3], affine[2][3]] : undefined,
    orientation: affine ? orientation(affine) : undefined,
  });
}

export function canonicalSourceCategory(sourceFormat, channelCount, intensityPolicy) {
  return sourceCategory({
    source_format: String(sourceFormat || "raster").toLowerCase(),
    channel_count: channelCount,
    intensity_policy: String(intensityPolicy || ""),
  });
}

export function validateSourceCompatibility(modelManifest, { sourceFormat, channelCount, intensityPolicy }) {
  validateModelManifest(modelManifest);
  const category = canonicalSourceCategory(sourceFormat, channelCount, intensityPolicy);
  if (channelCount !== modelManifest.input.channel_count) {
    throw new Error(`Model requires ${modelManifest.input.channel_count} channel(s), but this source has ${channelCount}.`);
  }
  if (category !== modelManifest.input.source_category) {
    throw new Error(`Model requires ${modelManifest.input.source_category} input, but this source is ${category}.`);
  }
  return category;
}

export async function prepareCanonicalInferenceChannels({
  channels,
  width,
  height,
  depth,
  geometry,
}) {
  if (!Array.isArray(channels) || ![1, 3].includes(channels.length)) {
    throw new Error("Inference requires one scalar or three RGB channels.");
  }
  const shape = [Number(width), Number(height), Number(depth)];
  const normalizedGeometry = canonicalGeometry(geometry, shape);
  const output = [];
  for (let index = 0; index < channels.length; index += 1) {
    const channel = channels[index];
    let bytes;
    let compressed = false;
    let datatype = channel.datatype || null;
    if (channel.encodedBytes) {
      bytes = bytesView(channel.encodedBytes);
      compressed = Boolean(channel.compressed);
      const parsed = readNiftiTrainingVolume(bytes, { includeValues: false });
      assertSameGeometry(parsed.geometry, normalizedGeometry, `Canonical input channel ${index}`);
      if (parsed.channelCount !== 1) throw new Error("Canonical input channels must be scalar NIfTI volumes.");
      datatype = datatype || parsed.datatype;
    } else {
      bytes = createNiftiScalarVolume({
        values: channel.values,
        width: shape[0],
        height: shape[1],
        depth: shape[2],
        geometry: normalizedGeometry,
        datatype,
      });
      datatype = readNiftiTrainingVolume(bytes, { includeValues: false }).datatype;
    }
    output.push({
      index,
      name: channels.length === 1 ? "scalar" : ["red", "green", "blue"][index],
      bytes,
      compressed,
      datatype,
      sha256: await sha256Hex(bytes),
    });
  }
  return { channels: output, geometry: normalizedGeometry };
}

export async function createInferenceRequestEntries({
  requestId = createInferenceRequestId(),
  model,
  sourceFormat,
  intensityPolicy,
  channels,
  width,
  height,
  depth,
  geometry,
}) {
  if (!isInferenceRequestId(requestId)) throw new Error("Invalid inference request_id.");
  if (!model?.manifest || !/^[a-f0-9]{64}$/.test(model.sha256 || "")) throw new Error("A validated Model ZIP is required.");
  const canonical = await prepareCanonicalInferenceChannels({ channels, width, height, depth, geometry });
  const sourceCategoryValue = validateSourceCompatibility(model.manifest, {
    sourceFormat, channelCount: canonical.channels.length, intensityPolicy,
  });
  const manifestChannels = canonical.channels.map((channel) => ({
    index: channel.index,
    name: channel.name,
    file: `input/${requestId}_${String(channel.index).padStart(4, "0")}.${channel.compressed ? "nii.gz" : "nii"}`,
    sha256: channel.sha256,
    datatype: channel.datatype,
  }));
  const target = model.manifest.task;
  const manifest = {
    format: INFERENCE_REQUEST_FORMAT,
    request_id: requestId,
    created_by: "SegRef3D Lite",
    model: {
      model_id: model.manifest.model_id,
      model_sha256: model.sha256,
      format: model.manifest.format,
      target_label_id: target.target_label_id,
      target_name: target.target_name,
    },
    input: {
      channel_count: canonical.channels.length,
      source_format: String(sourceFormat || "raster").toLowerCase(),
      source_category: sourceCategoryValue,
      intensity_policy: String(intensityPolicy),
      channels: manifestChannels,
    },
    geometry: canonical.geometry,
    privacy: {
      dicom_headers_included: false,
      image_data_may_be_identifiable: true,
      processing: "browser_local",
    },
  };
  const entries = [
    { name: "request_manifest.json", blob: new Blob([jsonBytes(manifest)], { type: "application/json" }) },
    { name: "model/model_manifest.json", blob: new Blob([jsonBytes(model.manifest)], { type: "application/json" }) },
    ...canonical.channels.map((channel, index) => ({
      name: manifestChannels[index].file,
      blob: new Blob([channel.bytes], { type: "application/octet-stream" }),
    })),
  ];
  return { entries, manifest, canonical };
}

function validateHashList(actual, expected, name) {
  if (!Array.isArray(actual) || actual.length !== expected.length
      || actual.some((value, index) => value !== expected[index])) throw new Error(`${name} mismatch.`);
}

export async function validateInferenceResultZip(source, {
  model,
  channelSha256,
  geometry,
} = {}) {
  const files = await readSafeZip(source, RESULT_LIMITS);
  const result = decodeJson(files.get("inference_result.json"), "inference_result.json");
  if (result?.format !== INFERENCE_RESULT_FORMAT || result.status !== "success"
      || !isInferenceRequestId(result.request_id)) throw new Error("Unsupported inference result format, status or request_id.");
  const targetId = result.model?.target_label_id;
  if (!Number.isInteger(targetId) || targetId < 1 || targetId > 20) throw new Error("Invalid inference result target label.");
  requiredText(result.model.target_name, "result target name", 80);
  if (!/^[a-f0-9]{64}$/.test(result.model.model_sha256 || "")) throw new Error("Invalid result model hash.");
  if (model) {
    if (result.model.model_id !== model.manifest.model_id || result.model.model_sha256 !== model.sha256
        || targetId !== model.manifest.task.target_label_id
        || result.model.target_name !== model.manifest.task.target_name) {
      throw new Error("Inference result model ID, hash or target mismatch.");
    }
    if (result.source?.channel_count !== model.manifest.input.channel_count
        || result.source?.source_category !== model.manifest.input.source_category) {
      throw new Error("Inference result source channel count or category mismatch.");
    }
  }
  if (channelSha256) validateHashList(result.source?.channel_sha256, channelSha256, "Source fingerprint");
  if (!Array.isArray(result.source?.channel_sha256)
      || result.source.channel_count !== result.source.channel_sha256.length) {
    throw new Error("Inference result source fingerprints are incomplete.");
  }
  const predictionFile = result.prediction?.file;
  if (!/^prediction\.nii(?:\.gz)?$/.test(predictionFile || "") || !files.has(predictionFile)) {
    throw new Error("Inference result is missing its declared prediction NIfTI.");
  }
  exactMembers(files, new Set(["inference_result.json", predictionFile, "README.txt"]), "Inference Result ZIP");
  const predictionBytes = files.get(predictionFile);
  if (predictionFile.endsWith(".gz") !== (predictionBytes[0] === 31 && predictionBytes[1] === 139)) {
    throw new Error("Prediction gzip filename disagrees with its content.");
  }
  const predictionHash = await sha256Hex(predictionBytes);
  if (predictionHash !== result.prediction.sha256) throw new Error("Prediction SHA-256 mismatch.");
  const parsed = await inspectNifti(predictionBytes, { labels: true, limit: CASE_LIMITS.expanded });
  if (parsed.datatype !== "uint8" || parsed.ids.some((id) => id !== targetId)) {
    throw new Error("Prediction must be uint8 and contain only background or the model target label.");
  }
  if (!sameJson(result.prediction.label_values, [0, targetId])) throw new Error("Prediction label_values are invalid.");
  if (!Number.isSafeInteger(result.prediction.foreground_voxel_count)
      || result.prediction.foreground_voxel_count < 0) throw new Error("Invalid foreground voxel count.");
  const declaredGeometry = validateGeometry(result.prediction.geometry);
  sameGeometry(parsed.geometry, declaredGeometry);
  if (geometry) sameGeometry(parsed.geometry, canonicalGeometry(geometry, geometry.shape));
  if (result.source?.original_geometry) sameGeometry(parsed.geometry, validateGeometry(result.source.original_geometry));
  if (model) {
    if (result.inference?.architecture !== model.manifest.architecture
        || !sameJson(result.inference.target_spacing_mm, model.manifest.input.target_spacing_mm)
        || !sameJson(result.inference.preprocessing, model.manifest.preprocessing)
        || !sameJson(result.inference.sliding_window, model.manifest.preprocessing.inference)) {
      throw new Error("Inference result does not reproduce the model preprocessing contract.");
    }
  }
  if (!requiredText(result.inference?.device, "inference device", 96)
      || !requiredText(result.versions?.python, "Python version", 64)
      || !requiredText(result.versions?.torch, "torch version", 64)
      || !requiredText(result.versions?.monai, "MONAI version", 64)
      || !/^[a-f0-9]{64}$/.test(result.backend?.source_sha256 || "")
      || result.privacy?.source_images_included !== false
      || result.privacy?.model_weights_included !== false) {
    throw new Error("Inference result runtime or privacy metadata is invalid.");
  }
  return { files, manifest: result, predictionBytes, prediction: parsed };
}

export function applyCustomPrediction(currentMasks, predictionMasks, targetId, mode = "replace") {
  if (!Array.isArray(currentMasks) || !Array.isArray(predictionMasks) || currentMasks.length !== predictionMasks.length) {
    throw new Error("Prediction depth does not match the current mask volume.");
  }
  if (!Number.isInteger(targetId) || targetId < 1 || targetId > 20 || !["merge", "replace"].includes(mode)) {
    throw new Error("Invalid target label or import mode.");
  }
  let applied = 0;
  let skippedOverlap = 0;
  let predicted = 0;
  const masks = currentMasks.map((mask, frame) => {
    const prediction = predictionMasks[frame];
    if (!prediction || prediction.length !== mask.length) throw new Error("Prediction shape does not match the current mask volume.");
    const next = mask.slice();
    if (mode === "replace") for (let pixel = 0; pixel < next.length; pixel += 1) if (next[pixel] === targetId) next[pixel] = 0;
    for (let pixel = 0; pixel < next.length; pixel += 1) {
      const value = Number(prediction[pixel]);
      if (value !== 0 && value !== targetId) throw new Error("Prediction contains a non-target label value.");
      if (value !== targetId) continue;
      predicted += 1;
      if (next[pixel] !== 0 && next[pixel] !== targetId) {
        skippedOverlap += 1;
        continue;
      }
      if (mode === "merge" && next[pixel] === targetId) continue;
      if (next[pixel] !== targetId) {
        next[pixel] = targetId;
        applied += 1;
      }
    }
    return next;
  });
  return { masks, predicted, applied, skippedOverlap };
}
