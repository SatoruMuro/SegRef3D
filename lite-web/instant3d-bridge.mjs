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
  requireValue(Array.isArray(objects) && objects.length >= 1, "Select at least one anatomical structure.");
  const allowed = new Map(
    catalog.structures
      .filter((item) => !item.license_required)
      .map((item) => [`${item.task}/${item.roi}`, item]),
  );
  const groups = new Map(
    (catalog.groups || [])
      .filter((item) => !item.license_required)
      .map((item) => [item.id, item]),
  );
  const usedIds = new Map();
  const usedStructures = new Map();
  const normalized = [];

  function addStructure(raw, index, selectionGroup = null, assignmentName = null) {
    const objectId = Number(raw.object_id);
    const key = `${raw.task}/${raw.roi}`;
    requireValue(Number.isInteger(objectId) && objectId >= 1 && objectId <= 20,
      `Object ${index + 1} has an invalid object ID.`);
    const catalogItem = allowed.get(key);
    requireValue(catalogItem, `Unsupported or license-restricted structure: ${key}.`);

    selectionGroup = String(selectionGroup || raw.selection_group || "") || null;
    if (selectionGroup) {
      const group = groups.get(selectionGroup);
      requireValue(group && raw.task === group.task && group.members.includes(raw.roi),
        `Invalid catalog group member: ${selectionGroup}/${key}.`);
      assignmentName = String(assignmentName || raw.assignment_name || group.display_name);
    }
    if (usedStructures.has(key)) {
      requireValue(usedStructures.get(key) === objectId, `Duplicate anatomical structure: ${raw.roi}.`);
      return;
    }
    requireValue(!usedIds.has(objectId) || (selectionGroup && usedIds.get(objectId) === selectionGroup),
      `Duplicate object ID: Obj${objectId}.`);
    if (!usedIds.has(objectId)) usedIds.set(objectId, selectionGroup);
    usedStructures.set(key, objectId);
    const item = {
      object_id: objectId,
      display_name: String(raw.display_name || catalogItem.display_name),
      task: String(raw.task),
      roi: String(raw.roi),
    };
    if (selectionGroup) {
      item.selection_group = selectionGroup;
      item.assignment_name = assignmentName;
    }
    normalized.push(item);
  }

  objects.forEach((raw, index) => {
    requireValue(raw && typeof raw === "object", `Object ${index + 1} is invalid.`);
    const groupId = String(raw.group || "");
    if (!groupId) {
      addStructure(raw, index);
      return;
    }
    const group = groups.get(groupId);
    requireValue(group, `Unsupported or license-restricted catalog group: ${groupId}.`);
    for (const roi of group.members) {
      const catalogItem = allowed.get(`${group.task}/${roi}`);
      requireValue(catalogItem, `Invalid catalog group member: ${groupId}/${group.task}/${roi}.`);
      addStructure({
        object_id: raw.object_id,
        display_name: catalogItem.display_name,
        task: group.task,
        roi,
      }, index, groupId, group.display_name);
    }
  });
  requireValue(normalized.length <= allowed.size, "Too many anatomical structures were selected.");
  return normalized;
}

export function collapseInstant3DObjects(objects, catalog) {
  const groups = new Map((catalog.groups || []).map((item) => [item.id, item]));
  const collapsed = [];
  const seenGroups = new Set();
  for (const item of validateInstant3DObjects(objects, catalog)) {
    if (item.selection_group) {
      const key = `${item.object_id}/${item.selection_group}`;
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
      const group = groups.get(item.selection_group);
      collapsed.push({
        object_id: item.object_id,
        display_name: item.assignment_name || group.display_name,
        group: item.selection_group,
      });
    } else {
      collapsed.push({
        object_id: item.object_id,
        display_name: item.display_name,
        task: item.task,
        roi: item.roi,
      });
    }
  }
  return collapsed.sort((left, right) => left.object_id - right.object_id);
}

export async function sha256Hex(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function createInstant3DRequest({ source, objects, catalog, fast = false }) {
  requireValue(source?.format === "nifti" && source.bytes, "Seg CT/MRI requires a compatible CT/MRI NIfTI volume.");
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
    "This ZIP uses an unsupported Seg CT/MRI bridge schema.");
  requireValue(manifest.status === "success", "Instant3D result status is not success.");
  manifest.objects = validateInstant3DObjects(manifest.objects, catalog);
  requireValue(currentSource?.format === "nifti", "Load the original NIfTI volume before importing its result.");
  const mismatches = geometryMismatches(manifest.source, currentSource);
  requireValue(mismatches.length === 0,
    `Seg CT/MRI result does not match the loaded volume: ${mismatches.join(", ")}.`);
  const labelmap = byName.get(INSTANT3D_LABELMAP);
  requireValue(labelmap, `${INSTANT3D_LABELMAP} is missing from the result ZIP.`);
  return { manifest, labelmap, entriesByName: byName };
}
