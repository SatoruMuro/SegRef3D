import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { DEMO_DATASETS, demoDatasetById } from "../demo-datasets.mjs";
import { parseNiftiLabelVolume, parseNiftiVolume } from "../medical-io.mjs";
import { createNiftiLabelVolume } from "../volume-tools.mjs";

test("Apple demo declares ordered images, calibration guidance, and attribution", () => {
  const dataset = demoDatasetById("apple-kanzi-84");
  assert.equal(DEMO_DATASETS.length, 4);
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

test("Demos use the normal sequence pipeline and load assets only on demand", async () => {
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
  assert.match(worker, /demo-datasets\.mjs\?v=5/);
  assert.doesNotMatch(worker, /APPLE_DEMO_FILES|\.\/demo\//);
  assert.doesNotMatch(worker, /RabbitCT_reference_256_corrected/);
  for (const id of ["hela-em-demo", "mouse-brain-demo"]) {
    assert.match(html, new RegExp(`data-demo-id="${id}"`));
  }
  assert.match(html, /Mouse brain microscopy data:/);
  assert.match(html, /https:\/\/brainarchitecture\.org\//);
  assert.match(html, /https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\//);
});

for (const [id, count, dimensions, colorType, budget] of [
  ["hela-em-demo", 150, [512, 512], 0, 30_000_000],
  ["mouse-brain-demo", 132, [707, 553], 2, 55_000_000],
]) {
  test(`${id}: complete ordered PNG assets match provenance hashes and web size budget`, async () => {
    const dataset = demoDatasetById(id);
    const directory = new URL(`../demo/${id}/`, import.meta.url);
    const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
    assert.equal(dataset.kind, "image-sequence");
    assert.equal(dataset.restoreAutosave, false);
    assert.equal(dataset.imagePaths.length, count);
    assert.equal(manifest.slices, count);
    assert.equal(manifest.frames.length, count);
    assert.deepEqual(dataset.imageSize, dimensions);
    assert.equal((await readdir(directory)).filter(name => name.endsWith(".png")).length, count);
    let totalBytes = 0;
    for (let index = 0; index < count; index += 1) {
      const frame = manifest.frames[index];
      assert.equal(dataset.imagePaths[index].split("/").at(-1), frame.file);
      assert.equal(frame.sourceFrame ?? frame.sourceNumber, index * 2 + 1);
      const bytes = await readFile(new URL(frame.file, directory));
      assert.equal(bytes.subarray(1, 4).toString(), "PNG");
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], dimensions);
      assert.equal(bytes[24], 8);
      assert.equal(bytes[25], colorType);
      assert.equal(bytes.length, frame.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), frame.sha256);
      totalBytes += bytes.length;
    }
    assert.equal(totalBytes, manifest.totalBytes);
    assert.ok(totalBytes < budget);
    assert.equal(dataset.attribution.licenseName, manifest.license);
    if (id === "hela-em-demo") {
      assert.deepEqual(dataset.voxelSpacingMm, [0.0000390625, 0.0000390625, 0.0001]);
      assert.equal(manifest.roi, "ROI_1416-1932-171");
    } else {
      assert.equal(dataset.voxelSpacingMm, undefined);
      assert.equal(manifest.voxelSpacingMm, null);
      assert.equal(manifest.datasetId, null);
      assert.equal(manifest.brainId, null);
      assert.equal(manifest.experimentId, null);
      assert.match(dataset.volumeInfoSource, /Unknown physical spacing/);
      assert.match(manifest.adaptation, /No resize, crop, rotation/);
    }
  });
}

test("queued autosaves retain their original project and slice after a stack switch", async () => {
  const source = await readFile(new URL("../app.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function autosave(");
  const end = source.indexOf("\nfunction clearImagePaths", start);
  const image = { name: "first.png", width: 1, height: 1, mask: new Uint8Array([3]) };
  const state = { projectId: "old", images: [image], saveQueue: Promise.resolve() };
  const writes = [];
  const notices = [];
  const context = vm.createContext({ state, MASK_SLICE_ORDER: "segref3d-canonical-v1",
    saveMask: async (...args) => writes.push(args), setSaveState: (...args) => notices.push(args),
    setStatus: () => {}, console });
  vm.runInContext(source.slice(start, end), context);
  const pending = context.autosave(image);
  state.projectId = "new";
  state.images = [];
  image.mask[0] = 7;
  await pending;
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "old");
  assert.equal(writes[0][4][0], 3);
  assert.equal(writes[0][5].zIndex, 0);
  assert.deepEqual(notices, [["Saving…", "saving"]]);
});
