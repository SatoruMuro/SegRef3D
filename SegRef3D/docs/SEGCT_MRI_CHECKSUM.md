# SegCT/MRI source checksum verification

Base: `b8fa4116d398fc2fa55fb934773d57fd9e99a21f` (2026-09-10).

## Finding and scope

`dicomMedicalSource()` creates the NIfTI transport bytes without a checksum.
The bridge previously calculated a missing checksum for a request but did not
retain it on the source. Result validation synchronously compared the result
checksum with the source property, so an otherwise matching source with no
cached checksum was rejected. Unit tests manually seeded that property and
therefore did not exercise this state.

The base main's application DICOM loader already hashes its source after
conversion, and its NIfTI loaders also precompute a checksum. Thus the missing
checksum defect is reproducible at the bridge boundary, but the exact reason
the reported live session reached that state is not established. The user's
actual request/result archives and live state were not available for inspection;
we do not attribute this to a particular browser cache or backend failure.

## Contract

- Both request generation and asynchronous result validation call
  `ensureSourceChecksum(source)`. If missing, SHA-256 is calculated from the
  transport bytes and stored on that same source object (`state.sourceVolume`
  for application calls). The request manifest uses the returned value.
- Import also works after reloading the original volume without creating a new
  request first. Missing source bytes give an actionable reload error.
- Source transport bytes are immutable during a loaded volume's lifetime;
  loading different data creates a new source. Display and mask editing do not
  modify those bytes. The checksum covers the complete NIfTI transport bytes,
  not rendered pixels or mask bytes.
- Source checksum, affine, dimensions, spacing and orientation validation remain
  enabled. Different bytes are rejected even when geometry is identical.
- No schema or Colab inference change. Both current and legacy bridge result
  schemas remain accepted. The backend copies the validated request source into
  its result manifest.
- App/module asset versions and the service-worker cache generation are bumped
  together to publish the asynchronous caller and validator consistently.

## Verification

- Full suites: Web 153, Desktop 139, Colab 32 tests passed. All four browser
  format/modality workflows passed. `git diff --check` passed.
- The revised targeted tests against the base bridge fail (10 failures), including
  the missing cached checksum assertion. With the fix, all 15 targeted tests pass.
- DICOM CT/MRI: four orientations, scalar/geometry preservation, request digest
  equality, same-session import, fresh-source import, one-voxel difference
  rejection, and geometry mismatch rejection. No manually pre-seeded digest.
- NIfTI: request digest equality, same-session and fresh-source import, one-voxel
  difference rejection, missing bytes error, and current/legacy result schemas.
- `lite-web/tests/medical-source.browser.mjs`: actual browser file loading and
  request ZIP download, result ZIP import/mask checks, reload/import, one-voxel
  rejection without applying masks, legacy import, and Project ZIP regression
  for DICOM CT, DICOM MRI, NIfTI CT and NIfTI MRI. The test deliberately removes
  the checksum cache to exercise the missing-state recovery path. Result manifests
  follow the published Colab structure; inference voxels are synthetic. This
  verifies the real browser importer, not a new GPU inference run.

The user's real Colab GPU run succeeded through result ZIP generation. We did
not repeat GPU inference or import their actual downloaded ZIP during this fix.

## Local GPU

`SegRef3D/instant3d_bridge.py` uses `nifti_fingerprint()` and `sha256_file()` when
creating requests and again against the current source file when validating
results. It does not depend on an optional browser-state checksum, so the same
missing-cache defect does not apply. No Local source or binary change is needed.
The published Local GPU v1.3.2 ZIP is untouched.
