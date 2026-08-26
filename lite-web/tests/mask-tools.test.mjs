import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMaskVolumeChanges,
  buildMaskVolumeChanges,
  checkProject,
  cleanupLabelMask,
  clearLabelVolume,
  createVolumeStatisticsCsv,
  frameIndicesForScope,
  interpolateLabelMasks,
  mergeLabelVolume,
  relabelVolume,
  volumeStatistics,
  volumeStatisticsAsync,
} from "../mask-tools.mjs";

test("volume statistics calculate voxel and calibrated physical volumes", () => {
  const masks = [new Uint8Array([1, 1, 0, 0]), new Uint8Array([0, 1, 0, 2])];
  const result = volumeStatistics(masks, 2, 2, [0.5, 0.5, 2], ["", "Muscle", "Bone"]);
  assert.equal(result.calibrated, true);
  assert.deepEqual(result.rows[0], {
    objectId: 1,
    objectName: "Muscle",
    voxelCount: 3,
    volumeMm3: 1.5,
    volumeCm3: 0.0015,
    firstFrame: 1,
    lastFrame: 2,
    occupiedSlices: 2,
  });
  assert.equal(result.rows[1].voxelCount, 1);
  assert.match(createVolumeStatisticsCsv(result), /1,Muscle,3,1\.5,0\.0015,1,2,2/);
  assert.equal(volumeStatistics(masks, 2, 2, null).rows[0].volumeMm3, null);
});

test("async volume statistics yield between slices and match synchronous results", async () => {
  const masks = [
    new Uint8Array([1, 1, 0, 2]),
    new Uint8Array([0, 1, 2, 2]),
    new Uint8Array([3, 0, 0, 0]),
  ];
  const progress = [];
  const result = await volumeStatisticsAsync(
    masks,
    2,
    2,
    [1, 1, 0.5],
    ["", "One", "Two", "Three"],
    { onProgress: (completed, total) => progress.push([completed, total]) },
  );
  assert.deepEqual(result, volumeStatistics(masks, 2, 2, [1, 1, 0.5], ["", "One", "Two", "Three"]));
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
});

test("async volume statistics can stop after a tab change", async () => {
  const masks = Array.from({ length: 4 }, () => new Uint8Array([1, 0, 0, 0]));
  let canceled = false;
  const result = await volumeStatisticsAsync(masks, 2, 2, null, [], {
    onProgress: (completed) => {
      if (completed === 1) canceled = true;
    },
    isCanceled: () => canceled,
  });
  assert.equal(result, null);
});

test("relabel, merge, and clear preserve unrelated labels and report conflicts", () => {
  const masks = [new Uint8Array([1, 2, 3, 0])];
  assert.deepEqual([...relabelVolume(masks, 1, 4)[0]], [4, 2, 3, 0]);
  assert.throws(() => relabelVolume(masks, 1, 2), /Use Merge/);
  assert.deepEqual([...mergeLabelVolume(masks, 1, 2)[0]], [2, 2, 3, 0]);
  assert.deepEqual([...clearLabelVolume(masks, 2)[0]], [1, 0, 3, 0]);
  assert.deepEqual([...masks[0]], [1, 2, 3, 0]);
});

test("cleanup fills holes, removes islands, keeps largest, smooths, dilates, and erodes", () => {
  const ring = new Uint8Array([
    0, 0, 0, 0, 0,
    0, 1, 1, 1, 0,
    0, 1, 0, 1, 0,
    0, 1, 1, 1, 0,
    0, 0, 0, 0, 0,
  ]);
  const islands = new Uint8Array([
    1, 1, 0, 0, 0,
    1, 1, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 1,
  ]);
  assert.equal(cleanupLabelMask(ring, 5, 5, 1, "fill-holes")[12], 1);
  assert.equal(cleanupLabelMask(islands, 5, 5, 1, "remove-islands", { minimumSize: 2 })[24], 0);
  assert.equal(cleanupLabelMask(islands, 5, 5, 1, "largest")[24], 0);
  assert.ok(cleanupLabelMask(ring, 5, 5, 1, "dilate", { radius: 1 })[2]);
  assert.equal(cleanupLabelMask(ring, 5, 5, 1, "erode", { radius: 1 })[6], 0);
  assert.doesNotThrow(() => cleanupLabelMask(ring, 5, 5, 1, "smooth", { amount: 1 }));
});

