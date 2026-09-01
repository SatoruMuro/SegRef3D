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

    def test_rib_search_lists_groups_and_individuals_and_adds_group_once(self):
        dialog = Instant3DWorkflowDialog(self.catalog, [], True)
        self.addCleanup(dialog.deleteLater)
        for query in ("rib", "ribs"):
            dialog.search.setText(query)
            self.assertEqual(dialog.available.count(), 27)
            labels = [dialog.available.item(index).text() for index in range(dialog.available.count())]
            self.assertIn("Ribs, all  ·  Bone", labels)
            self.assertIn("Ribs, left  ·  Bone", labels)
            self.assertIn("Ribs, right  ·  Bone", labels)
            self.assertIn("Rib 1, left  ·  Bone", labels)
            self.assertIn("Rib 12, right  ·  Bone", labels)

        dialog.available.setCurrentRow(labels.index("Ribs, all  ·  Bone"))
        dialog._add_selected()
        self.assertEqual(dialog.selected.count(), 1)
        self.assertEqual(dialog.mappings, [{
            "object_id": 1,
            "display_name": "Ribs, all",
            "group": "ribs_all",
        }])
        self.assertEqual(dialog.selected.item(0).text(), "Ribs, all  →  Obj 1")

        dialog.available.setCurrentRow(labels.index("Rib 1, left  ·  Bone"))
        dialog.object_id.setCurrentIndex(0)
        dialog._add_selected()
        self.assertEqual(len(dialog.mappings), 1)
        self.assertEqual(dialog.mappings[0]["group"], "ribs_all")

    def test_individual_rib_selection_remains_available(self):
        dialog = Instant3DWorkflowDialog(self.catalog, [], True)
        self.addCleanup(dialog.deleteLater)
        dialog.search.setText("Rib 12, right")
        self.assertEqual(dialog.available.count(), 1)
        dialog.available.setCurrentRow(0)
        dialog.object_id.setCurrentIndex(1)
        dialog._add_selected()
        self.assertEqual(dialog.mappings, [{
            "object_id": 2,
            "display_name": "Rib 12, right",
            "task": "total",
            "roi": "rib_right_12",
        }])

    def test_left_and_right_groups_each_add_as_one_row(self):
        for display_name, group_id in (("Ribs, left", "ribs_left"), ("Ribs, right", "ribs_right")):
            with self.subTest(group=group_id):
                dialog = Instant3DWorkflowDialog(self.catalog, [], True)
                self.addCleanup(dialog.deleteLater)
                dialog.search.setText(display_name)
                self.assertEqual(dialog.available.count(), 1)
                dialog.available.setCurrentRow(0)
                dialog._add_selected()
                self.assertEqual(dialog.mappings, [{
                    "object_id": 1,
                    "display_name": display_name,
                    "group": group_id,
                }])
                self.assertEqual(dialog.selected.count(), 1)


if __name__ == "__main__":
    unittest.main()
