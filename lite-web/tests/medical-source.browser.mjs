// Generate fixtures with SegRef3D/tests/medical_source_fixtures.py first.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { parseZip, createZip } from "../zip.mjs";
import { readNiftiTrainingVolume, createNiftiScalarVolume } from "../training-export.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const mime = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm" };
const server = createServer(async (request, response) => {
  try {
    const urlPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const filename = path.resolve(root, `.${urlPath.endsWith("/") ? `${urlPath}index.html` : urlPath}`);
    if (path.relative(root, filename).startsWith("..")) throw new Error("Outside test root");
    let body = await readFile(filename);
    if (urlPath === "/lite-web/app.mjs") body = `${body}\nglobalThis.medicalTest = { state };\n`;
    response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "msedge" });
const results = [];
try {
  for (const format of ["dicom", "nifti"]) for (const modality of ["CT", "MR"]) {
    const context = await browser.newContext({acceptDownloads:true, serviceWorkers:"block", viewport:{width:1600,height:1100}});
    const page = await context.newPage();
    const errors = [], alerts = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", async (dialog) => {if (dialog.type() === "alert") alerts.push(dialog.message()); await dialog.accept();});
    await context.route("**/*", (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(`${origin}/lite-web/`);
    await page.waitForFunction(() => !!globalThis.medicalTest);
    await page.locator(format === "dicom" ? "#folder-input" : "#volume-input")
      .setInputFiles(path.join(fixtures, format === "dicom" ? modality : `${modality}.nii`));
    await page.waitForFunction(() => medicalTest.state.sourceVolume && !medicalTest.state.loading);
    await page.locator('[data-tool-tab="ai"]').click();
    const expected = modality === "MR" ? "MRI" : "CT";
    if (format === "nifti") await page.locator("#instant3d-modality").selectOption(expected);
    assert.equal(await page.locator("#instant3d-modality").inputValue(), expected);
    assert.equal(await page.locator("#instant3d-modality").isDisabled(), format === "dicom");
    const task = modality === "MR" ? "total_mr" : "total";
    await page.locator("#instant3d-available").selectOption(`${task}/liver`);
    await page.locator("#instant3d-object-id").selectOption("3");
    await page.locator("#instant3d-add").click();
    assert.equal(await page.locator("#instant3d-export").isEnabled(), true);
    await page.screenshot({path:path.join(output, `${format}-${modality}.png`)});
    await page.locator("#instant3d-export").click();
    const downloaded = page.waitForEvent("download");
    await page.locator("#instant3d-warning-continue").click();
    const download = await downloaded;
    assert.match(download.suggestedFilename(), /_segct_mri_request\.zip$/);
    const requestPath = path.join(output, `${format}-${modality}-request.zip`);
    await download.saveAs(requestPath);
    const entries = await parseZip(new Blob([await readFile(requestPath)]));
    const manifest = JSON.parse(new TextDecoder().decode(entries.find(e=>e.name==='manifest.json').bytes));
    assert.doesNotMatch(JSON.stringify(manifest), /instant3d|segonweb/i);
    assert.ok(entries.every(e => !/instant3d|segonweb/i.test(e.name)));
    const source = readNiftiTrainingVolume(entries.find(e=>e.name.startsWith('image/')).bytes);
    assert.equal(manifest.source.modality, expected);
    assert.equal(manifest.objects[0].task, task);
    assert.deepEqual(source.shape, [6,5,4]);
    assert.equal(source.values[0], -1064);
    assert.equal(source.values[3*30+4*6+5], (29+300-20)*5-1024);
    const labels = new Uint8Array(120); labels[2*30+1*6+4] = labels[3*6+1] = 3;
    const result = await createZip([
      {name:'manifest.json', blob:new Blob([JSON.stringify({...manifest,status:'success'})])},
      {name:'labelmap/labels.nii.gz', blob:new Blob([gzipSync(createNiftiScalarVolume({values:labels,width:6,height:5,depth:4,geometry:source.geometry}))])},
    ]);
    const resultPath = path.join(output, `${format}-${modality}-result.zip`);
    await writeFile(resultPath, new Uint8Array(await result.arrayBuffer()));
    await page.locator('#instant3d-result-input').setInputFiles(resultPath);
    await page.waitForFunction(() => medicalTest.state.images[2].mask[10] === 3);
    const masks = await page.evaluate(() => medicalTest.state.images.flatMap(i=>[...i.mask]));
    assert.deepEqual(masks, [...labels]);
    // Existing Project ZIP restores masks onto the loaded original medical source.
    const projectDownload = page.waitForEvent('download');
    await page.locator('#export-menu summary').click();
    await page.locator('#export-project').click();
    const project = await projectDownload;
    const projectPath = path.join(output, `${format}-${modality}-project.zip`);
    await project.saveAs(projectPath);
    await page.evaluate(() => medicalTest.state.images.forEach(i=>i.mask.fill(0)));
    await page.locator('#mask-zip-input').setInputFiles(projectPath);
    await page.waitForFunction(() => medicalTest.state.images[2].mask[10] === 3);
    assert.deepEqual(await page.evaluate(() => medicalTest.state.images.flatMap(i=>[...i.mask])), [...labels]);
    assert.equal(await page.evaluate(() => medicalTest.state.sourceVolume.modality), expected);
    assert.deepEqual(errors, []); assert.deepEqual(alerts, []);
    results.push({format,modality:expected,structures:await page.locator('#instant3d-available option').count(),export:true,import:true,project:true});
    await context.close();
  }
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
