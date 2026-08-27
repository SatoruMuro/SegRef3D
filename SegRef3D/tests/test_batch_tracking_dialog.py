import os
from pathlib import Path
import sys
import unittest


os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from PyQt6.QtWidgets import QApplication  # noqa: E402
from batch_tracking_dialog import BatchTrackingDialog  # noqa: E402


class BatchTrackingDialogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    @staticmethod
    def _prompt():
        return {
            "id": 2,
            "name": "Object 2",
            "box": ((2.0, 3.0), (20.0, 18.0)),
            "point": None,
            "start": 0,
            "end": 2,
            "box_frame": 1,
        }

    def test_add_current_prompt_and_request_local_run(self):
        dialog = BatchTrackingDialog(
            [],
            3,
            self._prompt,
            local_batch_available=True,
        )
        self.assertFalse(dialog.run_local_button.isEnabled())

        dialog._add_current_prompt()
        self.assertEqual([item["id"] for item in dialog.objects], [2])
        self.assertTrue(dialog.run_local_button.isEnabled())

        dialog._accept_and_run_local()
        self.assertTrue(dialog.run_local_requested)
        self.assertEqual(dialog.result(), dialog.DialogCode.Accepted)


if __name__ == "__main__":
    unittest.main()
