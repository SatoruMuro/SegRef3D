# Legacy SVG migration validation — 2026-09-16

Base repository revision: `d825ae4` (main at checkout). The initial synthetic
preflight below ran before commit or deployment. Its local QA outputs are under
ignored `build/svg-qa/`; it used no real patient dataset or external inference
service. A subsequent private real-case release validation is recorded below.

| Requested check | Result |
|---|---|
| Local GPU legacy specification | Read current production importer, Qt rasterizer, exporter and palette; traced historical DICOM filename ordering in `3fe2fb9` / `08e015a` and the canonical ordering change `88c8426`. See `LEGACY_SVG_MIGRATION.md`. |
| Lite import | SVG-only folders and ZIPs decode to ordinary Uint8Array `image.mask`, then use the existing PNG apply/autosave/history path. PNGs remain authoritative in mixed folders; Project ZIP dispatch stays unchanged. |
| Color to Obj ID | Exact Local 20-color table; Obj 1 `#ff0000`, Obj 2 `#0000ff`. Existing Lite display swatches are unchanged. |
| Slice mapping | Complete one-based sequence required. Review shows all filename/source/display/z mappings; old DICOM natural filename order, canonical and reversed choices. Canonical manifest is validated. Missing/duplicate/zero-based/out-of-range/reversed-manifest cases tested. |
| SVG safety | Pure data parser and bounded aliased rasterizer; no SVG DOM/image decoding/URL loading. Script, URL, image, foreignObject, events, entities, transforms and unsupported features rejected. Browser checks no external requests and unchanged masks/history on a late-file failure. |
| Replace / Merge | Same PNG semantics. Replace replaces matched frames; Merge applies nonzero incoming labels with incoming overlap priority and preserves other pixels. Both are disclosed in the review and tested. |
| Export | One legacy colored SVG per canonical slice, including empty slices, in `<source>_svg_masks.zip`; canonical manifest includes format/version/count/dimensions/Obj colors/per-file mappings. |
| Round trip | Exact pixel equality for Lite → SVG → Lite and Lite → SVG → Local, all 20 IDs, holes, borders, single pixels and empty slices. |
| Local parity | Production Local-generated fixture outputs and actual Qt interpretations included as fixtures; all pixels agree in Lite. Additional 100 decimal-coordinate polygons and 100 cubic/quadratic/smooth curves agree exactly; circles and ellipses also match. Two Python cross-implementation tests passed. |
| DICOM migration | Real browser loaded a synthetic oblique, anisotropic MR DICOM series with reverse filenames. Local-generated SVG masks restored Obj 1/2 in canonical order. Drawing, cleanup and Undo/Redo passed. Downloaded NIfTI shape, affine and labels match the original DICOM-derived reference. |
| Training Data ZIP | Browser-generated ZIP has the original scalar image values, matching image/label affine and shape, exact canonical label values and Obj IDs. Accepted by TrainRef3D's shared case validator. |
| Node tests | **181 passed, 0 failed, 0 skipped** across `lite-web/tests/*.test.mjs`, `train-web/tests/*.test.mjs`, `slice-bridge/tests/*.test.mjs`. The SVG suite contains 11 tests. |
| Desktop/shared/backend | **65 desktop non-UI tests + 3 Windows PE tests passed**; includes actual QtGui SVG parity, geometry, mask sequence/cleanup, STL, segmentation/SegCT-MRI boundaries. **32 Colab backend tests passed**, including TrainRef3D/InferRef3D and SegAnything/SegCT-MRI contracts. Shared browser training contracts are also covered by Node and E2E. Full desktop UI suite remains blocked as described below. |
| Browser E2E | Legacy SVG MRI migration passed; existing Color TIFF/import/export regression passed; existing medical-source test passed for CT/MRI × DICOM/NIfTI (4 scenarios); SegAnything export test passed for DICOM, MONOCHROME1 DICOM, PNG, JPG, TIFF with/without display adjustments (10 scenarios). Browser runtime: local Edge through Playwright. |
| Known limits | SVG contour subset, exact working-grid dimensions, complete sequences and review of manifestless order are required. Unsupported arc commands (A), transforms, inherited styling and dimensionless files fail explicitly. Original source identity and arbitrary permutations cannot be inferred from SVG. No production MRI dataset was supplied. |

## Desktop UI environment limitation

