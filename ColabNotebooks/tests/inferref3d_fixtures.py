"""Tiny synthetic InferRef3D archives; never use their predictions as performance evidence."""
import hashlib
import json
from pathlib import Path
import zipfile

import nibabel as nib
import numpy as np


def model_manifest(channels=1, source_category=None):
    source_category = source_category or ("rgb" if channels == 3 else "medical_scalar")
    spacing = [0.8, 1.1, 2.2]
    return {
        "format": "trainref3d-model-1.0", "model_id": "TR3DM_abcdef12",
        "framework": "MONAI/PyTorch", "architecture": "3D UNet",
        "architecture_config": {"spatial_dims": 3, "in_channels": channels, "out_channels": 2,
                                "channels": [4, 8], "strides": [2], "num_res_units": 1,
                                "norm": "INSTANCE", "act": "PRELU", "dropout": 0.0, "bias": True},
        "checkpoint_format": "state_dict_and_architecture_config",
        "task": {"type": "binary_segmentation", "target_label_id": 5, "target_name": "Tumor"},
        "input": {"channel_count": channels, "source_category": source_category, "target_spacing_mm": spacing},
        "preprocessing": {"orientation": "RAS", "spacing_mm": spacing,
                          "spacing_policy": "dataset_median_per_RAS_axis", "image_interpolation": "bilinear",
                          "label_interpolation": "nearest",
                          "intensity": "rgb_divide_255" if channels == 3 else "per_volume_percentile_0.5_99.5_clip_then_zscore",
                          "intensity_statistics": "each_channel_including_zero_after_spacing_before_padding",
                          "percentile_sampling": {"maximum_voxels": 1000000, "method": "deterministic_flat_stride"},
                          "fixed_HU_window": False, "patch_size": [8, 8, 8], "padding": "constant_zero_symmetric",
                          "foreground_sampling": {"positive_weight": 1, "negative_weight": 1, "samples_per_case": 1},
                          "augmentation": {},
                          "inference": {"sliding_window_overlap": 0.25, "mode": "gaussian",
                                        "class_selection": "argmax", "foreground_channel": 1}},
        "training": {"epochs_completed": 2}, "dataset": {"dataset_id": "TR3D_12345678"},
        "versions": {"backend_sha256": "0" * 64}, "warnings": [],
    }


def model_zip(directory, backend, channels=1, mutate_checkpoint=None, mutate_manifest=None):
    import torch
    manifest = model_manifest(channels)
    if mutate_manifest:
        mutate_manifest(manifest)
    checkpoint = {"state_dict": backend.build_model(manifest["architecture_config"]).state_dict(),
                  "architecture_config": dict(manifest["architecture_config"])}
    if mutate_checkpoint:
        mutate_checkpoint(checkpoint)
    checkpoint_path = Path(directory) / "model.pt"
    torch.save(checkpoint, checkpoint_path)
    path = Path(directory) / "model.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(checkpoint_path, "model.pt")
        archive.writestr("model_manifest.json", json.dumps(manifest))
        archive.writestr("training_history.csv", "epoch,train_loss,validation_dice\n1,1,0\n")
        archive.writestr("validation_metrics.csv", "case_id,dice\nSR3D_00000000,0\n")
        archive.writestr("README.txt", "Synthetic test model")
    return path, manifest


def source_geometry(shape=(11, 9, 7)):
    # Oblique, anisotropic, non-zero-origin IJK-to-RAS affine.
    affine = np.array([[0.75, -0.2, 0.15, 12.5], [0.12, 1.05, -0.35, -8.25],
                       [0.04, 0.22, 2.4, 31.75], [0, 0, 0, 1]], dtype=float)
    spacing = np.linalg.norm(affine[:3, :3], axis=0)
    return {"shape": list(shape), "spacing_mm": spacing.tolist(), "affine": affine.tolist(),
            "origin_mm": affine[:3, 3].tolist(), "orientation": "RAS"}


def request_zip(directory, model_path, manifest, channels=1, geometry=None, mutate=None):
    geometry = geometry or source_geometry()
    shape = tuple(geometry["shape"])
    affine = np.asarray(geometry["affine"])
    channel_files = {}
    channel_specs = []
    for index in range(channels):
        values = (np.arange(np.prod(shape)).reshape(shape) * 7 - 500).astype(np.int16)
        if channels == 3:
            values = ((values - values.min() + index * 31) % 256).astype(np.uint8)
        raw = nib.Nifti1Image(values, affine).to_bytes()
        filename = f"input/TR3DI_12345678_{index:04d}.nii"
        channel_files[filename] = raw
        channel_specs.append({"index": index, "name": "scalar" if channels == 1 else ("red", "green", "blue")[index],
                              "file": filename, "sha256": hashlib.sha256(raw).hexdigest(), "datatype": values.dtype.name})
    request = {"format": "trainref3d-inference-request-1.0", "request_id": "TR3DI_12345678",
               "created_by": "SegRef3D Lite",
               "model": {"model_id": manifest["model_id"], "model_sha256": hashlib.sha256(Path(model_path).read_bytes()).hexdigest(),
                         "format": manifest["format"], "target_label_id": 5, "target_name": "Tumor"},
               "input": {"channel_count": channels, "source_format": "jpeg" if channels == 3 else "nifti",
                         "source_category": "rgb" if channels == 3 else "medical_scalar",
                         "intensity_policy": "working_rgb_8bit" if channels == 3 else "original_scalar",
                         "channels": channel_specs},
               "geometry": geometry,
               "privacy": {"dicom_headers_included": False, "image_data_may_be_identifiable": True,
                           "processing": "browser_local"}}
    if mutate:
        mutate(request, channel_files)
    path = Path(directory) / "request.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("request_manifest.json", json.dumps(request))
        archive.writestr("model/model_manifest.json", json.dumps(manifest))
        for name, raw in channel_files.items():
            archive.writestr(name, raw)
    return path, request
