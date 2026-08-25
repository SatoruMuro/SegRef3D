# Seg on Web: SegRef3D Job Workflow

SegOnWeb uses a Google Colab GPU as a computation backend. All prompt configuration
is performed in SegRef3D; there is no separate Gradio interface.

## 1. Configure Objects In SegRef3D

1. Load the image sequence in SegRef3D GPU.
2. Select an object ID under **Target Object**.
3. Move to a frame where the object is clear and choose **Set Box Prompt**.
4. Draw the box around the object. This frame becomes its Prompt Frame.
5. Move to the first desired frame and choose **Set Tracking Start**.
6. Move to the last desired frame and choose **Set Tracking End**.
7. Choose **Add Object Prompt**.
8. Repeat for other objects.

Open **Extensions > Batch Tracking > Batch Jobs** to review names, Prompt Frames,
Tracking Ranges, and box coordinates. Prompt Frame must be inside its Tracking Range.

## 2. Export The Job

Under **Extensions > Batch Tracking**, choose **Export for SegOnWeb** and save
`segonweb_input.zip`. It contains the working JPG sequence and `manifest.json`.

## 3. Run SegOnWeb

1. Choose **Seg on Web** in SegRef3D, or open
   [Seg on Web](https://satorumuro.github.io/SegRef3D/ColabNotebooks/segonweb.html).
2. In Colab, select **Runtime > Change runtime type > T4 GPU > Save**.
3. Select **Runtime > Run all**.
4. Upload `segonweb_input.zip` when the upload control appears.
5. Leave the notebook open while it processes every object forward and backward.
6. At **Segmentation complete**, choose the `segref3d_result.zip` download link.

The progress display shows the current step, object, frame, and overall progress.

## 4. Import The Result

1. Return to SegRef3D.
2. Under **Extensions > Batch Tracking**, choose **Import SegOnWeb Result**.
3. Select `segref3d_result.zip`.
4. Confirm replacement if the current project already contains label masks.

SegRef3D validates the image sequence and masks before applying them. If no images
are currently loaded, the JPG sequence in the result ZIP is restored automatically.
Imported masks are immediately written to a new `[autosave]` label PNG folder.

## 5. Refine And Reconstruct

Use the normal SegRef3D tools to add, erase, transfer, relabel, interpolate, measure,
and export NIfTI, TIFF, STL, overlay PNG, or volume CSV files.

The mask PNGs are single-channel label images: `0` is background and `1` through
`20` are object IDs.

## Troubleshooting

- Invalid ZIP or missing manifest: export the job again from SegRef3D.
- Prompt Frame outside Tracking Range: edit the object in **Batch Jobs**.
- CUDA/model error: confirm that the Colab runtime is using a T4 or another GPU, then
  choose **Runtime > Disconnect and delete runtime** and run all cells again.
- Interrupted processing: rerun all cells and upload the same input ZIP again.
