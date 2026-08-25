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


def _add_box_prompt(predictor, inference_state, obj: dict, prompt: dict, frame_idx: int):
    box = np.asarray(prompt["box"], dtype=np.float32)
    return predictor.add_new_points_or_box(
        inference_state=inference_state,
        frame_idx=frame_idx,
        obj_id=int(obj["id"]),
        box=box,
    )


def _prompt_mask(output, object_id: int, expected_shape: tuple[int, int]):
    if not isinstance(output, (tuple, list)) or len(output) < 3:
        raise SegOnWebProcessingError("SAM2 returned an invalid box-prompt result.")
    object_ids, logits = output[-2], output[-1]
    for position, returned_id in enumerate(object_ids):
        if int(returned_id) == int(object_id):
            return _binary_mask(logits[position], expected_shape)
    raise SegOnWebProcessingError(f"SAM2 did not return object {object_id} for its box prompt.")


def _prepare_tracking_frames(
    image_records: list[dict],
    obj: dict,
    source_root: Path,
    target_root: Path,
    *,
    reverse: bool,
):
    frame_indices = list(range(int(obj["tracking_start"]), int(obj["tracking_end"]) + 1))
    if reverse:
        frame_indices.reverse()
    if target_root.exists():
        shutil.rmtree(target_root)
    target_root.mkdir(parents=True)
    for local_index, original_index in enumerate(frame_indices, start=1):
        source = source_root / image_records[original_index]["archive_path"]
        target = target_root / f"{local_index:06d}.jpg"
        shutil.copyfile(source, target)
    return frame_indices


def _propagate_direction(
    predictor,
    image_dir: Path,
    frame_indices: list[int],
    obj: dict,
    expected_shape: tuple[int, int],
    callback,
    *,
    direction: str,
):
    original_to_local = {original: local for local, original in enumerate(frame_indices)}
    masks = {}
    try:
        state = predictor.init_state(video_path=str(image_dir))
        predictor.reset_state(state)
        mapped_prompts = sorted(
            ((original_to_local[int(prompt["frame"])], prompt) for prompt in obj["prompts"]),
            key=lambda item: item[0],
        )
        for prompt_position, (local_frame, prompt) in enumerate(mapped_prompts, start=1):
            original_frame = int(prompt["frame"])
            output = _add_box_prompt(predictor, state, obj, prompt, local_frame)
            masks[original_frame] = _prompt_mask(output, int(obj["id"]), expected_shape)
            _emit(
                callback,
                event="prompt",
                direction=direction,
                object=obj,
                prompt=prompt,
                prompt_position=prompt_position,
                prompt_count=len(obj["prompts"]),
                frame=original_frame,
            )
    except Exception as exc:
        if isinstance(exc, SegOnWebProcessingError):
            raise
        raise SegOnWebProcessingError(
            f"SAM2 {direction} initialization failed for object {obj['id']}: {exc}"
        ) from exc

    original_frame = frame_indices[0]
    try:
        for local_frame, object_ids, logits in predictor.propagate_in_video(state):
            local_frame = int(local_frame)
            if local_frame >= len(frame_indices):
                break
            if local_frame < 0:
                continue
            original_frame = frame_indices[local_frame]
            for position, object_id in enumerate(object_ids):
                if int(object_id) == int(obj["id"]):
                    # Keep the direct add_new_points_or_box result on every
                    # conditioning frame; propagation fills the other frames.
                    masks.setdefault(original_frame, _binary_mask(logits[position], expected_shape))
                    _emit(callback, event="frame", direction=direction, object=obj, frame=original_frame)
                    break
    except SegOnWebProcessingError:
        raise
    except Exception as exc:
        raise SegOnWebProcessingError(
            f"{direction.title()} tracking failed for object {obj['id']} at frame {original_frame + 1}: {exc}"
        ) from exc
    return masks


def _propagate_object(
    predictor,
    image_records: list[dict],
    extracted_root: Path,
    direction_root: Path,
    obj: dict,
    expected_shape: tuple[int, int],
    callback,
    *,
    direction: str,
):
    frame_indices = _prepare_tracking_frames(
        image_records,
        obj,
        extracted_root,
        direction_root,
        reverse=direction == "backward",
    )
    return _propagate_direction(
        predictor,
        direction_root,
        frame_indices,
        obj,
        expected_shape,
        callback,
        direction=direction,
    )


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
            2 * (obj["tracking_end"] - obj["tracking_start"] + 1)
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

        # Strategy A: register every conditioning keyframe in one state for each
        # direction. Reversed states remap every original frame to a local index.
        forward_masks = _propagate_object(
            predictor,
            image_records,
            extracted_root,
            work_root / "forward" / f"object_{object_id:03d}",
            obj,
            expected_shape,
            progress_callback,
            direction="forward",
        )
        backward_masks = _propagate_object(
            predictor,
            image_records,
            extracted_root,
            work_root / "reversed" / f"object_{object_id:03d}",
            obj,
            expected_shape,
            progress_callback,
            direction="backward",
        )
        # Forward masks win where directions overlap, matching the legacy split
        # where forward propagation owned frames at/after the primary prompt.
        object_masks = {**backward_masks, **forward_masks}
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
