# TrainRef3D v1.0 MVP

SegRef3D Lite creates masks and one-case Training ZIPs. **TrainRef3D assembles cases
locally, then trains one binary target in your own Google Colab GPU runtime.**

Web entry point: `train-web/index.html` (serve the repository root over HTTP).
After publication: <https://satorumuro.github.io/SegRef3D/train-web/>.
Colab launcher: [trainref3d.html](../ColabNotebooks/trainref3d.html).
Local implementation/test evidence and remaining GPU/desktop checks: [LOCAL_VALIDATION.md](LOCAL_VALIDATION.md).

## Workflow

1. Finish and review the selected structure in every independent case in SegRef3D Lite.
2. Export **Training Data ZIP** once per case. Preserve the original images/project separately.
3. Open TrainRef3D; drop or select several Training ZIPs. Invalid cases are shown as
   errors and excluded; remove an included case to change the dataset.
4. Select one Obj ID. Names are combined across cases; conflicting names trigger a
   warning. Confirm the same ID means the same structure in every case. Set a concise
   target name without personal information. IDs are never automatically remapped.
5. Check annotation completeness. A case without this Obj ID is treated as a **true
   negative**, not as an unannotated case. Any case/target/name change clears confirmation.
6. Create and download the Dataset ZIP. Open the Colab launcher separately.
7. Choose a T4 GPU. Run config/setup, explicitly approve and upload one Dataset ZIP,
   review the target/split/spacing summary, then run training and download the Model ZIP.

Nothing is uploaded by the web application. Validation runs in a Web Worker.
Dataset packaging references original case ZIP blobs, without recompressing their
contents or making a contiguous full-dataset ArrayBuffer.

DICOM headers are not included in standard Training ZIPs, but source NIfTI headers,
image pixels/voxels, anatomy, and object names may contain identifiable information.
These archives are **not guaranteed anonymous**. Follow institutional rules before
uploading research/medical data to Google Colab. Models/weights also need appropriate
data governance. Target names appear in dataset/model metadata.

## Dataset contract

`TrainRef3D_Dataset_TR3D_<random>.zip`:

```text
dataset_manifest.json
cases/SegRef3D_Train_SR3D_<id1>.zip
cases/SegRef3D_Train_SR3D_<id2>.zip
```

`format: trainref3d-dataset-1.0`; `training_case_format: segref3d-training-case-1.0`.
The outer manifest contains:

- Random `dataset_id`, `created_by`.
- `task`: `binary_segmentation`, original `target_label_id`, chosen `target_name`,
  `annotation_policy: complete_for_selected_target`.
- `input`: uniform `channel_count` (1 or 3), `source_category` (`medical_scalar`,
  `grayscale_8bit`, or `rgb`).
- `cases`: exact `case_id` / nested ZIP `file` pairs, with no source folder names.
- `privacy`: browser-local before Colab, identifiable-image warning; small-dataset warnings.

Case archives are retained byte-for-byte. Unknown source metadata is not copied into
new manifests. The public JavaScript import boundaries are
`shared/training-case.mjs` and `shared/training-archive.mjs`; neither app state nor
display-normalized pixels are imported. Existing Lite export files are unchanged.

Validation checks manifest/schema, duplicate IDs/paths, exact declared files, ZIP CRC,
paths/local-vs-central headers, NIfTI-1/2 scalar data including bounded gzip, integer
labels/actual Obj IDs, finite values, channel order, and geometry. Shape must match
exactly; affine, origin and spacing use absolute tolerance `1e-5`. Orientation follows
Lite's IJK-to-RAS convention. Source units must be mm or unspecified. Data with no
explicit qform/sform is rejected instead of guessing a coordinate system.

Uniform source categories and channel counts are required. CT vs MRI cannot reliably
be inferred from these manifests; users must keep imaging domains coherent. Different
formats/policies and high-bit-depth-to-8-bit degradation produce warnings. Original
image intensity values and original labels are not altered by packaging/preparation.

## Training baseline

TrainRef3D v1.0 uses a MONAI 3D U-Net baseline. It is intended as a reproducible
custom-model starting point, not an automated claim of optimal architecture.

