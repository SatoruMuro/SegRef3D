# SegRef3D

**SegRef3D** is an open-source platform for AI-assisted segmentation, interactive refinement, multiframe tracking, and three-dimensional reconstruction in morphological research.

It provides a practical, lightweight alternative workflow for researchers working with serial histological sections, microscopy images, and other morphological datasets, particularly when access to comprehensive commercial platforms such as Amira/Avizo is limited.

**SegRef3D**（セグレフ3D）は、形態学研究におけるAI支援セグメンテーション、対話的修正、連続画像上の追跡、三次元再構築を支援するオープンソースプラットフォームです。

連続組織切片、顕微鏡画像、その他の形態学画像データを扱う研究者に対して、特にAmira/Avizoなどの商用総合プラットフォームを利用しにくい環境でも実践可能な、軽量な代替ワークフローを提供します。


👉 [Read the full usage tutorial here](https://github.com/SatoruMuro/SAM2GUIfor3Drecon/blob/main/Tutorial/TutorialSegRef3DEN.md)    
  
日本語は[こちら](https://github.com/SatoruMuro/SAM2GUIfor3Drecon/blob/main/READMEJP.md)  

This repository was formerly named SAM2GUIfor3Drecon.  
The software is now distributed as SegRef3D.  

---
<img src="https://github.com/SatoruMuro/SAM2GUIfor3Drecon/blob/main/images/SegRef3D-v1.2.0-GUI.png" alt="image"  width="100%">

---

## 🎥 SegRef3D Tutorial Videos

Watch the **Basic Workflow** video to learn how to use SegRef3D, from loading images to AI-powered segmentation, mask editing, tracking, and exporting results.  

[How to use SegRef3D: 01. Basic Workflow (YouTube)](https://youtu.be/JModwfnBTYU)

---

## 🧠 Features

* 🖼 Load image folders
* 📆 Integration with **SAM2** for box-prompted segmentation and video tracking
* ✨ Object tracking with start/end frame selection and batch execution
* 🎨 Mask editing for up to 20 objects, with per-object color toggling
* 🖊 Freehand, point-to-point, and snap-to-boundary drawing modes
* ✏ Undo/redo support for editing
* ↔ Convert and reassign object colors across all masks
* 🔺 Threshold-based region extraction (CT/MRI presets or manual)
* 🗈 Thinning: reduce number of images by keeping every N-th
* 🧲 Export:
  * Mask images as grayscale TIFF (ascending/descending order)
  * 3D STL models by color (with mm/px and z-spacing calibration)
  * Volume statistics per object as CSV

---

## SegRef3D Lite Web (Beta)

**[Open SegRef3D Lite Web](https://satorumuro.github.io/SegRef3D/lite-web/)**

The lightweight mask-editing workflow is also available as a browser app on
Windows, macOS, Linux, iPadOS, and other modern browser platforms. Images and
masks stay on the device and are not uploaded to a server.

- Load JPG/PNG image folders and edit up to 20 single-label objects
- Load DICOM folders (`.dcm` or extensionless) and NIfTI `.nii` / `.nii.gz` volumes
- Free, Click, and edge Snap drawing with Add, Erase, Transfer, optional automatic apply, Undo, and Redo
- Browser autosave, Replace/Merge label PNG import, mask reset, and ZIP export for labels and overlays
- Project ZIP export/import for restoring label masks and editor settings
- Window/level, brightness/contrast, reference-line calibration, threshold extraction, and RGB extraction
- Windows-compatible VolInfo CSV import/export, including automatic export after medical-volume loading and calibration
- NIfTI/TIFF label-volume export and 1x/5x/10x signed-distance interpolation with STL export
- Multi-object Seg Anything job setup, job ZIP export, and complete result ZIP restoration
- Mouse-wheel image switching, zoom, pan, and a responsive touch-friendly layout

The Web Beta does not run SAM2 inside the browser. Configure Box Prompts, Prompt Frames,
and Tracking Ranges in Lite Web, export `segonweb_input.zip`, process it in the Seg Anything
Colab backend, and restore `segref3d_result.zip` with **Import Result**. Display, extraction,
calibration, label-volume export, and STL generation run locally in the browser. Images are
uploaded only when the user explicitly sends the job ZIP to Google Colab.

## AI-assisted segmentation

### Seg Anything

SAM-based segmentation for structures specified by the user. Use it when the target is not in
the anatomical catalog, is pathological or highly variable, or should be defined manually.

```text
SegRef3D → prompts and export → SAM / Colab → import → refinement → 3D
```

### Seg CT/MRI

Automatic anatomical segmentation from CT/MRI using TotalSegmentator. Available structures
depend on the modality and model. The v1 catalog currently exposes supported open-license CT
structures. The source volume remains unchanged while the request is prepared locally:

1. Load a CT `.nii` or `.nii.gz` volume.
2. Open **Seg CT/MRI** under AI Segmentation.
3. Search the open-license ROI catalog and map each structure to Obj 1-20.
4. Export `instant3d_request.zip`.
5. Open [Seg CT/MRI in Google Colab](https://satorumuro.github.io/SegRef3D/ColabNotebooks/segctmri.html).
6. Upload the request ZIP to your own Colab runtime and run TotalSegmentator.
7. Download `instant3d_result.zip` and import it into the same source volume.
8. Refine, measure, and export the returned masks in SegRef3D.

The request ZIP contains the exact source NIfTI volume, selected structures, Obj mappings, and
geometry fingerprint. Import rejects a result whose dimensions, spacing, affine/orientation, or
source checksum differs. Only structures in the bundled open-license catalog can be requested;
license-restricted TotalSegmentator tasks are rejected. TotalSegmentator is not bundled into the
Desktop or Lite Web application and runs only after an explicit upload to Google Colab. Confirm
that this use is permitted by your institution before uploading research or medical data.

```text
SegRef3D → select anatomy and export → TotalSegmentator / Colab → import → refinement → 3D
```

---

## ⚙️ System Requirements

* **Operating System:** Windows 10/11 (64-bit)  
* **Hardware:** NVIDIA GPU with CUDA support (for using SAM-based segmentation and tracking)  
  - CPU-only environment: SegRef3D can run, but **SAM features are disabled**.  
    Other functions (e.g., file handling, visualization, basic utilities) remain available.  
* **Software:** No need to install Python or PyTorch — they are already bundled with SegRef3D  



---

## 🚀 Quick Start

### 1. Download

#### **Latest Version — ver.1.2.3**

Newest Windows builds with CUDA 12.8 / RTX 50-series support, a SAM2-free Lite edition, safer tracking and mask editing, 5x/10x slice interpolation for 3D export, image preprocessing, and improved canvas navigation.

Two builds are available:

* **GPU build** — includes local SAM2-based AI segmentation. Recommended for NVIDIA GPU environments.
  * [`SegRef3D-GPU-v1.2.3-Windows.zip`](https://www.dropbox.com/scl/fi/aixgd0a7lyp45tcye3x3e/SegRef3D-GPU-v1.2.3-Windows.zip?rlkey=0mgnxeb3afovi60ln4q9uo156&st=tbh8qvrf&dl=1)

* **Lite build** — lightweight build without bundled SAM2. Recommended for general use when local AI segmentation is not required.
  * [`SegRef3D-Lite-v1.2.3-Windows.zip`](https://www.dropbox.com/scl/fi/2bbm6byzi3tme547e2beb/SegRef3D-Lite-v1.2.3-Windows.zip?rlkey=4u3njpty6ggm37oa04cqx12kn&st=95sqew99&dl=1)

#### **Previous Stable Version — ver.1.1.0**

Stable build tested across multiple environments.

* [`SegRef3D-ver1.1.0.zip`](https://www.dropbox.com/scl/fi/sw4r6plklm5666qdy63lh/SegRef3D-ver1.1.0.zip?rlkey=e4l1tijjz3ih5mapcvq5ftl6a&st=q7cn11jk&dl=1)

#### **Previous Stable Version — ver.1.0.1**

Earlier stable build tested across multiple environments.

* [`SegRef3D-ver1.0.1.zip`](https://www.dropbox.com/scl/fi/1xgq28szs6by1sp1qbskw/SegRef3D.zip?rlkey=3jtwph3muk24888rpya54f222&st=ajyyhjrm&dl=1)

After downloading, unzip the file.

> 📁 **Tip:** Move the entire unzipped folder (which includes `SegRef3D.exe` and the `_internal` folder) to a simple path like `C:\SegRef3D\`.  
> ❗ Avoid placing the folder in locations with **long paths, Japanese characters, or spaces** (e.g., Desktop or Documents), as this may cause runtime errors.


### 2. Preparation Before Execution

✅ **No need to install Python or PyTorch.**  
Everything required to run SegRef3D is already bundled inside the application.

⚠️ **Requirement:**  
If you want to use **SAM-based segmentation and tracking**, make sure the PC has an **NVIDIA GPU with a compatible driver installed**.  

- **GPU environment:** Full functionality (including SAM)  
- **CPU environment:** SAM features are disabled, but other tools remain usable  


### 3. Run

Double-click `SegRef3D.exe` to start the application.  
The `_internal` folder **must be located in the same directory** as `SegRef3D.exe`.

> ⚠️ SAM2 features (AI segmentation and tracking) require an NVIDIA GPU and CUDA-compatible drivers.  
> If your system is not compatible, the related buttons will be automatically disabled.  
> ❗ Be careful **not to delete the `_internal` folder** — the application will fail to launch without it.  
> 💡 **Tip:** The first startup may take longer than usual while the environment initializes.  


---

## 📘 Full Tutorial

Looking for step-by-step instructions?  
👉 [Read the full usage tutorial here](https://github.com/SatoruMuro/SAM2GUIfor3Drecon/blob/main/Tutorial/TutorialSegRef3DEN.md)

---

## 🔄 Registration (Alignment)

For serial images such as histological sections, alignment (registration) is essential before segmentation or 3D reconstruction.  
👉 [See detailed registration steps here](https://github.com/SatoruMuro/SAM2GUIfor3Drecon/blob/main/Tutorial/Registration.md)

> 💡 **Note:** Registration is typically **not required** for CT or MRI images, since they are already aligned during acquisition. However, **histological serial sections** often need registration (alignment) due to physical distortion and sectioning artifacts.

---

## 📂 Input Format

* Input images: `.jpg`, `.png`, **or DICOM (.dcm)** files stored in a folder
* Histological serial sections require registration before segmentation. See [this page](Tutorial/Registration.md) for details.
  `.jpg`, `.png`, **or DICOM (.dcm)** files stored in a folder
* Masks: SVG format with objects encoded using predefined 20 RGB colors

---

## 🧠 SAM2 Integration

To use SAM2 for segmentation and tracking:

* Press **Set Box Prompt** and select a rectangular area
* Press **Run Seg** to apply SAM2 segmentation
* Use **Set Tracking Start / End** and **Run Tracking** to propagate mask
* Optionally use **Run Batch Tracking** for multiple object prompts

> 📌 Note: `sam2_interface.py` internally loads the `build_sam2` module from `sam2pkg/sam2`.

---

## 🎨 Object Editing Tools

* **Add to Mask** / **Erase from Mask**: modify selected object by drawing
* **Transfer To**: reassign mask region to another object
* **Convert Color**: reassign color label across images
* **Overlap Detection**: visualize and extract overlapping areas
* **Undo/Redo Edit**: fully reversible editing

---

## ⚙️ STL and Volume Export

* If your input images are DICOM files, calibration is **not required**.
* For other image types (e.g., `.jpg`, `.png`):

  * Draw a line using **Draw Calibration Line**
  * Input actual mm length and z-spacing
* Then, click **Export STL** or **Export Volume CSV**

---

## 🖥️ For Non-GPU Environments

If you do not have a CUDA-compatible GPU, you can still use SegRef3D through a hybrid workflow:

* Run automatic segmentation on the web using Google Colaboratory
* Download the generated **standard PNG label masks**
* Load the masks into the local SegRef3D application for manual refinement, STL export, NIfTI export, and measurement CSV output

### Seg Anything Job Workflow

The GPU desktop, Lite desktop, and Lite Web workflows move every prompt operation into
SegRef3D and use Google Colab only as a SAM2 computation backend:

1. Configure each object's Box Prompt, Prompt Frame, and Tracking Range in SegRef3D.
2. Choose **AI Segmentation > Seg Anything > Create Input ZIP**.
3. Open Seg Anything, select a T4 GPU, run all cells, and upload `segonweb_input.zip`.
4. The final Colab cell automatically downloads `segref3d_result.zip` after segmentation completes.
5. Choose **Import Result ZIP** in SegRef3D, then refine the masks and build 3D output normally.

The Colab notebook does not use Gradio. It validates the job, automatically processes
multiple objects forward and backward from each object's Prompt Frame, displays
progress, and returns standard single-label PNG masks with the working JPG sequence.

### 🔗 Web-based Segmentation Tutorial

* 🇯🇵 Japanese: [TutorialSegOnWebJP.md](https://github.com/SatoruMuro/SegRef3D/blob/main/Tutorial/TutorialSegOnWebJP.md)
* 🇺🇸 English: [TutorialSegOnWebEN.md](https://github.com/SatoruMuro/SegRef3D/blob/main/Tutorial/TutorialSegOnWebEN.md)

### 📷 Notes for Web-based Workflow

* Lite Web accepts JPG, PNG, DICOM, and NIfTI input.
* Configure object jobs in **Batch Jobs**, then export one `segonweb_input.zip` file.
* Run Seg Anything on a Colab GPU and restore the returned `segref3d_result.zip` with **Import Result**.
* The web version outputs **standard PNG label masks** with the same image size as the original input images.

### 🔁 Final Integration

* Import the **standard PNG label masks** generated on the web into SegRef3D using **Load Masks**.
* The standard PNG mask is a single-channel label image:
  * `0` = background
  * `1–20` = object labels
* You can then edit the masks interactively and export STL models, NIfTI label maps, and measurement CSV files locally.
* Legacy `.svg` mask files from older versions can still be loaded, but the recommended format is now the single-channel PNG label mask.
* On non-GPU systems, all automatic SAM2 features in the local SegRef3D application are disabled by default.

---

## Related Tool: SliceBridge

**[Open SliceBridge in your browser](https://satorumuro.github.io/SegRef3D/slice-bridge/)**  
📘 **User guides:** [English](https://satorumuro.github.io/SegRef3D/Tutorial/SliceBridgeEN.html) / [日本語](https://satorumuro.github.io/SegRef3D/Tutorial/SliceBridgeJP.html)

SliceBridge inserts blank planes between the labeled planes of a SegRef3D
NIfTI label map. The resulting anchor-slice NIfTI can be interpolated with
3D Slicer's **Fill between slices** effect.

- Runs entirely in the browser; files are not uploaded
- Preserves label values, physical extent, origin, and orientation
- Supports `.nii` and `.nii.gz` NIfTI-1 integer label maps

---

## Related Tool: SegRef3D Viewer

SegRef3D Viewer is a standalone Windows 3D viewer for STL files exported from SegRef3D.

It allows users to load multiple STL files, display each structure as a separate colored object, adjust visibility, color, and opacity, inspect models using section cuts, and export visible objects as a colored OBJ + MTL pair.

SegRef3D Viewer is intended for post-export inspection and visualization. It does not edit, repair, smooth, or modify STL meshes.

Repository and download:
https://github.com/SatoruMuro/SegRef3DViewer

---

# Update  
**2026.8.26**

SegRef3D source versionを**1.2.6**へ更新。Windows GPU版／Lite CPU版のデスクトップGUIを、基本操作だけのTop Toolbar、縦型Object Panel、中央Image View、カテゴリ別Tool Panel、Slice Navigation、コンパクトなStatus Barからなる3カラム構成へ再設計。Object row選択とTarget Objectを同期し、wheel・PageUp/PageDown・F/R・J/Uを含む全画像切替をslice slider／番号表示へ反映。Lite版ではローカルSAM2 controlsを非表示にし、Seg on Web導線のみを表示。

Lite Webも同じ`Objects | Image View | Tools`の3カラム構成へ再設計。Top command barをOpen／Fit／統合Undo・Redo／Exportへ簡素化し、Object rowを唯一のTarget selectorとしてExtract・Cleanup・AI Setupと同期。Canvas下に直接番号入力付きslice sliderを追加し、AI SegmentationをSetup → Input ZIP → Colab → Resultの4-step workflowとしてTools dockへ統合。desktop／narrow／mobileでは同じ機能を維持し、狭い画面ではObjectsとToolsをdrawer表示する。

手描き編集に**Current Slice／All Pending Slices**を追加し、Add／Erase／Transferの対象範囲を明示。複数sliceへの一括適用は1回のUndo/Redo transactionとして保持し、Transferは描画範囲内の選択objectだけを変更。Top ToolbarのUndo／Redoを線編集とmask編集に統合し、`Ctrl+Y`／`Ctrl+Shift+Z`によるRedo、window resize時のzoom保持、主要controlのtooltip、処理中だけ表示されるprogress barを追加。

SegRef3D source versionを**1.2.5**へ更新。Windows GPU版／Lite CPU版の共通機能として、Lite Web互換の**Mask Cleanup**（Fill Holes、Remove Small Islands、Keep Largest Component、Smooth Boundary、Dilate、Erode）と、signed-distance fieldによる**Interpolate Between Frames**を追加。

対象object以外のlabelを保持し、Current Frame／Frame Range／All Framesを選択可能。複数frameへの処理も1回のUndo/Redo transactionとして扱い、変更maskは既存のlabel PNG autosave・NIfTI／TIFF／STL出力へそのまま反映。処理はSciPy／NumPyによるCPU共通実装で、Lite版へTorch／CUDA依存を追加しない構成を維持。

**2026.8.25**

Lite Webの研究workflowを再構成し、**Volume Statistics、Mask Cleanup、Label Manager、slice mask interpolation、TIFF stack import、Three.js 3D preview、Project Check**を追加。Objects panelをtarget選択の中心にし、Seg on Web操作を`Setup → ZIP → Colab → Result`の1つのpanel、各種出力をExport menuへ統合。

Seg on Web jobを、1 objectあたり1 tracking range＋複数box Keyframeへ後方互換拡張。`segref3d-segjob-1.0`を維持しつつ全promptをLite Web／Python validator／Colab backendで検証し、forward/reversed-backwardの両SAM2 stateへ投入。CUDA 12.8上の実SAM2でsingle prompt、2 Keyframe、複数objectのresult ZIP生成まで確認。

**2026.8.24**

SegRef3D source versionを**1.2.4**へ更新。

SegRef3D GPU版のBatch Trackingにobject名、Prompt Frame、object別Tracking Rangeを確認・編集できる**Batch Jobs**を追加。作業JPGと正式な`manifest.json`を含む`segonweb_input.zip`の出力、および`segref3d_result.zip`の検証・画像/mask/object情報復元に対応。

SegOnWebにGradioを使用しないjob backend notebookを追加。既存`SAM2GUIforImgSeqv4_8.ipynb`のSAM2.1 commit、checkpoint、config、box prompt、forward/reversed backward propagation、label PNG処理を維持し、複数object自動処理、進捗表示、result ZIP生成へ入出力部分を置換。

同じBatch Jobs / job ZIP / result ZIPワークフローをSAM2非搭載のWindows Lite版とLite Webにも追加。Lite環境でもpromptを準備してColabへ送り、画像系列・label mask・object情報を一括復元して、そのまま修正・NIfTI/TIFF/STL出力へ進めるよう更新。

**2026.8.21**

Lite Webに**Auto Add / Auto Erase / Auto Transfer**、読み込み後のwindow/level・明るさ・コントラスト調整、基準線キャリブレーション、Threshold/RGB抽出を追加。抽出は現在画像または全画像へAdd/Eraseでき、マスク編集履歴とブラウザ自動保存へ反映。

Lite WebにラベルマスクのNIfTI／マルチページTIFF書き出しと、1x／5x／10xのsigned-distanceスライス補完を使ったSTL書き出しを追加。

Lite WebにWindows版互換の**VolInfo CSV Import / Export**を追加。DICOM／NIfTI読込時と基準線キャリブレーション完了時に`*_volinf.csv`を自動出力し、SpacingをNIfTI／STL、OriginをNIfTIのsformへ反映。

Lite Webに**Seg on Web**リンクを追加。当初はColab出力のラベルPNGを`Load Masks`で戻す一方向ワークフローとして実装し、1.2.4でjob ZIP/result ZIP方式へ更新。

Lite Webの`Load Masks`に**Replace / Merge**を追加。Mergeでは読み込んだ非ゼロラベルを既存マスクへ重ね、重複部分は読み込んだラベルを優先。全画像のマスク・編集履歴・ブラウザ自動保存を確認付きで削除する`Clear Masks`も追加。

**2026.8.20**

SegRef3D **Lite Web Beta** を公開。Windows / macOS / Linux / iPadOS などのモダンブラウザで、画像を外部送信せずにラベルマスクを編集できるブラウザ版を追加。GitHub Actions でマスク処理・ZIP出力の自動テストを実行。

Lite WebにラベルPNGのフォルダ／ZIP読込とProject ZIPの保存・復元を追加。ラベル値0〜20、画像名、枚数、寸法を確認してから一括反映し、読込後のマスクもブラウザへ自動保存するよう改善。

Lite WebにDICOM（`.dcm`および拡張子なし）とNIfTI（`.nii`／`.nii.gz`）の画像読込を追加。DICOMのスライス順、window/level、rescale情報と、NIfTIのvoxel datatype・slope/interceptを反映してブラウザ上の編集画像シーケンスへ変換。

**2026.8.10**

SegRef3D **ver.1.2.3** を公開。

* GPU版を CUDA 12.8 / PyTorch 2.11 対応に更新し、RTX 50シリーズ（Blackwell、sm_120）を含む幅広いNVIDIA GPUへの対応を改善。SAM2を同梱しないLite版も追加。
* トラッキング範囲未設定時や `Clear Box` 操作時のエラーを防ぎ、CUDA非対応環境でもアプリ全体が終了しないよう安全性を改善。
* 3D出力に5x/10xのスライス間輪郭補間を追加し、断面間が滑らかなSTLを生成可能に変更。
* サイズの異なる画像の白キャンバス統一、2000px超画像の1000px縮小、ラベルPNG自動保存、オーバーレイPNG出力に対応。
* Add/EraseのUndo/Redo、マウスホイールによる画像切り替え、中ボタンドラッグによるキャンバス移動、グレー背景表示などの操作性を改善。

**2026.5.1**   
SegRef3D **ver.1.2.0** を公開。  
マスク処理をラスター処理ベースに統一し、編集・保存・読み込みの安定性を改善。  
UIを整理し、基本操作を常設ボタンに、応用機能を `Extensions` に集約。  
`Seg on Web` ボタンを追加し、Web環境でのセグメンテーション実行に対応。  
`Load VolInfo` / `Show VolInfo` によるボリューム情報の読み込み・表示機能を追加。  
修正作業を効率化するため、Auto Add などの自動編集補助機能を追加。  

**2025.11.13**  
SegRef3D **ver.1.1.0** を公開。  
拡張子なしの dcm データの読み込みに対応。  
画像ファイル名のナチュラルソートに対応。  
CT/MRI データ使用時、ボリューム情報 CSV の z spacing が整数化されてしまう不具合を修正。  
NIfTI 形式での出力機能を追加。  
バージョン情報を表示するボタンを追加。  
出力した STL を別ウィンドウでプレビュー表示できる機能を追加。  
UI 改善：基本操作ボタンを常設とし、拡張機能は最下段に整理。

**2025.8.21**
SegRef3Dのpytorch同封ビルド版を公開。ユーザーはpythonおよびpytorchのインストールが不要になります。

**2025.7.29**  
SegRef3Dを公開。

**2025.7.3**  
SAM2GUIのローカル実行版を公開。

**2025.6.10**  
SAM2GUIforImgSeqに、割り当て色番号の開始番号をユーザーが指定できる機能を追加（SAM2GUIforImgSeqv4.7.ipynb）。  

**2025.4.14**  
Segment Editor PPに一括処理などのマクロを複数追加（SegmentEditorPPv2.0.pptm）

**2025.3.11**  
No module named 'sam2'となるエラーを修正（SAM2GUIforImgSeqv4.6.ipynb）。  

**2025.3.11**  
PyTorch + CUDA + cuDNNの互換性を修正（SAM2GUIforImgSeqv4.3.ipynb）。  

**2025.2.4**  
SAM2 GUI for Img Seqのリセット方法を明記（SAM2GUIforImgSeqv4.2.ipynb）。  
SegmentEditorPPの新しいバージョンを追加(SegmentEditorPP1.4.pptm)。  

**2024.11.19**  
SAM2 GUI for Img Seqの中身をSAM2からSAM2.1にグレードアップさせました（SAM2GUIforImgSeqv4.0.ipynb）。これにより精度向上が期待されます（使用実感としてはあまり変わらないかもです）。  

**2024.10.25**  
Segment Editor PPにグレースケールのマスク画像の出力機能を追加しました（SegmentEditorPPv1.2.pptm）。これにより、3D slicerでのセグメント認識がより簡便になります。Tutorialの記載を更新しました。  

**2024.10.25**  
SAM2 GUI for Img Seqにグレースケールのマスク画像の出力機能を追加しました（SAM2GUIforImgSeqv3.6.ipynb）。これにより、3D slicerでのセグメント認識がより簡便になります。（詳細は後日Tutorialを更新して記載します）  

**2024.10.17**  
SAM2 GUI for Img Seqにベクター化機能（SVGファイル出力機能）を追加しました（SAM2GUIforImgSeqv3.4.ipynb）。これにより、[Vectorizer Colab](https://colab.research.google.com/github/SatoruMuro/SAM2GUIfor3Drecon/blob/main/ColabNotebooks/Vectorizer_v5.ipynb)を用いてベクター変換作業を行う必要がなくなりました。同様にColorChangerにもベクター化機能を追加しました（ColorChanger_v1.3.ipynb）。  

---

# License
The code for the SegRef3D, JPG Converter, SAM2  for Img Seq, ColorChanger, Vectorizer Colab, Segment Editor PP, Graphic2shape, and Object Mask Splitter is licensed under the [Apache 2.0 License](https://github.com/SatoruMuro/SAM2for3Drecon/blob/main/LICENSE).

---

# 📚 Citation｜引用

本ツールを研究・論文等で使用される場合は、以下の論文を引用してください。  
If you use this tool for research or academic purposes, please cite the following articles:

**Muro S, Ibara T, Nimura A, Akita K.**  
**SegRef3D: A Versatile Open-Source Platform for Artificial Intelligence-Assisted Segmentation and Three-Dimensional Reconstruction in Morphological Research.**  
*Int J Imaging Syst Technol.* 2026;36(2):e70313.  
🔗 [https://doi.org/10.1002/ima.70313](https://doi.org/10.1002/ima.70313)

**Muro S, Ibara T, Nimura A, Akita K.**  
**Seg and Ref: A Newly Developed Toolset for Artificial Intelligence-Powered Segmentation and Interactive Refinement for Labor-Saving Three-Dimensional Reconstruction.**  
*Microscopy (Oxford)*. Published online March 3, 2025.  
🔗 [https://doi.org/10.1093/jmicro/dfaf015](https://doi.org/10.1093/jmicro/dfaf015)

---

### 📎 BibTeX

```bibtex
@article{Muro2026,
  author    = {Muro, Satoru and Ibara, Takuya and Nimura, Akimoto and Akita, Keiichi},
  title     = {SegRef3D: A Versatile Open-Source Platform for Artificial Intelligence-Assisted Segmentation and Three-Dimensional Reconstruction in Morphological Research},
  journal   = {International Journal of Imaging Systems and Technology},
  volume    = {36},
  number    = {2},
  pages     = {e70313},
  year      = {2026},
  doi       = {10.1002/ima.70313}
}


@article{Muro2025b,
  author    = {Muro, Satoru and Ibara, Takuya and Nimura, Akimoto and Akita, Keiichi},
  title     = {Seg and Ref: A Newly Developed Toolset for Artificial Intelligence-Powered Segmentation and Interactive Refinement for Labor-Saving Three-Dimensional Reconstruction},
  journal   = {Microscopy (Oxford)},
  year      = {2025},
  month     = {March},
  note      = {Published online},
  doi       = {10.1093/jmicro/dfaf015}
}
```

---


## Applications in Published Studies

SegRef3D has been used for AI-assisted segmentation and three-dimensional reconstruction in anatomical and morphological studies using different types of serial image datasets.

| Image dataset | Specimen type | Study | Application |
|---|---|---|---|
| Serial histological sections | Human cadaveric specimen | Muro et al. Why is the umbilicus concave? A histological and three-dimensional anatomical study revealing the “umbilical sheath”. *Anatomical Science International*, 2026. [https://doi.org/10.1007/s12565-026-00950-w](https://doi.org/10.1007/s12565-026-00950-w) | 3D reconstruction of the fibrous connective tissue structure supporting the umbilical concavity. |
| Serial histological sections | Animal specimen | Kakui et al. A new entoproct commensal on holothuroids in the northwestern Pacific abyssal–hadal zone. *Deep-Sea Research Part I*, 2026. [https://doi.org/10.1016/j.dsr.2026.104716](https://doi.org/10.1016/j.dsr.2026.104716) | 3D reconstruction of a newly described deep-sea entoproct species from serial histological sections. |
| CoMBI block-face images | Human cadaveric specimen | Muro et al. Thin-Adipose Compartment at the Colonic Mesentery–Perirenal Fat Interface: Histological and Three-Dimensional Morphological Studies. *International Journal of Urology*, 2026. [https://doi.org/10.1111/iju.70385](https://doi.org/10.1111/iju.70385) | Segmentation and 3D reconstruction of thin adipose compartments using serial block-face images obtained by CoMBI. |
