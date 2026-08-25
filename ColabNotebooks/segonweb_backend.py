"""Gradio-free SegOnWeb backend using the proven SAM2 video predictor API."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import zipfile

import numpy as np
from PIL import Image

from segmentation_job import (
    MANIFEST_NAME,
    make_result_manifest,
    safe_extract_job_images,
)


SAM2_REFERENCE = {
    "repository": "https://github.com/facebookresearch/sam2.git",
    "commit": "2b90b9f5ceec907a1c18123530e92e794ad901a4",
    "checkpoint": "sam2.1_hiera_large.pt",
    "model_config": "configs/sam2.1/sam2.1_hiera_l.yaml",
    "reference_notebook": "SAM2GUIforImgSeqv4_8.ipynb",
}


class SegOnWebProcessingError(RuntimeError):
    """Raised with a concise user-facing SegOnWeb processing error."""


def _emit(callback, **payload):
    if callback is not None:
        callback(payload)


def _binary_mask(logit, expected_shape: tuple[int, int]) -> np.ndarray:
    mask = (logit > 0.0).squeeze().detach().cpu().numpy()
    if mask.ndim != 2 or mask.shape != expected_shape:
        raise SegOnWebProcessingError(
            f"SAM2 returned mask shape {mask.shape}; expected {expected_shape}."
        )
    return mask.astype(bool, copy=False)


def _add_box_prompt(predictor, inference_state, obj: dict, frame_idx: int):
    box = np.asarray(obj["box"], dtype=np.float32)
    return predictor.add_new_points_or_box(
        inference_state=inference_state,
        frame_idx=frame_idx,
        obj_id=int(obj["id"]),
        box=box,
    )


def _propagate_forward(
    predictor,
    image_dir: Path,
    obj: dict,
    expected_shape: tuple[int, int],
    callback,
):
    try:
        state = predictor.init_state(video_path=str(image_dir))
        predictor.reset_state(state)
        _add_box_prompt(predictor, state, obj, int(obj["prompt_frame"]))
    except Exception as exc:
        raise SegOnWebProcessingError(
            f"SAM2 initialization failed for object {obj['id']}: {exc}"
        ) from exc

    masks = {}
    frame_idx = int(obj["prompt_frame"])
    try:
        for frame_idx, object_ids, logits in predictor.propagate_in_video(state):
            frame_idx = int(frame_idx)
            if frame_idx > int(obj["tracking_end"]):
                break
            if frame_idx < int(obj["tracking_start"]):
                continue
            for position, object_id in enumerate(object_ids):
                if int(object_id) == int(obj["id"]):
                    masks[frame_idx] = _binary_mask(logits[position], expected_shape)
                    _emit(callback, event="frame", direction="forward", object=obj, frame=frame_idx)
                    break
    except SegOnWebProcessingError:
        raise
    except Exception as exc:
        raise SegOnWebProcessingError(
            f"Forward tracking failed for object {obj['id']} at frame {frame_idx + 1}: {exc}"
        ) from exc
    return masks


def _prepare_reversed_frames(image_records: list[dict], obj: dict, source_root: Path, reverse_root: Path):
    frame_indices = list(range(int(obj["prompt_frame"]), int(obj["tracking_start"]) - 1, -1))
    reverse_root.mkdir(parents=True, exist_ok=True)
    for reverse_index, original_index in enumerate(frame_indices, start=1):
        source = source_root / image_records[original_index]["archive_path"]
        target = reverse_root / f"{reverse_index:06d}.jpg"
        shutil.copyfile(source, target)
    return frame_indices


def _propagate_backward(
    predictor,
    image_records: list[dict],
    extracted_root: Path,
    reverse_root: Path,
    obj: dict,
    expected_shape: tuple[int, int],
    callback,
):
    frame_indices = _prepare_reversed_frames(
        image_records,
        obj,
        extracted_root,
        reverse_root,
    )
    try:
        state = predictor.init_state(video_path=str(reverse_root))
        predictor.reset_state(state)
        _add_box_prompt(predictor, state, obj, 0)
    except Exception as exc:
        raise SegOnWebProcessingError(
            f"SAM2 backward initialization failed for object {obj['id']}: {exc}"
        ) from exc

    masks = {}
    try:
        for reverse_index, object_ids, logits in predictor.propagate_in_video(state):
            reverse_index = int(reverse_index)
            if reverse_index >= len(frame_indices):
                break
            original_index = frame_indices[reverse_index]
            for position, object_id in enumerate(object_ids):
                if int(object_id) == int(obj["id"]):
                    masks[original_index] = _binary_mask(logits[position], expected_shape)
                    _emit(callback, event="frame", direction="backward", object=obj, frame=original_index)
                    break
    except SegOnWebProcessingError:
        raise
    except Exception as exc:
        raise SegOnWebProcessingError(
            f"Backward tracking failed for object {obj['id']}: {exc}"
        ) from exc
    return masks


def _write_status(path: Path, manifest: dict, completed_ids: list[int], current_id: int | None, state: str):
    status = {
        "format_version": manifest["format_version"],
        "state": state,
        "completed_objects": completed_ids,
        "current_object": current_id,
        "total_objects": len(manifest["objects"]),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(status, indent=2), encoding="utf-8")


def _write_result_zip(
    output_path: Path,
    result_root: Path,
    manifest: dict,
    extracted_root: Path,
    label_volume: np.ndarray,
    backend_info: dict,
):
    if result_root.exists():
        shutil.rmtree(result_root)
    image_output = result_root / "images"
    mask_output = result_root / "masks"
    image_output.mkdir(parents=True)
    mask_output.mkdir(parents=True)

    mask_records = []
    for record, label_mask in zip(manifest["images"]["files"], label_volume):
        image_source = extracted_root / record["archive_path"]
        image_target = result_root / record["archive_path"]
        image_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(image_source, image_target)

        mask_path = f"masks/mask{record['key']}.png"
        Image.fromarray(label_mask, mode="L").save(result_root / mask_path, format="PNG")
        mask_records.append({
            "index": record["index"],
            "key": record["key"],
            "archive_path": mask_path,
        })

    result_manifest = make_result_manifest(manifest, mask_records, backend=backend_info)
    (result_root / MANIFEST_NAME).write_text(
        json.dumps(result_manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(f".{output_path.name}.tmp")
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(result_root.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(result_root).as_posix())
        os.replace(temporary, output_path)
    finally:
        if temporary.exists():
            temporary.unlink()
    return result_manifest


def process_segmentation_job(
    input_zip: str,
    predictor,
    *,
    work_dir: str,
    output_zip: str,
    device_name: str = "unknown",
    progress_callback=None,
):
    """Run every manifest box prompt through the reference SAM2 video API."""
    work_root = Path(work_dir)
    if work_root.exists():
        shutil.rmtree(work_root)
    work_root.mkdir(parents=True)

    _emit(progress_callback, event="step", step=1, total_steps=4, message="Validating ZIP")
    try:
        manifest, _ = safe_extract_job_images(input_zip, str(work_root / "input"))
    except Exception as exc:
        raise SegOnWebProcessingError(f"Input ZIP validation failed: {exc}") from exc

    image_records = manifest["images"]["files"]
    extracted_root = work_root / "input"
    image_dir = extracted_root / "images"
    expected_shape = (manifest["images"]["height"], manifest["images"]["width"])
    label_volume = np.zeros((manifest["images"]["count"], *expected_shape), dtype=np.uint8)
    completed_ids = []
    status_path = work_root / "intermediate" / "status.json"

    _emit(progress_callback, event="step", step=2, total_steps=4, message="SAM2 model ready")
    _emit(
        progress_callback,
        event="start",
        object_count=len(manifest["objects"]),
        frame_count=manifest["images"]["count"],
        total_work=sum(
            (obj["tracking_end"] - obj["prompt_frame"] + 1)
            + (obj["prompt_frame"] - obj["tracking_start"] + 1)
            for obj in manifest["objects"]
        ),
    )

    _emit(progress_callback, event="step", step=3, total_steps=4, message="Segmenting")
    for object_position, obj in enumerate(manifest["objects"], start=1):
        object_id = int(obj["id"])
        _write_status(status_path, manifest, completed_ids, object_id, "processing")
        _emit(
            progress_callback,
            event="object",
            object=obj,
            object_position=object_position,
            object_count=len(manifest["objects"]),
        )

        forward_masks = _propagate_forward(
            predictor,
            image_dir,
            obj,
            expected_shape,
            progress_callback,
        )
        reverse_root = work_root / "reversed" / f"object_{object_id:03d}"
        backward_masks = _propagate_backward(
            predictor,
            image_records,
            extracted_root,
            reverse_root,
            obj,
            expected_shape,
            progress_callback,
        )
        object_masks = {**forward_masks, **backward_masks}
        if not object_masks:
            raise SegOnWebProcessingError(f"SAM2 returned no masks for object {object_id}.")
        for frame_index, mask in object_masks.items():
            label_volume[frame_index][mask] = object_id

        completed_ids.append(object_id)
        _write_status(status_path, manifest, completed_ids, None, "processing")

    _emit(progress_callback, event="step", step=4, total_steps=4, message="Writing result ZIP")
    backend_info = {
        "name": "SegOnWeb Colab",
        "device": device_name,
        **SAM2_REFERENCE,
    }
    try:
        result_manifest = _write_result_zip(
            Path(output_zip),
            work_root / "result_files",
            manifest,
            extracted_root,
            label_volume,
            backend_info,
        )
    except Exception as exc:
        raise SegOnWebProcessingError(f"Result ZIP creation failed: {exc}") from exc

    _write_status(status_path, manifest, completed_ids, None, "complete")
    _emit(progress_callback, event="complete", output_zip=os.fspath(output_zip))
    return result_manifest