- Tested versions: PyTorch 2.8.0, MONAI 1.5.1, nibabel 5.3.2; Colab pins these versions.
- 3D UNet: 1 or 3 inputs, 2 outputs; channels `(16,32,64,128,256)`, four stride-2
  levels, 2 residual units, InstanceNorm/PReLU. DiceCELoss + AdamW (`lr=1e-4`).
- `label == target_label_id` becomes 1 in a separate temporary NIfTI; other labels
  become 0. Original labelmap files are not overwritten.
- RAS orientation; **per-axis median spacing after axis reordering to RAS**, not forced
  isotropic spacing. Linear image / nearest label interpolation.
- Scalar: per-volume, per-channel 0.5/99.5 percentile clipping then z-score, including
  zero voxels. Percentiles use at most one million deterministic evenly strided samples
  for bounded sorting memory. No fixed HU window and no automatic CT/MRI guessing.
- RGB: divide each R/G/B channel by 255. Alpha is not an input channel.
- Symmetric zero padding for small/depth-limited volumes; 96³ random patches with
  foreground/background weights 1:1, 2 samples/case; negatives fall back to background
  sampling. Axis flips and small intensity scaling augment training patches only.
- Defaults: 100 epochs, batch size 1 (2 sampled patches/case), 2 loader workers,
  seed 42, early-stopping patience 20. Adjust advanced config in Colab, not the Web UI.
- AMP uses `torch.autocast` and `torch.amp.GradScaler` on CUDA. CPU needs an explicit
  `allow_cpu=True` and is intended only for the tiny smoke test.
- Case-level 80/20 split, seed 42, at least one validation case. No slice split.
  For **one case only**, train and validation use the same case; metadata explicitly
  marks `resubstitution_smoke_only`, and it is not held-out performance.
- Validation uses sliding windows (overlap 0.25, Gaussian blending); full images and
  assembled outputs stay on CPU, only inference patches go to CUDA. Foreground Dice
  is averaged per case on the resampled grid, and each case is reported. Both-empty
  masks score 1; a negative target with false-positive prediction scores 0. A split
  with no positive cases warns explicitly. Best internal-validation epoch is saved.

1–4 cases: experimental smoke test only; 5–9: very small; 10–19: small, unstable
estimates. Do not treat variants of the same subject as independent cases or use
synthetic/augmented copies to claim validation performance. There is no independent
test set or cross-validation in this MVP.

**Performance on the internal validation split does not establish clinical validity
or generalizability.**

## Model contract / future inference

`TrainRef3D_Model_TR3DM_<random>.zip` contains exactly:

```text
model.pt
model_manifest.json
training_history.csv
validation_metrics.csv
README.txt
```

`model_manifest.json` has `format: trainref3d-model-1.0`, model/dataset IDs, target,
architecture parameters, input channels, target spacing, normalization/sampling and
interpolation policies, patch/inference settings, actual split IDs/mode, full training
config, best epoch/Dice, versions and backend source SHA256. `model.pt` holds
`state_dict` and `architecture_config`, not a pickled full model.

Future inference should load **trusted** weights using `torch.load(..., weights_only=True)`,
construct `monai.networks.nets.UNet(**architecture_config)`, load the state dictionary,
reproduce the manifest preprocessing and channel order, then invert geometry back to
the original source grid. Output class 1 maps to `task.target_label_id`, not arbitrary
Obj 1. Reuse `build_model`, `preprocessing_config`, and the versioned schemas; geometry
inversion and SegRef3D prediction import are **not implemented** in this MVP.

## Safety limits / known constraints

- At most 64 cases, 512 MiB per case ZIP, 1 GiB per Dataset ZIP; case expanded ZIP and
  combined decoded NIfTI payloads at most 768 MiB. ZIP32, stored/deflated members only;
  no traversal, symlinks, encrypted files, undeclared members, directory entries or ZIP64.
