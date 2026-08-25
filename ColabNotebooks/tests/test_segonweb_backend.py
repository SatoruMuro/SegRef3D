from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "SegRef3D"))
sys.path.insert(0, str(ROOT / "ColabNotebooks"))

from segmentation_job import create_job_zip, validate_result_zip  # noqa: E402
from segonweb_backend import process_segmentation_job  # noqa: E402


class FakeLogit:
    def __init__(self, array):
        self.array = array

    def __gt__(self, value):
        return FakeLogit(self.array > value)

    def squeeze(self):
        return FakeLogit(np.squeeze(self.array))

    def detach(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return self.array


class FakePredictor:
    def __init__(self):
        self.prompt_calls = []

    def init_state(self, video_path):
        paths = sorted(Path(video_path).glob("*.jpg"), key=lambda path: int(path.stem))
        return {"count": len(paths), "video_path": str(video_path), "prompts": [], "obj_id": None}

    def reset_state(self, state):
        return None

    def add_new_points_or_box(self, *, inference_state, frame_idx, obj_id, box):
        prompt = {"frame": int(frame_idx), "box": np.asarray(box, dtype=int)}
        inference_state["prompts"].append(prompt)
        inference_state["obj_id"] = int(obj_id)
        self.prompt_calls.append({
            "video_path": inference_state["video_path"],
            "frame": prompt["frame"],
            "obj_id": int(obj_id),
            "box": prompt["box"].tolist(),
        })
        return frame_idx, [obj_id], [self._mask(prompt["box"])]

    def propagate_in_video(self, state):
        prompts = sorted(state["prompts"], key=lambda prompt: prompt["frame"])
        for frame_idx in range(prompts[0]["frame"], state["count"]):
            nearest = min(prompts, key=lambda prompt: abs(prompt["frame"] - frame_idx))
            yield frame_idx, [state["obj_id"]], [self._mask(nearest["box"])]

    @staticmethod
    def _mask(box):
        x1, y1, x2, y2 = box
        mask = np.full((1, 24, 32), -1.0, dtype=np.float32)
        mask[:, y1:y2, x1:x2] = 1.0
        return FakeLogit(mask)


class EmptyPropagationPredictor(FakePredictor):
    def propagate_in_video(self, state):
        empty = FakeLogit(np.full((1, 24, 32), -1.0, dtype=np.float32))
        for frame_idx in range(state["count"]):
            yield frame_idx, [state["obj_id"]], [empty]


class SegOnWebBackendTests(unittest.TestCase):
    def test_prompt_frame_uses_direct_box_mask_even_if_propagation_differs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            images = []
            for index in range(3):
                path = root / f"source{index + 1}.jpg"
                Image.new("RGB", (32, 24), "black").save(path, "JPEG")
                images.append({"key": f"{index + 1:04d}", "path": str(path)})
            input_zip = root / "segonweb_input.zip"
            result_zip = root / "segref3d_result.zip"
            create_job_zip(
                str(input_zip),
                images,
                [{
                    "id": 1,
                    "name": "Prompt mask",
                    "prompt_frame": 1,
                    "box": [4, 5, 12, 14],
                    "tracking_start": 0,
                    "tracking_end": 2,
                }],
                app_version="test",
            )
            process_segmentation_job(
                str(input_zip),
                EmptyPropagationPredictor(),
                work_dir=str(root / "work"),
                output_zip=str(result_zip),
                device_name="fake",
            )
            manifest = validate_result_zip(str(result_zip))
            import zipfile

            prompt_record = manifest["result"]["masks"][1]
            with zipfile.ZipFile(result_zip) as archive:
                with archive.open(prompt_record["archive_path"]) as mask_file:
                    with Image.open(mask_file) as image:
                        prompt_mask = np.array(image)
            self.assertEqual(prompt_mask[6, 5], 1)
            self.assertEqual(prompt_mask[4, 5], 0)

    def test_multiple_objects_and_partial_ranges(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            images = []
            for index in range(5):
                path = root / f"source{index + 1}.jpg"
                Image.new("RGB", (32, 24), (10 + index, 20, 30)).save(path, "JPEG")
                images.append({"key": f"{index + 1:04d}", "path": str(path)})
            objects = [
                {
                    "id": 1,
                    "name": "First",
                    "prompt_frame": 2,
                    "box": [2, 3, 12, 14],
                    "tracking_start": 1,
                    "tracking_end": 3,
                },
                {
                    "id": 3,
                    "name": "Second",
                    "prompt_frame": 3,
                    "box": [8, 8, 20, 20],
                    "tracking_start": 2,
                    "tracking_end": 4,
                },
            ]
            input_zip = root / "segonweb_input.zip"
            result_zip = root / "segref3d_result.zip"
            create_job_zip(str(input_zip), images, objects, app_version="test")
            process_segmentation_job(
                str(input_zip),
                FakePredictor(),
                work_dir=str(root / "work"),
                output_zip=str(result_zip),
                device_name="fake",
            )

            manifest = validate_result_zip(str(result_zip))
            self.assertEqual([obj["id"] for obj in manifest["objects"]], [1, 3])
            import zipfile

            with zipfile.ZipFile(result_zip) as archive:
                masks = []
                for record in manifest["result"]["masks"]:
                    with archive.open(record["archive_path"]) as mask_file:
                        with Image.open(mask_file) as image:
                            masks.append(np.array(image))
            self.assertFalse(np.any(masks[0]))
            self.assertEqual(masks[1][4, 4], 1)
            self.assertEqual(masks[2][10, 10], 3)
            self.assertEqual(masks[3][4, 4], 1)
            self.assertEqual(masks[4][10, 10], 3)

    def test_multiple_keyframes_are_submitted_in_forward_and_backward_states(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            images = []
            for index in range(10):
                path = root / f"source{index + 1}.jpg"
                Image.new("RGB", (32, 24), (10 + index, 20, 30)).save(path, "JPEG")
                images.append({"key": f"{index + 1:04d}", "path": str(path)})
            prompts = [
                {"type": "box", "frame": 2, "box": [2, 3, 10, 12]},
                {"type": "box", "frame": 5, "box": [8, 5, 18, 16]},
                {"type": "box", "frame": 8, "box": [14, 8, 26, 21]},
            ]
            objects = [{
                "id": 1,
                "name": "Multi",
                "tracking_start": 0,
                "tracking_end": 9,
                "prompts": prompts,
            }]
            input_zip = root / "segonweb_input.zip"
            result_zip = root / "segref3d_result.zip"
            manifest = create_job_zip(str(input_zip), images, objects, app_version="test")
            self.assertEqual([prompt["frame"] for prompt in manifest["objects"][0]["prompts"]], [2, 5, 8])

            predictor = FakePredictor()
            progress = []
            process_segmentation_job(
                str(input_zip),
                predictor,
                work_dir=str(root / "work"),
                output_zip=str(result_zip),
                device_name="fake",
                progress_callback=progress.append,
            )

            forward = [call for call in predictor.prompt_calls if "forward" in call["video_path"]]
            backward = [call for call in predictor.prompt_calls if "reversed" in call["video_path"]]
            self.assertEqual([call["frame"] for call in forward], [2, 5, 8])
            self.assertEqual([call["frame"] for call in backward], [1, 4, 7])
            self.assertTrue(all(call["obj_id"] == 1 for call in predictor.prompt_calls))
            self.assertEqual([call["box"] for call in forward], [prompt["box"] for prompt in prompts])
            self.assertEqual([call["box"] for call in backward], [prompt["box"] for prompt in reversed(prompts)])
            self.assertEqual([item["frame"] for item in progress if item["event"] == "prompt"], [2, 5, 8, 8, 5, 2])

            result_manifest = validate_result_zip(str(result_zip))
            self.assertEqual(len(result_manifest["objects"][0]["prompts"]), 3)
            self.assertEqual(result_manifest["images"]["count"], 10)


if __name__ == "__main__":
    unittest.main()
