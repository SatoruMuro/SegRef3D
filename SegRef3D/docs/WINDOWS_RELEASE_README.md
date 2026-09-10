# SegRef3D Local GPU for Windows

Extract the complete folder before starting `SegRef3D.exe`. Keep `_internal` beside
the executable. This is the one-folder Windows GPU distribution; local SAM2 requires
a compatible NVIDIA GPU. The exact version, source commit, and signing status are
recorded in `release-info.json`.

## v1.3.2 fixes

- Fixed WinError 193 at startup caused by ARM64-host runtime DLLs in the x64 bundle.
- Bundled verified native x64 Microsoft runtime DLLs and removed explicit ctypes preloads.
- Added architecture checks before packaging and after extraction; failed startup diagnostics now fail verification.
- Enabled Seg CT/MRI for compatible DICOM-derived volumes, preserving patient geometry.
- Retained the Auto Erase and Box Prompt fixes from v1.3.1.

## Known issue: Windows 11 Smart App Control

This v1.3.2 release is **unsigned**. A production code signing certificate has not
yet been introduced. Some dependencies already have vendor signatures; this does
not mean that the complete application is signed.

Smart App Control can block an internal native module with:

```text
DLL load failed while importing vtkInteractionStyle
アプリケーション制御ポリシーによってこのファイルがブロックされました
```

The reported Code Integrity event identified
`_internal/vtkmodules/vtkInteractionWidgets.cp312-win_amd64.pyd` as not meeting
Enterprise signing level requirements. Norton permitting `SegRef3D.exe` does not
override this Windows policy.

In Event Viewer, inspect **Applications and Services Logs → Microsoft → Windows →
CodeIntegrity → Operational** and match the timestamp and blocked path. Disabling
Smart App Control allowed startup on the reported PC, but it is **not a requirement
for using SegRef3D**. Treat policy changes only as diagnosis or a temporary workaround
for this unsigned version, with the device administrator's approval. Prefer an
approved device/environment while signed distribution is being prepared.

## 日本語

フォルダ全体を展開し、`_internal`を移動せずに`SegRef3D.exe`を起動してください。
v1.3.2ではruntime DLLのarchitecture混在によるWinError 193を修正しました。
今回のv1.3.2は未署名版です。Windows 11のSmart App Controlにより、上記の内部PYDが
ブロックされる場合があります。CodeIntegrity/Operationalログで対象ファイルを
確認してください。SACをオフにすると起動した事例はありますが、無効化を必須条件とは
していません。現行版の暫定回避や原因切り分けとして、端末管理者と判断してください。
今後、production証明書と依存ライブラリの確認を経て、署名済み配布へ移行する予定です。

## Diagnostics and signing

```powershell
.\SegRef3D.exe --vtk-check
.\SegRef3D.exe --gpu-check
.\scripts\audit_windows_signatures.ps1 -DistDir . -ReportPath ..\signature-inventory.csv
```

The included `scripts/` contains audit, guarded signing, and ZIP verification tools.
The approval list is deliberately empty. Do not sign third-party DLL/PYD files
without reviewing their origin, redistribution terms, and exact hash. Preserve
valid vendor signatures. See [code signing design](docs/WINDOWS_SIGNING.md).

Source, build pipeline, release notes and tutorials:
https://github.com/SatoruMuro/SegRef3D

No production signing certificate, private key or credentials are included.
Runtime dependency license notices remain under `_internal`.
