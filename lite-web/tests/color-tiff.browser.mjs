// Real browser import/menu/download regression. No hooks ship in the app.
// node lite-web/tests/color-tiff.browser.mjs [build/color-tiff-qa]
// Optional PLAYWRIGHT_MODULE (absolute index.mjs), BROWSER_CHANNEL=msedge.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import UTIF from "../vendor/utif.module.js";
import { createColorTiffStack, createTiffLabelStack, createNiftiLabelVolume } from "../volume-tools.mjs";
import { encodeLabelPng } from "../mask-sequence.mjs";
import { parseZip } from "../zip.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.resolve(process.argv[2] || "build/color-tiff-qa");
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
    if (urlPath === "/lite-web/app.mjs") body = `${body}\nglobalThis.colorTiffTest = { state, render, exportColorTiff };\n`;
    response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const results = [];
const errors = [], alerts = [], outsideRequests = [];
const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block", viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", async dialog => { if (dialog.type() === "alert") alerts.push(dialog.message()); await dialog.accept(); });
await context.route("**/*", route => {
  if (route.request().url().startsWith(origin)) return route.continue();
  outsideRequests.push(route.request().url()); return route.abort();
});
const rgba = [
  [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 128, 0, 0, 0, 0],
  [0, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 20, 40, 60, 255, 255, 0, 0, 128, 0, 0, 0, 0],
  [0, 255, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 60, 40, 20, 255, 0, 255, 0, 128, 0, 0, 0, 0],
];
const masks = [new Uint8Array([1, 0, 2, 0, 3, 0]), new Uint8Array([4, 5, 0, 0, 0, 0]), new Uint8Array([0, 0, 0, 6, 0, 7])];

function decodeTiff(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const pages = UTIF.decode(buffer);
  return pages.map(ifd => {
    UTIF.decodeImage(buffer, ifd, pages);
    return { width: ifd.width, height: ifd.height, rgba: [...UTIF.toRGBA8(ifd)] };
  });
}

async function downloadExport(id, name) {
  if (!await page.locator("#export-menu").evaluate(el => el.open)) await page.locator("#export-menu > summary").click();
  const pending = page.waitForEvent("download");
  await page.locator(id).click();
  const download = await pending;
  const target = path.join(output, name);
  await download.saveAs(target);
  await page.waitForFunction(() => !colorTiffTest.state.loading);
  return { bytes: new Uint8Array(await readFile(target)), filename: download.suggestedFilename() };
}

async function rasterFixture(folder, format, pixels = rgba, width = 2, height = 3) {
  const directory = path.join(output, folder);
  await mkdir(directory, { recursive: true });
  const expected = [];
  // Creation order differs from natural filename order (1, 2, 10).
  for (const index of pixels.map((_, index) => index).reverse()) {
    const data = await page.evaluate(async ({ pixels, format, width, height }) => {
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, `image/${format}`, 1));
      const decoded = await createImageBitmap(blob);
      const original = document.createElement("canvas"); original.width = width; original.height = height;
      original.getContext("2d").drawImage(decoded, 0, 0); decoded.close();
      return { bytes: [...new Uint8Array(await blob.arrayBuffer())], rgba: [...original.getContext("2d").getImageData(0, 0, width, height).data] };
    }, { pixels: pixels[index], format, width, height });
    await writeFile(path.join(directory, `slice${[1, 2, 10][index]}.${format}`), new Uint8Array(data.bytes));
    expected[index] = { width, height, rgba: data.rgba };
  }
  return { directory, expected };
}

async function loadFolder(directory, depth) {
  await page.locator("#folder-input").setInputFiles(directory);
  await page.waitForFunction(depth => colorTiffTest.state.images.length === depth && !colorTiffTest.state.loading, depth);
}

async function decodePng(bytes) {
  return page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    canvas.getContext("2d").drawImage(image, 0, 0); image.close();
    return [...canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data];
  }, [...bytes]);
}

