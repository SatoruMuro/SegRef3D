import os
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import nibabel as nib
import numpy as np
from PIL import Image


os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("SEGREF3D_DISABLE_SAM2", "1")
MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from PyQt6.QtWidgets import QApplication  # noqa: E402
import SegRef3D as app_module  # noqa: E402
from volume_geometry import VolumeGeometry  # noqa: E402


class VolumeGeometryUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = os.getcwd()
        os.chdir(self.temp.name)
        self.window = app_module.SegRefMain()
        self.affine = np.array([
            [-0.7, 0.02, 0.12, 41.5],
            [-0.01, 0.8, -0.08, -13.25],
            [0.03, -0.04, 2.2, 7.75],
            [0, 0, 0, 1],
        ])
        self.window.image_paths = {}
        self.window.image_sizes = {}
        self.window.label_masks = {}
        for index in range(3):
            key = f"{index + 1:04d}"
            path = Path(self.temp.name) / f"image{key}.png"
            Image.new("L", (6, 5), 100).save(path)
            self.window.image_paths[key] = str(path)
            self.window.image_sizes[key] = (6, 5)
            mask = np.zeros((5, 6), dtype=np.uint8)
            mask[1, index + 1] = index + 1
            self.window.label_masks[key] = mask
        self.window.original_image_filenames = {
            "0001": "Patient 01.nii.gz#slice=1",
            "0002": "Patient 01.nii.gz#slice=2",
            "0003": "Patient 01.nii.gz#slice=3",
        }
        self.window.source_dataset_name = "Study Folder.v1"
        self.window._set_volume_geometry(VolumeGeometry((6, 5, 3), self.affine, "dicom"))

    def tearDown(self):
        self.window.deleteLater()
        self.app.processEvents()
        os.chdir(self.previous)
        self.temp.cleanup()

    def test_desktop_export_uses_canonical_source_affine(self):
        self.window.export_nifti_labelmap()
        output = next(Path(self.temp.name).glob(
            "Study Folder.v1_nifti_output_*/Study Folder.v1_segref3d_labelmap.nii.gz"
        ))
        image = nib.load(output)
        np.testing.assert_allclose(image.affine, self.affine, atol=1e-5)
        self.assertEqual(image.shape, (6, 5, 3))
        self.assertIn("source image geometry", self.window.label_status.text())

    def test_output_names_use_the_loaded_folder_name(self):
        self.assertEqual(self.window.output_file_stem(), "Study Folder.v1")
        self.assertEqual(
            self.window._safe_output_dataset_name('bad:name?.folder'),
            "bad_name_.folder",
        )
        self.window.reset_autosave_label_dir()
        self.assertTrue(Path(self.window.output_label_dir).name.startswith(
            "Study Folder.v1_label_png_[autosave]_"
        ))
        self.assertEqual(Path(self.window.get_label_png_path("0001")).name, "mask0001.png")

        preview = type("Preview", (), {
            "color_labels": [(255, 0, 0), (0, 255, 0), (0, 0, 255)]
        })()
        self.assertEqual(
            app_module.STLPreviewDialog._color_for_path(
                preview, "image0001_object_03.stl"
            ),
            (0.0, 0.0, 1.0),
        )

    def test_save_masks_exports_only_labels_directly_to_dataset_folder(self):
        destination = Path(self.temp.name) / "exports"
        destination.mkdir()
        with patch.object(
            app_module.QFileDialog,
            "getExistingDirectory",
            return_value=str(destination),
        ):
            self.window.save_svg_as()

        label_folder = next(destination.glob("Study Folder.v1_label_png_*"))
        self.assertEqual(
            sorted(path.name for path in label_folder.glob("*.png")),
            ["mask0001.png", "mask0002.png", "mask0003.png"],
        )
        self.assertFalse((label_folder / "label_png").exists())
        self.assertFalse((label_folder / "preview_png").exists())
        self.assertEqual(list(label_folder.glob("preview_mask*.png")), [])
        self.assertIn(str(label_folder), self.window.label_status.text())

    def _set_synthetic_masks(self, masks):
        source = Path(self.temp.name) / "synthetic-source.png"
        height, width = masks[0].shape
        Image.new("L", (width, height), 100).save(source)
        self.window.image_paths = {}
        self.window.image_sizes = {}
        self.window.label_masks = {}
        self.window.original_image_filenames = {}
        for z_index, mask in enumerate(masks):
            key = f"{z_index + 1:04d}"
            self.window.image_paths[key] = str(source)
            self.window.image_sizes[key] = (width, height)
            self.window.label_masks[key] = mask.copy()
            self.window.original_image_filenames[key] = f"synthetic#slice={z_index + 1}"

    def _save_masks_to(self, destination):
        destination.mkdir(exist_ok=True)
        with patch.object(
            app_module.QFileDialog,
            "getExistingDirectory",
            return_value=str(destination),
        ):
            self.window.save_svg_as()
        return next(destination.glob("Study Folder.v1_label_png_*"))

    def test_save_masks_five_slice_png_content_is_canonical(self):
        points = [(0, 0), (4, 0), (2, 2), (0, 4), (4, 4)]
        masks = []
        for z_index, (x, y) in enumerate(points):
            mask = np.zeros((5, 5), dtype=np.uint8)
            mask[y, x] = z_index + 1
            masks.append(mask)
        self._set_synthetic_masks(masks)
        label_folder = self._save_masks_to(Path(self.temp.name) / "canonical-five")

        for z_index, expected in enumerate(masks):
            actual = np.asarray(Image.open(label_folder / f"mask{z_index + 1:04d}.png"))
            np.testing.assert_array_equal(actual, expected)
        manifest = json.loads((label_folder / "segref3d-mask-manifest.json").read_text("utf-8"))
        self.assertEqual(manifest["sliceOrder"], "segref3d-canonical-v1")
        self.assertEqual(manifest["sliceCount"], 5)
        self.assertEqual(
            [item["zIndex"] for item in manifest["files"]],
            [0, 1, 2, 3, 4],
        )

    def test_save_masks_edge_and_distant_slices_do_not_reverse(self):
        masks = [np.zeros((3, 3), dtype=np.uint8) for _ in range(401)]
        masks[0][0, 0] = 1
        masks[10][0, 1] = 2
        masks[400][2, 2] = 3
        self._set_synthetic_masks(masks)
        label_folder = self._save_masks_to(Path(self.temp.name) / "canonical-edges")

        first = np.asarray(Image.open(label_folder / "mask0001.png"))
        second = np.asarray(Image.open(label_folder / "mask0002.png"))
        eleven = np.asarray(Image.open(label_folder / "mask0011.png"))
        last = np.asarray(Image.open(label_folder / "mask0401.png"))
        self.assertEqual(first[0, 0], 1)
        self.assertFalse(np.any(second))
        self.assertEqual(eleven[0, 1], 2)
        self.assertEqual(last[2, 2], 3)

    def test_save_then_load_masks_is_voxel_identical_without_load_reversal(self):
        masks = []
        for z_index in range(5):
            mask = np.zeros((4, 5), dtype=np.uint8)
            mask[z_index % 4, z_index] = z_index + 1
            masks.append(mask)
        self._set_synthetic_masks(masks)
        label_folder = self._save_masks_to(Path(self.temp.name) / "roundtrip")
        self.window.label_masks = {
            f"{z_index + 1:04d}": np.zeros_like(mask)
            for z_index, mask in enumerate(masks)
        }

        with patch.object(
            app_module.QFileDialog,
            "getExistingDirectory",
            return_value=str(label_folder),
        ):
            self.window.load_mask_folder()
        for z_index, expected in enumerate(masks):
            np.testing.assert_array_equal(
                self.window.label_masks[f"{z_index + 1:04d}"],
                expected,
            )

    def test_autosave_filename_uses_canonical_display_index(self):
        first = np.zeros((3, 3), dtype=np.uint8)
        last = np.zeros((3, 3), dtype=np.uint8)
        first[0, 0] = 4
        last[2, 2] = 8
        self._set_synthetic_masks([first, np.zeros((3, 3), dtype=np.uint8), last])
        self.window.reset_autosave_label_dir()
        self.window.save_label_mask_png("0001")
        self.window.save_label_mask_png("0003")

        autosave = Path(self.window.output_label_dir)
        self.assertEqual(sorted(path.name for path in autosave.glob("*.png")), [
            "mask0001.png",
            "mask0003.png",
        ])
        np.testing.assert_array_equal(np.asarray(Image.open(autosave / "mask0001.png")), first)
        np.testing.assert_array_equal(np.asarray(Image.open(autosave / "mask0003.png")), last)

    def test_save_uses_canonical_loader_order_even_if_internal_keys_are_not_lexical(self):
        source = Path(self.temp.name) / "nonlexical-source.png"
        Image.new("L", (2, 2), 100).save(source)
        first = np.array([[1, 0], [0, 0]], dtype=np.uint8)
        second = np.array([[0, 0], [0, 2]], dtype=np.uint8)
        self.window.image_paths = {"0099": str(source), "0001": str(source)}
        self.window.image_sizes = {"0099": (2, 2), "0001": (2, 2)}
        self.window.label_masks = {"0099": first, "0001": second}
        label_folder = self._save_masks_to(Path(self.temp.name) / "display-order")

        np.testing.assert_array_equal(np.asarray(Image.open(label_folder / "mask0001.png")), first)
        np.testing.assert_array_equal(np.asarray(Image.open(label_folder / "mask0002.png")), second)

    def test_desktop_5x_export_preserves_key_slices_and_updates_affine(self):
        self.window.export_nifti_labelmap(5)
        output = next(Path(self.temp.name).glob(
            "Study Folder.v1_nifti_output_*/Study Folder.v1_segref3d_labelmap_5x.nii.gz"
        ))
        image = nib.load(output)
        data = np.asarray(image.dataobj)
        self.assertEqual(image.shape, (6, 5, 11))
        np.testing.assert_allclose(image.affine[:3, 2], self.affine[:3, 2] / 5, atol=1e-5)
        for source_k in range(3):
            expected = self.window.label_masks[f"{source_k + 1:04d}"].T
            np.testing.assert_array_equal(data[:, :, source_k * 5], expected)
            np.testing.assert_allclose(
                image.affine @ [2, 1, source_k * 5, 1],
                self.affine @ [2, 1, source_k, 1],
                atol=1e-5,
            )


    def test_reversed_export_preserves_physical_label_location(self):
        self.window.export_nifti_labelmap_reversed()
        output = next(Path(self.temp.name).glob(
            "Study Folder.v1_nifti_output_*/Study Folder.v1_segref3d_labelmap_revZ.nii.gz"
        ))
        image = nib.load(output)
        data = np.asarray(image.dataobj)
        for new_k in range(3):
            old_k = 2 - new_k
            old_label = int(self.window.label_masks[f"{old_k + 1:04d}"][1, old_k + 1])
            self.assertEqual(int(data[old_k + 1, 1, new_k]), old_label)
            np.testing.assert_allclose(
                image.affine @ [old_k + 1, 1, new_k, 1],
                self.affine @ [old_k + 1, 1, old_k, 1],
                atol=1e-5,
            )

    def test_calibration_updates_spacing_without_losing_direction_or_origin(self):
        original_direction = self.window.volume_geometry.direction.copy()
        original_origin = self.window.volume_geometry.origin
        output_mask_dir = Path(self.temp.name) / "masks"
        output_mask_dir.mkdir()
        self.window.output_mask_dir = str(output_mask_dir)
        self.window.mm_per_px = 0.5
        self.window.z_spacing_mm = 1.5

        self.window.save_calibration_to_csv()

        np.testing.assert_allclose(self.window.volume_geometry.spacing, [0.5, 0.5, 1.5], atol=1e-10)
        np.testing.assert_allclose(self.window.volume_geometry.direction, original_direction, atol=1e-10)
        np.testing.assert_allclose(self.window.volume_geometry.origin, original_origin, atol=1e-10)
        csv_path = next(Path(self.temp.name).glob("*_volinf.csv"))
        csv_text = csv_path.read_text(encoding="utf-8")
        self.assertIn("IJK to RAS Row 1", csv_text)
        self.assertIn("Geometry Source", csv_text)


if __name__ == "__main__":
    unittest.main()
