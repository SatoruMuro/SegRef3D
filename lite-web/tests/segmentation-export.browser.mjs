// Real Chromium integration: fixture generation and invocation are documented in
// SegRef3D/docs/SEGMENTATION_JOB_DICOM.md. No test hooks ship in the application.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseZip } from "../zip.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const mime = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm" };
const server = createServer(async (request, response) => {
  try {
    const urlPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const filename = path.resolve(root, `.${urlPath.endsWith("/") ? `${urlPath}index.html` : urlPath}`);
    const relative = path.relative(root, filename);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Outside test root");
    let body = await readFile(filename);
    if (urlPath === "/lite-web/app.mjs") {
      if (process.env.SEGJOB_APP_SOURCE) body = await readFile(process.env.SEGJOB_APP_SOURCE);
      body = `${body}\nglobalThis.segjobTest = { state, workingImageJpegBlob, ensureDisplayImage, render };\n`;
    }
    response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404); response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const results = [];
try {
  for (const kind of ["dicom", "dicom-mono1", "png", "jpg", "tiff"]) {
    const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block", viewport: { width: 1600, height: 1100 } });
    const page = await context.newPage();
    const alerts = [], errors = [], outsideRequests = [];
    page.on("dialog", async (dialog) => { if (dialog.type() === "alert") alerts.push(dialog.message()); await dialog.accept(); });
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", (route) => {
      if (route.request().url().startsWith(origin)) return route.continue();
      outsideRequests.push(route.request().url()); return route.abort();
    });
    await page.goto(`${origin}/lite-web/`);
    await page.waitForFunction(() => !!globalThis.segjobTest);
    await page.locator("#folder-input").setInputFiles(path.join(fixtures, kind));
    await page.waitForFunction(() => segjobTest.state.images.length === 15 && !segjobTest.state.loading);
    assert.deepEqual(alerts, []);
    const before = await page.evaluate(() => ({
      baseIsNull: segjobTest.state.images.every((image) => image.basePixels === null),
      staleSlices: segjobTest.state.images.filter((image) => image.displayVersion !== segjobTest.state.displayVersion).length,
      firstScalar: segjobTest.state.images[0].modalityPixels?.[0],
    }));
    if (kind.startsWith("dicom")) {
      assert.equal(before.baseIsNull, true);
      assert.ok(before.staleSlices > 0, "unvisited slices must exercise display refresh");
      assert.equal(before.firstScalar, -2024, "signed pixels and rescale must survive decoding");
    }
    // Use real workflow controls and pointer events to create a box on frame 1.
    await page.locator('[data-tool-tab="ai"]').click();
    await page.locator("#segonweb-jobs").click();
    await page.locator("#segonweb-tracking-start").fill("1");
    await page.locator("#segonweb-tracking-end").fill("15");
    await page.locator("#segonweb-set-box").click();
    const points = await page.evaluate(() => {
      const rect = document.querySelector("#editor-canvas").getBoundingClientRect();
      const { zoom, panX, panY } = segjobTest.state.viewport;
      return [[40, 50], [280, 300]].map(([x, y]) => ({ x: rect.left + panX + x * zoom, y: rect.top + panY + y * zoom }));
    });
    for (const point of points) await page.mouse.click(point.x, point.y);
    await page.locator("#segonweb-save-object").click();
    await page.locator("#segonweb-jobs-close").click();
    await page.locator('[data-tool-tab="ai"]').click();
    const requestCount = outsideRequests.length;
    for (const adjusted of [false, true]) {
      if (adjusted) {
        await page.evaluate(() => {
          Object.assign(segjobTest.state.displaySettings, { windowCenter: 50, windowWidth: 900, brightness: 15, contrast: 1.2 });
          segjobTest.state.displayVersion += 1;
          segjobTest.render();
        });
      }
      if (process.env.SEGJOB_APP_SOURCE) {
        await page.locator("#export-segonweb").click();
        await page.waitForFunction(() => !segjobTest.state.loading);
        assert.ok(alerts.some((text) => text.includes("Cannot convert undefined or null to object")), alerts.join("\n"));
        console.log("Baseline reproduced:", alerts.at(-1));
        break;
      }
      const downloaded = page.waitForEvent("download", { predicate: (download) => download.suggestedFilename().endsWith("_segonweb_input.zip") });
      await page.locator("#export-segonweb").click();
      const filename = path.join(output, `${kind}${adjusted ? "-adjusted" : ""}.zip`);
      await (await downloaded).saveAs(filename);
      await page.waitForFunction(() => !segjobTest.state.loading);
      const entries = await parseZip(new Blob([await readFile(filename)]));
      const manifest = JSON.parse(await entries.find((entry) => entry.name === "manifest.json").blob.text());
      assert.equal(manifest.format_version, "segref3d-segjob-1.0");
      assert.deepEqual([manifest.images.count, manifest.images.width, manifest.images.height], [15, 400, 400]);
      assert.equal(entries.filter((entry) => entry.name.startsWith("images/")).length, 15);
      const obj = manifest.objects[0];
      assert.deepEqual([obj.tracking_start, obj.tracking_end, obj.prompt_frame], [0, 14, 0]);
      obj.box.forEach((coordinate, index) => assert.ok(Math.abs(coordinate - [40, 50, 280, 300][index]) < 0.5));
      // Exact encoded-byte comparison with the image-only viewer canvas, plus
      // independent pure renderer comparison and actual browser JPEG decoding.
      const checks = await page.evaluate(async () => {
        const { modalityToRgba, adjustedRgba } = await import("./image-tools.mjs?v=26");
        const checks = [];
        for (const image of segjobTest.state.images) {
          const { width, height } = image;
          const expected = image.modalityPixels
            ? modalityToRgba(image.modalityPixels, { ...segjobTest.state.displaySettings, photometricInterpretation: image.dicom.photometricInterpretation })
            : adjustedRgba(image.basePixels, segjobTest.state.displaySettings);
          const actual = image.sourceCanvas.getContext("2d").getImageData(0, 0, width, height).data;
          if (!actual.every((value, index) => value === expected[index])) throw new Error(`Display mismatch: ${image.name}`);
          const blob = await new Promise((resolve) => image.sourceCanvas.toBlob(resolve, "image/jpeg", 0.95));
          const bitmap = await createImageBitmap(blob);
          if (bitmap.width !== width || bitmap.height !== height) throw new Error(`JPEG dimensions mismatch: ${image.name}`);
          const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0); bitmap.close();
          const jpg = ctx.getImageData(0, 0, width, height).data;
          let total = 0;
          for (let i = 0; i < actual.length; i += 4) for (let c = 0; c < 3; c++) total += Math.abs(jpg[i + c] - actual[i + c]);
          checks.push({ bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), meanError: total / (width * height * 3), width: canvas.width, height: canvas.height });
        }
        return checks;
      });
      for (const [index, record] of manifest.images.files.entries()) {
        assert.deepEqual(new Uint8Array(await entries.find((entry) => entry.name === record.archive_path).blob.arrayBuffer()), new Uint8Array(checks[index].bytes));
        assert.ok(checks[index].meanError < 2, `JPEG/display error ${checks[index].meanError}`);
      }
      assert.equal(outsideRequests.length, requestCount, "export must not contact external servers");
      assert.deepEqual(alerts, []); assert.deepEqual(errors, []);
      const result = { kind, adjusted, count: 15, width: 400, height: 400, range: [0, 14], promptFrame: obj.prompt_frame, box: obj.box, maxMeanJpegError: Math.max(...checks.map((check) => check.meanError)) };
      results.push(result); console.log(JSON.stringify(result));
    }
    if (!process.env.SEGJOB_APP_SOURCE) {
      const message = await page.evaluate(async () => {
        try { await segjobTest.workingImageJpegBlob({ name: "missing.dcm", width: 400, height: 400 }); }
        catch (error) { return error.message; }
      });
      assert.match(message, /missing\.dcm.*display image data is missing/);
      const encodingError = await page.evaluate(async () => {
        const image = { ...segjobTest.state.images[0], sourceCanvas: { toBlob(callback) { callback(null); } } };
        try { await segjobTest.workingImageJpegBlob(image); }
        catch (error) { return { message: error.message, cause: error.cause.message }; }
      });
      assert.match(encodingError.message, /Cannot encode .* as a working JPG/);
      assert.equal(encodingError.cause, "Image encoding failed.");
    }
    await context.close();
    if (process.env.SEGJOB_APP_SOURCE) break;
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
