import ctypes
import os
from pathlib import Path
import sys


os.environ["SEGREF3D_DISABLE_SAM2"] = "0"
os.environ["SEGREF3D_EDITION"] = "local-gpu"
os.environ["SEGREF3D_FORCE_SAFE_SDPA"] = "1"


def _configure_windows_dll_runtime() -> None:
    """Configure the frozen DLL runtime before PyQt or PyTorch is imported.

    PyQt6-Qt6 6.9.1 contains an older copy of the MSVC runtime in Qt6/bin.
    PyInstaller's Qt runtime hook registers that directory.  If its
    MSVCP140.dll is selected before the newer runtime beside python312.dll,
    PyTorch c10.dll fails its DLL initialization with WinError 1114.

    The distribution preparation step removes those conflicting Qt copies.
    Preloading the authoritative root copies here also makes the selected
    runtime deterministic and protects development builds that have not yet
    gone through that preparation step.
    """
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return

    internal_dir = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    torch_lib_dir = internal_dir / "torch" / "lib"

    handles = []
    for dll_dir in (internal_dir, torch_lib_dir):
        if dll_dir.is_dir():
            handles.append(os.add_dll_directory(str(dll_dir)))

    # Keep add_dll_directory handles alive for the process lifetime.
    sys._segref3d_dll_directory_handles = handles

    loaded = []
    for dll_name in (
        "vcruntime140.dll",
        "vcruntime140_1.dll",
        "msvcp140.dll",
        "concrt140.dll",
    ):
        dll_path = internal_dir / dll_name
        if dll_path.is_file():
            ctypes.WinDLL(str(dll_path))
            loaded.append(str(dll_path))
    sys._segref3d_preloaded_msvc_runtime = loaded


_configure_windows_dll_runtime()
