# DICOM medical sources for SegCT/MRI

## Cause and implementation

Lite previously created `state.sourceVolume` only for NIfTI input. Its DICOM
decoder already retained scalar pixels and patient geometry, but the SegCT/MRI
catalog, export, and import never received that source. Local GPU had a separate
Python implementation gated on `source_nifti_path`; its DICOM loader never set it.
The shared catalog, request modality, schema, and Colab backend were also CT-only.
There was no existing NIfTI MRI detection to preserve: the old default was CT.

Both inputs now use canonical NIfTI transport with shape, spacing, affine,
orientation, modality, and source checksum. Input provenance remains separate
from transport format. Lite's adapter is `lite-web/medical-source.mjs`; Local's
is `SegRef3D/medical_source.py`. The desktop `source_nifti_path` name remains for
compatibility and now refers to either the user's NIfTI or a session-owned DICOM
conversion. Generated NIfTI contains scalar pixels, not display screenshots.

DICOM `Modality=CT` selects CT; `Modality=MR` selects MRI. Missing, mixed, and other
modalities fail with an explanation. NIfTI retains the CT default and gains an
explicit CT/MRI selector because this information cannot safely be inferred from
its usual header. Changing modality clears incompatible assignments. The shared
catalog adds the 50 open-license `total_mr` structures from the
[official TotalSegmentator class map](https://github.com/wasserth/TotalSegmentator/blob/master/totalsegmentator/map_to_binary.py).
Request validation checks that every selected task/ROI supports the modality.
The Colab backend accepts both CT and MRI and dispatches the requested tasks.

## Geometry and intensity contract

- I = DICOM column, J = DICOM row, K = canonical displayed slice index.
  Shape is `[Columns, Rows, slice count]`.
- The existing loader sorts slices by IPP projected onto the IOP slice normal,
  independently of filename and InstanceNumber. Conversion uses that same order.
- DICOM PixelSpacing is `[row spacing, column spacing]`; the affine I and J
  columns use column and row spacing respectively.
- The K vector comes from the existing fit to IPPs, retaining obliquity and shear.
  SliceThickness does not override the measured step. A single slice must provide
  SpacingBetweenSlices or SliceThickness. Existing rounding tolerance is retained
  (maximum fit residual: the larger of 0.001 mm and 1% of the slice step).
- Origin is the first canonical IPP. Left/posterior/superior patient coordinates
  are converted to NIfTI RAS by negating the first two *world* axes, including
  origin; no voxel-array flip is applied.
- Rescale Slope/Intercept is applied per slice. Local also applies Modality LUTs.
  Window/level and MONOCHROME1 display inversion do not modify source values.
- Lite writes float32 scalar NIfTI with sform; the manifest reads back the actual
  float32 header values. Local uses the existing NIfTI geometry writer. Sheared
  affines retain sform and leave qform disabled. Generated uncompressed `.nii`
  bytes are deterministic across reopening the same series.
- Native dimensions are retained for medical input in Lite; the optional raster
  resize/shared-canvas operations do not intervene in the medical source grid.
- Results must match source checksum, dimensions, spacing, orientation and affine.
  Labelmap geometry is checked separately before editing masks. Desktop maps
  `labels[:, :, k].T` to display rows; Lite uses x-fastest row-major slice arrays.
- Colab undoes pure axis permutations/flips without interpolation. This fixes a
  boundary-voxel loss reproduced by the new sagittal test. Different sampling
  grids still use the existing nearest-neighbor resampling to the source grid.
  Result writing preserves the source qform code, including disabled qforms.
- Lite's existing post-import label-visibility update received raw arrays where
  it expected `{mask}` records. This error is fixed as part of the import path.

Invalid patient geometry, nonregular positions, incompatible dimensions, missing
scalar values, or unsupported modality explain why SegCT/MRI is unavailable.
The display path and other image/mask tools remain usable. Enhanced/multiframe
DICOM requiring per-frame geometry is rejected for this bridge. Lite rejects
Modality LUT Sequence rather than exporting incorrect rescale-only intensities.

## Verification (2026-09-10)

- Lite: 126 Node tests passed, including existing DICOM compression, display,
  geometry, SegAnything/training export, mask tools, and ZIP tests.
- Desktop/shared backend: 90 tests plus 26 subtests passed across medical source,
  SegCT/MRI UI/bridge/catalog, geometry/UI, SegAnything/UI, mask sequence,
  mask editing, and session storage.
- Local's SimpleITK fallback can reuse an already decoded scalar volume after
  checking its grid against DICOM metadata; values are not rescaled a second time.
- Headless Edge: CT DICOM, MR DICOM, CT NIfTI, and MRI NIfTI each passed actual
  structure selection, request download, result ZIP import, and Project ZIP mask
  restoration. CT displays 81 choices (78 structures + 3 rib groups); MRI displays
  50 structures. No page errors or alert errors occurred.
- The four browser request/result pairs were also validated with Python/nibabel:
  source voxel arrays, affine, and returned asymmetric mask positions matched.
- Local UI: the real folder loader, catalog selection, request export, result
  import, and Undo passed with CT/MR DICOM and slice-mapping debug disabled.
  Missing IPP preserves image display and disables export/import with a reason.
- CT/MR synthetic series cover axial, coronal, sagittal and oblique/sheared
  geometry, unequal X/Y/Z spacing, nonzero origins, reversed filenames and
  InstanceNumber, and per-slice rescale. Two asymmetric labeled voxels, including
  a first-slice voxel, survive the complete mocked-model backend round trip.
  Invalid/mixed modality, missing IPP/IOP/spacing, irregular positions, reordered
  source slices, and incompatible task assignments are rejected.

The backend test substitutes known masks for inference; it exercises request
validation, task selection, reorientation/resampling, result packaging and import.
Actual TotalSegmentator inference, the user's original MRI series, large-volume
memory usage, and a rebuilt Windows distribution have not been verified. No
clinical segmentation accuracy claim is made. Existing Project ZIPs contain masks
and settings; reopen the original DICOM/NIfTI before restoring them, as before.

## Reproduce

```powershell
node --test lite-web/tests/*.test.mjs
python -m pytest SegRef3D/tests/test_dicom_medical_source.py SegRef3D/tests/test_instant3d_bridge.py SegRef3D/tests/test_instant3d_dialog.py SegRef3D/tests/test_instant3d_ui.py SegRef3D/tests/test_volume_geometry.py SegRef3D/tests/test_volume_geometry_ui.py SegRef3D/tests/test_segonweb_ui.py SegRef3D/tests/test_segmentation_job.py SegRef3D/tests/test_mask_sequence.py SegRef3D/tests/test_mask_postprocessing.py SegRef3D/tests/test_mask_postprocessing_ui.py SegRef3D/tests/test_session_storage_ui.py -q
python SegRef3D/tests/medical_source_fixtures.py qa-output/medical-fixtures
# Set PLAYWRIGHT_MODULE to the installed playwright/index.mjs path.
node lite-web/tests/medical-source.browser.mjs qa-output/medical-fixtures qa-output/medical-browser
```

The browser harness only injects state access into its local test server. No test
hooks or synthetic data ship in the runtime. Requests remain local until the user
uploads them to Colab. Deploy the updated Lite assets, shared catalog and Colab
bridge/backend together; rebuild Local GPU to distribute its Python changes.

## Changed files

Runtime and catalog:

- `lite-web/app.mjs`, `lite-web/medical-source.mjs`, `lite-web/medical-io.mjs`,
  `lite-web/instant3d-bridge.mjs`, `lite-web/index.html`, `lite-web/service-worker.js`
- `SegRef3D/SegRef3D.py`, `SegRef3D/medical_source.py`,
  `SegRef3D/instant3d_bridge.py`, `SegRef3D/instant3d_dialog.py`
- `resources/totalsegmentator_roi_catalog.json`
- `schemas/instant3d_request.schema.json`
- `ColabNotebooks/instant3dweb2_backend.py`, `ColabNotebooks/Instant3DWeb2.ipynb`

Tests and documentation:

- `lite-web/tests/medical-source.test.mjs`, `lite-web/tests/medical-source.browser.mjs`,
  `lite-web/tests/ui-privacy.test.mjs`
- `SegRef3D/tests/medical_source_fixtures.py`, `SegRef3D/tests/test_dicom_medical_source.py`,
  `SegRef3D/tests/test_instant3d_ui.py`
- `SegRef3D/docs/DICOM_SEG_CT_MRI.md`
