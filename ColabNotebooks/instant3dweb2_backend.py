"""Gradio-free TotalSegmentator bridge backend for Instant3DWeb2."""

from __future__ import annotations

import csv
import importlib.metadata
import json
import platform
import shutil
import subprocess
import sys
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path

import nibabel as nib
import numpy as np
from PIL import Image


INSTANT3DWEB2_VERSION = "1.0.0"
LICENSED_TASKS = {
    "heartchambers_highres", "appendicular_bones", "appendicular_bones_mr",
    "tissue_types", "tissue_types_mr", "tissue_4_types", "brain_structures",
    "vertebrae_body", "face", "face_mr", "thigh_shoulder_muscles",
    "thigh_shoulder_muscles_mr", "coronary_arteries",
}


class Instant3DProcessingError(RuntimeError):
    """A concise error intended to be shown directly in Colab."""


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _bridge_modules():
    desktop = _repo_root() / "SegRef3D"
    if str(desktop) not in sys.path:
        sys.path.insert(0, str(desktop))
    from instant3d_bridge import (  # pylint: disable=import-outside-toplevel
        Instant3DBridgeError,
        geometry_mismatches,
        nifti_fingerprint,
        validate_request_zip,
    )
    return Instant3DBridgeError, geometry_mismatches, nifti_fingerprint, validate_request_zip


def _installed_roi_names(task: str) -> set[str]:
    """Read the installed TotalSegmentator task map before starting a long subprocess."""
    try:
        from totalsegmentator import map_to_binary  # pylint: disable=import-outside-toplevel
    except Exception as exc:
        raise Instant3DProcessingError(f"TotalSegmentator ROI catalog could not be imported: {exc}") from exc
    candidates = []
    for name in dir(map_to_binary):
        value = getattr(map_to_binary, name)
        if not isinstance(value, dict):
            continue
        task_value = value.get(task)
        if isinstance(task_value, dict):
            candidates.extend(task_value.keys())
            candidates.extend(task_value.values())
    names = {str(value) for value in candidates if isinstance(value, str)}
    if not names:
        raise Instant3DProcessingError(
            f"The installed TotalSegmentator package does not expose an ROI map for task '{task}'."
        )
    return names


def validate_installed_rois(objects: list[dict]) -> None:
    grouped = defaultdict(list)
    for item in objects:
        if item["task"] in LICENSED_TASKS:
            raise Instant3DProcessingError(
                f"Task '{item['task']}' requires an Academic license and is not supported by Instant3DWeb2 v1."
            )
        grouped[item["task"]].append(item["roi"])
    for task, rois in grouped.items():
        installed = _installed_roi_names(task)
        missing = [roi for roi in rois if roi not in installed]
        if missing:
            raise Instant3DProcessingError(
                f"ROI(s) not found in the installed TotalSegmentator task '{task}': {', '.join(missing)}."
            )


def _device() -> str:
    try:
        import torch  # pylint: disable=import-outside-toplevel
        if torch.cuda.is_available():
            print(f"GPU: {torch.cuda.get_device_name(0)}")
            return "gpu"
    except Exception as exc:
        print(f"GPU detection warning: {exc}")
    print("WARNING: No CUDA GPU is available. TotalSegmentator will run on CPU and may be slow.")
    return "cpu"


