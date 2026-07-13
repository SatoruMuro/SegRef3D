# SegRef3D Windows Builds

Both Windows builds use the same `SegRef3D.py` source. Do not create source
forks for GPU or Lite builds.

The build scripts read `__version__` from `SegRef3D.py` as text, without
importing it. Updating only:

```python
__version__ = "1.2.2"
```

changes the next output folder, executable, zip name, and Version Info dialog.

## GPU Build

```bat
build_windows_gpu.bat
```

Output example:

```text
dist\SegRef3D-GPU-v<version>\SegRef3D-GPU-v<version>.exe
dist\SegRef3D-GPU-v<version>-Windows.zip
```

The GPU build installs CUDA 12.8 PyTorch, includes `sam2pkg`, `checkpoints`,
`configs`, `gpu_runtime.py`, and `sam2_interface.py`, and excludes `xformers`
and `flash-attn`.

## Lite Build

```bat
build_windows_lite.bat
```

Output example:

```text
dist\SegRef3D-Lite-v<version>\SegRef3D-Lite-v<version>.exe
dist\SegRef3D-Lite-v<version>-Windows.zip
```

The Lite build excludes CUDA PyTorch, SAM2, `sam2pkg`, checkpoints, SAM2
configs, `xformers`, and `flash-attn`. It includes a PyInstaller runtime hook
that sets:

```text
SEGREF3D_DISABLE_SAM2=1
```

so the executable will not attempt to import SAM2 or torch at startup.

Local SAM2 buttons are disabled with an explanation. `Seg on Web` and
`Instant3Dweb` remain enabled.
