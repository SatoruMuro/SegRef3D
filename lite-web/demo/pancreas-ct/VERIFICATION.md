# Pancreas-CT demo verification

Verified on 2026-09-11. Dataset attribution, license, provenance, geometry and
per-file hashes are recorded in [manifest.json](manifest.json) and
[demo credits](../DEMO_DATA_LICENSES.md).

## Selection and delivery

- PANCREAS_0080 was the smallest complete series in the official TCIA Version 2
  series listing: 181 axial CT images, 512 × 512. Visual review of the series
  confirmed contrast-enhanced abdominal anatomy and the pancreatic region;
  slice 91 is the initial display. This is demo suitability review, not clinical QA.
- The official series ZIP is copied byte-for-byte, including its TCIA LICENSE:
  43,011,465 bytes; SHA-256
  `6b9bff4c2a7bb77b564a13fb2fdcfa5a3afea25455ab066309fb5fce7c9a8065`.
- One same-origin ZIP is fetched only when selected, avoiding 181 separate image
  requests and a dependency on the TCIA API at viewing time. No slices or pixels
  were removed or re-encoded. Manual segmentation is not included.
- All 182 archive entries pass CRC. All 181 DICOMs decode with one series and
  unique SOP Instance UIDs; slice positions are continuous at 1 mm. Pixel spacing
  is 0.9765625 × 0.9765625 mm. The preparation script also decodes every image
  with pydicom; the unit test independently uses the browser DICOM parser.
- The demo reverses decoded rows and slice order so screen down is posterior
  and slices run caudal to cranial (LPS Z −180 to 0 mm). Tests verify every voxel
  remains unchanged and physical coordinates agree with the original grid; the
  updated affine is used for display, masks and the SegCT/MRI source NIfTI.
  TCIA converted these files from anonymized volumes; they are not original scanner DICOM exports. The
  abdominal Window/Level preset (400/40) changes display only.

## Automated verification

- All 157 Web unit tests pass (134 Lite, 23 TrainRef3D/SliceBridge), including
  archive SHA-256, all DICOM file hashes, CRC, geometry and CT source creation.
- `demo-switch.browser.mjs`: all five demos load from the welcome controls;
  cards have matching sizes at desktop and 390-pixel widths. Seven successive
  demo loads retain no masks or display settings from the previous demo.
  Existing HeLa and Mouse Brain calibration/statistics checks pass.
- Real Edge browser: Pancreas-CT loads as 181 DICOM images at slice 91;
  next/previous slice and Window/Level work. SegCT/MRI recognizes CT, offers
  `total/pancreas`, and generates a request ZIP. Its source bytes match the
  manifest SHA-256. A synthetic result using the Colab schema imports onto the
  exact requested voxel in the reoriented grid. Screenshots show the spine and
  table below the abdomen. No page errors or alert failures occurred.
- `medical-source.browser.mjs`: DICOM and NIfTI CT/MRI request/result import,
  reload, changed-voxel rejection, legacy result and project round trips pass.
- `segmentation-export.browser.mjs`: DICOM, PNG, JPEG and TIFF SegAnything ZIP
  export passes with original/adjusted display, frame/range/box checks and JPEG
  comparison to the displayed image.

TotalSegmentator GPU inference was not run for this demo during these checks.
