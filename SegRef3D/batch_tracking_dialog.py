"""Batch tracking job editor used by the SegRef3D Local GPU workflow."""

from __future__ import annotations

import copy

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QAbstractItemView,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QHBoxLayout,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
)


class BatchObjectEditDialog(QDialog):
    def __init__(self, object_data: dict, image_count: int, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Edit Batch Object")
        self.setModal(True)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.name_edit = QLineEdit(str(object_data.get("name") or f"Object {object_data['id']}"))
        self.prompt_spin = QSpinBox()
        self.start_spin = QSpinBox()
        self.end_spin = QSpinBox()
        for spin in (self.prompt_spin, self.start_spin, self.end_spin):
            spin.setRange(1, max(1, image_count))

        self.prompt_spin.setValue(int(object_data["box_frame"]) + 1)
        self.start_spin.setValue(int(object_data["start"]) + 1)
        self.end_spin.setValue(int(object_data["end"]) + 1)

        form.addRow("Object ID", QLineEdit(str(object_data["id"])))
        form.itemAt(form.rowCount() - 1, QFormLayout.ItemRole.FieldRole).widget().setReadOnly(True)
        form.addRow("Name", self.name_edit)
        form.addRow("Prompt Frame", self.prompt_spin)
        form.addRow("Tracking Start", self.start_spin)
        form.addRow("Tracking End", self.end_spin)
        layout.addLayout(form)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self._validate_and_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _validate_and_accept(self):
        name = self.name_edit.text().strip()
        start = self.start_spin.value()
        prompt = self.prompt_spin.value()
        end = self.end_spin.value()
        if not name:
            QMessageBox.warning(self, "Invalid Object", "Object name cannot be empty.")
            return
        if not start <= prompt <= end:
            QMessageBox.warning(
                self,
                "Invalid Tracking Range",
                "Prompt Frame must be inside the Tracking Start/End range.",
            )
            return
        self.accept()

    def apply_to(self, object_data: dict) -> None:
        object_data["name"] = self.name_edit.text().strip()
        object_data["box_frame"] = self.prompt_spin.value() - 1
        object_data["start"] = self.start_spin.value() - 1
        object_data["end"] = self.end_spin.value() - 1


class BatchTrackingDialog(QDialog):
    def __init__(
        self,
        objects: list[dict],
        image_count: int,
        current_prompt_provider,
        parent=None,
        local_batch_available: bool = False,
    ):
        super().__init__(parent)
        self.setWindowTitle("Batch Tracking Jobs")
        self.resize(900, 360)
        self._objects = copy.deepcopy(objects)
        self._image_count = image_count
        self._current_prompt_provider = current_prompt_provider
        self._local_batch_available = bool(local_batch_available)
        self.run_local_requested = False

        layout = QVBoxLayout(self)
        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(
            ["Object", "Name", "Prompt Frame", "Tracking Range", "Box (x1, y1, x2, y2)"]
        )
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.doubleClicked.connect(self._edit_selected)
        layout.addWidget(self.table)

        actions = QHBoxLayout()
        self.add_button = QPushButton("Add Current Prompt")
        self.edit_button = QPushButton("Edit")
        self.replace_button = QPushButton("Replace with Current Prompt")
        self.delete_button = QPushButton("Delete")
        self.add_button.clicked.connect(self._add_current_prompt)
        self.edit_button.clicked.connect(self._edit_selected)
        self.replace_button.clicked.connect(self._replace_selected)
        self.delete_button.clicked.connect(self._delete_selected)
        actions.addWidget(self.add_button)
        actions.addWidget(self.edit_button)
        actions.addWidget(self.replace_button)
        actions.addWidget(self.delete_button)
        actions.addStretch(1)
        layout.addLayout(actions)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel
        )
        self.run_local_button = QPushButton("Save and Run Local Batch Tracking")
        self.run_local_button.setEnabled(self._local_batch_available)
        self.run_local_button.setToolTip(
            "Run all listed jobs with local SAM2."
            if self._local_batch_available
            else "Local SAM2 is unavailable in this build."
        )
        buttons.addButton(self.run_local_button, QDialogButtonBox.ButtonRole.ActionRole)
        self.run_local_button.clicked.connect(self._accept_and_run_local)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)
        self._refresh()

    @property
    def objects(self) -> list[dict]:
        return copy.deepcopy(self._objects)

    def _selected_index(self) -> int | None:
        rows = self.table.selectionModel().selectedRows()
        return rows[0].row() if rows else None

    def _refresh(self, selected: int | None = None):
        self._objects.sort(key=lambda item: int(item["id"]))
        self.table.setRowCount(len(self._objects))
        for row, obj in enumerate(self._objects):
            box = obj["box"]
            x1, y1 = box[0]
            x2, y2 = box[1]
            values = [
                str(obj["id"]),
                str(obj.get("name") or f"Object {obj['id']}"),
                str(int(obj["box_frame"]) + 1),
                f"{int(obj['start']) + 1}-{int(obj['end']) + 1}",
                f"{x1:.1f}, {y1:.1f}, {x2:.1f}, {y2:.1f}",
            ]
            for column, value in enumerate(values):
                item = QTableWidgetItem(value)
                if column in (0, 2, 3):
                    item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                self.table.setItem(row, column, item)
        self.table.resizeColumnsToContents()
        if self._objects:
            row = min(selected if selected is not None else 0, len(self._objects) - 1)
            self.table.selectRow(row)
        self._update_action_states()

    def _update_action_states(self):
        has_selection = self._selected_index() is not None
        self.edit_button.setEnabled(has_selection)
        self.replace_button.setEnabled(has_selection)
        self.delete_button.setEnabled(has_selection)
        self.run_local_button.setEnabled(self._local_batch_available and bool(self._objects))

    def _add_current_prompt(self):
        try:
            new_object = self._current_prompt_provider()
        except ValueError as exc:
            QMessageBox.warning(self, "Current Prompt Is Incomplete", str(exc))
            return

        object_id = int(new_object["id"])
        if any(int(item["id"]) == object_id for item in self._objects):
            QMessageBox.warning(
                self,
                "Object Already Exists",
                f"Object {object_id} is already listed. Select it and use "
                "Replace with Current Prompt.",
            )
            return
        if len(self._objects) >= 20:
            QMessageBox.warning(self, "Object Limit", "A maximum of 20 objects is supported.")
            return

        self._objects.append(new_object)
        self._objects.sort(key=lambda item: int(item["id"]))
        selected = next(
            index for index, item in enumerate(self._objects) if int(item["id"]) == object_id
        )
        self._refresh(selected)

    def _accept_and_run_local(self):
        if not self._objects:
            QMessageBox.warning(
                self,
                "No Batch Jobs",
                "Add at least one object before running local Batch Tracking.",
            )
            return
        self.run_local_requested = True
        self.accept()

    def _edit_selected(self, *_):
        index = self._selected_index()
        if index is None:
            return
        dialog = BatchObjectEditDialog(self._objects[index], self._image_count, self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            dialog.apply_to(self._objects[index])
            self._refresh(index)

    def _replace_selected(self):
        index = self._selected_index()
        if index is None:
            return
        try:
            replacement = self._current_prompt_provider(object_id=self._objects[index]["id"])
        except ValueError as exc:
            QMessageBox.warning(self, "Current Prompt Is Incomplete", str(exc))
            return
        replacement["name"] = self._objects[index].get("name") or replacement["name"]
        self._objects[index] = replacement
        self._refresh(index)

    def _delete_selected(self):
        index = self._selected_index()
        if index is None:
            return
        del self._objects[index]
        self._refresh(max(0, index - 1))
