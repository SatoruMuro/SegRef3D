# SliceBridge User Guide

**SliceBridge** is a web app that inserts blank slices between the contours in
a NIfTI label map exported from SegRef3D. It creates anchor-slice data that can
then be interpolated using 3D Slicer's **Fill between slices** effect.

## 🌉 Open SliceBridge

👉 **[SegRef3D SliceBridge](https://satorumuro.github.io/SegRef3D/slice-bridge/)**

🇯🇵 [日本語版の使用方法](https://satorumuro.github.io/SegRef3D/Tutorial/SliceBridgeJP.html)

Your files are never uploaded to a server. Reading, conversion, compression,
and download all take place locally in your browser.

---

## What this tool does

For example, suppose the original NIfTI has the following properties:

- Image size: `896 × 896 × 22`
- Z spacing: `6.5 mm`
- Subdivision factor: `10`

After conversion with SliceBridge, the output NIfTI will have:

- Image size: `896 × 896 × 211`
- Z spacing: `0.65 mm`
- Original contours: placed unchanged at slices 0, 10, 20, and so on
- Nine blank slices inserted between each pair of original contours

The original label values, origin, orientation, and physical extent are
preserved.

> SliceBridge does not interpolate the anatomical shapes.
>
> It prepares blank slices so that interpolation can be performed in 3D Slicer.

---

## Recommended environment

- Latest Google Chrome or Microsoft Edge on Windows or macOS
- A three-dimensional integer label map in NIfTI-1 format
- Supported extensions: `.nii` and `.nii.gz`

---

## 1. Export a NIfTI file from SegRef3D

After checking and editing the segmentation in SegRef3D, export the label map
using `Export NIfTI`.

If you need the slice order reversed, use `Export NIfTI (Reversed)` in
SegRef3D. SliceBridge preserves the orientation and origin stored in the input
NIfTI.

---

## 2. Load the NIfTI file into SliceBridge

1. Open [SliceBridge](https://satorumuro.github.io/SegRef3D/slice-bridge/).
2. Drag and drop a `.nii` or `.nii.gz` file onto the page.
3. Check the displayed image dimensions, voxel spacing, data type, and label
   values.

---

## 3. Configure the blank slices

### Slice axis

In most cases, you can leave this set to `Auto-detect`. SliceBridge
automatically selects the axis with the largest voxel spacing. You can also
select the X, Y, or Z axis manually.

### Subdivision factor

Specify how many intervals should be created from each original slice interval.

- A factor of `10` inserts nine blank slices between the original contours.
- Output spacing = original spacing ÷ 10.

Check the displayed output spacing, image dimensions, and estimated data size.

---

## 4. Create the Anchor NIfTI

1. Click `Create Anchor NIfTI`.
2. Wait until the progress reaches 100%.
3. Click `Download` to save the generated `.nii.gz` file.

Example output filename:

```text
segref3d_labelmap_anchor_z0p65mm.nii.gz
```

---

## 5. Interpolate in 3D Slicer

### 5-1. Load the NIfTI as a Volume

1. Open `Add data` in 3D Slicer.
2. Select the `.nii.gz` file downloaded from SliceBridge.
3. Set `Description` to `Volume` and load the file.

### 5-2. Open Segment Editor

1. Open the `Segment Editor` module.
2. Select the loaded NIfTI under `Source volume`.
3. Click `Add` to create an empty segment.

### 5-3. Extract label value 1

1. Select the new segment.
2. Select the `Threshold` effect.
3. Set both limits of `Threshold Range` to `1.00`.
4. Click `Apply`.

Only voxels with label value `1` are now assigned to the first segment.

### 5-4. Extract the other integer label values

Create a separate segment for each integer label value.

1. Click `Add` again to create another empty segment.
2. Select `Threshold`.
3. For label value `2`, set the range to `2.00–2.00` and click `Apply`.
4. For label value `3`, add another segment, set the range to
   `3.00–3.00`, and click `Apply`.
5. Repeat for every integer label value contained in the NIfTI.

```text
Label 1: Add → Threshold → 1.00–1.00 → Apply
Label 2: Add → Threshold → 2.00–2.00 → Apply
Label 3: Add → Threshold → 3.00–3.00 → Apply
```

You only need to create segments for the integer values listed under
`Labels` in SliceBridge. Rename the segments as needed, for example pelvis,
obturator internus, and levator ani.

### 5-5. Interpolate all visible segments together

`Fill between slices` processes all segments whose eye icons are on, not only
the segment highlighted in blue.

1. Turn on the eye icon for every segment that you want to interpolate.
2. Select `Fill between slices`.
3. Click `Initialize` and inspect the preview for all visible segments.
4. If the result is acceptable, click `Apply` once.

```text
Show Segment_1, Segment_2, and Segment_3
→ Fill between slices → Initialize → Apply (once each)
```

The visibility state determined by the eye icons controls which segments are
processed. To interpolate only a subset, hide the other segments before
clicking `Initialize`. This interpolation uses the segment shapes, not source
volume intensities.

---

## Notes

- SliceBridge does not modify the original anchor contours.
- Always inspect the result in both the original image planes and the 3D view.
- Correct any unnatural interpolation in 3D Slicer's Segment Editor.
- Closing the browser tab discards the loaded data and converted result from
  the browser.
- Large datasets may require several hundred megabytes or more of memory during
  conversion.

---

## Unsupported data

- NIfTI-2
- Two-file `.hdr`/`.img` datasets
- Four-dimensional or higher-dimensional NIfTI data
- Floating-point label maps

Convert these datasets to a three-dimensional NIfTI-1 integer label map in 3D
Slicer or another application before using SliceBridge.

---

## Related links

- [SegRef3D GitHub repository](https://github.com/SatoruMuro/SegRef3D)
- [SliceBridge source code](https://github.com/SatoruMuro/SegRef3D/tree/main/slice-bridge)
