// Real demo controls; state inspection is injected only by this local test server.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseZip, createZip } from '../zip.mjs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readNiftiTrainingVolume, createNiftiScalarVolume } from '../training-export.mjs';

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const mime = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer(async (request, response) => {
  try {
    const urlPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const filename = path.resolve(root, `.${urlPath.endsWith("/") ? `${urlPath}index.html` : urlPath}`);
    const relative = path.relative(root, filename);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Outside test root");
    let body = await readFile(filename);
    if (urlPath === "/lite-web/app.mjs") body = `${body}\nglobalThis.demoTest = { state, render, statisticsForCurrentVolume };\n`;
    response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "msedge" });
try {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage();
  const errors = [], alerts = [], results = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", async dialog => { if (dialog.type() === "alert") alerts.push(dialog.message()); await dialog.accept(); });
  await context.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(`${origin}/lite-web/`);
  await page.waitForFunction(() => !!globalThis.demoTest);
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
    await page.reload();
    await page.waitForFunction(() => !!globalThis.demoTest);
    const layout = await page.locator('.demo-grid .demo-button').evaluateAll(buttons => buttons.map(button => {
      const r = button.getBoundingClientRect();
      return { width: r.width, height: r.height, x: r.x, y: r.y, icon: !!button.querySelector('svg'), name: button.querySelector('b').textContent };
    }));
    assert.equal(layout.length, 5);
    assert.deepEqual(layout.map(b => b.name), ['Load Apple Demo', 'Load Rabbit CT Demo', 'Load Electron Microscopy Demo', 'Load Mouse Brain Demo', 'Load Pancreas CT Demo']);
    assert.ok(layout.every(b => b.icon && Math.abs(b.width - layout[0].width) < 1 && Math.abs(b.height - layout[0].height) < 1));
    if (width > 600) { assert.equal(layout[0].y, layout[1].y); assert.equal(layout[2].y, layout[3].y); }
    else { assert.ok(layout.every(b => b.x === layout[0].x)); }
    assert.ok(await page.locator('.demo-intro a').count() >= 7);
    assert.equal(await page.locator('.empty-actions button').count(), 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, `welcome-${width}.png`) });
  }
  await page.setViewportSize({ width: 1600, height: 1100 });
  // Exercise each new welcome card, independently of the Open menu controls.
  for (const [selector, id, count] of [
    ['#load-demo', 'apple-kanzi-84', 20],
    ['#load-rabbit-demo', 'rabbitct-reference-256', 256],
    ['.demo-grid [data-demo-id="hela-em-demo"]', 'hela-em-demo', 150],
    ['.demo-grid [data-demo-id="mouse-brain-demo"]', 'mouse-brain-demo', 132],
    ['.demo-grid [data-demo-id="pancreas-ct-demo"]', 'pancreas-ct-demo', 181],
  ]) {
    const welcomeContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1600, height: 1100 } });
    await welcomeContext.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const welcome = await welcomeContext.newPage();
    welcome.on('pageerror', error => errors.push(error.message));
    welcome.on('dialog', async dialog => { if (dialog.type() === 'alert') alerts.push(dialog.message()); await dialog.accept(); });
    await welcome.goto(`${origin}/lite-web/`);
    await welcome.waitForFunction(() => !!globalThis.demoTest);
    await welcome.locator(selector).click();
    await welcome.waitForFunction(id => demoTest.state.activeDemoDatasetId === id && !demoTest.state.loading, id, { timeout: 120000 });
    assert.equal(await welcome.evaluate(() => demoTest.state.images.length), count);
    await welcomeContext.close();
  }
  for (const [id, button, count] of [
    ["apple-kanzi-84", "open-apple-demo", 20],
    ["hela-em-demo", "open-hela-em-demo", 150],
    ["mouse-brain-demo", "open-mouse-brain-demo", 132],
    ["pancreas-ct-demo", "open-pancreas-ct-demo", 181],
    ["rabbitct-reference-256", "open-rabbit-demo", 256],
    ["hela-em-demo", "open-hela-em-demo", 150],
    ["apple-kanzi-84", "open-apple-demo", 20],
  ]) {
    await page.locator("#open-menu summary").click();
    await page.locator(`#${button}`).click();
    await page.waitForFunction(id => demoTest.state.activeDemoDatasetId === id && !demoTest.state.loading, id, { timeout: 120000 });
    const actual = await page.evaluate(() => ({
      id: demoTest.state.activeDemoDatasetId,
      count: demoTest.state.images.length,
      masked: demoTest.state.images.some(image => image.mask.some(value => value !== 0)),
      display: demoTest.state.displaySettings,
      defaults: demoTest.state.displayDefaults,
    }));
    assert.equal(actual.count, count);
    assert.equal(actual.masked, false, "unsaved masks from the previous dataset must not leak");
    assert.deepEqual(actual.display, actual.defaults);
    await page.screenshot({ path: path.join(output, `${results.length}-${id}.png`) });
    results.push(actual);
    const physical = await page.evaluate(() => ({ ...demoTest.state.physicalSpacing }));
    if (id === "hela-em-demo") {
      assert.equal(physical.xy, "metadata");
      assert.equal(physical.z, "metadata");
      await page.locator('[data-tool-tab="calibration"]').click();
      assert.equal(await page.locator('#spatial-information-value').textContent(), '39.06 × 39.06 × 100 nm');
      await page.evaluate(() => { demoTest.state.images[0].mask.fill(1,0,10000); demoTest.render(); });
      await page.locator('[data-tool-tab="volume"]').click();
      await page.waitForFunction(() => document.querySelector('#volume-statistics-unit').textContent === 'µm³');
      const stats = await page.evaluate(() => demoTest.statisticsForCurrentVolume());
      assert.equal(stats.rows[0].volumeMm3, 10000*0.0000390625*0.0000390625*0.0001);
      assert.match(await page.locator('#volume-statistics-rows').textContent(), /1.5259/);
      await page.screenshot({path:path.join(output,`hela-volume-${results.length}.png`)});
    } else if (id === "mouse-brain-demo") {
      assert.equal(physical.xy, 'unknown'); assert.equal(physical.z, 'estimated');
      assert.equal(await page.evaluate(() => demoTest.state.index),54);
      assert.equal(await page.locator('#demo-calibration-title').textContent(),'Mouse Brain Calibration');
      assert.equal(await page.locator('#demo-reference-value').textContent(),'11.4 mm (approx.)');
      assert.match(await page.locator('#spatial-information-value').textContent(), /Unknown.*100 µm.*estimated/);
      assert.equal(await page.locator('#spacing-x').inputValue(),'');
      assert.equal(await page.locator('#spacing-z').getAttribute('readonly'),'');
      await page.evaluate(() => { demoTest.state.images[54].mask.fill(1,0,10000); demoTest.render(); });
      await page.locator('[data-tool-tab="volume"]').click();
      await page.waitForFunction(() => document.querySelector('#volume-statistics-calibration').textContent === 'Volume calibration required');
      assert.equal(await page.evaluate(() => demoTest.statisticsForCurrentVolume().rows[0].volumeMm3),null);
      assert.match(await page.locator('#volume-statistics-rows').textContent(),/—/);
      await page.screenshot({path:path.join(output,'mouse-before-calibration.png')});
      const projectDownload = page.waitForEvent('download');
      await page.locator('#export-menu summary').click();
      await page.locator('#export-project').click();
      const project = await projectDownload;
      const projectPath = path.join(output,'uncalibrated-mouse-project.zip');
      await project.saveAs(projectPath);
      await page.evaluate(() => { demoTest.state.physicalSpacing = {xy:'manual',z:'manual'}; });
      await page.locator('#mask-zip-input').setInputFiles(projectPath);
      await page.waitForFunction(() => demoTest.state.physicalSpacing.xy === 'unknown');
      assert.equal(await page.evaluate(() => demoTest.statisticsForCurrentVolume().rows[0].volumeMm3),null);

      await page.locator('[data-tool-tab="calibration"]').click();
      await page.locator('#draw-calibration').click();
      const points = await page.evaluate(() => {
        const r=document.querySelector('canvas').getBoundingClientRect(), v=demoTest.state.viewport;
        return [35,650].map(x => ({x:r.x+v.panX+x*v.zoom,y:r.y+v.panY+250*v.zoom}));
      });
      for (const point of points) await page.mouse.click(point.x,point.y);
      await page.waitForFunction(() => demoTest.state.physicalSpacing.xy === 'user-calibrated');
      const after = await page.evaluate(() => ({calibration:demoTest.state.calibration,line:demoTest.state.images[54].calibrationLine,stats:demoTest.statisticsForCurrentVolume()}));
      const pixelLength = Math.hypot(after.line[1].x-after.line[0].x, after.line[1].y-after.line[0].y);
      assert.ok(Math.abs(pixelLength-615)<2);
      assert.equal(after.calibration.xSpacing,11.4/pixelLength);
      assert.equal(after.calibration.ySpacing,after.calibration.xSpacing);
      assert.equal(after.calibration.zSpacing,0.1);
      assert.match(await page.locator('#project-details').textContent(), /calibrated from 11\.4 mm reference/);
      assert.doesNotMatch(await page.locator('#project-details').textContent(), /calibration required/);
      assert.equal(after.stats.rows[0].volumeMm3,10000*(after.calibration.xSpacing*after.calibration.ySpacing*0.1));
      assert.equal(await page.locator('#demo-next-step').isVisible(),true);
      await page.locator('[data-tool-tab="volume"]').click();
      await page.waitForFunction(() => document.querySelector('#volume-statistics-unit').textContent === 'mm³');
      await page.waitForFunction(() => document.querySelector('#volume-statistics-calibration').textContent.includes('estimated'));
      assert.match(await page.locator('#volume-statistics-calibration').textContent(),/estimated/);
      await page.screenshot({path:path.join(output,'mouse-after-calibration.png')});
    } else if (id === 'pancreas-ct-demo') {
      assert.equal(physical.xy,'metadata'); assert.equal(physical.z,'metadata');
      const ct = await page.evaluate(() => ({index:demoTest.state.index,
        formats:[...new Set(demoTest.state.images.map(i=>i.sourceFormat))],
        shape:demoTest.state.sourceVolume.shape, kind:demoTest.state.sourceVolume.sourceKind,
        spacing:demoTest.state.sourceVolume.spacing, sha256:demoTest.state.sourceVolume.sha256}));
      assert.equal(ct.index,90); assert.deepEqual(ct.formats,['dicom']);
      assert.equal(ct.kind,'dicom'); assert.deepEqual(ct.shape,[512,512,181]);
      assert.deepEqual(ct.spacing,[0.9765625,0.9765625,1]);
      const orientation = await page.evaluate(() => ({
        affine: demoTest.state.sourceVolume.affine,
        z: demoTest.state.images.map(i=>i.dicom.imagePositionPatient[2]),
      }));
      assert.ok(orientation.affine[0][0]<0 && orientation.affine[1][1]<0 && orientation.affine[2][2]>0);
      assert.deepEqual(orientation.z,Array.from({length:181},(_,i)=>i-180));
      assert.deepEqual(actual.display,{windowCenter:40,windowWidth:400,brightness:0,contrast:1});
      await page.locator('#next-image').click();
      assert.equal(await page.locator('#slice-number').inputValue(),'92');
      await page.locator('#previous-image').click();
      await page.locator('[data-tool-tab="display"]').click();
      const before = await page.locator('#editor-canvas').screenshot();
      await page.locator('#window-center').fill('80'); await page.locator('#window-center').dispatchEvent('input');
      assert.notDeepEqual(await page.locator('#editor-canvas').screenshot(),before);
      await page.locator('[data-tool-tab="ai"]').click();
      await page.locator('#instant3d-available').selectOption('total/pancreas');
      await page.locator('#instant3d-object-id').selectOption('3');
      await page.locator('#instant3d-add').click();
      assert.equal(await page.locator('#instant3d-modality').inputValue(),'CT');
      assert.equal(await page.locator('#instant3d-export').isEnabled(),true);
      await page.screenshot({path:path.join(output,'pancreas-ct-catalog.png')});
      await page.locator('#instant3d-export').click();
      const pending=page.waitForEvent('download',{timeout:120000});
      await page.locator('#instant3d-warning-continue').click();
      const result=await pending; const resultPath=path.join(output,'pancreas-request.zip');
      await result.saveAs(resultPath);
      const entries=await parseZip(new Blob([await readFile(resultPath)]));
      const manifest=JSON.parse(new TextDecoder().decode(entries.find(e=>e.name==='manifest.json').bytes));
      assert.equal(manifest.source.sha256,ct.sha256);
      const sourceEntry=entries.find(e=>e.name.startsWith('image/'));
      assert.ok(sourceEntry, 'request ZIP contains the source volume');
      assert.equal(createHash('sha256').update(sourceEntry.bytes).digest('hex'),ct.sha256);
      const source = readNiftiTrainingVolume(sourceEntry.bytes);
      assert.deepEqual(source.geometry.affine,orientation.affine);
      const labels = new Uint8Array(512*512*181);
      labels[17*512*512+37*512+21]=3;
      const resultManifest = {
        schema:manifest.schema, schema_version:manifest.schema_version,
        request_id:manifest.request_id, status:'success', source:manifest.source,
        objects:manifest.objects, result:{labelmap:'labelmap/labels.nii.gz',label_png:[]},
        software:{segct_mri:'browser-fixture',totalsegmentator:'synthetic-inference'},warnings:[],overlaps:[],
      };
      const imported = await createZip([
        {name:'manifest.json',blob:new Blob([JSON.stringify(resultManifest)])},
        {name:'labelmap/labels.nii.gz',blob:new Blob([gzipSync(createNiftiScalarVolume({
          values:labels,width:512,height:512,depth:181,geometry:source.geometry,
        }))])},
      ]);
      const importPath=path.join(output,'pancreas-result.zip');
      await writeFile(importPath,new Uint8Array(await imported.arrayBuffer()));
      await page.locator('#instant3d-result-input').setInputFiles(importPath);
      await page.waitForFunction(()=>demoTest.state.images[17].mask[37*512+21]===3);
      assert.equal(await page.evaluate(()=>demoTest.state.images.reduce((n,i)=>
        n+i.mask.reduce((sum,v)=>sum+(v===3),0),0)),1);
    } else if (id === 'apple-kanzi-84') {
      assert.equal(physical.xy,'unknown');
      assert.equal(await page.evaluate(() => demoTest.state.calibration.referenceLength),100);
      assert.equal(await page.evaluate(() => demoTest.state.calibration.zSpacing),4);
    } else {
      assert.equal(physical.xy,'metadata'); assert.equal(physical.z,'metadata');
      assert.equal(await page.evaluate(() => demoTest.state.calibration.zSpacing),1);
    }
    // Seed unsaved edits and display settings to exercise reset on the next real load.
    await page.evaluate(() => {
      demoTest.state.images[0].mask[0] = 7;
      demoTest.state.displaySettings = { windowCenter: 70, windowWidth: 90, brightness: 30, contrast: 1.7 };
      demoTest.render();
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(alerts, []);
  await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
