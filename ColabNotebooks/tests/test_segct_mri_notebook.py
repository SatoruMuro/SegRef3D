"""Run notebook orchestration with real ZIP/geometry/backend I/O and synthetic masks.

Colab file UI, installation/network calls, and TotalSegmentator inference are mocked.
This checks cell ordering and file preservation, not real GPU/model execution.
"""
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

import nibabel as nib
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'SegRef3D'), str(ROOT / 'ColabNotebooks')]
import instant3d_bridge as bridge
import instant3dweb2_backend as backend

NOTEBOOK = ROOT / 'ColabNotebooks/Instant3DWeb2.ipynb'


def code_cells():
    return [''.join(c['source']) for c in json.loads(NOTEBOOK.read_text(encoding='utf-8'))['cells']
            if c['cell_type'] == 'code']


def exercise_request(zip_bytes, filename):
    """Also called with actual browser-exported Lite ZIPs by integration verification."""
    with tempfile.TemporaryDirectory() as temp:
        content = Path(temp)
        events, downloads, namespace = [], [], {}
        colab = types.ModuleType('google.colab')
        def upload():
            events.append('upload')
            return {filename: zip_bytes}
        def download(name):
            events.append('download')
            downloads.append(Path(name))
        colab.files = types.SimpleNamespace(upload=upload, download=download)
        def setup_run(args, **kwargs):
            events.append('setup')
            assert Path(namespace['REQUEST_ZIP']).read_bytes() == zip_bytes
            return subprocess.CompletedProcess(args, 0)
        def masks(source, task, rois, output, fast, device):
            events.append('segmentation')
            image = nib.load(source)
            result = {}
            for roi in rois:
                target = output / task / f'{roi}.nii.gz'
                target.parent.mkdir(parents=True, exist_ok=True)
                values = np.zeros(image.shape, dtype=np.uint8)
                values[1:-1, 1:-1, 1:-1] = 1
                nib.save(nib.Nifti1Image(values, image.affine), target)
                result[roi] = target
            return result
        with patch.dict(sys.modules, {'google.colab': colab}), \
             patch.object(subprocess, 'run', side_effect=setup_run), \
             patch.object(backend, 'validate_installed_rois'), \
             patch.object(backend, '_device', return_value='cpu'), \
             patch.object(backend, '_run_task', side_effect=masks), \
             patch.object(backend.importlib.metadata, 'version', return_value='test'):
            for index, source in enumerate(code_cells()):
                source = source.replace('/content', content.as_posix())
                exec(compile(source, f'{NOTEBOOK.name}:cell{index}', 'exec'), namespace)
                assert Path(namespace['REQUEST_ZIP']).read_bytes() == zip_bytes
                assert Path(namespace['REQUEST_ZIP']).name == filename.replace('\\', '/').split('/')[-1]
        assert events[0] == 'upload' and events[-1] == 'download'
        assert events.index('setup') < events.index('segmentation') < events.index('download')
        assert len(downloads) == 1 and downloads[0].name == 'segct_mri_result.zip'
        # Exercise the Local reader for both canonical and legacy result schemas.
        _, source_path = bridge.validate_request_zip(namespace['REQUEST_ZIP'], content / 'verify-source')
        bridge.validate_result_zip(downloads[0], source_path)
        with zipfile.ZipFile(downloads[0]) as archive:
            result = json.loads(archive.read('manifest.json'))
            assert 'labelmap/labels.nii.gz' in archive.namelist()
            assert any(n.startswith('label_png/') for n in archive.namelist())
            assert not any('instant3d' in n.lower() for n in archive.namelist())
            if result['schema'] == bridge.BRIDGE_SCHEMA:
                assert 'instant3d' not in json.dumps(result).lower()
            assert 'segct_mri' in result['software']
        return result


class SegCTMRINotebookTests(unittest.TestCase):
    def test_upload_is_first_setup_preserves_it_and_urls_stay_stable(self):
        cells = code_cells()
        self.assertEqual(len(cells), 4)
        self.assertIn('files.upload()', cells[0])
        self.assertIn('subprocess.run', cells[1])
        self.assertIn('validate_request_zip', cells[2])
        self.assertIn('process_request', cells[2])
        self.assertIn('files.download', cells[3])
        self.assertEqual(''.join(cells).count('files.upload()'), 1)
        self.assertNotIn('rmtree', cells[1])
        for launcher in ('segctmri.html', 'instant3dweb2.html'):
            self.assertIn('/ColabNotebooks/Instant3DWeb2.ipynb',
                          (ROOT / 'ColabNotebooks' / launcher).read_text())
        for source in cells:
            compile(source, str(NOTEBOOK), 'exec')

    def test_run_all_new_and_legacy_requests_ct_and_mri(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'source.nii.gz'
            nib.save(nib.Nifti1Image(np.zeros((5, 6, 4), dtype=np.int16), np.diag([.7, .8, 2, 1])), source)
            for modality, task in [('CT', 'total'), ('MRI', 'total_mr')]:
                request = root / 'case_segct_mri_request.zip'
                bridge.create_request_zip(request, source, [dict(object_id=1, display_name='Liver', task=task, roi='liver')], modality=modality)
                data = request.read_bytes()
                with self.subTest(modality=modality, format='new'):
                    self.assertEqual(exercise_request(data, 'folder\\custom-case.zip')['schema'], bridge.BRIDGE_SCHEMA)
                legacy = io.BytesIO()
                with zipfile.ZipFile(io.BytesIO(data)) as original, zipfile.ZipFile(legacy, 'w') as target:
                    for member in original.namelist():
                        payload = original.read(member)
                        if member == 'manifest.json':
                            manifest = json.loads(payload)
                            manifest['schema'] = bridge.LEGACY_BRIDGE_SCHEMA
                            payload = json.dumps(manifest).encode()
                        target.writestr(member, payload)
                with self.subTest(modality=modality, format='legacy'):
                    result = exercise_request(legacy.getvalue(), 'instant3d_request.zip')
                    self.assertEqual(result['schema'], bridge.LEGACY_BRIDGE_SCHEMA)

    def test_bad_uploads_fail_before_setup(self):
        wrong = io.BytesIO()
        with zipfile.ZipFile(wrong, 'w') as archive:
            archive.writestr('manifest.json', '{}')
        for upload in ({}, {'not.zip': b'not zip'}, {'project.zip': wrong.getvalue()},
                       {'a.zip': b'a', 'b.zip': b'b'}):
            with self.subTest(names=list(upload)), tempfile.TemporaryDirectory() as temp:
                colab = types.ModuleType('google.colab')
                colab.files = types.SimpleNamespace(upload=lambda: upload)
                with patch.dict(sys.modules, {'google.colab': colab}):
                    with self.assertRaisesRegex(ValueError, 'ZIP|request'):
                        exec(code_cells()[0].replace('/content', Path(temp).as_posix()), {})


if __name__ == '__main__':
    unittest.main()
