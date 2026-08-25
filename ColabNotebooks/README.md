
# SegOnWeb Colab Notebooks

## Current SegRef3D Job Workflow

Use `SegOnWebJob_v1_0.ipynb` for the Gradio-free SegRef3D segmentation job workflow.
The public redirect is `segonweb.html`.

1. Configure Batch Tracking objects in SegRef3D GPU.
2. Export `segonweb_input.zip`.
3. Open the notebook and select a T4 GPU.
4. Run all cells and upload the input ZIP in the first executable cell.
5. Leave the notebook running while setup and SAM2 processing continue.
6. Download `segref3d_result.zip` and import it into SegRef3D.

`segonweb_backend.py` contains the ZIP-to-SAM2 orchestration. It intentionally uses
the SAM2 execution path proven in `SAM2GUIforImgSeqv4_8.ipynb`:

- SAM2 commit `2b90b9f5ceec907a1c18123530e92e794ad901a4`
- `sam2.1_hiera_large.pt`
- `configs/sam2.1/sam2.1_hiera_l.yaml`
- `build_sam2_video_predictor`
- `add_new_points_or_box`
- forward propagation plus reversed-frame backward propagation
- `mask_logits > 0.0`

The v4.8 notebook remains in this directory as the reference implementation and
legacy Gradio workflow. Do not remove it until the new Colab workflow has completed
its release validation.

The shared archive schema is documented in
`SegRef3D/docs/SEGONWEB_JOB_FORMAT.md` and implemented by
`SegRef3D/segmentation_job.py`.
