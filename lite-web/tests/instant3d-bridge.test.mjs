import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collapseInstant3DObjects,
  createInstant3DRequest,
  validateInstant3DObjects,
  validateInstant3DResult,
} from "../instant3d-bridge.mjs";
import { parseNiftiVolume } from "../medical-io.mjs";
import { createNiftiLabelVolume } from "../volume-tools.mjs";

const catalog = JSON.parse(await readFile(new URL("../../resources/totalsegmentator_roi_catalog.json", import.meta.url), "utf8"));
const ribRois = new Set([
  ...Array.from({ length: 12 }, (_, index) => `rib_left_${index + 1}`),
  ...Array.from({ length: 12 }, (_, index) => `rib_right_${index + 1}`),
]);
const objects = [
  { object_id: 2, display_name: "Kidney, right", task: "total", roi: "kidney_right" },
  { object_id: 7, display_name: "Psoas major, right", task: "abdominal_muscles", roi: "psoas_major_right" },
];

function sourceNifti() {
  const masks = [new Uint8Array([0, 1, 0, 0, 0, 0]), new Uint8Array([0, 0, 0, 1, 0, 0])];
  return new Uint8Array(createNiftiLabelVolume(masks, 3, 2, [0.7, 0.8, 2], [12, -4, 8]));
}

test("builds a browser-local Instant3D request with nonsequential object mapping", async () => {
  const bytes = sourceNifti();
  const volume = parseNiftiVolume(bytes, "source.nii");
  const source = {
    format: "nifti", filename: "source.nii", bytes,
    shape: [volume.width, volume.height, volume.depth], spacing: volume.spacing,
    affine: volume.affine, orientation: volume.orientation,
  };
  const { manifest, entries } = await createInstant3DRequest({ source, objects, catalog });
  assert.deepEqual(manifest.objects.map((item) => item.object_id), [2, 7]);
  manifest.source.voxel_spacing_mm.forEach((value, index) =>
    assert.ok(Math.abs(value - [0.7, 0.8, 2][index]) < 1e-6));
  assert.equal(manifest.source.orientation.length, 3);
  assert.deepEqual(entries.map((entry) => entry.name), ["manifest.json", "image/source.nii"]);
  assert.match(manifest.source.sha256, /^[0-9a-f]{64}$/);
});

test("shared catalog exposes 24 searchable ribs and preserves their request identifiers", async () => {
  const keys = catalog.structures.map((item) => `${item.task}/${item.roi}`);
  assert.equal(new Set(keys).size, keys.length);
  const ribs = catalog.structures.filter((item) => ribRois.has(item.roi));
  assert.equal(ribs.length, 24);
  assert.deepEqual(new Set(ribs.map((item) => item.roi)), ribRois);
  for (const item of ribs) {
    assert.equal(item.task, "total");
    assert.equal(item.category, "Bone");
    assert.deepEqual(item.modality, ["CT"]);
    const haystack = [item.display_name, item.roi, item.category, ...(item.synonyms || [])]
      .join(" ").toLowerCase();
    assert.ok(haystack.includes("rib"));
    assert.ok(haystack.includes("ribs"));
  }

  const bytes = sourceNifti();
  const volume = parseNiftiVolume(bytes, "source.nii");
  const source = {
    format: "nifti", filename: "source.nii", bytes,
    shape: [volume.width, volume.height, volume.depth], spacing: volume.spacing,
    affine: volume.affine, orientation: volume.orientation,
  };
  const selected = [
    { object_id: 1, display_name: "Rib 1, left", task: "total", roi: "rib_left_1" },
    { object_id: 20, display_name: "Rib 12, right", task: "total", roi: "rib_right_12" },
  ];
  const { manifest } = await createInstant3DRequest({ source, objects: selected, catalog, fast: true });
  assert.deepEqual(manifest.objects, selected);
  assert.equal(manifest.options.fast, true);
});

test("shared rib groups have exact members and expand to official ROIs on one object", async () => {
  const groups = new Map(catalog.groups.map((item) => [item.id, item]));
  assert.deepEqual(new Set(groups.keys()), new Set(["ribs_all", "ribs_left", "ribs_right"]));
  const left = new Set(Array.from({ length: 12 }, (_, index) => `rib_left_${index + 1}`));
  const right = new Set(Array.from({ length: 12 }, (_, index) => `rib_right_${index + 1}`));
  const expected = new Map([
    ["ribs_all", new Set([...left, ...right])],
    ["ribs_left", left],
    ["ribs_right", right],
  ]);
  for (const [groupId, members] of expected) {
    const group = groups.get(groupId);
    assert.equal(group.category, "Bone");
    assert.equal(group.members.length, new Set(group.members).size);
    assert.deepEqual(new Set(group.members), members);
  }

  const bytes = sourceNifti();
  const volume = parseNiftiVolume(bytes, "source.nii");
  const source = {
    format: "nifti", filename: "source.nii", bytes,
    shape: [volume.width, volume.height, volume.depth], spacing: volume.spacing,
    affine: volume.affine, orientation: volume.orientation,
  };
  const selected = [{ object_id: 1, display_name: "Ribs, all", group: "ribs_all" }];
  const { manifest } = await createInstant3DRequest({ source, objects: selected, catalog, fast: true });
  assert.equal(manifest.objects.length, 24);
  assert.deepEqual(new Set(manifest.objects.map((item) => item.roi)), ribRois);
  assert.deepEqual(new Set(manifest.objects.map((item) => item.object_id)), new Set([1]));
  assert.deepEqual(new Set(manifest.objects.map((item) => item.selection_group)), new Set(["ribs_all"]));
  assert.ok(manifest.objects.every((item) => !["ribs", "ribs_all", "rib_all", "ribs_left", "ribs_right"].includes(item.roi)));
  assert.equal(manifest.options.fast, true);
  assert.deepEqual(collapseInstant3DObjects(manifest.objects, catalog), selected);

  const deduplicated = validateInstant3DObjects([
    ...selected,
    { object_id: 1, display_name: "Rib 1, left", task: "total", roi: "rib_left_1" },
  ], catalog);
  assert.equal(deduplicated.length, 24);
  assert.equal(deduplicated.filter((item) => item.roi === "rib_left_1").length, 1);
});

test("rejects duplicate object IDs and source-mismatched results", () => {
  assert.throws(() => validateInstant3DObjects([objects[0], { ...objects[1], object_id: 2 }], catalog), /Duplicate object ID/);
  const bytes = sourceNifti();
  const volume = parseNiftiVolume(bytes, "source.nii");
  const source = {
    format: "nifti", filename: "source.nii", bytes,
    shape: [volume.width, volume.height, volume.depth], spacing: volume.spacing,
    affine: volume.affine, orientation: volume.orientation, sha256: "a".repeat(64),
  };
  const resultManifest = {
    schema: "segref3d-instant3d-bridge", schema_version: "1.0", request_id: "request-123",
    status: "success", source: {
      filename: "source.nii", modality: "CT", shape: source.shape,
      voxel_spacing_mm: source.spacing, affine: source.affine,
      orientation: source.orientation, sha256: "b".repeat(64),
    }, objects, software: {}, warnings: [], overlaps: [],
  };
  const entries = [
    { name: "manifest.json", bytes: new TextEncoder().encode(JSON.stringify(resultManifest)) },
    { name: "labelmap/labels.nii.gz", bytes },
  ];
  assert.throws(() => validateInstant3DResult(entries, source, catalog), /source checksum/);
});
