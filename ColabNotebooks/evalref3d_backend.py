"""EvalRef3D v1 CPU evaluation. No inference, resampling, network or weight loading."""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import platform
import stat
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import nibabel as nib
import numpy as np
import scipy
from scipy.ndimage import binary_erosion, generate_binary_structure
from scipy.spatial import cKDTree

import trainref3d_backend as train
from inferref3d_backend import validate_model_manifest, valid_sha256, sha256_file

VERSION = '1.0.0'
FORMAT = 'trainref3d-evaluation-certificate-1.0'
REQUEST_FORMAT = 'trainref3d-evaluation-request-1.0'
MAX_BYTES = 1024**3
MAX_CASES = 32
RAW_POLICY = {'source': 'InferRef3D raw prediction', 'postprocessing': 'none', 'human_edit': False}
VERIFICATION = {'level': 'self_evaluated', 'platform_signature': None}
METRICS = ('dice', 'iou', 'precision', 'recall', 'ground_truth_voxel_count', 'prediction_voxel_count',
           'ground_truth_volume_mm3', 'prediction_volume_mm3', 'volume_error_percent',
           'absolute_volume_error_percent', 'hd95_mm', 'assd_mm')
DEFINITION = {
    'version': 'evalref3d-metrics-1.0', 'foreground': 'label == model.target_label_id',
    'dice': '2*TP/(GT+prediction); both empty=1', 'iou': 'TP/(GT+prediction-TP); both empty=1',
    'precision': 'TP/prediction; prediction empty=null', 'recall': 'TP/GT; GT empty=null',
    'volume_mm3': 'voxel_count * abs(det(full_affine[:3,:3]))',
    'volume_error_percent': '(prediction-GT)/GT*100; GT empty=null',
    'absolute_volume_error_percent': 'abs(volume_error_percent)',
    'surface': 'foreground voxel with at least one background or outside-volume 6-connected neighbor',
    'surface_coordinates': 'voxel centers (integer IJK), full affine to world RAS mm',
    'surface_distances': 'concatenated GT-to-prediction and prediction-to-GT Euclidean nearest surface center distances',
    'hd95_mm': 'numpy.percentile(combined_distances,95,method=linear)',
    'assd_mm': 'mean(combined_distances); weighted by total surface voxel count',
    'empty_surface_policy': 'either mask empty: hd95_mm=null, assd_mm=null',
    'empty_masks': {'both_empty': {'dice': 1, 'iou': 1, 'precision': None, 'recall': None},
                    'gt_empty': {'dice': 0, 'iou': 0, 'precision': 0, 'recall': None},
                    'prediction_empty': {'dice': 0, 'iou': 0, 'precision': None, 'recall': 0}},
    'aggregation': 'unweighted per-case; null excluded; population standard deviation ddof=0',
    'geometry': {'absolute_tolerance': 1e-5, 'relative_tolerance': 0, 'resampling': False},
}
require = train.require


def surface_points(mask, affine):
    surface = mask & ~binary_erosion(mask, structure=generate_binary_structure(3, 1), border_value=0)
    indices = np.argwhere(surface)
    return indices @ affine[:3, :3].T + affine[:3, 3]


def calculate_metrics(gt, prediction, affine):
    gt, prediction = np.asarray(gt, dtype=bool), np.asarray(prediction, dtype=bool)
    require(gt.ndim == 3 and gt.shape == prediction.shape, 'Mask shape mismatch')
    affine = np.asarray(affine, dtype=float)
    require(affine.shape == (4, 4) and np.isfinite(affine).all()
            and abs(np.linalg.det(affine[:3, :3])) > 1e-12, 'Invalid metric affine')
    g, p, tp = int(gt.sum()), int(prediction.sum()), int((gt & prediction).sum())
    voxel_volume = abs(float(np.linalg.det(affine[:3, :3])))
    error = (p - g) / g * 100 if g else None
    result = dict(zip(METRICS, [2 * tp / (g + p) if g + p else 1.,
                               tp / (g + p - tp) if g + p - tp else 1.,
                               tp / p if p else None, tp / g if g else None,
                               g, p, g * voxel_volume, p * voxel_volume, error,
                               abs(error) if error is not None else None, None, None]))
    if g and p:
        gs, ps = surface_points(gt, affine), surface_points(prediction, affine)
        distances = np.concatenate((cKDTree(ps).query(gs, workers=1)[0], cKDTree(gs).query(ps, workers=1)[0]))
        result['hd95_mm'] = float(np.percentile(distances, 95, method='linear'))
        result['assd_mm'] = float(np.mean(distances))
    return result


