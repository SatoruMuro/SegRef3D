import { createTrainingCaseEntries } from '../../lite-web/training-export.mjs';
import { createStoredZip } from '../../shared/training-archive.mjs';
import { modelManifest, modelZip, resultZip, geometry } from '../../lite-web/tests/custom-model-fixtures.mjs';
import { loadEvaluationModel, loadEvaluationCase } from '../evaluation.mjs';

let sharedModelBlob;

export async function fixture(index = 1, {mutateModel, mutateResult, negative = false, resultGeometry} = {}) {
  const manifest = modelManifest();
  manifest.dataset.train_case_ids = ['SR3D_aaaaaaaa'];
  manifest.dataset.validation_case_ids = ['SR3D_bbbbbbbb'];
  if (mutateModel) mutateModel(manifest);
  // ZIP timestamps are part of the whole-archive identity. Reuse the very same
  // model bytes across cases, even if fixture creation crosses a DOS time tick.
  const modelBlob = mutateModel ? await modelZip(manifest) : await (sharedModelBlob ??= modelZip(manifest));
  const model = await loadEvaluationModel(modelBlob);
  const labels = Uint8Array.from({length:24}, (_, i) => negative ? 0 : i % 5 === 0 ? 5 : i === 3 ? 2 : 0);
  const training = createTrainingCaseEntries({caseId:`SR3D_${index.toString(16).padStart(8,'0')}`,
    sourceFormat:'nifti', width:4, height:3, geometry:geometry(),
    masks:[labels.slice(0,12), labels.slice(12)], objectNames:{2:'Other organ',5:'Tumor'}, intensityPolicy:'original_scalar',
    channels:[{name:'scalar', values:Int16Array.from({length:24},(_,i)=>i*3+index), datatype:'int16'}]});
  const trainingBlob = await createStoredZip(training.entries), c = await loadEvaluationCase(trainingBlob);
  const prediction = labels.map(v=>v === 5 ? 5 : 0);
  const result = await resultZip({model, channelSha256:[...c.hashes], labels:prediction, resultGeometry,
    mutate:r=>{r.request_id=`TR3DI_${index.toString(16).padStart(8,'0')}`; if(mutateResult) mutateResult(r);}});
  return {modelBlob, model, trainingBlob, c, result};
}
