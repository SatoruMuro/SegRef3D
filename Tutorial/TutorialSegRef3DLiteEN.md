# SegRef3D Lite Basic Tutorial

This getting-started guide uses the 20-image **Apple Demo** to take you through loading, calibration, mask creation, refinement, 3D preview, and saving. You do not need Python, command-line experience, or software installation.

> This is an operation exercise. The apple mask produced here is not intended to be a complete research-grade segmentation.

## 0. What is SegRef3D Lite?

SegRef3D Lite is the standard entry point for SegRef3D. It runs in a modern browser on Windows, macOS, and Linux and supports JPG, PNG, TIFF, DICOM, and NIfTI input; mask editing; calibration; measurements; 3D reconstruction; NIfTI, TIFF, STL, and CSV export; and optional AI workflows. Normal editing and export operations run on your device.

## 1. Open SegRef3D Lite

[**Open SegRef3D Lite**](https://satorumuro.github.io/SegRef3D/lite-web/)

Chrome or Edge is a practical first choice when you need image-folder selection. Other modern browsers can also work, although folder dialogs differ between browsers.

![SegRef3D Lite start screen](images/SegRef3DLite/01-segref3d-lite-start.png)

The top bars contain image and editing commands, the center is the main canvas, and the Objects panel appears beside or below it. Select `Local Processing` at the upper right to review where processing takes place.

## 2. Open the Apple Demo

Select `Load Apple Demo` in the center of the start screen.

![Select Apple Demo](images/SegRef3DLite/02-apple-demo-select.png)

SegRef3D Lite loads the 20-image `Apple Demo - Kanzi 84` sequence. An apple cross-section and a frame counter such as `1 / 20` appear.

![Apple Demo loaded](images/SegRef3DLite/03-apple-demo-loaded.png)

## 3. Basic navigation

- Use the upper Previous/Next arrows or the slice controls below the canvas.
- A plain mouse wheel moves through the image sequence.
- `Ctrl`/`Command` + wheel zooms the image.
- While zoomed, hold the middle mouse button and drag to pan.
- Select the editing object with `Target` or in the Objects panel. This guide uses `Obj 1`.
- The Fit icon returns the whole image to the canvas.

## 4. Calibration

Move to a central frame where the apple is widest, then open `Tools` → `Calibration`. The Apple Demo guide provides:

- `Reference length`: **100 mm**
- `Z spacing`: **4.0 mm (approx.)**

Select `Draw Reference Line`, then click two endpoints across the widest apple diameter. A guide line follows the pointer after the first point.

![Apple Demo calibration](images/SegRef3DLite/04-calibration.png)

**The 100 mm value is an assumed apple diameter for demonstration purposes, not a measurement of this specimen.** The source dataset describes the slice spacing as roughly 4 mm. SegRef3D Lite uses the resulting mm/px and Z spacing for measurements, volume calculations, NIfTI, and STL.

## 5. Select Obj 1

Select `Obj 1` in the Objects panel or the top `Target` control and keep its visibility enabled. In a label mask, 0 is background and 1 is Obj 1. Up to 20 objects can be managed with separate display colors.

## 6. Create the apple mask

For this demo, Threshold is a reproducible starting point because the apple flesh is bright and the surrounding background is dark.

1. Open `Tools` → `Extract`.
2. Set Threshold `Minimum` to `180` and `Maximum` to `255`.
3. Set `Operation` to `Add` and `Images` to `All`.
4. Select `Apply Threshold`.

These values are a demo starting point. Adjust them to the intensity distribution of your own images.

![Create the apple mask](images/SegRef3DLite/05-create-mask.png)

## 7. Refine with Add and Erase

Close Tools and choose the `Click` draw mode. Left-click points around a region. At the final point, **right-click**; that point becomes the endpoint and is joined to the start.

- Add the drawn region: `Add`
- Remove the drawn region: `Erase`
- Undo a mask edit: Undo in the `EDIT` group
- Redo the edit: Redo in the `EDIT` group

The Undo/Redo controls in the `LINE` group affect only drawn lines and are separate from mask edit history.

![Edit a mask with Add and Erase](images/SegRef3DLite/06-edit-mask.png)

## 8. Mask Cleanup

Threshold may also select small bright regions outside the apple. Use one representative cleanup operation:

1. Open `Tools` → `Mask Cleanup`.
2. Choose `Obj 1`.
3. Choose `Keep Largest Component`.
4. Set `Frames` to `All Frames`.
5. Select `Apply Cleanup`.

This keeps the largest connected region in each frame and removes detached selections. Use mask edit Undo if the result is not appropriate.

![Mask Cleanup](images/SegRef3DLite/07-mask-cleanup.png)

## 9. Inspect multiple slices

Move through adjacent frames and check that the red Obj 1 overlay follows the apple boundary. You do not need to perfect all 20 slices for this tutorial. The goal is to understand how consecutive 2D masks become a 3D volume.

## 10. Preview in 3D

Open `Tools` → `Volume & 3D`. In the STL section choose:

- `Slice interpolation`: `5x`
- `Objects`: `Current target`

Select `Preview 3D`. SegRef3D Lite stacks the 2D masks into a voxel volume and displays its surface.

![Apple 3D preview](images/SegRef3DLite/08-3d-preview.png)

Drag to rotate, use the wheel to zoom, and select `Reset Camera` to return to the initial view.

## 11. Choose an export

| Goal | Recommended export |
| --- | --- |
| Resume later in SegRef3D Lite | `Project ZIP` |
| Send labels to 3D Slicer or similar software | `NIfTI Labelmap` |
| Save mask images | `Label PNG` or `TIFF` |
| Use a 3D surface model | `STL` |
| Save object volume values | `Volume Statistics CSV` |

Use the top `Export` menu or `Tools` → `Volume & 3D`.

![Export options](images/SegRef3DLite/09-export.png)

## 12. Save and resume with Project ZIP

Choose `Export` → `Project ZIP`. The archive contains the working images, label masks, display settings, and calibration settings.

To resume, choose `Open` → `Masks / Project ZIP`, then open the saved Project ZIP. When importing masks into an existing project, choose `Replace` or `Merge` in the prompt according to your goal.

Browser autosave can help restore masks on the same browser and device, but it is not a replacement for a portable backup. **Save a Project ZIP explicitly** in case browser data is cleared or you change environments.

## 13. NIfTI, STL, and CSV

- **NIfTI Labelmap** is intended for labels/segmentations in applications such as 3D Slicer.
- **STL** is a 3D surface model for viewers, CAD, or 3D-printing workflows.
- **Volume Statistics CSV** contains object voxel counts, mm³, cm³, and frame counts.

NIfTI and STL can optionally use 5x or 10x interpolation along the slice direction. Start with the 5x preview and verify the shape and calibration.

## 14. AI segmentation

Basic editing works without AI. Two Google Colab workflows are available when needed.

### Seg Anything

Segment an arbitrary user-specified structure with a SAM-based workflow. Define Box Prompts, Prompt Frames, and Tracking Ranges in SegRef3D Lite, then use `Create Input ZIP` → Google Colab → `Import Result ZIP`. See the [Seg Anything tutorial](TutorialSegOnWebEN.md).

### Seg CT/MRI

Use TotalSegmentator for supported known anatomy in a CT/MRI NIfTI volume. Select anatomy, create a request ZIP, process it in Google Colab, and import the result ZIP.

![AI Segmentation tools](images/SegRef3DLite/10-ai-segmentation.png)

## 15. Your data and privacy

During normal SegRef3D Lite use, image display, mask editing, calibration, measurements, NIfTI/TIFF export, and STL generation are processed in your browser on your device. Normal operations do not automatically upload source images to a SegRef3D-operated server.

`Seg Anything` and `Seg CT/MRI` are different. When using their Google Colab workflows, you explicitly upload job data containing the working images or source NIfTI to your Google Colab runtime. Check that this is permitted by your institution's research-data and privacy policies before using research or medical data.

## 16. Troubleshooting

### Images do not load

Check for JPG, PNG, TIFF, DICOM (with or without `.dcm`), or NIfTI (`.nii`/`.nii.gz`). SegRef3D Lite asks you to select a series when a DICOM folder contains multiple series.

### The browser becomes slow

Large volumes, many high-resolution images, and 5x/10x 3D operations can use substantial memory. Close unused tabs and begin with 1x or the current target only.

### The 3D model looks stretched or compressed

Check X/Y spacing, Z spacing, and the calibration line. DICOM and NIfTI input uses source geometry when it is available.

### I closed the browser

Loading the same images in the same browser may restore masks from browser autosave. Use a saved Project ZIP for reliable, portable resumption.

### I want to use 3D Slicer

Use `NIfTI Labelmap`. In 3D Slicer, load it as a Segmentation to handle object labels as separate segments.

## Demo data

Apple Demo images are adapted from: Schut DE, Trull AK, Couvée M. *Dataset of CT scans, slice photographs, and visual browning scores of 120 'Kanzi' apples.* Zenodo. [https://doi.org/10.5281/zenodo.8167285](https://doi.org/10.5281/zenodo.8167285)

Source dataset license: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Images were selected, cropped, resized to 1000 × 944 pixels, and JPEG-compressed for the SegRef3D demo. The original data providers do not endorse SegRef3D.

---

[日本語版](TutorialSegRef3DLiteJP.md) · [Seg Anything](TutorialSegOnWebEN.md) · [Registration](Registration.md)