def aggregate(cases):
    result = {}
    for metric in METRICS:
        values = [c[metric] for c in cases if c[metric] is not None]
        result[metric] = {'valid_case_count': len(values), **dict.fromkeys(
            ['mean', 'median', 'standard_deviation', 'minimum', 'maximum'])}
        if values:
            result[metric].update(zip(['mean', 'median', 'standard_deviation', 'minimum', 'maximum'],
                                     map(float, [np.mean(values), np.median(values), np.std(values, ddof=0), min(values), max(values)])))
    return result


def same_geometry(a, b):
    aa, sa = train.geometry_validate(a)
    ab, sb = train.geometry_validate(b)
    require(a['shape'] == b['shape'] and np.all(np.abs(aa - ab) < train.TOLERANCE)
            and np.all(np.abs(sa - sb) < train.TOLERANCE), 'Geometry mismatch')
    require(train.orientation(aa) == train.orientation(ab), 'Orientation mismatch')


def validate_manifest(m):
    require(m.get('format') == REQUEST_FORMAT and train.valid_id(m.get('certificate_id'), 'TR3DE'), 'Invalid evaluation request')
    require(m.get('verification') == VERIFICATION, 'v1 requires self_evaluated and no platform signature')
    require(m.get('prediction') == RAW_POLICY and m['prediction']['human_edit'] is False,
            'Only raw unedited prediction is allowed')
    binding = m['model']
    model = validate_model_manifest(binding['model_manifest'])
    require(binding.get('model_id') == model['model_id'] and valid_sha256(binding.get('model_zip_sha256')), 'Invalid model binding')
    split = model.get('dataset', {})
    for field in ('train_case_ids', 'validation_case_ids'):
        require(isinstance(split.get(field), list) and all(train.valid_id(x, 'SR3D') for x in split[field]), 'Missing train / validation case IDs')
    require(len(split['train_case_ids']) > 0, 'Missing training provenance')
    used = {x.lower() for x in split['train_case_ids'] + split['validation_case_ids']}
    evaluation = m['evaluation_set']
    cases = m['cases']
    require(isinstance(cases, list) and 1 <= len(cases) <= MAX_CASES, 'Invalid evaluation case count')
    require(evaluation.get('role') == 'independent_holdout' and type(evaluation.get('case_count')) is int
            and evaluation['case_count'] == len(cases) and evaluation.get('case_id_overlap_with_training') is False
            and evaluation.get('subject_independence') == {'status': 'user_attested'}
            and evaluation.get('ground_truth_complete') == 'user_attested'
            and evaluation.get('platform_verified_subject_independence') is False, 'Independent holdout attestation required')
    require(isinstance(evaluation.get('domain'), str) and 0 < len(evaluation['domain'].strip()) <= 500, 'Evaluation domain required')
    ids, fingerprints, requests = set(), set(), set()
    for c in cases:
        cid, rid = c['case_id'], c['request_id']
        require(train.valid_id(cid, 'SR3D') and cid.lower() not in used, 'Training / validation case overlap or invalid ID')
        require(cid.lower() not in ids and train.valid_id(rid, 'TR3DI') and rid.lower() not in requests, 'Duplicate case / request ID')
        ids.add(cid.lower()); requests.add(rid.lower())
        hashes = c['source_fingerprint']
        require(isinstance(hashes, list) and len(hashes) == model['input']['channel_count']
                and all(valid_sha256(x) for x in hashes), 'Invalid source fingerprint')
        require(tuple(hashes) not in fingerprints, 'Duplicate source fingerprint')
        fingerprints.add(tuple(hashes))
        r = c['inference']
        require(r.get('format') == 'trainref3d-inference-result-1.0' and r.get('status') == 'success'
                and r.get('request_id') == rid, 'Invalid inference result identity')
        require(valid_sha256(r.get('backend', {}).get('source_sha256'))
                and all(isinstance(r.get('versions', {}).get(k), str) and 0 < len(r['versions'][k]) <= 64
                        for k in ('python', 'torch', 'monai')), 'Invalid inference runtime provenance')
        require(r['model'] == {'model_id': model['model_id'], 'model_sha256': binding['model_zip_sha256'],
                              'target_label_id': model['task']['target_label_id'], 'target_name': model['task']['target_name']},
                'Inference model ID / hash / target mismatch')
        require(r['source']['channel_sha256'] == hashes and r['source']['channel_count'] == len(hashes), 'Source fingerprint mismatch')
        require(c['source_category'] == r['source']['source_category'] == model['input']['source_category'], 'Source category mismatch')
        require(isinstance(c.get('source_format'), str) and 0 < len(c['source_format']) <= 32, 'Invalid source format')
        require(r['inference']['architecture'] == model['architecture']
                and r['inference']['target_spacing_mm'] == model['input']['target_spacing_mm']
                and r['inference']['preprocessing'] == model['preprocessing']
                and r['inference']['sliding_window'] == model['preprocessing']['inference'], 'Inference preprocessing mismatch')
        for section in (r, r['prediction'], r['inference']):
            require(section.get('postprocessing', 'none') == 'none' and section.get('human_edit', False) is False, 'Edited prediction rejected')
        for name in ('ground_truth', 'prediction'):
            entry = c[name]
            prefix = 'ground_truth' if name == 'ground_truth' else 'prediction'
            require(entry.get('file') in [f'cases/{cid}/{prefix}.nii', f'cases/{cid}/{prefix}.nii.gz']
                    and valid_sha256(entry.get('sha256')), 'Invalid mask path / hash')
        require(c['prediction']['sha256'] == r['prediction']['sha256'], 'Prediction hash mismatch')
        require(r['prediction'].get('file') in ('prediction.nii', 'prediction.nii.gz')
                and c['prediction']['file'] == f'cases/{cid}/{r["prediction"]["file"]}', 'Prediction filename mismatch')
        require(r['prediction']['datatype'] == 'uint8' and r['prediction']['label_values'] == [0, model['task']['target_label_id']], 'Wrong prediction target')
        same_geometry(c['geometry'], r['source']['original_geometry'])
        same_geometry(c['geometry'], r['prediction']['geometry'])
    return model


