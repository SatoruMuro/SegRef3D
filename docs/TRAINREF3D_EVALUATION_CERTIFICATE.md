# EvalRef3D v1: a reproducible model evaluation record

EvalRef3D compares a TrainRef3D model's **raw InferRef3D prediction** with complete Ground Truth on independently held-out subjects. A Model Evaluation Certificate is a research performance record for the evaluated dataset. It is **not a performance guarantee, clinical validation certificate, or approval for clinical use**.

The intended page is `https://satorumuro.github.io/SegRef3D/eval-web/`. The page and Colab backend must be published before public links can work. Uncommitted local changes do not update GitHub Pages or the Colab notebook on GitHub.

## Architecture and immutable model identity

```text
Original Model ZIP ──browser validator + SHA-256──┐
Training ZIPs ──validate channels + GT + geometry─┼─ paired Evaluation Request ZIP
Raw Result ZIPs ──fingerprint + identity checks───┘    (GT + prediction + manifest)
                                                          │ explicit upload
                                                     CPU Colab backend
                                                          │
                                            separate Evaluation Certificate ZIP
```

The browser reuses `lite-web/custom-model.mjs` and `shared/training-case.mjs`. It validates the model architecture, channel count, source category and preprocessing without executing `model.pt`. Unlike the optional model provenance warnings in Lite's prediction import, **every model provenance warning is a hard error in EvalRef3D**. Python reuses the existing InferRef3D model manifest validator and TrainRef3D geometry/NIfTI checks; importing these modules does not import PyTorch or MONAI.

The original Model ZIP is never rewritten. Keep these two separate files:

```text
TrainRef3D_Model_TR3DM_<id>.zip
TrainRef3D_Evaluation_TR3DE_<id>.zip
```

The certificate stores the original ZIP's whole-file `model_zip_sha256` and `model_id`. Repacking a Model ZIP changes its identity even if the weights are unchanged. Consumers must hash the actual model archive and compare it with the certificate. A future marketplace can attach one or more certificates to that immutable model identity without changing the model format.

SHA-256 provides content binding, **not issuer authentication**. V1 metadata is unsigned and locally editable. The backend cannot independently rehash source images or model weights because neither is uploaded. It checks all supplied bindings for consistency and verifies both mask hashes; it records the browser's source matching result as part of a self-evaluation record. No client-only system can prevent a person from modifying unsigned JSON and claiming an invented score.

## Pairing, holdout protection and raw prediction

Pairing uses the ordered SHA-256 list of the exact canonical image NIfTI channel bytes stored inside each Training Data ZIP. The list must exactly equal InferRef3D's `source.channel_sha256`, including channel order. ZIP container compression is irrelevant; if a channel itself is `.nii.gz`, its compressed member bytes are hashed, following the existing inference contract. There is no fallback to names, voxel similarity, decompressed images, or folder paths. Re-exporting or recompressing a NIfTI may break this byte identity even when its voxel values appear unchanged.

Each Training ZIP and Result ZIP must have exactly one match. Duplicate source fingerprints, case IDs, request IDs, missing results and extra results are rejected. Model ID, Model ZIP SHA-256, target ID/name, input category/channel count and inference preprocessing must agree. Prediction SHA-256 and the declared original geometry must agree with the prediction file.

The selected target is exactly `label == target_label_id`. All other GT Obj IDs are background. Ground Truth bytes remain unchanged. A target absent from GT is a valid negative case only under the user's completeness attestation. Prediction labels must contain only 0 and the selected target ID, using uint8.

Evaluation case IDs are the `SR3D_...` IDs in Training manifests, not names such as `case001`. EvalRef3D requires the model's `dataset.train_case_ids` and `dataset.validation_case_ids`, checks both, and rejects any overlap (case-insensitive). Models without that provenance are rejected. Different IDs for the same subject cannot be detected. The required checkbox says:

> I confirm that these evaluation cases are independent subjects that were not used for training or internal validation, and that the Ground Truth annotations are complete for the selected target.

The output explicitly records `subject_independence.status = user_attested`, `ground_truth_complete = user_attested`, `case_id_overlap_with_training = false` and `platform_verified_subject_independence = false`.

Primary performance is always the original Result ZIP prediction, with `postprocessing = none` and `human_edit = false`. Largest-component filtering, island removal, hole filling and manual edits are excluded. Explicit edited/postprocessed declarations are rejected. Existing InferRef3D v1 results do not contain these flags; their original checked `prediction.nii[.gz]` is treated as raw. V1 has no signature capable of proving that a third party did not rewrite a result and recompute its hash.

## Geometry is checked, never repaired

