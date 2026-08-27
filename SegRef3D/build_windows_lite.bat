@echo off
setlocal

cd /d "%~dp0"

set "VENV_DIR=.venv-lite"
if "%PYTHON_EXE%"=="" set "PYTHON_EXE=python"

echo === SegRef3D Local CPU Build ===
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

python -m pip install -r requirements\requirements-lite.txt
if errorlevel 1 exit /b 1

for /f "tokens=2 delims==" %%i in ('findstr /b "__version__" SegRef3D.py') do set "VERSION=%%i"
set "VERSION=%VERSION: =%"
set "VERSION=%VERSION:"=%"
set "VERSION=%VERSION:'=%"
if "%VERSION%"=="" (
    echo Failed to read __version__ from SegRef3D.py
    exit /b 1
)

set "APP_NAME=SegRef3D-Local-CPU-v%VERSION%-Windows"
set "PYINSTALLER_NAME=SegRef3D"
set "SEGREF3D_APP_NAME=%APP_NAME%"
set "SEGREF3D_EDITION=local-cpu"
set "SEGREF3D_DISABLE_SAM2=1"

echo.
echo === Confirming excluded SAM2 attention packages ===
python -m pip show torch || echo torch: not installed
python -m pip show xformers || echo xformers: not installed
python -m pip show flash-attn || echo flash-attn: not installed

echo.
echo === Building %APP_NAME% with PyInstaller onedir ===
python -m PyInstaller SegRef3D.py ^
    --name "%PYINSTALLER_NAME%" ^
    --noconfirm ^
    --clean ^
    --onedir ^
    --console ^
    --icon "SegRef3D.ico" ^
    --runtime-hook "tools\pyi_disable_sam2.py" ^
    --add-data "ffmpeg_bin\ffmpeg.exe;ffmpeg_bin" ^
    --add-data "..\resources;resources" ^
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

if exist "dist\%APP_NAME%" rmdir /s /q "dist\%APP_NAME%"
move "dist\%PYINSTALLER_NAME%" "dist\%APP_NAME%"
if errorlevel 1 exit /b 1

echo.
echo === Creating zip ===
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -LiteralPath 'dist\%APP_NAME%' -DestinationPath 'dist\%APP_NAME%.zip' -Force"
if errorlevel 1 exit /b 1

echo.
echo Build complete:
echo %CD%\dist\%APP_NAME%\SegRef3D.exe
echo %CD%\dist\%APP_NAME%.zip

endlocal