def _run_task(source: Path, task: str, rois: list[str], output: Path, fast: bool, device: str) -> dict[str, Path]:
    task_dir = output / task
    task_dir.mkdir(parents=True, exist_ok=True)
    base = [
        "TotalSegmentator", "-i", str(source), "-o", str(task_dir),
        "--task", task, "-d", device, "--nr_thr_resamp", "1", "--nr_thr_saving", "1",
    ]
    if fast:
        base.append("--fast")
    subset = [*base, "--roi_subset", *rois]
    print("Running:", " ".join(subset))
    result = subprocess.run(subset, capture_output=True, text=True, check=False)
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr)
    if result.returncode != 0 and "roi_subset" in (result.stdout + result.stderr).lower():
        print(f"Task '{task}' does not accept --roi_subset in this version; retrying the task and post-filtering outputs.")
        result = subprocess.run(base, capture_output=True, text=True, check=False)
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "unknown TotalSegmentator error")[-3000:]
        raise Instant3DProcessingError(f"TotalSegmentator task '{task}' failed:\n{tail}")
    found = {}
    for roi in rois:
        candidates = [task_dir / f"{roi}.nii.gz", task_dir / f"{roi}.nii"]
        path = next((candidate for candidate in candidates if candidate.is_file()), None)
        if path is None:
            matches = list(task_dir.rglob(f"*{roi}*.nii*"))
            path = matches[0] if matches else None
        if path is None:
            raise Instant3DProcessingError(
                f"TotalSegmentator completed task '{task}', but output ROI '{roi}' was not found."
            )
        found[roi] = path
    return found


def _on_source_grid(mask_path: Path, source: nib.Nifti1Image) -> np.ndarray:
    mask = nib.load(str(mask_path))
    same_grid = mask.shape == source.shape and np.allclose(mask.affine, source.affine, rtol=0, atol=1e-4)
    if not same_grid:
        from nibabel.processing import resample_from_to  # pylint: disable=import-outside-toplevel
        print(f"Resampling {mask_path.name} to the source affine with nearest-neighbor interpolation.")
        mask = resample_from_to(mask, (source.shape, source.affine), order=0)
    array = np.asarray(mask.dataobj) > 0.5
    if array.shape != source.shape:
        raise Instant3DProcessingError(f"Mask geometry could not be matched to the source: {mask_path.name}")
    return array


def _write_nifti(array: np.ndarray, source: nib.Nifti1Image, path: Path) -> None:
    header = source.header.copy()
    header.set_data_dtype(np.uint8)
    image = nib.Nifti1Image(array.astype(np.uint8), source.affine, header)
    image.set_qform(source.affine, code=int(source.header["qform_code"]) or 1)
    image.set_sform(source.affine, code=int(source.header["sform_code"]) or 1)
    nib.save(image, str(path))


def _overlaps(binary_masks: dict[int, np.ndarray]) -> list[dict]:
    result = []
    object_ids = sorted(binary_masks)
    for left_index, object_a in enumerate(object_ids):
        for object_b in object_ids[left_index + 1:]:
            voxels = int(np.count_nonzero(binary_masks[object_a] & binary_masks[object_b]))
            if voxels:
                result.append({"object_a": object_a, "object_b": object_b, "voxels": voxels})
    return result


def _write_label_pngs(labelmap: np.ndarray, output: Path) -> list[dict]:
    label_dir = output / "label_png"
    label_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for index in range(labelmap.shape[2]):
        path = label_dir / f"mask{index + 1:04d}.png"
        Image.fromarray(labelmap[:, :, index].T.astype(np.uint8), mode="L").save(path)
        records.append({"index": index, "key": f"{index + 1:04d}", "archive_path": f"label_png/{path.name}"})
    return records


def _write_volumes(objects: list[dict], binary_masks: dict[int, np.ndarray], spacing, output: Path) -> None:
    statistics = output / "statistics"
    statistics.mkdir(parents=True, exist_ok=True)
    voxel_mm3 = float(np.prod(spacing))
    with open(statistics / "volumes.csv", "w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=[
            "object_id", "display_name", "task", "roi", "voxel_count", "volume_mm3", "volume_ml",
        ])
        writer.writeheader()
        for item in objects:
            count = int(np.count_nonzero(binary_masks[item["object_id"]]))
            writer.writerow({
                **{key: item[key] for key in ("object_id", "display_name", "task", "roi")},
                "voxel_count": count,
                "volume_mm3": count * voxel_mm3,
                "volume_ml": count * voxel_mm3 / 1000.0,
            })


