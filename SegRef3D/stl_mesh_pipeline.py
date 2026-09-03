"""Shared Local Preview/STL mesh pipeline with Lite-compatible slice interpolation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence

import numpy as np

from mask_postprocessing import signed_distance_for_label


SUPPORTED_SLICE_FACTORS = (1, 5, 10)
MAX_INTERPOLATED_VOXELS = 200_000_000


@dataclass
class StlMeshResult:
    """One in-memory surface consumed unchanged by Preview and STL export."""

    label: int
    factor: int
    mesh: object
    filename: str
    source_depth: int
    interpolated_depth: int
    source_spacing_xyz: tuple[float, float, float]
    mesh_pitch_zyx: tuple[float, float, float]

    @property
    def source_z_extent_mm(self) -> float:
        """Distance between the first and last source slice centres."""
        return (self.source_depth - 1) * self.source_spacing_xyz[2]

    @property
    def interpolated_z_extent_mm(self) -> float:
        """Distance between interpolated endpoint centres (must equal source)."""
        return (self.interpolated_depth - 1) * self.mesh_pitch_zyx[0]


def _validated_spacing_xyz(spacing_xyz: Sequence[float]) -> tuple[float, float, float]:
    values = tuple(float(value) for value in spacing_xyz)
    if len(values) != 3 or not np.all(np.isfinite(values)) or min(values) <= 0:
        raise ValueError("Voxel spacing must contain three positive values.")
    return values


def _validated_label_volume(label_volume: np.ndarray) -> np.ndarray:
    source = np.asarray(label_volume)
    if source.ndim != 3 or min(source.shape) < 1:
        raise ValueError("Label volume must have shape D,H,W with positive dimensions.")
    if not np.issubdtype(source.dtype, np.integer):
        raise ValueError("Label volume must contain integer object IDs.")
    if np.any(source < 0) or np.any(source > 255):
        raise ValueError("Object IDs must be between 0 and 255.")
    return source.astype(np.uint8, copy=False)


def crop_label_volume(
    label_volume: np.ndarray,
    label: int,
    padding: int = 2,
) -> tuple[np.ndarray, int, int] | None:
    """Crop only X/Y around one object, matching Lite's STL memory optimisation."""
    source = _validated_label_volume(label_volume)
    label = int(label)
    occupied_xy = np.any(source == label, axis=0)
    positions_y, positions_x = np.nonzero(occupied_xy)
    if positions_y.size == 0:
        return None
    padding = max(0, int(padding))
    height, width = source.shape[1:]
    minimum_y = max(0, int(positions_y.min()) - padding)
    maximum_y = min(height - 1, int(positions_y.max()) + padding)
    minimum_x = max(0, int(positions_x.min()) - padding)
    maximum_x = min(width - 1, int(positions_x.max()) + padding)
    return (
        source[:, minimum_y:maximum_y + 1, minimum_x:maximum_x + 1],
        minimum_x,
        minimum_y,
    )


def interpolate_label_volume(
    label_volume: np.ndarray,
    label: int,
    factor: int,
) -> np.ndarray:
    """Interpolate one label along D using Lite's signed-distance linear blend.

    Source slices remain exact key slices at ``output[::factor]``. The returned
    array is temporary and never aliases or modifies the editor's label maps.
    """
    source = _validated_label_volume(label_volume)
    factor = int(factor)
    if factor not in SUPPORTED_SLICE_FACTORS:
        raise ValueError("Slice interpolation factor must be 1, 5, or 10.")
    label = int(label)
    depth, height, width = source.shape
    if factor == 1 or depth == 1:
        return (source == label).copy()

    output_depth = (depth - 1) * factor + 1
    output = np.zeros((output_depth, height, width), dtype=bool)
    left_distance = signed_distance_for_label(source[0], label)
    for z_index in range(depth - 1):
        right_distance = signed_distance_for_label(source[z_index + 1], label)
        for step in range(factor):
            ratio = step / factor
            output[z_index * factor + step] = (
                left_distance * (1.0 - ratio) + right_distance * ratio <= 0
            )
        left_distance = right_distance
    output[-1] = source[-1] == label
    return output


def build_stl_meshes(
    label_volume: np.ndarray,
    labels: Iterable[int],
    factor: int,
    spacing_xyz: Sequence[float],
    *,
    output_stem: str = "SegRef3D",
    smoothing_iterations: int = 0,
    progress_callback: Callable[[str], object] | None = None,
) -> list[StlMeshResult]:
    """Run the one shared mask -> interpolation -> spacing -> mesh pipeline."""
    source = _validated_label_volume(label_volume)
    factor = int(factor)
    if factor not in SUPPORTED_SLICE_FACTORS:
        raise ValueError("Slice interpolation factor must be 1, 5, or 10.")
    spacing_x, spacing_y, spacing_z = _validated_spacing_xyz(spacing_xyz)
    selected = []
    for value in labels:
        label = int(value)
        if not 1 <= label <= 255:
            raise ValueError("Object IDs must be between 1 and 255.")
        if label not in selected:
            selected.append(label)
    if not selected:
        raise ValueError("No objects are selected for 3D generation.")

    from trimesh.smoothing import filter_laplacian
    from trimesh.voxel.ops import matrix_to_marching_cubes

    output = []
    source_depth = source.shape[0]
    effective_factor = factor if source_depth > 1 else 1
    output_depth = (source_depth - 1) * effective_factor + 1
    pitch_zyx = (spacing_z / effective_factor, spacing_y, spacing_x)
    smoothing_iterations = max(0, int(smoothing_iterations))

    for label in selected:
        if progress_callback is not None:
            progress_callback(f"Obj {label}: optimizing volume")
        cropped = crop_label_volume(source, label)
        if cropped is None:
            continue
        cropped_volume, offset_x, offset_y = cropped
        voxel_count = output_depth * cropped_volume.shape[1] * cropped_volume.shape[2]
        if voxel_count > MAX_INTERPOLATED_VOXELS:
            raise ValueError(
                f"Obj {label} is too large after mask-area optimization "
                f"({round(voxel_count / 1_000_000)} million voxels)."
            )

        if progress_callback is not None:
            progress_callback(f"Obj {label}: {factor}x signed-distance interpolation")
        binary_volume = interpolate_label_volume(cropped_volume, label, factor)
        if not np.any(binary_volume):
            continue

        if progress_callback is not None:
            progress_callback(f"Obj {label}: generating mesh")
        mesh = matrix_to_marching_cubes(binary_volume, pitch=pitch_zyx)
        mesh.apply_translation((0.0, offset_y * spacing_y, offset_x * spacing_x))
        if smoothing_iterations:
            filter_laplacian(
                mesh,
                lamb=0.5,
                iterations=smoothing_iterations,
            )
        output.append(StlMeshResult(
            label=label,
            factor=factor,
            mesh=mesh,
            filename=f"{output_stem}_object_{label:02d}_{factor}x.stl",
            source_depth=source_depth,
            interpolated_depth=binary_volume.shape[0],
            source_spacing_xyz=(spacing_x, spacing_y, spacing_z),
            mesh_pitch_zyx=pitch_zyx,
        ))

    if not output:
        raise ValueError("The selected object set has no meshable mask pixels.")
    return output


def export_stl_meshes(meshes: Sequence[StlMeshResult], output_directory) -> list[Path]:
    """Write the exact in-memory mesh objects used by the preview."""
    directory = Path(output_directory)
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    for item in meshes:
        path = directory / item.filename
        item.mesh.export(path, file_type="stl")
        paths.append(path)
    return paths
