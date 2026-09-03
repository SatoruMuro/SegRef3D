import contextlib
import ast
import io
import json
from pathlib import Path
from unittest import mock
import tempfile
import unittest
import zipfile

import nibabel as nib
import numpy as np

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import inferref3d_backend as infer
import trainref3d_backend as train
from inferref3d_fixtures import model_zip, request_zip


class InferRef3DBackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def pair(self, channels=1, **kwargs):
        model, manifest = model_zip(self.root, train, channels, **kwargs)
        request, request_manifest = request_zip(self.root, model, manifest, channels)
        return model, request, manifest, request_manifest

    def test_model_zip_safe_load_and_weights_only_architecture_reconstruction(self):
        import torch
        model_path, request_path, manifest, _ = self.pair()
        info = infer.load_model_zip(model_path, self.root)
        original = torch.load
        with mock.patch("torch.load", wraps=original) as loader:
            restored = infer.load_weights_model(info, torch.device("cpu"))
        self.assertTrue(loader.call_args.kwargs["weights_only"])
        self.assertEqual(restored(torch.zeros(1, 1, 8, 8, 8)).shape, (1, 2, 8, 8, 8))

    def test_notebook_and_launcher_expose_explicit_two_file_colab_workflow(self):
        notebook_path = Path(__file__).resolve().parents[1] / "InferRef3D_v1_0.ipynb"
        notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
        source = "\n".join("".join(cell.get("source", [])) for cell in notebook["cells"])
        self.assertIn("BACKEND_REF = 'main'", source)
        self.assertIn("len(uploaded) == 2", source)
        self.assertIn("ir.run_inference", source)
        self.assertIn("files.download", source)
        self.assertNotIn("gradio", source.lower())
        for cell in notebook["cells"]:
            if cell.get("cell_type") != "code":
                continue
            python_source = "\n".join(line for line in "".join(cell["source"]).splitlines()
                                      if not line.lstrip().startswith("%"))
            ast.parse(python_source or "pass")
        launcher = (notebook_path.parent / "inferref3d.html").read_text(encoding="utf-8")
        self.assertIn("InferRef3D_v1_0.ipynb", launcher)
        self.assertIn("does not upload", launcher)

    def test_checkpoint_manifest_architecture_mismatch_is_rejected(self):
        model_path, _, _, _ = self.pair(mutate_checkpoint=lambda value: value["architecture_config"].update(out_channels=3))
        info = infer.load_model_zip(model_path, self.root)
        import torch
        with self.assertRaisesRegex(ValueError, "architecture mismatch"):
            infer.load_weights_model(info, torch.device("cpu"))

    def test_unsafe_model_and_request_paths_are_rejected(self):
        for filename, loader in (("bad_model.zip", infer.load_model_zip), ("bad_request.zip", infer.load_request_zip)):
            path = self.root / filename
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("../escape", b"x")
            with self.subTest(filename=filename), self.assertRaisesRegex(ValueError, "Unsafe ZIP path"):
                loader(path, self.root)

    def test_scalar_and_rgb_preprocessing_reproduce_training_normalization(self):
        for channels in (1, 3):
            with self.subTest(channels=channels):
                directory = self.root / f"c{channels}"
                directory.mkdir()
                model, manifest = model_zip(directory, train, channels)
                request, _ = request_zip(directory, model, manifest, channels)
                loaded = infer.load_request_zip(request, directory)
                item = infer.preprocessing_transform(manifest)({"image": loaded["image"]})
                self.assertEqual(item["image"].shape[0], channels)
                if channels == 3:
                    self.assertGreaterEqual(float(item["image"].min()), 0)
                    self.assertLessEqual(float(item["image"].max()), 1)
                else:
                    self.assertAlmostEqual(float(item["image"].mean()), 0, places=4)
                    self.assertAlmostEqual(float(item["image"].std(unbiased=False)), 1, places=4)

    def test_model_hash_channel_and_source_category_mismatch_are_rejected(self):
        model_path, request_path, _, _ = self.pair()
        model = infer.load_model_zip(model_path, self.root)
        request = infer.load_request_zip(request_path, self.root)
        request["manifest"]["model"]["model_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            infer.validate_model_request(model, request)
        request["manifest"]["model"]["model_sha256"] = model["sha256"]
        request["manifest"]["input"]["source_category"] = "grayscale_8bit"
        with self.assertRaisesRegex(ValueError, "source category"):
            infer.validate_model_request(model, request)
        request["manifest"]["input"]["source_category"] = "rgb"
        request["manifest"]["input"]["channel_count"] = 3
        request["manifest"]["input"]["channels"] = [
            {"index": index, "name": ("red", "green", "blue")[index],
             "file": f"input/TR3DI_12345678_{index:04d}.nii", "sha256": f"{index + 1}" * 64,
             "datatype": "uint8"}
            for index in range(3)
        ]
        with self.assertRaisesRegex(ValueError, "channel count"):
            infer.validate_model_request(model, request)

    def test_oblique_anisotropic_inverse_and_target_id_mapping(self):
        import torch
        class ForegroundModel(torch.nn.Module):
            def forward(self, image):
                output = torch.zeros(image.shape[0], 2, *image.shape[2:], device=image.device)
                output[:, 1] = 1
                return output
        model_path, request_path, _, request_manifest = self.pair()
        model_info = infer.load_model_zip(model_path, self.root)
        request = infer.load_request_zip(request_path, self.root)
        prediction, affine, peak = infer.predict_to_original_grid(
            ForegroundModel(), request, model_info["manifest"], torch.device("cpu"),
        )
        self.assertEqual(list(prediction.shape), request_manifest["geometry"]["shape"])
        np.testing.assert_allclose(affine, request_manifest["geometry"]["affine"], rtol=0, atol=1e-5)
        self.assertTrue(set(np.unique(prediction)).issubset({0, 5}))
        self.assertGreater(int(np.count_nonzero(prediction == 5)), prediction.size // 2)
        self.assertIsNone(peak)

    def test_negative_empty_prediction_is_supported(self):
        import torch
        class BackgroundModel(torch.nn.Module):
            def forward(self, image):
                output = torch.zeros(image.shape[0], 2, *image.shape[2:], device=image.device)
                output[:, 0] = 1
                return output
        model_path, request_path, manifest, _ = self.pair()
        request = infer.load_request_zip(request_path, self.root)
        prediction, _, _ = infer.predict_to_original_grid(
            BackgroundModel(), request, manifest, torch.device("cpu"),
        )
        self.assertEqual(int(prediction.sum()), 0)

    def test_cpu_synthetic_end_to_end_result_zip_and_manifest(self):
        model_path, request_path, _, request_manifest = self.pair()
        with contextlib.redirect_stdout(io.StringIO()):
            result = infer.run_inference(model_path, request_path, self.root / "output", allow_cpu=True)
        with zipfile.ZipFile(result["result_zip"]) as archive:
            self.assertEqual(set(archive.namelist()), {"prediction.nii.gz", "inference_result.json", "README.txt"})
            manifest = json.loads(archive.read("inference_result.json"))
            self.assertEqual(manifest["format"], "trainref3d-inference-result-1.0")
            self.assertEqual(manifest["model"]["target_label_id"], 5)
            self.assertEqual(manifest["prediction"]["label_values"], [0, 5])
            self.assertEqual(manifest["source"]["original_geometry"], request_manifest["geometry"])
            prediction_path = self.root / "result_prediction.nii.gz"
            prediction_path.write_bytes(archive.read("prediction.nii.gz"))
        prediction = nib.load(prediction_path)
        self.assertEqual(list(prediction.shape), request_manifest["geometry"]["shape"])
        np.testing.assert_allclose(prediction.affine, request_manifest["geometry"]["affine"], rtol=0, atol=1e-5)
        self.assertTrue(set(np.unique(np.asarray(prediction.dataobj))).issubset({0, 5}))
        self.assertEqual(manifest["prediction"]["sha256"], infer.sha256_file(prediction_path))
        self.assertRegex(manifest["backend"]["source_sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