def checked_entries(archive):
    infos = archive.infolist()
    require(1 <= len(infos) <= 2 * MAX_CASES + 1, 'ZIP entry count exceeds safety limit')
    seen, total = set(), 0
    for info in infos:
        train.safe_path(info.filename)
        require(info.filename.lower() not in seen, 'Duplicate ZIP path')
        seen.add(info.filename.lower())
        require(not info.is_dir() and not stat.S_ISLNK(info.external_attr >> 16)
                and not info.flag_bits & ~0x808 and info.compress_type in (0, 8), 'Unsupported ZIP entry')
        total += info.file_size
        require(info.file_size <= train.MAX_EXPANDED_BYTES and total <= MAX_BYTES, 'Expanded ZIP exceeds safety limit')
    return {info.filename for info in infos}


def load_mask(archive, entry, root, geometry):
    raw = archive.read(entry['file'])  # zipfile verifies local name, overlap and CRC.
    require(hashlib.sha256(raw).hexdigest() == entry['sha256'], 'Mask SHA-256 mismatch')
    compressed = raw[:2] == b'\x1f\x8b'
    require(entry['file'].endswith('.gz') == compressed, 'Gzip extension mismatch')
    path = root / 'mask.nii'
    with path.open('wb') as target:
        if compressed:
            with gzip.GzipFile(fileobj=io.BytesIO(raw)) as source:
                train.copy_bounded(source, target, train.MAX_EXPANDED_BYTES)
        else:
            target.write(raw)
    image, ids, _ = train.load_checked_nifti(path, geometry, label=True)
    actual = {'shape': list(image.shape[:3]), 'affine': image.affine.tolist(), 'spacing_mm': list(map(float, image.header.get_zooms()[:3]))}
    same_geometry(actual, geometry)
    values = np.asarray(image.dataobj).reshape(image.shape[:3]).copy()
    return values, image.affine.copy(), ids


