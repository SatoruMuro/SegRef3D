import { loadTrainingCase, checkConsistency, targetUnion, datasetWarnings, buildDataset } from "./dataset-format.mjs?v=1";
let cases=[];
self.onmessage=async ({data})=>{
  try {
    if (data.action==="clear") cases=[];
    else if (data.action==="remove") cases=cases.filter(c=>c.caseId!==data.caseId);
    else if (data.action==="load") {
      for (const blob of data.files) {
        self.postMessage({type:"progress",message:`Validating ${cases.length+1}...`});
        try {
          const record=await loadTrainingCase(blob);
          checkConsistency([...cases,record]);
          if (cases.reduce((sum,c)=>sum+c.blob.size,blob.size)>1072693248) throw new Error("Dataset exceeds the 1 GiB browser limit.");
          cases.push(record);
        } catch(error) { self.postMessage({type:"case-error",displayName:blob.name||"Training ZIP",message:error.message}); }
      }
    } else if (data.action==="build") {
      const result=await buildDataset(cases,data.options,name=>self.postMessage({type:"progress",message:`Packaging ${name}`}));
      self.postMessage({type:"built",...result}); return;
    }
    self.postMessage({type:"cases",cases:cases.map(({blob,...summary})=>summary),targets:targetUnion(cases),warnings:datasetWarnings(cases,data.target)});
  } catch(error) { self.postMessage({type:"error",message:error.message}); }
};
