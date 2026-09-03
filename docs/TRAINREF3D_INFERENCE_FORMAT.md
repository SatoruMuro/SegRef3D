# TrainRef3D inference interchange v1.0

InferRef3D completes the browser-local human-in-the-loop path:

```text
SegRef3D masks → Training ZIP → TrainRef3D model
        → Inference Request + Model ZIP → InferRef3D prediction
        → SegRef3D review/correction → Training ZIP
```

This MVP accepts only `trainref3d-model-1.0` binary MONAI 3D UNet models with one scalar
channel or three ordered R/G/B channels. No browser executes `model.pt`. Model/request/result
validation and prediction import are browser-local; Colab transfer happens only when the user
explicitly uploads files to their own runtime.

## Model ZIP trust boundary

`TrainRef3D_Model_TR3DM_<id>.zip` has exactly:

```text
model.pt
model_manifest.json
training_history.csv
validation_metrics.csv
README.txt
```

Lite validates safe paths, members and `model_manifest.json`, then retains the whole-archive
SHA-256. It does not parse weights. InferRef3D independently validates the archive and loads only
a trusted `{state_dict, architecture_config}` checkpoint via
`torch.load(..., weights_only=True)`. Checkpoint and manifest architecture configs must be equal.

## Inference Request ZIP

Filename: `TrainRef3D_Inference_Request_TR3DI_<id>.zip`
Format: `trainref3d-inference-request-1.0`

```text
request_manifest.json
model/model_manifest.json
input/TR3DI_<id>_0000.nii[.gz]
input/TR3DI_<id>_0001.nii[.gz]   # RGB only
input/TR3DI_<id>_0002.nii[.gz]   # RGB only
```

`model.pt` is intentionally not duplicated. `request_manifest.json` records:

- random request ID and creator;
- model format/ID/whole-ZIP SHA-256/target Obj ID/name;
- source format/category/intensity policy and ordered scalar channel filenames, datatypes and hashes;
- original shape, spacing, origin, orientation and full IJK-to-RAS affine;
- false DICOM-header inclusion, identifiable-image warning and browser-local processing declaration.

The source fingerprint is the ordered SHA-256 list of deterministic canonical NIfTI channel bytes,
not display pixels. The canonical encoder is shared with Training Data export: original scalar
NIfTI bytes are reused when geometry is unchanged; DICOM scalar values use stored value × slope +
intercept; raster working-grid grayscale or R/G/B values are encoded deterministically. Rebuilding
the same canonical bytes on result import prevents accidental import to a different same-shaped case.

## Preprocessing and geometry

The model manifest is the source of truth. v1.0 accepts only the recorded TrainRef3D contract:

- orientation to RAS;
- model `target_spacing_mm`, linear image interpolation;
- scalar 0.5/99.5 percentile clipping then per-channel z-score, or RGB division by 255;
- no augmentation or random crop;
- saved patch size, overlap, blending and argmax class-1 selection.

The full input remains CPU-side while sliding-window patches may use CUDA/AMP. The target-grid
binary prediction is nearest-neighbor resampled with nibabel to `(original_shape, original_affine)`.
This geometry-aware inverse supports oblique affine, anisotropic spacing and non-zero origin. Class
1 becomes the model's original `target_label_id`; it is never silently changed to Obj 1.

## Inference Result ZIP

Filename: `TrainRef3D_Inference_Result_TR3DI_<request-id>.zip`
Format: `trainref3d-inference-result-1.0`

```text
prediction.nii.gz
inference_result.json
README.txt
```

The result includes no source image and no weights. Its manifest records success/request ID;
model ID/hash/target; source channel count/category/fingerprints/original geometry; prediction
file/hash/uint8 labels/foreground count/geometry; architecture, exact preprocessing and
sliding-window settings; device and optional peak GPU memory; Python/torch/MONAI/CUDA versions;
backend source SHA-256; and privacy declarations.

Lite rejects a result unless model identity/hash, ordered source fingerprints, prediction hash,
label values (`0` or target only), shape, spacing, affine, origin and orientation agree. **Replace**
clears only the target Obj before applying foreground; **Merge** retains it and fills background.
Both skip voxels occupied by another Obj and report the count. The whole import uses one existing
bulk Undo transaction. A default `Object X` name may adopt the model target name; a user custom name
is never overwritten.

## Safety and limitations

ZIP traversal, duplicate/overlapping paths, symlinks, encrypted/unsupported members, undeclared
files and bounded-expansion violations are rejected at both browser and Python boundaries. DICOM
headers are not included, but pixels/voxels can contain burned-in text, facial or unique anatomy.
Users must follow institutional rules before Colab upload.

Only binary MONAI UNet inference is implemented. There is no multiclass model, ONNX, nnU-Net,
browser PyTorch, automatic upload, cloud inference service, automatic retraining or clinical
deployment. A prediction is algorithmic output for expert review and correction, not an independent
clinical diagnosis.
