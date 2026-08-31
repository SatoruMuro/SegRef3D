"""CPU: python .../run_trainref3d_smoke.py
GPU: python .../run_trainref3d_smoke.py --gpu [--dataset authorized_dataset.zip]
Synthetic smoke data checks mechanics, never performance/generalizability.
"""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trainref3d_backend as backend
from trainref3d_fixtures import dataset_file


def run():
    import torch
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gpu", action="store_true")
    parser.add_argument("--dataset", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.gpu:
        assert torch.cuda.is_available(), "CUDA GPU unavailable"
    else:
        torch.set_num_threads(2)
        assert not args.dataset, "Use real datasets only in the explicit --gpu smoke test"
    with tempfile.TemporaryDirectory(prefix="trainref3d_smoke_") as temp:
        root = Path(temp)
        # Two cases -> one train iteration (2 patches) + one validation per epoch.
        source = args.dataset or dataset_file(root, count=2, channels=3, negatives=(0,))
        dataset = backend.prepare_dataset(source, root / "work")
        config = backend.TrainingConfig(epochs=3 if args.gpu else 2, num_workers=0, patch_size=(96,96,96) if args.dataset else (16,16,16),
                                        channels=(16,32,64,128,256) if args.dataset else (4,8),
                                        strides=(2,2,2,2) if args.dataset else (2,), num_res_units=1)
        result = backend.train(dataset, args.output or root / "output", config, allow_cpu=not args.gpu)
        state = torch.load(result["checkpoint"], map_location="cpu", weights_only=True)
        restored = backend.build_model(state["architecture_config"])
        restored.load_state_dict(state["state_dict"])
        restored.eval()
        with torch.inference_mode():
            output = restored(torch.zeros(1, dataset["channel_count"], *config.patch_size))
        assert output.shape == (1, 2, *config.patch_size)
        with zipfile.ZipFile(result["archive"]) as archive:
            assert set(archive.namelist()) == {"model.pt", "model_manifest.json", "training_history.csv", "validation_metrics.csv", "README.txt"}
            manifest = json.loads(archive.read("model_manifest.json"))
            assert manifest["training"]["epochs_completed"] == config.epochs
        assert all(0 <= row["dice"] <= 1 for row in result["metrics"])
        print("PASS: forward / loss / backward / best checkpoint reload / validation / Model ZIP")
        if not args.output:
            print("Temporary synthetic outputs are removed automatically; this is not a performance evaluation.")


if __name__ == "__main__":
    run()
