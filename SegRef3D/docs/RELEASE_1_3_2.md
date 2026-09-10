# SegRef3D Local GPU v1.3.2 配布情報

v1.3.1で報告された起動直後のWinError 193を修正するpatch releaseです。
v1.3.1の同名差し替えは行いません。新しい配布名は
`SegRef3D-Local-GPU-v1.3.2-Windows.zip`です。完成物のハッシュと検証結果は、
最終ZIPを別フォルダに展開して確認した後、このページへ記録します。

## 根本原因はARM64ホストのruntime DLLの混入

PyInstallerの`Analysis-00.toc`で、rootの`vcruntime140.dll`、`msvcp140.dll`、
`vcruntime140_1.dll`の収集元が`C:\Windows\System32`だったことを確認しました。
ビルド端末はARM64 Windows、Pythonとアプリはx64でした。先頭の2 DLLは
PE Machineが`0xAA64`で、CHPE metadataもありました。ARM64 Windows用の
ハイブリッドDLLをx64 Windowsへ配布したため、ユーザー環境で有効なDLLとして
ロードできず、`pyi_local_gpu.py`の`ctypes.WinDLL`でWinError 193になりました。
ファイルの欠損やSmart App Controlによるブロックとは異なる原因です。

Microsoftは、ARM64XをWindows on Armでx64／Armプロセスの両方に対応する形式と
説明しています。この互換性は通常のx64 Windowsへそのまま持ち出せることを
意味しません。[Microsoft ARM64Xの説明](https://learn.microsoft.com/en-us/windows/arm/arm64x-pe)

| v1.3.1ファイル | bytes | PE Machine | File version | Authenticode |
|---|---:|---|---|---|
| SegRef3D.exe | 57,521,876 | 0x8664（x64） | 未設定 | NotSigned |
| python312.dll | 6,985,520 | 0x8664（x64） | 3.12.14 | Valid、OpenAI OpCo LLC |
| vcruntime140.dll | 203,336 | 0xAA64（ARM64、CHPEあり） | 14.50.35719.0 | Valid、Microsoft Windows、Catalog |
| msvcp140.dll | 1,380,424 | 0xAA64（ARM64、CHPEあり） | 14.50.35719.0 | Valid、Microsoft Windows、Catalog |
| vcruntime140_1.dll | 53,280 | 0x8664（CHPEあり） | 14.50.35719.0 | Valid、Microsoft Corporation |

全905 PEのMachine集計はx64が903、ARM64が2でした。Machineがx64でも
CHPE metadataを持つruntimeがあるため、修正版の検査は両方を確認します。

問題の`vcruntime140.dll`のSHA-256:

```text
6d987d8cb2a47cff9c29c1fcbb853e7ef273c545f7d822728f7d2d448ca18758
```

`msvcp140.dll`のSHA-256:

```text
530975b54f72d211cced62ad4bb5498e0f5786a7cc448da9a35e2d1738cbee1a
```

## ZIPの破損ではなく、以前の検証がarchitectureを確認していなかった

上記DLLのサイズ・SHA-256は、保存されたbuild dist、ZIP化対象の署名監査記録、
正式ZIP内、以前の別フォルダ展開物、Dropbox配布先ZIP内で一致しました。
元ZIPとDropbox ZIPの全体SHA-256も、次の値で一致しています。

```text
666005b0cfb01c6c09bb52da59bd78beb2855047c604085cf501cba53738de8a
```

以前の検査は全905 PEのhash一致を確認しましたが、PE MachineとCHPEを
検査していませんでした。VTK／GPU診断／GUI smoke testの終了コード0は
ARM64 Windows上での実測であり、通常のx64 Windowsでの動作確認ではありません。
この検査範囲を明示せず完成扱いした点を訂正します。

また、以前のZIP検証スクリプトは個別の終了コードを記録するだけで、非0の場合も
スクリプト全体を失敗にしていませんでした。これは別の検証上の欠陥です。
今回の保存ログには個別の成功記録があり、この欠陥による見かけ上の成功では
ありませんが、今後の誤判定を防ぐため修正しました。

## v1.3.0にも同じruntime収集とbootstrapがあった

v1.3.0の`827b0b1`とv1.3.1の`a52f619`を比較すると、
`tools/pyi_local_gpu.py`と`tools/prepare_windows_gpu_dist.py`は同一でした。
保存されたv1.3.0 distの3 runtime DLLも、v1.3.1と同じハッシュ・architectureでした。
比較対象は保存されたv1.3.0 distであり、過去に別途作られたすべての試験ZIPの
同一性までは断定していません。

build batの差分は、venv指定、環境setup省略、VTK事前検査、`--noupx`、
署名方針、再梱包・ZIP検証の整備でした。どちらも同じPyInstaller CLIからspecを
生成し、runtimeをarchitecture指定せず自動収集していました。

## 修正内容とruntimeの出所

`pyi_local_gpu.py`からMSVC DLLの明示ロードとctypes依存を削除しました。
`_internal`と`torch/lib`のDLL検索パス登録、およびhandleの保持は継続します。
例外を握りつぶす処理は追加していません。

ビルドではMicrosoft公式`VC_redist.x64.exe`の14.50.35719をhashで固定し、
amd64用minimum-runtime CABだけを抽出してPyInstallerへ明示的に渡します。
この公式x64パッケージにはARM64 payloadも含まれるため、パッケージ名だけでは
判定せず、抽出後の各DLLも検査します。WindowsへのインストールやSystem32からの
コピーは行いません。[Microsoft配布パッケージの説明](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)

新しい`vcruntime140.dll`は123,472 bytes、Machine `0x8664`、CHPEなし、
version 14.50.35719.0、Microsoftの埋め込み署名Validです。SHA-256:

```text
184146852727a9db4eea06178716bec3cdbb1015c911f6b0f915b184ad7775b2
```

全12 runtime DLLの収集元、version、hashは配布物の
`msvc-runtime-provenance.json`に記録します。古いQt側の同系列runtime重複を除き、
全EXE／DLL／PYDを梱包前と展開後に検査します。ARM64、ARM64EC、x86、CHPEを
含むバイナリは拒否します。VTK／GPU／GUI検証は終了コード0に加え、各成功ログを
必須とします。

同じ作業branchで完了したDICOM由来CT／MRIのSeg CT/MRI対応も含みます。
既存のAuto Erase／Box Prompt修正は保持しています。

署名方針は従来と同じunsignedです。runtime DLLのMicrosoft署名とアプリ全体の
コード署名は区別します。SACの受け入れとNVIDIA GPU推論は別途確認が必要です。
