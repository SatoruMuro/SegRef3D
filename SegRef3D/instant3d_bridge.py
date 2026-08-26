"""Shared Instant3DWeb2 ZIP protocol for the desktop application and Colab."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import uuid
import zipfile
from pathlib import Path, PurePosixPath

import nibabel as nib
import numpy as np


BRIDGE_SCHEMA = "segref3d-instant3d-bridge"
BRIDGE_VERSION = "1.0"
REQUEST_SOURCE = "image/source.nii.gz"
RESULT_LABELMAP = "labelmap/labels.nii.gz"


class Instant3DBridgeError(ValueError):
    """A concise, user-facing Instant3DWeb2 validation error."""


def resource_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "resources"
    return Path(__file__).resolve().parents[1] / "resources"


def load_roi_catalog(path: str | os.PathLike | None = None) -> dict:
    catalog_path = Path(path) if path else resource_root() / "totalsegmentator_roi_catalog.json"
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise Instant3DBridgeError(f"ROI catalog could not be loaded: {exc}") from exc
    structures = catalog.get("structures") if isinstance(catalog, dict) else None
    if catalog.get("schema_version") != BRIDGE_VERSION or not isinstance(structures, list):
        raise Instant3DBridgeError("ROI catalog has an unsupported or invalid schema.")
    seen = set()
    for item in structures:
        key = (item.get("task"), item.get("roi")) if isinstance(item, dict) else None
        if not key or not all(isinstance(value, str) and value for value in key) or key in seen:
            raise Instant3DBridgeError("ROI catalog contains an invalid or duplicate task/ROI entry.")
        seen.add(key)
    return catalog


def _safe_member(name: str) -> str:
    normalized = str(name).replace("\\", "/")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts or ":" in normalized:
        raise Instant3DBridgeError(f"Unsafe ZIP member path: {name}")
    return normalized


def sha256_file(path: str | os.PathLike) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def nifti_fingerprint(path: str | os.PathLike) -> dict:
    source = Path(path)
    try:
        image = nib.load(str(source))
        shape = tuple(int(value) for value in image.shape)
        if len(shape) != 3 or any(value < 1 for value in shape):
            raise Instant3DBridgeError("Instant3DWeb2 requires one 3D NIfTI volume.")
        affine = np.asarray(image.affine, dtype=float)
        spacing = tuple(float(value) for value in image.header.get_zooms()[:3])
        orientation = "".join(nib.aff2axcodes(affine))
    except Instant3DBridgeError:
        raise
    except Exception as exc:
        raise Instant3DBridgeError(f"NIfTI source could not be read: {exc}") from exc
    return {
        "filename": "source.nii.gz" if source.name.lower().endswith(".nii.gz") else "source.nii",
        "modality": "CT",
        "shape": list(shape),
        "voxel_spacing_mm": list(spacing),
        "orientation": orientation,
        "affine": affine.tolist(),
        "sha256": sha256_file(source),
    }


def validate_objects(objects: object, catalog: dict | None = None) -> list[dict]:
    if not isinstance(objects, list) or not 1 <= len(objects) <= 20:
        raise Instant3DBridgeError("Select between 1 and 20 anatomical structures.")
    catalog = catalog or load_roi_catalog()
    allowed = {
        (item["task"], item["roi"]): item
        for item in catalog["structures"]
        if not item.get("license_required", False)
    }
    normalized = []
    used_ids = set()
    used_rois = set()
    for index, raw in enumerate(objects):
        if not isinstance(raw, dict):
            raise Instant3DBridgeError(f"Object {index + 1} is invalid.")
        try:
            object_id = int(raw.get("object_id"))
        except Exception as exc:
            raise Instant3DBridgeError(f"Object {index + 1} has an invalid object ID.") from exc
        task = str(raw.get("task", ""))
        roi = str(raw.get("roi", ""))
        if not 1 <= object_id <= 20:
            raise Instant3DBridgeError("Object IDs must be between 1 and 20.")
        if object_id in used_ids:
            raise Instant3DBridgeError(f"Duplicate object ID: Obj{object_id}.")
        if (task, roi) in used_rois:
            raise Instant3DBridgeError(f"Duplicate anatomical structure: {roi}.")
        catalog_item = allowed.get((task, roi))
        if catalog_item is None:
            raise Instant3DBridgeError(f"Unsupported or license-restricted structure: {task}/{roi}.")
        used_ids.add(object_id)
        used_rois.add((task, roi))
        normalized.append({
            "object_id": object_id,
            "display_name": str(raw.get("display_name") or catalog_item["display_name"]),
            "task": task,
            "roi": roi,
        })
    return normalized


def make_request_manifest(source_path: str | os.PathLike, objects: list[dict], *, fast: bool = False) -> dict:
    return {
        "schema": BRIDGE_SCHEMA,
        "schema_version": BRIDGE_VERSION,
        "request_id": str(uuid.uuid4()),
        "source": nifti_fingerprint(source_path),
        "objects": validate_objects(objects),
        "options": {"fast": bool(fast)},
    }


def create_request_zip(output_path: str | os.PathLike, source_path: str | os.PathLike, objects: list[dict], *, fast: bool = False) -> dict:
    manifest = make_request_manifest(source_path, objects, fast=fast)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        archive.write(source_path, f'image/{manifest["source"]["filename"]}')
    return manifest


def _read_manifest(archive: zipfile.ZipFile) -> tuple[dict, set[str]]:
    members = {_safe_member(info.filename) for info in archive.infolist() if not info.is_dir()}
    if "manifest.json" not in members:
        raise Instant3DBridgeError("manifest.json is missing from the ZIP.")
    try:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
    except Exception as exc:
        raise Instant3DBridgeError(f"manifest.json could not be read: {exc}") from exc
    if manifest.get("schema") != BRIDGE_SCHEMA or manifest.get("schema_version") != BRIDGE_VERSION:
        raise Instant3DBridgeError("This ZIP uses an unsupported Instant3D bridge schema.")
    return manifest, members


def geometry_mismatches(expected: dict, actual: dict, *, affine_tolerance: float = 1e-4) -> list[str]:
    mismatches = []
    if list(expected.get("shape", [])) != list(actual.get("shape", [])):
        mismatches.append("dimensions")
    try:
        if not np.allclose(expected["voxel_spacing_mm"], actual["voxel_spacing_mm"], rtol=0, atol=1e-5):
            mismatches.append("voxel spacing")
    except Exception:
        mismatches.append("voxel spacing")
    try:
        if not np.allclose(expected["affine"], actual["affine"], rtol=0, atol=affine_tolerance):
            mismatches.append("affine/orientation")
    except Exception:
        mismatches.append("affine/orientation")
    if expected.get("orientation") != actual.get("orientation"):
        mismatches.append("orientation")
    if expected.get("sha256") != actual.get("sha256"):
        mismatches.append("source checksum")
    return list(dict.fromkeys(mismatches))


def validate_request_zip(zip_path: str | os.PathLike, extract_dir: str | os.PathLike | None = None) -> tuple[dict, Path | None]:
    try:
        with zipfile.ZipFile(zip_path) as archive:
            manifest, members = _read_manifest(archive)
            source_member = f'image/{manifest.get("source", {}).get("filename", "")}'
            if source_member not in members or source_member not in ("image/source.nii", REQUEST_SOURCE):
                raise Instant3DBridgeError("image/source.nii or image/source.nii.gz is missing from the request ZIP.")
            manifest["objects"] = validate_objects(manifest.get("objects"))
            source_path = None
            if extract_dir is not None:
                destination = Path(extract_dir)
                destination.mkdir(parents=True, exist_ok=True)
                source_path = destination / Path(source_member).name
                source_path.write_bytes(archive.read(source_member))
                actual = nifti_fingerprint(source_path)
                mismatches = geometry_mismatches(manifest.get("source", {}), actual)
                if mismatches:
                    raise Instant3DBridgeError("Request source validation failed: " + ", ".join(mismatches) + ".")
            return manifest, source_path
    except Instant3DBridgeError:
        raise
    except (OSError, zipfile.BadZipFile) as exc:
        raise Instant3DBridgeError(f"Invalid Instant3D request ZIP: {exc}") from exc


def validate_result_zip(zip_path: str | os.PathLike, current_source_path: str | os.PathLike) -> tuple[dict, bytes]:
    try:
        with zipfile.ZipFile(zip_path) as archive:
            manifest, members = _read_manifest(archive)
            if manifest.get("status") != "success":
                raise Instant3DBridgeError("Instant3D result status is not success.")
            manifest["objects"] = validate_objects(manifest.get("objects"))
            if RESULT_LABELMAP not in members:
                raise Instant3DBridgeError(f"{RESULT_LABELMAP} is missing from the result ZIP.")
            current = nifti_fingerprint(current_source_path)
            mismatches = geometry_mismatches(manifest.get("source", {}), current)
            if mismatches:
                raise Instant3DBridgeError(
                    "Instant3D result does not match the currently loaded volume: " + ", ".join(mismatches) + "."
                )
            return manifest, archive.read(RESULT_LABELMAP)
    except Instant3DBridgeError:
        raise
    except (OSError, zipfile.BadZipFile) as exc:
        raise Instant3DBridgeError(f"Invalid Instant3D result ZIP: {exc}") from exc


def labelmap_from_bytes(data: bytes, expected_source: dict) -> np.ndarray:
    import tempfile

    with tempfile.TemporaryDirectory(prefix="segref3d-instant3d-") as folder:
        path = Path(folder) / "labels.nii.gz"
        path.write_bytes(data)
        image = nib.load(str(path))
        array = np.asarray(image.dataobj)
        actual = {
            "shape": list(array.shape),
            "voxel_spacing_mm": list(image.header.get_zooms()[:3]),
            "affine": np.asarray(image.affine).tolist(),
            "orientation": "".join(nib.aff2axcodes(image.affine)),
            "sha256": expected_source.get("sha256"),
        }
        mismatches = [item for item in geometry_mismatches(expected_source, actual) if item != "source checksum"]
        if mismatches:
            raise Instant3DBridgeError("Result labelmap geometry mismatch: " + ", ".join(mismatches) + ".")
        if array.ndim != 3 or np.any(array < 0) or np.any(array > 20):
            raise Instant3DBridgeError("Result labelmap must contain labels 0 through 20 in one 3D volume.")
        return array.astype(np.uint8, copy=True)