// Minimal synthetic Explicit VR Little Endian monochrome DICOM (no patient data).
function grayDicom() {
  const element = (group, tag, vr, raw) => {
    const value = typeof raw === "number" ? Buffer.from([raw & 255, raw >> 8]) : Buffer.from(raw);
    const size = value.length + value.length % 2;
    const long = vr === "OW";
    const header = Buffer.alloc(long ? 12 : 8);
    header.writeUInt16LE(group); header.writeUInt16LE(tag, 2); header.write(vr, 4);
    if (long) header.writeUInt32LE(size, 8); else header.writeUInt16LE(size, 6);
    const padded = Buffer.alloc(size, vr === "UI" || long ? 0 : 32); value.copy(padded);
    return Buffer.concat([header, padded]);
  };
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"),
    element(2, 0x10, "UI", "1.2.840.10008.1.2.1"),
    element(0x20, 0xe, "UI", "1.2.3.4.5"), element(0x20, 0x13, "IS", "1"),
    element(0x20, 0x32, "DS", "0\\0\\0"), element(0x20, 0x37, "DS", "1\\0\\0\\0\\1\\0"),
    element(0x28, 2, "US", 1), element(0x28, 4, "CS", "MONOCHROME2"),
    element(0x28, 0x10, "US", 3), element(0x28, 0x11, "US", 2),
    element(0x28, 0x30, "DS", "1\\1"), element(0x28, 0x100, "US", 16),
    element(0x28, 0x101, "US", 16), element(0x28, 0x102, "US", 15), element(0x28, 0x103, "US", 0),
    element(0x7fe0, 0x10, "OW", Buffer.from([0, 0, 50, 0, 100, 0, 150, 0, 200, 0, 250, 0])),
  ]);
}

