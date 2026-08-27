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


if __name__ == "__main__":
    unittest.main()
