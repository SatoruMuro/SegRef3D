import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createInstant3DRequest, validateInstant3DObjects, validateInstant3DResult } from "../instant3d-bridge.mjs";
import { parseNiftiVolume } from "../medical-io.mjs";
import { createNiftiLabelVolume } from "../volume-tools.mjs";

const catalog = JSON.parse(await readFile(new URL("../../resources/totalsegmentator_roi_catalog.json", import.meta.url), "utf8"));
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
