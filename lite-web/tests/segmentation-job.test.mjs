import assert from "node:assert/strict";
import test from "node:test";
import {
  SEGMENTATION_JOB_KIND,
  SEGMENTATION_RESULT_KIND,
  createSegmentationJobManifest,
  validateSegmentationArchive,
  validateSegmentationManifest,
} from "../segmentation-job.mjs";

function jobManifest() {
  return createSegmentationJobManifest({
    images: Array.from({ length: 5 }, (_, index) => ({
      name: `source${index + 1}.png`,
      width: 128,
      height: 96,
    })),
    objects: [
      { id: 1, name: "Circle", promptFrame: 2, box: [10, 12, 50, 60], trackingStart: 1, trackingEnd: 4 },
      { id: 2, name: "Rectangle", promptFrame: 1, box: [70, 8, 110, 45], trackingStart: 0, trackingEnd: 3 },
    ],
    source: { project_name: "Browser test" },
  });
}

test("creates the desktop-compatible segmentation job manifest", () => {
  const manifest = jobManifest();
  assert.equal(manifest.kind, SEGMENTATION_JOB_KIND);
  assert.deepEqual(manifest.images.order, ["0001", "0002", "0003", "0004", "0005"]);
  assert.equal(manifest.objects[0].prompt_frame, 2);
  assert.deepEqual(manifest.objects[1].prompts[0].box, [70, 8, 110, 45]);
});

test("rejects a prompt frame outside its tracking range", () => {
  const manifest = jobManifest();
  manifest.objects[0].tracking_start = 3;
  assert.throws(() => validateSegmentationManifest(manifest), /inside its tracking range/);
});

test("normalizes multiple keyframe prompts and keeps legacy fields on the primary prompt", () => {
  const manifest = createSegmentationJobManifest({
    images: Array.from({ length: 10 }, (_, index) => ({
      name: `source${index + 1}.png`,
      width: 128,
      height: 96,
    })),
    objects: [{
      id: 1,
      name: "Multi",
      trackingStart: 0,
      trackingEnd: 9,
      prompts: [
        { type: "box", frame: 8, box: [30, 32, 70, 75] },
        { type: "box", frame: 2, box: [10, 12, 50, 60] },
        { type: "box", frame: 5, box: [20, 22, 60, 68] },
      ],
    }],
  });
  assert.deepEqual(manifest.objects[0].prompts.map((prompt) => prompt.frame), [2, 5, 8]);
  assert.equal(manifest.objects[0].prompt_frame, 2);
  assert.deepEqual(manifest.objects[0].box, [10, 12, 50, 60]);
});

test("rejects invalid multiple keyframe prompt collections", () => {
  const base = jobManifest();
  const invalidCases = [
    { prompts: [], message: /at least one box prompt/ },
    { prompts: [{ type: "point", frame: 2, box: [10, 12, 50, 60] }], message: /type must be box/ },
    { prompts: [{ type: "box", frame: 0, box: [10, 12, 50, 60] }], message: /inside its tracking range/ },
    { prompts: [{ type: "box", frame: 5, box: [10, 12, 50, 60] }], message: /outside the image sequence/ },
    { prompts: [{ type: "box", frame: 2, box: [50, 12, 10, 60] }], message: /coordinates are outside/ },
    {
      prompts: [
        { type: "box", frame: 2, box: [10, 12, 50, 60] },
        { type: "box", frame: 2, box: [12, 14, 52, 62] },
      ],
      message: /duplicate frame 2/,
    },
  ];
  for (const { prompts, message } of invalidCases) {
    const manifest = structuredClone(base);
    manifest.objects[0].prompts = prompts;
    assert.throws(() => validateSegmentationManifest(manifest), message);
  }
});

test("rejects unsafe ZIP paths before reading declared files", () => {
  const manifest = jobManifest();
  const entries = [
    { name: "manifest.json", bytes: new TextEncoder().encode(JSON.stringify(manifest)) },
    ...manifest.images.files.map((record) => ({ name: record.archive_path, bytes: new Uint8Array() })),
    { name: "../outside.txt", bytes: new Uint8Array() },
  ];
  assert.throws(() => validateSegmentationArchive(entries, SEGMENTATION_JOB_KIND), /must not contain '\.\.'/);
});

test("validates result masks and declared image members", () => {
  const manifest = jobManifest();
  manifest.kind = SEGMENTATION_RESULT_KIND;
  manifest.result = {
    mask_format: "single-label-uint8-png",
    overlap_policy: "later-object-overwrites-earlier-object",
    backend: { name: "test" },
    masks: manifest.images.files.map((record) => ({
      index: record.index,
      key: record.key,
      archive_path: `masks/mask${record.key}.png`,
    })),
  };
  const entries = [
    { name: "manifest.json", bytes: new TextEncoder().encode(JSON.stringify(manifest)) },
    ...manifest.images.files.map((record) => ({ name: record.archive_path, bytes: new Uint8Array() })),
    ...manifest.result.masks.map((record) => ({ name: record.archive_path, bytes: new Uint8Array() })),
  ];
  const result = validateSegmentationArchive(entries, SEGMENTATION_RESULT_KIND);
  assert.equal(result.manifest.result.masks.length, 5);
});
