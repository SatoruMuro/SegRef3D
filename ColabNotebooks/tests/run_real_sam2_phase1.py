"""Run the Phase 1 reference-equivalence test with a real SAM2 predictor."""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import sys
import tempfile
import zipfile

import numpy as np
from PIL import Image, ImageDraw


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    return parser.parse_args()


def make_frames(folder: Path, count=5):
    folder.mkdir(parents=True)
    records = []
    for index in range(count):
        image = Image.new("RGB", (128, 96), "black")
        draw = ImageDraw.Draw(image)
        x = 35 + index * 2
        draw.ellipse((x, 28, x + 36, 64), fill=(230, 230, 230), outline="white", width=2)
        y = 12 + index
        draw.rectangle((91, y, 118, y + 22), fill=(150, 150, 150), outline="white", width=2)
        path = folder / f"source{index + 1:04d}.jpg"
        image.save(path, "JPEG", quality=95)
        records.append({"key": f"{index + 1:04d}", "path": str(path)})
    return records


def mask_from_logit(logit):
    return (logit > 0.0).squeeze().detach().cpu().numpy().astype(bool)


def run_v48_reference(predictor, frame_dir: Path, obj: dict, reverse_dir: Path):
    state = predictor.init_state(video_path=str(frame_dir))
    predictor.reset_state(state)
    box = np.asarray(obj["box"], dtype=np.float32)
    predictor.add_new_points_or_box(
        inference_state=state,
        frame_idx=obj["prompt_frame"],
        obj_id=obj["id"],
        box=box,
    )
    masks = {}
    for frame_idx, object_ids, logits in predictor.propagate_in_video(state):
        if frame_idx > obj["tracking_end"]:
            break
        for position, object_id in enumerate(object_ids):
            if int(object_id) == obj["id"]:
                masks[int(frame_idx)] = mask_from_logit(logits[position])

    reverse_indices = list(range(obj["prompt_frame"], obj["tracking_start"] - 1, -1))
    reverse_dir.mkdir(parents=True)
    frame_paths = sorted(frame_dir.glob("*.jpg"), key=lambda path: int(path.stem))
    for reverse_index, original_index in enumerate(reverse_indices):
        shutil.copyfile(frame_paths[original_index], reverse_dir / f"{reverse_index:05d}.jpg")

    reverse_state = predictor.init_state(video_path=str(reverse_dir))
    predictor.reset_state(reverse_state)
    predictor.add_new_points_or_box(
        inference_state=reverse_state,
        frame_idx=0,
        obj_id=obj["id"],
        box=box,
    )
    for reverse_index, object_ids, logits in predictor.propagate_in_video(reverse_state):
        if reverse_index >= len(reverse_indices):
            break
        for position, object_id in enumerate(object_ids):
            if int(object_id) == obj["id"]:
                masks[reverse_indices[int(reverse_index)]] = mask_from_logit(logits[position])
    return masks


