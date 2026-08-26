# Seg Anything：SegRef3D Job ワークフロー

Seg Anythingは、Google ColabのGPUを計算backendとして利用します。Box Prompt、Prompt Frame、Tracking Rangeの設定はすべてSegRef3Dで行い、別のGradio画面は使用しません。

## 1. SegRef3Dでobjectを設定

1. SegRef3D GPU版またはLite版で画像系列を読み込みます。
2. **Target Object**でobject IDを選びます。
3. 対象が明瞭な画像へ移動し、**Set Box Prompt**を押します。
4. 対象を囲むboxを描きます。この画像がPrompt Frameになります。
5. 追跡を始める画像で**Set Tracking Start**を押します。
6. 追跡を終える画像で**Set Tracking End**を押します。
7. **Add Object Prompt**を押します。
8. 複数objectがある場合は同じ操作を繰り返します。

**Extensions > Batch Tracking > Batch Jobs**では、object名、Prompt Frame、Tracking Range、box座標を一覧で確認・編集・削除できます。Prompt FrameはTracking Rangeの内側に設定してください。

## 2. Job ZIPを出力

**AI Segmentation > Seg Anything**から**Create Input ZIP**を押し、`segonweb_input.zip`を保存します。ZIPには作業用JPG画像系列と`manifest.json`が入ります。

## 3. Seg Anythingを実行

1. SegRef3Dの**Seg Anything**を押すか、[Seg Anything](https://satorumuro.github.io/SegRef3D/ColabNotebooks/segonweb.html)を開きます。
2. Colabで**ランタイム > ランタイムのタイプを変更 > T4 GPU > 保存**を選びます。
3. **ランタイム > すべてのセルを実行**を選びます。
4. upload欄が表示されたら`segonweb_input.zip`を選びます。
5. 各objectのforward/backward trackingが終わるまでnotebookを開いたまま待ちます。
6. **Segmentation complete**になると、独立した最後のcellから`segref3d_result.zip`のdownloadがbrowserで自動的に始まります。

処理中は、現在のstep、object、frame、全体進捗が表示されます。

## 4. 結果ZIPを読み込み

1. SegRef3Dへ戻ります。
2. **AI Segmentation > Seg Anything > Import Result ZIP**を押します。
3. `segref3d_result.zip`を選びます。
4. 既にlabel maskがある場合は、置換確認に同意します。

SegRef3Dは画像系列とmaskを検証してから反映します。画像を開いていない場合は、result ZIP内のJPG系列も自動復元します。読み込んだmaskは新しい`[autosave]` label PNGフォルダへ直ちに保存されます。

### Lite Webでの操作

ブラウザ版も同じmanifest/ZIP形式を使用します。**Batch Jobs**を開いたままmouse wheelまたはF/Rで画像を移動し、**Use current**で現在画像をTracking Start/Endとして取り込みます。**Set Box on Canvas**ではcrosshair補助線を使ってBox Promptを設定できます。**Create Input ZIP**で出力し、Colabの結果を**Import Result**で復元します。jobの準備にはローカルSAM2やNVIDIA GPUは不要です。

## 5. 修正と3D構築

読み込み後は通常のSegRef3Dと同じように、Add、Erase、Transfer、label変更、補間、計測、NIfTI、TIFF、STL、overlay PNG、volume CSV出力を利用できます。

mask PNGはsingle-channel label imageです。`0`が背景、`1`から`20`がobject IDです。

## トラブルシューティング

- ZIP不正、manifestなし：SegRef3Dからjob ZIPを再出力してください。
- Prompt Frameが範囲外：**Batch Jobs**でTracking Rangeを修正してください。
- CUDA/model error：ColabがT4などのGPU runtimeになっていることを確認し、**ランタイム > ランタイムを接続解除して削除**の後に全セルを再実行してください。
- 処理中断：全セルを再実行し、先頭の実行cellで同じinput ZIPをuploadした後、残りのcellが終わるまでnotebookを開いたままにしてください。
- downloadが始まらない：最後のdownload cellだけを再実行してください。localhostへのlinkではなく、Colab標準の`files.download()`を使用します。
