# SegRef3D Lite Web

Browser-based, local-first image mask editor derived from the non-SAM2 workflow in SegRef3D.

Public beta: <https://satorumuro.github.io/SegRef3D/lite-web/>

## Current MVP

- Load naturally sorted JPG/PNG image folders
- Load DICOM folders with `.dcm` or extensionless files
- Load NIfTI-1/NIfTI-2 `.nii` and `.nii.gz` volumes as editable slice sequences
- Optional resize for images larger than 2000 px
- Optional shared white canvas for mixed image dimensions
- Edit 20 single-label objects with Free, Click, and edge Snap drawing
- Add, Erase, and Transfer label operations, with optional Auto Add/Erase/Transfer on path completion
- Separate Undo/Redo histories for drawn lines and committed mask edits
- Post-load window/level, brightness, and contrast controls
- Non-modal Image Tools with in-panel frame navigation so the source image remains visible
- Threshold and clicked-color RGB extraction for the current image or full sequence
- Pixel and slice-spacing calibration, including two-point reference-line calibration
- Live crosshair, line, endpoint, and pixel-distance guides while placing a calibration line
- Desktop-compatible VolInfo CSV import/export with automatic export for DICOM/NIfTI and reference-line calibration
- Browser autosave with IndexedDB
- Load grayscale label PNG sequences with Replace/Merge modes and clear all project masks
- Export and restore Project ZIP files containing label masks and editor settings
- Configure multiple SegOnWeb jobs with an object name, Box Prompt, Prompt Frame, and Tracking Range
- Export `segonweb_input.zip` and import the complete `segref3d_result.zip` returned by Colab
- Plain wheel image navigation, Ctrl/Command+wheel zoom, Shift+wheel horizontal pan
- Middle-button drag and WASD/arrow-key canvas pan
- Label visibility controls
- Label PNG and visible-overlay PNG sequence export as ZIP
- NIfTI label-volume and multi-page TIFF stack export
- 1x/5x/10x signed-distance slice interpolation and binary STL export
- Responsive desktop/mobile layout and offline cache

All Lite Web image processing happens locally in the browser. Seg on Web is a separate Google
Colab workflow where users explicitly upload images for SAM2 segmentation.

Project ZIP files do not contain the source images. Load the original image folder first, then
open the Project ZIP from **Load Masks** to restore its masks and editor settings.

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

1. Load the image sequence and open **Batch Jobs**.
2. Keep **Batch Jobs** open, move through the sequence with the mouse wheel or F/R, and use
   **Use current** to capture the Tracking Start/End frames.
3. Choose **Set Box on Canvas** and use the crosshair guides to set each object's Box Prompt.
4. Download `segonweb_input.zip` with **Export SegOnWeb**.
5. Open **Seg on Web**, run all cells, and upload that one ZIP at the first upload cell.
6. Leave the notebook running, then download `segref3d_result.zip` and open it with **Import Result**.
7. Refine the returned masks and continue to volume or STL export.

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

## Planned expansion

- TIFF volume import
- Three.js STL preview
- Volume statistics per object as CSV
