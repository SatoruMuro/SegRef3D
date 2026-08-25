import json
from pathlib import Path
import unittest


NOTEBOOK = Path(__file__).resolve().parents[1] / "SegOnWebJob_v1_0.ipynb"


class SegOnWebNotebookTests(unittest.TestCase):
    def test_notebook_is_gradio_free_and_python_cells_parse(self):
        notebook = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
        sources = []
        for index, cell in enumerate(notebook["cells"]):
            if cell.get("cell_type") != "code":
                continue
            source = cell.get("source", "")
            if isinstance(source, list):
                source = "".join(source)
            sources.append(source)
            python_only = "\n".join(
                "pass" if line.lstrip().startswith(("!", "%")) else line
                for line in source.splitlines()
            )
            compile(python_only, f"{NOTEBOOK.name}:cell-{index}", "exec")

        combined = "\n".join(sources).lower()
        self.assertNotIn("import gradio", combined)
        self.assertNotIn("gradio_interface", combined)
        self.assertIn("process_segmentation_job", combined)
        self.assertIn("files.upload", combined)
        self.assertIn("segref3d_result.zip", combined)
        self.assertIn("2b90b9f5ceec907a1c18123530e92e794ad901a4", combined)
        self.assertIn("files.upload", sources[0])
        self.assertEqual(combined.count("files.upload"), 1)
        self.assertLess(combined.index("files.upload"), combined.index("pip uninstall"))
        self.assertNotIn("filelink", combined)
        self.assertEqual(combined.count("files.download"), 1)
        self.assertIn("files.download", sources[-1].lower())
        self.assertNotIn("process_segmentation_job(", sources[-1].lower())
        self.assertLess(combined.index("process_segmentation_job("), combined.index("files.download"))


if __name__ == "__main__":
    unittest.main()