test("cleanup frame scopes and bulk transactions support one-step undo and redo", () => {
  assert.deepEqual(frameIndicesForScope("current", 2, 0, 0, 5), [2]);
  assert.deepEqual(frameIndicesForScope("range", 0, 1, 3, 5), [1, 2, 3]);
  assert.deepEqual(frameIndicesForScope("all", 0, 0, 0, 3), [0, 1, 2]);
  assert.throws(() => frameIndicesForScope("range", 0, 3, 1, 5), /valid cleanup frame range/);

  const before = [new Uint8Array([1, 0]), new Uint8Array([0, 0]), new Uint8Array([2, 0])];
  const after = [new Uint8Array([1, 1]), new Uint8Array([0, 0]), new Uint8Array([0, 0])];
  const transaction = buildMaskVolumeChanges(before, after);
  assert.deepEqual(transaction.map((change) => change.index), [0, 2]);
  assert.deepEqual(applyMaskVolumeChanges(after, transaction, "before").map((mask) => [...mask]), before.map((mask) => [...mask]));
  assert.deepEqual(applyMaskVolumeChanges(before, transaction, "after").map((mask) => [...mask]), after.map((mask) => [...mask]));
});

test("slice interpolation creates editable intermediate object masks", () => {
  const left = new Uint8Array([
    0, 0, 0, 0, 0,
    0, 1, 1, 0, 0,
    0, 1, 1, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
  ]);
  const right = new Uint8Array([
    0, 0, 0, 0, 0,
    0, 0, 1, 1, 0,
    0, 0, 1, 1, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
  ]);
  const generated = interpolateLabelMasks(left, right, 5, 5, 1, 3);
  assert.equal(generated.length, 3);
  assert.ok(generated.every((mask) => mask.some((value) => value === 1)));
  assert.throws(() => interpolateLabelMasks(new Uint8Array(25), right, 5, 5, 1, 1), /start frame/);
});

test("project QA distinguishes errors, warnings, and valid tracking setup", () => {
  const images = [
    { name: "frame0001.png", width: 2, height: 2, mask: new Uint8Array([1, 0, 0, 0]) },
    { name: "frame0002.png", width: 2, height: 2, mask: new Uint8Array([0, 1, 0, 0]) },
  ];
  const valid = checkProject({
    images,
    spacing: [1, 1, 1],
    segmentationJobs: [{ id: 1, trackingStart: 0, trackingEnd: 1, prompts: [{ type: "box", frame: 0, box: [0, 0, 1, 1] }] }],
  });
  assert.ok(valid.some((finding) => finding.code === "tracking-valid"));
  assert.ok(valid.some((finding) => finding.code === "filename-sequence"));
  assert.ok(valid.some((finding) => finding.code === "object-1-isolated"));
  const invalid = checkProject({
    images,
    spacing: null,
    objectNames: ["", "Object 1", "Named Empty"],
    segmentationJobs: [{ id: 1, trackingStart: 0, trackingEnd: 1, prompts: [
      { type: "box", frame: 2, box: [0, 0, 3, 1] },
      { type: "box", frame: 2, box: [0, 0, 1, 1] },
    ] }],
  });
  assert.ok(invalid.some((finding) => finding.severity === "warning" && finding.code === "spacing"));
  assert.ok(invalid.some((finding) => finding.code.includes("duplicate")));
  assert.ok(invalid.some((finding) => finding.code.endsWith("box")));
});

test("project QA reports missing frames, filename mismatches, dimensions, and invalid labels", () => {
  const missing = checkProject({
    images: [
      { name: "slice0001.png", width: 2, height: 2, mask: new Uint8Array([21, 0, 0, 0]) },
      { name: "slice0003.png", width: 3, height: 2, mask: new Uint8Array(6) },
    ],
    spacing: [1, 1, 1],
  });
  assert.ok(missing.some((finding) => finding.code === "missing-frames"));
  assert.ok(missing.some((finding) => finding.code === "frame-dimensions" && finding.severity === "error"));
  assert.ok(missing.some((finding) => finding.code === "label-range" && finding.severity === "error"));

  const mismatch = checkProject({
    images: [
      { name: "slice0001.png", width: 1, height: 1, mask: new Uint8Array(1) },
      { name: "scan0002.jpg", width: 1, height: 1, mask: new Uint8Array(1) },
    ],
    spacing: [1, 1, 1],
  });
  assert.ok(mismatch.some((finding) => finding.code === "filename-pattern"));
});
