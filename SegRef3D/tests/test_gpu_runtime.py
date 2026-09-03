import sys
from pathlib import Path
from types import SimpleNamespace
import unittest


MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from gpu_runtime import get_torch_build_archs  # noqa: E402


class GpuRuntimeTests(unittest.TestCase):
    def test_build_archs_use_public_cuda_list_when_available(self):
        torch_module = SimpleNamespace(
            cuda=SimpleNamespace(get_arch_list=lambda: ["sm_90", "sm_120"]),
            _C=SimpleNamespace(_cuda_getArchFlags=lambda: "sm_75"),
        )

        self.assertEqual(get_torch_build_archs(torch_module), ["sm_90", "sm_120"])

    def test_build_archs_fall_back_to_wheel_metadata_without_a_gpu(self):
        torch_module = SimpleNamespace(
            cuda=SimpleNamespace(get_arch_list=lambda: []),
            _C=SimpleNamespace(_cuda_getArchFlags=lambda: "sm_75 sm_90 sm_120"),
        )

        self.assertEqual(
            get_torch_build_archs(torch_module),
            ["sm_75", "sm_90", "sm_120"],
        )


if __name__ == "__main__":
    unittest.main()
