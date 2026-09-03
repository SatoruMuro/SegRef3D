"""Normalize and validate the Windows GPU DLL layout after PyInstaller.

PyQt6-Qt6 6.9.1 ships legacy MSVC runtime copies in Qt6/bin.  They conflict
with the newer official runtime collected by PyInstaller at _internal root and
cause PyTorch c10.dll to fail initialization with WinError 1114.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import pefile


CONFLICTING_QT_RUNTIME_NAMES = (
    "msvcp140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
)


def _version(path: Path) -> tuple[int, int, int, int]:
    pe = pefile.PE(str(path), fast_load=True)
    try:
        pe.parse_data_directories(
            directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_RESOURCE"]]
        )
        if not hasattr(pe, "VS_FIXEDFILEINFO"):
            raise RuntimeError(f"DLL has no fixed version resource: {path}")
        info = pe.VS_FIXEDFILEINFO[0]
        return (
            info.FileVersionMS >> 16,
            info.FileVersionMS & 0xFFFF,
            info.FileVersionLS >> 16,
            info.FileVersionLS & 0xFFFF,
        )
    finally:
        pe.close()


def prepare_distribution(dist_dir: Path, *, check_only: bool = False) -> None:
    dist_dir = dist_dir.resolve()
    internal_dir = dist_dir / "_internal"
    qt_bin_dir = internal_dir / "PyQt6" / "Qt6" / "bin"
    torch_lib_dir = internal_dir / "torch" / "lib"

    if not (dist_dir / "SegRef3D.exe").is_file():
        raise RuntimeError(f"Not a SegRef3D onedir distribution: {dist_dir}")
    if not (torch_lib_dir / "c10.dll").is_file():
        raise RuntimeError(f"Bundled PyTorch c10.dll is missing: {torch_lib_dir}")

    for name in CONFLICTING_QT_RUNTIME_NAMES:
        root_dll = internal_dir / name
        qt_dll = qt_bin_dir / name
        if not root_dll.is_file():
            raise RuntimeError(f"Authoritative root MSVC runtime is missing: {root_dll}")

        root_version = _version(root_dll)
        print(f"[DLL] authoritative {name}: {root_version} ({root_dll})")
        if not qt_dll.exists():
            continue

        qt_version = _version(qt_dll)
        if check_only:
            raise RuntimeError(
                f"Conflicting Qt runtime remains: {qt_dll} "
                f"(Qt {qt_version}, root {root_version})"
            )
        print(
            f"[DLL] removing conflicting Qt copy: {qt_dll} "
            f"(Qt {qt_version}, root {root_version})"
        )
        qt_dll.unlink()

    print("[DLL] Windows GPU distribution layout is normalized.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dist_dir", type=Path)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args(argv)
    prepare_distribution(args.dist_dir, check_only=args.check_only)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[DLL] distribution validation failed ({type(exc).__name__}): {exc}")
        raise SystemExit(2)
