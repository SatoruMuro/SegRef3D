import importlib.util
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('windows_pe', ROOT / 'tools/windows_pe.py')
windows_pe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(windows_pe)


def fixture(path, machine=0x8664, chpe=False):
    data = bytearray(1024)
    data[:2] = b'MZ'
    struct.pack_into('<I', data, 60, 128)
    data[128:132] = b'PE\0\0'
    struct.pack_into('<HH', data, 132, machine, 1)
    struct.pack_into('<H', data, 148, 240)
    optional = 152
    struct.pack_into('<H', data, optional, 0x20B)
    struct.pack_into('<I', data, optional + 108, 16)
    struct.pack_into('<II', data, optional + 192, 4096, 208)
    section = optional + 240
    data[section:section+8] = b'.rdata\0\0'
    struct.pack_into('<IIII', data, section + 8, 512, 4096, 512, 512)
    struct.pack_into('<I', data, 512, 208)
    struct.pack_into('<Q', data, 712, 0x180001100 if chpe else 0)
    path.write_bytes(data)


class WindowsX64Tests(unittest.TestCase):
    def test_native_x64_and_host_specific_binaries(self):
        with tempfile.TemporaryDirectory() as temp:
            dll = Path(temp) / 'vcruntime140.dll'
            fixture(dll)
            windows_pe.require_x64(dll)
            for machine, chpe in [(0xAA64, False), (0xA641, False), (0x14C, False), (0x8664, True)]:
                fixture(dll, machine, chpe)
                with self.subTest(machine=machine, chpe=chpe), self.assertRaises(RuntimeError):
                    windows_pe.require_x64(dll)

    def test_corrupt_pe_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            dll = Path(temp) / 'bad.dll'
            dll.write_bytes(b'not a DLL')
            with self.assertRaises(Exception):
                windows_pe.audit_x64_tree(Path(temp))

    @unittest.skipUnless(os.name == 'nt', 'PowerShell verifier')
    def test_powershell_and_python_agree_for_x64_arm64_and_chpe(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            dll = folder / 'vcruntime140.dll'
            runner = folder / 'check.ps1'
            runner.write_text("$ErrorActionPreference='Stop'\n. '" + str(ROOT / 'scripts/check_windows_x64.ps1') + "'\nAssert-WindowsX64Bundle $PSScriptRoot\n")
            for machine, chpe, success in [(0x8664, False, True), (0xAA64, False, False), (0x14C, False, False), (0x8664, True, False)]:
                fixture(dll, machine, chpe)
                result = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(runner)], capture_output=True, timeout=60)
                self.assertEqual(result.returncode == 0, success, result.stderr.decode(errors='replace'))


if __name__ == '__main__':
    unittest.main()
