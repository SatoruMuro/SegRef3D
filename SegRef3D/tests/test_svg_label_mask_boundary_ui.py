import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from xml.etree import ElementTree as ET

import cv2
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


class SvgLabelMaskBoundaryUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous_cwd = os.getcwd()
        os.chdir(self.temp.name)
        self.window = app_module.SegRefMain()
        self.window.source_dataset_name = "SVG Boundary Study"
        self.window.image_paths = {}
        self.window.image_sizes = {}
        self.window.label_masks = {}
        self.window.label_mask_paths = {}
        for index in range(2):
            key = f"{index + 1:04d}"
            image_path = Path(self.temp.name) / f"image{key}.png"
            Image.new("L", (64, 48), 100).save(image_path)
            self.window.image_paths[key] = str(image_path)
            self.window.image_sizes[key] = (64, 48)
            self.window.label_masks[key] = np.zeros((48, 64), dtype=np.uint8)
        self.window.reset_autosave_label_dir()

    def tearDown(self):
        self.window.deleteLater()
        self.app.processEvents()
        os.chdir(self.previous_cwd)
        self.temp.cleanup()

    def test_mask_ui_names_make_png_and_svg_roles_explicit(self):
        self.assertEqual(self.window.btn_load_masks.text(), "Load Masks (PNG / SVG)")
        self.assertEqual(self.window.btn_save_masks.text(), "Save Label PNG Masks")
        self.assertEqual(self.window.btn_export_svg_masks.text(), "Export SVG Masks")

    def test_save_masks_writes_only_label_png_and_manifest(self):
        self.window.label_masks["0001"][5:12, 8:18] = 1
        destination = Path(self.temp.name) / "save"
        output, count = self.window.save_masks_to_folder(
            str(destination), "20260902_120000"
        )
        output = Path(output)

        self.assertEqual(count, 2)
        self.assertEqual(
            sorted(path.name for path in output.glob("*.png")),
            ["mask0001.png", "mask0002.png"],
        )
        self.assertEqual(list(output.glob("*.svg")), [])
        manifest_path = output / app_module.MASK_MANIFEST_FILENAME
        self.assertTrue(manifest_path.exists())
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["sliceCount"], 2)

    def test_colored_svg_import_becomes_label_mask_and_png(self):
        color1 = "#{:02x}{:02x}{:02x}".format(*self.window.color_labels[0])
        color2 = "#{:02x}{:02x}{:02x}".format(*self.window.color_labels[1])
        svg_path = Path(self.temp.name) / "legacy-mask0001.svg"
        svg_path.write_text(
            f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48">
  <rect x="4" y="5" width="18" height="12" fill="{color1}"/>
  <circle cx="42" cy="25" r="8" style="fill:{color2}"/>
</svg>''',
            encoding="utf-8",
        )

        self.window.load_svg_as_label_mask("0001", str(svg_path))

        mask = self.window.label_masks["0001"]
        self.assertEqual(int(mask[8, 8]), 1)
        self.assertEqual(int(mask[25, 42]), 2)
        self.assertTrue(Path(self.window.get_label_png_path("0001")).exists())
        self.assertFalse(hasattr(self.window, "mask_paths"))

    def test_svg_export_round_trip_preserves_objects_hole_and_empty_slice(self):
        source = self.window.label_masks["0001"]
        source[5:30, 6:32] = 1
        source[12:20, 14:24] = 0
        cv2.circle(source, (48, 29), 9, 2, thickness=-1)
        expected = source.copy()

        destination = Path(self.temp.name) / "svg-export"
        output, count = self.window.export_svg_masks_to_folder(
            str(destination), "20260902_120100"
        )
        output = Path(output)
        self.assertEqual(count, 2)
        self.assertEqual(
            sorted(path.name for path in output.glob("*.svg")),
            ["mask0001.svg", "mask0002.svg"],
        )

        root = ET.parse(output / "mask0001.svg").getroot()
        self.assertEqual(root.attrib["width"], "64")
        self.assertEqual(root.attrib["height"], "48")
        self.assertEqual(root.attrib["viewBox"], "0 0 64 48")
        fills = {element.attrib.get("fill") for element in root.iter()}
        self.assertIn(
            "#{:02x}{:02x}{:02x}".format(*self.window.color_labels[0]), fills
        )
        self.assertIn(
            "#{:02x}{:02x}{:02x}".format(*self.window.color_labels[1]), fills
        )
        empty_root = ET.parse(output / "mask0002.svg").getroot()
        self.assertFalse(any(element.tag.endswith("path") for element in empty_root.iter()))

        self.window.label_masks["0001"][:] = 0
        self.window.load_svg_as_label_mask("0001", str(output / "mask0001.svg"))
        restored = self.window.label_masks["0001"]
        for obj_id in (1, 2):
            expected_object = expected == obj_id
            restored_object = restored == obj_id
            intersection = np.count_nonzero(expected_object & restored_object)
            union = np.count_nonzero(expected_object | restored_object)
            self.assertGreater(intersection / union, 0.85)
        self.assertEqual(int(restored[15, 18]), 0)

    def test_loading_nifti_does_not_generate_empty_svgs(self):
        self.window.label_masks.clear()
        volume_path = Path(self.temp.name) / "volume.nii.gz"
        nib.save(
            nib.Nifti1Image(
                np.arange(8 * 6 * 2, dtype=np.float32).reshape((8, 6, 2)),
                np.eye(4),
            ),
            volume_path,
        )

        self.assertTrue(self.window._load_nifti_volume(str(volume_path)))
        self.assertEqual(list(Path(self.temp.name).rglob("*.svg")), [])
        self.assertFalse(hasattr(self.window, "mask_paths"))


if __name__ == "__main__":
    unittest.main()
