import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';
import { pairAndValidate, createEvaluationRequest, loadEvaluationModel, loadEvaluationCase } from '../evaluation.mjs';
import { readSafeZip, createStoredZip } from '../../shared/training-archive.mjs';
import { geometry, modelZip, modelManifest } from '../../lite-web/tests/custom-model-fixtures.mjs';

test('five cases pair by fingerprint regardless of file order; request excludes images and weights', async()=>{
  const fs = await Promise.all([1,5,10,23,26].map(i=>fixture(i)));
  const paired = await pairAndValidate(fs[0].model, fs.map(f=>f.c), fs.map(f=>f.result).reverse());
  const request = await createEvaluationRequest(paired,{attested:true,domain:'Synthetic oblique MRI'});
  const entries = await readSafeZip(request.blob,{archive:2**30,expanded:2**30,entries:65});
  assert.equal(entries.size,11); assert.equal(request.manifest.evaluation_set.case_count,5);
  assert.ok([...entries.keys()].every(n=>n==='evaluation_manifest.json'||/^cases\/SR3D_\w+\/(ground_truth|prediction)\.nii$/.test(n)));
  assert.deepEqual(request.manifest.verification,{level:'self_evaluated',platform_signature:null});
  assert.equal(request.manifest.prediction.human_edit,false);
  assert.deepEqual(paired.pairs.map(p=>p.training.caseId), fs.map(f=>f.c.caseId));
});

for (const [name,mutate,pattern] of [
  ['fingerprint',r=>r.source.channel_sha256[0]='f'.repeat(64),/fingerprint/],
  ['model ID',r=>r.model.model_id='TR3DM_deadbeef',/model ID/],
  ['model hash',r=>r.model.model_sha256='f'.repeat(64),/hash/],
  ['target name',r=>r.model.target_name='Wrong',/target/],
  ['target Obj ID',r=>r.model.target_label_id=2,/target|label/],
  ['postprocessing',r=>r.inference.postprocessing='keep_largest_component',/Postprocessed/],
  ['human edit',r=>r.prediction.human_edit=true,/Human-edited/],
  ['preprocessing',r=>r.inference.architecture='Other',/preprocessing/],
]) test(`reject ${name}`,async()=>{
  const f=await fixture(1,{mutateResult:mutate});
  await assert.rejects(pairAndValidate(f.model,[f.c],[f.result]),pattern);
});

test('geometry mismatch is a hard reject',async()=>{
  const g=geometry();g.affine[0][3]+=1;
  const f=await fixture(1,{resultGeometry:g});
  await assert.rejects(pairAndValidate(f.model,[f.c],[f.result]),/geometry/);
});
for(const field of ['train_case_ids','validation_case_ids']) test(`reject overlap in ${field}`,async()=>{
  const f=await fixture(1,{mutateModel:m=>m.dataset[field].push('SR3D_00000001')});
  await assert.rejects(pairAndValidate(f.model,[f.c],[f.result]),/overlap/);
});
test('missing split provenance, duplicates, unmatched cases and absent attestation reject',async()=>{
  await assert.rejects(loadEvaluationModel(await modelZip(modelManifest())),/train_case_ids/);
  const f=await fixture();
  await assert.rejects(pairAndValidate(f.model,[f.c,f.c],[f.result,f.result]),/Duplicate/);
  await assert.rejects(pairAndValidate(f.model,[f.c],[]),/exactly one/);
  const p=await pairAndValidate(f.model,[f.c],[f.result]);
  await assert.rejects(createEvaluationRequest(p,{domain:'Test'}),/Confirm/);
});
test('negative cases retained; no target name assumption from other objects',async()=>{
  const f=await fixture(2,{negative:true});
  assert.equal((await pairAndValidate(f.model,[f.c],[f.result])).pairs.length,1);
});
test('malformed/traversal/unexpected archives rejected',async()=>{
  await assert.rejects(loadEvaluationCase(new Blob(['not zip'])),/ZIP/);
  await assert.rejects(createStoredZip([{name:'../escape',blob:new Blob(['x'])}]),/Unsafe/);
  const f=await fixture(); const entries=await readSafeZip(f.trainingBlob);
  entries.set('private.dcm',new Uint8Array([1]));
  await assert.rejects(loadEvaluationCase(await createStoredZip([...entries].map(([name,raw])=>({name,blob:new Blob([raw])})))),/Unexpected/);
});
