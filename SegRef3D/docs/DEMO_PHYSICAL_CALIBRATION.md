# Microscopy demo physical calibration

Base: `d18bbcc96d42aa013cc98d6bafd4a60a37b0be24`. Verified 2026-09-10.

## HeLa (EMPIAR-10478)

Calculation spacing remains exactly `[0.0000390625, 0.0000390625, 0.0001]` mm:
10 nm source pixels × 2000 / 512 = 39.0625 nm XY; 50 nm source Z × 2 = 100 nm.
ROI_1416-1932-171, source frames 1, 3, …, 299, 150 demo images, resize provenance
and CC0 remain unchanged. No demo image bytes were modified.

The shared spacing formatter chooses mm, µm or nm by magnitude. HeLa displays
`39.06 × 39.06 × 100 nm`. Volume calculation stays in mm³ with the original
floating-point values. Statistics use µm³ when all positive object volumes are
below 0.001 mm³; otherwise mm³ remains the primary column. Nonzero tiny values
in either mm³ or cm³ use scientific notation instead of rounding to zero.
An object-row summary keeps the primary value visible in the narrow tools panel.

Statistics CSV keeps the original columns in their original order and appends
`volume_um3`, `physical_spacing_status`, `xy_source`, `z_source`, and
`reference_width_mm`. Physical values use full JavaScript numeric serialization,
not fixed-decimal truncation. For example, 10,000 HeLa voxels are exactly
1.52587890625 µm³ with the existing spacing calculation.

## Mouse Brain (BAP)

Source physical spacing metadata are still marked as absent; `voxelSpacingMm`
remains null in the asset manifest. The demo now starts at **slice 55**, zero-based
index 54, file `image0109.png`. Contact-sheet comparison across the sequence and
full-size inspection found a broad coronal forebrain with clearly visible,
uncropped lateral margins. This is a practical calibration slice, not a claim
that this section has the specimen's measured maximum width.

The user draws an XY reference line with the existing calibration tool. Its
**11.4 mm approximate adult mouse brain width** is an educational reference,
not a measurement of this BAP specimen. XY = 11.4 / drawn pixel length in mm.
Z is preset to **0.10 mm / 100 µm estimated effective interval**, using the
requested approximate 13.2 mm AP coverage / 132 images. It is neither source
metadata nor original histological section thickness. Manual demo fields are
read-only so the guide uses the preset reference and Z interval.

`state.physicalSpacing` explicitly tracks XY and Z as unknown, metadata,
estimated, user-calibrated or manual, plus the approximate reference provenance.
Statistics and Project Check use this state rather than free-form
`volumeInfoSource` comparisons. Before XY calibration, physical statistics are
unavailable (`—`) and voxel counts remain available. Afterwards volumes use
calibrated XY and estimated Z, labeled approximate/estimated.

Project ZIP and VolInfo CSV preserve provenance. Unknown Project ZIP values do
not become calibrated simply because numeric placeholders exist. A narrow,
explicit legacy Project ZIP source allowlist preserves older known manual and
DICOM/NIfTI calibrations; arbitrary source strings are not trusted.

Uncalibrated reference-demo physical geometry export (VolInfo, NIfTI, STL,
Training ZIP) requires calibration. Pixel/mask/Project/TIFF exports remain
available. 3D preview remains available with an uncalibrated placeholder-grid
notice. Calibrated Training ZIPs include the estimate note among their warnings.

BAP attribution, CC BY-SA 4.0, all 132 supplied 707 × 553 RGB images, ordering,
alpha-removal/lossless-optimization provenance and hashes are preserved.
Existing section shifts and tissue artifacts still require consideration before
quantitative analysis; this demo calibration does not establish specimen accuracy.

## Verification

- 156 Web tests pass, including all 133 Lite tests. New tests cover exact HeLa
  spacing/calculation, nm and µm³ display, CSV precision, Mouse calibration gating,
  reference calculation, provenance and legacy Project/VolInfo compatibility.
- Actual browser demo loading: four welcome cards, desktop/narrow layouts, six
  successive stack loads, mask/display/calibration reset, HeLa statistics and
  Mouse slice 55, guide, unknown XY, estimated Z and readonly preset fields.
- Browser Mouse workflow: labeled voxels before calibration have no physical
  volume; Project ZIP restoration preserves that state; two canvas clicks apply
  the reference; XY matches reference/pixel-length and Z remains 0.1 mm; only then
  do physical statistics appear. Both microscopy images and displayed results
  were visually inspected.
- DICOM CT/MRI and NIfTI CT/MRI: four browser request/result/reload/legacy import
  and Project ZIP workflows pass.
- DICOM MONOCHROME1/2, PNG, JPEG and TIFF: ten browser SegAnything export cases
  pass with default and adjusted display settings, geometry, prompts and JPG
  checks retained.
- All demo image SHA-256 checks pass. No Local source, inference algorithm,
  DICOM geometry, image bytes, licensing or published Windows ZIP was changed.
