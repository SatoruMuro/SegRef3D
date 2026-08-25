export const SEGMENTATION_FORMAT_VERSION = "segref3d-segjob-1.0";
export const SEGMENTATION_JOB_KIND = "segmentation_job";
export const SEGMENTATION_RESULT_KIND = "segmentation_result";

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function integer(value, field, minimum = null) {
  requireValue(Number.isInteger(value), `${field} must be an integer.`);
  if (minimum !== null) requireValue(value >= minimum, `${field} must be at least ${minimum}.`);
  return value;
}

function number(value, field) {
  requireValue(Number.isFinite(value), `${field} must be numeric.`);
  return Number(value);
}

function imageKey(value, field) {
  requireValue(typeof value === "string" && value.length > 0, `${field} is missing.`);
  requireValue(value !== "." && value !== "..", `${field} is invalid.`);
  requireValue(!/[\\/:\0]/.test(value), `${field} must be a filename-safe token.`);
  return value;
}

export function safeArchivePath(value, field = "ZIP member") {
  requireValue(typeof value === "string" && value.trim(), `${field} is missing.`);
  requireValue(!value.includes("\0"), `${field} must not contain a null byte.`);
  const normalized = value.replaceAll("\\", "/");
  requireValue(!normalized.startsWith("/"), `${field} must be a relative ZIP path.`);
  requireValue(!/^[A-Za-z]:/.test(normalized), `${field} must not contain a drive name.`);
  const parts = normalized.split("/");
  requireValue(!parts.includes(".."), `${field} must not contain '..'.`);
  requireValue(parts.every((part) => part !== "" && part !== "."), `${field} is invalid.`);
  return normalized;
}

function normalizedBox(value, field, width, height) {
  requireValue(Array.isArray(value) && value.length === 4, `${field} must contain [x1, y1, x2, y2].`);
  const [x1, y1, x2, y2] = value.map((item) => number(item, field));
  requireValue(0 <= x1 && x1 < x2 && x2 <= width, `${field} x coordinates are outside the image.`);
  requireValue(0 <= y1 && y1 < y2 && y2 <= height, `${field} y coordinates are outside the image.`);
  return [x1, y1, x2, y2];
}

export function validateSegmentationManifest(source, expectedKind = null) {
  requireValue(source && typeof source === "object" && !Array.isArray(source), "manifest.json must contain a JSON object.");
  const manifest = structuredClone(source);
  requireValue(
    manifest.format_version === SEGMENTATION_FORMAT_VERSION,
    `Unsupported manifest version: ${JSON.stringify(manifest.format_version)}.`,
  );
  requireValue(
    [SEGMENTATION_JOB_KIND, SEGMENTATION_RESULT_KIND].includes(manifest.kind),
    `Unsupported manifest kind: ${JSON.stringify(manifest.kind)}.`,
  );
  if (expectedKind) requireValue(manifest.kind === expectedKind, `Expected ${expectedKind}, received ${manifest.kind}.`);
  requireValue(manifest.frame_index_base === 0, "frame_index_base must be 0.");
  requireValue(manifest.created_by && typeof manifest.created_by === "object", "created_by must be an object.");
  requireValue(manifest.source && typeof manifest.source === "object", "source must be an object.");

  const images = manifest.images;
  requireValue(images && typeof images === "object", "images must be an object.");
  const count = integer(images.count, "images.count", 1);
  const width = integer(images.width, "images.width", 1);
  const height = integer(images.height, "images.height", 1);
  requireValue(Array.isArray(images.files) && images.files.length === count, "images.count does not match images.files.");
  const seenIndices = new Set();
  const seenKeys = new Set();
  const seenPaths = new Set();
  images.files = images.files.map((record, position) => {
    const field = `images.files[${position}]`;
    requireValue(record && typeof record === "object", `${field} must be an object.`);
    const index = integer(record.index, `${field}.index`, 0);
    const key = imageKey(record.key, `${field}.key`);
    requireValue(typeof record.original_filename === "string" && record.original_filename, `${field}.original_filename is missing.`);
    requireValue(typeof record.working_filename === "string" && record.working_filename, `${field}.working_filename is missing.`);
    const archivePath = safeArchivePath(record.archive_path, `${field}.archive_path`);
    requireValue(archivePath.startsWith("images/"), `${field}.archive_path must be inside images/.`);
    requireValue(!seenIndices.has(index), `Duplicate image index: ${index}.`);
    requireValue(!seenKeys.has(key), `Duplicate image key: ${key}.`);
    requireValue(!seenPaths.has(archivePath), `Duplicate image path: ${archivePath}.`);
    seenIndices.add(index);
    seenKeys.add(key);
    seenPaths.add(archivePath);
    return { ...record, index, key, archive_path: archivePath };
  }).sort((left, right) => left.index - right.index);
  requireValue(images.files.every((record, index) => record.index === index), "Image indices must be contiguous and zero-based.");
  requireValue(
    Array.isArray(images.order) && images.order.every((key, index) => key === images.files[index].key),
    "images.order does not match images.files.",
  );

  requireValue(Array.isArray(manifest.objects) && manifest.objects.length > 0, "objects must contain at least one object.");
  const objectIds = new Set();
  manifest.objects = manifest.objects.map((object, position) => {
    const field = `objects[${position}]`;
    requireValue(object && typeof object === "object", `${field} must be an object.`);
    const id = integer(object.id, `${field}.id`, 1);
    requireValue(id <= 255, `${field}.id exceeds the uint8 label limit.`);
    requireValue(!objectIds.has(id), `Duplicate object id: ${id}.`);
    objectIds.add(id);
    requireValue(typeof object.name === "string" && object.name.trim(), `${field}.name is missing.`);
    const promptFrame = integer(object.prompt_frame, `${field}.prompt_frame`, 0);
    const trackingStart = integer(object.tracking_start, `${field}.tracking_start`, 0);
    const trackingEnd = integer(object.tracking_end, `${field}.tracking_end`, 0);
    requireValue(trackingEnd < count, `${field}.tracking_end is outside the image sequence.`);
    requireValue(trackingStart <= promptFrame && promptFrame <= trackingEnd, `${field}.prompt_frame must be inside its tracking range.`);
    const box = normalizedBox(object.box, `${field}.box`, width, height);
    requireValue(Array.isArray(object.prompts) && object.prompts.length > 0, `${field}.prompts must contain the box prompt.`);
    const primary = object.prompts.find((prompt) => prompt && prompt.type === "box");
    requireValue(primary, `${field}.prompts does not contain a box prompt.`);
    requireValue(primary.frame === promptFrame, `${field}.prompts box frame does not match prompt_frame.`);
    const promptBox = normalizedBox(primary.box, `${field}.prompts box`, width, height);
    requireValue(promptBox.every((value, index) => value === box[index]), `${field}.prompts box does not match box.`);
    return {
      ...object,
      id,
      name: object.name.trim(),
      prompt_frame: promptFrame,
      box,
      tracking_start: trackingStart,
      tracking_end: trackingEnd,
      prompts: object.prompts.map((prompt) => prompt === primary ? { ...prompt, box: promptBox } : prompt),
    };
  });

  if (manifest.kind === SEGMENTATION_RESULT_KIND) {
    requireValue(manifest.result && typeof manifest.result === "object", "result is missing from the result manifest.");
    requireValue(manifest.result.mask_format === "single-label-uint8-png", "Unsupported result mask format.");
    requireValue(
      Array.isArray(manifest.result.masks) && manifest.result.masks.length === count,
      "result.masks must contain one mask per image.",
    );
    manifest.result.masks = manifest.result.masks.map((record, position) => {
      const field = `result.masks[${position}]`;
      requireValue(record && typeof record === "object", `${field} must be an object.`);
      requireValue(record.index === images.files[position].index, `${field}.index does not match its image.`);
      requireValue(record.key === images.files[position].key, `${field}.key does not match its image.`);
      const archivePath = safeArchivePath(record.archive_path, `${field}.archive_path`);
      requireValue(archivePath.startsWith("masks/"), `${field}.archive_path must be inside masks/.`);
      return { ...record, archive_path: archivePath };
    });
  }
  return manifest;
}

