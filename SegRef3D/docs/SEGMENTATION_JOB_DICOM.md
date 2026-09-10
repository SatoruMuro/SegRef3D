# SegAnything DICOM Job ZIP修正・検証記録

以下は初期修正時点の記録。その後のmain反映・Lite本番公開・正式Windows ZIPと公開後検証は [v1.3.1配布情報](RELEASE_1_3_1.md) を参照。

2026-09-09。Qt lifecycle／Windows署名対応のコミット `c961acc` を保持し、同じ作業ブランチ `fix/qt-item-lifecycle-windows-signing` で追加対応した。

## 原因と修正

LiteのDICOM decoderは、符号付き画素、Rescale Slope／Interceptを処理したscalar値を `modalityPixels` に保持する。`prepareImageSequence()` はこの経路で `basePixels = null` とする。これはWindow/Levelを後から変更するための正常な状態である。

viewerの `ensureDisplayImage()` は `modalityToRgba()` を使って表示用RGBAを生成していた。一方、`workingImageJpegBlob()` は独立したcanvasに `pixels.data.set(image.basePixels)` を実行していたため、DICOMの正常な状態を扱えなかった。旧コード `c961acc:lite-web/app.mjs` を同じ実ブラウザテストへ読み込むと、Create Input ZIPで報告と同じ `Cannot convert undefined or null to object` を再現した。

修正後の `workingImageJpegBlob()` は、表示用データの存在を確認し、`ensureDisplayImage()` で各スライスの表示を更新してから `sourceCanvas` をJPEG品質0.95で出力する。未表示スライスや表示設定変更後のスライスにも現在の設定を適用する。`sourceCanvas` は画像だけを保持し、mask、描画線、Box Promptの重畳は含まない。decoder、Window/Level、MONOCHROME1反転、brightness／contrastの計算は既存処理をそのまま使用する。

PNG/JPG/RGB TIFFでは、標準表示設定の画素は従来と同じ。表示設定を変更した場合は、これらの形式も現在の表示画像を出力する。従来はJob ZIPだけが表示調整を無視していた。出力品質とZIP仕様は維持した。表示データ欠落とJPEGエンコード失敗にはファイル名と再読み込み案内を付け、原因例外も保持する。

Training Data ZIP、Project ZIP、NIfTI export、DICOM geometry、mask形式、object ID、SAM2処理は変更していない。新しい通信処理はなく、Create Input ZIPはブラウザ内で完了する。

## Local版の確認

Local CPU／GPUは同じ `load_image_folder()` → `_segonweb_image_records()` → `export_for_segonweb()` → `create_job_zip()` を使用する。DICOMは読み込み時に `_normalize_grayscale()` で表示用RGB JPEGへ変換され、viewerもそのJPEGを読む。ZIPライターの `_jpeg_bytes()` はRGB JPEGを再エンコードせずコピーする。`basePixels` を前提とするLiteの不具合は存在しないため、Localの実装変更は不要だった。

LocalのDICOM表示は従来からスライスのmin/maxによる正規化であり、Liteのmodality値に対するWindow/Level表示とは異なる。今回、この表示仕様差を統一する変更は加えていない。両版とも、それぞれのviewerの画像とJob ZIP画像を一致させ、共通の `segref3d-segjob-1.0` 形式を維持する。

## 実測結果

すべて患者情報を含まない合成入力。400×400 px、15スライス、Box Prompt 1個、tracking rangeは画面上1–15（manifestでは0–14）を使用した。

| 検証 | 結果 |
|---|---|
| Lite: signed 16-bit DICOM MONOCHROME2／MONOCHROME1 | 各15枚、通常表示と表示変更後の両方で成功 |
| DICOM画素 | 先頭のstored値−500、slope 2、intercept −1024からmodality値−2024を確認 |
| Lite: RGB PNG／JPG／TIFF | 各15枚、通常表示と表示変更後の両方で成功 |
| LiteのBox Prompt | 実際のUIと2回のマウスクリックで設定。frame 1（manifest 0）、座標約[40,50,280,300]。UI座標変換の浮動小数誤差は0.000006 px未満 |
| manifestとJPEG | 10 ZIP、計150 JPEG。manifest存在、形式、枚数、全JPEG寸法400×400、range、prompt frame、座標を検証 |
| 表示との一致 | 全150 JPEGがviewerの画像canvasから生成したJPEGとバイト単位で一致。canvasのRGBAも既存rendererの出力と全画素一致 |
| JPEGの非可逆誤差 | 表示RGBAとデコード後JPEGのRGB平均絶対差は、各画像の平均値の最大が0.477未満（8-bitの0–255尺度） |
| ローカル処理 | ブラウザのexport中、外部サーバーへのリクエスト0件 |
| Local: DICOM／PNG／JPG／TIFF | 実際のフォルダ読込・追跡範囲設定・Boxモード・object保存・exportを各15枚で成功。prompt frameは画面上7、manifest 6 |
| Localの表示との一致 | ZIP内の全60 JPEGがviewerの画像ファイルとバイト単位で一致 |
| 既存backend互換性 | Liteの全10 ZIPを既存Python validator／extractorで検証。既存Colab処理＋fake predictorで各15枚の結果mask ZIPまで成功 |
| JavaScript既存テスト | Lite＋SliceBridge、120件成功 |
| Desktop Python | Qt lifecycleを含め126件成功 |
| Colab Python | 27件成功、skipなし。MONAI 1.5.1を作業用依存フォルダに追加して実行 |

