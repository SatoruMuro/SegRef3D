@echo off
setlocal

cd /d "%~dp0"

set "VENV_DIR=.venv-lite"
if "%PYTHON_EXE%"=="" set "PYTHON_EXE=C:\Users\sator\AppData\Local\Programs\Python\Python312\python.exe"

echo === SegRef3D Lightweight Build ===
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

pip install -r requirements\requirements-lite.txt
if errorlevel 1 exit /b 1

for /f "tokens=2 delims==" %%i in ('findstr /b "__version__" SegRef3D.py') do set "VERSION=%%i"
set "VERSION=%VERSION: =%"
set "VERSION=%VERSION:"=%"
set "VERSION=%VERSION:'=%"
if "%VERSION%"=="" (
    echo Failed to read __version__ from SegRef3D.py
    exit /b 1
)

set "APP_NAME=SegRef3D-Lite-v%VERSION%"
set "SEGREF3D_APP_NAME=%APP_NAME%"
set "SEGREF3D_DISABLE_SAM2=1"

echo.
echo === Confirming excluded SAM2 attention packages ===
pip show torch || echo torch: not installed
pip show xformers || echo xformers: not installed
pip show flash-attn || echo flash-attn: not installed

echo.
echo === Building %APP_NAME% with PyInstaller onedir ===
pyinstaller SegRef3D.py ^
    --name "%APP_NAME%" ^
    --noconfirm ^
    --clean ^
    --onedir ^
    --console ^
    --icon "SegRef3D.ico" ^
    --runtime-hook "tools\pyi_disable_sam2.py" ^
    --add-data "ffmpeg_bin\ffmpeg.exe;ffmpeg_bin" ^
    --hidden-import pydicom.encoders.pylibjpeg ^
    --hidden-import pydicom.encoders.gdcm ^
    --hidden-import vtkmodules.all ^
    --hidden-import vtkmodules.qt.QVTKRenderWindowInteractor ^
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
    --exclude-module torch ^
    --exclude-module torchvision ^
    --exclude-module torchaudio ^
    --exclude-module sam2_interface ^
    --exclude-module gpu_runtime ^
    --exclude-module sam2 ^
    --exclude-module build_sam ^
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

endlocal
