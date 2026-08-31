"""TrainRef3D v1.0: validated case archives -> binary MONAI baseline -> model ZIP.

No network calls, automatic uploads or medical performance claims. Importing this
module needs numpy/nibabel only; torch/MONAI are imported by training functions.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import json
import math
import platform
import random
import re
import shutil
import stat
import tempfile
import warnings
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from uuid import uuid4

import nibabel as nib
import numpy as np

CASE_FORMAT = "segref3d-training-case-1.0"
DATASET_FORMAT = "trainref3d-dataset-1.0"
MODEL_FORMAT = "trainref3d-model-1.0"
TOLERANCE = 1e-5
MAX_CASE_BYTES = 512 * 1024**2
MAX_EXPANDED_BYTES = 768 * 1024**2
MAX_DATASET_BYTES = 1024**3
MAX_DATASET_DECODED_BYTES = 8 * 1024**3
MAX_CASES = 64
DTYPES = {"uint8", "int8", "uint16", "int16", "uint32", "int32", "float32", "float64"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_path(name):
    require(isinstance(name, str) and len(name) <= 240 and re.fullmatch(r"[A-Za-z0-9_./-]+", name)
            and all(p not in ("", ".", "..") for p in name.split("/")), "Unsafe ZIP path")
    return name


def zip_entries(archive, *, outer=False):
    infos = archive.infolist()
    require(0 < len(infos) <= (MAX_CASES + 1 if outer else 16), "ZIP file count exceeds safety limit")
    seen, total = set(), 0
    for info in infos:
        safe_path(info.filename)
        require(info.filename.lower() not in seen, "Duplicate ZIP path")
        seen.add(info.filename.lower())
        require(not info.is_dir() and not stat.S_ISLNK(info.external_attr >> 16)
                and not info.flag_bits & 1 and info.compress_type in (0, 8), "Unsupported ZIP entry")
        total += info.file_size
        require(info.file_size <= (MAX_CASE_BYTES if outer else MAX_EXPANDED_BYTES), "ZIP member exceeds safety limit")
        require(total <= (MAX_DATASET_BYTES if outer else MAX_EXPANDED_BYTES), "Expanded ZIP exceeds safety limit")
    return {i.filename: i for i in infos}


def copy_bounded(source, target, limit):
    total = 0
    while True:
        chunk = source.read(min(1024**2, limit - total + 1))
        if not chunk:
            break
        total += len(chunk)
        require(total <= limit, "Expanded data exceeds safety limit")
        target.write(chunk)
    return total


def read_json(archive, name):
    require(name in archive.namelist(), f"Missing {name}")
    require(archive.getinfo(name).file_size <= 1024**2, "Manifest exceeds safety limit")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result
    return json.loads(archive.read(name), object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Non-finite JSON number")))


def valid_id(value, prefix):
    return isinstance(value, str) and re.fullmatch(prefix + r"_[a-f0-9]{8,32}", value, re.IGNORECASE) is not None


def orientation(affine):
    # Match SegRef3D Lite's IJK-to-RAS axis naming policy, including oblique data.
    used, axes = set(), []
    for axis in range(3):
        world = max((i for i in range(3) if i not in used), key=lambda i: abs(affine[i, axis]))
        used.add(world)
        axes.append(("RAS" if affine[world, axis] >= 0 else "LPI")[world])
    return "".join(axes)


def geometry_validate(geometry):
    require(isinstance(geometry, dict), "Missing geometry")
    shape = geometry.get("shape", [])
    require(len(shape) == 3 and all(type(x) is int and x > 0 for x in shape), "Invalid geometry shape")
    affine = np.asarray(geometry.get("affine"), dtype=np.float64)
    spacing = np.asarray(geometry.get("spacing_mm"), dtype=np.float64)
    require(affine.shape == (4, 4) and spacing.shape == (3,) and np.isfinite(affine).all()
            and np.isfinite(spacing).all() and (spacing > 0).all(), "Invalid geometry spacing or affine")
    require(abs(np.linalg.det(affine[:3, :3])) > 1e-12
            and np.allclose(affine[3], [0, 0, 0, 1], rtol=0, atol=TOLERANCE), "Singular or invalid affine")
    require(np.allclose(np.linalg.norm(affine[:3, :3], axis=0), spacing, rtol=0, atol=TOLERANCE), "Spacing does not match affine")
    if "origin_mm" in geometry:
        origin = np.asarray(geometry["origin_mm"])
        require(origin.shape == (3,) and np.allclose(origin, affine[:3, 3], rtol=0, atol=TOLERANCE), "Origin mismatch")
    if "orientation" in geometry:
        require(geometry["orientation"] == orientation(affine), "Orientation mismatch")
    return affine, spacing


def category(image):
    if image["channel_count"] == 3:
        return "rgb"
    if image["source_format"] in ("nifti", "dicom") and re.search("original_scalar|dicom_rescale", image["intensity_policy"]):
        return "medical_scalar"
    return "grayscale_8bit"


def load_checked_nifti(path, geometry, *, label=False):
    affine, spacing = geometry_validate(geometry)
    image = nib.load(str(path))
    require(len(image.shape) >= 3 and all(n == 1 for n in image.shape[3:])
            and list(image.shape[:3]) == geometry["shape"], "NIfTI shape mismatch")
    require(image.header.get_xyzt_units()[0] in ("unknown", "mm"), "NIfTI spatial units must be mm or unspecified")
    require(int(image.header["sform_code"]) > 0 or int(image.header["qform_code"]) > 0, "NIfTI needs qform or sform")
    require(np.allclose(image.affine, affine, rtol=0, atol=TOLERANCE)
            and np.allclose(image.header.get_zooms()[:3], spacing, rtol=0, atol=TOLERANCE), "NIfTI geometry mismatch")
    dtype = image.get_data_dtype()
    require(dtype.name in DTYPES and math.prod(image.shape) * dtype.itemsize <= MAX_EXPANDED_BYTES, "Unsupported or oversized NIfTI datatype")
    if label:
        require(dtype.kind in "ui" and image.dataobj.slope == 1 and image.dataobj.inter == 0, "Labels require unscaled integer NIfTI")
    ids, minimum, maximum = set(), math.inf, -math.inf
    for z in range(image.shape[2]):
        values = np.asarray(image.dataobj[:, :, z]).reshape(image.shape[:2])
        require(np.isfinite(values).all(), "Non-finite NIfTI values")
        minimum, maximum = min(minimum, float(values.min())), max(maximum, float(values.max()))
        if label:
            require(minimum >= 0 and maximum <= 65535, "Label IDs must be in 0..65535")
            ids.update(int(n) for n in np.unique(values) if n)
    return image, ids, (minimum, maximum)


def validate_case_manifest(m):
    require(isinstance(m, dict) and m.get("format") == CASE_FORMAT and valid_id(m.get("case_id"), "SR3D"), "Invalid case manifest")
    image, label = m.get("image", {}), m.get("label", {})
    require(type(image.get("channel_count")) is int and image["channel_count"] in (1, 3)
            and isinstance(image.get("channels"), list) and len(image["channels"]) == image["channel_count"], "Invalid channels")
    for field, length in (("source_format", 32), ("intensity_policy", 96)):
        require(isinstance(image.get(field), str) and re.fullmatch(r"[a-z0-9_-]{1," + str(length) + "}", image[field]), "Invalid source/intensity policy")
    case_id = m["case_id"]
    require(isinstance(label.get("file"), str) and re.fullmatch(r"labelsTr/" + case_id + r"\.nii(?:\.gz)?", label["file"]), "Invalid label filename")
    require(isinstance(label.get("objects"), list), "Invalid label objects")
    ids = set()
    for obj in label["objects"]:
        require(type(obj.get("id")) is int and 1 <= obj["id"] <= 65535 and obj["id"] not in ids
                and isinstance(obj.get("name"), str) and 0 < len(obj["name"].strip()) <= 80, "Invalid label object")
        ids.add(obj["id"])
    for i, channel in enumerate(image["channels"]):
        require(channel.get("index") == i and channel.get("name") == ("scalar" if image["channel_count"] == 1 else ("red", "green", "blue")[i])
                and isinstance(channel.get("file"), str)
                and re.fullmatch(r"imagesTr/" + case_id + f"_{i:04d}" + r"\.nii(?:\.gz)?", channel["file"]), "Invalid channel order / filename / name")
    geometry_validate(m.get("geometry"))
    require(m.get("privacy", {}).get("dicom_headers_included") is False
            and m.get("privacy", {}).get("patient_identifiers_in_manifest") is False, "Invalid case privacy declaration")
    return ids


def extract_case(case_zip, destination, target_label_id, decoded_budget=MAX_EXPANDED_BYTES):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(case_zip) as archive:
        entries = zip_entries(archive)
        manifest = read_json(archive, "manifest.json")
        ids = validate_case_manifest(manifest)
        paths = [c["file"] for c in manifest["image"]["channels"]] + [manifest["label"]["file"]]
        require(set(entries) == {"manifest.json", *paths}, "Missing image/label or unexpected Training ZIP files")
        extracted, inflated_total = [], 0
        for index, name in enumerate(paths):
            # Never extract arbitrary names or headers. Gzip is bounded before nibabel touches it.
            path = destination / f"volume_{index}.nii"
            with archive.open(name) as member, path.open("xb") as output:
                if name.endswith(".gz"):
                    with gzip.GzipFile(fileobj=member) as decoded:
                        size = copy_bounded(decoded, output, min(MAX_EXPANDED_BYTES, decoded_budget) - inflated_total)
                else:
                    size = copy_bounded(member, output, min(MAX_EXPANDED_BYTES, decoded_budget) - inflated_total)
                inflated_total += size
            extracted.append(path)
    label, actual_ids, _ = load_checked_nifti(extracted[-1], manifest["geometry"], label=True)
    require(ids == actual_ids and manifest["label"].get("datatype") == label.get_data_dtype().name, "Manifest label IDs / datatype disagree with voxels")
    for channel, path in zip(manifest["image"]["channels"], extracted[:-1]):
        image, _, value_range = load_checked_nifti(path, manifest["geometry"])
        require(not channel.get("datatype") or channel["datatype"] == image.get_data_dtype().name, "Image datatype disagrees with manifest")
        if manifest["image"]["channel_count"] == 3:
            require(value_range[0] >= 0 and value_range[1] <= 255, "RGB channels require a 0–255 range")
    binary = np.zeros(label.shape[:3], dtype=np.uint8)
    for z in range(binary.shape[2]):
        binary[:, :, z] = np.asarray(label.dataobj[:, :, z]).reshape(binary.shape[:2]) == target_label_id
    binary_path = destination / "binary_target.nii"
    binary_image = nib.Nifti1Image(binary, label.affine)
    binary_image.header.set_xyzt_units("mm")
    nib.save(binary_image, binary_path)
    return {"case_id": manifest["case_id"], "image": [str(p) for p in extracted[:-1]], "label": str(binary_path),
            "original_label": str(extracted[-1]), "geometry": manifest["geometry"],
            "channel_count": manifest["image"]["channel_count"], "source_category": category(manifest["image"]),
            "source_format": manifest["image"]["source_format"], "intensity_policy": manifest["image"]["intensity_policy"],
            "label_ids": sorted(ids), "objects": manifest["label"]["objects"], "target_voxels": int(binary.sum()),
            "decoded_bytes": inflated_total + binary_path.stat().st_size}


def validate_dataset_manifest(m):
    require(isinstance(m, dict) and m.get("format") == DATASET_FORMAT
            and m.get("training_case_format") == CASE_FORMAT and valid_id(m.get("dataset_id"), "TR3D"), "Invalid dataset format / ID")
    task = m.get("task", {})
    require(task.get("type") == "binary_segmentation" and type(task.get("target_label_id")) is int
            and 1 <= task["target_label_id"] <= 65535 and isinstance(task.get("target_name"), str)
            and 0 < len(task["target_name"].strip()) <= 80, "Invalid binary target")
    require(task.get("annotation_policy") == "complete_for_selected_target", "Annotation completeness not confirmed")
    require(type(m.get("input", {}).get("channel_count")) is int and m["input"]["channel_count"] in (1, 3), "Invalid dataset channel count")
    require(isinstance(m.get("cases"), list) and 0 < len(m["cases"]) <= MAX_CASES, "Invalid dataset case count")
    seen = set()
    for case in m["cases"]:
        require(valid_id(case.get("case_id"), "SR3D") and case["case_id"].lower() not in seen, "Invalid or duplicate case_id")
        seen.add(case["case_id"].lower())
        require(case.get("file") == f"cases/SegRef3D_Train_{case['case_id']}.zip", "Invalid nested case filename")
    require(m.get("privacy", {}).get("processing_before_colab") == "browser_local"
            and m.get("privacy", {}).get("image_data_may_be_identifiable") is True, "Invalid privacy declaration")


def split_cases(case_ids, seed=42):
    ids = sorted(case_ids)
    require(ids and len(set(ids)) == len(ids), "Cannot split empty / duplicate cases")
    random.Random(seed).shuffle(ids)
    if len(ids) == 1:
        return {"train": ids[:], "validation": ids[:], "mode": "resubstitution_smoke_only"}
    n = max(1, math.ceil(len(ids) * 0.2))
    return {"train": ids[n:], "validation": ids[:n], "mode": "held_out_cases"}


def spacing_summary(cases):
    values = []
    for case in cases:
        affine, spacing = geometry_validate(case["geometry"])
        order = np.argsort(nib.orientations.io_orientation(affine)[:, 0])
        values.append(spacing[order])
    matrix = np.asarray(values)
    return {"coordinate_order": "RAS", "median_mm": np.median(matrix, axis=0).tolist(),
            "min_mm": matrix.min(axis=0).tolist(), "max_mm": matrix.max(axis=0).tolist()}


def prepare_dataset(dataset_zip, work_dir, seed=42):
    dataset_zip = Path(dataset_zip)
    require(dataset_zip.stat().st_size <= MAX_DATASET_BYTES, "Dataset ZIP exceeds the 1 GiB limit")
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix="trainref3d_", dir=work_dir))
    cases, decoded_total = [], 0
    with zipfile.ZipFile(dataset_zip) as outer:
        entries = zip_entries(outer, outer=True)
        manifest = read_json(outer, "dataset_manifest.json")
        validate_dataset_manifest(manifest)
        require(set(entries) == {"dataset_manifest.json", *(c["file"] for c in manifest["cases"])}, "Missing or unexpected dataset members")
        require(shutil.disk_usage(root).free > sum(i.file_size for i in entries.values()) + 2 * MAX_EXPANDED_BYTES, "Insufficient free disk for dataset preparation")
        for index, spec in enumerate(manifest["cases"]):
            require(shutil.disk_usage(root).free > 2 * MAX_EXPANDED_BYTES, "Insufficient free disk for next case")
            # Spool just one nested archive at a time; never extract arbitrary outer paths.
            with tempfile.TemporaryFile() as nested:
                with outer.open(spec["file"]) as member:
                    copy_bounded(member, nested, MAX_CASE_BYTES)
                nested.seek(0)
                case = extract_case(nested, root / f"case_{index:04d}", manifest["task"]["target_label_id"], MAX_DATASET_DECODED_BYTES - decoded_total)
                decoded_total += case["decoded_bytes"]
                require(decoded_total <= MAX_DATASET_DECODED_BYTES, "Combined decoded dataset exceeds the 8 GiB safety limit")
            require(case["case_id"] == spec["case_id"], "Nested case_id mismatch")
            require(case["channel_count"] == manifest["input"]["channel_count"], "Mixed channel counts")
            if cases:
                require(case["source_category"] == cases[0]["source_category"], "Mixed source intensity semantics")
            cases.append(case)
    require(any(manifest["task"]["target_label_id"] in c["label_ids"] for c in cases), "Selected target is absent from every case")
    source_category = cases[0]["source_category"]
    require(manifest["input"].get("source_category", source_category) == source_category, "Source category mismatch")
    split = split_cases([c["case_id"] for c in cases], seed)
    notes = []
    n = len(cases)
    if n < 5:
        notes.append("Experimental smoke test only (1–4 cases).")
    elif n < 10:
        notes.append("Very small training dataset (5–9 cases).")
    elif n < 20:
        notes.append("Small dataset; validation estimates may be unstable.")
    if split["mode"] != "held_out_cases":
        notes.append("One case: resubstitution smoke-test Dice is NOT held-out validation.")
    target_names = {o["name"] for c in cases for o in c["objects"] if o["id"] == manifest["task"]["target_label_id"]}
    if len(target_names) > 1:
        notes.append("Target Obj names conflict. The confirmed Obj ID is used without remapping.")
    if len({(c["source_format"], c["intensity_policy"]) for c in cases}) > 1:
        notes.append("Different source/intensity policies: verify the same imaging domain; CT/MRI modality is not inferred.")
    for group in ("train", "validation"):
        if not any(c["target_voxels"] > 0 for c in cases if c["case_id"] in split[group]):
            notes.append(f"No positive target cases in {group}; foreground performance cannot be established.")
    # Only whitelisted data is carried into summaries and model metadata.
    dataset = {"dataset_id": manifest["dataset_id"], "task": {k: manifest["task"][k] for k in ("type", "target_label_id", "target_name", "annotation_policy")},
               "channel_count": manifest["input"]["channel_count"], "source_category": source_category,
               "cases": cases, "split": split, "spacing": spacing_summary(cases), "warnings": notes, "work_dir": str(root)}
    print(json.dumps({"dataset_id": dataset["dataset_id"], "case_count": n, "negative_cases": sum(c["target_voxels"] == 0 for c in cases),
                      "target": dataset["task"], "spacing": dataset["spacing"], "split": split, "warnings": notes}, indent=2))
    return dataset


@dataclass
class TrainingConfig:
    epochs: int = 100
    learning_rate: float = 1e-4
    patch_size: tuple = (96, 96, 96)
    batch_size: int = 1
    num_workers: int = 2
    random_seed: int = 42
    patience: int = 20
    samples_per_case: int = 2
    channels: tuple = (16, 32, 64, 128, 256)
    strides: tuple = (2, 2, 2, 2)
    num_res_units: int = 2
    max_resampled_voxels: int = 64000000

    def validate(self):
        for key in ("epochs", "batch_size", "patience", "samples_per_case", "max_resampled_voxels"):
            require(type(getattr(self, key)) is int and getattr(self, key) > 0, f"Invalid {key}")
        require(type(self.num_workers) is int and self.num_workers >= 0 and type(self.random_seed) is int, "Invalid workers / seed")
        require(math.isfinite(self.learning_rate) and self.learning_rate > 0, "Invalid learning rate")
        require(len(self.strides) == len(self.channels) - 1 and all(type(s) is int and s >= 1 for s in self.strides)
                and all(type(c) is int and c > 0 for c in self.channels) and len(self.channels) >= 2, "Invalid UNet channels/strides")
        multiple = math.prod(self.strides)
        require(len(self.patch_size) == 3 and all(type(s) is int and s >= multiple * 2 and s % multiple == 0 for s in self.patch_size), "Patch dimensions must be at least 2x, and divisible by, the network stride product")


def architecture_config(dataset, config):
    return {"spatial_dims": 3, "in_channels": dataset["channel_count"], "out_channels": 2,
            "channels": list(config.channels), "strides": list(config.strides), "num_res_units": config.num_res_units,
            "norm": "INSTANCE", "act": "PRELU", "dropout": 0.0, "bias": True}


def preprocessing_config(dataset, config):
    return {"orientation": "RAS", "spacing_mm": dataset["spacing"]["median_mm"],
            "spacing_policy": "dataset_median_per_RAS_axis", "image_interpolation": "bilinear", "label_interpolation": "nearest",
            "intensity": "rgb_divide_255" if dataset["source_category"] == "rgb" else "per_volume_percentile_0.5_99.5_clip_then_zscore",
            "intensity_statistics": "each_channel_including_zero_after_spacing_before_padding",
            "percentile_sampling": {"maximum_voxels": 1000000, "method": "deterministic_flat_stride"},
            "fixed_HU_window": False, "patch_size": list(config.patch_size), "padding": "constant_zero_symmetric",
            "foreground_sampling": {"positive_weight": 1, "negative_weight": 1, "samples_per_case": config.samples_per_case},
            "augmentation": {"random_flip_probability_each_axis": 0.1, "intensity_scale_probability": 0.1, "intensity_scale_factor": 0.1},
            "inference": {"sliding_window_overlap": 0.25, "mode": "gaussian", "class_selection": "argmax", "foreground_channel": 1}}


class NormalizeIntensity:
    def __init__(self, rgb=False):
        self.rgb = rgb

    def __call__(self, data):
        import torch
        result = dict(data)
        image = result["image"].clone().float()
        for channel in image:
            if self.rgb:
                channel.div_(255.0)
            else:
                values = channel.as_tensor() if hasattr(channel, "as_tensor") else channel
                flat = values.flatten()
                sample = flat[::max(1, math.ceil(flat.numel() / 1000000))]
                low, high = torch.quantile(sample, torch.tensor([0.005, 0.995]))
                channel.clamp_(float(low), float(high))
                channel.sub_(channel.mean()).div_(channel.std(unbiased=False).clamp_min(1e-8))
        result["image"] = image
        return result


def make_transforms(dataset, config, training=False):
    from monai.transforms import (Compose, LoadImaged, EnsureChannelFirstd, Orientationd, Spacingd, SpatialPadd,
                                  RandCropByPosNegLabeld, RandFlipd, RandScaleIntensityd, EnsureTyped)
    keys = ("image", "label")
    transforms = [LoadImaged(keys=keys, dtype=np.float32), EnsureChannelFirstd(keys=keys),
                  Orientationd(keys=keys, axcodes="RAS", labels=(("L", "R"), ("P", "A"), ("I", "S"))),
                  Spacingd(keys=keys, pixdim=dataset["spacing"]["median_mm"], mode=("bilinear", "nearest")),
                  NormalizeIntensity(dataset["source_category"] == "rgb")]
    if training:
        transforms.extend([SpatialPadd(keys=keys, spatial_size=config.patch_size, mode="constant"),
                           RandCropByPosNegLabeld(keys=keys, label_key="label", spatial_size=config.patch_size,
                                                 pos=1, neg=1, num_samples=config.samples_per_case),
                           *(RandFlipd(keys=keys, prob=0.1, spatial_axis=i) for i in range(3)),
                           RandScaleIntensityd(keys="image", factors=0.1, prob=0.1)])
    transforms.append(EnsureTyped(keys=keys))
    return Compose(transforms)


def build_model(architecture):
    from monai.networks.nets import UNet
    return UNet(**architecture)


def validate_model(model, cases, transform, device, patch_size):
    import torch
    from monai.inferers import sliding_window_inference
    from monai.metrics import DiceMetric
    rows = []
    model.eval()
    with torch.inference_mode():
        for case in cases:
            item = transform(case)
            image = item["image"].unsqueeze(0)  # Full volume stays on CPU; only patches go to CUDA.
            truth = item["label"].unsqueeze(0) > 0.5
            output = sliding_window_inference(image, roi_size=patch_size, sw_batch_size=1, predictor=model,
                                             overlap=0.25, mode="gaussian", sw_device=device, device="cpu")
            prediction = output.argmax(dim=1, keepdim=True) == 1
            metric = DiceMetric(include_background=True, reduction="mean", ignore_empty=False)
            # One channel here is foreground only, not the two-class network output.
            metric(y_pred=prediction.float(), y=truth.float())
            dice = float(metric.aggregate().item())
            require(math.isfinite(dice), "Non-finite validation Dice")
            rows.append({"case_id": case["case_id"], "dice": dice, "target_voxels_resampled": int(truth.sum()),
                         "predicted_voxels": int(prediction.sum())})
    return rows


def model_manifest(dataset, config, model_id, epochs_completed, best_epoch, best_dice, versions):
    require(valid_id(model_id, "TR3DM"), "Invalid model ID")
    return {"format": MODEL_FORMAT, "model_id": model_id, "framework": "MONAI/PyTorch", "architecture": "3D UNet",
            "architecture_config": architecture_config(dataset, config), "checkpoint_format": "state_dict_and_architecture_config",
            "task": {key: dataset["task"][key] for key in ("type", "target_label_id", "target_name")},
            "input": {"channel_count": dataset["channel_count"], "source_category": dataset["source_category"], "target_spacing_mm": dataset["spacing"]["median_mm"]},
            "preprocessing": preprocessing_config(dataset, config),
            "training": {"epochs_completed": epochs_completed, "best_epoch": best_epoch, "best_validation_dice": best_dice,
                         "random_seed": config.random_seed, "config": asdict(config), "optimizer": "AdamW", "weight_decay": 0.01,
                         "loss": "DiceCELoss(include_background=False, to_onehot_y=True, softmax=True)"},
            "dataset": {"dataset_id": dataset["dataset_id"], "case_count": len(dataset["cases"]),
                        "train_case_ids": dataset["split"]["train"], "validation_case_ids": dataset["split"]["validation"],
                        "split_mode": dataset["split"]["mode"], "spacing_summary": dataset["spacing"],
                        "case_sources": [{k: c[k] for k in ("case_id", "source_format", "intensity_policy")} for c in dataset["cases"]]},
            "validation": {"metric": "foreground_Dice", "grid": "RAS_target_spacing", "aggregation": "mean_per_case_including_negatives",
                           "empty_target_policy": "both_empty=1; target_empty_prediction_nonempty=0", "selection": "best_epoch_internal_split"},
            "versions": versions, "warnings": dataset["warnings"],
            "privacy": {"image_data_included": False, "names_may_be_identifiable": True},
            "intended_use": "Research only; internal validation does not establish clinical validity or generalizability."}


def write_csv(path, rows):
    with Path(path).open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def train(dataset, output_dir, config=None, *, allow_cpu=False):
    import torch
    import monai
    from monai.data import DataLoader, Dataset
    from monai.losses import DiceCELoss
    from monai.utils import set_determinism
    config = config or TrainingConfig()
    config.validate()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type != "cuda":
        warnings.warn("No CUDA GPU: CPU training is for tiny smoke tests only. Select a T4 GPU in Colab.")
        require(allow_cpu, "CUDA GPU required. Set allow_cpu=True only for an intentional tiny smoke test.")
    set_determinism(seed=config.random_seed)
    dataset = dict(dataset)
    dataset["split"] = split_cases([c["case_id"] for c in dataset["cases"]], config.random_seed)
    spacing = np.asarray(dataset["spacing"]["median_mm"])
    from monai.data.utils import compute_shape_offset
    for case in dataset["cases"]:
        # Guard before any resampling allocation, including rotated/oblique bounding boxes.
        target_affine = np.diag([*spacing, 1.0])
        shape, _ = compute_shape_offset(case["geometry"]["shape"], np.asarray(case["geometry"]["affine"]), target_affine)
        require(math.prod(shape) * dataset["channel_count"] <= config.max_resampled_voxels,
                "Resampled case exceeds CPU memory guard. Reduce source resolution deliberately or use a separate dataset.")
    train_cases = [c for c in dataset["cases"] if c["case_id"] in dataset["split"]["train"]]
    val_cases = [c for c in dataset["cases"] if c["case_id"] in dataset["split"]["validation"]]
    # Cache-free datasets avoid holding every volume in host memory.
    loader = DataLoader(Dataset(train_cases, make_transforms(dataset, config, True)), batch_size=config.batch_size,
                        shuffle=True, num_workers=config.num_workers, pin_memory=device.type == "cuda")
    val_transform = make_transforms(dataset, config)
    architecture = architecture_config(dataset, config)
    model = build_model(architecture).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.learning_rate, weight_decay=0.01)
    loss_function = DiceCELoss(include_background=False, to_onehot_y=True, softmax=True)
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    run_dir = Path(output_dir) / ("run_" + uuid4().hex[:16])
    run_dir.mkdir(parents=True, exist_ok=False)
    best_path = run_dir / "best_model.pt"
    history, best, best_epoch = [], -1.0, 0
    for epoch in range(1, config.epochs + 1):
        model.train()
        total, steps = 0.0, 0
        for batch in loader:
            image, label = batch["image"].to(device), batch["label"].to(device)
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type, enabled=device.type == "cuda"):
                loss = loss_function(model(image), label)
            require(torch.isfinite(loss).item(), "Non-finite training loss")
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            total += float(loss.item())
            steps += 1
        metrics = validate_model(model, val_cases, val_transform, device, config.patch_size)
        mean_dice = float(np.mean([row["dice"] for row in metrics]))
        if mean_dice > best:
            best, best_epoch = mean_dice, epoch
            torch.save({"state_dict": {k: v.detach().cpu() for k, v in model.state_dict().items()},
                        "architecture_config": architecture}, best_path)
        history.append({"epoch": epoch, "train_loss": total / steps, "validation_dice": mean_dice, "best_dice": best})
        write_csv(run_dir / "training_history.csv", history)
        print(f"Epoch {epoch} / {config.epochs} | Train loss: {total/steps:.5f} | Validation Dice: {mean_dice:.5f} | Best Dice: {best:.5f}", flush=True)
        if epoch - best_epoch >= config.patience:
            print(f"Early stopping after {config.patience} epochs without improvement.")
            break
    checkpoint = torch.load(best_path, map_location="cpu", weights_only=True)
    model.load_state_dict(checkpoint["state_dict"])
    metrics = validate_model(model, val_cases, val_transform, device, config.patch_size)
    write_csv(run_dir / "validation_metrics.csv", metrics)
    for row in metrics:
        print(f"{row['case_id']}  foreground Dice={row['dice']:.5f}")
    model_id = "TR3DM_" + uuid4().hex[:16]
    manifest = model_manifest(dataset, config, model_id, len(history), best_epoch, best,
                              {"python": platform.python_version(), "torch": torch.__version__, "monai": monai.__version__,
                               "numpy": np.__version__, "nibabel": nib.__version__, "device": str(device),
                               "backend_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})
    (run_dir / "model_manifest.json").write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    (run_dir / "README.txt").write_text(
        "TrainRef3D research model. NOT clinically validated.\n"
        "model.pt contains state_dict and architecture_config, not a pickled full model.\n"
        "Load trusted checkpoints with torch.load(..., weights_only=True), build MONAI UNet from architecture_config, then load_state_dict.\n"
        "Reproduce preprocessing and target spacing from model_manifest.json. Output class 1 maps to task.target_label_id.\n"
        "Validation is on the resampled grid; both-empty Dice=1, empty-target false positive Dice=0.\n"
        "A one-case run uses resubstitution smoke-test Dice, not held-out performance.\n"
        "Inference integration / SegRef3D prediction import are not implemented.\n"
        "Object/target names may contain identifiable information.\n", encoding="utf-8")
    archive_path = run_dir / f"TrainRef3D_Model_{model_id}.zip"
    with zipfile.ZipFile(archive_path, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(best_path, "model.pt")
        for name in ("model_manifest.json", "training_history.csv", "validation_metrics.csv", "README.txt"):
            archive.write(run_dir / name, name)
    print(manifest["intended_use"])
    return {"archive": str(archive_path), "manifest": manifest, "history": history, "metrics": metrics,
            "checkpoint": str(best_path), "run_dir": str(run_dir)}


def plot_history(result):
    import matplotlib.pyplot as plt
    history = result["history"]
    figure, axes = plt.subplots(1, 2, figsize=(10, 3))
    for axis, key, title in zip(axes, ("train_loss", "validation_dice"), ("Training loss", "Internal validation foreground Dice")):
        axis.plot([row["epoch"] for row in history], [row[key] for row in history])
        axis.set(xlabel="Epoch", title=title)
    figure.tight_layout()
    plt.show()
    return figure
