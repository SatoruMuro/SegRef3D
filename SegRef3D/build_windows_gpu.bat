@echo off
setlocal

cd /d "%~dp0"

set "VENV_DIR=.venv-gpu-cu128"
if "%PYTHON_EXE%"=="" set "PYTHON_EXE=C:\Users\sator\AppData\Local\Programs\Python\Python312\python.exe"

echo === SegRef3D CUDA 12.8 GPU Build ===
echo Python: %PYTHON_EXE%
echo Venv: %CD%\%VENV_DIR%

if not exist "%VENV_DIR%\Scripts\python.exe" (
    "%PYTHON_EXE%" -m venv "%VENV_DIR%"
    if errorlevel 1 exit /b 1
)

call "%VENV_DIR%\Scripts\activate.bat"
if errorlevel 1 exit /b 1

python -m pip install --upgrade pip setuptools wheel
if errorlevel 1 exit /b 1

pip install --force-reinstall torch==2.11.0+cu128 torchvision==0.26.0+cu128 torchaudio==2.11.0+cu128 --index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 exit /b 1

pip install -r requirements\requirements-gpu-cu128.txt
if errorlevel 1 exit /b 1

for /f "tokens=2 delims==" %%i in ('findstr /b "__version__" SegRef3D.py') do set "VERSION=%%i"
set "VERSION=%VERSION: =%"
set "VERSION=%VERSION:"=%"
set "VERSION=%VERSION:'=%"
if "%VERSION%"=="" (
    echo Failed to read __version__ from SegRef3D.py
    exit /b 1
)

set "APP_NAME=SegRef3D-GPU-v%VERSION%"
set "SEGREF3D_APP_NAME=%APP_NAME%"
set "SEGREF3D_DISABLE_SAM2=0"
set "SEGREF3D_FORCE_SAFE_SDPA=1"

echo.
echo === Optional attention packages ===
pip show xformers || echo xformers: not installed
pip show flash-attn || echo flash-attn: not installed

echo.
python tools\check_gpu_runtime.py
if errorlevel 2 (
    echo.
    echo GPU runtime check failed on a visible CUDA GPU. This environment is not suitable for the RTX 50-series build.
    exit /b 2
)

python -c "import sys, torch; archs=list(torch.cuda.get_arch_list()); print('Build torch:', torch.__version__, 'CUDA', torch.version.cuda); print('Build torch arch list:', archs); sys.exit(0 if torch.version.cuda and ('sm_120' in archs or 'compute_120' in archs) else 3)"
if errorlevel 3 (
    echo.
    echo This PyTorch build does not advertise sm_120 or compute_120 support. Do not ship it for RTX 50-series GPUs.
    exit /b 3
)

echo.
echo === Building %APP_NAME% with PyInstaller onedir ===
pyinstaller SegRef3D.py ^
    --name "%APP_NAME%" ^
    --noconfirm ^
    --clean ^
    --onedir ^
    --console ^
    --icon "SegRef3D.ico" ^
    --paths "sam2pkg" ^
    --paths "sam2pkg\sam2" ^
    --add-data "ffmpeg_bin\ffmpeg.exe;ffmpeg_bin" ^
    --add-data "configs;configs" ^
    --add-data "checkpoints;checkpoints" ^
    --add-data "sam2pkg;sam2pkg" ^
    --add-data "sam2pkg\sam2;sam2" ^
    --add-data "sam2_interface.py;." ^
    --add-data "gpu_runtime.py;." ^
    --hidden-import sam2_interface ^
    --hidden-import gpu_runtime ^
    --hidden-import build_sam ^
    --hidden-import sam2 ^
    --hidden-import sam2.build_sam ^
    --hidden-import sam2.sam2_video_predictor ^
    --hidden-import sam2.sam2_image_predictor ^
    --hidden-import pydicom.encoders.pylibjpeg ^
    --hidden-import pydicom.encoders.gdcm ^
    --hidden-import vtkmodules.all ^
    --hidden-import vtkmodules.qt.QVTKRenderWindowInteractor ^
    --collect-all torch ^
    --collect-all torchvision ^
    --collect-all torchaudio ^
    --collect-all PyQt6 ^
    --collect-all cv2 ^
    --collect-all pydicom ^
    --collect-all pylibjpeg ^
    --collect-all pylibjpeg_libjpeg ^
    --collect-all pylibjpeg_openjpeg ^
    --collect-all gdcm ^
    --collect-all nrrd ^
    --collect-all nibabel ^
    --collect-all vtk ^
    --collect-all vtkmodules ^
    --collect-all SimpleITK ^
    --collect-all trimesh ^
    --collect-all shapely ^
    --collect-all svgpathtools ^
    --collect-all skimage ^
    --collect-all scipy ^
    --collect-all PIL ^
    --collect-all imageio ^
    --collect-all hydra ^
    --collect-all omegaconf ^
    --collect-all iopath ^
    --collect-all fvcore ^
    --exclude-module xformers ^
    --exclude-module flash_attn
if errorlevel 1 exit /b 1

echo.
echo === Creating zip ===
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -LiteralPath 'dist\%APP_NAME%' -DestinationPath 'dist\%APP_NAME%-Windows.zip' -Force"
if errorlevel 1 exit /b 1

echo.
echo Build complete:
echo %CD%\dist\%APP_NAME%\%APP_NAME%.exe
echo %CD%\dist\%APP_NAME%-Windows.zip
echo.
echo To verify startup diagnostics:
echo "%CD%\dist\%APP_NAME%\%APP_NAME%.exe"
echo "%CD%\dist\%APP_NAME%\%APP_NAME%.exe" --gpu-check

endlocal
