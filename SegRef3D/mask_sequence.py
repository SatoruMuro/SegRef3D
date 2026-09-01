"""Canonical SegRef3D mask-sequence naming and manifest helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Sequence


MASK_MANIFEST_FILENAME = "segref3d-mask-manifest.json"
MASK_SCHEMA_VERSION = 2
MASK_SLICE_ORDER = "segref3d-canonical-v1"


def canonical_mask_filename(z_index: int) -> str:
    """Return the one-based PNG filename for a zero-based canonical z index."""
    if not isinstance(z_index, int) or z_index < 0:
        raise ValueError("z_index must be a non-negative integer")
    return f"mask{z_index + 1:04d}.png"


def canonical_mask_records(keys: Iterable[str]) -> list[dict]:
    """Map display-order keys to canonical z indices and exported filenames."""
    return [
        {
            "zIndex": z_index,
            "displaySlice": z_index + 1,
            "key": str(key),
            "filename": canonical_mask_filename(z_index),
        }
        for z_index, key in enumerate(keys)
    ]


def create_mask_manifest(
    records: Sequence[dict],
    width: int | None,
    height: int | None,
    *,
    exported_by: str,
    edition: str,
) -> dict:
    return {
        "schemaVersion": MASK_SCHEMA_VERSION,
        "sliceCount": len(records),
        "width": int(width) if width is not None else None,
        "height": int(height) if height is not None else None,
        "sliceIndexBase": 1,
        "sliceOrder": MASK_SLICE_ORDER,
        "exportedBy": exported_by,
        "edition": edition,
        "files": [
            {
                "zIndex": record["zIndex"],
                "displaySlice": record["displaySlice"],
                "filename": record["filename"],
            }
            for record in records
        ],
    }


def write_mask_manifest(directory: str | Path, manifest: dict) -> Path:
    path = Path(directory) / MASK_MANIFEST_FILENAME
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def export_mapping_preview(records: Sequence[dict], edge_count: int = 3) -> list[str]:
    """Return first/last mapping lines without flooding logs for large volumes."""
    if edge_count < 1:
        return []
    indices = list(range(min(edge_count, len(records))))
    tail_start = max(edge_count, len(records) - edge_count)
    indices.extend(range(tail_start, len(records)))
    lines = [
        f"volume z={records[index]['zIndex']} -> {records[index]['filename']}"
        for index in indices
    ]
    if len(records) > edge_count * 2:
        lines.insert(edge_count, "...")
    return lines
