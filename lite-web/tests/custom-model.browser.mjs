// Real browser regression; state inspection is injected by the test server only.
// node lite-web/tests/custom-model.browser.mjs [build/custom-model-qa]
// Optional PLAYWRIGHT_MODULE (absolute index.mjs), BROWSER_CHANNEL=msedge.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { geometry, modelManifest, modelZip, scalarChannels, validatedModel, resultZip } from "./custom-model-fixtures.mjs";
import { createNiftiScalarVolume } from "../training-export.mjs";
import { sha256Hex } from "../custom-model.mjs";
import { parseZip } from "../zip.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.resolve(process.argv[2] || "build/custom-model-qa");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const mime = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer(async (request, response) => {
  try {
    const urlPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const filename = path.resolve(root, `.${urlPath.endsWith("/") ? `${urlPath}index.html` : urlPath}`);
    const relative = path.relative(root, filename);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Outside test root");
    let body = await readFile(filename);
    if (urlPath === "/lite-web/app.mjs") body = `${body}\nglobalThis.customModelTest = { state, updateCustomModelControls, selectTargetLabel };\n`;
    response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block", viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors = [], alerts = [], results = [];
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", async dialog => { if (dialog.type() === "alert") alerts.push(dialog.message()); await dialog.accept(); });
await context.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());

