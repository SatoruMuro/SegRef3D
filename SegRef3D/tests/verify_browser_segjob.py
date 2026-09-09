"""Validate browser-generated ZIPs with the unchanged desktop/Colab reader."""
import json
from pathlib import Path
import sys
import tempfile

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "SegRef3D"), str(ROOT / "ColabNotebooks"), str(ROOT / "ColabNotebooks/tests")]
from segmentation_job import safe_extract_job_images, validate_result_zip
from segonweb_backend import process_segmentation_job
from test_segonweb_backend import FakeLogit, FakePredictor


class ImageSizePredictor(FakePredictor):
    """Exercise backend ZIP and prompt handling, without claiming real SAM2 inference."""
    def init_state(self, video_path):
        state = super().init_state(video_path)
        with Image.open(next(Path(video_path).glob("*.jpg"))) as image:
            self.shape = (image.height, image.width)
        return state

    def _mask(self, box):
        x1, y1, x2, y2 = box
        mask = np.full((1, *self.shape), -1.0, dtype=np.float32)
        mask[:, y1:y2, x1:x2] = 1.0
        return FakeLogit(mask)


def verify(folder):
    archives = sorted(Path(folder).glob("*.zip"))
    assert len(archives) == 10, f"Expected 10 browser exports, found {len(archives)}"
    for archive in archives:
        with tempfile.TemporaryDirectory() as temp:
            manifest, images = safe_extract_job_images(str(archive), str(Path(temp) / "validated"))
            assert manifest["format_version"] == "segref3d-segjob-1.0"
            assert len(list(images.glob("*.jpg"))) == manifest["images"]["count"] == 15
            assert (manifest["images"]["width"], manifest["images"]["height"]) == (400, 400)
            obj = manifest["objects"][0]
            assert (obj["tracking_start"], obj["tracking_end"], obj["prompt_frame"]) == (0, 14, 0)
            np.testing.assert_allclose(obj["box"], [40, 50, 280, 300], atol=0.5)
            for image_path in images.glob("*.jpg"):
                with Image.open(image_path) as image:
                    image.load()
                    assert (image.format, image.mode, image.size) == ("JPEG", "RGB", (400, 400))
            result = Path(temp) / "result.zip"
            predictor = ImageSizePredictor()
            process_segmentation_job(str(archive), predictor, work_dir=str(Path(temp) / "backend"), output_zip=str(result), device_name="synthetic-test")
            result_manifest = validate_result_zip(str(result))
            assert len(result_manifest["result"]["masks"]) == 15
            assert predictor.prompt_calls
            print(json.dumps({"zip": archive.name, "validated_jpegs": 15, "backend_result_masks": 15, "predictor": "fake"}))


if __name__ == "__main__":
    verify(sys.argv[1])
