import json
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
from sam2_interface import SAM2Interface  # noqa: E402


class SessionStorageUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous_cwd = os.getcwd()
        os.chdir(self.temp.name)
        self.window = app_module.SegRefMain()
        self.source_image = Path(self.temp.name) / "source.png"
        Image.new("L", (5, 4), 100).save(self.source_image)

    def tearDown(self):
        self.window.deleteLater()
        self.app.processEvents()
        os.chdir(self.previous_cwd)
        self.temp.cleanup()

    def _set_dataset(self, name, identity, value):
        self.window.source_dataset_name = name
        self.window.image_paths = {"0001": str(self.source_image)}
        self.window.image_sizes = {"0001": (5, 4)}
        self.window.original_image_filenames = {"0001": "source.png"}
        self.window.label_masks = {
            "0001": np.full((4, 5), value, dtype=np.uint8)
        }
        self.window.reset_autosave_label_dir(str(identity))

    def test_one_session_root_and_one_reused_autosave_folder(self):
        session_root = Path(self.window.session_root_dir)
        self.assertTrue(session_root.is_dir())
        self.assertRegex(
            session_root.name,
            r"^SegRef3D-session_\d{8}_\d{6}(?:_\d{2})?$",
        )
        self.assertEqual(
            list(Path(self.temp.name).glob("SegRef3D-session_*")),
            [session_root],
        )
        info = json.loads((session_root / "session_info.json").read_text("utf-8"))
        self.assertEqual(info["sessionName"], session_root.name)

        identity = Path(self.temp.name) / "DatasetA"
        self._set_dataset("DatasetA", identity, 1)
        autosave = Path(self.window.output_label_dir)
        self.window.save_label_mask_png("0001")
        self.window.label_masks["0001"].fill(2)
        self.window.save_label_mask_png("0001")
        self.window.reset_autosave_label_dir(str(identity))

        self.assertEqual(Path(self.window.output_label_dir), autosave)
        self.assertEqual(
            list(session_root.rglob("autosave_label_png")),
            [autosave],
        )
        self.assertEqual(
            sorted(path.name for path in autosave.glob("mask*.png")),
            ["mask0001.png"],
        )
        self.assertTrue((autosave / app_module.MASK_MANIFEST_FILENAME).exists())
        self.assertTrue(np.all(np.asarray(Image.open(autosave / "mask0001.png")) == 2))

    def test_new_application_instance_gets_a_different_session_root(self):
        first_root = Path(self.window.session_root_dir)
        second = app_module.SegRefMain()
        try:
            second_root = Path(second.session_root_dir)
            self.assertNotEqual(first_root, second_root)
            self.assertTrue(second_root.is_dir())
            self.assertRegex(
                second_root.name,
                r"^SegRef3D-session_\d{8}_\d{6}(?:_\d{2})?$",
            )
            self.assertEqual(
                len(list(Path(self.temp.name).glob("SegRef3D-session_*"))),
                2,
            )
        finally:
            second.deleteLater()
            self.app.processEvents()

    def test_datasets_with_the_same_name_do_not_collide(self):
        identity_a = Path(self.temp.name) / "source-a" / "Dataset"
        identity_b = Path(self.temp.name) / "source-b" / "Dataset"

        self._set_dataset("Dataset", identity_a, 3)
        first_autosave = Path(self.window.output_label_dir)
        self.window.save_label_mask_png("0001")

        self._set_dataset("Dataset", identity_b, 7)
        second_autosave = Path(self.window.output_label_dir)
        self.window.save_label_mask_png("0001")

        self.assertNotEqual(first_autosave, second_autosave)
        self.assertEqual(first_autosave.parent.name, "Dataset")
        self.assertEqual(second_autosave.parent.name, "Dataset_02")
        self.assertTrue(np.all(np.asarray(Image.open(first_autosave / "mask0001.png")) == 3))
        self.assertTrue(np.all(np.asarray(Image.open(second_autosave / "mask0001.png")) == 7))

        self.window.reset_autosave_label_dir(str(identity_a))
        self.assertEqual(Path(self.window.output_label_dir), first_autosave)

    def test_image_loader_activates_separate_storage_for_each_dataset(self):
        first_source = Path(self.temp.name) / "source-a" / "Dataset"
        second_source = Path(self.temp.name) / "source-b" / "Dataset"
        for source, value in ((first_source, 80), (second_source, 120)):
            source.mkdir(parents=True)
            Image.new("L", (5, 4), value).save(source / "image0001.jpg")

        with patch.object(
            app_module.QFileDialog,
            "getExistingDirectory",
            side_effect=[str(first_source), str(second_source)],
        ):
            self.window.load_image_folder()
            first_autosave = Path(self.window.output_label_dir)
            self.window.ensure_label_mask_exists("0001")

            self.window.load_image_folder()
            second_autosave = Path(self.window.output_label_dir)
            self.window.ensure_label_mask_exists("0001")

        self.assertNotEqual(first_autosave, second_autosave)
        self.assertTrue((first_autosave / "mask0001.png").exists())
        self.assertTrue((second_autosave / "mask0001.png").exists())
        self.assertEqual(
            len(list(Path(self.window.session_root_dir).rglob("autosave_label_png"))),
            2,
        )

    def test_explicit_mask_exports_stay_outside_session_root(self):
        self._set_dataset("DatasetA", Path(self.temp.name) / "DatasetA", 1)
        destination = Path(self.temp.name) / "explicit-exports"

        png_folder, _ = self.window.save_masks_to_folder(
            str(destination), "20260902_120000"
        )
        svg_folder, _ = self.window.export_svg_masks_to_folder(
            str(destination), "20260902_120001"
        )

        session_root = Path(self.window.session_root_dir)
        self.assertNotIn(session_root, Path(png_folder).parents)
        self.assertNotIn(session_root, Path(svg_folder).parents)
        self.assertIn(destination, Path(png_folder).parents)
        self.assertIn(destination, Path(svg_folder).parents)

    def test_explicit_stl_export_stays_outside_session_root(self):
        self._set_dataset("DatasetA", Path(self.temp.name) / "DatasetA", 1)

        class FakeMesh:
            @staticmethod
            def export(path, file_type=None):
                Path(path).write_bytes(b"solid test\nendsolid test\n")

        mesh_item = type("MeshItem", (), {
            "mesh": FakeMesh(),
            "filename": "DatasetA_object_01_1x.stl",
            "factor": 1,
        })()
        with patch.object(
            self.window, "_prepare_stl_meshes", return_value=[mesh_item]
        ):
            self.window.export_colorwise_stl_with_scale()

        output_dir = next(Path(self.temp.name).glob("DatasetA_stl_output_*"))
        self.assertNotIn(Path(self.window.session_root_dir), output_dir.parents)
        self.assertEqual(
            sorted(path.name for path in output_dir.glob("*.stl")),
            ["DatasetA_object_01_1x.stl"],
        )

    def test_sam2_single_segmentation_temp_is_session_scoped_and_cleaned(self):
        self._set_dataset("DatasetA", Path(self.temp.name) / "DatasetA", 0)
        temp_root = self.window._session_dataset_path("temp", "sam2")
        seen_video_paths = []

        class FakeTensor:
            def __gt__(self, _value):
                return self

            def cpu(self):
                return self

            @staticmethod
            def numpy():
                return np.ones((1, 4, 5), dtype=np.uint8)

        class FakePredictor:
            @staticmethod
            def init_state(video_path):
                video_path = Path(video_path)
                seen_video_paths.append(video_path)
                if not (video_path / "0.jpg").exists():
                    raise AssertionError("SAM2 temporary frame was not created")
                return object()

            @staticmethod
            def add_new_points_or_box(**_kwargs):
                return None, None, [FakeTensor()]

        interface = object.__new__(SAM2Interface)
        interface.predictor = FakePredictor()
        interface.ensure_available = lambda: None
        progress = []
        result = interface.run_segmentation(
            np.zeros((4, 5), dtype=np.uint8),
            ((0, 0), (4, 3)),
            progress_callback=progress.append,
            temp_root=str(temp_root),
        )

        self.assertEqual(progress, [0, 25, 50, 75, 100])
        self.assertEqual(result.shape, (4, 5))
        self.assertEqual(seen_video_paths[0].parent, temp_root)
        self.assertEqual(list(temp_root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
