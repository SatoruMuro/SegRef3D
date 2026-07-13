__version__ = "1.2.2"


import sys
import os
import re

from PyQt6.QtWidgets import (
    QApplication,
    QMainWindow,
    QFileDialog,
    QGraphicsView,
    QGraphicsScene,
    QGraphicsPixmapItem,
    QGraphicsPathItem,
    QCheckBox
)

from PyQt6.QtSvgWidgets import QGraphicsSvgItem
from PyQt6.QtWidgets import QMessageBox

from PyQt6.QtGui import (
    QPixmap,
    QPainterPath,
    QPen,
    QPainter, 
    QMouseEvent,
    QImage,
    QColor,
    QBrush
)

from PyQt6.QtCore import Qt, QPointF
from PyQt6.QtSvg import QSvgRenderer

from PyQt6.QtWidgets import QFileDialog, QDialogButtonBox, QPushButton

import nrrd  # pip install pynrrd
import numpy as np

from ui_SegRef3D import Ui_MainWindow

from svgpathtools import parse_path

from datetime import datetime
import shutil

CANVAS_BACKGROUND_COLOR = QColor("#e8e8e8")
from xml.etree import ElementTree as ET

from collections import defaultdict

from PyQt6.QtGui import QShortcut, QKeySequence

import pydicom
from PIL import Image

import csv

from PyQt6.QtCore import QRectF
from PyQt6.QtWidgets import QGraphicsRectItem

from PyQt6.QtGui import QPainterPath
from PyQt6.QtGui import QCursor


import cv2
import subprocess

import time

from trimesh.smoothing import filter_laplacian  # ✅ 追加

# ほかのimport群の近くに
import nibabel as nib



def _hex_from_rgb_text(s: str) -> str | None:
    m = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', s.strip(), re.I)
    if not m:
        return None
    r, g, b = map(int, m.groups())
    return f'#{r:02x}{g:02x}{b:02x}'

def _extract_fill_hex(elem: ET.Element) -> str | None:
    """<path fill> でも style='fill:…' でも、rgb() でも #rrggbb に正規化して返す。"""
    fill  = (elem.attrib.get("fill")  or "").strip().lower()
    style = (elem.attrib.get("style") or "").strip().lower()
    if "fill:" in style:
        m = re.search(r'fill:([^;]+)', style)
        if m:
            fill = m.group(1).strip()
    if not fill or fill == "none":
        return None
    if fill.startswith("rgb("):
        fill = _hex_from_rgb_text(fill) or fill
    if isinstance(fill, str) and fill.startswith("#") and len(fill) == 7:
        return fill
    return None

def _tuple_from_hex(hx: str) -> tuple[int,int,int]:
    return (int(hx[1:3],16), int(hx[3:5],16), int(hx[5:7],16))

def _recolor_svg_inplace(svg_path: str, from_hex: str, to_hex: str) -> bool:
    """その SVG の fill が from_hex の要素だけ to_hex に差し替え。変更があれば True"""
    try:
        tree = ET.parse(svg_path)
        root = tree.getroot()
        changed = False
        for el in root.iter():
            hx = _extract_fill_hex(el)
            if hx == from_hex:
                el.set("fill", to_hex)
                # style に fill 指定があれば削除
                style = el.attrib.get("style", "")
                if "fill:" in style:
                    style = re.sub(r'fill:[^;]+;?', '', style)
                    el.set("style", style)
                changed = True
        if changed:
            tree.write(svg_path, encoding="utf-8")
        return changed
    except Exception as e:
        print(f"[WARN] recolor failed: {svg_path}: {e}")
        return False

    
    
    

    
def extract_all_numbers(s):
    return [int(num) for num in re.findall(r'\d+', s)]

def create_video_from_images(image_paths, output_path, fps=5):
    if not image_paths:
        raise ValueError("No images provided to create video.")

    # 最初の画像のサイズを取得
    first_image = cv2.imread(image_paths[0])
    height, width, _ = first_image.shape

    # 動画ファイルを作成
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    for path in image_paths:
        img = cv2.imread(path)
        if img is None:
            raise ValueError(f"Failed to load image {path}")
        out.write(img)

    out.release()


def get_ffmpeg_path():
    if getattr(sys, 'frozen', False):
        # exeとしてビルド後の実行（PyInstaller環境）
        base_path = sys._MEIPASS if hasattr(sys, "_MEIPASS") else os.path.dirname(sys.executable)
    else:
        # 通常のPythonスクリプト実行
        base_path = os.path.dirname(os.path.abspath(__file__))
    
    ffmpeg_path = os.path.join(base_path, "ffmpeg_bin", "ffmpeg.exe")
    if not os.path.exists(ffmpeg_path):
        raise FileNotFoundError(f"ffmpeg.exe not found at {ffmpeg_path}")
    
    return ffmpeg_path

# グローバル定数として取得
FFMPEG_PATH = get_ffmpeg_path()



class CustomGraphicsView(QGraphicsView):
    def __init__(self, parent=None):
        super().__init__(parent)
        scene = QGraphicsScene(self)
        scene.setBackgroundBrush(QBrush(CANVAS_BACKGROUND_COLOR))
        self.setScene(scene)
        self.setBackgroundBrush(QBrush(CANVAS_BACKGROUND_COLOR))
        self.drawing = False
        self.current_path = None
        self.paths = []  # 各画像ごとに後で辞書化予定

        # ✅ ペン色とペン本体
        self.pen_color = Qt.GlobalColor.gray  # ← pen_color を定義
        self.pen = QPen(self.pen_color, 2)    # ← それを使って QPen を作成
        
        self.draw_mode = 'free'  # ← モード（free or click）
        self.click_points = []   # clickモードで使用する座標のリスト
        self.current_path_item = None  # clickモード用

        self.save_callback = None  # ✅ コールバック追加
        self.image_wheel_callback = None
        
        self.temp_preview_item = None  # 仮のスムージングプレビュー用
        
        self.gray_image = None  # グレースケール画像（スナップ用）
        self.middle_mouse_panning = False
        self.last_pan_pos = None
        self.cursor_before_pan = None



        
  
        
    def create_smooth_path(self, points):
        if len(points) < 2:
            return QPainterPath()
    
        path = QPainterPath(points[0])
    
        def control_points(p0, p1, p2, p3):
            c1 = QPointF(p1.x() + (p2.x() - p0.x()) / 6.0,
                         p1.y() + (p2.y() - p0.y()) / 6.0)
            c2 = QPointF(p2.x() - (p3.x() - p1.x()) / 6.0,
                         p2.y() - (p3.y() - p1.y()) / 6.0)
            return c1, c2
    
        if len(points) == 2:
            path.lineTo(points[1])
            return path
    
        # 仮想の前点 p_{-1}
        p_minus = QPointF(2 * points[0].x() - points[1].x(),
                          2 * points[0].y() - points[1].y())
    
        # 最初の区間
        c1, c2 = control_points(p_minus, points[0], points[1], points[2])
        path.cubicTo(c1, c2, points[1])
    
        # 中間の区間
        for i in range(1, len(points) - 2):
            c1, c2 = control_points(points[i - 1], points[i], points[i + 1], points[i + 2])
            path.cubicTo(c1, c2, points[i + 1])
    
        # 仮想の後点 p_{n+1}
        p_last = points[-1]
        p_before_last = points[-2]
        p_plus = QPointF(2 * p_last.x() - p_before_last.x(),
                         2 * p_last.y() - p_before_last.y())
    
        # 最後の区間
        c1, c2 = control_points(points[-3], points[-2], points[-1], p_plus)
        path.cubicTo(c1, c2, points[-1])
    
        return path





        

    def wheelEvent(self, event):
        modifiers = QApplication.keyboardModifiers()
        delta = event.angleDelta().y()
        if modifiers == Qt.KeyboardModifier.ControlModifier:
            self.scale(1.25 if delta > 0 else 0.8, 1.25 if delta > 0 else 0.8)
        elif modifiers == Qt.KeyboardModifier.ShiftModifier:
            self.horizontalScrollBar().setValue(
                self.horizontalScrollBar().value() - delta
            )
        elif modifiers == Qt.KeyboardModifier.NoModifier:
            if self.image_wheel_callback is not None:
                self.image_wheel_callback(delta)
        event.accept()



    
    def snap_to_edge_wrapper(self, scene_pos):
        import cv2
        import numpy as np
    
        if not hasattr(self, 'gray_image') or self.gray_image is None:
            return scene_pos  # 元画像がなければそのまま
    
        # scene 座標から image 座標に変換
        x = int(scene_pos.x())
        y = int(scene_pos.y())
    
        window_size = 15
        img = self.gray_image
        h, w = img.shape
        half = window_size // 2
    
        x_min = max(0, x - half)
        x_max = min(w, x + half)
        y_min = max(0, y - half)
        y_max = min(h, y + half)
    
        crop = img[y_min:y_max, x_min:x_max]
        edges = cv2.Canny(crop, 50, 150)
    
        if np.count_nonzero(edges) == 0:
            return scene_pos  # エッジなしなら補正しない
    
        ys, xs = np.where(edges > 0)
        xs_global = xs + x_min
        ys_global = ys + y_min
    
        distances = (xs_global - x) ** 2 + (ys_global - y) ** 2
        min_idx = np.argmin(distances)
        snapped_x = int(xs_global[min_idx])
        snapped_y = int(ys_global[min_idx])
    
        return QPointF(snapped_x, snapped_y)

     
    def undo_last_click_point(self):
        if self.draw_mode in ['click', 'click_snap'] and self.click_points:
            self.click_points.pop()  # 最後の点を削除
    
            if len(self.click_points) >= 2:
                smooth_path = self.create_smooth_path(self.click_points)
                self.current_path_item.setPath(smooth_path)
            elif len(self.click_points) == 1:
                self.current_path = QPainterPath(self.click_points[0])
                self.current_path_item.setPath(self.current_path)
            else:
                # すべて削除されたらパスを消去
                if self.current_path_item:
                    self.scene().removeItem(self.current_path_item)
                    self.current_path_item = None
                    self.current_path = None
    
            # 仮プレビューも消す
            if self.temp_preview_item:
                self.scene().removeItem(self.temp_preview_item)
                self.temp_preview_item = None
    
            self.scene().update()
   

    
    def mousePressEvent(self, event: QMouseEvent):
        if event.button() == Qt.MouseButton.MiddleButton:
            self.middle_mouse_panning = True
            self.last_pan_pos = event.pos()
            self.cursor_before_pan = self.cursor()
            self.setCursor(Qt.CursorShape.ClosedHandCursor)
            event.accept()
            return

        if event.button() == Qt.MouseButton.LeftButton:
            scene_pos = self.mapToScene(event.pos())
    
            if self.draw_mode == 'free':
                self.drawing = True
                self.current_path = QPainterPath(scene_pos)
                self.current_path_item = QGraphicsPathItem()
                self.current_path_item.setPen(self.pen)
                self.current_path_item.setPath(self.current_path)
                self.scene().addItem(self.current_path_item)
    
            elif self.draw_mode in ('click', 'click_snap'):
                # ▶ snap モードのときは座標を補正
                if self.draw_mode == 'click_snap':
                    snapped_scene_pos = self.snap_to_edge_wrapper(scene_pos)
                    self.click_points.append(snapped_scene_pos)
                else:
                    self.click_points.append(scene_pos)
    
                if len(self.click_points) == 1:
                    self.current_path = QPainterPath(self.click_points[0])
                    self.current_path_item = QGraphicsPathItem()
                    self.current_path_item.setPen(self.pen)
                    self.scene().addItem(self.current_path_item)
                else:
                    smooth_path = self.create_smooth_path(self.click_points)
                    self.current_path_item.setPath(smooth_path)
    
                # 仮プレビューの削除
                if self.temp_preview_item:
                    self.scene().removeItem(self.temp_preview_item)
                    self.temp_preview_item = None
    
            event.accept()



                
    # def mouseMoveEvent(self, event: QMouseEvent):
    #     scene_pos = self.mapToScene(event.pos())
    
    #     # ✅ freeモード（従来の手描き）
    #     if self.draw_mode == 'free' and self.drawing and self.current_path:
    #         self.current_path.lineTo(scene_pos)
    #         self.current_path_item.setPath(self.current_path)
    
    #     # ✅ clickモード（仮のスムーズ曲線プレビュー）
    #     # elif self.draw_mode == 'click' and len(self.click_points) >= 1:
    #     elif self.draw_mode in ('click', 'click_snap') and len(self.click_points) >= 1:

    #         temp_points = self.click_points + [scene_pos]
    #         smooth_path = self.create_smooth_path(temp_points)
    
    #         # 🔒 temp_preview_item の存在と有効性をチェック
    #         if self.temp_preview_item:
    #             if self.temp_preview_item.scene() is not None:
    #                 self.temp_preview_item.setPath(smooth_path)
    #             else:
    #                 print("[WARN] temp_preview_item is deleted or invalid")
    #                 self.temp_preview_item = None
    
    #         if not self.temp_preview_item:
    #             self.temp_preview_item = QGraphicsPathItem()
    #             self.temp_preview_item.setPen(QPen(Qt.GlobalColor.gray, 1, Qt.PenStyle.DashLine))  # 仮表示は点線で
    #             self.temp_preview_item.setPath(smooth_path)
    #             self.scene().addItem(self.temp_preview_item)
    
    #     event.accept()

    def mouseMoveEvent(self, event: QMouseEvent):
        if self.middle_mouse_panning and self.last_pan_pos is not None:
            delta = event.pos() - self.last_pan_pos
            self.last_pan_pos = event.pos()
            self.horizontalScrollBar().setValue(
                self.horizontalScrollBar().value() - delta.x()
            )
            self.verticalScrollBar().setValue(
                self.verticalScrollBar().value() - delta.y()
            )
            event.accept()
            return

        scene_pos = self.mapToScene(event.pos())
    
        # ✅ freeモード（従来の手描き）
        if self.draw_mode == 'free' and self.drawing:
            if self.current_path is None or self.current_path_item is None:
                print("[WARN] Drawing path or item is None. Cancelling drawing.")
                self.drawing = False
                return
    
            try:
                # ⚠️ この行でRuntimeErrorを防止
                if self.current_path_item.scene() is None:
                    print("[WARN] current_path_item was removed from scene. Cancelling drawing.")
                    self.current_path = None
                    self.current_path_item = None
                    self.drawing = False
                    return
            except RuntimeError:
                print("[WARN] current_path_item already deleted. Cancelling drawing.")
                self.current_path = None
                self.current_path_item = None
                self.drawing = False
                return
    
            self.current_path.lineTo(scene_pos)
            self.current_path_item.setPath(self.current_path)
    
        # ✅ clickモード（仮のスムーズ曲線プレビュー）
        elif self.draw_mode in ('click', 'click_snap') and len(self.click_points) >= 1:
            temp_points = self.click_points + [scene_pos]
            smooth_path = self.create_smooth_path(temp_points)
    
            # 🔒 temp_preview_item の存在と有効性をチェック
            if self.temp_preview_item:
                if self.temp_preview_item.scene() is not None:
                    self.temp_preview_item.setPath(smooth_path)
                else:
                    print("[WARN] temp_preview_item is deleted or invalid")
                    self.temp_preview_item = None
    
            if not self.temp_preview_item:
                self.temp_preview_item = QGraphicsPathItem()
                self.temp_preview_item.setPen(QPen(Qt.GlobalColor.gray, 1, Qt.PenStyle.DashLine))  # 仮表示は点線で
                self.temp_preview_item.setPath(smooth_path)
                self.scene().addItem(self.temp_preview_item)
    
        event.accept()

            

    
    def finalize_click_drawing(self):
        if self.click_points and self.current_path_item:
            smooth_path = self.create_smooth_path(self.click_points)
            smooth_path.closeSubpath()
            self.current_path_item.setPath(smooth_path)
            self.paths.append(self.current_path_item)
    
            if self.save_callback:
                self.save_callback(smooth_path)
    
            if self.temp_preview_item:
                self.scene().removeItem(self.temp_preview_item)
                self.temp_preview_item = None
    
            self.click_points = []
            self.current_path = None
            self.current_path_item = None
            self.scene().update()

                
    def mouseReleaseEvent(self, event: QMouseEvent):
        if event.button() == Qt.MouseButton.MiddleButton and self.middle_mouse_panning:
            self.middle_mouse_panning = False
            self.last_pan_pos = None
            if self.cursor_before_pan is not None:
                self.setCursor(self.cursor_before_pan)
                self.cursor_before_pan = None
            event.accept()
            return

        if self.draw_mode == 'free':
            if event.button() == Qt.MouseButton.LeftButton and self.drawing:
                self.drawing = False
                path = self.current_path_item.path()
                path.closeSubpath()
                self.current_path_item.setPath(path)
                self.paths.append(self.current_path_item)
                if self.save_callback:
                    self.save_callback(self.current_path_item.path())
                self.scene().update()
    
        elif self.draw_mode in ['click', 'click_snap']:
            if event.button() == Qt.MouseButton.RightButton:
                self.finalize_click_drawing()  # ← 共通処理に置き換え
    
        event.accept()




        event.accept()





# ===== STL プレビュー用ダイアログ =====
from PyQt6.QtWidgets import QDialog, QVBoxLayout
from vtkmodules.qt.QVTKRenderWindowInteractor import QVTKRenderWindowInteractor
import vtk
import random

class STLPreviewDialog(QDialog):
    def __init__(self, parent=None, stl_paths=None, color_labels=None):
        super().__init__(parent)
        self.setWindowTitle("STL Preview")
        self.resize(900, 700)
        
        # ← 追加：カラーラベルを保持
        self.color_labels = color_labels or []

        layout = QVBoxLayout(self)
        self.vtk_widget = QVTKRenderWindowInteractor(self)
        layout.addWidget(self.vtk_widget)

        self.renderer = vtk.vtkRenderer()
        self.vtk_widget.GetRenderWindow().AddRenderer(self.renderer)
        self.interactor = self.vtk_widget.GetRenderWindow().GetInteractor()
        self.interactor.SetInteractorStyle(vtk.vtkInteractorStyleTrackballCamera())

        axes = vtk.vtkAxesActor()
        orientation = vtk.vtkOrientationMarkerWidget()
        orientation.SetOrientationMarker(axes)
        orientation.SetViewport(0.0, 0.0, 0.2, 0.2)
        orientation.SetInteractor(self.interactor)
        orientation.SetEnabled(1)
        orientation.InteractiveOff()

        self.renderer.SetBackground(0.1, 0.1, 0.12)

        if stl_paths:
            if isinstance(stl_paths, (list, tuple)):
                self.load_multiple(stl_paths)
            else:
                self.load_one(stl_paths)

        self.interactor.Initialize()
        self.vtk_widget.GetRenderWindow().Render()

    def _color_for_path(self, path: str):
        """ファイル名中の連番（例: object_01.stl → 1）から self.color_labels の色を返す"""
        import os, re
        base = os.path.basename(path)
        m = re.search(r'(\d+)', base)  # どこかに数字があればOK（object_01, label3 など）
        if m and self.color_labels:
            idx = int(m.group(1)) - 1  # 1始まり → 0始まり
            if 0 <= idx < len(self.color_labels):
                r, g, b = self.color_labels[idx]
                return (r/255.0, g/255.0, b/255.0)
        # 見つからない/範囲外 → グレー
        return (0.7, 0.7, 0.7)


    def _actor_from_reader(self, reader, color=None):
        normals = vtk.vtkPolyDataNormals()
        normals.SetInputConnection(reader.GetOutputPort())
        normals.ConsistencyOn()
        normals.SplittingOff()
        normals.AutoOrientNormalsOn()
        normals.Update()

        mapper = vtk.vtkPolyDataMapper()
        mapper.SetInputConnection(normals.GetOutputPort())
        mapper.ScalarVisibilityOff()

        actor = vtk.vtkActor()
        actor.SetMapper(mapper)
        prop = actor.GetProperty()
        if color is None:
            # ランダムに淡色
            color = [0.7 + 0.3*random.random() for _ in range(3)]
        prop.SetColor(*color)
        prop.SetColor(*color)          # ← 渡された色をそのまま適用
        prop.SetSpecular(0.2)
        prop.SetSpecularPower(20)
        return actor

    def load_one(self, stl_path: str):
        reader = vtk.vtkSTLReader()
        reader.SetFileName(stl_path)
        reader.Update()
        color = self._color_for_path(stl_path)   # ← 追加
        actor = self._actor_from_reader(reader, color)
        self.renderer.AddActor(actor)
        self._finalize_scene()

    def load_multiple(self, paths):
        for p in paths:
            reader = vtk.vtkSTLReader()
            reader.SetFileName(p)
            reader.Update()
            color = self._color_for_path(p)      # ← 追加
            actor = self._actor_from_reader(reader, color)
            self.renderer.AddActor(actor)
        self._finalize_scene()

    def _finalize_scene(self):
        light = vtk.vtkLight()
        light.SetLightTypeToHeadlight()
        light.SetIntensity(1.0)
        self.renderer.AddLight(light)
        self.renderer.ResetCamera()








class SegRefMain(QMainWindow, Ui_MainWindow):
    def __init__(self):
        super().__init__()
        

        self.image_pristine = True
        self.ignore_spinbox_change = False
        
        # 🔽 Box Prompt用（SAM2統合のため）
        self.box_mode = False
        self.box_points = []
        self.temp_box_item = None
        self.last_box_prompt = None
        self.stored_boxes = []
        # 一括トラッキング用
        self.batch_object_data = []  # 各オブジェクトの情報を辞書形式で保持
        self.box_per_frame = {}  # 例: {0: ((x1,y1), (x2,y2)), 1: ((x1,y1), (x2,y2)), ...}


        
        self.setupUi(self)
    
        self.installEventFilter(self)

        # ✅ graphicsView を CustomGraphicsView に差し替え
        layout = self.central_widget.layout()
        index = layout.indexOf(self.graphicsView)
        layout.removeWidget(self.graphicsView)
        self.graphicsView.deleteLater()

        self.graphicsView = CustomGraphicsView()
        layout.insertWidget(index, self.graphicsView)

        # ✅ Scene を作成
        self.scene = QGraphicsScene()
        self.scene.setBackgroundBrush(QBrush(CANVAS_BACKGROUND_COLOR))
        self.graphicsView.setScene(self.scene)
        self.graphicsView.setBackgroundBrush(QBrush(CANVAS_BACKGROUND_COLOR))

        # ✅ チェックボックスのイベント接続
        for checkbox in self.checkboxes:
            checkbox.stateChanged.connect(self.display_current_image)

        # ✅ ボタンイベント
                
        # self.btn_export_target_mask.clicked.connect(
        #     lambda: self.export_target_object_as_mask(
        #         target_index=self.combo_target_object.currentIndex()
        #     )
        # )  #実験用
        
        
        
        self.btn_load_images.clicked.connect(self.load_image_folder)
        self.btn_fit_to_window.clicked.connect(self.fit_view_to_window)

        self.btn_thin_images.clicked.connect(self.thin_images_and_reload)

        
        self.btn_load_masks.clicked.connect(self.load_mask_folder)
        self.btn_save_svg_as.clicked.connect(self.save_svg_as)



        
        self.spin_threshold_min.valueChanged.connect(self.on_threshold_spinbox_changed)
        self.spin_threshold_max.valueChanged.connect(self.on_threshold_spinbox_changed)

        self.combo_threshold_preset.currentTextChanged.connect(self.apply_threshold_preset)


        self.btn_extract_threshold.clicked.connect(self.extract_by_threshold)
        
        self.btn_extract_inside_object.clicked.connect(
            self.extract_threshold_inside_object_current
        )
        self.btn_extract_inside_object_all.clicked.connect(
            self.extract_threshold_inside_object_all
        )   
        self.btn_show_fraction.clicked.connect(self.show_threshold_fraction_current)
                


        self.btn_rgb_extract.clicked.connect(self.extract_by_rgb)
        self.btn_rgb_pick.clicked.connect(self.enable_rgb_picker)





        self.btn_undo.clicked.connect(self.undo_last_path)
        self.btn_redo.clicked.connect(self.redo_last_path)
        self.btn_clear_current_path.clicked.connect(self.clear_current_path)
        self.btn_clear_all_paths.clicked.connect(self.clear_all_paths)   
        
        self.btn_show_version_info.clicked.connect(self.show_version_info)

        
        
        self.combo_color.currentTextChanged.connect(self.update_pen_color)
        self.combo_draw_mode.currentTextChanged.connect(self.change_draw_mode)
        



        
        self.btn_add_to_mask.clicked.connect(self.add_drawn_path_to_mask)
        self.btn_cut_from_mask.clicked.connect(self.cut_drawn_path_from_mask)
        self.btn_transfer_to_mask.clicked.connect(self.transfer_drawn_path_to_mask)
        self.btn_convert_color.clicked.connect(self.convert_object_color_across_svgs)
        self.btn_undo_edit.clicked.connect(self.smart_undo)
        self.btn_redo_edit.clicked.connect(self.redo_edit)
        self.btn_rescan_used_colors.clicked.connect(self.update_checkboxes_based_on_used_colors)

        self.btn_bring_to_front.clicked.connect(self.bring_selected_object_to_front)
        self.btn_send_to_back.clicked.connect(self.send_selected_object_to_back)
        
        
        
        # self.btn_remove_small_parts.clicked.connect(self.delete_small_parts_in_selected_object)
        self.btn_remove_small_parts.clicked.connect(self.on_remove_small_parts)
        self.btn_delete_current_only.clicked.connect(self.delete_selected_object_from_current_image)
        self.btn_delete_object.clicked.connect(self.delete_selected_object)
        self.btn_undo_delete.clicked.connect(self.smart_undo)


        
        # self.btn_export_grayscale_png.clicked.connect(self.export_all_svgs_to_grayscale_png)
        self.btn_export_nifti.clicked.connect(self.export_nifti_labelmap)  # ← 新規追加！
        self.btn_export_nifti_reversed.clicked.connect(self.export_nifti_labelmap_reversed)
        self.btn_export_tiff.clicked.connect(self.export_all_svgs_to_grayscale_tiff)
        self.btn_export_tiff_reversed.clicked.connect(self.export_all_svgs_to_grayscale_tiff_reversed)
        self.btn_export_overlay_png.clicked.connect(self.export_overlay_png_sequence)
        
        self.btn_draw_calibration_line.clicked.connect(self.start_calibration)
        self.btn_load_volinf.clicked.connect(self.load_volinf_csv)
        self.btn_show_volinf.clicked.connect(self.show_volinf)
        self.btn_draw_measurement_line.clicked.connect(self.start_measurement_mode)

        
        self.btn_export_stl_colorwise.clicked.connect(self.export_colorwise_stl_with_scale)
        self.btn_export_volume_csv.clicked.connect(self.export_colorwise_volumes_to_csv)
        
        self.measurement_mode = False
        self.measurement_points = []
        self.temp_measurement_line_item = None
        self.measurement_results = []



        #Undo Redoのための変数
        self.undo_stack = {}  # 例: {'0001': [svg_text_before_edit, ...]}
        self.redo_stack = {}







        # ✅ 状態保持
        self.image_paths = {}
        self.mask_paths = {}

        # ✅ PNG単一ラベル正本（新規）
        self.label_masks = {}         # key -> np.ndarray(H, W), dtype=np.uint8
        self.label_mask_paths = {}    # key -> saved png path

        self.current_index = 0

        self.graphicsView.viewport().installEventFilter(self)

        # ✅ 線データ保持
        self.drawn_paths_per_image = {}
        self.graphicsView.save_callback = self.save_drawn_path
        self.graphicsView.image_wheel_callback = self.switch_image_by_wheel
        
        self.color_labels = self.color_labels
        
        self.modified_svg_trees = {}
        self.path_elements_by_color = {}
        
        self.pixmap_cache = {}        # 画像キャッシュ
        self.svg_renderer_cache = {}  # SVGレンダリングキャッシュ
        
        self.drawn_paths_per_image = {}  # 画像キー → [(QPainterPath, モード)] の辞書
        
        now = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.output_mask_dir = os.path.join(os.getcwd(), f"masks_{now}")
        os.makedirs(self.output_mask_dir, exist_ok=True)

        # ✅ PNG単一ラベル保存先（新規）
        self.reset_autosave_label_dir()
        
        self.redo_stack = defaultdict(list)  # 🔁 Redoline用のスタック（画像ごと）
        
        self.calibration_mode = False
        self.calibration_points = []
        
        # self.mm_per_px = 1.0  # 初期値：1px = 1mm
        # self.z_spacing_mm = 1.0
        
        self.mm_per_px = None
        self.z_spacing_mm = None
        
        
        
        
        
        
        
        # 🔽 マウス移動を検知するために必要
        self.graphicsView.setMouseTracking(True)
        self.graphicsView.viewport().setMouseTracking(True)
        
        # 🔽 キャリブレーション用初期化
        self.temp_line_item = None
        self.calibration_points = []
    
        undo_shortcut = QShortcut(QKeySequence("Ctrl+Z"), self)
        undo_shortcut.activated.connect(self.smart_undo)
    
        self.sam2_interface = None
        self.sam2_enabled = False
        self.sam2_disabled_reason = None

        if False:
            sam2_disabled_message = self.sam2_interface.status_message
            self.label_status.setText(f"⚠ {sam2_disabled_message}")

            # SAM2関連のボタンをリストアップ
            sam_buttons = [
                self.btn_run_sam2,
                self.btn_set_box_prompt,
                self.btn_clear_box,
                self.btn_set_tracking_start,
                self.btn_set_tracking_end,
                self.btn_add_object_prompt,
                self.btn_batch_tracking,
                self.btn_run_tracking,
                self.btn_prepare_tracking,
            ]

            # ボタンを無効化し、クリック時にはステータスメッセージを出すようにする
            for btn in sam_buttons:
                try:
                    btn.clicked.disconnect()
                except TypeError:
                    pass
                btn.setEnabled(False)  # ✅ グレーアウト
                btn.setStyleSheet("color: gray; background-color: lightgray;")  # ✅ 見た目もグレーアウト
                btn.clicked.connect(lambda _, b=btn: self.label_status.setText(
                    f"⚠ '{b.text()}' is unavailable. {sam2_disabled_message}"))
        if False:
            self.label_status.setText(self.sam2_interface.status_message)
        
        
        if self.sam2_enabled:
            self.label_status.setText(self.sam2_interface.status_message)
        
        self.loaded_images = {}  # 🔧 画像読み込み管理用の辞書
        
        self.btn_set_box_prompt.clicked.connect(self.start_box_prompt_mode)
        self.btn_run_sam2.clicked.connect(self.run_sam2_segmentation)
        self.btn_seg_on_web.clicked.connect(self.open_seg_on_web)
        self.btn_instant3dweb.clicked.connect(self.open_instant3dweb)
        self.btn_clear_box.clicked.connect(self.clear_box)
                        
        self.tracking_start_index = None
        self.tracking_end_index = None
        self.btn_prepare_tracking.clicked.connect(self.prepare_tracking_frames)
        self.btn_set_tracking_start.clicked.connect(self.set_tracking_start)
        self.btn_set_tracking_end.clicked.connect(self.set_tracking_end)
        self.btn_run_tracking.clicked.connect(self.run_tracking)
        self.btn_add_object_prompt.clicked.connect(self.add_object_prompt_for_batch)
        self.btn_batch_tracking.clicked.connect(self.run_batch_tracking)
        self.initialize_sam2()
        
        #オーバーラップの検出
        self.btn_extract_overlap.clicked.connect(self.on_extract_overlap_clicked)
        self.btn_extract_overlap_all.clicked.connect(self.on_extract_overlap_clicked_all)  # ← 新関数に接続

        

        
        # NOTE:
        # Overlap extraction and front/back ordering are disabled
        # in single-label PNG mode because per-pixel overlap/layer order
        # is not preserved in the current raster label design.
        reason_text = "Disabled in single-label PNG mode."
        
        disabled_buttons = [
            self.btn_extract_overlap,
            self.btn_extract_overlap_all,
            self.btn_bring_to_front,
            self.btn_send_to_back,
        ]
        
        for btn in disabled_buttons:
            btn.setEnabled(False)
            btn.setStyleSheet("color: gray; background-color: lightgray;")
            btn.setToolTip(reason_text)








#ヘルパー関数

    
    def auto_add_latest_path_current_image(self):
        key = self.get_current_image_key()
        if not key:
            return
    
        if key not in self.drawn_paths_per_image or not self.drawn_paths_per_image[key]:
            return
    
        try:
            # Auto Add 対象オブジェクトを表示ON
            obj_id = self.combo_target_object.currentIndex() + 1
            self.checkboxes[obj_id - 1].setChecked(True)
    
            # current image だけ Undo 保存
            self.save_svg_state_for_undo(key)
    
            # 最新パスだけ取得
            latest_path, _ = self.drawn_paths_per_image[key][-1]
    
            label_mask = self.ensure_label_mask_exists(key)
            h, w = label_mask.shape
    
            binary = self.rasterize_path_to_binary(latest_path, w, h)
    
            # current image のみ加算
            label_mask[binary > 0] = obj_id
            self.save_label_mask_png(key)
    
            # 反映済みの最新パスを描画バッファから削除
            self.drawn_paths_per_image[key].pop()
    
            self.display_current_image()
            self.scene.update()
            self.label_status.setText(f"✅ Auto Added to Obj {obj_id}")
    
        except Exception as e:
            self.label_status.setText(f"⚠ Auto Add failed: {e}")

    
    def auto_erase_latest_path_current_image(self):
        key = self.get_current_image_key()
        if not key:
            return
    
        if key not in self.drawn_paths_per_image or not self.drawn_paths_per_image[key]:
            return
    
        try:
            obj_id = self.combo_target_object.currentIndex() + 1
    
            # current image のみ Undo 保存
            self.save_svg_state_for_undo(key)
    
            # 最新パスだけ取得
            latest_path, _ = self.drawn_paths_per_image[key][-1]
    
            label_mask = self.ensure_label_mask_exists(key)
            h, w = label_mask.shape
    
            binary = self.rasterize_path_to_binary(latest_path, w, h)
    
            # 対象オブジェクト部分だけ消す
            erase_mask = (binary > 0) & (label_mask == obj_id)
            label_mask[erase_mask] = 0
            self.save_label_mask_png(key)
    
            # 反映済みの最新パスを描画バッファから削除
            self.drawn_paths_per_image[key].pop()
    
            self.display_current_image()
            self.scene.update()
            self.label_status.setText(f"✅ Auto Erased from Obj {obj_id}")
    
        except Exception as e:
            self.label_status.setText(f"⚠ Auto Erase failed: {e}")
    
    
    def auto_transfer_latest_path_current_image(self):
        key = self.get_current_image_key()
        if not key:
            return
    
        if key not in self.drawn_paths_per_image or not self.drawn_paths_per_image[key]:
            return
    
        try:
            src_id = self.combo_target_object.currentIndex() + 1
            dst_id = self.combo_transfer_target.currentIndex() + 1
    
            # 同じなら実質変化なし
            if src_id == dst_id:
                self.drawn_paths_per_image[key].pop()
                self.display_current_image()
                self.scene.update()
                self.label_status.setText("⚠ Source and destination are the same.")
                return
    
            # 転送先を表示ON
            self.checkboxes[dst_id - 1].setChecked(True)
    
            # current image のみ Undo 保存
            self.save_svg_state_for_undo(key)
    
            # 最新パスだけ取得
            latest_path, _ = self.drawn_paths_per_image[key][-1]
    
            label_mask = self.ensure_label_mask_exists(key)
            h, w = label_mask.shape
    
            binary = self.rasterize_path_to_binary(latest_path, w, h)
    
            # src object のうち、描画領域に入った部分だけ dst へ移す
            transfer_mask = (binary > 0) & (label_mask == src_id)
            label_mask[transfer_mask] = dst_id
            self.save_label_mask_png(key)
    
            # 反映済みの最新パスを描画バッファから削除
            self.drawn_paths_per_image[key].pop()
    
            self.display_current_image()
            self.scene.update()
            self.label_status.setText(f"✅ Auto Transferred Obj {src_id} → Obj {dst_id}")
    
        except Exception as e:
            self.label_status.setText(f"⚠ Auto Transfer failed: {e}")



    
    
    def load_svg_as_label_mask(self, key: str, svg_path: str) -> None:
        """
        既存SVGを読み込み、単一ラベル画像 (uint8, 0..20) に変換して
        self.label_masks[key] に格納する。
    
        対応:
        - path
        - polygon
        - polyline
        - rect
    
        サイズ方針:
        - SVGに viewBox / width / height がある場合は、元画像サイズに合わせてスケール
        - SVGにサイズ情報がない場合は、SVG座標を元画像上のpx座標としてそのまま扱う
        """
        if key not in self.image_paths:
            raise KeyError(f"No image found for key: {key}")
    
        img = cv2.imread(self.image_paths[key], cv2.IMREAD_GRAYSCALE)
        if img is None:
            raise ValueError(f"Failed to read base image for key {key}: {self.image_paths[key]}")
    
        h, w = img.shape
        label = np.zeros((h, w), dtype=np.uint8)
    
        tree = ET.parse(svg_path)
        root = tree.getroot()
    
        def local_tag(elem):
            # namespace付きタグにも対応: {http://www.w3.org/2000/svg}polygon
            return elem.tag.split("}")[-1].lower()
    
        def parse_length(value):
            """
            '540', '540px', '540.0' のような値から数値部分だけを取り出す。
            """
            if value is None:
                return None
            m = re.search(r"[-+]?\d*\.\d+|[-+]?\d+", str(value))
            return float(m.group(0)) if m else None
    
        def get_svg_canvas_size(root):
            """
            SVGの座標系サイズを取得する。
            viewBox があれば優先し、なければ width/height を使う。
            どちらもなければ None, None を返す。
            """
            viewbox = root.attrib.get("viewBox") or root.attrib.get("viewbox")
            if viewbox:
                nums = re.findall(r"[-+]?\d*\.\d+|[-+]?\d+", viewbox)
                if len(nums) == 4:
                    _, _, vb_w, vb_h = map(float, nums)
                    if vb_w > 0 and vb_h > 0:
                        return vb_w, vb_h
    
            sw = parse_length(root.attrib.get("width"))
            sh = parse_length(root.attrib.get("height"))
    
            if sw is not None and sh is not None and sw > 0 and sh > 0:
                return sw, sh
    
            return None, None
    
        svg_w, svg_h = get_svg_canvas_size(root)
    
        if svg_w is not None and svg_h is not None:
            scale_x = w / svg_w
            scale_y = h / svg_h
        else:
            # サイズ情報なしSVGは、座標を元画像px座標としてそのまま使う
            scale_x = 1.0
            scale_y = 1.0
    
        def normalize_fill_to_hex(elem):
            """
            fill="#ff0000"
            style="fill:#ff0000"
            fill="rgb(255,0,0)"
            などを #rrggbb に正規化する。
            """
            fill = elem.attrib.get("fill", "")
            style = elem.attrib.get("style", "")
    
            # 既存の normalize_color があれば使う
            try:
                color = self.normalize_color(fill, style)
            except Exception:
                color = ""
    
            if not color:
                fill = fill.strip().lower() if fill else ""
                style = style.strip().lower() if style else ""
    
                if "fill:" in style:
                    m = re.search(r'fill:([^;"]+)', style)
                    if m:
                        fill = m.group(1).strip().lower()
    
                color = fill
    
            if not color:
                return None
    
            color = color.strip().lower()
    
            if color == "none":
                return None
    
            if color.startswith("rgb"):
                m = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', color)
                if m:
                    r, g, b = map(int, m.groups())
                    color = f"#{r:02x}{g:02x}{b:02x}"
    
            if color.startswith("#") and len(color) == 7:
                return color
    
            return None
    
        def obj_id_from_hex(fill_hex):
            for i, (r, g, b) in enumerate(self.color_labels, start=1):
                hex_color = f"#{r:02x}{g:02x}{b:02x}"
                if fill_hex == hex_color:
                    return i
            return None
    
        def scale_qpath(qpath):
            """
            QPainterPathの座標を scale_x / scale_y でスケールする。
            """
            if scale_x == 1.0 and scale_y == 1.0:
                return qpath
    
            from PyQt6.QtGui import QTransform
            transform = QTransform()
            transform.scale(scale_x, scale_y)
            return transform.map(qpath)
    
        def points_to_qpath(points_text, close=True):
            """
            points="x1,y1 x2,y2 ..." を QPainterPath に変換する。
            polygon/polyline 用。
            """
            nums = re.findall(r"[-+]?\d*\.\d+|[-+]?\d+", points_text)
            if len(nums) < 4:
                return None
    
            pts = []
            for i in range(0, len(nums) - 1, 2):
                x = float(nums[i]) * scale_x
                y = float(nums[i + 1]) * scale_y
                pts.append(QPointF(x, y))
    
            if len(pts) < 2:
                return None
    
            qpath = QPainterPath()
            qpath.moveTo(pts[0])
            for pt in pts[1:]:
                qpath.lineTo(pt)
    
            if close and len(pts) >= 3:
                qpath.closeSubpath()
    
            return qpath
    
        loaded_elements = 0
        loaded_pixels = 0
    
        for elem in root.iter():
            tag = local_tag(elem)
    
            fill_hex = normalize_fill_to_hex(elem)
            if fill_hex is None:
                continue
    
            obj_id = obj_id_from_hex(fill_hex)
            if obj_id is None:
                continue
    
            qpath = None
    
            if tag == "path":
                d_attr = elem.attrib.get("d", "")
                if not d_attr:
                    continue
    
                qpath = self.svg_d_to_qpath(d_attr)
                qpath = scale_qpath(qpath)
    
            elif tag == "polygon":
                points_text = elem.attrib.get("points", "")
                qpath = points_to_qpath(points_text, close=True)
    
            elif tag == "polyline":
                points_text = elem.attrib.get("points", "")
                qpath = points_to_qpath(points_text, close=False)
    
            elif tag == "rect":
                try:
                    x = parse_length(elem.attrib.get("x")) or 0.0
                    y = parse_length(elem.attrib.get("y")) or 0.0
                    rw = parse_length(elem.attrib.get("width")) or 0.0
                    rh = parse_length(elem.attrib.get("height")) or 0.0
    
                    if rw <= 0 or rh <= 0:
                        continue
    
                    qpath = QPainterPath()
                    qpath.addRect(
                        x * scale_x,
                        y * scale_y,
                        rw * scale_x,
                        rh * scale_y
                    )
                except Exception:
                    continue
    
            else:
                continue
    
            if qpath is None or qpath.isEmpty():
                continue
    
            binary = self.rasterize_path_to_binary(qpath, w, h)
            px = int(np.count_nonzero(binary))
    
            if px == 0:
                continue
    
            # 単一ラベルなので、後から読んだ要素が上書き
            label[binary > 0] = obj_id
            loaded_elements += 1
            loaded_pixels += px
    
        self.label_masks[key] = label
        self.label_mask_paths[key] = self.get_label_png_path(key)
        self.save_label_mask_png(key)
    
        print(
            f"[INFO] Loaded SVG as label mask: {os.path.basename(svg_path)} | "
            f"elements={loaded_elements}, pixels={loaded_pixels}, "
            f"labels={np.unique(label).tolist()}, "
            f"scale=({scale_x:.6g}, {scale_y:.6g})"
        )

    
    # def load_svg_as_label_mask(self, key: str, svg_path: str) -> None:
    #     """
    #     既存SVGを読み込み、単一ラベル画像 (uint8, 0..20) に変換して
    #     self.label_masks[key] に格納する。
    #     """
    #     if key not in self.image_paths:
    #         raise KeyError(f"No image found for key: {key}")
    
    #     img = cv2.imread(self.image_paths[key], cv2.IMREAD_GRAYSCALE)
    #     if img is None:
    #         raise ValueError(f"Failed to read base image for key {key}: {self.image_paths[key]}")
    
    #     h, w = img.shape
    #     label = np.zeros((h, w), dtype=np.uint8)
    
    #     tree = ET.parse(svg_path)
    #     root = tree.getroot()
    
    #     # SVG内の path を順に処理
    #     for elem in root.iter():
    #         if elem.tag.endswith("path"):
    #             fill = elem.attrib.get("fill", "")
    #             style = elem.attrib.get("style", "")
    
    #             # fill が style 側にある場合も拾う
    #             if not fill and "fill:" in style:
    #                 m = re.search(r'fill:([^;"]+)', style)
    #                 if m:
    #                     fill = m.group(1).strip()
    
    #             fill = fill.lower().strip() if fill else ""
    #             if not fill or fill == "none":
    #                 continue
    
    #             # 今の color_labels に対応する object id を決める
    #             obj_id = None
    #             for i, (r, g, b) in enumerate(self.color_labels, start=1):
    #                 hex_color = f"#{r:02x}{g:02x}{b:02x}"
    #                 if fill == hex_color:
    #                     obj_id = i
    #                     break
    
    #             if obj_id is None:
    #                 continue
    
    #             d_attr = elem.attrib.get("d", "")
    #             if not d_attr:
    #                 continue
    
    #             qpath = self.svg_d_to_qpath(d_attr)
    
    #             # QPainterPath -> binary mask
    #             binary = self.rasterize_path_to_binary(qpath, w, h)
    
    #             # 単一ラベルなので後から描かれたものが上書き
    #             label[binary > 0] = obj_id
    
    #     self.label_masks[key] = label
    #     self.label_mask_paths[key] = self.get_label_png_path(key)





#ヘルパー関数
    
    def build_label_overlay_qimage(self, key: str, alpha: int = 77) -> QImage:
        """
        label mask (uint8, 0..20) を、checkbox の表示状態を反映した
        半透明カラーオーバーレイ画像 (QImage ARGB32) に変換する。
        alpha=77 は約30%相当。
        """
        label = self.ensure_label_mask_exists(key)
        h, w = label.shape
    
        overlay = np.zeros((h, w, 4), dtype=np.uint8)  # RGBA
    
        for i, (r, g, b) in enumerate(self.color_labels, start=1):
            visible = self.checkboxes[i - 1].isChecked()
            if not visible:
                continue
    
            mask = (label == i)
            if np.any(mask):
                overlay[mask, 0] = b   # QImage.Format_ARGB32 に渡す前提で BGRA 順
                overlay[mask, 1] = g
                overlay[mask, 2] = r
                overlay[mask, 3] = alpha
    
        qimg = QImage(
            overlay.data,
            w,
            h,
            overlay.strides[0],
            QImage.Format.Format_ARGB32
        )
    
        return qimg.copy()





#ヘルパー関数
    
    def reset_autosave_label_dir(self) -> None:
        now = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.output_label_dir = os.path.join(os.getcwd(), f"label_png_[autosave]_{now}")
        os.makedirs(self.output_label_dir, exist_ok=True)
        self.label_mask_paths = {
            key: self.get_label_png_path(key)
            for key in getattr(self, "label_masks", {}).keys()
        }
        print(f"[INFO] Autosave label PNG folder: {self.output_label_dir}")


    def get_label_png_path(self, key: str) -> str:
        return os.path.join(self.output_label_dir, f"mask{key}.png")
    
    
    def create_empty_label_mask(self, key: str) -> np.ndarray:
        """
        画像サイズに合わせた空の label mask を作る。
        0=background, 1..20=object id
        """
        if key not in self.image_paths:
            raise KeyError(f"No image found for key: {key}")
    
        img = cv2.imread(self.image_paths[key], cv2.IMREAD_GRAYSCALE)
        if img is None:
            raise ValueError(f"Failed to read image for key {key}: {self.image_paths[key]}")
    
        h, w = img.shape
        return np.zeros((h, w), dtype=np.uint8)
    
    
    def ensure_label_mask_exists(self, key: str) -> np.ndarray:
        """
        label mask が未作成なら空配列を作成し、辞書と保存先を初期化して返す。
        """
        if key not in self.label_masks:
            self.label_masks[key] = self.create_empty_label_mask(key)
            self.label_mask_paths[key] = self.get_label_png_path(key)
            self.save_label_mask_png(key)
        return self.label_masks[key]
    
    
    def save_label_mask_png(self, key: str) -> None:
        """
        メモリ上の label mask を PNG 保存する。
        """
        if key not in self.label_masks:
            raise KeyError(f"No label mask in memory for key: {key}")
    
        os.makedirs(self.output_label_dir, exist_ok=True)
        save_path = self.get_label_png_path(key)
        ok = cv2.imwrite(save_path, self.label_masks[key])
        if not ok:
            raise IOError(f"Failed to save label mask: {save_path}")
    
        self.label_mask_paths[key] = save_path
        message = f"Autosaved label PNG: {os.path.basename(save_path)}"
        print(f"[INFO] {message}")
        if hasattr(self, "label_status"):
            self.label_status.setText(message)
    
    
    def load_label_mask_png(self, key: str, png_path: str) -> None:
        """
        PNG label image を読み込んでメモリに載せる。
        """
        arr = cv2.imread(png_path, cv2.IMREAD_UNCHANGED)
        if arr is None:
            raise ValueError(f"Failed to load label png: {png_path}")
    
        if arr.ndim != 2:
            raise ValueError(f"Label PNG must be single-channel: {png_path}")
    
        if arr.dtype != np.uint8:
            arr = arr.astype(np.uint8)
    
        self.label_masks[key] = arr
        self.label_mask_paths[key] = self.get_label_png_path(key)
        self.save_label_mask_png(key)
    
    
    def save_all_label_masks_png(self) -> None:
        """
        現在メモリ上にある全 label mask を保存する。
        """
        for key in sorted(self.label_masks.keys()):
            self.save_label_mask_png(key)
        if hasattr(self, "label_status"):
            self.label_status.setText(f"Autosaved label PNGs to: {self.output_label_dir}")
    
    
    def get_current_label_mask(self) -> np.ndarray | None:
        key = self.get_current_image_key()
        if key is None:
            return None
        return self.ensure_label_mask_exists(key)
    
    
    
    
    
    import re
    
        
    from datetime import datetime
    
    def show_version_info(self):
        month_str = datetime.now().strftime("%B %Y")
        version_text = (
            f"SegRef3D\n"
            f"Version {__version__} ({month_str})\n\n"
            "Developed by: Satoru Muro, M.D., Ph.D.\n"
            "Institute of Science Tokyo\n\n"
            "Python: 3.12\n"
            "PyQt6 GUI for AI-based segmentation and refinement"
        )
        QMessageBox.information(self, "Version Information", version_text)


    def local_sam2_buttons(self):
        return [
            self.btn_prepare_tracking,
            self.btn_set_box_prompt,
            self.btn_clear_box,
            self.btn_set_tracking_start,
            self.btn_set_tracking_end,
            self.btn_add_object_prompt,
            self.btn_batch_tracking,
            self.btn_run_tracking,
            self.btn_run_sam2,
        ]


    def disable_sam2_ui(self, reason: str):
        self.sam2_interface = None
        self.sam2_enabled = False
        self.sam2_disabled_reason = reason
        message = reason or (
            "SAM2 is not included in this lightweight build. "
            "Use Seg on Web or the GPU build for AI segmentation."
        )

        for btn in self.local_sam2_buttons():
            try:
                btn.clicked.disconnect()
            except (TypeError, RuntimeError):
                pass
            btn.setEnabled(False)
            btn.setToolTip(message)
            btn.setStyleSheet("color: gray; background-color: lightgray;")
            btn.clicked.connect(lambda _, m=message: self.label_status.setText(f"⚠ {m}"))

        # Keep cloud/web AI routes available in the lightweight build.
        for btn in (self.btn_seg_on_web, self.btn_instant3dweb):
            btn.setEnabled(True)
            btn.setToolTip("")

        self.label_status.setText(f"⚠ {message}")
        print(f"[INFO] Local SAM2 disabled: {message}")


    def initialize_sam2(self):
        lite_reason = (
            "SAM2 is not included in this lightweight build. "
            "Use Seg on Web or the GPU build for AI segmentation."
        )

        disable_flag = os.environ.get("SEGREF3D_DISABLE_SAM2", "").strip().lower()
        if disable_flag in ("1", "true", "yes", "on"):
            self.disable_sam2_ui(lite_reason)
            return

        try:
            from sam2_interface import SAM2Interface
        except Exception as exc:
            self.disable_sam2_ui(f"{lite_reason} Import error: {exc}")
            return

        allow_cpu_sam2 = os.environ.get("SEGREF3D_ALLOW_SAM2_CPU", "").strip().lower() in (
            "1", "true", "yes", "on"
        )

        try:
            self.sam2_interface = SAM2Interface(allow_cpu_fallback=allow_cpu_sam2)
            self.sam2_enabled = bool(getattr(self.sam2_interface, "enabled", False))
        except Exception as exc:
            self.disable_sam2_ui(f"{lite_reason} Initialization error: {exc}")
            return

        if self.sam2_enabled:
            self.sam2_disabled_reason = None
            self.label_status.setText(self.sam2_interface.status_message)
        else:
            self.disable_sam2_ui(
                getattr(self.sam2_interface, "status_message", "Local SAM2 is unavailable.")
            )


    def ensure_local_sam2_available(self) -> bool:
        if self.sam2_enabled and self.sam2_interface is not None:
            return True
        self.label_status.setText("⚠ SAM2 is not included in this build.")
        if self.sam2_disabled_reason:
            print(f"[WARN] {self.sam2_disabled_reason}")
        return False


    def mask_to_qpath(self, mask):
        from skimage import measure

        path = QPainterPath()
        contours = measure.find_contours(mask.astype(np.uint8), 0.5)

        for contour in contours:
            if len(contour) < 2:
                continue
            path.moveTo(contour[0][1], contour[0][0])
            for y, x in contour[1:]:
                path.lineTo(x, y)

        return path
    
    def open_seg_on_web(self):
        import webbrowser
        webbrowser.open(
            "https://satorumuro.github.io/SAM2GUIfor3Drecon/ColabNotebooks/segonweb.html?v=48"
        )
        self.label_status.setText("Opening Seg on Web...")
            
    def open_instant3dweb(self):
        import webbrowser
        webbrowser.open(
            "https://satorumuro.github.io/SAM2GUIfor3Drecon/ColabNotebooks/instant3dweb.html?v=1"
        )
        self.label_status.setText("Opening Instant3DWeb...")        
        
    
    def extract_by_rgb(self):
        if not self.image_paths:
            self.label_status.setText("⚠ No images loaded.")
            return
    
        current_key = self.get_current_image_key()
    
        # 入力されたRGBと許容幅を取得
        target = np.array([
            self.spin_b.value(),
            self.spin_g.value(),
            self.spin_r.value()
        ])
        tol = self.spin_rgb_tol.value()
    
        lower = np.clip(target - tol, 0, 255)
        upper = np.clip(target + tol, 0, 255)
    
        for key, image_path in self.image_paths.items():
            img = cv2.imread(image_path)
            if img is None:
                print(f"[WARN] Failed to load image: {image_path}")
                continue
    
            mask = cv2.inRange(img, lower, upper)
    
            # マスク → QPainterPath
            qpath = self.mask_to_qpath(mask)
    
            # 現在の画像だけ画面に描画
            if key == current_key:
                path_item = QGraphicsPathItem()
                path_item.setPen(self.graphicsView.pen)
                path_item.setPath(qpath)
                self.scene.addItem(path_item)
    
            # マスク保存（Undo/Redo対応）
            self.save_drawn_path_for_image(key, qpath)
    
            print(f"[INFO] RGB mask extracted from {image_path} (key: {key})")
    
        self.label_status.setText("✅ RGB-based extraction completed for all images.")
    
    
    def enable_rgb_picker(self):
        self.label_status.setText("🎯 Click image to pick color.")
        self.graphicsView.setCursor(Qt.CursorShape.CrossCursor)
        self.graphicsView.mousePressEvent = self.pick_color_from_click
    
    def pick_color_from_click(self, event: QMouseEvent):
        scene_pos = self.graphicsView.mapToScene(event.pos())
        x, y = int(scene_pos.x()), int(scene_pos.y())
    
        key = self.get_current_image_key()
        if key and key in self.image_paths:
            img = cv2.imread(self.image_paths[key])
            if img is not None and 0 <= y < img.shape[0] and 0 <= x < img.shape[1]:
                b, g, r = img[y, x]
                self.spin_r.setValue(r)
                self.spin_g.setValue(g)
                self.spin_b.setValue(b)
                self.label_status.setText(f"🎯 Picked RGB: ({r}, {g}, {b})")
    
        # マウスイベントを戻す
        self.graphicsView.setCursor(Qt.CursorShape.ArrowCursor)
        self.graphicsView.mousePressEvent = self.graphicsView.__class__.mousePressEvent









    
    def thin_images_and_reload(self):
        if not self.image_pristine:
            self.label_status.setText("⚠ Please run thinning immediately after loading images, before any operations.")
            return

        

        
        
        factor = self.spin_thin_factor.value()
        if factor <= 1:
            self.label_status.setText("No thinning applied (factor = 1).")
            return
    
        now = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = os.path.join(os.getcwd(), f"thinned_images_{now}")
        os.makedirs(output_dir, exist_ok=True)
    
        # 🔽 数値列をすべて抽出し、naturalな並び順にソート
        image_items = sorted(
            self.image_paths.items(),
            key=lambda item: extract_all_numbers(item[0])
        )
    
        new_image_paths = {}
    
        for i, (key, path) in enumerate(image_items):
            if i % factor == 0:
                img = cv2.imread(path)
                if img is None:
                    continue
                new_name = f"{len(new_image_paths)+1:04d}.jpg"
                save_path = os.path.join(output_dir, new_name)
                cv2.imwrite(save_path, img)
                new_image_paths[new_name[:-4]] = save_path
    
        self.image_paths = new_image_paths
        self.current_index = 0
    
        if self.z_spacing_mm is not None:
            self.z_spacing_mm *= factor
    
        self.display_current_image()
        self.label_status.setText(f"✅ Thinned to every {factor} image(s). Total: {len(new_image_paths)} images.")
        
        
        
                
    def on_threshold_spinbox_changed(self):
        print("[DEBUG] spinbox changed")
        if self.ignore_spinbox_change:
            print("[DEBUG] Change ignored due to flag.")
            return
        print("[DEBUG] Set to Custom")
        if self.combo_threshold_preset.currentText() != "Custom":
            self.combo_threshold_preset.setCurrentText("Custom")
            
            


    
    import re
    
    def normalize_color(self, fill: str, style: str) -> str:
        import re
        def rgb_to_hex(rgb_str):
            match = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', rgb_str)
            if match:
                r, g, b = map(int, match.groups())
                return f'#{r:02x}{g:02x}{b:02x}'
            return rgb_str.strip().lower()

        color = ""
        if style and "fill:" in style:
            match = re.search(r'fill:([^;"]+)', style)
            if match:
                color = match.group(1).strip().lower()
        elif fill:
            color = fill.strip().lower()

        if color.startswith("rgb"):
            return rgb_to_hex(color)
        return color





    
    
    # def extract_object_mask_as_binary(self, key, object_index):
    #     """
    #     対象のSVGファイルから、指定されたオブジェクト番号のマスク領域をバイナリ画像として返す。
    #     """
    #     import cv2
    #     import numpy as np
    #     from PyQt6.QtGui import QImage, QPainter, QColor
    #     from PyQt6.QtCore import Qt
    #     from xml.etree import ElementTree as ET
    
    #     if key not in self.mask_paths:
    #         print(f"[WARN] No mask found for {key}")
    #         return None
    
    #     # ✅ 元画像サイズを使ってマスクサイズを決定
    #     if key not in self.image_paths:
    #         print(f"[WARN] No image path found for key: {key}")
    #         return None
    
    #     image_path = self.image_paths[key]
    #     img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    #     if img is None:
    #         print(f"[WARN] Failed to load image: {image_path}")
    #         return None
    
    #     height, width = img.shape
    
    #     # ✅ SVG 読み込み
    #     svg_path = self.mask_paths[key]
    #     tree = ET.parse(svg_path)
    #     root = tree.getroot()
    
    #     target_rgb = self.color_labels[object_index]
    #     target_hex = f'#{target_rgb[0]:02x}{target_rgb[1]:02x}{target_rgb[2]:02x}'
    
    #     image = QImage(width, height, QImage.Format.Format_Grayscale8)
    #     image.fill(0)
    
    #     painter = QPainter(image)
    #     painter.setBrush(QColor(255, 255, 255))
    #     painter.setPen(Qt.PenStyle.NoPen)
    
    #     for elem in root.iter("path"):
    #         fill = elem.attrib.get("fill", "").lower()
    #         if fill != target_hex:
    #             continue
    
    #         d_attr = elem.attrib.get("d")
    #         if not d_attr:
    #             continue
    
    #         path = self.svg_d_to_qpath(d_attr)
    #         painter.drawPath(path)
    
    #     painter.end()
    
    #     ptr = image.bits()
    #     ptr.setsize(image.width() * image.height())
    #     arr = np.array(ptr).reshape((image.height(), image.width()))
    #     return arr

                    
    def extract_object_mask_as_binary(self, key, object_index):
        """
        label_masks から、指定オブジェクト番号のバイナリマスクを返す。
        object_index は 0始まり（Obj1 -> 0）。
        戻り値は uint8 の 0/255。
        """
        if key not in self.image_paths:
            print(f"[WARN] No image path found for key: {key}")
            return None
    
        try:
            label_mask = self.ensure_label_mask_exists(key)
        except Exception as e:
            print(f"[WARN] Failed to get label mask for {key}: {e}")
            return None
    
        obj_id = object_index + 1
        binary = (label_mask == obj_id).astype(np.uint8) * 255
        return binary
        
    
    
    

    
    
    
    
    
    
    def apply_threshold_preset(self, preset_name):
        presets = {
            "CT Bone": (180, 255),
            "CT Soft Tissue": (80, 180),
            "CT Fat": (30, 80),
            "CT Air/Background": (0, 30),
            "MRI High Signal": (150, 255),
            "MRI Low Signal": (0, 60)
        }
    
        self.ignore_spinbox_change = True  # 🚫 一時的に変更検知を無視
    
        if preset_name in presets:
            min_val, max_val = presets[preset_name]
            self.spin_threshold_min.setValue(min_val)
            self.spin_threshold_max.setValue(max_val)
            self.label_status.setText(f"✅ Preset '{preset_name}' applied: Min={min_val}, Max={max_val}")
    



    
        elif preset_name == "Custom":
            self.label_status.setText("🛠 Custom mode: you can set thresholds manually.")
    
        else:
            self.label_status.setText("⚠ Unknown preset selected.")
    
        self.ignore_spinbox_change = False  # ✅ フラグ解除











    
    def svg_d_to_qpath(self, d_string):
        from PyQt6.QtGui import QPainterPath
        import re
    
        path = QPainterPath()
        tokens = re.findall(r"[-+]?\d*\.\d+|[-+]?\d+|[A-Za-z]", d_string)
        i = 0
        current_pos = None
        while i < len(tokens):
            cmd = tokens[i]
            if cmd == "M":
                x, y = float(tokens[i + 1]), float(tokens[i + 2])
                path.moveTo(x, y)
                current_pos = (x, y)
                i += 3
            elif cmd == "L":
                x, y = float(tokens[i + 1]), float(tokens[i + 2])
                path.lineTo(x, y)
                current_pos = (x, y)
                i += 3
            elif cmd == "Z":
                path.closeSubpath()
                i += 1
            else:
                i += 1
        return path




    
    def on_extract_overlap_clicked(self):
        key = self.get_current_image_key()
        if not key:
            self.label_status.setText("⚠ No image selected.")
            return
    
        idx1 = self.combo_overlap1.currentIndex()
        idx2 = self.combo_overlap2.currentIndex()
    
        if idx1 == idx2:
            self.label_status.setText("⚠ Please select two different objects.")
            return
    
        color1 = self.color_labels[idx1]
        color2 = self.color_labels[idx2]
    
        self.extract_overlap_between_objects(key, color1, color2)


    
    def extract_overlap_between_objects(self, key, color1_rgb, color2_rgb):
        if key not in self.mask_paths:
            print(f"[WARN] No SVG found for key {key}")
            return
    
        svg_path = self.mask_paths[key]
        tree = ET.parse(svg_path)
        root = tree.getroot()
    
        def rgb_to_hex(rgb):
            return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"
    
        color1_hex = rgb_to_hex(color1_rgb)
        color2_hex = rgb_to_hex(color2_rgb)
    
        path1 = QPainterPath()
        path2 = QPainterPath()
    
        for elem in root.iter("path"):
            fill = elem.attrib.get("fill", "").lower()
            if fill not in {color1_hex, color2_hex}:
                continue
    
            d = elem.attrib.get("d")
            if not d:
                continue
    
            qpath = self.svg_d_to_qpath(d)
            path_union = QPainterPath()
            for subpath in qpath.toSubpathPolygons():
                if subpath.size() >= 3:
                    sp = QPainterPath()
                    sp.moveTo(subpath[0])
                    for pt in subpath[1:]:
                        sp.lineTo(pt)
                    sp.closeSubpath()
                    path_union = path_union.united(sp)
    
            if fill == color1_hex:
                path1 = path1.united(path_union)
            elif fill == color2_hex:
                path2 = path2.united(path_union)
    
        intersection = path1.intersected(path2)
    
        if intersection.isEmpty():
            self.label_status.setText("⚠ No overlapping area found.")
            return
    
        item = QGraphicsPathItem(intersection)
        # item.setPen(QPen(Qt.GlobalColor.magenta, 2))
        item.setPen(QPen(self.graphicsView.pen_color, 2))  # ← ユーザー設定のペン色に統一
        item.setZValue(5)
        self.scene.addItem(item)
    
        # 保存（描画履歴）
        self.save_drawn_path_for_image(key, intersection)
        self.label_status.setText("✅ Overlap extracted and added to current image.")





    def on_extract_overlap_clicked_all(self):
        idx1 = self.combo_overlap1.currentIndex()
        idx2 = self.combo_overlap2.currentIndex()
    
        if idx1 == idx2:
            self.label_status.setText("⚠ Please select two different objects.")
            return
    
        color1 = self.color_labels[idx1]
        color2 = self.color_labels[idx2]
    
        self.save_svg_state_for_undo("__global__")  # Undoのために一括保存
    
        processed = 0
        for key in self.mask_paths.keys():
            self.extract_overlap_between_objects(key, color1, color2)
            processed += 1
    
        self.display_current_image()
        self.label_status.setText(f"✅ Overlap extraction completed for {processed} images.")

 

    
    # def change_draw_mode(self, mode):
    #     self.graphicsView.draw_mode = mode.lower()  # 'free' or 'click'
    #     self.label_status.setText(f"Draw mode: {mode}")
            
    def change_draw_mode(self, mode):
        if mode == "Click (Snap)":
            self.graphicsView.draw_mode = "click_snap"
        elif mode == "Click":
            self.graphicsView.draw_mode = "click"
        else:
            self.graphicsView.draw_mode = "free"
    
        self.label_status.setText(f"Draw mode: {self.graphicsView.draw_mode}")





    
    def start_box_prompt_mode(self):
        if not self.ensure_local_sam2_available():
            return

        self.box_mode = True
        self.box_points = []
        print("[DEBUG] start_box_prompt_mode called")

            
        # クロスヘア仮線の初期化
        self.temp_crosshair_hline = None
        self.temp_crosshair_vline = None        
    
        # 以前の仮ボックスが残っていれば削除
        if hasattr(self, "temp_box_item") and self.temp_box_item:
            self.scene.removeItem(self.temp_box_item)
            self.temp_box_item = None
            
     

                    
        # 🔸 確定ボックス削除（実線のやつ）
        if hasattr(self, "confirmed_box_item"):
            try:
                if self.confirmed_box_item is not None and self.confirmed_box_item.scene() is not None:
                    self.scene.removeItem(self.confirmed_box_item)
            except RuntimeError:
                print("[WARN] confirmed_box_item has been already deleted.")
            self.confirmed_box_item = None
            
    
    
        # 🔸 保存済みのボックス情報もリセット
        self.last_box_prompt = None
        self.last_used_box_px = None
        
        # 🔸 すべてのフレームのボックス情報もクリア
        self.box_per_frame.clear()
    
        self.label_status.setText("Click top-left and bottom-right corners to set box.")
        
    
    def clear_box(self):
        if not self.ensure_local_sam2_available():
            return

        # ✅ ボックスが表示されていれば削除
        if hasattr(self, "confirmed_box_item") and self.confirmed_box_item:
            self.scene.removeItem(self.confirmed_box_item)
            self.confirmed_box_item = None
    
        if hasattr(self, "temp_box_item") and self.temp_box_item:
            self.scene.removeItem(self.temp_box_item)
            self.temp_box_item = None
    
        # ✅ 状態を初期化
        self.box_points = []
        self.last_box_prompt = None
        self.last_used_box_px = None
        
        # ✅ すべてのフレーム上のボックス情報もクリア
        self.box_per_frame.clear()        
        
        self.label_status.setText("Box cleared.")






    
    def run_sam2_segmentation(self):
        if not self.ensure_local_sam2_available():
            return

        if not getattr(self, "sam2_enabled", False):
            message = getattr(self.sam2_interface, "status_message", "SAM2 is not available in this runtime.")
            self.label_status.setText(f"⚠ {message}")
            print(f"[WARN] {message}")
            return

        key = self.get_current_image_key()
        if key is None or key not in self.image_paths:
            print("[WARN] No image loaded.")
            return
    
        if not self.last_box_prompt:
            print("[WARN] No box prompt set.")
            return
    
        image_path = self.image_paths[key]
        image_pil = Image.open(image_path).convert("RGB")
        image_np = np.array(image_pil)
    
        # pxに変換
        width, height = image_pil.size
        top_left_percent, bottom_right_percent = self.last_box_prompt
        x1 = top_left_percent[0] * width / 100
        y1 = top_left_percent[1] * height / 100
        x2 = bottom_right_percent[0] * width / 100
        y2 = bottom_right_percent[1] * height / 100
        box = ((x1, y1), (x2, y2))
    
        print(f"[INFO] Running SAM2 on box: {box}")
        
             
                    
        def update_progress(percent):
            bar_length = 20  # バーの長さ（文字数）
            filled_length = int(bar_length * percent // 100)
            bar = '█' * filled_length + '-' * (bar_length - filled_length)
            self.label_status.setText(f"SAM2 segmentation... |{bar}| {percent}%")
            QApplication.processEvents()

        
        try:
            result_mask = self.sam2_interface.run_segmentation(image_np, box, progress_callback=update_progress)
        except Exception as e:
            self.label_status.setText(f"⚠ SAM2 segmentation failed: {e}")
            print(f"[ERROR] SAM2 segmentation failed: {e}")
            return
    
        # マスクから QPainterPath に変換して、描画＆保存
        qpath = self.mask_to_qpath(result_mask)
                
        # ✅ パスの簡略化（曲線が多すぎる問題を軽減）
        qpath = qpath.simplified()
 
        
                
        # QGraphicsPathItem を作成（ペン設定も一致させる）
        path_item = QGraphicsPathItem()
        path_item.setPen(self.graphicsView.pen)  # ✅ タッチペン描画と同じペン設定
        path_item.setPath(qpath)
        self.scene.addItem(path_item)
        
        # save_drawn_path にも登録（Undo/Redo対応）
        self.save_drawn_path(qpath)
    
        print("[INFO] SAM2 segmentation done and added to drawing.")
        
        
        
        
        
        # 🔸 表示されている確定ボックス（赤線）を削除
        if hasattr(self, "confirmed_box_item"):
            try:
                if self.confirmed_box_item is not None and self.confirmed_box_item.scene() is not None:
                    self.scene.removeItem(self.confirmed_box_item)
            except RuntimeError:
                print("[WARN] confirmed_box_item has been already deleted.")
            self.confirmed_box_item = None
        

        
        # 🔸 フレームごとのボックス情報も削除
        if hasattr(self, "last_used_box_index") and self.last_used_box_index in self.box_per_frame:
            del self.box_per_frame[self.last_used_box_index]

        
        
        
        
        # ✅ 仮ボックス（マウス移動中の点線）を削除
        if self.temp_box_item:
            self.scene.removeItem(self.temp_box_item)
            self.temp_box_item = None
        
        self.display_current_image()

        # 🔁 run_tracking() 用にボックス(px)も保存
        self.last_used_box_px = box

        print("[DEBUG] result_mask shape:", result_mask.shape)
        print("[DEBUG] result_mask dtype:", result_mask.dtype)
        print("[DEBUG] result_mask unique values:", np.unique(result_mask))






    
    def prepare_tracking_frames(self):
        if not self.ensure_local_sam2_available():
            return

        self.label_status.setText("📦 Preparing tracking frames...")
        QApplication.processEvents()
    
        video_dir = "./video_frames"
        if os.path.exists(video_dir):
            shutil.rmtree(video_dir)
        os.makedirs(video_dir)
    
        image_items = sorted(self.image_paths.items())  # ファイル名でソート
        total = len(image_items)
    
        for i, (name, path) in enumerate(image_items, 1):
            dst_filename = f"{i:04d}.jpg"
            dst_path = os.path.join(video_dir, dst_filename)
            shutil.copyfile(path, dst_path)
    
            # 🔁 進捗バー
            percent = int(i / total * 100)
            bar = "[" + "█" * (percent // 10) + " " * (10 - percent // 10) + "]"
            self.label_status.setText(f"📷 Preparing frames: {bar} {percent}%")
            QApplication.processEvents()
            time.sleep(0.01)
    
        self.label_status.setText("✅ Tracking frames ready.")


    
    def set_tracking_start(self):
        if not self.ensure_local_sam2_available():
            return

        self.tracking_start_index = self.current_image_index
        self.label_status.setText(f"Tracking Start set at frame {self.tracking_start_index + 1}")
    
    def set_tracking_end(self):
        if not self.ensure_local_sam2_available():
            return

        self.tracking_end_index = self.current_image_index
        self.label_status.setText(f"Tracking End set at frame {self.tracking_end_index + 1}")
    
    
    
        
    def hide_confirmed_box(self):
        if hasattr(self, "confirmed_box_item"):
            try:
                if self.confirmed_box_item and self.confirmed_box_item.scene():
                    self.scene.removeItem(self.confirmed_box_item)
            except RuntimeError:
                print("[WARN] confirmed_box_item has been already deleted.")
            self.confirmed_box_item = None  # 表示だけ消す。中身のbox情報は残す


    



    # def run_tracking(self):
    #     # 🔎 チェック：開始・終了フレーム
    #     if not hasattr(self, 'tracking_start_index') or not hasattr(self, 'tracking_end_index'):
    #         self.label_status.setText("Please set both start and end frames for tracking.")
    #         return
    
    #     if self.tracking_start_index > self.tracking_end_index:
    #         self.label_status.setText("Tracking start frame must be before end frame.")
    #         return
    
    #     self.label_status.setText(f"Tracking will run from frame {self.tracking_start_index + 1} to {self.tracking_end_index + 1}.")
    
    
    
    #     # ✅ ボックスプロンプト（px単位）を使用
    #     if not hasattr(self, 'last_used_box_px'):
    #         self.label_status.setText("⚠ Box prompt not set. Please run SAM2 segmentation first.")
    #         return
    #     box = self.last_used_box_px
    
    #     # 🟡 ポイントプロンプト（任意）
    #     point = self.last_used_point if hasattr(self, 'last_used_point') else None




        
    #     video_dir = "./video_frames"
    #     if not os.path.exists(video_dir):
    #         self.label_status.setText("⚠ Please run 'Prepare Tracking Frames' first.")
    #         return
            
    
    #     # 🔄 推論状態初期化（順方向）
    #     self.label_status.setText("📷 Loading frames into SAM2... Please wait.")
    #     QApplication.processEvents()
        
    #     predictor = self.sam2_interface.predictor
    #     inference_state = predictor.init_state(video_path=video_dir)
    #     predictor.reset_state(inference_state)
    
    #     # 🧠 初期画像の読み込み（順方向）
    #     box_frame_index = self.last_used_box_index  # ✅ ボックスを置いたフレーム
    #     frame_idx = box_frame_index
    #     sample_image = np.array(Image.open(os.path.join(video_dir, f"{frame_idx + 1:04d}.jpg")))
    #     h, w = sample_image.shape[:2]
    
    #     # ボックスとポイントの変換
    #     x1, y1 = int(box[0][0]), int(box[0][1])
    #     x2, y2 = int(box[1][0]), int(box[1][1])
    #     box_arr = np.array([x1, y1, x2, y2], dtype=np.float32)
    
    #     if point:
    #         x_p, y_p = int(point[0]), int(point[1])
    #         points = np.array([[x_p, y_p]], dtype=np.float32)
    #         labels = np.array([1], dtype=np.int32)
    #     else:
    #         points = None
    #         labels = None
    
    #     # ▶ 順方向の初期マスク設定
    #     predictor.add_new_points_or_box(
    #         inference_state=inference_state,
    #         frame_idx=frame_idx,
    #         obj_id=1,
    #         points=points,
    #         labels=labels,
    #         box=box_arr
    #     )
    
    #     print("[DEBUG] Forward inference_state object_ids:", inference_state.get("obj_ids", "N/A"))
    #     print(f"[DEBUG] Using box: {box}")
    #     print(f"[DEBUG] Converted to array: {box_arr}")
    
    #     # # ▶ 伝播上限
    #     # frame_limit = self.tracking_end_index
    #     # video_segments = {}
        
    #     # # ▶ 進捗バー準備（順方向）
    #     # total_forward = frame_limit - self.tracking_start_index + 1
                
    #     # ▶ 伝播上限
    #     frame_limit = self.tracking_end_index
    #     video_segments = {}
        
    #     # ▶ 進捗バー準備（順方向）
    #     total_forward = frame_limit - box_frame_index + 1
        
        
        
    #     current_forward = 0
        
        
        
        
    
    #     # ▶ 順方向の伝播
    #     for out_frame_idx, out_obj_ids, out_mask_logits in predictor.propagate_in_video(inference_state):
    #         if out_frame_idx > frame_limit:
    #             break
    #         video_segments[out_frame_idx] = {
    #             out_obj_id: (out_mask_logits[i] > 0.0).squeeze().cpu().numpy()
    #             for i, out_obj_id in enumerate(out_obj_ids)
    #         }
    
    #         # 🌟 進捗バー表示（順方向）
    #         current_forward += 1
    #         percent = int(current_forward / total_forward * 100)
    #         bar = "[" + "█" * (percent // 10) + "-" * (10 - percent // 10) + "]"
    #         self.label_status.setText(f"▶ Forward tracking {bar} {percent}%")
    #         QApplication.processEvents()
        


    
    #     # reversed_frame_indices = list(range(self.tracking_end_index, self.tracking_start_index - 1, -1))
    #     reversed_frame_indices = list(range(box_frame_index, self.tracking_start_index - 1, -1))




    #     reversed_video_dir = "./video_frames_reversed"
    #     if os.path.exists(reversed_video_dir):
    #         shutil.rmtree(reversed_video_dir)
    #     os.makedirs(reversed_video_dir)
    
    #     # for i, idx in enumerate(reversed_frame_indices):
    #     #     src = os.path.join(video_dir, f"{idx + 1:04d}.jpg")  # ffmpeg -start_number 1 に対応
    #     #     # dst = os.path.join(reversed_video_dir, f"{i:04d}.jpg")
    #     #     # ✅ 修正：ffmpeg で読み込めるよう 0001.jpg からスタート
    #     #     dst = os.path.join(reversed_video_dir, f"{i + 1:04d}.jpg")
    #     #     shutil.copyfile(src, dst)
        
    #     #存在確認追加            
    #     for i, idx in enumerate(reversed_frame_indices):
    #         src = os.path.join(video_dir, f"{idx + 1:04d}.jpg")  # ffmpeg -start_number 1 に対応
    #         dst = os.path.join(reversed_video_dir, f"{i + 1:04d}.jpg")
            
    #         if os.path.exists(src):
    #             shutil.copyfile(src, dst)
    #         else:
    #             print(f"[WARN] Skipping missing frame: {src}")            
    
    #     # 🔧 修正箇所: reversed ディレクトリで推論初期化
    #     reversed_inference_state = predictor.init_state(video_path=reversed_video_dir)
    #     predictor.reset_state(reversed_inference_state)
    
    #     # 🔧 修正箇所: reversed 側の frame_idx=0 に初期マスク設定
    #     predictor.add_new_points_or_box(
    #         inference_state=reversed_inference_state,
    #         frame_idx=0,
    #         obj_id=1,
    #         points=points,
    #         labels=labels,
    #         box=box_arr
    #     )
    
    #     # 🔧 修正箇所: reversed 側の順方向伝播
    #     reversed_video_segments = {}
                
    #     # ▶ 進捗バー準備（逆方向）
    #     total_backward = len(reversed_frame_indices)
    #     current_backward = 0        
        
    #     for out_frame_idx, out_obj_ids, out_mask_logits in predictor.propagate_in_video(reversed_inference_state):
    #         reversed_video_segments[out_frame_idx] = {
    #             out_obj_id: (out_mask_logits[i] > 0.0).squeeze().cpu().numpy()
    #             for i, out_obj_id in enumerate(out_obj_ids)
    #         }    
         
    #         # 🌟 進捗バー表示（逆方向）
    #         current_backward += 1
    #         percent = int(current_backward / total_backward * 100)
    #         bar = "[" + "█" * (percent // 10) + "-" * (10 - percent // 10) + "]"
    #         self.label_status.setText(f"◀ Backward tracking {bar} {percent}%")
    #         QApplication.processEvents()
                
    #     # 🔧 修正箇所: reversed の結果を本来のフレームインデックスにマッピング（正確）
    #     # for i, orig_frame_idx in enumerate(reversed_frame_indices[::-1]):  # 順番を元に戻す
    #     #     if orig_frame_idx not in video_segments:
    #     #         video_segments[orig_frame_idx] = reversed_video_segments.get(i, {})
        
    #     # 🔧 正しいマッピング：reversed_frame_indices[i] → reversed_video_segments[i]
    #     for i, orig_frame_idx in enumerate(reversed_frame_indices[::-1]):
    #         # reversed_video_segments の中身は i = 0 が reversed_frame_indices[0] に対応しているので
    #         reversed_index = total_backward - 1 - i
    #         if orig_frame_idx not in video_segments:
    #             video_segments[orig_frame_idx] = reversed_video_segments.get(reversed_index, {})



    #     # ▶ マスク適用・保存
    #     frame_names = list(self.image_paths.keys())
    
    #     for frame_idx, frame_name in enumerate(frame_names):
    #         if frame_idx > frame_limit:
    #             break
    
    #         if frame_idx in video_segments:
    #             segment_masks = video_segments[frame_idx]
    #             for obj_id, mask in segment_masks.items():
    #                 print(f"[DEBUG] Frame {frame_idx}, Obj {obj_id}, mask type: {type(mask)}")
    
    #                 if mask is None or not isinstance(mask, np.ndarray) or mask.ndim != 2 or not np.any(mask):
    #                     print(f"[WARN] Skipping frame {frame_idx}, obj_id {obj_id}: invalid mask")
    #                     continue
    
    #                 qpath = self.sam2_interface.mask_to_qpath(mask)
    #                 # ✅ パスの簡略化（曲線が多すぎる問題を軽減）
    #                 qpath = qpath.simplified()
                    
    #                 key = f"{frame_idx + 1:04d}"  # ffmpeg に合わせたファイル名対応
    
    #                 # 既存の描画があれば削除
    #                 if key in self.drawn_paths_per_image:
    #                     del self.drawn_paths_per_image[key]
    #                     print(f"[INFO] Previous path for frame {key} deleted.")
    
    #                 self.save_drawn_path_for_image(key, qpath)
    
    #     # ▶ 状態更新
        
    #     self.label_status.setText("✅ Tracking completed and masks applied to selected frames.")

        

        
    #     # 🔸 表示されている確定ボックス（赤線）を削除
    #     if hasattr(self, "confirmed_box_item"):
    #         try:
    #             if self.confirmed_box_item is not None and self.confirmed_box_item.scene() is not None:
    #                 self.scene.removeItem(self.confirmed_box_item)
    #         except RuntimeError:
    #             print("[WARN] confirmed_box_item has been already deleted.")
    #         self.confirmed_box_item = None
        
    #     # 🔸 ボックスの情報をすべてリセット
    #     self.last_box_prompt = None
    #     self.last_used_box_px = None
        
    #     # 🔸 フレームごとのボックス情報も削除
    #     if hasattr(self, "last_used_box_index") and self.last_used_box_index in self.box_per_frame:
    #         del self.box_per_frame[self.last_used_box_index]

            
            
            


    #     self.last_used_box_px = None
        
        
    #     self.display_current_image()
        
    
    def run_tracking(self):
        if not self.ensure_local_sam2_available():
            return

        # 🔎 チェック：開始・終了フレーム
        if not hasattr(self, 'tracking_start_index') or not hasattr(self, 'tracking_end_index'):
            self.label_status.setText("Please set both start and end frames for tracking.")
            return
    
        if self.tracking_start_index > self.tracking_end_index:
            self.label_status.setText("Tracking start frame must be before end frame.")
            return
    
        self.label_status.setText(
            f"Tracking will run from frame {self.tracking_start_index + 1} to {self.tracking_end_index + 1}."
        )
    
        # ✅ ボックスプロンプト（px単位）を使用
        if not hasattr(self, 'last_used_box_px'):
            self.label_status.setText("⚠ Box prompt not set. Please run SAM2 segmentation first.")
            return
        box = self.last_used_box_px
    
        # 🟡 ポイントプロンプト（任意）
        point = self.last_used_point if hasattr(self, 'last_used_point') else None
    
        video_dir = "./video_frames"
        if not os.path.exists(video_dir):
            self.label_status.setText("⚠ Please run 'Prepare Tracking Frames' first.")
            return
    
        # 🔄 推論状態初期化（順方向）
        self.label_status.setText("📷 Loading frames into SAM2... Please wait.")
        QApplication.processEvents()
    
        predictor = self.sam2_interface.predictor
        inference_state = predictor.init_state(video_path=video_dir)
        predictor.reset_state(inference_state)
    
        # 🧠 初期画像の読み込み（順方向）
        box_frame_index = self.last_used_box_index
        frame_idx = box_frame_index
        sample_image = np.array(Image.open(os.path.join(video_dir, f"{frame_idx + 1:04d}.jpg")))
        h, w = sample_image.shape[:2]
    
        # ボックスとポイントの変換
        x1, y1 = int(box[0][0]), int(box[0][1])
        x2, y2 = int(box[1][0]), int(box[1][1])
        box_arr = np.array([x1, y1, x2, y2], dtype=np.float32)
    
        if point:
            x_p, y_p = int(point[0]), int(point[1])
            points = np.array([[x_p, y_p]], dtype=np.float32)
            labels = np.array([1], dtype=np.int32)
        else:
            points = None
            labels = None
    
        # 単独trackingは Obj 1 に入れる
        obj_id = 1
        self.checkboxes[obj_id - 1].setChecked(True)
    
        predictor.add_new_points_or_box(
            inference_state=inference_state,
            frame_idx=frame_idx,
            obj_id=obj_id,
            points=points,
            labels=labels,
            box=box_arr
        )
    
        print("[DEBUG] Forward inference_state object_ids:", inference_state.get("obj_ids", "N/A"))
        print(f"[DEBUG] Using box: {box}")
        print(f"[DEBUG] Converted to array: {box_arr}")
    
        frame_limit = self.tracking_end_index
        video_segments = {}
    
        total_forward = frame_limit - box_frame_index + 1
        current_forward = 0
    
        # ▶ 順方向の伝播
        for out_frame_idx, out_obj_ids, out_mask_logits in predictor.propagate_in_video(inference_state):
            if out_frame_idx > frame_limit:
                break
            video_segments[out_frame_idx] = {
                out_obj_id: (out_mask_logits[i] > 0.0).squeeze().cpu().numpy()
                for i, out_obj_id in enumerate(out_obj_ids)
            }
    
            current_forward += 1
            percent = int(current_forward / total_forward * 100)
            bar = "[" + "█" * (percent // 10) + "-" * (10 - percent // 10) + "]"
            self.label_status.setText(f"▶ Forward tracking {bar} {percent}%")
            QApplication.processEvents()
    
        # ▶ 逆方向
        reversed_frame_indices = list(range(box_frame_index, self.tracking_start_index - 1, -1))
    
        reversed_video_dir = "./video_frames_reversed"
        if os.path.exists(reversed_video_dir):
            shutil.rmtree(reversed_video_dir)
        os.makedirs(reversed_video_dir)
    
        for i, idx in enumerate(reversed_frame_indices):
            src = os.path.join(video_dir, f"{idx + 1:04d}.jpg")
            dst = os.path.join(reversed_video_dir, f"{i + 1:04d}.jpg")
    
            if os.path.exists(src):
                shutil.copyfile(src, dst)
            else:
                print(f"[WARN] Skipping missing frame: {src}")
    
        reversed_inference_state = predictor.init_state(video_path=reversed_video_dir)
        predictor.reset_state(reversed_inference_state)
    
        predictor.add_new_points_or_box(
            inference_state=reversed_inference_state,
            frame_idx=0,
            obj_id=obj_id,
            points=points,
            labels=labels,
            box=box_arr
        )
    
        reversed_video_segments = {}
    
        total_backward = len(reversed_frame_indices)
        current_backward = 0
    
        for out_frame_idx, out_obj_ids, out_mask_logits in predictor.propagate_in_video(reversed_inference_state):
            reversed_video_segments[out_frame_idx] = {
                out_obj_id: (out_mask_logits[i] > 0.0).squeeze().cpu().numpy()
                for i, out_obj_id in enumerate(out_obj_ids)
            }
    
            current_backward += 1
            percent = int(current_backward / total_backward * 100)
            bar = "[" + "█" * (percent // 10) + "-" * (10 - percent // 10) + "]"
            self.label_status.setText(f"◀ Backward tracking {bar} {percent}%")
            QApplication.processEvents()
    
        # reversed 結果を統合
        for i, orig_frame_idx in enumerate(reversed_frame_indices[::-1]):
            reversed_index = total_backward - 1 - i
            if orig_frame_idx not in video_segments:
                video_segments[orig_frame_idx] = reversed_video_segments.get(reversed_index, {})
    
    
    
    
        # # ▶ マスク適用・保存
        # frame_names = list(self.image_paths.keys())
        # applied_count = 0
    
        # for frame_idx, frame_name in enumerate(frame_names):
        #     if frame_idx > frame_limit:
        #         break
    
        #     if frame_idx in video_segments:
        #         segment_masks = video_segments[frame_idx]
    
        #         for seg_obj_id, mask in segment_masks.items():
        #             print(f"[DEBUG] Frame {frame_idx}, Obj {seg_obj_id}, mask type: {type(mask)}")
    
        #             if seg_obj_id != obj_id:
        #                 continue
    
        #             if mask is None or not isinstance(mask, np.ndarray) or mask.ndim != 2 or not np.any(mask):
        #                 print(f"[WARN] Skipping frame {frame_idx}, obj_id {seg_obj_id}: invalid mask")
        #                 continue
    
        #             key = f"{frame_idx + 1:04d}"
    
        #             try:
        #                 label_mask = self.ensure_label_mask_exists(key)
    
        #                 if label_mask.shape != mask.shape:
        #                     print(f"[WARN] Shape mismatch at {key}: label={label_mask.shape}, mask={mask.shape}")
        #                     continue
    
        #                 if key in self.drawn_paths_per_image:
        #                     del self.drawn_paths_per_image[key]
        #                     print(f"[INFO] Previous path for frame {key} deleted.")
    
        #                 # tracking結果を直接 label mask に書き込む
        #                 label_mask[mask.astype(bool)] = obj_id
        #                 self.save_label_mask_png(key)
        #                 applied_count += 1
    
        #             except Exception as e:
        #                 print(f"[ERROR] Failed to apply tracking mask for {key}: {e}")

        
        # ▶ tracking結果を label mask には書き込まず、描画パスとして一時保存
        frame_names = list(self.image_paths.keys())
        applied_count = 0
        applied_frame_indices = []
        
        for frame_idx, frame_name in enumerate(frame_names):
            if frame_idx > frame_limit:
                break
        
            if frame_idx in video_segments:
                segment_masks = video_segments[frame_idx]
        
                for seg_obj_id, mask in segment_masks.items():
                    print(f"[DEBUG] Frame {frame_idx}, Obj {seg_obj_id}, mask type: {type(mask)}")
        
                    if seg_obj_id != obj_id:
                        continue
        
                    if mask is None or not isinstance(mask, np.ndarray) or mask.ndim != 2 or not np.any(mask):
                        print(f"[WARN] Skipping frame {frame_idx}, obj_id {seg_obj_id}: invalid mask")
                        continue
        
                    key = f"{frame_idx + 1:04d}"
        
                    try:
                        # mask -> QPainterPath に変換
                        mask_uint8 = (mask.astype(np.uint8) * 255)
                        qpath = self.mask_to_qpath(mask_uint8)
        
                        if qpath is None or qpath.isEmpty():
                            print(f"[WARN] Empty qpath for frame {key}")
                            continue
        
                        qpath = qpath.simplified()
        
                        # 既存の一時描画があれば置き換え
                        if key in self.drawn_paths_per_image:
                            del self.drawn_paths_per_image[key]
                            print(f"[INFO] Previous temporary path for frame {key} deleted.")
        
                        # label mask には書き込まず、手描きパスとして保存
                        self.save_drawn_path_for_image(key, qpath)
                        applied_frame_indices.append(frame_idx)
        
                        # 現在表示中の画像なら画面にも一時表示
                        current_key = self.get_current_image_key()
                        if key == current_key:
                            path_item = QGraphicsPathItem()
                            path_item.setPen(self.graphicsView.pen)
                            path_item.setPath(qpath)
                            path_item.setZValue(10)
                            self.scene.addItem(path_item)
        
                        applied_count += 1
        
                    except Exception as e:
                        print(f"[ERROR] Failed to store tracking path for {key}: {e}")
    
        self.label_status.setText(f"✅ Tracking complete ({applied_count} frames).")
    

        # 🔸 表示されている確定ボックス（赤線）を削除
        if hasattr(self, "confirmed_box_item"):
            try:
                if self.confirmed_box_item is not None and self.confirmed_box_item.scene() is not None:
                    self.scene.removeItem(self.confirmed_box_item)
            except RuntimeError:
                print("[WARN] confirmed_box_item has been already deleted.")
            self.confirmed_box_item = None
    
        # 🔸 ボックス情報をリセット
        self.last_box_prompt = None
        self.last_used_box_px = None
    
        if hasattr(self, "last_used_box_index") and self.last_used_box_index in self.box_per_frame:
            del self.box_per_frame[self.last_used_box_index]
    
        self.last_used_box_px = None
    
        # self.clear_all_paths()
        # self.display_current_image()
        if applied_frame_indices:
            self.current_index = min(applied_frame_indices)
        
        self.display_current_image()




        


    
    def add_object_prompt_for_batch(self):
        if not self.ensure_local_sam2_available():
            return


        
        if not hasattr(self, 'last_used_box_px'):
            self.label_status.setText("⚠ Box prompt not set.")
            return
        if not hasattr(self, 'tracking_start_index') or not hasattr(self, 'tracking_end_index'):
            self.label_status.setText("⚠ Start and End frame must be set.")
            return
    
        box = self.last_used_box_px
        point = self.last_used_point if hasattr(self, 'last_used_point') else None
        start_frame = self.tracking_start_index
        end_frame = self.tracking_end_index
    
        if len(self.batch_object_data) >= 20:
            self.label_status.setText("⚠ Max 20 objects allowed.")
            return
    
        self.batch_object_data.append({
            "box": box,
            "point": point,
            "start": start_frame,
            "end": end_frame,
            "box_frame": self.last_used_box_index  # ✅ 新規追加
        })
    
        self.label_status.setText(f"🧩 Object {len(self.batch_object_data)} added (Frame {start_frame+1}–{end_frame+1})")
        



    
    # def run_tracking_for_object(self, obj_id, box, point, start_frame, end_frame, box_frame):
    #     self.label_status.setText(f"📦 Tracking Object {obj_id}: Frame {start_frame+1}–{end_frame+1}")
    #     QApplication.processEvents()
    
    #     video_dir = "./video_frames"
    #     if not os.path.exists(video_dir):
    #         self.label_status.setText("⚠ Please run 'Prepare Tracking Frames' first.")
    #         return
    
    #     # 🔄 推論状態初期化（順方向）
    #     self.label_status.setText("📷 Loading frames into SAM2... Please wait.")
    #     QApplication.processEvents()
    
    #     predictor = self.sam2_interface.predictor
    #     inference_state = predictor.init_state(video_path=video_dir)
    #     predictor.reset_state(inference_state)
    
    #     # 初期画像の読み込み
    #     # frame_idx = start_frame
    #     frame_idx = box_frame

    #     sample_image = np.array(Image.open(os.path.join(video_dir, f"{frame_idx + 1:04d}.jpg")))
    #     h, w = sample_image.shape[:2]
    
    #     # ボックスとポイントの変換
    #     x1, y1 = int(box[0][0]), int(box[0][1])
    #     x2, y2 = int(box[1][0]), int(box[1][1])
    #     box_arr = np.array([x1, y1, x2, y2], dtype=np.float32)
    
    #     if point:
    #         x_p, y_p = int(point[0]), int(point[1])
    #         points = np.array([[x_p, y_p]], dtype=np.float32)
    #         labels = np.array([1], dtype=np.int32)
    #     else:
    #         points = None
    #         labels = None
    
    #     # 初期マスク指定
    #     predictor.add_new_points_or_box(
    #         inference_state=inference_state,
    #         frame_idx=frame_idx,
    #         obj_id=obj_id,
    #         points=points,
    #         labels=labels,
    #         box=box_arr
    #     )
    
    #     # frame_limit = end_frame
    #     # video_segments = {}
    #     # # total_forward = frame_limit - start_frame + 1
    #     # total_forward = end_frame - box_frame + 1

    #     # current_forward = 0
        
    #     # ▶ 伝播上限
    #     # frame_limit = self.tracking_end_index
    #     frame_limit = end_frame
    #     video_segments = {}
        
    #     # ▶ 進捗バー準備（順方向）
    #     total_forward = frame_limit - box_frame + 1
    #     current_forward = 0        
        
        
    
    #     for out_frame_idx, out_obj_ids, out_mask_logits in predictor.propagate_in_video(inference_state):
    #         if out_frame_idx > frame_limit:
    #             break
    #         video_segments[out_frame_idx] = {
    #             out_obj_id: (out_mask_logits[i] > 0.0).squeeze().cpu().numpy()
    #             for i, out_obj_id in enumerate(out_obj_ids)
    #         }
    
    #         current_forward += 1
    #         percent = int(current_forward / total_forward * 100)
    #         bar = "[" + "█" * (percent // 10) + "-" * (10 - percent // 10) + "]"
    #         self.label_status.setText(f"▶ Object {obj_id}: Forward {bar} {percent}%")
    #         QApplication.processEvents()
    
    #     # 逆方向
    #     # reversed_frame_indices = list(range(end_frame, start_frame - 1, -1))
    #     reversed_frame_indices = list(range(box_frame, start_frame - 1, -1))

    #     reversed_video_dir = "./video_frames_reversed"
    #     if os.path.exists(reversed_video_dir):
    #         shutil.rmtree(reversed_video_dir)
    #     os.makedirs(reversed_video_dir)
    
    #     for i, idx in enumerate(reversed_frame_indices):
    #         src = os.path.join(video_dir, f"{idx + 1:04d}.jpg")
    #         dst = os.path.join(reversed_video_dir, f"{i + 1:04d}.jpg")
    #         if os.path.exists(src):
    #             shutil.copyfile(src, dst)
    #         else:
    #             print(f"[WARN] Skipping missing frame: {src}")
    
    #     reversed_inference_state = predictor.init_state(video_path=reversed_video_dir)
    #     predictor.reset_state(reversed_inference_state)
    
    #     predictor.add_new_points_or_box(
    #         inference_state=reversed_inference_state,
    #         frame_idx=0,
    #         obj_id=obj_id,
    #         points=points,
    #         labels=labels,
    #         box=box_arr
    #     )
    
    #     reversed_video_segments = {}
    #     total_backward = len(reversed_frame_indices)
    #     current_backward = 0
    
    #     for out_frame_idx, out_obj_ids, out_mask_logits in predictor.propagate_in_video(reversed_inference_state):
    #         reversed_video_segments[out_frame_idx] = {
    #             out_obj_id: (out_mask_logits[i] > 0.0).squeeze().cpu().numpy()
    #             for i, out_obj_id in enumerate(out_obj_ids)
    #         }
    
    #         current_backward += 1
    #         percent = int(current_backward / total_backward * 100)
    #         bar = "[" + "█" * (percent // 10) + "-" * (10 - percent // 10) + "]"
    #         self.label_status.setText(f"◀ Object {obj_id}: Backward {bar} {percent}%")
    #         QApplication.processEvents()
    
    #     # # reversed → 正規順に戻す
    #     # for i, orig_frame_idx in enumerate(reversed_frame_indices[::-1]):
    #     #     reversed_index = total_backward - 1 - i  # ✅ 正しい順に戻す
    #     #     if orig_frame_idx not in video_segments:
    #     #         video_segments[orig_frame_idx] = reversed_video_segments.get(i, {})
            
    #     # ⬇ reversed_video_segments を正しい位置に統合する
    #     for out_frame_idx, masks in reversed_video_segments.items():
    #         # 対応する元のフレームインデックスを取得
    #         if out_frame_idx < len(reversed_frame_indices):
    #             orig_frame_idx = reversed_frame_indices[out_frame_idx]
    #             if orig_frame_idx not in video_segments:
    #                 video_segments[orig_frame_idx] = masks
    
    
    #     # マスク保存
    #     frame_names = list(self.image_paths.keys())
    #     for frame_idx, frame_name in enumerate(frame_names):
    #         if frame_idx > frame_limit:
    #             break
    #         if frame_idx in video_segments:
    #             segment_masks = video_segments[frame_idx]
    #             for seg_obj_id, mask in segment_masks.items():
    #                 if mask is None or not isinstance(mask, np.ndarray) or mask.ndim != 2 or not np.any(mask):
    #                     print(f"[WARN] Skipping frame {frame_idx}, obj_id {seg_obj_id}: invalid mask")
    #                     continue
    #                 qpath = self.sam2_interface.mask_to_qpath(mask)
    #                 # ✅ パスの簡略化（曲線が多すぎる問題を軽減）
    #                 qpath = qpath.simplified()
    #                 key = f"{frame_idx + 1:04d}"
    
    #                 if key in self.drawn_paths_per_image:
    #                     del self.drawn_paths_per_image[key]
    #                     print(f"[INFO] Previous path for frame {key} deleted.")
                    
    #                 # RGB → hex変換
    #                 def rgb_to_hex(rgb):
    #                     return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"
                    
    #                 # SVGファイルが存在するか確認
    #                 svg_path = self.mask_paths.get(key)
    #                 if svg_path and os.path.exists(svg_path):
    #                     try:
    #                         tree = ET.parse(svg_path)
    #                         root = tree.getroot()
                    
    #                         # QPainterPath → path d 文字列
    #                         polygons = qpath.toSubpathPolygons()
    #                         path_data = ""
    #                         for polygon in polygons:
    #                             if polygon.size() < 3:
    #                                 continue
    #                             path_data += "M " + " L ".join(f"{pt.x()},{pt.y()}" for pt in polygon) + " Z "
                    
    #                         # オブジェクトの色（obj_id）で fill 指定
    #                         obj_color_rgb = self.color_labels[obj_id - 1]  # 1-indexed
    #                         fill_color = rgb_to_hex(obj_color_rgb)
                    
    #                         new_elem = ET.Element("path")
    #                         new_elem.set("d", path_data.strip())
    #                         new_elem.set("fill", fill_color)
    #                         new_elem.set("stroke", "none")
    #                         new_elem.set("fill-rule", "evenodd")
    #                         root.append(new_elem)
                    
    #                         # 保存先を output_mask_dir に変更
    #                         save_path = os.path.join(self.output_mask_dir, os.path.basename(svg_path))
    #                         tree.write(save_path, encoding="utf-8")
                    
    #                         print(f"[INFO] Object {obj_id}: SVG path added to {save_path}")
                    
    #                         # UI再描画のため、drawn_paths にも qpath を保存
    #                         # self.drawn_paths_per_image[key] = [(qpath, fill_color)]
    #                         self.checkboxes[obj_id - 1].setChecked(True)
                    
    #                     except Exception as e:
    #                         print(f"[ERROR] Failed to write SVG path for {key}: {e}")


    
    #                 self.save_drawn_path_for_image(key, qpath)
    
    #     self.label_status.setText(f"✅ Object {obj_id}: Tracking complete.")
    #     self.clear_all_paths()



    
    def run_tracking_for_object(self, obj_id, box, point, start_frame, end_frame, box_frame):
        if not self.ensure_local_sam2_available():
            return

        self.label_status.setText(f"📦 Tracking Object {obj_id}: Frame {start_frame+1}–{end_frame+1}")
        QApplication.processEvents()
    
        video_dir = "./video_frames"
        if not os.path.exists(video_dir):
            self.label_status.setText("⚠ Please run 'Prepare Tracking Frames' first.")
            return
    
        # 🔄 推論状態初期化（順方向）
        self.label_status.setText("📷 Loading frames into SAM2... Please wait.")
        QApplication.processEvents()
    
        predictor = self.sam2_interface.predictor
        inference_state = predictor.init_state(video_path=video_dir)
        predictor.reset_state(inference_state)
    
        # 初期画像の読み込み
        frame_idx = box_frame
        sample_image = np.array(Image.open(os.path.join(video_dir, f"{frame_idx + 1:04d}.jpg")))
        h, w = sample_image.shape[:2]
    
        # ボックスとポイントの変換
        x1, y1 = int(box[0][0]), int(box[0][1])
        x2, y2 = int(box[1][0]), int(box[1][1])
        box_arr = np.array([x1, y1, x2, y2], dtype=np.float32)
    
        if point:
            x_p, y_p = int(point[0]), int(point[1])
            points = np.array([[x_p, y_p]], dtype=np.float32)
            labels = np.array([1], dtype=np.int32)
        else:
            points = None
            labels = None
    
        # 初期マスク指定
        predictor.add_new_points_or_box(
            inference_state=inference_state,
            frame_idx=frame_idx,
            obj_id=obj_id,
            points=points,
            labels=labels,
            box=box_arr
        )
    
        frame_limit = end_frame
        video_segments = {}
    
        total_forward = frame_limit - box_frame + 1
        current_forward = 0
    
        for out_frame_idx, out_obj_ids, out_mask_logits in predictor.propagate_in_video(inference_state):
            if out_frame_idx > frame_limit:
                break
            video_segments[out_frame_idx] = {
                out_obj_id: (out_mask_logits[i] > 0.0).squeeze().cpu().numpy()
                for i, out_obj_id in enumerate(out_obj_ids)
            }
    
            current_forward += 1
            percent = int(current_forward / total_forward * 100)
            bar = "[" + "█" * (percent // 10) + "-" * (10 - percent // 10) + "]"
            self.label_status.setText(f"▶ Object {obj_id}: Forward {bar} {percent}%")
            QApplication.processEvents()
    
        # 逆方向
        reversed_frame_indices = list(range(box_frame, start_frame - 1, -1))
    
        reversed_video_dir = "./video_frames_reversed"
        if os.path.exists(reversed_video_dir):
            shutil.rmtree(reversed_video_dir)
        os.makedirs(reversed_video_dir)
    
        for i, idx in enumerate(reversed_frame_indices):
            src = os.path.join(video_dir, f"{idx + 1:04d}.jpg")
            dst = os.path.join(reversed_video_dir, f"{i + 1:04d}.jpg")
            if os.path.exists(src):
                shutil.copyfile(src, dst)
            else:
                print(f"[WARN] Skipping missing frame: {src}")
    
        reversed_inference_state = predictor.init_state(video_path=reversed_video_dir)
        predictor.reset_state(reversed_inference_state)
    
        predictor.add_new_points_or_box(
            inference_state=reversed_inference_state,
            frame_idx=0,
            obj_id=obj_id,
            points=points,
            labels=labels,
            box=box_arr
        )
    
        reversed_video_segments = {}
        total_backward = len(reversed_frame_indices)
        current_backward = 0
    
        for out_frame_idx, out_obj_ids, out_mask_logits in predictor.propagate_in_video(reversed_inference_state):
            reversed_video_segments[out_frame_idx] = {
                out_obj_id: (out_mask_logits[i] > 0.0).squeeze().cpu().numpy()
                for i, out_obj_id in enumerate(out_obj_ids)
            }
    
            current_backward += 1
            percent = int(current_backward / total_backward * 100)
            bar = "[" + "█" * (percent // 10) + "-" * (10 - percent // 10) + "]"
            self.label_status.setText(f"◀ Object {obj_id}: Backward {bar} {percent}%")
            QApplication.processEvents()
    
        # ⬇ reversed_video_segments を正しい位置に統合
        for out_frame_idx, masks in reversed_video_segments.items():
            if out_frame_idx < len(reversed_frame_indices):
                orig_frame_idx = reversed_frame_indices[out_frame_idx]
                if orig_frame_idx not in video_segments:
                    video_segments[orig_frame_idx] = masks
    
        # マスク反映
        frame_names = list(self.image_paths.keys())
        applied_count = 0
    
        # tracking結果を見えるようにする
        self.checkboxes[obj_id - 1].setChecked(True)
    
        for frame_idx, frame_name in enumerate(frame_names):
            if frame_idx > frame_limit:
                break
    
            if frame_idx in video_segments:
                segment_masks = video_segments[frame_idx]
    
                for seg_obj_id, mask in segment_masks.items():
                    if seg_obj_id != obj_id:
                        continue
    
                    if mask is None or not isinstance(mask, np.ndarray) or mask.ndim != 2 or not np.any(mask):
                        print(f"[WARN] Skipping frame {frame_idx}, obj_id {seg_obj_id}: invalid mask")
                        continue
    
                    key = f"{frame_idx + 1:04d}"
    
                    try:
                        label_mask = self.ensure_label_mask_exists(key)
    
                        if label_mask.shape != mask.shape:
                            print(f"[WARN] Shape mismatch at {key}: label={label_mask.shape}, mask={mask.shape}")
                            continue
    
                        # 既存の描画があれば削除
                        if key in self.drawn_paths_per_image:
                            del self.drawn_paths_per_image[key]
                            print(f"[INFO] Previous path for frame {key} deleted.")
    
                        # tracking結果を直接 label mask に書き込む
                        label_mask[mask.astype(bool)] = obj_id
                        self.save_label_mask_png(key)
                        applied_count += 1
    
                    except Exception as e:
                        print(f"[ERROR] Failed to apply tracking mask for {key}: {e}")
    
        self.label_status.setText(f"✅ Object {obj_id}: Tracking complete ({applied_count} frames).")
        self.clear_all_paths()
        self.display_current_image()
    
        



    # def run_batch_tracking(self):
    #     if not self.batch_object_data:
    #         self.label_status.setText("⚠ No objects registered for batch tracking.")
    #         return
    
    #     for obj_idx, obj_info in enumerate(self.batch_object_data, 1):
    #         self.label_status.setText(f"🚀 Tracking object {obj_idx} (Frame {obj_info['start']+1}–{obj_info['end']+1})...")
    #         QApplication.processEvents()
    
    #         self.run_tracking_for_object(
    #             obj_id=obj_idx,
    #             box=obj_info["box"],
    #             point=obj_info["point"],
    #             start_frame=obj_info["start"],
    #             end_frame=obj_info["end"],
    #             box_frame=obj_info["box_frame"]  # ✅ これを追加
    #         )
    
    #     self.label_status.setText("✅ All batch tracking completed.")
                
        
                        
    #     # 🔸 表示されている確定ボックス（赤線）を削除
    #     if hasattr(self, "confirmed_box_item"):
    #         try:
    #             if self.confirmed_box_item is not None and self.confirmed_box_item.scene() is not None:
    #                 self.scene.removeItem(self.confirmed_box_item)
    #         except RuntimeError:
    #             print("[WARN] confirmed_box_item has been already deleted.")
    #         self.confirmed_box_item = None
        
    #     # 🔸 ボックスの情報をすべてリセット
    #     self.last_box_prompt = None
    #     self.last_used_box_px = None
        
    #     # 🔸 フレームごとのボックス情報をすべて削除（これが必要！）
    #     self.box_per_frame.clear()


            
            
        
    #     self.display_current_image()


    
    def run_batch_tracking(self):
        if not self.ensure_local_sam2_available():
            return

        if not self.batch_object_data:
            self.label_status.setText("⚠ No objects registered for batch tracking.")
            return
    
        for obj_idx, obj_info in enumerate(self.batch_object_data, 1):
            self.label_status.setText(
                f"🚀 Tracking object {obj_idx} (Frame {obj_info['start']+1}–{obj_info['end']+1})..."
            )
            QApplication.processEvents()
    
            self.run_tracking_for_object(
                obj_id=obj_idx,
                box=obj_info["box"],
                point=obj_info["point"],
                start_frame=obj_info["start"],
                end_frame=obj_info["end"],
                box_frame=obj_info["box_frame"]
            )
    
        self.label_status.setText("✅ All batch tracking completed.")
    
        # 確定ボックス削除
        if hasattr(self, "confirmed_box_item"):
            try:
                if self.confirmed_box_item is not None and self.confirmed_box_item.scene() is not None:
                    self.scene.removeItem(self.confirmed_box_item)
            except RuntimeError:
                print("[WARN] confirmed_box_item has been already deleted.")
            self.confirmed_box_item = None
    
        # ボックス情報リセット
        self.last_box_prompt = None
        self.last_used_box_px = None
        self.box_per_frame.clear()
    
        self.display_current_image()




        
    # def smart_undo(self):
    #     key = self.get_current_image_key()
    
    #     # ① 手描きパスのUndo（最優先）
    #     if key in self.drawn_paths_per_image and self.drawn_paths_per_image[key]:
    #         self.undo_last_path()
    #         print("[INFO] Ctrl+Z → undo_last_drawn_path done")
    #         return
    
    #     # ② 通常の1画像Undo（先にチェック）
    #     if key in self.undo_stack and self.undo_stack[key]:
    #         self.undo_edit(key)
    #         print("[INFO] Ctrl+Z → undo_svg_edit done")
    #         return
    
    #     # ③ 全画像対象のUndo（key="__global__" を渡す！）
    #     if "__global__" in self.undo_stack and self.undo_stack["__global__"]:
    #         self.undo_edit("__global__")
    #         print("[INFO] Ctrl+Z → undo_global_svg_edit done")
    #         return
    
    #     # ④ それでも何もなければ
    #     self.label_status.setText("Nothing to undo.")
    #     print("[INFO] Ctrl+Z → nothing to undo")
    
    def smart_undo(self):
        key = self.get_current_image_key()
    
        # ① 手描きパスのUndo（最優先）
        if key in self.drawn_paths_per_image and self.drawn_paths_per_image[key]:
            self.undo_last_path()
            print("[INFO] Ctrl+Z -> undo_last_drawn_path done")
            return
    
        # ② 通常の1画像Undo
        if key in self.undo_stack and self.undo_stack[key]:
            self.undo_edit(key)
            print("[INFO] Ctrl+Z -> undo_label_edit done")
            return
    
        # ③ 全画像対象のUndo
        if "__global__" in self.undo_stack and self.undo_stack["__global__"]:
            self.undo_edit("__global__")
            print("[INFO] Ctrl+Z -> undo_global_label_edit done")
            return
    
        # ④ 何もなければ
        self.label_status.setText("Nothing to undo.")
        print("[INFO] Ctrl+Z -> nothing to undo")

    def start_calibration(self):
        self.display_current_image()
        self.calibration_mode = True
        self.calibration_points = []
        self.label_status.setText("Click two points to draw calibration line.")







            
    def start_measurement_mode(self):
        self.measurement_mode = True
        self.measurement_points = []
    
        if self.temp_measurement_line_item:
            self.scene.removeItem(self.temp_measurement_line_item)
            self.temp_measurement_line_item = None
    
        self.label_status.setText("Click two points to measure distance.")


    
    def get_nifti_spacing_origin(self):
        """
        NIfTI出力用に X/Y/Z spacing と origin を取得する。
        volinf があればそれを優先し、なければ mm_per_px / z_spacing_mm を使う。
        """
        if hasattr(self, "volinf") and isinstance(self.volinf, dict):
            sx = float(self.volinf.get("x_spacing", self.mm_per_px if self.mm_per_px is not None else 1.0))
            sy = float(self.volinf.get("y_spacing", self.mm_per_px if self.mm_per_px is not None else sx))
            sz = float(self.volinf.get("z_spacing", self.z_spacing_mm if self.z_spacing_mm is not None else 1.0))
    
            ox = float(self.volinf.get("x_origin", 0.0))
            oy = float(self.volinf.get("y_origin", 0.0))
            oz = float(self.volinf.get("z_origin", 0.0))
        else:
            sx = float(self.mm_per_px) if self.mm_per_px is not None else 1.0
            sy = float(self.mm_per_px) if self.mm_per_px is not None else 1.0
            sz = float(self.z_spacing_mm) if self.z_spacing_mm is not None else 1.0
    
            ox = 0.0
            oy = 0.0
            oz = 0.0
    
        return sx, sy, sz, ox, oy, oz

    
    def load_volinf_csv(self):
        import csv
        import os
        from PyQt6.QtWidgets import QFileDialog
    
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Select VolInfo CSV",
            "",
            "CSV Files (*.csv)"
        )
    
        if not file_path:
            self.label_status.setText("VolInfo load canceled.")
            return
    
        try:
            with open(file_path, newline="", encoding="utf-8-sig") as f:
                rows = list(csv.reader(f))
    
            # 想定形式:
            # row0: Width, Height, Depth
            # row1: 540, 795, 138
            # row2: X Spacing, Y Spacing, Z Spacing
            # row3: 0.004985571, 0.004985571, 0.036
            # row4: X Origin, Y Origin, Z Origin
            # row5: 0, 0, 0
    
            if len(rows) < 4:
                raise ValueError("CSV must contain at least 4 rows.")
    
            header_spacing = [c.strip().lower() for c in rows[2]]
            values_spacing = rows[3]
    
            if not (
                len(header_spacing) >= 3
                and "x spacing" in header_spacing[0]
                and "y spacing" in header_spacing[1]
                and "z spacing" in header_spacing[2]
            ):
                raise ValueError("Could not find X/Y/Z Spacing row.")
    
            x_spacing = float(values_spacing[0])
            y_spacing = float(values_spacing[1])
            z_spacing = float(values_spacing[2])
    
            if x_spacing <= 0 or y_spacing <= 0 or z_spacing <= 0:
                raise ValueError("Spacing values must be positive.")
    
            # 現状の内部仕様は XY共通の mm_per_px
            if abs(x_spacing - y_spacing) > 1e-9:
                mm_per_px = (x_spacing + y_spacing) / 2.0
                print(
                    f"[WARN] X/Y spacing differ: X={x_spacing}, Y={y_spacing}. "
                    f"Using average={mm_per_px}"
                )
            else:
                mm_per_px = x_spacing
    
            self.mm_per_px = mm_per_px
            self.z_spacing_mm = z_spacing
    
            # GUI側のZ intervalにも反映
            if hasattr(self, "spin_z_interval"):
                self.spin_z_interval.setValue(float(z_spacing))
    
            # optional: volinf情報も保持
            self.volinf = {
                "width": int(float(rows[1][0])) if len(rows) > 1 and len(rows[1]) >= 1 else None,
                "height": int(float(rows[1][1])) if len(rows) > 1 and len(rows[1]) >= 2 else None,
                "depth": int(float(rows[1][2])) if len(rows) > 1 and len(rows[1]) >= 3 else None,
                "x_spacing": x_spacing,
                "y_spacing": y_spacing,
                "z_spacing": z_spacing,
                "x_origin": float(rows[5][0]) if len(rows) > 5 and len(rows[5]) >= 1 else 0.0,
                "y_origin": float(rows[5][1]) if len(rows) > 5 and len(rows[5]) >= 2 else 0.0,
                "z_origin": float(rows[5][2]) if len(rows) > 5 and len(rows[5]) >= 3 else 0.0,
                "source": file_path,
            }
    
            self.label_status.setText(
                f"✅ VolInfo loaded: XY={self.mm_per_px:.6f} mm/px, Z={self.z_spacing_mm:.6f} mm"
            )
    
            print(f"[INFO] Loaded VolInfo CSV: {os.path.basename(file_path)}")
            print(f"[INFO] X spacing: {x_spacing}")
            print(f"[INFO] Y spacing: {y_spacing}")
            print(f"[INFO] Z spacing: {z_spacing}")
            print(f"[INFO] mm_per_px used: {self.mm_per_px}")
            print(f"[INFO] z_spacing_mm used: {self.z_spacing_mm}")
    
        except Exception as e:
            self.label_status.setText(f"⚠ Failed to load VolInfo: {e}")
            print(f"[ERROR] Failed to load VolInfo CSV: {e}")


    
    def show_volinf(self):
        """
        現在保持している VolInfo / spacing 情報を短く表示する。
        """
    
        # volinf CSV が読み込まれている場合
        if hasattr(self, "volinf") and isinstance(self.volinf, dict):
            width = self.volinf.get("width", None)
            height = self.volinf.get("height", None)
            depth = self.volinf.get("depth", None)
    
            sx = self.volinf.get("x_spacing", None)
            sy = self.volinf.get("y_spacing", None)
            sz = self.volinf.get("z_spacing", None)
    
            ox = self.volinf.get("x_origin", 0.0)
            oy = self.volinf.get("y_origin", 0.0)
            oz = self.volinf.get("z_origin", 0.0)
    
            # UI表示は短く
            if width is not None and height is not None and depth is not None:
                self.label_status.setText(
                    f"VolInfo: {width}×{height}×{depth}, spacing {sx:.6g}×{sy:.6g}×{sz:.6g} mm"
                )
            else:
                self.label_status.setText(
                    f"VolInfo: spacing {sx:.6g}×{sy:.6g}×{sz:.6g} mm"
                )
    
            # 詳細はコンソールへ
            print("[INFO] Current VolInfo")
            print(f"  Size:   {width} x {height} x {depth}")
            print(f"  Spacing: X={sx}, Y={sy}, Z={sz}")
            print(f"  Origin:  X={ox}, Y={oy}, Z={oz}")
            print(f"  Source:  {self.volinf.get('source', 'N/A')}")
            return
    
        # volinf はないが、手動キャリブレーション値がある場合
        if self.mm_per_px is not None or self.z_spacing_mm is not None:
            xy = self.mm_per_px if self.mm_per_px is not None else 1.0
            z = self.z_spacing_mm if self.z_spacing_mm is not None else 1.0
    
            self.label_status.setText(
                f"Spacing: XY={xy:.6g} mm/px, Z={z:.6g} mm"
            )
    
            print("[INFO] Current spacing without VolInfo")
            print(f"  mm_per_px: {self.mm_per_px}")
            print(f"  z_spacing_mm: {self.z_spacing_mm}")
            return
    
        # 何も設定されていない場合
        self.label_status.setText("⚠ No VolInfo or spacing loaded.")
        print("[INFO] No VolInfo or spacing loaded.")
        

    def get_current_image_key(self):
        """現在の画像インデックスからキー（ファイル名）を取得"""
        keys = list(self.image_paths.keys())
        if 0 <= self.current_index < len(keys):
            return keys[self.current_index]
        return None



    def update_pen_color(self, color_name):
        if color_name == "Gray":
            color = Qt.GlobalColor.gray
        elif color_name == "White":
            color = Qt.GlobalColor.white
        elif color_name == "Black":
            color = Qt.GlobalColor.black
        else:
            color = Qt.GlobalColor.gray  # デフォルト fallback
    
        self.graphicsView.pen = QPen(color, 2)
        self.graphicsView.pen_color = color  # ✅ pen_colorも同期して更新

    


    
    def extract_by_threshold(self):
        if not self.image_paths:
            print("[WARN] No images loaded.")
            return
    
        min_val = self.spin_threshold_min.value()
        max_val = self.spin_threshold_max.value()
    
        current_key = self.get_current_image_key()
    
        for key, image_path in self.image_paths.items():
            try:
                image_pil = Image.open(image_path).convert("L")  # グレースケール
                image_np = np.array(image_pil)
    
                # 🎯 閾値処理
                mask = np.where((image_np >= min_val) & (image_np <= max_val), 255, 0).astype(np.uint8)
    
                # ✨ マスク → QPainterPath
                qpath = self.mask_to_qpath(mask)
    
                # ✏ 現在表示中の画像には画面にも描画
                if key == current_key:
                    path_item = QGraphicsPathItem()
                    path_item.setPen(self.graphicsView.pen)  # タッチペンと同じ設定
                    path_item.setPath(qpath)
                    self.scene.addItem(path_item)
    
                # 💾 Undo/Redo & SVG対応
                # self.save_drawn_path(qpath, key_override=key)
                self.save_drawn_path_for_image(key, qpath)

    
                print(f"[INFO] Extracted mask from {image_path} (key: {key})")
    
            except Exception as e:
                print(f"[WARN] Failed to process {image_path}: {e}")
    
        self.label_status.setText(f"✅ Threshold extraction completed for all images.")
    

        
    def extract_threshold_inside_object_current(self):
        key = self.get_current_image_key()
        if not key:
            self.label_status.setText("⚠ No current image selected.")
            return
    
        try:
            self.save_svg_state_for_undo(key)
            self._extract_threshold_inside_object_for_key(key)
            self.display_current_image()
            self.scene.update()
            self.label_status.setText("✅ Extracted threshold inside target object")
        except Exception as e:
            self.label_status.setText(f"⚠ Extract inside object failed: {e}")
    
    
    
    
    
    def extract_threshold_inside_object_all(self):
        if not self.image_paths:
            self.label_status.setText("⚠ No images loaded.")
            return
    
        processed = 0
    
        # 全画像Undo
        self.save_svg_state_for_undo("__global__")
    
        for key in sorted(self.image_paths.keys()):
            try:
                changed = self._extract_threshold_inside_object_for_key(key)
                if changed:
                    processed += 1
            except Exception as e:
                print(f"[WARN] Failed to extract inside object for {key}: {e}")
    
        self.display_current_image()
        self.scene.update()
        self.label_status.setText(
            f"✅ Extracted inside target object in {processed} image(s)"
        )
    
    
    def _extract_threshold_inside_object_for_key(self, key):
        """
        Target Object 内部だけで threshold 条件を満たす画素を抽出し、
        Transfer Target に書き込む。
        """
        if key not in self.image_paths:
            print(f"[WARN] No image path for key: {key}")
            return False
    
        src_id = self.combo_target_object.currentIndex() + 1
        dst_id = self.combo_transfer_target.currentIndex() + 1
    
        min_val = self.spin_threshold_min.value()
        max_val = self.spin_threshold_max.value()
    
        if min_val > max_val:
            min_val, max_val = max_val, min_val
    
        gray = cv2.imread(self.image_paths[key], cv2.IMREAD_GRAYSCALE)
        if gray is None:
            print(f"[WARN] Failed to load image: {self.image_paths[key]}")
            return False
    
        label_mask = self.ensure_label_mask_exists(key)
    
        if label_mask.shape != gray.shape:
            print(f"[WARN] Shape mismatch for {key}: label={label_mask.shape}, image={gray.shape}")
            return False
    
        inside_mask = (label_mask == src_id)
        threshold_mask = (gray >= min_val) & (gray <= max_val)
        result_mask = inside_mask & threshold_mask
    
        if not np.any(result_mask):
            print(f"[INFO] No threshold-positive pixels inside Obj {src_id} for {key}")
            return False
    
        # Undo用：current/allどちらでも呼べるようにここでは保存しない
        label_mask[result_mask] = dst_id
        self.save_label_mask_png(key)
    
        # 表示ON
        self.checkboxes[dst_id - 1].setChecked(True)
    
        pixel_count = int(np.count_nonzero(result_mask))
        print(
            f"[INFO] Extracted {pixel_count} px inside Obj {src_id} "
            f"to Obj {dst_id} for {key}"
        )
    
        return True


    
    def show_threshold_fraction_current(self):
        key = self.get_current_image_key()
        if not key:
            self.label_status.setText("⚠ No current image selected.")
            return
    
        try:
            label_mask = self.ensure_label_mask_exists(key)
    
            target_id = self.combo_target_object.currentIndex() + 1
            extracted_id = self.combo_transfer_target.currentIndex() + 1
    
            target_px = int(np.count_nonzero(label_mask == target_id))
            extracted_px = int(np.count_nonzero(label_mask == extracted_id))
    
            denominator_px = target_px + extracted_px
    
            if denominator_px == 0:
                self.label_status.setText(
                    f"⚠ Obj {target_id} + Obj {extracted_id} area is zero."
                )
                return
    
            fraction = extracted_px / denominator_px * 100.0
    
            # mm²換算できる場合
            if self.mm_per_px is not None:
                pixel_area_mm2 = self.mm_per_px ** 2
                target_area_mm2 = target_px * pixel_area_mm2
                extracted_area_mm2 = extracted_px * pixel_area_mm2
                total_area_mm2 = denominator_px * pixel_area_mm2
    
                self.label_status.setText(
                    f"Fraction Obj{extracted_id}/(Obj{target_id}+Obj{extracted_id}) = "
                    f"{fraction:.2f}% | Total {total_area_mm2:.2f} mm², "
                    f"Extracted {extracted_area_mm2:.2f} mm²"
                )
            else:
                self.label_status.setText(
                    f"Fraction Obj{extracted_id}/(Obj{target_id}+Obj{extracted_id}) = "
                    f"{fraction:.2f}% | Total {denominator_px} px, "
                    f"Extracted {extracted_px} px"
                )
    
        except Exception as e:
            self.label_status.setText(f"⚠ Failed to show fraction: {e}")






        
    def undo_last_path(self):
        key = f"{self.current_index + 1:04}"
        if key in self.drawn_paths_per_image and self.drawn_paths_per_image[key]:
            last_path = self.drawn_paths_per_image[key].pop()  # 最後のパスを取り出す
            self.redo_stack[key].append(last_path)             # 🔁 Redo用に保存
            self.display_current_image()
    
    def redo_last_path(self):
        key = self.get_current_image_key()
        if key in self.redo_stack and self.redo_stack[key]:
            restored_path = self.redo_stack[key].pop()
    
            # パス配列がなければ初期化
            if key not in self.drawn_paths_per_image:
                self.drawn_paths_per_image[key] = []
    
            self.drawn_paths_per_image[key].append(restored_path)
            self.display_current_image()
    
    def clear_current_path(self):
        key = self.get_current_image_key()
        if key in self.drawn_paths_per_image:
            self.drawn_paths_per_image[key] = []
            self.display_current_image()
    
    def clear_all_paths(self):
        for key in self.image_paths.keys():
            self.drawn_paths_per_image[key] = []
        self.display_current_image()

    # def clear_all_paths(self):
    #     key = f"{self.current_index + 1:04}"
    #     if key in self.drawn_paths_per_image:
    #         self.drawn_paths_per_image[key] = []
    #         self.display_current_image()




    
    def _create_empty_svg(self, svg_path, reference_image_path):
        from xml.etree.ElementTree import Element, SubElement, ElementTree
    
        # 画像サイズを取得
        with Image.open(reference_image_path) as img:
            width, height = img.size
    
        # SVGの基本構造を構築
        svg = Element("svg", xmlns="http://www.w3.org/2000/svg",
                      width=str(width), height=str(height),
                      viewBox=f"0 0 {width} {height}")
        tree = ElementTree(svg)
        tree.write(svg_path, encoding="utf-8", xml_declaration=True)
            
                
            
            
                    
    def _normalize_grayscale(self, array):
        arr = array.astype(np.float32)
        arr -= arr.min()
        arr /= (arr.max() + 1e-8)
        arr *= 255.0
        return arr.astype(np.uint8)
    







    
    def load_image_folder(self):
                
        # ✅ 既存の画像／マスク／描画パス／Undo情報などをすべてリセット
        self.image_paths.clear()
        self.mask_paths.clear()
        self.label_masks.clear()
        self.label_mask_paths.clear()
        self.drawn_paths_per_image.clear()
        self.undo_stack.clear()
        self.redo_stack.clear()
        self.modified_svg_trees.clear()
        self.path_elements_by_color.clear()
        self.pixmap_cache.clear()
        self.svg_renderer_cache.clear()
        
        self.current_index = 0
        self.drawing = False  # 念のため描画中もリセット

        import pathlib
        from PyQt6.QtWidgets import QFileDialog
        
        import re
        _num_re = re.compile(r'(\d+)')
        
        def _natural_key(s):
            """ 'image2.jpg' < 'image10.jpg' になるキー """
            # pathlib.Path やフルパスにも対応
            name = s.name if hasattr(s, "name") else s
            return [int(t) if t.isdigit() else t.lower() for t in re.split(_num_re, name)]
        
                
        # === INSERT: ヘルパー（CSVの値を丸めずに出す） ===
        def _fstr(x):
            try:
                return format(float(x), '.10g')  # 余計な丸めを避ける
            except Exception:
                return str(x)
        
        # === INSERT: DICOMシリーズから z spacing を頑健に推定 ===
        # ルール:
        #   1) ImagePositionPatient と ImageOrientationPatient からスライス法線を求め、
        #      その方向の位置差の中央値を z spacing とする
        #   2) (0018,0088) SpacingBetweenSlices がある場合はそれを優先（0や欠落は無視）
        #   3) それらがダメな場合の最後のフォールバックとして SliceThickness
        def _estimate_z_spacing_from_series(dicom_paths):
            import pydicom, math
            pos = []
            normals = []
        
            # 候補: SpacingBetweenSlices と SliceThickness
            spacing_between_slices = None
            slice_thickness = None
        
            for p in dicom_paths:
                try:
                    ds = pydicom.dcmread(p, stop_before_pixels=True, force=True)
                except Exception:
                    continue
        
                # 候補2：SpacingBetweenSlices
                sbs = getattr(ds, 'SpacingBetweenSlices', None)
                try:
                    if sbs is not None:
                        sbs = float(sbs)
                        if sbs > 0:
                            spacing_between_slices = sbs
                except Exception:
                    pass
        
                # 候補3：SliceThickness
                st = getattr(ds, 'SliceThickness', None)
                try:
                    if st is not None:
                        st = float(st)
                        if st > 0:
                            slice_thickness = st
                except Exception:
                    pass
        
                ipp = getattr(ds, 'ImagePositionPatient', None)       # [x,y,z]
                iop = getattr(ds, 'ImageOrientationPatient', None)    # [rx,ry,rz,cx,cy,cz]
                if ipp is None or iop is None or len(iop) < 6:
                    continue
        
                try:
                    rx, ry, rz, cx, cy, cz = map(float, iop[:6])
                    # 行ベクトル r と列ベクトル c の外積でスライス法線
                    nx = ry*cz - rz*cy
                    ny = rz*cx - rx*cz
                    nz = rx*cy - ry*cx
                    nlen = math.sqrt(nx*nx + ny*ny + nz*nz)
                    if nlen == 0:
                        continue
                    nx, ny, nz = nx/nlen, ny/nlen, nz/nlen
                    x, y, z = map(float, ipp[:3])
                    # スライス法線方向への射影スカラー(= 位置パラメータ)
                    t = x*nx + y*ny + z*nz
                    pos.append(t)
                    normals.append((nx, ny, nz))
                except Exception:
                    continue
        
            # 位置パラメータから隣接差分の中央値
            if len(pos) >= 2:
                pos_sorted = sorted(pos)
                diffs = [abs(pos_sorted[i+1] - pos_sorted[i]) for i in range(len(pos_sorted)-1)]
                diffs = [d for d in diffs if d > 1e-6]
                if diffs:
                    z_from_positions = float(sorted(diffs)[len(diffs)//2])  # median
                else:
                    z_from_positions = None
            else:
                z_from_positions = None
        
            # 優先順位で決定
            if spacing_between_slices is not None:
                return float(spacing_between_slices)
            if z_from_positions is not None:
                return float(z_from_positions)
            if slice_thickness is not None:
                return float(slice_thickness)
            return None
        
        
        
        # 1) フォルダ選択（ネイティブ）
        folder = QFileDialog.getExistingDirectory(self, "Select Image Folder")
        if folder:
            # ▶ フォルダが選ばれた：その中の対象ファイルを処理
            # selected_files = sorted(os.listdir(folder))
            selected_files = sorted(os.listdir(folder), key=_natural_key)
        else:
            # 2) キャンセル → ファイル選択（ネイティブ / 複数可）
            files, _ = QFileDialog.getOpenFileNames(
                self,
                "Select Image Files",
                "",
                "Images / Volumes (*.png *.jpg *.jpeg *.tif *.tiff *.bmp *.dcm *.nrrd *.nhdr);;All Files (*)"
            )
            if not files:
                return  # ここでもキャンセルなら終了
            # すべて同じフォルダ前提（異なる場合は先頭を基準にする）
            folder = os.path.dirname(files[0])
            # selected_files = [os.path.basename(p) for p in files]
            selected_files = sorted((os.path.basename(p) for p in files), key=_natural_key)

        
        input_folder = pathlib.Path(folder)
        
        # どの名前で出力フォルダを作るか決める
        if 'files' in locals() and files:        # ファイル選択の経路
            if len(files) == 1:
                out_name = pathlib.Path(files[0]).stem   # 例: Panoramix-cropped → Panoramix-croppedjpg
            else:
                out_name = input_folder.name             # 複数選択 → フォルダ名jpg
        else:
            out_name = input_folder.name                 # フォルダ選択 → フォルダ名jpg
        
        jpg_folder = pathlib.Path(os.getcwd()) / f"{out_name}jpg"
        jpg_folder.mkdir(exist_ok=True)   # ★必ず先に作っておく（ここが肝）
        
        print(f"[INFO] JPG output dir: {jpg_folder}")    # デバッグ表示（任意）
        
        valid_exts = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".dcm", ".nrrd", ".nhdr"}
        self.image_paths = {}
        self.image_sizes = {}
        
        
        next_idx = 1  # ★ 連番はここから開始（0001, 0002, ...）
        # 以降は selected_files をループ（拡張子でフィルタ）
        bmp_convert_preference = None
        num_converted = 0
        
        dcm_file_names = []   # ← これを for ループの直前に


        
        # ループの前に
        from pydicom.misc import is_dicom as _is_dicom
        
                
        # === INSERT === (DICOM 判定ヘルパー)
        from pydicom.misc import is_dicom as _is_dicom
        import pydicom
        
        def _looks_like_dicom(path: str) -> bool:
            """
            pydicom.misc.is_dicom にまず頼り、例外時や preamble なし DICOM のために
            先頭バイトの簡易判定も試す。
            """
            try:
                return _is_dicom(path)  # True/False
            except Exception:
                pass
        
            # 予備: 先頭132バイト確認（Part-10 preamble "DICM" or 一般的タグ先頭）
            try:
                with open(path, "rb") as f:
                    buf = f.read(132)
                if len(buf) < 132:
                    return False
                # 128–131: "DICM" があれば Part-10 形式
                if buf[128:132] == b"DICM":
                    return True
                # preamble 無し DICOM の可能性（タグのグループ番号っぽい）
                return (buf[0:2] in (b"\x02\x00", b"\x08\x00", b"\x10\x00"))
            except Exception:
                return False
        
        
        
        
        
        
        def _looks_like_dicom(path: str) -> bool:
            try:
                return _is_dicom(path)  # True/False
            except Exception:
                # 予備: 先頭132バイトを見て Part-10 or preambleなしDICOMをざっくり判定
                try:
                    with open(path, "rb") as f:
                        buf = f.read(132)
                    if len(buf) < 132:
                        return False
                    return (buf[128:132] == b"DICM") or (buf[0:2] in (b"\x02\x00", b"\x08\x00", b"\x10\x00"))
                except Exception:
                    return False


        for i, filename in enumerate(selected_files):
            
            
                            
            # === REPLACE === (拡張子だけで弾かず、DICOMらしさで拾う)
            input_path = os.path.join(folder, filename)
            ext = pathlib.Path(filename).suffix.lower()
            
            # 「DICOM らしい」かを先に判定（拡張子なし対応）
            is_dcm_candidate = (ext == ".dcm") or _looks_like_dicom(input_path)
            
            # 許可拡張子 or DICOM らしければ採用、それ以外はスキップ
            if (ext not in valid_exts) and (not is_dcm_candidate):
                continue
            
            # key = f"{i+1:04}"
            # output_jpg_path = os.path.join(jpg_folder, f"image{key}.jpg")
            key = f"{next_idx:04}"
            output_jpg_path = os.path.join(jpg_folder, f"image{key}.jpg")
            
            try:
                # ここから下は既存ロジックを活かしつつ DICOM 候補を先に処理
                if is_dcm_candidate:
                    dcm_file_names.append(input_path)
                    if not jpg_folder.exists():
                        jpg_folder.mkdir(exist_ok=True)
                    ds = pydicom.dcmread(input_path, force=True)
                    arr = ds.pixel_array
                    arr = self._normalize_grayscale(arr)
                    Image.fromarray(arr).convert("RGB").save(output_jpg_path, "JPEG")
                    # self.image_paths[key] = output_jpg_path
                    # self.image_sizes[key] = Image.open(output_jpg_path).size
                    # num_converted += 1
                    # continue
                    self.image_paths[key] = output_jpg_path
                    self.image_sizes[key] = Image.open(output_jpg_path).size
                    num_converted += 1
                    next_idx += 1   # ★ 採用したのでカウントアップ
                    continue                
            
                # --- ここから非 DICOM（NRRD/JPG/PNG/TIF/BMP など）の既存分岐へ ---
                
                
                
                    
                    
                
                    
                                    
                elif ext in (".nrrd", ".nhdr"):
                    if not jpg_folder.exists():
                        jpg_folder.mkdir(exist_ok=True)
                
                    # 1) 読み込み
                    data, header = nrrd.read(input_path)
                
                    # 2) 3D化（4Dは先頭チャネルのみ使用）
                    if data.ndim == 4:
                        data = data[..., 0]
                    elif data.ndim != 3:
                        raise ValueError(f"Unsupported NRRD shape: {data.shape} (expect 3D or 4D)")
                

                    
                    # 3) 並べ替え＋向き補正（JPG化の前）
                    space_dirs = header.get('space directions', None)
                    
                    def _as_vec3(v):
                        if v is None:
                            return None
                        try:
                            a = np.asarray(v, dtype=float).reshape(-1)
                            if a.size >= 3 and np.all(np.isfinite(a[:3])):
                                return a[:3]
                        except Exception:
                            pass
                        return None
                    
                    # numpy配列でも落ちないように長さの取り方を安全化
                    def _safe_len(x):
                        try:
                            return len(x)
                        except TypeError:
                            return 0
                    
                    if space_dirs is not None and _safe_len(space_dirs) >= 3:
                        v = [_as_vec3(space_dirs[i]) for i in range(3)]
                        axis_phys, axis_sign = [], []
                        for vi in v:
                            if vi is None:
                                axis_phys.append(None); axis_sign.append(1)
                            else:
                                k = int(np.argmax(np.abs(vi)))       # 0=X,1=Y,2=Z
                                s = 1 if vi[k] >= 0 else -1
                                axis_phys.append(k); axis_sign.append(s)
                        try:
                            # 目標 (Z,Y,X)
                            src_for_Z = axis_phys.index(2)
                            src_for_Y = axis_phys.index(1)
                            src_for_X = axis_phys.index(0)
                            perm = (src_for_Z, src_for_Y, src_for_X)
                            if perm != (0, 1, 2):
                                data = np.transpose(data, perm)
                            sign_after = [axis_sign[src_for_Z], axis_sign[src_for_Y], axis_sign[src_for_X]]
                            if sign_after[0] < 0: data = np.flip(data, axis=0)  # Z
                            if sign_after[1] < 0: data = np.flip(data, axis=1)  # Y
                            if sign_after[2] < 0: data = np.flip(data, axis=2)  # X
                        except ValueError:
                            pass
                    # else: フォールバックは何もしない
                    
                    # 並べ替え後の shape
                    num_slices = data.shape[0]
                    h, w = data.shape[1], data.shape[2]
                    
                    # ---- ここまで置き換え ----

                    
                    
                    
                    
                    
                    
                    
                
                    # 4) 並べ替え「後」の shape でサイズ取得（★ここも修正点）
                    num_slices = data.shape[0]          # Z
                    h, w = data.shape[1], data.shape[2] # Y, X
                
                    # 5) JPG 展開（★並べ替え後の data を使う）
                    # for s in range(num_slices):
                    #     key = f"{len(self.image_paths) + 1:04}"
                    #     output_jpg_path = os.path.join(jpg_folder, f"image{key}.jpg")
                    for s in range(num_slices):
                        key = f"{next_idx:04}"
                        output_jpg_path = os.path.join(jpg_folder, f"image{key}.jpg")                        
                        
                        slice_arr = data[s, :, :]
                        slice_arr = self._normalize_grayscale(slice_arr.astype(np.float32))
                        image = Image.fromarray(slice_arr).convert("RGB")
                        image.save(output_jpg_path, "JPEG")
                
                        # self.image_paths[key] = output_jpg_path
                        # self.image_sizes[key] = (w, h)
                        # num_converted += 1
                        self.image_paths[key] = output_jpg_path
                        self.image_sizes[key] = (w, h)
                        num_converted += 1
                        next_idx += 1   # ★ 1スライスごとに加算                        
                        
                
                    # 6) 体積情報（spacing / origin）をCSVに
                    def _norm(v):
                        try:
                            return float(np.linalg.norm(np.array(v, dtype=float)))
                        except Exception:
                            return None
                
                    sx = sy = sz = None
                    origin_x = origin_y = origin_z = None
                
                    if isinstance(space_dirs, (list, tuple)) and len(space_dirs) >= 3:
                        # 並べ替えターゲット (Z,Y,X) に合わせて [Z,Y,X] の順で長さを取る
                        sz = _norm(space_dirs[0])
                        sy = _norm(space_dirs[1])
                        sx = _norm(space_dirs[2])
                
                    if sx is None or sy is None or sz is None:
                        # spacings = header.get('spacings') or header.get('spaceorigin')
                        spacings = header.get('spacings') or header.get('space origin')
                        if isinstance(spacings, (list, tuple)) and len(spacings) >= 3:
                            sx, sy, sz = [float(spacings[0]), float(spacings[1]), float(spacings[2])]
                
                    origin = header.get('space origin')
                    if isinstance(origin, (list, tuple)) and len(origin) >= 3:
                        origin_x, origin_y, origin_z = [str(origin[0]), str(origin[1]), str(origin[2])]
                
                    volume_table = [
                        ["Width", "Height", "Depth"],
                        [str(w), str(h), str(num_slices)],
                        ["X Spacing", "Y Spacing", "Z Spacing"],
                        [str(sx) if sx is not None else "", str(sy) if sy is not None else "", str(sz) if sz is not None else ""],
                        ["X Origin", "Y Origin", "Z Origin"],
                        [origin_x or "", origin_y or "", origin_z or ""]
                    ]
                
                    self.mm_per_px = float(sx) if sx is not None else None
                    self.z_spacing_mm = float(sz) if sz is not None else None
                
                    csv_filename = f"{input_folder.name}_volinf.csv"
                    csv_path = os.path.join(os.getcwd(), csv_filename)
                    with open(csv_path, "w", newline="", encoding="utf-8") as f:
                        writer = csv.writer(f)
                        writer.writerows(volume_table)
                    print(f"[INFO] Volume info (NRRD) saved to: {csv_path}")
                    
                    
                    
                    
                    
                    
                
    
                elif ext == ".jpg" or ext == ".jpeg":
                    # そのまま利用
                    # self.image_paths[key] = input_path
                    # with Image.open(input_path) as im:
                    #     self.image_sizes[key] = im.size
                    self.image_paths[key] = input_path
                    with Image.open(input_path) as im:
                        self.image_sizes[key] = im.size
                    next_idx += 1   # ★ 採用時に加算
                    
    
                elif ext == ".bmp":
                    # 🔸 Only ask once when encountering the first BMP
                    if bmp_convert_preference is None:
                        reply = QMessageBox.question(
                            self,
                            "BMP Import",
                            "Do you want to convert BMP images to JPG before importing?\n"
                            "Selecting 'No' will import them as BMP without conversion.\n"
                            "(Cancel will abort the loading process.)",
                            QMessageBox.StandardButton.Yes
                            | QMessageBox.StandardButton.No
                            | QMessageBox.StandardButton.Cancel,
                            QMessageBox.StandardButton.Yes
                        )
                        if reply == QMessageBox.StandardButton.Cancel:
                            self.label_status.setText("❌ Image loading has been canceled.")
                            return
                        bmp_convert_preference = (reply == QMessageBox.StandardButton.Yes)
                
                    if bmp_convert_preference:
                        if not jpg_folder.exists():
                            jpg_folder.mkdir(exist_ok=True)
                        with Image.open(input_path) as im:
                            im = im.convert("RGB")
                            im.save(output_jpg_path, "JPEG")
                            self.image_paths[key] = output_jpg_path
                            self.image_sizes[key] = im.size
                        num_converted += 1
                        next_idx += 1   # ★
                        
                    else:
                        # Import as BMP without conversion
                        self.image_paths[key] = input_path
                        with Image.open(input_path) as im:
                            self.image_sizes[key] = im.size
                        next_idx += 1   # ★    
    
                else:
                    # PNG/TIFなどは従来通りJPGへ変換
                    if not jpg_folder.exists():
                        jpg_folder.mkdir(exist_ok=True)
                    with Image.open(input_path) as im:
                        im = im.convert("RGB")
                        im.save(output_jpg_path, "JPEG")
                        self.image_paths[key] = output_jpg_path
                        self.image_sizes[key] = im.size
                    num_converted += 1
                    next_idx += 1   # ★
    
            except Exception as e:
                print(f"[WARN] Failed to process {filename}: {e}")
                continue   # ← 追加
                
            
    
        total = len(self.image_paths)
        self.label_status.setText(f"Loaded {total} images (converted {num_converted} to JPG).")
        
        
        # ★★★ ここを追加：DICOMがあったのに全滅 or 0枚 → SimpleITK でシリーズ読込にフォールバック ★★★
        if total == 0 and dcm_file_names:
            try:
                import SimpleITK as sitk
                reader = sitk.ImageSeriesReader()
                series_ids = reader.GetGDCMSeriesIDs(folder)
                if series_ids:
                    file_names = reader.GetGDCMSeriesFileNames(folder, series_ids[0])
                    reader.SetFileNames(file_names)
                    image = reader.Execute()
                    arr = sitk.GetArrayFromImage(image)  # (Z,Y,X)
                    Z, H, W = arr.shape
                    # for s in range(Z):
                    #     key2 = f"{len(self.image_paths)+1:04}"
                    #     out2 = os.path.join(jpg_folder, f"image{key2}.jpg")
                    for s in range(Z):
                        key = f"{next_idx:04}"
                        out2 = os.path.join(jpg_folder, f"image{key}.jpg")                        
                        sl = self._normalize_grayscale(arr[s, :, :].astype(np.float32))
                        Image.fromarray(sl).convert("RGB").save(out2, "JPEG")
                        # self.image_paths[key2] = out2
                        # self.image_sizes[key2] = (W, H)
                        # num_converted += 1
                        # next_idx += 1   # ★
                        self.image_paths[key] = out2
                        self.image_sizes[key] = (W, H)
                        num_converted += 1
                        next_idx += 1   # ★                        
        
                    # spacing / origin を保存（CSVは後段の代表DICOMブロックで出力される）
                    sx, sy, sz = image.GetSpacing()   # (sx, sy, sz)
                    ox, oy, oz = image.GetOrigin()
                    self.mm_per_px = float(sx)
                    self.z_spacing_mm = float(sz)
                    total = len(self.image_paths)
                    self.label_status.setText(f"Loaded {total} images via SimpleITK fallback (converted {num_converted} to JPG).")
                else:
                    print("[WARN] SimpleITK: no DICOM series IDs found.")
            except Exception as e:
                print(f"[WARN] SimpleITK fallback failed: {e}")
        
        # ★★★ KeyError('0001') 対策：0枚ならここで安全に戻る ★★★
        if len(self.image_paths) == 0:
            QMessageBox.warning(
                self, "No images loaded",
                "No images could be loaded.\n"
                "Files may be invalid/unsupported or all failed to parse."
            )
            return
        
        
        
        
        
        self.current_index = 0
 
        # 🔽 output_mask_dir を初期化
        now = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.output_mask_dir = os.path.join(os.getcwd(), f"masks_{now}")
        os.makedirs(self.output_mask_dir, exist_ok=True)
    
        # 🔽 空のSVGを生成して mask_paths に登録
        for key, img_path in self.image_paths.items():
            svg_filename = f"mask{key}.svg"
            svg_path = os.path.join(self.output_mask_dir, svg_filename)
            self._create_empty_svg(svg_path, img_path)
            self.mask_paths[key] = svg_path
            
        
        # === INSERT (ループの外) ===
        # 🔽 代表DICOMからボリューム情報をCSVに（可能なら）…を 1 回だけ書く
        csv_filename = f"{input_folder.name}_volinf.csv"
        csv_path = os.path.join(os.getcwd(), csv_filename)
        
        
        
        
        # def _write_vol_csv(width, height, depth, sx, sy, sz, ox, oy, oz):
        #     table = [
        #         ["Width", "Height", "Depth"], [str(width), str(height), str(depth)],
        #         ["X Spacing", "Y Spacing", "Z Spacing"], [str(sx), str(sy), str(sz)],
        #         ["X Origin", "Y Origin", "Z Origin"], [str(ox), str(oy), str(oz)]
        #     ]
        #     with open(csv_path, "w", newline="", encoding="utf-8") as f:
        #         csv.writer(f).writerows(table)
        # def _write_vol_csv(width, height, depth, sx, sy, sz, ox, oy, oz):
        #     def _fmt(v):
        #         try:
        #             f = float(v)
        #             # 小数点以下3桁固定表示
        #             return f"{f:.3f}"
        #         except Exception:
        #             return str(v)
        
        #     table = [
        #         ["Width", "Height", "Depth"],
        #         [str(width), str(height), str(depth)],
        #         ["X Spacing", "Y Spacing", "Z Spacing"],
        #         [_fmt(sx), _fmt(sy), _fmt(sz)],
        #         ["X Origin", "Y Origin", "Z Origin"],
        #         [_fmt(ox), _fmt(oy), _fmt(oz)],
        #     ]
        #     with open(csv_path, "w", newline="", encoding="utf-8") as f:
        #         csv.writer(f).writerows(table)
        def _write_vol_csv(width, height, depth, sx, sy, sz, ox, oy, oz):
            table = [
                ["Width", "Height", "Depth"], [str(width), str(height), str(depth)],
                ["X Spacing", "Y Spacing", "Z Spacing"], [_fstr(sx), _fstr(sy), _fstr(sz)],
                ["X Origin", "Y Origin", "Z Origin"], [_fstr(ox), _fstr(oy), _fstr(oz)]
            ]
            with open(csv_path, "w", newline="", encoding="utf-8") as f:
                csv.writer(f).writerows(table)
            print(f"[INFO] Volume info saved to: {csv_path}")                
                
                
                
            print(f"[INFO] Volume info saved to: {csv_path}")
        
        w = h = d = 0
        sx = sy = sz = None
        ox = oy = oz = 0.0
        
        # すでに SimpleITK フォールバックで spacing が入っていればそれを使う
        if getattr(self, "mm_per_px", None) is not None and getattr(self, "z_spacing_mm", None) is not None:
            first_key = sorted(self.image_paths.keys())[0]
            w, h = self.image_sizes[first_key]
            d = len(self.image_paths)
            sx = float(self.mm_per_px); sy = float(self.mm_per_px); sz = float(self.z_spacing_mm)
            _write_vol_csv(w, h, d, sx, sy, sz, ox, oy, oz)
        else:
            # 拡張子なし DICOM も拾う（_looks_like_dicom を既に実装済み前提）
            # all_files = sorted(os.listdir(folder))
            all_files = sorted(os.listdir(folder), key=_natural_key)

            dcm_like_paths = [
                os.path.join(folder, f)
                for f in all_files
                if (f.lower().endswith(".dcm") or _looks_like_dicom(os.path.join(folder, f)))
            ]
            if dcm_like_paths:
                try:
                    ds0 = pydicom.dcmread(dcm_like_paths[0], force=True)
                    w = int(getattr(ds0, "Columns", 0) or 0)
                    h = int(getattr(ds0, "Rows", 0) or 0)
                    d = len(dcm_like_paths)
                    px = getattr(ds0, "PixelSpacing", [1.0, 1.0])
                    sx = float(px[0]) if px else 1.0
                    sy = float(px[1]) if px else 1.0
                    sz = float(getattr(ds0, "SliceThickness", 1.0) or 1.0)
                    ipp = getattr(ds0, "ImagePositionPatient", [0.0, 0.0, 0.0])
                    ox, oy, oz = float(ipp[0]), float(ipp[1]), float(ipp[2])
                    self.mm_per_px = sx
                    self.z_spacing_mm = sz
                                        
                    # === INSERT: z spacing を再推定して上書き ===
                    try:
                        z_est = _estimate_z_spacing_from_series(dcm_like_paths)
                        if z_est and z_est > 0:
                            sz = float(z_est)
                            self.z_spacing_mm = sz
                    except Exception as _e:
                        print(f"[WARN] z-spacing estimation failed: {_e}")
                  
                    _write_vol_csv(w, h, d, sx, sy, sz, ox, oy, oz)
                except Exception:
                    # SimpleITK フォールバック
                    try:
                        import SimpleITK as sitk
                        reader = sitk.ImageSeriesReader()
                        series_ids = reader.GetGDCMSeriesIDs(folder)
                        if series_ids:
                            file_names = reader.GetGDCMSeriesFileNames(folder, series_ids[0])
                            reader.SetFileNames(file_names)
                            image = reader.Execute()
                            Z, H, W = sitk.GetArrayFromImage(image).shape
                            w, h, d = W, H, Z
                            sx, sy, sz = image.GetSpacing()
                            ox, oy, oz = image.GetOrigin()
                            self.mm_per_px = float(sx)
                            self.z_spacing_mm = float(sz)
                                                        
                            # === INSERT: z spacing を再推定して上書き（SITK後） ===
                            try:
                                z_est = _estimate_z_spacing_from_series(dcm_like_paths)
                                if z_est and z_est > 0:
                                    sz = float(z_est)
                                    self.z_spacing_mm = sz
                            except Exception as _e:
                                print(f"[WARN] z-spacing estimation (after SITK) failed: {_e}")
                            
                            
                            
                            
                            
                            _write_vol_csv(w, h, d, sx, sy, sz, ox, oy, oz)
                        else:
                            raise RuntimeError("No DICOM series IDs")
                    except Exception as e2:
                        print(f"[WARN] Failed to extract volume info: {e2}")
                 
            
                        
                
                
                
    
        self.image_pristine = True
        self.display_current_image()
        self.fit_view_to_window()
        
        self.label_status.setText("✅ Images loaded. Use mouse wheel, PageUp/PageDown, F/R, or J/U to switch images.")

            
            
    def fit_view_to_window(self):
        self.graphicsView.fitInView(self.scene.itemsBoundingRect(), Qt.AspectRatioMode.KeepAspectRatio)
        self.label_status.setText("✅ View fitted to window.")            


    
    
    # def load_mask_folder(self):
    #     import os, shutil
    #     from datetime import datetime
    #     from xml.etree import ElementTree as ET
    #     from PyQt6.QtWidgets import QFileDialog, QMessageBox
    
    #     folder = QFileDialog.getExistingDirectory(self, "Select Mask Folder")
    #     if not folder:
    #         return
    
    #     incoming = self.load_files_from_folder(folder, [".svg"])
    #     if not incoming:
    #         self.label_status.setText("No SVGs in the selected folder.")
    #         return
    
    #     # --- Replace or Merge? ---
    #     box = QMessageBox(self)
    #     box.setWindowTitle("Import SVGs")
    #     box.setText("How do you want to import the SVG masks?")
    #     btn_replace = box.addButton("Replace all", QMessageBox.ButtonRole.AcceptRole)
    #     btn_merge   = box.addButton("Merge / Append", QMessageBox.ButtonRole.ActionRole)
    #     box.addButton(QMessageBox.StandardButton.Cancel)
    #     box.exec()
    #     if box.clickedButton() is None:
    #         return
    #     mode = "replace" if box.clickedButton() is btn_replace else \
    #            ("merge" if box.clickedButton() is btn_merge else None)
    #     if mode is None:
    #         self.label_status.setText("Import canceled.")
    #         return
    
    #     # --- Ensure output folder ---
    #     if not hasattr(self, "output_mask_dir") or not os.path.exists(self.output_mask_dir):
    #         now = datetime.now().strftime("%Y%m%d_%H%M%S")
    #         self.output_mask_dir = os.path.join(os.getcwd(), f"masks_{now}")
    #         os.makedirs(self.output_mask_dir, exist_ok=True)
    
    #     # Replace = clear only our bookkeeping (実ファイルは残っていてもOK)
    #     if mode == "replace":
    #         self.mask_paths.clear()
    
    #     # Palette (allowed colors) lowercased hex for cleaning
    #     allowed_colors = {f"#{r:02x}{g:02x}{b:02x}".lower() for r, g, b in self.color_labels}
    
    #     # --- helper: append paths from add_svg into base_svg (no recolor) ---
    #     def _append_svg_paths(base_svg: str, add_svg: str) -> bool:
    #         try:
    #             base_tree = ET.parse(base_svg); base_root = base_tree.getroot()
    #             add_root  = ET.parse(add_svg).getroot()
    
    #             for el in add_root.iter():
    #                 tag = el.tag.lower()
    #                 if not tag.endswith("path"):
    #                     continue
    #                 d = el.attrib.get("d")
    #                 if not d:
    #                     continue
    #                 # keep only allowed fills
    #                 fill = self._normalize_color(el.attrib.get("fill", ""),
    #                                              el.attrib.get("style", "")).lower()
    #                 if not fill or fill not in allowed_colors:
    #                     continue
    
    #                 new_el = ET.Element("path")
    #                 new_el.set("d", d)
    #                 new_el.set("fill", fill)
    #                 if "fill-rule" in el.attrib:
    #                     new_el.set("fill-rule", el.attrib.get("fill-rule"))
    #                 # drop stroke/style to avoid outlines
    #                 # (SegRef 側で塗りのみ扱うため)
    #                 # ※ new_el には stroke/style を付けない
    #                 base_root.append(new_el)
    
    #             base_tree.write(base_svg, encoding="utf-8")
    #             return True
    #         except Exception as e:
    #             print(f"[WARN] merge failed {base_svg} <- {add_svg}: {e}")
    #             return False
    
    #     # --- import loop ---
    #     for key, src_path in incoming.items():
    #         dst_path = os.path.join(self.output_mask_dir, f"mask{key}.svg")
    
    #         if mode == "replace" or not os.path.exists(dst_path):
    #             # copy and clean to allowed palette
    #             shutil.copy2(src_path, dst_path)
    #             self._clean_svg_colors(dst_path, allowed_colors)
    #         else:
    #             # merge (append) into existing file; if failed, fall back to replace
    #             if not _append_svg_paths(dst_path, src_path):
    #                 shutil.copy2(src_path, dst_path)
    #                 self._clean_svg_colors(dst_path, allowed_colors)
    
    #         self.mask_paths[key] = dst_path
    
    #     # refresh
    #     if hasattr(self, "svg_renderer_cache"):
    #         self.svg_renderer_cache.clear()
    #     self.display_current_image()
    #     self.update_checkboxes_based_on_used_colors()
    #     self.label_status.setText(
    #         f"Imported {len(incoming)} SVGs ({'replaced' if mode=='replace' else 'merged'})."
    #     )
    
    def load_mask_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Mask Folder")
        if not folder:
            return
    
        # いったんクリア
        self.label_masks.clear()
        self.label_mask_paths.clear()
    
        # 移行期間なので SVG と PNG の両方を許可
        mask_files = sorted([
            f for f in os.listdir(folder)
            if f.lower().endswith(".png") or f.lower().endswith(".svg")
        ])
    
        if not mask_files:
            self.label_status.setText("⚠ No PNG or SVG mask files found.")
            return
    
        loaded_count = 0
    
        for filename in mask_files:
            src_path = os.path.join(folder, filename)
    
            nums = re.findall(r'\d+', filename)
            if nums:
                key = f"{int(nums[-1]):04d}"
            else:
                loaded_count += 1
                key = f"{loaded_count:04d}"
    
            try:
                if filename.lower().endswith(".png"):
                    self.load_label_mask_png(key, src_path)
    
                elif filename.lower().endswith(".svg"):
                    self.load_svg_as_label_mask(key, src_path)
    
                loaded_count += 1
    
            except Exception as e:
                print(f"[WARN] Failed to load mask {filename}: {e}")
    
        if loaded_count == 0:
            self.label_status.setText("⚠ Failed to load any masks.")
            return
    
        # self.label_status.setText(f"✅ Loaded {loaded_count} mask(s) into label map.")
        # self.display_current_image()    
        self.update_checkboxes_based_on_used_colors()
        self.display_current_image()
        self.label_status.setText(f"✅ Loaded {loaded_count} mask(s). Autosaved label PNGs to: {self.output_label_dir}")    
    
    
    
    
    def _clean_svg_colors(self, svg_path: str, allowed_colors: set[str]) -> None:
        """許可色以外の要素を削除（従来処理を関数化）。"""
        from xml.etree import ElementTree as ET
        try:
            tree = ET.parse(svg_path)
            root = tree.getroot()
            to_remove = []
            for elem in root.iter():
                fill = elem.attrib.get("fill", "")
                style = elem.attrib.get("style", "")
                color = self._normalize_color(fill, style)  # 既存関数
                if color and color not in allowed_colors:
                    to_remove.append(elem)
            for e in to_remove:
                parent = self._find_parent(root, e)
                if parent is not None:
                    parent.remove(e)
            tree.write(svg_path, encoding="utf-8")
        except Exception as e:
            print(f"[WARN] Failed to clean {svg_path}: {e}")

    
    # 追加: パレットを #rrggbb の小文字で返す
    def _palette_hex(self) -> list[str]:
        return [f"#{r:02x}{g:02x}{b:02x}" for (r, g, b) in self.color_labels]

        
    def _get_used_colors_hex(self) -> set[str]:
        used: set[str] = set()
        for p in self.mask_paths.values():
            try:
                root = ET.parse(p).getroot()
                for el in root.iter():
                    hx = _extract_fill_hex(el)  # style="fill:..", rgb(..), #rrggbb に対応
                    if hx:
                        used.add(hx.lower())
            except Exception as e:
                print(f"[WARN] parse failed: {p}: {e}")
        return used

    
    def _merge_svg_files(
        self,
        base_svg: str,
        add_svg: str,
        allowed_colors: set[str],
        used_colors_hex: set[str],
        collision_mode: str | None = None,  # "overlay" or "recolor"
    ) -> tuple[set[str], str | None]:
        """
        base_svg に add_svg の path を追記してマージ。
        色衝突があればユーザーに「重ねる/再配色」を一度だけ尋ねる。
        戻り値: (更新後の使用中カラー集合, 決定した collision_mode)
        """
        from xml.etree import ElementTree as ET
    
        base_tree = ET.parse(base_svg); base_root = base_tree.getroot()
        add_tree  = ET.parse(add_svg);  add_root  = add_tree.getroot()
        
        allowed_colors = {c.lower() for c in allowed_colors}
        used_colors_hex = {c.lower() for c in used_colors_hex}    
    
        # Obj1=赤のHEX
        obj1_rgb = self.color_labels[0]
        obj1_hex = f"#{obj1_rgb[0]:02x}{obj1_rgb[1]:02x}{obj1_rgb[2]:02x}"
    
        # 追加側の有効色を収集（TS赤をObj1へ正規化）
        incoming_elems: list[ET.Element] = []
        incoming_colors: list[str] = []
    
        for el in list(add_root.iter()):
            if not el.tag.lower().endswith("path"):
                continue
            # 色を正規化
            fill = self._normalize_color(el.attrib.get("fill", ""), el.attrib.get("style", ""))
            if not fill:
                continue
            if fill in ("#ff0000", "rgb(255,0,0)"):
                fill = obj1_hex
            fill = fill.lower()
            if fill not in allowed_colors:
                continue
    
            # path 複製（d は必須）
            if "d" not in el.attrib:
                continue
            new_el = ET.Element(el.tag)
            new_el.set("d", el.attrib["d"])
            new_el.set("fill", fill)
            new_el.set("fill-rule", el.attrib.get("fill-rule", "evenodd"))
            # stroke等は消す
            for k in ("stroke", "stroke-width", "style"):
                if k in new_el.attrib:
                    new_el.attrib.pop(k, None)
    
            incoming_elems.append(new_el)
            incoming_colors.append(fill)
    
        if not incoming_elems:
            return used_colors_hex, collision_mode
    
        # 衝突検出
        distinct_incoming = list(dict.fromkeys(incoming_colors))  # 順序保持のユニーク
        collisions = [c for c in distinct_incoming if c in used_colors_hex]
    
        # 必要なら、1回だけユーザーに方針を聞く
        if collisions and collision_mode is None:
            box = QMessageBox(self)
            box.setWindowTitle("Color collision")
            cols = ", ".join(collisions[:5]) + ("..." if len(collisions) > 5 else "")
            box.setText(f"Some incoming object colors are already used ({cols}).")
            btn_overlay = box.addButton("Overlay as-is", QMessageBox.ButtonRole.AcceptRole)
            btn_recolor = box.addButton("Recolor incoming", QMessageBox.ButtonRole.ActionRole)
            box.addButton(QMessageBox.StandardButton.Cancel)
            box.exec()
            if box.clickedButton() is None:
                return used_colors_hex, collision_mode
            collision_mode = "overlay" if box.clickedButton() is btn_overlay else \
                             ("recolor" if box.clickedButton() is btn_recolor else None)
            if collision_mode is None:
                return used_colors_hex, None  # cancel
    
        # 再配色が選ばれたら、空いている色へ順次割り当て
        color_map: dict[str, str] = {}
        if collisions and collision_mode == "recolor":
            palette = [f"#{r:02x}{g:02x}{b:02x}" for (r, g, b) in self.color_labels]
            free_pool = [hx.lower() for hx in palette if hx.lower() not in used_colors_hex]
            if not free_pool:
                QMessageBox.information(self, "Info", "No free object colors left. Overlaying as-is.")
                collision_mode = "overlay"
            else:
                it = iter(free_pool)
                for c in collisions:
                    try:
                        color_map[c] = next(it)
                    except StopIteration:
                        color_map[c] = free_pool[-1]            
            
            
            # free_pool = [
            #     f"#{r:02x}{g:02x}{b:02x}".lower()
            #     for (r, g, b) in self.color_labels
            #     if f"#{r:02x}{g:02x}{b:02x}".lower() not in used_colors_hex
            # ]
            # if not free_pool:
            #     QMessageBox.information(self, "Info",
            #                             "No free object colors left. Overlaying as-is.")
            #     collision_mode = "overlay"
            # else:
            #     it = iter(free_pool)
            #     for c in collisions:
            #         try:
            #             color_map[c] = next(it)
            #         except StopIteration:
            #             # 空きが尽きたら最後の色を使い回し
            #             color_map[c] = free_pool[-1]
                        
                        
                        
                        
    
        # 追記（必要に応じて色を置換）
        added_colors = set()
        for new_el in incoming_elems:
            fill = new_el.attrib.get("fill", "").lower()
            if collision_mode == "recolor" and fill in color_map:
                new_el.set("fill", color_map[fill])
                fill = color_map[fill]
            base_root.append(new_el)
            added_colors.add(fill)
    
        base_tree.write(base_svg, encoding="utf-8")
    
        # 使用中カラー集合を更新
        used_colors_hex = set(used_colors_hex) | set(added_colors)
        return used_colors_hex, collision_mode



    #黒背景を消すための
    def _normalize_color(self, fill, style):
        def rgb_to_hex(rgb_str):
            match = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', rgb_str)
            if match:
                r, g, b = map(int, match.groups())
                return f'#{r:02x}{g:02x}{b:02x}'
            return rgb_str.strip().lower()
    
        color = ""
        if style and "fill:" in style:
            match = re.search(r'fill:([^;"]+)', style)
            if match:
                color = match.group(1).strip().lower()
        elif fill:
            color = fill.strip().lower()
    
        if color.startswith("rgb"):
            return rgb_to_hex(color)
        return color
    
    def _find_parent(self, root, target):
        for parent in root.iter():
            if target in list(parent):
                return parent
        return None





            

    def load_files_from_folder(self, folder, extensions):
        files = {}
        for file in sorted(os.listdir(folder)):
            if any(file.lower().endswith(ext) for ext in extensions):
                key = os.path.splitext(file)[0][-4:]  # 末尾4桁（例：0001）
                files[key] = os.path.join(folder, file)
        return files



    
    

    




    
    
    def _collect_used_color_hexes(self) -> set[str]:
        """現在 self.mask_paths にある全SVGから使用中の #rrggbb を集める"""
        used: set[str] = set()
        for svg_path in self.mask_paths.values():
            try:
                root = ET.parse(svg_path).getroot()
                for el in root.iter():
                    hx = _extract_fill_hex(el)   # ← モジュール関数を呼ぶ
                    if hx:
                        used.add(hx)
            except Exception as e:
                print(f"[WARN] parse failed: {svg_path}: {e}")
        return used    
    
    
    
        
    # def update_checkboxes_based_on_used_colors(self):
    #     # いったん全OFF
    #     for cb in self.checkboxes:
    #         cb.setChecked(False)
    
    #     # 既存SVGから使われている色(hex)を厳密に収集
    #     used_hex = set()
    #     for svg_path in self.mask_paths.values():
    #         try:
    #             root = ET.parse(svg_path).getroot()
    #             for el in root.iter():
    #                 hx = _extract_fill_hex(el)  # style="fill:..." / rgb(...) / #rrggbb 全対応
    #                 if hx:
    #                     used_hex.add(hx.lower())
    #         except Exception:
    #             continue
    
    #     # 定義色に対応するチェックをON
    #     for i, (r, g, b) in enumerate(self.color_labels):
    #         hx = f"#{r:02x}{g:02x}{b:02x}"
    #         self.checkboxes[i].setChecked(hx in used_hex)
    
    # def update_checkboxes_based_on_used_colors(self):
    #     # いったん全OFF
    #     for cb in self.checkboxes:
    #         cb.setChecked(False)
    
    #     used_hex = self._get_used_colors_hex()  # ← SVGから厳密取得
    #     for i, (r, g, b) in enumerate(self.color_labels):
    #         hx = f"#{r:02x}{g:02x}{b:02x}"
    #         self.checkboxes[i].setChecked(hx in used_hex)
                
    def update_checkboxes_based_on_used_colors(self):
        """
        現在使用中のオブジェクトを検出してチェックボックスをONにする。
        新方式の label_masks を優先し、必要に応じて旧SVG方式にも対応する。
        """
    
        # いったん全OFF
        for cb in self.checkboxes:
            cb.setChecked(False)
    
        used_ids = set()
    
        # ✅ 新方式：label_masks から使用中 object id を取得
        if hasattr(self, "label_masks") and self.label_masks:
            for key, label_mask in self.label_masks.items():
                try:
                    if label_mask is None:
                        continue
    
                    vals = np.unique(label_mask)
    
                    for v in vals:
                        v = int(v)
                        if 1 <= v <= len(self.color_labels):
                            used_ids.add(v)
    
                except Exception as e:
                    print(f"[WARN] Failed to inspect label mask for {key}: {e}")
    
        # ✅ 旧方式：SVGしかない場合の fallback
        if not used_ids and hasattr(self, "_get_used_colors_hex"):
            try:
                used_hex = self._get_used_colors_hex()
                for i, (r, g, b) in enumerate(self.color_labels, start=1):
                    hx = f"#{r:02x}{g:02x}{b:02x}"
                    if hx in used_hex:
                        used_ids.add(i)
            except Exception as e:
                print(f"[WARN] Failed to inspect SVG colors: {e}")
    
        # 使用中objectだけON
        for obj_id in used_ids:
            self.checkboxes[obj_id - 1].setChecked(True)
    
        print(f"[INFO] Used object IDs: {sorted(used_ids)}")            
            
            


        
    # def save_svg_as(self):
    #     folder_path = QFileDialog.getExistingDirectory(
    #         self, "Select Folder to Save SVGs"
    #     )
    
    #     if not folder_path:
    #         self.label_status.setText("Save canceled.")
    #         return
    
    #     count = 0
    #     for key, svg_path in self.mask_paths.items():
    #         if os.path.exists(svg_path):
    #             dst_path = os.path.join(folder_path, f"mask{key}.svg")
    #             shutil.copyfile(svg_path, dst_path)
    #             count += 1
    
    #     self.label_status.setText(f"{count} SVGs saved to: {folder_path}")

    
    # def save_svg_as(self):
    #     folder_path = QFileDialog.getExistingDirectory(
    #         self, "Select Folder to Save Label PNGs"
    #     )
    
    #     if not folder_path:
    #         self.label_status.setText("Save canceled.")
    #         return
    
    #     count = 0
    
    #     # 画像順で保存
    #     for key in sorted(self.image_paths.keys()):
    #         try:
    #             label_mask = self.ensure_label_mask_exists(key)
    #             dst_path = os.path.join(folder_path, f"mask{key}.png")
    
    #             ok = cv2.imwrite(dst_path, label_mask)
    #             if ok:
    #                 self.label_mask_paths[key] = dst_path
    #                 count += 1
    #             else:
    #                 print(f"[WARN] Failed to save: {dst_path}")
    
    #         except Exception as e:
    #             print(f"[WARN] Failed to save mask for {key}: {e}")
    
    #     self.label_status.setText(f"✅ {count} label PNGs saved to: {folder_path}")

    
    # def save_svg_as(self):
    #     folder_path = QFileDialog.getExistingDirectory(
    #         self, "Select Folder to Save Label PNGs"
    #     )
    
    #     if not folder_path:
    #         self.label_status.setText("Save canceled.")
    #         return
    
    #     count_label = 0
    #     count_preview = 0
    
    #     for key in sorted(self.image_paths.keys()):
    #         try:
    #             label_mask = self.ensure_label_mask_exists(key)
    
    #             # 1) 正本の label PNG を保存
    #             label_dst_path = os.path.join(folder_path, f"mask{key}.png")
    #             ok_label = cv2.imwrite(label_dst_path, label_mask)
    #             if ok_label:
    #                 count_label += 1
    #             else:
    #                 print(f"[WARN] Failed to save label PNG: {label_dst_path}")
    
    #             # 2) 閲覧用の color preview PNG を保存
    #             h, w = label_mask.shape
    #             preview = np.zeros((h, w, 3), dtype=np.uint8)  # BGR
    
    #             for obj_id, (r, g, b) in enumerate(self.color_labels, start=1):
    #                 mask = (label_mask == obj_id)
    #                 if np.any(mask):
    #                     preview[mask] = (b, g, r)  # OpenCVはBGR
    
    #             preview_dst_path = os.path.join(folder_path, f"preview_mask{key}.png")
    #             ok_preview = cv2.imwrite(preview_dst_path, preview)
    #             if ok_preview:
    #                 count_preview += 1
    #             else:
    #                 print(f"[WARN] Failed to save preview PNG: {preview_dst_path}")
    
    #         except Exception as e:
    #             print(f"[WARN] Failed to save mask for {key}: {e}")
    
    #     self.label_status.setText(
    #         f"✅ Saved {count_label} label PNGs and {count_preview} preview PNGs to: {folder_path}"
    #     )        
                    
    def save_svg_as(self):
        root_folder = QFileDialog.getExistingDirectory(
            self, "Select Folder to Save Masks"
        )
    
        if not root_folder:
            self.label_status.setText("Save canceled.")
            return
    
        label_folder = os.path.join(root_folder, "label_png")
        preview_folder = os.path.join(root_folder, "preview_png")
        os.makedirs(label_folder, exist_ok=True)
        os.makedirs(preview_folder, exist_ok=True)
    
        count_label = 0
        count_preview = 0
    
        for key in sorted(self.image_paths.keys()):
            try:
                label_mask = self.ensure_label_mask_exists(key)
    
                # 1) 正本の label PNG
                label_dst_path = os.path.join(label_folder, f"mask{key}.png")
                ok_label = cv2.imwrite(label_dst_path, label_mask)
                if ok_label:
                    count_label += 1
                else:
                    print(f"[WARN] Failed to save label PNG: {label_dst_path}")
    
                # 2) 閲覧用 color preview PNG
                h, w = label_mask.shape
                preview = np.zeros((h, w, 3), dtype=np.uint8)  # BGR
    
                for obj_id, (r, g, b) in enumerate(self.color_labels, start=1):
                    mask = (label_mask == obj_id)
                    if np.any(mask):
                        preview[mask] = (b, g, r)
    
                preview_dst_path = os.path.join(preview_folder, f"preview_mask{key}.png")
                ok_preview = cv2.imwrite(preview_dst_path, preview)
                if ok_preview:
                    count_preview += 1
                else:
                    print(f"[WARN] Failed to save preview PNG: {preview_dst_path}")
    
            except Exception as e:
                print(f"[WARN] Failed to save mask for {key}: {e}")
    
        # self.label_status.setText(
        #     f"✅ Saved {count_label} label PNGs to '{label_folder}' and "
        #     f"{count_preview} preview PNGs to '{preview_folder}'"
        # )            

        self.label_status.setText(
            f"✅ Saved {count_label} label PNGs and {count_preview} preview PNGs"
        )


                    
                    
    def export_overlay_png_sequence(self):
        if not self.image_paths:
            self.label_status.setText("⚠ No images loaded.")
            return

        root_folder = QFileDialog.getExistingDirectory(
            self, "Select Folder to Export Overlay PNGs"
        )
        if not root_folder:
            self.label_status.setText("Overlay export canceled.")
            return

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = os.path.join(root_folder, f"overlay_png_{timestamp}")
        os.makedirs(output_dir, exist_ok=True)

        alpha = 77 / 255.0
        exported_count = 0

        for export_index, key in enumerate(sorted(self.image_paths.keys()), start=1):
            image_path = self.image_paths[key]
            image = cv2.imread(image_path, cv2.IMREAD_COLOR)
            if image is None:
                print(f"[WARN] Failed to load image for overlay export: {image_path}")
                continue

            h, w = image.shape[:2]
            output = image.astype(np.float32)
            label_mask = self.label_masks.get(key)

            if label_mask is not None:
                if label_mask.shape != (h, w):
                    print(
                        f"[WARN] Skipping mask overlay for {key}: "
                        f"label={label_mask.shape}, image={(h, w)}"
                    )
                else:
                    for obj_id, (r, g, b) in enumerate(self.color_labels, start=1):
                        if obj_id - 1 >= len(self.checkboxes):
                            continue
                        if not self.checkboxes[obj_id - 1].isChecked():
                            continue

                        mask = (label_mask == obj_id)
                        if not np.any(mask):
                            continue

                        color_bgr = np.array([b, g, r], dtype=np.float32)
                        output[mask] = (1.0 - alpha) * output[mask] + alpha * color_bgr

            output = np.clip(output, 0, 255).astype(np.uint8)
            output_path = os.path.join(output_dir, f"overlay{export_index:04d}.png")
            if cv2.imwrite(output_path, output):
                exported_count += 1
            else:
                print(f"[WARN] Failed to write overlay PNG: {output_path}")

        self.label_status.setText(f"✅ Exported {exported_count} overlay PNGs")
        print(f"[INFO] Exported {exported_count} overlay PNGs to: {output_dir}")


    def display_current_image(self):
    
        # ✅ 現在の画像インデックスを記録
        self.current_image_index = self.current_index 
    
        # 🧠 現在の表示状態を保持
        current_transform = self.graphicsView.transform()
        h_value = self.graphicsView.horizontalScrollBar().value()
        v_value = self.graphicsView.verticalScrollBar().value()
    
        # ✅ 既存アイテムをクリア
        self.scene.clear()
        self.pixmap_item = None
    
        # 画像リストが空なら安全に戻る
        if not self.image_paths:
            self.label_status.setText("No images to display.")
            return
    
        key = f"{self.current_index + 1:04}"
    
        # 指定 key が無ければ最初のキーへフォールバック
        img_path = self.image_paths.get(key)
        if not img_path:
            first_key = sorted(self.image_paths.keys())[0]
            key = first_key
            try:
                self.current_index = int(first_key) - 1
            except Exception:
                self.current_index = 0
            img_path = self.image_paths[key]
    
        filename = os.path.basename(img_path)
        self.label_status.setText(f"Displaying {filename} ({self.current_index + 1}/{len(self.image_paths)})")
    
        # ========= 元画像の読み込み =========
        pixmap = self.pixmap_cache.get(key)
        if pixmap is None:
            pm = QPixmap(img_path)
            if pm.isNull():
                QMessageBox.warning(self, "Load error", f"Failed to load image:\n{img_path}")
                return
            self.pixmap_cache[key] = pm
            pixmap = pm
    
        self.pixmap_item = QGraphicsPixmapItem(pixmap)
        self.pixmap_item.setZValue(0)
        self.scene.addItem(self.pixmap_item)
        self.scene.setSceneRect(QRectF(pixmap.rect()))
    
        # ========= label mask オーバーレイ再描画 =========
        try:
            label_mask = self.ensure_label_mask_exists(key)
    
            if label_mask.shape[0] != pixmap.height() or label_mask.shape[1] != pixmap.width():
                print(
                    f"[WARN] label mask size mismatch for key {key}: "
                    f"mask={label_mask.shape}, image=({pixmap.height()}, {pixmap.width()})"
                )
            else:
                overlay_qimg = self.build_label_overlay_qimage(key, alpha=77)  # 約30%透明
                overlay_pixmap = QPixmap.fromImage(overlay_qimg)
    
                overlay_item = QGraphicsPixmapItem(overlay_pixmap)
                overlay_item.setZValue(1)
                self.scene.addItem(overlay_item)
    
        except Exception as e:
            print(f"[WARN] Failed to render label overlay for {key}: {e}")
    
        # ========= ズーム＆スクロール復元 =========
        self.graphicsView.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.graphicsView.setResizeAnchor(QGraphicsView.ViewportAnchor.AnchorViewCenter)
        self.graphicsView.setTransform(current_transform)
        self.graphicsView.horizontalScrollBar().setValue(h_value)
        self.graphicsView.verticalScrollBar().setValue(v_value)
    
        # ========= 描画済みの線を再表示 =========
        if key in self.drawn_paths_per_image:
            for path, color in self.drawn_paths_per_image[key]:
                path_item = QGraphicsPathItem(path)
                path_item.setPen(QPen(QColor(color), 2))
                path_item.setZValue(2)
                self.scene.addItem(path_item)
    
        # ========= このフレームにボックスがあれば再表示 =========
        if self.current_index in self.box_per_frame:
            p1, p2 = self.box_per_frame[self.current_index]
            rect = QRectF(p1, p2).normalized()
            box_item = QGraphicsRectItem(rect)
            box_item.setPen(QPen(Qt.GlobalColor.red, 2))
            box_item.setZValue(10)
            self.scene.addItem(box_item)
    
        # ========= OpenCV グレースケールをスナップ用にセット =========
        gray = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)
        self.graphicsView.gray_image = gray

        

        
    def resizeEvent(self, event):
        super().resizeEvent(event)
        if hasattr(self, "scene") and self.scene and not self.scene.itemsBoundingRect().isNull():
            self.graphicsView.resetTransform()
            self.graphicsView.fitInView(self.scene.itemsBoundingRect(), Qt.AspectRatioMode.KeepAspectRatio)
                

    def closeEvent(self, event):
        box = QMessageBox(self)
        box.setWindowTitle("Confirm Exit")
        box.setText(
            "Are you sure you want to close SegRef3D?\n\n"
            "Please confirm that your label PNG masks have been saved.\n\n"
            "Autosaved label PNG masks are stored in:\n"
            f"{self.output_label_dir}"
        )
        close_button = box.addButton("Close", QMessageBox.ButtonRole.AcceptRole)
        box.addButton("Cancel", QMessageBox.ButtonRole.RejectRole)
        box.exec()

        if box.clickedButton() is close_button:
            event.accept()
        else:
            event.ignore()


    def finalize_pending_click_path(self):
        if self.graphicsView.draw_mode in ['click', 'click_snap']:
            if self.graphicsView.click_points and self.graphicsView.current_path_item:
                self.graphicsView.finalize_click_drawing()


    def switch_image(self, delta: int) -> bool:
        if not self.image_paths:
            return False

        target_index = self.current_index + delta
        if target_index < 0 or target_index >= len(self.image_paths):
            return False

        self.finalize_pending_click_path()
        self.current_index = target_index
        self.image_pristine = False
        self.display_current_image()
        return True


    def go_to_next_image(self) -> bool:
        return self.switch_image(1)


    def go_to_previous_image(self) -> bool:
        return self.switch_image(-1)


    def switch_image_by_wheel(self, delta: int) -> bool:
        if delta > 0:
            return self.go_to_previous_image()
        if delta < 0:
            return self.go_to_next_image()
        return False


    

    
    def eventFilter(self, source, event):

        if event.type() == event.Type.KeyPress:
            key = event.key()
        
            if key in (Qt.Key.Key_PageDown, Qt.Key.Key_F, Qt.Key.Key_J):
                self.go_to_next_image()
                return True
        
            elif key in (Qt.Key.Key_PageUp, Qt.Key.Key_R, Qt.Key.Key_U):
                self.go_to_previous_image()
                return True
            
            # 🔍 拡大：E
            elif key in (Qt.Key.Key_E, Qt.Key.Key_I, Qt.Key.Key_Plus, Qt.Key.Key_Equal):
                self.graphicsView.scale(1.25, 1.25)
                return True
    
            # 🔎 縮小：Q
            elif key in (Qt.Key.Key_Q, Qt.Key.Key_P, Qt.Key.Key_Minus):
                self.graphicsView.scale(0.8, 0.8)
                return True
                        
            elif key in (Qt.Key.Key_W, Qt.Key.Key_O, Qt.Key.Key_Up):
                self.graphicsView.verticalScrollBar().setValue(
                    self.graphicsView.verticalScrollBar().value() - 50  # 上へ
                )
                return True
            
            elif key in (Qt.Key.Key_S, Qt.Key.Key_L, Qt.Key.Key_Down):
                self.graphicsView.verticalScrollBar().setValue(
                    self.graphicsView.verticalScrollBar().value() + 50  # 下へ
                )
                return True
            
            elif key in (Qt.Key.Key_A, Qt.Key.Key_K, Qt.Key.Key_Left):
                self.graphicsView.horizontalScrollBar().setValue(
                    self.graphicsView.horizontalScrollBar().value() - 50  # 左へ
                )
                return True
            
            elif key in (Qt.Key.Key_D, Qt.Key.Key_Semicolon, Qt.Key.Key_Right):
                self.graphicsView.horizontalScrollBar().setValue(
                    self.graphicsView.horizontalScrollBar().value() + 50  # 右へ
                )
                return True
            
            # ✅ Tキーでクリック描画を確定
            elif key in (Qt.Key.Key_G, Qt.Key.Key_H):
                if self.graphicsView.draw_mode in ['click', 'click_snap']:
                    self.graphicsView.finalize_click_drawing()
                    return True            
                       
            elif key in (Qt.Key.Key_T, Qt.Key.Key_Y):
                if self.graphicsView.draw_mode in ['click', 'click_snap']:
                    self.graphicsView.undo_last_click_point()
                    return True


    
        elif event.type() == event.Type.Wheel and source == self.graphicsView.viewport():
            event.accept()
    
            modifiers = QApplication.keyboardModifiers()
            delta = event.angleDelta().y()
    
            if modifiers == Qt.KeyboardModifier.ControlModifier:
                factor = 1.25 if delta > 0 else 0.8
                self.graphicsView.scale(factor, factor)
                return True
    
            elif modifiers == Qt.KeyboardModifier.ShiftModifier:
                hbar = self.graphicsView.horizontalScrollBar()
                hbar.setValue(hbar.value() - delta)
                return True
    
            elif modifiers == Qt.KeyboardModifier.NoModifier:
                self.switch_image_by_wheel(delta)
                return True
    
           
        
        elif event.type() == event.Type.MouseMove and source == self.graphicsView.viewport():
        
            # 🔍 共通デバッグ出力
            # print(f"[DEBUG] MouseMove: box_mode={self.box_mode}, box_points={len(self.box_points)}, calibration_mode={self.calibration_mode}, calibration_points={len(self.calibration_points)}")
        
            # ✅ ボックスモードで2点目をまだ選んでいないとき
            if self.box_mode and len(self.box_points) == 1:
                p1 = self.box_points[0]
                p2 = self.graphicsView.mapToScene(event.pos())
        
                if self.temp_box_item:
                    self.scene.removeItem(self.temp_box_item)
                    self.temp_box_item = None
        
                rect = QRectF(p1, p2).normalized()
                self.temp_box_item = QGraphicsRectItem(rect)
                self.temp_box_item.setPen(QPen(Qt.GlobalColor.red, 2, Qt.PenStyle.DashLine))
                self.scene.addItem(self.temp_box_item)
        
                return True
        
        
            # ✅ ボックスモードでまだ最初の点を選んでいないとき（クロスヘア）
            if self.box_mode and len(self.box_points) < 1:
                
                
                        
                
                # クロスヘア描画（MouseMove）
                scene_pos = self.graphicsView.mapToScene(event.pos())
                self.current_crosshair_pos = scene_pos  # ← 🔴 追加！
                
                x, y = scene_pos.x(), scene_pos.y()
                
                # 以前のクロスヘアを削除
                if hasattr(self, "temp_crosshair_hline") and self.temp_crosshair_hline:
                    self.scene.removeItem(self.temp_crosshair_hline)
                if hasattr(self, "temp_crosshair_vline") and self.temp_crosshair_vline:
                    self.scene.removeItem(self.temp_crosshair_vline)
                
                scene_rect = self.graphicsView.sceneRect()
                
                # 🔽 右方向にだけ伸びる水平線（左端がマウス位置）
                hline_path = QPainterPath()
                hline_path.moveTo(x, y)
                hline_path.lineTo(scene_rect.right(), y)
                
                self.temp_crosshair_hline = QGraphicsPathItem(hline_path)
                self.temp_crosshair_hline.setPen(QPen(Qt.GlobalColor.red, 2, Qt.PenStyle.SolidLine))
                self.temp_crosshair_hline.setZValue(999)
                self.scene.addItem(self.temp_crosshair_hline)
                
                # 🔽 下方向にだけ伸びる垂直線（上端がマウス位置）
                vline_path = QPainterPath()
                vline_path.moveTo(x, y)
                vline_path.lineTo(x, scene_rect.bottom())
                
                self.temp_crosshair_vline = QGraphicsPathItem(vline_path)
                self.temp_crosshair_vline.setPen(QPen(Qt.GlobalColor.red, 2, Qt.PenStyle.SolidLine))
                self.temp_crosshair_vline.setZValue(999)
                self.scene.addItem(self.temp_crosshair_vline)
        
        
        
                return True
        
            # ✅ キャリブレーション線の仮表示
            if self.calibration_mode and len(self.calibration_points) == 1:
                p1 = self.calibration_points[0]
                p2 = self.graphicsView.mapToScene(event.pos())
        
                if hasattr(self, "temp_line_item") and self.temp_line_item:
                    self.scene.removeItem(self.temp_line_item)
        
                path = QPainterPath()
                path.moveTo(p1)
                path.lineTo(p2)
                self.temp_line_item = QGraphicsPathItem(path)
                self.temp_line_item.setPen(QPen(Qt.GlobalColor.magenta, 1, Qt.PenStyle.DashLine))
                self.scene.addItem(self.temp_line_item)
        
                return True
            
                        
            # ✅ 測定モード：仮線の表示
            if self.measurement_mode and len(self.measurement_points) == 1:
                p1 = self.measurement_points[0]
                p2 = self.graphicsView.mapToScene(event.pos())
            
                # 既存の仮線を削除
                if self.temp_measurement_line_item:
                    self.scene.removeItem(self.temp_measurement_line_item)
            
                path = QPainterPath()
                path.moveTo(p1)
                path.lineTo(p2)
                self.temp_measurement_line_item = QGraphicsPathItem(path)
                self.temp_measurement_line_item.setPen(QPen(Qt.GlobalColor.green, 1, Qt.PenStyle.DashLine))
                self.temp_measurement_line_item.setZValue(999)
                self.scene.addItem(self.temp_measurement_line_item)
            
                return True
            
            

        
        elif event.type() == event.Type.MouseButtonPress and event.button() == Qt.MouseButton.LeftButton:
            # ✅ マウスカーソルの現在位置を scene 座標に変換（ズレ防止）
            scene_pos = self.graphicsView.mapToScene(
                self.graphicsView.viewport().mapFromGlobal(QCursor.pos())
            )
        
            # 🔹 キャリブレーションモード
            if self.calibration_mode:
                self.calibration_points.append(scene_pos)
        
                if len(self.calibration_points) == 2:
                    p1, p2 = self.calibration_points
        
                    # 確定線
                    path = QPainterPath()
                    path.moveTo(p1)
                    path.lineTo(p2)
                    line_item = QGraphicsPathItem(path)
                    line_item.setPen(QPen(Qt.GlobalColor.magenta, 2))
                    self.scene.addItem(line_item)

     

                    # 仮線削除
                    if hasattr(self, "temp_line_item") and self.temp_line_item:
                        self.scene.removeItem(self.temp_line_item)
                        self.temp_line_item = None

                    px_length = ((p1.x() - p2.x()) ** 2 + (p1.y() - p2.y()) ** 2) ** 0.5
                    real_length_mm = self.spin_mm_input.value()
                    self.mm_per_px = real_length_mm / px_length if px_length != 0 else 1.0
                    self.z_spacing_mm = self.spin_z_interval.value()

                    self.label_status.setText(
                        f"Calibration complete: {px_length:.2f}px = {real_length_mm:.2f}mm → 1px = {self.mm_per_px:.4f} mm, Z spacing = {self.z_spacing_mm:.4f} mm"
                    )
                    self.save_calibration_to_csv()

                    self.calibration_mode = False
                    self.calibration_points = []

                return True
                        
            
            # 🔹 測定モード
            if self.measurement_mode:
                self.measurement_points.append(scene_pos)
            
                if len(self.measurement_points) == 2:
                    p1, p2 = self.measurement_points
            
                    # 確定線
                    path = QPainterPath()
                    path.moveTo(p1)
                    path.lineTo(p2)
                    line_item = QGraphicsPathItem(path)
                    line_item.setPen(QPen(Qt.GlobalColor.green, 2))
                    line_item.setZValue(10)
                    self.scene.addItem(line_item)
            
                    # 仮線削除
                    if self.temp_measurement_line_item:
                        self.scene.removeItem(self.temp_measurement_line_item)
                        self.temp_measurement_line_item = None
            
                    # 長さ計算
                    px_length = ((p1.x() - p2.x()) ** 2 + (p1.y() - p2.y()) ** 2) ** 0.5
                    mm_per_px = self.mm_per_px
                    mm_length = px_length * mm_per_px if mm_per_px else None
            
                    # 保存
                    self.measurement_results.append((p1, p2, px_length, mm_length))
            
                    # ステータス表示
                    msg = f"Measured: {px_length:.2f} px"
                    if mm_length:
                        msg += f" = {mm_length:.2f} mm"
                    else:
                        msg += " (mm/px not calibrated)"
                    self.label_status.setText(msg)
            
                    # リセット
                    self.measurement_mode = False
                    self.measurement_points = []
            
                return True
            
            
            

            # 🔹 ボックスプロンプトモード
            if self.box_mode:
                # self.box_points.append(scene_pos)

                                                        
                if self.box_mode:
                    if len(self.box_points) == 0:
                        # ✅ 1点目はクロスヘア（狙った位置）
                        if hasattr(self, "current_crosshair_pos"):
                            self.box_points.append(self.current_crosshair_pos)
                        else:
                            self.box_points.append(self.graphicsView.mapToScene(event.pos()))
                
                    elif len(self.box_points) == 1:
                        # ✅ 2点目は必ずクリック位置（誤差を防ぐため）
                        # scene_pos = self.graphicsView.mapToScene(event.pos())
                        scene_pos = self.graphicsView.mapToScene(self.graphicsView.viewport().mapFromGlobal(QCursor.pos()))

                
                        # 🔽 念のため：クリック時にも crosshair_pos を更新（マウスが動いてない場合）
                        self.current_crosshair_pos = scene_pos
                
                        self.box_points.append(scene_pos)



                # 1点目クリック後 → クロスヘア削除
                if len(self.box_points) == 1:
                    if hasattr(self, "temp_crosshair_hline") and self.temp_crosshair_hline:
                        self.scene.removeItem(self.temp_crosshair_hline)
                        self.temp_crosshair_hline = None
                    if hasattr(self, "temp_crosshair_vline") and self.temp_crosshair_vline:
                        self.scene.removeItem(self.temp_crosshair_vline)
                        self.temp_crosshair_vline = None

                # 2点目クリック → ボックス確定
                elif len(self.box_points) == 2:
                    p1, p2 = self.box_points
                    rect = QRectF(p1, p2).normalized()
                
                    # ✅ 先に確定ボックスを追加
                    self.confirmed_box_item = QGraphicsRectItem(rect)
                    self.confirmed_box_item.setPen(QPen(Qt.GlobalColor.red, 2))
                    self.confirmed_box_item.setZValue(10)  # 仮ボックスより上に描画したければ
                    self.scene.addItem(self.confirmed_box_item)
                
                    # ✅ 仮ボックスがあれば削除
                    if self.temp_box_item:
                        self.scene.removeItem(self.temp_box_item)
                        self.temp_box_item = None
                
                    # ✅ 終了処理
                    self.box_mode = False
                    width = self.graphicsView.sceneRect().width()
                    height = self.graphicsView.sceneRect().height()
                    top_left = (p1.x() / width * 100, p1.y() / height * 100)
                    bottom_right = (p2.x() / width * 100, p2.y() / height * 100)
                    self.last_box_prompt = (top_left, bottom_right)
                    self.last_used_box_px = ((p1.x(), p1.y()), (p2.x(), p2.y()))
                    self.label_status.setText(f"Box set: {top_left} → {bottom_right}")
                    self.last_used_box_index = self.current_index  # ✅ ボックスを置いたフレーム番号を記録
                    # ✅ フレームに応じて保存
                    self.box_per_frame[self.current_index] = ((p1, p2))

                    self.box_points = []
                                                        
                    if len(self.box_points) >= 2:
                        print(f"[DEBUG] point1: ({self.box_points[0].x():.2f}, {self.box_points[0].y():.2f})")
                        print(f"[DEBUG] point2: ({self.box_points[1].x():.2f}, {self.box_points[1].y():.2f})")

                    

                return True

    
        return super().eventFilter(source, event)


    
            
    # def save_calibration_to_csv(self):
    #     import csv
    #     from pathlib import Path
    
    #     if self.mm_per_px is None or self.z_spacing_mm is None:
    #         print("[WARN] Calibration values not set")
    #         return
    
    #     try:
    #         first_img_path = self.image_paths.get("0001") or list(self.image_paths.values())[0]
    #         img = Image.open(first_img_path)
    #         width, height = img.width, img.height
    #     except Exception as e:
    #         print(f"[WARN] Failed to get image size: {e}")
    #         width, height = 0, 0
    
    #     depth = len(self.image_paths)
    
    #     volume_table = [
    #         ["Width", "Height", "Depth"],
    #         [str(width), str(height), str(depth)],
    #         ["X Spacing", "Y Spacing", "Z Spacing"],
    #         [str(self.mm_per_px), str(self.mm_per_px), str(self.z_spacing_mm)],
    #         ["X Origin", "Y Origin", "Z Origin"],
    #         ["0", "0", "0"]
    #     ]
    
    #     # from datetime import datetime
    #     # folder_name = Path(self.output_mask_dir).name.replace("masks_", "")
    #     # csv_path = Path(self.output_mask_dir).parent / f"{folder_name}_volinf.csv"
        
    #     input_folder_name = Path(self.image_paths.get("0001") or list(self.image_paths.values())[0]).parent.name
    #     csv_filename = f"{input_folder_name}_volinf.csv"
    #     csv_path = Path(self.output_mask_dir).parent / csv_filename

    
    #     with open(csv_path, "w", newline="", encoding="utf-8") as f:
    #         writer = csv.writer(f)
    #         writer.writerows(volume_table)
    
    
    
    
    #     print(f"[INFO] Calibration info saved to: {csv_path}")
    
    def save_calibration_to_csv(self):
        import csv
        from pathlib import Path
        from datetime import datetime
    
        if self.mm_per_px is None or self.z_spacing_mm is None:
            print("[WARN] Calibration values not set")
            return
    
        try:
            first_img_path = self.image_paths.get("0001") or list(self.image_paths.values())[0]
            img = Image.open(first_img_path)
            width, height = img.width, img.height
        except Exception as e:
            print(f"[WARN] Failed to get image size: {e}")
            width, height = 0, 0
    
        depth = len(self.image_paths)
    
        volume_table = [
            ["Width", "Height", "Depth"],
            [str(width), str(height), str(depth)],
            ["X Spacing", "Y Spacing", "Z Spacing"],
            [str(self.mm_per_px), str(self.mm_per_px), str(self.z_spacing_mm)],
            ["X Origin", "Y Origin", "Z Origin"],
            ["0", "0", "0"]
        ]
    
        input_folder_name = Path(self.image_paths.get("0001") or list(self.image_paths.values())[0]).parent.name
        csv_filename = f"{input_folder_name}_volinf.csv"
        csv_path = Path(self.output_mask_dir).parent / csv_filename
    
        try:
            with open(csv_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerows(volume_table)
    
        except PermissionError:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            fallback_filename = f"{input_folder_name}_volinf_{timestamp}.csv"
            fallback_path = Path(self.output_mask_dir).parent / fallback_filename
    
            with open(fallback_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerows(volume_table)
    
            csv_path = fallback_path
            print(f"[WARN] Original volinf CSV was locked. Saved as: {csv_path}")
    
        print(f"[INFO] Calibration info saved to: {csv_path}")        


            
    # def save_svg_state_for_undo(self, key=None):
    #     """
    #     SVGの状態をUndo用に保存。
    #     - key を指定：そのキーのみ保存
    #     - key を None：全mask_paths分のsnapshotを保存
    #     """
    #     if key is None:
    #         # 一括保存（全画像）
    #         snapshot = {}
    #         for k, path in self.mask_paths.items():
    #             if os.path.exists(path):
    #                 with open(path, "r", encoding="utf-8") as f:
    #                     snapshot[k] = f.read()
    #         if snapshot:
    #             self.undo_stack.setdefault("__global__", []).append(snapshot)
    #             self.redo_stack["__global__"] = []
    #     else:
    #         # 単一キーの保存（従来の動作）
    #         if key not in self.mask_paths:
    #             return
    #         path = self.mask_paths[key]
    #         with open(path, "r", encoding="utf-8") as f:
    #             svg_text = f.read()
    #         self.undo_stack.setdefault(key, []).append(svg_text)
    #         self.redo_stack[key] = []
        
            
    def save_svg_state_for_undo(self, key=None):
        """
        label mask の状態を Undo 用に保存。
        - key を指定: そのキーのみ保存
        - key を None: 全 label_masks 分の snapshot を保存
        """
        if key is None:
            snapshot = {}
    
            for k in self.image_paths.keys():
                try:
                    label_mask = self.ensure_label_mask_exists(k)
                    snapshot[k] = label_mask.copy()
                except Exception as e:
                    print(f"[WARN] Failed to snapshot label mask for {k}: {e}")
    
            if snapshot:
                self.undo_stack.setdefault("__global__", []).append(snapshot)
                self.redo_stack["__global__"] = []
    
        else:
            try:
                label_mask = self.ensure_label_mask_exists(key)
            except Exception as e:
                print(f"[WARN] Failed to snapshot label mask for {key}: {e}")
                return
    
            self.undo_stack.setdefault(key, []).append(label_mask.copy())
            self.redo_stack[key] = []        
        
                
                
    # def undo_edit(self, key=None):
    #     if key is None:
    #         key = self.get_current_image_key()
    
    #     # 🔁 グローバルUndo（全画像対象の操作があれば優先）
    #     if key == "__global__" and self.undo_stack.get("__global__"):
    #         snapshot = self.undo_stack["__global__"].pop()
    
    #         # Redo用に現在の全状態を保存
    #         current_state = {}
    #         for k in snapshot:
    #             if k in self.mask_paths and os.path.exists(self.mask_paths[k]):
    #                 with open(self.mask_paths[k], "r", encoding="utf-8") as f:
    #                     current_state[k] = f.read()
    #         self.redo_stack.setdefault("__global__", []).append(current_state)
    
    #         # 復元
    #         for k, svg_text in snapshot.items():
    #             if k in self.mask_paths:
    #                 with open(self.mask_paths[k], "w", encoding="utf-8") as f:
    #                     f.write(svg_text)
    
    #         self.display_current_image()
    #         self.label_status.setText("Undo (all images) completed.")
    #         return
    
    #     # 🟨 通常Undo（1画像のみ）
    #     if key in self.undo_stack and self.undo_stack[key]:
    #         current_svg_path = self.mask_paths.get(key)
    #         if current_svg_path and os.path.exists(current_svg_path):
    #             # Redo用に現在状態を保存
    #             with open(current_svg_path, "r", encoding="utf-8") as f:
    #                 self.redo_stack.setdefault(key, []).append(f.read())
    
    #             # Undo復元
    #             previous_svg = self.undo_stack[key].pop()
    #             with open(current_svg_path, "w", encoding="utf-8") as f:
    #                 f.write(previous_svg)
    
    #             self.display_current_image()
    #             self.label_status.setText(f"Undo (image {key}) completed.")
    #         else:
    #             self.label_status.setText(f"SVG path not found for image {key}")
    #     else:
    #         self.label_status.setText("Nothing to undo.")
                
    
    
    def undo_edit(self, key=None):
        if key is None:
            key = self.get_current_image_key()
    
        # 🔁 グローバルUndo
        if key == "__global__" and self.undo_stack.get("__global__"):
            snapshot = self.undo_stack["__global__"].pop()
    
            # Redo用に現在の全状態を保存
            current_state = {}
            for k in snapshot:
                try:
                    current_state[k] = self.ensure_label_mask_exists(k).copy()
                except Exception as e:
                    print(f"[WARN] Failed to capture current state for redo ({k}): {e}")
    
            self.redo_stack.setdefault("__global__", []).append(current_state)
    
            # 復元
            for k, label_arr in snapshot.items():
                self.label_masks[k] = label_arr.copy()
                try:
                    self.save_label_mask_png(k)
                except Exception as e:
                    print(f"[WARN] Failed to save restored label mask for {k}: {e}")
    
            self.display_current_image()
            self.label_status.setText("Undo (all images) completed.")
            return
    
        # 🟨 通常Undo（1画像のみ）
        if key in self.undo_stack and self.undo_stack[key]:
            try:
                current_label = self.ensure_label_mask_exists(key).copy()
                self.redo_stack.setdefault(key, []).append(current_label)
    
                previous_label = self.undo_stack[key].pop()
                self.label_masks[key] = previous_label.copy()
                self.save_label_mask_png(key)
    
                self.display_current_image()
                self.label_status.setText(f"Undo (image {key}) completed.")
            except Exception as e:
                self.label_status.setText(f"Undo failed for image {key}: {e}")
        else:
            self.label_status.setText("Nothing to undo.")            
    
    
    
    
    
    # def redo_edit(self):
    #     key = self.get_current_image_key()
    
    #     # 🔁 グローバルRedo（全画像対象の操作）
    #     if "__global__" in self.redo_stack and self.redo_stack["__global__"]:
    #         snapshot = self.redo_stack["__global__"].pop()
    
    #         # Undo用に現在の全状態を保存
    #         current_state = {}
    #         for k in snapshot:
    #             if k in self.mask_paths and os.path.exists(self.mask_paths[k]):
    #                 with open(self.mask_paths[k], "r", encoding="utf-8") as f:
    #                     current_state[k] = f.read()
    #         self.undo_stack.setdefault("__global__", []).append(current_state)
    
    #         # 復元
    #         for k, svg_text in snapshot.items():
    #             if k in self.mask_paths:
    #                 with open(self.mask_paths[k], "w", encoding="utf-8") as f:
    #                     f.write(svg_text)
    
    #         self.display_current_image()
    #         self.label_status.setText("Redo (all images) completed.")
    #         return
    
    #     # 🟨 通常Redo（1画像のみ）
    #     if key in self.redo_stack and self.redo_stack[key]:
    #         current_svg_path = self.mask_paths[key]
    #         with open(current_svg_path, "r", encoding="utf-8") as f:
    #             self.undo_stack.setdefault(key, []).append(f.read())
    #         next_svg = self.redo_stack[key].pop()
    #         with open(current_svg_path, "w", encoding="utf-8") as f:
    #             f.write(next_svg)
    #         self.display_current_image()
    #         self.label_status.setText(f"Redo (image {key}) completed.")
    #     else:
    #         self.label_status.setText("Nothing to redo.")
    
    def redo_edit(self):
        key = self.get_current_image_key()
    
        # 🔁 グローバルRedo（全画像対象の操作）
        if "__global__" in self.redo_stack and self.redo_stack["__global__"]:
            snapshot = self.redo_stack["__global__"].pop()
    
            # Undo用に現在の全状態を保存
            current_state = {}
            for k in snapshot:
                try:
                    current_state[k] = self.ensure_label_mask_exists(k).copy()
                except Exception as e:
                    print(f"[WARN] Failed to capture current state for undo ({k}): {e}")
    
            self.undo_stack.setdefault("__global__", []).append(current_state)
    
            # 復元
            for k, label_arr in snapshot.items():
                self.label_masks[k] = label_arr.copy()
                try:
                    self.save_label_mask_png(k)
                except Exception as e:
                    print(f"[WARN] Failed to save restored label mask for {k}: {e}")
    
            self.display_current_image()
            self.label_status.setText("Redo (all images) completed.")
            return
    
        # 🟨 通常Redo（1画像のみ）
        if key in self.redo_stack and self.redo_stack[key]:
            try:
                current_label = self.ensure_label_mask_exists(key).copy()
                self.undo_stack.setdefault(key, []).append(current_label)
    
                next_label = self.redo_stack[key].pop()
                self.label_masks[key] = next_label.copy()
                self.save_label_mask_png(key)
    
                self.display_current_image()
                self.label_status.setText(f"Redo (image {key}) completed.")
            except Exception as e:
                self.label_status.setText(f"Redo failed for image {key}: {e}")
        else:
            self.label_status.setText("Nothing to redo.")


    
    # def save_drawn_path(self, path):
    #     key = self.get_current_image_key()

    #     # 🔒 パスを確実に閉じる
    #     if not path.isEmpty():
    #         path.closeSubpath()
    
    #     # パスの初期化（なければ）
    #     if key not in self.drawn_paths_per_image:
    #         self.drawn_paths_per_image[key] = []
    
    #     # 🔁 Redoスタックも初期化（Undo後の新規描画で履歴を消す）
    #     if key not in self.redo_stack:
    #         self.redo_stack[key] = []
    #     self.redo_stack[key].clear()
    
    #     # ペンの色付きでパスを保存
    #     self.drawn_paths_per_image[key].append((path, self.graphicsView.pen_color))
    
    # def save_drawn_path(self, path):
    #     key = self.get_current_image_key()
    #     if not key:
    #         return
    
    #     # 🔒 パスを確実に閉じる
    #     if not path.isEmpty():
    #         path.closeSubpath()
    
    #     # パスの初期化（なければ）
    #     if key not in self.drawn_paths_per_image:
    #         self.drawn_paths_per_image[key] = []
    
    #     # 🔁 Redoスタックも初期化（Undo後の新規描画で履歴を消す）
    #     if key not in self.redo_stack:
    #         self.redo_stack[key] = []
    #     self.redo_stack[key].clear()
    
    #     # ペンの色付きでパスを保存
    #     self.drawn_paths_per_image[key].append((path, self.graphicsView.pen_color))
    
    #     # ✅ Auto Add: current image のみ即反映
    #     if hasattr(self, "chk_auto_add") and self.chk_auto_add.isChecked():
    #         self.auto_add_latest_path_current_image()
    
    
    
    def save_drawn_path(self, path):
        key = self.get_current_image_key()
        if not key:
            return
    
        if not path.isEmpty():
            path.closeSubpath()
    
        if key not in self.drawn_paths_per_image:
            self.drawn_paths_per_image[key] = []
    
        if key not in self.redo_stack:
            self.redo_stack[key] = []
        self.redo_stack[key].clear()
    
        self.drawn_paths_per_image[key].append((path, self.graphicsView.pen_color))
    
        mode = self.combo_auto_apply_mode.currentText()
    
        if mode == "Add":
            self.auto_add_latest_path_current_image()
        elif mode == "Erase":
            self.auto_erase_latest_path_current_image()
        elif mode == "Transfer":
            self.auto_transfer_latest_path_current_image()


    def save_drawn_path_for_image(self, key, qpath):
        # 🔒 パスを確実に閉じる
        if not qpath.isEmpty():
            qpath.closeSubpath()

        if key not in self.drawn_paths_per_image:
            self.drawn_paths_per_image[key] = []
        self.drawn_paths_per_image[key].append((qpath, self.graphicsView.pen_color))
        print(f"[INFO] Drawn path added to frame: {key}")


    
    def redraw_paths(self):
        self.remove_all_path_items()
        key = self.get_current_image_key()
        if key in self.drawn_paths_per_image:
            for path, color in self.drawn_paths_per_image[key]:
                path_item = QGraphicsPathItem(path)
                pen = QPen(color, 2)
                path_item.setPen(pen)
                self.scene.addItem(path_item)
                self.graphicsView.path_items.append(path_item)





    # #ベクターのみで簡潔するver    
    # def add_drawn_path_to_mask(self):
    #     # self.save_svg_state_for_undo(self.get_current_image_key())
    #     # ✅ ループ前に一度だけ全画像の Undo 保存
    #     self.save_svg_state_for_undo()        
    
    #     from PyQt6.QtGui import QPainterPath
    #     from xml.etree import ElementTree as ET
    
    #     def parse_svg_path_to_qpath(d_attr):
    #         path = QPainterPath()
    #         tokens = re.findall(r"[-+]?\d*\.\d+|[-+]?\d+|[A-Za-z]", d_attr)
    #         i = 0
    #         while i < len(tokens):
    #             cmd = tokens[i]
    #             if cmd == "M":
    #                 x, y = float(tokens[i + 1]), float(tokens[i + 2])
    #                 path.moveTo(x, y)
    #                 i += 3
    #             elif cmd == "L":
    #                 x, y = float(tokens[i + 1]), float(tokens[i + 2])
    #                 path.lineTo(x, y)
    #                 i += 3
    #             elif cmd == "Z":
    #                 path.closeSubpath()
    #                 i += 1
    #             else:
    #                 i += 1
    #         return path
    
    #     def normalize_color(fill, style):
    #         def rgb_to_hex(rgb_str):
    #             match = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', rgb_str)
    #             if match:
    #                 r, g, b = map(int, match.groups())
    #                 return f'#{r:02x}{g:02x}{b:02x}'
    #             return rgb_str.strip().lower()
    
    #         color = ""
    #         if style and "fill:" in style:
    #             match = re.search(r'fill:([^;"]+)', style)
    #             if match:
    #                 color = match.group(1).strip().lower()
    #         elif fill:
    #             color = fill.strip().lower()
    
    #         if color.startswith("rgb"):
    #             return rgb_to_hex(color)
    #         return color
    
    #     def safe_remove(root, target_elem):
    #         for parent in root.iter():
    #             if target_elem in list(parent):
    #                 parent.remove(target_elem)
    #                 return True
    #         return False
    
    #     # 対象色を取得
    #     idx = self.combo_target_object.currentIndex()
    #     target_rgb = self.color_labels[idx]
    #     fill_color = f'#{target_rgb[0]:02x}{target_rgb[1]:02x}{target_rgb[2]:02x}'
    
    #     # 各画像についてループ
    #     for key, paths in self.drawn_paths_per_image.items():
    #         if not paths or key not in self.mask_paths:
    #             continue

    #         # self.save_svg_state_for_undo("__global__", key)  # ✅ keyごとに保存（__global__スタックに）
    
    #         svg_path = self.mask_paths.get(key)
    #         if not svg_path:
    #             print(f"[DEBUG] No SVG path found for key: {key}")
    #             continue
    #         print(f"[DEBUG] Processing SVG path: {svg_path}")
    
    #         tree = ET.parse(svg_path)
    #         root = tree.getroot()
    
    #         print(f"[DEBUG] SVG: {svg_path}")
    #         all_tags = [elem.tag for elem in root.iter()]
    #         print(f"[DEBUG] Found tags: {set(all_tags)}")
    
    #         # 既存パスと描画パスの統合
    #         combined_path = QPainterPath()
    #         for path, _ in paths:
    #             path.closeSubpath()
    #             combined_path.addPath(path)
            
    #         combined_path.setFillRule(Qt.FillRule.OddEvenFill)  # ✅ ここを追加！
    
    #         color_map = {}
    #         for elem in root.findall(".//path"):
    #             fill = normalize_color(elem.attrib.get("fill", ""), elem.attrib.get("style", ""))
    #             color_map.setdefault(fill, []).append(elem)





            
    #         from PyQt6.QtGui import QPainterPath
            
    #         # ✅ 描画されたパスを1つにまとめる
    #         combined_path = QPainterPath()
    #         for path, _ in paths:
    #             path.closeSubpath()
    #             combined_path.addPath(path)
    #         combined_path.setFillRule(Qt.FillRule.OddEvenFill)
            
    #         # ✅ SVGパスデータを生成
    #         polygons = combined_path.toSubpathPolygons()
    #         svg_path_data = ""
    #         for polygon in polygons:
    #             if polygon.size() < 3:
    #                 continue
    #             svg_path_data += "M " + " L ".join(f"{pt.x()},{pt.y()}" for pt in polygon) + " Z "
            
    #         # ✅ 現在選択中の色で追加（既存 path は削除しない）
    #         idx = self.combo_target_object.currentIndex()
    #         target_rgb = self.color_labels[idx]
    #         fill_color = f'#{target_rgb[0]:02x}{target_rgb[1]:02x}{target_rgb[2]:02x}'
            
    #         new_elem = ET.Element("path")
    #         new_elem.set("d", svg_path_data.strip())
    #         new_elem.set("fill", fill_color)
    #         new_elem.set("stroke", "none")
    #         new_elem.set("fill-rule", "evenodd")
    #         root.append(new_elem)
            
            
                
                
    
    #         # 保存
    #         original_name = os.path.basename(svg_path)
    #         save_path = os.path.join(self.output_mask_dir, original_name)
    #         tree.write(save_path, encoding="utf-8")
    
    #         # この画像の描画をクリア
    #         self.drawn_paths_per_image[key] = []
    
    #     self.display_current_image()
    #     # ✅ 対象オブジェクトを明示的に表示ONにする
    #     self.checkboxes[idx].setChecked(True)
    
    
    # def add_drawn_path_to_mask(self):
    #     key = self.get_current_image_key()
    #     if key is None:
    #         return
    
    #     label_mask = self.ensure_label_mask_exists(key)
    
    #     if key not in self.drawn_paths_per_image:
    #         return
    
    #     # 現在選択中のオブジェクトID
    #     # obj_id = self.get_selected_object_id()  # ← 既存関数に合わせる
    #     obj_id = self.combo_target_object.currentIndex() + 1
    
    #     if obj_id is None:
    #         return
    
    #     h, w = label_mask.shape
    
    #     for path, _ in self.drawn_paths_per_image[key]:
    #         binary = self.rasterize_path_to_binary(path, w, h)
    
    #         # 🔥 ここが本質
    #         label_mask[binary] = obj_id
    
    #     # 保存（任意）
    #     self.save_label_mask_png(key)
    
    #     # 表示更新
    #     self.display_current_image()
    
    #     # 描画クリア
    #     self.drawn_paths_per_image[key] = []

    
    def add_drawn_path_to_mask(self):
        # 対象オブジェクトID（1〜20）
        obj_id = self.combo_target_object.currentIndex() + 1
    
        # 対象オブジェクトを自動で表示ON
        self.checkboxes[obj_id - 1].setChecked(True)
    
        processed_count = 0
    
        # 線がある全画像に対して実行
        for key, paths in self.drawn_paths_per_image.items():
            if not paths:
                continue
    
            label_mask = self.ensure_label_mask_exists(key)
            h, w = label_mask.shape
    
            for path, _ in paths:
                binary = self.rasterize_path_to_binary(path, w, h)
                label_mask[binary] = obj_id
    
            self.save_label_mask_png(key)
    
            # この画像の描画線をクリア
            self.drawn_paths_per_image[key] = []
            processed_count += 1
    
        self.display_current_image()
        self.label_status.setText(f"✅ Added to Obj {obj_id} on {processed_count} image(s).")


    def qpath_to_svg_path(self, path: QPainterPath) -> str:
        """QPainterPath を SVG パス文字列に変換"""
        svg_parts = []
        for i in range(path.elementCount()):
            e = path.elementAt(i)
            cmd = "M" if i == 0 else "L"
            svg_parts.append(f"{cmd} {e.x:.2f} {e.y:.2f}")
        svg_parts.append("Z")
        return " ".join(svg_parts)






    def simplify_path(self, path: QPainterPath, tolerance: float = 2.0) -> QPainterPath:
        from PyQt6.QtGui import QPolygonF
        simplified = QPainterPath()
        polygon = path.toFillPolygon()
        if polygon:
            simplified.addPolygon(QPolygonF(polygon))
        return simplified

    def parse_svg_path_to_qpath(self, d_attr, step_size=5.0):
        from svgpathtools import parse_path
        import numpy as np
        from PyQt6.QtGui import QPainterPath

        path_obj = parse_path(d_attr)
        qpath = QPainterPath()
        for segment in path_obj:
            num = max(2, int(segment.length() // step_size))
            points = [segment.point(t) for t in np.linspace(0, 1, num)]
            for i, pt in enumerate(points):
                x, y = pt.real, pt.imag
                if i == 0 and qpath.isEmpty():
                    qpath.moveTo(x, y)
                else:
                    qpath.lineTo(x, y)
        return qpath






    
    def export_target_object_as_mask(self, target_index: int = 0):
        from PyQt6.QtGui import QImage, QPainter, QPixmap
        from PyQt6.QtSvg import QSvgRenderer
        from PyQt6.QtCore import Qt, QRectF
        from xml.etree import ElementTree as ET
        from io import BytesIO
        from datetime import datetime
        import os
        from copy import deepcopy  # ← 追加
    
        if not self.image_paths:
            print("[ERROR] No images loaded.")
            return
    
        key = list(self.image_paths.keys())[0]
        image_path = self.image_paths[key]
        svg_path = self.mask_paths[key]
    
        pixmap = QPixmap(image_path)
        width = pixmap.width()
        height = pixmap.height()
        if width == 0 or height == 0:
            print(f"[ERROR] Failed to get valid size from: {image_path}")
            return
    
        # 🎯 ターゲット色
        target_rgb = self.color_labels[target_index]
        target_hex = f'#{target_rgb[0]:02x}{target_rgb[1]:02x}{target_rgb[2]:02x}'.lower()
    
    
    
        
        # 🛠 SVG 読み込みとフィルター処理
        tree = ET.parse(svg_path)
        root = tree.getroot()
        
        match_count = 0
        target_elements = []
        
        for elem in list(root.iter()):
            fill = elem.attrib.get("fill", "")
            style = elem.attrib.get("style", "")
            color = self._normalize_color(fill, style)
        
            elem.attrib.pop("style", None)  # styleの影響を除去
        
            if color == target_hex:
                target_copy = deepcopy(elem)
                target_copy.set("fill", "#ffffff")  # 白に塗って最後に描画
                target_elements.append(target_copy)
                elem.set("fill", "#000000")  # 元の場所にも一応黒で残す
                match_count += 1
            else:
                elem.set("fill", "#000000")  # その他は黒塗り
        
        # ✅ 白いターゲット要素を最後に追加（前面に来る）
        for target_elem in target_elements:
            root.append(target_elem)
        
        print(f"[DEBUG] Matched {match_count} elements for target color {target_hex}")

    
    
    
        # 🔁 SVGラスタライズ処理
        svg_bytes = BytesIO()
        tree.write(svg_bytes, encoding='utf-8')
        svg_data = svg_bytes.getvalue()
    
        renderer = QSvgRenderer(svg_data)
        image = QImage(width, height, QImage.Format.Format_RGB32)
        image.fill(Qt.GlobalColor.black)
        image.fill(0)  # ✅ これが抜けていた！
    
        painter = QPainter()
        if painter.begin(image):
            painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)
            painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, False)
            renderer.render(painter, QRectF(0, 0, width, height))  # ✅ 描画範囲明示
            painter.end()
        else:
            print("[ERROR] QPainter failed")
            return
    
        # 💾 保存
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        save_dir = os.path.join(os.getcwd(), f"target_mask_output_{timestamp}")
        os.makedirs(save_dir, exist_ok=True)
        save_path = os.path.join(save_dir, f"{key}_mask.tiff")
        image.save(save_path, "TIFF")
        print(f"[SAVED] Target mask saved to: {save_path}")



    
    def svg_object_to_binary_mask(self, key: str, target_index: int) -> np.ndarray:
        from PyQt6.QtGui import QImage, QPainter, QPixmap
        from PyQt6.QtSvg import QSvgRenderer
        from PyQt6.QtCore import Qt, QRectF
        from xml.etree import ElementTree as ET
        from io import BytesIO
        import numpy as np
        from copy import deepcopy
    
        if key not in self.image_paths or key not in self.mask_paths:
            print(f"[ERROR] Invalid key: {key}")
            return None
    
        image_path = self.image_paths[key]
        svg_path = self.mask_paths[key]
    
        pixmap = QPixmap(image_path)
        width = pixmap.width()
        height = pixmap.height()
        if width == 0 or height == 0:
            print(f"[ERROR] Failed to get valid size from: {image_path}")
            return None
    
        # 🎯 ターゲット色
        target_rgb = self.color_labels[target_index]
        target_hex = f'#{target_rgb[0]:02x}{target_rgb[1]:02x}{target_rgb[2]:02x}'.lower()
    
        # 🛠 SVG 読み込みと描画調整
        tree = ET.parse(svg_path)
        root = tree.getroot()
    
        target_elements = []
        match_count = 0
    
        for elem in list(root.iter()):
            fill = elem.attrib.get("fill", "")
            style = elem.attrib.get("style", "")
            color = self._normalize_color(fill, style)
    
            elem.attrib.pop("style", None)  # 副作用を除去
    
            if color == target_hex:
                target_copy = deepcopy(elem)
                target_copy.set("fill", "#ffffff")
                target_elements.append(target_copy)
                elem.set("fill", "#000000")
                match_count += 1
            else:
                elem.set("fill", "#000000")
    
        for target_elem in target_elements:
            root.append(target_elem)
    
        if match_count == 0:
            print(f"[WARN] No matching elements found for {target_hex}")
    
        # 🔁 SVG → QImage
        svg_bytes = BytesIO()
        tree.write(svg_bytes, encoding='utf-8')
        svg_data = svg_bytes.getvalue()
    
        renderer = QSvgRenderer(svg_data)
        image = QImage(width, height, QImage.Format.Format_RGB32)
        image.fill(Qt.GlobalColor.black)
        image.fill(0)
    
        painter = QPainter()
        if painter.begin(image):
            painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)
            painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, False)
            renderer.render(painter, QRectF(0, 0, width, height))
            painter.end()
        else:
            print("[ERROR] QPainter failed")
            return None
    
        # 🔁 QImage → NumPy配列
        ptr = image.bits().asstring(image.width() * image.height() * 4)
        arr = np.frombuffer(ptr, dtype=np.uint8).reshape((height, width, 4))
        binary_mask = (arr[:, :, 0] + arr[:, :, 1] + arr[:, :, 2]) > 0  # 白部分だけTrue
    
        return binary_mask
    



        
    # def rasterize_path_to_binary(self, path: QPainterPath, width: int, height: int) -> np.ndarray:
    #     from PyQt6.QtGui import QImage, QPainter, QColor
    #     from PyQt6.QtCore import Qt
    #     import numpy as np
    
    #     image = QImage(width, height, QImage.Format.Format_Grayscale8)
    #     image.fill(0)
    
    #     painter = QPainter(image)
    #     painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)
    #     painter.setBrush(QColor(255, 255, 255))
    #     painter.setPen(Qt.PenStyle.NoPen)
    #     painter.drawPath(path)
    #     painter.end()
    
    #     ptr = image.bits()
    #     ptr.setsize(width * height)
    #     arr = np.frombuffer(ptr, dtype=np.uint8).reshape((height, width)).copy()
    
    #     binary = arr > 0
    #     return binary
        
    def rasterize_path_to_binary(self, path: QPainterPath, width: int, height: int) -> np.ndarray:
        from PyQt6.QtGui import QImage, QPainter, QColor, QPainterPath
        from PyQt6.QtCore import Qt
        import numpy as np
    
        # 念のためコピーして、副作用を避ける
        path = QPainterPath(path)
    
        # 複雑な閉曲線・穴構造への安全策
        path.setFillRule(Qt.FillRule.OddEvenFill)
    
        # path の座標範囲を確認
        rect = path.boundingRect()
        print(
            "[DEBUG rasterize] path bbox: "
            f"x={rect.x():.2f}, y={rect.y():.2f}, "
            f"w={rect.width():.2f}, h={rect.height():.2f}"
        )
    
        # Grayscale8 の QImage を作成
        image = QImage(width, height, QImage.Format.Format_Grayscale8)
        image.fill(0)
    
        if image.isNull():
            print("[ERROR rasterize] QImage creation failed.")
            return np.zeros((height, width), dtype=bool)
    
        painter = QPainter(image)
        if not painter.isActive():
            print("[ERROR rasterize] QPainter failed to start.")
            return np.zeros((height, width), dtype=bool)
    
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)
        painter.setBrush(QColor(255, 255, 255))
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawPath(path)
        painter.end()
    
        # ✅ 重要：QImage は 1行あたりの実メモリ幅が width と一致しないことがある
        bytes_per_line = image.bytesPerLine()
        total_bytes = bytes_per_line * height
    
        print(
            "[DEBUG rasterize] image size: "
            f"width={width}, height={height}, "
            f"bytesPerLine={bytes_per_line}, totalBytes={total_bytes}"
        )
    
        if bytes_per_line != width:
            print(
                "[WARNING rasterize] bytesPerLine != width. "
                "QImage row padding exists. Using bytesPerLine and cropping to width."
            )
    
        # QImage → NumPy
        ptr = image.bits()
        ptr.setsize(total_bytes)
    
        arr_padded = np.frombuffer(ptr, dtype=np.uint8).reshape((height, bytes_per_line))
    
        # ✅ padding 部分を捨てて、実際の画像幅だけ使う
        arr = arr_padded[:, :width].copy()
    
        binary = arr > 0
    
        # ラスタライズ後の bbox を確認
        ys, xs = np.where(binary)
        if len(xs) > 0:
            print(
                "[DEBUG rasterize] binary bbox: "
                f"x={xs.min()}-{xs.max()}, y={ys.min()}-{ys.max()}, "
                f"pixels={len(xs)}"
            )
        else:
            print("[DEBUG rasterize] binary is empty.")
    
        return binary
    
    
    def extract_paths_from_binary(self, binary_mask: np.ndarray, min_area: float = 100.0) -> list:
        import cv2
        from PyQt6.QtGui import QPainterPath
        from PyQt6.QtCore import QPointF, Qt
    
        paths = []
    
        # ✅ OpenCV用に uint8 に変換（True→255、False→0）
        if binary_mask.dtype != np.uint8:
            binary_mask = (binary_mask > 0).astype(np.uint8) * 255
    
    
        
        contours, _ = cv2.findContours(binary_mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
    
        combined_path = QPainterPath()
    
        for contour in contours:
            if len(contour) < 3:
                continue
    
            area = cv2.contourArea(contour)
            if area < min_area:
                continue
    
            sub_path = QPainterPath()
            sub_path.moveTo(QPointF(contour[0][0][0], contour[0][0][1]))
            for point in contour[1:]:
                x, y = point[0]
                sub_path.lineTo(QPointF(x, y))
            sub_path.closeSubpath()
            combined_path.addPath(sub_path)
    
        combined_path.setFillRule(Qt.FillRule.OddEvenFill)
        return [combined_path]  # ✅ 1つの複合パスとして返す


                
            
    # def cut_drawn_path_from_mask(self):
    #     from PIL import Image
    #     from PyQt6.QtGui import QPainterPath, QPainterPathStroker
    #     from PyQt6.QtCore import QPointF, Qt
    
    #     def normalize_color(fill, style):
    #         def rgb_to_hex(rgb_str):
    #             match = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', rgb_str)
    #             if match:
    #                 r, g, b = map(int, match.groups())
    #                 return f'#{r:02x}{g:02x}{b:02x}'
    #             return rgb_str.strip().lower()
    
    #         color = ""
    #         if style and "fill:" in style:
    #             match = re.search(r'fill:([^;"]+)', style)
    #             if match:
    #                 color = match.group(1).strip().lower()
    #         elif fill:
    #             color = fill.strip().lower()
    
    #         if color.startswith("rgb"):
    #             return rgb_to_hex(color)
    #         return color
    
    #     def safe_remove(root, target_elem):
    #         for parent in root.iter():
    #             if target_elem in list(parent):
    #                 parent.remove(target_elem)
    #                 return True
    #         return False
    
    #     key_current = self.get_current_image_key()
    #     if not key_current or key_current not in self.drawn_paths_per_image:
    #         return
    
    #     self.save_svg_state_for_undo()
    
    #     idx = self.combo_target_object.currentIndex()
    #     target_rgb = self.color_labels[idx]
    #     fill_color = f'#{target_rgb[0]:02x}{target_rgb[1]:02x}{target_rgb[2]:02x}'
    
    #     for key, paths in self.drawn_paths_per_image.items():
    #         if not paths or key not in self.mask_paths:
    #             continue
    
    #         svg_path = self.mask_paths[key]
    #         tree = ET.parse(svg_path)
    #         root = tree.getroot()
    
    #         drawn_union = QPainterPath()
    #         for path, _ in paths:
    #             path.closeSubpath()
    #             simplified = self.simplify_path(path)
    #             drawn_union.addPath(simplified)
    
    #         drawn_union.setFillRule(Qt.FillRule.OddEvenFill)
    
    #         # 描画領域を画像化 → 輪郭再抽出（subtractedによる穴潰れ回避）
    #         width, height = self.image_sizes.get(key, (512, 512))
    #         # binary_mask = self.path_to_binary_image(drawn_union, width, height)
    #         binary_mask = self.rasterize_path_to_binary(drawn_union, width, height)

    #         # contour_paths = self.extract_paths_from_binary(binary_mask)
    #         contour_paths = self.extract_paths_from_binary(binary_mask, min_area=100.0)

    
    #         elements_to_process = list(root.iter())
    
    #         for elem in elements_to_process:
    #             tag = elem.tag.lower()
    #             fill = normalize_color(elem.attrib.get("fill", ""), elem.attrib.get("style", ""))
    #             if fill != fill_color:
    #                 continue
    
    #             if tag.endswith("path"):
    #                 d_attr = elem.attrib.get("d", "")
    #                 if not d_attr:
    #                     continue
    #                 try:
    #                     original_path = self.parse_svg_path_to_qpath(d_attr, step_size=5.0)
    #                     original_path.setFillRule(Qt.FillRule.OddEvenFill)
    #                 except Exception as e:
    #                     print(f"[DEBUG] Failed to parse path: {e}")
    #                     continue
  
    
  
                    
    #                 # 🔸 ターゲットインデックス取得
    #                 target_index = self.combo_target_object.currentIndex()
                    
    #                 # 🔸 SVGから特定オブジェクトのみレンダリングしてバイナリ化
    #                 original_binary = self.svg_object_to_binary_mask(key, target_index)
    #                 if original_binary is None:
    #                     print("[ERROR] Failed to generate binary mask.")
    #                     return
                    

                    
    #                 # 🔸 描画領域のバイナリマスク（これは path → image でOK）
    #                 # drawn_binary = self.path_to_binary_image(drawn_union, width, height)
    #                 drawn_binary = self.rasterize_path_to_binary(drawn_union, width, height)

                    
                    
                    
    #                 # # ✅ デバッグ出力
    #                 # cv2.imwrite("debug_original_binary.png", original_binary * 255)
    #                 # cv2.imwrite("debug_drawn_binary.png", drawn_binary * 255)

                    
    #                 # ✅ ラスター subtract
    #                 cut_result = original_binary & (~drawn_binary)
    #                 # cv2.imwrite("debug_cut_result.png", cut_result.astype(np.uint8) * 255)
                                        
    #                 # # 🔍 デバッグ用にラスター subtract 結果を保存（白＝残る部分）
    #                 # debug_cut_path = os.path.join(self.output_mask_dir, f"debug_cut_{os.path.basename(svg_path).replace('.svg', '.png')}")
    #                 # cv2.imwrite(debug_cut_path, cut_result * 255)  # 白黒で保存（uint8）
    #                 # print(f"[DEBUG] Saved cut_result image to: {debug_cut_path}")                    
                    
    #                 # 輪郭を再抽出
    #                 # cut_paths = self.extract_paths_from_binary(cut_result)
    #                 cut_paths = self.extract_paths_from_binary(cut_result, min_area=100.0)

                    
    #                 # 元の path 要素を削除
    #                 safe_remove(root, elem)
                    
    #                 # 抽出した path を SVG として追加
    #                 for path in cut_paths:
    #                     svg_path_data = ""
    #                     for polygon in path.toSubpathPolygons():
    #                         if polygon.size() < 3:
    #                             continue
    #                         svg_path_data += "M " + " L ".join(f"{pt.x()},{pt.y()}" for pt in polygon) + " Z "
                    
    #                     new_elem = ET.Element("path")
    #                     new_elem.set("d", svg_path_data.strip())
    #                     new_elem.set("fill", fill_color)
    #                     new_elem.set("stroke", "none")
    #                     new_elem.set("fill-rule", "evenodd")
    #                     root.append(new_elem)
    
    
    
    
    
    
    #         save_path = os.path.join(self.output_mask_dir, os.path.basename(svg_path))
    #         tree.write(save_path, encoding="utf-8", xml_declaration=True)
    #         self.mask_paths[key] = save_path
    #         self.drawn_paths_per_image[key] = []
    
    #         if key == key_current:
    #             self.display_current_image()
    #             self.scene.update()
    
    #     self.display_current_image()
    #     self.scene.update()        
        
        
        
        
            
    def cut_drawn_path_from_mask(self):
        key_current = self.get_current_image_key()
        if not key_current:
            return
    
        # 対象オブジェクトID（1〜20）
        obj_id = self.combo_target_object.currentIndex() + 1
    
        processed_count = 0
    
        # 線がある全画像に対して実行
        for key, paths in self.drawn_paths_per_image.items():
            if not paths:
                continue
    
            label_mask = self.ensure_label_mask_exists(key)
            h, w = label_mask.shape
    
            # 描画パスを1つにまとめる
            drawn_union = QPainterPath()
            for path, _ in paths:
                path.closeSubpath()
                drawn_union.addPath(path)
    
            drawn_union.setFillRule(Qt.FillRule.OddEvenFill)
    
            # ラスター化
            binary = self.rasterize_path_to_binary(drawn_union, w, h)
    
            # 対象オブジェクト部分だけ消す
            erase_region = binary & (label_mask == obj_id)
            label_mask[erase_region] = 0
    
            # 保存
            self.save_label_mask_png(key)
    
            # この画像の描画をクリア
            self.drawn_paths_per_image[key] = []
            processed_count += 1
    
        self.display_current_image()
        self.scene.update()
        self.label_status.setText(f"✅ Erased from Obj {obj_id} on {processed_count} image(s).")        
        
        
        
        
        
        
        
        
    
        
            
    def _add_contours_to_svg(self, binary_mask, color_hex, root):
        contours, hierarchy = cv2.findContours(binary_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        if hierarchy is None:
            return
    
        hierarchy = hierarchy[0]  # shape: (n_contours, 4)
    
        def contour_to_path(contour):
            points = [f"{pt[0][0]},{pt[0][1]}" for pt in contour]
            return "M " + " L ".join(points) + " Z"
    
        # 輪郭と階層構造から path を構築
        for i, (contour, hier) in enumerate(zip(contours, hierarchy)):
            if hier[3] != -1:
                continue  # 子輪郭（穴）は親のパスで処理されるのでスキップ
    
            # ✅ 親輪郭
            d = contour_to_path(contour)
    
            # ✅ 子（穴）を含める
            child_idx = hier[2]
            while child_idx != -1:
                d += " " + contour_to_path(contours[child_idx])
                child_idx = hierarchy[child_idx][0]
    
            new_elem = ET.Element("path")
            new_elem.set("d", d)
            new_elem.set("fill", color_hex)
            new_elem.set("stroke", "none")
            new_elem.set("fill-rule", "evenodd")  # ⬅️ これが穴を正しく扱うために必要
            root.append(new_elem)




    
    # def transfer_drawn_path_to_mask(self):
    #     from xml.etree import ElementTree as ET
    #     from PyQt6.QtGui import QImage, QPainterPath
    #     from PyQt6.QtCore import Qt
    #     import numpy as np
    #     import cv2
    #     import os
    
    #     self.save_svg_state_for_undo()
    
    #     key_current = self.get_current_image_key()
    #     if not key_current or key_current not in self.drawn_paths_per_image:
    #         return
    
    #     idx_src = self.combo_target_object.currentIndex()
    #     idx_dst = self.combo_transfer_target.currentIndex()
    #     src_rgb = self.color_labels[idx_src]
    #     dst_rgb = self.color_labels[idx_dst]
    #     src_color = f'#{src_rgb[0]:02x}{src_rgb[1]:02x}{src_rgb[2]:02x}'
    #     dst_color = f'#{dst_rgb[0]:02x}{dst_rgb[1]:02x}{dst_rgb[2]:02x}'
    
    #     for key, paths in self.drawn_paths_per_image.items():
    #         if not paths or key not in self.mask_paths or key not in self.image_paths:
    #             continue
    
    #         image_path = self.image_paths[key]
    #         svg_path = self.mask_paths[key]
    #         pixmap = QPixmap(image_path)
    #         width, height = pixmap.width(), pixmap.height()
    
    #         if width == 0 or height == 0:
    #             print(f"[ERROR] Invalid image size for {key}")
    #             continue
    
    #         # 🎯 1. 元のマスクをバイナリ化
    #         mask_src = self.svg_object_to_binary_mask(key, idx_src).astype(np.uint8)
    #         if mask_src is None:
    #             continue
    
    #         # ✏ 2. 手描きパスをラスタライズ
    #         path_union = QPainterPath()
    #         for path, _ in paths:
    #             path.closeSubpath()
    #             path_union.addPath(path)
    #         path_union.setFillRule(Qt.FillRule.OddEvenFill)
    #         drawn_mask = self.rasterize_path_to_binary(path_union, width, height).astype(np.uint8)
    
    #         # ➕ 3. 転送部分（AND）・残存部分（差分）を計算
    #         intersected = cv2.bitwise_and(mask_src, drawn_mask)
    #         subtracted = cv2.bitwise_and(mask_src, cv2.bitwise_not(drawn_mask))
    
    #         # 🧼 4. 元のオブジェクト要素を削除
    #         tree = ET.parse(svg_path)
    #         root = tree.getroot()
    #         to_remove = []
    #         for elem in list(root.iter()):
    #             fill = elem.attrib.get("fill", "").strip().lower()
    #             style = elem.attrib.get("style", "")
    #             if self._normalize_color(fill, style) == src_color:
    #                 to_remove.append(elem)
    #         for elem in to_remove:
    #             root.remove(elem)
    
    #         # 🖌 5. 交差領域 → 転送先色で追加
    #         self._add_contours_to_svg(intersected, dst_color, root)
    
    #         # 🖌 6. 残存領域 → 元の色で追加
    #         self._add_contours_to_svg(subtracted, src_color, root)
    
    #         # 💾 7. 保存
    #         save_path = os.path.join(self.output_mask_dir, os.path.basename(svg_path))
    #         tree.write(save_path, encoding="utf-8")
    #         self.mask_paths[key] = save_path
    #         self.drawn_paths_per_image[key] = []
    
    #     self.update_checkboxes_based_on_used_colors()
    #     self.display_current_image()
    #     self.scene.update()
        


    
    def transfer_drawn_path_to_mask(self):
        key_current = self.get_current_image_key()
        if not key_current:
            return
    
        # 元オブジェクトID / 転送先オブジェクトID（1〜20）
        src_id = self.combo_target_object.currentIndex() + 1
        dst_id = self.combo_transfer_target.currentIndex() + 1
    
        # 転送先オブジェクトを自動で表示ON
        self.checkboxes[dst_id - 1].setChecked(True)
    
        processed_count = 0
    
        # 線がある全画像に対して実行
        for key, paths in self.drawn_paths_per_image.items():
            if not paths:
                continue
    
            label_mask = self.ensure_label_mask_exists(key)
            h, w = label_mask.shape
    
            # 描画パスを1つにまとめる
            path_union = QPainterPath()
            for path, _ in paths:
                path.closeSubpath()
                path_union.addPath(path)
            path_union.setFillRule(Qt.FillRule.OddEvenFill)
    
            # ラスター化
            drawn_mask = self.rasterize_path_to_binary(path_union, w, h)
    
            # 元オブジェクトのうち、描画領域に入っている部分だけ転送
            move_region = drawn_mask & (label_mask == src_id)
            label_mask[move_region] = dst_id
    
            # 保存
            self.save_label_mask_png(key)
    
            # この画像の描画をクリア
            self.drawn_paths_per_image[key] = []
            processed_count += 1
    
        self.display_current_image()
        self.scene.update()
        self.label_status.setText(
            f"✅ Transferred Obj {src_id} → Obj {dst_id} on {processed_count} image(s)."
        )
    

        


    
    # def convert_object_color_across_svgs(self):
    #     from xml.etree import ElementTree as ET
    
    #     def normalize_color(fill, style):
    #         def rgb_to_hex(rgb_str):
    #             match = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', rgb_str)
    #             if match:
    #                 r, g, b = map(int, match.groups())
    #                 return f'#{r:02x}{g:02x}{b:02x}'
    #             return rgb_str.strip().lower()
    
    #         color = ""
    #         if style and "fill:" in style:
    #             match = re.search(r'fill:([^;"]+)', style)
    #             if match:
    #                 color = match.group(1).strip().lower()
    #         elif fill:
    #             color = fill.strip().lower()
    
    #         if color.startswith("rgb"):
    #             return rgb_to_hex(color)
    #         return color
    
    #     # 元のオブジェクト番号と変換先オブジェクト番号を取得
    #     idx_from = self.combo_convert_from.currentIndex()
    #     idx_to = self.combo_convert_to.currentIndex()
    #     color_from = f'#{self.color_labels[idx_from][0]:02x}{self.color_labels[idx_from][1]:02x}{self.color_labels[idx_from][2]:02x}'
    #     color_to   = f'#{self.color_labels[idx_to][0]:02x}{self.color_labels[idx_to][1]:02x}{self.color_labels[idx_to][2]:02x}'

    #     # 一括編集のためUndo保存（全SVG）
    #     self.save_svg_state_for_undo()  # ← ループの外に1回でOK！
    
    #     for key, svg_path in self.mask_paths.items():
    #         tree = ET.parse(svg_path)
    #         root = tree.getroot()
    #         changed = False
    
    #         for elem in root.iter():
    #             tag = elem.tag.lower()
    #             fill = normalize_color(elem.attrib.get("fill", ""), elem.attrib.get("style", ""))
    #             if fill == color_from:
    #                 elem.set("fill", color_to)
    #                 changed = True
    
    #         if changed:
    #             save_path = os.path.join(self.output_mask_dir, os.path.basename(svg_path))
    #             tree.write(save_path, encoding="utf-8")
    #             self.mask_paths[key] = save_path  # 更新
    #             print(f"[INFO] Converted in {os.path.basename(svg_path)}")
    
    #     self.display_current_image()
    #     self.scene.update()
        
    
    def convert_object_color_across_svgs(self):
        # 元オブジェクトID / 変換先オブジェクトID（1〜20）
        src_id = self.combo_convert_from.currentIndex() + 1
        dst_id = self.combo_convert_to.currentIndex() + 1
    
        if src_id == dst_id:
            self.label_status.setText("⚠ Source and destination are the same.")
            return
    
        # 変換先オブジェクトを自動で表示ON
        self.checkboxes[dst_id - 1].setChecked(True)
    
        changed_count = 0
    
        for key in sorted(self.image_paths.keys()):
            try:
                label_mask = self.ensure_label_mask_exists(key)
    
                if np.any(label_mask == src_id):
                    label_mask[label_mask == src_id] = dst_id
                    self.save_label_mask_png(key)
                    changed_count += 1
                    print(f"[INFO] Converted in mask {key}")
    
            except Exception as e:
                print(f"[WARN] Failed to convert object color for {key}: {e}")
    
        self.display_current_image()
        self.scene.update()
        self.label_status.setText(f"✅ Converted Obj {src_id} → Obj {dst_id} in {changed_count} image(s)")





    
    def bring_selected_object_to_front(self):
        self._reorder_svg_elements(bring_to_front=True)
    
    def send_selected_object_to_back(self):
        self._reorder_svg_elements(bring_to_front=False)
    
    def _reorder_svg_elements(self, bring_to_front=True):
        from xml.etree import ElementTree as ET
    
        def normalize_color(fill, style):
            def rgb_to_hex(rgb_str):
                match = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', rgb_str)
                if match:
                    r, g, b = map(int, match.groups())
                    return f'#{r:02x}{g:02x}{b:02x}'
                return rgb_str.strip().lower()
    
            color = ""
            if style and "fill:" in style:
                match = re.search(r'fill:([^;"]+)', style)
                if match:
                    color = match.group(1).strip().lower()
            elif fill:
                color = fill.strip().lower()
    
            if color.startswith("rgb"):
                return rgb_to_hex(color)
            return color
    
        # 対象オブジェクト色のRGBとHex取得（1回だけでOK）
        idx = self.combo_reorder_object.currentIndex()
        target_rgb = self.color_labels[idx]
        target_hex = f'#{target_rgb[0]:02x}{target_rgb[1]:02x}{target_rgb[2]:02x}'

        # 一括編集のためUndo保存（全SVG）
        self.save_svg_state_for_undo()  # ← ループの外に1回でOK！
    
        for key, svg_path in self.mask_paths.items():
            try:
                tree = ET.parse(svg_path)
                root = tree.getroot()
            except Exception as e:
                print(f"[ERROR] Failed to parse SVG ({key}): {e}")
                continue
    
            elements = list(root)
            matched = []
            unmatched = []
    
            for elem in elements:
                fill = normalize_color(elem.attrib.get("fill", ""), elem.attrib.get("style", ""))
                if fill == target_hex:
                    matched.append(elem)
                else:
                    unmatched.append(elem)
    
            if not matched:
                print(f"[INFO] No matching elements found in {key}.svg")
                continue
    
            root[:] = []
            if bring_to_front:
                root.extend(unmatched + matched)
            else:
                root.extend(matched + unmatched)
    
            save_path = os.path.join(self.output_mask_dir, os.path.basename(svg_path))
            tree.write(save_path, encoding="utf-8")
            self.mask_paths[key] = save_path
            print(f"[INFO] {'Brought to front' if bring_to_front else 'Sent to back'} in {key}.svg")
    
        self.display_current_image()
        self.scene.update()





    
    def save_all_modified_svgs(self, output_dir=None):
        import os
        for key, tree in self.modified_svg_trees.items():
            path = self.mask_paths.get(key)
            if not path:
                continue
            save_path = path if output_dir is None else os.path.join(output_dir, os.path.basename(path))
            tree.write(save_path, encoding="utf-8")
    
            


    
    # def export_all_svgs_to_grayscale_tiff(self):
    #     from PyQt6.QtGui import QImage, QPainter, QPixmap
    #     from xml.etree import ElementTree as ET
    #     from io import BytesIO
    #     from datetime import datetime
    #     import os
    #     from PyQt6.QtWidgets import QApplication
    
    #     app = QApplication.instance()
    #     if app is None:
    #         app = QApplication([])
    
    #     if not QApplication.instance():
    #         print("[ERROR] No QApplication instance found")
    #         return
    
    #     if not self.image_paths:
    #         print("[ERROR] No images loaded.")
    #         return
    
    #     first_image_path = list(self.image_paths.values())[0]
    #     pixmap = QPixmap(first_image_path)
    #     width = pixmap.width()
    #     height = pixmap.height()
    #     if width == 0 or height == 0:
    #         print(f"[ERROR] Failed to get valid size from: {first_image_path}")
    #         return
    
    #     timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    #     output_dir = os.path.join(os.getcwd(), f"tiff_output_{timestamp}")
    #     os.makedirs(output_dir, exist_ok=True)
    
    #     svg_dir = self.output_mask_dir
    #     svg_files = [f for f in os.listdir(svg_dir) if f.endswith(".svg")]
    #     if not svg_files:
    #         print("[ERROR] No SVG files found in:", svg_dir)
    #         return
        
    
    #     grayscale_values = [255, 248, 237, 226, 215, 204, 193, 182, 171, 160,
    #                         149, 138, 127, 116, 105, 94, 83, 72, 61, 50]
    #     rgb_to_gray = {
    #         f'#{r:02x}{g:02x}{b:02x}': f'#{v:02x}{v:02x}{v:02x}'
    #         for (r, g, b), v in zip(self.color_labels, grayscale_values)
    #     }
    
    #     for filename in svg_files:
    #         svg_path = os.path.join(svg_dir, filename)
    #         print(f"[DEBUG] Processing SVG path: {svg_path}")
    #         tree = ET.parse(svg_path)
    #         root = tree.getroot()
    
    #         for elem in root.iter():
    #             fill = elem.attrib.get("fill", "")
    #             style = elem.attrib.get("style", "")
    #             color = self._normalize_color(fill, style)
    #             if color in rgb_to_gray:
    #                 elem.set("fill", rgb_to_gray[color])
    
    #         svg_bytes = BytesIO()
    #         tree.write(svg_bytes, encoding='utf-8')
    #         svg_bytes.seek(0)
    #         renderer = QSvgRenderer(svg_bytes.read())
    
    #         # image = QImage(width, height, QImage.Format.Format_ARGB32)
    #         image = QImage(width, height, QImage.Format.Format_RGB32)  # ← ARGBでなくRGBにする
    #         image.fill(Qt.GlobalColor.black)  # 背景

    #         if image.isNull():
    #             print("[ERROR] QImage creation failed")
    #             continue
    #         image.fill(0)
    
    #         painter = QPainter()
    #         if not painter.begin(image):
    #             print(f"[ERROR] QPainter failed for {svg_path}")
    #             continue
    #         painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)
    #         painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, False)

    #         renderer.render(painter)
    #         painter.end()
    
    #         save_path = os.path.join(output_dir, filename.replace(".svg", ".tiff"))
    #         image.save(save_path, "TIFF")
    #         print(f"[SAVED] {save_path}")
    
    #     print(f"[INFO] Exported {len(svg_files)} grayscale TIFF files to: {output_dir}")
    
    def export_all_svgs_to_grayscale_tiff(self):
        from datetime import datetime
        import os
        from PyQt6.QtWidgets import QApplication
    
        app = QApplication.instance()
        if app is None:
            app = QApplication([])
    
        if not self.image_paths:
            print("[ERROR] No images loaded.")
            return
    
        grayscale_values = [255, 248, 237, 226, 215, 204, 193, 182, 171, 160,
                            149, 138, 127, 116, 105, 94, 83, 72, 61, 50]
    
        def _nums(s):
            import re
            m = re.findall(r"\d+", s)
            return tuple(map(int, m)) if m else (s,)
    
        keys = sorted(self.image_paths.keys(), key=_nums)
        if not keys:
            print("[ERROR] No image keys found.")
            return
    
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = os.path.join(os.getcwd(), f"tiff_output_{timestamp}")
        os.makedirs(output_dir, exist_ok=True)
    
        exported_count = 0
    
        for key in keys:
            try:
                label_mask = self.ensure_label_mask_exists(key)
    
                if label_mask.ndim != 2:
                    print(f"[WARN] Invalid label mask ndim for {key}: {label_mask.ndim}")
                    continue
    
                height, width = label_mask.shape
                gray_img = np.zeros((height, width), dtype=np.uint8)
    
                for obj_id, gray_value in enumerate(grayscale_values, start=1):
                    gray_img[label_mask == obj_id] = gray_value
    
                save_path = os.path.join(output_dir, f"mask{key}.tiff")
                ok = cv2.imwrite(save_path, gray_img)
                if ok:
                    print(f"[SAVED] {save_path}")
                    exported_count += 1
                else:
                    print(f"[ERROR] Failed to save TIFF: {save_path}")
    
            except Exception as e:
                print(f"[WARN] Failed to export TIFF for {key}: {e}")
    
        print(f"[INFO] Exported {exported_count} grayscale TIFF files to: {output_dir}")
        self.label_status.setText(f"✅ Exported {exported_count} grayscale TIFFs")    



    # def export_all_svgs_to_grayscale_tiff_reversed(self):
    #     from PyQt6.QtGui import QImage, QPainter, QPixmap
    #     from xml.etree import ElementTree as ET
    #     from io import BytesIO
    #     from datetime import datetime
    #     import os
    #     from PyQt6.QtWidgets import QApplication
    
    #     app = QApplication.instance()
    #     if app is None:
    #         app = QApplication([])
    
    #     if not self.image_paths:
    #         print("[ERROR] No images loaded.")
    #         return
    
    #     first_image_path = list(self.image_paths.values())[0]
    #     pixmap = QPixmap(first_image_path)
    #     width = pixmap.width()
    #     height = pixmap.height()
    #     if width == 0 or height == 0:
    #         print(f"[ERROR] Failed to get valid size from: {first_image_path}")
    #         return
    
    #     timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    #     output_dir = os.path.join(os.getcwd(), f"tiff_output_reversed_{timestamp}")
    #     os.makedirs(output_dir, exist_ok=True)
    
    #     svg_dir = self.output_mask_dir
    #     svg_files = sorted([f for f in os.listdir(svg_dir) if f.endswith(".svg")])
    
    #     if not svg_files:
    #         print("[ERROR] No SVG files found in:", svg_dir)
    #         return
    
    #     grayscale_values = [255, 248, 237, 226, 215, 204, 193, 182, 171, 160,
    #                         149, 138, 127, 116, 105, 94, 83, 72, 61, 50]
    #     rgb_to_gray = {
    #         f'#{r:02x}{g:02x}{b:02x}': f'#{v:02x}{v:02x}{v:02x}'
    #         for (r, g, b), v in zip(self.color_labels, grayscale_values)
    #     }
    
    #     reversed_files = list(reversed(svg_files))
    #     total = len(reversed_files)
    
    #     for i, filename in enumerate(reversed_files):
    #         svg_path = os.path.join(svg_dir, filename)
    #         print(f"[DEBUG] Processing SVG path: {svg_path}")
    #         tree = ET.parse(svg_path)
    #         root = tree.getroot()
    
    #         for elem in root.iter():
    #             fill = elem.attrib.get("fill", "")
    #             style = elem.attrib.get("style", "")
    #             color = self._normalize_color(fill, style)
    #             if color in rgb_to_gray:
    #                 elem.set("fill", rgb_to_gray[color])
    
    #         svg_bytes = BytesIO()
    #         tree.write(svg_bytes, encoding='utf-8')
    #         svg_bytes.seek(0)
    #         renderer = QSvgRenderer(svg_bytes.read())
    
    #         image = QImage(width, height, QImage.Format.Format_RGB32)
    #         image.fill(Qt.GlobalColor.black)
    
    #         if image.isNull():
    #             print("[ERROR] QImage creation failed")
    #             continue
    
    #         painter = QPainter()
    #         if not painter.begin(image):
    #             print(f"[ERROR] QPainter failed for {svg_path}")
    #             continue
    #         painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)
    #         painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, False)
    
    #         renderer.render(painter)
    #         painter.end()
    
    #         save_filename = f"mask{i+1:04}.tiff"
    #         save_path = os.path.join(output_dir, save_filename)
    #         image.save(save_path, "TIFF")
    #         print(f"[SAVED] {save_path}")
    
    #     print(f"[INFO] Exported {total} TIFF files in reversed order to: {output_dir}")
    
    def export_all_svgs_to_grayscale_tiff_reversed(self):
        from datetime import datetime
        import os
        from PyQt6.QtWidgets import QApplication
    
        app = QApplication.instance()
        if app is None:
            app = QApplication([])
    
        if not self.image_paths:
            print("[ERROR] No images loaded.")
            return
    
        grayscale_values = [255, 248, 237, 226, 215, 204, 193, 182, 171, 160,
                            149, 138, 127, 116, 105, 94, 83, 72, 61, 50]
    
        def _nums(s):
            import re
            m = re.findall(r"\d+", s)
            return tuple(map(int, m)) if m else (s,)
    
        keys = sorted(self.image_paths.keys(), key=_nums)
        if not keys:
            print("[ERROR] No image keys found.")
            return
    
        reversed_keys = list(reversed(keys))
    
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = os.path.join(os.getcwd(), f"tiff_output_reversed_{timestamp}")
        os.makedirs(output_dir, exist_ok=True)
    
        exported_count = 0
    
        for i, key in enumerate(reversed_keys):
            try:
                label_mask = self.ensure_label_mask_exists(key)
    
                if label_mask.ndim != 2:
                    print(f"[WARN] Invalid label mask ndim for {key}: {label_mask.ndim}")
                    continue
    
                height, width = label_mask.shape
                gray_img = np.zeros((height, width), dtype=np.uint8)
    
                for obj_id, gray_value in enumerate(grayscale_values, start=1):
                    gray_img[label_mask == obj_id] = gray_value
    
                save_filename = f"mask{i+1:04}.tiff"
                save_path = os.path.join(output_dir, save_filename)
    
                ok = cv2.imwrite(save_path, gray_img)
                if ok:
                    print(f"[SAVED] {save_path}")
                    exported_count += 1
                else:
                    print(f"[ERROR] Failed to save TIFF: {save_path}")
    
            except Exception as e:
                print(f"[WARN] Failed to export reversed TIFF for {key}: {e}")
    
        print(f"[INFO] Exported {exported_count} TIFF files in reversed order to: {output_dir}")
        self.label_status.setText(f"✅ Exported {exported_count} reversed TIFFs")        



    # def export_nifti_labelmap(self):
    #     from PyQt6.QtGui import QImage, QPainter, QColor
    #     from PyQt6.QtCore import Qt
    #     from xml.etree import ElementTree as ET
    #     from io import BytesIO
    #     from datetime import datetime
    #     import numpy as np
    #     import os
    
    #     # 画像サイズの決定
    #     if not self.image_paths:
    #         self.label_status.setText("⚠ No images loaded.")
    #         return
    #     first_image_path = list(self.image_paths.values())[0]
    #     pix = QPixmap(first_image_path)
    #     W, H = pix.width(), pix.height()
    #     if W == 0 or H == 0:
    #         self.label_status.setText("⚠ Failed to get image size.")
    #         return
    
    #     # スケール（mm/px, z spacing）
    #     mm_per_px = self.mm_per_px if self.mm_per_px is not None else 1.0
    #     z_spacing = self.z_spacing_mm if self.z_spacing_mm is not None else 1.0
    #     if self.mm_per_px is None or self.z_spacing_mm is None:
    #         self.label_status.setText("⚠ mm/px or z-spacing not set. Using 1.0 mm by default.")
    
    #     # SVG 群
    #     svg_dir = getattr(self, "output_mask_dir", None)
    #     if not svg_dir or not os.path.isdir(svg_dir):
    #         self.label_status.setText("⚠ No SVG mask folder.")
    #         return
    #     svg_files = [f for f in os.listdir(svg_dir) if f.lower().endswith(".svg")]
    #     if not svg_files:
    #         self.label_status.setText("⚠ No SVG files found.")
    #         return
    
    #     # ファイル名の数値順（0001, 0002, ... を意識）
    #     def _nums(s): 
    #         import re
    #         m = re.findall(r"\d+", s)
    #         return tuple(map(int, m)) if m else (s,)
    #     svg_files = sorted(svg_files, key=_nums)
    
    #     # 色→ラベルIDの辞書（1..20）
    #     rgb_list = list(self.color_labels)  # [(R,G,B), ...] 長さ20想定
    #     color_to_label = { (r, g, b): i+1 for i, (r, g, b) in enumerate(rgb_list) }
    
    #     # HEX → (R,G,B)
    #     def _hex_to_rgb(hx: str):
    #         hx = hx.lstrip("#")
    #         return (int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16))
    
    #     # ラスタライズ & ラベリング
    #     volume_slices = []
    #     for name in svg_files:
    #         svg_path = os.path.join(svg_dir, name)
    
    #         # SVGをそのまま描画して「色画像」を作る
    #         img = QImage(W, H, QImage.Format.Format_RGB32)
    #         img.fill(Qt.GlobalColor.black)  # 背景=黒
    #         p = QPainter(img); p.setRenderHint(QPainter.RenderHint.Antialiasing, False)
    
    #         # 直接パースして path 毎に描画（fill色で塗る）
    #         try:
    #             tree = ET.parse(svg_path)
    #             root = tree.getroot()
    #         except Exception as e:
    #             print(f"[WARN] SVG parse failed: {svg_path}: {e}")
    #             p.end()
    #             continue
    
    #         # pathごとに塗る（fill-ruleは evenodd 前提）
    #         for el in root.iter():
    #             fill = el.attrib.get("fill", "").strip().lower()
    #             style = el.attrib.get("style", "").strip().lower()
    #             if "fill:" in style:
    #                 import re
    #                 m = re.search(r"fill:([^;]+)", style)
    #                 if m:
    #                     fill = m.group(1).strip().lower()
    #             if not fill or fill == "none":
    #                 continue
    
    #             # rgb() → #RRGGBB 正規化
    #             if fill.startswith("rgb("):
    #                 import re
    #                 m = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', fill)
    #                 if m:
    #                     r, g, b = map(int, m.groups())
    #                     fill = f"#{r:02x}{g:02x}{b:02x}"
    
    #             if not fill.startswith("#") or len(fill) != 7:
    #                 continue
    
    #             # d属性からQPainterPathへ
    #             d = el.attrib.get("d", None)
    #             if not d:
    #                 continue
    #             qpath = self.svg_d_to_qpath(d)
    #             if qpath.isEmpty():
    #                 continue
    
    #             # 塗り色
    #             r, g, b = _hex_to_rgb(fill)
    #             p.setPen(Qt.PenStyle.NoPen)
    #             p.setBrush(QColor(r, g, b))
    #             p.drawPath(qpath)
    
    #         p.end()
    
    #         # QImage → numpy (H,W,3)
    #         ptr = img.bits()
    #         ptr.setsize(img.width() * img.height() * 4)  # RGBA(=ARGB32) だけどRGB32も4byte/px
    #         arr = np.frombuffer(ptr, dtype=np.uint8).reshape((H, W, 4))[:, :, :3]  # RGB
    
    #         # 色→ラベルID（完全一致）
    #         # まず背景0で初期化してから、各色を一致置換
    #         label_slice = np.zeros((H, W), dtype=np.uint8)
    #         for (r, g, b), lab in color_to_label.items():
    #             mask = (arr[:, :, 0] == r) & (arr[:, :, 1] == g) & (arr[:, :, 2] == b)
    #             label_slice[mask] = lab
    
    #         volume_slices.append(label_slice)
    
    #     if not volume_slices:
    #         self.label_status.setText("⚠ No valid slices to export.")
    #         return
    
    #     # (H,W,Z) → (X,Y,Z) に転置（X=cols, Y=rows）
    #     vol = np.stack(volume_slices, axis=-1)              # (H, W, Z)
    #     vol = np.transpose(vol, (1, 0, 2)).astype(np.uint8) # (W, H, Z) → NIfTIの(X,Y,Z)想定
    
    #     # # アフィン（RAS前提の等軸スケール）
    #     # affine = np.array([
    #     #     [mm_per_px,      0.0,       0.0, 0.0],
    #     #     [0.0,       mm_per_px,       0.0, 0.0],
    #     #     [0.0,            0.0,   z_spacing, 0.0],
    #     #     [0.0,            0.0,       0.0, 1.0]
    #     # ], dtype=float)
    
    #     # img_nii = nib.Nifti1Image(vol, affine)
    #     # hdr = img_nii.header
                
    #     # ✅ アフィン（Y軸を反転 + 平行移動で画面系→RASへ補正）
    #     sx = float(mm_per_px)
    #     sy = float(mm_per_px)
    #     sz = float(z_spacing)
        
    #     affine = np.array([
    #         [ sx,  0.0, 0.0, 0.0            ],   # X: 右→左（画面の列）= +X
    #         [ 0.0, -sy, 0.0, (H - 1) * sy   ],   # Y: 画面の下向きをRASの+Yに合わせる
    #         [ 0.0,  0.0,  sz, 0.0            ],  # Z: スライス間隔
    #         [ 0.0,  0.0, 0.0, 1.0            ],
    #     ], dtype=float)
        
    #     img_nii = nib.Nifti1Image(vol, affine)
    #     img_nii.set_sform(affine, code=1)  # scanner anatomical
    #     img_nii.set_qform(affine, code=1)
        
    #     hdr = img_nii.header
    #     hdr.set_xyzt_units('mm','sec')
    #     hdr['descrip'] = b'SegRef3D labelmap (1-20); 0=background'
        
        
    #     hdr.set_xyzt_units('mm','sec')
    #     hdr['descrip'] = b'SegRef3D labelmap (1-20); 0=background'
    #     # 便利名
    #     timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    #     out_dir = os.path.join(os.getcwd(), f"nifti_output_{timestamp}")
    #     os.makedirs(out_dir, exist_ok=True)
    #     out_path = os.path.join(out_dir, "segref3d_labelmap.nii.gz")
    
    #     nib.save(img_nii, out_path)
    #     self.label_status.setText(f"✅ NIfTI exported: {out_path}  (voxel: {mm_per_px}×{mm_per_px}×{z_spacing} mm)")
        

    
    def export_nifti_labelmap(self):
        from datetime import datetime
        import numpy as np
        import os
    
        if not self.image_paths:
            self.label_status.setText("⚠ No images loaded.")
            return
    
        # # スケール（mm/px, z spacing）
        # mm_per_px = self.mm_per_px if self.mm_per_px is not None else 1.0
        # z_spacing = self.z_spacing_mm if self.z_spacing_mm is not None else 1.0
        # if self.mm_per_px is None or self.z_spacing_mm is None:
        #     self.label_status.setText("⚠ mm/px or z-spacing not set. Using 1.0 mm by default.")
                
        # スケール・原点
        sx, sy, sz, ox, oy, oz = self.get_nifti_spacing_origin()
        
        if self.mm_per_px is None or self.z_spacing_mm is None:
            self.label_status.setText("⚠ spacing not set. Using 1.0 mm by default.")        
    
        # 画像キーを数値順に並べる
        def _nums(s):
            import re
            m = re.findall(r"\d+", s)
            return tuple(map(int, m)) if m else (s,)
    
        keys = sorted(self.image_paths.keys(), key=_nums)
        if not keys:
            self.label_status.setText("⚠ No image keys found.")
            return
    
        volume_slices = []
    
        first_shape = None
        for key in keys:
            try:
                label_mask = self.ensure_label_mask_exists(key)
    
                if label_mask.ndim != 2:
                    print(f"[WARN] Invalid label mask ndim for {key}: {label_mask.ndim}")
                    continue
    
                if first_shape is None:
                    first_shape = label_mask.shape
                elif label_mask.shape != first_shape:
                    print(f"[WARN] Skipping {key}: shape mismatch {label_mask.shape} != {first_shape}")
                    continue
    
                volume_slices.append(label_mask.astype(np.uint8))
    
            except Exception as e:
                print(f"[WARN] Failed to collect label mask for {key}: {e}")
    
        if not volume_slices:
            self.label_status.setText("⚠ No valid slices to export.")
            return
    
        H, W = first_shape
    
        # (H, W, Z) -> (X, Y, Z)
        vol = np.stack(volume_slices, axis=-1)               # (H, W, Z)
        vol = np.transpose(vol, (1, 0, 2)).astype(np.uint8)  # (W, H, Z)
    
        # # affine
        # sx = float(mm_per_px)
        # sy = float(mm_per_px)
        # sz = float(z_spacing)
    
        # affine = np.array([
        #     [ sx,  0.0, 0.0, 0.0          ],
        #     [ 0.0, -sy, 0.0, (H - 1) * sy ],
        #     [ 0.0,  0.0,  sz, 0.0         ],
        #     [ 0.0,  0.0, 0.0, 1.0         ],
        # ], dtype=float)
                
        # affine
        affine = np.array([
            [ sx,  0.0, 0.0,              ox ],
            [ 0.0, -sy, 0.0,  oy + (H - 1) * sy ],
            [ 0.0,  0.0, sz,              oz ],
            [ 0.0,  0.0, 0.0,             1.0 ],
        ], dtype=float)        
    
        img_nii = nib.Nifti1Image(vol, affine)
        img_nii.set_sform(affine, code=1)
        img_nii.set_qform(affine, code=1)
    
        hdr = img_nii.header
        hdr.set_xyzt_units('mm', 'sec')
        hdr['descrip'] = b'SegRef3D labelmap (1-20); 0=background'
    
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_dir = os.path.join(os.getcwd(), f"nifti_output_{timestamp}")
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "segref3d_labelmap.nii.gz")
    
        nib.save(img_nii, out_path)
        # self.label_status.setText(
        #     f"✅ NIfTI exported ({len(volume_slices)} slices, voxel {mm_per_px}×{mm_per_px}×{z_spacing} mm)"
        # )
        self.label_status.setText(
            f"✅ NIfTI exported ({len(volume_slices)} slices)"
        )

        

    
    # def export_nifti_labelmap_reversed(self):
    #     """
    #     Z 軸（上下）を反転して NIfTI 出力（vol はそのまま・アフィンで反転）
    #     """
    #     from PyQt6.QtGui import QImage, QPainter, QColor, QPixmap
    #     from PyQt6.QtCore import Qt
    #     from xml.etree import ElementTree as ET
    #     from io import BytesIO
    #     from datetime import datetime
    #     import numpy as np
    #     import os, re, nibabel as nib
    
    #     # 画像サイズの決定
    #     if not self.image_paths:
    #         self.label_status.setText("⚠ No images loaded.")
    #         return
    #     first_image_path = list(self.image_paths.values())[0]
    #     pix = QPixmap(first_image_path)
    #     W, H = pix.width(), pix.height()
    #     if W == 0 or H == 0:
    #         self.label_status.setText("⚠ Failed to get image size.")
    #         return
    
    #     # スケール
    #     mm_per_px = self.mm_per_px if self.mm_per_px is not None else 1.0
    #     z_spacing = self.z_spacing_mm if self.z_spacing_mm is not None else 1.0
    #     if self.mm_per_px is None or self.z_spacing_mm is None:
    #         self.label_status.setText("⚠ mm/px or z-spacing not set. Using 1.0 mm by default.")
    
    #     # SVG 群（数値順）
    #     svg_dir = getattr(self, "output_mask_dir", None)
    #     if not svg_dir or not os.path.isdir(svg_dir):
    #         self.label_status.setText("⚠ No SVG mask folder.")
    #         return
    #     svg_files = [f for f in os.listdir(svg_dir) if f.lower().endswith(".svg")]
    #     if not svg_files:
    #         self.label_status.setText("⚠ No SVG files found.")
    #         return
    #     def _nums(s):
    #         m = re.findall(r"\d+", s)
    #         return tuple(map(int, m)) if m else (s,)
    #     svg_files = sorted(svg_files, key=_nums)
    
    #     # 色→ラベルID辞書
    #     rgb_list = list(self.color_labels)  # [(R,G,B), ...]
    #     color_to_label = { (r, g, b): i+1 for i, (r, g, b) in enumerate(rgb_list) }
    #     def _hex_to_rgb(hx: str):
    #         hx = hx.lstrip("#")
    #         return (int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16))
    
    #     # ラスタライズ & ラベリング（vol は通常順）
    #     volume_slices = []
    #     for name in svg_files:
    #         svg_path = os.path.join(svg_dir, name)
    #         img = QImage(W, H, QImage.Format.Format_RGB32)
    #         img.fill(Qt.GlobalColor.black)
    #         p = QPainter(img)
    #         p.setRenderHint(QPainter.RenderHint.Antialiasing, False)
    
    #         try:
    #             tree = ET.parse(svg_path)
    #             root = tree.getroot()
    #         except Exception as e:
    #             print(f"[WARN] SVG parse failed: {svg_path}: {e}")
    #             p.end()
    #             continue
    
    #         for el in root.iter():
    #             fill = el.attrib.get("fill", "").strip().lower()
    #             style = el.attrib.get("style", "").strip().lower()
    #             if "fill:" in style:
    #                 m = re.search(r"fill:([^;]+)", style)
    #                 if m: fill = m.group(1).strip().lower()
    #             if not fill or fill == "none":
    #                 continue
    #             if fill.startswith("rgb("):
    #                 m = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', fill)
    #                 if m:
    #                     r, g, b = map(int, m.groups())
    #                     fill = f"#{r:02x}{g:02x}{b:02x}"
    #             if not (fill.startswith("#") and len(fill) == 7):
    #                 continue
    
    #             d = el.attrib.get("d", None)
    #             if not d: continue
    #             qpath = self.svg_d_to_qpath(d)
    #             if qpath.isEmpty(): continue
    
    #             r, g, b = _hex_to_rgb(fill)
    #             p.setPen(Qt.PenStyle.NoPen)
    #             p.setBrush(QColor(r, g, b))
    #             p.drawPath(qpath)
    
    #         p.end()
    #         ptr = img.bits(); ptr.setsize(img.width()*img.height()*4)
    #         arr = np.frombuffer(ptr, dtype=np.uint8).reshape((H, W, 4))[:, :, :3]
    #         label_slice = np.zeros((H, W), dtype=np.uint8)
    #         for (r, g, b), lab in color_to_label.items():
    #             mask = (arr[:, :, 0] == r) & (arr[:, :, 1] == g) & (arr[:, :, 2] == b)
    #             label_slice[mask] = lab
    #         volume_slices.append(label_slice)
    
    #     if not volume_slices:
    #         self.label_status.setText("⚠ No valid slices to export.")
    #         return
    
    #     # (H,W,Z) → (X,Y,Z)
    #     vol = np.stack(volume_slices, axis=-1)              # (H, W, Z)
    #     vol = np.transpose(vol, (1, 0, 2)).astype(np.uint8) # (W, H, Z)
    #     D = vol.shape[2]
    
    #     # ✅ 反転アフィン：Z スケールを負に、並進に (D-1)*sz
    #     sx = float(mm_per_px); sy = float(mm_per_px); sz = float(z_spacing)
    #     affine = np.array([
    #         [ sx,  0.0,  0.0,            0.0 ],
    #         [ 0.0, -sy,  0.0,   (H - 1) * sy ],
    #         [ 0.0,  0.0, -sz,   (D - 1) * sz ],
    #         [ 0.0,  0.0,  0.0,            1.0 ],
    #     ], dtype=float)
    
    #     img_nii = nib.Nifti1Image(vol, affine)
    #     img_nii.set_sform(affine, code=1)
    #     img_nii.set_qform(affine, code=1)
    #     hdr = img_nii.header
    #     hdr.set_xyzt_units('mm','sec')
    #     hdr['descrip'] = b'SegRef3D labelmap (1-20); 0=background; Z reversed'
    
    #     timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    #     out_dir = os.path.join(os.getcwd(), f"nifti_output_{timestamp}")
    #     os.makedirs(out_dir, exist_ok=True)
    #     out_path = os.path.join(out_dir, "segref3d_labelmap_revZ.nii.gz")
    #     nib.save(img_nii, out_path)
    #     self.label_status.setText(
    #         f"✅ NIfTI (Z reversed) exported: {out_path}  (voxel: {sx}×{sy}×{sz} mm)"
    #     )

    
    def export_nifti_labelmap_reversed(self):
        """
        Z 軸（上下）を反転して NIfTI 出力
        vol は通常順のまま、アフィンで Z を反転
        """
        from datetime import datetime
        import numpy as np
        import os
    
        if not self.image_paths:
            self.label_status.setText("⚠ No images loaded.")
            return
    
        # # スケール
        # mm_per_px = self.mm_per_px if self.mm_per_px is not None else 1.0
        # z_spacing = self.z_spacing_mm if self.z_spacing_mm is not None else 1.0
        # if self.mm_per_px is None or self.z_spacing_mm is None:
        #     self.label_status.setText("⚠ mm/px or z-spacing not set. Using 1.0 mm by default.")
            
        # スケール・原点
        sx, sy, sz, ox, oy, oz = self.get_nifti_spacing_origin()
        
        if self.mm_per_px is None or self.z_spacing_mm is None:
            self.label_status.setText("⚠ spacing not set. Using 1.0 mm by default.")    
    
        # 画像キーを数値順に並べる
        def _nums(s):
            import re
            m = re.findall(r"\d+", s)
            return tuple(map(int, m)) if m else (s,)
    
        keys = sorted(self.image_paths.keys(), key=_nums)
        if not keys:
            self.label_status.setText("⚠ No image keys found.")
            return
    
        volume_slices = []
    
        first_shape = None
        for key in keys:
            try:
                label_mask = self.ensure_label_mask_exists(key)
    
                if label_mask.ndim != 2:
                    print(f"[WARN] Invalid label mask ndim for {key}: {label_mask.ndim}")
                    continue
    
                if first_shape is None:
                    first_shape = label_mask.shape
                elif label_mask.shape != first_shape:
                    print(f"[WARN] Skipping {key}: shape mismatch {label_mask.shape} != {first_shape}")
                    continue
    
                volume_slices.append(label_mask.astype(np.uint8))
    
            except Exception as e:
                print(f"[WARN] Failed to collect label mask for {key}: {e}")
    
        if not volume_slices:
            self.label_status.setText("⚠ No valid slices to export.")
            return
    
        H, W = first_shape
    
        # (H, W, Z) -> (X, Y, Z)
        vol = np.stack(volume_slices, axis=-1)               # (H, W, Z)
        vol = np.transpose(vol, (1, 0, 2)).astype(np.uint8)  # (W, H, Z)
        D = vol.shape[2]
    
        # # Z反転アフィン
        # sx = float(mm_per_px)
        # sy = float(mm_per_px)
        # sz = float(z_spacing)
    
        # affine = np.array([
        #     [ sx,  0.0,  0.0,          0.0 ],
        #     [ 0.0, -sy,  0.0, (H - 1) * sy ],
        #     [ 0.0,  0.0, -sz, (D - 1) * sz ],
        #     [ 0.0,  0.0,  0.0,          1.0 ],
        # ], dtype=float)
        
        # Z反転アフィン
        affine = np.array([
            [ sx,  0.0,  0.0,              ox ],
            [ 0.0, -sy,  0.0,  oy + (H - 1) * sy ],
            [ 0.0,  0.0, -sz,  oz + (D - 1) * sz ],
            [ 0.0,  0.0,  0.0,             1.0 ],
        ], dtype=float)
    
        img_nii = nib.Nifti1Image(vol, affine)
        img_nii.set_sform(affine, code=1)
        img_nii.set_qform(affine, code=1)
    
        hdr = img_nii.header
        hdr.set_xyzt_units('mm', 'sec')
        hdr['descrip'] = b'SegRef3D labelmap (1-20); 0=background; Z reversed'
    
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_dir = os.path.join(os.getcwd(), f"nifti_output_{timestamp}")
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "segref3d_labelmap_revZ.nii.gz")
    
        nib.save(img_nii, out_path)
        # self.label_status.setText(
        #     f"✅ NIfTI (Z reversed) exported ({len(volume_slices)} slices, voxel {sx}×{sy}×{sz} mm)"
        # )
        self.label_status.setText(
            f"✅ NIfTI (Z reversed) exported ({len(volume_slices)} slices)"
        )



    def on_remove_small_parts(self):
        threshold = self.spinbox_threshold.value()
        self.delete_small_parts_in_selected_object(min_area_threshold=threshold)


    

    # def delete_small_parts_in_selected_object(self, min_area_threshold=None):
    #     if min_area_threshold is None:
    #         min_area_threshold = self.spinbox_threshold.value()  # ✅ UIから取得
            
    #     from xml.etree import ElementTree as ET
    #     from svgpathtools import parse_path
    #     from PyQt6.QtGui import QPainterPath
    #     import re
    
    #     def normalize_color(fill, style):
    #         def rgb_to_hex(rgb_str):
    #             match = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', rgb_str)
    #             if match:
    #                 r, g, b = map(int, match.groups())
    #                 return f'#{r:02x}{g:02x}{b:02x}'
    #             return rgb_str.strip().lower()
    
    #         color = ""
    #         if style and "fill:" in style:
    #             match = re.search(r'fill:([^;"]+)', style)
    #             if match:
    #                 color = match.group(1).strip().lower()
    #         elif fill:
    #             color = fill.strip().lower()
                
    #         if color.startswith("rgb"):
    #             return rgb_to_hex(color).lower()  # ✅ 小文字統一
    #         return color.lower()  # ✅ 小文字統一

    #     # 対象オブジェクト番号と色（hex）
    #     obj_index = self.combo_delete_object.currentIndex()
    #     target_rgb = self.color_labels[obj_index]
    #     target_hex = '#{:02x}{:02x}{:02x}'.format(*target_rgb).lower()

    
    #     deleted_count = 0
                
    #     # ✅ 一括編集のためUndo保存（全SVG）
    #     self.save_svg_state_for_undo("__global__")        
    #     for key, svg_path in self.mask_paths.items():
    #         # self.save_svg_state_for_undo(key)  # ✅ ここでUndo用バックアップを保存
    #         tree = ET.parse(svg_path)
    #         root = tree.getroot()
    #         parent_map = {c: p for p in root.iter() for c in p}
    #         changed = False
    
    #         for elem in list(root.iter()):

    #             tag = elem.tag
    #             if '}' in tag:
    #                 tag = tag.split('}', 1)[1]  # 名前空間を除去
                
    #             if tag.lower() != "path":
    #                 continue
            
    
    #             fill = normalize_color(elem.attrib.get("fill", ""), elem.attrib.get("style", ""))
    #             if fill != target_hex:
    #                 continue
    
    #             d = elem.attrib.get("d", "")
    #             if not d:
    #                 continue
     
    #             def polygon_area_from_points(points):
    #                 if len(points) < 3:
    #                     return 0.0
    #                 area = 0.0
    #                 for i in range(len(points)):
    #                     x1, y1 = points[i].x(), points[i].y()
    #                     x2, y2 = points[(i + 1) % len(points)].x(), points[(i + 1) % len(points)].y()
    #                     area += (x1 * y2 - x2 * y1)
    #                 return abs(area) / 2.0                
                
                
    #             # qpath = svg_d_to_qpath(d)
    #             qpath = self.svg_d_to_qpath(d)
    #             if not qpath:
    #                 continue
                
    #             polygons = qpath.toSubpathPolygons()
    #             total_area = sum(polygon_area_from_points(poly) for poly in polygons)
                
    #             print(f"[DEBUG] Area: {total_area:.2f} px² for object {obj_index+1}")
                
                
                
                
                
                
    #             # if total_area < min_area_threshold:
    #             #     parent = parent_map.get(elem)
    #             #     if parent is not None:
    #             #         parent.remove(elem)
    #             #         deleted_count += 1
    #             #         changed = True
                
    #             # 新しいパスデータを構築
    #             new_path_data = ""
    #             kept_count = 0
    #             for poly in polygons:
    #                 area = polygon_area_from_points(poly)
    #                 if area >= min_area_threshold:
    #                     kept_count += 1
    #                     new_path_data += "M " + " L ".join(f"{pt.x()},{pt.y()}" for pt in poly) + " Z "
    #                 else:
    #                     print(f"[DEBUG] Removed subpath with area {area:.2f} px² (below threshold)")
                
    #             if kept_count == 0:
    #                 # 全部小さくて削除された場合 → path要素自体を削除
    #                 parent = parent_map.get(elem)
    #                 if parent is not None:
    #                     parent.remove(elem)
    #                     deleted_count += 1
    #                     changed = True
    #             else:
    #                 # 一部でも残ったら、d属性を書き換え
    #                 elem.set("d", new_path_data.strip())
    #                 changed = True
                        
                        
                        
                        
    
    #         if changed:
    #             save_path = os.path.join(self.output_mask_dir, os.path.basename(svg_path))
    #             tree.write(save_path, encoding="utf-8")
    #             self.mask_paths[key] = save_path
    #             print(f"[INFO] Removed small parts of object {obj_index+1} in {os.path.basename(svg_path)}")
    
    #     self.display_current_image()
    #     self.scene.update()
    #     self.label_status.setText(f"Removed small parts of object {obj_index+1} from all SVGs. ({deleted_count} elements removed)")


    
    def delete_small_parts_in_selected_object(self, min_area_threshold=None):
        if min_area_threshold is None:
            min_area_threshold = self.spinbox_threshold.value()
    
        obj_id = self.combo_delete_object.currentIndex() + 1
    
        deleted_images = 0
        deleted_components_total = 0
    
        for key in sorted(self.image_paths.keys()):
            try:
                label_mask = self.ensure_label_mask_exists(key)
    
                # 対象オブジェクトだけのバイナリ
                binary = (label_mask == obj_id).astype(np.uint8)
    
                if np.count_nonzero(binary) == 0:
                    continue
    
                # 連結成分解析
                num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    
                removed_any = False
                removed_count_this_image = 0
    
                # 0は背景なので1から
                for comp_id in range(1, num_labels):
                    area = stats[comp_id, cv2.CC_STAT_AREA]
    
                    if area < min_area_threshold:
                        label_mask[labels == comp_id] = 0
                        removed_any = True
                        removed_count_this_image += 1
    
                if removed_any:
                    self.save_label_mask_png(key)
                    deleted_images += 1
                    deleted_components_total += removed_count_this_image
                    print(f"[INFO] Removed small parts of Obj {obj_id} in mask {key} ({removed_count_this_image} components)")
    
            except Exception as e:
                print(f"[WARN] Failed to remove small parts for {key}: {e}")
    
        self.display_current_image()
        self.scene.update()
        self.label_status.setText(
            f"✅ Removed small parts of Obj {obj_id} in {deleted_images} image(s)"
        )







    
    # def delete_selected_object_from_current_image(self):
    #     # self.save_svg_state_for_undo("__global__")
    #     key = self.get_current_image_key()
    #     if key:
    #         self.save_svg_state_for_undo(key)
        
        
        
    #     from xml.etree import ElementTree as ET
    #     import re
    #     import os
    
    #     def normalize_color(fill, style):
    #         def rgb_to_hex(rgb_str):
    #             match = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', rgb_str)
    #             if match:
    #                 r, g, b = map(int, match.groups())
    #                 return f'#{r:02x}{g:02x}{b:02x}'
    #             return rgb_str.strip().lower()
    
    #         color = ""
    #         if style and "fill:" in style:
    #             match = re.search(r'fill:([^;"]+)', style)
    #             if match:
    #                 color = match.group(1).strip().lower()
    #         elif fill:
    #             color = fill.strip().lower()
    
    #         if color.startswith("rgb"):
    #             return rgb_to_hex(color)
    #         return color
    
    #     # 現在表示中の画像キーと対応SVG取得
    #     key = self.get_current_image_key()
    #     svg_path = self.mask_paths[key]
    
    #     # 削除対象の色を決定
    #     obj_index = self.combo_delete_object.currentIndex()
    #     target_rgb = self.color_labels[obj_index]
    #     target_hex = '#{:02x}{:02x}{:02x}'.format(*target_rgb)
    
    #     # SVGを読み込み、該当 path を削除
    #     tree = ET.parse(svg_path)
    #     root = tree.getroot()
    #     parent_map = {c: p for p in root.iter() for c in p}
    #     deleted_count = 0
    
    #     for elem in list(root.iter()):
    #         if not elem.tag.lower().endswith("path"):
    #             continue
    
    #         fill = normalize_color(elem.attrib.get("fill", ""), elem.attrib.get("style", ""))
    #         if fill == target_hex:
    #             parent = parent_map.get(elem)
    #             if parent is not None:
    #                 parent.remove(elem)
    #                 deleted_count += 1
    
    #     # 保存先に書き戻す
    #     save_path = os.path.join(self.output_mask_dir, os.path.basename(svg_path))
    #     tree.write(save_path, encoding="utf-8")
    #     self.mask_paths[key] = save_path
    
    #     # GUI更新
    #     self.display_current_image()
    #     self.scene.update()
    #     self.label_status.setText(f"Deleted object {obj_index+1} from {os.path.basename(svg_path)}. ({deleted_count} elements removed)")


    
    def delete_selected_object_from_current_image(self):
        key = self.get_current_image_key()
        if not key:
            self.label_status.setText("⚠ No current image selected.")
            return
    
        try:
            label_mask = self.ensure_label_mask_exists(key)
        except Exception as e:
            self.label_status.setText(f"⚠ Failed to load label mask: {e}")
            return
    
        obj_id = self.combo_delete_object.currentIndex() + 1
    
        deleted_pixels = int(np.count_nonzero(label_mask == obj_id))
        label_mask[label_mask == obj_id] = 0
    
        self.save_label_mask_png(key)
    
        self.display_current_image()
        self.scene.update()
        self.label_status.setText(
            f"✅ Deleted Obj {obj_id} from current image ({deleted_pixels} px)"
        )





    
    
    # def delete_selected_object(self):
       
    #     from xml.etree import ElementTree as ET
    #     import re
        
    #     # ✅ 全画像Undo保存（ループ前に1回だけ！）
    #     self.save_svg_state_for_undo()    
        
    #     def normalize_color(fill, style):
    #         def rgb_to_hex(rgb_str):
    #             match = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', rgb_str)
    #             if match:
    #                 r, g, b = map(int, match.groups())
    #                 return f'#{r:02x}{g:02x}{b:02x}'
    #             return rgb_str.strip().lower()
    
    #         color = ""
    #         if style and "fill:" in style:
    #             match = re.search(r'fill:([^;"]+)', style)
    #             if match:
    #                 color = match.group(1).strip().lower()
    #         elif fill:
    #             color = fill.strip().lower()
    
    #         if color.startswith("rgb"):
    #             return rgb_to_hex(color)
    #         return color
    
    #     # オブジェクト番号（1〜20）を取得し、その色を決定
    #     obj_index = self.combo_delete_object.currentIndex()
    #     target_rgb = self.color_labels[obj_index]
    #     target_hex = '#{:02x}{:02x}{:02x}'.format(*target_rgb)
    
    #     deleted_count = 0
    #     for key, svg_path in self.mask_paths.items():
    #         # self.save_svg_state_for_undo(key)
    #         tree = ET.parse(svg_path)
    #         root = tree.getroot()
    #         parent_map = {c: p for p in root.iter() for c in p}
    #         changed = False
    
    #         for elem in list(root.iter()):
    #             tag = elem.tag.lower()
    #             if not tag.endswith("path"):
    #                 continue
    
    #             fill = normalize_color(elem.attrib.get("fill", ""), elem.attrib.get("style", ""))
    #             if fill == target_hex:
    #                 parent = parent_map.get(elem)
    #                 if parent is not None:
    #                     parent.remove(elem)
    #                     deleted_count += 1
    #                     changed = True
    
    #         if changed:
    #             save_path = os.path.join(self.output_mask_dir, os.path.basename(svg_path))
    #             tree.write(save_path, encoding="utf-8")
    #             self.mask_paths[key] = save_path  # 更新
    #             print(f"[INFO] Deleted object {obj_index+1} from {os.path.basename(svg_path)}")
    
    #     self.display_current_image()
    #     self.scene.update()
    #     self.label_status.setText(f"Deleted object {obj_index+1} from all SVGs. ({deleted_count} elements removed)")
    
    def delete_selected_object(self):
        obj_id = self.combo_delete_object.currentIndex() + 1
    
        deleted_images = 0
        deleted_pixels_total = 0
    
        for key in sorted(self.image_paths.keys()):
            try:
                label_mask = self.ensure_label_mask_exists(key)
    
                deleted_pixels = int(np.count_nonzero(label_mask == obj_id))
                if deleted_pixels == 0:
                    continue
    
                label_mask[label_mask == obj_id] = 0
                self.save_label_mask_png(key)
    
                deleted_images += 1
                deleted_pixels_total += deleted_pixels
                print(f"[INFO] Deleted Obj {obj_id} from mask {key}")
    
            except Exception as e:
                print(f"[WARN] Failed to delete object for {key}: {e}")
    
        self.display_current_image()
        self.scene.update()
        self.label_status.setText(
            f"✅ Deleted Obj {obj_id} from {deleted_images} image(s)"
        )




    # def export_colorwise_stl_with_scale(self):
    #     import os
    #     import numpy as np
    #     from datetime import datetime
    #     from xml.etree import ElementTree as ET
    #     from PyQt6.QtGui import QImage, QPainter
    #     from PyQt6.QtCore import Qt
    #     from io import BytesIO
    #     from trimesh.voxel.ops import matrix_to_marching_cubes
    #     from trimesh.voxel import VoxelGrid
    #     from trimesh.smoothing import filter_laplacian
        

    #     if self.mm_per_px is None or self.z_spacing_mm is None:
    #         print(f"[DEBUG] Spacing values before CSV load: mm_per_px={self.mm_per_px}, z_spacing_mm={self.z_spacing_mm}")
                        
    #         import csv
    #         from PyQt6.QtWidgets import QFileDialog
            
    #         # 🔽 常にユーザーにCSVファイルを選ばせる
    #         file_path, _ = QFileDialog.getOpenFileName(self, "Select CSV File", "", "CSV Files (*.csv)")
    #         if not file_path:
    #             print("[ERROR] CSV file not selected. Aborting STL export.")
    #             return
            
    #         try:
    #             with open(file_path, newline='', encoding='utf-8') as f:
    #                 reader = csv.reader(f)
    #                 rows = list(reader)
            
    #                 x_spacing = float(rows[3][0])  # 4行目・1列目
    #                 z_spacing = float(rows[3][2])  # 4行目・3列目
            
    #                 self.mm_per_px = x_spacing
    #                 self.z_spacing_mm = z_spacing
    #                 print(f"[INFO] Loaded spacing: mm/px = {self.mm_per_px}, z = {self.z_spacing_mm}")
    #                 print(f"[DEBUG] Spacing values after CSV load: mm_per_px={self.mm_per_px}, z_spacing_mm={self.z_spacing_mm}")
    #         except Exception as e:
    #             print(f"[ERROR] Failed to read CSV file: {e}")
    #             return

    #     rgb_keys = [f"#{r:02x}{g:02x}{b:02x}" for r, g, b in self.color_labels]
    #     num_colors = len(rgb_keys)

    #     svg_dir = self.output_mask_dir
    #     svg_files = sorted([f for f in os.listdir(svg_dir) if f.endswith(".svg")])
    #     if not svg_files:
    #         print("[ERROR] No SVG files found")
    #         return
        
    #     svg_files.sort()  # デフォルトは昇順（mask0001.svg → maskNNNN.svg）
        
    #     # ✅ Stacking direction を UI から取得して反映
    #     # 0: Backside (ascending), 1: Frontside (descending)
    #     if self.combo_stack_order.currentIndex() == 0:
    #         svg_files.reverse()
    #         print("[INFO] Using descending stacking order (Frontside)")
    #     else:
    #         print("[INFO] Using ascending stacking order (Backside)")        

    #     first_svg = os.path.join(svg_dir, svg_files[0])
    #     renderer = QSvgRenderer(first_svg)
    #     width, height = renderer.defaultSize().width(), renderer.defaultSize().height()

    #     timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    #     output_dir = os.path.join(os.getcwd(), f"stl_output_{timestamp}")
    #     os.makedirs(output_dir, exist_ok=True)

    #     # masks_per_color = [np.zeros((len(svg_files), height, width), dtype=np.uint8) for _ in range(num_colors)]
    #     # ✅ チェックされているインデックスだけ抽出
    #     target_indices = [i for i, cb in enumerate(self.checkboxes) if cb.isChecked()]
    #     masks_per_color = [np.zeros((len(svg_files), height, width), dtype=np.uint8) for _ in target_indices]

        
    #     # 🔧 進捗表示関数を定義
    #     def update_progress_bar(label, task, current, total):
    #         percent = int(current / total * 100)
    #         bar_length = 20
    #         filled_length = int(bar_length * percent // 100)
    #         bar = '█' * filled_length + '-' * (bar_length - filled_length)
    #         label.setText(f"{task}... |{bar}| {percent}%")
    #         QApplication.processEvents()

        
    #     #進捗表示用
    #     self.label_status.setText("Generating masks from SVG...")
    #     QApplication.processEvents()



    #     svg_files = sorted([f for f in os.listdir(svg_dir) if f.endswith(".svg")])
    #     for z, fname in enumerate(svg_files):
    #         svg_path = os.path.join(svg_dir, fname)

    #         for out_idx, color_idx in enumerate(target_indices):  # ✅ 選択色だけ処理
    #             rgb = rgb_keys[color_idx]
    #             tree = ET.parse(svg_path)
    #             root = tree.getroot()
    #             parent_map = {c: p for p in root.iter() for c in p}
            
    #             for elem in list(root.iter()):
    #                 fill = elem.attrib.get("fill", "")
    #                 style = elem.attrib.get("style", "")
    #                 color = self._normalize_color(fill, style)
            
    #                 if color == rgb:
    #                     elem.set("fill", "white")
    #                     elem.attrib.pop("style", None)
    #                 else:
    #                     parent = parent_map.get(elem)
    #                     if parent is not None:
    #                         parent.remove(elem)
            
    #             svg_bytes = BytesIO()
    #             tree.write(svg_bytes, encoding='utf-8')
    #             svg_bytes.seek(0)
    #             renderer = QSvgRenderer(svg_bytes.read())
            
    #             image = QImage(width, height, QImage.Format.Format_Grayscale8)
    #             image.fill(Qt.GlobalColor.black)
    #             painter = QPainter(image)
    #             renderer.render(painter)
    #             painter.end()
            
    #             ptr = image.bits()
    #             ptr.setsize(image.width() * image.height())
    #             array = np.frombuffer(ptr, dtype=np.uint8).reshape((height, width))
                                
    #             # ✅ Frontside（降順）の場合は上下反転
    #             if self.combo_stack_order.currentIndex() == 0:
    #                 array = np.flipud(array)
                
                
    #             masks_per_color[out_idx][z] = (array > 127).astype(np.uint8) * 255
                            
            
                
    #             # ✅ 進捗表示更新（スライス単位）
    #             update_progress_bar(self.label_status, "Generating masks", z + 1, len(svg_files))                



    #     #進捗表示用
    #     self.label_status.setText("Exporting STL files...")
    #     QApplication.processEvents()
        
    #     num_valid_volumes = sum(np.count_nonzero(vol) > 0 for vol in masks_per_color)
    #     exported_count = 0
        
        
    #     # for i, volume in enumerate(masks_per_color):
    #     for i, volume in enumerate(masks_per_color):
    #         color_idx = target_indices[i]
    #         if np.count_nonzero(volume) == 0:
    #             continue
    #         print(f"[DEBUG] Final spacing values before STL export: mm_per_px={self.mm_per_px}, z_spacing_mm={self.z_spacing_mm}")
        
    #         if self.mm_per_px is None or self.z_spacing_mm is None:
    #             print("[ERROR] Calibration not completed.")
    #             return
        
                    
    #         # # 🔽 空でないスライスの範囲を抽出してトリミング
    #         # nonzero_slices = np.any(volume > 127, axis=(1, 2))
    #         # if not np.any(nonzero_slices):
    #         #     print(f"[SKIP] Object {color_idx+1} is completely empty. Skipped.")
    #         #     continue
            
    #         # z_start, z_end = np.where(nonzero_slices)[0][[0, -1]]
    #         # trimmed_volume = volume[z_start:z_end + 1]
            
    #         if np.count_nonzero(volume) == 0:
    #             print(f"[SKIP] Object {color_idx+1} is completely empty. Skipped.")
    #             continue
            
    #         binary_volume = (volume > 127)  # ✅ 修正点
        
        
        
    #         # ✅ VoxelGrid を使わずに直接メッシュ化
    #         mesh = matrix_to_marching_cubes(
    #             binary_volume,
    #             pitch=[self.z_spacing_mm, self.mm_per_px, self.mm_per_px]
    #         )
            
            
            
    #         # 🔽 スムージングモードとレベルを取得
    #         mode_text = self.combo_smooth_mode.currentText()
    #         level_str = self.combo_smooth_level.currentText().split("（")[0]
    #         smooth_level = int(level_str)
            
    #         from scipy.ndimage import zoom
            
    #         adjusted_z_spacing = self.z_spacing_mm  # 初期値
            
    #         # 🔽 Z方向補間（volume smoothing）
    #         if smooth_level > 0 and mode_text in ["Z-interpolation only", "Both"]:
    #             z_factor = 1.0 + smooth_level * 0.4
                
                
    #             binary_volume = zoom(
    #                 binary_volume.astype(np.uint8), 
    #                 zoom=[z_factor, 1.0, 1.0], 
    #                 order=3
    #             ) > 0.5
    #             adjusted_z_spacing = self.z_spacing_mm / z_factor  # 🔧 ここを追加
                
                
    #             print(f"[INFO] Applied Z-direction interpolation with factor {z_factor:.2f}")
    #         else:
    #             print("[INFO] Volume smoothing skipped")
            
      
            
    #         # ✅ 補正済みのピッチでメッシュ化
    #         mesh = matrix_to_marching_cubes(
    #             binary_volume,
    #             pitch=[adjusted_z_spacing, self.mm_per_px, self.mm_per_px]
    #         )            
            
            
    #         # 🔽 メッシュスムージング（surface smoothing）
    #         if smooth_level > 0 and mode_text in ["Mesh smoothing only", "Both"]:
    #             iterations = 10 + smooth_level * 5
                
    #             filter_laplacian(mesh, lamb=0.5, iterations=iterations)
    #             print(f"[INFO] Applied mesh smoothing: {iterations} iterations")
    #         else:
    #             print("[INFO] Mesh smoothing skipped")



        
    #         # stl_path = os.path.join(output_dir, f"object_{i+1:02}.stl")
    #         stl_path = os.path.join(output_dir, f"object_{color_idx + 1:02}.stl")
    #         mesh.export(stl_path)
    #         print(f"[SAVED] {stl_path}")          
                    
    #         # ✅ 進捗表示更新（色ごとのSTL出力単位）
    #         exported_count += 1
    #         update_progress_bar(self.label_status, "Exporting STLs", exported_count, num_valid_volumes)            
            

    #     self.label_status.setText(f"[Done] Exported STL per color to: {output_dir}")
    
        
    
    
    #     # 出力後に最新フォルダを特定してプレビュー
    #     try:
    #         # 直近で作成された stl_output_* フォルダを取得
    #         base_dir = os.getcwd()
    #         stl_dirs = [d for d in os.listdir(base_dir) if d.startswith("stl_output_")]
    #         if stl_dirs:
    #             latest_dir = max(stl_dirs, key=lambda d: os.path.getmtime(os.path.join(base_dir, d)))
    #             stl_dir_path = os.path.join(base_dir, latest_dir)
        
    #             # STLファイル一覧を取得
    #             stl_files = [os.path.join(stl_dir_path, f) for f in os.listdir(stl_dir_path) if f.lower().endswith(".stl")]
        
    #             if stl_files:
    #                 # dlg = STLPreviewDialog(self, stl_files)
    #                 # dlg.exec()
    #                 dlg = STLPreviewDialog(
    #                     parent=self,
    #                     stl_paths=stl_files,               # ← ここを stl_files に
    #                     color_labels=self.color_labels       # ← これが肝
    #                 )
    #                 dlg.exec()
                    
    #                 self.label_status.setText(f"✅ Preview opened for {len(stl_files)} STL files in '{latest_dir}'")
    #             else:
    #                 self.label_status.setText("⚠ No STL files found in latest output folder.")
    #         else:
    #             self.label_status.setText("⚠ No stl_output_* folder found.")
    #     except Exception as e:
    #         self.label_status.setText(f"⚠ Failed to open preview: {e}")

    
    def export_colorwise_stl_with_scale(self):
        import os
        import numpy as np
        from datetime import datetime
        from trimesh.voxel.ops import matrix_to_marching_cubes
        from trimesh.smoothing import filter_laplacian
    
        if self.mm_per_px is None or self.z_spacing_mm is None:
            print(f"[DEBUG] Spacing values before CSV load: mm_per_px={self.mm_per_px}, z_spacing_mm={self.z_spacing_mm}")
    
            import csv
            from PyQt6.QtWidgets import QFileDialog
    
            file_path, _ = QFileDialog.getOpenFileName(self, "Select CSV File", "", "CSV Files (*.csv)")
            if not file_path:
                print("[ERROR] CSV file not selected. Aborting STL export.")
                return
    
            try:
                with open(file_path, newline='', encoding='utf-8') as f:
                    reader = csv.reader(f)
                    rows = list(reader)
    
                    x_spacing = float(rows[3][0])  # 4行目・1列目
                    z_spacing = float(rows[3][2])  # 4行目・3列目
    
                    self.mm_per_px = x_spacing
                    self.z_spacing_mm = z_spacing
                    print(f"[INFO] Loaded spacing: mm/px = {self.mm_per_px}, z = {self.z_spacing_mm}")
            except Exception as e:
                print(f"[ERROR] Failed to read CSV file: {e}")
                return
    
        if not self.image_paths:
            self.label_status.setText("⚠ No images loaded.")
            return
    
        # 数値順
        def _nums(s):
            import re
            m = re.findall(r"\d+", s)
            return tuple(map(int, m)) if m else (s,)
    
        keys = sorted(self.image_paths.keys(), key=_nums)
        if not keys:
            self.label_status.setText("⚠ No image keys found.")
            return
    
        # 最初の1枚でサイズ確認
        first_mask = self.ensure_label_mask_exists(keys[0])
        if first_mask.ndim != 2:
            self.label_status.setText("⚠ Invalid label mask format.")
            return
        height, width = first_mask.shape
    
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = os.path.join(os.getcwd(), f"stl_output_{timestamp}")
        os.makedirs(output_dir, exist_ok=True)
    
        # ✅ チェックされているオブジェクトだけ対象
        target_indices = [i for i, cb in enumerate(self.checkboxes) if cb.isChecked()]
        if not target_indices:
            self.label_status.setText("⚠ No objects checked for STL export.")
            return
    
        # stack order
        if self.combo_stack_order.currentIndex() == 0:
            # Frontside
            keys = list(reversed(keys))
            print("[INFO] Using descending stacking order (Frontside)")
        else:
            print("[INFO] Using ascending stacking order (Backside)")
    
        # オブジェクトごとの volume 準備
        masks_per_color = [
            np.zeros((len(keys), height, width), dtype=np.uint8)
            for _ in target_indices
        ]
    
        def update_progress_bar(label, task, current, total):
            percent = int(current / total * 100) if total > 0 else 100
            bar_length = 20
            filled_length = int(bar_length * percent // 100)
            bar = '█' * filled_length + '-' * (bar_length - filled_length)
            label.setText(f"{task}... |{bar}| {percent}%")
            QApplication.processEvents()
    
        # ========= label_masks から volume 構築 =========
        self.label_status.setText("Generating masks from label maps...")
        QApplication.processEvents()
    
        for z, key in enumerate(keys):
            try:
                label_mask = self.ensure_label_mask_exists(key)
    
                if label_mask.shape != (height, width):
                    print(f"[WARN] Skipping {key}: shape mismatch {label_mask.shape} != {(height, width)}")
                    continue
    
                for out_idx, color_idx in enumerate(target_indices):
                    obj_id = color_idx + 1
                    binary = (label_mask == obj_id).astype(np.uint8) * 255
    
                    # ✅ Frontside の場合は上下反転（旧挙動を維持）
                    if self.combo_stack_order.currentIndex() == 0:
                        binary = np.flipud(binary)
    
                    masks_per_color[out_idx][z] = binary
    
            except Exception as e:
                print(f"[WARN] Failed to build volume slice for {key}: {e}")
    
            update_progress_bar(self.label_status, "Generating masks", z + 1, len(keys))
    
        # ========= STL 出力 =========
        self.label_status.setText("Exporting STL files...")
        QApplication.processEvents()
    
        num_valid_volumes = sum(np.count_nonzero(vol) > 0 for vol in masks_per_color)
        exported_count = 0
    
        for i, volume in enumerate(masks_per_color):
            color_idx = target_indices[i]
    
            if np.count_nonzero(volume) == 0:
                print(f"[SKIP] Object {color_idx + 1} is completely empty. Skipped.")
                continue
    
            if self.mm_per_px is None or self.z_spacing_mm is None:
                print("[ERROR] Calibration not completed.")
                return
    
            binary_volume = (volume > 127)
    
            # 初回メッシュ化（旧挙動維持）
            mesh = matrix_to_marching_cubes(
                binary_volume,
                pitch=[self.z_spacing_mm, self.mm_per_px, self.mm_per_px]
            )
    
            # スムージング設定
            mode_text = self.combo_smooth_mode.currentText()
            level_str = self.combo_smooth_level.currentText().split("（")[0]
            smooth_level = int(level_str)
    
            from scipy.ndimage import zoom
    
            adjusted_z_spacing = self.z_spacing_mm
    
            # Z方向補間
            if smooth_level > 0 and mode_text in ["Z-interpolation only", "Both"]:
                z_factor = 1.0 + smooth_level * 0.4
    
                binary_volume = zoom(
                    binary_volume.astype(np.uint8),
                    zoom=[z_factor, 1.0, 1.0],
                    order=3
                ) > 0.5
                adjusted_z_spacing = self.z_spacing_mm / z_factor
    
                print(f"[INFO] Applied Z-direction interpolation with factor {z_factor:.2f}")
            else:
                print("[INFO] Volume smoothing skipped")
    
            # 補正済みピッチで再メッシュ化
            mesh = matrix_to_marching_cubes(
                binary_volume,
                pitch=[adjusted_z_spacing, self.mm_per_px, self.mm_per_px]
            )
    
            # メッシュスムージング
            if smooth_level > 0 and mode_text in ["Mesh smoothing only", "Both"]:
                iterations = 10 + smooth_level * 5
                filter_laplacian(mesh, lamb=0.5, iterations=iterations)
                print(f"[INFO] Applied mesh smoothing: {iterations} iterations")
            else:
                print("[INFO] Mesh smoothing skipped")
    
            stl_path = os.path.join(output_dir, f"object_{color_idx + 1:02}.stl")
            mesh.export(stl_path)
            print(f"[SAVED] {stl_path}")
    
            exported_count += 1
            update_progress_bar(self.label_status, "Exporting STLs", exported_count, num_valid_volumes)
    
        self.label_status.setText(f"[Done] Exported STL per color to: {output_dir}")
    
        # ========= プレビュー =========
        try:
            base_dir = os.getcwd()
            stl_dirs = [d for d in os.listdir(base_dir) if d.startswith("stl_output_")]
            if stl_dirs:
                latest_dir = max(stl_dirs, key=lambda d: os.path.getmtime(os.path.join(base_dir, d)))
                stl_dir_path = os.path.join(base_dir, latest_dir)
    
                stl_files = [
                    os.path.join(stl_dir_path, f)
                    for f in os.listdir(stl_dir_path)
                    if f.lower().endswith(".stl")
                ]
    
                if stl_files:
                    dlg = STLPreviewDialog(
                        parent=self,
                        stl_paths=stl_files,
                        color_labels=self.color_labels
                    )
                    dlg.exec()
                    self.label_status.setText(f"✅ Preview opened for {len(stl_files)} STL files")
                else:
                    self.label_status.setText("⚠ No STL files found in latest output folder.")
            else:
                self.label_status.setText("⚠ No stl_output_* folder found.")
        except Exception as e:
            self.label_status.setText(f"⚠ Failed to open preview: {e}")



        
    
            
    # def export_colorwise_volumes_to_csv(self):
    #     import os
    #     import numpy as np
    #     import csv
    #     from datetime import datetime
    
    #     if self.mm_per_px is None or self.z_spacing_mm is None:
    #         from PyQt6.QtWidgets import QFileDialog
    #         file_path, _ = QFileDialog.getOpenFileName(self, "Select CSV File", "", "CSV Files (*.csv)")
    #         if not file_path:
    #             print("[ERROR] CSV file not selected. Aborting volume export.")
    #             return
    #         try:
    #             with open(file_path, newline='', encoding='utf-8') as f:
    #                 reader = csv.reader(f)
    #                 rows = list(reader)
    #                 self.mm_per_px = float(rows[3][0])
    #                 self.z_spacing_mm = float(rows[3][2])
    #                 print(f"[INFO] Loaded spacing: mm/px = {self.mm_per_px}, z = {self.z_spacing_mm}")
    #         except Exception as e:
    #             print(f"[ERROR] Failed to read CSV file: {e}")
    #             return
    
    #     if not self.image_paths:
    #         print("[ERROR] No images loaded.")
    #         return
    
    #     def _nums(s):
    #         import re
    #         m = re.findall(r"\d+", s)
    #         return tuple(map(int, m)) if m else (s,)
    
    #     keys = sorted(self.image_paths.keys(), key=_nums)
    #     if not keys:
    #         print("[ERROR] No image keys found.")
    #         return
    
    #     num_colors = len(self.color_labels)
    
    #     # 最初の1枚でサイズ確認
    #     first_mask = self.ensure_label_mask_exists(keys[0])
    #     if first_mask.ndim != 2:
    #         print("[ERROR] Invalid label mask format.")
    #         return
    
    #     height, width = first_mask.shape
    
    #     masks_per_color = [
    #         np.zeros((len(keys), height, width), dtype=np.uint8)
    #         for _ in range(num_colors)
    #     ]
    
    #     self.label_status.setText("Generating masks for volume calculation...")
    #     QApplication.processEvents()
    
    #     for z, key in enumerate(keys):
    #         try:
    #             label_mask = self.ensure_label_mask_exists(key)
    
    #             if label_mask.shape != (height, width):
    #                 print(f"[WARN] Skipping {key}: shape mismatch {label_mask.shape} != {(height, width)}")
    #                 continue
    
    #             for i in range(num_colors):
    #                 obj_id = i + 1
    #                 masks_per_color[i][z] = (label_mask == obj_id).astype(np.uint8)
    
    #         except Exception as e:
    #             print(f"[WARN] Failed to collect mask for {key}: {e}")
    
    #     voxel_volume_mm3 = (self.mm_per_px ** 2) * self.z_spacing_mm
    
    #     results = []
    #     overlap_results = []
    
    #     # 通常体積 + 各スライスの面積
    #     per_slice_areas_all = []
    
    #     for i, volume in enumerate(masks_per_color):
    #         voxel_count = np.count_nonzero(volume)
    #         total_volume_mm3 = voxel_count * voxel_volume_mm3
    #         total_volume_cm3 = total_volume_mm3 / 1000
    #         print(f"[RESULT] Object {i+1:02}: {total_volume_cm3:.3f} cm³")
    #         results.append((f"Object {i+1}", total_volume_mm3, total_volume_cm3))
    
    #         slice_areas_mm2 = []
    #         for z in range(volume.shape[0]):
    #             slice_pixel_count = np.count_nonzero(volume[z])
    #             slice_area_mm2 = slice_pixel_count * (self.mm_per_px ** 2)
    #             slice_areas_mm2.append(slice_area_mm2)
    #         per_slice_areas_all.append(slice_areas_mm2)
    
    #     # オーバーラップ体積
    #     for i in range(num_colors):
    #         for j in range(i + 1, num_colors):
    #             overlap = np.logical_and(masks_per_color[i], masks_per_color[j])
    #             voxel_count = np.count_nonzero(overlap)
    #             total_volume_mm3 = voxel_count * voxel_volume_mm3
    #             total_volume_cm3 = total_volume_mm3 / 1000
    #             if voxel_count > 0:
    #                 print(f"[OVERLAP] Object {i+1} & Object {j+1}: {total_volume_cm3:.3f} cm³")
    #                 overlap_results.append((f"Object {i+1} & {j+1}", total_volume_mm3, total_volume_cm3))
    
    #     # 出力
    #     timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    #     output_csv = os.path.join(os.getcwd(), f"volume_output_{timestamp}.csv")
    
    #     with open(output_csv, 'w', newline='', encoding='utf-8') as f:
    #         writer = csv.writer(f)
    #         writer.writerow(["Label", "Volume (mm^3)", "Volume (cm^3)"])
    #         writer.writerows(results)
    
    #         writer.writerow([])
    #         writer.writerow(["Slice Areas (mm^2)"])
    #         header = ["Slice Index"] + [f"Obj {i+1}" for i in range(num_colors)]
    #         writer.writerow(header)
    
    #         num_slices = len(keys)
    #         for z in range(num_slices):
    #             row = [z + 1]
    #             for i in range(num_colors):
    #                 area = per_slice_areas_all[i][z] if i < len(per_slice_areas_all) else 0
    #                 row.append(f"{area:.2f}")
    #             writer.writerow(row)
    
    #         if overlap_results:
    #             writer.writerow([])
    #             writer.writerow(["Overlapping Volumes"])
    #             writer.writerow(["Overlap Pair", "Volume (mm^3)", "Volume (cm^3)"])
    #             writer.writerows(overlap_results)
    
    #         if self.measurement_results:
    #             writer.writerow([])
    #             writer.writerow(["Measurement Results"])
    #             writer.writerow(["Label", "Length (px)", "Length (mm)"])
    #             for i, (_, _, px, mm) in enumerate(self.measurement_results):
    #                 label = f"Measurement {i+1:02d}"
    #                 mm_str = f"{mm:.2f}" if mm is not None else "N/A"
    #                 writer.writerow([label, f"{px:.2f}", mm_str])
    
    #     self.label_status.setText(f"✅ Volume CSV exported")

    
    def export_colorwise_volumes_to_csv(self):
        import os
        import numpy as np
        import csv
        from datetime import datetime
    
        if self.mm_per_px is None or self.z_spacing_mm is None:
            from PyQt6.QtWidgets import QFileDialog
            file_path, _ = QFileDialog.getOpenFileName(
                self, "Select CSV File", "", "CSV Files (*.csv)"
            )
            if not file_path:
                print("[ERROR] CSV file not selected. Aborting volume export.")
                return
    
            try:
                with open(file_path, newline='', encoding='utf-8') as f:
                    reader = csv.reader(f)
                    rows = list(reader)
                    self.mm_per_px = float(rows[3][0])
                    self.z_spacing_mm = float(rows[3][2])
                    print(f"[INFO] Loaded spacing: mm/px = {self.mm_per_px}, z = {self.z_spacing_mm}")
            except Exception as e:
                print(f"[ERROR] Failed to read CSV file: {e}")
                return
    
        if not self.image_paths:
            print("[ERROR] No images loaded.")
            return
    
        def _nums(s):
            import re
            m = re.findall(r"\d+", s)
            return tuple(map(int, m)) if m else (s,)
    
        keys = sorted(self.image_paths.keys(), key=_nums)
        if not keys:
            print("[ERROR] No image keys found.")
            return
    
        num_colors = len(self.color_labels)
    
        first_mask = self.ensure_label_mask_exists(keys[0])
        if first_mask.ndim != 2:
            print("[ERROR] Invalid label mask format.")
            return
    
        height, width = first_mask.shape
    
        masks_per_color = [
            np.zeros((len(keys), height, width), dtype=np.uint8)
            for _ in range(num_colors)
        ]
    
        self.label_status.setText("Generating masks for measurement export...")
        QApplication.processEvents()
    
        for z, key in enumerate(keys):
            try:
                label_mask = self.ensure_label_mask_exists(key)
    
                if label_mask.shape != (height, width):
                    print(f"[WARN] Skipping {key}: shape mismatch {label_mask.shape} != {(height, width)}")
                    continue
    
                for i in range(num_colors):
                    obj_id = i + 1
                    masks_per_color[i][z] = (label_mask == obj_id).astype(np.uint8)
    
            except Exception as e:
                print(f"[WARN] Failed to collect mask for {key}: {e}")
    
        voxel_volume_mm3 = (self.mm_per_px ** 2) * self.z_spacing_mm
        pixel_area_mm2 = self.mm_per_px ** 2
    
        results = []
        per_slice_areas_all = []
    
        # =========================
        # 1. Object-wise volume
        # =========================
        for i, volume in enumerate(masks_per_color):
            voxel_count = int(np.count_nonzero(volume))
            total_volume_mm3 = voxel_count * voxel_volume_mm3
            total_volume_cm3 = total_volume_mm3 / 1000.0
    
            print(f"[RESULT] Object {i+1:02}: {total_volume_cm3:.3f} cm³")
            results.append((f"Object {i+1}", total_volume_mm3, total_volume_cm3))
    
            slice_areas_mm2 = []
            for z in range(volume.shape[0]):
                slice_pixel_count = int(np.count_nonzero(volume[z]))
                slice_area_mm2 = slice_pixel_count * pixel_area_mm2
                slice_areas_mm2.append(slice_area_mm2)
    
            per_slice_areas_all.append(slice_areas_mm2)
    
        # =========================
        # 2. Threshold fraction block
        #    Target Object + Extracted Object
        # =========================
        target_id = self.combo_target_object.currentIndex() + 1
        extracted_id = self.combo_transfer_target.currentIndex() + 1
    
        threshold_min = self.spin_threshold_min.value()
        threshold_max = self.spin_threshold_max.value()
    
        if threshold_min > threshold_max:
            threshold_min, threshold_max = threshold_max, threshold_min
    
        # NOTE:
        # Extract Inside Object は label_mask[result] = extracted_id にするため、
        # 抽出後は target_id の画素が extracted_id に移動している。
        # したがって denominator は target_id + extracted_id として扱う。
        target_volume_binary = np.logical_or(
            masks_per_color[target_id - 1] > 0,
            masks_per_color[extracted_id - 1] > 0
        )
        extracted_volume_binary = masks_per_color[extracted_id - 1] > 0
    
        target_voxel_count = int(np.count_nonzero(target_volume_binary))
        extracted_voxel_count = int(np.count_nonzero(extracted_volume_binary))
    
        target_volume_mm3 = target_voxel_count * voxel_volume_mm3
        extracted_volume_mm3 = extracted_voxel_count * voxel_volume_mm3
    
        target_volume_cm3 = target_volume_mm3 / 1000.0
        extracted_volume_cm3 = extracted_volume_mm3 / 1000.0
    
        fraction_percent = (
            extracted_voxel_count / target_voxel_count * 100.0
            if target_voxel_count > 0 else 0.0
        )
    
        per_slice_fraction_rows = []
    
        for z, key in enumerate(keys):
            target_slice = target_volume_binary[z]
            extracted_slice = extracted_volume_binary[z]
    
            target_px = int(np.count_nonzero(target_slice))
            extracted_px = int(np.count_nonzero(extracted_slice))
    
            target_area_mm2 = target_px * pixel_area_mm2
            extracted_area_mm2 = extracted_px * pixel_area_mm2
    
            slice_fraction = (
                extracted_px / target_px * 100.0
                if target_px > 0 else 0.0
            )
    
            per_slice_fraction_rows.append([
                z + 1,
                key,
                target_px,
                extracted_px,
                target_area_mm2,
                extracted_area_mm2,
                slice_fraction
            ])
    
        # =========================
        # 3. CSV output
        # =========================
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_csv = os.path.join(os.getcwd(), f"measurement_output_{timestamp}.csv")
    
        with open(output_csv, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
    
            # Object volumes
            writer.writerow(["Object Volumes"])
            writer.writerow(["Label", "Volume (mm^3)", "Volume (cm^3)"])
            writer.writerows(results)
    
            # Slice areas
            writer.writerow([])
            writer.writerow(["Slice Areas (mm^2)"])
            header = ["Slice Index"] + [f"Obj {i+1}" for i in range(num_colors)]
            writer.writerow(header)
    
            num_slices = len(keys)
            for z in range(num_slices):
                row = [z + 1]
                for i in range(num_colors):
                    area = per_slice_areas_all[i][z] if i < len(per_slice_areas_all) else 0
                    row.append(f"{area:.2f}")
                writer.writerow(row)
    
            # Threshold fraction
            writer.writerow([])
            writer.writerow(["Threshold Fraction Inside Object"])
            writer.writerow(["Target Object", f"Obj {target_id}"])
            writer.writerow(["Extracted Object", f"Obj {extracted_id}"])
            writer.writerow(["Threshold Min", threshold_min])
            writer.writerow(["Threshold Max", threshold_max])
    
            writer.writerow([])
            writer.writerow(["Summary"])
            writer.writerow([
                "Target Volume (mm^3)",
                "Target Volume (cm^3)",
                "Extracted Volume (mm^3)",
                "Extracted Volume (cm^3)",
                "Fraction (%)"
            ])
            writer.writerow([
                f"{target_volume_mm3:.4f}",
                f"{target_volume_cm3:.4f}",
                f"{extracted_volume_mm3:.4f}",
                f"{extracted_volume_cm3:.4f}",
                f"{fraction_percent:.4f}"
            ])
    
            writer.writerow([])
            writer.writerow(["Per-slice Threshold Fraction"])
            writer.writerow([
                "Slice Index",
                "Image Key",
                "Target Pixels",
                "Extracted Pixels",
                "Target Area (mm^2)",
                "Extracted Area (mm^2)",
                "Fraction (%)"
            ])
    
            for row in per_slice_fraction_rows:
                writer.writerow([
                    row[0],
                    row[1],
                    row[2],
                    row[3],
                    f"{row[4]:.4f}",
                    f"{row[5]:.4f}",
                    f"{row[6]:.4f}"
                ])
    
            # Measurement line results
            if self.measurement_results:
                writer.writerow([])
                writer.writerow(["Measurement Results"])
                writer.writerow(["Label", "Length (px)", "Length (mm)"])
                for i, (_, _, px, mm) in enumerate(self.measurement_results):
                    label = f"Measurement {i+1:02d}"
                    mm_str = f"{mm:.2f}" if mm is not None else "N/A"
                    writer.writerow([label, f"{px:.2f}", mm_str])
    
        self.label_status.setText("✅ Measurements CSV exported")
        print(f"[INFO] Measurement CSV exported: {output_csv}")






if __name__ == "__main__":
    if "--gpu-check" in sys.argv:
        try:
            from gpu_runtime import (
                compatibility_result,
                configure_safe_torch_attention,
                get_cuda_diagnostics,
                print_cuda_diagnostics,
            )

            configure_safe_torch_attention()
            cuda_diagnostics = get_cuda_diagnostics()
            print_cuda_diagnostics(cuda_diagnostics, sam2_mode="diagnostic-only")
            print(f"Result: {compatibility_result(cuda_diagnostics)}")
            sys.exit(
                0
                if cuda_diagnostics.get("cuda_test_ok") or not cuda_diagnostics.get("cuda_available")
                else 2
            )
        except Exception as exc:
            print("=== SegRef3D GPU Diagnostic ===")
            print(f"GPU diagnostic failed: {exc}")
            print("===============================")
            sys.exit(2)

    app = QApplication(sys.argv)
    window = SegRefMain()
    app.installEventFilter(window)  # ← ここでアプリケーション全体にフィルターを適用
    window.show()
    sys.exit(app.exec())

