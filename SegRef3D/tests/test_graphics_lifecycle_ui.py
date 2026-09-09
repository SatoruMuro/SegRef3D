"""Real Qt items/events and actual mask autosave, without SAM2 inference."""
import os
from pathlib import Path
import sys
import tempfile
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("SEGREF3D_DISABLE_SAM2", "1")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
from PIL import Image
from PyQt6 import sip
from PyQt6.QtCore import QEvent, QPointF, Qt
from PyQt6.QtGui import QMouseEvent
from PyQt6.QtWidgets import QApplication, QGraphicsPathItem
import SegRef3D as module


class GraphicsLifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cwd = os.getcwd()
        os.chdir(self.temp.name)
        self.window = module.SegRefMain()
        self.view = self.window.graphicsView
        self.window.image_paths = {}
        self.window.image_sizes = {}
        self.window.label_masks = {}
        for n in range(3):
            key = f"{n + 1:04d}"
            path = Path(self.temp.name) / f"image{key}.png"
            Image.new("L", (64, 64), 128).save(path)
            self.window.image_paths[key] = str(path)
            self.window.image_sizes[key] = (64, 64)
            self.window.label_masks[key] = np.zeros((64, 64), dtype=np.uint8)
            self.window.drawn_paths_per_image[key] = []
        self.window.current_index = 0
        self.window.display_current_image()

    def tearDown(self):
        sip.delete(self.window)
        os.chdir(self.cwd)
        self.temp.cleanup()

    def event(self, kind, point=(10, 10), button=Qt.MouseButton.NoButton):
        pos = QPointF(self.view.mapFromScene(QPointF(*point)))
        return QMouseEvent(kind, pos, pos, button, button, Qt.KeyboardModifier.NoModifier)

    def press(self, point=(10, 10)):
        self.view.mousePressEvent(self.event(QEvent.Type.MouseButtonPress, point, Qt.MouseButton.LeftButton))

    def move(self, point=(25, 25)):
        self.view.mouseMoveEvent(self.event(QEvent.Type.MouseMove, point))

    def release(self, button=Qt.MouseButton.RightButton):
        self.view.mouseReleaseEvent(self.event(QEvent.Type.MouseButtonRelease, button=button))

    def draw(self, mode="Click"):
        self.window.change_draw_mode(mode)
        self.press((8, 8))
        if mode == "Free":
            for point in ((32, 8), (32, 32), (8, 32)):
                self.move(point)
            self.release(Qt.MouseButton.LeftButton)
        else:
            for point in ((32, 8), (32, 32), (8, 32)):
                self.press(point)
            self.move((8, 9))  # Live preview at synchronous auto-apply callback.
            self.release()
        self.assert_clean()

    def assert_clean(self):
        self.assertIsNone(self.view.current_path_item)
        self.assertIsNone(self.view.temp_preview_item)
        self.assertIsNone(self.view.current_path)
        self.assertFalse(self.view.drawing)
        self.assertEqual(self.view.click_points, [])

    def test_save_callback_has_no_live_input_and_may_clear_scene_reentrantly(self):
        received = []
        def save(path):
            self.assert_clean()
            self.window.scene.clear()
            self.view.finalize_click_drawing()
            received.append(path)
        self.view.save_callback = save
        self.draw()
        self.draw("Free")
        self.assertEqual(len(received), 2)
        self.assertTrue(all(not path.isEmpty() for path in received))

    def test_auto_erase_masks_autosave_undo_redo_and_many_transitions(self):
        for n in range(48):
            self.window.switch_image(1 if self.window.current_index < 2 else -2)
            key = self.window.get_current_image_key()
            # Include images with no Object ID as well as labeled images.
            before = np.full((64, 64), n % 2, dtype=np.uint8)
            self.window.label_masks[key] = before.copy()
            self.window.combo_auto_apply_mode.setCurrentText("Erase")
            self.draw(("Click", "Click (Snap)", "Free")[n % 3])
            erased = self.window.label_masks[key].copy()
            self.assertLessEqual(np.count_nonzero(erased), np.count_nonzero(before))
            if n % 2:
                self.assertLess(np.count_nonzero(erased), np.count_nonzero(before))
            self.assertTrue(Path(self.window.label_mask_paths[key]).is_file())
            np.testing.assert_array_equal(np.asarray(Image.open(self.window.label_mask_paths[key])), erased)
            self.window.undo_edit()
            np.testing.assert_array_equal(self.window.label_masks[key], before)
            self.window.redo_edit()
            np.testing.assert_array_equal(self.window.label_masks[key], erased)
            self.assert_clean()
            self.window.start_box_prompt_mode()
            self.window.eventFilter(self.view.viewport(), self.event(QEvent.Type.MouseMove))
            old_crosshair = self.window.temp_crosshair_hline
            self.window.display_current_image()
            self.assertTrue(sip.isdeleted(old_crosshair))
            self.assertIsNone(self.window.temp_crosshair_hline)
            self.window.eventFilter(self.view.viewport(), self.event(QEvent.Type.MouseMove))
            self.window.combo_auto_apply_mode.setCurrentText("Off")
            self.draw()

    def test_switch_modes_mid_gesture_and_late_release(self):
        for drawing in ("Free", "Click", "Click (Snap)"):
            for switch in (lambda: self.window.change_draw_mode("Free"),
                           lambda: self.window.combo_auto_apply_mode.setCurrentText("Erase"),
                           self.window.start_box_prompt_mode,
                           self.window.scene.clear):
                self.window.combo_auto_apply_mode.setCurrentText("Off")
                self.window.change_draw_mode(drawing)
                self.press()
                self.move()
                old = self.view.current_path_item
                switch()
                self.assert_clean()
                self.assertTrue(sip.isdeleted(old))
                self.release(Qt.MouseButton.LeftButton)
                self.release()
                self.assert_clean()

    def test_direct_scene_clear_cleans_all_overlay_references(self):
        names = ("temp_box_item", "confirmed_box_item", "temp_crosshair_hline",
                 "temp_crosshair_vline", "temp_line_item", "temp_measurement_line_item")
        for name in names:
            item = QGraphicsPathItem()
            setattr(self.window, name, item)
            self.window.scene.addItem(item)
        self.window.scene.clear()
        self.assertTrue(all(getattr(self.window, name) is None for name in names))
        self.assertEqual(self.window.scene.items(), [])

    def test_box_completion_survives_draw_mode_switch_and_redraw(self):
        self.window.start_box_prompt_mode()
        for point in ((5, 5), (40, 40)):
            event = self.event(QEvent.Type.MouseButtonPress, point, Qt.MouseButton.LeftButton)
            self.assertTrue(self.window.eventFilter(self.view.viewport(), event))
        coords = self.window.last_box_prompt
        self.assertFalse(self.window.box_mode)
        box = self.window.confirmed_box_item
        pixmap = self.window.pixmap_item
        self.window.change_draw_mode('Click')
        self.assertIs(self.window.confirmed_box_item, box)
        self.assertIs(self.window.pixmap_item, pixmap)
        self.window.display_current_image()
        self.assertTrue(sip.isdeleted(box))
        self.assertFalse(sip.isdeleted(self.window.confirmed_box_item))
        self.assertEqual(self.window.last_box_prompt, coords)
        self.window.clear_box()
        self.assertIsNone(self.window.confirmed_box_item)
        self.assertEqual(self.window.box_per_frame, {})

    def test_same_slice_repeated_draw_manual_erase_and_auto_add(self):
        key = self.window.get_current_image_key()
        self.window.combo_auto_apply_mode.setCurrentText('Off')
        # OddEvenFill deliberately cancels an even number of identical paths.
        for _ in range(33):
            self.draw()
        self.assertEqual(len(self.window.drawn_paths_per_image[key]), 33)
        self.window.label_masks[key].fill(1)
        self.assertTrue(self.window._apply_pending_paths_to_masks('erase'))
        self.assertLess(np.count_nonzero(self.window.label_masks[key]), 64 * 64)
        self.window.combo_auto_apply_mode.setCurrentText('Add')
        self.draw()
        self.assertEqual(np.count_nonzero(self.window.label_masks[key]), 64 * 64)
        self.assert_clean()


if __name__ == "__main__":
    unittest.main()
