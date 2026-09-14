// Run with PLAYWRIGHT_MODULE pointing to playwright/index.mjs when not installed
// locally. BROWSER_CHANNEL=chrome or msedge selects an installed real browser.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkAppleWorkflow } from "./three-preview-workflow.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.resolve(process.argv[2] || "build/preview-qa");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const mime = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const filename = path.resolve(root, `.${decodeURIComponent(url.pathname).replace(/\/$/, "/index.html")}`);
    const relative = path.relative(root, filename);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Outside test root");
    let body = await readFile(filename);
    // Test-only observation: no camera/renderer/debug globals ship in the app.
    if (relative.replaceAll("\\", "/") === "lite-web/three-viewer.mjs") {
      body = String(body).replaceAll("\r\n", "\n").replace("  return {\n    resetCamera,", "  globalThis.previewInternals = { camera, controls, renderer, scene, surfaces, render, transparency };\n  return {\n    resetCamera,");
      body = body.replace("const transparency = createPreviewTransparency(renderer);", "const transparency = new URL(location.href).searchParams.has('fallback') ? null : createPreviewTransparency(renderer);");
    }
    response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" }); response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve) => server.listen(Number(process.env.PORT || 0), "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
if (process.env.SERVE_ONLY) {
  console.log(origin);
} else {
  const browser = await chromium.launch({ headless: process.env.HEADED !== "1", ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const results = { browser: browser.version(), channel: process.env.BROWSER_CHANNEL || "chromium" };
  try {
    // Preserve CSS geometry and mouse distances while limiting pixel work on
    // software-rendered CI. Local installed-browser validation uses native 1x.
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: process.env.CI ? 0.5 : 1, serviceWorkers: "block" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => { errors.push(error.message); console.error(error.message); });
    page.on("console", (msg) => { if (msg.type() === "error" && !msg.text().includes("404")) { errors.push(msg.text()); console.error(msg.text()); } });
    await page.goto(`${origin}/lite-web/tests/three-preview-fixture.html${process.env.OIT_FALLBACK ? "?fallback=1" : ""}`);
    await page.waitForFunction(() => globalThis.previewInternals);
    results.oit = await page.evaluate(() => !!previewInternals.transparency);
    assert.equal(results.oit, !process.env.OIT_FALLBACK);
    results.nested = await page.evaluate(() => {
      const observations = [];
      for (const opacity of [1, 0.5, 0.2, 0.1, 0]) {
        preview.setObjectOpacity(1, opacity);
        let minGreen = Infinity, minRed = Infinity, minInnerContribution = Infinity, maxInnerContribution = 0;
        for (const elevation of [-Math.PI / 2, -0.7, 0, 0.7, Math.PI / 2]) {
          // At a pole azimuth does not change the viewing direction. Keep the
          // full 5-degree sweep at the equator and 30-degree oblique sweeps.
          const steps = Math.abs(elevation) > 1 ? 1 : elevation === 0 ? 72 : 12;
          for (let step = 0; step < steps; step++) {
            const value = sampleView(step * 2 * Math.PI / steps, elevation);
            preview.setObjectVisible(2, false);
            const withoutInner = sampleView(step * 2 * Math.PI / steps, elevation);
            preview.setObjectVisible(2, true);
            const contribution = value.mean[1] - withoutInner.mean[1];
            minInnerContribution = Math.min(minInnerContribution, contribution);
            maxInnerContribution = Math.max(maxInnerContribution, contribution);
            minGreen = Math.min(minGreen, value.green); minRed = Math.min(minRed, value.red);
          }
        }
        observations.push({ opacity, minGreen, minRed, minInnerContribution, maxInnerContribution });
      }
      preview.setObjectVisible(1, false); preview.setObjectOpacity(1, 1);
      const hidden = sampleView(0);
      const material = previewInternals.surfaces.get(1).material;
      const hiddenState = { visible: previewInternals.surfaces.get(1).visible, transparent: material.transparent, depthWrite: material.depthWrite };
      preview.setObjectVisible(1, true); const shown = sampleView(0);
      return { observations, hidden, hiddenState, shown };
    });
    const nested = results.nested;
    console.log("Nested geometry sweep completed.");
    assert.equal(nested.observations[0].minRed, nested.hidden.pixelCount, "opaque shell must fully occlude inner sphere from every direction");
    assert.equal(nested.observations[0].maxInnerContribution, 0);
    for (const row of nested.observations.filter((row) => row.opacity < 1)) assert.ok(row.minInnerContribution > 20, `inner sphere must contribute at every angle at opacity ${row.opacity}: ${row.minInnerContribution}`);
    for (let i = 2; i < nested.observations.length; i++) assert.ok(nested.observations[i].minInnerContribution > nested.observations[i - 1].minInnerContribution, "lower shell opacity should reveal more of the interior");
    assert.equal(nested.hidden.green, nested.hidden.pixelCount);
    assert.deepEqual(nested.hiddenState, { visible: false, transparent: false, depthWrite: true });
    assert.equal(nested.shown.red, nested.shown.pixelCount);
    results.overlap = await page.evaluate(() => {
      makePreview(true); preview.setObjectOpacity(1, 0.5); preview.setObjectOpacity(2, 0.5);
      const before = sampleView(-0.0001), after = sampleView(0.0001);
      return { before, after, sortingJump: Math.max(...before.mean.map((v, i) => Math.abs(v - after.mean[i]))) };
    });
    if (results.oit) assert.ok(results.overlap.sortingJump < 2, "OIT must remove the color jump when transparent object centers swap order");
    if (results.oit) {
      results.orderInvariance = await page.evaluate(() => {
        let maxDifference = 0;
        for (let i = 0; i < 72; i++) {
          const surface = previewInternals.surfaces.get(1);
          surface.renderOrder = -1; const first = sampleView(i * Math.PI / 36, 0.3);
          surface.renderOrder = 1; const last = sampleView(i * Math.PI / 36, 0.3);
          maxDifference = Math.max(maxDifference, ...first.mean.map((v, c) => Math.abs(v - last.mean[c])));
        }
        return maxDifference;
      });
      assert.ok(results.orderInvariance < 1, "swapping transparent draw order must not change the visible surfaces throughout 360 degrees");
    }
    await page.screenshot({ path: path.join(output, "overlap.png") });
    console.log("Overlapping geometry and draw-order checks completed.");
    await page.evaluate(() => { makePreview(); preview.setObjectOpacity(1, 0.2); });
    // Real mouse input, not direct calls to the camera controller.
    const initial = await page.evaluate(() => previewInternals.camera.position.toArray());
    await page.mouse.move(350, 280); await page.mouse.down();
    for (const [x, y] of [[410, 330], [690, 330], [690, 100], [350, 280]]) await page.mouse.move(x, y, { steps: 20 });
    await page.mouse.up();
    const stopped = await page.evaluate(() => previewInternals.camera.position.toArray());
    assert.notDeepEqual(stopped, initial);
    await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(() => previewInternals.camera.position.toArray()), stopped, "no inertia after mouse release");
    const idleFrame = await page.evaluate(() => previewInternals.renderer.info.render.frame);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => previewInternals.renderer.info.render.frame), idleFrame, "idle preview should not spend GPU time on OIT");
    await page.evaluate(() => preview.resetCamera());
    assert.deepEqual(await page.evaluate(() => previewInternals.camera.position.toArray()), initial);
    await page.screenshot({ path: path.join(output, "nested.png") });
    // Resize triggers both projection and render-target updates; equal fractional
    // drags must produce the same orientation at different aspect ratios.
    await page.mouse.move(300, 250); await page.mouse.down(); await page.mouse.move(380, 310, { steps: 10 }); await page.mouse.up();
    const beforeResize = await page.evaluate(() => previewInternals.camera.position.toArray());
    await page.evaluate(() => { preview.resetCamera(); document.querySelector("#preview").style.cssText = "width:1000px;height:400px"; });
    await page.waitForFunction(() => previewInternals.camera.aspect === 2.5);
    await page.mouse.move(300, 250); await page.mouse.down(); await page.mouse.move(400, 290, { steps: 10 }); await page.mouse.up();
    const afterResize = await page.evaluate(() => previewInternals.camera.position.toArray());
    assert.ok(beforeResize.every((v, i) => Math.abs(v - afterResize[i]) < 1e-8));
    assert.ok((await page.evaluate(() => sampleView(0))).green > 0, "OIT should still display the interior after resizing");
    // All mouse bindings run through native browser pointer/keyboard events.
    for (const binding of ["middle", "shift"]) {
      const target = await page.evaluate(() => previewInternals.controls.target.toArray());
      if (binding === "shift") await page.keyboard.down("Shift");
      const button = binding === "middle" ? "middle" : "left";
      await page.mouse.move(400, 200); await page.mouse.down({ button }); await page.mouse.move(430, 220); await page.mouse.up({ button });
      if (binding === "shift") await page.keyboard.up("Shift");
      assert.notDeepEqual(await page.evaluate(() => previewInternals.controls.target.toArray()), target);
    }
    const distance = () => page.evaluate(() => previewInternals.camera.position.distanceTo(previewInternals.controls.target));
    const beforeDolly = await distance();
    await page.mouse.move(400, 200); await page.mouse.down({ button: "right" }); await page.mouse.move(400, 230); await page.mouse.up({ button: "right" });
    assert.ok(await distance() > beforeDolly);
    const beforeWheel = await distance(); await page.mouse.wheel(0, -100);
    await page.waitForFunction((d) => previewInternals.camera.position.distanceTo(previewInternals.controls.target) < d, beforeWheel);
    const beforeSpin = await page.evaluate(() => ({ position: previewInternals.camera.position.toArray(), up: previewInternals.camera.up.toArray() }));
    await page.keyboard.down("Control"); await page.mouse.move(700, 200); await page.mouse.down(); await page.mouse.move(700, 260); await page.mouse.up(); await page.keyboard.up("Control");
    assert.deepEqual(await page.evaluate(() => previewInternals.camera.position.toArray()), beforeSpin.position);
    assert.notDeepEqual(await page.evaluate(() => previewInternals.camera.up.toArray()), beforeSpin.up);
    await page.evaluate(() => { preview.dispose(); preview.dispose(); });
    assert.equal(await page.locator("canvas").count(), 0);
    // Three r185 retains its shared 16x16 DFG lighting lookup in this counter;
    // all preview geometry and all four OIT target/depth textures are released.
    assert.deepEqual(await page.evaluate(() => previewInternals.renderer.info.memory), { geometries: 0, textures: 1 });
    await page.evaluate(() => makePreview()); assert.equal(await page.locator("canvas").count(), 1);
    if (!process.env.OIT_FALLBACK) results.apple = await checkAppleWorkflow(page, origin, output);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(results, null, 2));
    await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  } finally { await browser.close(); server.close(); }
}
