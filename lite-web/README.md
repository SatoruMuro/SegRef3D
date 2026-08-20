# SegRef3D Lite Web

Browser-based, local-first image mask editor derived from the non-SAM2 workflow in SegRef3D.

Public beta: <https://satorumuro.github.io/SegRef3D/lite-web/>

## Current MVP

- Load naturally sorted JPG/PNG image folders
- Optional resize for images larger than 2000 px
- Optional shared white canvas for mixed image dimensions
- Edit 20 single-label objects with Free, Click, and edge Snap drawing
- Add, Erase, and Transfer label operations
- Separate Undo/Redo histories for drawn lines and committed mask edits
- Browser autosave with IndexedDB
- Load grayscale label PNG sequences from a folder or ZIP, with value and dimension checks
- Export and restore Project ZIP files containing label masks and editor settings
- Plain wheel image navigation, Ctrl/Command+wheel zoom, Shift+wheel horizontal pan
- Middle-button drag and WASD/arrow-key canvas pan
- Label visibility controls
- Label PNG and visible-overlay PNG sequence export as ZIP
- Responsive desktop/mobile layout and offline cache

All image processing happens locally in the browser. Images are not uploaded.

Project ZIP files do not contain the source images. Load the original image folder first, then
open the Project ZIP from **Load Masks** to restore its masks and editor settings.

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
- TIFF and NIfTI import/export
- 5x/10x signed-distance slice interpolation
- STL generation and Three.js preview
