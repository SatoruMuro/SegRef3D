from pathlib import Path
from types import SimpleNamespace
import json
import sys
import unittest

import nibabel as nib
import numpy as np


MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from volume_geometry import (  # noqa: E402
    VolumeGeometry,
    VolumeGeometryError,
    dicom_datasets_to_mapping,
    dicom_datasets_to_order,
    dicom_datasets_to_geometry,
    dicom_mapping_preview,
    nifti_image_with_geometry,
    reverse_axis_affine,
    upsample_geometry_along_k,
)


def dicom_slice(position, orientation, *, rows=320, columns=320, pixel_spacing=(0.6875, 0.6875)):
    return SimpleNamespace(
        Rows=rows,
        Columns=columns,
        PixelSpacing=pixel_spacing,
        ImageOrientationPatient=orientation,
        ImagePositionPatient=position,
        SpacingBetweenSlices=3.75,
        SliceThickness=3.75,
    )


class VolumeGeometryTests(unittest.TestCase):
    @staticmethod
    def _coronal_512_series():
        orientation = (1, 0, 0, 0, 0, 1)
        datasets = []
        names = []
        for canonical_z in range(512):
            dataset = dicom_slice(
                (18.0, 300.0 - canonical_z * 0.629, -42.0),
                orientation,
                rows=542,
                columns=512,
                pixel_spacing=(0.625, 0.625),
            )
            dataset.InstanceNumber = 512 - canonical_z
            dataset.SliceLocation = 300.0 - canonical_z * 0.629
            datasets.append(dataset)
            names.append(f"source{512 - canonical_z:04d}.dcm")
        return datasets, names

    def test_coronal_512_display_mapping_uses_iop_projection_not_filename_or_instance(self):
        canonical, canonical_names = self._coronal_512_series()
        datasets = list(reversed(canonical))
        names = list(reversed(canonical_names))

        order = dicom_datasets_to_order(datasets, source_names=names)
        mapping = dicom_datasets_to_mapping(datasets, source_names=names, order=order)

        for display_slice in (1, 50, 100, 400, 512):
            record = mapping[display_slice - 1]
            self.assertEqual(record["zIndex"], display_slice - 1)
            self.assertEqual(record["displaySlice"], display_slice)
            self.assertEqual(record["sourceFilename"], f"source{513 - display_slice:04d}.dcm")
            self.assertEqual(record["instanceNumber"], 513 - display_slice)
        np.testing.assert_allclose(mapping[0]["sliceNormal"], [0, -1, 0], atol=1e-12)
        self.assertLess(mapping[0]["projectedPosition"], mapping[-1]["projectedPosition"])
        self.assertEqual(len(dicom_mapping_preview(mapping)), 6)

        ordered = [datasets[index] for index in order]
        geometry, geometry_order = dicom_datasets_to_geometry(ordered)
        self.assertEqual(geometry_order, list(range(512)))
        # LPS Y decreases with K; LPS-to-RAS therefore gives the reported +0.629 RAS Y K axis.
        np.testing.assert_allclose(geometry.affine_ras[:3, 2], [0, 0.629, 0], atol=1e-10)

    def test_irregular_coronal_geometry_fallback_does_not_discard_projected_order(self):
        canonical, canonical_names = self._coronal_512_series()
        canonical[250].ImagePositionPatient = (18.0, 300.0 - 250 * 0.629 + 0.2, -42.0)
        datasets = list(reversed(canonical))
        names = list(reversed(canonical_names))

        order = dicom_datasets_to_order(datasets, source_names=names)
        ordered = [datasets[index] for index in order]
        with self.assertRaises(VolumeGeometryError):
            dicom_datasets_to_geometry(ordered)

        mapping = dicom_datasets_to_mapping(datasets, source_names=names, order=order)
        self.assertEqual(mapping[0]["sourceFilename"], "source0512.dcm")
        self.assertEqual(mapping[49]["sourceFilename"], "source0463.dcm")
        self.assertEqual(mapping[99]["sourceFilename"], "source0413.dcm")
        self.assertEqual(mapping[399]["sourceFilename"], "source0113.dcm")
        self.assertEqual(mapping[511]["sourceFilename"], "source0001.dcm")

    def test_quantized_512_coronal_ipp_uses_fitted_step_without_false_fallback(self):
        spacing = 0.62915234375
        orientation = (1, 0, 0, 0, 0, -1)
        slices = [
            dicom_slice(
                (-156.274, round(-326.248 + index * spacing, 3), 1995.97),
                orientation,
                rows=542,
                columns=512,
                pixel_spacing=(spacing, spacing),
            )
            for index in range(512)
        ]

        geometry, order = dicom_datasets_to_geometry(slices)

        self.assertEqual(order, list(range(512)))
        self.assertEqual(geometry.source_kind, "dicom")
        np.testing.assert_allclose(geometry.origin, [156.274, 326.248, 1995.97], atol=1e-12)
        np.testing.assert_allclose(geometry.affine_ras[:3, 2], [0, -spacing, 0], atol=2e-6)

    def test_shared_desktop_web_nifti_fixture_preserves_affine_and_labels(self):
        fixture_path = MODULE_DIR.parent / "test-data" / "volume_geometry_parity.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        width, height, depth = fixture["shape"]
        masks = np.asarray(fixture["labels"], dtype=np.uint8).reshape(depth, height, width)
        volume = np.stack([mask.T for mask in masks], axis=2)
        geometry = VolumeGeometry(tuple(fixture["shape"]), fixture["affine"], "desktop-web-parity")

        image = nifti_image_with_geometry(volume, geometry)

        np.testing.assert_allclose(image.affine, fixture["affine"], atol=1e-7)
        self.assertEqual(image.shape, tuple(fixture["shape"]))
        reopened_masks = np.stack([np.asarray(image.dataobj)[:, :, index].T for index in range(depth)])
        np.testing.assert_array_equal(reopened_masks.reshape(depth, -1), fixture["labels"])

    def test_axis_aligned_dicom_lps_is_converted_to_ras(self):
        slices = [
            dicom_slice((10, 20, 30 + index * 2), (1, 0, 0, 0, 1, 0), pixel_spacing=(0.5, 0.75))
            for index in range(3)
        ]
        geometry, order = dicom_datasets_to_geometry(slices)
        self.assertEqual(order, [0, 1, 2])
        np.testing.assert_allclose(
            geometry.affine_ras,
            [[-0.75, 0, 0, -10], [0, -0.5, 0, -20], [0, 0, 2, 30], [0, 0, 0, 1]],
            atol=1e-8,
        )

    def test_coronal_dicom_preserves_nonzero_origin_and_direction(self):
        orientation = (1, 0, 0, 0, 0, -1)
        slices = [
            dicom_slice((100.076588, 23.749557 + index * 3.75, 137.329995), orientation)
            for index in range(25)
        ]
        geometry, _ = dicom_datasets_to_geometry(slices)
        np.testing.assert_allclose(geometry.origin, [-100.076588, -23.749557, 137.329995], atol=1e-6)
        np.testing.assert_allclose(geometry.spacing, [0.6875, 0.6875, 3.75], atol=1e-8)
        np.testing.assert_allclose(
            geometry.direction,
            [[-1, 0, 0], [0, 0, -1], [0, -1, 0]],
            atol=1e-8,
        )

    def test_pelvic_mri_acceptance_geometry_matches_slicer_values(self):
        spacing = np.array([0.6875, 0.6875, 3.75])
        expected_origin_ras = np.array([100.076588, 23.749557, 137.329995])
        expected_direction_ras = np.array([
            [-0.9998, -0.0095, 0.0149],
            [-0.0153, 0.0501, -0.9986],
            [0.0087, -0.9987, -0.0502],
        ])
        i_direction_lps = expected_direction_ras[:, 0] * np.array([-1, -1, 1])
        j_direction_lps = expected_direction_ras[:, 1] * np.array([-1, -1, 1])
        slice_step_lps = expected_direction_ras[:, 2] * spacing[2] * np.array([-1, -1, 1])
        origin_lps = expected_origin_ras * np.array([-1, -1, 1])
        orientation = tuple(i_direction_lps) + tuple(j_direction_lps)
        slices = [
            dicom_slice(origin_lps + index * slice_step_lps, orientation)
            for index in range(25)
        ]

        geometry, order = dicom_datasets_to_geometry(slices)

        self.assertEqual(geometry.shape, (320, 320, 25))
        self.assertEqual(order, list(range(25)))
        np.testing.assert_allclose(geometry.spacing, spacing, atol=1e-3)
        np.testing.assert_allclose(geometry.origin, expected_origin_ras, atol=1e-3)
        np.testing.assert_allclose(geometry.direction, expected_direction_ras, atol=1e-3)

    def test_oblique_dicom_uses_actual_slice_step_vector(self):
        i_direction = np.array([0.8, 0.6, 0.0])
        j_direction = np.array([-0.3, 0.4, 0.866025403784])
        orientation = tuple(i_direction) + tuple(j_direction)
        origin = np.array([45.0, -22.0, 81.0])
        actual_step = np.array([0.25, -0.15, 2.4])
        slices = [dicom_slice(origin + index * actual_step, orientation) for index in range(5)]
        geometry, _ = dicom_datasets_to_geometry(slices)
        np.testing.assert_allclose(geometry.affine_ras[:3, 2], [-0.25, 0.15, 2.4], atol=1e-8)
        self.assertGreater(abs(float(geometry.affine_ras[0, 1])), 0.1)

    def test_nifti_round_trip_uses_exact_sform_and_disables_sheared_qform(self):
        affine = np.array([
            [-0.6875, -0.0065, 0.0559, 100.076588],
            [-0.0105, 0.0344, -3.7448, 23.749557],
            [0.0060, -0.6866, -0.1883, 137.329995],
            [0, 0, 0, 1],
        ])
        geometry = VolumeGeometry((8, 7, 5), affine, "synthetic-oblique")
        image = nifti_image_with_geometry(np.zeros(geometry.shape, dtype=np.uint8), geometry)
        np.testing.assert_allclose(image.affine, affine, atol=1e-7)
        np.testing.assert_allclose(image.get_sform(), affine, atol=1e-7)
        self.assertEqual(int(image.header["sform_code"]), 1)
        self.assertEqual(int(image.header["qform_code"]), 0)

    def test_reversed_voxels_keep_original_physical_coordinates(self):
        affine = np.array([
            [-0.7, 0.03, 0.2, 42],
            [0.01, 0.8, -0.1, -15],
            [0.02, -0.04, 2.5, 8],
            [0, 0, 0, 1],
        ])
        depth = 6
        reversed_affine = reverse_axis_affine(affine, 2, depth)
        for new_k in range(depth):
            original_k = depth - 1 - new_k
            expected = affine @ [3, 4, original_k, 1]
            actual = reversed_affine @ [3, 4, new_k, 1]
            np.testing.assert_allclose(actual, expected, atol=1e-10)

    def test_k_upsampling_preserves_oblique_physical_extent(self):
        spacing = np.array([0.6875, 0.6875, 3.75])
        direction = np.array([
            [-0.9998, -0.0095, 0.0149],
            [-0.0153, 0.0501, -0.9986],
            [0.0087, -0.9987, -0.0502],
        ])
        direction /= np.linalg.norm(direction, axis=0, keepdims=True)
        affine = np.eye(4)
        affine[:3, :3] = direction * spacing[np.newaxis, :]
        affine[:3, 3] = [100.076588, 23.749557, 137.329995]
        source = VolumeGeometry((320, 320, 25), affine, "pelvic-mri")

        five = upsample_geometry_along_k(source, 5)
        ten = upsample_geometry_along_k(source, 10)

        self.assertEqual(five.shape, (320, 320, 121))
        self.assertEqual(ten.shape, (320, 320, 241))
        np.testing.assert_allclose(five.spacing, [0.6875, 0.6875, 0.75], atol=1e-10)
        np.testing.assert_allclose(ten.spacing, [0.6875, 0.6875, 0.375], atol=1e-10)
        np.testing.assert_allclose(five.affine_ras[:3, :2], affine[:3, :2], atol=1e-12)
        np.testing.assert_allclose(ten.affine_ras[:3, :2], affine[:3, :2], atol=1e-12)
        for i, j, k in ((0, 0, 0), (17, 29, 12), (319, 319, 24)):
            expected = affine @ [i, j, k, 1]
            np.testing.assert_allclose(five.affine_ras @ [i, j, k * 5, 1], expected, atol=1e-10)
            np.testing.assert_allclose(ten.affine_ras @ [i, j, k * 10, 1], expected, atol=1e-10)


if __name__ == "__main__":
    unittest.main()
