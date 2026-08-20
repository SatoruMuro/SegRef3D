import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRasterToMask,
  createProjectId,
  fitViewport,
  maskFilename,
  naturalCompare,
  screenToImage,
  transferLabel,
  zoomAroundPoint,
} from "../core.mjs";

test("natural sorting keeps numbered slices in order", () => {
  const names = ["slice10.png", "slice2.png", "slice1.png"].sort(naturalCompare);
  assert.deepEqual(names, ["slice1.png", "slice2.png", "slice10.png"]);
});

test("fit viewport centers an image without distortion", () => {
  const viewport = fitViewport(1000, 700, 800, 400, 20);
  assert.equal(viewport.zoom, 1.2);
  assert.equal(viewport.panX, 20);
  assert.equal(viewport.panY, 110);
});

test("zooming around a point preserves the image coordinate", () => {
  const before = { zoom: 1, panX: 20, panY: 30 };
  const imagePoint = screenToImage(220, 130, before);
  const after = zoomAroundPoint(before, 220, 130, 2.5);
  assert.deepEqual(screenToImage(220, 130, after), imagePoint);
});

test("mask add and erase only change intended pixels", () => {
  const mask = new Uint8Array([0, 1, 2, 1]);
  assert.equal(applyRasterToMask(mask, new Uint8Array([1, 1, 0, 0]), "add", 3), 2);
  assert.deepEqual([...mask], [3, 3, 2, 1]);
  assert.equal(applyRasterToMask(mask, new Uint8Array([1, 1, 1, 1]), "erase", 3), 2);
  assert.deepEqual([...mask], [0, 0, 2, 1]);
});

test("label transfer preserves unrelated labels", () => {
  const mask = new Uint8Array([1, 2, 1, 0]);
  assert.equal(transferLabel(mask, 1, 7), 2);
  assert.deepEqual([...mask], [7, 2, 7, 0]);
});

test("project and mask naming are deterministic", () => {
  const files = [
    { name: "b.png", size: 20, lastModified: 2 },
    { name: "a.png", size: 10, lastModified: 1 },
  ];
  assert.equal(createProjectId(files), createProjectId([...files].reverse()));
  assert.equal(maskFilename(11), "mask0012.png");
});