Localテストのファイルダイアログ／通知はmock化し、Box Promptのクリック結果となる画像座標を設定する。Liteは実ブラウザのUI／pointerイベントで設定した。Windows Edge headlessを使用し、テスト用state参照はテストサーバーが応答に追加する。製品コードにはテスト用APIを追加していない。

## テストの再実行

リポジトリルートから実行する。PythonにはDesktopのテスト依存（PyQt6、Pillow、NumPy、pydicom等）、ブラウザテストにはPlaywrightとChromium系ブラウザが必要。

```powershell
python SegRef3D/tests/segjob_image_fixtures.py build/verification/segjob-fixtures
# Playwrightを通常のNode module解決で参照できない場合だけ、絶対パスを指定する。
# $env:PLAYWRIGHT_MODULE='C:/path/to/playwright/index.mjs'
$env:BROWSER_CHANNEL='msedge'  # 省略時はPlaywrightのChromium
node lite-web/tests/segmentation-export.browser.mjs build/verification/segjob-fixtures build/verification/segjob-browser
python SegRef3D/tests/verify_browser_segjob.py build/verification/segjob-browser
node --test "lite-web/tests/*.test.mjs" "slice-bridge/tests/*.test.mjs"
$env:QT_QPA_PLATFORM='offscreen'
$env:SEGREF3D_DISABLE_SAM2='1'
python -m unittest discover -s SegRef3D/tests -v
python -m unittest discover -s ColabNotebooks/tests -v
```

Colab全テストにはTorch、MONAI等の既存テスト依存も必要。今回、外部のビルド用venvは変更せず、MONAIをGit対象外の `build/verification/test-dependencies` に導入し、Colabテスト時だけPYTHONPATHへ追加した。

旧コードの再現は `git show c961acc:lite-web/app.mjs` をファイルに保存し、`SEGJOB_APP_SOURCE` にそのパスを設定してブラウザテストを実行する。このオプションは旧エラーの再現を検証するためのもの。通常の回帰テストでは指定しない。

ログと生成ZIPはGit対象外の `build/verification/` に保存した。`segjob-baseline.log`、`segjob-browser.log`、`segjob-browser/results.json`、`segjob-backend.log`、`all-js-tests.log`、`all-tests-with-segjob.log`、`colab-tests.log` を参照。

## 変更ファイルと未検証範囲

- `lite-web/app.mjs`: Job JPEG生成のみ修正。
- `lite-web/index.html`、`lite-web/service-worker.js`、`lite-web/tests/ui-privacy.test.mjs`: app v46／offline cache v49へ更新。
- `lite-web/tests/segmentation-export.browser.mjs`: 実ブラウザのZIP回帰テスト。
- `SegRef3D/tests/segjob_image_fixtures.py`: 共通の合成DICOM／RGB raster系列。
- `SegRef3D/tests/test_segonweb_ui.py`: Localの実読込→Job ZIP回帰テスト。
- `SegRef3D/tests/verify_browser_segjob.py`: ブラウザZIPのPython／Colab互換性検証。
- `lite-web/README.md`、この文書: 出力仕様と検証手順。

共同研究者の実DICOM、全DICOM transfer syntaxでの実ブラウザexport、全ブラウザ、Google Colab上での実SAM2／GPU推論は未検証。圧縮DICOM decoderの既存テストは成功しているが、今回の15枚の実ブラウザ試験は非圧縮Explicit VR Little Endianである。fake predictorでの成功を実SAM2の成功とは扱わない。

先行作業でWindows GPU版のビルドとEXE起動／VTKチェックは完了済み。本追加対応はLocal runtimeを変更していないため、Windows配布物の再ビルドは不要。証明書未導入・SAC有効別端末・実GPUに関する残課題は [Windows検証記録](WINDOWS_BUILD_VERIFICATION.md) に記載。Web版への公開とGit pushは実施していない。
