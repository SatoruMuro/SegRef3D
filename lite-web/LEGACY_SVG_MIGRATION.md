# Migrating legacy SegRef3D SVG masks

Legacy SegRef3D SVG masks can be imported and converted to the current editable label-mask format.

Load the **original DICOM** with **Open → Load Images**, then choose **Open → Masks / Project ZIP → PNG / SVG Folder** (or a ZIP containing the SVG sequence). Select Replace or Merge, review the file-to-slice mapping, and import. Verify the anatomical alignment and Obj IDs, refine the masks, then use **Export → Training Data ZIP**. NIfTI Labelmap, Label PNG and Project ZIP also work with these ordinary masks.

SVG is a **2D slice mask**, not a geometry-bearing 3D format. The currently loaded source volume supplies its affine, origin, spacing and canonical slice order. SVG cannot prove that you loaded the same patient, series, orientation or source files as the old project. Width and height alone are insufficient to establish that identity.

## Existing Local behavior and compatibility boundary

The implementation was checked against `SegRef3D/SegRef3D.py` at repository revision `d825ae4`:

- `load_svg_as_label_mask`: parse XML, normalize element `fill` / inline `style` / integer `rgb(...)`, look up `ui_SegRef3D.py::color_labels`, rasterize each element, and let later elements overwrite earlier labels.
- `svg_d_to_qpath` and `rasterize_path_to_binary`: Qt paths, forced odd-even fill, no antialiasing, no stroke. The Lite contour rasterizer matches Qt's 26.6 coordinate rounding, 16.16 edge stepping and half-pixel boundary rules. See the reference [Qt rasterizer](https://github.com/qt/qtbase/blob/6.8/src/gui/painting/qrasterizer.cpp) and [outline mapper](https://github.com/qt/qtbase/blob/6.8/src/gui/painting/qoutlinemapper.cpp).
- `write_label_mask_svg`: one colored M/L/Z compound path per used object, `fill-rule="evenodd"`, `data-label-id`, explicit dimensions/viewBox, including empty SVGs for empty slices. Local finds contours on a doubled nearest-neighbor label image.
- The historical `qpath_to_svg_path` in revisions `3fe2fb9` / `08e015a` emits M/L/Z contours with decimal coordinates. Lite supports this contour subset, polygons, polylines (implicitly closed for fill), rectangles, circles, ellipses, and inert groups. Upper/lowercase M/L/H/V/Z/C/S/Q/T commands and XML namespace prefixes such as `ns0` are accepted.

Curve handling uses the unit-scale Qt outline-mapper tolerance (0.25 pixels, bounded subdivision), followed by the same fixed-point scan conversion. Circles and ellipses use Qt's cubic representation, with no browser antialiasing. The existing Local rect/circle fixture idiom is covered, along with decimal ellipses and compound Bezier paths.

Lite's SVG palette is the **Local palette**, not Lite's slightly different display swatches. Import preserves IDs, so a dataset using Obj 1 for right obturator internus and Obj 2 for left obturator internus retains those assignments. SVG colors do not encode anatomical names; set names in the label manager if needed.

| Obj | Legacy SVG color | Obj | Legacy SVG color |
|---:|---|---:|---|
| 1 | `#ff0000` | 11 | `#ffc0cb` |
| 2 | `#0000ff` | 12 | `#ff1493` |
| 3 | `#00ff00` | 13 | `#008000` |
| 4 | `#ffff00` | 14 | `#800000` |
| 5 | `#800080` | 15 | `#00ffe6` |
| 6 | `#ffa500` | 16 | `#ffd700` |
| 7 | `#00ffff` | 17 | `#ff4500` |
| 8 | `#adff2f` | 18 | `#000080` |
| 9 | `#808080` | 19 | `#dc143c` |
| 10 | `#008080` | 20 | `#808000` |

Background is 0. Missing fill, `none` and black are ignored, as in Local; an unrecognized colored fill is rejected rather than silently dropping an object. A conflicting `data-label-id` is rejected. Inline fill takes precedence over the fill attribute. Like Local, stroke, opacity and the declared fill rule do not change label coverage: filled interiors use odd-even fill with full coverage.

## Slice mapping

Local `load_mask_folder` uses the **last integer in the mask filename** as a one-based image key. It does not reverse SVGs. Earlier DICOM loaders (`08e015a`, before `88c8426`) assigned those image keys in natural DICOM filename order; current loaders sort DICOM by projected ImagePositionPatient. The same `mask0001.svg` may therefore belong at a different current z index.

Lite requires unique numbers **1 through the source frame count**, including an empty SVG for an empty slice. Missing files, duplicate numbers, zero-based numbering, extra slices, ambiguous source names and dimension mismatches fail before any masks change. Selection order and ZIP directory order have no effect.

For a sequence without a manifest, the review offers:

1. **Old Local: natural DICOM filename order**: map SVG number n to the nth original DICOM filename, then to its current canonical z. This is the initial selection for unique single-frame DICOM filenames. It is a candidate based on the historical loader, not proof of the dataset's provenance.
2. **Current canonical**: mask0001 → display slice 1 / volume z=0, mask0002 → z=1, etc.
3. **Reverse**: map mask0001 to the last loaded slice, for a separately reversed legacy sequence.

