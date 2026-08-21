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
- Add, Erase, and Transfer label operations
- Separate Undo/Redo histories for drawn lines and committed mask edits
- Browser autosave with IndexedDB
- Load grayscale label PNG sequences with Replace/Merge modes and clear all project masks
- Export and restore Project ZIP files containing label masks and editor settings
- Open Seg on Web in Colab and import its returned label masks for manual refinement
- Plain wheel image navigation, Ctrl/Command+wheel zoom, Shift+wheel horizontal pan
- Middle-button drag and WASD/arrow-key canvas pan
- Label visibility controls
- Label PNG and visible-overlay PNG sequence export as ZIP
- Responsive desktop/mobile layout and offline cache

All Lite Web image processing happens locally in the browser. Seg on Web is a separate Google
Colab workflow where users explicitly upload images for SAM2 segmentation.

Project ZIP files do not contain the source images. Load the original image folder first, then
open the Project ZIP from **Load Masks** to restore its masks and editor settings.

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

JPEG-LS, JPEG 2000, RLE, other compressed DICOM transfer syntaxes, and 4D NIfTI volumes are
currently rejected with a clear error instead of being rendered incorrectly.

### Seg on Web workflow

Open **Seg on Web** first, upload the image sequence to Google Colab, and run SAM2 to create rough
label masks. Download the Label mask PNG ZIP, then load it together with the same source images in
Lite Web and use **Load Masks** to refine the segmentation.

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

- Threshold and RGB extraction
- TIFF import/export and NIfTI export
- 5x/10x signed-distance slice interpolation
- STL generation and Three.js preview
