# SegRef3D Local installation guide

This guide applies to the Windows desktop editions of SegRef3D v1.2.6.

## Download

- [SegRef3D Local GPU v1.2.6](https://www.dropbox.com/scl/fi/ku3hj0spnw5rrmzgpc5ui/SegRef3D-Local-GPU-v1.2.6-Windows.zip?rlkey=aqd47l35lfl1kf6a7r5rv3xa3&st=e34tvblg&dl=1) for Windows with a compatible NVIDIA CUDA GPU
- [SegRef3D Local CPU v1.2.6](https://www.dropbox.com/scl/fi/05evqq67tokxvo37ixw87/SegRef3D-Local-CPU-v1.2.6-Windows.zip?rlkey=mz1kvdlkxmmffipp411xc1kux&st=nwh3k3rn&dl=1) for a CPU-only/offline legacy Windows workflow

SegRef3D Lite is recommended for most users who do not require a Windows desktop application.

## Install and run

1. Download the ZIP for the required edition.
2. Extract the entire ZIP. Do not run the executable from inside the archive.
3. Keep `SegRef3D.exe` and the `_internal` folder together.
4. Place the extracted folder at a short, simple path such as `C:\SegRef3D\`.
5. Double-click `SegRef3D.exe`.

Python and PyTorch do not need to be installed separately. The first startup can take longer while
the bundled runtime initializes.

## GPU edition

Local SAM2 requires a compatible NVIDIA GPU and driver. The application performs a CUDA runtime
test before enabling SAM2; CUDA being visible does not by itself guarantee compatibility. If the
test fails, SAM2 is disabled without preventing the non-SAM2 tools from opening.

## Path and extraction problems

If the application does not start, confirm that:

- the ZIP was fully extracted;
- `_internal` is beside `SegRef3D.exe`;
- the application is in a short path without unusual characters;
- security software did not quarantine bundled files; and
- the GPU driver is current when using Local GPU.

---

# SegRef3D Local インストールガイド

Windowsデスクトップ版SegRef3D v1.2.6向けの案内です。

## ダウンロード

- [SegRef3D Local GPU v1.2.6](https://www.dropbox.com/scl/fi/ku3hj0spnw5rrmzgpc5ui/SegRef3D-Local-GPU-v1.2.6-Windows.zip?rlkey=aqd47l35lfl1kf6a7r5rv3xa3&st=e34tvblg&dl=1)：対応NVIDIA CUDA GPU搭載Windows向け
- [SegRef3D Local CPU v1.2.6](https://www.dropbox.com/scl/fi/05evqq67tokxvo37ixw87/SegRef3D-Local-CPU-v1.2.6-Windows.zip?rlkey=mz1kvdlkxmmffipp411xc1kux&st=nwh3k3rn&dl=1)：CPU-only／offline Windows workflow向けlegacy版

Windowsデスクトップアプリが必須でない場合は、SegRef3D Liteを推奨します。

## 展開と起動

1. 必要な版のZIPをダウンロードします。
2. ZIP全体を展開します。ZIP内から直接実行しないでください。
3. `SegRef3D.exe`と`_internal` folderを同じ場所に保持します。
4. 展開folderを`C:\SegRef3D\`のような短く単純なpathへ置きます。
5. `SegRef3D.exe`をダブルクリックします。

PythonやPyTorchを別途インストールする必要はありません。初回起動はbundled runtimeの初期化により
時間がかかる場合があります。

Local GPUのSAM2には、対応NVIDIA GPUとdriverが必要です。アプリはSAM2を有効にする前にCUDAの実演算を
確認します。互換性確認に失敗した場合も、SAM2以外の機能は起動できる構成です。
