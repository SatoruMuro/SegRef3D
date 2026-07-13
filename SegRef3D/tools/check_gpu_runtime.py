from __future__ import annotations

import os
import sys


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from gpu_runtime import (  # noqa: E402
    compatibility_result,
    get_cuda_diagnostics,
    get_optional_attention_status,
)


def main() -> int:
    info = get_cuda_diagnostics()
    optional = get_optional_attention_status()

    print("=== SegRef3D GPU Runtime Check ===")
    print(f"Python: {info.get('python_executable')}")
    print(f"Torch: {info.get('torch_version')}")
    print(f"Torch CUDA: {info.get('torch_cuda')}")
    print(f"CUDA available: {info.get('cuda_available')}")
    print(f"GPU: {info.get('device_name')}")
    capability = info.get("device_capability")
    if capability:
        print(f"Device capability: {capability[0]}.{capability[1]}")
    else:
        print("Device capability: None")
    print(f"Current arch: {info.get('current_arch')}")
    print(f"Torch arch list: {info.get('supported_archs')}")
    print(f"Blackwell sm_120 support: {info.get('blackwell_sm120_supported')}")
    print(f"CUDA tensor test: {'OK' if info.get('cuda_test_ok') else 'FAILED'}")
    if info.get("error"):
        print(f"CUDA error: {info.get('error')}")
    print(f"xformers: {optional['xformers']}")
    print(f"flash-attn: {optional['flash-attn']}")
    print(f"Result: {compatibility_result(info)}")
    print("==================================")

    if info.get("cuda_available") and not info.get("cuda_test_ok"):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
