# Windows Local GPU検証結果（2026-09-09）

以下は最初のv1.3.0検証用ビルドの記録。正式v1.3.1のZIP・公開後検証結果は [配布情報](RELEASE_1_3_1.md) を参照。

作業ブランチのソースからone-folder配布物と未署名ZIPを作成した。EXE起動、VTK import、DLL配置監査、ソースの125テストは成功した。CUDA GPUを利用できない検証機のため、SAM2の実GPU推論と共同研究者の端末でのSAC通過は未検証。production署名は行っていない。

## ビルド環境と生成物

| 項目 | 結果 |
|---|---|
| OS | Windows 11、build 26200 |
| Python | 3.12.14、既存GPU用venvを `VENV_DIR` で指定 |
| PyInstaller | 6.22.2、hooks-contrib 2026.7 |
| Qt | PyQt6 6.9.1／Qt 6.9.1 |
| Torch | 2.11.0+cu128、CUDA 12.8、sm_120を含むビルド |
| VTK | 9.7.0 |
| ビルド | `SKIP_ENV_SETUP=1`、`SIGNING_ENABLED=0`、one-folder／console／noupx |
| 出力 | `SegRef3D/dist/SegRef3D-Local-GPU-v1.3.0-Windows/SegRef3D.exe` |
| ZIP | `SegRef3D-Local-GPU-v1.3.0-Windows-unsigned.zip`、4,006,648,298 bytes |

ZIPのSHA-256:

```text
f7f1e0be72c010534a3f14cfb8fc22fc7ae93720328ecbf4ff8b79bd26eede72
```

今回のvenvはローカルの既存開発環境を利用した。収集物にはOpenAIが署名したPythonランタイムのバイナリも含まれる。公開用には、採用するPython配布元・依存wheel・ライセンス・ハッシュを改めて固定したクリーンな環境を使う。未署名のこのZIPは検証用であり、既存の公開ダウンロードは更新していない。

## 完成したdistの署名状態

PowerShellのAuthenticode診断で、905個のPEを確認した。これは今回生成したdistの結果であり、共同研究者が使用した以前の配布ZIPそのものを監査した結果ではない。

| 拡張子 | NotSigned | Valid | 合計 |
|---|---:|---:|---:|
| .exe | 3 | 0 | 3 |
| .dll | 244 | 241 | 485 |
| .pyd | 399 | 18 | 417 |
| 合計 | 646 | 259 | 905 |

UnknownError／HashMismatch／NotTrustedは今回の診断では0件。未署名EXEは `SegRef3D.exe`、FFmpeg、Torchに同梱されたprotoc。Validの署名者にはMicrosoft、NVIDIA、Qt、Intel、Anaconda、OpenAIを含む。

`_internal/vtkmodules/vtkInteractionWidgets.cp312-win_amd64.pyd` はNotSigned、埋め込み署名なし。SHA-256は次のとおり。

```text
540840be927a4944141ec28cfa5a96ef2d65fb759a1afa7f427e380e130ad611
```

対応する `_internal/vtk.libs/vtkInteractionWidgets-9.7.0.dll` も未署名。VTKのwheelに付属するLICENSEをdist内で確認した。署名の許可リストは空のままとし、第三者バイナリへの署名承認は自動生成していない。

署名計画は257個が `Preserve`、2個が `VerifyEmbedded`、645個が `NeedsReview`、自作EXEの1個が `SignApp`。2個のMicrosoftランタイムでは、PowerShellがcatalog署名を優先した一方、埋め込みRSA証明書も抽出できた。`VerifyEmbedded` は成功判定ではなく、SDKのSignToolによる独立検証が必要という意味である。

## 実施した検証

| 検証 | 結果と範囲 |
|---|---|
| 旧ソースの症例A/B | 両方で削除済みQGraphicsPathItem例外を再現 |
| 新規lifecycleテスト | 6件成功。実Qt、mask保存、Undo/Redo、48回のスライス操作、33回の同一スライス描画 |
| ソース全テスト | 125件成功。最終実行はVTK importを無効化せず実施。SAM2推論はテスト設定で無効 |
| DLL配置調整・監査 | 正常終了。検査対象の直接依存はbundleまたはWindowsへ解決 |
| frozen `--vtk-check` | 正常終了、VTK 9.7.0。InteractionStyle／InteractionWidgetsもimport |
| frozen `--startup-smoke-test` | offscreenでMainWindowを作成して正常終了。タイトルはSegRef3D Local GPU |
| frozen `--gpu-check` | 終了コード0。ただしCUDA available=False、実CUDA tensor／SAM2推論は未検証 |
| 署名ポリシー | 14ケース成功。PS 5.1／7で確認 |
| 実PEの診断・拒否 | vendor保持、catalogと埋め込み署名の識別、未レビューPYD拒否、未署名production拒否、拒否時のハッシュ不変を確認 |
| 実署名・timestamp | 未実施。production証明書およびSignToolが未導入 |

最初のビルド試行はVTK importの待機中に中断した。同じホストの独立診断でも一部VTK PYDのポリシーブロックが発生したが、後の事前診断と最終EXEでは成功した。セキュリティ設定の変更によって通したわけではなく、成功・失敗が混在した理由の確定にはCodeIntegrityログの追加調査が必要。

最終ビルドのPyInstaller、COLLECT、DLL監査は完了した。その後、Windows PowerShellの既定の実行ポリシーによりpackagingスクリプトの起動が拒否されたため、既存ビルド方式と同じプロセス限定の `-ExecutionPolicy Bypass` を復元した。完成済みの同じdistに対してpackagingを実行し、診断後にZIP化した。SAC／WDAC／永続的な実行ポリシーは変更していない。

## 検証ログ

Git対象外の `build/verification/` に以下を保持する。

- `baseline.log`、`ast-review.txt`: 旧コード再現と変更範囲の比較。
- `lifecycle-real-imports.log`、`all-tests-real-imports.log`: 最終ソーステスト。
- `windows-build-final.log`、`package-final.log`、`frozen-startup.log`: ビルド・packaging・EXE起動。
- `zip-verification.log`: ZIPのCRC、ファイル集合、全PEハッシュの照合。
- `environment-signatures.csv`: ビルド前venvの診断。distと母集団が異なる。

完成distのファイル別一覧は `SegRef3D/dist/SegRef3D-Local-GPU-v1.3.0-Windows-signing/before.csv`。この一覧も署名前の診断であり、署名済みという意味ではない。

## 公開前に必要な作業

公開信頼されたRSAコード署名証明書／鍵保管先とWindows SDKを用意し、未署名の第三者依存645個の出所・再配布条件・ハッシュをレビューする。署名許可リストを作成した後、署名・RFC3161 timestamp・全PEのSignTool検証を実行する。catalogと併存する埋め込み署名の検証も必須。[具体的な導入手順](WINDOWS_SIGNING.md)

別のSAC有効Windows 11端末で署名済みZIPを展開し、Draw／Erase／Auto Erase／Box Promptの手操作、共同研究者のDICOM、autosave、VTK、実GPUでのSAM2を確認する。今回のoffscreenテストは手操作・実GPU・任意の組織ポリシーを代替しない。秘密鍵・証明書・token・credentialはGitに追加していない。
