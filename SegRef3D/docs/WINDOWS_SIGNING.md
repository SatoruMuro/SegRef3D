# Windows配布物の署名とリリース

SegRef3D Local GPUは、PyInstallerのone-folder出力を完成させた後、ZIP化の前に署名する。対象は配布フォルダ全体の `.exe`・`.dll`・`.pyd`。既存の有効なvendor署名を保持し、未署名の第三者バイナリは出所と再配布条件を確認したものだけに署名する。証明書未導入の現状では、署名済みproduction releaseは作成できない。

## EXEだけの署名ではVTKのブロックを解消できない

報告されたブロック対象は `_internal/vtkmodules/vtkInteractionWidgets.cp312-win_amd64.pyd` であり、起動元EXEへの署名はこのファイルの署名にはならない。Smart App Controlは読み込まれる実行コードも評価する。署名状態を配布物全体で確認する必要がある。[Microsoftのテスト手順](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/test-your-app-with-smart-app-control)

「Enterprise signing level」というログだけでは個別の署名不備や組織のポリシーまでは断定できない。今回の共同研究者の端末については、提示されたCode IntegrityログとSmart App Controlをオフにした際の比較結果が原因判断の根拠となる。NortonのEXE許可とは別の制御である。

| 方式 | 今回の判断 |
|---|---|
| A: SegRef3D.exeのみ | VTKのPYDをカバーせず、不十分 |
| B: 自作exe/dll/pydのみ | 自作コードには必要だが、第三者VTKの問題は残る |
| C: 配布物内の未署名PE | 出所・ライセンスを個別確認した許可リストと組み合わせて採用 |
| D: ビルド前の依存物に署名 | 仮想環境を書き換え、ビルド時の加工やコピー漏れも検出できないため標準にはしない |
| E: dist完成後に署名 | 推奨。DLL配置調整後の最終バイト列を検査・署名する |

採用方式はCとEの組み合わせ。one-fileに変更する必要はない。依存関係の収集・DLL配置調整・ファイル加工をすべて完了してから署名し、その後は対象バイナリを書き換えない。UPXによるvendor署名の破損を避けるため、GPUビルドに `--noupx` を指定する。

## 診断と署名対象のレビュー

SegRef3Dディレクトリを作業ディレクトリとする。PowerShell 5.1以降を想定する。

```powershell
.\scripts\audit_windows_signatures.ps1 `
  -DistDir .\dist\SegRef3D-Local-GPU-v1.3.0-Windows `
  -ReportPath .\dist\signature-inventory.csv

.\scripts\sign_windows_release.ps1 `
  -DistDir .\dist\SegRef3D-Local-GPU-v1.3.0-Windows -AuditOnly
