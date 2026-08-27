import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { DEMO_DATASETS, demoDatasetById } from "../demo-datasets.mjs";
import { parseNiftiLabelVolume, parseNiftiVolume } from "../medical-io.mjs";
import { createNiftiLabelVolume } from "../volume-tools.mjs";

test("Apple demo declares ordered images, calibration guidance, and attribution", () => {
  const dataset = demoDatasetById("apple-kanzi-84");
  assert.equal(DEMO_DATASETS.length, 2);
  assert.equal(dataset.imagePaths.length, 20);
  assert.equal(dataset.imagePaths[0], "./demo/apple-kanzi-84/apple_0001.jpg");
  assert.equal(dataset.imagePaths.at(-1), "./demo/apple-kanzi-84/apple_0020.jpg");
  assert.equal(dataset.revision, 2);
  assert.equal(dataset.calibration.referenceLengthMm, 100);
  assert.equal(dataset.calibration.sliceSpacingMm, 4);
  assert.match(dataset.calibration.referenceNote, /not a measurement/i);
  assert.match(dataset.attribution.doiUrl, /zenodo\.8167285/);
  assert.equal(dataset.attribution.licenseName, "CC BY 4.0");
});

test("RabbitCT demo declares a lazy NIfTI volume with known physical spacing", async () => {
  const dataset = demoDatasetById("rabbitct-reference-256");
  assert.equal(dataset.kind, "nifti-volume");
  assert.equal(dataset.initialFrameIndex, 127);
  assert.equal(dataset.volumePath, "./demo/rabbitct/RabbitCT_reference_256_corrected.nii.gz");
  assert.deepEqual(dataset.voxelSpacingMm, [1, 1, 1]);
  assert.match(dataset.guide.primaryValue, /1\.0 mm isotropic/);
  assert.match(dataset.guide.secondaryValue, /skull or body contour/i);
  assert.match(dataset.attribution.doiUrl, /zenodo\.org\/records\/21267885/);
  assert.equal(dataset.attribution.licenseName, "CC BY 4.0");

  const file = await readFile(
    new URL("../demo/rabbitct/RabbitCT_reference_256_corrected.nii.gz", import.meta.url),
  );
  assert.equal(file.byteLength, dataset.volumeBytes);
  const input = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const volume = parseNiftiVolume(input, dataset.volumeFilename);
  assert.equal(volume.width, 256);
  assert.equal(volume.height, 256);
  assert.equal(volume.frames.length, 256);
  assert.deepEqual(volume.spacing, [1, 1, 1]);

  const emptySlice = new Uint8Array(volume.width * volume.height);
  const exported = createNiftiLabelVolume(
    Array.from({ length: volume.frames.length }, () => emptySlice),
    volume.width,
    volume.height,
    volume.geometry,
  );
  const reopened = parseNiftiLabelVolume(exported.buffer, "rabbit-labels.nii");
  reopened.affine.forEach((row, y) => row.forEach((value, x) => {
    assert.ok(Math.abs(value - volume.affine[y][x]) < 1e-6);
  }));
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
  assert.match(html, /Load RabbitCT Demo/);
  assert.match(html, /id="demo-calibration-guide"/);
  assert.match(html, /id="demo-reference-value">100 mm/);
  assert.ok(html.indexOf('id="reference-length"') < html.indexOf('id="spacing-z"'));
  assert.match(app, /decodeNiftiSources\(file\)/);
  assert.match(app, /prepareImageSequence\([\s\S]*preserveDimensions: true, demoDataset: dataset/);
  assert.match(worker, /demo-datasets\.mjs\?v=3/);
  assert.match(worker, /APPLE_DEMO_FILES/);
  assert.doesNotMatch(worker, /RabbitCT_reference_256_corrected/);
});
