# SegRef3D Segmentation Job Format

`segref3d-segjob-1.0` is the shared interface between SegRef3D and SegOnWeb.
The schema implementation and validator live in `SegRef3D/segmentation_job.py`.

## Input ZIP

```text
segonweb_input.zip
|-- manifest.json
`-- images/
    |-- 000001.jpg
    |-- 000002.jpg
    `-- ...
```

The JPG files are copied without recompression when the SegRef3D working image is
already an RGB JPEG. Other supported working image formats are converted to RGB JPEG
only for this archive. Every image must have the same dimensions.

## Manifest

```json
{
  "format_version": "segref3d-segjob-1.0",
  "kind": "segmentation_job",
  "frame_index_base": 0,
  "created_by": {"application": "SegRef3D", "version": "1.x.y"},
  "source": {
    "project_name": "examplejpg",
    "original_inputs": ["image0001.tif", "image0002.tif"]
  },
  "images": {
    "count": 2,
    "width": 1024,
    "height": 768,
    "order": ["0001", "0002"],
    "files": [
      {
        "index": 0,
        "key": "0001",
        "original_filename": "image0001.tif",
        "working_filename": "image0001.jpg",
        "archive_path": "images/000001.jpg"
      }
    ]
  },
  "objects": [
    {
      "id": 1,
      "name": "Levator",
      "prompt_frame": 84,
      "box": [120.0, 180.0, 430.0, 620.0],
      "tracking_start": 40,
      "tracking_end": 140,
      "prompts": [
        {"type": "box", "frame": 84, "box": [120.0, 180.0, 430.0, 620.0]}
      ]
    }
  ]
}
```

All manifest frame indices are zero-based. SegRef3D displays the corresponding frame
numbers as one-based values in the GUI. `prompt_frame` must be inside the inclusive
`tracking_start` to `tracking_end` range. Box coordinates use pixel-space
`[x1, y1, x2, y2]` with an exclusive lower-right edge.

The direct `prompt_frame` and `box` fields define the Phase 1 box workflow. The
parallel `prompts` list allows future point, multiple-box, and additional-frame
prompts without changing the archive format.

## Result ZIP

```text
segref3d_result.zip
|-- manifest.json
|-- images/
|   |-- 000001.jpg
|   `-- ...
`-- masks/
    |-- mask0001.png
    `-- ...
```

The result manifest keeps the input image and object metadata, changes `kind` to
`segmentation_result`, and adds:

```json
{
  "result": {
    "mask_format": "single-label-uint8-png",
    "overlap_policy": "later-object-overwrites-earlier-object",
    "backend": {"name": "SegOnWeb Colab"},
    "masks": [
      {"index": 0, "key": "0001", "archive_path": "masks/mask0001.png"}
    ]
  }
}
```

Each mask is an 8-bit, single-channel PNG with the original image dimensions. Pixel
value `0` is background and values `1` through `20` are SegRef3D object IDs. Objects
are processed in manifest order; a later object overwrites an earlier object where
their masks overlap, matching the desktop single-label mask behavior.

## Validation And Safety

- Unsupported `format_version` or `kind` values are rejected.
- Image count, order, dimensions, keys, prompt ranges, boxes, and object IDs are validated.
- Result archives must contain exactly one declared uint8 PNG mask per image.
- Absolute paths, drive names, `..` traversal, duplicate members, and ZIP symlinks are rejected.
- SegRef3D validates and reads every incoming mask before replacing in-memory project masks.
