import { safeArchivePath } from "./segmentation-job.mjs?v=25";

export const INSTANT3D_SCHEMA = "segref3d-instant3d-bridge";
export const INSTANT3D_SCHEMA_VERSION = "1.0";
export const INSTANT3D_LABELMAP = "labelmap/labels.nii.gz";

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function closeNumber(left, right, tolerance = 1e-5) {
  return Number.isFinite(Number(left)) && Math.abs(Number(left) - Number(right)) <= tolerance;
}

export function validateInstant3DObjects(objects, catalog) {
  requireValue(Array.isArray(objects) && objects.length >= 1 && objects.length <= 20,
    "Select between 1 and 20 anatomical structures.");
  const allowed = new Map(
    catalog.structures
      .filter((item) => !item.license_required)
      .map((item) => [`${item.task}/${item.roi}`, item]),
  );
  const usedIds = new Set();
  const usedStructures = new Set();
  return objects.map((raw, index) => {
    const objectId = Number(raw.object_id);
    const key = `${raw.task}/${raw.roi}`;
    requireValue(Number.isInteger(objectId) && objectId >= 1 && objectId <= 20,
      `Object ${index + 1} has an invalid object ID.`);
    requireValue(!usedIds.has(objectId), `Duplicate object ID: Obj${objectId}.`);
    requireValue(!usedStructures.has(key), `Duplicate anatomical structure: ${raw.roi}.`);
    const catalogItem = allowed.get(key);
    requireValue(catalogItem, `Unsupported or license-restricted structure: ${key}.`);
    usedIds.add(objectId);
    usedStructures.add(key);
    return {
      object_id: objectId,
      display_name: String(raw.display_name || catalogItem.display_name),
      task: String(raw.task),
      roi: String(raw.roi),
    };
  });
}

export async function sha256Hex(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function createInstant3DRequest({ source, objects, catalog, fast = false }) {
  requireValue(source?.format === "nifti" && source.bytes, "Instant3DWeb2 requires a compatible CT NIfTI volume.");
  requireValue(catalog?.schema_version === INSTANT3D_SCHEMA_VERSION, "The ROI catalog is unavailable or unsupported.");
  const normalizedObjects = validateInstant3DObjects(objects, catalog);
  const extension = source.filename.toLowerCase().endsWith(".nii.gz") ? ".nii.gz" : ".nii";
  const sourceFilename = `source${extension}`;
  const checksum = source.sha256 || await sha256Hex(source.bytes);
  const manifest = {
    schema: INSTANT3D_SCHEMA,
    schema_version: INSTANT3D_SCHEMA_VERSION,
    request_id: globalThis.crypto.randomUUID(),
    source: {
      filename: sourceFilename,
      modality: "CT",
      shape: [...source.shape],
      voxel_spacing_mm: [...source.spacing],
      orientation: source.orientation,
      affine: source.affine.map((row) => [...row]),
      sha256: checksum,
    },
    objects: normalizedObjects,
    options: { fast: Boolean(fast) },
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const sourceBytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes);
  return {
    manifest,
    entries: [
      { name: "manifest.json", bytes: manifestBytes, blob: new Blob([manifestBytes]) },
      { name: `image/${sourceFilename}`, bytes: sourceBytes, blob: new Blob([sourceBytes]) },
    ],
  };
}

export function geometryMismatches(expected, actual, { includeChecksum = true } = {}) {
  const mismatches = [];
  if (JSON.stringify(expected.shape) !== JSON.stringify(actual.shape)) mismatches.push("dimensions");
  if (!Array.isArray(expected.voxel_spacing_mm) || !expected.voxel_spacing_mm.every(
    (value, index) => closeNumber(value, actual.spacing[index]),
  )) mismatches.push("voxel spacing");
  const affineMatches = Array.isArray(expected.affine) && expected.affine.every(
    (row, y) => Array.isArray(row) && row.every((value, x) => closeNumber(value, actual.affine[y]?.[x], 1e-4)),
  );
  if (!affineMatches) mismatches.push("affine/orientation");
  if (expected.orientation !== actual.orientation) mismatches.push("orientation");
  if (includeChecksum && expected.sha256 !== actual.sha256) mismatches.push("source checksum");
  return [...new Set(mismatches)];
}

export function validateInstant3DResult(entries, currentSource, catalog) {
  const byName = new Map();
  for (const entry of entries) {
    const name = safeArchivePath(entry.name, "Instant3D ZIP member");
    byName.set(name, entry);
  }
  const manifestEntry = byName.get("manifest.json");
  requireValue(manifestEntry, "manifest.json is missing from the result ZIP.");
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestEntry.bytes));
  } catch (error) {
    throw new Error(`manifest.json could not be read: ${error.message}`);
  }
  requireValue(manifest.schema === INSTANT3D_SCHEMA && manifest.schema_version === INSTANT3D_SCHEMA_VERSION,
    "This ZIP uses an unsupported Instant3D bridge schema.");
  requireValue(manifest.status === "success", "Instant3D result status is not success.");
  manifest.objects = validateInstant3DObjects(manifest.objects, catalog);
  requireValue(currentSource?.format === "nifti", "Load the original NIfTI volume before importing its result.");
  const mismatches = geometryMismatches(manifest.source, currentSource);
  requireValue(mismatches.length === 0,
    `Instant3D result does not match the loaded volume: ${mismatches.join(", ")}.`);
  const labelmap = byName.get(INSTANT3D_LABELMAP);
  requireValue(labelmap, `${INSTANT3D_LABELMAP} is missing from the result ZIP.`);
  return { manifest, labelmap, entriesByName: byName };
}
