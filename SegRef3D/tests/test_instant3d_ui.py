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
from medical_source_fixtures import write_dicom_series


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

    def test_external_ai_entry_names_are_distinct_and_legacy_is_preserved(self):
        self.assertEqual(self.window.btn_seg_on_web.text(), "Seg Anything")
        self.assertEqual(self.window.btn_instant3d_workflow.text(), "Seg CT/MRI")
        self.assertEqual(self.window.btn_instant3dweb.text(), "Legacy Instant3DWeb")
        self.assertIn("SAM", self.window.btn_seg_on_web.toolTip())
        self.assertIn("TotalSegmentator", self.window.btn_instant3d_workflow.toolTip())

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

    def test_local_gpu_dicom_load_catalog_export_import_and_undo(self):
        for modality in ("CT", "MR"):
            with self.subTest(modality=modality):
                folder = Path(self.temp.name) / modality
                paths, expected, affine = write_dicom_series(folder, modality)
                with patch.object(app_module.QFileDialog, "getExistingDirectory", return_value=str(folder)), \
                     patch.object(app_module.QMessageBox, "warning") as warning, \
                     patch.object(app_module.QMessageBox, "information"), \
                     patch.dict(os.environ, {"SEGREF3D_EDITION": "local-gpu"}):
                    self.window.load_image_folder()
                warning.assert_not_called()
                self.assertIsNone(self.window.source_volume_error)
                source = self.window.source_nifti_path
                np.testing.assert_array_equal(np.asarray(nib.load(source).dataobj), expected)
                self.assertEqual(list(self.window.dicom_source_paths.values()), paths)
                self.window.show_instant3d_workflow()
                dialog = self.window.instant3d_dialog
                name = "MRI" if modality == "MR" else "CT"
                self.assertEqual(dialog.modality, name)
                self.assertFalse(dialog.modality_selector.isEnabled())
                self.assertGreater(dialog.available.count(), 0)
                dialog.search.setText("Liver")
                dialog.available.setCurrentRow(0)
                dialog.object_id.setCurrentIndex(2)
                dialog._add_selected()
                self.assertEqual(len(dialog.mappings), 1)
                task = "total_mr" if modality == "MR" else "total"
                self.assertEqual(dialog.mappings[0]["task"], task)
                request = Path(self.temp.name) / f"{modality}-request.zip"
                with patch.object(app_module.QFileDialog, "getSaveFileName", return_value=(str(request), "")), \
                     patch.object(app_module.QMessageBox, "exec", return_value=0):
                    dialog._emit_export()
                with zipfile.ZipFile(request) as archive:
                    manifest = json.loads(archive.read("manifest.json"))
                self.assertEqual(manifest["source"]["modality"], name)
                dialog.close()
                labels = np.zeros((6, 5, 4), np.uint8)
                labels[4, 1, 2] = labels[1, 3, 0] = 3
                label_path = Path(self.temp.name) / "labels.nii.gz"
                nib.save(nib.Nifti1Image(labels, affine), label_path)
                manifest["status"] = "success"
                result = Path(self.temp.name) / f"{modality}-result.zip"
                with zipfile.ZipFile(result, "w") as archive:
                    archive.writestr("manifest.json", json.dumps(manifest))
                    archive.write(label_path, "labelmap/labels.nii.gz")
                with patch.object(app_module.QFileDialog, "getOpenFileName", return_value=(str(result), "")), \
                     patch.object(app_module.QMessageBox, "warning") as warning:
                    self.window.import_instant3dweb2_result()
                warning.assert_not_called()
                actual = np.stack([self.window.label_masks[key].T for key in self.window.image_paths], axis=2)
                np.testing.assert_array_equal(actual, labels)
                self.window.smart_undo()
                self.assertFalse(any(np.any(mask) for mask in self.window.label_masks.values()))

    def test_nifti_mri_selection_keeps_ct_default_and_clears_old_assignments(self):
        self.window._load_nifti_volume(str(self.source))
        self.window.show_instant3d_workflow()
        dialog = self.window.instant3d_dialog
        self.assertEqual(dialog.modality, "CT")
        dialog.available.setCurrentRow(0)
        dialog._add_selected()
        dialog.modality_selector.setCurrentText("MRI")
        self.assertEqual(dialog.mappings, [])
        self.assertEqual(dialog.available.count(), 50)
        self.assertEqual(self.window.source_nifti_fingerprint["modality"], "MRI")
        dialog.close()

    def test_dicom_without_patient_position_still_displays_and_explains_unavailability(self):
        import pydicom
        folder = Path(self.temp.name) / "missing-position"
        paths, _, _ = write_dicom_series(folder)
        for path in paths:
            ds = pydicom.dcmread(path)
            del ds.ImagePositionPatient
            ds.save_as(path)
        with patch.object(app_module.QFileDialog, "getExistingDirectory", return_value=str(folder)), \
             patch.object(app_module.QMessageBox, "warning"), patch.object(app_module.QMessageBox, "information"):
            self.window.load_image_folder()
        self.assertEqual(len(self.window.image_paths), 4)
        self.assertIsNone(self.window.source_nifti_path)
        self.assertIn("ImagePositionPatient", self.window.source_volume_error)
        self.window.show_instant3d_workflow()
        dialog = self.window.instant3d_dialog
        self.assertFalse(dialog.export_button.isEnabled())
        self.assertFalse(dialog.import_button.isEnabled())
        from PyQt6.QtWidgets import QLabel
        self.assertTrue(any("ImagePositionPatient" in label.text() for label in dialog.findChildren(QLabel)))
        dialog.close()


if __name__ == "__main__":
    unittest.main()
