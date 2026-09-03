"""InferRef3D v1.0: trusted TrainRef3D state_dict + canonical request -> reviewable labelmap.

Archives are validated before extraction. The source is never uploaded by this
module itself, model checkpoints are loaded with weights_only=True, and the
prediction is resampled back to the request's exact original NIfTI grid.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import math
import platform
import tempfile
import zipfile
from pathlib import Path

import nibabel as nib
import numpy as np

import trainref3d_backend as train

MODEL_FORMAT = "trainref3d-model-1.0"
REQUEST_FORMAT = "trainref3d-inference-request-1.0"
RESULT_FORMAT = "trainref3d-inference-result-1.0"
MAX_MODEL_BYTES = 1024**3
MAX_REQUEST_BYTES = 1024**3
MAX_RESULT_BYTES = 768 * 1024**2
SOURCE_CATEGORIES = {"medical_scalar", "grayscale_8bit", "rgb"}


def sha256_file(path, chunk_size=1024**2):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        while chunk := stream.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def backend_sha256():
    return sha256_file(__file__)


def exact_members(entries, expected, description):
    train.require(set(entries) == set(expected), f"{description} contains missing or unexpected files")


def valid_sha256(value):
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)


def validate_model_manifest(manifest):
    train.require(isinstance(manifest, dict) and manifest.get("format") == MODEL_FORMAT
                  and train.valid_id(manifest.get("model_id"), "TR3DM"), "Invalid model format / ID")
    train.require(manifest.get("framework") == "MONAI/PyTorch" and manifest.get("architecture") == "3D UNet",
                  "Unsupported model framework / architecture")
    task = manifest.get("task", {})
    train.require(task.get("type") == "binary_segmentation" and type(task.get("target_label_id")) is int
                  and 1 <= task["target_label_id"] <= 20 and isinstance(task.get("target_name"), str)
                  and 0 < len(task["target_name"].strip()) <= 80, "Invalid model target")
    model_input = manifest.get("input", {})
    train.require(type(model_input.get("channel_count")) is int and model_input["channel_count"] in (1, 3)
                  and model_input.get("source_category") in SOURCE_CATEGORIES
                  and (model_input["channel_count"] == 3) == (model_input["source_category"] == "rgb"),
                  "Invalid model input contract")
    spacing = np.asarray(model_input.get("target_spacing_mm"), dtype=np.float64)
    train.require(spacing.shape == (3,) and np.isfinite(spacing).all() and (spacing > 0).all(),
                  "Invalid model target spacing")
    architecture = manifest.get("architecture_config", {})
    train.require(architecture.get("spatial_dims") == 3
                  and architecture.get("in_channels") == model_input["channel_count"]
                  and architecture.get("out_channels") == 2
                  and isinstance(architecture.get("channels"), list) and len(architecture["channels"]) >= 2
                  and all(type(x) is int and x > 0 for x in architecture["channels"])
                  and isinstance(architecture.get("strides"), list)
                  and len(architecture["strides"]) == len(architecture["channels"]) - 1
                  and all(type(x) is int and x > 0 for x in architecture["strides"])
                  and type(architecture.get("num_res_units")) is int and architecture["num_res_units"] >= 0,
                  "Invalid architecture_config")
    train.require(manifest.get("checkpoint_format") == "state_dict_and_architecture_config",
                  "Unsupported checkpoint format")
    preprocessing = manifest.get("preprocessing", {})
    expected_intensity = ("rgb_divide_255" if model_input["source_category"] == "rgb"
                          else "per_volume_percentile_0.5_99.5_clip_then_zscore")
    train.require(preprocessing.get("orientation") == "RAS"
                  and preprocessing.get("spacing_policy") == "dataset_median_per_RAS_axis"
                  and preprocessing.get("image_interpolation") == "bilinear"
                  and preprocessing.get("label_interpolation") == "nearest"
                  and preprocessing.get("intensity") == expected_intensity
                  and preprocessing.get("spacing_mm") == model_input["target_spacing_mm"],
                  "Unsupported or inconsistent preprocessing contract")
    patch = preprocessing.get("patch_size")
    train.require(isinstance(patch, list) and len(patch) == 3
                  and all(type(x) is int and x > 0 for x in patch), "Invalid inference patch size")
    inference = preprocessing.get("inference", {})
    overlap = inference.get("sliding_window_overlap")
    train.require(type(overlap) in (int, float) and math.isfinite(overlap) and 0 <= overlap < 1
                  and inference.get("mode") in ("constant", "gaussian")
                  and inference.get("class_selection") == "argmax"
                  and inference.get("foreground_channel") == 1, "Invalid inference contract")
    return manifest


def load_model_zip(model_zip, work_dir):
    model_zip = Path(model_zip)
    train.require(model_zip.is_file() and model_zip.stat().st_size <= MAX_MODEL_BYTES, "Model ZIP exceeds safety limit")
    root = Path(tempfile.mkdtemp(prefix="inferref3d_model_", dir=work_dir))
    with zipfile.ZipFile(model_zip) as archive:
        entries = train.zip_entries(archive)
        expected = {"model.pt", "model_manifest.json", "training_history.csv", "validation_metrics.csv", "README.txt"}
        exact_members(entries, expected, "Model ZIP")
        manifest = validate_model_manifest(train.read_json(archive, "model_manifest.json"))
        checkpoint_path = root / "model.pt"
        with archive.open("model.pt") as source, checkpoint_path.open("xb") as target:
            train.copy_bounded(source, target, train.MAX_EXPANDED_BYTES)
        train.require(checkpoint_path.stat().st_size > 0, "Empty model.pt")
    return {"manifest": manifest, "checkpoint": str(checkpoint_path), "sha256": sha256_file(model_zip),
            "archive": str(model_zip), "work_dir": str(root)}


def validate_request_manifest(manifest):
    train.require(isinstance(manifest, dict) and manifest.get("format") == REQUEST_FORMAT
                  and train.valid_id(manifest.get("request_id"), "TR3DI"), "Invalid request format / ID")
    model = manifest.get("model", {})
    train.require(model.get("format") == MODEL_FORMAT and train.valid_id(model.get("model_id"), "TR3DM")
                  and valid_sha256(model.get("model_sha256"))
                  and type(model.get("target_label_id")) is int and 1 <= model["target_label_id"] <= 20
                  and isinstance(model.get("target_name"), str) and 0 < len(model["target_name"].strip()) <= 80,
                  "Invalid request model reference")
    image = manifest.get("input", {})
    train.require(type(image.get("channel_count")) is int and image["channel_count"] in (1, 3)
                  and image.get("source_category") in SOURCE_CATEGORIES
                  and (image["channel_count"] == 3) == (image["source_category"] == "rgb")
                  and isinstance(image.get("source_format"), str) and 0 < len(image["source_format"]) <= 32
                  and isinstance(image.get("intensity_policy"), str) and 0 < len(image["intensity_policy"]) <= 96
                  and isinstance(image.get("channels"), list) and len(image["channels"]) == image["channel_count"],
                  "Invalid request input contract")
    request_id = manifest["request_id"]
    names = ("scalar",) if image["channel_count"] == 1 else ("red", "green", "blue")
    for index, channel in enumerate(image["channels"]):
        train.require(channel.get("index") == index and channel.get("name") == names[index]
                      and isinstance(channel.get("file"), str)
                      and __import__("re").fullmatch(r"input/" + request_id + f"_{index:04d}" + r"\.nii(?:\.gz)?", channel["file"])
                      and valid_sha256(channel.get("sha256")), "Invalid request channel")
    train.geometry_validate(manifest.get("geometry"))
    privacy = manifest.get("privacy", {})
    train.require(privacy.get("dicom_headers_included") is False
                  and privacy.get("image_data_may_be_identifiable") is True
                  and privacy.get("processing") == "browser_local", "Invalid request privacy declaration")
    return manifest


def load_request_zip(request_zip, work_dir):
    request_zip = Path(request_zip)
    train.require(request_zip.is_file() and request_zip.stat().st_size <= MAX_REQUEST_BYTES, "Request ZIP exceeds safety limit")
    root = Path(tempfile.mkdtemp(prefix="inferref3d_request_", dir=work_dir))
    with zipfile.ZipFile(request_zip) as archive:
        entries = train.zip_entries(archive)
        manifest = validate_request_manifest(train.read_json(archive, "request_manifest.json"))
        embedded_model = train.read_json(archive, "model/model_manifest.json")
        paths = [item["file"] for item in manifest["input"]["channels"]]
        exact_members(entries, {"request_manifest.json", "model/model_manifest.json", *paths}, "Request ZIP")
        extracted = []
        for index, item in enumerate(manifest["input"]["channels"]):
            raw = archive.read(item["file"])
            train.require(sha256_bytes(raw) == item["sha256"], "Request channel SHA-256 mismatch")
            target = root / f"input_{index}.nii"
            if item["file"].endswith(".gz"):
                with gzip.GzipFile(fileobj=io.BytesIO(raw)) as source, target.open("xb") as output:
                    train.copy_bounded(source, output, train.MAX_EXPANDED_BYTES)
            else:
                with target.open("xb") as output:
                    output.write(raw)
            volume, _, value_range = train.load_checked_nifti(target, manifest["geometry"])
            train.require(not item.get("datatype") or item["datatype"] == volume.get_data_dtype().name,
                          "Request channel datatype mismatch")
            if manifest["input"]["source_category"] == "rgb":
                train.require(value_range[0] >= 0 and value_range[1] <= 255, "RGB input requires 0-255 channels")
            extracted.append(str(target))
    return {"manifest": manifest, "embedded_model_manifest": embedded_model, "image": extracted,
            "channel_sha256": [item["sha256"] for item in manifest["input"]["channels"]],
            "work_dir": str(root), "archive": str(request_zip)}


def validate_model_request(model, request):
    manifest = validate_model_manifest(model["manifest"])
    request_manifest = validate_request_manifest(request["manifest"])
    train.require(model["sha256"] == request_manifest["model"]["model_sha256"], "Model ZIP SHA-256 mismatch")
    train.require(request["embedded_model_manifest"] == manifest, "Embedded and uploaded model manifests disagree")
    task = manifest["task"]
    image = manifest["input"]
    train.require(request_manifest["model"]["model_id"] == manifest["model_id"]
                  and request_manifest["model"]["target_label_id"] == task["target_label_id"]
                  and request_manifest["model"]["target_name"] == task["target_name"],
                  "Request model ID or target mismatch")
    train.require(request_manifest["input"]["channel_count"] == image["channel_count"]
                  and request_manifest["input"]["source_category"] == image["source_category"],
                  "Request input channel count or source category mismatch")
    return True


def load_weights_model(model_info, device):
    import torch
    checkpoint = torch.load(model_info["checkpoint"], map_location="cpu", weights_only=True)
    train.require(isinstance(checkpoint, dict) and set(checkpoint) == {"state_dict", "architecture_config"}
                  and checkpoint["architecture_config"] == model_info["manifest"]["architecture_config"]
                  and isinstance(checkpoint["state_dict"], dict), "Checkpoint / manifest architecture mismatch")
    model = train.build_model(model_info["manifest"]["architecture_config"])
    model.load_state_dict(checkpoint["state_dict"], strict=True)
    model.to(device).eval()
    return model


def preprocessing_transform(model_manifest):
    from monai.transforms import Compose, EnsureChannelFirstd, EnsureTyped, LoadImaged, Orientationd, Spacingd
    config = model_manifest["preprocessing"]
    # validate_model_manifest guarantees these values are the exact TrainRef3D v1.0 training contract.
    return Compose([
        LoadImaged(keys="image", dtype=np.float32),
        EnsureChannelFirstd(keys="image"),
        Orientationd(keys="image", axcodes=config["orientation"], labels=(("L", "R"), ("P", "A"), ("I", "S"))),
        Spacingd(keys="image", pixdim=config["spacing_mm"], mode=config["image_interpolation"]),
        train.NormalizeIntensity(model_manifest["input"]["source_category"] == "rgb"),
        EnsureTyped(keys="image"),
    ])


def predict_to_original_grid(model, request, model_manifest, device):
    import torch
    from monai.inferers import sliding_window_inference
    item = preprocessing_transform(model_manifest)({"image": request["image"]})
    image = item["image"]
    train.require(image.shape[0] == model_manifest["input"]["channel_count"], "Preprocessed channel mismatch")
    config = model_manifest["preprocessing"]
    inference = config["inference"]
    gpu = device.type == "cuda"
    if gpu:
        torch.cuda.reset_peak_memory_stats(device)
    with torch.inference_mode(), torch.autocast(device_type=device.type, dtype=torch.float16, enabled=gpu):
        logits = sliding_window_inference(
            image.unsqueeze(0), roi_size=config["patch_size"], sw_batch_size=1, predictor=model,
            overlap=inference["sliding_window_overlap"], mode=inference["mode"],
            sw_device=device, device="cpu",
        )
        binary = (logits.argmax(dim=1)[0] == inference["foreground_channel"]).to(torch.uint8).numpy()
    target_affine = np.asarray(image.affine, dtype=np.float64)
    target = nib.Nifti1Image(binary, target_affine)
    original = request["manifest"]["geometry"]
    original_affine, _ = train.geometry_validate(original)
    from nibabel.processing import resample_from_to
    restored = resample_from_to(target, (tuple(original["shape"]), original_affine), order=0, mode="constant", cval=0)
    restored_binary = (np.asarray(restored.dataobj) > 0).astype(np.uint8)
    target_id = model_manifest["task"]["target_label_id"]
    prediction = restored_binary * np.uint8(target_id)
    train.require(list(prediction.shape) == original["shape"]
                  and np.allclose(restored.affine, original_affine, rtol=0, atol=train.TOLERANCE),
                  "Prediction inverse geometry mismatch")
    peak = int(torch.cuda.max_memory_allocated(device)) if gpu else None
    return prediction, original_affine, peak


def result_manifest(model, request, prediction_file, prediction_sha256, foreground_voxels, device, peak_gpu_memory):
    import monai
    import torch
    manifest = model["manifest"]
    task = manifest["task"]
    geometry = request["manifest"]["geometry"]
    return {
        "format": RESULT_FORMAT, "status": "success", "request_id": request["manifest"]["request_id"],
        "model": {"model_id": manifest["model_id"], "model_sha256": model["sha256"],
                  "target_label_id": task["target_label_id"], "target_name": task["target_name"]},
        "source": {"channel_count": manifest["input"]["channel_count"],
                   "channel_sha256": request["channel_sha256"], "source_category": manifest["input"]["source_category"],
                   "original_geometry": geometry},
        "prediction": {"file": prediction_file, "sha256": prediction_sha256, "datatype": "uint8",
                       "label_values": [0, task["target_label_id"]],
                       "foreground_voxel_count": foreground_voxels, "geometry": geometry},
        "inference": {"architecture": manifest["architecture"], "target_spacing_mm": manifest["input"]["target_spacing_mm"],
                      "preprocessing": manifest["preprocessing"], "sliding_window": manifest["preprocessing"]["inference"],
                      "device": str(device), "peak_gpu_memory_bytes": peak_gpu_memory},
        "versions": {"python": platform.python_version(), "torch": torch.__version__, "monai": monai.__version__,
                     "cuda": torch.version.cuda},
        "backend": {"source_sha256": backend_sha256()},
        "privacy": {"source_images_included": False, "model_weights_included": False},
        "safety": "Algorithmic segmentation for review and correction; not an independent clinical diagnosis.",
    }


def run_inference(model_zip, request_zip, output_dir, *, allow_cpu=False):
    import torch
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    work_dir = Path(tempfile.mkdtemp(prefix="inferref3d_", dir=output_dir))
    model_info = load_model_zip(model_zip, work_dir)
    request = load_request_zip(request_zip, work_dir)
    validate_model_request(model_info, request)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train.require(device.type == "cuda" or allow_cpu, "CUDA GPU required; allow_cpu=True is only for a tiny smoke test")
    model = load_weights_model(model_info, device)
    prediction, affine, peak = predict_to_original_grid(model, request, model_info["manifest"], device)
    request_id = request["manifest"]["request_id"]
    prediction_path = work_dir / "prediction.nii.gz"
    prediction_image = nib.Nifti1Image(prediction, affine)
    prediction_image.header.set_xyzt_units("mm")
    prediction_image.set_qform(affine, code=1)
    prediction_image.set_sform(affine, code=1)
    nib.save(prediction_image, prediction_path)
    prediction_sha = sha256_file(prediction_path)
    result = result_manifest(model_info, request, "prediction.nii.gz", prediction_sha,
                             int(np.count_nonzero(prediction)), device, peak)
    result_path = output_dir / f"TrainRef3D_Inference_Result_{request_id}.zip"
    with zipfile.ZipFile(result_path, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(prediction_path, "prediction.nii.gz")
        archive.writestr("inference_result.json", json.dumps(result, indent=2) + "\n")
        archive.writestr("README.txt", "Prediction is algorithmic and must be reviewed and corrected in SegRef3D Lite.\n"
                         "It is not an independent clinical diagnosis.\n")
    train.require(result_path.stat().st_size <= MAX_RESULT_BYTES, "Inference Result ZIP exceeds safety limit")
    print(json.dumps({"request_id": request_id, "model_id": model_info["manifest"]["model_id"],
                      "device": str(device), "foreground_voxels": int(np.count_nonzero(prediction)),
                      "peak_gpu_memory_bytes": peak, "result_zip": str(result_path)}, indent=2))
    return {"result_zip": str(result_path), "manifest": result, "prediction": str(prediction_path),
            "device": str(device), "peak_gpu_memory_bytes": peak, "work_dir": str(work_dir)}
