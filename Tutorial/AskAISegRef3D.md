# Ask AI about your SegRef3D workflow

Use this guide when you are unsure which SegRef3D edition or workflow fits your images, goal, computer, and data-handling requirements.

You can use the prompt below with [ChatGPT](https://chatgpt.com/),
[Gemini](https://gemini.google.com/), [Claude](https://claude.ai/), or
[Perplexity](https://www.perplexity.ai/). The links open the services without sending any SegRef3D
data automatically.

## Before you begin

- Describe your data and requirements in words.
- Do not paste identifiable patient information, confidential research images, credentials, or
  unpublished data into a third-party AI service.
- Check your institution's rules before using an external AI service or Google Colab.
- AI guidance is a starting point. Verify image order, spacing, masks, measurements, and exports
  against your source data.

## Copy this prompt

```text
Help me choose a SegRef3D workflow. Use only the official SegRef3D information at:
https://satorumuro.github.io/SegRef3D/llms.txt
https://satorumuro.github.io/SegRef3D/llms-full.txt
https://github.com/SatoruMuro/SegRef3D

Before recommending anything, ask me a short set of questions covering:
1. Imaging modality or image type.
2. File format.
3. Whether the data are ordered serial 2D images or an existing 3D volume.
4. Whether pixel/voxel spacing and slice spacing are known and reliable.
5. My goal: segmentation, mask refinement, volume measurement, 3D reconstruction,
   STL/NIfTI/TIFF/PNG/CSV export, or transfer to software such as 3D Slicer.
6. My operating system, browser, NVIDIA GPU availability, and approximate data size.
7. Whether processing must remain on my device and whether Google Colab or another
   third-party service is permitted.

After I answer, recommend:
- the appropriate SegRef3D edition;
- any required preparation such as registration or calibration;
- a numbered quick-start workflow;
- the safest relevant segmentation route;
- the appropriate export format;
- important validation and data-handling cautions.

Clearly distinguish normal SegRef3D Lite browser-local processing, SegRef3D Local GPU,
SegRef3D Local CPU, and the explicit Google Colab upload used by Seg Anything or Seg CT/MRI.
Do not invent features, do not assume clinical validation, and do not ask me to upload or paste
research images or identifiable patient data. Ask for descriptions and metadata only.
```

## Information that helps the consultation

```text
Image type or modality:
File format:
Number of images or volume dimensions:
Serial 2D images or 3D volume:
Pixel/voxel spacing:
Slice spacing or thickness:
Main goal:
Existing masks:
Operating system:
NVIDIA GPU:
Approximate data size:
Must processing remain local?:
Is Google Colab permitted?:
Desired output:
```

## Official references

- [Short AI-readable overview](../llms.txt)
- [Detailed AI-readable knowledge base](../llms-full.txt)
- [SegRef3D Lite basic tutorial](TutorialSegRef3DLiteEN.md)
- [Registration guidance](Registration.md)
- [Seg Anything tutorial](TutorialSegOnWebEN.md)
- [SegRef3D repository README](../README.md)

---

# AIにSegRef3Dの使い方を相談する

画像の種類、目的、PC環境、データ取扱条件に合うSegRef3Dの使い方が分からない場合に利用してください。
AIサービスを開くだけではSegRef3Dのデータは送信されません。下のプロンプトをコピーし、条件を文章で
回答します。

## 事前の注意

- 患者識別情報、機密の研究画像、認証情報、未公開データそのものを第三者のAIサービスへ貼り付けないでください。
- 外部AIサービスやGoogle Colabを利用できるか、所属機関の規定を確認してください。
- AIの案内は出発点です。画像順、spacing、mask、計測値、出力結果は元データと照合してください。

## 日本語プロンプト

```text
私のデータに合うSegRef3Dのworkflowを案内してください。次のSegRef3D公式情報だけを根拠にしてください。
https://satorumuro.github.io/SegRef3D/llms.txt
https://satorumuro.github.io/SegRef3D/llms-full.txt
https://github.com/SatoruMuro/SegRef3D

提案の前に、次の条件を確認する短い質問をしてください。
1. 画像種またはmodality
2. file format
3. ordered serial 2D imagesか、既存の3D volumeか
4. pixel/voxel spacingとslice spacingが既知で信頼できるか
5. 目的（segmentation、mask修正、体積計測、3D再構築、STL/NIfTI/TIFF/PNG/CSV出力、3D Slicer等への移行）
6. OS、browser、NVIDIA GPUの有無、おおよそのデータサイズ
7. 端末内処理が必須か、Google Colab等の第三者サービスを利用できるか

回答後、適切なSegRef3Dの版、registrationやcalibration等の前処理、番号付きquick start、
適切なsegmentation方法、推奨export形式、検証上・データ取扱上の注意を提案してください。

通常のSegRef3D Liteのbrowser-local処理、SegRef3D Local GPU、SegRef3D Local CPU、
Seg Anything／Seg CT/MRIでユーザーが明示的に行うGoogle Colab uploadを区別してください。
未実装機能を推測せず、臨床的妥当性を仮定せず、研究画像や患者識別情報のuploadを求めないでください。
画像そのものではなく、説明とmetadataだけを質問してください。
```
