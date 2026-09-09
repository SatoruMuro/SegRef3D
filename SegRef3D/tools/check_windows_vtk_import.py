"""Bounded preflight: don't start a release build with blocked VTK binaries."""
import subprocess
import sys


def main():
    try:
        result = subprocess.run(
            [sys.executable, "-u", "-c",
             "from vtkmodules.qt.QVTKRenderWindowInteractor import QVTKRenderWindowInteractor; "
             "from vtkmodules import vtkInteractionStyle, vtkInteractionWidgets; "
             "import vtk; print('VTK import OK:', vtk.vtkVersion.GetVTKVersion())"],
            timeout=120,
        )
        return result.returncode
    except subprocess.TimeoutExpired:
        print("VTK import timed out after 120 seconds. Check CodeIntegrity/Operational; build stopped.", flush=True)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
