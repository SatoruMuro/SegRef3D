"""Execute the upload cell with Colab mocked; no network or training dependencies."""
import ast
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def code_cells(name="TrainRef3D_v1_0.ipynb"):
    notebook = json.loads((ROOT / name).read_text(encoding="utf-8"))
    return ["".join(c["source"]) for c in notebook["cells"] if c["cell_type"] == "code"]


class TrainRef3DNotebookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.saved = Path(self.temp.name) / "uploaded.zip"
        self.source = code_cells()[0].replace("/content/trainref3d_uploaded_dataset.zip", self.saved.as_posix())
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("dataset_manifest.json", "{}")
        self.payload = data.getvalue()
        self.files = types.SimpleNamespace(upload=Mock(return_value={"dataset.ZIP": self.payload}))
        colab = types.ModuleType("google.colab")
        colab.files = self.files
        google = types.ModuleType("google")
        google.colab = colab
        self.modules = patch.dict(sys.modules, {"google": google, "google.colab": colab})
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def run_upload(self, answer="YES", namespace=None):
        namespace = {} if namespace is None else namespace
        with patch("builtins.input", return_value=answer) as prompt, contextlib.redirect_stdout(io.StringIO()):
            exec(self.source, namespace)
        return namespace, prompt

    def test_upload_first_and_no_later_interaction(self):
        cells = code_cells()
        self.assertIn("files.upload()", cells[0])
        self.assertNotIn("tr.", cells[0])
        for source in cells[1:]:
            self.assertNotIn("input(", source)
            self.assertNotIn("files.upload(", source)
        combined = "\n".join(cells)
        self.assertLess(combined.index("files.upload()"), combined.index("%pip"))
        self.assertLess(combined.index("EPOCHS ="), combined.index("tr.train("))
        self.assertIn("files.download(result['archive'])", cells[-1])
        for source in cells:
            compile("\n".join("pass" if line.startswith("%") else line for line in source.splitlines()), "cell", "exec")
        # Keep the backend safety limit in sync without importing its dependencies.
        tree = ast.parse((ROOT / "trainref3d_backend.py").read_text(encoding="utf-8"))
        limit = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "MAX_DATASET_BYTES" for t in n.targets))
        namespace, _ = self.run_upload()
        self.assertEqual(namespace["MAX_UPLOAD_BYTES"], eval(compile(ast.Expression(limit.value), "limit", "eval")))

    def test_yes_variants_and_saved_bytes(self):
        for answer in ("YES", "yes", "Yes", "yEs", "  YeS\t"):
            with self.subTest(answer=answer):
                self.saved.unlink(missing_ok=True)
                namespace, _ = self.run_upload(answer)
                self.assertEqual(namespace["dataset_path"].read_bytes(), self.payload)
                self.assertEqual(namespace["upload_name"], "dataset.ZIP")
                self.assertNotIn("uploaded", namespace)

    def test_advanced_spatial_flip_setting_reaches_training_config(self):
        cells = code_cells()
        settings = next(code for code in cells if "SPATIAL_FLIP_PROBABILITIES =" in code)
        self.assertIn("Laterality-sensitive anatomical targets should not use left-right flips.", settings)
        train_cell = next(code for code in cells if "config = tr.TrainingConfig(" in code)
        backend = types.SimpleNamespace(TrainingConfig=Mock(), train=Mock(return_value={"archive": "model.zip"}), plot_history=Mock())
        namespace = {"tr": backend, "dataset": {}}
        exec(settings, namespace)
        self.assertEqual(namespace["SPATIAL_FLIP_PROBABILITIES"], (0.0, 0.0, 0.0))
        for probabilities in ((0.0, 0.0, 0.0), (0.2, 0.0, 0.0)):
            namespace["SPATIAL_FLIP_PROBABILITIES"] = probabilities
            with contextlib.redirect_stdout(io.StringIO()):
                exec(train_cell, namespace)
            self.assertEqual(backend.TrainingConfig.call_args.kwargs["spatial_flip_probabilities"], probabilities)
            self.assertEqual(backend.TrainingConfig.call_args.kwargs["random_seed"], 42)

    def test_run_all_reuses_upload_without_prompt(self):
        namespace, _ = self.run_upload()
        namespace, prompt = self.run_upload(namespace=namespace)
        self.files.upload.assert_called_once()
        prompt.assert_not_called()
        self.assertEqual(namespace["dataset_path"], self.saved)

    def test_kernel_restart_reuses_file_without_in_memory_variables(self):
        self.run_upload()
        namespace, prompt = self.run_upload(namespace={})
        self.files.upload.assert_called_once()
        prompt.assert_not_called()
        self.assertEqual(namespace["dataset_path"].read_bytes(), self.payload)

    def test_missing_saved_file_requests_upload_again(self):
        namespace, _ = self.run_upload()
        self.saved.unlink()
        self.run_upload(namespace=namespace)
        self.assertEqual(self.files.upload.call_count, 2)

    def test_negative_answer_does_not_upload(self):
        for answer in ("NO", "", "y", "yes please"):
            with self.subTest(answer=answer), self.assertRaisesRegex(AssertionError, "cancelled"):
                self.run_upload(answer)
        self.files.upload.assert_not_called()

    def test_cancelled_wrong_extension_and_corrupt_zip(self):
        for payload, error in (({}, "exactly one"), ({"a.zip": b"a", "b.zip": b"b"}, "exactly one"),
                               ({"bad.txt": self.payload}, "Expected"), ({"bad.zip": b"bad"}, "readable")):
            with self.subTest(payload=payload):
                self.files.upload.return_value = payload
                with self.assertRaisesRegex(AssertionError, error):
                    self.run_upload()
                self.assertFalse(self.saved.exists())

    def test_inference_approval_accepts_same_variants(self):
        cell = next(c for c in code_cells("InferRef3D_v1_0.ipynb") if "input(" in c)
        approval = next(line.strip() for line in cell.splitlines() if "input(" in line)
        for answer in ("YES", "yes", "Yes", "yEs", " yes "):
            with self.subTest(answer=answer), patch("builtins.input", return_value=answer):
                exec(approval, {})
        with patch("builtins.input", return_value="no"), self.assertRaises(AssertionError):
            exec(approval, {})


if __name__ == "__main__":
    unittest.main()
