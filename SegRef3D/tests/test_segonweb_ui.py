import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import numpy as np
from PIL import Image


os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("SEGREF3D_DISABLE_SAM2", "1")
MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from PyQt6.QtWidgets import QApplication  # noqa: E402
import SegRef3D as app_module  # noqa: E402
from segmentation_job import (  # noqa: E402
    SegmentationJobError,
    create_job_zip,
    make_result_manifest,
    validate_job_zip,
)


class SegOnWebUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.previous_cwd = os.getcwd()
        os.chdir(self.temp_dir.name)
        self.window = app_module.SegRefMain()

    def tearDown(self):
        self.window.deleteLater()
        self.app.processEvents()
        os.chdir(self.previous_cwd)
        self.temp_dir.cleanup()

    def _images(self, count=3):
        records = []
        for index in range(count):
            path = Path(self.temp_dir.name) / f"image{index + 1:04d}.jpg"
            Image.new("RGB", (32, 24), (index * 10, 30, 40)).save(path, "JPEG")
            records.append({"key": f"{index + 1:04d}", "path": str(path)})
        return records

    @staticmethod
    def _objects():
        return [{
            "id": 2,
            "name": "Target",
            "prompt_frame": 1,
            "box": [2, 3, 20, 18],
            "tracking_start": 0,
            "tracking_end": 2,
        }]

    def _result_zip(self):
        images = self._images()
        job_zip = Path(self.temp_dir.name) / "segonweb_input.zip"
        job_manifest = create_job_zip(str(job_zip), images, self._objects(), app_version="test")
        result_zip = Path(self.temp_dir.name) / "segref3d_result.zip"
        mask_records = []
        with zipfile.ZipFile(job_zip) as source, zipfile.ZipFile(result_zip, "w") as output:
            for record in job_manifest["images"]["files"]:
                output.writestr(record["archive_path"], source.read(record["archive_path"]))
                mask_path = f"masks/mask{record['key']}.png"
                mask = np.zeros((24, 32), dtype=np.uint8)
                mask[4:12, 5:16] = 2
                payload = io.BytesIO()
                Image.fromarray(mask, mode="L").save(payload, "PNG")
                output.writestr(mask_path, payload.getvalue())
                mask_records.append({
                    "index": record["index"],
                    "key": record["key"],
                    "archive_path": mask_path,
                })
            result_manifest = make_result_manifest(
                job_manifest,
                mask_records,
                backend={"name": "test"},
            )
            output.writestr("manifest.json", json.dumps(result_manifest))
        return result_zip

    def test_export_uses_batch_metadata(self):
        images = self._images()
        self.window.image_paths = {record["key"]: record["path"] for record in images}
        self.window.image_sizes = {record["key"]: (32, 24) for record in images}
        self.window.original_image_filenames = {
            record["key"]: f"original-{record['key']}.png" for record in images
        }
        self.window.batch_object_data = [{
            "id": 2,
            "name": "Target",
            "box": ((2, 3), (20, 18)),
            "point": None,
            "start": 0,
            "end": 2,
            "box_frame": 1,
        }]
        output_zip = Path(self.temp_dir.name) / "exported.zip"
        with patch.object(app_module.QFileDialog, "getSaveFileName", return_value=(str(output_zip), "")):
            with patch.object(app_module.QMessageBox, "information"):
                self.window.export_for_segonweb()

        manifest = validate_job_zip(str(output_zip))
        self.assertEqual(manifest["objects"][0]["id"], 2)
        self.assertEqual(manifest["objects"][0]["prompt_frame"], 1)
        self.assertEqual(manifest["objects"][0]["tracking_start"], 0)
        self.assertEqual(manifest["images"]["files"][0]["original_filename"], "original-0001.png")

    def test_lite_mode_keeps_segonweb_job_tools_enabled(self):
        for button in self.window.local_sam2_execution_buttons():
            self.assertFalse(button.isEnabled(), button.text())
        for button in self.window.segonweb_job_buttons():
            self.assertTrue(button.isEnabled(), button.text())

        images = self._images()
        self.window.image_paths = {record["key"]: record["path"] for record in images}
        self.window.image_sizes = {record["key"]: (32, 24) for record in images}
        self.window.current_index = 1
        self.window.set_tracking_start()
        self.window.set_tracking_end()
        self.assertEqual(self.window.tracking_start_index, 1)
        self.assertEqual(self.window.tracking_end_index, 1)

    def test_import_restores_images_masks_and_objects(self):
        result_zip = self._result_zip()
        with patch.object(app_module.QFileDialog, "getOpenFileName", return_value=(str(result_zip), "")):
            with patch.object(app_module.QMessageBox, "warning") as warning:
                self.window.import_segonweb_result()

        warning.assert_not_called()
        self.assertEqual(sorted(self.window.image_paths), ["0001", "0002", "0003"])
        self.assertEqual(sorted(self.window.label_masks), ["0001", "0002", "0003"])
        self.assertEqual(int(self.window.label_masks["0002"][5, 6]), 2)
        self.assertEqual(self.window.batch_object_data[0]["name"], "Target")
        self.assertEqual(self.window.batch_object_data[0]["box_frame"], 1)
        self.assertTrue((Path(self.window.output_label_dir) / "mask0001.png").is_file())

    def test_result_rejects_different_current_image_order(self):
        result_zip = self._result_zip()
        images = self._images()
        self.window.image_paths = {
            "1001": images[0]["path"],
            "1002": images[1]["path"],
            "1003": images[2]["path"],
        }
        with self.assertRaisesRegex(SegmentationJobError, "Image order mismatch"):
            self.window._validate_current_images_for_result(
                app_module.validate_result_zip(str(result_zip))
            )


if __name__ == "__main__":
    unittest.main()