- Backend independently validates the outer and inner archives before training. Gzip
  decompression is streamed and bounded before nibabel reads it. Temporary extraction
  uses generated paths; no supplied archive paths are written directly.
  Combined backend decoded files (including temporary binary labels) are capped at 8 GiB,
  with a free-disk check before each case. Failed runs may leave their generated temporary
  directory for inspection; remove that specific run directory when no longer needed.
- 64 million resampled voxel-channel elements per case maximum by default; large
  resampling allocations are rejected before preprocessing. No all-dataset RAM cache.
  These guards reduce risk but cannot guarantee every browser/runtime has enough memory.
- Modern browser with module workers and `DecompressionStream` required. Web session
  data is not autosaved; reloading clears the list. No service worker/offline cache is
  added; `?v=1` assets are independent of Lite's existing offline cache.
- Single binary target only; all-negative datasets without a selectable target are
  rejected. Mixed scalar/RGB and medical/raster scalar categories are rejected.
- Fixed seed supports repeatable case splits; it does not guarantee bitwise equality
  across devices/library versions. Pin the notebook `BACKEND_REF` to a verified commit
  for future reproducibility. A model trained here is not evidence of optimal architecture.
- No automatic Colab upload, inference, model import, multiclass, nnU-Net, automated
  retraining, cloud server or clinical deployment.

## Tests

From the repository root (Python 3.12 and Node 22+ tested):

```sh
node --test "lite-web/tests/*.test.mjs" "train-web/tests/*.test.mjs"
python -m venv .venv-train
# Activate that environment, then install the CPU wheel for local smoke testing:
python -m pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r ColabNotebooks/trainref3d-requirements.txt
python -m unittest discover -s ColabNotebooks/tests -p "test_*.py" -v
python ColabNotebooks/tests/run_trainref3d_smoke.py
```

Core backend unit tests need only numpy/nibabel. The separate smoke command executes
two CPU iterations on tiny RGB data, padding, a negative case, forward/loss/backward,
best-checkpoint reload, sliding-window Dice and model ZIP validation. It removes its
temporary synthetic outputs unless `--output` is supplied.

Generate non-sensitive browser/cross-language fixtures with
`node train-web/tests/generate-fixtures.mjs <new-output-directory>`; existing files are
not overwritten. Serve the root (`python -m http.server 4173 --bind 127.0.0.1`), open
`http://127.0.0.1:4173/train-web/`, select `case-0.zip` and `case-1.zip`, confirm target
5, then download. `case-2.zip` is RGB and should be rejected from a scalar dataset.
`dataset-web.zip` is built with the real Lite exporter and Web packaging code for
cross-language validation with `prepare_dataset`.

### Optional Colab T4 smoke test — not a performance evaluation

Before publication, upload the local notebook to Colab, upload the reviewed
`trainref3d_backend.py` through Colab's Files sidebar into `/content`, and set
`BACKEND_REF='local'`. Only code needs that manual step; the Dataset ZIP still uses
the explicit privacy-confirmed upload cell. This does not require pushing to main.

After these local changes have been reviewed/published, open the Colab notebook,
set `BACKEND_REF` to that reviewed SHA and `EPOCHS=3`, then upload the synthetic
`dataset-web.zip` or an authorized multi-case RabbitCT-derived test package. Confirm
upload → validation → preprocessing → training → per-case Dice → Model ZIP download.
For a checked-out repository in a GPU runtime, the equivalent mechanical test is:

```sh
python ColabNotebooks/tests/run_trainref3d_smoke.py --gpu --output /content/smoke-output
# For authorized independently annotated case data:
python ColabNotebooks/tests/run_trainref3d_smoke.py --gpu --dataset Dataset.zip --output /content/smoke-output
```

Record GPU model, library versions, selected commit, epochs, warnings and model manifest.
Synthetic variants or one RabbitCT subject cannot validate generalization. No T4 run
is claimed by the CPU-only automated tests.

API references: [MONAI UNet](https://docs.monai.io/en/stable/networks.html#unet),
[MONAI DiceMetric](https://docs.monai.io/en/stable/metrics.html#dicemetric),
[PyTorch AMP](https://docs.pytorch.org/docs/stable/amp.html).