def process_request(request_zip: str | Path, output_zip: str | Path = "/content/instant3d_result.zip") -> Path:
    Instant3DBridgeError, geometry_mismatches, nifti_fingerprint, validate_request_zip = _bridge_modules()
    try:
        with tempfile.TemporaryDirectory(prefix="instant3dweb2-") as temporary:
            work = Path(temporary)
            manifest, source_path = validate_request_zip(request_zip, work / "request")
            if source_path is None:
                raise Instant3DProcessingError("The request source was not extracted.")
            if manifest["source"].get("modality") != "CT":
                raise Instant3DProcessingError("Instant3DWeb2 v1 currently supports CT NIfTI volumes only.")
            validate_installed_rois(manifest["objects"])
            source = nib.load(str(source_path))
            task_groups = defaultdict(list)
            for item in manifest["objects"]:
                task_groups[item["task"]].append(item["roi"])
            task_output = work / "totalsegmentator"
            roi_paths = {}
            device = _device()
            for task, rois in task_groups.items():
                roi_paths.update(_run_task(
                    source_path, task, rois, task_output,
                    bool(manifest.get("options", {}).get("fast", False)), device,
                ))

            result_root = work / "result"
            masks_dir = result_root / "masks"
            labelmap_dir = result_root / "labelmap"
            masks_dir.mkdir(parents=True)
            labelmap_dir.mkdir(parents=True)
            binary_masks = {}
            result_objects = []
            for item in manifest["objects"]:
                object_id = item["object_id"]
                binary = _on_source_grid(roi_paths[item["roi"]], source)
                binary_masks[object_id] = binary
                filename = f"obj{object_id:02d}_{item['roi']}.nii.gz"
                _write_nifti(binary, source, masks_dir / filename)
                result_objects.append({**item, "mask_file": f"masks/{filename}"})

            overlaps = _overlaps(binary_masks)
            labelmap = np.zeros(source.shape, dtype=np.uint8)
            for object_id in sorted(binary_masks):
                labelmap[(labelmap == 0) & binary_masks[object_id]] = object_id
            _write_nifti(labelmap, source, labelmap_dir / "labels.nii.gz")
            label_records = _write_label_pngs(labelmap, result_root)
            _write_volumes(manifest["objects"], binary_masks, source.header.get_zooms()[:3], result_root)

            source_actual = nifti_fingerprint(source_path)
            mismatch = geometry_mismatches(manifest["source"], source_actual)
            if mismatch:
                raise Instant3DProcessingError("Source geometry changed during processing: " + ", ".join(mismatch))
            try:
                import torch  # pylint: disable=import-outside-toplevel
                torch_version = torch.__version__
            except Exception:
                torch_version = "not available"
            result_manifest = {
                "schema": manifest["schema"],
                "schema_version": manifest["schema_version"],
                "request_id": manifest["request_id"],
                "status": "success",
                "source": manifest["source"],
                "objects": result_objects,
                "result": {"labelmap": "labelmap/labels.nii.gz", "label_png": label_records},
                "software": {
                    "instant3dweb2": INSTANT3DWEB2_VERSION,
                    "totalsegmentator": importlib.metadata.version("TotalSegmentator"),
                    "python": platform.python_version(),
                    "torch": torch_version,
                },
                "warnings": (["Overlapping ROIs were resolved in the labelmap by lower object ID priority."] if overlaps else []),
                "overlaps": overlaps,
            }
            (result_root / "manifest.json").write_text(
                json.dumps(result_manifest, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            output_path = Path(output_zip)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                for path in sorted(result_root.rglob("*")):
                    if path.is_file():
                        archive.write(path, path.relative_to(result_root).as_posix())
            print(f"Instant3DWeb2 result created: {output_path}")
            return output_path
    except (Instant3DBridgeError, Instant3DProcessingError):
        raise
    except shutil.Error as exc:
        raise Instant3DProcessingError(f"Result file operation failed: {exc}") from exc
    except OSError as exc:
        if "space" in str(exc).lower() or getattr(exc, "errno", None) == 28:
            raise Instant3DProcessingError("The Colab runtime ran out of disk space.") from exc
        raise Instant3DProcessingError(f"Instant3DWeb2 file operation failed: {exc}") from exc
    except Exception as exc:
        raise Instant3DProcessingError(f"Instant3DWeb2 processing failed: {exc}") from exc
