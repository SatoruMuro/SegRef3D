# SegRef3D

**連続画像から、定量可能な3Dデータへ。**

SegRef3Dは、連続画像や3D volumeから、構造のsegmentation、mask修正、校正済み体積の計測、
3Dモデルの再構築を行う研究者向けオープンソースplatformです。

[**SegRef3D Liteを開く**][lite] · [**Local GPU v1.3.0をダウンロード**][gpu-download] ·
[基本操作](Tutorial/TutorialSegRef3DLiteJP.md) · [AIに相談](Tutorial/AskAISegRef3D.md) ·
[English](README.md)

<img src="images/SegRef3D-v1.2.0-GUI.png" alt="SegRef3D desktop interface" width="100%">

## どんな画像を持っていますか？

| データ | SegRef3Dでできること |
| --- | --- |
| 連続組織切片／光学顕微鏡画像 | 構造をsegmentし、maskを修正し、体積計測と3D再構築へ進めます。 |
| 連続電子顕微鏡画像 | 順序付けられた画像stack上で構造をsegmentし、定量・再構築できます。 |
| CT／MRI | volumeを読み込み、構造のsegmentation／修正、体積計測、3D出力ができます。 |
| Micro-CT | 既知のvoxel spacingを用いて定量的なsegmentation、計測、3D再構築ができます。 |
| Visible Human／解剖学的画像stack | 順序付けられた画像から解剖構造をsegmentし、定量3Dデータを作れます。 |
| 既存mask／AI segmentation | maskを読み込み、修正し、計測・出力できます。 |

物理的な連続切片は、定量3D解析の前に[registration](Tutorial/Registration.md)が必要な場合があります。
実寸計測には、信頼できるpixel/voxel spacingとslice spacingが必要です。

## 何をしたいですか？

- 連続画像やvolume内の構造を**segment**する
- 既存またはAI生成segmentationを**修正**する
- 校正されたobject体積を**計測**する
- 構造を**3D再構築**して確認する
- mask、label volume、計測値、surface modelを外部解析用に**出力**する

## SegRef3Dを使う理由

### 画像stackとvolumeの両方に対応

連続組織切片、顕微鏡、CT/MRI、micro-CT、その他の連番画像や対応3D volumeを、
**segment → refine → quantify → 3D**という一貫したworkflowで扱えます。

### Human in the loop

**AI segmentation → 研究者による修正 → 定量出力**を中心に設計されています。自動処理の結果を、
計測や3D化の前に確認・修正できます。

### Quantitative 3D

校正済みspacingと確認済みmaskを、体積統計、NIfTI labelmap、TIFF stack、STL surface modelへ
つなげられます。

mask PNGの保存順は表示中のcanonical volume順です。volume z=0は`mask0001.png`、
volume z=N-1は`maskNNNN.png`となります。新しくSegRef3Dが保存するmask setには、
`segref3d-canonical-v1`を宣言する`segref3d-mask-manifest.json`が含まれます。

Liteの`Training Data ZIP`では、geometryを一致させた画像channel、Obj IDを保持するlabelmap、
versioned manifestを1症例分としてbrowser内で保存できます。
[TrainRef3D](train-web/README.md)では複数のTraining ZIPをbrowser内でまとめ、対象Objを1つ選び、
自分のColab GPUでbinary custom modelを学習できます。Liteはmask作成、TrainRef3Dは症例集約と
学習を担当します。研究用baselineであり、臨床性能を保証するものではありません。

### Local first

通常のSegRef3D Liteの編集、計測、exportはbrowser内で処理されます。任意のColab AI workflowでは、
ユーザーがjobを明示的に送信した場合だけデータがuploadされます。研究・医用データを扱う場合は、
所属機関のpolicyを確認してください。

AI支援segmentationは、ローカルまたは任意のColab workflowで利用できます。結果は定量解析や3D出力の
前にSegRef3Dで修正できます。

## 使用するSegRef3Dを選ぶ

| 版 | 適している環境 | 開始 |
| --- | --- | --- |
| **SegRef3D Lite** | 大多数のユーザー；Windows／macOS／Linux；install不要 | [**browserで開く**][lite] |
| **SegRef3D Local GPU v1.3.0** | Windows + 対応NVIDIA CUDA GPU；ローカルSAM2 | [**ZIPをダウンロード**][gpu-download] |
| **SegRef3D Local CPU v1.2.6** | Windows CPU-only／offline desktopのlegacy workflow | [**ZIPをダウンロード**][cpu-download] |

Windows desktop版が必要でなければ、まず**SegRef3D Lite**を使用してください。同梱SAM2をローカル実行
する場合はLocal GPUを選びます。Local CPUはローカルSAM2を含まないlegacy／fallback版です。

