"""Tiny synthetic data; never use these synthetic variants to estimate performance."""
import io
import json
from pathlib import Path
import zipfile

import nibabel as nib
import numpy as np


def case_bytes(index=0, channels=1, negative=False, shape=(12, 10, 6), spacing=(0.7, 0.9, 2.0), mutate=None):
    case_id = f"SR3D_{index:08x}"
    affine = np.diag([*spacing, 1.0])
    affine[:3, 3] = [12, -8, 30]
    label = np.zeros(shape, np.uint8)
    if not negative:
        label[2:5, 2:5, 1:3] = 5
        label[0, 0, 0] = 2
    objects = [] if negative else [{"id": 2, "name": "Kidney"}, {"id": 5, "name": "Tumor"}]
    manifest = {"format": "segref3d-training-case-1.0", "case_id": case_id,
                "image": {"source_format": "jpeg" if channels == 3 else "nifti", "channel_count": channels,
                          "intensity_policy": "working_rgb_8bit" if channels == 3 else "original_scalar", "channels": []},
                "label": {"file": f"labelsTr/{case_id}.nii", "datatype": "uint8", "objects": objects},
                "geometry": {"shape": list(shape), "spacing_mm": list(spacing), "affine": affine.tolist(),
                             "origin_mm": [12, -8, 30], "orientation": "RAS"},
                "privacy": {"dicom_headers_included": False, "patient_identifiers_in_manifest": False}}
    files = {manifest["label"]["file"]: nib.Nifti1Image(label, affine).to_bytes()}
    for channel in range(channels):
        name = f"imagesTr/{case_id}_{channel:04d}.nii"
        values = np.arange(np.prod(shape)).reshape(shape) % 200 + channel * 10 if channels == 3 else np.arange(np.prod(shape)).reshape(shape) * 7 - 500
        values = values.astype(np.uint8 if channels == 3 else np.int16)
        files[name] = nib.Nifti1Image(values, affine).to_bytes()
        manifest["image"]["channels"].append({"index": channel, "name": ("red", "green", "blue")[channel] if channels == 3 else "scalar", "file": name, "datatype": values.dtype.name})
    if mutate:
        mutate(manifest, files)
    files["manifest.json"] = json.dumps(manifest).encode()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return manifest, buffer.getvalue()


def dataset_file(directory, count=3, channels=1, negatives=(1,), mutate=None, case_mutate=None):
    manifest = {"format": "trainref3d-dataset-1.0", "dataset_id": "TR3D_12345678", "created_by": "TrainRef3D",
                "training_case_format": "segref3d-training-case-1.0",
                "task": {"type": "binary_segmentation", "target_label_id": 5, "target_name": "Tumor", "annotation_policy": "complete_for_selected_target"},
                "input": {"channel_count": channels, "source_category": "rgb" if channels == 3 else "medical_scalar"}, "cases": [],
                "privacy": {"processing_before_colab": "browser_local", "image_data_may_be_identifiable": True}}
    files = {}
    for i in range(count):
        m, data = case_bytes(i, channels, i in negatives, mutate=case_mutate)
        filename = f"cases/SegRef3D_Train_{m['case_id']}.zip"
        manifest["cases"].append({"case_id": m["case_id"], "file": filename})
        files[filename] = data
    if mutate:
        mutate(manifest, files)
    path = Path(directory) / "synthetic_dataset.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("dataset_manifest.json", json.dumps(manifest))
        for name, data in files.items():
            archive.writestr(name, data)
    return path
