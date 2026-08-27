import sys
import unittest
from pathlib import Path

import numpy as np


MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from mask_postprocessing import (  # noqa: E402
    apply_mask_volume_changes,
    build_mask_volume_changes,
    cleanup_label_mask,
    frame_indices_for_scope,
    interpolate_label_masks,
    interpolate_multilabel_volume,
    merge_label_binary,
)


class MaskCleanupTests(unittest.TestCase):
    def setUp(self):
        self.ring = np.array([
            [0, 0, 0, 0, 0],
            [0, 1, 1, 1, 0],
            [0, 1, 0, 1, 0],
            [0, 1, 1, 1, 0],
            [0, 0, 0, 0, 0],
        ], dtype=np.uint8)

    def test_fill_holes_preserves_outside(self):
        result = cleanup_label_mask(self.ring, 1, "fill-holes")
        self.assertEqual(result[2, 2], 1)
        self.assertEqual(result[0, 0], 0)

    def test_remove_small_islands_uses_inclusive_threshold(self):
        mask = np.zeros((5, 5), dtype=np.uint8)
        mask[0:2, 0:2] = 1
        mask[4, 4] = 1
        result = cleanup_label_mask(mask, 1, "remove-islands", minimum_size=4)
        self.assertEqual(np.count_nonzero(result == 1), 4)
        self.assertEqual(result[4, 4], 0)

    def test_keep_largest_component(self):
        mask = np.zeros((6, 6), dtype=np.uint8)
        mask[0:2, 0:2] = 1
        mask[5, 5] = 1
        result = cleanup_label_mask(mask, 1, "largest")
        self.assertEqual(np.count_nonzero(result == 1), 4)

    def test_smooth_boundary_remains_binary(self):
        result = cleanup_label_mask(self.ring, 1, "smooth", iterations=2)
        self.assertTrue(set(np.unique(result)).issubset({0, 1}))

    def test_dilate_and_erode_match_radius_one_disk(self):
        point = np.zeros((5, 5), dtype=np.uint8)
        point[2, 2] = 1
        dilated = cleanup_label_mask(point, 1, "dilate", radius=1)
        self.assertEqual(np.count_nonzero(dilated == 1), 5)
        eroded = cleanup_label_mask(self.ring, 1, "erode", radius=1)
        self.assertEqual(eroded[1, 1], 0)

    def test_other_labels_win_collisions(self):
        mask = np.zeros((5, 5), dtype=np.uint8)
        mask[2, 2] = 1
        mask[2, 3] = 2
        result = cleanup_label_mask(mask, 1, "dilate", radius=1)
        self.assertEqual(result[2, 3], 2)
        self.assertEqual(np.count_nonzero(result == 2), 1)

    def test_frame_scopes(self):
        self.assertEqual(frame_indices_for_scope("current", 2, 0, 0, 5), [2])
        self.assertEqual(frame_indices_for_scope("range", 0, 1, 3, 5), [1, 2, 3])
        self.assertEqual(frame_indices_for_scope("all", 0, 0, 0, 3), [0, 1, 2])
        with self.assertRaisesRegex(ValueError, "valid cleanup frame range"):
            frame_indices_for_scope("range", 0, 3, 1, 5)


class MaskInterpolationTests(unittest.TestCase):
    def test_multilabel_volume_upsampling_preserves_every_source_slice(self):
        source = np.zeros((3, 7, 7), dtype=np.uint8)
        source[0, 1:4, 1:4] = 1
        source[1, 2:5, 2:5] = 2
        source[2, 3:6, 3:6] = 3
        source_before = source.copy()

        for factor, expected_depth in ((5, 11), (10, 21)):
            output = interpolate_multilabel_volume(source, factor)
            self.assertEqual(output.shape, (expected_depth, 7, 7))
            np.testing.assert_array_equal(output[::factor], source)
            self.assertTrue({1, 2, 3}.issubset(set(np.unique(output))))
            self.assertTrue(set(np.unique(output)).issubset({0, 1, 2, 3}))

        np.testing.assert_array_equal(source, source_before)

    def test_multilabel_factor_one_is_an_unchanged_copy(self):
        source = np.array([[[0, 1], [2, 3]]], dtype=np.uint8)
        output = interpolate_multilabel_volume(source, 1)
        np.testing.assert_array_equal(output, source)
        self.assertIsNot(output, source)

    def test_interpolation_preserves_endpoints_and_other_labels(self):
        start = np.zeros((5, 5), dtype=np.uint8)
        end = np.zeros((5, 5), dtype=np.uint8)
        start[1:3, 1:3] = 1
        end[1:3, 2:4] = 1
        start_before = start.copy()
        end_before = end.copy()
        generated = interpolate_label_masks(start, end, 1, 3)
        self.assertEqual(len(generated), 3)
        self.assertTrue(all(np.any(mask) for mask in generated))
        np.testing.assert_array_equal(start, start_before)
        np.testing.assert_array_equal(end, end_before)

        target = np.zeros((5, 5), dtype=np.uint8)
        target[1, 2] = 2
        merged = merge_label_binary(target, generated[0], 1)
        self.assertEqual(merged[1, 2], 2)

    def test_interpolation_requires_endpoint_masks(self):
        empty = np.zeros((5, 5), dtype=np.uint8)
        end = empty.copy()
        end[2, 2] = 1
        with self.assertRaisesRegex(ValueError, "start frame"):
            interpolate_label_masks(empty, end, 1, 1)

    def test_bulk_change_is_one_reversible_transaction(self):
        before = {
            "0001": np.array([[1, 0]], dtype=np.uint8),
            "0002": np.array([[0, 0]], dtype=np.uint8),
            "0003": np.array([[2, 0]], dtype=np.uint8),
        }
        after = {key: mask.copy() for key, mask in before.items()}
        after["0001"][0, 1] = 1
        after["0003"][0, 0] = 0
        changes = build_mask_volume_changes(before, after)
        self.assertEqual(set(changes), {"0001", "0003"})
        undone = apply_mask_volume_changes(after, changes, "before")
        redone = apply_mask_volume_changes(before, changes, "after")
        for key in before:
            np.testing.assert_array_equal(undone[key], before[key])
            np.testing.assert_array_equal(redone[key], after[key])


if __name__ == "__main__":
    unittest.main()
