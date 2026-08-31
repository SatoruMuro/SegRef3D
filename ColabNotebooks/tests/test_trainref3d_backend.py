import contextlib
import gzip
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import nibabel as nib
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trainref3d_backend as backend
from trainref3d_fixtures import dataset_file


class TrainRef3DBackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def prepare(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return backend.prepare_dataset(dataset_file(self.root, **kwargs), self.root / "work")

    def test_dataset_parse_nested_binary_and_negative(self):
        dataset = self.prepare()
        self.assertEqual(len(dataset["cases"]), 3)
        for case in dataset["cases"]:
            original = nib.load(case["original_label"]).get_fdata()
            binary = nib.load(case["label"]).get_fdata()
            np.testing.assert_array_equal(binary, original == 5)
        self.assertEqual(dataset["cases"][1]["target_voxels"], 0)
        self.assertIn(2, dataset["cases"][0]["label_ids"])
        self.assertTrue(set(dataset["split"]["train"]).isdisjoint(dataset["split"]["validation"]))

    def test_multichannel_loading(self):
        dataset = self.prepare(channels=3)
        images = [nib.load(p).get_fdata() for p in dataset["cases"][0]["image"]]
        self.assertEqual(len(images), 3)
        self.assertEqual(images[1][0, 0, 0] - images[0][0, 0, 0], 10)
        self.assertEqual(dataset["source_category"], "rgb")

    def test_spacing_summary_anisotropic(self):
        dataset = self.prepare()
        np.testing.assert_allclose(dataset["spacing"]["median_mm"], [0.7, 0.9, 2])
        cases = dataset["cases"]
        cases[0]["geometry"]["affine"] = [[0,-.9,0,12],[.7,0,0,-8],[0,0,2,30],[0,0,0,1]]
        cases[0]["geometry"]["orientation"] = "ALS"
        np.testing.assert_allclose(backend.spacing_summary(cases[:1])["median_mm"], [.9,.7,2])

    def test_split_reproducible_and_single_case_honest(self):
        ids = [f"case_{i}" for i in range(10)]
        self.assertEqual(backend.split_cases(ids), backend.split_cases(ids[::-1]))
        self.assertEqual(len(backend.split_cases(ids)["validation"]), 2)
        self.assertEqual(backend.split_cases(["one"])["mode"], "resubstitution_smoke_only")

    def test_schema_completeness_duplicate_and_missing(self):
        mutations = [lambda m,f: m.update(format="bad"), lambda m,f: m["task"].update(annotation_policy="unknown"),
                     lambda m,f: m["cases"].append(m["cases"][0]), lambda m,f: f.pop(next(iter(f))),
                     lambda m,f: m["input"].update(channel_count=3)]
        for mutate in mutations:
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.prepare(mutate=mutate)

    def test_case_schema_geometry_labels_and_noninteger(self):
        mutations = [lambda m,f: m.update(format="bad"), lambda m,f: m["geometry"]["spacing_mm"].__setitem__(0, 5),
                     lambda m,f: m["geometry"]["affine"][0].__setitem__(3, 99),
                     lambda m,f: m["label"].update(objects=[]), lambda m,f: f.pop(m["label"]["file"])]
        for mutate in mutations:
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.prepare(case_mutate=mutate)
        def float_label(m,f):
            f[m["label"]["file"]] = nib.Nifti1Image(np.zeros(m["geometry"]["shape"], np.float32), np.asarray(m["geometry"]["affine"])).to_bytes()
        with self.assertRaisesRegex(ValueError, "integer"):
            self.prepare(case_mutate=float_label)

    def test_unsafe_zip_path_and_unexpected_dicom(self):
        for name in ("../escape", "/absolute", "C:/escape", "a\\..\\escape", "secret.dcm"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.prepare(case_mutate=lambda m,f: f.update({name: b"secret"}))
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            self.prepare(mutate=lambda m,f: f.update({"../escape": b"bad"}))
        self.assertFalse((self.root / "escape").exists())

    def test_model_manifest_schema_no_phi(self):
        dataset = self.prepare(case_mutate=lambda m,f: m.update(PatientName="DO_NOT_COPY", PatientID="MRN-999"))
        config = backend.TrainingConfig()
        m = backend.model_manifest(dataset, config, "TR3DM_abcdef12", 2, 1, 0.4, {"python": "test"})
        self.assertEqual(m["format"], "trainref3d-model-1.0")
        self.assertEqual(m["task"]["target_label_id"], 5)
        self.assertEqual(m["architecture_config"]["out_channels"], 2)
        self.assertFalse(m["preprocessing"]["fixed_HU_window"])
        self.assertNotIn("DO_NOT_COPY", json.dumps(m))
        self.assertNotIn("MRN-999", json.dumps(m))

    def test_nested_gzip_and_nifti2(self):
        def convert(m, files):
            channel = m["image"]["channels"][0]
            source = nib.Nifti1Image.from_bytes(files.pop(channel["file"]))
            channel["file"] += ".gz"
            files[channel["file"]] = gzip.compress(nib.Nifti2Image(source.get_fdata().astype(np.int16), source.affine).to_bytes())
        dataset = self.prepare(case_mutate=convert)
        self.assertEqual(nib.load(dataset["cases"][0]["image"][0]).get_fdata()[0, 0, 0], -500)

    def test_bounded_expansion_and_nonfinite(self):
        with self.assertRaisesRegex(ValueError, "safety limit"):
            backend.copy_bounded(io.BytesIO(b"x" * 20), io.BytesIO(), 10)
        with patch.object(backend, "MAX_EXPANDED_BYTES", 100), self.assertRaisesRegex(ValueError, "safety limit"):
            self.prepare()
        def invalid(m, files):
            c = m["image"]["channels"][0]
            a = np.zeros(m["geometry"]["shape"], np.float32)
            a[0, 0, 0] = np.nan
            files[c["file"]] = nib.Nifti1Image(a, np.asarray(m["geometry"]["affine"])).to_bytes()
        with self.assertRaisesRegex(ValueError, "Non-finite"):
            self.prepare(case_mutate=invalid)

    def test_empty_target_rejected_and_single_case_warning(self):
        with self.assertRaisesRegex(ValueError, "absent from every"):
            self.prepare(negatives=(0,1,2))
        dataset = self.prepare(count=1, negatives=())
        self.assertEqual(dataset["split"]["mode"], "resubstitution_smoke_only")
        self.assertTrue(any("NOT held-out" in w for w in dataset["warnings"]))

    def test_notebook_structure(self):
        path = Path(__file__).resolve().parents[1] / "TrainRef3D_v1_0.ipynb"
        notebook = json.loads(path.read_text(encoding="utf-8"))
        sources = []
        for index, cell in enumerate(notebook["cells"]):
            if cell["cell_type"] == "code":
                source = "".join(cell["source"])
                compile("\n".join("pass" if line.startswith(("!", "%")) else line for line in source.splitlines()), f"cell{index}", "exec")
                sources.append(source)
        all_code = "\n".join(sources)
        self.assertIn("EPOCHS", sources[0])
        self.assertEqual(all_code.count("files.upload()"), 1)
        self.assertIn("files.download", sources[-1])
        self.assertNotIn("gradio", all_code.lower())


if __name__ == "__main__":
    unittest.main()
