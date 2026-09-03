import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

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

    def test_nifti_labelmap_ui_exposes_geometry_preserving_exports(self):
        self.assertEqual(self.window.btn_export_nifti.text(), "Export NIfTI Labelmap")
        self.assertEqual(self.window.btn_export_nifti_5x.text(), "NIfTI Labelmap (5x)")
        self.assertEqual(self.window.btn_export_nifti_10x.text(), "NIfTI Labelmap (10x)")
        self.assertIn("3D Slicer", self.window.btn_export_nifti.toolTip())
        self.assertIn("slice direction", self.window.btn_export_nifti_5x.toolTip())
        self.assertIn("physical geometry", self.window.btn_export_nifti_10x.toolTip())

    def test_stl_ui_matches_lite_preview_export_controls(self):
        self.assertEqual(
            [self.window.combo_stl_factor.itemData(index) for index in range(3)],
            [1, 5, 10],
        )
        self.assertEqual(self.window.combo_stl_factor.currentData(), 5)
        self.assertEqual(
            [self.window.combo_stl_objects.itemData(index) for index in range(2)],
            ["target", "visible"],
        )
        self.assertEqual(self.window.combo_stl_objects.currentData(), "target")
        self.assertEqual(self.window.btn_preview_stl.text(), "Preview 3D")
        self.assertEqual(self.window.btn_export_stl_colorwise.text(), "Export STL")
        self.assertIn("without saving", self.window.btn_preview_stl.toolTip())
        self.assertIn("same mesh pipeline", self.window.btn_export_stl_colorwise.toolTip())

    def test_stl_pipeline_uses_controls_without_mutating_editor_masks(self):
        for index, key in enumerate(self.window.label_masks):
            self.window.label_masks[key][6:13, 5 + index:12 + index] = 1
        before = {
            key: mask.copy() for key, mask in self.window.label_masks.items()
        }
        self.window.combo_stl_factor.setCurrentIndex(
            self.window.combo_stl_factor.findData(5)
        )
        self.window.combo_stl_objects.setCurrentIndex(
            self.window.combo_stl_objects.findData("target")
        )
        self.window.mm_per_px = 1.0
        self.window.z_spacing_mm = 1.0

        meshes = self.window._build_stl_meshes_from_controls()

        self.assertEqual(len(meshes), 1)
        self.assertEqual(meshes[0].label, 1)
        self.assertEqual(meshes[0].factor, 5)
        self.assertAlmostEqual(meshes[0].mesh_pitch_zyx[0], 0.2)
        if app_module.vtk is not None:
            preview_data = app_module.STLPreviewDialog._polydata_from_mesh(meshes[0].mesh)
            self.assertEqual(preview_data.GetNumberOfPoints(), len(meshes[0].mesh.vertices))
            self.assertEqual(preview_data.GetNumberOfPolys(), len(meshes[0].mesh.faces))
        for key, expected in before.items():
            np.testing.assert_array_equal(self.window.label_masks[key], expected)

    def test_stl_pipeline_requires_physical_spacing_when_volinfo_is_canceled(self):
        self.window.label_masks["0001"][6:13, 5:12] = 1
        with patch.object(self.window, "load_volinf_csv") as load_volinfo:
            with self.assertRaisesRegex(ValueError, "Voxel spacing is not set"):
                self.window._build_stl_meshes_from_controls()
        load_volinfo.assert_called_once_with()

    def test_gpu_panel_shows_local_execution_controls(self):
        self.window.sam2_enabled = True
        self.window._update_sam2_panel_visibility()
        self.assertFalse(self.window.local_sam2_widget.isHidden())
        self.assertTrue(self.window.lite_sam2_widget.isHidden())

    def test_local_sam2_add_is_directly_below_run_tracking(self):
        layout = self.window.local_sam2_widget.layout()
        buttons = [layout.itemAt(index).widget() for index in range(layout.count())]

        self.assertEqual(
            buttons,
            [
                self.window.btn_run_sam2,
                self.window.btn_prepare_tracking,
                self.window.btn_run_tracking,
                self.window.btn_local_sam2_add,
                self.window.btn_manage_local_batch_jobs,
            ],
        )
        self.assertFalse(hasattr(self.window, "btn_batch_tracking"))
        self.assertEqual(self.window.btn_local_sam2_add.text(), "Add")
        self.assertEqual(
            self.window.btn_local_sam2_add.sizePolicy().horizontalPolicy(),
            self.window.btn_run_tracking.sizePolicy().horizontalPolicy(),
        )
        self.assertEqual(
            self.window.btn_local_sam2_add.styleSheet(),
            self.window.btn_add_to_mask.styleSheet(),
        )

    def test_local_sam2_add_matches_draw_refine_add(self):
        key = "0001"
        self.window.drawn_paths_per_image[key] = [(self._rectangle(), "#808080")]
        self.window.btn_local_sam2_add.click()
        local_sam2_result = self.window.label_masks[key].copy()

        self.window.smart_undo()
        self.window.drawn_paths_per_image[key] = [(self._rectangle(), "#808080")]
        self.window.btn_add_to_mask.click()

        np.testing.assert_array_equal(self.window.label_masks[key], local_sam2_result)
        self.assertTrue(np.any(local_sam2_result == 1))

    def test_batch_jobs_dialog_remains_the_local_batch_run_entry_point(self):
        jobs = [{
            "id": 1,
            "name": "Object 1",
            "box": ((2, 3), (20, 18)),
            "point": None,
            "start": 0,
            "end": 2,
            "box_frame": 1,
        }]
        dialog = Mock()
        dialog.exec.return_value = app_module.QDialog.DialogCode.Accepted
        dialog.objects = jobs
        dialog.run_local_requested = True

        with patch.object(app_module, "BatchTrackingDialog", return_value=dialog):
            with patch.object(self.window, "run_batch_tracking") as run_local:
                self.window.show_batch_tracking_jobs()

        run_local.assert_called_once_with()
        self.assertEqual(self.window.batch_object_data, jobs)

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

    def test_status_progress_keeps_operation_text_separate_from_percentage(self):
        cases = (
            ("▶ Forward tracking", 68),
            ("◀ Backward tracking", 10),
            ("▶ Object 2: Forward", 42),
            ("Exporting STL...", 100),
        )

        for status_text, percent in cases:
            with self.subTest(status_text=status_text):
                self.window._set_status_progress(status_text, percent)
                self.assertEqual(self.window.label_status.text(), status_text)
                self.assertNotIn("%", self.window.label_status.text())
                self.assertNotIn("█", self.window.label_status.text())
                self.assertFalse(self.window.status_progress.isHidden())
                self.assertEqual(self.window.status_progress.value(), percent)
                self.assertEqual(self.window.status_progress.text(), f"{percent}%")

    def test_completion_error_and_plain_status_messages_hide_progress(self):
        self.window._set_status_progress("◀ Backward tracking", 10)

        for message in (
            "✅ Tracking completed.",
            "⚠ Tracking failed: test error",
            "Coverage: 68%",
            "Ready",
        ):
            with self.subTest(message=message):
                self.window.label_status.setText(message)
                self.assertEqual(self.window.label_status.text(), message)
                self.assertTrue(self.window.status_progress.isHidden())


if __name__ == "__main__":
    unittest.main()
