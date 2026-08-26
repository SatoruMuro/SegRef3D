# SegRef3D Lite Web

Browser-based, local-first image mask editor derived from the non-SAM2 workflow in SegRef3D.

Public beta: <https://satorumuro.github.io/SegRef3D/lite-web/>

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

Lite Web includes two demos that use the same loading, mask-editing, and export pipelines as user data:

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
was converted to NIfTI and reoriented for SegRef3D Lite Web demo use; the original data providers
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
- Use the Objects panel as the current-target selector, with visibility, rename, relabel, merge,
  and object-only clear actions
- Configure one tracking range and multiple box-prompt keyframes per Seg on Web object
- Export `segonweb_input.zip` and import the complete `segref3d_result.zip` returned by Colab
- Plain wheel image navigation, Ctrl/Command+wheel zoom, Shift+wheel horizontal pan
- Middle-button drag and WASD/arrow-key canvas pan
- Label visibility controls
- Label PNG and visible-overlay PNG sequence export as ZIP
- NIfTI label-volume and multi-page TIFF stack export
- Multi-page TIFF and naturally sorted TIFF-folder import for 8-bit grayscale, 16-bit grayscale,
  and RGB data
- 1x/5x/10x signed-distance slice interpolation and binary STL export
- Editable signed-distance interpolation between two labeled key slices
- Mask Cleanup for the current frame, a frame range, or all frames: Fill Holes, Remove Small
  Islands, Keep Largest Component, Smooth Boundary, Dilate, and Erode
- Per-object Volume Statistics with voxel count, calibrated mm³/cm³, occupied range, and CSV export
- Shared-mesh Three.js STL preview with rotate, pan, zoom, camera reset, visibility, and opacity
- Project Check for dimensions, spacing, labels, isolated components, numbered-frame gaps, and
  Seg on Web prompt/range validity
- Responsive desktop/mobile layout and offline cache

### Local processing and data flow

- Source images loaded into Lite Web are processed locally in the browser and are not uploaded
  to SegRef3D servers.
- Mask autosave uses browser-local IndexedDB storage.
- Label PNG, overlay, Project ZIP, NIfTI, TIFF, CSV, and STL exports are generated locally and
  downloaded directly to the user's device.
- Lite Web does not operate an image-upload API, analytics pipeline, or telemetry service.

Seg on Web is the explicit exception to this browser-local workflow. It is a separate Google
Colab workflow for SAM2 segmentation. The generated `segonweb_input.zip` includes the working
image sequence and Seg on Web job settings. The user explicitly uploads that ZIP to their own
Google Colab runtime; SegRef3D does not operate an intermediate image-upload server. Institutional
research-data or privacy rules may restrict uploading research or medical data to Google Colab,
so users should confirm that this use is permitted before continuing.

Project ZIP files do not contain the source images. Load the original image folder first, then
open the Project ZIP from **Open > Masks / Project ZIP** to restore its masks and editor settings.

VolInfo CSV uses the same six-row `Width/Height/Depth`, `X/Y/Z Spacing`, and `X/Y/Z Origin`
format as the Windows app. Imported spacing is used by NIfTI and STL export, and origin is written
to the NIfTI sform. A CSV is
downloaded automatically after DICOM/NIfTI loading and after reference-line calibration; the
Calibration tab also provides manual Import/Export controls.

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

### Seg on Web workflow

1. Load an image sequence in SegRef3D Lite Web.
2. Open **AI Segmentation > Edit Setup** in the Tools dock.
3. Define the tracking range for each object.
4. Move to useful keyframes and add one or more box prompts with **Add Box Prompt Here**.
5. Return to **AI Segmentation** and choose **Create Input ZIP**.
6. Choose **Open Seg on Web**, run all Colab cells, and upload the ZIP in the first upload cell.
7. Download the generated `segref3d_result.zip`.
8. Choose **AI Segmentation > Import AI Result** in Lite Web.
9. Refine the returned masks, run **Tools > Check Project**, and export measurements or 3D data.

Opening Seg on Web displays a confirmation before leaving the browser-local workflow. Creating
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
sequence is already open, Lite Web verifies frame count, order, dimensions, and filenames before
replacing masks.

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

Lite Web processing and export are browser-local. Seg on Web is separate and requires the user to
explicitly upload its image-containing input ZIP to Google Colab. Very large TIFF stacks, all-frame
cleanup, interpolation, and mesh generation can require substantial browser memory. Lite Web warns
before unusually large TIFF imports and uses progress states and yielded processing for long
operations. Use the Windows build for datasets that exceed the browser's available memory.
