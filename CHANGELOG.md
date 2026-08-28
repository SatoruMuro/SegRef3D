# Changelog

Release and development history moved from the main README. Dates and descriptions before this
move are preserved in their original language.

## 2026.8.28

- README／READMEJPを、画像種・目的・版選択・Tutorialを中心とする短い導入ページへ再構成。
- SegRef3D Local GPU／Local CPU v1.2.6の正式なDropbox download linkを公開。
- AI相談用guideと`llms.txt`／`llms-full.txt`を追加。

## 2026.8.26

SegRef3D source versionを**1.2.6**へ更新。Windows GPU版／Lite CPU版のデスクトップGUIを、基本操作だけのTop Toolbar、縦型Object Panel、中央Image View、カテゴリ別Tool Panel、Slice Navigation、コンパクトなStatus Barからなる3カラム構成へ再設計。Object row選択とTarget Objectを同期し、wheel・PageUp/PageDown・F/R・J/Uを含む全画像切替をslice slider／番号表示へ反映。Lite版ではローカルSAM2 controlsを非表示にし、Seg on Web導線のみを表示。

Lite Webも同じ`Objects | Image View | Tools`の3カラム構成へ再設計。Top command barをOpen／Fit／統合Undo・Redo／Exportへ簡素化し、Object rowを唯一のTarget selectorとしてExtract・Cleanup・AI Setupと同期。Canvas下に直接番号入力付きslice sliderを追加し、AI SegmentationをSetup → Input ZIP → Colab → Resultの4-step workflowとしてTools dockへ統合。desktop／narrow／mobileでは同じ機能を維持し、狭い画面ではObjectsとToolsをdrawer表示する。

手描き編集に**Current Slice／All Pending Slices**を追加し、Add／Erase／Transferの対象範囲を明示。複数sliceへの一括適用は1回のUndo/Redo transactionとして保持し、Transferは描画範囲内の選択objectだけを変更。Top ToolbarのUndo／Redoを線編集とmask編集に統合し、`Ctrl+Y`／`Ctrl+Shift+Z`によるRedo、window resize時のzoom保持、主要controlのtooltip、処理中だけ表示されるprogress barを追加。

SegRef3D source versionを**1.2.5**へ更新。Windows GPU版／Lite CPU版の共通機能として、Lite Web互換の**Mask Cleanup**（Fill Holes、Remove Small Islands、Keep Largest Component、Smooth Boundary、Dilate、Erode）と、signed-distance fieldによる**Interpolate Between Frames**を追加。

対象object以外のlabelを保持し、Current Frame／Frame Range／All Framesを選択可能。複数frameへの処理も1回のUndo/Redo transactionとして扱い、変更maskは既存のlabel PNG autosave・NIfTI／TIFF／STL出力へそのまま反映。処理はSciPy／NumPyによるCPU共通実装で、Lite版へTorch／CUDA依存を追加しない構成を維持。

## 2026.8.25

Lite Webの研究workflowを再構成し、**Volume Statistics、Mask Cleanup、Label Manager、slice mask interpolation、TIFF stack import、Three.js 3D preview、Project Check**を追加。Objects panelをtarget選択の中心にし、Seg on Web操作を`Setup → ZIP → Colab → Result`の1つのpanel、各種出力をExport menuへ統合。

Seg on Web jobを、1 objectあたり1 tracking range＋複数box Keyframeへ後方互換拡張。`segref3d-segjob-1.0`を維持しつつ全promptをLite Web／Python validator／Colab backendで検証し、forward/reversed-backwardの両SAM2 stateへ投入。CUDA 12.8上の実SAM2でsingle prompt、2 Keyframe、複数objectのresult ZIP生成まで確認。

## 2026.8.24

SegRef3D source versionを**1.2.4**へ更新。

SegRef3D GPU版のBatch Trackingにobject名、Prompt Frame、object別Tracking Rangeを確認・編集できる**Batch Jobs**を追加。作業JPGと正式な`manifest.json`を含む`segonweb_input.zip`の出力、および`segref3d_result.zip`の検証・画像/mask/object情報復元に対応。

SegOnWebにGradioを使用しないjob backend notebookを追加。既存`SAM2GUIforImgSeqv4_8.ipynb`のSAM2.1 commit、checkpoint、config、box prompt、forward/reversed backward propagation、label PNG処理を維持し、複数object自動処理、進捗表示、result ZIP生成へ入出力部分を置換。

同じBatch Jobs / job ZIP / result ZIPワークフローをSAM2非搭載のWindows Lite版とLite Webにも追加。Lite環境でもpromptを準備してColabへ送り、画像系列・label mask・object情報を一括復元して、そのまま修正・NIfTI/TIFF/STL出力へ進めるよう更新。

## 2026.8.21

Lite Webに**Auto Add / Auto Erase / Auto Transfer**、読み込み後のwindow/level・明るさ・コントラスト調整、基準線キャリブレーション、Threshold/RGB抽出を追加。抽出は現在画像または全画像へAdd/Eraseでき、マスク編集履歴とブラウザ自動保存へ反映。

Lite WebにラベルマスクのNIfTI／マルチページTIFF書き出しと、1x／5x／10xのsigned-distanceスライス補完を使ったSTL書き出しを追加。

