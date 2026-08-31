# TrainRef3D MVP — local implementation report

Validated 2026-08-31 / 2026-09-01 on Windows, Python 3.12, Node 22+, PyTorch 2.8.0+cpu,
MONAI 1.5.1 and nibabel 5.3.2. Starting main/HEAD:
`c6269e0fa92147fd6346b7f798cab73a1e284f7b`.

**Local implementation and CPU/browser workflow validated. No commit or push performed.**
Full release validation remains open: Colab T4 has not been exercised; five existing
desktop UI test modules cannot load VTK under this machine's application-control policy.

## 1. Files

New:

- `train-web/index.html`, `app.mjs`, `styles.css`, `dataset-format.mjs`, `dataset-worker.mjs`
- `train-web/README.md`, `LOCAL_VALIDATION.md`
- `train-web/tests/dataset-format.test.mjs`, `generate-fixtures.mjs`
- `shared/training-case.mjs`, `training-archive.mjs`
- `ColabNotebooks/trainref3d.html`, `TrainRef3D_v1_0.ipynb`, `trainref3d_backend.py`, `trainref3d-requirements.txt`
- `ColabNotebooks/tests/test_trainref3d_backend.py`, `test_trainref3d_training.py`, `trainref3d_fixtures.py`, `run_trainref3d_smoke.py`
- `.github/workflows/trainref3d.yml`

Documentation updates only in existing files: `README.md`, `READMEJP.md`,
`lite-web/README.md`, `ColabNotebooks/README.md`, `CHANGELOG.md`, `llms.txt`, `llms-full.txt`.

Existing Lite/desktop runtime, geometry, export, service-worker and LFS files are unchanged.
The unchanged executable's SHA256 remains
`b573cb3894c78c46a9e9aa9d1772479822bee6043398c4460f439de8732d24ec`.
Test dependencies, synthetic ZIPs and model artifacts live outside the tracked source
set, primarily under ignored `.venv-train/`. Nothing was staged.

## 2–6. Web UI, dataset schema, target, completeness and validation

The separate dark/responsive TrainRef3D page supports multiple ZIP selection and drop
handling, local Worker validation, case rows, source/channel/shape/spacing/label/intensity
status, failed-case reasons and exclusion/removal. It has no upload or telemetry transport.

`trainref3d-dataset-1.0` records a random dataset ID, uniform channel count/source category,
selected original Obj ID/name, complete-for-selected-target policy, nested case ZIP paths,
and privacy declarations. Original `segref3d-training-case-1.0` ZIP bytes are retained.

Target selection is the sparse Obj ID/name union. Same-ID conflicting names warn; the
user sets the canonical target name. No renumbering. Confirmation is mandatory and
resets on case/target/name changes. Missing selected-target voxels mean a true negative.
An all-negative dataset with no selectable target is rejected.

Validation independently checks archive sizes, file counts, safe/unique paths, exact
members and CRC, manifest format, channel order, integer label data and actual IDs,
finite voxels, NIfTI-1/2 and bounded gzip. Image/label/manifest shape is exact; spacing,
origin and affine agree within absolute `1e-5`. Geometry naming matches Lite's IJK-to-RAS.
Medical-scalar vs raster-scalar and 1-vs-3-channel mixtures are rejected. Domain/modality
coherence still needs human confirmation; unknown PHI metadata is not copied forward.

## 7–12. Notebook, model, preprocessing, split, parameters and Dice

Notebook: config → pinned dependencies/backend → privacy-confirmed explicit upload →
validation/summary → training/plotting → separate Model ZIP download. Pre-publication
testing can upload the backend via Colab's Files sidebar and set `BACKEND_REF='local'`.

MONAI 3D UNet: 1/3 inputs, 2 outputs, `(16,32,64,128,256)` channels, four stride-2 levels,
2 residual units, InstanceNorm/PReLU. DiceCELoss + AdamW; CUDA AMP uses current
`torch.autocast` / `torch.amp.GradScaler` APIs. Checkpoint contains state_dict/config only.

Temporary binary label = original label == selected Obj ID; originals are untouched.
RAS and per-RAS-axis median spacing preserve anisotropy. Scalar inputs use per-volume
0.5/99.5-percentile clipping and z-score (bounded deterministic percentile sampling),
without guessing a CT HU window. RGB channels are divided by 255. Foreground/background
patch sampling, padding, axis flips and intensity scaling are training-only transforms.

