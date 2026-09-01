import json
import os
from pathlib import Path
import sys
import unittest


os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
MODULE_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = MODULE_DIR.parent
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from PyQt6.QtWidgets import QApplication  # noqa: E402
from instant3d_dialog import Instant3DWorkflowDialog  # noqa: E402


class Instant3DDialogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])
        cls.catalog = json.loads(
            (REPO_DIR / "resources" / "totalsegmentator_roi_catalog.json").read_text(encoding="utf-8")
        )

    def test_rib_search_lists_24_structures_and_adds_selected_mapping(self):
        dialog = Instant3DWorkflowDialog(self.catalog, [], True)
        self.addCleanup(dialog.deleteLater)
        dialog.search.setText("rib")
        self.assertEqual(dialog.available.count(), 24)
        labels = [dialog.available.item(index).text() for index in range(dialog.available.count())]
        self.assertIn("Rib 1, left  ·  Bone", labels)
        self.assertIn("Rib 12, right  ·  Bone", labels)
        dialog.available.setCurrentRow(labels.index("Rib 12, right  ·  Bone"))
        dialog.object_id.setCurrentIndex(1)
        dialog._add_selected()
        self.assertEqual(dialog.selected.count(), 1)
        self.assertEqual(dialog.mappings, [{
            "object_id": 2,
            "display_name": "Rib 12, right",
            "task": "total",
            "roi": "rib_right_12",
        }])


if __name__ == "__main__":
    unittest.main()
