"""Small, asymmetric DICOM volumes; no patient data or model download required."""
from pathlib import Path
import numpy as np
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, CTImageStorage, MRImageStorage, generate_uid

ORIENTATIONS = {
    "axial": [1, 0, 0, 0, 1, 0],
    "coronal": [1, 0, 0, 0, 0, -1],
    "sagittal": [0, 1, 0, 0, 0, 1],
    "oblique": [0.8, 0.6, 0, -0.48, 0.64, 0.6],
}


def write_dicom_series(folder, modality="MR", orientation="oblique", depth=4):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    iop = np.array(ORIENTATIONS[orientation])
    step = np.cross(iop[:3], iop[3:]) * 2.3 + iop[:3] * 0.12  # preserve shear
    origin = np.array([31.25, -22.5, 17.75])
    lps = np.eye(4)
    lps[:3, 0], lps[:3, 1], lps[:3, 2], lps[:3, 3] = iop[:3] * 0.7, iop[3:] * 1.1, step, origin
    affine = np.diag([-1, -1, 1, 1]) @ lps
    uid = generate_uid()
    paths = []
    values = np.zeros((6, 5, depth), dtype=np.float32)
    for k in range(depth):
        path = folder / f"slice{depth-k:02d}.dcm"  # filenames and InstanceNumber oppose IPP
        meta = FileMetaDataset()
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        meta.MediaStorageSOPClassUID = CTImageStorage if modality == "CT" else MRImageStorage
        meta.MediaStorageSOPInstanceUID = generate_uid()
        ds = FileDataset(str(path), {}, file_meta=meta, preamble=b"\0" * 128)
        ds.SOPClassUID, ds.SOPInstanceUID = meta.MediaStorageSOPClassUID, meta.MediaStorageSOPInstanceUID
        ds.SeriesInstanceUID, ds.Modality = uid, modality
        ds.Rows, ds.Columns = 5, 6
        ds.ImageOrientationPatient = iop.tolist()
        ds.ImagePositionPatient = (origin + step * k).tolist()
        ds.PixelSpacing = [1.1, 0.7]
        ds.SliceThickness = 8  # IPP-derived spacing must win over thickness
        ds.InstanceNumber = depth - k
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME1"
        ds.BitsAllocated = ds.BitsStored = 16
        ds.HighBit, ds.PixelRepresentation = 15, 1
        ds.RescaleSlope, ds.RescaleIntercept = 2 + k, -1024
        ds.WindowCenter, ds.WindowWidth = -100, 700
        raw = (np.arange(30).reshape(5, 6) + k * 100 - 20).astype(np.int16)
        ds.PixelData = raw.tobytes()
        ds.save_as(path, enforce_file_format=True)
        paths.append(str(path))
        values[:, :, k] = (raw * (2 + k) - 1024).T
    return paths, values, affine


if __name__ == "__main__":
    import sys
    import nibabel as nib
    for modality in ("CT", "MR"):
        paths, values, affine = write_dicom_series(Path(sys.argv[1]) / modality, modality)
        nib.save(nib.Nifti1Image(values, affine), Path(sys.argv[1]) / f"{modality}.nii")
