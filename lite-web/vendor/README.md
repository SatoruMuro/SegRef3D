# Vendored medical image parsers

- `dicom-parser` 1.8.21 (MIT): DICOM Part 10 and raw data-set parsing
- `dcmjs` 0.50.3 (MIT): browser bundle required by the codec wrapper
- `dcmjs-codecs` 0.0.8 (MIT): browser/WASM RLE, JPEG, JPEG-LS, and JPEG 2000 decoding
- `nifti-reader-js` 0.8.0 (MIT): NIfTI-1/NIfTI-2 header and image parsing
- `fflate` 0.8.3 (MIT): gzip decompression used by `nifti-reader-js`

The fixed browser files are stored locally so SegRef3D Lite continues to
work without a CDN connection. See the adjacent `*.LICENSE.txt` files.

`dcmjs-native-codecs.wasm` is resolved relative to `dicom-codec.mjs`; no root-relative URL or
deployment-time path setting is required on GitHub Pages.