The review shows file count, source slice count, dimensions and **every filename → display slice → z → source filename**. A detected complete reversal is highlighted. Renamed source files, manually permuted sequences and old resliced volumes cannot be inferred from SVG; there is no automatic off-by-one correction or resampling. Check the mapping and anatomy before using exported training data. Multi-frame DICOM has no unique filename per frame, so the filename mode is unavailable.

A Lite SVG ZIP manifest fixes and validates canonical mapping. Its palette, dimensions, count and each filename/z/display mapping must agree. It does not carry or authenticate the source volume's 3D geometry.

## Geometry and safety

Lite requires explicit pixel width/height equal to the loaded **working grid**. If present, viewBox must be `0 0 width height`. Local's automatic scaling and dimensionless-coordinate fallback are deliberately unavailable. A working-grid downsample, padding, offset viewBox, physical units or unmatched dimensions is rejected; no silent resize or centering occurs.

Parsing and rasterization are pure JavaScript data operations. Imported XML is never inserted into a DOM, passed to an image decoder, or loaded as an SVG URL. The allowlist rejects scripts, external URLs/images, event attributes, `foreignObject`, `use`, stylesheets, transforms, inherited group styling, entities, DTDs, processing instructions (except the XML header), CSS escapes and unknown elements/attributes. Only inert literal properties needed by the legacy contours are accepted. There is no network operation in the module.

The subset currently **rejects arc commands (A) and arbitrary SVG features**, even though Local's broader parser accepts some of them. Unsupported files fail with an explanation, never a partial success. Use Local to convert those to label PNG at the original dimensions. Supported source-generated contour fixtures are tested against the actual Local parser; this does not claim support for every SVG accepted by Qt.

Limits per slice: 16 MB text, 16 million pixels, 100,000 elements, 500,000 path points, 20 million edge/scanline intersections and 100 million pixel writes. Excessively complex exports are rejected with a suggestion to use Label PNG. All files decode and validate before applying any masks.

## Replace, Merge and editor state

SVG shares the existing PNG `applyImportedMasks` / `combineLabelMasks` path:

- **Replace** replaces each matched frame in full, including existing objects and background. The SVG review explicitly states this.
- **Merge** writes imported nonzero labels; imported labels win at overlapping pixels, while other existing pixels remain unchanged. This is the established PNG behavior, not the background-only AI result merge policy.

The result is the existing `image.mask` Uint8Array, with ordinary per-frame Undo/Redo, visibility updates and autosave. There is no SVG mask state. PNG and Project ZIP behavior is unchanged. When label PNGs are present, the existing PNG import path remains authoritative and reports that SVG files were ignored. To import SVG, select an SVG-only folder/ZIP. A contradictory SVG manifest alongside PNGs is rejected rather than reinterpreted as a PNG manifest.

## SVG export

**Export → SVG Masks** downloads `<source>_svg_masks.zip` with `mask0001.svg` through `maskNNNN.svg` and `segref3d-mask-manifest.json`.

Every slice, including blank ones, has explicit dimensions/viewBox. The same legacy colored M/L/Z paths, odd-even rule and `data-label-id` are used. Lite represents exact pixel boundaries with horizontal-run closed subpaths rather than approximate contour extraction. This stays within Local's existing SVG subset and gives pixel-identical Lite → SVG → Lite and Lite → SVG → Local label masks, including one-pixel objects and holes. It is not a new SVG dialect.

The sidecar contains `format: segref3d-colored-svg-masks`, `version: 1`, `sliceOrder: segref3d-canonical-v1`, one-based indexing, frame/slice counts, width/height, all 20 Obj/color pairs, and explicit per-file canonical z/display mapping. It extends the mask-sequence sidecar convention for SVG; the PNG sidecar is unchanged.

## Reproducing validation

```sh
python SegRef3D/tests/generate_svg_parity_fixture.py
python SegRef3D/tests/medical_source_fixtures.py build/svg-qa/medical
node --test "lite-web/tests/*.test.mjs" "train-web/tests/*.test.mjs" "slice-bridge/tests/*.test.mjs"
python -m unittest discover -s SegRef3D/tests -p test_lite_svg_parity.py
node lite-web/tests/legacy-svg.browser.mjs build/svg-qa
```

The generator executes the unchanged Local production SVG methods using Qt/OpenCV, without a GPU/model or full UI startup. Repository fixtures include Local-generated colored contours, holes, single-pixel regions, empty slices, legacy styles, namespace handling tests, 100 decimal-coordinate polygon and 100 cubic/quadratic/smooth-curve Qt parity cases, and four Local-generated MRI migration masks. Browser QA loads an oblique, anisotropic synthetic MR DICOM series whose filenames oppose its physical order, imports those old masks, edits/cleans/undoes/redoes them, checks NIfTI and Training ZIP labels/intensities/affines/order, verifies TrainRef3D acceptance, and restores PNG/Project/SVG archives. Invalid late SVG files must leave masks/history untouched and trigger no external requests.

Set `PLAYWRIGHT_MODULE` to an existing Playwright `index.mjs` if needed, and `BROWSER_CHANNEL=msedge` to use Edge. QA output goes to ignored `build/svg-qa/`.
