import { MODEL_FORMAT, INFERENCE_RESULT_FORMAT, loadModelZip, sha256Hex } from "../custom-model.mjs";
import { createNiftiScalarVolume } from "../training-export.mjs";
import { createZip } from "../zip.mjs";

const MODEL_ID = "TR3DM_a1b2c3d4";
const REQUEST_ID = "TR3DI_11223344";

export function geometry(shape = [4, 3, 2]) {
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

export function modelManifest(overrides = {}) {
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

export async function modelZip(manifest = modelManifest(), extra = []) {
  return zip([
    ["model.pt", Uint8Array.of(1, 2, 3)],
    ["model_manifest.json", JSON.stringify(manifest)],
    ["training_history.csv", "epoch,loss\n1,1\n"],
    ["validation_metrics.csv", "case_id,dice\na,0\n"],
    ["README.txt", "Research only"],
    ...extra,
  ]);
}

export function scalarChannels() {
  return [{ name: "scalar", values: Int16Array.from({ length: 24 }, (_, index) => index * 7 - 50), datatype: "int16" }];
}

export async function validatedModel(manifest = modelManifest()) {
  return loadModelZip(await modelZip(manifest));
}

export async function resultZip({ model, channelSha256, resultGeometry = geometry(), labels = null, mutate = null, datatype = "uint8", extra = [] }) {
  const values = labels || Uint8Array.from({ length: 24 }, (_, index) => index % 5 === 0 ? 5 : 0);
  const prediction = createNiftiScalarVolume({
    values, width: resultGeometry.shape[0], height: resultGeometry.shape[1], depth: resultGeometry.shape[2],
    geometry: resultGeometry, datatype,
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
    ...extra,
  ]);
}
