"""Audit PE dependencies and duplicate DLLs in a frozen GPU distribution."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import sys

import pefile


SYSTEM_DLLS = {
    "advapi32.dll",
    "bcrypt.dll",
    "cfgmgr32.dll",
    "combase.dll",
    "crypt32.dll",
    "dbghelp.dll",
    "gdi32.dll",
    "kernel32.dll",
    "ntdll.dll",
    "ole32.dll",
    "oleaut32.dll",
    "rpcrt4.dll",
    "secur32.dll",
    "setupapi.dll",
    "shell32.dll",
    "shlwapi.dll",
    "user32.dll",
    "userenv.dll",
    "version.dll",
    "winmm.dll",
    "ws2_32.dll",
}

MSVC_RUNTIME_DLLS = {
    "concrt140.dll",
    "msvcp140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
}

TARGETS = (
    "c10.dll",
    "torch_cpu.dll",
    "torch_python.dll",
    "c10_cuda.dll",
    "torch_cuda.dll",
)


def _imports(path: Path) -> list[tuple[str, str]]:
    pe = pefile.PE(str(path), fast_load=True)
    try:
        pe.parse_data_directories(
            directories=[
                pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"],
                pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT"],
            ]
        )
        result = [
            (entry.dll.decode(errors="replace"), "import")
            for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", [])
        ]
        result.extend(
            (entry.dll.decode(errors="replace"), "delay")
            for entry in getattr(pe, "DIRECTORY_ENTRY_DELAY_IMPORT", [])
        )
        return result
    finally:
        pe.close()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _classify(name: str, matches: list[Path]) -> str:
    lower = name.lower()
    if lower.startswith(("api-ms-win-", "ext-ms-win-")) or lower in SYSTEM_DLLS:
        return "Windows"
    if lower in MSVC_RUNTIME_DLLS:
        return "Microsoft Visual C++ Runtime"
    if any("torch\\lib" in str(path).lower() for path in matches):
        return "PyTorch/CUDA bundle"
    if matches:
        return "bundled third-party"
    return "UNRESOLVED"


def audit(dist_dir: Path) -> int:
    dist_dir = dist_dir.resolve()
    internal_dir = dist_dir / "_internal"
    torch_lib_dir = internal_dir / "torch" / "lib"
    system32_dir = Path(os.environ.get("WINDIR", r"C:\Windows")) / "System32"
    all_dlls = list(internal_dir.rglob("*.dll"))
    by_name: dict[str, list[Path]] = {}
    for path in all_dlls:
        by_name.setdefault(path.name.lower(), []).append(path)

    unresolved: set[str] = set()
    print(f"Distribution: {dist_dir}")
    for target_name in TARGETS:
        target = torch_lib_dir / target_name
        print(f"\n[{target_name}]")
        if not target.is_file():
            print("  MISSING")
            unresolved.add(target_name)
            continue
        for imported_name, import_kind in _imports(target):
            lower = imported_name.lower()
            dist_matches = by_name.get(lower, [])
            system_match = system32_dir / imported_name
            candidates = list(dist_matches)
            if system_match.is_file():
                candidates.append(system_match)
            classification = _classify(imported_name, candidates)
            if classification == "UNRESOLVED":
                unresolved.add(imported_name)
            locations = ", ".join(
                str(path.relative_to(internal_dir))
                if path.is_relative_to(internal_dir)
                else str(path)
                for path in candidates
            ) or "API-set/System32 lookup"
            print(
                f"  {import_kind:6} {imported_name:38} "
                f"{classification:32} {locations}"
            )

    print("\n[duplicate DLL names]")
    for name, paths in sorted(by_name.items()):
        if len(paths) < 2:
            continue
        signatures = {(_sha256(path), path.stat().st_size) for path in paths}
        status = "identical" if len(signatures) == 1 else "DIFFERENT"
        print(f"  {name}: {status}")
        for path in paths:
            print(
                f"    {path.relative_to(internal_dir)} "
                f"size={path.stat().st_size} sha256={_sha256(path)}"
            )

    if unresolved:
        print(f"\nUnresolved non-system dependencies: {sorted(unresolved)}")
        return 2
    print("\nAll direct target dependencies resolve to the bundle or Windows.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dist_dir", type=Path)
    args = parser.parse_args(argv)
    return audit(args.dist_dir)


if __name__ == "__main__":
    raise SystemExit(main())
