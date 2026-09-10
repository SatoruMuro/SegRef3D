# SegRef3D Local GPU v1.3.1 配布情報

**2026-09-10追記：このZIPはx64実機で起動不能のため配布対象から除外します。**
ARM64 WindowsのSystem32由来のruntime DLLが混入していました。以下の起動成功は
ARM64 Windows上での結果であり、x64実機での互換性を確認したものではありません。
修正と検証結果は [v1.3.2配布情報](RELEASE_1_3_2.md) を参照してください。

v1.3.2の配置・公開後、旧ZIPをDropboxの通常配布フォルダから
`50_SegRef3D/backup/20260910/broken-build-v1.3.1/` へ退避しました。
元のファイル名と下表のサイズ・SHA-256を保持し、移動前後の一致を確認しました。
このページ以下は過去の記録です。v1.3.1をダウンロード・再配布する案内ではありません。

2026-09-09。Local GPUのバグ修正版を作成し、LiteのDICOM Create Input ZIP修正を本番公開した。公開済みv1.3.0との識別のためpatch versionを1.3.1へ進めた。公開済みLocal CPU v1.2.6の配布物・バージョン・リンクは変更していない。

## Windows正式ZIP

| 項目 | 内容 |
|---|---|
| ファイル名 | `SegRef3D-Local-GPU-v1.3.1-Windows.zip` |
| サイズ | 4,027,879,398 bytes（約4.03 GB／3.75 GiB） |
| SHA-256 | `666005b0cfb01c6c09bb52da59bd78beb2855047c604085cf501cba53738de8a` |
| トップレベル | `SegRef3D-Local-GPU-v1.3.1-Windows/` のみ |
| ファイル数 | 18,745 |
| 実行ファイル | トップレベル直下の `SegRef3D.exe` |
| 構成 | PyInstaller one-folder、console、noupx |
| 署名状態 | **unsigned**。production certificate未導入 |
| アプリのビルド元 | `a52f619e4013c611d2b5ce4237cd23a83ba6736d`（mainへ反映後にビルド） |
| 梱包・検証スクリプト | `4247f62`（Windows ZIP区切り記号対応） |

正式ZIPは作業環境内の `SegRef3D/dist/` に作成済み。2026-09-10、Dropboxのローカル設定と旧GPU／CPU正式ZIPの配置履歴を確認し、既存の配布フォルダ `50_SegRef3D/GitHubDownload/` へ同名でコピーした。既存ファイルの上書きはなく、コピー前の元ZIPとコピー後の配布先ZIPのサイズ・SHA-256は上表の値で完全一致した。試験用ZIPはコピーしていない。検証記録はGit管理外の `build/verification/dropbox-v131-copy.json` に保存した。

**新しい外部ダウンロードURLは、Dropboxの共有リンク確認後に掲載する。** ローカル同期フォルダへのコピーは確認済みだが、クラウドへの同期完了と新規共有URLは未確認。このページは配布情報であり、ZIPダウンロードリンクではない。以前の試験用ZIPへの直接リンクは、README／READMEJP／Local installation guide／llms文書から取り除いた。確認していないURLへ置き換えてはいない。

ZIPには `_internal` のruntime、README、LICENSE、`release-info.json`、指定された署名・診断・ZIP検証スクリプト、署名設計書を同梱した。収集されたテストディレクトリ、Pythonキャッシュ、PDB、dump、notebookは除いた。vendor license、SAM2実行時ソース・設定・checkpoint、依存ライブラリが必要とするruntime/headerは保持している。build directory、アプリの開発用テスト、秘密鍵、署名証明書、credentialsは同梱していない。

最初のZIPに対する展開前検査で、Windows ZIP APIがバックスラッシュの内部パスを返す場合への検証スクリプトの対応漏れが判明した。スクリプトを修正し、実ZIPの作成・展開テストを追加して再梱包した。アプリのEXE／ネイティブバイナリはこの調整では変更していない。上表は再梱包後の最終ZIPの値である。

## 含まれる修正

- **Auto Erase**: 保存callbackによるscene更新後に、finalizeが削除済みpath itemへアクセスする問題を修正。pathを値として確定し、callback前に一時参照と描画状態を解除する。
- **Box Prompt／eventFilter**: scene削除・モード切替時にpreview／crosshair等の参照を共通cleanupで解除する。削除済みwrapperを通常経路で保持しない。
- **Lite DICOM Create Input ZIP**: `basePixels=null`でも正常なmodality画像を扱い、既存viewerの画像専用canvasからworking JPEGを生成する。Window/Level・brightness／contrastを反映し、maskとBoxは含めない。

セグメンテーションアルゴリズム、SAM2推論ロジック、DICOM geometry、mask／autosave形式、object ID、UIレイアウト、Job ZIPの `segref3d-segjob-1.0` 仕様は変更していない。[Qt原因調査](QT_LIFECYCLE_REPORT.md)、[DICOM Job ZIP検証](SEGMENTATION_JOB_DICOM.md)。

