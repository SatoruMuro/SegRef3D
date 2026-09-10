"""Reject host-specific ARM64/ARM64X/CHPE binaries in the Windows x64 bundle."""
from pathlib import Path
import pefile


def require_x64(path: Path) -> None:
    pe = pefile.PE(str(path), fast_load=True)
    try:
        if pe.FILE_HEADER.Machine != 0x8664 or pe.OPTIONAL_HEADER.Magic != 0x20B:
            raise RuntimeError(f"Expected Windows x64 PE: {path} (Machine=0x{pe.FILE_HEADER.Machine:04X})")
        pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_LOAD_CONFIG']])
        config = getattr(getattr(pe, 'DIRECTORY_ENTRY_LOAD_CONFIG', None), 'struct', None)
        if getattr(config, 'CHPEMetadataPointer', 0):
            raise RuntimeError(f"ARM emulation/CHPE runtime is not portable to native x64 Windows: {path}")
    finally:
        pe.close()


def audit_x64_tree(root: Path) -> int:
    paths = [p for p in root.rglob('*') if p.suffix.lower() in ('.exe', '.dll', '.pyd')]
    if not paths:
        raise RuntimeError(f"No PE files in distribution: {root}")
    for path in paths:
        require_x64(path)
    print(f"[PE] Validated {len(paths)} native x64 EXE/DLL/PYD files (no ARM64/CHPE).")
    return len(paths)
