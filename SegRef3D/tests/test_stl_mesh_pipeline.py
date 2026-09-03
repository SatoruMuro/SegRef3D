import ast
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import trimesh


MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from stl_mesh_pipeline import (  # noqa: E402
    build_stl_meshes,
    export_stl_meshes,
    interpolate_label_volume,
)


class StlSliceInterpolationTests(unittest.TestCase):
    @staticmethod
    def _source_volume():
        volume = np.zeros((3, 9, 10), dtype=np.uint8)
        volume[0, 2:6, 1:5] = 1
        volume[1, 2:7, 2:7] = 1
        volume[2, 3:8, 4:9] = 1
        return volume

    def test_signed_distance_interpolation_preserves_source_slices_and_input(self):
        source = self._source_volume()
        before = source.copy()
        for factor in (5, 10):
            output = interpolate_label_volume(source, 1, factor)
            self.assertEqual(output.shape[0], (source.shape[0] - 1) * factor + 1)
            np.testing.assert_array_equal(output[::factor], source == 1)
            self.assertTrue(np.any(output[1:-1]))
        np.testing.assert_array_equal(source, before)

    def test_1x_5x_10x_keep_identical_slice_centre_z_extent(self):
        source = self._source_volume()
        spacing = (0.6, 0.9, 2.0)
        expected_extent = (source.shape[0] - 1) * spacing[2]
        for factor in (1, 5, 10):
            result = build_stl_meshes(source, [1], factor, spacing)[0]
            self.assertAlmostEqual(result.source_z_extent_mm, expected_extent, places=10)
            self.assertAlmostEqual(result.interpolated_z_extent_mm, expected_extent, places=10)
            self.assertAlmostEqual(result.mesh_pitch_zyx[0], spacing[2] / factor, places=10)

    def test_single_slice_does_not_shrink_z_pitch(self):
        source = np.zeros((1, 7, 7), dtype=np.uint8)
        source[0, 2:5, 2:5] = 1
        for factor in (5, 10):
            result = build_stl_meshes(source, [1], factor, (0.6, 0.9, 2.0))[0]
            self.assertEqual(result.interpolated_depth, 1)
            self.assertAlmostEqual(result.mesh_pitch_zyx[0], 2.0, places=10)

    def test_exported_stl_matches_the_in_memory_preview_geometry(self):
        result = build_stl_meshes(
            self._source_volume(), [1], 5, (0.6, 0.9, 2.0), output_stem="synthetic"
        )[0]
        preview_face_count = len(result.mesh.faces)
        preview_bounds = result.mesh.bounds.copy()
        with tempfile.TemporaryDirectory() as directory:
            path = export_stl_meshes([result], directory)[0]
            exported = trimesh.load_mesh(path, process=False)
        self.assertEqual(len(exported.faces), preview_face_count)
        np.testing.assert_allclose(exported.bounds, preview_bounds, atol=1e-6)

    def test_preview_and_export_call_the_same_preparation_method(self):
        source_path = MODULE_DIR / "SegRef3D.py"
        module = ast.parse(source_path.read_text(encoding="utf-8"))
        main_class = next(
            node for node in module.body
            if isinstance(node, ast.ClassDef) and node.name == "SegRefMain"
        )
        methods = {
            node.name: node for node in main_class.body if isinstance(node, ast.FunctionDef)
        }
        for name in ("preview_stl_with_scale", "export_colorwise_stl_with_scale"):
            calls = [
                node.func.attr
                for node in ast.walk(methods[name])
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            ]
            self.assertIn("_prepare_stl_meshes", calls)
        prepare_calls = [
            node.func.attr
            for node in ast.walk(methods["_prepare_stl_meshes"])
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        ]
        self.assertIn("_build_stl_meshes_from_controls", prepare_calls)


if __name__ == "__main__":
    unittest.main()
