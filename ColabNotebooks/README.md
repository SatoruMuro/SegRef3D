
# SegRef3D AI Segmentation Notebooks

## TrainRef3D — custom binary model training

Use `TrainRef3D_v1_0.ipynb` through [trainref3d.html](trainref3d.html). Assemble multiple
SegRef3D Training ZIPs in the separate [TrainRef3D Web app](../train-web/README.md), select
one target Obj ID and confirm complete annotation, then explicitly upload the Dataset ZIP
to your own Colab T4 runtime. The notebook delegates validation, preprocessing, MONAI 3D
U-Net training, best checkpoints, foreground Dice and versioned Model ZIP output to
`trainref3d_backend.py`. Config is editable in the first code cell; download has its own
  final cell. No automatic image upload is added.

CPU units: `python -m unittest discover -s ColabNotebooks/tests -p "test_trainref3d_backend.py"`.
Separate CPU/GPU mechanical smoke test: `tests/run_trainref3d_smoke.py` (add `--gpu` for CUDA).
See the [format and optional GPU validation guide](../train-web/README.md) for dependencies,
safety limits, one-case resubstitution policy and model schema. Images and names may remain
identifiable; follow institutional upload rules. Internal validation Dice does not establish
clinical validity or generalizability.

## InferRef3D — custom binary model inference

Use `InferRef3D_v1_0.ipynb` through [inferref3d.html](inferref3d.html). In SegRef3D Lite,
select a trusted TrainRef3D Model ZIP and create one source-bound Inference Request ZIP. The
notebook explicitly uploads both archives to the user's own Colab runtime, validates their hashes
and manifests, loads `model.pt` with `torch.load(..., weights_only=True)`, reconstructs the MONAI
UNet, and reproduces the model manifest's RAS/spacing/intensity/sliding-window contract.

The class-1 output is mapped to the saved target Obj ID and nearest-neighbor resampled to the
request's exact original shape/affine, including oblique anisotropic grids. The Result ZIP contains
only `prediction.nii.gz`, `inference_result.json`, and `README.txt`; it includes source/model/prediction
hashes, geometry, runtime versions and backend source SHA. Import it through Lite's Custom Model
panel for protected Merge/Replace, one-step Undo, review, correction, and Training Data re-export.
No file is uploaded automatically. Predictions are not independent clinical diagnoses.

CPU units: `python -m unittest discover -s ColabNotebooks/tests -p "test_inferref3d_backend.py" -v`.
Mechanical CPU/T4 path: `tests/run_inferref3d_smoke.py` (add `--gpu` for CUDA/AMP). Format details:
[`TRAINREF3D_INFERENCE_FORMAT.md`](../docs/TRAINREF3D_INFERENCE_FORMAT.md).

## Seg Anything

Use `SegOnWebJob_v1_0.ipynb` for the Gradio-free Seg Anything workflow.
The public redirect is `segonweb.html`.

1. Configure **AI Tracking Setup** objects in SegRef3D Lite or Batch Tracking in SegRef3D Local.
2. Export `segonweb_input.zip`.
3. Open the notebook and select a T4 GPU.
4. Run all cells and upload the input ZIP in the first executable cell.
5. Leave the notebook running while setup and SAM2 processing continue.
6. The final, separate download cell automatically starts the `segref3d_result.zip` download.
7. Import the downloaded ZIP into SegRef3D.

`segonweb_backend.py` contains the ZIP-to-SAM2 orchestration. It intentionally uses
the SAM2 execution path proven in `SAM2GUIforImgSeqv4_8.ipynb`:

- SAM2 commit `2b90b9f5ceec907a1c18123530e92e794ad901a4`
- `sam2.1_hiera_large.pt`
- `configs/sam2.1/sam2.1_hiera_l.yaml`
- `build_sam2_video_predictor`
- `add_new_points_or_box`
- forward propagation plus reversed-frame backward propagation
- `mask_logits > 0.0`

One object may contain multiple frame-sorted box prompts. The backend uses **Strategy A**: every
prompt for that object is registered with the same SAM2 inference state before propagation. For
backward tracking it creates a reversed range-local sequence and remaps every original prompt
frame into that sequence. Prompt-frame masks returned by `add_new_points_or_box` are retained,
forward results take precedence over backward results on directional overlap, and later objects
overwrite earlier objects in the final single-label mask.

The archive remains `segref3d-segjob-1.0`. Legacy `prompt_frame`/`box` fields mirror the first
item in `prompts`, so existing single-prompt input and result ZIP files remain supported.

`tests/run_real_sam2_phase1.py` provides the separate GPU smoke test. It checks reference
single-prompt behavior, a two-keyframe object, independent multi-object ranges, and validated
result ZIP generation. The automated unit tests use a fake predictor so CI does not download a
checkpoint or require a GPU.

The v4.8 notebook remains in this directory as the reference implementation and
legacy Gradio workflow. Do not remove it until the new Colab workflow has completed
its release validation.

The shared archive schema is documented in
`SegRef3D/docs/SEGONWEB_JOB_FORMAT.md` and implemented by
`SegRef3D/segmentation_job.py`.

## Seg CT/MRI

Use `Instant3DWeb2.ipynb` for the Gradio-free CT structure workflow. The public launcher is
`segctmri.html`. The former `instant3dweb2.html` URL remains as a compatibility redirect.
`instant3dweb2_backend.py` contains request validation, task grouping,
TotalSegmentator invocation, geometry-aware output handling, and result ZIP generation.

1. Create `instant3d_request.zip` in SegRef3D Local or SegRef3D Lite.
2. Open the Seg CT/MRI launcher and select a T4 GPU runtime when available.
3. Upload the request ZIP in the first executable upload cell.
4. Run validation before TotalSegmentator is installed or invoked.
5. Run the grouped open-license tasks and create `instant3d_result.zip`.
6. Use the separate final cell to start the browser download automatically.
7. Import the result into the same source NIfTI volume in SegRef3D.

The backend rejects unsafe ZIP paths, malformed manifests, unsupported ROI/task combinations,
duplicate Obj mappings, and license-restricted tasks. It preserves binary ROI NIfTI outputs as
the source of truth, resamples only when TotalSegmentator returns a different grid, and records
overlap and runtime versions in the result manifest. The merged single-label map uses lower Obj ID
priority on overlap. Real TotalSegmentator inference requires a Colab GPU smoke test and is not
part of the CPU-only automated unit suite.
