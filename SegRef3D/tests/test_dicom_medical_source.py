import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import nibabel as nib
import numpy as np
import pydicom

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "SegRef3D"), str(ROOT / "ColabNotebooks")]
from medical_source import dicom_source_to_nifti
from volume_geometry import dicom_files_to_order
from volume_geometry import VolumeGeometry
from instant3d_bridge import create_request_zip, validate_result_zip, labelmap_from_bytes, Instant3DBridgeError
import instant3dweb2_backend as backend
from medical_source_fixtures import write_dicom_series, ORIENTATIONS


class DicomMedicalSourceTests(unittest.TestCase):
    def test_already_decoded_scalar_fallback_is_not_scaled_twice(self):
        with tempfile.TemporaryDirectory() as folder:
            paths, values, affine = write_dicom_series(Path(folder) / "dicom")
            geometry = VolumeGeometry(values.shape, affine, "dicom-simpleitk")
            source, _ = dicom_source_to_nifti(paths, Path(folder) / "source.nii",
                                            scalar_volume=values, scalar_geometry=geometry)
            np.testing.assert_array_equal(np.asarray(nib.load(source).dataobj), values)
            shifted = affine.copy()
            shifted[0, 3] += 1
            with self.assertRaisesRegex(ValueError, "does not match patient metadata"):
                dicom_source_to_nifti(paths, Path(folder) / "bad.nii", scalar_volume=values,
                                     scalar_geometry=VolumeGeometry(values.shape, shifted, "dicom-simpleitk"))

    def test_ct_and_mri_geometry_intensities_and_round_trip(self):
        for modality in ("CT", "MR"):
            for orientation in ORIENTATIONS:
                with self.subTest(modality=modality, orientation=orientation), tempfile.TemporaryDirectory() as folder:
                    root = Path(folder)
                    paths, expected, affine = write_dicom_series(root / "dicom", modality, orientation)
                    ordered = dicom_files_to_order(list(reversed(paths)))
                    self.assertEqual(ordered, paths)
                    source, fingerprint = dicom_source_to_nifti(ordered, root / "source.nii")
                    image = nib.load(source)
                    np.testing.assert_array_equal(np.asarray(image.dataobj), expected)
                    np.testing.assert_allclose(image.affine, affine, atol=1e-5)
                    np.testing.assert_allclose(image.header.get_zooms(), np.linalg.norm(affine[:3, :3], axis=0), atol=1e-6)
                    self.assertEqual(image.shape, (6, 5, 4))
                    self.assertEqual(int(image.header['qform_code']), 0)  # shear must not be approximated
                    name = "MRI" if modality == "MR" else "CT"
                    self.assertEqual(fingerprint["modality"], name)
                    _, again = dicom_source_to_nifti(ordered, root / "reopened.nii")
                    self.assertEqual(fingerprint["sha256"], again["sha256"])
                    task = "total_mr" if modality == "MR" else "total"
                    objects = [dict(object_id=3, task=task, roi="liver")]
                    request = root / "request.zip"
                    create_request_zip(request, source, objects, modality=name)
                    labels = np.zeros(image.shape, np.uint8)
                    labels[4, 1, 2] = labels[1, 3, 0] = 3

                    def fake_run(source_path, selected_task, rois, output, fast, device):
                        self.assertEqual(selected_task, task)
                        mask = nib.Nifti1Image((labels > 0).astype(np.uint8), image.affine)
                        # Simulate TotalSegmentator returning a permuted/flipped grid.
                        mask = mask.as_reoriented(np.array([[1, -1], [2, 1], [0, -1]]))
                        target = root / "predicted.nii.gz"
                        nib.save(mask, target)
                        return {"liver": target}

                    result = root / "result.zip"
                    with patch.object(backend, "validate_installed_rois"), patch.object(backend, "_device", return_value="cpu"), \
                         patch.object(backend, "_run_task", side_effect=fake_run), \
                         patch.object(backend.importlib.metadata, "version", return_value="test"):
                        backend.process_request(request, result)
                    manifest, raw = validate_result_zip(result, source)
                    actual = labelmap_from_bytes(raw, manifest["source"])
                    np.testing.assert_array_equal(actual, labels)

    def test_invalid_metadata_fails_with_reason(self):
        for tag, value, reason in [("Modality", "PT", "Modality"), ("ImagePositionPatient", None, "ImagePositionPatient"),
                                  ("PixelSpacing", [0, 1], "PixelSpacing"), ("ImageOrientationPatient", None, "ImageOrientationPatient"),
                                  ("NumberOfFrames", 2, "multi-frame")]:
            with self.subTest(tag=tag), tempfile.TemporaryDirectory() as folder:
                paths, _, _ = write_dicom_series(Path(folder) / "dicom")
                ds = pydicom.dcmread(paths[0])
                if value is None:
                    delattr(ds, tag)
                else:
                    setattr(ds, tag, value)
                ds.save_as(paths[0])
                with self.assertRaisesRegex(ValueError, reason):
                    dicom_source_to_nifti(paths, Path(folder) / "source.nii")

    def test_reordered_irregular_and_missing_single_slice_spacing_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            paths, _, _ = write_dicom_series(Path(folder) / "dicom")
            with self.assertRaisesRegex(ValueError, "slice order"):
                dicom_source_to_nifti(paths[::-1], Path(folder) / "source.nii")
            ds = pydicom.dcmread(paths[2])
            ds.ImagePositionPatient[2] += 3
            ds.save_as(paths[2])
            with self.assertRaisesRegex(ValueError, "not regular"):
                dicom_source_to_nifti(paths, Path(folder) / "source.nii")
            ds = pydicom.dcmread(paths[0])
            del ds.SliceThickness
            ds.save_as(paths[0])
            with self.assertRaisesRegex(ValueError, "SliceThickness"):
                dicom_source_to_nifti(paths[:1], Path(folder) / "source.nii")

    def test_ct_roi_cannot_be_sent_to_mri_model(self):
        with tempfile.TemporaryDirectory() as folder:
            paths, _, _ = write_dicom_series(Path(folder) / "dicom")
            source, _ = dicom_source_to_nifti(paths, Path(folder) / "source.nii")
            with self.assertRaisesRegex(Instant3DBridgeError, "not available for MRI"):
                create_request_zip(Path(folder) / "request.zip", source,
                                   [dict(object_id=1, task="total", roi="liver")], modality="MRI")