Split is case-level 80/20, seed 42, minimum one validation case. A single-case run is
explicitly `resubstitution_smoke_only`, not held-out validation. Actual IDs are exported.
Defaults: 100 epochs, lr 1e-4, 96³ patches, batch 1 with 2 sampled patches/case, 2 workers,
early-stopping patience 20. The best epoch's weights are retained.

Validation uses CPU-assembled sliding-window inference with GPU patches, Gaussian
blending and 0.25 overlap. Foreground Dice is reported per case and averaged including
negative cases on the resampled grid: both empty = 1, empty truth with false positives = 0.
The same internal split selects the best epoch; it is not an independent clinical test.

## 13. Model ZIP

`TrainRef3D_Model_TR3DM_<random>.zip` contains `model.pt`, `model_manifest.json`,
`training_history.csv`, `validation_metrics.csv`, `README.txt`.
`trainref3d-model-1.0` stores architecture/preprocessing/spacing/channel/target policies,
training config, actual split, best epoch/Dice, runtime versions and backend SHA256.
No source images are placed in this output; names and learned weights still require care.

## 14–15. Executed tests

| Command / check | Result |
| --- | --- |
| `node --test "lite-web/tests/*.test.mjs" "train-web/tests/*.test.mjs" "slice-bridge/tests/*.test.mjs"` | **106 passed**: 83 Lite + 19 TrainRef3D + 4 slice bridge |
| `python -m unittest discover -s ColabNotebooks/tests -p "test_*.py" -v` | **18 passed**: 14 TrainRef3D + 4 existing Colab |
| `python ColabNotebooks/tests/run_trainref3d_smoke.py` | **Passed**, 2 epochs / 2 train iterations, short-depth RGB, negative case, forward/loss/backward/checkpoint reload/validation/Model ZIP |
| Actual browser-downloaded Dataset ZIP → Python → scalar CPU epoch → Model ZIP | **Passed** |
| `node --check` app/worker; `python -m py_compile` backend; `git diff --check` | **Passed** |
| Existing desktop `python -u -m unittest discover -s SegRef3D/tests -p "test_*.py" -v` | **33 passed; 5 UI module import errors** from Windows application-control blocking VTK DLLs (also outside sandbox). Not reported as an all-green suite. |

Browser skill verification used the real local page and native multiple-file chooser:
two scalar cases including one negative → target 5 → confirmation gate → ZIP download.
The downloaded file was independently prepared and trained by the Python backend.
Also confirmed RGB-only readiness, mixed scalar/RGB rejection, name-edit confirmation
reset, no console errors, and 390px viewport without page-wide horizontal overflow.
The table scrolls horizontally. Native OS drag-and-drop was not separately automated;
the implemented drop handler shares the same loader as multi-file selection.

MONAI emits expected negative-case sampling and PyTorch 2.9 indexing deprecation warnings
under the pinned PyTorch 2.8 baseline; these are not test failures. Matplotlib falls back
to a temporary config cache under the sandbox. No medical performance claim is made
from these synthetic tests or their numerical Dice values.

## 16–17. Remaining validation and limits

- **Colab/T4 GPU smoke test not run**; CUDA AMP/T4 memory behavior and notebook upload/
  download in Colab remain to be checked. Instructions and `--gpu` smoke runner are included.
- No changes pushed: the public main Colab link will not contain these new files until
  a later authorized publication. Use the local-backend notebook mode before publication.
- Existing desktop UI full regression requires an environment that is permitted to load
  its VTK libraries. No OS security policy was changed to bypass the block.
- 64 cases / 1 GiB dataset, 512 MiB case, 768 MiB decoded case, 8 GiB combined backend
  decoded files, 64M resampled voxel-channel elements by default. These are safety limits,
  not guarantees of adequate memory on every device. Modern module-worker/gzip support required.
- Single binary target only; no multiclass, inference/import, auto-upload or retraining.
- CT/MRI domain cannot be established from source format alone; annotation completeness
  cannot be inferred from missing labels. Both need the user's review.

## 18. Reusable inference interfaces

Use `trainref3d-model-1.0`, `architecture_config`, `preprocessing`, `input.target_spacing_mm`,
`task.target_label_id`, `build_model()` and trusted `torch.load(..., weights_only=True)`.
Reconstruct preprocessing, predict class 1, invert orientation/resampling to the original
source grid and map class 1 to the original Obj ID. That geometry inversion/prediction
import workflow is intentionally left for the next phase. Case/dataset validators are
independent shared contracts and can be reused without importing Lite UI state.
