import { validateTrainingCase, TRAINING_CASE_FORMAT } from "../shared/training-case.mjs?v=1";
import { createStoredZip, DATASET_LIMITS } from "../shared/training-archive.mjs?v=1";
export const DATASET_FORMAT = "trainref3d-dataset-1.0";
const validated = new WeakSet();
export async function loadTrainingCase(blob) {
  const record = { ...await validateTrainingCase(blob), blob };
  validated.add(record);
  return record;
}
export function checkConsistency(cases) {
  if (!cases.length) throw new Error("Add at least one valid Training ZIP.");
  if (cases.length > 64) throw new Error("MVP supports at most 64 cases per Dataset ZIP.");
  const ids = new Set();
  for (const c of cases) {
    if (ids.has(c.caseId.toLowerCase())) throw new Error(`Duplicate case_id: ${c.caseId}`);
    ids.add(c.caseId.toLowerCase());
    if (c.channelCount !== cases[0].channelCount) throw new Error("Mixed 1-channel / 3-channel datasets are not supported.");
    if (c.sourceCategory !== cases[0].sourceCategory) throw new Error("Mixed medical-scalar / raster intensity semantics are not supported.");
  }
}
export function targetUnion(cases) {
  const targets = new Map();
  for (const c of cases) for (const o of c.objects) {
    if (!targets.has(o.id)) targets.set(o.id, new Set());
    targets.get(o.id).add(o.name);
  }
  return [...targets].sort(([a],[b])=>a-b).map(([id,names])=>({id,names:[...names].sort(),conflict:names.size>1}));
}
export function datasetWarnings(cases, target) {
  const n=cases.length, warnings=[];
  if (n<5) warnings.push("Experimental smoke test only (1–4 cases).");
  else if (n<10) warnings.push("Very small training dataset (5–9 cases).");
  else if (n<20) warnings.push("Small dataset; validation estimates may be unstable (10–19 cases).");
  if (n===1) warnings.push("One case cannot provide a held-out validation set. Colab will report resubstitution smoke-test Dice only.");
  if (cases[0]?.sourceCategory==="medical_scalar") warnings.push("CT and MRI modality cannot be identified reliably from this format. Include only one coherent imaging domain.");
  if (new Set(cases.map(c=>c.intensityPolicy)).size>1 || new Set(cases.map(c=>c.sourceFormat)).size>1) warnings.push("Source formats / intensity policies differ. Confirm that these cases represent the same imaging domain; CT/MRI modality cannot be inferred reliably.");
  if (cases.some(c=>c.intensityPolicy.includes("high_bit_depth"))) warnings.push("Some source intensities were reduced to the explicitly accepted 8-bit working grid by SegRef3D Lite.");
  if (targetUnion(cases).find(t=>t.id===target)?.conflict) warnings.push("This Obj ID has different names across cases. Confirm they refer to the SAME target structure; IDs are not remapped.");
  const negative=cases.filter(c=>!c.labelIds.includes(target)).length;
  if (target && negative) warnings.push(`${negative} included case(s) lack this target and will be treated as true negatives.`);
  return warnings;
}
export function createDatasetManifest(cases, {targetLabelId,targetName,annotationComplete,datasetId}={}) {
  checkConsistency(cases);
  if (annotationComplete!==true) throw new Error("Annotation completeness must be confirmed for every included case.");
  if (!targetUnion(cases).some(t=>t.id===targetLabelId)) throw new Error("Select one target structure present in at least one case.");
  if (typeof targetName!=="string" || !targetName.trim() || targetName.length>80) throw new Error("Target name must contain 1–80 characters.");
  if (!/^TR3D_[a-f0-9]{8,32}$/.test(datasetId||"")) throw new Error("Invalid dataset_id.");
  return {format:DATASET_FORMAT,dataset_id:datasetId,created_by:"TrainRef3D",training_case_format:TRAINING_CASE_FORMAT,
    task:{type:"binary_segmentation",target_label_id:targetLabelId,target_name:targetName.trim(),annotation_policy:"complete_for_selected_target"},
    input:{channel_count:cases[0].channelCount,source_category:cases[0].sourceCategory},
    cases:cases.map(c=>({case_id:c.caseId,file:`cases/SegRef3D_Train_${c.caseId}.zip`})),
    privacy:{processing_before_colab:"browser_local",image_data_may_be_identifiable:true},
    warnings:datasetWarnings(cases,targetLabelId)};
}
export async function buildDataset(cases, options, onProgress=()=>{}) {
  if (cases.some(c=>!validated.has(c))) throw new Error("Every case must pass archive validation before packaging.");
  if (cases.reduce((sum,c)=>sum+c.blob.size,0)>DATASET_LIMITS.archive-1048576) throw new Error("Dataset exceeds the 1 GiB browser limit.");
  const random=crypto.getRandomValues(new Uint8Array(8));
  const datasetId=options.datasetId||`TR3D_${[...random].map(n=>n.toString(16).padStart(2,"0")).join("")}`;
  const manifest=createDatasetManifest(cases,{...options,datasetId});
  const entries=[{name:"dataset_manifest.json",blob:new Blob([JSON.stringify(manifest,null,2)+"\n"])}];
  cases.forEach((c,i)=>entries.push({name:manifest.cases[i].file,blob:c.blob}));
  return {manifest,blob:await createStoredZip(entries,onProgress),filename:`TrainRef3D_Dataset_${datasetId}.zip`};
}
