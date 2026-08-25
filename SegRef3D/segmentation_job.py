"""Shared SegRef3D <-> SegOnWeb segmentation job archive support."""

from __future__ import annotations

import copy
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import zipfile

from PIL import Image


FORMAT_VERSION = "segref3d-segjob-1.0"
MANIFEST_NAME = "manifest.json"
JOB_KIND = "segmentation_job"
RESULT_KIND = "segmentation_result"
IMAGE_DIR = "images"
MASK_DIR = "masks"
MAX_OBJECT_ID = 255
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024 * 1024


class SegmentationJobError(ValueError):
    """Raised when a segmentation job or result archive is invalid."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SegmentationJobError(message)


def _archive_path(value: object, field_name: str) -> str:
    _require(isinstance(value, str) and value.strip(), f"{field_name} is missing.")
    _require("\x00" not in value, f"{field_name} must not contain a null byte.")
    value = value.replace("\\", "/")
    path = PurePosixPath(value)
    _require(not path.is_absolute(), f"{field_name} must be a relative ZIP path.")
    _require(".." not in path.parts, f"{field_name} must not contain '..'.")
    _require(":" not in path.parts[0], f"{field_name} must not contain a drive name.")
    return path.as_posix()


def _image_key(value: object, field_name: str) -> str:
    _require(isinstance(value, str) and value, f"{field_name} is missing.")
    _require(value not in (".", ".."), f"{field_name} is invalid.")
    _require("\x00" not in value, f"{field_name} must not contain a null byte.")
    _require(not any(character in value for character in ("/", "\\", ":")), f"{field_name} must be a filename-safe token.")
    return value


def _integer(value: object, field_name: str, minimum: int | None = None) -> int:
    _require(isinstance(value, int) and not isinstance(value, bool), f"{field_name} must be an integer.")
    if minimum is not None:
        _require(value >= minimum, f"{field_name} must be at least {minimum}.")
    return value


def _number(value: object, field_name: str) -> float:
    _require(isinstance(value, (int, float)) and not isinstance(value, bool), f"{field_name} must be numeric.")
    return float(value)


def _validate_image_block(images: object) -> tuple[list[dict], int, int]:
    _require(isinstance(images, dict), "images must be an object.")
    count = _integer(images.get("count"), "images.count", 1)
    width = _integer(images.get("width"), "images.width", 1)
    height = _integer(images.get("height"), "images.height", 1)
    files = images.get("files")
    _require(isinstance(files, list), "images.files must be a list.")
    _require(len(files) == count, "images.count does not match images.files.")

    seen_indices: set[int] = set()
    seen_keys: set[str] = set()
    seen_paths: set[str] = set()
    normalized: list[dict] = []
    for position, record in enumerate(files):
        field = f"images.files[{position}]"
        _require(isinstance(record, dict), f"{field} must be an object.")
        index = _integer(record.get("index"), f"{field}.index", 0)
        key = _image_key(record.get("key"), f"{field}.key")
        _require(
            isinstance(record.get("original_filename"), str) and record["original_filename"],
            f"{field}.original_filename is missing.",
        )
        _require(
            isinstance(record.get("working_filename"), str) and record["working_filename"],
            f"{field}.working_filename is missing.",
        )
        archive_path = _archive_path(record.get("archive_path"), f"{field}.archive_path")
        _require(archive_path.startswith(f"{IMAGE_DIR}/"), f"{field}.archive_path must be inside images/.")
        _require(index not in seen_indices, f"Duplicate image index: {index}.")
        _require(key not in seen_keys, f"Duplicate image key: {key}.")
        _require(archive_path not in seen_paths, f"Duplicate image path: {archive_path}.")
        seen_indices.add(index)
        seen_keys.add(key)
        seen_paths.add(archive_path)
        item = copy.deepcopy(record)
        item["archive_path"] = archive_path
        normalized.append(item)

    normalized.sort(key=lambda item: item["index"])
    _require([item["index"] for item in normalized] == list(range(count)), "Image indices must be contiguous and zero-based.")

    order = images.get("order")
    _require(isinstance(order, list), "images.order must be a list.")
    _require(order == [item["key"] for item in normalized], "images.order does not match images.files.")
    return normalized, width, height


def _normalize_box(value: object, field_name: str, width: int, height: int) -> list[float]:
    _require(isinstance(value, list) and len(value) == 4, f"{field_name} must contain [x1, y1, x2, y2].")
    x1, y1, x2, y2 = (_number(item, field_name) for item in value)
    _require(0 <= x1 < x2 <= width, f"{field_name} x coordinates are outside the image.")
    _require(0 <= y1 < y2 <= height, f"{field_name} y coordinates are outside the image.")
    return [x1, y1, x2, y2]


def validate_manifest(manifest: object, expected_kind: str | None = None) -> dict:
    """Validate and return a normalized copy of a job or result manifest."""
    _require(isinstance(manifest, dict), "manifest.json must contain a JSON object.")
    normalized = copy.deepcopy(manifest)
    _require(normalized.get("format_version") == FORMAT_VERSION, f"Unsupported manifest version: {normalized.get('format_version')!r}.")
    kind = normalized.get("kind")
    _require(kind in (JOB_KIND, RESULT_KIND), f"Unsupported manifest kind: {kind!r}.")
    if expected_kind is not None:
        _require(kind == expected_kind, f"Expected {expected_kind}, received {kind}.")
    _require(normalized.get("frame_index_base") == 0, "frame_index_base must be 0.")
    _require(isinstance(normalized.get("created_by"), dict), "created_by must be an object.")
    _require(isinstance(normalized.get("source"), dict), "source must be an object.")

    image_files, width, height = _validate_image_block(normalized.get("images"))
    normalized["images"]["files"] = image_files
    count = len(image_files)

    objects = normalized.get("objects")
    _require(isinstance(objects, list) and objects, "objects must contain at least one object.")
    seen_ids: set[int] = set()
    for position, obj in enumerate(objects):
        field = f"objects[{position}]"
        _require(isinstance(obj, dict), f"{field} must be an object.")
        object_id = _integer(obj.get("id"), f"{field}.id", 1)
        _require(object_id <= MAX_OBJECT_ID, f"{field}.id exceeds the uint8 label limit.")
        _require(object_id not in seen_ids, f"Duplicate object id: {object_id}.")
        seen_ids.add(object_id)
        _require(isinstance(obj.get("name"), str) and obj["name"].strip(), f"{field}.name is missing.")
        prompt_frame = _integer(obj.get("prompt_frame"), f"{field}.prompt_frame", 0)
        tracking_start = _integer(obj.get("tracking_start"), f"{field}.tracking_start", 0)
        tracking_end = _integer(obj.get("tracking_end"), f"{field}.tracking_end", 0)
        _require(tracking_end < count, f"{field}.tracking_end is outside the image sequence.")
        _require(tracking_start <= prompt_frame <= tracking_end, f"{field}.prompt_frame must be inside its tracking range.")
        obj["box"] = _normalize_box(obj.get("box"), f"{field}.box", width, height)

        prompts = obj.get("prompts")
        _require(isinstance(prompts, list) and prompts, f"{field}.prompts must contain the box prompt.")
        box_prompts = [item for item in prompts if isinstance(item, dict) and item.get("type") == "box"]
        _require(box_prompts, f"{field}.prompts does not contain a box prompt.")
        primary = box_prompts[0]
        _require(primary.get("frame") == prompt_frame, f"{field}.prompts box frame does not match prompt_frame.")
        primary["box"] = _normalize_box(primary.get("box"), f"{field}.prompts box", width, height)
        _require(primary["box"] == obj["box"], f"{field}.prompts box does not match box.")

    if kind == RESULT_KIND:
        result = normalized.get("result")
        _require(isinstance(result, dict), "result is missing from the result manifest.")
        _require(result.get("mask_format") == "single-label-uint8-png", "Unsupported result mask format.")
        masks = result.get("masks")
        _require(isinstance(masks, list) and len(masks) == count, "result.masks must contain one mask per image.")
        for position, record in enumerate(masks):
            field = f"result.masks[{position}]"
            _require(isinstance(record, dict), f"{field} must be an object.")
            _require(record.get("index") == image_files[position]["index"], f"{field}.index does not match its image.")
            _require(record.get("key") == image_files[position]["key"], f"{field}.key does not match its image.")
            archive_path = _archive_path(record.get("archive_path"), f"{field}.archive_path")
            _require(archive_path.startswith(f"{MASK_DIR}/"), f"{field}.archive_path must be inside masks/.")
            record["archive_path"] = archive_path

    return normalized


def make_manifest(
    image_records: list[dict],
    objects: list[dict],
    *,
    app_version: str,
    source: dict | None = None,
) -> dict:
    """Create a validated job manifest from image and object records."""
    _require(bool(image_records), "No images were provided.")
    width = image_records[0]["width"]
    height = image_records[0]["height"]
    files = []
    for index, record in enumerate(image_records):
        files.append({
            "index": index,
            "key": str(record["key"]),
            "original_filename": str(record.get("original_filename") or Path(record["path"]).name),
            "working_filename": Path(record["path"]).name,
            "archive_path": f"{IMAGE_DIR}/{index + 1:06d}.jpg",
        })

    normalized_objects = []
    for obj in objects:
        box = [float(value) for value in obj["box"]]
        prompt_frame = int(obj["prompt_frame"])
        normalized_objects.append({
            "id": int(obj["id"]),
            "name": str(obj.get("name") or f"Object {obj['id']}").strip(),
            "prompt_frame": prompt_frame,
            "box": box,
            "tracking_start": int(obj["tracking_start"]),
            "tracking_end": int(obj["tracking_end"]),
            "prompts": [{"type": "box", "frame": prompt_frame, "box": box.copy()}],
        })

    manifest = {
        "format_version": FORMAT_VERSION,
        "kind": JOB_KIND,
        "frame_index_base": 0,
        "created_by": {"application": "SegRef3D", "version": str(app_version)},
        "source": copy.deepcopy(source or {}),
        "images": {
            "count": len(files),
            "width": int(width),
            "height": int(height),
            "order": [record["key"] for record in files],
            "files": files,
        },
        "objects": normalized_objects,
    }
    return validate_manifest(manifest, JOB_KIND)


def _jpeg_bytes(path: str) -> bytes:
    with Image.open(path) as image:
        if image.format == "JPEG" and image.mode == "RGB":
            with open(path, "rb") as handle:
                return handle.read()
        output = io.BytesIO()
        image.convert("RGB").save(output, format="JPEG", quality=95, subsampling=0)
        return output.getvalue()


def create_job_zip(output_path: str, image_records: list[dict], objects: list[dict], *, app_version: str, source: dict | None = None) -> dict:
    """Write a SegOnWeb input ZIP and return its validated manifest."""
    _require(bool(image_records), "No images were provided.")
    expected_size: tuple[int, int] | None = None
    prepared = []
    for record in image_records:
        path = os.fspath(record["path"])
        _require(os.path.isfile(path), f"Image file is missing: {path}")
        with Image.open(path) as image:
            size = image.size
        if expected_size is None:
            expected_size = size
        _require(size == expected_size, f"Image size mismatch: {Path(path).name} is {size}, expected {expected_size}.")
        item = dict(record)
        item["width"], item["height"] = size
        prepared.append(item)

    manifest = make_manifest(prepared, objects, app_version=app_version, source=source)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.tmp")
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            archive.writestr(MANIFEST_NAME, json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
            for source_record, manifest_record in zip(prepared, manifest["images"]["files"]):
                archive.writestr(manifest_record["archive_path"], _jpeg_bytes(source_record["path"]))
        os.replace(temporary, output)
    finally:
        if temporary.exists():
            temporary.unlink()
    return manifest


def _validate_members(archive: zipfile.ZipFile) -> set[str]:
    names: set[str] = set()
    total_size = 0
    for info in archive.infolist():
        name = _archive_path(info.filename, "ZIP member")
        _require(name not in names, f"Duplicate ZIP member: {name}.")
        names.add(name)
        total_size += info.file_size
        _require(total_size <= MAX_ARCHIVE_BYTES, "ZIP is too large after extraction.")
        mode = (info.external_attr >> 16) & 0o170000
        _require(mode != 0o120000, f"ZIP symbolic links are not allowed: {name}.")
    return names


def read_archive_manifest(zip_path: str, expected_kind: str | None = None) -> tuple[dict, set[str]]:
    try:
        with zipfile.ZipFile(zip_path, "r") as archive:
            names = _validate_members(archive)
            _require(MANIFEST_NAME in names, "manifest.json is missing from the ZIP.")
            try:
                manifest = json.loads(archive.read(MANIFEST_NAME).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise SegmentationJobError(f"manifest.json is invalid: {exc}") from exc
    except zipfile.BadZipFile as exc:
        raise SegmentationJobError("The selected file is not a valid ZIP archive.") from exc
    return validate_manifest(manifest, expected_kind), names


def validate_job_zip(zip_path: str) -> dict:
    manifest, names = read_archive_manifest(zip_path, JOB_KIND)
    with zipfile.ZipFile(zip_path, "r") as archive:
        for record in manifest["images"]["files"]:
            path = record["archive_path"]
            _require(path in names, f"Image file is missing from the ZIP: {path}.")
            try:
                with Image.open(io.BytesIO(archive.read(path))) as image:
                    _require(image.size == (manifest["images"]["width"], manifest["images"]["height"]), f"Image size mismatch in ZIP: {path}.")
                    image.verify()
            except SegmentationJobError:
                raise
            except Exception as exc:
                raise SegmentationJobError(f"Image file is invalid: {path}: {exc}") from exc
    return manifest


def validate_result_zip(zip_path: str) -> dict:
    manifest, names = read_archive_manifest(zip_path, RESULT_KIND)
    width = manifest["images"]["width"]
    height = manifest["images"]["height"]
    with zipfile.ZipFile(zip_path, "r") as archive:
        for record in manifest["images"]["files"]:
            path = record["archive_path"]
            _require(path in names, f"Result image is missing: {path}.")
            try:
                with Image.open(io.BytesIO(archive.read(path))) as image:
                    _require(image.size == (width, height), f"Result image size mismatch: {path}.")
                    image.verify()
            except SegmentationJobError:
                raise
            except Exception as exc:
                raise SegmentationJobError(f"Result image is invalid: {path}: {exc}") from exc
        for record in manifest["result"]["masks"]:
            path = record["archive_path"]
            _require(path in names, f"Result mask is missing: {path}.")
            try:
                with Image.open(io.BytesIO(archive.read(path))) as image:
                    _require(image.size == (width, height), f"Mask size mismatch in ZIP: {path}.")
                    _require(image.mode == "L", f"Mask must be an 8-bit single-channel PNG: {path}.")
                    _require(image.format == "PNG", f"Mask must be PNG: {path}.")
            except SegmentationJobError:
                raise
            except Exception as exc:
                raise SegmentationJobError(f"Mask file is invalid: {path}: {exc}") from exc
    return manifest


def safe_extract_job_images(zip_path: str, destination: str) -> tuple[dict, Path]:
    """Validate a job and extract only its declared JPG files."""
    manifest = validate_job_zip(zip_path)
    root = Path(destination)
    image_root = root / IMAGE_DIR
    image_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as archive:
        for record in manifest["images"]["files"]:
            target = root / PurePosixPath(record["archive_path"])
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(record["archive_path"], "r") as source, open(target, "wb") as output:
                shutil.copyfileobj(source, output)
    return manifest, image_root


def make_result_manifest(job_manifest: dict, mask_records: list[dict], *, backend: dict) -> dict:
    manifest = validate_manifest(job_manifest, JOB_KIND)
    result = copy.deepcopy(manifest)
    result["kind"] = RESULT_KIND
    result["result"] = {
        "mask_format": "single-label-uint8-png",
        "overlap_policy": "later-object-overwrites-earlier-object",
        "backend": copy.deepcopy(backend),
        "masks": copy.deepcopy(mask_records),
    }
    return validate_manifest(result, RESULT_KIND)