```

CSVには相対パス、拡張子、SHA-256、AuthenticodeのStatus、署名形式、PEの埋め込み署名の有無、signer、thumbprint、公開鍵方式、timestamp署名者を記録する。`Valid` と `NotSigned` を区別し、`UnknownError`、`HashMismatch`、`NotTrusted` などは未署名として扱わない。timestamp署名者の存在は日時そのものではない。正確な署名・timestamp時刻と検証の詳細は `signtool verify /pa /all /v` の出力を保存して確認する。

`windows_signing_approvals.json` は意図的に空で出荷する。`before.csv` の `NeedsReview` ごとに、次の情報を記録する。自動的にCSV全行を許可リストへ転記してはいけない。

- `Path`: distを基準とする完全な相対パス。区切りは `/`。ワイルドカード不可。
- `SHA256`: ビルド完了後・署名前のファイルハッシュ。
- `Package`: パッケージ名と固定バージョン。
- `License`: 対象バイナリに適用される再配布条件と同梱したnoticeの場所。
- `Source`: 入手したwheel／vendor配布物の出所。入手物自体のハッシュもレビュー記録に残す。
- `Review`: 誰が、いつ、どの根拠で再配布・署名を承認したか。

トップレベルの `SegRef3D.exe` だけは自作ビルドとして扱う。その他の未署名PEには、全項目を持つ許可リストのパスとハッシュが一致しなければ署名しない。依存バージョンやビルド結果が変われば再レビューする。ライセンスの文字列は技術的な承認記録であり、スクリプトが再配布の可否を法的に判定するわけではない。

VTKはBSD 3-Clauseで、条件付きのバイナリ再配布・変更が認められている。著作権表示、条件、免責文を配布物に含め、Kitware等による推奨を示す表現を使わない。wheel内の第三者コンポーネントのnoticeも確認する。今回の調査対象PYDは未署名だったが、将来のwheelも同じとは限らない。署名する場合のsignerはSegRef3Dの配布主体であり、VTKの作者になり代わるものではない。[VTKのライセンス](https://vtk.org/about/)

有効な埋め込みRSA署名を持つMicrosoft・NVIDIA・Qt等のバイナリは変更せず、署名前後のSHA-256一致を検査する。不正・不明な署名、ECC署名、catalogにしか署名がないファイルは自動修復せず停止する。開発PCのcatalogが利用者PCにも存在するとは限らず、catalogの検証結果だけでは配布先での信頼を保証できない。

今回のdistでは `msvcp140.dll` と `vcruntime140.dll` がcatalog判定となったが、埋め込みRSA署名の証明書も抽出できた。この場合は `VerifyEmbedded` と表示し、署名を上書きせず `signtool verify /pa /all /v`（`/a`は付けない）で埋め込み署名を独立検証する。抽出した証明書の情報だけでは検証成功とはみなさない。スクリプトはこの検証を署名開始前とZIP化前に要求する。[PowerShellは署名が併存する場合catalogを優先する](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature)

## production証明書の準備

Smart App Control用には公開信頼されたCAのRSAコード署名証明書を使う。自己署名証明書やPrivate Trustを公開配布用に使わない。Microsoftの案内ではECC署名は現在サポートされない。[署名要件](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)

運用上は非エクスポート可能な鍵を持つhardware token／HSM／クラウド署名を優先する。今回の実装はWindows証明書ストアの `My` に登録された証明書をthumbprintで選ぶSignTool方式。対応するKSP等を通じて秘密鍵を利用できることが条件となる。秘密鍵、PFX、パスワード、tokenはリポジトリに置かない。

Azure Artifact SigningのPublic Trustも候補となる。利用資格と本人・組織確認を申請時に確認する。現行の公式案内では日本の組織も対象に含まれるが、個人の利用資格は別条件である。今回のスクリプトにAzure専用の署名プロバイダ連携は実装していないため、採用する場合は同じ対象選定と検証方針を保って署名部分を追加する。[セットアップ要件](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)、[Public Trust](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-trust-models)

CIでは保護されたリリース環境にのみ署名権限を与える。forkのPRや未レビューのコードを署名ジョブで実行しない。CI secret等によるストアへの一時登録はCI側で管理し、ジョブ終了時に登録を片付ける。PFXパスワードをコマンドラインへ出す方法は本スクリプトでは実装していない。

```powershell
$env:RELEASE_BUILD = '1'
$env:SIGNING_ENABLED = '1'
$env:SIGNTOOL_PATH = 'C:\Program Files (x86)\Windows Kits\10\bin\<SDK version>\x64\signtool.exe'
$env:SIGNING_CERT_SHA1 = '<Myストア内の証明書thumbprint、40桁>'
$env:SIGNING_TIMESTAMP_URL = '<CAが提供するRFC3161 timestamp URL>'
.\build_windows_gpu.bat
```

`SIGNING_CERT_SHA1` は証明書選択用のthumbprintであり、ファイルの署名方式ではない。ファイルのdigestは `/fd SHA256`、RFC3161は `/tr ... /td SHA256`。証明書の有効期間、RSA公開鍵、秘密鍵、code signing EKU、信頼チェーンを事前確認する。LocalMachineストアを使う場合は署名スクリプトを直接 `-StoreLocation LocalMachine` で実行する。[SignTool仕様](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)

## リリースの順序と停止条件

1. レビュー済みコミットから新しいstagingを作り、依存バージョン・wheelのハッシュ・`pip freeze` を記録する。既存スクリプトはTorchとQt以外に未固定の依存を含むため、productionでは解決済み環境も固定する。
2. VTK importの事前確認後、PyInstaller `--onedir --noupx` で収集する。`prepare_windows_gpu_dist.py` とDLL監査を実行する。
3. 全PEの診断と許可リストを確認する。未レビュー／不正な署名が1件でもあれば、署名開始前に停止する。
4. 有効なvendor署名を検証し、対象の未署名PEだけを署名する。署名・timestamp・検証の失敗や警告はエラーとする。
5. 全PEの署名を再検証し、vendorファイルのハッシュが変わっていないことを確認する。部分的に署名して失敗したstagingはリリースに使わず、原因を解消してクリーンビルドする。
6. `prepare_windows_release.py` でテスト・キャッシュ・debugデータを除き、指定されたREADME・署名資料を同梱する。署名工程後にZIPとSHA-256を生成する。正式名は `SegRef3D-Local-GPU-v<version>-Windows.zip`。署名状態は `release-info.json` に記録し、既存ZIPは上書きしない。
7. ZIPを別ディレクトリへ展開し、`verify_windows_release.ps1 -RuntimeChecks` で最終バイナリの `--vtk-check`・`--gpu-check`・GUI起動を確認する。SACによるブロックも検証結果に記録し、成功とは扱わない。

証明書なしの開発ビルドは `SIGNING_ENABLED=0`（既定）で可能。正式未署名配布を明示的に承認した場合だけ、`RELEASE_BUILD=1`、`ALLOW_UNSIGNED_RELEASE=1`、`SIGNING_ENABLED=0` を併用する。明示フラグなしの未署名正式ビルドは拒否する。2026-09-09のv1.3.1はこの未署名配布に該当し、実機・実GPU検証は配布物完成後に行う運用を採用した。SAC有効PCでの既知のブロックを、この未署名配布全体の中止条件にはしない。

`--gpu-check` はGPU非搭載時に成功終了する既存仕様のため、終了コードだけでGPU推論成功と判断してはいけない。実GPUのSAM2と共同研究者の実DICOMは今回の正式ZIPを使って後から確認する。証明書導入後のsigned releaseでは、第三者許可リスト・SignTool・timestamp・全PE検証を省略しない。

`VENV_DIR` で既存環境を指定でき、`SKIP_ENV_SETUP=1` はその環境のpip再インストールを省略する。productionで使う際は、その環境がレビュー済みの依存に一致することを確認する。

署名の検証成功は、任意の組織のWDACポリシーやSmartScreenの警告回避を保証しない。SACについても最終配布物による検証が必要。SAC、WDAC、永続的なPowerShell実行ポリシーは変更しない。既存のビルド方式に合わせ、レビュー済みのローカルスクリプトを呼び出すPowerShellプロセスにだけ `-ExecutionPolicy Bypass` を指定する。これはSACによるネイティブバイナリのブロックを解除しない。