## Lite本番公開と公開後確認

公開URL: <https://satorumuro.github.io/SegRef3D/lite-web/>

既存のmain連動 `pages build and deployment` を使用し、公開URL・Pages設定は変更していない。

- [Lite CI成功（a52f619）](https://github.com/SatoruMuro/SegRef3D/actions/runs/34348562144)
- [Pagesデプロイ成功（a52f619）](https://github.com/SatoruMuro/SegRef3D/actions/runs/34348561937)
- 公開HTMLはHTTP 200。公開された `app.mjs?v=46` と検証対象ソースの内容が一致。offline cacheはv49。

Windows Edgeの実ブラウザで、公開URLを直接操作した。テスト用APIの注入や公開アプリの差し替えは行っていない。合成DICOM（signed 16-bit、slope 2／intercept −1024、MONOCHROME1/2）、RGB PNG、JPG、TIFFを各15枚・400×400で読み込み、maskを描画し、Box Prompt 1個、tracking range 1–15を設定してCreate Input ZIPを実行した。

通常表示とWindow/Level・brightness／contrast変更後の計10 ZIP・150 JPEGで、ダウンロード、manifest、枚数、寸法、prompt frame、座標、rangeを確認した。JPEGと表示設定から求めた画像のRGB平均絶対差は各画像の平均値の最大が0.477未満（0–255尺度）。表示中のmask内部とBox枠の位置でも画素を比較し、重畳表示がJPEGに焼き込まれていないことを確認した。export中のネットワークリクエストは0件。

全10 ZIPは既存Python validator／extractorとColab処理で読み込み、テスト用predictorで各15枚の結果mask ZIPまで生成できた。実SAM2推論の検証とは区別している。

## 自動テスト・署名監査

- Desktop Python: 128件成功（Qt lifecycle、DICOM／raster Job ZIP、正式ZIP作成・展開を含む）。
- JavaScript: Lite／TrainRef3D／SliceBridgeの139件成功。
- Colab Python: 27件成功、skipなし。
- 署名ポリシー: 14ケース成功、PowerShell 5.1／7で確認。
- 最終ZIPのCRC検査と単一root構造の検査に成功。別ディレクトリへ展開してruntime確認を実施。
- 全905 PEのSHA-256が、監査時・dist・展開後で一致。

展開した正式ZIPから、VTK 9.7.0 import、GPU診断、GUI起動smoke testはいずれも終了コード0だった。GUIは通常のWindows表示経路で `window.show()` とイベントloopまで進み、`SegRef3D Local GPU v1.3.1`／`[SMOKE] title='SegRef3D Local GPU'` を記録して自動終了した。自動終了時にQtのthread-storage診断が出たが、削除済みQGraphicsItem例外は発生していない。検証機ではCUDA GPUを利用できず、SAM2はその旨を表示して無効化された。GPU診断の終了コード0を実GPU推論の成功とは扱わない。

Git管理外の `build/verification/` に `formal-v131-build.log`、`formal-v131-repackage.log`、`formal-v131-zip-integrity.json`、`formal-v131-extracted/verification.json`、各runtimeログ、`public-v131/results.json`、`public-v131/pixel-checks.json` と公開後の画面・Job ZIPを保存した。

905 PEの監査結果は、未署名646、有効な既存署名259。署名計画はvendor署名保持257、catalogに併存する埋め込み署名の追加検証対象2、自作EXE 1、第三者依存のレビュー待ち645。問題となった `vtkInteractionWidgets.cp312-win_amd64.pyd` は未署名である。今回、実署名は行っていない。

## Smart App Controlと今後の署名

Windows 11 Smart App Controlで、内部VTK PYDがEnterprise signing level requirementsを満たさないとしてブロックされ、`DLL load failed while importing vtkInteractionStyle`／「アプリケーション制御ポリシーによってこのファイルがブロックされました」となる既知の問題がある。

イベントビューアーの `Microsoft → Windows → CodeIntegrity → Operational` で対象パスと時刻を確認する。SACをオフにすると起動した事例はあるが、無効化はSegRef3Dの利用条件ではない。原因切り分けや現行版の暫定回避として、端末管理者と判断する。今回、SAC／WDAC／永続的な実行ポリシーは変更していない。

署名infrastructureは正式コードへ反映済み。将来はproduction証明書／Windows SDKを導入し、未署名の第三者依存の出所・再配布条件・ハッシュを確認した後、SHA-256署名・RFC3161 timestamp・全PE検証を通してsigned buildへ移行できる。既存vendor署名を無条件に置き換えない。[署名設計と導入手順](WINDOWS_SIGNING.md)

実GPUのSAM2と共同研究者の実DICOMは、今回の正式ZIPを使って後から確認する。SAC有効の別PCでのブロック可能性は、今回の未署名リリースの既知事項として残る。