const sourceBytes = createNiftiScalarVolume({ ...scalarChannels()[0], width: 4, height: 3, depth: 2, geometry: geometry() });
const channelSha256 = [await sha256Hex(sourceBytes)];
const model = await validatedModel();
async function saveBlob(name, blob) { const file = path.join(output, name); await writeFile(file, new Uint8Array(await blob.arrayBuffer())); return file; }
const sourcePath = path.join(output, "source.nii");
await writeFile(sourcePath, sourceBytes);
const resultPath = await saveBlob("result.zip", await resultZip({ model, channelSha256 }));
const modelPath = await saveBlob("model.zip", model.blob);
const otherManifest = modelManifest();
otherManifest.model_id = "TR3DM_deadbeef";
otherManifest.task = { ...otherManifest.task, target_label_id: 2, target_name: "Other target" };
const otherModelPath = await saveBlob("other-model.zip", await modelZip(otherManifest));
const masks = () => page.evaluate(() => customModelTest.state.images.map(image => [...image.mask]));
const dialogOpen = () => page.locator("#custom-model-conflict-dialog").evaluate(el => el.open);
async function importResult(file = resultPath) {
  await page.locator("#custom-model-result-input").setInputFiles(file);
  await page.waitForFunction(() => !customModelTest.state.loading);
}
async function resetMasks(existing = false, customName = false) {
  await page.evaluate(({ existing, customName }) => {
    const { state, selectTargetLabel } = customModelTest;
    for (const image of state.images) image.mask.fill(0);
    // Predictions occupy indices 0, 5, 10, 15, 20. Protect Obj 3 at index 0.
    state.images[0].mask[0] = 3;
    if (existing) state.images[0].mask[1] = 5;
    state.objectNames[5] = customName ? "User custom name" : "Object 5";
    selectTargetLabel(2);
  }, { existing, customName });
}
async function acceptAndUndo(button, expected, name) {
  const before = await masks();
  await page.locator(button).click();
  await page.waitForFunction(() => customModelTest.state.customModelPendingImport === null);
  assert.deepEqual((await masks()).flat(), expected);
  assert.equal(await page.evaluate(() => customModelTest.state.targetLabel), 5);
  assert.match(await page.locator("#status-text").textContent(), /1 overlapping voxels were skipped/);
  await page.locator("#undo-action").click();
  await page.waitForFunction(() => document.querySelector("#status-text").textContent.startsWith("Undid:"));
  assert.deepEqual(await masks(), before);
  results.push(name);
}
const expected = Array.from({ length: 24 }, (_, i) => i === 0 ? 3 : i % 5 === 0 ? 5 : 0);
try {
  await page.goto(`${origin}/lite-web/`);
  await page.waitForFunction(() => !!globalThis.customModelTest);
  assert.equal(await page.locator("#custom-model-import").isDisabled(), true);
  results.push("B: no source disables import");
  await page.locator("#volume-input").setInputFiles(sourcePath);
  await page.waitForFunction(() => customModelTest.state.images.length === 2 && !customModelTest.state.loading);
  await page.locator('[data-tool-tab="ai"]').click();
  assert.equal(await page.locator("#custom-model-import").isEnabled(), true);
  assert.equal(await page.locator("#custom-model-export").isDisabled(), true);
  await page.evaluate(() => { customModelTest.state.loading = true; customModelTest.updateCustomModelControls(); });
  assert.equal(await page.locator("#custom-model-import").isDisabled(), true);
  await page.evaluate(() => { customModelTest.state.loading = false; customModelTest.updateCustomModelControls(); });
  results.push("A: source without model enables import; loading disables it; request stays disabled");

  await resetMasks();
  await importResult();
  assert.equal(await dialogOpen(), true);
  assert.equal(await page.locator("#custom-model-conflict-merge").isVisible(), false);
  const summary = await page.locator("#custom-model-provenance").textContent();
  for (const text of ["Obj 5 — Tumor", model.manifest.model_id, "Source: Matched current volume", "Geometry: Matched", "Model ZIP currently loaded: None", "Model ZIP is not required"]) assert.ok(summary.includes(text));
  await page.screenshot({ path: path.join(output, "no-model-confirmation.png") });
  await acceptAndUndo("#custom-model-conflict-replace", expected, "C/I/L: no-model import restores Result Obj 5, protects overlap, one-step Undo");
  assert.equal(await page.evaluate(() => customModelTest.state.objectNames[5]), "Tumor");

  for (const mode of ["merge", "replace"]) {
    await resetMasks(true, true);
    await importResult();
    const wanted = [...expected]; if (mode === "merge") wanted[1] = 5;
    await acceptAndUndo(`#custom-model-conflict-${mode}`, wanted, `L: no-model ${mode}, overlap reporting and Undo`);
    assert.equal(await page.evaluate(() => customModelTest.state.objectNames[5]), "User custom name");
  }

  for (const [name, mutate, message] of [
    ["D-source", m => { m.source.channel_sha256[0] = "f".repeat(64); }, /Source fingerprint/],
    ["E-geometry", m => { m.source.original_geometry.affine[0][3] += 1; }, /geometry mismatch/],
    ["F-hash", m => { m.prediction.sha256 = "f".repeat(64); }, /SHA-256/],
    ["G-target", m => { m.model.target_label_id = 21; }, /target label/],
  ]) {
    const bad = await saveBlob(`${name}.zip`, await resultZip({ model, channelSha256: [...channelSha256], mutate }));
    const before = await masks();
    await importResult(bad);
    assert.match(alerts.pop(), message);
    assert.equal(await dialogOpen(), false);
    assert.deepEqual(await masks(), before);
    results.push(`${name}: hard rejection without model, masks unchanged`);
  }

  await page.locator("#custom-model-file-input").setInputFiles(otherModelPath);
  await page.waitForFunction(() => !customModelTest.state.loading);
  assert.equal(await page.locator("#custom-model-export").isEnabled(), true);
  await resetMasks();
  for (const cancel of ["button", "escape"]) {
    const before = await masks();
    await importResult();
    assert.match(await page.locator("#custom-model-provenance").textContent(), /different TrainRef3D model/);
    await page.screenshot({ path: path.join(output, "model-mismatch-confirmation.png") });
    if (cancel === "button") await page.locator("#custom-model-conflict-cancel").click();
    else await page.keyboard.press("Escape");
    assert.deepEqual(await masks(), before);
    assert.equal(await page.evaluate(() => customModelTest.state.customModelPendingImport), null);
    results.push(`H/J: model mismatch warning and ${cancel} cancellation without mutation`);
  }
  await importResult();
  await acceptAndUndo("#custom-model-conflict-replace", expected, "I: mismatch accepted into Result Obj 5, not selected model/current Obj 2");
  for (const [name, message] of [["D-source", /Source fingerprint/], ["E-geometry", /geometry mismatch/]]) {
    const before = await masks();
    await importResult(path.join(output, `${name}.zip`));
    assert.match(alerts.pop(), message);
    assert.equal(await dialogOpen(), false);
    assert.deepEqual(await masks(), before);
    results.push(`${name}: selected model mismatch cannot override hard rejection`);
  }

  await page.locator("#custom-model-file-input").setInputFiles(modelPath);
  await page.waitForFunction(() => !customModelTest.state.loading);
  await resetMasks();
  await importResult();
  assert.equal(await dialogOpen(), false);
  assert.deepEqual((await masks()).flat(), expected);
  results.push("K: matching model validates and imports silently when target is empty");

  const downloading = page.waitForEvent("download");
  await page.locator("#custom-model-export").click();
  const download = await downloading;
  const requestPath = path.join(output, "request.zip");
  await download.saveAs(requestPath);
  const entries = await parseZip(new Blob([await readFile(requestPath)]));
  const request = JSON.parse(new TextDecoder().decode(entries.find(e => e.name === "request_manifest.json").bytes));
  assert.equal(request.model.model_sha256, model.sha256);
  assert.equal(request.model.target_label_id, 5);
  assert.deepEqual(request.input.channels.map(c => c.sha256), channelSha256);
  results.push("Request export still binds model hash, target and canonical source fingerprints");

  const incompatiblePath = await saveBlob("rgb-model.zip", await modelZip(modelManifest({ sourceCategory: "rgb" })));
  await page.locator("#custom-model-file-input").setInputFiles(incompatiblePath);
  await page.waitForFunction(() => !customModelTest.state.loading);
  assert.equal(await page.locator("#custom-model-export").isDisabled(), true);
  assert.equal(await page.locator("#custom-model-import").isEnabled(), true);
  results.push("Incompatible loaded model still permits prediction import, blocks request");
  assert.deepEqual(errors, []);
  assert.deepEqual(alerts, []);
  await writeFile(path.join(output, "results.json"), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
