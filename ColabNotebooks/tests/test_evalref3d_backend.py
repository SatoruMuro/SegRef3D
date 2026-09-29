"""Synthetic CPU metrics, archive rejection and browser-module -> Python E2E."""
import copy
import contextlib
import csv
import gzip
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile
from pathlib import Path

import jsonschema
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'ColabNotebooks'))
import evalref3d_backend as backend


class MetricsTests(unittest.TestCase):
    def mask(self, points):
        mask = np.zeros((5, 5, 5), dtype=bool)
        for p in points:
            mask[p] = True
        return mask

    def test_perfect_partial_no_overlap(self):
        g = self.mask([(1, 1, 1), (2, 1, 1)])
        p = self.mask([(2, 1, 1), (3, 1, 1)])
        perfect = backend.calculate_metrics(g, g, np.eye(4))
        self.assertEqual([perfect[x] for x in ('dice', 'iou', 'hd95_mm', 'assd_mm')], [1, 1, 0, 0])
        partial = backend.calculate_metrics(g, p, np.eye(4))
        self.assertEqual(partial['dice'], .5)
        self.assertAlmostEqual(partial['iou'], 1 / 3)
        self.assertEqual(partial['precision'], .5)
        self.assertEqual(partial['recall'], .5)
        self.assertEqual(partial['assd_mm'], .5)
        self.assertEqual(partial['hd95_mm'], 1)
        none = backend.calculate_metrics(g, self.mask([(4, 4, 4)]), np.eye(4))
        self.assertEqual(none['dice'], 0)
        self.assertEqual(none['iou'], 0)
        self.assertEqual(none['volume_error_percent'], -50)
        self.assertEqual(none['absolute_volume_error_percent'], 50)

    def test_empty_policy(self):
        empty, nonempty = self.mask([]), self.mask([(1, 1, 1)])
        for g, p, expected in [(empty, empty, [1, 1, None, None]),
                                (empty, nonempty, [0, 0, 0, None]),
                                (nonempty, empty, [0, 0, None, 0])]:
            result = backend.calculate_metrics(g, p, np.eye(4))
            self.assertEqual([result[k] for k in ('dice', 'iou', 'precision', 'recall')], expected)
            self.assertIsNone(result['hd95_mm'])
            self.assertIsNone(result['assd_mm'])
            if not g.any():
                self.assertIsNone(result['volume_error_percent'])

    def test_anisotropic_and_full_oblique_affine(self):
        g, p = self.mask([(1, 1, 1)]), self.mask([(2, 2, 1)])
        for affine in [np.diag([2., 3., 5., 1.]),
                       np.array([[2., 1., 0., 20.], [1., 3., 0., -12.], [.5, .2, 5., 40.], [0, 0, 0, 1]])]:
            expected = np.linalg.norm(affine[:3, :3] @ np.array([1, 1, 0]))
            result = backend.calculate_metrics(g, p, affine)
            self.assertAlmostEqual(result['hd95_mm'], expected)
            self.assertAlmostEqual(result['assd_mm'], expected)
            self.assertAlmostEqual(result['ground_truth_volume_mm3'], abs(np.linalg.det(affine[:3, :3])))

    def test_border_surface_and_population_aggregation(self):
        points = backend.surface_points(np.ones((3, 3, 3), dtype=bool), np.eye(4))
        self.assertEqual(len(points), 26)
        empty = self.mask([])
        row = backend.calculate_metrics(empty, empty, np.eye(4))
        rows = [dict(row, dice=x) for x in [0, .25, .5, .75, 1]]
        summary = backend.aggregate(rows)
        self.assertEqual(summary['dice']['valid_case_count'], 5)
        self.assertEqual(summary['dice']['mean'], .5)
        self.assertEqual(summary['dice']['median'], .5)
        self.assertAlmostEqual(summary['dice']['standard_deviation'], np.sqrt(.125))
        self.assertEqual(summary['hd95_mm']['valid_case_count'], 0)
        self.assertIsNone(summary['hd95_mm']['mean'])

    def test_surface_weighting_uses_concatenated_distances(self):
        result = backend.calculate_metrics(self.mask([(0, 1, 1), (1, 1, 1)]), self.mask([(3, 1, 1)]), np.eye(4))
        self.assertAlmostEqual(result['assd_mm'], 7 / 3)
        self.assertAlmostEqual(result['hd95_mm'], 2.9)

    def test_rare_large_surface_distances_can_make_assd_exceed_hd95(self):
        gt = np.zeros((201, 1, 1), dtype=bool)
        gt[:100] = True
        prediction = gt.copy()
        prediction[200] = True
        result = backend.calculate_metrics(gt, prediction, np.eye(4))
        self.assertEqual(result['hd95_mm'], 0)
        self.assertAlmostEqual(result['assd_mm'], 101 / 201)
        self.assertGreater(result['assd_mm'], result['hd95_mm'])


class RequestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        subprocess.run(['node', str(ROOT / 'eval-web/tests/create-request.mjs'), str(cls.root)], check=True, capture_output=True)
        cls.request = cls.root / 'request.zip'
        with zipfile.ZipFile(cls.request) as archive:
            cls.entries = {n: archive.read(n) for n in archive.namelist()}
        cls.manifest = json.loads(cls.entries['evaluation_manifest.json'])

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def altered(self, mutate=None, extra=None):
        manifest = copy.deepcopy(self.manifest)
        if mutate:
            mutate(manifest)
        path = self.root / 'altered.zip'
        with zipfile.ZipFile(path, 'w') as archive:
            for name, raw in self.entries.items():
                archive.writestr(name, json.dumps(manifest) if name == 'evaluation_manifest.json' else raw)
            if extra:
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    archive.writestr(*extra)
        return path

    def test_cross_language_certificate_schema_csv_and_no_payloads(self):
        result = backend.evaluate_request(self.request, self.root / 'output')
        c = result['certificate']
        schema = json.loads((ROOT / 'schemas/trainref3d-evaluation-certificate-1.0.schema.json').read_text())
        jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(c)
        self.assertEqual(c['evaluation_set']['case_count'], 5)
        self.assertEqual(c['summary']['dice']['mean'], 1)
        self.assertEqual(c['summary']['dice']['valid_case_count'], 5)
        self.assertEqual(c['summary']['hd95_mm']['maximum'], 0)
        self.assertEqual(c['summary']['hd95_mm']['valid_case_count'], 4)
        self.assertEqual(c['summary']['precision']['valid_case_count'], 4)
        with zipfile.ZipFile(result['certificate_zip']) as archive:
            self.assertEqual(set(archive.namelist()), {'evaluation_certificate.json', 'per_case_metrics.csv', 'README.txt'})
            rows = list(csv.DictReader(io.StringIO(archive.read('per_case_metrics.csv').decode())))
            self.assertEqual(len(rows), 5)
            for row, case in zip(rows, c['cases']):
                self.assertEqual(row['case_id'], case['case_id'])
                for key in backend.METRICS:
                    self.assertEqual(float(row[key]) if row[key] else None, case[key])
            self.assertIn('n=5', archive.read('README.txt').decode())
        invalid = copy.deepcopy(c)
        invalid['verification']['level'] = 'platform_verified'
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(invalid, schema)

    def test_reject_identity_fingerprint_geometry_policy_and_overlap(self):
        mutations = [
            lambda m: m['model'].update(model_id='TR3DM_deadbeef'),
            lambda m: m['model'].update(model_zip_sha256='f' * 64),
            lambda m: m['cases'][0]['inference']['model'].update(target_label_id=2),
            lambda m: m['cases'][0]['source_fingerprint'].__setitem__(0, 'f' * 64),
            lambda m: m['cases'][0]['geometry']['affine'][0].__setitem__(3, 100),
            lambda m: m['model']['model_manifest']['dataset']['train_case_ids'].append(m['cases'][0]['case_id']),
            lambda m: m['model']['model_manifest']['dataset']['validation_case_ids'].append(m['cases'][0]['case_id']),
            lambda m: m['verification'].update(level='platform_verified'),
            lambda m: m['verification'].update(platform_signature='pretend'),
            lambda m: m['prediction'].update(postprocessing='fill_holes'),
            lambda m: m['prediction'].update(human_edit=True),
            lambda m: m['cases'][0]['inference']['prediction'].update(human_edit=True),
            lambda m: m['cases'][0]['ground_truth'].update(sha256='f' * 64),
            lambda m: m['cases'][0]['inference']['prediction'].update(foreground_voxel_count=0),
            lambda m: m['evaluation_set'].update(ground_truth_complete=False),
            lambda m: m['evaluation_set'].update(case_count=1),
            lambda m: m['cases'][1].update(case_id=m['cases'][0]['case_id']),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                with self.assertRaises(ValueError):
                    backend.evaluate_request(self.altered(mutation), self.root / 'rejected')
        self.assertFalse((self.root / 'rejected').exists())

    def test_safe_zip_paths_duplicates_unexpected_and_corruption(self):
        for name in ('../escape', '/absolute', 'C:/escape', 'a\\b', 'evaluation_manifest.json', 'image.nii', 'model.pt'):
            with self.subTest(name=name):
                with self.assertRaises((ValueError, zipfile.BadZipFile)):
                    backend.evaluate_request(self.altered(extra=(name, b'bad')), self.root / 'rejected')
        path = self.root / 'bad.zip'
        path.write_bytes(b'not a zip')
        with self.assertRaises(zipfile.BadZipFile):
            backend.evaluate_request(path, self.root / 'rejected')
        raw = bytearray(self.request.read_bytes()); raw[80] ^= 1; path.write_bytes(raw)
        with self.assertRaises((ValueError, zipfile.BadZipFile)):
            backend.evaluate_request(path, self.root / 'rejected')

    def test_actual_mask_geometry_and_expansion_limits(self):
        def shift_all_metadata(m):
            c = m['cases'][0]
            for g in (c['geometry'], c['inference']['source']['original_geometry'], c['inference']['prediction']['geometry']):
                g['affine'][0][3] += 10
                if 'origin_mm' in g:
                    g['origin_mm'][0] += 10
        with self.assertRaisesRegex(ValueError, 'geometry mismatch'):
            backend.evaluate_request(self.altered(shift_all_metadata), self.root / 'rejected')
        with patch.object(backend, 'MAX_BYTES', 10):
            with self.assertRaisesRegex(ValueError, 'safety limit'):
                backend.evaluate_request(self.request, self.root / 'rejected')
        path = self.root / 'linked.zip'
        info = zipfile.ZipInfo('mask.nii'); info.create_system = 3; info.external_attr = 0o120777 << 16
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr(info, b'link-target')
        with self.assertRaisesRegex(ValueError, 'Unsupported ZIP entry'):
            backend.evaluate_request(path, self.root / 'rejected')

    def test_gzip_masks_evaluate_and_expansion_is_bounded(self):
        m = copy.deepcopy(self.manifest)
        entries = {}
        for c in m['cases']:
            for key in ('ground_truth', 'prediction'):
                entry = c[key]
                raw = gzip.compress(self.entries[entry['file']], mtime=0)
                entry['file'] += '.gz'
                entry['sha256'] = hashlib.sha256(raw).hexdigest()
                entries[entry['file']] = raw
            c['inference']['prediction']['file'] += '.gz'
            c['inference']['prediction']['sha256'] = c['prediction']['sha256']
        path = self.root / 'gzip.zip'
        with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('evaluation_manifest.json', json.dumps(m))
            for name, raw in entries.items():
                archive.writestr(name, raw)
        result = backend.evaluate_request(path, self.root / 'gzip-output')
        self.assertEqual(result['certificate']['summary']['dice']['mean'], 1)
        with zipfile.ZipFile(path) as archive, patch.object(backend.train, 'MAX_EXPANDED_BYTES', 100):
            with self.assertRaisesRegex(ValueError, 'Expanded data exceeds'):
                backend.load_mask(archive, m['cases'][0]['ground_truth'], self.root, m['cases'][0]['geometry'])

    def test_notebook_cells_execute_cpu_end_to_end_and_reuse_upload(self):
        # Execute the actual notebook cells locally. Only Colab UI/network/pip are
        # replaced; evaluation runs in a real pinned Python subprocess.
        from types import ModuleType
        notebook = json.loads((ROOT / 'ColabNotebooks/EvalRef3D_v1_0.ipynb').read_text(encoding='utf-8'))
        content = self.root / 'notebook'; content.mkdir()
        uploads, downloads = [], []
        files = ModuleType('google.colab.files')
        def upload():
            uploads.append(True)
            return {'request.zip': self.request.read_bytes()}
        files.upload = upload
        files.download = lambda p: downloads.append(Path(p))
        colab = ModuleType('google.colab'); colab.files = files
        def retrieve(url, destination):
            shutil.copyfile(ROOT / 'ColabNotebooks' / url.rsplit('/', 1)[1], destination)
        original_call = subprocess.check_call
        def run(command):
            if command[1:3] != ['-m', 'pip']:
                return original_call(command, stdout=subprocess.DEVNULL)
            return 0
        namespace = {}
        with patch.dict(sys.modules, {'google.colab': colab, 'google.colab.files': files}), \
                patch('urllib.request.urlretrieve', retrieve), patch('subprocess.check_call', run), \
                contextlib.redirect_stdout(io.StringIO()):
            for _ in range(2):
                for cell in notebook['cells']:
                    if cell['cell_type'] == 'code':
                        code = ''.join(cell['source']).replace('/content', content.as_posix())
                        exec(compile(code, 'EvalRef3D notebook', 'exec'), namespace)
        self.assertEqual(len(uploads), 1)
        self.assertEqual(len(downloads), 2)
        for path in downloads:
            with zipfile.ZipFile(path) as archive:
                certificate = json.loads(archive.read('evaluation_certificate.json'))
                self.assertEqual(certificate['evaluation_set']['case_count'], 5)
                self.assertEqual(certificate['summary']['dice']['mean'], 1)

    def test_notebook_cpu_and_pinned_setup(self):
        notebook = json.loads((ROOT / 'ColabNotebooks/EvalRef3D_v1_0.ipynb').read_text(encoding='utf-8'))
        source = '\n'.join(''.join(c['source']) for c in notebook['cells'])
        self.assertNotIn('"accelerator": "GPU"', json.dumps(notebook))
        for pin in (ROOT / 'ColabNotebooks/evalref3d-requirements.txt').read_text().splitlines():
            self.assertIn(pin, source)
        for cell in notebook['cells']:
            if cell['cell_type'] == 'code':
                compile(''.join(cell['source']), 'EvalRef3D notebook', 'exec')
        self.assertLess(source.index('files.upload()'), source.index('pip'))
        self.assertIn('files.download(', source)


if __name__ == '__main__':
    unittest.main()
