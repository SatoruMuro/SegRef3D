"""Generate repository SVG/label parity fixtures using the actual Local methods.

No GPU/model or full application startup is needed. AST extraction executes the
unchanged production methods with their Qt/OpenCV dependencies. Run from repo root:
python SegRef3D/tests/generate_svg_parity_fixture.py [output-directory]
"""
import ast
import base64
import json
from pathlib import Path
import re
import random
import sys
import tempfile
from xml.etree import ElementTree as ET

import cv2
import numpy as np
from PyQt6.QtCore import QPointF
from PyQt6.QtGui import QPainterPath

ROOT = Path(__file__).resolve().parents[2]


def local_harness():
    tree = ast.parse((ROOT / "SegRef3D/SegRef3D.py").read_text(encoding="utf-8-sig"))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "SegRefMain")
    names = {"load_svg_as_label_mask", "normalize_color", "svg_d_to_qpath",
             "rasterize_path_to_binary", "write_label_mask_svg", "_contour_to_svg_subpath"}
    methods = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert len(methods) == len(names)
    harness = ast.ClassDef(name="LocalSvg", bases=[], keywords=[], body=methods, decorator_list=[])
    module = ast.fix_missing_locations(ast.Module(body=[harness], type_ignores=[]))
    import os
    namespace = dict(np=np, cv2=cv2, ET=ET, re=re, os=os, QPainterPath=QPainterPath, QPointF=QPointF)
    exec(compile(module, "SegRef3D.py (unchanged SVG methods)", "exec"), namespace)
    instance = namespace["LocalSvg"]()
    ui = ast.parse((ROOT / "SegRef3D/ui_SegRef3D.py").read_text(encoding="utf-8-sig"))
    assignment = next(n for n in ast.walk(ui) if isinstance(n, ast.Assign) and any(
        isinstance(t, ast.Attribute) and t.attr == "color_labels" for t in n.targets))
    instance.color_labels = ast.literal_eval(assignment.value)
    instance.label_masks = {}
    instance.label_mask_paths = {}
    instance.get_label_png_path = lambda key: "unused.png"
    instance.save_label_mask_png = lambda key: None
    return instance


def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    local = local_harness()
    expected = {"producer": "SegRef3D.py production SVG methods / Qt aliased OddEvenFill", "palette": local.color_labels, "cases": []}
    with tempfile.TemporaryDirectory() as temp:
        image = Path(temp) / "image.png"
        cv2.imwrite(str(image), np.zeros((48, 64), np.uint8))
        local.image_paths = {"0001": str(image)}
        source = np.zeros((48, 64), np.uint8)
        source[5:30, 6:32] = 1
        source[12:20, 14:24] = 0
        cv2.circle(source, (48, 29), 9, 2, -1)
        source[0, 0] = 20
        source[40, 2:30] = 3
        source[2:20, 60] = 4
        for name, mask in [("local-export", source), ("empty", np.zeros_like(source))]:
            filename = output / f"{name}.svg"
            local.write_label_mask_svg(mask, str(filename))
            local.load_svg_as_label_mask("0001", str(filename))
            expected["cases"].append({"file": filename.name, "width": 64, "height": 48,
                                      "labels": local.label_masks["0001"].ravel().tolist()})
        # Reuse the legacy rect/style idiom from test_svg_label_mask_boundary_ui;
        # the supported contour subset additionally tests overlap and odd-even holes.
        filename = output / "legacy-shapes.svg"
        filename.write_text('''<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48">
<rect x="4" y="5" width="18" height="12" fill="#ff0000"/>
<polygon points="8,8 25,8 25,25 8,25" style="fill:rgb(0,0,255);stroke:none"/>
<path d="M 30 3 L 58 3 L 58 23 L 30 23 Z M 36 8 L 50 8 L 50 17 L 36 17 Z" fill="#00ff00"/>
<polyline points="2,35 10,35 10,42 2,42" fill="#ffff00"/>
<circle cx="42" cy="25" r="8" style="fill:#0000ff"/>
<ellipse cx="20" cy="36" rx="5.3" ry="8.7" fill="#800080"/>
<path d="M 35 35 C 38.25 28.13 49.47 45.33 55 35 S 58 40 59 42 Q 40 45 35 35 Z" fill="#ffa500"/>
</svg>''', encoding="utf-8")
        local.load_svg_as_label_mask("0001", str(filename))
        expected["cases"].append({"file": filename.name, "width": 64, "height": 48,
                                  "labels": local.label_masks["0001"].ravel().tolist()})
        # Decimal contours from the old interactive writer exercise Qt's fixed-
        # point boundary rounding; ordinary floating-point polygon fill differs.
        rng = random.Random(42)
        decimals = []
        for _ in range(100):
            points = [(round(rng.uniform(0, 64), 2), round(rng.uniform(0, 48), 2)) for _ in range(8)]
            text = '<svg width="64" height="48"><polygon points="' + ' '.join(f'{x},{y}' for x, y in points) + '" fill="#ff0000"/></svg>'
            decimal_path = Path(temp) / "decimal.svg"
            decimal_path.write_text(text)
            local.load_svg_as_label_mask("0001", str(decimal_path))
            decimals.append({"svg": text, "labelsBase64": base64.b64encode(local.label_masks["0001"].tobytes()).decode("ascii")})
        (output / "decimal-parity.json").write_text(json.dumps(decimals, separators=(",", ":")) + "\n")
        curves = []
        for _ in range(100):
            values = [round(rng.uniform(2, 45), 2) for _ in range(12)]
            text = '<svg width="64" height="48"><path d="M 3 3 C ' + ' '.join(map(str, values[:6])) + ' Q ' + ' '.join(map(str, values[6:10])) + ' T ' + ' '.join(map(str, values[10:])) + ' Z" fill="#ff0000"/></svg>'
            curve_path = Path(temp) / "curve.svg"
            curve_path.write_text(text)
            local.load_svg_as_label_mask("0001", str(curve_path))
            curves.append({"svg": text, "labelsBase64": base64.b64encode(local.label_masks["0001"].tobytes()).decode("ascii")})
        (output / "curve-parity.json").write_text(json.dumps(curves, separators=(",", ":")) + "\n")
    (output / "expected.json").write_text(json.dumps(expected, separators=(",", ":")) + "\n", encoding="utf-8")
    migration = output / "migration"
    migration.mkdir(exist_ok=True)
    canonical = []
    with tempfile.TemporaryDirectory() as temp:
        image = Path(temp) / "image.png"
        cv2.imwrite(str(image), np.zeros((5, 6), np.uint8))
        local.image_paths = {"0001": str(image)}
        for z in range(4):
            mask = np.zeros((5, 6), np.uint8)
            mask[z, 1] = 1
            mask[4 - z, 4] = 2
            # medical_source_fixtures: slice04.dcm is canonical z=0, but old
            # filename-order imports made it display slice 4 / mask0004.svg.
            filename = migration / f"mask{4-z:04d}.svg"
            local.write_label_mask_svg(mask, str(filename))
            local.load_svg_as_label_mask("0001", str(filename))
            canonical.append(local.label_masks["0001"].ravel().tolist())
    (migration / "expected.json").write_text(json.dumps({"canonical": canonical}) + "\n", encoding="utf-8")


if __name__ == "__main__":
    generate(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "test-data/legacy-svg")
