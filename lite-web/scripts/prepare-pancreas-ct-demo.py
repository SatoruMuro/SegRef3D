"""Validate and copy the official TCIA single-series archive without rewriting DICOM.

Usage: python lite-web/scripts/prepare-pancreas-ct-demo.py downloaded.zip
Requires pydicom and numpy (inspection only). No credentials or network access.
"""
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import zipfile

import numpy as np
import pydicom

EXPECTED_SHA256 = "6b9bff4c2a7bb77b564a13fb2fdcfa5a3afea25455ab066309fb5fce7c9a8065"
SERIES_UID = "1.2.826.0.1.3680043.2.1125.1.41202274843063370955090296887703130"
source = Path(sys.argv[1])
assert hashlib.sha256(source.read_bytes()).hexdigest() == EXPECTED_SHA256
target = Path(__file__).resolve().parents[1] / "demo" / "pancreas-ct"
target.mkdir(parents=True, exist_ok=True)
records = []
with zipfile.ZipFile(source) as archive:
    assert archive.testzip() is None
    for name in archive.namelist():
        if not name.endswith(".dcm"):
            assert name == "LICENSE"
            continue
        data = archive.read(name)
        ds = pydicom.dcmread(io.BytesIO(data))
        assert ds.PatientID == "PANCREAS_0080" and ds.SeriesInstanceUID == SERIES_UID
        assert ds.Modality == "CT" and ds.Rows == ds.Columns == 512
        assert list(ds.ImageOrientationPatient) == [1, 0, 0, 0, -1, 0]
        assert list(ds.PixelSpacing) == [0.9765625, 0.9765625]
        assert float(ds.RescaleSlope) == 1 and float(ds.RescaleIntercept) == 0
        pixels = ds.pixel_array  # Decode every slice, not just its metadata.
        records.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                        "sopInstanceUID": str(ds.SOPInstanceUID),
                        "positionLps": [float(x) for x in ds.ImagePositionPatient],
                        "pixelMinimum": int(pixels.min()), "pixelMaximum": int(pixels.max())})
    (target / "LICENSE.txt").write_bytes(archive.read("LICENSE"))
assert len(records) == len({r['sopInstanceUID'] for r in records}) == 181
z_positions = sorted(r['positionLps'][2] for r in records)
assert np.allclose(np.diff(z_positions), 1)
shutil.copyfile(source, target / "PANCREAS_0080.zip")
manifest = {
    "id": "pancreas-ct-demo", "revision": 1, "patientID": "PANCREAS_0080",
    "collection": "Pancreas-CT (Version 2)", "source": "The Cancer Imaging Archive (TCIA)",
    "citation": "Roth H, Farag A, Turkbey EB, Lu L, Liu J, Summers RM. Data From Pancreas-CT (Version 2). The Cancer Imaging Archive, 2016.",
    "doiUrl": "https://doi.org/10.7937/K9/TCIA.2016.tNB1kqBU",
    "collectionUrl": "https://www.cancerimagingarchive.net/collection/pancreas-ct/",
    "license": "CC BY 3.0", "licenseUrl": "https://creativecommons.org/licenses/by/3.0/",
    "policyUrl": "https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/",
    "downstreamUse": "Retain attribution, DOI, license and the TCIA data usage policy link when redistributing or using these data. Follow TCIA restrictions, including no re-identification or participant contact.",
    "seriesInstanceUID": SERIES_UID,
    "downloadUrl": f"https://services.cancerimagingarchive.net/nbia-api/services/v1/getImage?SeriesInstanceUID={SERIES_UID}",
    "archive": {"path": "PANCREAS_0080.zip", "bytes": source.stat().st_size, "sha256": EXPECTED_SHA256},
    "imageCount": 181, "imageSize": [512, 512], "modality": "CT",
    "voxelSpacingMm": [0.9765625, 0.9765625, 1], "physicalSpacingStatus": "known",
    "spacingSource": "PixelSpacing and consecutive ImagePositionPatient values in the supplied DICOM",
    "sourceNote": "TCIA created these DICOM files from anonymized Analyze/NIfTI volumes; they are not original scanner DICOM exports.",
    "initialFrameIndex": 90, "displayDefaults": {"windowCenter": 40, "windowWidth": 400},
    "presentation": "Screen down = posterior; slice order = caudal to cranial (-180 to 0 mm LPS Z). Decoded rows and slices are reversed with the affine updated consistently for display, masks and exports. No interpolation or voxel value changes; original DICOM bytes unchanged.",
    "selectionNote": "Smallest complete series in the retrieved Version 2 listing; visual review confirmed contrast-enhanced abdomen and pancreatic region. Initial slice 91 shows the upper abdomen. This is demo selection, not clinical quality assurance.",
    "adaptation": "None to the archive or DICOM: byte-for-byte copy of the official series ZIP including LICENSE. No resampling, cropping, slice removal or lossy encoding. Window/Level is a viewer-only preset.",
    "manualSegmentationIncluded": False, "files": records,
}
(target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Validated {len(records)} DICOM slices; copied {source.stat().st_size} bytes unchanged.")
