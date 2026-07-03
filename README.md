# SegRef3D

**SegRef3D** is an open-source platform for AI-assisted segmentation, interactive refinement, multiframe tracking, and three-dimensional reconstruction in morphological research.  
  
**SegRef3D**（セグレフ3D） は、形態学研究におけるAI支援セグメンテーション、対話的修正、連続画像上の追跡、三次元再構築を支援するオープンソースプラットフォームです。

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

## ⚙️ System Requirements

* **Operating System:** Windows 10/11 (64-bit)  
* **Hardware:** NVIDIA GPU with CUDA support (for using SAM-based segmentation and tracking)  
  - CPU-only environment: SegRef3D can run, but **SAM features are disabled**.  
    Other functions (e.g., file handling, visualization, basic utilities) remain available.  
* **Software:** No need to install Python or PyTorch — they are already bundled with SegRef3D  



---

## 🚀 Quick Start

### 1. Download

#### **Latest Version — ver.1.2.1**

Newest build with improved image-processing workflow, unified raster-based mask handling, and UI improvements.

* [`SegRef3D-ver1.2.1.zip`](https://www.dropbox.com/scl/fi/um7pvcdw1nygwcj8d1x76/SegRef3D-ver1.2.1.zip?rlkey=n6p8ewi5nvjji4ds39ij0ghfu&st=kqwc6w63&dl=1)

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

### 🔗 Web-based Segmentation Tutorial

* 🇯🇵 Japanese: [TutorialSegOnWebJP.md](https://github.com/SatoruMuro/SAM2GUIfor3Drecon/blob/main/Tutorial/TutorialSegOnWebJP.md)
* 🇺🇸 English: [TutorialSegOnWebEN.md](https://github.com/SatoruMuro/SAM2GUIfor3Drecon/blob/main/Tutorial/TutorialSegOnWebEN.md)

### 📷 Notes for Web-based Workflow

* The web version currently supports `.jpg` images as input.
* When DICOM images are loaded into SegRef3D, corresponding `.jpg` images are automatically saved in a new folder.
* These `.jpg` images can be uploaded to Google Colab for automatic segmentation.
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

## Related Tool: SegRef3D Viewer

SegRef3D Viewer is a standalone Windows 3D viewer for STL files exported from SegRef3D.

It allows users to load multiple STL files, display each structure as a separate colored object, adjust visibility, color, and opacity, inspect models using section cuts, and export visible objects as a colored OBJ + MTL pair.

SegRef3D Viewer is intended for post-export inspection and visualization. It does not edit, repair, smooth, or modify STL meshes.

Repository and download:
https://github.com/SatoruMuro/SegRef3DViewer

---

# Update  
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
