#!/usr/bin/env python3
"""Tiny mechanical InferRef3D smoke test for CPU or Colab T4; not performance evidence."""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import time
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import inferref3d_backend as infer
import trainref3d_backend as train
from inferref3d_fixtures import model_zip, request_zip


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gpu", action="store_true", help="Require CUDA and exercise AMP on GPU")
    args = parser.parse_args()
    import torch
    if args.gpu and not torch.cuda.is_available():
        raise SystemExit("CUDA is unavailable; select a T4 GPU runtime.")
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="inferref3d_smoke_") as directory:
        root = Path(directory)
        model, manifest = model_zip(root, train)
        request, _ = request_zip(root, model, manifest)
        result = infer.run_inference(model, request, root / "output", allow_cpu=not args.gpu)
        with zipfile.ZipFile(result["result_zip"]) as archive:
            assert set(archive.namelist()) == {"prediction.nii.gz", "inference_result.json", "README.txt"}
            result_manifest = json.loads(archive.read("inference_result.json"))
        assert result_manifest["format"] == infer.RESULT_FORMAT
        assert result_manifest["model"]["target_label_id"] == 5
        assert result_manifest["prediction"]["label_values"] == [0, 5]
        assert result_manifest["backend"]["source_sha256"] == infer.backend_sha256()
        print(json.dumps({"status": "PASS", "device": result["device"],
                          "peak_gpu_memory_bytes": result["peak_gpu_memory_bytes"],
                          "runtime_seconds": time.perf_counter() - started,
                          "checks": ["safe archives", "weights_only state_dict", "preprocessing", "AMP when CUDA",
                                     "sliding-window inference", "oblique original-grid inverse", "target Obj ID",
                                     "Result ZIP and manifest"]}, indent=2))


if __name__ == "__main__":
    main()
