import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import nibabel as nib
import numpy as np


MODULE_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = MODULE_DIR.parent
COLAB_DIR = REPO_DIR / "ColabNotebooks"
for path in (MODULE_DIR, COLAB_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from instant3d_bridge import (  # noqa: E402
    Instant3DBridgeError,
    collapse_object_groups,
    create_request_zip,
    labelmap_from_bytes,
    load_roi_catalog,
    validate_request_zip,
    validate_result_zip,
)
import instant3dweb2_backend as backend  # noqa: E402


OBJECTS = [
    {"object_id": 2, "display_name": "Kidney, right", "task": "total", "roi": "kidney_right"},
    {"object_id": 7, "display_name": "Psoas major, right", "task": "abdominal_muscles", "roi": "psoas_major_right"},
]
RIB_ROIS = {
    *(f"rib_left_{number}" for number in range(1, 13)),
    *(f"rib_right_{number}" for number in range(1, 13)),
}


class Instant3DBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.affine = np.array([
            [-0.7, 0, 0, 42],
            [0, 0.8, 0, -18],
            [0, 0, 2.0, 5],
            [0, 0, 0, 1],
        ], dtype=float)
        values = np.arange(8 * 7 * 5, dtype=np.int16).reshape((8, 7, 5))
        self.source = self.root / "source.nii.gz"
        nib.save(nib.Nifti1Image(values, self.affine), self.source)

    def tearDown(self):
        self.temp.cleanup()

    def request(self):
        path = self.root / "instant3d_request.zip"
        manifest = create_request_zip(path, self.source, OBJECTS)
        return path, manifest

    def test_catalog_contains_searchable_unique_total_ribs(self):
        catalog = load_roi_catalog()
        keys = [(item["task"], item["roi"]) for item in catalog["structures"]]
        self.assertEqual(len(keys), len(set(keys)))
        ribs = [item for item in catalog["structures"] if item["roi"] in RIB_ROIS]
        self.assertEqual(len(ribs), 24)
        self.assertEqual({item["roi"] for item in ribs}, RIB_ROIS)
        for item in ribs:
            self.assertEqual(item["task"], "total")
            self.assertEqual(item["category"], "Bone")
            self.assertEqual(item["modality"], ["CT"])
            haystack = " ".join([
                item["display_name"], item["roi"], item["category"], *item.get("synonyms", []),
            ]).lower()
            self.assertIn("rib", haystack)
            self.assertIn("ribs", haystack)

    def test_catalog_rib_groups_have_exact_unique_members(self):
        groups = {item["id"]: item for item in load_roi_catalog()["groups"]}
        self.assertEqual(set(groups), {"ribs_all", "ribs_left", "ribs_right"})
        expected_left = {f"rib_left_{number}" for number in range(1, 13)}
        expected_right = {f"rib_right_{number}" for number in range(1, 13)}
        expected = {
            "ribs_all": expected_left | expected_right,
            "ribs_left": expected_left,
            "ribs_right": expected_right,
        }
        for group_id, members in expected.items():
            group = groups[group_id]
            self.assertEqual(group["category"], "Bone")
            self.assertEqual(len(group["members"]), len(set(group["members"])))
            self.assertEqual(set(group["members"]), members)

    def test_all_ribs_group_expands_to_official_rois_on_one_object(self):
        selected = [{"object_id": 1, "display_name": "Ribs, all", "group": "ribs_all"}]
        request = self.root / "all_ribs_request.zip"
        manifest = create_request_zip(request, self.source, selected, fast=True)
        self.assertEqual(len(manifest["objects"]), 24)
        self.assertEqual({item["roi"] for item in manifest["objects"]}, RIB_ROIS)
        self.assertEqual({item["object_id"] for item in manifest["objects"]}, {1})
        self.assertEqual({item["selection_group"] for item in manifest["objects"]}, {"ribs_all"})
        self.assertTrue(manifest["options"]["fast"])
        fake_rois = {"ribs", "ribs_all", "rib_all", "ribs_left", "ribs_right"}
        self.assertTrue(fake_rois.isdisjoint({item["roi"] for item in manifest["objects"]}))
        validated, _source = validate_request_zip(request)
        self.assertEqual(validated["objects"], manifest["objects"])
        self.assertEqual(collapse_object_groups(validated["objects"]), selected)

    def test_group_and_redundant_member_are_deduplicated(self):
        selected = [
            {"object_id": 1, "display_name": "Ribs, all", "group": "ribs_all"},
            {"object_id": 1, "display_name": "Rib 1, left", "task": "total", "roi": "rib_left_1"},
        ]
        manifest = create_request_zip(self.root / "deduplicated.zip", self.source, selected)
        self.assertEqual(len(manifest["objects"]), 24)
        self.assertEqual([item["roi"] for item in manifest["objects"]].count("rib_left_1"), 1)

    def test_rib_request_preserves_identifier_and_fast_option(self):
        objects = [{
            "object_id": 4, "display_name": "Rib 12, right", "task": "total", "roi": "rib_right_12",
        }]
        request = self.root / "rib_request.zip"
        expected = create_request_zip(request, self.source, objects, fast=True)
        actual, _source = validate_request_zip(request)
        self.assertEqual(actual["objects"], expected["objects"])
        self.assertEqual(actual["objects"][0]["roi"], "rib_right_12")
        self.assertTrue(actual["options"]["fast"])

    def test_fast_total_command_passes_rib_identifiers_unchanged(self):
        commands = []

        def fake_subprocess(command, **_kwargs):
            commands.append(command)
            task_dir = self.root / "totalsegmentator" / "total"
            task_dir.mkdir(parents=True, exist_ok=True)
            for roi in ("rib_left_1", "rib_right_12"):
                nib.save(nib.Nifti1Image(np.zeros((1, 1, 1)), np.eye(4)), task_dir / f"{roi}.nii.gz")
            return backend.subprocess.CompletedProcess(command, 0, "", "")

        with patch.object(backend.subprocess, "run", side_effect=fake_subprocess):
            result = backend._run_task(
                self.source,
                "total",
                ["rib_left_1", "rib_right_12"],
                self.root / "totalsegmentator",
                True,
                "cpu",
            )
        self.assertEqual(set(result), {"rib_left_1", "rib_right_12"})
        self.assertIn("--fast", commands[0])
        subset = commands[0][commands[0].index("--roi_subset") + 1:]
        self.assertEqual(subset, ["rib_left_1", "rib_right_12"])

    def result(self, manifest):
        labelmap = np.zeros((8, 7, 5), dtype=np.uint8)
        labelmap[1:4, 1:4, 1:3] = 2
        labelmap[4:7, 3:6, 2:5] = 7
        label_path = self.root / "labels.nii.gz"
        nib.save(nib.Nifti1Image(labelmap, self.affine), label_path)
        result_manifest = {
            "schema": manifest["schema"], "schema_version": manifest["schema_version"],
            "request_id": manifest["request_id"], "status": "success",
            "source": manifest["source"], "objects": OBJECTS,
            "software": {}, "warnings": [], "overlaps": [],
        }
        result = self.root / "instant3d_result.zip"
        with zipfile.ZipFile(result, "w") as archive:
            archive.writestr("manifest.json", json.dumps(result_manifest))
            archive.write(label_path, "labelmap/labels.nii.gz")
        return result, labelmap

    def test_request_preserves_nonsequential_object_mapping_and_geometry(self):
        request, expected = self.request()
        actual, extracted = validate_request_zip(request, self.root / "extracted")
        self.assertEqual([item["object_id"] for item in actual["objects"]], [2, 7])
        self.assertEqual(actual["source"]["orientation"], "LAS")
        np.testing.assert_allclose(actual["source"]["voxel_spacing_mm"], [0.7, 0.8, 2.0])
        self.assertTrue(np.allclose(actual["source"]["affine"], self.affine))
        self.assertTrue(extracted.is_file())
        self.assertEqual(actual["request_id"], expected["request_id"])

    def test_result_rejects_wrong_source_and_decodes_matching_labelmap(self):
        _request, manifest = self.request()
        result, expected = self.result(manifest)
        validated, label_bytes = validate_result_zip(result, self.source)
        np.testing.assert_array_equal(labelmap_from_bytes(label_bytes, validated["source"]), expected)
        wrong_source = self.root / "wrong.nii.gz"
        nib.save(nib.Nifti1Image(np.zeros((8, 7, 5)), np.eye(4)), wrong_source)
        with self.assertRaisesRegex(Instant3DBridgeError, "does not match"):
            validate_result_zip(result, wrong_source)

    def test_backend_round_trip_preserves_binary_masks_overlap_and_png_order(self):
        request, manifest = self.request()

        def fake_run(_source, task, rois, output, _fast, _device):
            result = {}
            for roi in rois:
                array = np.zeros((8, 7, 5), dtype=np.uint8)
                if roi == "kidney_right":
                    array[1:5, 1:5, 1:4] = 1
                else:
                    array[3:7, 3:6, 2:5] = 1
                path = output / task / f"{roi}.nii.gz"
                path.parent.mkdir(parents=True, exist_ok=True)
                nib.save(nib.Nifti1Image(array, self.affine), path)
                result[roi] = path
            return result

        output = self.root / "backend-result.zip"
        with patch.object(backend, "validate_installed_rois"), \
             patch.object(backend, "_device", return_value="cpu"), \
             patch.object(backend, "_run_task", side_effect=fake_run), \
             patch.object(backend.importlib.metadata, "version", return_value="test"):
            backend.process_request(request, output)

        with zipfile.ZipFile(output) as archive:
            result_manifest = json.loads(archive.read("manifest.json"))
            names = set(archive.namelist())
            self.assertIn("masks/obj02_kidney_right.nii.gz", names)
            self.assertIn("masks/obj07_psoas_major_right.nii.gz", names)
            self.assertIn("label_png/mask0001.png", names)
            self.assertIn("statistics/volumes.csv", names)
            self.assertEqual([item["object_id"] for item in result_manifest["objects"]], [2, 7])
            self.assertTrue(result_manifest["overlaps"])
            self.assertEqual(result_manifest["request_id"], manifest["request_id"])

    def test_backend_unions_group_members_into_one_object_label(self):
        request = self.root / "group_request.zip"
        manifest = create_request_zip(
            request,
            self.source,
            [{"object_id": 1, "display_name": "Ribs, all", "group": "ribs_all"}],
            fast=True,
        )

        def fake_run(_source, task, rois, output, fast, _device):
            self.assertEqual(task, "total")
            self.assertTrue(fast)
            result = {}
            for index, roi in enumerate(rois):
                array = np.zeros((8, 7, 5), dtype=np.uint8)
                array.reshape(-1)[index] = 1
                path = output / task / f"{roi}.nii.gz"
                path.parent.mkdir(parents=True, exist_ok=True)
                nib.save(nib.Nifti1Image(array, self.affine), path)
                result[roi] = path
            return result

        output = self.root / "group-result.zip"
        with patch.object(backend, "validate_installed_rois"), \
             patch.object(backend, "_device", return_value="cpu"), \
             patch.object(backend, "_run_task", side_effect=fake_run), \
             patch.object(backend.importlib.metadata, "version", return_value="test"):
            backend.process_request(request, output)

        with zipfile.ZipFile(output) as archive:
            result_manifest = json.loads(archive.read("manifest.json"))
            label_path = self.root / "group-labels.nii.gz"
            label_path.write_bytes(archive.read("labelmap/labels.nii.gz"))
            labelmap = np.asarray(nib.load(label_path).dataobj)
            self.assertEqual(len(result_manifest["objects"]), 24)
            self.assertEqual({item["roi"] for item in result_manifest["objects"]}, RIB_ROIS)
            self.assertEqual({item["object_id"] for item in result_manifest["objects"]}, {1})
            self.assertEqual(int(np.count_nonzero(labelmap == 1)), 24)
            self.assertEqual(len([name for name in archive.namelist() if name.startswith("masks/obj01_rib_")]), 24)


if __name__ == "__main__":
    unittest.main()
