import json
import io
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

import numpy as np
from PIL import Image


MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from segmentation_job import (  # noqa: E402
    JOB_KIND,
    RESULT_KIND,
    SegmentationJobError,
    create_job_zip,
    make_result_manifest,
    read_archive_manifest,
    validate_manifest,
    validate_job_zip,
    validate_result_zip,
)


class SegmentationJobTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.images = []
        for index in range(3):
            path = self.root / f"image{index + 1:04d}.jpg"
            Image.new("RGB", (32, 24), (index * 20, 30, 40)).save(path, "JPEG")
            self.images.append({
                "key": f"{index + 1:04d}",
                "path": str(path),
                "original_filename": f"source-{index + 1}.png",
            })
        self.objects = [{
            "id": 2,
            "name": "Target",
            "prompt_frame": 1,
            "box": [2, 3, 20, 18],
            "tracking_start": 0,
            "tracking_end": 2,
        }]

    def tearDown(self):
        self.temp_dir.cleanup()

    def _job_zip(self):
        path = self.root / "segonweb_input.zip"
        manifest = create_job_zip(str(path), self.images, self.objects, app_version="test")
        return path, manifest

    def test_job_round_trip(self):
        path, manifest = self._job_zip()
        validated = validate_job_zip(str(path))
        self.assertEqual(validated, manifest)
        self.assertEqual(validated["kind"], JOB_KIND)
        self.assertEqual(validated["images"]["order"], ["0001", "0002", "0003"])
        self.assertEqual(validated["objects"][0]["prompt_frame"], 1)

    def test_rejects_prompt_outside_range(self):
        objects = [dict(self.objects[0], prompt_frame=0, tracking_start=1)]
        with self.assertRaisesRegex(SegmentationJobError, "inside its tracking range"):
            create_job_zip(str(self.root / "bad.zip"), self.images, objects, app_version="test")

    def test_multiple_prompts_are_normalized_and_legacy_fields_match_primary(self):
        objects = [{
            "id": 2,
            "name": "Target",
            "tracking_start": 0,
            "tracking_end": 2,
            "prompts": [
                {"type": "box", "frame": 2, "box": [4, 5, 22, 20]},
                {"type": "box", "frame": 0, "box": [1, 2, 12, 14]},
                {"type": "box", "frame": 1, "box": [2, 3, 20, 18]},
            ],
        }]
        path = self.root / "multiple.zip"
        manifest = create_job_zip(str(path), self.images, objects, app_version="test")
        obj = manifest["objects"][0]
        self.assertEqual([prompt["frame"] for prompt in obj["prompts"]], [0, 1, 2])
        self.assertEqual(obj["prompt_frame"], 0)
        self.assertEqual(obj["box"], [1.0, 2.0, 12.0, 14.0])
        self.assertEqual(validate_job_zip(str(path)), manifest)

    def test_rejects_invalid_multiple_prompt_collections(self):
        _, base = self._job_zip()
        invalid_cases = [
            ([], "at least one box prompt"),
            ([{"type": "point", "frame": 1, "box": [2, 3, 20, 18]}], "type must be box"),
            ([{"type": "box", "frame": 3, "box": [2, 3, 20, 18]}], "outside the image sequence"),
            ([{"type": "box", "frame": 1, "box": [20, 3, 2, 18]}], "coordinates are outside"),
            ([
                {"type": "box", "frame": 1, "box": [2, 3, 20, 18]},
                {"type": "box", "frame": 1, "box": [3, 4, 21, 19]},
            ], "duplicate frame 1"),
        ]
        for prompts, message in invalid_cases:
            with self.subTest(message=message):
                manifest = json.loads(json.dumps(base))
                manifest["objects"][0]["prompts"] = prompts
                with self.assertRaisesRegex(SegmentationJobError, message):
                    validate_manifest(manifest)

    def test_rejects_path_traversal(self):
        path, manifest = self._job_zip()
        manifest["images"]["files"][0]["archive_path"] = "../escape.jpg"
        with zipfile.ZipFile(self.root / "traversal.zip", "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr("../escape.jpg", b"bad")
        with self.assertRaisesRegex(SegmentationJobError, "must not contain"):
            read_archive_manifest(str(self.root / "traversal.zip"))

    def test_rejects_unsafe_image_key(self):
        images = [dict(record) for record in self.images]
        images[0]["key"] = "../../escape"
        with self.assertRaisesRegex(SegmentationJobError, "filename-safe token"):
            create_job_zip(str(self.root / "unsafe-key.zip"), images, self.objects, app_version="test")

    def test_result_round_trip(self):
        job_path, job_manifest = self._job_zip()
        mask_records = []
        result_path = self.root / "segref3d_result.zip"
        with zipfile.ZipFile(job_path, "r") as job_archive, zipfile.ZipFile(result_path, "w") as result_archive:
            for image_record in job_manifest["images"]["files"]:
                result_archive.writestr(image_record["archive_path"], job_archive.read(image_record["archive_path"]))
                mask_path = f"masks/mask{image_record['key']}.png"
                mask_records.append({"index": image_record["index"], "key": image_record["key"], "archive_path": mask_path})
                mask = np.zeros((24, 32), dtype=np.uint8)
                mask[3:10, 4:12] = 2
                payload = io.BytesIO()
                Image.fromarray(mask, mode="L").save(payload, "PNG")
                result_archive.writestr(mask_path, payload.getvalue())
            result_manifest = make_result_manifest(job_manifest, mask_records, backend={"name": "test"})
            result_archive.writestr("manifest.json", json.dumps(result_manifest))

        validated = validate_result_zip(str(result_path))
        self.assertEqual(validated["kind"], RESULT_KIND)
        self.assertEqual(validated["result"]["masks"][1]["key"], "0002")


if __name__ == "__main__":
    unittest.main()
