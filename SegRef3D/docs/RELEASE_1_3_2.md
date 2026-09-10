# SegRef3D Local GPU v1.3.2 配布情報

v1.3.1で報告された起動直後のWinError 193について、原因の特定、修正、
v1.3.2の再ビルドとZIP整合性検証まで完了しました。2026-09-10、リリース方針を
変更し、原因修正・自動テスト・全PE architecture検査・CRC・SHA-256検証を根拠に、
このZIPを正式配布版としました。x64／NVIDIA実機での確認は配布後に実施します。
**完成ZIPからのGUI・VTK起動と実GPU推論は未確認**です。ARM64の作業端末では
Smart App ControlがEXEをブロックしており、起動成功を確認したという意味ではありません。

| 項目 | 内容 |
|---|---|
| 新ZIP名 | `SegRef3D-Local-GPU-v1.3.2-Windows.zip` |
| サイズ | 3,998,870,575 bytes |
| SHA-256 | `eefdaf4dc6bdc7b05951ac59d8a0c891759ad899493f91f60e7e0b47aaf3350e` |
| ビルド元commit | `c350e71960bcc77c59f9a5648c0dbbb378937c16` |
| PE数／ZIP entry数 | 911／18,753 |
| 署名状態 | unsigned（Microsoft等の既存vendor署名は保持） |
| 配布状況 | 2026-09-10、既存Dropbox配布フォルダへコピー・照合済み |

正式ZIPは再圧縮・同名差し替えをせず、検証した完成物を
`50_SegRef3D/GitHubDownload/SegRef3D-Local-GPU-v1.3.2-Windows.zip` へ新規コピーしました。
コピー前後のサイズは3,998,870,575 bytes、SHA-256は上表の値で完全一致し、
既存ファイルの上書きはありません。記録はGit管理外の
`build/verification/dropbox-v132-copy.json` に保存しました。
Dropboxクラウド同期完了と新しい共有URLは未確認です。README等はこの配布情報を
案内し、確認済みの共有URLが取得できるまでZIPの直接リンクは掲載しません。

v1.3.1の同名差し替えは行いません。v1.3.2の配置・参照先更新後に、旧v1.3.1を
broken buildとして通常の配布対象から外し、元のファイル名とハッシュを保存します。

## 配布後の実機確認

次の項目は自動テストやPE検査では代替できず、現時点では未確認です。

- 通常のx64 Windowsで完成ZIPを新規展開し、PowerShellから引数なしで起動する。
- WinError 193／bootstrap errorの再発がなく、GUIが表示され継続動作する。
- VTK importとpreview、DICOM読み込み・スライス移動・Window/Level。
- NVIDIA CUDAでのSAM2推論・tracking、mask生成・保存。
- Auto Erase、Draw、Box Promptとの反復切替と描画後の保存。

今回はこれらを正式配布の事前条件から外しました。production certificateは未導入で、
署名基盤を維持したunsignedリリースです。SACによるEXE／PYDのポリシーブロックと、
runtime architecture不一致によるWinError 193は別問題です。SACの無効化を利用条件にはしません。

## 最新mainとの統合確認（2026-09-10）

最新mainの `e579764`（Electron microscopy／Mouse brainデモ）を通常mergeで統合しました。
競合したのは `lite-web/service-worker.js` と `lite-web/tests/ui-privacy.test.mjs` です。
デモの必要時ロード、styles v34、workspace UI v31を保持し、DICOM用medical-sourceと
instant3d bridge v5も保持しました。統合アプリをv48、offline cacheをv51に進め、
両ブランチが使っていたv47／v50との混在を避けています。

- 統合後のDesktop自動テスト139件、Lite自動テスト129件が成功しました。
- EdgeでApple JPEG（20枚）、Electron microscopy（150枚）、Mouse brain（132枚）を
  実際のOpenメニューから読み込み、5回の切替で未保存maskと表示設定が残留しないことを確認しました。
  追加テストは `lite-web/tests/demo-switch.browser.mjs` です。
- CT DICOM／MRI DICOMの構造物候補はそれぞれ81／50件。DICOM・NIfTIのCT／MRIで
  Seg CT/MRI input ZIP、結果mask取り込み、Project ZIP保存・復元が成功しました。
