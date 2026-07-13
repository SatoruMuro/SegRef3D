# SegRef3D Windows GPU Build Notes

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

## GPU build environment

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

Do not use CUDA 11.8 for the GPU build.

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

The GPU build uses onedir packaging:

```bat
pyinstaller --noconfirm --clean SegRef3D_gpu.spec
```

Output:

```text
dist\SegRef3D-GPU-v<version>\SegRef3D-GPU-v<version>.exe
```

Run the executable from a terminal to keep startup diagnostics visible:

```bat
dist\SegRef3D-GPU-v<version>\SegRef3D-GPU-v<version>.exe
dist\SegRef3D-GPU-v<version>\SegRef3D-GPU-v<version>.exe --gpu-check
```

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