Lite WebにWindows版互換の**VolInfo CSV Import / Export**を追加。DICOM／NIfTI読込時と基準線キャリブレーション完了時に`*_volinf.csv`を自動出力し、SpacingをNIfTI／STL、OriginをNIfTIのsformへ反映。

Lite Webに**Seg on Web**リンクを追加。当初はColab出力のラベルPNGを`Load Masks`で戻す一方向ワークフローとして実装し、1.2.4でjob ZIP/result ZIP方式へ更新。

Lite Webの`Load Masks`に**Replace / Merge**を追加。Mergeでは読み込んだ非ゼロラベルを既存マスクへ重ね、重複部分は読み込んだラベルを優先。全画像のマスク・編集履歴・ブラウザ自動保存を確認付きで削除する`Clear Masks`も追加。

## 2026.8.20

SegRef3D **Lite Web Beta** を公開。Windows / macOS / Linux / iPadOS などのモダンブラウザで、画像を外部送信せずにラベルマスクを編集できるブラウザ版を追加。GitHub Actions でマスク処理・ZIP出力の自動テストを実行。

Lite WebにラベルPNGのフォルダ／ZIP読込とProject ZIPの保存・復元を追加。ラベル値0〜20、画像名、枚数、寸法を確認してから一括反映し、読込後のマスクもブラウザへ自動保存するよう改善。

Lite WebにDICOM（`.dcm`および拡張子なし）とNIfTI（`.nii`／`.nii.gz`）の画像読込を追加。DICOMのスライス順、window/level、rescale情報と、NIfTIのvoxel datatype・slope/interceptを反映してブラウザ上の編集画像シーケンスへ変換。

## 2026.8.10

SegRef3D **ver.1.2.3** を公開。

- GPU版を CUDA 12.8 / PyTorch 2.11 対応に更新し、RTX 50シリーズ（Blackwell、sm_120）を含む幅広いNVIDIA GPUへの対応を改善。SAM2を同梱しないLite版も追加。
- トラッキング範囲未設定時や `Clear Box` 操作時のエラーを防ぎ、CUDA非対応環境でもアプリ全体が終了しないよう安全性を改善。
- 3D出力に5x/10xのスライス間輪郭補間を追加し、断面間が滑らかなSTLを生成可能に変更。
- サイズの異なる画像の白キャンバス統一、2000px超画像の1000px縮小、ラベルPNG自動保存、オーバーレイPNG出力に対応。
- Add/EraseのUndo/Redo、マウスホイールによる画像切り替え、中ボタンドラッグによるキャンバス移動、グレー背景表示などの操作性を改善。

## 2026.5.1

SegRef3D **ver.1.2.0** を公開。

マスク処理をラスター処理ベースに統一し、編集・保存・読み込みの安定性を改善。UIを整理し、基本操作を常設ボタンに、応用機能を`Extensions`に集約。`Seg on Web`ボタンを追加し、Web環境でのセグメンテーション実行に対応。`Load VolInfo` / `Show VolInfo`によるボリューム情報の読み込み・表示機能を追加。修正作業を効率化するため、Auto Addなどの自動編集補助機能を追加。

## 2025.11.13

SegRef3D **ver.1.1.0** を公開。拡張子なしのdcmデータ、画像ファイル名のナチュラルソート、NIfTI出力、バージョン情報表示、STL previewへ対応。CT/MRIデータ使用時にvolume information CSVのz spacingが整数化される不具合を修正。UIを整理し、基本操作を常設、拡張機能を最下段へ配置。

## 2025.8.21

SegRef3DのPyTorch同梱build版を公開。ユーザーによるPythonおよびPyTorchのinstallを不要化。

## 2025.7.29

SegRef3Dを公開。

## 2025.7.3

SAM2GUIのローカル実行版を公開。

## 2025.6.10

SAM2GUIforImgSeqに、割り当て色番号の開始番号をユーザーが指定できる機能を追加（SAM2GUIforImgSeqv4.7.ipynb）。

## 2025.4.14

Segment Editor PPに一括処理などのマクロを複数追加（SegmentEditorPPv2.0.pptm）。

## 2025.3.11

- `No module named 'sam2'`となるエラーを修正（SAM2GUIforImgSeqv4.6.ipynb）。
- PyTorch + CUDA + cuDNNの互換性を修正（SAM2GUIforImgSeqv4.3.ipynb）。

## 2025.2.4

SAM2 GUI for Img Seqのリセット方法を明記（SAM2GUIforImgSeqv4.2.ipynb）。SegmentEditorPPの新しいバージョンを追加（SegmentEditorPP1.4.pptm）。

## 2024.11.19

SAM2 GUI for Img SeqをSAM2からSAM2.1へ更新（SAM2GUIforImgSeqv4.0.ipynb）。

## 2024.10.25

- Segment Editor PPにグレースケールmask画像の出力機能を追加（SegmentEditorPPv1.2.pptm）。3D Slicerでのsegment認識を簡略化し、Tutorialを更新。
- SAM2 GUI for Img Seqにグレースケールmask画像の出力機能を追加（SAM2GUIforImgSeqv3.6.ipynb）。

## 2024.10.17

SAM2 GUI for Img Seqにvectorization（SVG出力）を追加（SAM2GUIforImgSeqv3.4.ipynb）。これによりVectorizer Colabを介した変換を不要化。ColorChangerにもvectorizationを追加（ColorChanger_v1.3.ipynb）。
