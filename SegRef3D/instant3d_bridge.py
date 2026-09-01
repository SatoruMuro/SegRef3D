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
    """A concise, user-facing Seg CT/MRI validation error."""


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
    groups = catalog.get("groups", []) if isinstance(catalog, dict) else None
    if (
        catalog.get("schema_version") != BRIDGE_VERSION
        or not isinstance(structures, list)
        or not isinstance(groups, list)
    ):
        raise Instant3DBridgeError("ROI catalog has an unsupported or invalid schema.")
    seen = set()
    for item in structures:
        key = (item.get("task"), item.get("roi")) if isinstance(item, dict) else None
        if not key or not all(isinstance(value, str) and value for value in key) or key in seen:
            raise Instant3DBridgeError("ROI catalog contains an invalid or duplicate task/ROI entry.")
        seen.add(key)
    seen_groups = set()
    for group in groups:
        group_id = group.get("id") if isinstance(group, dict) else None
        task = group.get("task") if isinstance(group, dict) else None
        members = group.get("members") if isinstance(group, dict) else None
        if (
            not isinstance(group_id, str)
            or not group_id
            or group_id in seen_groups
            or not isinstance(task, str)
            or not task
            or not isinstance(members, list)
            or not members
            or any(not isinstance(roi, str) or not roi for roi in members)
            or len(members) != len(set(members))
            or any((task, roi) not in seen for roi in members)
        ):
            raise Instant3DBridgeError("ROI catalog contains an invalid group entry.")
        seen_groups.add(group_id)
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
            raise Instant3DBridgeError("Seg CT/MRI requires one 3D NIfTI volume.")
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
    catalog = catalog or load_roi_catalog()
    if not isinstance(objects, list) or not objects:
        raise Instant3DBridgeError("Select at least one anatomical structure.")
    allowed = {
        (item["task"], item["roi"]): item
        for item in catalog["structures"]
        if not item.get("license_required", False)
    }
    groups = {
        item["id"]: item
        for item in catalog.get("groups", [])
        if not item.get("license_required", False)
    }
    normalized = []
    used_ids = {}
    used_rois = {}

    def add_structure(raw, index, *, selection_group=None, assignment_name=None):
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
        catalog_item = allowed.get((task, roi))
        if catalog_item is None:
            raise Instant3DBridgeError(f"Unsupported or license-restricted structure: {task}/{roi}.")

        selection_group = str(selection_group or raw.get("selection_group") or "") or None
        if selection_group:
            group = groups.get(selection_group)
            if group is None or task != group["task"] or roi not in group["members"]:
                raise Instant3DBridgeError(f"Invalid catalog group member: {selection_group}/{task}/{roi}.")
            assignment_name = str(assignment_name or raw.get("assignment_name") or group["display_name"])

        key = (task, roi)
        if key in used_rois:
            if used_rois[key] == object_id:
                return
            raise Instant3DBridgeError(f"Duplicate anatomical structure: {roi}.")
        if object_id in used_ids and (not selection_group or used_ids[object_id] != selection_group):
            raise Instant3DBridgeError(f"Duplicate object ID: Obj{object_id}.")
        used_ids.setdefault(object_id, selection_group)
        used_rois[key] = object_id
        item = {
            "object_id": object_id,
            "display_name": str(raw.get("display_name") or catalog_item["display_name"]),
            "task": task,
            "roi": roi,
        }
        if selection_group:
            item["selection_group"] = selection_group
            item["assignment_name"] = assignment_name
        normalized.append(item)

    for index, raw in enumerate(objects):
        if not isinstance(raw, dict):
            raise Instant3DBridgeError(f"Object {index + 1} is invalid.")
        group_id = str(raw.get("group") or "")
        if group_id:
            group = groups.get(group_id)
            if group is None:
                raise Instant3DBridgeError(f"Unsupported or license-restricted catalog group: {group_id}.")
            for roi in group["members"]:
                catalog_item = allowed[(group["task"], roi)]
                add_structure({
                    "object_id": raw.get("object_id"),
                    "display_name": catalog_item["display_name"],
                    "task": group["task"],
                    "roi": roi,
                }, index, selection_group=group_id, assignment_name=group["display_name"])
        else:
            add_structure(raw, index)
    if len(normalized) > len(allowed):
        raise Instant3DBridgeError("Too many anatomical structures were selected.")
    return normalized


def collapse_object_groups(objects: object, catalog: dict | None = None) -> list[dict]:
    """Collapse expanded manifest objects back to one UI row per catalog group."""
    catalog = catalog or load_roi_catalog()
    groups = {item["id"]: item for item in catalog.get("groups", [])}
    collapsed = []
    seen_groups = set()
    for item in validate_objects(objects, catalog):
        group_id = item.get("selection_group")
        if group_id:
            key = (int(item["object_id"]), group_id)
            if key in seen_groups:
                continue
            seen_groups.add(key)
            group = groups[group_id]
            collapsed.append({
                "object_id": int(item["object_id"]),
                "display_name": item.get("assignment_name") or group["display_name"],
                "group": group_id,
            })
        else:
            collapsed.append({key: item[key] for key in ("object_id", "display_name", "task", "roi")})
    return sorted(collapsed, key=lambda item: int(item["object_id"]))


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
        raise Instant3DBridgeError("This ZIP uses an unsupported Seg CT/MRI bridge schema.")
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
        raise Instant3DBridgeError(f"Invalid Seg CT/MRI request ZIP: {exc}") from exc


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
                    "Seg CT/MRI result does not match the currently loaded volume: " + ", ".join(mismatches) + "."
                )
            return manifest, archive.read(RESULT_LABELMAP)
    except Instant3DBridgeError:
        raise
    except (OSError, zipfile.BadZipFile) as exc:
        raise Instant3DBridgeError(f"Invalid Seg CT/MRI result ZIP: {exc}") from exc


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
