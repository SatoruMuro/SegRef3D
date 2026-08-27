import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image


os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("SEGREF3D_DISABLE_SAM2", "1")
MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from PyQt6.QtWidgets import QApplication  # noqa: E402
import SegRef3D as app_module  # noqa: E402


class MaskPostProcessingUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.previous_cwd = os.getcwd()
        os.chdir(self.temp_dir.name)
        self.window = app_module.SegRefMain()
        self.window.image_paths = {}
        self.window.label_masks = {}
        for index in range(5):
            key = f"{index + 1:04d}"
            path = Path(self.temp_dir.name) / f"image{key}.png"
            Image.new("L", (32, 24), 128).save(path)
            self.window.image_paths[key] = str(path)
            self.window.label_masks[key] = np.zeros((24, 32), dtype=np.uint8)
        self.window.current_index = 2

    def tearDown(self):
        if self.window.mask_postprocessing_dialog is not None:
            self.window.mask_postprocessing_dialog.close()
        self.window.deleteLater()
        self.app.processEvents()
        os.chdir(self.previous_cwd)
        self.temp_dir.cleanup()

    @staticmethod
    def _cleanup_settings(scope, start=1, end=5):
        return {
            "object_id": 1,
            "operation": "fill-holes",
            "operation_name": "Fill Holes",
            "scope": scope,
            "start_frame": start,
            "end_frame": end,
            "minimum_size": 20,
            "radius": 1,
            "iterations": 1,
        }

    def _put_ring(self, key):
        mask = self.window.label_masks[key]
        mask[8:13, 8] = 1
        mask[8:13, 12] = 1
        mask[8, 8:13] = 1
        mask[12, 8:13] = 1

    def test_cleanup_scopes_change_only_selected_frames(self):
        for key in self.window.label_masks:
            self._put_ring(key)

        self.window.apply_mask_cleanup(self._cleanup_settings("current"))
        self.assertEqual(self.window.label_masks["0003"][10, 10], 1)
        self.assertEqual(self.window.label_masks["0002"][10, 10], 0)

        self.window.apply_mask_cleanup(self._cleanup_settings("range", 1, 2))
        self.assertEqual(self.window.label_masks["0001"][10, 10], 1)
        self.assertEqual(self.window.label_masks["0002"][10, 10], 1)
        self.assertEqual(self.window.label_masks["0004"][10, 10], 0)

        self.window.apply_mask_cleanup(self._cleanup_settings("all"))
        self.assertTrue(all(mask[10, 10] == 1 for mask in self.window.label_masks.values()))

    def test_cleanup_autosaves_and_undo_redo_is_one_transaction(self):
        for key in ("0002", "0003", "0004"):
            self._put_ring(key)
        self.window.apply_mask_cleanup(self._cleanup_settings("range", 2, 4))
        self.assertEqual(len(self.window.undo_stack["__global__"]), 1)
        for key in ("0002", "0003", "0004"):
            self.assertTrue(Path(self.window.get_label_png_path(key)).exists())
            self.assertEqual(self.window.label_masks[key][10, 10], 1)

        self.window.smart_undo()
        self.assertTrue(all(self.window.label_masks[key][10, 10] == 0 for key in ("0002", "0003", "0004")))
        self.window.redo_edit()
        self.assertTrue(all(self.window.label_masks[key][10, 10] == 1 for key in ("0002", "0003", "0004")))

    def test_interpolation_preserves_endpoints_and_other_objects(self):
        self.window.label_masks["0001"][8:13, 7:12] = 1
        self.window.label_masks["0005"][8:13, 17:22] = 1
        self.window.label_masks["0003"][10, 14] = 2
        first = self.window.label_masks["0001"].copy()
        last = self.window.label_masks["0005"].copy()

        self.window.interpolate_masks_between_frames({
            "object_id": 1,
            "start_frame": 1,
            "end_frame": 5,
        })
        np.testing.assert_array_equal(self.window.label_masks["0001"], first)
        np.testing.assert_array_equal(self.window.label_masks["0005"], last)
        self.assertTrue(any(np.any(self.window.label_masks[key] == 1) for key in ("0002", "0003", "0004")))
        self.assertEqual(self.window.label_masks["0003"][10, 14], 2)
        self.assertEqual(len(self.window.undo_stack["__global__"]), 1)

        self.window.smart_undo()
        self.assertTrue(all(not np.any(self.window.label_masks[key] == 1) for key in ("0002", "0003", "0004")))
        self.assertEqual(self.window.label_masks["0003"][10, 14], 2)

    def test_inline_interpolation_controls_follow_loaded_frames_and_target(self):
        self.window._sync_slice_navigation()
        self.assertEqual(self.window.spin_interpolation_start.maximum(), 5)
        self.assertEqual(self.window.spin_interpolation_start.value(), 1)
        self.assertEqual(self.window.spin_interpolation_end.value(), 5)
        self.assertTrue(self.window.btn_interpolate_masks.isEnabled())

        self.window.set_target_object(2)
        self.assertEqual(self.window.combo_interpolation_object.currentData(), 3)
        self.window.spin_interpolation_start.setValue(2)
        self.window.spin_interpolation_end.setValue(4)
        with patch.object(self.window, "interpolate_masks_between_frames") as interpolate:
            self.window.interpolate_masks_from_panel()
        interpolate.assert_called_once_with({
            "object_id": 3,
            "start_frame": 2,
            "end_frame": 4,
        })


if __name__ == "__main__":
    unittest.main()