Full discovery was attempted with two existing Python environments, including an
approved run outside the sandbox. Windows application control blocked the
`PyQt6.QtWidgets` DLL (`ImportError: DLL load failed ... application control policy`).
The ten UI test modules could not import, so they are **not counted as passed**.
`QtGui`/`QPainter` work, and the production Local SVG parser/rasterizer/exporter
cross-implementation tests ran successfully without a QtWidgets application.

The alternate environment also lacked `trimesh`; its STL tests subsequently
passed in the first environment. Windows PE tests were run in the environment
that already had `pefile`. No application-control settings were changed.

Relevant logs:

- `build/svg-qa/node-tests.log`
- `build/svg-qa/desktop-tests.log` — full UI attempt and environment errors
- `build/svg-qa/desktop-core.log`, `build/svg-qa/windows-x64.log`
- `build/svg-qa/local-parity.log`, `build/svg-qa/fixture-generation.log`
- `build/svg-qa/backend-tests.log`
- `build/svg-qa/browser-report.json`, `mapping-review.png`, `migration-complete.png`
- `build/svg-qa/color-tiff-browser.log`, `medical-browser.log`, `seganything-browser.log`

CI now includes the SVG migration browser scenario with synthetic DICOM fixtures.
This CI change has been inspected locally; a remote CI run has not been triggered.

## Real-case release validation — 2026-09-16

**Legacy SVG real-data migration validation complete.** No application code
changes were needed after the synthetic preflight. One user-selected original
MR DICOM series and its legacy obturator internus SVG masks passed locally:

- 28 DICOM slices, 384 × 384 working grid, and 28 SVGs named
  `mask0001.svg` through `mask0028.svg`. No missing or duplicate indices.
- Actual SVGs contain only `svg` / `path`, M/L/Z commands, `evenodd`, red
  `#ff0000` and blue `#0000ff`; width/height and viewBox match the working grid.
  No transforms, arcs or unsupported features were present.
- Old natural DICOM filename order equals current canonical order in this case:
  mask0001 → display 1 / z=0. The coronal series proceeds anterior to posterior.
- Obj 1 (right) and Obj 2 (left) are the only foreground IDs. All 4,128,768 pixels
  match the unchanged Local GPU production parser / QtGui rasterizer exactly.
  Right has 15,220 voxels on slices 9–25; left has 17,393 on slices 9–26.
- Lite and 3D Slicer 5.12.3 overlays were reviewed around appearance,
  middle and disappearance (display slices 8, 9, 12, 17, 23, 26, 27).
  Five superior-to-inferior axial reconstructions were also reviewed in Slicer.
  No reverse, one-slice shift, left/right swap or physical-position mismatch
  was observed. The original DICOM, never an old NIfTI, was the reference.
- Slicer independently loaded the original DICOM and the current label NIfTI.
  Their shape and IJK-to-RAS matrices agree (absolute matrix tolerance 1e-4).
- Training ZIP contains the scalar image, labelmap and manifest. Its image and
  label agree in geometry; the image equals Slicer's independently decoded
  original DICOM at every voxel, and its labels equal the current label NIfTI.
  Both Training NIfTIs were reloaded and their overlay inspected in Slicer.
- TrainRef3D's browser/shared validator and backend `extract_case` both pass;
  backend target checks for Obj 1 and Obj 2 preserve IDs and voxel counts and
  accept `medical_scalar` / `original_scalar` semantics.
- Release rerun: 181 Node, 68 desktop/shared non-UI, and 32 Colab backend tests
  pass, as does `git diff --check`. Browser regressions pass for synthetic SVG
  migration, Color TIFF, medical sources, SegAnything exports, 3D OIT/fallback
  and demo switching. The known QtWidgets desktop UI limitation above remains.

Manifestless SVG order requires review. Lite showed no DICOM read errors;
Slicer's importer emitted a nonfatal missing patient-identification-fields
message, then loaded the complete volume and passed all comparisons. Initial
Slicer startup was slow; the first no-main-window run passed numeric checks but
could not render a layout, so the overlay run was repeated with a layout.
Local GPU parity uses production methods without its blocked QtWidgets GUI.

Patient data, source paths, physical coordinates, DICOM identifiers, private
logs and review images are excluded from Git. Only synthetic fixtures are
committed. Private validation artifacts remain under ignored
`build/real-svg-qa/`. This one-case result does not establish support for
arbitrary SVG features or infer the source identity of other legacy datasets.
