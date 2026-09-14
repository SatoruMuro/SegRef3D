import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseZip } from "../zip.mjs";

// Exercise the real Apple demo, drawing, meshing, dialog controls and STL export.
// Compact hand-drawn regions keep this a preview regression, not a meshing stress
// test. No masks, application state or production functions are injected.
export async function checkAppleWorkflow(page, origin, output) {
  await page.goto(`${origin}/lite-web/`);
  await page.locator("#load-demo").click();
  await page.locator("#spacing-x").waitFor({ state: "visible" });
  await page.locator("#spacing-x").fill("0.15"); await page.locator("#spacing-y").fill("0.15");
  await page.getByRole("tab", { name: "Draw & Refine", exact: true }).click();
  const box = await page.locator("#editor-canvas").boundingBox();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  async function draw(slice, size) {
    await page.locator("#slice-number").fill(String(slice)); await page.locator("#slice-number").press("Enter");
    for (const [dx, dy, button] of [[-size, -size, "left"], [size, -size, "left"], [size, size, "left"], [-size, size, "right"]]) {
      await page.mouse.click(center.x + dx, center.y + dy, { button });
    }
    await page.locator("#add-mask").click();
  }
  for (const slice of [9, 10, 11]) await draw(slice, 20);
  await page.locator('#label-list [data-label="2"] .label-copy').click(); await draw(10, 10);
  await page.getByRole("tab", { name: "Volume & 3D", exact: true }).click();
  await page.locator("#stl-factor").selectOption("1"); await page.locator("#stl-scope").selectOption("visible");
  await page.locator("#preview-stl").click();
  await page.waitForFunction(() => !!globalThis.previewInternals);
  assert.equal(await page.locator("#stl-preview-objects input[type=checkbox]").count(), 2);
  const counts = await page.evaluate(() => [...previewInternals.surfaces.values()].map((surface) => surface.geometry.attributes.position.count / 3));
  assert.ok(counts.every((count) => count > 0));
  const initial = await page.evaluate(() => previewInternals.camera.position.toArray());
  await page.locator('input[title="Obj 2 opacity"]').fill("1");
  for (const opacity of [1, 0.5, 0.2, 0.1]) {
    await page.locator('input[title="Obj 1 opacity"]').fill(String(opacity));
    assert.deepEqual(await page.evaluate(() => {
      const surface = previewInternals.surfaces.get(1);
      return [surface.material.opacity, surface.material.transparent, surface.material.depthWrite, surface.visible];
    }), [opacity, opacity < 1, opacity === 1, true]);
  }
  await page.getByLabel("Show Obj 1 in 3D preview").uncheck();
  await page.locator('input[title="Obj 1 opacity"]').fill("1");
  assert.equal(await page.evaluate(() => previewInternals.surfaces.get(1).visible), false);
  await page.getByLabel("Show Obj 1 in 3D preview").check();
  await page.locator('input[title="Obj 1 opacity"]').fill("0.2");
  const canvas = await page.locator("#stl-preview-canvas canvas").boundingBox();
  await page.mouse.move(canvas.x + canvas.width * 0.4, canvas.y + canvas.height * 0.5);
  await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width * 0.65, canvas.y + canvas.height * 0.3, { steps: 20 }); await page.mouse.up();
  assert.notDeepEqual(await page.evaluate(() => previewInternals.camera.position.toArray()), initial);
  await page.locator("#stl-preview-reset").click();
  assert.deepEqual(await page.evaluate(() => previewInternals.camera.position.toArray()), initial);
  await page.screenshot({ path: path.join(output, "apple-preview.png") });
  const rendering = await page.evaluate(() => {
    const p = previewInternals, gl = p.renderer.getContext();
    const pixel = new Uint8Array(4);
    const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const time = (render) => {
      render(); finish();
      const samples = [];
      for (let i = 0; i < 15; i++) {
        const start = performance.now(); render(); finish(); samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return { medianMs: samples[7], p95Ms: samples[14] };
    };
    return { conventional: time(() => p.renderer.render(p.scene, p.camera)), oit: time(p.render),
      viewport: [gl.drawingBufferWidth, gl.drawingBufferHeight], renderer: gl.getParameter(gl.RENDERER) };
  });
  await page.locator("#stl-preview-close").click();
  assert.equal(await page.locator("#stl-preview-canvas canvas").count(), 0);
  await page.locator("#preview-stl").click();
  await page.locator("#stl-preview-objects input[type=checkbox]").first().waitFor();
  assert.equal(await page.locator("#stl-preview-canvas canvas").count(), 1);
  await page.locator("#stl-preview-close").click();
  const downloading = page.waitForEvent("download");
  await page.locator("#export-stl").click();
  const download = await downloading;
  const archive = path.join(output, "apple-surfaces.zip"); await download.saveAs(archive);
  const entries = await parseZip(new Blob([await readFile(archive)]));
  assert.equal(entries.length, 2);
  for (const [i, entry] of entries.entries()) {
    assert.ok(entry.name.endsWith(".stl"));
    const view = new DataView(entry.bytes.buffer, entry.bytes.byteOffset, entry.bytes.byteLength);
    assert.equal(view.getUint32(80, true), counts[i], "export and preview must use the same surface generation");
    assert.equal(entry.bytes.length, 84 + counts[i] * 50);
  }
  return { triangles: counts, reopened: true, stlExport: true, rendering };
}
