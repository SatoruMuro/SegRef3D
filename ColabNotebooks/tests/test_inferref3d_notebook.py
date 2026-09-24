"""Upload-first InferRef3D flow without Colab, network or GPU dependencies."""
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

NOTEBOOK = Path(__file__).resolve().parents[1] / "InferRef3D_v1_0.ipynb"


def code_cells():
    notebook = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    return ["".join(c["source"]) for c in notebook["cells"] if c["cell_type"] == "code"]


def archive(*names):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as result:
        for name in names:
            result.writestr(name, "{}")
    return data.getvalue()


class InferRef3DNotebookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = code_cells()[0].replace("/content", self.root.as_posix())
        self.payload = {"request.ZIP": archive("request_manifest.json", "model/model_manifest.json"),
                        "model.zip": archive("model_manifest.json")}
        self.files = types.SimpleNamespace(upload=Mock(return_value=self.payload), download=Mock())
        colab = types.ModuleType("google.colab")
        colab.files = self.files
        google = types.ModuleType("google")
        google.colab = colab
        mock_modules = patch.dict(sys.modules, {"google": google, "google.colab": colab})
        mock_modules.start()
        self.addCleanup(mock_modules.stop)

    def upload(self, answer="YES", namespace=None, source=None):
        namespace = {} if namespace is None else namespace
        with patch("builtins.input", return_value=answer) as prompt, contextlib.redirect_stdout(io.StringIO()):
            exec(source or self.source, namespace)
        return namespace, prompt

    def test_upload_precedes_setup_and_all_later_cells_have_no_prompts(self):
        cells = code_cells()
        self.assertIn("files.upload()", cells[0])
        for dependency in ("%pip", "import torch", "urlopen", "torch.cuda", "import trainref3d", "import inferref3d"):
            self.assertNotIn(dependency, cells[0])
        for source in cells[1:]:
            self.assertNotIn("input(", source)
            self.assertNotIn("files.upload(", source)
        self.assertEqual("\n".join(cells).count("files.upload()"), 1)
        self.assertIn("files.download(result['result_zip'])", cells[-1])
        for source in cells:
            compile("\n".join("pass" if line.startswith("%") else line for line in source.splitlines()), "cell", "exec")

    def test_yes_variants_save_both_original_archives_and_names(self):
        source = self.source.replace("REUPLOAD_INPUTS = False", "REUPLOAD_INPUTS = True")
        for answer in ("YES", "yes", "Yes", "yEs", " \tYeS "):
            with self.subTest(answer=answer):
                namespace, prompt = self.upload(answer, source=source)
                prompt.assert_called_once()
                self.assertEqual(namespace["upload_names"], list(self.payload))
                self.assertEqual([p.read_bytes() for p in namespace["upload_paths"]], list(self.payload.values()))
                self.assertNotIn("uploaded", namespace)

    def test_run_all_and_kernel_restart_reuse_without_input(self):
        namespace, _ = self.upload()
        for state in (namespace, {}):
            restored, prompt = self.upload(namespace=state)
            prompt.assert_not_called()
            self.assertEqual(restored["upload_names"], list(self.payload))
            self.assertEqual([p.read_bytes() for p in restored["upload_paths"]], list(self.payload.values()))
        self.files.upload.assert_called_once()

    def test_missing_zip_or_invalid_upload_record_requests_complete_pair(self):
        for missing in ("inferref3d_upload_0.zip", "inferref3d_upload_1.zip", "inferref3d_uploads.json"):
            self.upload()
            (self.root / missing).unlink()
            _, prompt = self.upload()
            prompt.assert_called_once()
        (self.root / "inferref3d_uploads.json").write_text("broken", encoding="utf-8")
        _, prompt = self.upload()
        prompt.assert_called_once()

    def test_negative_answers_do_not_upload(self):
        for answer in ("", "no", "y", "yes please"):
            with self.subTest(answer=answer), self.assertRaisesRegex(AssertionError, "cancelled"):
                self.upload(answer)
        self.files.upload.assert_not_called()

    def test_invalid_selection_is_rejected_before_saving(self):
        for payload in ({}, {"one.zip": archive("model_manifest.json")},
                        {"a.zip": b"bad", "b.zip": b"bad"},
                        {"a.txt": archive("a"), "b.zip": archive("b")},
                        {"a.zip": b"", "b.zip": b"", "c.zip": b""}):
            with self.subTest(names=list(payload)):
                self.files.upload.return_value = payload
                with self.assertRaises(AssertionError):
                    self.upload()
                self.assertFalse((self.root / "inferref3d_uploads.json").exists())

    def test_oversized_upload_is_rejected(self):
        class Oversized:
            def __len__(self):
                return 1024**3 + 1
        self.files.upload.return_value = {"big.zip": Oversized(), "request.zip": archive("request_manifest.json")}
        with self.assertRaisesRegex(AssertionError, "1 GiB"):
            self.upload()

    def test_interrupted_pair_save_is_not_reused(self):
        self.upload()
        original = Path.write_bytes
        def fail_second(path, data):
            if path.name == "inferref3d_upload_1.zip":
                raise OSError("Simulated interrupted upload")
            return original(path, data)
        with patch.object(Path, "write_bytes", fail_second), self.assertRaisesRegex(OSError, "interrupted"):
            self.upload(source=self.source.replace("REUPLOAD_INPUTS = False", "REUPLOAD_INPUTS = True"))
        self.assertFalse((self.root / "inferref3d_uploads.json").exists())
        _, prompt = self.upload()
        prompt.assert_called_once()

    def test_identification_accepts_either_order_and_rejects_duplicate_or_ambiguous_roles(self):
        validation = next(c for c in code_cells() if "ir.load_model_zip" in c)
        for payload in (self.payload, dict(reversed(list(self.payload.items())))):
            self.files.upload.return_value = payload
            namespace, _ = self.upload(source=self.source.replace("REUPLOAD_INPUTS = False", "REUPLOAD_INPUTS = True"))
            backend = Mock()
            backend.load_model_zip.return_value = {"manifest": {"model_id": "id", "task": {}}}
            backend.load_request_zip.return_value = {"manifest": {"input": {"source_category": "medical_scalar"}, "geometry": {}}}
            namespace["ir"] = backend
            with contextlib.redirect_stdout(io.StringIO()):
                exec(validation.replace("/content", self.root.as_posix()), namespace)
            self.assertEqual(namespace["model_path"].read_bytes(), self.payload["model.zip"])
            self.assertEqual(namespace["request_path"].read_bytes(), self.payload["request.ZIP"])
            backend.validate_model_request.assert_called_once()
        for names in (("model_manifest.json",), ("request_manifest.json",),
                      ("model_manifest.json", "request_manifest.json"), ("unrelated.json",)):
            self.files.upload.return_value = {"a.zip": archive(*names), "b.zip": archive(*names)}
            namespace, _ = self.upload(source=self.source.replace("REUPLOAD_INPUTS = False", "REUPLOAD_INPUTS = True"))
            namespace["ir"] = Mock()
            with self.assertRaises(AssertionError):
                exec(validation, namespace)
            namespace["ir"].load_model_zip.assert_not_called()


if __name__ == "__main__":
    unittest.main()
