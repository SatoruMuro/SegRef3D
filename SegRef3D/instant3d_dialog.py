"""Compact Instant3DWeb2 workflow dialog for SegRef3D desktop."""

from __future__ import annotations

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QVBoxLayout,
)


class Instant3DWorkflowDialog(QDialog):
    exportRequested = pyqtSignal(list, bool)
    importRequested = pyqtSignal()
    openColabRequested = pyqtSignal()

    def __init__(self, catalog: dict, mappings: list[dict], source_ready: bool, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Instant3DWeb2 / TotalSegmentator")
        self.resize(620, 620)
        self.catalog = [item for item in catalog["structures"] if not item.get("license_required", False)]
        self.mappings = [dict(item) for item in mappings]

        layout = QVBoxLayout(self)
        title = QLabel("Automatic segmentation with TotalSegmentator")
        title.setStyleSheet("font-size: 16px; font-weight: 600;")
        layout.addWidget(title)
        source = QLabel(
            "Source: compatible CT NIfTI volume" if source_ready else
            "Load a compatible CT NIfTI (.nii or .nii.gz) volume before exporting."
        )
        source.setWordWrap(True)
        layout.addWidget(source)

        self.search = QLineEdit()
        self.search.setPlaceholderText("Search anatomical structures...")
        self.search.textChanged.connect(self._render_catalog)
        layout.addWidget(self.search)

        self.available = QListWidget()
        self.available.setAlternatingRowColors(True)
        self.available.itemDoubleClicked.connect(lambda _item: self._add_selected())
        layout.addWidget(self.available, 2)

        add_row = QHBoxLayout()
        add_row.addWidget(QLabel("Assign to"))
        self.object_id = QComboBox()
        self.object_id.addItems([f"Obj {value}" for value in range(1, 21)])
        add_row.addWidget(self.object_id)
        self.add_button = QPushButton("Add Structure")
        self.add_button.clicked.connect(self._add_selected)
        add_row.addWidget(self.add_button)
        layout.addLayout(add_row)

        layout.addWidget(QLabel("Selected structures"))
        self.selected = QListWidget()
        self.selected.setAlternatingRowColors(True)
        layout.addWidget(self.selected, 1)
        remove = QPushButton("Remove Selected")
        remove.clicked.connect(self._remove_selected)
        layout.addWidget(remove)

        self.fast = QCheckBox("Fast mode (lower-resolution TotalSegmentator model)")
        layout.addWidget(self.fast)

        actions = QHBoxLayout()
        self.export_button = QPushButton("Export Request ZIP")
        self.export_button.setEnabled(source_ready)
        self.export_button.clicked.connect(self._emit_export)
        self.import_button = QPushButton("Import Result ZIP")
        self.import_button.setEnabled(source_ready)
        self.import_button.clicked.connect(self.importRequested.emit)
        self.open_button = QPushButton("Open Instant3DWeb2")
        self.open_button.clicked.connect(self.openColabRequested.emit)
        actions.addWidget(self.export_button)
        actions.addWidget(self.import_button)
        actions.addWidget(self.open_button)
        layout.addLayout(actions)

        privacy = QLabel(
            "The request ZIP contains the source NIfTI volume. Upload it explicitly to your own "
            "Google Colab runtime. It is not uploaded to a SegRef3D-operated server."
        )
        privacy.setWordWrap(True)
        privacy.setStyleSheet("color: #566; font-size: 11px;")
        layout.addWidget(privacy)
        close = QPushButton("Close")
        close.clicked.connect(self.accept)
        layout.addWidget(close, alignment=Qt.AlignmentFlag.AlignRight)

        self._render_catalog()
        self._render_mappings()

    def _render_catalog(self):
        query = self.search.text().strip().lower()
        self.available.clear()
        for structure in self.catalog:
            haystack = " ".join([
                structure["display_name"], structure["roi"], structure.get("category", ""),
                *structure.get("synonyms", []),
            ]).lower()
            if query and query not in haystack:
                continue
            item = QListWidgetItem(f'{structure["display_name"]}  ·  {structure.get("category", "Other")}')
            item.setData(Qt.ItemDataRole.UserRole, structure)
            item.setToolTip(structure["roi"])
            self.available.addItem(item)

    def _next_free_object_id(self):
        used = {int(item["object_id"]) for item in self.mappings}
        return next((value for value in range(1, 21) if value not in used), 1)

    def _add_selected(self):
        item = self.available.currentItem()
        if item is None:
            return
        structure = dict(item.data(Qt.ItemDataRole.UserRole))
        object_id = self.object_id.currentIndex() + 1
        self.mappings = [entry for entry in self.mappings if int(entry["object_id"]) != object_id]
        self.mappings = [
            entry for entry in self.mappings
            if (entry["task"], entry["roi"]) != (structure["task"], structure["roi"])
        ]
        self.mappings.append({
            "object_id": object_id,
            "display_name": structure["display_name"],
            "task": structure["task"],
            "roi": structure["roi"],
        })
        self.mappings.sort(key=lambda entry: int(entry["object_id"]))
        self._render_mappings()
        self.object_id.setCurrentIndex(self._next_free_object_id() - 1)

    def _remove_selected(self):
        row = self.selected.currentRow()
        if row < 0:
            return
        object_id = int(self.selected.item(row).data(Qt.ItemDataRole.UserRole))
        self.mappings = [entry for entry in self.mappings if int(entry["object_id"]) != object_id]
        self._render_mappings()

    def _render_mappings(self):
        self.selected.clear()
        for mapping in self.mappings:
            item = QListWidgetItem(f'Obj {mapping["object_id"]}  —  {mapping["display_name"]}')
            item.setData(Qt.ItemDataRole.UserRole, int(mapping["object_id"]))
            item.setToolTip(f'{mapping["task"]} / {mapping["roi"]}')
            self.selected.addItem(item)

    def _emit_export(self):
        self.exportRequested.emit([dict(item) for item in self.mappings], self.fast.isChecked())
