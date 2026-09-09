"""Synthetic (no patient data) inputs shared by desktop and browser Job ZIP tests."""
from pathlib import Path

import numpy as np
from PIL import Image
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid


def make_series(root, kind, count=15):
    folder = Path(root) / kind
    folder.mkdir(parents=True, exist_ok=True)
    series_uid, study_uid = generate_uid(), generate_uid()
    y, x = np.indices((400, 400))
    for index in range(count):
        # Signed pixels, nontrivial rescale and a smooth gradient for JPEG comparisons.
        pixels = (x * 3 + y - 500 + index * 10).astype(np.int16)
        if kind.startswith("dicom"):
            path = folder / f"slice{index + 1:04d}.dcm"
            meta = FileMetaDataset()
            meta.TransferSyntaxUID = ExplicitVRLittleEndian
            meta.MediaStorageSOPClassUID = CTImageStorage
            meta.MediaStorageSOPInstanceUID = generate_uid()
            ds = FileDataset(str(path), {}, file_meta=meta, preamble=b"\0" * 128)
            ds.SOPClassUID = meta.MediaStorageSOPClassUID
            ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
            ds.SeriesInstanceUID, ds.StudyInstanceUID = series_uid, study_uid
            ds.Modality = "CT"
            ds.PatientName = "Synthetic^SegJob"
            ds.PatientID = "TEST-NO-PATIENT-DATA"
            ds.Rows = ds.Columns = 400
            ds.SamplesPerPixel = 1
            ds.PhotometricInterpretation = "MONOCHROME1" if kind.endswith("mono1") else "MONOCHROME2"
            ds.BitsAllocated = ds.BitsStored = 16
            ds.HighBit, ds.PixelRepresentation = 15, 1
            ds.RescaleSlope, ds.RescaleIntercept = 2, -1024
            ds.WindowCenter, ds.WindowWidth = -200, 1800
            ds.InstanceNumber = index + 1
            ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
            ds.ImagePositionPatient = [0, 0, index * 2]
            ds.PixelSpacing = [0.7, 0.7]
            ds.SliceThickness = 2
            ds.PixelData = pixels.astype("<i2").tobytes()
            ds.save_as(path, enforce_file_format=True)
        else:
            gray = np.clip((pixels.astype(float) + 500) / 6, 0, 255).astype(np.uint8)
            rgb = np.stack((gray, (gray * 0.8 + 20).astype(np.uint8), (gray * 0.5 + 70).astype(np.uint8)), axis=-1)
            Image.fromarray(rgb).save(folder / f"slice{index + 1:04d}.{kind}")
    return folder


if __name__ == "__main__":
    import sys
    for format_name in ("dicom", "dicom-mono1", "png", "jpg", "tiff"):
        print(make_series(sys.argv[1], format_name))
