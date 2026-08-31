"""CPU-only transform/metric tests; forward/backward lives in the separate smoke script."""
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trainref3d_backend as backend
from trainref3d_fixtures import dataset_file


@unittest.skipUnless(importlib.util.find_spec("torch") and importlib.util.find_spec("monai"), "Optional training dependencies not installed")
class TrainRef3DTrainingTests(unittest.TestCase):
    def test_scalar_and_rgb_normalization_preserve_input(self):
        import torch
        from monai.data import MetaTensor
        scalar = MetaTensor(torch.arange(120, dtype=torch.float32).reshape(1, 4, 5, 6) * 100 - 1000)
        original = scalar.clone()
        result = backend.NormalizeIntensity()({"image": scalar})["image"]
        self.assertAlmostEqual(float(result.mean()), 0, places=5)
        self.assertAlmostEqual(float(result.std(unbiased=False)), 1, places=5)
        self.assertTrue(torch.equal(original, scalar))
        self.assertTrue(torch.equal(result.affine, scalar.affine))
        rgb = MetaTensor(torch.tensor([0.0, 127.5, 255.0]).reshape(3,1,1,1))
        self.assertEqual(backend.NormalizeIntensity(True)({"image": rgb})["image"].flatten().tolist(), [0, 0.5, 1])

    def test_validation_negative_dice_convention_and_singleton_time_axis(self):
        import nibabel as nib
        import numpy as np
        import torch
        class ConstantModel(torch.nn.Module):
            def __init__(self, foreground):
                super().__init__()
                self.foreground = foreground
            def forward(self, x):
                output = torch.zeros(x.shape[0], 2, *x.shape[2:], device=x.device)
                output[:, int(self.foreground)] = 1
                return output
        def singleton_time(m, files):
            channel = m["image"]["channels"][0]
            source = nib.Nifti1Image.from_bytes(files[channel["file"]])
            files[channel["file"]] = nib.Nifti1Image(np.asarray(source.dataobj)[..., None], source.affine).to_bytes()
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            dataset = backend.prepare_dataset(dataset_file(directory, case_mutate=singleton_time), Path(directory) / "work")
            config = backend.TrainingConfig(patch_size=(16,16,16), channels=(4,8), strides=(2,), num_workers=0)
            negative = [c for c in dataset["cases"] if not c["target_voxels"]]
            transform = backend.make_transforms(dataset, config)
            for foreground, expected in ((False, 1.0), (True, 0.0)):
                rows = backend.validate_model(ConstantModel(foreground), negative, transform, torch.device("cpu"), config.patch_size)
                self.assertEqual(rows[0]["dice"], expected)


if __name__ == "__main__":
    unittest.main()