def evaluate_request(request_zip, output_dir):
    request_zip, output_dir = Path(request_zip), Path(output_dir)
    require(request_zip.stat().st_size <= MAX_BYTES, 'Request exceeds 1 GiB safety limit')
    rows = []
    with zipfile.ZipFile(request_zip) as archive, tempfile.TemporaryDirectory(prefix='evalref3d_') as temporary:
        entries = checked_entries(archive)
        m = train.read_json(archive, 'evaluation_manifest.json')
        model = validate_manifest(m)
        expected = {'evaluation_manifest.json'} | {c[k]['file'] for c in m['cases'] for k in ('ground_truth', 'prediction')}
        require(entries == expected, 'Unexpected or missing request files; images / weights are forbidden')
        target = model['task']['target_label_id']
        for c in m['cases']:
            gt, affine, _ = load_mask(archive, c['ground_truth'], Path(temporary), c['geometry'])
            pred, pred_affine, ids = load_mask(archive, c['prediction'], Path(temporary), c['geometry'])
            require(pred.dtype == np.uint8 and ids <= {target}, 'Wrong prediction target / datatype')
            require(np.all(np.abs(affine - pred_affine) < train.TOLERANCE), 'GT / prediction geometry mismatch')
            require(type(c['inference']['prediction']['foreground_voxel_count']) is int
                    and c['inference']['prediction']['foreground_voxel_count'] == int((pred == target).sum()), 'Foreground count mismatch')
            rows.append({k: c[k] for k in ('case_id', 'request_id', 'source_fingerprint', 'source_category', 'source_format', 'geometry')}
                        | {'ground_truth_sha256': c['ground_truth']['sha256'], 'prediction_sha256': c['prediction']['sha256'],
                           'inference_backend_sha256': c['inference']['backend']['source_sha256']}
                        | calculate_metrics(gt == target, pred == target, affine))
    certificate = {
        'format': FORMAT, 'certificate_id': m['certificate_id'], 'created_at_utc': datetime.now(timezone.utc).isoformat(),
        'verification': dict(VERIFICATION),
        'model': {'model_id': model['model_id'], 'model_zip_sha256': m['model']['model_zip_sha256'],
                  'model_format': model['format'], **model['task'], 'input': model['input'],
                  'preprocessing': model['preprocessing'], 'model_manifest': model},
        'evaluation_set': m['evaluation_set'], 'prediction': dict(RAW_POLICY), 'metrics_definition': DEFINITION,
        'summary': aggregate(rows), 'cases': rows,
        'software': {'evalref3d_version': VERSION, 'python': platform.python_version(), 'numpy': np.__version__,
                     'nibabel': nib.__version__, 'scipy': scipy.__version__, 'backend_sha256': sha256_file(__file__),
                     'trainref3d_backend_sha256': sha256_file(train.__file__),
                     'inferref3d_backend_sha256': sha256_file(Path(__file__).with_name('inferref3d_backend.py'))},
        'evaluation_request_sha256': sha256_file(request_zip),
        'limitations': ['Self-evaluated certificate.', 'Subject independence is user-attested, not independently verified.',
                        'Ground Truth completeness is user-attested.', 'Performance applies only to the evaluated data domain.',
                        'This certificate does not establish clinical validity.',
                        'Unsigned metadata can be edited; browser checks are not platform authentication.']}
    encoded = json.dumps(certificate, indent=2, allow_nan=False) + '\n'
    buffer = io.StringIO(newline='')
    fields = ['case_id', 'request_id', 'source_fingerprint', 'ground_truth_sha256', 'prediction_sha256', *METRICS]
    writer = csv.DictWriter(buffer, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        record = {k: row[k] for k in fields}
        record['source_fingerprint'] = json.dumps(record['source_fingerprint'], separators=(',', ':'))
        writer.writerow(record)
    readme = (f'Model Evaluation Certificate — research evaluation record\nModel ID: {model["model_id"]}\n'
              f'Model ZIP SHA-256: {m["model"]["model_zip_sha256"]}\nTarget: Obj {target} — {model["task"]["target_name"]}\n'
              f'Evaluation case count: n={len(rows)}\nDomain: {m["evaluation_set"]["domain"]}\n'
              'Raw prediction only; postprocessing=none; human_edit=false.\nSelf-evaluated; unsigned.\n'
              'Not clinically validated. No performance guarantee. Subject independence and annotation completeness are user-attested.\n'
              'Keep this sidecar with the original, unchanged Model ZIP. CSV blanks mean null; summary excludes nulls.\n')
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f'TrainRef3D_Evaluation_{m["certificate_id"]}.zip'
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('evaluation_certificate.json', encoded)
        archive.writestr('per_case_metrics.csv', buffer.getvalue())
        archive.writestr('README.txt', readme)
    return {'certificate': certificate, 'certificate_zip': str(output)}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('request_zip')
    parser.add_argument('--output-dir', default='evalref3d-output')
    args = parser.parse_args()
    result = evaluate_request(args.request_zip, args.output_dir)
    print(f'n={result["certificate"]["evaluation_set"]["case_count"]}: {result["certificate_zip"]}')
