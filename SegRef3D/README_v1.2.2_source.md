# SegRef3D v1.2.2 Source Backup

This folder contains the SegRef3D v1.2.2 desktop source backup.

## Layout

- `SegRef3D.py` - main PyQt6 application.
- `ui_SegRef3D.py` - generated UI module used by the main app.
- `sam2_interface.py`, `gpu_runtime.py` - optional local SAM2/GPU integration.
- `remote_sam2_interface.py`, `totalseg_interface.py` - external segmentation integrations.
- `tools/` - runtime/build helper scripts.
- `requirements/` - Lite, CPU, and CUDA 12.8 GPU requirement sets.
- `docs/` - Windows and CUDA 12.8 build notes.
- `build_windows_lite.bat` - builds the SAM2-free lightweight Windows app.
- `build_windows_gpu.bat` - builds the CUDA 12.8 SAM2 Windows app.

## Notes

- SAM2 checkpoints, `sam2pkg`, virtual environments, generated masks, and PyInstaller outputs are intentionally not tracked.
- The Lite build is controlled by `SEGREF3D_DISABLE_SAM2=1` and should launch without Torch/SAM2.
- The GPU build uses CUDA 12.8 PyTorch and checks for modern GPU architecture support such as `sm_120`.
