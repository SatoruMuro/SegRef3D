"""Canonical medical sources for SegCT/MRI, independent of the input format."""
from pathlib import Path

import nibabel as nib
import numpy as np
import pydicom
from pydicom.pixels import apply_modality_lut

from instant3d_bridge import Instant3DBridgeError, nifti_fingerprint
from volume_geometry import dicom_datasets_to_geometry, nifti_image_with_geometry


def dicom_source_to_nifti(ordered_paths, output_path, *, scalar_volume=None, scalar_geometry=None):
    """Keep the exact displayed slice order; never silently reorder a source here.

    DICOM pixels are [row, column]; NIfTI data are [column, row, slice].
    Display VOI/windowing and MONOCHROME1 inversion do not affect these values.
    """
    datasets = [pydicom.dcmread(str(path), force=True, stop_before_pixels=scalar_volume is not None)
                for path in ordered_paths]
    if not datasets:
        raise Instant3DBridgeError("No scalar DICOM slices are available.")
    modalities = {str(getattr(ds, "Modality", "")).strip().upper() for ds in datasets}
    if modalities not in ({"CT"}, {"MR"}):
        raise Instant3DBridgeError("DICOM Modality must be CT or MR and consistent throughout the series.")
    if len({str(getattr(ds, "SeriesInstanceUID", "")) for ds in datasets}) != 1:
        raise Instant3DBridgeError("Load one DICOM series for SegCT/MRI.")
    if any(int(getattr(ds, "NumberOfFrames", 1)) != 1 or int(getattr(ds, "SamplesPerPixel", 1)) != 1 for ds in datasets):
        raise Instant3DBridgeError("DICOM requires scalar slices; multi-frame input needs per-frame patient geometry.")
    if len(datasets) == 1:
        spacing = getattr(datasets[0], "SpacingBetweenSlices", getattr(datasets[0], "SliceThickness", None))
        if spacing is None or not np.isfinite(float(spacing)) or abs(float(spacing)) <= 0:
            raise Instant3DBridgeError("Single-slice DICOM requires SpacingBetweenSlices or SliceThickness.")
    geometry, order = dicom_datasets_to_geometry(datasets)
    if abs(np.linalg.det(geometry.affine_ras[:3, :3])) < 1e-8:
        raise Instant3DBridgeError("DICOM slice positions do not define an invertible 3D patient affine.")
    if order != list(range(len(datasets))):
        raise Instant3DBridgeError("DICOM patient slice order does not match the editable image sequence.")
    if scalar_volume is not None:
        # SimpleITK fallback already applies DICOM modality scaling. Its actual
        # grid must match patient metadata before using those scalar values.
        volume = np.asarray(scalar_volume, dtype=np.float32)
        if scalar_geometry is None or not np.allclose(scalar_geometry.affine_ras, geometry.affine_ras, rtol=0, atol=1e-4):
            raise Instant3DBridgeError("Decoded DICOM volume geometry does not match patient metadata.")
        if volume.shape != geometry.shape or not np.all(np.isfinite(volume)):
            raise Instant3DBridgeError("Decoded DICOM scalar grid does not match Rows/Columns/slice count.")
    else:
        volume = np.empty(geometry.shape, dtype=np.float32)
        for index, ds in enumerate(datasets):
            pixels = np.asarray(apply_modality_lut(ds.pixel_array, ds), dtype=np.float32)
            if pixels.shape != (geometry.shape[1], geometry.shape[0]) or not np.all(np.isfinite(pixels)):
                raise Instant3DBridgeError("DICOM requires finite scalar voxels matching Rows/Columns.")
            volume[:, :, index] = pixels.T
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Uncompressed NIfTI has deterministic bytes when reopening the same series.
    nib.save(nifti_image_with_geometry(volume, geometry), str(output))
    fingerprint = nifti_fingerprint(output)
    fingerprint.update(modality="MRI" if modalities == {"MR"} else "CT", source_kind="dicom")
    return str(output), fingerprint
