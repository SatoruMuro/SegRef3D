"""Run the unchanged Local SVG parser against repository fixtures and Lite output."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import cv2
import numpy as np
from generate_svg_parity_fixture import ROOT, local_harness


class LiteSvgParityTests(unittest.TestCase):
    def test_local_generated_fixtures_still_match_production_parser(self):
        data = json.loads((ROOT / "test-data/legacy-svg/expected.json").read_text())
        local = local_harness()
        with tempfile.TemporaryDirectory() as temp:
            for case in data["cases"]:
                image = Path(temp) / "image.png"
                cv2.imwrite(str(image), np.zeros((case["height"], case["width"]), np.uint8))
                local.image_paths = {"0001": str(image)}
                local.load_svg_as_label_mask("0001", str(ROOT / "test-data/legacy-svg" / case["file"]))
                self.assertEqual(local.label_masks["0001"].ravel().tolist(), case["labels"])

    def test_lite_export_is_pixel_identical_in_local_including_all_twenty_labels(self):
        local = local_harness()
        mask = np.zeros((13, 23), np.uint8)
        for y in range(13):
            for x in range(23):
                mask[y, x] = (x * 17 + y * 11) % 21
        mask[3:10, 4:12] = 1
        mask[5:8, 6:10] = 0
        mask[7:11, 15:20] = 2
        program = '''import {readFileSync,writeFileSync} from "node:fs";
import {encodeLegacySvg} from "./lite-web/legacy-svg.mjs";
const p=JSON.parse(readFileSync(process.argv[1],"utf8"));
writeFileSync(process.argv[2],encodeLegacySvg(new Uint8Array(p.labels),p.width,p.height));'''
        with tempfile.TemporaryDirectory() as temp:
            source, svg, image = [Path(temp) / name for name in ("input.json", "mask0001.svg", "image.png")]
            source.write_text(json.dumps({"width": 23, "height": 13, "labels": mask.ravel().tolist()}))
            subprocess.run(["node", "--input-type=module", "-e", program, str(source), str(svg)], cwd=ROOT, check=True)
            cv2.imwrite(str(image), np.zeros_like(mask))
            local.image_paths = {"0001": str(image)}
            local.load_svg_as_label_mask("0001", str(svg))
            np.testing.assert_array_equal(local.label_masks["0001"], mask)


if __name__ == "__main__":
    unittest.main()