Local GPU v1.3.0では、Local SAM2によるBox Prompt segmentationとmulti-frame trackingを利用できます。
PyTorch 2.11.0+cu128（CUDA 12.8）を採用し、RTX 50-series／Blackwell `sm_120`に対応しています。
RTX 5080 Laptop GPUで実機確認済みですが、動作には対応NVIDIA GPUが必要です。

Local v1.3.0は、Interpolate Between Frames、slice補間1x／5x／10xを使うPreview 3D・STL export、
PNG／legacy SVG mask import、Label PNG／colored SVG mask export、session単位のautosave storageにも対応します。

Local版はZIP全体を展開して`SegRef3D.exe`を実行します。driver、folder、初回起動の注意は
[Local版インストールガイド](Tutorial/LocalInstallation.md)を参照してください。

## AIにworkflowを相談する

迷った場合は、AIに**持っている画像 → 達成したいこと → PC環境**を伝えると、SegRef3D公式文書に
基づくworkflow案内を受けられます。

[**公式promptを使ってChatGPT／Gemini／Claude／Perplexityに相談する**](Tutorial/AskAISegRef3D.md)

条件と機密性のないmetadataだけを説明し、研究機密画像や患者識別情報を第三者AI serviceへ貼り付けないでください。

## Tutorials

| やりたいこと | Guide |
| --- | --- |
| SegRef3D Liteを初めて使う | [基本操作チュートリアル](Tutorial/TutorialSegRef3DLiteJP.md) |
| 基本workflowを動画で見る | [操作紹介動画](https://youtu.be/JModwfnBTYU) |
| desktop版の全体workflowを学ぶ | [SegRef3D詳細チュートリアル](Tutorial/TutorialSegRef3DJP.md) |
| 連続組織切片を扱う | [Registration／連続切片guide](Tutorial/Registration.md) |
| 任意構造をAIでsegmentする | [Seg Anythingチュートリアル](Tutorial/TutorialSegOnWebJP.md) |
| 対応CT/MRI解剖構造をsegmentする | [Seg CT/MRI workflow](lite-web/README.md#seg-ctmri-workflow) |
| NIfTI／TIFF／STL／CSV出力を選ぶ | [Lite出力チュートリアル](Tutorial/TutorialSegRef3DLiteJP.md#11-どの形式を保存するか) |
| Windows Local版をinstallする | [Local版インストールガイド](Tutorial/LocalInstallation.md) |

[変更履歴](CHANGELOG.md) · [旧版ダウンロード](Tutorial/LegacyDownloads.md) ·
[AI向け詳細文書](llms.txt)

## 関連ツール

- [**SliceBridge**](https://satorumuro.github.io/SegRef3D/slice-bridge/)は、3D Slicerの**Fill between slices**で補間するためのNIfTI基準sliceを作成します。[使い方](Tutorial/SliceBridgeJP.md)
- [**SegRef3D Viewer**](https://github.com/SatoruMuro/SegRef3DViewer)は、SegRef3Dから出力した複数STL構造を確認するWindows viewerです。

## 引用とライセンス

研究でSegRef3Dを使用する場合は、以下を引用してください。

1. Muro S, Ibara T, Nimura A, Akita K. **SegRef3D: A Versatile Open-Source Platform for Artificial Intelligence-Assisted Segmentation and Three-Dimensional Reconstruction in Morphological Research.** *Int J Imaging Syst Technol.* 2026;36(2):e70313. [DOI](https://doi.org/10.1002/ima.70313)
2. Muro S, Ibara T, Nimura A, Akita K. **Seg and Ref: A Newly Developed Toolset for Artificial Intelligence-Powered Segmentation and Interactive Refinement for Labor-Saving Three-Dimensional Reconstruction.** *Microscopy (Oxford).* 2025. [DOI](https://doi.org/10.1093/jmicro/dfaf015)

[BibTeXと掲載研究での活用例](CITATION.md)

SegRef3Dは[Satoru Muro](https://github.com/SatoruMuro)が開発し、
[Apache License 2.0](LICENSE)で公開しています。

[lite]: https://satorumuro.github.io/SegRef3D/lite-web/
[gpu-download]: https://www.dropbox.com/scl/fi/ktsn1ljcuvj75c334kbnp/SegRef3D-Local-GPU-v1.3.0-Windows_FIXED.zip?rlkey=vn5d4j6u0glagk7xgoqfw93ox&st=p5ivqyca&dl=1
[cpu-download]: https://www.dropbox.com/scl/fi/05evqq67tokxvo37ixw87/SegRef3D-Local-CPU-v1.2.6-Windows.zip?rlkey=mz1kvdlkxmmffipp411xc1kux&st=nwh3k3rn&dl=1
