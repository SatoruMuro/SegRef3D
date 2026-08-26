"""PyQt controls for local mask cleanup and frame interpolation."""

from __future__ import annotations

from PyQt6.QtCore import pyqtSignal
from PyQt6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSpinBox,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from mask_postprocessing import CLEANUP_OPERATIONS


class MaskPostProcessingDialog(QDialog):
    cleanup_requested = pyqtSignal(dict)
    interpolation_requested = pyqtSignal(dict)

    OPERATION_TOOLTIPS = {
        "fill-holes": "Fill enclosed holes inside the selected mask.",
        "remove-islands": "Remove connected components smaller than the specified pixel count.",
        "largest": "Keep only the largest connected region.",
        "smooth": "Smooth small irregularities in the mask boundary.",
        "dilate": "Expand the selected mask.",
        "erode": "Shrink the selected mask.",
    }

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Mask Post-processing")
        self.setMinimumWidth(560)
        self.setModal(False)

        root = QVBoxLayout(self)
        self.tabs = QTabWidget()
        root.addWidget(self.tabs)
        self._build_cleanup_tab()
        self._build_interpolation_tab()

        close_buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        close_buttons.rejected.connect(self.close)
        root.addWidget(close_buttons)

    @staticmethod
    def _object_combo() -> QComboBox:
        combo = QComboBox()
        for label in range(1, 21):
            combo.addItem(f"Obj {label}", label)
        return combo

    @staticmethod
    def _frame_spin() -> QSpinBox:
        spin = QSpinBox()
        spin.setRange(1, 1)
        return spin

    def _build_cleanup_tab(self):
        tab = QWidget()
        root = QVBoxLayout(tab)
        group = QGroupBox("Mask Cleanup")
        form = QFormLayout(group)

        self.cleanup_object = self._object_combo()
        self.cleanup_operation = QComboBox()
        for value, label in CLEANUP_OPERATIONS.items():
            self.cleanup_operation.addItem(label, value)
        self.cleanup_scope = QComboBox()
        self.cleanup_scope.addItem("Current Frame", "current")
        self.cleanup_scope.addItem("Frame Range", "range")
        self.cleanup_scope.addItem("All Frames", "all")
        self.cleanup_start = self._frame_spin()
        self.cleanup_end = self._frame_spin()
        self.minimum_size = QSpinBox()
        self.minimum_size.setRange(1, 100000000)
        self.minimum_size.setValue(20)
        self.minimum_size.setSuffix(" pixels")
        self.radius = QSpinBox()
        self.radius.setRange(1, 20)
        self.radius.setValue(1)
        self.radius.setSuffix(" pixels")
        self.iterations = QSpinBox()
        self.iterations.setRange(1, 20)
        self.iterations.setValue(1)

        form.addRow("Object", self.cleanup_object)
        form.addRow("Operation", self.cleanup_operation)
        form.addRow("Frames", self.cleanup_scope)
        range_row = QHBoxLayout()
        range_row.addWidget(QLabel("Start frame"))
        range_row.addWidget(self.cleanup_start)
        range_row.addWidget(QLabel("End frame"))
        range_row.addWidget(self.cleanup_end)
        form.addRow("Frame Range", range_row)
        form.addRow("Minimum island size", self.minimum_size)
        form.addRow("Radius", self.radius)
        form.addRow("Smoothing iterations", self.iterations)

        apply_button = QPushButton("Apply Cleanup")
        apply_button.setToolTip("Apply cleanup to the selected object and frame scope.")
        apply_button.clicked.connect(self._emit_cleanup)
        root.addWidget(group)
        root.addWidget(apply_button)
        root.addStretch(1)
        self.tabs.addTab(tab, "Mask Cleanup")

        self.cleanup_scope.currentIndexChanged.connect(self._sync_cleanup_controls)
        self.cleanup_operation.currentIndexChanged.connect(self._sync_cleanup_controls)
        self._sync_cleanup_controls()

    def _build_interpolation_tab(self):
        tab = QWidget()
        root = QVBoxLayout(tab)
        group = QGroupBox("Interpolate Between Frames")
        form = QFormLayout(group)
        self.interpolation_object = self._object_combo()
        self.interpolation_start = self._frame_spin()
        self.interpolation_end = self._frame_spin()
        form.addRow("Object", self.interpolation_object)
        form.addRow("Start frame", self.interpolation_start)
        form.addRow("End frame", self.interpolation_end)
        apply_button = QPushButton("Interpolate Masks")
        apply_button.setToolTip("Generate intermediate masks between two segmented frames.")
        apply_button.clicked.connect(self._emit_interpolation)
        root.addWidget(group)
        root.addWidget(apply_button)
        root.addStretch(1)
        self.tabs.addTab(tab, "Interpolate Between Frames")

    def refresh(self, frame_count: int, current_frame: int, object_id: int):
        frame_count = max(1, int(frame_count))
        current_frame = max(1, min(frame_count, int(current_frame)))
        object_index = max(0, min(19, int(object_id) - 1))
        for spin in (
            self.cleanup_start,
            self.cleanup_end,
            self.interpolation_start,
            self.interpolation_end,
        ):
            spin.setRange(1, frame_count)
        self.cleanup_start.setValue(current_frame)
        self.cleanup_end.setValue(frame_count)
        self.interpolation_start.setValue(current_frame)
        self.interpolation_end.setValue(min(frame_count, current_frame + 1))
        self.cleanup_object.setCurrentIndex(object_index)
        self.interpolation_object.setCurrentIndex(object_index)

    def select_remove_small_islands(self, object_id: int, minimum_size: int):
        self.tabs.setCurrentIndex(0)
        self.cleanup_object.setCurrentIndex(max(0, min(19, object_id - 1)))
        index = self.cleanup_operation.findData("remove-islands")
        self.cleanup_operation.setCurrentIndex(index)
        self.cleanup_scope.setCurrentIndex(self.cleanup_scope.findData("all"))
        self.minimum_size.setValue(max(1, int(minimum_size)))

    def _sync_cleanup_controls(self):
        is_range = self.cleanup_scope.currentData() == "range"
        self.cleanup_start.setEnabled(is_range)
        self.cleanup_end.setEnabled(is_range)
        operation = self.cleanup_operation.currentData()
        self.minimum_size.setEnabled(operation == "remove-islands")
        self.radius.setEnabled(operation in {"dilate", "erode"})
        self.iterations.setEnabled(operation in {"smooth", "dilate", "erode"})
        self.cleanup_operation.setToolTip(self.OPERATION_TOOLTIPS.get(operation, ""))

    def _emit_cleanup(self):
        self.cleanup_requested.emit({
            "object_id": int(self.cleanup_object.currentData()),
            "operation": self.cleanup_operation.currentData(),
            "operation_name": self.cleanup_operation.currentText(),
            "scope": self.cleanup_scope.currentData(),
            "start_frame": self.cleanup_start.value(),
            "end_frame": self.cleanup_end.value(),
            "minimum_size": self.minimum_size.value(),
            "radius": self.radius.value(),
            "iterations": self.iterations.value(),
        })

    def _emit_interpolation(self):
        self.interpolation_requested.emit({
            "object_id": int(self.interpolation_object.currentData()),
            "start_frame": self.interpolation_start.value(),
            "end_frame": self.interpolation_end.value(),
        })

