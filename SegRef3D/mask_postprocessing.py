"""CPU-only mask cleanup and frame interpolation shared by all builds."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

import numpy as np
from scipy import ndimage


CLEANUP_OPERATIONS = {
    "fill-holes": "Fill Holes",
    "remove-islands": "Remove Small Islands",
    "largest": "Keep Largest Component",
    "smooth": "Smooth Boundary",
    "dilate": "Dilate",
    "erode": "Erode",
}


def _label_binary(mask: np.ndarray, label: int) -> np.ndarray:
    array = np.asarray(mask)
    if array.ndim != 2:
        raise ValueError("Label mask must be a two-dimensional array.")
    if not 1 <= int(label) <= 255:
        raise ValueError("Object label must be between 1 and 255.")
    return array == int(label)


def _disk(radius: int) -> np.ndarray:
    radius = max(1, min(20, int(radius)))
    axis = np.arange(-radius, radius + 1)
    yy, xx = np.meshgrid(axis, axis, indexing="ij")
    return (xx * xx + yy * yy) <= radius * radius


def connected_components(binary: np.ndarray) -> list[np.ndarray]:
    """Return 8-connected component coordinate arrays, largest first."""
    binary = np.asarray(binary, dtype=bool)
    if binary.ndim != 2:
        raise ValueError("Binary mask must be a two-dimensional array.")
    labels, count = ndimage.label(binary, structure=np.ones((3, 3), dtype=np.uint8))
    components = []
    for component_id in range(1, count + 1):
        coordinates = np.argwhere(labels == component_id)
        components.append((len(coordinates), component_id, coordinates))
    components.sort(key=lambda item: (-item[0], item[1]))
    return [coordinates for _, _, coordinates in components]


def cleanup_label_mask(
    mask: np.ndarray,
    label: int,
    operation: str,
    *,
    minimum_size: int = 20,
    radius: int = 1,
    iterations: int = 1,
) -> np.ndarray:
    """Apply Lite Web-compatible cleanup to one label in a label map."""
    source = np.asarray(mask)
    binary = _label_binary(source, label)
    radius = max(1, min(20, int(radius)))
    iterations = max(1, min(20, int(iterations)))

    if operation == "fill-holes":
        binary = ndimage.binary_fill_holes(
            binary,
            structure=ndimage.generate_binary_structure(2, 1),
        )
    elif operation == "remove-islands":
        minimum_size = max(1, int(minimum_size))
        output = np.zeros_like(binary)
        for component in connected_components(binary):
            if len(component) >= minimum_size:
                output[component[:, 0], component[:, 1]] = True
        binary = output
    elif operation == "largest":
        output = np.zeros_like(binary)
        components = connected_components(binary)
        if components:
            component = components[0]
            output[component[:, 0], component[:, 1]] = True
        binary = output
    elif operation == "smooth":
        kernel = np.ones((3, 3), dtype=np.uint8)
        for _ in range(iterations):
            binary = ndimage.convolve(
                binary.astype(np.uint8), kernel, mode="constant", cval=0
            ) >= 5
    elif operation in {"dilate", "erode"}:
        structure = _disk(radius)
        morphology = (
            ndimage.binary_dilation if operation == "dilate" else ndimage.binary_erosion
        )
        for _ in range(iterations):
            binary = morphology(binary, structure=structure, border_value=0)
    else:
        raise ValueError(f"Unsupported cleanup operation: {operation}.")

    output = source.copy()
    output[(source == label) & ~binary] = 0
    output[(source == 0) & binary] = label
    return output


def frame_indices_for_scope(
    scope: str,
    current_frame: int,
    start_frame: int,
    end_frame: int,
    frame_count: int,
) -> list[int]:
    """Resolve zero-based frame indices for a cleanup scope."""
    if frame_count < 1:
        raise ValueError("No images are loaded.")
    if scope == "current":
        if not 0 <= current_frame < frame_count:
            raise ValueError("The current frame is outside the image sequence.")
        return [current_frame]
    if scope == "all":
        return list(range(frame_count))
    if scope == "range" and 0 <= start_frame <= end_frame < frame_count:
        return list(range(start_frame, end_frame + 1))
    raise ValueError("Choose a valid cleanup frame range.")


def signed_distance_for_label(mask: np.ndarray, label: int) -> np.ndarray:
    """Return the same Euclidean signed-distance convention used by Lite Web."""
    binary = _label_binary(mask, label)
    height, width = binary.shape
    count = int(np.count_nonzero(binary))
    if count == 0:
        return np.full(binary.shape, np.hypot(width, height), dtype=np.float32)
    if count == binary.size:
        return np.full(binary.shape, -np.hypot(width, height), dtype=np.float32)
    to_foreground = ndimage.distance_transform_edt(~binary)
    to_background = ndimage.distance_transform_edt(binary)
    return (to_foreground - to_background).astype(np.float32)


def interpolate_label_masks(
    start_mask: np.ndarray,
    end_mask: np.ndarray,
    label: int,
    intermediate_count: int,
) -> list[np.ndarray]:
    """Generate binary intermediate masks using signed-distance interpolation."""
    start = np.asarray(start_mask)
    end = np.asarray(end_mask)
    if start.ndim != 2 or end.ndim != 2 or start.shape != end.shape:
        raise ValueError("Start and End frame dimensions do not match.")
    intermediate_count = int(intermediate_count)
    if intermediate_count < 1:
        raise ValueError("At least one intermediate frame is required.")
    if not np.any(start == label):
        raise ValueError("The start frame does not contain the selected object.")
    if not np.any(end == label):
        raise ValueError("The end frame does not contain the selected object.")

    left = signed_distance_for_label(start, label)
    right = signed_distance_for_label(end, label)
    generated = []
    for step in range(1, intermediate_count + 1):
        ratio = step / (intermediate_count + 1)
        generated.append((left * (1.0 - ratio) + right * ratio <= 0))
    return generated


def merge_label_binary(mask: np.ndarray, binary: np.ndarray, label: int) -> np.ndarray:
    """Replace one label with a binary result while preserving every other label."""
    source = np.asarray(mask)
    binary = np.asarray(binary, dtype=bool)
    if source.shape != binary.shape:
        raise ValueError("Interpolated mask dimensions do not match the target frame.")
    output = source.copy()
    output[source == label] = 0
    output[binary & (output == 0)] = label
    return output


def build_mask_volume_changes(
    before: Mapping[str, np.ndarray],
    after: Mapping[str, np.ndarray],
) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Build one compact, reversible transaction from changed masks only."""
    changes = {}
    for key in before.keys() & after.keys():
        left = np.asarray(before[key])
        right = np.asarray(after[key])
        if left.shape != right.shape:
            raise ValueError(f"Mask dimensions changed for frame {key}.")
        if not np.array_equal(left, right):
            changes[key] = (left.copy(), right.copy())
    return changes


def apply_mask_volume_changes(
    masks: Mapping[str, np.ndarray],
    changes: Mapping[str, tuple[np.ndarray, np.ndarray]],
    direction: str,
) -> dict[str, np.ndarray]:
    """Apply a transaction copy for unit testing and non-GUI callers."""
    if direction not in {"before", "after"}:
        raise ValueError("Direction must be 'before' or 'after'.")
    side = 0 if direction == "before" else 1
    output = {key: np.asarray(mask).copy() for key, mask in masks.items()}
    for key, states in changes.items():
        output[key] = states[side].copy()
    return output

