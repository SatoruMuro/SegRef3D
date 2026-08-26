import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { DEMO_DATASETS, demoDatasetById } from "../demo-datasets.mjs";

test("Apple demo declares ordered images, calibration guidance, and attribution", () => {
  const dataset = demoDatasetById("apple-kanzi-84");
  assert.equal(DEMO_DATASETS.length, 1);
  assert.equal(dataset.imagePaths.length, 20);
  assert.equal(dataset.imagePaths[0], "./demo/apple-kanzi-84/apple_0001.jpg");
  assert.equal(dataset.imagePaths.at(-1), "./demo/apple-kanzi-84/apple_0020.jpg");
  assert.equal(dataset.calibration.referenceLengthMm, 75);
  assert.equal(dataset.calibration.sliceSpacingMm, 4);
  assert.match(dataset.calibration.referenceNote, /not a measurement/i);
  assert.match(dataset.attribution.doiUrl, /zenodo\.8167285/);
  assert.equal(dataset.attribution.licenseName, "CC BY 4.0");
});

test("Apple demo assets are complete and remain practical for web delivery", async () => {
  const directory = new URL("../demo/apple-kanzi-84/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^apple_\d{4}\.jpg$/.test(name)).sort();
  assert.equal(files.length, 20);
  assert.equal(files[0], "apple_0001.jpg");
  assert.equal(files.at(-1), "apple_0020.jpg");
  const totalBytes = (await Promise.all(files.map((name) => stat(new URL(name, directory)))))
    .reduce((sum, entry) => sum + entry.size, 0);
  assert.ok(totalBytes > 1_000_000);
  assert.ok(totalBytes < 7_000_000);
});

test("Apple demo UI uses the normal sequence pipeline and offline cache", async () => {
  const [html, app, worker] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.mjs", import.meta.url), "utf8"),
    readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Load Apple Demo/);
  assert.match(html, /id="demo-calibration-guide"/);
  assert.match(app, /prepareImageSequence\([\s\S]*preserveDimensions: true, demoDataset: dataset/);
  assert.match(worker, /demo-datasets\.mjs\?v=1/);
  assert.match(worker, /APPLE_DEMO_FILES/);
});
