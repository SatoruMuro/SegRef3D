"""Build the BAP-derived demo from the supplied ZIP without changing RGB pixels.

Usage: python lite-web/scripts/prepare-mouse-brain-demo.py path/to/source.zip
Requires Pillow. Source ZIPs are local inputs, never app assets.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile

import PIL
from PIL import Image


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_zip", type=Path)
    args = parser.parse_args()
    destination = Path(__file__).resolve().parents[1] / "demo/mouse-brain-demo"
    destination.mkdir(parents=True, exist_ok=True)
    frames = []
    with zipfile.ZipFile(args.source_zip) as archive:
        names = [name for name in archive.namelist() if not name.endswith("/")]
        expected = [f"image{number:04d}.png" for number in range(1, 264, 2)]
        names.sort(key=lambda name: int(re.fullmatch(r"image(\d+)\.png", name).group(1)))
        if names != expected:
            raise ValueError("Expected exactly image0001.png, image0003.png, ... image0263.png.")
        for name in names:
            original = archive.read(name)
            with Image.open(io.BytesIO(original)) as source:
                if source.size != (707, 553) or source.mode != "RGBA":
                    raise ValueError(f"Unexpected dimensions or color mode: {name}")
                if source.getchannel("A").getextrema() != (255, 255):
                    raise ValueError(f"Non-opaque alpha must not be discarded: {name}")
                rgb = source.convert("RGB")
                output = io.BytesIO()
                rgb.save(output, format="PNG", optimize=True, compress_level=9)
                encoded = output.getvalue()
                with Image.open(io.BytesIO(encoded)) as decoded:
                    if decoded.tobytes() != rgb.tobytes():
                        raise ValueError(f"RGB pixels changed: {name}")
            (destination / name).write_bytes(encoded)
            frames.append({"file": name, "sourceFile": name,
                           "sourceNumber": int(name[5:9]),
                           "sourceBytes": len(original), "sourceSha256": sha256(original),
                           "bytes": len(encoded), "sha256": sha256(encoded)})
    manifest = {
        "id": "mouse-brain-demo", "revision": 1,
        "dataset": "Mouse brain light microscopy / Mouse Brain Architecture Project",
        "type": "serial light microscopy sections", "specimen": "mouse brain",
        "source": "Brain Architecture Project (BAP)",
        "sourceUrl": "https://brainarchitecture.org/",
        "policyUrl": "https://brainarchitecture.org/policies/",
        "license": "CC BY-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        "provenance": "BAP-derived image set supplied by the SegRef3D maintainer via Dropbox.",
        "sourceArchiveSha256": sha256(args.source_zip.read_bytes()),
        "datasetId": None, "brainId": None, "experimentId": None,
        "identifierNote": "No dataset, brain, experiment ID, README or spacing metadata accompanied the supplied images.",
        "citation": "Bohland JW et al. (2009). A Proposal for a Coordinated Effort for the Determination of Brainwide Neuroanatomical Connectivity in Model Organisms at a Mesoscopic Scale. PLoS Computational Biology 5(3): e1000334.",
        "citationUrl": "https://doi.org/10.1371/journal.pcbi.1000334",
        "imageSize": [707, 553], "format": "PNG", "colorMode": "RGB", "bitDepth": 8,
        "sourceColorMode": "RGBA", "slices": len(frames), "voxelSpacingMm": None,
        "order": "Natural numeric order of original filenames, 1 through 263 in steps of 2. All 132 supplied files retained. Even-numbered files were absent in the supplied set; no additional gaps in its step-2 sequence.",
        "continuityReview": "Contact sheets of all supplied images show progressive anatomy without an obvious order reversal. Original section shifts, tears and slide artifacts remain; images are not registered. This does not establish physical section spacing or that every original section is present.",
        "adaptation": "Removed only the fully opaque alpha channel; optimized lossless PNG compression. RGB pixels and 707 x 553 dimensions are unchanged. No resize, crop, rotation, registration, contrast adjustment or additional slice selection.",
        "pillowVersion": PIL.__version__,
        "sourceTotalBytes": sum(frame["sourceBytes"] for frame in frames),
        "totalBytes": sum(frame["bytes"] for frame in frames), "frames": frames,
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Verified {len(frames)} lossless RGB images: {manifest['totalBytes']:,} bytes")


if __name__ == "__main__":
    main()
