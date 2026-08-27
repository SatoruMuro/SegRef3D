# SegRef3D Windows Builds

Both Windows packages use the same `SegRef3D.py` source. Do not create source
forks for Local GPU or Local CPU builds.

The build scripts read `__version__` from `SegRef3D.py` as text, without
importing it. Updating only:

```python
__version__ = "<version>"
```

changes the next output folder, zip name, and Version Info dialog. The executable
inside either package is always named `SegRef3D.exe`.

## SegRef3D Local GPU

```bat
build_windows_gpu.bat
```

Output example:

```text
dist\SegRef3D-Local-GPU-v<version>-Windows\SegRef3D.exe
dist\SegRef3D-Local-GPU-v<version>-Windows.zip
```

The Local GPU build installs CUDA 12.8 PyTorch, includes `sam2pkg`, `checkpoints`,
`configs`, `gpu_runtime.py`, and `sam2_interface.py`, and excludes `xformers`
and `flash-attn`.

## SegRef3D Local CPU

```bat
build_windows_lite.bat
```

Output example:

```text
dist\SegRef3D-Local-CPU-v<version>-Windows\SegRef3D.exe
dist\SegRef3D-Local-CPU-v<version>-Windows.zip
```

The Local CPU build excludes CUDA PyTorch, SAM2, `sam2pkg`, checkpoints, SAM2
configs, `xformers`, and `flash-attn`. It includes a PyInstaller runtime hook
that sets:

```text
SEGREF3D_DISABLE_SAM2=1
SEGREF3D_EDITION=local-cpu
```

so the executable will not attempt to import SAM2 or torch at startup.

Local SAM2 buttons are disabled with an explanation. `Seg Anything`, `Seg CT/MRI`, and
`Legacy Instant3DWeb` remain enabled.

Before distribution, extract each ZIP into a fresh directory and run
`SegRef3D.exe --startup-smoke-test`. Also run `SegRef3D.exe --gpu-check` for
SegRef3D Local GPU.