def main():
    args = parse_args()
    repo = args.repo.resolve()
    runtime = args.runtime.resolve()
    sys.path.insert(0, str(repo / "SegRef3D"))
    sys.path.insert(0, str(repo / "ColabNotebooks"))
    sys.path.insert(0, str(runtime / "sam2pkg"))

    import torch
    from sam2.build_sam import build_sam2_video_predictor
    from segmentation_job import create_job_zip, safe_extract_job_images, validate_result_zip
    from segonweb_backend import process_segmentation_job

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for this Phase 1 real-SAM2 test.")
    torch.autocast("cuda", dtype=torch.float16).__enter__()
    if torch.cuda.get_device_properties(0).major >= 8:
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

    checkpoint = runtime / "checkpoints" / "sam2.1_hiera_large.pt"
    model_cfg = "configs/sam2.1/sam2.1_hiera_l.yaml"
    predictor = build_sam2_video_predictor(model_cfg, str(checkpoint), device=torch.device("cuda"))

    with tempfile.TemporaryDirectory(prefix="segonweb-real-") as temp:
        root = Path(temp)
        image_records = make_frames(root / "source")
        obj = {
            "id": 1,
            "name": "Synthetic circle",
            "prompt_frame": 2,
            "box": [35, 24, 82, 69],
            "tracking_start": 1,
            "tracking_end": 4,
        }
        input_zip = root / "segonweb_input.zip"
        create_job_zip(str(input_zip), image_records, [obj], app_version="phase1-test")
        manifest, extracted_images = safe_extract_job_images(str(input_zip), str(root / "reference_input"))

        reference_masks = run_v48_reference(
            predictor,
            extracted_images,
            obj,
            root / "reference_reversed",
        )
        result_zip = root / "segref3d_result.zip"
        process_segmentation_job(
            str(input_zip),
            predictor,
            work_dir=str(root / "backend_work"),
            output_zip=str(result_zip),
            device_name=torch.cuda.get_device_name(0),
        )
        result_manifest = validate_result_zip(str(result_zip))

        maximum_reference_difference = 0
        with zipfile.ZipFile(result_zip, "r") as archive:
            for record in result_manifest["result"]["masks"]:
                frame_index = record["index"]
                with archive.open(record["archive_path"]) as mask_file:
                    with Image.open(mask_file) as image:
                        actual = np.array(image) == obj["id"]
                expected = reference_masks.get(frame_index, np.zeros_like(actual))
                if not np.array_equal(actual, expected):
                    differing = int(np.count_nonzero(actual != expected))
                    maximum_reference_difference = max(maximum_reference_difference, differing)
                    tolerance = max(8, int(actual.size * 0.001))
                    if differing > tolerance:
                        raise AssertionError(
                            f"Reference mismatch at frame {frame_index + 1}: "
                            f"{differing} pixels differ (tolerance {tolerance})."
                        )

        print("Reference equivalence: PASS")
        print("Maximum reference boundary difference:", maximum_reference_difference, "pixels")
        print("SegRef3D ZIP -> real SAM2 -> result ZIP: PASS")
        print("Torch:", torch.__version__, "CUDA:", torch.version.cuda)
        print("GPU:", torch.cuda.get_device_name(0))
        print("Frames:", manifest["images"]["count"], "Prompt frame:", obj["prompt_frame"] + 1)

        multi_keyframe_obj = {
            "id": 1,
            "name": "Synthetic circle with two keyframes",
            "tracking_start": 0,
            "tracking_end": 4,
            "prompts": [
                {"type": "box", "frame": 1, "box": [33, 24, 80, 69]},
                {"type": "box", "frame": 3, "box": [39, 24, 86, 69]},
            ],
        }
        keyframe_input = root / "segonweb_multikey_input.zip"
        keyframe_result = root / "segref3d_multikey_result.zip"
        keyframe_manifest = create_job_zip(
            str(keyframe_input),
            image_records,
            [multi_keyframe_obj],
            app_version="multiple-keyframe-smoke",
        )
        normalized_object = keyframe_manifest["objects"][0]
        if [prompt["frame"] for prompt in normalized_object["prompts"]] != [1, 3]:
            raise AssertionError("Multiple keyframes were not retained in the input manifest.")
        process_segmentation_job(
            str(keyframe_input),
            predictor,
            work_dir=str(root / "multikey_backend_work"),
            output_zip=str(keyframe_result),
            device_name=torch.cuda.get_device_name(0),
        )
        keyframe_result_manifest = validate_result_zip(str(keyframe_result))
        returned_object = keyframe_result_manifest["objects"][0]
        if [prompt["frame"] for prompt in returned_object["prompts"]] != [1, 3]:
            raise AssertionError("Multiple keyframes were not retained in the result manifest.")
        labeled_frames = []
        with zipfile.ZipFile(keyframe_result, "r") as archive:
            for record in keyframe_result_manifest["result"]["masks"]:
                with archive.open(record["archive_path"]) as mask_file:
                    with Image.open(mask_file) as image:
                        if np.any(np.array(image) == multi_keyframe_obj["id"]):
                            labeled_frames.append(record["index"])
        if not {1, 3}.issubset(labeled_frames):
            raise AssertionError(f"Prompt-frame masks are missing: labeled frames {labeled_frames}")
        print("Multiple keyframes -> real SAM2 -> result ZIP: PASS")

        second_obj = {
            "id": 2,
            "name": "Synthetic rectangle",
            "prompt_frame": 1,
            "box": [87, 9, 122, 39],
            "tracking_start": 0,
            "tracking_end": 3,
        }
        multi_input = root / "segonweb_multi_input.zip"
        multi_result = root / "segref3d_multi_result.zip"
        create_job_zip(str(multi_input), image_records, [obj, second_obj], app_version="phase1-test")
        process_segmentation_job(
            str(multi_input),
            predictor,
            work_dir=str(root / "multi_backend_work"),
            output_zip=str(multi_result),
            device_name=torch.cuda.get_device_name(0),
        )
        multi_manifest = validate_result_zip(str(multi_result))
        seen_ids = set()
        frame_five_ids = set()
        with zipfile.ZipFile(multi_result, "r") as archive:
            for record in multi_manifest["result"]["masks"]:
                with archive.open(record["archive_path"]) as mask_file:
                    with Image.open(mask_file) as image:
                        labels = set(int(value) for value in np.unique(np.array(image)))
                seen_ids.update(labels)
                if record["index"] == 4:
                    frame_five_ids = labels
        if not {1, 2}.issubset(seen_ids):
            raise AssertionError(f"Multiple-object result is missing labels: seen {sorted(seen_ids)}")
        if 2 in frame_five_ids:
            raise AssertionError("Object 2 appeared outside its tracking range on frame 5.")
        print("Multiple objects with independent prompt frames/ranges: PASS")


if __name__ == "__main__":
    main()