export function createSegmentationJobManifest({ images, objects, source = {}, createdBy = {} }) {
  requireValue(Array.isArray(images) && images.length > 0, "No images were provided.");
  const width = integer(images[0].width, "images[0].width", 1);
  const height = integer(images[0].height, "images[0].height", 1);
  const files = images.map((image, index) => {
    requireValue(image.width === width && image.height === height, `Image size mismatch at frame ${index + 1}.`);
    const key = String(index + 1).padStart(4, "0");
    return {
      index,
      key,
      original_filename: String(image.originalFilename || image.name || `image${key}.jpg`),
      working_filename: String(image.workingFilename || `image${key}.jpg`),
      archive_path: `images/${String(index + 1).padStart(6, "0")}.jpg`,
    };
  });
  const normalizedObjects = objects.map((object) => {
    const box = object.box.map(Number);
    const promptFrame = Number(object.promptFrame);
    return {
      id: Number(object.id),
      name: String(object.name || `Object ${object.id}`).trim(),
      prompt_frame: promptFrame,
      box,
      tracking_start: Number(object.trackingStart),
      tracking_end: Number(object.trackingEnd),
      prompts: [{ type: "box", frame: promptFrame, box: box.slice() }],
    };
  });
  return validateSegmentationManifest({
    format_version: SEGMENTATION_FORMAT_VERSION,
    kind: SEGMENTATION_JOB_KIND,
    frame_index_base: 0,
    created_by: {
      application: String(createdBy.application || "SegRef3D Lite Web"),
      version: String(createdBy.version || "web"),
    },
    source: structuredClone(source),
    images: {
      count: files.length,
      width,
      height,
      order: files.map((record) => record.key),
      files,
    },
    objects: normalizedObjects,
  }, SEGMENTATION_JOB_KIND);
}

export function validateSegmentationArchive(entries, expectedKind) {
  requireValue(Array.isArray(entries), "ZIP entries are missing.");
  const entriesByPath = new Map();
  for (const entry of entries) {
    const path = safeArchivePath(entry.name);
    requireValue(!entriesByPath.has(path), `Duplicate ZIP member: ${path}.`);
    entriesByPath.set(path, entry);
  }
  const manifestEntry = entriesByPath.get("manifest.json");
  requireValue(manifestEntry, "manifest.json is missing from the ZIP.");
  let source;
  try {
    source = JSON.parse(new TextDecoder().decode(manifestEntry.bytes));
  } catch (error) {
    throw new Error(`manifest.json is invalid: ${error.message}`);
  }
  const manifest = validateSegmentationManifest(source, expectedKind);
  for (const record of manifest.images.files) {
    requireValue(entriesByPath.has(record.archive_path), `Image file is missing from the ZIP: ${record.archive_path}.`);
  }
  if (manifest.kind === SEGMENTATION_RESULT_KIND) {
    for (const record of manifest.result.masks) {
      requireValue(entriesByPath.has(record.archive_path), `Result mask is missing: ${record.archive_path}.`);
    }
  }
  return { manifest, entriesByPath };
}