- DICOM MONOCHROME1／2、PNG／JPG／TIFFのCreate Input ZIPを表示調整前後の
  10ケースで確認しました。各15枚・400×400 JPEG、manifest、range、prompt frame、
  Box座標が正しく、Window/Level・brightness／contrastを反映し、mask／Boxを含みません。
- LocalのDICOM対応とruntime修正はビルド元 `c350e71` と同一です。配布済みv1.3.2 ZIPは
  再生成・再圧縮していません。

ブラウザ検証はローカル配信した統合ソースを使用し、状態参照はテストサーバーだけで
追加しています。公開アプリにテストAPIは含めません。結果はGit管理外の
`build/verification/v132-*-browser/` と `v132-merge-*-tests.log` に保存しています。

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

## 完成ZIPの検証結果と、起動を止めた別のポリシー

新しいZIPを`build/verification-132/final-extracted/`へ展開しました。
全911 PEがMachine `0x8664`かつCHPEなしで、署名棚卸し時、dist、ZIP内、展開後の
全PEのSHA-256が一致しました。18,753 entryのCRC検査も成功しています。
12 runtime DLLはすべて公式パッケージの抽出結果と一致しました。

`vcruntime140.dll`のSHA-256比較:

| 段階 | 旧v1.3.1 | 新v1.3.2 |
|---|---|---|
| dist／ZIP化対象の監査 | `6d987d8c…ca18758` | `18414685…d7775b2` |
| ZIP内 | 同一 | 同一 |
| 別フォルダへの展開後 | 同一 | 同一 |
| Dropbox配布先ZIP内 | 同一 | ZIP全体のSHA-256が元ZIPと一致 |

完全なhashは上記本文と、Git管理外の`build/verification-132/final-integrity.json`、
`original-comparison.json`に保存しています。

展開後の3 runtime DLLは、x64 Pythonから個別にロードできました。
ロード済みモジュールの実パスも展開先のDLLと一致しました。この単体検査は
アプリのbootstrapを変更するものではなく、SegRef3D.exeの起動成功とも区別します。

PowerShellから展開先の`SegRef3D.exe --vtk-check`を起動しようとしたところ、
WindowsはEXEの実行開始前に「アプリケーション制御ポリシーによってこのファイルが
ブロックされました」と返しました。2026-09-10 12:29:52 JSTのCode Integrity
event 3033／3077は、`final-extracted/.../SegRef3D.exe`がEnterprise signing level
requirementsを満たさないと記録し、event 3118はSmart App Control blockを記録しています。
runtime DLLやVTK PYDのロード段階には到達していません。WinError 193の再発として
扱っていません。現在のユーザー／コンピューター証明書ストアには利用可能な
コード署名証明書がなく、Windowsのセキュリティ設定は変更していません。

このため、展開物からのVTK import、GUI表示、引数なし通常起動の成功は未確認です。
ビルド前のVTK 9.7.0 import成功を、完成ZIPの起動成功へ読み替えていません。
実行が許可されたx64 Windows端末、または正式コード署名を利用できる環境で
残りの検証を完了する必要があります。この作業端末はARM64 Windowsで、
NVIDIA GPUも利用できないため、native x64実機とGPU推論は未確認です。

実施した自動テストはDesktop 139件、Lite 126件で全件成功しました。
architecture検査ではx64正常、ARM64／ARM64EC／x86／CHPE／破損PEを確認し、
PowerShellとPythonの判定を照合しました。実際のv1.3.1 distも新しい検査で拒否されました。
終了コード非0と、終了コード0でも成功markerのない結果を模擬し、ZIP検証が失敗する
ことを確認しました。署名棚卸しは265 PEの既存署名保持、645依存PEが署名レビュー待ち、
アプリEXE 1個が未署名です。

実行ログは`build/verification-132/`の`build.log`、`python-tests.log`、`lite-tests.log`、
`extracted-check.log`、`code-integrity.json`、`new-pe-signatures.json`、
`runtime-dll-load.json`、`final-integrity.json`に保存しています。
