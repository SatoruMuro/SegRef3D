# SliceBridge 使用方法

**SliceBridge**は、SegRef3Dから出力したNIfTIラベルマップの輪郭間に
空白スライスを挿入し、3D Slicerの **Fill between slices** で補間できる
基準スライスデータを作成するWebアプリです。

## 🌉 SliceBridgeを開く

👉 **[SegRef3D SliceBridge](https://satorumuro.github.io/SegRef3D/slice-bridge/)**

ファイルはサーバーへアップロードされません。読み込み、変換、圧縮、
ダウンロードまで、すべて使用中のブラウザ内で処理されます。

---

## このツールが行うこと

たとえば、元のNIfTIが次の条件だったとします。

- 画像サイズ：`896 × 896 × 22`
- Z spacing：`6.5 mm`
- 細分化倍率：`10`

SliceBridgeで変換すると、以下のNIfTIが作成されます。

- 画像サイズ：`896 × 896 × 211`
- Z spacing：`0.65 mm`
- 元の輪郭：Z方向の0、10、20……番目のスライスにそのまま配置
- その間の9スライス：空白

元データのラベル値、原点、向き、実寸範囲は保持されます。

> SliceBridge自体は形状を補間しません。
>
> 空白スライスを用意した後、3D Slicerで補間を実行します。

---

## 推奨環境

- WindowsまたはmacOSの最新版Google Chrome／Microsoft Edge
- NIfTI-1形式の3次元整数ラベルマップ
- 対応拡張子：`.nii`、`.nii.gz`

---

## 1. SegRef3DからNIfTIを出力する

SegRef3Dでセグメンテーションを確認・修正した後、
`Export NIfTI`からラベルマップを出力します。

上下方向を反転したデータが必要な場合は、SegRef3D側で
`Export NIfTI (Reversed)`を使用してください。SliceBridgeは、読み込んだ
NIfTIの向きと原点を維持したまま変換します。

---

## 2. NIfTIをSliceBridgeへ読み込む

1. [SliceBridge](https://satorumuro.github.io/SegRef3D/slice-bridge/)を開きます。
2. `.nii`または`.nii.gz`を画面へドラッグ＆ドロップします。
3. 表示された画像サイズ、Voxel spacing、データ型、ラベル値を確認します。

---

## 3. 空白スライスを設定する

### スライス方向

通常は`自動判定`のままで構いません。X・Y・Zのうち、Voxel spacingが
最も大きい方向が自動的に選択されます。必要な場合は、X軸、Y軸、Z軸を
手動で指定できます。

### 細分化倍率

元の1スライス間隔を何分割するか指定します。

- `10`を指定：元の輪郭間に9枚の空白スライスを挿入
- 変換後のspacing：元のspacing ÷ 10

設定欄に表示される変換後のspacing、画像サイズ、推定データ量を確認します。

---

## 4. Anchor NIfTIを作成する

1. `Anchor NIfTIを作成`を押します。
2. 進捗が100%になるまで待ちます。
3. `ダウンロード`を押して、作成された`.nii.gz`を保存します。

出力ファイル名の例：

```text
segref3d_labelmap_anchor_z0p65mm.nii.gz
```

---

## 5. 3D Slicerで補間する

### 5-1. NIfTIを読み込む

1. 3D Slicerの`Add data`を開きます。
2. SliceBridgeからダウンロードした`.nii.gz`を選びます。
3. `Description`を`Volume`にして読み込みます。

### 5-2. Segmentationへ変換する

`Segmentations`モジュールで、読み込んだlabelmapをSegmentationへ
インポートします。

### 5-3. セグメントの重なりを許可する

`Segment Editor`で、以下を設定します。

```text
Modify other segments → Allow overlap
```

骨盤骨、内閉鎖筋、肛門挙筋など、複数の構造を同時に扱う場合に重要です。

### 5-4. Fill between slicesを実行する

1. 補間するセグメントを選択します。
2. `Fill between slices`を選択します。
3. `Initialize`で補間結果を確認します。
4. 問題がなければ`Apply`を押します。
5. 複数のセグメントがある場合は、各セグメントで繰り返します。

---

## 使用上の注意

- SliceBridgeは元の基準輪郭を変更しません。
- 補間結果は、必ず元画像の各断面と3D表示の両方で確認してください。
- 補間で不自然な形状が生じる部分は、3D SlicerのSegment Editorで修正します。
- ブラウザのタブを閉じると、読み込んだデータと変換結果はブラウザから破棄されます。
- 大容量データでは、変換中に数百MB以上のメモリを使用する場合があります。

---

## 対応していないデータ

- NIfTI-2
- `.hdr`と`.img`に分かれた2ファイル形式
- 4次元以上のNIfTI
- 浮動小数点型のラベルマップ

これらの場合は、3D Slicerなどで3次元のNIfTI-1整数ラベルマップへ変換してから
使用してください。

---

## 関連リンク

- [SegRef3D GitHubリポジトリ](https://github.com/SatoruMuro/SegRef3D)
- [SliceBridgeソースコード](https://github.com/SatoruMuro/SegRef3D/tree/main/slice-bridge)
