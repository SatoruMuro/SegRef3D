import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createTrainingCaseEntries, readNiftiTrainingVolume } from "../../lite-web/training-export.mjs";
import { createZip } from "../../lite-web/zip.mjs";
import { readSafeZip, createStoredZip, DATASET_LIMITS } from "../../shared/training-archive.mjs";
import { inspectNifti, validateTrainingCase } from "../../shared/training-case.mjs";
import { loadTrainingCase, checkConsistency, targetUnion, createDatasetManifest, buildDataset, datasetWarnings } from "../dataset-format.mjs";

export async function fixture({id="SR3D_12345678",rgb=false,negative=false,mutate,extra=[],gzip=false}={}) {
  const result=createTrainingCaseEntries({caseId:id,sourceFormat:rgb?"jpeg":"nifti",width:4,height:3,
    geometry:{shape:[4,3,2],affine:[[0,-0.75,0,12],[0.5,0,0,-8],[0,0,2.5,30],[0,0,0,1]]},
    masks:Array.from({length:2},()=>negative?new Uint8Array(12):Uint8Array.from([0,1,2,5,0,0,0,0,0,0,0,0])),
    objectNames:{1:"Aorta",2:"Kidney",5:"Tumor"},intensityPolicy:rgb?"working_rgb_8bit":"original_scalar",
    channels:Array.from({length:rgb?3:1},(_,i)=>({name:rgb?["red","green","blue"][i]:"scalar",values:rgb?Uint8Array.from({length:24},(_,j)=>i*60+j):Int16Array.from({length:24},(_,j)=>j*100-500)}))});
  let entries=result.entries;
  if(gzip) {
    for(const channel of result.manifest.image.channels) {
      const entry=entries.find(e=>e.name===channel.file);entry.blob=new Blob([gzipSync(new Uint8Array(await entry.blob.arrayBuffer()))]);entry.name+=".gz";channel.file+=".gz";
    }
  }
  if(mutate) entries=await mutate(result.manifest,entries)||entries;
  entries=entries.filter(e=>e.name!=="manifest.json");
  entries.push({name:"manifest.json",blob:new Blob([JSON.stringify(result.manifest)])},...extra);
  return createZip(entries);
}
const options={targetLabelId:5,targetName:"Tumor",annotationComplete:true,datasetId:"TR3D_abcdef12"};

