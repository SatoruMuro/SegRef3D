import os
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image


os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("SEGREF3D_DISABLE_SAM2", "1")
MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from PyQt6.QtGui import QPainterPath  # noqa: E402
from PyQt6.QtWidgets import QApplication  # noqa: E402
import SegRef3D as app_module  # noqa: E402


class DesktopWorkspaceUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.previous_cwd = os.getcwd()
        os.chdir(self.temp_dir.name)
        self.window = app_module.SegRefMain()
        self.window.image_paths = {}
        self.window.image_sizes = {}
        self.window.label_masks = {}
        for index in range(3):
            key = f"{index + 1:04d}"
            path = Path(self.temp_dir.name) / f"image{key}.png"
            Image.new("L", (32, 24), 128).save(path)
            self.window.image_paths[key] = str(path)
            self.window.image_sizes[key] = (32, 24)
            self.window.label_masks[key] = np.zeros((24, 32), dtype=np.uint8)
            self.window.drawn_paths_per_image[key] = []
        self.window.current_index = 0
        self.window.display_current_image()

    def tearDown(self):
        self.window.deleteLater()
        self.app.processEvents()
        os.chdir(self.previous_cwd)
        self.temp_dir.cleanup()

    @staticmethod
    def _rectangle():
        path = QPainterPath()
        path.addRect(3, 3, 8, 8)
        return path

    def test_object_row_selects_target_and_cleanup_object(self):
        self.window.object_target_buttons[2].click()
        self.assertEqual(self.window.combo_target_object.currentIndex(), 2)
        self.assertEqual(self.window.combo_delete_object.currentIndex(), 2)
        self.assertTrue(self.window.object_target_buttons[2].isChecked())
        self.assertIn("Obj 3", self.window.label_active_target.text())

    def test_slice_controls_follow_all_navigation_paths(self):
        self.window.slice_slider.setValue(3)
        self.assertEqual(self.window.current_index, 2)
        self.assertEqual(self.window.spin_slice.value(), 3)
        self.assertFalse(self.window.btn_next_slice.isEnabled())
        self.window.go_to_previous_image()
        self.assertEqual(self.window.current_index, 1)
        self.assertEqual(self.window.slice_slider.value(), 2)
        self.assertEqual(self.window.label_slice_count.text(), "/ 3")

    def test_lite_panel_hides_local_execution_controls(self):
        self.assertTrue(self.window.local_sam2_widget.isHidden())
        self.assertFalse(self.window.lite_sam2_widget.isHidden())
        self.assertTrue(self.window.btn_seg_on_web.isEnabled())
        self.assertFalse(self.window.btn_run_sam2.isEnabled())

    def test_gpu_panel_shows_local_execution_controls(self):
        self.window.sam2_enabled = True
        self.window._update_sam2_panel_visibility()
        self.assertFalse(self.window.local_sam2_widget.isHidden())
        self.assertTrue(self.window.lite_sam2_widget.isHidden())

    def test_current_scope_leaves_other_pending_slices_untouched(self):
        self.window.drawn_paths_per_image["0001"] = [(self._rectangle(), "#808080")]
        self.window.drawn_paths_per_image["0002"] = [(self._rectangle(), "#808080")]
        self.window.radio_apply_current.setChecked(True)
        self.window.add_drawn_path_to_mask()
        self.assertTrue(np.any(self.window.label_masks["0001"] == 1))
        self.assertFalse(np.any(self.window.label_masks["0002"] == 1))
        self.assertEqual(self.window.drawn_paths_per_image["0001"], [])
        self.assertEqual(len(self.window.drawn_paths_per_image["0002"]), 1)

        self.window.smart_undo()
        self.assertFalse(np.any(self.window.label_masks["0001"] == 1))
        self.window.smart_redo()
        self.assertTrue(np.any(self.window.label_masks["0001"] == 1))

    def test_all_pending_scope_is_one_transaction(self):
        for key in ("0001", "0002"):
            self.window.drawn_paths_per_image[key] = [(self._rectangle(), "#808080")]
        self.window.radio_apply_all_pending.setChecked(True)
        self.window.add_drawn_path_to_mask()
        self.assertTrue(np.any(self.window.label_masks["0001"] == 1))
        self.assertTrue(np.any(self.window.label_masks["0002"] == 1))
        self.assertEqual(len(self.window.undo_stack["__global__"]), 1)
        self.window.smart_undo()
        self.assertFalse(np.any(self.window.label_masks["0001"] == 1))
        self.assertFalse(np.any(self.window.label_masks["0002"] == 1))

    def test_erase_current_scope_does_not_touch_other_pending_slice(self):
        for key in ("0001", "0002"):
            self.window.label_masks[key][:] = 1
            self.window.drawn_paths_per_image[key] = [(self._rectangle(), "#808080")]
        self.window.radio_apply_current.setChecked(True)
        self.window.cut_drawn_path_from_mask()

        self.assertTrue(np.any(self.window.label_masks["0001"] == 0))
        self.assertFalse(np.any(self.window.label_masks["0002"] == 0))
        self.assertEqual(len(self.window.drawn_paths_per_image["0002"]), 1)

    def test_transfer_changes_only_the_drawn_source_region(self):
        key = "0001"
        self.window.label_masks[key][:] = 1
        path = self._rectangle()
        self.window.drawn_paths_per_image[key] = [(path, "#808080")]
        self.window.combo_transfer_target.setCurrentIndex(1)
        self.window.radio_apply_current.setChecked(True)
        expected_region = self.window.rasterize_path_to_binary(path, 32, 24)

        self.window.transfer_drawn_path_to_mask()

        result = self.window.label_masks[key]
        self.assertTrue(np.all(result[expected_region] == 2))
        self.assertTrue(np.all(result[~expected_region] == 1))

    def test_resize_preserves_zoom_transform(self):
        self.window.graphicsView.scale(2.0, 2.0)
        before = self.window.graphicsView.transform().m11()
        self.window.resize(1200, 760)
        self.app.processEvents()
        self.assertAlmostEqual(self.window.graphicsView.transform().m11(), before)

    def test_status_progress_is_only_visible_for_percent_messages(self):
        self.window.label_status.setText("Tracking Object 2: 68%")
        self.assertFalse(self.window.status_progress.isHidden())
        self.assertEqual(self.window.status_progress.value(), 68)
        self.window.label_status.setText("Ready")
        self.assertTrue(self.window.status_progress.isHidden())


if __name__ == "__main__":
    unittest.main()
