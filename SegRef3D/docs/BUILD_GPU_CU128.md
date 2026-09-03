# SegRef3D Local GPU Build Notes

This build profile is for NVIDIA GPU compatibility, including RTX 50-series /
Blackwell GPUs such as RTX 5080 Laptop GPU (`sm_120`).

## Why a new build profile is required

The older SegRef3D build used PyTorch with CUDA 11.8. That runtime can see an
RTX 5080 GPU, but it cannot safely run kernels for `sm_120`. The symptom is a
SAM2 failure such as:

- `CUDA capability sm_120 is not compatible with the current PyTorch installation`
- `fmha_cutlass... is for sm80-sm100, but was built for sm37`

This is a build/runtime compatibility problem, not a SegRef3D label-mask logic
bug.

## SegRef3D Local GPU environment

Use a fresh Windows virtual environment. The provided build script uses Python
3.12 by default:

```bat
build_windows_gpu.bat
```

To use another Python:

```bat
set PYTHON_EXE=C:\Path\To\Python311\python.exe
build_windows_gpu.bat
```

The build script installs the PyTorch packages from the official CUDA 12.8 wheel
index before installing the remaining requirements:

```bat
pip install --force-reinstall torch==2.11.0+cu128 torchvision==0.26.0+cu128 torchaudio==2.11.0+cu128 --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements-gpu-cu128.txt
```

Do not use CUDA 11.8 for SegRef3D Local GPU.

## Runtime diagnostics

Run this inside the build venv:

```bat
.venv-gpu-cu128\Scripts\python.exe tools\check_gpu_runtime.py
```

The RTX 50-series target must show either direct `sm_120` support or an
appropriate PTX fallback, and the real CUDA tensor test must pass. If CUDA is
visible but the tensor test fails, do not ship that build for RTX 50-series.

## Optional attention kernels

The compatibility build intentionally excludes:

- `xformers`
- `flash-attn`

SegRef3D configures PyTorch SDPA for compatibility at startup:

- flash SDPA disabled
- memory-efficient SDPA disabled
- math SDPA enabled

This avoids shipping an optional attention kernel compiled only for older GPU
architectures. The build script prints:

```bat
pip show xformers
pip show flash-attn
```

Preferred result:

- `xformers: not installed`
- `flash-attn: not installed`

## SAM2 custom CUDA extension

This source tree contains SAM2's optional connected-components CUDA extension
source, but no verified prebuilt `sam2._C` binary for CUDA 12.8 / `sm_120`.
The compatibility build therefore disables SAM2's small-hole-fill postprocess
by setting `++model.fill_hole_area=0` in `sam2pkg\sam2\build_sam.py`.

This avoids shipping a custom extension compiled for the wrong GPU generation.
SAM2 box-prompt segmentation still uses the standard PyTorch execution path.

## CPU fallback

By default, SAM2 is disabled if the CUDA runtime test fails or if no CUDA GPU is
available. The rest of SegRef3D remains usable.

CPU SAM2 fallback can be enabled for testing:

```bat
set SEGREF3D_ALLOW_SAM2_CPU=1
SegRef3D.py
```

CPU SAM2 may be very slow and is not the default distributable behavior.

## PyInstaller

SegRef3D Local GPU uses onedir packaging. The build script invokes PyInstaller
and then creates the versioned distribution directory and ZIP.

```bat
build_windows_gpu.bat
```

Output:

```text
dist\SegRef3D-Local-GPU-v<version>-Windows\SegRef3D.exe
dist\SegRef3D-Local-GPU-v<version>-Windows.zip
```

Run the executable from a terminal to keep startup diagnostics visible:

```bat
dist\SegRef3D-Local-GPU-v<version>-Windows\SegRef3D.exe --startup-smoke-test
dist\SegRef3D-Local-GPU-v<version>-Windows\SegRef3D.exe --gpu-check
```

The build is rejected before ZIP creation unless the frozen `--gpu-check`
can import PyTorch. On a machine with a visible CUDA GPU it also requires the
CUDA tensor operation to succeed.

## Microsoft Visual C++ runtime and DLL layout

The onedir distribution is self-contained. PyInstaller collects the official
Microsoft Visual C++ runtime beside `python312.dll` in `_internal`; users are
not required to install a separate redistributable for this package.

PyQt6-Qt6 6.9.1 also contains older MSVC runtime copies under
`_internal\PyQt6\Qt6\bin`. Those copies must not ship because the Qt runtime
hook adds that directory to the Windows DLL search path and can make PyTorch
`c10.dll` initialize against the wrong `MSVCP140.dll`. The build therefore:

1. removes only `MSVCP140.dll`, `VCRUNTIME140.dll`, and
   `VCRUNTIME140_1.dll` from the Qt subdirectory;
2. retains the authoritative Microsoft runtime at `_internal` root;
3. registers `_internal` and `_internal\torch\lib` before application imports;
4. preloads the authoritative root runtime; and
5. runs the PE dependency audit and frozen `--gpu-check` before ZIP creation.

## Test matrix

### A. RTX 5080 Laptop GPU / RTX 50-series

Expected:

- CUDA diagnostic passes
- current architecture reports `sm_120`
- CUDA tensor test is `OK`
- SAM2 mode is `cuda`
- SAM2 box-prompt segmentation runs without `sm_120` or `fmha_cutlass` errors

### B. RTX 30-series or RTX 40-series

Expected:

- CUDA diagnostic passes
- CUDA tensor test is `OK`
- SAM2 mode is `cuda`
- SAM2 box-prompt segmentation runs on GPU

### C. No NVIDIA GPU

Expected:

- App launches
- Non-SAM2 functions work
- SAM2 is disabled with a clear message, unless CPU fallback is explicitly enabled
- No crash
