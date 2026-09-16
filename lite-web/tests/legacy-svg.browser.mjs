// Generate medical_source_fixtures.py into build/svg-qa/medical first.
// Browser UI imports/downloads with test-only state observation; no shipped hooks.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseZip, createZip } from "../zip.mjs";
import { encodeLegacySvg, decodeLegacySvg } from "../legacy-svg.mjs";
import { readNiftiTrainingVolume } from "../training-export.mjs";
import { loadTrainingCase } from "../../train-web/dataset-format.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.resolve(process.argv[2] || "build/svg-qa");
await mkdir(output, {recursive:true});
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const server = createServer(async (request,response) => {
  try {
    const url = new URL(request.url,"http://localhost");
    const file = path.resolve(root, `.${url.pathname.endsWith("/") ? url.pathname+"index.html" : url.pathname}`);
    if (path.relative(root,file).startsWith("..")) throw Error("outside root");
    let body=await readFile(file);
    if (url.pathname==="/lite-web/app.mjs") body+= "\nglobalThis.svgTest={state};\n";
    response.writeHead(200,{"Content-Type":({".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",".html":"text/html",".json":"application/json"})[path.extname(file)]||"application/octet-stream"});
    response.end(body);
  } catch {response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})});
const context=await browser.newContext({acceptDownloads:true,serviceWorkers:"block",viewport:{width:1440,height:1000}});
const page=await context.newPage(), errors=[], alerts=[], outside=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("dialog",async d=>{if(d.type()==="alert")alerts.push(d.message());await d.accept();});
await context.route("**/*",route=>{if(route.request().url().startsWith(origin))return route.continue();outside.push(route.request().url());return route.abort();});
const masks=()=>page.evaluate(()=>svgTest.state.images.map(i=>[...i.mask]));
const idle=()=>page.waitForFunction(()=>!svgTest.state.loading);
async function download(id,name) {
  if (!await page.locator("#export-menu").evaluate(e=>e.open)) await page.locator("#export-menu > summary").click();
  const pending=page.waitForEvent("download");await page.locator(id).click();
  const d=await pending;const filename=path.join(output,name);await d.saveAs(filename);await idle();
  return {bytes:new Uint8Array(await readFile(filename)),filename,suggested:d.suggestedFilename()};
}
async function importZip(filename,{mode="replace",review=false,cancel=false}={}) {
  if (!await page.locator("#open-menu").evaluate(e=>e.open)) await page.locator("#open-menu > summary").click(); await page.locator("#load-masks").click();
  await page.locator(`input[name="mask-import-mode"][value="${mode}"]`).check();
  await page.locator("#mask-import-cancel").click();
  await page.locator("#mask-zip-input").setInputFiles(filename);
  if(review) {
    await page.locator("#svg-mapping-dialog").waitFor({state:"visible"});
    await page.locator(cancel?'#svg-mapping-dialog button[value="cancel"]':"#svg-mapping-apply").click();
  }
  await idle();
}
const affineEqual=(a,b)=>a.forEach((row,y)=>row.forEach((v,x)=>assert.ok(Math.abs(v-b[y][x])<1e-5,`affine ${y},${x}: ${v} != ${b[y][x]}`)));
try {
  await page.goto(`${origin}/lite-web/`);await page.waitForFunction(()=>!!globalThis.svgTest);
  await page.locator("#folder-input").setInputFiles(path.join(output,"medical/MR"));
  await page.waitForFunction(()=>svgTest.state.images.length===4&&!svgTest.state.loading);
  const source=readNiftiTrainingVolume(new Uint8Array(await readFile(path.join(output,"medical/MR.nii"))));
  const expected=JSON.parse(await readFile(path.join(root,"test-data/legacy-svg/migration/expected.json"))).canonical;
  const initialGeometry=await page.evaluate(()=>svgTest.state.sourceVolume.geometry);
  if (!await page.locator("#open-menu").evaluate(e=>e.open)) await page.locator("#open-menu > summary").click(); await page.locator("#load-masks").click();
  assert.match(await page.locator("#choose-mask-folder").innerText(),/SVG/);
  await page.locator("#mask-import-cancel").click();
  await page.locator("#mask-folder-input").setInputFiles(path.join(root,"test-data/legacy-svg/migration"));
  await page.locator("#svg-mapping-dialog").waitFor({state:"visible"});
  assert.equal(await page.locator("#svg-slice-order").inputValue(),"legacy-filename");
  assert.match(await page.locator("#svg-mapping-summary").innerText(),/reverse order/);
  assert.match(await page.locator("#svg-mapping-preview").innerText(),/mask0001.svg → display 4 \/ z=3 → slice01.dcm/);
  await page.screenshot({path:path.join(output,"mapping-review.png")});
  await page.locator("#svg-mapping-apply").click();await idle();
  if (await page.locator("#open-menu").evaluate(e=>e.open)) await page.locator("#open-menu > summary").click();
  assert.deepEqual(await masks(),expected);
  assert.deepEqual(await page.evaluate(()=>svgTest.state.sourceVolume.geometry),initialGeometry);
  // Import is recorded in the ordinary per-frame PNG/edit undo history.
  await page.locator("#undo-action").click();
  assert.deepEqual((await masks())[0],Array(30).fill(0));
  await page.locator("#redo-action").click();assert.deepEqual(await masks(),expected);
  // Ordinary drawing and cleanup act on imported labels; Obj 2 stays protected.
  await page.getByRole("tab",{name:"Draw & Refine",exact:true}).click();
  await page.locator('#label-list [data-label="3"] .label-copy').click();
  const canvas=await page.locator("#editor-canvas").boundingBox();
  const center={x:canvas.x+canvas.width/2,y:canvas.y+canvas.height/2};
  for(const [dx,dy,button] of [[-90,-90,"left"],[90,-90,"left"],[90,90,"left"],[-90,90,"right"]]) await page.mouse.click(center.x+dx,center.y+dy,{button});
  await page.locator("#add-mask").click();
  assert.ok((await masks())[0].includes(3));
  await page.locator("#undo-action").click();assert.deepEqual(await masks(),expected);
  await page.getByRole("tab",{name:"Mask Cleanup",exact:true}).click();
  await page.locator("#cleanup-object").selectOption("1");await page.locator("#cleanup-operation").selectOption("dilate");
  await page.locator("#apply-cleanup").click();await idle();
  assert.ok((await masks())[0].filter(v=>v===1).length>expected[0].filter(v=>v===1).length);
  assert.equal((await masks())[0].filter(v=>v===2).length,1);
  await page.locator("#undo-action").click();assert.deepEqual(await masks(),expected);
  await page.locator("#redo-action").click();
  await page.locator("#undo-action").click();assert.deepEqual(await masks(),expected);

  const nifti=readNiftiTrainingVolume((await download("#export-menu-nifti","migration-labels.nii")).bytes);
  assert.deepEqual(nifti.shape,source.shape);affineEqual(nifti.affine,source.affine);
  assert.deepEqual([...nifti.values],expected.flat());
  const training=await download("#export-training","migration-training.zip");
  const trainingEntries=await parseZip(new Blob([training.bytes]));
  const image=readNiftiTrainingVolume(trainingEntries.find(e=>e.name.startsWith("imagesTr/")).bytes);
  const label=readNiftiTrainingVolume(trainingEntries.find(e=>e.name.startsWith("labelsTr/")).bytes);
  const trainingManifest=JSON.parse(new TextDecoder().decode(trainingEntries.find(e=>e.name==="manifest.json").bytes));
  assert.deepEqual(image.shape,label.shape);affineEqual(image.affine,label.affine);affineEqual(image.affine,source.affine);
  assert.deepEqual([...image.values],[...source.values]);assert.deepEqual([...label.values],expected.flat());
  assert.match(JSON.stringify(trainingManifest),/segref3d-canonical-v1/);
  const trainCase=await loadTrainingCase(new Blob([training.bytes]));assert.ok(trainCase.labelIds.includes(1)&&trainCase.labelIds.includes(2));

  const png=await download("#export-labels","migration-png.zip");
  const project=await download("#export-project","migration-project.zip");
  const exported=await download("#export-svg-masks","migration-svg.zip");
  assert.match(exported.suggested,/_svg_masks.zip$/);
  const exportedEntries=await parseZip(new Blob([exported.bytes]));
  for(let z=0;z<4;z++) assert.deepEqual([...decodeLegacySvg(new TextDecoder().decode(exportedEntries.find(e=>e.name===`mask000${z+1}.svg`).bytes),6,5)],expected[z]);
  // Files are also consumed by the desktop parity test after this run.
  for(const e of exportedEntries.filter(e=>e.name.endsWith(".svg"))) await writeFile(path.join(output,e.name),e.bytes);
  await importZip(exported.filename,{review:true,cancel:true});assert.deepEqual(await masks(),expected);

  const added=Array.from({length:4},()=>new Uint8Array(30));added[0][0]=20;
  const mergeFile=path.join(output,"merge.zip");
  await writeFile(mergeFile,new Uint8Array(await (await createZip(added.map((mask,z)=>({name:`mask000${z+1}.svg`,blob:new Blob([encodeLegacySvg(mask,6,5)])})))).arrayBuffer()));
  // Manifestless ZIP: explicitly select canonical instead of old filename order.
  if (!await page.locator("#open-menu").evaluate(e=>e.open)) await page.locator("#open-menu > summary").click(); await page.locator("#load-masks").click();await page.locator('input[name="mask-import-mode"][value="merge"]').check();await page.locator("#mask-import-cancel").click();
  await page.locator("#mask-zip-input").setInputFiles(mergeFile);
  await page.locator("#svg-mapping-dialog").waitFor({state:"visible"});await page.locator("#svg-slice-order").selectOption("canonical");await page.locator("#svg-mapping-apply").click();await idle();
  const merged=structuredClone(expected);merged[0][0]=20;assert.deepEqual(await masks(),merged);
  await importZip(exported.filename,{review:true});assert.deepEqual(await masks(),expected);
  await importZip(png.filename);assert.deepEqual(await masks(),expected);
  await importZip(project.filename);assert.deepEqual(await masks(),expected);
  const mixedFile=path.join(output,"mixed-png-svg.zip");
  const pngEntries=await parseZip(new Blob([png.bytes]));
  await writeFile(mixedFile,new Uint8Array(await (await createZip([
    ...pngEntries.map(e=>({name:e.name,blob:new Blob([e.bytes])})),
    {name:"mask0001.svg",blob:new Blob(['<svg><script>throw Error("never execute")</script></svg>'])},
  ])).arrayBuffer()));
  await importZip(mixedFile);assert.deepEqual(await masks(),expected);
  assert.match(await page.locator("#status-text").textContent(),/SVG files were ignored/);

  // Late-file invalid input must leave all masks and history untouched; no fetch.
  const bad=path.join(output,"unsafe.zip");
  const unsafeEntries=exportedEntries.filter(e=>e.name.endsWith(".svg")).map(e=>({name:e.name,blob:new Blob([e.name==="mask0004.svg" ? '<svg width="6" height="5"><image href="https://example.invalid/secret"/></svg>' : e.bytes])}));
  await writeFile(bad,new Uint8Array(await (await createZip(unsafeEntries)).arrayBuffer()));
  const histories=await page.evaluate(()=>svgTest.state.images.map(i=>i.undo.length));
  await importZip(bad);assert.match(alerts.pop(),/unsupported element/);assert.deepEqual(await masks(),expected);
  assert.deepEqual(await page.evaluate(()=>svgTest.state.images.map(i=>i.undo.length)),histories);
  assert.deepEqual(errors,[]);assert.deepEqual(alerts,[]);assert.deepEqual(outside,[]);
  await page.screenshot({path:path.join(output,"migration-complete.png")});
  const report={passed:true,checks:["MR DICOM IPP order versus old filename reverse", "Local-generated legacy SVG Obj 1/2", "ordinary drawing / cleanup / undo / redo", "NIfTI source affine and labels", "Training ZIP source intensities/affine/Obj IDs/canonical order", "TrainRef3D case acceptance", "PNG and Project ZIP restore", "SVG download/roundtrip/review/cancel", "Merge and Replace", "late unsafe SVG atomic rejection / no external requests"],sourceShape:source.shape,affine:source.affine};
  await writeFile(path.join(output,"browser-report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
