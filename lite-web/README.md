# SegRef3D Lite

The demo list includes **Pancreas CT (TCIA)**: one complete contrast-enhanced abdominal
DICOM series, PANCREAS_0080 (181 × 512 × 512), from **Pancreas-CT (Version 2)**.
The unchanged official series ZIP (43.0 MB) downloads only when selected. Viewing,
Window/Level adjustments and SegCT/MRI request generation run locally.

Roth H, Farag A, Turkbey EB, Lu L, Liu J, Summers RM. *Data From Pancreas-CT (Version 2).*
The Cancer Imaging Archive, 2016. [Dataset DOI](https://doi.org/10.7937/K9/TCIA.2016.tNB1kqBU).
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) ·
[TCIA Data Usage Policy](https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/) ·
[Full credits and redistribution requirements](./demo/DEMO_DATA_LICENSES.md#abdominal-dicom-ct-pancreas-ct-tcia--cc-by-30).

Browser-based, local-first image mask editor derived from the non-SAM2 workflow in SegRef3D.

Generated export names use the loaded source folder name as their prefix, so datasets remain easy to
distinguish after download. A directly loaded single-file volume uses its displayed project name instead.

Public app: <https://satorumuro.github.io/SegRef3D/lite-web/>

Not sure which workflow fits your data, goal, and computer? Use the
[official Ask AI prompt](../Tutorial/AskAISegRef3D.md). The AI-readable official references are
[llms.txt](../llms.txt) and [llms-full.txt](../llms-full.txt).

## Workspace

The desktop layout follows the same mental model as the Windows application:

```text
Objects | Image View | Tools
```

- **Objects** is the only current-target selector. Visibility and object management remain in
  each row.
- **Image View** keeps the canvas central, with Previous/Next, direct slice number, slider, and
  status synchronized with wheel and keyboard navigation.
- **Tools** groups Draw & Refine, AI Segmentation, Display, Extract, Mask Cleanup, Calibration,
  Volume & 3D, and Project Check in one dock.
- The top command bar is limited to Open, Fit, unified Undo/Redo, and Export.
- At narrow and mobile widths, the canvas remains primary while Objects and Tools become drawers.

## Try SegRef3D without preparing your own data

SegRef3D Lite includes four demos that use the same loading, mask-editing, and export pipelines as user data:

- **Apple Demo**: serial slice photographs and a calibration tutorial.
- **RabbitCT Demo**: a volumetric CT tutorial with 1.0 mm isotropic voxel spacing.
- **Electron microscopy**: HeLa cells, EMPIAR-10478 (CC0), 150 grayscale PNG slices,
  512 × 512, 25.4 MB. Reuses the previously prepared ROI_1416-1932-171 demo unchanged.
- **Mouse brain — Light microscopy**: BAP-derived serial histological sections (CC BY-SA 4.0),
  132 RGB PNG slices, 707 × 553, 51.5 MB. Lossless optimization preserves every supplied RGB pixel.

Select a demo on the start screen or in **Open**. Images download only after selection and
are cached on demand; initial page loading does not download the image stacks. Both microscopy
demos open in the usual image tools with slice navigation, threshold/drawing, editable masks,
and export. Selecting either microscopy demo starts a fresh stack with empty masks; export
your work before switching. Local user images keep their normal autosave behavior.

Mouse brain opens at slice 55 for reference-line calibration: **11.4 mm (approx.)** adult
brain width, not a measurement of this specimen. X/Y remain unknown until calibration;
Z is **0.10 mm / 100 µm estimated** from demo coverage, not source metadata or original
section thickness. Volume Statistics show voxel counts and no physical volumes before
calibration. Afterwards, volumes use calibrated X/Y and estimated Z. HeLa keeps its source-derived
39.0625 × 39.0625 × 100 nm spacing; small volumes display in µm³. CSV retains mm³/cm³,
adds µm³ and spacing provenance, and preserves numeric precision.
Original section shifts and tissue artifacts remain; registration
may be required for quantitative 3D analysis. See
[demo data licenses, source citations, ordering and modifications](demo/DEMO_DATA_LICENSES.md).
CC BY-SA 4.0 applies to the BAP-derived assets and adaptations; SegRef3D software remains Apache-2.0.

### Apple Demo

Choose **Load Apple Demo** to open the bundled 20-slice photograph stack.

1. Open the automatically displayed **Calibration** tab.
2. Draw a reference line across the widest apple diameter using the assumed learning value
   **100 mm**.
3. Keep the preset slice spacing at **approx. 4.0 mm**.
4. Segment and refine the apple's outer contour.
5. Open **Volume & 3D**, preview the reconstruction, and export STL or another existing format.

The 100 mm reference is an assumed apple diameter for learning the calibration workflow;
it is not a measurement of this specimen. The source dataset describes the slice spacing as
roughly 4 mm.

Apple demo images are adapted from Schut DE, Trull AK, Couvée M., *Dataset of CT scans, slice
photographs, and visual browning scores of 120 'Kanzi' apples*,
[Zenodo DOI 10.5281/zenodo.8167285](https://doi.org/10.5281/zenodo.8167285), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Images were selected, cropped, and
resized for this demo; the original data providers do not endorse SegRef3D.

### RabbitCT Demo

Choose **Load Rabbit CT Demo** to download and open the bundled 256 x 256 x 256 NIfTI volume on
demand. X, Y, and Z spacing are preset to **1.0 mm**, so a calibration line is not required.
Try Threshold or drawing tools on the skull or body contour, refine the mask, then open
**Volume & 3D** to preview and export the reconstruction.

The RabbitCT demo is adapted from the
[RabbitCT benchmark dataset](https://zenodo.org/records/21267885), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The original `reference_256.vol`
was converted to NIfTI and reoriented for SegRef3D Lite demo use; the original data providers
do not endorse SegRef3D. The approximately 20 MB demo volume is fetched only when
**Load Rabbit CT Demo** is selected.

## Current features

- Load naturally sorted JPG/PNG/WebP image folders
- Load DICOM folders with `.dcm` or extensionless files
- Load NIfTI-1/NIfTI-2 `.nii` and `.nii.gz` volumes as editable slice sequences
- Optional resize for images larger than 2000 px
- Optional shared white canvas for mixed image dimensions
- Edit 20 single-label objects with Free, Click, and edge Snap drawing
- Add, Erase, and Transfer label operations, with optional Auto Add/Erase/Transfer on path completion
- Unified Undo/Redo controls that route to the newest pending drawing or committed mask edit while
  preserving the separate internal histories
- Post-load window/level, brightness, and contrast controls
- A fixed Tools dock that keeps the source image visible while using image, mask, calibration,
  and volume tools
- Threshold and clicked-color RGB extraction for the current image or full sequence
- Pixel and slice-spacing calibration, including two-point reference-line calibration
- Live crosshair, line, endpoint, and pixel-distance guides while placing a calibration line
- Desktop-compatible VolInfo CSV import/export with automatic export for DICOM/NIfTI and reference-line calibration
- Browser autosave with IndexedDB
- Load grayscale label PNG sequences with Replace/Merge modes and clear all project masks
- Export and restore Project ZIP files containing label masks and editor settings
- Export image channels plus the single-label mask as a reusable one-case Training Data ZIP for
  future custom segmentation-model training
- Use the Objects panel as the current-target selector, with visibility, rename, relabel, merge,
  and object-only clear actions
- Configure one tracking range and multiple box-prompt keyframes per SegAnything object
- Export `<source-folder>_seganything_request.zip` and import the complete `seganything_result.zip` returned by Colab
- Select open-license TotalSegmentator structures, map them to Obj 1-20, and exchange validated
  `<source-folder>_segct_mri_request.zip` / `segct_mri_result.zip` archives with SegCT/MRI
- Plain wheel image navigation, Ctrl/Command+wheel zoom, Shift+wheel horizontal pan
- Middle-button drag and WASD/arrow-key canvas pan
- Label visibility controls
- Label PNG and visible-overlay PNG sequence export as ZIP
- NIfTI Labelmap export in Original, 5x, and 10x slice-interpolated forms, plus multi-page TIFF
  stack export
- Color TIFF export of the original source image stack, preserving RGB color and alpha without masks
- Multi-page TIFF and naturally sorted TIFF-folder import for 8-bit grayscale, 16-bit grayscale,
  and RGB data
- 1x/5x/10x signed-distance slice interpolation and binary STL export
- Editable signed-distance interpolation between two labeled key slices
- Mask Cleanup for the current frame, a frame range, or all frames: Fill Holes, Remove Small
  Islands, Keep Largest Component, Smooth Boundary, Dilate, and Erode
- Per-object Volume Statistics with voxel count, calibrated mm³/cm³, occupied range, and CSV export
- Shared-mesh Three.js STL preview with rotate, pan, zoom, camera reset, visibility, and opacity
- Project Check for dimensions, spacing, labels, isolated components, numbered-frame gaps, and
  SegAnything prompt/range validity
- Responsive desktop/mobile layout and offline cache

### Local processing and data flow

- Source images loaded into SegRef3D Lite are processed locally in the browser and are not uploaded
  to SegRef3D servers.
- Mask autosave uses browser-local IndexedDB storage.
- Label PNG, overlay, Project ZIP, NIfTI, TIFF, CSV, and STL exports are generated locally and
  downloaded directly to the user's device.
- Training Data ZIP is also generated entirely in the browser. It contains image voxel/pixel data,
  a geometry-matched NIfTI labelmap, and `manifest.json`; it is not uploaded to SegRef3D.
- Download names use the loaded source folder name as a prefix. A directly loaded single-file
  volume uses its displayed project name. Standard sequence names such as `mask0001.png` remain
  unchanged inside ZIP archives for import compatibility.
- SegRef3D Lite does not operate an image-upload API, analytics pipeline, or telemetry service.

SegAnything and SegCT/MRI are the explicit exceptions to this browser-local workflow. They are
separate Google Colab workflows. SegAnything provides SAM-based segmentation for user-specified
structures. SegCT/MRI provides automatic anatomical segmentation with TotalSegmentator.
The generated `<source-folder>_seganything_request.zip` includes the working image sequence and SegAnything job
settings. The SegCT/MRI request ZIP includes the source NIfTI. The user explicitly uploads these
files to their own Google Colab runtime; SegRef3D does not operate an intermediate image-upload
server. Institutional research-data or privacy rules may restrict uploading research or medical
data to Google Colab, so users should confirm that this use is permitted before continuing.

Project ZIP files do not contain the source images. Load the original image folder first, then
open the Project ZIP from **Open > Masks / Project ZIP** to restore its masks and editor settings.

### Canonical mask slice order

Mask PNG numbering always follows the displayed SegRef3D volume order after source/DICOM sorting:
display slice 1 (volume z=0) is `mask0001.png`, and display slice N (volume z=N-1) is
`maskNNNN.png`. Label PNG ZIP and Project ZIP exports include
`segref3d-mask-manifest.json` with `sliceOrder: "segref3d-canonical-v1"`. Browser autosave stores
the same zero-based canonical z index with each IndexedDB record; it does not create autosave PNG
files. Training Data ZIP records the same order in its label metadata.

### Training Data ZIP

After reviewing or correcting a segmentation, choose **Export > Training Data ZIP** to save one
case as `SegRef3D_Train_SR3D_<random>.zip`. Scalar/grayscale input uses `_0000`; RGB input is split
losslessly on the working grid into `_0000` (R), `_0001` (G), and `_0002` (B). The labelmap keeps
the existing Obj IDs without renumbering. Image channels, labelmap, spacing, origin, orientation,
and affine are re-parsed and compared before download.

For scalar NIfTI with unchanged working geometry, the exact source `.nii`/`.nii.gz` bytes are reused.
Monochrome DICOM, including supported compressed frames, is exported as Float32 after lossless
pixel decoding and stored-value × rescale-slope + rescale-intercept; DICOM headers are never
included. The current TIFF loader converts high-bit-depth
TIFF to an 8-bit working image, so Training export requires explicit confirmation and records this
limitation in `intensity_policy` and `warnings` rather than claiming original intensity retention.

Training ZIPs are not anonymous data. DICOM headers and automatically copied patient identifiers
are excluded, but image pixels/voxels may contain burned-in text, facial or unique anatomy, and
object names are user-entered text. The ZIP is intended as a versioned one-case interchange format
(`segref3d-training-case-1.0`). Use multiple Training Data ZIP files in
[TrainRef3D](../train-web/README.md) to build a custom binary model: validate cases locally,
select one Obj and confirm annotation completeness, then explicitly upload the Dataset ZIP to
your own Colab GPU runtime. The training engine is separate from SegRef3D Lite; internal Dice
does not establish clinical validity.

### Custom Model / InferRef3D

After TrainRef3D creates `TrainRef3D_Model_TR3DM_<id>.zip`, load a new source and open
**AI Segmentation > Custom Model**. Lite validates the safe archive layout and
`trainref3d-model-1.0` manifest locally; it never executes `model.pt`. Channel count and source
category must exactly match the canonical Training Data export contract. Choose **Create Inference
Request ZIP**, then explicitly upload that Request ZIP and the original Model ZIP to your own
[InferRef3D Colab](../ColabNotebooks/inferref3d.html) runtime.

The request contains deterministic canonical NIfTI channel bytes and their SHA-256 hashes. It does
not duplicate `model.pt`, but includes the model manifest and the whole Model ZIP hash. InferRef3D
reconstructs the trusted state-dictionary model, reproduces manifest preprocessing, runs sliding-window
inference, and nearest-neighbor resamples the prediction to the exact original shape and affine.
Class 1 maps back to the model's original Obj ID. On import, Lite verifies model/source/prediction
hashes, labels, shape, spacing, orientation and affine. **Replace** clears only that target; **Merge**
keeps it. Both preserve all other objects on overlap, and the whole import is one Undo transaction.
The imported mask remains editable and can be exported again as Training Data ZIP.

Model/request/result validation is browser-local. Upload to Colab is always explicit. Images may
remain identifiable. A prediction is an algorithmic segmentation intended for review and correction,
not an independent clinical diagnosis. The versioned schemas are documented in
[`TRAINREF3D_INFERENCE_FORMAT.md`](../docs/TRAINREF3D_INFERENCE_FORMAT.md).

VolInfo CSV keeps the Windows-compatible `Width/Height/Depth`, `X/Y/Z Spacing`, and
`X/Y/Z Origin` rows and now adds the complete 4 x 4 IJK-to-RAS affine. Older six-row VolInfo
files remain supported and use an explicit axis-aligned fallback. DICOM and NIfTI inputs retain
their source orientation and physical origin through NIfTI label export. A CSV is downloaded
automatically after DICOM/NIfTI loading and after reference-line calibration; the Calibration tab
also provides manual Import/Export controls.

NIfTI Labelmap export preserves full 3D patient-space geometry when it is available. The 5x and
10x options use deterministic multi-label signed-distance interpolation along K only. Output depth
is `(D - 1) * factor + 1`; every source slice is copied unchanged to `k * factor`, and the affine K
vector is divided by the factor so the first and last physical positions remain unchanged. In
3D Slicer, load the result as **Segmentation** to import label IDs as separate segments. TIFF
exports preserve mask pixels but do not reliably preserve full patient-space geometry.

**Color TIFF** (Export → Volumes, beside TIFF) exports the original decoded source image
stack without grayscale conversion, mask overlays, object colors, display adjustments, or
background compositing. The existing **TIFF** export remains an 8-bit grayscale label-ID stack.
Color TIFF is a single uncompressed multi-page TIFF with 8-bit RGBA samples and unassociated
alpha, named `<source-folder>_color_<timestamp>.tiff`. Pages follow the same loaded z order
as TIFF (natural filename order for image folders), with no rotation or flip. Original width
and height are retained even if the editor was resized or padded during loading. Unequal
original dimensions disable Color TIFF; shared white canvas padding is never exported.

PNG/JPEG/WebP sequences and supported RGB TIFF stacks are available; grayscale raster
images export with equal R/G/B values. DICOM, NIfTI and grayscale TIFF disable the button
with an explanatory tooltip. Color and alpha are those of the browser-decoded 8-bit raster,
not the original compressed file or high-bit-depth samples. Full patient-space geometry and
source color profiles are not embedded. Processing stays entirely in the browser, yields
between pages with progress, and rejects files beyond classic TIFF's 4 GiB limit.

**Replace** replaces each matched image mask. **Merge** treats imported label `0` as transparent,
keeps existing labels outside imported regions, and lets imported non-zero labels win on overlap.
The **Clear Masks** trash button clears masks, edit history, drawn lines, and browser autosave for
the entire loaded project after confirmation.

### Medical image support

#### Supported DICOM Transfer Syntax

| Transfer Syntax UID | Name | Pixel decoder |
| --- | --- | --- |
| `1.2.840.10008.1.2` | Implicit VR Little Endian | Native typed-array reader |
| `1.2.840.10008.1.2.1` | Explicit VR Little Endian | Native typed-array reader |
| `1.2.840.10008.1.2.2` | Explicit VR Big Endian | Native typed-array reader |
| `1.2.840.10008.1.2.5` | RLE Lossless | dcmjs-codecs WASM |
| `1.2.840.10008.1.2.4.50` | JPEG Baseline (Process 1) | dcmjs-codecs WASM |
| `1.2.840.10008.1.2.4.57` | JPEG Lossless (Process 14) | dcmjs-codecs WASM |
| `1.2.840.10008.1.2.4.70` | JPEG Lossless (Process 14, Selection Value 1) | dcmjs-codecs WASM |
| `1.2.840.10008.1.2.4.80` | JPEG-LS Lossless | dcmjs-codecs WASM (CharLS) |
| `1.2.840.10008.1.2.4.81` | JPEG-LS Near-Lossless | dcmjs-codecs WASM (CharLS) |
| `1.2.840.10008.1.2.4.90` | JPEG 2000 Lossless | dcmjs-codecs WASM (OpenJPEG) |
| `1.2.840.10008.1.2.4.91` | JPEG 2000 | dcmjs-codecs WASM (OpenJPEG) |

Automated tests decode RLE, both JPEG Lossless UIDs, JPEG-LS, and JPEG 2000 into scalar arrays and
verify dimensions, min/max, pixel values, slice order, and spacing. JPEG Baseline, JPEG-LS
Near-Lossless, and lossy JPEG 2000 retain the values represented by the compressed bitstream, but
cannot restore information already discarded by lossy compression.

- NIfTI: common integer and floating-point scalar datatypes plus RGB/RGBA volumes
- DICOM Bits Allocated/Stored, High Bit, signed/unsigned representation, window center/width, and
  rescale slope/intercept are applied after decompression. MONOCHROME1 is inverted for display only;
  raw/training scalar values are not inverted.
- DICOM modality values remain `Float32Array` data through rendering. The initial window uses the
  median of valid per-slice DICOM window presets, avoiding a scout/air-only first slice from clipping
  the whole series. If WC/WW are absent, a padding-excluded p0.5-p99.5 modality window is used.
- Window controls expand to the loaded modality range, including negative centers and widths above
  255. Add `?debugDicomDisplay=1` to log raw, modality, DICOM-window, active-window, and display
  statistics for the currently rendered DICOM slice.
- NIfTI slope/intercept are applied before grayscale display conversion
- JPG/PNG and extraction tools continue to operate on the normalized 0-255 editor image.

Deflated Explicit VR Little Endian, JPEG Extended 12-bit, JPEG 2000 Part 2 multicomponent, MPEG,
and other unlisted transfer syntaxes are rejected with their UID instead of being rendered
incorrectly. 4D NIfTI volumes are also rejected.

The codec scripts and `dcmjs-native-codecs.wasm` are loaded from `lite-web/vendor/` only when a
compressed series is selected. URLs are resolved relative to `dicom-codec.mjs`, so the GitHub Pages
repository base path is preserved. The service worker caches these same-origin files after first
use; no DICOM bytes or metadata are uploaded.

### SegAnything workflow

Create Input ZIP uses the current image display, including DICOM window/level,
brightness and contrast, to generate 8-bit working JPEGs for every slice. Masks,
drawn paths and box overlays are excluded. PNG/JPG/TIFF inputs use the same
image-only display path. The archive remains `segref3d-segjob-1.0` and is created
entirely in the browser. See the [DICOM export verification and browser test commands](../SegRef3D/docs/SEGMENTATION_JOB_DICOM.md).

1. Load an image sequence in SegRef3D Lite.
2. Open **AI Segmentation > Edit Setup** in the Tools dock.
3. Define the tracking range for each object.
4. Move to useful keyframes and add one or more box prompts with **Add Box Prompt Here**.
5. Return to **AI Segmentation** and choose **Create Input ZIP**.
6. Choose **Open SegAnything**, run all Colab cells, and upload the ZIP in the first upload cell.
7. Download the generated `seganything_result.zip`.
8. Choose **AI Segmentation > Import AI Result** in SegRef3D Lite.
9. Refine the returned masks, run **Tools > Check Project**, and export measurements or 3D data.

Opening SegAnything displays a confirmation before leaving the browser-local workflow. Creating
the input ZIP does not upload it: the upload occurs only when the user selects the ZIP in Google
Colab. The ZIP contains the working image sequence, not only prompt coordinates or job metadata.

Each object keeps one inclusive tracking range and a frame-sorted list of box prompts. The
`segref3d-segjob-1.0` manifest version is retained: `prompt_frame` and `box` mirror the first
prompt for legacy readers, while `prompts` contains every keyframe. Existing single-prompt jobs
remain valid.

The Colab backend uses Strategy A. It registers every keyframe for an object into the same SAM2
inference state before propagation. A second state uses a correctly remapped reversed frame
sequence for backward propagation. Forward results win where the two directions overlap; later
objects overwrite earlier objects in the final single-label mask, preserving the existing policy.

The result ZIP can restore its working JPG sequence when no images are loaded. When the source
sequence is already open, SegRef3D Lite verifies frame count, order, dimensions, and filenames before
replacing masks.

### SegCT/MRI workflow

1. Load a CT NIfTI `.nii` or `.nii.gz` volume. SegRef3D Lite retains the original bytes and full affine.
2. Open **AI Segmentation > SegCT/MRI**.
3. Search the shared open-license ROI catalog and map each selected structure to Obj 1-20.
4. Choose **Create Request ZIP** and confirm the Google Colab data-flow notice.
5. Open [SegCT/MRI](https://satorumuro.github.io/SegRef3D/ColabNotebooks/segctmri.html).
6. Upload `<source-folder>_segct_mri_request.zip` to your own Colab runtime and run the notebook.
7. Download `segct_mri_result.zip`, then choose **Import Result ZIP** in SegRef3D Lite.
8. Select Replace or Merge when target objects already contain labels, then refine the masks.

The request contains the exact source NIfTI, selected structures, Obj mappings, and a geometry
fingerprint. Import verifies dimensions, voxel spacing, affine/orientation, and SHA-256 before
changing masks. The labelmap is converted back to the same editable slice order in one Undo-able
transaction. Binary per-ROI NIfTI files remain the backend source of truth; where structures
overlap in the combined single-label map, the lower Obj ID has priority and the overlap is reported.

SegCT/MRI uses TotalSegmentator in Google Colab; it does not run in the browser and is not
bundled with SegRef3D Lite. The selectable catalog contains only supported open-license tasks. Users
must confirm that uploading research or medical data to Google Colab is permitted by their
institution. Results are algorithmic segmentations intended for review and refinement, not an
independent clinical diagnosis.

## Local development

Serve the repository root with a server that maps `.mjs` to JavaScript, then open:

```text
http://127.0.0.1:8766/lite-web/
```

Run tests with Node.js 22 or newer:

```bash
node --test "lite-web/tests/*.test.mjs"
```

With the existing Playwright browser test runtime installed, run
`node lite-web/tests/color-tiff.browser.mjs build/color-tiff-qa` to load synthetic
PNG/JPEG/WebP, RGB TIFF, grayscale and medical inputs, verify downloaded pixels and
existing exports, and capture the Export menu at desktop and narrow widths. Set
`BROWSER_CHANNEL=msedge` to use installed Edge; `PLAYWRIGHT_MODULE` can point to an
existing Playwright `index.mjs`. The fixtures and output remain local in `build/`.

## Browser limits

SegRef3D Lite processing and export are browser-local. SegAnything and SegCT/MRI are separate and
require the user to explicitly upload their image-containing input ZIP to Google Colab. Very large TIFF stacks, all-frame
cleanup, interpolation, and mesh generation can require substantial browser memory. SegRef3D Lite warns
before unusually large TIFF imports and uses progress states and yielded processing for long
operations. Use the Windows build for datasets that exceed the browser's available memory.
