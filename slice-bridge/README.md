# SegRef3D SliceBridge

SliceBridge converts a sparse 3D NIfTI label map into an anchor-slice label
map for 3D Slicer's **Fill between slices** effect. Original labeled planes
are kept exactly, the selected axis spacing is divided by the chosen factor,
and blank planes are inserted between the originals.

The app is a dependency-free static site. Processing takes place entirely in
the browser; selected files are never uploaded.

## Supported input

- Single-file NIfTI-1 (`.nii` or `.nii.gz`)
- 3D integer label maps: `uint8`, `int8`, `uint16`, `int16`, `uint32`, or
  `int32`
- Little- and big-endian headers

NIfTI-2 and two-file `.hdr`/`.img` datasets are intentionally rejected with a
clear error message.

## Run locally

Serve the repository directory over HTTP:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/slice-bridge/>.

## Tests

```bash
node --test slice-bridge/tests/nifti.test.mjs
```

## Processing details

- The output dimension on the selected axis is
  `(input dimension - 1) × factor + 1`.
- The selected `pixdim` value and the corresponding `sform` column are divided
  by the factor, preserving the physical extent and origin.
- `qform` orientation is preserved through the updated `pixdim`.
- Intermediate voxels are zero; label values at anchor planes are copied
  without interpolation.
- Output is streamed through the browser's gzip compressor to avoid allocating
  a second full output volume in memory.
