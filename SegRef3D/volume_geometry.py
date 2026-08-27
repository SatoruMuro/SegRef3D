"""Physical-space geometry helpers shared by SegRef3D desktop builds."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

import nibabel as nib
import numpy as np


LPS_TO_RAS = np.diag([-1.0, -1.0, 1.0, 1.0])


class VolumeGeometryError(ValueError):
    """Raised when source metadata cannot describe one regular 3D volume."""


def _as_affine(value) -> np.ndarray:
    affine = np.asarray(value, dtype=float)
    if affine.shape != (4, 4) or not np.all(np.isfinite(affine)):
        raise VolumeGeometryError("IJK-to-RAS affine must be one finite 4x4 matrix.")
    if not np.allclose(affine[3], [0.0, 0.0, 0.0, 1.0], rtol=0, atol=1e-8):
        raise VolumeGeometryError("IJK-to-RAS affine has an invalid homogeneous row.")
    if np.any(np.linalg.norm(affine[:3, :3], axis=0) <= 0):
        raise VolumeGeometryError("IJK-to-RAS affine contains a zero-length voxel axis.")
    return affine


def spacing_from_affine(affine) -> tuple[float, float, float]:
    matrix = _as_affine(affine)
    return tuple(float(value) for value in np.linalg.norm(matrix[:3, :3], axis=0))


def direction_from_affine(affine) -> np.ndarray:
    matrix = _as_affine(affine)
    spacing = np.asarray(spacing_from_affine(matrix))
    return matrix[:3, :3] / spacing[np.newaxis, :]


def affine_with_spacing(affine, spacing: Sequence[float]) -> np.ndarray:
    matrix = _as_affine(affine).copy()
    values = np.asarray(spacing, dtype=float)
    if values.shape != (3,) or not np.all(np.isfinite(values)) or np.any(values <= 0):
        raise VolumeGeometryError("Voxel spacing must contain three positive values.")
    matrix[:3, :3] = direction_from_affine(matrix) * values[np.newaxis, :]
    return matrix


def axis_aligned_affine(
    shape: Sequence[int],
    spacing: Sequence[float],
    origin: Sequence[float] = (0.0, 0.0, 0.0),
    *,
    desktop_y_down: bool = True,
) -> np.ndarray:
    width, height, depth = (int(value) for value in shape)
    if min(width, height, depth) < 1:
        raise VolumeGeometryError("Volume dimensions must be positive.")
    sx, sy, sz = (float(value) for value in spacing)
    ox, oy, oz = (float(value) for value in origin)
    if min(sx, sy, sz) <= 0 or not np.all(np.isfinite([sx, sy, sz, ox, oy, oz])):
        raise VolumeGeometryError("Fallback spacing/origin values are invalid.")
    if desktop_y_down:
        return np.array(
            [
                [sx, 0.0, 0.0, ox],
                [0.0, -sy, 0.0, oy + (height - 1) * sy],
                [0.0, 0.0, sz, oz],
                [0.0, 0.0, 0.0, 1.0],
            ],
            dtype=float,
        )
    return np.array(
        [
            [sx, 0.0, 0.0, ox],
            [0.0, sy, 0.0, oy],
            [0.0, 0.0, sz, oz],
            [0.0, 0.0, 0.0, 1.0],
        ],
        dtype=float,
    )


def reverse_axis_affine(affine, axis: int, length: int) -> np.ndarray:
    if axis not in (0, 1, 2) or int(length) < 1:
        raise VolumeGeometryError("Reverse axis and length are invalid.")
    transform = np.eye(4, dtype=float)
    transform[axis, axis] = -1.0
    transform[axis, 3] = int(length) - 1
    return _as_affine(affine) @ transform


def qform_can_represent(affine, *, atol: float = 1e-5) -> bool:
    direction = direction_from_affine(affine)
    gram = direction.T @ direction
    return bool(np.allclose(gram, np.eye(3), rtol=0, atol=atol))


@dataclass(frozen=True)
class VolumeGeometry:
    shape: tuple[int, int, int]
    affine_ras: np.ndarray
    source_kind: str
    warnings: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self):
        shape = tuple(int(value) for value in self.shape)
        if len(shape) != 3 or min(shape) < 1:
            raise VolumeGeometryError("Volume geometry requires three positive dimensions.")
        object.__setattr__(self, "shape", shape)
        object.__setattr__(self, "affine_ras", _as_affine(self.affine_ras).copy())
        object.__setattr__(self, "source_kind", str(self.source_kind or "unknown"))
        object.__setattr__(self, "warnings", tuple(str(item) for item in self.warnings))

    @property
    def spacing(self) -> tuple[float, float, float]:
        return spacing_from_affine(self.affine_ras)

    @property
    def origin(self) -> tuple[float, float, float]:
        return tuple(float(value) for value in self.affine_ras[:3, 3])

    @property
    def direction(self) -> np.ndarray:
        return direction_from_affine(self.affine_ras)

    def with_spacing(self, spacing: Sequence[float], *, source_kind: str | None = None):
        return VolumeGeometry(
            self.shape,
            affine_with_spacing(self.affine_ras, spacing),
            source_kind or self.source_kind,
            self.warnings,
        )

    def reversed(self, axis: int):
        return VolumeGeometry(
            self.shape,
            reverse_axis_affine(self.affine_ras, axis, self.shape[axis]),
            f"{self.source_kind}:reversed-axis-{axis}",
            self.warnings,
        )


def _finite_vector(value, length: int, name: str) -> np.ndarray:
    try:
        vector = np.asarray([float(item) for item in value], dtype=float)
    except Exception as exc:
        raise VolumeGeometryError(f"DICOM {name} is missing or invalid.") from exc
    if vector.shape != (length,) or not np.all(np.isfinite(vector)):
        raise VolumeGeometryError(f"DICOM {name} must contain {length} finite values.")
    return vector


def dicom_datasets_to_geometry(
    datasets: Sequence,
    *,
    orientation_tolerance: float = 1e-4,
    position_tolerance_mm: float = 1e-3,
) -> tuple[VolumeGeometry, list[int]]:
    """Build a regular IJK-to-RAS affine and the matching DICOM slice order."""
    if not datasets:
        raise VolumeGeometryError("No DICOM slices were provided.")
    first = datasets[0]
    width = int(getattr(first, "Columns", 0) or 0)
    height = int(getattr(first, "Rows", 0) or 0)
    if width < 1 or height < 1:
        raise VolumeGeometryError("DICOM Rows/Columns are missing.")

    first_iop = _finite_vector(getattr(first, "ImageOrientationPatient", None), 6, "ImageOrientationPatient")
    i_direction = first_iop[:3].copy()
    j_direction = first_iop[3:].copy()
    i_direction /= np.linalg.norm(i_direction)
    j_direction /= np.linalg.norm(j_direction)
    if abs(float(np.dot(i_direction, j_direction))) > orientation_tolerance:
        raise VolumeGeometryError("DICOM row and column directions are not orthogonal.")
    normal = np.cross(i_direction, j_direction)
    normal_length = np.linalg.norm(normal)
    if normal_length <= 0:
        raise VolumeGeometryError("DICOM slice normal cannot be determined.")
    normal /= normal_length

    first_spacing = _finite_vector(getattr(first, "PixelSpacing", None), 2, "PixelSpacing")
    row_spacing, column_spacing = (float(value) for value in first_spacing)
    if row_spacing <= 0 or column_spacing <= 0:
        raise VolumeGeometryError("DICOM PixelSpacing values must be positive.")

    positions = []
    for index, dataset in enumerate(datasets):
        if int(getattr(dataset, "Columns", 0) or 0) != width or int(getattr(dataset, "Rows", 0) or 0) != height:
            raise VolumeGeometryError("DICOM slice dimensions are inconsistent.")
        iop = _finite_vector(getattr(dataset, "ImageOrientationPatient", None), 6, "ImageOrientationPatient")
        if not np.allclose(iop, first_iop, rtol=0, atol=orientation_tolerance):
            raise VolumeGeometryError("DICOM slices are not parallel with a consistent orientation.")
        pixel_spacing = _finite_vector(getattr(dataset, "PixelSpacing", None), 2, "PixelSpacing")
        if not np.allclose(pixel_spacing, first_spacing, rtol=0, atol=position_tolerance_mm):
            raise VolumeGeometryError("DICOM PixelSpacing changes within the series.")
        position = _finite_vector(getattr(dataset, "ImagePositionPatient", None), 3, "ImagePositionPatient")
        positions.append((float(np.dot(position, normal)), index, position))

    positions.sort(key=lambda item: item[0])
    order = [item[1] for item in positions]
    ordered_positions = np.stack([item[2] for item in positions])
    warnings = []
    if len(ordered_positions) >= 2:
        steps = np.diff(ordered_positions, axis=0)
        slice_step_lps = np.median(steps, axis=0)
        step_length = float(np.linalg.norm(slice_step_lps))
        if step_length <= position_tolerance_mm:
            raise VolumeGeometryError("DICOM slices contain duplicate positions.")
        predicted = ordered_positions[0] + np.arange(len(ordered_positions))[:, None] * slice_step_lps
        max_error = float(np.max(np.linalg.norm(ordered_positions - predicted, axis=1)))
        allowed_error = max(position_tolerance_mm, step_length * 0.01)
        if max_error > allowed_error:
            raise VolumeGeometryError(
                f"DICOM slice positions are not regular enough for one 3D affine (max error {max_error:.6g} mm)."
            )
        if max_error > position_tolerance_mm:
            warnings.append(f"DICOM slice positions were fitted with {max_error:.6g} mm maximum residual.")
    else:
        spacing_value = getattr(first, "SpacingBetweenSlices", None)
        if spacing_value is None:
            spacing_value = getattr(first, "SliceThickness", 1.0)
        try:
            slice_spacing = abs(float(spacing_value))
        except Exception:
            slice_spacing = 1.0
        if not np.isfinite(slice_spacing) or slice_spacing <= 0:
            slice_spacing = 1.0
        slice_step_lps = normal * slice_spacing
        warnings.append("Single-slice DICOM geometry uses the declared slice spacing.")

    affine_lps = np.eye(4, dtype=float)
    affine_lps[:3, 0] = i_direction * column_spacing
    affine_lps[:3, 1] = j_direction * row_spacing
    affine_lps[:3, 2] = slice_step_lps
    affine_lps[:3, 3] = ordered_positions[0]
    affine_ras = LPS_TO_RAS @ affine_lps
    return VolumeGeometry((width, height, len(datasets)), affine_ras, "dicom", tuple(warnings)), order


def dicom_files_to_geometry(paths: Iterable[str | Path]) -> tuple[VolumeGeometry, list[str]]:
    import pydicom

    records = []
    for path in paths:
        source = str(path)
        try:
            dataset = pydicom.dcmread(source, stop_before_pixels=True, force=True)
            if not hasattr(dataset, "Rows") or not hasattr(dataset, "Columns"):
                continue
            uid = str(getattr(dataset, "SeriesInstanceUID", "default-series"))
            records.append((uid, source, dataset))
        except Exception:
            continue
    if not records:
        raise VolumeGeometryError("No DICOM metadata could be read.")
    groups = {}
    for uid, source, dataset in records:
        groups.setdefault(uid, []).append((source, dataset))
    selected = max(groups.values(), key=len)
    geometry, order = dicom_datasets_to_geometry([item[1] for item in selected])
    ordered_paths = [selected[index][0] for index in order]
    if len(groups) > 1:
        geometry = VolumeGeometry(
            geometry.shape,
            geometry.affine_ras,
            geometry.source_kind,
            geometry.warnings + (f"Selected the largest of {len(groups)} DICOM series.",),
        )
    return geometry, ordered_paths


def simpleitk_image_to_geometry(image, *, source_kind: str = "dicom-simpleitk") -> VolumeGeometry:
    shape = tuple(int(value) for value in image.GetSize())
    spacing = np.asarray(image.GetSpacing(), dtype=float)
    origin_lps = np.asarray(image.GetOrigin(), dtype=float)
    direction_lps = np.asarray(image.GetDirection(), dtype=float).reshape(3, 3)
    affine_lps = np.eye(4, dtype=float)
    affine_lps[:3, :3] = direction_lps @ np.diag(spacing)
    affine_lps[:3, 3] = origin_lps
    return VolumeGeometry(shape, LPS_TO_RAS @ affine_lps, source_kind)


def nifti_image_with_geometry(data: np.ndarray, geometry: VolumeGeometry) -> nib.Nifti1Image:
    volume = np.asarray(data)
    if tuple(int(value) for value in volume.shape) != geometry.shape:
        raise VolumeGeometryError(
            f"Label volume shape {tuple(volume.shape)} does not match geometry {geometry.shape}."
        )
    affine = geometry.affine_ras.copy()
    image = nib.Nifti1Image(volume, affine)
    image.set_sform(affine, code=1)
    if qform_can_represent(affine):
        image.set_qform(affine, code=1)
    else:
        image.set_qform(None, code=0)
    image.header.set_xyzt_units("mm", "sec")
    return image
