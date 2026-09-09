# Draw／Auto Erase／Box Promptの修正記録

2026-09-09、mainの `09fa96b6b1f0c5b228ed231804998a9b9034d9b0` から作業ブランチ `fix/qt-item-lifecycle-windows-signing` を作成した。修正前ソースで報告された2経路の例外を再現し、アイテム所有権と操作状態を修正した。Qt例外を捕捉して処理を続行する修正は追加していない。

## 1. クラッシュの根本原因

`QGraphicsScene.clear()` はscene内のアイテムをC++側で削除するが、Python側のメンバ参照は自動的にNoneにならない。元コードは描画中のitem、preview、Box Promptのcrosshair、測定用仮線を保持したままsceneを消していた。`item.scene()` 自体も削除済みwrapperでは呼べない。[Qtの所有権とclear/removeItem](https://doc.qt.io/qt-6/qgraphicsscene.html)

症例Aでは、`finalize_click_drawing → save_drawn_path → auto_erase_latest_path_current_image → display_current_image → scene.clear` の同期コールバック内でpreviewが削除される。戻った `finalize_click_drawing` がそのpreviewを `removeItem` しようとして例外になった。元コードのfree描画も完了後のitem参照を保持し続けていた。

症例Bでは、`start_box_prompt_mode` 後にMouseMoveがcrosshairを生成する。スライス移動やmaskの再表示でsceneが消えた後、次のMouseMoveで `eventFilter` が古いcrosshairを再参照する。旧ソースで、症例Aは実際のmask autosaveの直後、症例BはBox Prompt表示・画像再表示の後に、同じ `wrapped C/C++ object of type QGraphicsPathItem has been deleted` を再現した。

## 2. 修正したファイルと関数

`graphics_lifecycle.py` に `EditorGraphicsScene.clear` と `release_item` を追加した。アプリはPySide6ではなくPyQt6のため、有効性確認には `PyQt6.sip.isdeleted` を使う。

`SegRef3D.py` の主な変更は次のとおり。

- `CustomGraphicsView`: `__init__`、`reset_interaction`、`_commit_drawing`、`mousePressEvent`、`mouseMoveEvent`、`mouseReleaseEvent`、`finalize_click_drawing`、`undo_last_click_point`。
- `SegRefMain`: `__init__`、`_reset_scene_interaction`、`reset_editor_interaction`、`change_draw_mode`、`start_box_prompt_mode`、`clear_box`、`display_current_image`、`eventFilter`。校正・測定モードの開始にも共通resetを使う。
- `run_sam2_segmentation`、`run_tracking`、`run_batch_tracking`、`hide_confirmed_box` 内の変更は、表示用boxの削除を共通helperへ置き換えた部分のみ。
- CLIに `--vtk-check` を追加し、起動だけでは見逃すVTK import失敗をリリース工程で検出する。

## 3. 変更後のlifecycle

| 対象 | 作成と所有 | 終了時の処理 |
|---|---|---|
| 描画中のpath item | Viewが生成しsceneへ追加。Viewは操作中だけ参照 | 確定時にpathを値コピーし、item参照を解除。キャンセル時はhelperで削除 |
| hover preview | ViewがMouseMoveで生成、sceneが所有 | 次の点、確定、モード切替、scene clear前に参照解除・削除 |
| 確定済み描画 | 表示はscene、保存用の `QPainterPath` は `drawn_paths_per_image` が保持 | sceneから再描画可能。使われていなかった `view.paths` のwrapper蓄積を廃止 |
| 仮box・crosshair・校正／測定仮線 | Mainが生成しsceneへ追加 | 共通resetで参照をNoneにしてからremove・delete |
| 確定box | sceneが所有。Mainは表示中の1個を参照 | clear前に参照解除。`box_per_frame` の座標から再生成し、新しいitemを参照 |

`release_item` はメンバを先にNoneにし、有効なitemだけをsceneから外して `sip.delete` する。`removeItem` だけではC++オブジェクトは削除されないため、所有者のいない一時itemを残さない。有効性のチェックはこの破棄境界に集約した。

sceneはViewをQt親として作成する。Mainは同じsceneを使用し、`about_to_clear` によってViewとMainの参照・未確定点・drag状態をC++側の一括削除より先に初期化する。通常の `scene.clear()` 直接呼び出しもこの経路を通る。

モード切替は未確定の描画をキャンセルする。確定済み描画、mask、確定box座標は保持する。スライス移動時にクリック描画を確定する既存動作も維持する。Box Prompt中にsceneが再表示されると、選択ツールを保ちつつ未確定の点を取り直す。eventFilterのクリック処理はviewportからの入力に限定する。

## 4. 症例AとBの解消

症例Aは、描画確定・プレビュー削除・状態解除を保存コールバックより前に完了させることで解消する。mask計算には独立した `QPainterPath` を渡すので、コールバック内のrasterize・mask更新・autosave・scene再表示がitemの寿命に依存しない。保存完了後に古いitemを触る処理もなくなる。

症例Bは、scene破棄前にcrosshair、仮線、仮boxの参照と点列を解除することで解消する。次のMouseMoveでは新しい状態から必要なitemを生成する。確定boxの再描画後にも、新しいwrapperへ参照を更新する。

## 5. 回帰テスト

追加した `tests/test_graphics_lifecycle_ui.py` の6テストは、実際のPyQt6 scene/itemとQMouseEventを使う。mask処理・PNG autosave・Undo/Redoは実装を実行し、保存PNGの画素も比較する。

- Drawの連続、Drawから手動Erase、Draw／Auto Eraseの往復、Auto Eraseの連続。
- Auto EraseからBox Prompt、Box PromptからDraw／Auto Erase、クリック／スナップ／free描画の途中の切替と遅れて届くrelease。
- 3スライスで48回のAuto Erase・Undo・Redo・autosave。Object IDあり／なしを交互に検証。
- 同一スライスで33回の連続描画、手動Erase、Auto Add。既存のOddEvenFillの動作も保持。
- 同期保存中のscene clearと再度のfinalize、scene clear後の全参照解除、確定boxの保持／再描画／クリア。

修正前の再現試験は `build/verification/baseline.log`、修正後の実importによる試験は `lifecycle-real-imports.log` に記録した。既存テストを含む125件も、GPU用Python環境で全件成功した（`all-tests-real-imports.log`）。テストではSAM2推論を無効にしている。最初の一括試験はVTK importをテスト側で無効化したが、その後VTKを無効化しない実行でも125件の成功を確認した。

## 6. 既存機能への影響

SAM2／GPU推論の実装ファイル、DICOM geometry実装、UIレイアウトは変更していない。AST比較でも `rasterize_path_to_binary`、`auto_erase_latest_path_current_image`、`save_drawn_path`、`save_label_mask_png`、`_apply_pending_paths_to_masks` は変更前と同一である。mask形式・autosave形式・object IDの意味を変更していない。

既存テストにはDICOM由来の座標・スライス順序、labelmap export、session復元、mask後処理、STL生成等を含む。ただし、共同研究者の実データや実GPUでのSAM2推論を検証したことにはならない。

## 7. Windowsビルドと署名設計

現行の `build_windows_gpu.bat` はPython 3.12系、PyInstaller one-folder／console方式。specはCLIから生成され、Git管理対象外。`_internal` にPyQt6（PySide6ではない）、VTK、Torch／torchvision／torchaudio、CUDA関連DLL、NumPy／SciPy／OpenCV／GDCM／SimpleITK等のネイティブ依存とFFmpegを収集する。Torchは2.11.0+cu128、Qtは6.9.1を指定している。

従来はDLL配置調整とfrozen GPU診断の後に `Compress-Archive` でZIPを作成していた。追加した署名設計では、DLL配置調整後に全PEを監査・署名・検証し、その最終バイナリで診断してからZIP化する。各方式A〜Eの比較、第三者署名、証明書導入手順、production公開前の検証は [WINDOWS_SIGNING.md](WINDOWS_SIGNING.md) にまとめた。

追加したスクリプトは `scripts/audit_windows_signatures.ps1`、`sign_windows_release.ps1`、`windows_signing_common.ps1`、`package_windows_release.ps1` と空の `windows_signing_approvals.json`。さらにVTK importを120秒で打ち切る `tools/check_windows_vtk_import.py` を追加した。

署名ポリシーの14ケース、実ファイルの診断、Qt署名の保持判定、未レビュー依存の拒否、拒否時のハッシュ不変、未署名productionの拒否を検証した。PowerShell 5.1と7で基本テストを実行した。証明書ストアの実署名、timestamp通信、SignTool実検証の成功経路は、production証明書とSDK導入後の検証が必要である。証明書・秘密鍵は生成していない。

README／READMEJPとWindowsビルド案内にSACの症状とCodeIntegrityログの確認方法を追記した。SACをオフにすることは必須条件にしていない。

## 8. ビルド結果と残る検証

最終的な配布物の検証結果は [Windowsビルド検証記録](WINDOWS_BUILD_VERIFICATION.md) を参照。今回の検証機ではCUDA GPUが利用可能と判定されず、実GPUのSAM2推論は未検証。SACの設定は変更していないが、VTK importのポリシーブロックと成功が同じ作業中に混在した。署名済み配布物をSAC有効の別Windows 11端末で検証する工程を省略してはいけない。
