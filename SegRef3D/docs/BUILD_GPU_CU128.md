# SegRef3D Local GPU Build Notes

For signature inventory, production certificate setup, third-party binary review,
and the required order of signing and packaging, see [Windows signing](WINDOWS_SIGNING.md).
`SIGNING_ENABLED=0` is the default development mode. `RELEASE_BUILD=1` requires
signing or explicit `ALLOW_UNSIGNED_RELEASE=1`. Formal ZIP names follow
`SegRef3D-Local-GPU-v<version>-Windows.zip`; `release-info.json` records signing status.
Development ZIPs retain the `-signed.zip` / `-unsigned.zip` suffix.
For an explicitly authorized unsigned release, set `RELEASE_BUILD=1`,
`ALLOW_UNSIGNED_RELEASE=1`, and `SIGNING_ENABLED=0`. After packaging, run:

```powershell
.\scripts\verify_windows_release.ps1 -ZipPath .\dist\SegRef3D-Local-GPU-v1.3.2-Windows.zip -ExtractDir .\dist\verify-v1.3.2 -RuntimeChecks
```
The build preflights VTK imports; final VTK/GPU/GUI checks run on the extracted ZIP.

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

Release verification must run on a fresh extraction of the final ZIP. A failed
VTK/GPU/GUI diagnostic, or missing success marker, makes verification fail. On a
machine with a visible CUDA GPU the diagnostic also requires a CUDA tensor operation.

## Microsoft Visual C++ runtime and DLL layout

The onedir distribution bundles the native x64 Microsoft Visual C++ runtime
beside `python312.dll` in `_internal`. Do not use System32 as the runtime source:
on Windows ARM64 it can contain ARM64X/CHPE DLLs that work on the build host but
fail with WinError 193 on native x64 Windows.

Download the pinned, Microsoft-signed redistributable and set its path before building:

```powershell
New-Item -ItemType Directory -Force build/deps
curl.exe -L --fail -o build/deps/VC_redist.x64.exe https://aka.ms/vs/18/release/14.50.35719/VC_redist.x64.exe
Get-AuthenticodeSignature build/deps/VC_redist.x64.exe
$env:MSVC_REDIST_EXE = (Resolve-Path build/deps/VC_redist.x64.exe).Path
.\build_windows_gpu.bat
```

`stage_windows_msvc.py` verifies installer SHA-256
`8995548dfffcde7c49987029c764355612ba6850ee09a7b6f0fddc85bdc5c280`,
extracts only `vcRuntimeMinimum_amd64/cab1.cab`, and validates every extracted
DLL as native x64. It does not run the installer or modify Windows. The x64
installer also contains an ARM64 payload, which must not be used for this bundle.
Use a fresh `build/msvc-x64` staging directory for each build. The distribution
includes `msvc-runtime-provenance.json` with source URL, version and DLL hashes.

PyQt6-Qt6 6.9.1 also contains older MSVC runtime copies under
`_internal\PyQt6\Qt6\bin`. Those copies must not ship because the Qt runtime
hook adds that directory to the Windows DLL search path and can make PyTorch
`c10.dll` initialize against the wrong `MSVCP140.dll`. The build therefore:

1. explicitly passes the verified x64 DLLs to PyInstaller as binaries;
2. verifies their collected hashes and removes older Qt copies of that runtime family;
3. registers `_internal` and `_internal\torch\lib` before application imports;
4. leaves actual runtime loading to Windows/PyInstaller, without ctypes preloads;
5. rejects every non-x64 or CHPE EXE/DLL/PYD before packaging and after extraction;
6. runs VTK/GPU/GUI checks on the extracted ZIP and records the host architecture.

An ARM64-host startup test is not native x64 device acceptance. Record this limit
explicitly and perform native x64 and NVIDIA GPU testing when those devices are available.

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