try {
  await page.goto(`${origin}/lite-web/`);
  await page.waitForFunction(() => !!globalThis.colorTiffTest);
  assert.equal(await page.locator("#export-menu-color-tiff").isDisabled(), true);
  for (const format of ["png", "jpeg", "webp"]) {
    const { directory, expected } = await rasterFixture(format, format);
    await loadFolder(directory, 3);
    assert.deepEqual(await page.evaluate(() => colorTiffTest.state.images.map(i => i.name)), [1, 2, 10].map(i => `slice${i}.${format}`));
    const before = await downloadExport("#export-menu-color-tiff", `${format}-color.tiff`);
    assert.match(before.filename, new RegExp(`^${format}_color_.*\\.tiff$`));
    assert.deepEqual(decodeTiff(before.bytes), expected);
    const emptyTiff = await downloadExport("#export-menu-tiff", `${format}-empty-labels.tiff`);
    assert.deepEqual(emptyTiff.bytes, createTiffLabelStack(masks.map(m => new Uint8Array(m.length)), 2, 3));
    if (format === "png") {
      const maskDir = path.join(output, "input-masks"); await mkdir(maskDir, { recursive: true });
      for (const [index, mask] of masks.entries()) await writeFile(path.join(maskDir, `mask${String(index + 1).padStart(4, "0")}.png`), await encodeLabelPng(mask, 2, 3));
      await page.locator("#mask-folder-input").setInputFiles(maskDir);
      await page.waitForFunction(() => !colorTiffTest.state.loading && colorTiffTest.state.images[2].mask[5] === 7);
      await page.evaluate(() => {
        Object.assign(colorTiffTest.state.displaySettings, { brightness: 55, contrast: 1.5, windowCenter: 90, windowWidth: 130 });
        colorTiffTest.state.displayVersion += 1;
        colorTiffTest.render();
      });
      assert.notDeepEqual(await page.evaluate(() => [...colorTiffTest.state.images[0].sourceCanvas.getContext("2d").getImageData(0, 0, 2, 3).data]), expected[0].rgba);
      const after = await downloadExport("#export-menu-color-tiff", "png-masked-adjusted-color.tiff");
      assert.deepEqual(after.bytes, before.bytes, "mask and display settings must not affect a single output byte");
      const legacy = await downloadExport("#export-menu-tiff", "png-labels.tiff");
      assert.deepEqual(legacy.bytes, createTiffLabelStack(masks, 2, 3));
      const labels = await downloadExport("#export-labels", "labels.zip");
      const project = await downloadExport("#export-project", "project.zip");
      for (const exported of [labels, project]) {
        const entries = await parseZip(new Blob([exported.bytes]));
        const pngs = entries.filter(e => e.name.endsWith(".png")).sort((a, b) => a.name.localeCompare(b.name));
        assert.equal(pngs.length, 3);
        for (const [index, entry] of pngs.entries()) assert.deepEqual(await decodePng(entry.bytes), [...masks[index]].flatMap(v => [v, v, v, 255]));
      }
      const overlays = await downloadExport("#export-overlays", "overlays.zip");
      const entries = (await parseZip(new Blob([overlays.bytes]))).filter(e => e.name.endsWith(".png"));
      assert.equal(entries.length, 3);
      assert.notDeepEqual(await decodePng(entries[0].bytes), expected[0].rgba);
      const nifti = await downloadExport("#export-menu-nifti", "labelmap.nii");
      assert.deepEqual([...nifti.bytes.subarray(352)], masks.flatMap(m => [...m]));
      const header = new DataView(nifti.bytes.buffer);
      assert.deepEqual([42, 44, 46].map(offset => header.getInt16(offset, true)), [2, 3, 3]);
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.locator("#export-menu > summary").click();
        await page.locator("#export-menu-color-tiff").scrollIntoViewIfNeeded();
        const box = await page.locator("#export-menu-color-tiff").boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height);
        await page.screenshot({ path: path.join(output, `menu-${viewport.width}.png`) });
        const uiDownload = await downloadExport("#export-menu-color-tiff", `ui-${viewport.width}.tiff`);
        assert.deepEqual(uiDownload.bytes, before.bytes);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    results.push({ format, pages: 3, width: 2, height: 3, exactDecodedPixels: true });
  }
  const gray = await rasterFixture("gray-png", "png", [[0, 0, 0, 255, 31, 31, 31, 255, 90, 90, 90, 255, 128, 128, 128, 255, 200, 200, 200, 255, 255, 255, 255, 255]]);
  await loadFolder(gray.directory, 1);
  assert.deepEqual(decodeTiff((await downloadExport("#export-menu-color-tiff", "gray-color.tiff")).bytes), gray.expected);
  // A true single-channel PNG, in addition to an RGB raster with gray pixels.
  const grayValues = new Uint8Array([0, 31, 90, 128, 200, 255]);
  const singleChannelDir = path.join(output, "single-channel-png");
  await mkdir(singleChannelDir, { recursive: true });
  await writeFile(path.join(singleChannelDir, "gray.png"), await encodeLabelPng(grayValues, 2, 3));
  await loadFolder(singleChannelDir, 1);
  assert.deepEqual(decodeTiff((await downloadExport("#export-menu-color-tiff", "single-channel-color.tiff")).bytes)[0].rgba,
    [...grayValues].flatMap(value => [value, value, value, 255]));

  const rgbTiff = path.join(output, "input-rgb.tiff");
  await writeFile(rgbTiff, await createColorTiffStack(rgba.map(p => new Uint8Array(p)), 2, 3));
  await page.locator("#volume-input").setInputFiles(rgbTiff);
  await page.waitForFunction(() => !colorTiffTest.state.loading && colorTiffTest.state.images.length === 3);
  assert.deepEqual(decodeTiff((await downloadExport("#export-menu-color-tiff", "tiff-color.tiff")).bytes), rgba.map(p => ({ width: 2, height: 3, rgba: p })));

  for (const [filename, bytes] of [["gray.tiff", createTiffLabelStack(masks, 2, 3)], ["gray.nii", createNiftiLabelVolume(masks, 2, 3)]]) {
    const file = path.join(output, filename); await writeFile(file, bytes);
    await page.locator("#volume-input").setInputFiles(file);
    await page.waitForFunction(() => !colorTiffTest.state.loading);
    assert.equal(await page.locator("#export-menu-color-tiff").isDisabled(), true, filename);
    assert.match(await page.locator("#export-menu-color-tiff").getAttribute("title"), /no supported color source/);
  }
  const dicomDir = path.join(output, "dicom"); await mkdir(dicomDir, { recursive: true });
  await writeFile(path.join(dicomDir, "slice1.dcm"), grayDicom());
  await loadFolder(dicomDir, 1);
  assert.equal(await page.locator("#export-menu-color-tiff").isDisabled(), true);
  // Even programmatic calls have a clear error and restore the loading UI.
  await page.evaluate(() => colorTiffTest.exportColorTiff());
  assert.match(alerts.pop(), /no supported color source/);
  assert.equal(await page.locator("#loading-overlay").isVisible(), false);

  // Original dimensions survive the optional >2000px resize prompt.
  const largePixels = Array.from({ length: 2002 * 2 }, (_, i) => i % 2 ? [0, 255, 0, 255] : [255, 0, 0, 255]).flat();
  const large = await rasterFixture("large", "png", [largePixels], 2002, 2);
  await loadFolder(large.directory, 1);
  assert.equal(await page.evaluate(() => colorTiffTest.state.images[0].width), 1000);
  assert.deepEqual(decodeTiff((await downloadExport("#export-menu-color-tiff", "original-size.tiff")).bytes), large.expected);
  // Same working dimensions from padding must never silently export white padding.
  const mixed = await rasterFixture("mixed", "png", [rgba[0]]);
  await writeFile(path.join(mixed.directory, "different.png"), await encodeLabelPng(new Uint8Array(12), 3, 4));
  await loadFolder(mixed.directory, 2);
  assert.equal(await page.locator("#export-menu-color-tiff").isDisabled(), true);
  assert.match(await page.locator("#export-menu-color-tiff").getAttribute("title"), /equal original image dimensions/);
  assert.deepEqual(alerts, []); assert.deepEqual(errors, []); assert.deepEqual(outsideRequests, []);
  results.push({ grayscaleRaster: "gray RGBA", grayscaleTiff: "disabled", nifti: "disabled", dicom: "disabled", rgbTiff: "exact RGBA", resize: "original size", mixedDimensions: "disabled", otherExports: "passed", desktopAndNarrow: "passed", outsideRequests: 0 });
  await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