test("A: multiple actual Lite-exported cases validate; scalar gzip and oblique geometry",async()=>{
  const a=await loadTrainingCase(await fixture({gzip:true})),b=await loadTrainingCase(await fixture({id:"SR3D_87654321"}));
  checkConsistency([a,b]);assert.equal(a.channelCount,1);assert.deepEqual(a.geometry.shape,[4,3,2]);assert.deepEqual(a.labelIds,[1,2,5]);
});
test("B: duplicate case_id is rejected",async()=>{const c=await loadTrainingCase(await fixture());assert.throws(()=>checkConsistency([c,c]),/Duplicate/);});
test("C: mixed scalar and RGB rejected",async()=>{const a=await loadTrainingCase(await fixture()),b=await loadTrainingCase(await fixture({id:"SR3D_87654321",rgb:true}));assert.throws(()=>checkConsistency([a,b]),/Mixed/);});
test("D: invalid case manifest rejected",async()=>{await assert.rejects(loadTrainingCase(await fixture({mutate:m=>{m.format="wrong";}})),/manifest/);});
test("E: missing image rejected",async()=>{await assert.rejects(loadTrainingCase(await fixture({mutate:(m,e)=>e.filter(x=>!x.name.startsWith("imagesTr/"))})),/Missing image/);});
test("F: missing label rejected",async()=>{await assert.rejects(loadTrainingCase(await fixture({mutate:(m,e)=>e.filter(x=>!x.name.startsWith("labelsTr/"))})),/Missing label/);});
test("G: target union keeps sparse IDs and warns on names",async()=>{
  const a=await loadTrainingCase(await fixture()),b=await loadTrainingCase(await fixture({id:"SR3D_87654321",mutate:m=>{m.label.objects[2].name="Lesion";}}));
  assert.deepEqual(targetUnion([a,b]).map(t=>t.id),[1,2,5]);assert.equal(targetUnion([a,b])[2].conflict,true);assert.ok(datasetWarnings([a,b],5).some(s=>s.includes("different names")));
});
test("H/I: selected target manifest and mandatory completeness",async()=>{
  const c=await loadTrainingCase(await fixture());const m=createDatasetManifest([c],options);
  assert.equal(m.format,"trainref3d-dataset-1.0");assert.equal(m.task.target_label_id,5);assert.equal(m.task.target_name,"Tumor");
  assert.throws(()=>createDatasetManifest([c],{...options,annotationComplete:false}),/completeness/);
  assert.throws(()=>createDatasetManifest([c],{...options,targetLabelId:3}),/Select one/);
});
test("J: nested ZIP layout and original bytes retained",async()=>{
  const original=await fixture(),c=await loadTrainingCase(original),result=await buildDataset([c],options);
  const entries=await readSafeZip(result.blob,DATASET_LIMITS);
  assert.deepEqual([...entries.keys()],["dataset_manifest.json","cases/SegRef3D_Train_SR3D_12345678.zip"]);
  assert.deepEqual(entries.get(result.manifest.cases[0].file),new Uint8Array(await original.arrayBuffer()));
  assert.equal(result.filename,"TrainRef3D_Dataset_TR3D_abcdef12.zip");
});
test("K: traversal, absolute, backslash, duplicate and unexpected ZIP paths rejected",async()=>{
  for(const name of ["../escape","/absolute","a/../escape","C:/evil","a\\..\\escape","manifest.json","secret.dcm"]) {
    await assert.rejects(loadTrainingCase(await fixture({extra:[{name,blob:new Blob(["bad"])}]})),/Unsafe|Duplicate|Unexpected/);
  }
});
test("L: empty target cases retained as negatives",async()=>{
  const cases=await Promise.all([loadTrainingCase(await fixture()),loadTrainingCase(await fixture({id:"SR3D_87654321",negative:true}))]);
  const m=createDatasetManifest(cases,options);assert.equal(m.cases.length,2);assert.ok(m.warnings.some(s=>s.includes("true negatives")));
});
test("geometry / spacing / origin / orientation and label schema mismatches rejected",async()=>{
  for(const mutate of [m=>{m.geometry.affine[0][3]+=1;},m=>{m.geometry.spacing_mm[0]*=2;},m=>{m.geometry.orientation="LPS";},m=>{m.geometry.origin_mm[0]+=1;},m=>{m.label.objects.pop();},m=>{m.label.datatype="float32";}]) {
    await assert.rejects(loadTrainingCase(await fixture({mutate})),/mismatch|match|disagree/i);
  }
});
test("manifest PHI is not propagated to dataset; display names are plain text",async()=>{
  const c=await loadTrainingCase(await fixture({mutate:m=>{m.PatientName="NOT_COPIED";m.PatientID="MRN-123";}}));
  assert.ok(!JSON.stringify(createDatasetManifest([c],options)).includes("NOT_COPIED"));
  const app=await readFile(new URL("../app.mjs",import.meta.url),"utf8");assert.ok(!app.includes("innerHTML"));
});
test("truncated NIfTI / non-finite data / wrong RGB channel order rejected",async()=>{
  await assert.rejects(inspectNifti(new Uint8Array(100)),/NIfTI/);
  await assert.rejects(loadTrainingCase(await fixture({rgb:true,mutate:m=>{m.image.channels[1].name="red";}})),/order/);
  const f=await readSafeZip(await fixture());const bytes=f.get("imagesTr/SR3D_12345678_0000.nii");
  await assert.rejects(inspectNifti(bytes.subarray(0,353)),/Truncated/);
});
test("archive safety limits before decompression and trusted-validation boundary",async()=>{
  await assert.rejects(readSafeZip(await fixture(),{archive:10,expanded:10,entries:1}),/safety limit/);
  await assert.rejects(buildDataset([{blob:new Blob()}],options),/validation/);
  await assert.rejects(createStoredZip([{name:"../a",blob:new Blob()}]),/Unsafe/);
});
test("web is local-only and Colab upload is explicit",async()=>{
  const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
  assert.match(html,/connect-src 'none'/);assert.match(html,/multiple/);assert.match(html,/annotation|annotated/);assert.match(html,/does not upload/);
  const app=await readFile(new URL("../app.mjs",import.meta.url),"utf8");assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(app));assert.match(app,/new Worker/);
});

