# Demo UI, Colab ordering and product names

Verification date: 2026-09-10. Base: `1a0d10279aa848fbd67422f77c3c8dffc2ad06e3`.
Branch: `codex/demo-colab-product-names`. This is a source change; the already
distributed Local GPU v1.3.2 ZIP is not rebuilt or replaced by this work.

## Changes

- Lite keeps **Load Images / Load Volume** above **Try a demo dataset**.
  The four **Load … Demo** cards have equal dimensions and SVG icons, a 2 × 2
  desktop grid and one column at narrow widths. Descriptions, slice counts,
  sizes, credits, licenses, URLs and dataset loaders are retained.
- The shared SegCT/MRI notebook now has four executable cells:
  **Upload SegRef3D request ZIP → Setup SegCT/MRI → Validate request and run
  segmentation → Download / Export results**. Run all pauses for the first
  upload and then executes these cells in order.
- Upload uses only standard-library validation before setup. It checks one ZIP,
  its manifest/schema and source member, saves it in a unique `/content`
  upload directory outside the repository, and checks its existence before
  installation and after setup. Setup neither deletes `/content` nor resets
  the upload directory. The backend subsequently validates full geometry and
  objects before inference. Invalid uploads produce actionable errors.
- Lite and Local GPU/CPU share the same notebook link and protocol. Neither
  filenames nor URLs of existing notebooks, launchers or tutorials are renamed.
  The older Gradio notebooks also use current visible names; their inference
  code is unchanged. Stale saved output from the old CT/MRI notebook is cleared.
- Visible names are **SegAnything** and **SegCT/MRI**. New request downloads are
  `<source>_seganything_request.zip` / `<source>_segct_mri_request.zip`, and the
  corresponding Colab results are `seganything_result.zip` /
  `segct_mri_result.zip`. Metadata, temporary/output directories and the older
  CT/MRI STL producer header use current names.

## Compatibility

SegAnything retains `segref3d-segjob-1.0`, including legacy single-prompt jobs.
ZIP readers inspect archive contents, without depending on the ZIP basename.

New SegCT/MRI requests use `segref3d-segct-mri-bridge`, version `1.0`.
Both Python and Lite accept that schema and `segref3d-instant3d-bridge`.
The result schema follows its request schema: this is intentional so that
already distributed Local clients can import responses to their old requests.
This legacy response identifier is a compatibility exception, not a product
label. New requests and their results contain no old product name in generated
member names or metadata. Source filenames and user-entered names are preserved.
Backend software metadata uses `segct_mri`.

The Local autosave identity reader also accepts the old `segonweb:` prefix;
new result imports write `seganything:`. Internal functions, module names,
DOM IDs and CSS classes remain stable where renaming would add risk.

## Verification

| Check | Result |
| --- | --- |
| JavaScript units: Lite, Train, Slice Bridge | 152 passed |
| Desktop Python units, including Qt lifecycle and medical geometry | 139 passed |
| Colab Python units, including new/legacy ZIP and notebook orchestration | 32 passed |
| Windows signing policy tests | 14 cases passed; no signing performed |
| Edge, desktop 1600 × 1100 and narrow 390 × 844 | Equal cards, SVGs, titles, separate own-data controls, retained credit links, no horizontal overflow |
| Apple / Rabbit CT / Electron Microscopy / Mouse Brain | 20 / 256 / 150 / 132 slices loaded; switching resets seeded masks and display settings |
| Lite CT/MRI DICOM and CT/MRI NIfTI | Four browser export/import cases passed; CT/MRI candidates, project restore and masks retained |
| Those four actual Lite request ZIPs through the notebook/backend/Local reader | Passed with synthetic model masks, real ZIP, NIfTI geometry and label PNG I/O |
| SegAnything: DICOM MONOCHROME1/2, PNG, JPG, TIFF | Ten browser cases (default and adjusted display), each 15 × 400 × 400; request filename, metadata, JPEGs, range, prompt and box verified |
| Those ten actual SegAnything ZIPs through Python/Colab backend | Each produced and validated 15 masks with a synthetic predictor |
| New/legacy Local CT/MRI request ZIPs through all notebook cells | CT and MRI passed, including arbitrary basename, upload retention and final download callback |
| Notebook files and existing URLs | Preserved; source parsed and visible names tested |