Shape must match exactly. Spacing and every affine component must differ by **less than 1e-5**, with relative tolerance zero, matching the strict browser boundary. Origin and orientation must agree with the affine. Both NIfTI files must agree directly with each other and with the original source/Training manifest geometry. The backend additionally compares the two decoded affine matrices. No resampling is allowed. NIfTI units follow the existing contract: mm or unspecified (interpreted as mm). Explicit qform or sform is required; sform takes precedence under the existing NIfTI policy.

## Fixed metrics and empty-mask policy

For each case, let `G` be the GT foreground count, `P` the prediction foreground count and `TP` their intersection. Evaluation is performed on the original grid.

| Metric | Definition |
| --- | --- |
| Dice | `2*TP/(G+P)` |
| Jaccard / IoU | `TP/(G+P-TP)` |
| Precision | `TP/P` |
| Recall / sensitivity | `TP/G` |
| GT / prediction voxel count | `G` / `P` |
| GT / prediction volume, mm³ | voxel count × `abs(det(affine[:3,:3]))` |
| Signed volume error, % | `(P-G)/G*100` |
| Absolute volume error, % | absolute value of signed error |
| HD95, mm | 95th percentile of concatenated bidirectional surface distances; NumPy `method='linear'` |
| ASSD, mm | mean of those concatenated distances |

A surface voxel is a foreground voxel with at least one background or outside-volume **6-connected** neighbor. `scipy.ndimage.binary_erosion` with a 6-neighbor structure and outside value 0 extracts that boundary. Integer IJK surface voxel centers are transformed using the **full affine** to world RAS mm, including obliquity and any shear. `scipy.spatial.cKDTree` finds Euclidean nearest neighbors in both directions, using one worker. Distances are concatenated; ASSD is weighted by the number of surface voxels, not the mean of two directional means. This is a voxel-center distance definition, not a triangulated or area-weighted surface metric.

ASSD can exceed HD95 when a small fraction of surface distances are very large: the mean includes every distance, while the 95th percentile excludes the upper tail from its position statistic. No validator, schema or display may assume `ASSD < HD95`. A synthetic regression test explicitly covers this case.

| Mask state | Dice | IoU | Precision | Recall | HD95 / ASSD | Volume errors |
| --- | --- | --- | --- | --- | --- | --- |
| Both empty | 1 | 1 | null | null | null | null |
| GT empty, prediction nonempty | 0 | 0 | 0 | null | null | null |
| GT nonempty, prediction empty | 0 | 0 | null | 0 | null | −100% / 100% |

All twelve metrics have mean, median, population standard deviation (`ddof=0`), minimum, maximum and `valid_case_count`. Cases are weighted equally. Null values are excluded per metric. If no valid values exist, every statistic is null and `valid_case_count=0`. CSV empty cells represent JSON nulls; JSON never contains NaN or Infinity.

The UI, notebook summary, README and certificate all state **n**, and the user supplies a description of the evaluated domain. Report “mean Dice X, n=5, domain …”, rather than a score without cohort size or context. A small or narrow holdout set does not establish generalizability.

## Request and certificate contracts

`EvalRef3D_Request_TR3DE_<id>.zip` contains only:

```text
evaluation_manifest.json
cases/SR3D_<id>/ground_truth.nii[.gz]
cases/SR3D_<id>/prediction.nii[.gz]
```

The request manifest uses `trainref3d-evaluation-request-1.0`. It includes the original model manifest, model ID/hash, evaluation role/domain/attestation, raw policy and one record per case. Case records include source hashes, original geometry, each mask's SHA-256, and the inference identity/preprocessing/runtime metadata needed for consistency checks. No source images or model weights are sent to Colab. NIfTI masks and names can still be identifying; this is data minimization, not an anonymization guarantee.

`TrainRef3D_Evaluation_TR3DE_<id>.zip` contains exactly:

```text
evaluation_certificate.json
per_case_metrics.csv
README.txt
```

No images, GT, predictions or weights are included. JSON uses `trainref3d-evaluation-certificate-1.0`; the machine-readable schema is [`schemas/trainref3d-evaluation-certificate-1.0.schema.json`](../schemas/trainref3d-evaluation-certificate-1.0.schema.json). It contains model binding/provenance, evaluation set, fixed metric definitions, summary, per-case metrics and hashes, actual Python/library versions, SHA-256 of all three backend source modules and request archive, and explicit limitations.

`verification.level` is always `self_evaluated` and `platform_signature` is always null. The v1 emitter and v1 schema reject `platform_verified` and `externally_validated`. Those names are reserved for future signed services. A future marketplace must verify a platform signature against its trusted issuer keys, not trust the string value alone. Marketplace distribution or sales are outside this implementation.