test("NIfTI-2 header and qform agree with the existing independent Lite reader",async()=>{
  const files=await readSafeZip(await fixture());
  const first=files.get("imagesTr/SR3D_12345678_0000.nii");
  const q=first.slice(),qv=new DataView(q.buffer);
  qv.setInt16(254,0,true);qv.setInt16(252,1,true);qv.setFloat32(264,Math.SQRT1_2,true);
  [12,-8,30].forEach((n,i)=>qv.setFloat32(268+4*i,n,true));
  const qParsed=await inspectNifti(q), independent=readNiftiTrainingVolume(q);
  qParsed.geometry.affine.forEach((row,i)=>row.forEach((n,j)=>assert.ok(Math.abs(n-independent.affine[i][j])<1e-5)));
  const n2=new Uint8Array(544+48),v=new DataView(n2.buffer);v.setInt32(0,540,true);
  n2.set([110,43,50,0,13,10,26,10],4);v.setInt16(12,4,true);v.setInt16(14,16,true);
  [3,4,3,2,1,1,1,1].forEach((n,i)=>v.setBigInt64(16+8*i,BigInt(n),true));
  [1,.5,.75,2.5].forEach((n,i)=>v.setFloat64(104+8*i,n,true));
  v.setBigInt64(168,544n,true);v.setFloat64(176,1,true);v.setInt32(348,1,true);v.setInt32(500,2,true);
  const affine=[[0,-.75,0,12],[.5,0,0,-8],[0,0,2.5,30]];
  affine.forEach((row,i)=>row.forEach((n,j)=>v.setFloat64(400+(i*4+j)*8,n,true)));n2.set(first.subarray(352),544);
  const parsed=await inspectNifti(n2);assert.deepEqual(parsed.geometry.affine,readNiftiTrainingVolume(n2).affine);assert.deepEqual(parsed.geometry.shape,[4,3,2]);
});
test("non-finite, extra time axes, disguised gzip and label scaling fail closed",async()=>{
  const files=await readSafeZip(await fixture()),original=files.get("imagesTr/SR3D_12345678_0000.nii");
  const bad=original.slice(),v=new DataView(bad.buffer);v.setInt16(40,5,true);v.setInt16(48,1,true);v.setInt16(50,2,true);
  await assert.rejects(inspectNifti(bad),/3D/);
  const floats=new Uint8Array(352+24*4);floats.set(original.subarray(0,352));const fv=new DataView(floats.buffer);fv.setInt16(70,16,true);fv.setInt16(72,32,true);fv.setFloat32(352,NaN,true);
  await assert.rejects(inspectNifti(floats),/non-finite/);
  const label=files.get("labelsTr/SR3D_12345678.nii").slice();new DataView(label.buffer).setFloat32(112,2,true);
  await assert.rejects(inspectNifti(label,{labels:true}),/unscaled integer/);
  await assert.rejects(loadTrainingCase(await fixture({mutate:(m,e)=>{const c=m.image.channels[0];e.find(x=>x.name===c.file).name+=".gz";c.file+=".gz";}})),/gzip/);
});
test("corrupt CRC, symlink and expansion metadata are rejected",async()=>{
  const raw=new Uint8Array(await (await fixture()).arrayBuffer());
  const crc=raw.slice();crc[80]^=1;await assert.rejects(readSafeZip(crc),/integrity/);
  const linked=raw.slice(),v=new DataView(linked.buffer),end=linked.length-22,central=v.getUint32(end+16,true);
  v.setUint32(central+38,0xa1ff0000,true);await assert.rejects(readSafeZip(linked),/linked/);
  await assert.rejects(readSafeZip(raw,{archive:100000,expanded:100,entries:16}),/safety limit/);
});
