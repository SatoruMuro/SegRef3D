from PyQt6.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QPushButton, QLabel, QGraphicsView,
    QCheckBox, QScrollArea, QFrame, QComboBox,  # ← ここに QComboBox を追加
    QDoubleSpinBox, QSpinBox  # ✅ ← これを追加
)
from PyQt6.QtGui import QColor, QPixmap, QFont
from PyQt6.QtCore import Qt


class Ui_MainWindow:
       
        
    def setupUi(self, MainWindow):
        MainWindow.setWindowTitle("SegRef3D")
        MainWindow.resize(1000, 800)
    
        self.central_widget = QWidget(MainWindow)
        MainWindow.setCentralWidget(self.central_widget)
    
        outer_layout = QVBoxLayout(self.central_widget)
    

    
    
    
    
        # 🔹 上段：ボタン2つ
        button_layout1 = QHBoxLayout()
        self.btn_load_images = QPushButton("Load Images")
        self.btn_fit_to_window = QPushButton("Fit to Window")
                
        # 🔸 間引きUI
        self.label_thin_factor = QLabel("Thin Every N-th:")
        self.label_thin_factor.setAlignment(Qt.AlignmentFlag.AlignRight)
        self.spin_thin_factor = QSpinBox()
        self.spin_thin_factor.setRange(1, 10)
        self.spin_thin_factor.setValue(1)  # デフォルト=1（間引かない）
        self.btn_thin_images = QPushButton("Apply Thinning")
        
        self.btn_load_masks = QPushButton("Load Masks")
        self.btn_save_svg_as = QPushButton("Save Masks")
        
        self.btn_export_nifti = QPushButton("Export NIfTI")  # ← 新規追加！
        self.btn_export_nifti_reversed = QPushButton("Export NIfTI (Reversed)")
        self.btn_export_tiff = QPushButton("Export TIFF")
        # self.btn_export_grayscale_png = QPushButton("Export PNG")   
        self.btn_export_tiff_reversed = QPushButton("Export TIFF (Reversed)")
        self.btn_export_overlay_png = QPushButton("Export Overlay PNG")



        # 🔹 色選択UI（ラベル + ComboBox）とボタン3つ
        self.label_color = QLabel("Pen Color:")
        self.label_color.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self.combo_color = QComboBox()
        self.combo_color.addItems(["Gray", "White", "Black"])
        self.combo_color.setCurrentText("Gray")  # ← 追加
                
        self.label_draw_mode = QLabel("Draw Mode:")
        self.label_draw_mode.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        self.combo_draw_mode = QComboBox()
        # self.combo_draw_mode.addItems(["Free", "Click"])
        self.combo_draw_mode.addItems([
            "Free",           # Freehand drawing
            "Click",          # Point-to-point drawing
            "Click (Snap)"    # Point-to-point with boundary snapping
        ])        
        
        self.combo_draw_mode.setCurrentText("Free")        
        


        self.btn_undo = QPushButton("Undo Line")
        self.btn_redo = QPushButton("Redo Line")
        self.btn_clear_current_path = QPushButton("Clear Lines")
        self.btn_clear_all_paths = QPushButton("Clear All Lines")       
        
        self.btn_show_version_info = QPushButton("Ver Info")



        
        button_layout1.addWidget(self.btn_load_images)
        button_layout1.addWidget(self.btn_fit_to_window)
        
        button_layout1.addWidget(self.label_thin_factor)
        button_layout1.addWidget(self.spin_thin_factor)
        button_layout1.addWidget(self.btn_thin_images)
        button_layout1.addWidget(self.btn_load_masks)
        button_layout1.addWidget(self.btn_save_svg_as)
        
        button_layout1.addWidget(self.btn_export_nifti)          # ← TIFFの左隣に追加！
        button_layout1.addWidget(self.btn_export_nifti_reversed)
        button_layout1.addWidget(self.btn_export_tiff)
        # button_layout1.addWidget(self.btn_export_grayscale_png)
        button_layout1.addWidget(self.btn_export_tiff_reversed)


        button_layout1.addWidget(self.label_color)
        button_layout1.addWidget(self.combo_color)
                
        button_layout1.addWidget(self.label_draw_mode)
        button_layout1.addWidget(self.combo_draw_mode)

        button_layout1.addWidget(self.btn_undo)
        button_layout1.addWidget(self.btn_redo)
        button_layout1.addWidget(self.btn_clear_current_path)
        button_layout1.addWidget(self.btn_clear_all_paths)
        
        button_layout1.addWidget(self.btn_show_version_info)

        
        # 🔹 ボタン行：2段目
        button_layout2 = QHBoxLayout()
        

        
        
        
                
        # 🔹 閾値プリセット選択 ComboBox
        self.label_threshold_preset = QLabel("Threshold Preset:")
        self.label_threshold_preset.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        self.combo_threshold_preset = QComboBox()
        self.combo_threshold_preset.addItems([
            "Custom",              # ← 手動設定モード
            "CT Bone",
            "CT Soft Tissue",
            "CT Fat",
            "CT Air/Background",
            "MRI High Signal",
            "MRI Low Signal"
            # "Auto (Otsu)"
        ])
        self.combo_threshold_preset.setCurrentText("Custom")
        
        
        
        

                
        # 🔹 グレースケールしきい値範囲（Min–Max統合）
        self.label_threshold_range = QLabel("Gray Threshold (Min–Max):")
        self.label_threshold_range.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        self.spin_threshold_min = QSpinBox()
        self.spin_threshold_min.setRange(0, 255)
        self.spin_threshold_min.setValue(180)
        self.spin_threshold_min.setFixedWidth(80)
        
        self.spin_threshold_max = QSpinBox()
        self.spin_threshold_max.setRange(0, 255)
        self.spin_threshold_max.setValue(255)
        self.spin_threshold_max.setFixedWidth(80)
        
        self.btn_extract_threshold = QPushButton("Extract by Threshold")
        
        self.btn_extract_inside_object = QPushButton("Extract Inside Obj")
        self.btn_extract_inside_object_all = QPushButton("Extract Inside Obj All")        
        self.btn_show_fraction = QPushButton("Show Fraction")

        
        # 🔹 RGB抽出設定
        # 🔹 RGB抽出 UI 追加要素
        self.label_rgb = QLabel("Target RGB:")
        self.label_rgb.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        self.spin_r = QSpinBox()
        self.spin_r.setRange(0, 255)
        self.spin_r.setPrefix("R:")
        self.spin_r.setFixedWidth(80)
        
        self.spin_g = QSpinBox()
        self.spin_g.setRange(0, 255)
        self.spin_g.setPrefix("G:")
        self.spin_g.setFixedWidth(80)
        
        self.spin_b = QSpinBox()
        self.spin_b.setRange(0, 255)
        self.spin_b.setPrefix("B:")
        self.spin_b.setFixedWidth(80)
        
        self.label_rgb_tol = QLabel("±Tol:")
        self.label_rgb_tol.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        self.spin_rgb_tol = QSpinBox()
        self.spin_rgb_tol.setRange(0, 128)
        self.spin_rgb_tol.setValue(30)
        self.spin_rgb_tol.setFixedWidth(80)
        
        self.btn_rgb_pick = QPushButton("Pick Color")
        self.btn_rgb_extract = QPushButton("Extract by RGB")
        








               


                
        button_layout2.addWidget(self.label_threshold_preset)
        button_layout2.addWidget(self.combo_threshold_preset)

        

        button_layout2.addWidget(self.label_threshold_range)
        button_layout2.addWidget(self.spin_threshold_min)
        button_layout2.addWidget(self.spin_threshold_max)
        button_layout2.addWidget(self.btn_extract_threshold)
                
        button_layout2.addWidget(self.btn_extract_inside_object)
        button_layout2.addWidget(self.btn_extract_inside_object_all)        
        button_layout2.addWidget(self.btn_show_fraction)
        
        # 🔽 button_layout2 に追加
        button_layout2.addWidget(self.label_rgb)
        button_layout2.addWidget(self.spin_r)
        button_layout2.addWidget(self.spin_g)
        button_layout2.addWidget(self.spin_b)
        button_layout2.addWidget(self.label_rgb_tol)
        button_layout2.addWidget(self.spin_rgb_tol)
        button_layout2.addWidget(self.btn_rgb_pick)
        button_layout2.addWidget(self.btn_rgb_extract)        
        
        
        
        
        
        


        # 🔽 2段レイアウトとして追加
        outer_layout.addLayout(button_layout1)
        outer_layout.addLayout(button_layout2)
        
        
        
        sam_layout = QHBoxLayout()
        
        self.btn_prepare_tracking = QPushButton("Prepare Tracking")
        self.btn_set_box_prompt = QPushButton("Set Box Prompt")
        self.btn_clear_box = QPushButton("Clear Box")                
        self.btn_set_tracking_start = QPushButton("Set Tracking Start")                     
        self.btn_set_tracking_end = QPushButton("Set Tracking End")
        self.btn_add_object_prompt = QPushButton("Add Object Prompt")
        self.btn_batch_tracking = QPushButton("Run Batch Tracking")        
        self.btn_run_tracking = QPushButton("Run Tracking")
        self.btn_run_sam2 = QPushButton("Run Seg")
        self.btn_seg_on_web = QPushButton("Seg on Web")
        self.btn_instant3dweb = QPushButton("Instant3Dweb")

        sam_layout.addWidget(self.btn_prepare_tracking)
        sam_layout.addWidget(self.btn_set_box_prompt)        
        sam_layout.addWidget(self.btn_clear_box)                
        sam_layout.addWidget(self.btn_set_tracking_start)
        sam_layout.addWidget(self.btn_set_tracking_end)
        sam_layout.addWidget(self.btn_add_object_prompt)
        sam_layout.addWidget(self.btn_batch_tracking)
        sam_layout.addWidget(self.btn_run_tracking)
        sam_layout.addWidget(self.btn_run_sam2)
        sam_layout.addWidget(self.btn_seg_on_web)   
        sam_layout.addWidget(self.btn_instant3dweb)
        
        outer_layout.addLayout(sam_layout)


        # 🔹 編集対象オブジェクト選択 + Add ボタン
        add_layout = QHBoxLayout()
        
        self.label_overlap = QLabel("Overlap Between:")
        self.label_overlap.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        self.combo_overlap1 = QComboBox()
        self.combo_overlap1.addItems([str(i + 1) for i in range(20)])
        self.combo_overlap1.setCurrentIndex(0)
        
        self.combo_overlap2 = QComboBox()
        self.combo_overlap2.addItems([str(i + 1) for i in range(20)])
        self.combo_overlap2.setCurrentIndex(1)
        
        self.btn_extract_overlap = QPushButton("Extract Overlap CurrentImg")
        self.btn_extract_overlap_all = QPushButton("Extract Overlap AllImg")






        
        # self.label_target_object = QLabel("Target Object:")
        # self.label_target_object.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        # # ✅ 太字を適用
        # bold_font = QFont()
        # bold_font.setBold(True)
        # self.label_target_object.setFont(bold_font)
        
        # self.combo_target_object = QComboBox()
        # self.combo_target_object.addItems([str(i+1) for i in range(20)])
        # self.combo_target_object.setCurrentIndex(0)
        
        # self.btn_add_to_mask = QPushButton("Add to Mask")
        # self.chk_auto_add = QCheckBox("Auto Add")
        # self.chk_auto_add.setChecked(False)
        
        # self.btn_cut_from_mask = QPushButton("Erase from Mask")
        
        # self.btn_transfer_to_mask = QPushButton("Transfer To:")
        # self.combo_transfer_target = QComboBox()
        # self.combo_transfer_target.addItems([str(i+1) for i in range(20)])
        # self.combo_transfer_target.setCurrentIndex(19)  # デフォルト obj20
        
        # self.btn_undo_edit = QPushButton("Undo Edit")
        # self.btn_redo_edit = QPushButton("Redo Edit")
        
        # add_layout.addWidget(self.label_target_object)
        # add_layout.addWidget(self.combo_target_object)
        # add_layout.addWidget(self.btn_add_to_mask)
        # add_layout.addWidget(self.chk_auto_add)
        # add_layout.addWidget(self.btn_cut_from_mask)
        # add_layout.addWidget(self.btn_transfer_to_mask)
        # add_layout.addWidget(self.combo_transfer_target)
        # add_layout.addWidget(self.btn_undo_edit)
        # add_layout.addWidget(self.btn_redo_edit)
        
        # outer_layout.addLayout(add_layout)
        
        self.label_target_object = QLabel("Target Object:")
        self.label_target_object.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        bold_font = QFont()
        bold_font.setBold(True)
        self.label_target_object.setFont(bold_font)
        
        self.combo_target_object = QComboBox()
        self.combo_target_object.addItems([str(i+1) for i in range(20)])
        self.combo_target_object.setCurrentIndex(0)
        
        self.btn_add_to_mask = QPushButton("Add to Mask")
        self.btn_cut_from_mask = QPushButton("Erase from Mask")
        
        self.btn_transfer_to_mask = QPushButton("Transfer To:")
        self.combo_transfer_target = QComboBox()
        self.combo_transfer_target.addItems([str(i+1) for i in range(20)])
        self.combo_transfer_target.setCurrentIndex(19)
        
        self.label_auto_apply = QLabel("Auto:")
        self.label_auto_apply.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        self.combo_auto_apply_mode = QComboBox()
        self.combo_auto_apply_mode.addItems(["Off", "Add", "Erase", "Transfer"])
        self.combo_auto_apply_mode.setCurrentText("Off")
        self.combo_auto_apply_mode.setFixedWidth(110)
        
        self.btn_undo_edit = QPushButton("Undo Edit")
        self.btn_redo_edit = QPushButton("Redo Edit")
        
        add_layout.addWidget(self.label_target_object)
        add_layout.addWidget(self.combo_target_object)
        add_layout.addWidget(self.btn_add_to_mask)
        add_layout.addWidget(self.btn_cut_from_mask)
        add_layout.addWidget(self.btn_transfer_to_mask)
        add_layout.addWidget(self.combo_transfer_target)
        add_layout.addWidget(self.label_auto_apply)
        add_layout.addWidget(self.combo_auto_apply_mode)
        add_layout.addWidget(self.btn_undo_edit)
        add_layout.addWidget(self.btn_redo_edit)
        
        outer_layout.addLayout(add_layout)





    
        # 🔹 画像ビュー
        self.graphicsView = QGraphicsView()
        self.graphicsView.setMinimumSize(800, 600)
        outer_layout.addWidget(self.graphicsView)


        # 🔹 ステータスラベル（画像ファイル名など）
        self.label_status = QLabel("Ready")
        self.label_status.setAlignment(Qt.AlignmentFlag.AlignHCenter)

        status_font = QFont()
        status_font.setPointSize(16)   # ← ここで大きさ調整
        status_font.setBold(True)
        self.label_status.setFont(status_font)        
        
        outer_layout.addWidget(self.label_status)

    
        # 🔹 チェックボックス（2行 × 10列）
        self.checkboxes = []
        self.color_labels = [
            (255, 0, 0), (0, 0, 255), (0, 255, 0), (255, 255, 0),
            (128, 0, 128), (255, 165, 0), (0, 255, 255), (173, 255, 47),
            (128, 128, 128), (0, 128, 128), (255, 192, 203), (255, 20, 147),
            (0, 128, 0), (128, 0, 0), (0, 255, 230), (255, 215, 0),
            (255, 69, 0), (0, 0, 128), (220, 20, 60), (128, 128, 0)
        ]
    
    
    
        checkbox_grid = QGridLayout()
        for i, rgb in enumerate(self.color_labels):
            checkbox = QCheckBox(f"Obj {i+1}")
            checkbox.setChecked(False)
    
            color_box = QLabel()
            pixmap = QPixmap(20, 20)
            pixmap.fill(QColor(*rgb))
            color_box.setPixmap(pixmap)
            color_box.setFixedSize(20, 20)
    
            box_layout = QHBoxLayout()
            box_layout.addWidget(checkbox)
            box_layout.addWidget(color_box)
            box_layout.addStretch()
    
            box_widget = QWidget()
            box_widget.setLayout(box_layout)
    
            row = i // 10  # 0 or 1
            col = i % 10   # 0–9
            checkbox_grid.addWidget(box_widget, row, col)
    
            self.checkboxes.append(checkbox)
    
        # outer_layout.addLayout(checkbox_grid)
        # ここでボタンを作っておく（定義場所をここに移してOK）
        self.btn_rescan_used_colors = QPushButton("Rescan Used Colors")
        
        # グリッド + ボタン をまとめる横一列レイアウト
        obj_row_layout = QHBoxLayout()
        obj_row_layout.addLayout(checkbox_grid)            # 左に 2段のグリッド
        obj_row_layout.addWidget(self.btn_rescan_used_colors)  # その右にボタン
        # obj_row_layout.addStretch(1)                       # 余白
        
        outer_layout.addLayout(obj_row_layout)        
        
        
        
                
        # 🔹 一括オブジェクト色変換 UI（チェックボックスの下に配置）
        convert_layout = QHBoxLayout()
        
        self.label_convert_from = QLabel("Convert From:")
        self.label_convert_from.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)

        self.combo_convert_from = QComboBox()
        self.combo_convert_from.addItems([str(i+1) for i in range(20)])
        self.combo_convert_from.setCurrentIndex(0)
        
        self.label_convert_to = QLabel("To:")
        self.label_convert_to.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)

        self.combo_convert_to = QComboBox()
        self.combo_convert_to.addItems([str(i+1) for i in range(20)])
        self.combo_convert_to.setCurrentIndex(1)
        
        self.btn_convert_color = QPushButton("Convert Object Color")
        
        self.label_reorder_object = QLabel("Reorder:")
        self.label_reorder_object.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self.combo_reorder_object = QComboBox()
        self.combo_reorder_object.addItems([str(i+1) for i in range(20)])
        self.combo_reorder_object.setCurrentIndex(0)
        
        self.btn_bring_to_front = QPushButton("Bring to Front")
        self.btn_send_to_back = QPushButton("Send to Back")
        
        self.label_delete_object = QLabel("Delete Object:")
        self.label_delete_object.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        self.combo_delete_object = QComboBox()
        self.combo_delete_object.addItems([str(i+1) for i in range(20)])
        self.combo_delete_object.setCurrentIndex(0)
                
        # 🔹 Remove Small Parts Threshold 設定
        self.label_threshold = QLabel("Threshold:")
        self.label_threshold.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        self.spinbox_threshold = QSpinBox()
        self.spinbox_threshold.setMinimum(1)
        self.spinbox_threshold.setMaximum(10000)
        self.spinbox_threshold.setValue(50)  # 初期値
        
        self.label_px2 = QLabel("px²")
        

        
        
        self.btn_remove_small_parts = QPushButton("Remove Small Parts")
        self.btn_delete_current_only = QPushButton("Delete Object CurrentImg")
        self.btn_delete_object = QPushButton("Delete Object AllImg")
        self.btn_undo_delete = QPushButton("Undo Delete")
        # self.btn_rescan_used_colors = QPushButton("Rescan Used Colors")
        
        convert_layout.addWidget(self.label_convert_from)
        convert_layout.addWidget(self.combo_convert_from)
        convert_layout.addWidget(self.label_convert_to)
        convert_layout.addWidget(self.combo_convert_to)
        convert_layout.addWidget(self.btn_convert_color)
        
        convert_layout.addWidget(self.label_reorder_object)
        convert_layout.addWidget(self.combo_reorder_object)
        convert_layout.addWidget(self.btn_bring_to_front)
        convert_layout.addWidget(self.btn_send_to_back)
        
        convert_layout.addWidget(self.label_delete_object)
        convert_layout.addWidget(self.combo_delete_object)
        
        convert_layout.addWidget(self.label_threshold)
        convert_layout.addWidget(self.spinbox_threshold)
        convert_layout.addWidget(self.label_px2)
        
        convert_layout.addWidget(self.btn_remove_small_parts) 
        convert_layout.addWidget(self.btn_delete_current_only)
        convert_layout.addWidget(self.btn_delete_object)
        convert_layout.addWidget(self.btn_undo_delete)
        # convert_layout.addWidget(self.btn_rescan_used_colors)
        
        # outer_layout.addLayout(convert_layout)

    
        # # 🔹 ステータスラベル（画像ファイル名など）
        # self.label_status = QLabel("Ready")
        # self.label_status.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        # outer_layout.addWidget(self.label_status)


        # 🔹 キャリブレーションとSTL出力 UI
        calibration_layout = QHBoxLayout()

        self.label_mm_input = QLabel("Line Length (mm):")
        self.label_mm_input.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self.label_mm_input.setFont(bold_font)
        self.spin_mm_input = QDoubleSpinBox()
        self.spin_mm_input.setDecimals(2)
        self.spin_mm_input.setRange(0.01, 1000.0)
        self.spin_mm_input.setSingleStep(0.1)
        self.spin_mm_input.setValue(10.0)

        self.label_z_spacing = QLabel("Z Interval (mm):")
        self.label_z_spacing.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self.label_z_spacing.setFont(bold_font)
        self.spin_z_interval = QDoubleSpinBox()
        self.spin_z_interval.setDecimals(3)
        self.spin_z_interval.setRange(0.001, 10.0)
        self.spin_z_interval.setSingleStep(0.01)
        self.spin_z_interval.setValue(0.2)
        
        self.btn_draw_calibration_line = QPushButton("Calibration Line")
        self.btn_load_volinf = QPushButton("Load VolInfo")
        self.btn_show_volinf = QPushButton("Show VolInfo")
        self.btn_draw_measurement_line = QPushButton("Measurement Line")  # ✅ 新ボタン追加



        
        
        self.label_stack_order = QLabel("Stacking Direction:")
        self.label_stack_order.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        self.combo_stack_order = QComboBox()
        self.combo_stack_order.addItems([
            "Frontside (descending)",  # index 0 ← 表面から（降順）
            "Backside (ascending)"     # index 1 ← 裏面から（昇順）
        ])
        self.combo_stack_order.setCurrentIndex(0)  # デフォルトを「表面（降順）」

        

        
        self.label_smooth = QLabel("Smooth Level:")
        self.label_smooth.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)

        
        self.combo_smooth_level = QComboBox()
        self.combo_smooth_level.addItems([
            "0（off）", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"
        ])
        self.combo_smooth_level.setCurrentIndex(5)  # デフォルトはレベル5（中）
        
        # スムージングモードの選択ラベルとコンボボックスを追加
        self.label_smooth_mode = QLabel("Smooth Mode:")
        self.label_smooth_mode.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        
        self.combo_smooth_mode = QComboBox()
        self.combo_smooth_mode.addItems([
            "None",                 # スムージングなし
            "Z-interpolation only",# Z方向補間のみ
            "Mesh smoothing only",  # メッシュスムージングのみ
            "Both"                  # 両方
        ])
        self.combo_smooth_mode.setCurrentIndex(0)  # デフォルト: なし
        

        self.btn_export_stl_colorwise = QPushButton("Export 3D")
        self.btn_export_volume_csv = QPushButton("Export Measurements")  # 🔽 体積出力ボタン

        # calibration_layout.addWidget(self.btn_rescan_used_colors)
        
        calibration_layout.addWidget(self.label_mm_input)
        calibration_layout.addWidget(self.spin_mm_input)
        calibration_layout.addWidget(self.label_z_spacing)
        calibration_layout.addWidget(self.spin_z_interval)
        calibration_layout.addWidget(self.btn_draw_calibration_line)
        calibration_layout.addWidget(self.btn_load_volinf)
        calibration_layout.addWidget(self.btn_show_volinf)
        calibration_layout.addWidget(self.btn_draw_measurement_line)  # ✅ ここに追加
        
        calibration_layout.addWidget(self.label_stack_order)
        calibration_layout.addWidget(self.combo_stack_order)

        
        calibration_layout.addWidget(self.label_smooth)
        calibration_layout.addWidget(self.combo_smooth_level)
        calibration_layout.addWidget(self.label_smooth_mode)
        calibration_layout.addWidget(self.combo_smooth_mode)
        calibration_layout.addWidget(self.btn_export_stl_colorwise)
        calibration_layout.addWidget(self.btn_export_volume_csv)

        outer_layout.addLayout(calibration_layout)
                
        
   

        # ================================
        # 🔹 拡張機能用の一番下の行を追加
        # ================================
        advanced_row = QHBoxLayout()

        self.label_advanced_group = QLabel("Extensions:")
        self.label_advanced_group.setAlignment(
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        )

        self.combo_advanced_group = QComboBox()
        self.combo_advanced_group.addItems([
            "None",
            "Thinning",
            "Export NIfTI / TIFF",
            "Threshold",
            "RGB",
            "Batch Tracking",
            "Convert",
            "Delete / Cleanup",
            "Stacking Direction",
            "Version Info",
        ])
        self.combo_advanced_group.setCurrentIndex(0)

        self.advanced_container = QWidget()
        self.advanced_container_layout = QHBoxLayout(self.advanced_container)
        self.advanced_container_layout.setContentsMargins(0, 0, 0, 0)
        self.advanced_container_layout.setSpacing(6)

        advanced_row.addWidget(self.label_advanced_group)
        advanced_row.addWidget(self.combo_advanced_group)
        advanced_row.addWidget(self.advanced_container, 1)

        outer_layout.addLayout(advanced_row)
                
        
        # ===== ここから追加 =====
        def show_advanced_group(name: str):
            layout = self.advanced_container_layout
            while layout.count():
                item = layout.takeAt(0)
                w = item.widget()
                if w is not None:
                    w.hide()
        
            if name == "None":
                return
        
            for w in self.advanced_groups.get(name, []):
                layout.addWidget(w)
                w.show()
        
            layout.addStretch(1)
        
        show_advanced_group("None")
        self.combo_advanced_group.currentTextChanged.connect(show_advanced_group)
        # ===== ここまで =====
        
        
        
        # ================================
        # 🔹 拡張グループに属するウィジェットを定義
        # ================================
        all_layouts = [
            button_layout1,
            button_layout2,
            sam_layout,
            add_layout,
            convert_layout,
            calibration_layout,
        ]

        def detach_from_all_layouts(widget):
            """既存のレイアウトからウィジェットを抜く"""
            for lay in all_layouts:
                lay.removeWidget(widget)

        self.advanced_groups = {
            "Thinning": [
                self.label_thin_factor,
                self.spin_thin_factor,
                self.btn_thin_images,
            ],
            "Export NIfTI / TIFF": [
                self.btn_export_nifti,
                self.btn_export_nifti_reversed,
                self.btn_export_tiff,
                self.btn_export_tiff_reversed,
                self.btn_export_overlay_png,
            ],
            # "Threshold / RGB": [
            #     self.label_threshold_preset,
            #     self.combo_threshold_preset,
            #     self.label_threshold_range,
            #     self.spin_threshold_min,
            #     self.spin_threshold_max,
            #     self.btn_extract_threshold,
            #     self.label_rgb,
            #     self.spin_r,
            #     self.spin_g,
            #     self.spin_b,
            #     self.label_rgb_tol,
            #     self.spin_rgb_tol,
            #     self.btn_rgb_pick,
            #     self.btn_rgb_extract,
            # ],
            # "Threshold / RGB": [
            #     self.label_threshold_preset,
            #     self.combo_threshold_preset,
            #     self.label_threshold_range,
            #     self.spin_threshold_min,
            #     self.spin_threshold_max,
            #     self.btn_extract_threshold,
            #     self.btn_extract_inside_object,
            #     self.btn_extract_inside_object_all,
            #     self.label_rgb,
            #     self.spin_r,
            #     self.spin_g,
            #     self.spin_b,
            #     self.label_rgb_tol,
            #     self.spin_rgb_tol,
            #     self.btn_rgb_pick,
            #     self.btn_rgb_extract,
            # ],            
            "Threshold": [
                self.label_threshold_preset,
                self.combo_threshold_preset,
                self.label_threshold_range,
                self.spin_threshold_min,
                self.spin_threshold_max,
                self.btn_extract_threshold,
                self.btn_extract_inside_object,
                self.btn_extract_inside_object_all,
                self.btn_show_fraction,
            ],
            
            "RGB": [
                self.label_rgb,
                self.spin_r,
                self.spin_g,
                self.spin_b,
                self.label_rgb_tol,
                self.spin_rgb_tol,
                self.btn_rgb_pick,
                self.btn_rgb_extract,
            ],            
            
            
            "Batch Tracking": [
                self.btn_add_object_prompt,
                self.btn_batch_tracking,
            ],
            # "Overlap": [
            #     self.label_overlap,
            #     self.combo_overlap1,
            #     self.combo_overlap2,
            #     self.btn_extract_overlap,
            #     self.btn_extract_overlap_all,
            # ],
            # 🔻 Convert / Reorder / Delete を3グループに分割
            "Convert": [
                self.label_convert_from,
                self.combo_convert_from,
                self.label_convert_to,
                self.combo_convert_to,
                self.btn_convert_color,
            ],
            # "Reorder": [
            #     self.label_reorder_object,
            #     self.combo_reorder_object,
            #     self.btn_bring_to_front,
            #     self.btn_send_to_back,
            # ],
            "Delete / Cleanup": [
                self.label_delete_object,
                self.combo_delete_object,
                self.label_threshold,
                self.spinbox_threshold,
                self.label_px2,
                self.btn_remove_small_parts,
                self.btn_delete_current_only,
                self.btn_delete_object,
                self.btn_undo_delete,
                # self.btn_rescan_used_colors,
            ],
            "Stacking Direction": [
                self.label_stack_order,
                self.combo_stack_order,
            ],
            "Version Info": [
                self.btn_show_version_info,
            ],
        }

        # ① これらのウィジェットを元レイアウトから抜いて非表示にする
        for group_widgets in self.advanced_groups.values():
            for w in group_widgets:
                detach_from_all_layouts(w)
                w.hide()
        
        
        
        
        
        
        
        
        
        # ✅ ボタンの色をスタイルで設定
        # 目立たないボタン（グレー系）：Undo, Redo, Clear系
        clear_style = "background-color: #dcdcdc; color: black;"  # ライトグレー
        for btn in [
            self.btn_undo, self.btn_redo,
            self.btn_clear_current_path, self.btn_clear_all_paths,
            self.btn_clear_box,
            self.btn_undo_edit, self.btn_redo_edit,
            self.btn_undo_delete  # ✅ 追加
        ]:
            btn.setStyleSheet(clear_style)
        
        # 重い処理（オレンジ系）：SAM, Tracking, STL出力など
        heavy_style = "background-color: #ffcc99; color: black;"  # 明るいオレンジ
        for btn in [
            self.btn_run_sam2,
            self.btn_run_tracking,
            self.btn_export_stl_colorwise,
            self.btn_save_svg_as
        ]:
            btn.setStyleSheet(heavy_style)
                    
        # 編集ボタン（青緑系）
        edit_style = "background-color: #99ddff; color: black;"  # 明るい水色
        for btn in [
            self.btn_add_to_mask,
            self.btn_cut_from_mask,
            self.btn_transfer_to_mask
        ]:
            btn.setStyleSheet(edit_style)
        
        # 🆕 バッチ専用（赤系）
        batch_style = "background-color: #ff6666; color: white;"  # 強調赤
        self.btn_batch_tracking.setStyleSheet(batch_style)
                    
        # 🆕 バッチ準備（淡赤系）
        prepare_style = "background-color: #ff9999; color: black;"  # 準備ボタンに合う色
        self.btn_add_object_prompt.setStyleSheet(prepare_style)        
                
        # トラッキング準備（黄色系）
        prepare_tracking_style = "background-color: #ffff99; color: black;"  # 明るい黄色
        self.btn_prepare_tracking.setStyleSheet(prepare_tracking_style)

        # 🔸 間引き（目立たせないグレー系）
        thin_style = "background-color: #dcdcdc; color: black;"  # ライトグレー
        self.btn_thin_images.setStyleSheet(thin_style)
        
        # ✅ 測定・出力ボタン（緑系）
        measure_export_style = "background-color: #ccffcc; color: black;"  # 明るいグリーン
        for btn in [
            self.btn_draw_measurement_line,
            self.btn_show_volinf,
            self.btn_export_volume_csv
        ]:
            btn.setStyleSheet(measure_export_style)

        # ✅ 読み込み・保存ボタン（青系）
        load_style = "background-color: #cce5ff; color: black;"  # 明るい青（読み込み系）
        for btn in [
            self.btn_load_images,
            self.btn_load_masks,
            self.btn_load_volinf            
        ]:
            btn.setStyleSheet(load_style)


        # ✅ 特定の基本操作ボタンに黒枠を追加（背景色はそのまま維持）
        basic_frame_style = """
            border: 2px solid black;
            border-radius: 6px;
            font-weight: bold;
        """
        for btn in [
            self.btn_load_images,
            self.btn_save_svg_as,
            self.btn_prepare_tracking,
            self.btn_set_box_prompt,
            self.btn_set_tracking_start,
            self.btn_set_tracking_end,
            self.btn_run_tracking,
            self.btn_add_to_mask,
            self.btn_cut_from_mask,
            self.btn_draw_calibration_line,
            self.btn_export_stl_colorwise
        ]:
            prev_style = btn.styleSheet()
            btn.setStyleSheet(prev_style + basic_frame_style)


