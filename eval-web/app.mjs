import { loadEvaluationModel, loadEvaluationCase, pairAndValidate, createEvaluationRequest, MAX_CASES } from './evaluation.mjs';
const $ = id => document.getElementById(id);
let validated = null, url = null, busy = false;
function downloadReset() {
  if (url) URL.revokeObjectURL(url);
  url = null; $('ready').hidden = true; $('download').removeAttribute('href');
}
function enable() { $('create').disabled = busy || !validated || !$('attestation').checked || !$('domain').value.trim(); }
function reset() {
  validated = null; $('validation-summary').hidden = true; $('case-list').replaceChildren();
  $('attestation').checked = false; $('attestation').disabled = true; downloadReset(); enable();
}
function lock(value) {
  busy = value;
  for (const id of ['model-file', 'training-files', 'result-files', 'validate', 'domain']) $(id).disabled = value;
  $('attestation').disabled = value || !validated; enable();
}
for (const id of ['model-file', 'training-files', 'result-files']) $(id).addEventListener('change', reset);
for (const id of ['attestation', 'domain']) $(id).addEventListener('input', () => { downloadReset(); enable(); });
$('validate').addEventListener('click', async () => {
  reset(); lock(true);
  try {
    const modelFile = $('model-file').files[0];
    const trainingFiles = [...$('training-files').files], results = [...$('result-files').files];
    if (!modelFile || !trainingFiles.length || trainingFiles.length > MAX_CASES || trainingFiles.length !== results.length)
      throw new Error(`Select one model and equal numbers of Training and Result ZIPs (1–${MAX_CASES}).`);
    $('status').textContent = 'Validating model and hashing original ZIP…';
    const model = await loadEvaluationModel(modelFile), cases = [];
    for (const file of trainingFiles) {
      $('status').textContent = `Validating Training ZIP ${cases.length + 1}/${trainingFiles.length}…`;
      cases.push(await loadEvaluationCase(file));
    }
    validated = await pairAndValidate(model, cases, results, text => { $('status').textContent = text; });
    $('model-id').textContent = model.manifest.model_id;
    $('target').textContent = `Obj ${model.manifest.task.target_label_id} — ${model.manifest.task.target_name}`;
    $('case-count').textContent = `${cases.length} matched / ${cases.length} (n=${cases.length})`;
    for (const {training} of validated.pairs) {
      const li = document.createElement('li'); li.textContent = `${training.caseId} — source and geometry matched`;
      $('case-list').append(li);
    }
    $('validation-summary').hidden = false;
    $('status').textContent = 'All pairs validated. Describe the evaluation domain and confirm the independent holdout subjects.';
  } catch (error) { reset(); $('status').textContent = `Rejected: ${error.message}`; }
  finally { lock(false); }
});
$('create').addEventListener('click', async () => {
  lock(true); downloadReset();
  try {
    $('status').textContent = 'Creating request with Ground Truth and raw prediction only…';
    const result = await createEvaluationRequest(validated, {attested: $('attestation').checked, domain: $('domain').value});
    url = URL.createObjectURL(result.blob); $('download').href = url; $('download').download = result.filename;
    $('ready').hidden = false; $('status').textContent = `Ready: n=${result.manifest.cases.length}. Download and upload this request in your CPU Colab runtime.`;
  } catch (error) { $('status').textContent = `Request failed: ${error.message}`; }
  finally { lock(false); }
});
window.addEventListener('pagehide', downloadReset);
