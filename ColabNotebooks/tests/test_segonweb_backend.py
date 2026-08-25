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
    def init_state(self, video_path):
        paths = sorted(Path(video_path).glob("*.jpg"), key=lambda path: int(path.stem))
        return {"count": len(paths), "prompt_frame": None, "obj_id": None, "box": None}

    def reset_state(self, state):
        return None

    def add_new_points_or_box(self, *, inference_state, frame_idx, obj_id, box):
        inference_state.update(prompt_frame=int(frame_idx), obj_id=int(obj_id), box=np.asarray(box, dtype=int))
        return frame_idx, [obj_id], [self._mask(inference_state)]

    def propagate_in_video(self, state):
        for frame_idx in range(state["prompt_frame"], state["count"]):
            yield frame_idx, [state["obj_id"]], [self._mask(state)]

    @staticmethod
    def _mask(state):
        x1, y1, x2, y2 = state["box"]
        mask = np.full((1, 24, 32), -1.0, dtype=np.float32)
        mask[:, y1:y2, x1:x2] = 1.0
        return FakeLogit(mask)


class SegOnWebBackendTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
