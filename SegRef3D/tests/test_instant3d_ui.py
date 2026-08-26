import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import nibabel as nib
import numpy as np


os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("SEGREF3D_DISABLE_SAM2", "1")
MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from PyQt6.QtWidgets import QApplication  # noqa: E402
import SegRef3D as app_module  # noqa: E402
from instant3d_bridge import make_request_manifest  # noqa: E402


class Instant3DDesktopUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = os.getcwd()
        os.chdir(self.temp.name)
        self.window = app_module.SegRefMain()
        self.affine = np.array([
            [-0.7, 0, 0, 40], [0, 0.8, 0, -12], [0, 0, 2.0, 6], [0, 0, 0, 1],
        ])
        self.source = Path(self.temp.name) / "ct.nii.gz"
        volume = np.arange(6 * 5 * 4, dtype=np.int16).reshape((6, 5, 4))
        nib.save(nib.Nifti1Image(volume, self.affine), self.source)

    def tearDown(self):
        self.window.deleteLater()
        self.app.processEvents()
        os.chdir(self.previous)
        self.temp.cleanup()

    def test_nifti_source_is_retained_with_exact_affine(self):
        self.assertTrue(self.window._load_nifti_volume(str(self.source)))
        self.assertEqual(len(self.window.image_paths), 4)
        self.assertEqual(self.window.image_sizes["0001"], (6, 5))
        self.assertEqual(self.window.source_nifti_fingerprint["orientation"], "LAS")
        np.testing.assert_allclose(self.window.source_nifti_fingerprint["affine"], self.affine)

    def test_result_import_maps_source_xy_to_display_rows_without_flipping(self):
        self.assertTrue(self.window._load_nifti_volume(str(self.source)))
        objects = [{
            "object_id": 2, "display_name": "Kidney, right", "task": "total", "roi": "kidney_right",
        }]
        manifest = make_request_manifest(self.source, objects)
        manifest.update({"status": "success", "software": {}, "warnings": [], "overlaps": []})
        labelmap = np.zeros((6, 5, 4), dtype=np.uint8)
        labelmap[4, 2, 1] = 2
        label_path = Path(self.temp.name) / "labels.nii.gz"
        nib.save(nib.Nifti1Image(labelmap, self.affine), label_path)
        result = Path(self.temp.name) / "instant3d_result.zip"
        with zipfile.ZipFile(result, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.write(label_path, "labelmap/labels.nii.gz")
        with patch.object(app_module.QFileDialog, "getOpenFileName", return_value=(str(result), "")):
            self.window.import_instant3dweb2_result()
        self.assertEqual(int(self.window.label_masks["0002"][2, 4]), 2)
        self.assertEqual(self.window.object_label_names[2], "Kidney, right")
        self.window.smart_undo()
        self.assertFalse(np.any(self.window.label_masks["0002"] == 2))


if __name__ == "__main__":
    unittest.main()
