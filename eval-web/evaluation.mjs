import { loadModelZip, sha256Hex, validateInferenceResultZip } from '../lite-web/custom-model.mjs';
import { validateTrainingCase, validCaseId } from '../shared/training-case.mjs';
import { readSafeZip, createStoredZip } from '../shared/training-archive.mjs';

export const REQUEST_FORMAT = 'trainref3d-evaluation-request-1.0';
export const MAX_CASES = 32; // 1 manifest + 2 masks per case, ZIP32 / 1 GiB.
export const RAW_POLICY = Object.freeze({source: 'InferRef3D raw prediction', postprocessing: 'none', human_edit: false});
const json = value => new Blob([JSON.stringify(value, null, 2) + '\n']);
const key = hashes => JSON.stringify(hashes);
const require = (ok, message) => { if (!ok) throw new Error(message); };

export function holdoutIds(manifest) {
  const split = manifest.dataset;
  for (const field of ['train_case_ids', 'validation_case_ids']) {
    require(Array.isArray(split?.[field]) && split[field].every(validCaseId), `Missing or invalid ${field}; independent holdout cannot be checked.`);
  }
  require(split.train_case_ids.length > 0, 'Model has no training case provenance.');
  return new Set([...split.train_case_ids, ...split.validation_case_ids].map(id => id.toLowerCase()));
}

export async function loadEvaluationModel(blob) {
  const model = await loadModelZip(blob);
  holdoutIds(model.manifest);
  // Keep only the manifest and whole ZIP identity; never execute weights.
  return {manifest: model.manifest, sha256: model.sha256};
}

export async function loadEvaluationCase(blob, onProgress) {
  const info = await validateTrainingCase(blob, onProgress);
  const files = await readSafeZip(blob);
  const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
  const hashes = [];
  for (const channel of manifest.image.channels) hashes.push(await sha256Hex(files.get(channel.file)));
  return {...info, hashes, groundTruth: files.get(manifest.label.file),
    groundTruthExtension: manifest.label.file.endsWith('.gz') ? '.nii.gz' : '.nii'};
}

function rawOnly(result) {
  for (const section of [result, result.prediction, result.inference]) {
    require(section?.postprocessing === undefined || section.postprocessing === 'none', 'Postprocessed prediction rejected.');
    require(section?.human_edit === undefined || section.human_edit === false, 'Human-edited prediction rejected.');
  }
}

export async function pairAndValidate(model, cases, resultBlobs, onProgress = () => {}) {
  const used = holdoutIds(model.manifest);
  require(cases.length > 0 && cases.length <= MAX_CASES, `Select 1–${MAX_CASES} evaluation cases.`);
  require(cases.length === resultBlobs.length, 'Every Training ZIP needs exactly one Result ZIP.');
  const byHash = new Map(), ids = new Set();
  for (const c of cases) {
    require(!used.has(c.caseId.toLowerCase()), `Training / validation overlap: ${c.caseId}`);
    require(!ids.has(c.caseId.toLowerCase()), 'Duplicate evaluation case ID.');
    require(!byHash.has(key(c.hashes)), 'Duplicate source fingerprint; ambiguous subjects.');
    require(c.channelCount === model.manifest.input.channel_count && c.sourceCategory === model.manifest.input.source_category,
      'Training case input channel count / source category mismatch.');
    ids.add(c.caseId.toLowerCase()); byHash.set(key(c.hashes), c);
  }
  const matched = new Set(), requests = new Set(), pairs = [];
  let maskBytes = cases.reduce((sum, c) => sum + c.groundTruth.byteLength, 0);
  require(maskBytes < 2 ** 30, 'Evaluation masks exceed the 1 GiB request limit.');
  for (const blob of resultBlobs) {
    onProgress(`Validating result ${pairs.length + 1}/${resultBlobs.length}…`);
    const result = await validateInferenceResultZip(blob, {model});
    require(result.modelWarnings.length === 0, result.modelWarnings.join(' '));
    rawOnly(result.manifest);
    const c = byHash.get(key(result.manifest.source.channel_sha256));
    require(c, 'Source fingerprint mismatch: no identical Training ZIP channel bytes.');
    require(!matched.has(c.caseId) && !requests.has(result.manifest.request_id.toLowerCase()), 'Duplicate result / request ID.');
    // Reuse the same geometry and prediction integrity gate used by Lite import.
    await validateInferenceResultZip(blob, {model, channelSha256: c.hashes, geometry: c.geometry});
    maskBytes += result.predictionBytes.byteLength;
    require(maskBytes < 2 ** 30, 'Evaluation masks exceed the 1 GiB request limit.');
    matched.add(c.caseId); requests.add(result.manifest.request_id.toLowerCase());
    pairs.push({training: c, result});
  }
  return {model, pairs: pairs.sort((a,b) => a.training.caseId.localeCompare(b.training.caseId))};
}

export async function createEvaluationRequest(validated, {attested = false, domain = ''} = {}) {
  require(attested === true, 'Confirm subject independence and Ground Truth completeness.');
  require(typeof domain === 'string' && domain.trim().length > 0 && domain.length <= 500, 'Describe the evaluated data domain (maximum 500 characters).');
  const {model, pairs} = validated;
  const certificateId = `TR3DE_${crypto.randomUUID().replaceAll('-', '')}`;
  const cases = [], entries = [];
  for (const {training: c, result} of pairs) {
    const gtFile = `cases/${c.caseId}/ground_truth${c.groundTruthExtension}`;
    const predFile = `cases/${c.caseId}/${result.manifest.prediction.file}`;
    entries.push({name: gtFile, blob: new Blob([c.groundTruth])}, {name: predFile, blob: new Blob([result.predictionBytes])});
    const r = result.manifest;
    cases.push({case_id: c.caseId, request_id: r.request_id, source_fingerprint: c.hashes,
      source_category: c.sourceCategory, source_format: c.sourceFormat, geometry: c.geometry,
      ground_truth: {file: gtFile, sha256: await sha256Hex(c.groundTruth)},
      prediction: {file: predFile, sha256: r.prediction.sha256},
      inference: {format: r.format, status: r.status, request_id: r.request_id,
        model: r.model, source: r.source, prediction: r.prediction,
        inference: r.inference, backend: r.backend, versions: r.versions}});
  }
  const manifest = {format: REQUEST_FORMAT, certificate_id: certificateId,
    model: {model_id: model.manifest.model_id, model_zip_sha256: model.sha256, model_manifest: model.manifest},
    evaluation_set: {role: 'independent_holdout', case_count: cases.length, domain: domain.trim(),
      case_id_overlap_with_training: false, subject_independence: {status: 'user_attested'},
      ground_truth_complete: 'user_attested', platform_verified_subject_independence: false},
    prediction: {...RAW_POLICY}, verification: {level: 'self_evaluated', platform_signature: null}, cases};
  const manifestBlob = json(manifest);
  require(manifestBlob.size <= 1048576, 'Evaluation manifest exceeds the 1 MiB safety limit.');
  entries.unshift({name: 'evaluation_manifest.json', blob: manifestBlob});
  return {manifest, blob: await createStoredZip(entries), filename: `EvalRef3D_Request_${certificateId}.zip`};
}
