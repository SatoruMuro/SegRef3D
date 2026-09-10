// Real demo controls; state inspection is injected only by this local test server.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    if (urlPath === "/lite-web/app.mjs") body = `${body}\nglobalThis.demoTest = { state, render };\n`;
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
    assert.equal(layout.length, 4);
    assert.deepEqual(layout.map(b => b.name), ['Load Apple Demo', 'Load Rabbit CT Demo', 'Load Electron Microscopy Demo', 'Load Mouse Brain Demo']);
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
