from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class BuildEditionTests(unittest.TestCase):
    def test_version_is_single_source_for_both_builds(self):
        source = (ROOT / "SegRef3D.py").read_text(encoding="utf-8")
        version = re.search(r'^__version__\s*=\s*["\']([^"\']+)["\']', source, re.MULTILINE)
        self.assertIsNotNone(version)

        for script_name in ("build_windows_gpu.bat", "build_windows_lite.bat"):
            script = (ROOT / script_name).read_text(encoding="utf-8")
            self.assertIn('findstr /b "__version__" SegRef3D.py', script)
            self.assertNotIn(version.group(1), script)

    def test_distribution_names_and_executable_name(self):
        gpu = (ROOT / "build_windows_gpu.bat").read_text(encoding="utf-8")
        cpu = (ROOT / "build_windows_lite.bat").read_text(encoding="utf-8")

        self.assertIn("SegRef3D-Local-GPU-v%VERSION%-Windows", gpu)
        self.assertIn("SegRef3D-Local-CPU-v%VERSION%-Windows", cpu)
        self.assertIn('set "PYINSTALLER_NAME=SegRef3D"', gpu)
        self.assertIn('set "PYINSTALLER_NAME=SegRef3D"', cpu)
        self.assertIn("pyi_local_gpu.py", gpu)
        self.assertIn("pyi_disable_sam2.py", cpu)

    def test_gpu_build_bundles_only_the_runtime_sam2_package_tree(self):
        gpu = (ROOT / "build_windows_gpu.bat").read_text(encoding="utf-8")

        self.assertIn('--add-data "sam2pkg\\sam2;sam2pkg\\sam2"', gpu)
        self.assertNotIn('--add-data "sam2pkg;sam2pkg"', gpu)

    def test_gpu_build_pins_the_qt_runtime_used_by_the_release_workflow(self):
        requirements = (ROOT / "requirements" / "requirements-gpu-cu128.txt").read_text(
            encoding="utf-8"
        )

        self.assertIn("PyQt6==6.9.1", requirements)
        self.assertIn("PyQt6-Qt6==6.9.1", requirements)
        self.assertIn("PyQt6-sip==13.10.2", requirements)

    def test_gpu_build_normalizes_dlls_and_requires_frozen_gpu_check(self):
        gpu = (ROOT / "build_windows_gpu.bat").read_text(encoding="utf-8")

        prepare = 'python tools\\prepare_windows_gpu_dist.py "dist\\%APP_NAME%"'
        audit = 'python tools\\audit_windows_gpu_dlls.py "dist\\%APP_NAME%"'
        frozen_check = '"dist\\%APP_NAME%\\SegRef3D.exe" --gpu-check'
        self.assertIn(prepare, gpu)
        self.assertIn(audit, gpu)
        self.assertIn(frozen_check, gpu)
        self.assertLess(gpu.index(frozen_check), gpu.index("Compress-Archive"))

    def test_gpu_runtime_hook_preloads_authoritative_msvc_runtime(self):
        hook = (ROOT / "tools" / "pyi_local_gpu.py").read_text(encoding="utf-8")

        self.assertIn("os.add_dll_directory", hook)
        self.assertIn('internal_dir / "torch" / "lib"', hook)
        self.assertIn('"msvcp140.dll"', hook)
        self.assertIn("ctypes.WinDLL", hook)

    def test_gpu_edition_does_not_report_the_cpu_only_sam2_message_on_failure(self):
        source = (ROOT / "SegRef3D.py").read_text(encoding="utf-8")

        self.assertIn('gpu_failure = (', source)
        self.assertIn('reason = gpu_failure if edition == "local-gpu" else lite_reason', source)
        self.assertIn("Local SAM2 initialization failed.", source)


if __name__ == "__main__":
    unittest.main()
