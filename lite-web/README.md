# SegRef3D Lite

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

SegRef3D Lite includes two demos that use the same loading, mask-editing, and export pipelines as user data:

- **Apple Demo**: serial slice photographs and a calibration tutorial.
- **RabbitCT Demo**: a volumetric CT tutorial with 1.0 mm isotropic voxel spacing.

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

Choose **Load RabbitCT Demo** to download and open the bundled 256 x 256 x 256 NIfTI volume on
demand. X, Y, and Z spacing are preset to **1.0 mm**, so a calibration line is not required.
Try Threshold or drawing tools on the skull or body contour, refine the mask, then open
**Volume & 3D** to preview and export the reconstruction.

The RabbitCT demo is adapted from the
[RabbitCT benchmark dataset](https://zenodo.org/records/21267885), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The original `reference_256.vol`
was converted to NIfTI and reoriented for SegRef3D Lite demo use; the original data providers
do not endorse SegRef3D. The approximately 20 MB demo volume is fetched only when
**Load RabbitCT Demo** is selected.

## Current features

- Load naturally sorted JPG/PNG image folders
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
- Configure one tracking range and multiple box-prompt keyframes per Seg Anything object
- Export `<source-folder>_segonweb_input.zip` and import the complete `segref3d_result.zip` returned by Colab
- Select open-license TotalSegmentator structures, map them to Obj 1-20, and exchange validated
  `<source-folder>_instant3d_request.zip` / `instant3d_result.zip` archives with Seg CT/MRI
- Plain wheel image navigation, Ctrl/Command+wheel zoom, Shift+wheel horizontal pan
- Middle-button drag and WASD/arrow-key canvas pan
- Label visibility controls
- Label PNG and visible-overlay PNG sequence export as ZIP
- NIfTI Labelmap export in Original, 5x, and 10x slice-interpolated forms, plus multi-page TIFF
  stack export
- Multi-page TIFF and naturally sorted TIFF-folder import for 8-bit grayscale, 16-bit grayscale,
  and RGB data
- 1x/5x/10x signed-distance slice interpolation and binary STL export
- Editable signed-distance interpolation between two labeled key slices
- Mask Cleanup for the current frame, a frame range, or all frames: Fill Holes, Remove Small
  Islands, Keep Largest Component, Smooth Boundary, Dilate, and Erode
- Per-object Volume Statistics with voxel count, calibrated mm³/cm³, occupied range, and CSV export
- Shared-mesh Three.js STL preview with rotate, pan, zoom, camera reset, visibility, and opacity
- Project Check for dimensions, spacing, labels, isolated components, numbered-frame gaps, and
  Seg Anything prompt/range validity
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

Seg Anything and Seg CT/MRI are the explicit exceptions to this browser-local workflow. They are
separate Google Colab workflows. Seg Anything provides SAM-based segmentation for user-specified
structures. Seg CT/MRI provides automatic anatomical segmentation with TotalSegmentator.
The generated `<source-folder>_segonweb_input.zip` includes the working image sequence and Seg Anything job
settings. The Seg CT/MRI request ZIP includes the source NIfTI. The user explicitly uploads these
files to their own Google Colab runtime; SegRef3D does not operate an intermediate image-upload
server. Institutional research-data or privacy rules may restrict uploading research or medical
data to Google Colab, so users should confirm that this use is permitted before continuing.

Project ZIP files do not contain the source images. Load the original image folder first, then
open the Project ZIP from **Open > Masks / Project ZIP** to restore its masks and editor settings.

### Training Data ZIP

After reviewing or correcting a segmentation, choose **Export > Training Data ZIP** to save one
case as `SegRef3D_Train_SR3D_<random>.zip`. Scalar/grayscale input uses `_0000`; RGB input is split
losslessly on the working grid into `_0000` (R), `_0001` (G), and `_0002` (B). The labelmap keeps
the existing Obj IDs without renumbering. Image channels, labelmap, spacing, origin, orientation,
and affine are re-parsed and compared before download.

For scalar NIfTI with unchanged working geometry, the exact source `.nii`/`.nii.gz` bytes are reused.
Uncompressed monochrome DICOM is exported as Float32 after stored-value × rescale-slope +
rescale-intercept; DICOM headers are never included. The current TIFF loader converts high-bit-depth
TIFF to an 8-bit working image, so Training export requires explicit confirmation and records this
limitation in `intensity_policy` and `warnings` rather than claiming original intensity retention.
Compressed DICOM frames whose scalar pixels cannot be recovered losslessly are rejected.

Training ZIPs are not anonymous data. DICOM headers and automatically copied patient identifiers
are excluded, but image pixels/voxels may contain burned-in text, facial or unique anatomy, and
object names are user-entered text. The ZIP is intended as a versioned one-case interchange format
(`segref3d-training-case-1.0`) for future TrainRef3D-style dataset assembly; model training is not
included in SegRef3D Lite yet.

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

**Replace** replaces each matched image mask. **Merge** treats imported label `0` as transparent,
keeps existing labels outside imported regions, and lets imported non-zero labels win on overlap.
The **Clear Masks** trash button clears masks, edit history, drawn lines, and browser autosave for
the entire loaded project after confirmation.

### Medical image support

- DICOM: uncompressed Implicit VR Little Endian, Explicit VR Little Endian, Explicit VR Big
  Endian, and browser-decodable JPEG Baseline frames
- NIfTI: common integer and floating-point scalar datatypes plus RGB/RGBA volumes
- DICOM window center/width and rescale slope/intercept are applied when available
- NIfTI slope/intercept are applied before grayscale display conversion
- Post-load display and threshold values operate on the normalized 0-255 image used by the editor

JPEG-LS, JPEG 2000, RLE, other compressed DICOM transfer syntaxes, and 4D NIfTI volumes are
currently rejected with a clear error instead of being rendered incorrectly.

### Seg Anything workflow

1. Load an image sequence in SegRef3D Lite.
2. Open **AI Segmentation > Edit Setup** in the Tools dock.
3. Define the tracking range for each object.
4. Move to useful keyframes and add one or more box prompts with **Add Box Prompt Here**.
5. Return to **AI Segmentation** and choose **Create Input ZIP**.
6. Choose **Open Seg Anything**, run all Colab cells, and upload the ZIP in the first upload cell.
7. Download the generated `segref3d_result.zip`.
8. Choose **AI Segmentation > Import AI Result** in SegRef3D Lite.
9. Refine the returned masks, run **Tools > Check Project**, and export measurements or 3D data.

Opening Seg Anything displays a confirmation before leaving the browser-local workflow. Creating
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

### Seg CT/MRI workflow

1. Load a CT NIfTI `.nii` or `.nii.gz` volume. SegRef3D Lite retains the original bytes and full affine.
2. Open **AI Segmentation > Seg CT/MRI**.
3. Search the shared open-license ROI catalog and map each selected structure to Obj 1-20.
4. Choose **Create Request ZIP** and confirm the Google Colab data-flow notice.
5. Open [Seg CT/MRI](https://satorumuro.github.io/SegRef3D/ColabNotebooks/segctmri.html).
6. Upload `<source-folder>_instant3d_request.zip` to your own Colab runtime and run the notebook.
7. Download `instant3d_result.zip`, then choose **Import Result ZIP** in SegRef3D Lite.
8. Select Replace or Merge when target objects already contain labels, then refine the masks.

The request contains the exact source NIfTI, selected structures, Obj mappings, and a geometry
fingerprint. Import verifies dimensions, voxel spacing, affine/orientation, and SHA-256 before
changing masks. The labelmap is converted back to the same editable slice order in one Undo-able
transaction. Binary per-ROI NIfTI files remain the backend source of truth; where structures
overlap in the combined single-label map, the lower Obj ID has priority and the overlap is reported.

Seg CT/MRI uses TotalSegmentator in Google Colab; it does not run in the browser and is not
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

## Browser limits

SegRef3D Lite processing and export are browser-local. Seg Anything and Seg CT/MRI are separate and
require the user to explicitly upload their image-containing input ZIP to Google Colab. Very large TIFF stacks, all-frame
cleanup, interpolation, and mesh generation can require substantial browser memory. SegRef3D Lite warns
before unusually large TIFF imports and uses progress states and yielded processing for long
operations. Use the Windows build for datasets that exceed the browser's available memory.
