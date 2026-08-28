# SegRef3D Lite 基本操作チュートリアル

このチュートリアルでは、内蔵の **Apple Demo - Kanzi 84** を使い、3つの構造をGoogle ColabのSAM2でsegmentし、SegRef3D Liteへ戻して修正・3D表示・保存するところまでを一周します。

| Object | このチュートリアルでsegmentする構造 |
| --- | --- |
| Obj 1 | Apple（リンゴ全体） |
| Obj 2 | Stem（茎） |
| Obj 3 | Core（芯） |

Pythonやsoftwareのinstallは不要です。Google ColabでAI segmentationを実行するときだけ、ユーザー自身がjob ZIPをColabへuploadします。

## 1. SegRef3D Liteを開く

[**SegRef3D Liteを開く**](https://satorumuro.github.io/SegRef3D/lite-web/)

SegRef3D Liteでは、browser上で画像確認、AI segmentationの準備、mask修正、3D reconstruction、exportまで行えます。通常の表示・編集・exportは端末内で処理されます。

![SegRef3D Lite start screen](images/SegRef3DLite/01-open-lite.png)

## 2. Apple Demoを開いてsliceを移動する

中央の`Load Apple Demo`を押します。選択画面はなく、20枚の`Apple Demo - Kanzi 84`が直接読み込まれます。

![Apple Demo loaded](images/SegRef3DLite/02-apple-demo-loaded.png)

canvas上でmouse wheelを回すとsliceを前後へ移動できます。画面下のsliderや左右buttonでも移動できます。まず複数sliceを見て、Apple、Stem、Coreが分かりやすいframeを確認してください。

## 3. Calibration

Apple Demoを読み込むと、`Image & mask tools`の`Calibration`が開き、次の値がpresetされます。

- `Reference length`: **100 mm**
- `Z spacing`: **4.0 mm (approx.)**

値を入力し直す必要はありません。`Draw Reference Line`を押し、リンゴの最も広い直径に沿って2点をclickします。1点目の後は、2点目まで補助線が表示されます。

![Apple Demo calibration](images/SegRef3DLite/03-calibration.png)

calibrationで得たX/Y spacingとZ spacingは、volume計測、NIfTI、3D Preview、STLの実寸に使われます。

> **Demoの数値について:** 100 mmはcalibration操作を学ぶために仮定したリンゴ直径で、この標本の実測値ではありません。Source datasetではslice間隔がおよそ4 mmと説明されています。

## 4. AI Tracking Setupを開く

上部の`Seg Anything`を押し、workflow画面を開きます。

![Seg Anything workflow](images/SegRef3DLite/04-ai-segmentation-workflow.png)

`Edit Setup`を押すと`AI Tracking Setup`が開きます。ここでobject名、Tracking Range、Box Promptを登録します。

![AI Tracking Setup](images/SegRef3DLite/05-ai-tracking-setup.png)

Tracking Rangeは、その構造を追跡する最初と最後のsliceです。modalを開いたまま左右button、mouse wheel、または`F`／`R`でsliceを移動し、`Use current`で現在のsliceを`Tracking start`／`Tracking end`へ設定できます。Box Promptを置くframeはTracking Range内にしてください。

> 提供スクリーンショットの一部ではdefault名の`Object 1`／`Object 2`が表示されています。このチュートリアルでは`Object name`を`Apple`／`Stem`／`Core`へ変更してください。Obj IDと表示色は変わりません。

## 5. Obj 1 = Appleを登録する

1. `Object ID`を`Obj 1`、`Object name`を`Apple`にします。
2. リンゴ全体の輪郭が明瞭なsliceへ移動します。
3. リンゴが存在する最初と最後のsliceを確認し、`Tracking start`と`Tracking end`を設定します。
4. `Add Box Prompt Here`を押します。
5. canvas上でリンゴ全体を含むboxの対角2点をclickします。
6. `Save Object`を押します。

boxは輪郭ぎりぎりにする必要はありません。対象全体が入るように囲みます。

![Apple Box Prompt](images/SegRef3DLite/06-apple-box-prompt.png)

保存後、上部の一覧にObj 1とPrompt数、Tracking Rangeが表示されます。

![Apple object saved](images/SegRef3DLite/07-apple-object-saved.png)

## 6. Obj 2 = Stemを登録する

1. `New`を押します。未使用の次のIDである`Obj 2`が選ばれます。
2. `Object name`を`Stem`にします。
3. mouse wheelまたはframe buttonで茎が見やすいsliceへ移動します。
4. 茎が存在するslice範囲を`Tracking start`／`Tracking end`へ設定します。
5. `Add Box Prompt Here`を押し、茎全体を囲みます。
6. `Save Object`を押します。

![Stem Box Prompt](images/SegRef3DLite/08-stem-box-prompt.png)

## 7. Obj 3 = Coreを登録し、3 objectsを確認する

1. もう一度`New`を押し、`Obj 3`を作ります。
2. `Object name`を`Core`にします。
3. 芯の星形が分かりやすいsliceへ移動します。
4. Coreが存在するslice範囲を設定します。
5. `Add Box Prompt Here`でCore全体を囲み、`Save Object`を押します。

![Core Box Prompt](images/SegRef3DLite/09-core-box-prompt.png)

workflow summaryが`3 objects · 3 prompts configured`になれば、Colabへ渡す準備は完了です。必要なら`Edit Setup`を再度開き、3 objectsのPromptとTracking Rangeを確認します。

![Three objects ready](images/SegRef3DLite/10-three-objects-ready.png)

## 8. Create Input ZIP

`AI Tracking Setup`を閉じ、Seg Anything workflowの`Create Input ZIP`を押します。Apple Demoでは次のfileがdownloadされます。

`Apple Demo - Kanzi 84_segonweb_input.zip`

このZIPには、20枚の作業画像と、Apple／Stem／CoreのBox Prompt・Tracking Rangeがまとめられています。作成しただけでは外部へ送信されません。

## 9. Google ColabでSeg Anythingを実行する

### 9-1. Colabを開く

`Open Seg Anything`を押します。Google Colab利用の確認画面で内容を読み、続ける場合は`Continue to Seg Anything`を押します。[Seg Anythingを直接開く](https://satorumuro.github.io/SegRef3D/ColabNotebooks/segonweb.html)こともできます。

### 9-2. GPU runtimeを選ぶ

Colabで`ランタイム` → `ランタイムのタイプを変更`を開き、hardware acceleratorに`T4 GPU`を選んで保存します。T4以外の割り当て済みNVIDIA GPUでも動作できます。

### 9-3. 全cellを実行してInput ZIPをuploadする

`ランタイム` → `すべてのセルを実行`を選びます。最初の実行cellにfile upload欄が表示されたら、先ほどの`*_segonweb_input.zip`を選びます。

![Upload the Seg Anything input ZIP in Colab](images/SegRef3DLite/11-colab-upload.png)

notebookはSAM2を準備し、3 objectsを順番にtrackingします。通常は数分程度ですが、Colabの混雑状況、割り当てGPU、runtimeによって変わります。処理中はnotebookを閉じないでください。

処理が完了すると`Segmentation complete`と表示され、最後のcellから`segref3d_result.zip`のdownloadが自動的に始まります。始まらない場合は最後のdownload cellだけを再実行します。

> **Data handling:** 通常のSegRef3D Lite操作は端末内で行われますが、Seg Anythingでは作業画像を含むInput ZIPをユーザー自身のGoogle Colab runtimeへuploadします。研究・医療データでは、所属施設のdata handling policyでGoogle Colabの利用が許可されていることを確認してください。画像がSegRef3D運営serverへ送信されるworkflowではありません。

## 10. AI Resultを戻してmaskを修正する

### 10-1. Result ZIPをimportする

SegRef3D Liteへ戻り、Seg Anything workflowの`Import AI Result`を押して`segref3d_result.zip`を選びます。既存maskがある場合は、現在のlabel masksを置き換えるか確認されます。

![Import AI Result](images/SegRef3DLite/12-import-ai-result.png)

import後は、Apple、Stem、Coreのmaskとobject名がObjects panelへ反映されます。

### 10-2. Addで不足部分を補う

1. `Draw & Refine`を開きます。
2. Objects panelで修正するobjectを選びます。
3. draw modeを`Click`にします。
4. `Auto`を`Add`にします。
5. 左clickで追加領域を囲み、最後の点を右clickします。

右clickした点が終点となって始点へ結ばれ、囲んだ領域が現在のsliceのmaskへ追加されます。

| Addする範囲を指定 | Add後 |
| --- | --- |
| ![Outline an Add region](images/SegRef3DLite/13-ai-result-add-outline.png) | ![Add completed](images/SegRef3DLite/14-refine-add-complete.png) |

### 10-3. Eraseではみ出しを削る

`Auto`を`Erase`へ変更し、削除したい領域を左clickで囲み、最後の点を右clickします。囲んだ領域が現在のsliceのmaskから削除されます。

| Eraseする範囲を指定 | Erase後 |
| --- | --- |
| ![Outline an Erase region](images/SegRef3DLite/15-refine-erase-outline.png) | ![Erase completed](images/SegRef3DLite/16-refine-erase-complete.png) |

AI segmentationで大部分を作り、研究者が必要な部分だけ確認・修正するのがSegRef3Dの基本workflowです。

### 10-4. Objectを切り替える

Objects panelで`Obj 1: Apple`、`Obj 2: Stem`、`Obj 3: Core`を選ぶと、編集対象を切り替えられます。左端のcheckboxは表示／非表示です。複数objectを同じ画像系列上で独立して確認・修正できます。

![Switch editing objects](images/SegRef3DLite/17-object-switching.png)

## 11. どの形式を保存するか

| 目的 | 出力 |
| --- | --- |
| 複数objectを3D surfaceとして使用 | `STL` |
| 後日SegRef3D Liteで作業を再開 | `Project ZIP` |
| 3D Slicer等へlabel volumeとして渡す | `NIfTI Labelmap` |
| mask画像を保存 | `Label PNG`または`TIFF` |
| object volumeを表で保存 | `Volume Statistics CSV` |

### 11-1. Apple／Stem／Coreを3D Previewする

1. Objects panelでApple、Stem、CoreのvisibilityをONにします。
2. `Image & mask tools`の`Volume & 3D`を開きます。
3. STL sectionの`Slice interpolation`を`5x`にします。
4. `Objects`を`Visible objects`にします。
5. `Preview 3D`を押します。

![Choose Visible objects for 3D](images/SegRef3DLite/18-volume-3d-visible-objects.png)

3D Previewでは、mouse dragで回転、mouse wheelでzoomできます。右側のsliderはobjectごとのopacityです。Appleを半透明にすると、StemとCoreの位置関係を確認しやすくなります。

![Apple, Stem, and Core in 3D](images/SegRef3DLite/19-three-objects-3d.png)

### 11-2. STLをexportする

Previewを閉じ、`Objects = Visible objects`のまま`Export STL`を押します。

![Export STL](images/SegRef3DLite/20-export-stl.png)

複数objectでは、`Apple Demo - Kanzi 84_STL_5x_<timestamp>.zip`がdownloadされます。ZIP内にはObj 1、Obj 2、Obj 3のSTLが別fileとして入ります。STLは3D viewer、CAD、3D printing workflow等で使えるsurface model形式です。

### 11-3. 最後にProject ZIPを保存する

上部の`Export` → `Project ZIP`を選びます。

![Export Project ZIP](images/SegRef3DLite/21-project-zip.png)

`Apple Demo - Kanzi 84_SegRef3D_Project_<timestamp>.zip`にはlabel masks、calibration、object名、表示設定、Seg Anything setupが保存されます。Source images自体は含まれません。

再開するときは、先に`Load Apple Demo`で同じ画像を読み込み、`Load Masks` → `Replace` → `ZIP / Project ZIP`で保存済みZIPを開きます。browser autosaveだけに頼らず、**作業の最後にProject ZIPを保存してください。**

## 12. その他の便利な機能

SegRef3D Liteには、Threshold／RGB extraction、Mask Cleanup、mask interpolation、NIfTI Labelmap、TIFF、Label PNG、Overlay PNG、Volume Statistics CSVなどもあります。このGetting Started tutorialではAI workflowを中心に扱いました。詳細は[SegRef3D Lite documentation](../lite-web/README.md)と[Seg Anything詳細guide](TutorialSegOnWebJP.md)を参照してください。

## 13. このチュートリアルで行ったこと

- Apple Demoの連続画像を読み込んだ
- 画像scaleとZ spacingをcalibrationした
- Apple、Stem、Coreを別objectとしてBox Promptで指定した
- Google Colab GPUでSAM2 segmentationを実行した
- AI masksをSegRef3D Liteへ戻した
- Add／Eraseでmaskを修正した
- 3 objectsを切り替えて確認した
- Apple／Stem／Coreを同時に3D表示した
- object別STLをexportした
- Project ZIPを保存した

これで、**対象指定 → AI segmentation → human refinement → quantitative 3D output**というSegRef3D Liteの基本workflowを一周しました。

## 14. Demo data

Apple Demo images are adapted from: Schut DE, Trull AK, Couvée M. *Dataset of CT scans, slice photographs, and visual browning scores of 120 'Kanzi' apples.* Zenodo. [https://doi.org/10.5281/zenodo.8167285](https://doi.org/10.5281/zenodo.8167285)

Source dataset license: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Images were selected, cropped, resized to 1000 × 944 pixels, and JPEG-compressed for the SegRef3D demo. The original data providers do not endorse SegRef3D.

---

[English version](TutorialSegRef3DLiteEN.md) · [Seg Anything詳細guide](TutorialSegOnWebJP.md) · [Registration](Registration.md)
