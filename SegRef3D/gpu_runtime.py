"""Runtime GPU diagnostics for SegRef3D.

This module intentionally uses only PyTorch public APIs.  It does not import
xformers, flash-attn, or any custom attention package.
"""

from __future__ import annotations

import importlib.metadata
import sys
from typing import Any


def _package_status(distribution_name: str) -> str:
    try:
        return importlib.metadata.version(distribution_name)
    except importlib.metadata.PackageNotFoundError:
        return "not installed"
    except Exception as exc:
        return f"unknown ({exc})"


def get_optional_attention_status() -> dict[str, str]:
    return {
        "xformers": _package_status("xformers"),
        "flash-attn": _package_status("flash-attn"),
    }


def get_cuda_diagnostics() -> dict[str, Any]:
    import torch

    info: dict[str, Any] = {
        "python_executable": sys.executable,
        "torch_version": torch.__version__,
        "torch_cuda": torch.version.cuda,
        "cuda_available": torch.cuda.is_available(),
        "device_name": None,
        "device_capability": None,
        "current_arch": None,
        "supported_archs": [],
        "blackwell_sm120_supported": False,
        "arch_list_has_current": False,
        "cuda_test_ok": False,
        "error": None,
    }

    try:
        info["supported_archs"] = list(torch.cuda.get_arch_list())
        info["blackwell_sm120_supported"] = (
            "sm_120" in info["supported_archs"]
            or "compute_120" in info["supported_archs"]
        )
    except Exception as exc:
        info["error"] = f"get_arch_list failed: {exc}"

    if not info["cuda_available"]:
        return info

    try:
        name = torch.cuda.get_device_name(0)
        major, minor = torch.cuda.get_device_capability(0)
        current_arch = f"sm_{major}{minor}"
        current_compute = f"compute_{major}{minor}"

        info["device_name"] = name
        info["device_capability"] = (major, minor)
        info["current_arch"] = current_arch
        info["arch_list_has_current"] = (
            current_arch in info["supported_archs"]
            or current_compute in info["supported_archs"]
        )

        # A real CUDA kernel launch is required. torch.cuda.is_available() alone
        # can be true even when this PyTorch build cannot run on the GPU arch.
        x = torch.randn((256, 256), device="cuda")
        y = x @ x
        torch.cuda.synchronize()
        _ = y.detach().cpu()

        info["cuda_test_ok"] = True
    except Exception as exc:
        info["error"] = str(exc)
        info["cuda_test_ok"] = False

    return info


def configure_safe_torch_attention() -> None:
    """Prefer portable PyTorch math SDPA over optional optimized kernels."""
    try:
        import torch

        if not hasattr(torch.backends, "cuda"):
            return
        cuda_backend = torch.backends.cuda
        if hasattr(cuda_backend, "enable_flash_sdp"):
            cuda_backend.enable_flash_sdp(False)
        if hasattr(cuda_backend, "enable_mem_efficient_sdp"):
            cuda_backend.enable_mem_efficient_sdp(False)
        if hasattr(cuda_backend, "enable_math_sdp"):
            cuda_backend.enable_math_sdp(True)
        print("[INFO] PyTorch SDPA configured for compatibility: flash=off, mem_efficient=off, math=on")
    except Exception as exc:
        print(f"[WARN] Failed to configure PyTorch SDPA compatibility mode: {exc}")


def choose_sam2_mode(cuda_info: dict[str, Any], allow_cpu_fallback: bool = False) -> tuple[str, str]:
    if cuda_info.get("cuda_test_ok"):
        device = cuda_info.get("device_name") or "CUDA device"
        return "cuda", f"SAM2 enabled on CUDA: {device}"

    if cuda_info.get("cuda_available"):
        reason = (
            "SAM2 GPU mode is disabled because this PyTorch build does not support "
            "the current GPU architecture. Please use the CUDA 12.8+ build of SegRef3D."
        )
        if allow_cpu_fallback:
            return "cpu", reason + " Falling back to CPU SAM2 mode, which may be very slow."
        return "disabled", reason

    if allow_cpu_fallback:
        return "cpu", "SAM2 enabled on CPU. This may be very slow."

    return "disabled", "SAM2 is disabled because no usable CUDA GPU was detected."


def print_cuda_diagnostics(cuda_info: dict[str, Any], sam2_mode: str | None = None) -> None:
    print("=== SegRef3D GPU Diagnostic ===")
    print(f"Python: {cuda_info.get('python_executable')}")
    print(f"Torch: {cuda_info.get('torch_version')}")
    print(f"Torch CUDA: {cuda_info.get('torch_cuda')}")
    print(f"CUDA available: {cuda_info.get('cuda_available')}")
    print(f"GPU: {cuda_info.get('device_name')}")
    capability = cuda_info.get("device_capability")
    if capability:
        print(f"Device capability: {capability[0]}.{capability[1]}")
    else:
        print("Device capability: None")
    print(f"Current arch: {cuda_info.get('current_arch')}")
    print(f"Torch supported archs: {cuda_info.get('supported_archs')}")
    print(f"Blackwell sm_120 support: {cuda_info.get('blackwell_sm120_supported')}")
    print(f"CUDA runtime test: {'OK' if cuda_info.get('cuda_test_ok') else 'FAILED'}")
    if cuda_info.get("error"):
        print(f"CUDA error: {cuda_info.get('error')}")
    optional = get_optional_attention_status()
    print(f"xformers: {optional['xformers']}")
    print(f"flash-attn: {optional['flash-attn']}")
    if sam2_mode is not None:
        print(f"SAM2 mode: {sam2_mode}")
    print("===============================")


def compatibility_result(cuda_info: dict[str, Any]) -> str:
    if cuda_info.get("cuda_test_ok"):
        return "GPU runtime is compatible"
    if cuda_info.get("cuda_available"):
        return "GPU is visible but the runtime test failed"
    return "No CUDA GPU is available"
