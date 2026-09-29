// Cross-language fixture producer: real browser modules and synthetic inputs only.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures.mjs';
import { pairAndValidate, createEvaluationRequest } from '../evaluation.mjs';
const output=path.resolve(process.argv[2] || 'build/evalref3d-e2e');
await mkdir(output,{recursive:true});
const fs=[];
for(const i of [1,5,10,23,26]) fs.push(await fixture(i,{negative:i===26}));
const p=await pairAndValidate(fs[0].model,fs.map(f=>f.c),fs.map(f=>f.result).reverse());
const request=await createEvaluationRequest(p,{attested:true,domain:'Synthetic CPU E2E; oblique anisotropic grid'});
await writeFile(path.join(output,'request.zip'),new Uint8Array(await request.blob.arrayBuffer()));
for (const [name,blob] of [['model.zip',fs[0].modelBlob],['training.zip',fs[0].trainingBlob],['result.zip',fs[0].result]])
  await writeFile(path.join(output,name),new Uint8Array(await blob.arrayBuffer()));
console.log(path.join(output,'request.zip'));
