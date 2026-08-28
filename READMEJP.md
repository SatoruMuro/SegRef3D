# SegRef3D

**連続画像から、定量可能な3Dデータへ。**

SegRef3Dは、連続2D画像や3D volumeから、構造のsegmentation、mask修正、体積計測、3D再構築を行う
オープンソースプラットフォームです。連続組織切片、光学・電子顕微鏡画像、CT/MRI、micro-CT、
Visible Human系画像、その他の連番画像やvolumeを扱えます。

[**SegRef3D Liteを開く**](https://satorumuro.github.io/SegRef3D/lite-web/) ·
[基本操作](Tutorial/TutorialSegRef3DLiteJP.md) ·
[AIに使い方を相談する](Tutorial/AskAISegRef3D.md) ·
[English](README.md)

## 画像・目的・環境から選ぶ

| 条件 | 最初の選択 |
| --- | --- |
| 連続組織切片・光学／電子顕微鏡画像 | 必要に応じて位置合わせし、画像順・pixel spacing・slice spacingを確認してから編集します。 |
| CT／MRI／micro-CT | DICOMまたはNIfTIを読み込み、計測前に取り込まれたphysical geometryを確認します。 |
| 既存のAI maskを直したい | label PNGまたはProject ZIPを読み込み、Add／Erase／Cleanup等で修正します。 |
| 体積を測りたい | spacingまたはcalibrationを確認し、maskを点検してVolume Statistics CSVを出力します。 |
| 3Dモデルを作りたい | 画像順とspacingを確認し、3D preview後にSTLを出力します。 |
| 3D Slicerへ持っていきたい | NIfTI Labelmapを出力し、SlicerではSegmentationとして読み込みます。 |

組織切片などは、定量3D化の前に[registration／alignment](Tutorial/Registration.md)が必要な場合があります。
実寸計測では、DICOM/NIfTIのgeometryまたは検証済みのpixel/voxel・slice spacingを使用してください。

## どのSegRef3Dを使えばよいですか？

| 環境 | 推奨版 |
| --- | --- |
| Windows／macOS／Linuxで簡単に始めたい | **SegRef3D Lite** |
| Windows + NVIDIA CUDA GPUでSAM2をローカル実行したい | **SegRef3D Local GPU** |
| SAM2なしのWindowsデスクトップ版が必要 | **SegRef3D Local CPU**（legacy） |

ほとんどの新規ユーザーには、インストール不要の**SegRef3D Lite**を推奨します。

## AIにSegRef3Dの使い方を相談する

[公式のAI相談用プロンプト](Tutorial/AskAISegRef3D.md)を利用すると、画像種、file format、2D連番／3D volume、
spacing、目的、OS/GPU、データ取扱条件をAIに整理させてから、適した版とworkflowを提案させられます。
AI向け公式情報は[llms.txt](llms.txt)と[llms-full.txt](llms-full.txt)です。

> AI相談では条件を文章で説明し、患者識別情報、機密の研究画像、認証情報、未公開データそのものは
> 第三者のAIサービスへ貼り付けないでください。

### プライバシーと処理場所

**通常のSegRef3D Lite利用中、画像はユーザーの端末内に留まります。** 画像表示、mask編集、計測、
NIfTI出力、STL生成はブラウザ内で処理されます。Seg AnythingとSeg CT/MRIだけは例外で、作業画像または
元volumeを含むZIPをユーザー自身のGoogle Colab runtimeへ明示的にuploadします。SegRef3Dは中継用の
画像upload serverを運用していません。研究・医用情報の利用可否は所属機関の規定を確認してください。

---

<img src="images/SegRef3D-v1.2.0-GUI.png" alt="image" width="100%">

---

## 🎥 SegRef3D 操作紹介動画

SegRef3Dの基本的な操作手順をご覧いただける動画を掲載しています。以下の動画では、インターフェースの使い方、セグメンテーションの実行手順、マスク編集やトラッキングの一連の流れを確認できます。

[How to use SegRef3D: 01. Basic Workflow (YouTube)](https://youtu.be/JModwfnBTYU)

---


## 🧠 主な機能

* 🖼 JPG/PNG/TIFF連番、DICOM series、3D NIfTI volumeの読み込み
* 📆 SegRef3D Local GPUでのローカルSAM2 segmentation／tracking
* ☁ SegRef3D Liteから利用する任意のSeg Anything／Seg CT/MRI Google Colab workflow
* ✨ 任意の範囲を指定したオブジェクト追跡（Start/Endフレームの指定、バッチ処理）
* 🎨 最大20オブジェクトまでのマスク編集と可視化切替
* 🖊 フリーハンド、点指定、境界スナップの描画モード
* ✏ Undo／Redo による編集履歴管理
* ↔ 色ラベルの一括変換・再割り当て機能
* 🔺 CT／MRIプリセットや手動による閾値抽出
* 🗈 間引き機能（N枚に1枚のみ保持）
* 🧲 出力機能：

  * 元画像geometryを保持するNIfTI Labelmap（Original / slice方向5x / 10x補間）
  * グレースケールTIFF（昇順／降順）
  * mmスケーリング済みオブジェクト別 3D STL 出力
  * オブジェクトごとの体積CSV出力

---

## SegRef3D Lite

**[SegRef3D Liteを開く](https://satorumuro.github.io/SegRef3D/lite-web/)**

📘 **基本操作チュートリアル:** [日本語](Tutorial/TutorialSegRef3DLiteJP.md) · [English](Tutorial/TutorialSegRef3DLiteEN.md)

マスク編集の主要ワークフローを、Windows、macOS、Linux、iPadOSなどのモダンブラウザで利用できます。

- JPG/PNG、DICOM、NIfTIの読み込みと20オブジェクトのラベル編集
- Free / Click / Snap描画、Auto Add / Erase / Transfer、Threshold / RGB抽出、Undo / Redo
- Window/Level、明るさ・コントラスト、基準線キャリブレーション、VolInfo CSV
- ラベルPNG、overlay PNG、Original/5x/10x NIfTI Labelmap、TIFF、補間STLの出力
- DICOM/NIfTI由来のIJK→RAS physical geometryをNIfTIマスクへ保持（旧VolInfo CSVも読込可能）
- 複数objectのSeg Anything job設定、`segonweb_input.zip`出力、`segref3d_result.zip`復元
- ブラウザ自動保存、Project ZIP、マウス/キーボード操作、モバイル対応UI

SAM2本体はブラウザ内では動作しません。SegRef3D Liteの**Seg Anything**でBox Prompt、Prompt Frame、Tracking Rangeを設定し、明示的にGoogle Colabへjob ZIPをuploadした場合だけ画像が外部へ送信されます。その他の編集・抽出・出力処理はブラウザ内で完結します。

NIfTI Labelmap出力は、取得できる場合に元DICOM/NIfTIの患者座標geometryを保持します。
5x/10xはslice方向のみsigned-distance補間し、元annotation sliceと最初/最後の物理位置を保持します。
3D Slicerではファイル種類を **Segmentation** として読み込むと、ラベルを個別segmentとして
取り込めます。TIFFはマスク画素を保持しますが完全な3D患者座標は保持しないため、
元画像へ位置合わせして使用する場合はNIfTI Labelmapを利用してください。

## AI支援セグメンテーション

### Seg Anything

ユーザーが指定した任意対象をSAM系モデルでsegmentします。解剖構造catalogにない対象、病変や
変異の大きい構造、ユーザー自身が対象を定義したい場合に使用します。

### Seg CT/MRI

TotalSegmentatorを用いてCT/MRIから既知の解剖学的構造を自動segmentします。利用可能な構造は
modalityとmodelに依存し、v1 catalogではopen-licenseの対応CT構造を提供します。

1. CTの`.nii`または`.nii.gz`を読み込む
2. **AI Segmentation > Seg CT/MRI**を開く
3. open-license ROI catalogを検索し、各構造をObj 1-20へ割り当てる
4. `instant3d_request.zip`を出力する
5. [Google Colab版Seg CT/MRI](https://satorumuro.github.io/SegRef3D/ColabNotebooks/segctmri.html)を開く
6. 自分のColab runtimeへZIPを明示的にuploadしてTotalSegmentatorを実行する
7. `instant3d_result.zip`をdownloadし、同じ元volumeを開いたSegRef3Dへ読み込む
8. 返されたmaskを修正し、計測・3D出力へ進む

request ZIPには元NIfTIそのもの、選択構造、Obj割当、geometry fingerprintが含まれます。
結果読込時には寸法、voxel spacing、affine／orientation、元volumeのchecksumを照合し、異なる
volumeへの誤読込を拒否します。選択できるのは同梱のopen-license catalogに含まれる構造のみで、
license制限のあるTotalSegmentator taskは拒否されます。研究画像・医用画像をGoogle Colabへ
uploadできるかは、所属機関の規定を事前に確認してください。

---

## 🌉 SliceBridge — NIfTI基準スライス作成ツール

**[ブラウザでSliceBridgeを開く](https://satorumuro.github.io/SegRef3D/slice-bridge/)**

👉 [SliceBridgeの詳しい使い方](Tutorial/SliceBridgeJP.md)

SegRef3Dから出力したNIfTIラベルマップの輪郭間に空白スライスを挿入し、
3D Slicerの **Fill between slices** で補間できる基準スライスデータを作成します。

- ファイルは外部へ送信せず、ブラウザ内だけで処理
- ラベル値、実寸範囲、原点、向きを保持
- NIfTI-1整数ラベルマップ（`.nii` / `.nii.gz`）に対応

---

## ⚙️ 動作環境

* **SegRef3D Lite:** Windows、macOS、Linuxのモダンブラウザ。インストール不要。
* **SegRef3D Local GPU:** Windows 10/11（64-bit）、NVIDIA CUDA GPU、互換ドライバ。
* **SegRef3D Local CPU:** Windows 10/11（64-bit）。ローカルSAM2は含みません。
* **Local配布版:** PythonやPyTorchを別途インストールする必要はありません。

---

## 🚀 クイックスタート

### 1. ダウンロード

#### 推奨：SegRef3D Lite

Windows／macOS／Linux。インストール不要です。

* **[SegRef3D Liteを開く](https://satorumuro.github.io/SegRef3D/lite-web/)**

#### 高度なローカルAI：SegRef3D Local GPU v1.2.6

Windows + 対応NVIDIA CUDA GPU向けです。ローカルSAM2 segmentation／trackingを含み、
同梱AI機能をローカル実行したいWindowsユーザーに推奨します。

* **[SegRef3D Local GPU v1.2.6 Windows版をダウンロード](https://www.dropbox.com/scl/fi/ku3hj0spnw5rrmzgpc5ui/SegRef3D-Local-GPU-v1.2.6-Windows.zip?rlkey=aqd47l35lfl1kf6a7r5rv3xa3&st=e34tvblg&dl=1)**

ファイル：`SegRef3D-Local-GPU-v1.2.6-Windows.zip`

#### Legacy／offline：SegRef3D Local CPU v1.2.6

ローカルSAM2を含まないCPU-only Windowsデスクトップ版です。対応NVIDIA GPUがなく、
Windowsデスクトップアプリを必要とする場合のlegacy／fallback版です。GPUを使わない多くの
新規ユーザーには、引き続きSegRef3D Liteを推奨します。

* **[SegRef3D Local CPU v1.2.6 Windows版をダウンロード](https://www.dropbox.com/scl/fi/05evqq67tokxvo37ixw87/SegRef3D-Local-CPU-v1.2.6-Windows.zip?rlkey=mz1kvdlkxmmffipp411xc1kux&st=nwh3k3rn&dl=1)**

ファイル：`SegRef3D-Local-CPU-v1.2.6-Windows.zip`

#### 以前のデスクトップ配布版 — v1.2.3

* [旧GPU版（`SegRef3D-GPU-v1.2.3-Windows.zip`）](https://www.dropbox.com/scl/fi/aixgd0a7lyp45tcye3x3e/SegRef3D-GPU-v1.2.3-Windows.zip?rlkey=0mgnxeb3afovi60ln4q9uo156&st=tbh8qvrf&dl=1)
* [旧Liteデスクトップ版（`SegRef3D-Lite-v1.2.3-Windows.zip`）](https://www.dropbox.com/scl/fi/2bbm6byzi3tme547e2beb/SegRef3D-Lite-v1.2.3-Windows.zip?rlkey=4u3njpty6ggm37oa04cqx12kn&st=95sqew99&dl=1)

#### **旧安定版 — ver.1.1.0**

複数の環境で動作確認済みの安定版です。

* [`SegRef3D-ver1.1.0.zip`](https://www.dropbox.com/scl/fi/sw4r6plklm5666qdy63lh/SegRef3D-ver1.1.0.zip?rlkey=e4l1tijjz3ih5mapcvq5ftl6a&st=q7cn11jk&dl=1)

#### **旧安定版 — ver.1.0.1**

以前の安定版です。

* [`SegRef3D-ver1.0.1.zip`](https://www.dropbox.com/scl/fi/1xgq28szs6by1sp1qbskw/SegRef3D.zip?rlkey=3jtwph3muk24888rpya54f222&st=ajyyhjrm&dl=1)

ダウンロード後、ZIPファイルを解凍してご利用ください。


> 📁 **ヒント:** 解凍したフォルダ（`SegRef3D.exe` と `_internal` フォルダを含む）は、  
> `C:\SegRef3D\` のようなシンプルなパスに置いてください。  
> ❗ パスが長すぎたり、日本語やスペースを含む場所（例: デスクトップやドキュメント）には置かないでください。  
> 実行時にエラーが発生する場合があります。  

---

### 2. 実行前の準備

✅ **Python や PyTorch のインストールは不要です。**  
SegRef3D を動かすのに必要なものはすべてアプリケーションに同梱されています。  

⚠️ **注意:**  
**SAM ベースのセグメンテーションとトラッキング** を使用するには、  
**CUDA 対応の NVIDIA GPU と互換ドライバ** が必要です。  

- **SegRef3D Local GPU:** ローカルSAM2を含む全機能を利用可能
- **SegRef3D Local CPU:** ローカルSAM2は無効ですが、その他のツールは利用可能

---

### 3. 実行

`SegRef3D.exe` をダブルクリックしてアプリケーションを起動してください。  
このとき、`_internal` フォルダが **必ず同じディレクトリ** に存在している必要があります。  

> ⚠️ SAM2 機能（AI セグメンテーションとトラッキング）は NVIDIA GPU と CUDA 対応ドライバが必須です。  
> 非対応環境では、関連するボタンは自動的に無効化されます。  
> ❗ `_internal` フォルダを削除しないでください。削除するとアプリケーションは起動できません。  
> 💡 **ヒント:** 初回起動時は環境の初期化のため、起動に時間がかかる場合があります。  


---

## 📘 詳細チュートリアル

詳しい操作手順はこちら：  
👉 [使用方法チュートリアル（日本語）](Tutorial/TutorialSegRef3DJP.md)

---

## 🔄 位置合わせ

連続組織切片の画像などでは、セグメンテーションや3D再構築の前に位置合わせが必要です。  
👉 [詳細なレジストレーション手順はこちらをご覧ください](Tutorial/Registration.md)

> 💡 **補足:** CTやMRI画像は撮影時にすでに整列されているため、通常は位置合わせは**不要**です。  
> 一方で、**組織の連続切片**では、物理的な歪みや切片ズレの影響により、位置合わせが必要になることがあります。

---

## 📂 入力フォーマット

* 連番画像：`.jpg`、`.png`、対応TIFF
* 医用volume：DICOM folder（`.dcm`または拡張子なし）、3D NIfTI（`.nii` / `.nii.gz`）
* mask／project：label PNG連番、SegRef3D Project ZIP。local版は旧SVG maskにも対応
* 組織連続切片はsegmentation前にregistrationが必要な場合があります：
  [詳細はこちら](Tutorial/Registration.md)

---

## 🧠 SAM2 自動セグメンテーション機能

* **Set Box Prompt** を押して範囲指定
* **Run Seg** を押してSAM2によるセグメンテーション実行
* **Set Tracking Start / End** を使ってトラッキング範囲を指定し、**Run Tracking** を押して伝播
* 必要に応じて **Run Batch Tracking** により複数オブジェクトを一括追跡

> 📌 `sam2_interface.py` は内部で `sam2pkg/sam2` の `build_sam2` モジュールを呼び出しています。

---

## ⚙️ STL／体積CSV 出力

* DICOM画像の場合は **キャリブレーション不要**
* `.jpg`, `.png` の場合：

  * **Draw Calibration Line** でスケール線を描画
  * 実際の長さ（mm）と z間隔（mm）を入力
* その後、**Export STL** または **Export Volume CSV** をクリック

---

## 🎨 マスク編集ツール

* **Add to Mask** / **Erase from Mask**：描画領域を追加／削除
* **Transfer To**：描画領域を別のオブジェクトに移動
* **Convert Color**：色ラベルを全画像にわたって変換
* **Overlap Detection**：2つのオブジェクトの重なり領域を抽出・可視化
* **Undo/Redo Edit**：編集の取り消しとやり直し
* **Mask Cleanup**：`Extensions > Mask Cleanup`から、穴埋め、小領域除去、最大領域保持、境界平滑化、膨張、収縮を現在frame・範囲・全frameへ適用
* **Interpolate Between Frames**：2つのkeyframe間へsigned-distance field補間による編集可能なmaskを生成。複数frame処理も1回のUndo/Redoで復元

---

## 🖥️ GPU非搭載環境での活用法

CUDA非対応環境でも、SegRef3D Local CPUまたはSegRef3D Liteの**Seg Anything**でobjectごとのBox Prompt、Prompt Frame、Tracking Rangeを設定し、**Create Input ZIP**で`segonweb_input.zip`を作成できます。Colabで全セルを実行してZIPを1つuploadすると、複数objectを自動処理した`segref3d_result.zip`が生成されます。**Import Result ZIP**で戻すと、そのままmask修正と3D構築へ進めます。Colab側でGradio操作は行いません。

### 🔗 Webベースのセグメンテーション手順

* 🇯🇵 日本語: [TutorialSegOnWebJP.md](https://github.com/SatoruMuro/SegRef3D/blob/main/Tutorial/TutorialSegOnWebJP.md)
* 🇺🇸 英語: [TutorialSegOnWebEN.md](https://github.com/SatoruMuro/SegRef3D/blob/main/Tutorial/TutorialSegOnWebEN.md)

### 📷 Web処理用画像の注意点

* SegRef3D LocalとSegRef3D Liteは作業画像をJPG化し、元の順序・ファイル名・寸法を`manifest.json`へ記録します
* Colabへuploadするのは、SegRef3Dが生成した`segonweb_input.zip`です
* Result ZIP読込時に画像枚数・順序・寸法・mask形式を検証し、不一致なら現在のmaskを変更しません

### 🔁 統合ワークフロー

* `segref3d_result.zip`をSegRef3D LocalまたはSegRef3D Liteへ一括で読み込み
* Result内の正本 PNG は single-channel label image です
  * `0` = background
  * `1–20` = object labels
* 読み込み後、SegRef3D 上でインタラクティブに修正・3D STL / NIfTI / CSV 出力を実施
* 旧バージョンで作成した `.svg` マスクも読み込み可能ですが、現在の推奨形式は正本 PNG マスクです
* GPU が無い場合、ローカルSAM2実行は無効ですが、Seg Anything jobの準備・入出力は利用できます

---


## Related Tool: SegRef3D Viewer

SegRef3D Viewerは、SegRef3Dから出力されたSTLファイルを確認・可視化するための、Windows用スタンドアロン3Dビューアーです。

複数のSTLファイルを読み込み、各構造を個別の色付きオブジェクトとして表示できます。表示・非表示、色、透明度の調整、断面表示、スクリーンショット保存、色付きOBJ＋MTL形式でのエクスポートに対応しています。

SegRef3D Viewerは、SegRef3Dで作成したSTLモデルの出力後確認・可視化を目的としたビューアーです。STLメッシュの編集、修復、平滑化、改変は行いません。

Repository and download:
https://github.com/SatoruMuro/SegRef3DViewer

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



## 掲載研究での活用例

SegRef3Dは、さまざまな種類の連続画像データを用いた解剖学・形態学研究において、AI支援セグメンテーションと三次元再構築に活用されています。

| 画像データ | 検体・試料 | 研究 | 活用内容 |
|---|---|---|---|
| 連続組織切片画像 | ヒト解剖体標本 | Muro et al. Why is the umbilicus concave? A histological and three-dimensional anatomical study revealing the “umbilical sheath”. *Anatomical Science International*, 2026. [https://doi.org/10.1007/s12565-026-00950-w](https://doi.org/10.1007/s12565-026-00950-w) | 臍の陥凹を支持する線維性結合組織構造の三次元再構築。 |
| 連続組織切片画像 | 動物試料 | Kakui et al. A new entoproct commensal on holothuroids in the northwestern Pacific abyssal–hadal zone. *Deep-Sea Research Part I*, 2026. [https://doi.org/10.1016/j.dsr.2026.104716](https://doi.org/10.1016/j.dsr.2026.104716) | 連続組織切片に基づく、深海性内肛動物新種の三次元再構築。 |
| CoMBIブロックフェイス画像 | ヒト解剖体標本 | Muro et al. Thin-Adipose Compartment at the Colonic Mesentery–Perirenal Fat Interface: Histological and Three-Dimensional Morphological Studies. *International Journal of Urology*, 2026. [https://doi.org/10.1111/iju.70385](https://doi.org/10.1111/iju.70385) | CoMBIにより取得した連続ブロックフェイス画像を用いた、薄い脂肪性コンパートメントのセグメンテーションと三次元再構築。 |