Browser tests use a local server with outbound requests blocked. They load the
real bundled datasets and exercise real controls; image data is not sent to an
external service. The backend integration tests replace package installation,
network calls and model inference with test doubles. **Actual Google Colab
installation, file-picker UI and NVIDIA GPU inference were not run here.**
The host is Windows ARM64; this record does not claim a new x64 EXE build/test,
production deployment or real TotalSegmentator/SAM2 inference.

Commands (use an environment with the repository's existing dependencies):

```text
node --test lite-web/tests/*.test.mjs train-web/tests/*.test.mjs slice-bridge/tests/*.test.mjs
python -m unittest discover -s SegRef3D/tests
python -m unittest discover -s ColabNotebooks/tests
pwsh -NoProfile -File SegRef3D/tests/test_windows_signing.ps1
node lite-web/tests/demo-switch.browser.mjs <output-directory>
node lite-web/tests/medical-source.browser.mjs <medical-fixtures> <output-directory>
node lite-web/tests/segmentation-export.browser.mjs <segjob-fixtures> <output-directory>
python SegRef3D/tests/verify_browser_segjob.py <segjob-output-directory>
```

Browser commands require `PLAYWRIGHT_MODULE` and an installed browser channel.
Detailed logs, generated synthetic ZIPs and screenshots are local-only under
`build/verification/names-*`; they are not release payloads.

## Remaining legacy names

The inventory below covers text in tracked/source files, including new tests,
using the case-insensitive pattern `seg[_ -]?on[_ -]?web|instant[_ -]?3d`.
Builds, dependency caches, binary assets and this explanatory inventory are not
counted. Historic release records retain the names used at the time. Current
documentation retains old spelling only in stable file paths, URLs or explicit
compatibility explanations. The table lists each matching file and why its
remaining references are intentional.

| File | Matching lines | Reason |
| --- | ---: | --- |
| `CHANGELOG.md` | 7 | Historical release record; preserves the names and implementation recorded at that time. |
| `ColabNotebooks/Instant3DWeb2.ipynb` | 4 | Stable notebook filename metadata, backend imports/internal function names or accepted legacy request schema. |
| `ColabNotebooks/Instant3Dweb_v1_4.ipynb` | 2 | Stable notebook filename metadata, backend imports/internal function names or accepted legacy request schema. |
| `ColabNotebooks/README.md` | 7 | Stable notebook/module/tutorial paths, existing links and compatibility documentation. |
| `ColabNotebooks/SegOnWebJob_v1_0.ipynb` | 3 | Stable notebook filename metadata, backend imports/internal function names or accepted legacy request schema. |
| `ColabNotebooks/instant3dweb.html` | 1 | Existing notebook/redirect URL; displayed product names are updated. |
| `ColabNotebooks/instant3dweb2.html` | 2 | Existing notebook/redirect URL; displayed product names are updated. |
| `ColabNotebooks/instant3dweb2_backend.py` | 22 | Stable module/function/class/variable names, DOM IDs, CSS classes or import/cache paths. |
| `ColabNotebooks/segctmri.html` | 2 | Existing notebook/redirect URL; displayed product names are updated. |
| `ColabNotebooks/segonweb.html` | 2 | Existing notebook/redirect URL; displayed product names are updated. |
| `ColabNotebooks/segonweb_backend.py` | 11 | Stable module/function/class/variable names, DOM IDs, CSS classes or import/cache paths. |
| `ColabNotebooks/tests/run_real_sam2_phase1.py` | 4 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `ColabNotebooks/tests/test_notebook_structure.py` | 7 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `ColabNotebooks/tests/test_segct_mri_notebook.py` | 8 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `ColabNotebooks/tests/test_segonweb_backend.py` | 5 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `README.md` | 1 | Stable notebook/module/tutorial paths, existing links and compatibility documentation. |
| `READMEJP.md` | 1 | Stable notebook/module/tutorial paths, existing links and compatibility documentation. |
| `SegRef3D/SegRef3D.py` | 66 | Internal functions/widgets plus legacy autosave identity read alias; new writes use current names. |
| `SegRef3D/docs/DICOM_SEG_CT_MRI.md` | 6 | Stable notebook/module/tutorial paths, existing links and compatibility documentation. |
| `SegRef3D/docs/RELEASE_1_3_2.md` | 2 | Historical release record; preserves the names and implementation recorded at that time. |
| `SegRef3D/docs/SEGMENTATION_JOB_DICOM.md` | 2 | Stable notebook/module/tutorial paths, existing links and compatibility documentation. |
| `SegRef3D/instant3d_bridge.py` | 37 | Internal identifiers and accepted legacy schema; new requests use the canonical schema. |
| `SegRef3D/instant3d_dialog.py` | 1 | Stable module/function/class/variable names, DOM IDs, CSS classes or import/cache paths. |
| `SegRef3D/medical_source.py` | 11 | Stable module/function/class/variable names, DOM IDs, CSS classes or import/cache paths. |
| `SegRef3D/tests/test_desktop_workspace_ui.py` | 1 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `SegRef3D/tests/test_dicom_medical_source.py` | 3 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `SegRef3D/tests/test_instant3d_bridge.py` | 5 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `SegRef3D/tests/test_instant3d_dialog.py` | 5 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `SegRef3D/tests/test_instant3d_ui.py` | 15 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `SegRef3D/tests/test_segonweb_ui.py` | 8 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `SegRef3D/tests/verify_browser_segjob.py` | 2 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `SegRef3D/ui_SegRef3D.py` | 25 | Stable module/function/class/variable names, DOM IDs, CSS classes or import/cache paths. |
| `Tutorial/AskAISegRef3D.md` | 1 | Stable notebook/module/tutorial paths, existing links and compatibility documentation. |
| `Tutorial/TutorialSegOnWebEN.md` | 1 | Stable notebook/module/tutorial paths, existing links and compatibility documentation. |
| `Tutorial/TutorialSegOnWebJP.md` | 1 | Stable notebook/module/tutorial paths, existing links and compatibility documentation. |
| `Tutorial/TutorialSegRef3DLiteEN.md` | 3 | Stable notebook/module/tutorial paths, existing links and compatibility documentation. |
| `Tutorial/TutorialSegRef3DLiteJP.md` | 3 | Stable notebook/module/tutorial paths, existing links and compatibility documentation. |
| `lite-web/app.mjs` | 238 | Stable module/function/class/variable names, DOM IDs, CSS classes or import/cache paths. |
| `lite-web/index.html` | 81 | Stable module/function/class/variable names, DOM IDs, CSS classes or import/cache paths. |
| `lite-web/instant3d-bridge.mjs` | 17 | Internal identifiers and accepted legacy schema; new requests use the canonical schema. |
| `lite-web/service-worker.js` | 1 | Stable module/function/class/variable names, DOM IDs, CSS classes or import/cache paths. |
| `lite-web/styles.css` | 66 | Stable module/function/class/variable names, DOM IDs, CSS classes or import/cache paths. |
| `lite-web/tests/instant3d-bridge.test.mjs` | 17 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `lite-web/tests/medical-source.browser.mjs` | 13 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `lite-web/tests/medical-source.test.mjs` | 6 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `lite-web/tests/segmentation-export.browser.mjs` | 10 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `lite-web/tests/ui-privacy.test.mjs` | 6 | Stable internal/test identifiers, fixture filenames, URLs and explicit legacy compatibility assertions. |
| `lite-web/workspace-ui.mjs` | 4 | Stable module/function/class/variable names, DOM IDs, CSS classes or import/cache paths. |
| `llms-full.txt` | 1 | Stable notebook/module/tutorial paths, existing links and compatibility documentation. |
| `schemas/instant3d_request.schema.json` | 2 | Stable schema URL/file path and accepted legacy schema enum. |
| `schemas/instant3d_result.schema.json` | 2 | Stable schema URL/file path and accepted legacy schema enum. |

## Changed files

57 files, including tests and documentation:

- `ColabNotebooks/Instant3DWeb2.ipynb`
- `ColabNotebooks/Instant3Dweb_v1_4.ipynb`
- `ColabNotebooks/README.md`
- `ColabNotebooks/SAM2GUIforImgSeqv4_8.ipynb`
- `ColabNotebooks/SegOnWebJob_v1_0.ipynb`
- `ColabNotebooks/instant3dweb.html`
- `ColabNotebooks/instant3dweb2.html`
- `ColabNotebooks/instant3dweb2_backend.py`
- `ColabNotebooks/segctmri.html`
- `ColabNotebooks/segonweb.html`
- `ColabNotebooks/segonweb_backend.py`
- `ColabNotebooks/tests/run_real_sam2_phase1.py`
- `ColabNotebooks/tests/test_notebook_structure.py`
- `ColabNotebooks/tests/test_segct_mri_notebook.py`
- `ColabNotebooks/tests/test_segonweb_backend.py`
- `README.md`
- `READMEJP.md`
- `SegRef3D/SegRef3D.py`
- `SegRef3D/docs/BUILD_WINDOWS.md`
- `SegRef3D/docs/DEMO_COLAB_NAMING.md`
- `SegRef3D/docs/DICOM_SEG_CT_MRI.md`
- `SegRef3D/docs/SEGMENTATION_JOB_DICOM.md`
- `SegRef3D/docs/SEGONWEB_JOB_FORMAT.md`
- `SegRef3D/docs/WINDOWS_RELEASE_README.md`
- `SegRef3D/instant3d_bridge.py`
- `SegRef3D/instant3d_dialog.py`
- `SegRef3D/medical_source.py`
- `SegRef3D/segmentation_job.py`
- `SegRef3D/tests/test_instant3d_bridge.py`
- `SegRef3D/tests/test_instant3d_ui.py`
- `SegRef3D/tests/test_segmentation_job.py`
- `SegRef3D/tests/test_segonweb_ui.py`
- `SegRef3D/ui_SegRef3D.py`
- `Tutorial/AskAISegRef3D.md`
- `Tutorial/TutorialSegOnWebEN.md`
- `Tutorial/TutorialSegOnWebJP.md`
- `Tutorial/TutorialSegRef3DLiteEN.md`
- `Tutorial/TutorialSegRef3DLiteJP.md`
- `lite-web/README.md`
- `lite-web/app.mjs`
- `lite-web/index.html`
- `lite-web/instant3d-bridge.mjs`
- `lite-web/medical-source.mjs`
- `lite-web/service-worker.js`
- `lite-web/styles.css`
- `lite-web/tests/demo-datasets.test.mjs`
- `lite-web/tests/demo-switch.browser.mjs`
- `lite-web/tests/instant3d-bridge.test.mjs`
- `lite-web/tests/medical-source.browser.mjs`
- `lite-web/tests/segmentation-export.browser.mjs`
- `lite-web/tests/ui-privacy.test.mjs`
- `lite-web/workspace-ui.mjs`
- `llms-full.txt`
- `llms.txt`
- `resources/totalsegmentator_roi_catalog.json`
- `schemas/instant3d_request.schema.json`
- `schemas/instant3d_result.schema.json`