Future schema versions may add a separately named `standard_postprocessing` secondary analysis. Raw prediction remains primary. Such an analysis must record the exact operation sequence, every parameter, software version and algorithm version; it must never overwrite or merge with the raw metrics. Manual-correction performance is not model performance. V1 does not execute or emit this secondary analysis.

## Browser and Colab workflow

Select one model, all holdout Training ZIPs and all corresponding original Result ZIPs. Click **Pair & Validate**, review the model/target, matched case count, zero overlap and geometry/source checks. Describe the data domain, then affirm subject independence and complete target annotation. Download the request and explicitly upload it to the CPU notebook.

The browser has no upload API, analytics or external fetch; CSP disallows network connections. Input changes invalidate validation and the confirmation. Domain or checkbox changes revoke an existing download. Errors leave request generation disabled. TrainRef3D and Lite's Custom Model panel include secondary EvalRef3D links.

The notebook uploads one request first, installs pinned `numpy==2.2.6`, `nibabel==5.3.2`, `scipy==1.15.3`, then validates/calculates/generates/downloads. A fresh Python subprocess avoids Colab's pre-imported library versions hiding the pins. No CUDA, PyTorch, MONAI or GPU is needed by evaluation. The backend and validators use a shared `BACKEND_REF`; pin it to a reviewed commit for archival reproduction. The default `main` requires publishing these changes first. Re-running uses the saved request unless `REUPLOAD_INPUTS=True`. Each execution writes to a fresh output folder; the backend refuses to overwrite an existing certificate.

For local CPU evaluation after creating a request:

```sh
python -m pip install -r ColabNotebooks/evalref3d-requirements.txt
python ColabNotebooks/evalref3d_backend.py request.zip --output-dir local-output
```

## Safety limits and testing

V1 accepts 1–32 cases and a request of up to 1 GiB. The shared ZIP32 writer permits 65 members (one manifest and two masks per case). Individual mask/decoded NIfTI limits follow the shared 768 MiB policy. ZIP traversal, absolute paths, duplicates, symlinks, unsupported compression, corruption and unexpected entries are rejected. Gzip expansion is bounded. Archives are never bulk-extracted. Surface trees use memory proportional to surface voxel count; exceptionally large masks can exceed a CPU runtime's memory. Validation never silently downsamples a mask to accommodate it.

Synthetic tests cover perfect, partial, disjoint, false-positive-only, false-negative-only, empty, anisotropic and oblique cases; model/hash/target/fingerprint/geometry mismatch; train/validation overlap; five-case aggregation; JSON schema; CSV equality; output members; archive abuse; and cross-language request/backend evaluation. A headless browser test exercises upload, validation, explicit attestation, download, Python certificate generation, mobile layout, stale-state invalidation and rejection behavior.

```sh
node --test "lite-web/tests/*.test.mjs" "train-web/tests/*.test.mjs" "slice-bridge/tests/*.test.mjs" "eval-web/tests/*.test.mjs"
python -m pip install jsonschema
python -m unittest discover -s ColabNotebooks/tests -p "test_*.py" -v
python -m unittest discover -s SegRef3D/tests -p "test_*.py" -v
node eval-web/tests/evaluation.browser.mjs
git diff --check
```

Existing training/inference and desktop tests need their normal additional dependencies. Browser tests use Playwright; `PLAYWRIGHT_MODULE`, `BROWSER_CHANNEL` and `EVAL_PYTHON` can point to installed runtimes.

## Real Right Obturator Internus validation

The requested holdout names are case001, case005, case010, case023 and case026. Their actual Training manifest IDs and fingerprints determine pairing. Begin with the original Right OI model, case001 Training ZIP and its original raw Result ZIP, then repeat with all five. Confirm both browser checks, run the CPU backend, inspect per-case counts/metrics and retain the certificate outside version control.

Synthetic tests are **not** real model performance evidence. A local real-data case001 browser-to-CPU E2E has also been completed with the spatial-flip-disabled Right OI v2 model. Model/source binding, geometry, train/validation exclusion, JSON schema, CSV agreement and metadata-only output were verified. An independent surface implementation using explicit six-neighbor comparisons and chunked pairwise Euclidean distances reproduced the backend metrics. Private inputs, requests, certificates and detailed results remain in the user's Dropbox TrainRef folder; they are not included in this repository. This single-case check validates the evaluation workflow, not clinical validity or five-case holdout performance. Patient images and archives must never be committed. `build/`, local environments and `*.zip` are ignored by this repository.

The case001 n=1 certificate is a development/E2E validation record and must not be presented as representative marketplace performance. The intended representative holdout evaluation includes all five specified subjects with the same unchanged Right OI v2 Model ZIP and original, unedited InferRef3D results.
