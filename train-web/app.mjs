import { datasetWarnings } from "./dataset-format.mjs?v=1";
const el=id=>document.getElementById(id);
const worker=new Worker(new URL("./dataset-worker.mjs?v=1",import.meta.url),{type:"module"});
let cases=[],targets=[],busy=false,failed=false,downloadUrl=null;
const setStatus=message=>{el("status").textContent=message;};
function invalidate() {
  el("complete").checked=false; el("ready").hidden=true;
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl=null; }
}
function controls() {
  for (const id of ["files","clear","target","target-name","complete"]) el(id).disabled=busy || failed || (["target","target-name","complete"].includes(id)&&!targets.length);
  for (const button of el("case-rows").querySelectorAll("button")) button.disabled=busy;
  el("build").disabled=busy || failed || !cases.length || !el("target").value || !el("target-name").value.trim() || !el("complete").checked;
}
function warnings() {
  el("warnings").replaceChildren(...datasetWarnings(cases,Number(el("target").value)).map(message=>{
    const li=document.createElement("li");li.textContent=message;return li;
  }));
}
function render() {
  const previous=el("target").value;
  el("case-count").textContent=`${cases.length} valid case(s) included`;
  el("case-rows").replaceChildren(...cases.map(c=>{
    const row=document.createElement("tr");
    for (const value of [c.caseId,c.sourceFormat,c.channelCount,c.geometry.shape.join(" × "),c.geometry.spacing_mm.map(x=>Number(x.toFixed(4))).join(" × "),c.objects.map(o=>`${o.id}: ${o.name}`).join(", ")||"No foreground",c.intensityPolicy,"Ready"]) {
      const cell=document.createElement("td");cell.textContent=value;row.append(cell);
    }
    const cell=document.createElement("td"),button=document.createElement("button");button.textContent="Remove";button.setAttribute("aria-label",`Remove ${c.caseId}`);
    button.onclick=()=>send({action:"remove",caseId:c.caseId});cell.append(button);row.append(cell);return row;
  }));
  el("target").replaceChildren(...targets.map(t=>{const o=document.createElement("option");o.value=t.id;o.textContent=`Obj ${t.id} — ${t.names.join(" / ")}`;return o;}));
  if (targets.some(t=>String(t.id)===previous)) el("target").value=previous;
  el("target-name").value=targets.find(t=>String(t.id)===el("target").value)?.names[0]||"";
  warnings();controls();
}
function send(message) {if(busy||failed)return;invalidate();busy=true;controls();worker.postMessage(message);}
function load(files) {
  if (busy||failed)return;
  const selected=[...files];
  if (selected.length>64) {setStatus("Select at most 64 Training ZIPs at once.");return;}
  if (selected.some(f=>!f.name.toLowerCase().endsWith(".zip"))) {setStatus("Select .zip files only.");return;}
  send({action:"load",files:selected});
}
worker.onmessage=({data})=>{
  if(data.type==="progress") {setStatus(data.message);return;}
  if(data.type==="case-error") {const li=document.createElement("li");li.textContent=`Error — ${data.displayName} excluded: ${data.message}`;el("errors").append(li);return;}
  busy=false;
  if(data.type==="cases") {cases=data.cases;targets=data.targets;render();setStatus("Validation complete. Error cases are excluded. Review your target and annotation completeness.");}
  else if(data.type==="built") {downloadUrl=URL.createObjectURL(data.blob);el("download").href=downloadUrl;el("download").download=data.filename;el("ready").hidden=false;setStatus("Dataset ready. No data has been uploaded.");}
  else setStatus(`Error: ${data.message}`);
  controls();
};
worker.onerror=()=>{busy=false;failed=true;invalidate();cases=[];targets=[];render();setStatus("Validation worker failed (possibly insufficient memory). Reload the page and use fewer/smaller cases.");};
el("files").onchange=event=>{load(event.target.files);event.target.value="";};
el("clear").onclick=()=>{el("errors").replaceChildren();send({action:"clear"});};
el("target").onchange=()=>{invalidate();el("target-name").value=targets.find(t=>String(t.id)===el("target").value)?.names[0]||"";warnings();controls();};
el("target-name").oninput=()=>{invalidate();controls();};
el("complete").onchange=controls;
el("build").onclick=()=>{
  if(el("build").disabled)return;
  el("ready").hidden=true;
  if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null;}
  busy=true;controls();setStatus("Creating Dataset ZIP...");
  worker.postMessage({action:"build",options:{targetLabelId:Number(el("target").value),targetName:el("target-name").value,annotationComplete:el("complete").checked}});
};
for (const event of ["dragenter","dragover"]) el("drop-area").addEventListener(event,e=>{e.preventDefault();if(!busy)el("drop-area").classList.add("dragover");});
for (const event of ["dragleave","drop"]) el("drop-area").addEventListener(event,e=>{e.preventDefault();el("drop-area").classList.remove("dragover");if(event==="drop")load(e.dataTransfer.files);});
window.addEventListener("beforeunload",()=>{worker.terminate();if(downloadUrl)URL.revokeObjectURL(downloadUrl);});
