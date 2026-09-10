import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("prepare_release", ROOT / "tools/prepare_windows_release.py")
prepare_release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare_release)


class WindowsReleaseTests(unittest.TestCase):
    def test_preparation_removes_artifacts_but_preserves_runtime_and_licenses(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "SegRef3D.exe").write_bytes(b"fixture")
            keep = ["sam2/runtime.py", "configs/model.yaml", "torch/include/runtime.h", "vendor.dll", "vendor.dist-info/licenses/test/LICENSE"]
            remove = ["sam2/__pycache__/runtime.pyc", "scipy/tests/test_example.py", "package/test_unit.py", "package/example.ipynb", "vendor.pdb"]
            for relative in keep + remove:
                target = root / "_internal" / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b"fixture")
            prepare_release.prepare(root)
            for relative in keep:
                self.assertTrue((root / "_internal" / relative).is_file(), relative)
            for relative in remove:
                self.assertFalse((root / "_internal" / relative).exists(), relative)
            self.assertTrue((root / "scripts/audit_windows_signatures.ps1").is_file())
            self.assertTrue((root / "README.md").is_file())
            self.assertTrue((root / "release-info.json").is_file())

    @unittest.skipUnless(os.name == "nt", "Windows packaging policy")
    def test_unsigned_formal_release_requires_explicit_opt_in_and_uses_formal_name(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "SegRef3D-Local-GPU-v1.3.1-Windows"
            root.mkdir()
            # Use an existing Windows PE without executing or modifying it.
            shutil.copy2(sys.executable, root / "SegRef3D.exe")
            (root / "release-info.json").write_text('{"version":"1.3.1"}')
            command = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts/package_windows_release.ps1"), "-DistDir", str(root)]
            env = {**os.environ, "RELEASE_BUILD": "1", "SIGNING_ENABLED": "0", "ALLOW_UNSIGNED_RELEASE": "0"}
            denied = subprocess.run(command, env=env, capture_output=True)
            self.assertNotEqual(denied.returncode, 0)
            self.assertFalse(Path(str(root) + ".zip").exists())
            env["ALLOW_UNSIGNED_RELEASE"] = "1"
            allowed = subprocess.run(command, env=env, capture_output=True)
            self.assertEqual(allowed.returncode, 0, allowed.stderr.decode(errors="replace"))
            archive_path = Path(str(root) + ".zip")
            with zipfile.ZipFile(archive_path) as archive:
                self.assertIsNone(archive.testzip())
                info = archive.read(root.name + "/release-info.json").decode("utf-8-sig")
                self.assertIn('"unsigned"', info)
            extraction = Path(temp) / "extracted"
            verify = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts/verify_windows_release.ps1"), "-ZipPath", str(archive_path), "-ExtractDir", str(extraction)], capture_output=True)
            self.assertEqual(verify.returncode, 0, verify.stderr.decode(errors="replace"))
            self.assertEqual((extraction / root.name / "SegRef3D.exe").read_bytes(), (root / "SegRef3D.exe").read_bytes())
            self.assertTrue((extraction / "verification.json").is_file())

            # Simulate both a failed process and a false zero exit without a
            # success marker. Neither may be reported as release verification success.
            for code in (2, 0):
                runtime_extraction = Path(temp) / f'failed-{code}'
                runner = Path(temp) / f'verify-failure-{code}.ps1'
                runner.write_text("""$ErrorActionPreference = 'Stop'
function Start-Process {
    param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, [switch]$PassThru, $RedirectStandardOutput, $RedirectStandardError)
    'bootstrap failed' | Set-Content -LiteralPath $RedirectStandardOutput
    'WinError 193' | Set-Content -LiteralPath $RedirectStandardError
    $process = [pscustomobject]@{ ExitCode = EXIT_CODE }
    $process | Add-Member ScriptMethod WaitForExit { param($timeout) return $true }
    $process | Add-Member ScriptMethod Refresh { }
    return $process
}
& 'VERIFY_SCRIPT' -ZipPath 'ZIP_PATH' -ExtractDir 'EXTRACT_PATH' -RuntimeChecks
""".replace('EXIT_CODE', str(code)).replace('VERIFY_SCRIPT', str(ROOT / 'scripts/verify_windows_release.ps1'))
                    .replace('ZIP_PATH', str(archive_path)).replace('EXTRACT_PATH', str(runtime_extraction)))
                failed = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(runner)], capture_output=True, timeout=60)
                self.assertNotEqual(failed.returncode, 0)
                record = json.loads((runtime_extraction / 'verification.json').read_text(encoding='utf-8-sig'))
                self.assertEqual(record['Checks'][0]['ExitCode'], code)


if __name__ == "__main__":
    unittest.main()
