// Local/browser/cross-language test assets, never real training performance data.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createTrainingCaseEntries } from "../../lite-web/training-export.mjs";
import { createZip } from "../../lite-web/zip.mjs";
import { loadTrainingCase, buildDataset } from "../dataset-format.mjs";
const directory=resolve(process.argv[2]||".venv-train/fixtures");
await mkdir(directory,{recursive:true});
const cases=[];
for(let i=0;i<3;i++) {
  const rgb=i===2,caseId=`SR3D_${(12345678+i).toString(16).padStart(8,"0")}`;
  const result=createTrainingCaseEntries({caseId,sourceFormat:rgb?"jpeg":"nifti",width:12,height:10,
    geometry:{shape:[12,10,6],affine:[[.7,0,0,12],[0,.9,0,-8],[0,0,2,30],[0,0,0,1]]},
    masks:Array.from({length:6},(_,z)=>Uint8Array.from({length:120},(_,j)=>i===1?0:(z>1&&z<4&&j>30&&j<60?5:0))),
    objectNames:{5:"Synthetic target"},intensityPolicy:rgb?"working_rgb_8bit":"original_scalar",
    channels:Array.from({length:rgb?3:1},(_,c)=>({name:rgb?["red","green","blue"][c]:"scalar",values:rgb?Uint8Array.from({length:720},(_,j)=>j%200+c*20):Int16Array.from({length:720},(_,j)=>j*7-500)}))});
  const blob=await createZip(result.entries);
  await writeFile(join(directory,`case-${i}.zip`),new Uint8Array(await blob.arrayBuffer()),{flag:"wx"});
  if(!rgb)cases.push(await loadTrainingCase(blob));
}
const dataset=await buildDataset(cases,{targetLabelId:5,targetName:"Synthetic target",annotationComplete:true,datasetId:"TR3D_abcdef12"});
await writeFile(join(directory,"dataset-web.zip"),new Uint8Array(await dataset.blob.arrayBuffer()),{flag:"wx"});
console.log(directory);
