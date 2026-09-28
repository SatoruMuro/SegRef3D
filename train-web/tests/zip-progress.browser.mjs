// node train-web/tests/zip-progress.browser.mjs
// Optional PLAYWRIGHT_MODULE=/absolute/path/index.mjs, BROWSER_CHANNEL=msedge.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTrainingCaseEntries } from "../../lite-web/training-export.mjs";
import { createZip } from "../../lite-web/zip.mjs";
import { readSafeZip, DATASET_LIMITS } from "../../shared/training-archive.mjs";

const root=fileURLToPath(new URL("../../",import.meta.url));
const output=path.join(root,"build/zip-progress-qa");
await mkdir(output,{recursive:true});
async function fixture(id, size, depth) {
  const count=size*size*depth;
  const masks=Array.from({length:depth},()=>new Uint8Array(size*size).fill(1));
  const {entries}=createTrainingCaseEntries({caseId:id,sourceFormat:"nifti",width:size,height:size,
    geometry:{shape:[size,size,depth],affine:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]},
    masks,objectNames:{1:"Target"},intensityPolicy:"original_scalar",
    channels:[{name:"scalar",values:new Int16Array(count).fill(100)}]});
  const blob=await createZip(entries);
  const filename=path.join(output,`${id}.zip`);
  await writeFile(filename,new Uint8Array(await blob.arrayBuffer()));
  return {filename,bytes:blob.size};
}
const large=await fixture("SR3D_abcdef12",256,256),small=await fixture("SR3D_abcdef13",4,3);
const corrupt=path.join(output,"corrupt.zip");await writeFile(corrupt,"not a ZIP");
const mime={".html":"text/html",".mjs":"text/javascript",".css":"text/css"};
const server=createServer(async(request,response)=>{
  try {
    const pathname=new URL(request.url,"http://localhost").pathname;
    const file=path.resolve(root,`.${pathname.endsWith("/")?pathname+"index.html":pathname}`);
    if(path.relative(root,file).startsWith(".."))throw Error("Outside root");
    const body=await readFile(file);
    response.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream"});
    response.end(body);
  } catch {response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`${origin}/train-web/`);
  const shortcut=page.locator("#colab-shortcut a");
  for(const width of [1280,390,320]) {
    await page.setViewportSize({width,height:844});
    assert.equal(await shortcut.isVisible(),true);
    assert.equal(await page.locator("#ready").isHidden(),true);
    assert.equal(await page.locator("#build").isDisabled(),true);
    assert.equal(await shortcut.getAttribute("href"),"../ColabNotebooks/trainref3d.html");
    assert.equal(await shortcut.getAttribute("target"),"_blank");
    assert.equal(await shortcut.getAttribute("rel"),"noopener noreferrer");
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const box=await shortcut.boundingBox();
    assert.ok(box.y>=0&&box.y+box.height<=844,"Shortcut is visible without scrolling");
    assert.ok(box.x>=0&&box.x+box.width<=width,"Shortcut fits narrow screens");
    await page.screenshot({path:path.join(output,`colab-shortcut-${width}.png`)});
  }
  const popupPending=page.waitForEvent("popup");await shortcut.click();
  const popup=await popupPending;await popup.waitForLoadState("domcontentloaded");
  assert.equal(popup.url(),`${origin}/ColabNotebooks/trainref3d.html`);
  assert.equal(await popup.evaluate(()=>window.opener===null),true);
  await popup.close();
  assert.equal(await page.locator("#ready").isHidden(),true);
  await page.setViewportSize({width:1280,height:1000});
  await page.evaluate(()=>{
    window.samples=[];window.busyFrames=0;
    const panel=document.getElementById("load-progress");
    new MutationObserver(()=>{
      samples.push({visible:!panel.hidden,text:document.getElementById("load-progress-text").textContent,
        detail:document.getElementById("load-progress-detail").textContent,
        value:document.getElementById("load-progress-bar").getAttribute("value")});
    }).observe(panel,{subtree:true,childList:true,attributes:true,characterData:true});
    function frame(){if(!panel.hidden)busyFrames++;requestAnimationFrame(frame);}requestAnimationFrame(frame);
  });
  await page.locator("#files").setInputFiles([large.filename,corrupt,small.filename]);
  await page.waitForFunction(()=>!document.getElementById("load-progress").hidden);
  assert.equal(await page.locator("#files").isDisabled(),true);
  await page.screenshot({path:path.join(output,"loading.png")});
  await page.waitForFunction(()=>document.getElementById("status").textContent.startsWith("Validation complete"),{},{timeout:60000});
  const telemetry=await page.evaluate(()=>({samples,busyFrames}));
  assert.ok(telemetry.busyFrames>2,"Main thread must keep painting during ZIP work");
  assert.ok(telemetry.samples.some(s=>s.visible&&s.text.includes("Extracting files...")&&s.value!==null));
  assert.ok(telemetry.samples.some(s=>s.visible&&s.text.includes("Preparing images...")&&s.value===null));
  assert.ok(telemetry.samples.some(s=>s.detail.startsWith("ZIP 3/3")),"ZIP numbering must include rejected archives");
  assert.equal(await page.locator("#case-rows tr").count(),2);
  assert.match(await page.locator("#errors").textContent(),/corrupt.zip/);
  assert.equal(await page.locator("#load-progress").isHidden(),true);
  assert.equal(await page.locator("#files").isEnabled(),true);

  // Export still retains the original case ZIPs and contract after progress reporting.
  await page.locator("#complete").check();await page.locator("#build").click();
  await page.waitForFunction(()=>!document.getElementById("ready").hidden,{},{timeout:60000});
  const readyColab=page.locator('#ready a[href="../ColabNotebooks/trainref3d.html"]');
  assert.equal(await readyColab.isVisible(),true);
  assert.equal(await readyColab.getAttribute("class"),"button");
  assert.equal(await readyColab.getAttribute("target"),"_blank");
  assert.equal(await readyColab.getAttribute("rel"),"noopener noreferrer");
  for(const width of [1280,390,320]) {
    await page.setViewportSize({width,height:844});
    assert.equal(await shortcut.isVisible(),true);
    assert.equal(await readyColab.isVisible(),true);
    await readyColab.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(output,`dataset-ready-${width}.png`)});
  }
  await page.setViewportSize({width:1280,height:1000});
  const pending=page.waitForEvent("download");await page.locator("#download").click();
  const download=await pending, exported=path.join(output,"dataset.zip");await download.saveAs(exported);
  const entries=await readSafeZip(new Blob([await readFile(exported)]),DATASET_LIMITS);
  assert.deepEqual(entries.get("cases/SegRef3D_Train_SR3D_abcdef12.zip"),new Uint8Array(await readFile(large.filename)));
  assert.equal(JSON.parse(new TextDecoder().decode(entries.get("dataset_manifest.json"))).cases.length,2);
  await page.locator("#case-rows button").first().click();
  await page.waitForFunction(()=>document.querySelectorAll("#case-rows tr").length===1);
  await page.locator("#clear").click();
  await page.waitForFunction(()=>document.querySelectorAll("#case-rows tr").length===0);
  await page.locator("#files").setInputFiles(corrupt);
  await page.waitForFunction(()=>document.getElementById("errors").children.length===1&&!document.getElementById("files").disabled);
  assert.equal(await page.locator("#load-progress").isHidden(),true);
  await page.locator("#files").setInputFiles(small.filename);
  await page.waitForFunction(()=>document.querySelectorAll("#case-rows tr").length===1);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(output,"complete-mobile.png")});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);

  // A crashed Worker must also clear the progress UI and explain recovery.
  await page.route("**/dataset-worker.mjs*",route=>route.fulfill({contentType:"text/javascript",body:"self.onmessage=()=>{throw new Error('Test worker failure');};"}));
  await page.reload();
  await page.locator("#files").setInputFiles(small.filename);
  await page.waitForFunction(()=>document.getElementById("status").textContent.includes("worker failed"));
  assert.equal(await page.locator("#load-progress").isHidden(),true);
  assert.equal(errors.filter(e=>!e.includes("Test worker failure")).length,0);
  const report={largeZipBytes:large.bytes,busyFrames:telemetry.busyFrames,progressEvents:telemetry.samples.length,
    checks:["persistent Colab shortcut", "safe new-tab navigation", "initial desktop/mobile layout", "preserved Dataset ready link", "visible progress", "entry counts", "indeterminate preparation", "responsive main thread", "mixed valid/invalid ZIPs", "unchanged export bytes", "remove/clear", "retry after error", "mobile layout", "worker failure cleanup"]};
  await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
