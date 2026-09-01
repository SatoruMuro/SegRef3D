import * as nifti from "./vendor/nifti-reader.js";
import { affineOrientation, parseNiftiLabelVolume } from "./medical-io.mjs?v=21";
import { makeVolumeGeometry, normalizeAffine, spacingFromAffine } from "./medical-geometry.mjs?v=2";
import { createNiftiLabelVolume } from "./volume-tools.mjs?v=17";
import { MASK_SLICE_ORDER } from "./mask-sequence.mjs?v=1";

export const TRAINING_CASE_FORMAT = "segref3d-training-case-1.0";
export const TRAINING_GEOMETRY_TOLERANCE = 1e-5;

const NIFTI_TYPES = Object.freeze({
  2: { name: "uint8", bytes: 1, read: "getUint8", write: "setUint8", integer: true },
  4: { name: "int16", bytes: 2, read: "getInt16", write: "setInt16", integer: true },
  8: { name: "int32", bytes: 4, read: "getInt32", write: "setInt32", integer: true },
  16: { name: "float32", bytes: 4, read: "getFloat32", write: "setFloat32", integer: false },
  64: { name: "float64", bytes: 8, read: "getFloat64", write: "setFloat64", integer: false },
  256: { name: "int8", bytes: 1, read: "getInt8", write: "setInt8", integer: true },
  512: { name: "uint16", bytes: 2, read: "getUint16", write: "setUint16", integer: true },
  768: { name: "uint32", bytes: 4, read: "getUint32", write: "setUint32", integer: true },
});

const TYPE_BY_ARRAY = new Map([
  [Uint8Array, 2],
  [Uint8ClampedArray, 2],
  [Int16Array, 4],
  [Int32Array, 8],
  [Float32Array, 16],
  [Float64Array, 64],
  [Int8Array, 256],
  [Uint16Array, 512],
  [Uint32Array, 768],
]);

function bytesView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("NIfTI data must be an ArrayBuffer or typed array.");
}

function exactArrayBuffer(value) {
  const bytes = bytesView(value);
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function headerAffine(header, spacing) {
  const candidate = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => Number(header.affine?.[row]?.[column])),
  );
  if (candidate.every((row) => row.every(Number.isFinite))) return normalizeAffine(candidate);
  return [
    [spacing[0], 0, 0, 0],
    [0, spacing[1], 0, 0],
    [0, 0, spacing[2], 0],
    [0, 0, 0, 1],
  ];
}

function typedDatatype(values, requested) {
  if (requested !== undefined && requested !== null) {
    const code = typeof requested === "number"
      ? requested
      : Number(Object.entries(NIFTI_TYPES).find(([, item]) => item.name === requested)?.[0]);
    if (NIFTI_TYPES[code]) return code;
    throw new Error(`Unsupported scalar NIfTI datatype: ${requested}.`);
  }
  const code = TYPE_BY_ARRAY.get(values?.constructor);
  if (!code) throw new Error("A supported typed array is required for scalar NIfTI export.");
  return code;
}

export function createTrainingCaseId(random = globalThis.crypto) {
  const bytes = new Uint8Array(4);
  if (random?.getRandomValues) random.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return `SR3D_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function isTrainingCaseId(value) {
  return /^SR3D_[a-f0-9]{8,32}$/i.test(String(value || ""));
}

export function geometryDifferences(left, right, tolerance = TRAINING_GEOMETRY_TOLERANCE) {
  const differences = [];
  const leftShape = left?.shape?.map(Number) || [];
  const rightShape = right?.shape?.map(Number) || [];
  if (leftShape.length !== 3 || rightShape.length !== 3 || leftShape.some((value, index) => value !== rightShape[index])) {
    differences.push(`shape ${leftShape.join("x")} != ${rightShape.join("x")}`);
  }
  const leftAffine = left?.affine;
  const rightAffine = right?.affine;
  if (!leftAffine || !rightAffine) {
    differences.push("affine is missing");
    return differences;
  }
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      if (Math.abs(Number(leftAffine[row]?.[column]) - Number(rightAffine[row]?.[column])) >= tolerance) {
        differences.push(`affine[${row}][${column}] differs`);
      }
    }
  }
  const leftSpacing = left.spacing || spacingFromAffine(leftAffine);
  const rightSpacing = right.spacing || spacingFromAffine(rightAffine);
  if (leftSpacing.some((value, index) => Math.abs(Number(value) - Number(rightSpacing[index])) >= tolerance)) {
    differences.push("spacing differs");
  }
  return [...new Set(differences)];
}

export function assertSameGeometry(left, right, description = "Image and label", tolerance) {
  const differences = geometryDifferences(left, right, tolerance);
  if (differences.length > 0) throw new Error(`${description} geometry mismatch: ${differences.join(", ")}.`);
}

export function createNiftiScalarVolume({ values, width, height, depth, geometry, datatype = null }) {
  const shape = [Number(width), Number(height), Number(depth)];
  if (shape.some((value) => !Number.isInteger(value) || value < 1)) throw new Error("Scalar volume dimensions are invalid.");
  const voxelCount = shape[0] * shape[1] * shape[2];
  const slices = Array.isArray(values) ? values : null;
  const suppliedVoxelCount = slices
    ? slices.reduce((sum, slice) => sum + Number(slice?.length || 0), 0)
    : Number(values?.length || 0);
  if (!values || suppliedVoxelCount !== voxelCount) throw new Error("Scalar voxel count does not match the volume dimensions.");
  const code = typedDatatype(values, datatype);
  const type = NIFTI_TYPES[code];
  const normalizedGeometry = makeVolumeGeometry({
    shape,
    affine: geometry?.affine,
    sourceKind: geometry?.sourceKind || "training-export",
  });
  const affine = normalizedGeometry.affine;
  const spacing = spacingFromAffine(affine);
  const output = new Uint8Array(352 + voxelCount * type.bytes);
  const view = new DataView(output.buffer);
  view.setInt32(0, 348, true);
  view.setInt16(40, 3, true);
  view.setInt16(42, shape[0], true);
  view.setInt16(44, shape[1], true);
  view.setInt16(46, shape[2], true);
  for (let index = 4; index < 8; index += 1) view.setInt16(40 + index * 2, 1, true);
  view.setInt16(70, code, true);
  view.setInt16(72, type.bytes * 8, true);
  view.setFloat32(76, 1, true);
  spacing.forEach((value, index) => view.setFloat32(80 + index * 4, value, true));
  view.setFloat32(108, 352, true);
  view.setFloat32(112, 1, true);
  view.setFloat32(116, 0, true);
  view.setUint8(123, 2);
  view.setInt16(252, 0, true);
  view.setInt16(254, 1, true);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      view.setFloat32(280 + row * 16 + column * 4, affine[row][column], true);
    }
  }
  output.set([0x6e, 0x2b, 0x31, 0], 344);
  if (code === 2 && values instanceof Uint8Array) output.set(values, 352);
  else if (code === 2 && slices?.every((slice) => slice instanceof Uint8Array)) {
    let offset = 352;
    for (const slice of slices) {
      output.set(slice, offset);
      offset += slice.length;
    }
  }
  else {
    let sliceIndex = 0;
    let indexInSlice = 0;
    for (let index = 0; index < voxelCount; index += 1) {
      const offset = 352 + index * type.bytes;
      const value = slices ? slices[sliceIndex][indexInSlice] : values[index];
      if (type.bytes === 1) view[type.write](offset, value);
      else view[type.write](offset, value, true);
      if (slices) {
        indexInSlice += 1;
        if (indexInSlice === slices[sliceIndex].length) {
          sliceIndex += 1;
          indexInSlice = 0;
        }
      }
    }
  }
  return output;
}

export function readNiftiTrainingVolume(input, { includeValues = true } = {}) {
  let data = exactArrayBuffer(input);
  const compressed = nifti.isCompressed(data);
  if (compressed) data = nifti.decompress(data);
  if (!nifti.isNIFTI(data)) throw new Error("Training image is not a valid NIfTI volume.");
  const header = nifti.readHeader(data);
  const shape = [1, 2, 3].map((index) => Number(header.dims[index]));
  if (Number(header.dims[0]) < 3 || shape.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error("Training image is not a valid 3D NIfTI volume.");
  }
  if (Number(header.dims[0]) > 3 && Number(header.dims[4] || 1) > 1) {
    throw new Error("4D NIfTI volumes cannot be exported as one training case.");
  }
  const voxelCount = shape[0] * shape[1] * shape[2];
  const datatypeCode = Number(header.datatypeCode);
  const colorChannels = datatypeCode === 128 ? 3 : datatypeCode === 2304 ? 4 : 0;
  const type = NIFTI_TYPES[datatypeCode];
  if (!type && colorChannels === 0) throw new Error(`Unsupported training NIfTI datatype ${datatypeCode}.`);
  const image = nifti.readImage(header, data);
  const spacing = [1, 2, 3].map((index) => Math.abs(Number(header.pixDims[index])) || 1);
  const affine = headerAffine(header, spacing);
  const geometry = makeVolumeGeometry({ shape, affine, sourceKind: "nifti" });
  const slopeValue = Number(header.scl_slope);
  const interceptValue = Number(header.scl_inter);
  const slope = Number.isFinite(slopeValue) && slopeValue !== 0 ? slopeValue : 1;
  const intercept = Number.isFinite(interceptValue) ? interceptValue : 0;
  const result = {
    shape,
    width: shape[0],
    height: shape[1],
    depth: shape[2],
    geometry,
    spacing: geometry.spacing,
    affine: geometry.affine,
    orientation: affineOrientation(geometry.affine),
    datatype: colorChannels ? (colorChannels === 3 ? "rgb24" : "rgba32") : type.name,
    datatypeCode,
    channelCount: colorChannels || 1,
    compressed,
    integer: Boolean(type?.integer && slope === 1 && intercept === 0),
  };
  if (!includeValues) return result;
  if (colorChannels) {
    const source = new Uint8Array(image);
    result.channels = Array.from({ length: 3 }, () => new Uint8Array(voxelCount));
    for (let index = 0; index < voxelCount; index += 1) {
      result.channels[0][index] = source[index * colorChannels];
      result.channels[1][index] = source[index * colorChannels + 1];
      result.channels[2][index] = source[index * colorChannels + 2];
    }
    return result;
  }
  const view = new DataView(image);
  const littleEndian = header.littleEndian !== false;
  const values = new Float64Array(voxelCount);
  for (let index = 0; index < voxelCount; index += 1) {
    const offset = index * type.bytes;
    const raw = type.bytes === 1 ? view[type.read](offset) : view[type.read](offset, littleEndian);
    values[index] = raw * slope + intercept;
  }
  result.values = values;
  result.integer = type.integer && slope === 1 && intercept === 0;
  return result;
}

async function workingRgbaChannels(images, width, height, onProgress) {
  const sliceSize = width * height;
  let grayscale = true;
  for (const image of images) {
    for (let offset = 0; offset < image.basePixels.length; offset += 4) {
      if (image.basePixels[offset] !== image.basePixels[offset + 1] || image.basePixels[offset] !== image.basePixels[offset + 2]) {
        grayscale = false;
        break;
      }
    }
    if (!grayscale) break;
  }
  const channelCount = grayscale ? 1 : 3;
  const values = Array.from({ length: channelCount }, () => new Uint8Array(sliceSize * images.length));
  for (let z = 0; z < images.length; z += 1) {
    const pixels = images[z].basePixels;
    const targetStart = z * sliceSize;
    for (let index = 0; index < sliceSize; index += 1) {
      const source = index * 4;
      values[0][targetStart + index] = pixels[source];
      if (!grayscale) {
        values[1][targetStart + index] = pixels[source + 1];
        values[2][targetStart + index] = pixels[source + 2];
      }
    }
    onProgress(`Encoding image volume ${z + 1} / ${images.length}`);
    if (z % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return values.map((channel, index) => ({
    name: grayscale ? "scalar" : ["red", "green", "blue"][index],
    values: channel,
    datatype: "uint8",
  }));
}

export async function prepareTrainingSourceChannels({
  sourceVolume = null,
  images,
  width,
  height,
  geometry,
  onProgress = () => {},
}) {
  const shape = [width, height, images.length];
  if (sourceVolume?.format === "nifti") {
    onProgress("Reading original NIfTI voxels");
    const metadata = readNiftiTrainingVolume(sourceVolume.bytes, { includeValues: false });
    if (metadata.shape.some((value, index) => value !== shape[index])) {
      throw new Error(
        "The original NIfTI grid was resized for editing, so its voxels no longer match the mask. Reload without resizing before Training Data export.",
      );
    }
    const differences = geometryDifferences(metadata.geometry, geometry);
    if (metadata.channelCount === 1 && differences.length === 0) {
      return {
        channels: [{
          name: "scalar",
          encodedBytes: sourceVolume.bytes,
          compressed: metadata.compressed,
          datatype: metadata.datatype,
        }],
        intensityPolicy: "original_scalar",
      };
    }
    const parsed = readNiftiTrainingVolume(sourceVolume.bytes);
    if (parsed.channelCount === 1) {
      return {
        channels: [{ name: "scalar", values: parsed.values, datatype: "float64" }],
        intensityPolicy: "original_scalar_reencoded_with_working_geometry",
        warnings: ["The source scalar voxels were preserved losslessly, but the NIfTI header was re-encoded to match edited working geometry."],
      };
    }
    return {
      channels: parsed.channels.map((values, index) => ({
        name: ["red", "green", "blue"][index], values, datatype: "uint8",
      })),
      intensityPolicy: "original_rgb_channels",
    };
  }

  const sourceFormat = images[0]?.sourceFormat || "raster";
  if (sourceFormat === "dicom") {
    const unavailable = images.find((image) => image.trainingUnavailableReason);
    if (unavailable) throw new Error(unavailable.trainingUnavailableReason);
    if (images.every((image) => image.trainingKind === "scalar" && image.trainingPixels)) {
      return {
        channels: [{
          name: "scalar",
          values: images.map((image) => image.trainingPixels),
          datatype: "float32",
        }],
        intensityPolicy: "dicom_rescale_slope_intercept_float32",
      };
    }
    if (images.every((image) => image.trainingKind === "rgba" && image.trainingPixels)) {
      return {
        channels: await workingRgbaChannels(images, width, height, onProgress),
        intensityPolicy: "dicom_rgb_8bit",
      };
    }
    throw new Error("DICOM training export cannot mix monochrome and color frames in one case.");
  }

  const channels = await workingRgbaChannels(images, width, height, onProgress);
  const highBitDepth = images.reduce((maximum, image) => Math.max(maximum, Number(image.sourceBitDepth) || 8), 8);
  return {
    channels,
    intensityPolicy: highBitDepth > 8
      ? "working_8bit_from_high_bit_depth_source"
      : channels.length === 1 ? "working_grayscale_8bit" : "working_rgb_8bit",
    warnings: highBitDepth > 8
      ? [`${highBitDepth}-bit source values were not retained by the current loader; this export contains the explicitly accepted 8-bit working-grid values.`]
      : [],
  };
}

function labelsInMasks(masks) {
  const labels = new Set();
  for (const mask of masks) for (const value of mask) if (value !== 0) labels.add(Number(value));
  return [...labels].sort((left, right) => left - right);
}

function normalizedObjects(labelIds, objectNames) {
  return labelIds.map((id) => ({ id, name: String(objectNames?.[id] || `Object ${id}`).slice(0, 80) }));
}

function entry(name, bytes, type = "application/octet-stream") {
  return { name, blob: new Blob([bytes], { type }) };
}

export function validateTrainingCaseFiles({ manifest, files, tolerance = TRAINING_GEOMETRY_TOLERANCE }) {
  if (manifest?.format !== TRAINING_CASE_FORMAT) throw new Error("Training manifest format is invalid.");
  if (!isTrainingCaseId(manifest.case_id)) throw new Error("Training manifest case_id is invalid.");
  if (!files.has("manifest.json")) throw new Error("Training ZIP is missing manifest.json.");
  const labelBytes = files.get(manifest.label?.file);
  if (!labelBytes) throw new Error("Training ZIP is missing the declared label file.");
  if (!new RegExp(`^labelsTr/${manifest.case_id}\\.nii(?:\\.gz)?$`).test(manifest.label.file)) {
    throw new Error("Training label filename does not match case_id.");
  }
  const labelMetadata = readNiftiTrainingVolume(labelBytes, { includeValues: false });
  if (!labelMetadata.integer || labelMetadata.datatype !== "uint8") {
    throw new Error("Training label NIfTI must use an integer uint8 datatype.");
  }
  const label = parseNiftiLabelVolume(exactArrayBuffer(labelBytes), manifest.label.file);
  const labelGeometry = makeVolumeGeometry({ shape: label.shape, affine: label.affine, sourceKind: "label" });
  const manifestGeometry = makeVolumeGeometry({
    shape: manifest.geometry?.shape,
    affine: manifest.geometry?.affine,
    sourceKind: "manifest",
  });
  assertSameGeometry(labelGeometry, manifestGeometry, "Label and manifest", tolerance);
  if (manifest.geometry.orientation !== affineOrientation(labelGeometry.affine)) {
    throw new Error("Training manifest orientation does not match the label affine.");
  }
  const channels = manifest.image?.channels;
  if (!Array.isArray(channels) || channels.length < 1 || channels.length !== manifest.image.channel_count) {
    throw new Error("Training manifest channel count is invalid.");
  }
  channels.forEach((channel, index) => {
    if (channel.index !== index || !channel.file.includes(`${manifest.case_id}_${String(index).padStart(4, "0")}.nii`)) {
      throw new Error("Training manifest channel filename or index is invalid.");
    }
    const bytes = files.get(channel.file);
    if (!bytes) throw new Error(`Training ZIP is missing image channel ${index}.`);
    const parsed = readNiftiTrainingVolume(bytes, { includeValues: false });
    if (parsed.channelCount !== 1) throw new Error(`Training image channel ${index} is not scalar.`);
    assertSameGeometry(parsed.geometry, labelGeometry, `Image channel ${index} and label`, tolerance);
  });
  const actualLabels = labelsInMasks(label.frames);
  const declaredLabels = (manifest.label.objects || []).map((item) => Number(item.id)).sort((a, b) => a - b);
  if (actualLabels.length !== declaredLabels.length || actualLabels.some((value, index) => value !== declaredLabels[index])) {
    throw new Error("Training manifest label IDs do not match the labelmap.");
  }
  if (manifest.label.datatype !== "uint8") throw new Error("Training label datatype must be integer uint8.");
  return { label, channelCount: channels.length, labels: actualLabels };
}

export function createTrainingCaseEntries({
  caseId,
  sourceFormat,
  channels,
  masks,
  width,
  height,
  geometry,
  objectNames = [],
  intensityPolicy,
  warnings = [],
}) {
  if (!isTrainingCaseId(caseId)) throw new Error("Training case_id must be a random SR3D identifier.");
  if (!Array.isArray(channels) || ![1, 3].includes(channels.length)) throw new Error("Training images require one scalar or three RGB channels.");
  const shape = [Number(width), Number(height), masks?.length || 0];
  const labelGeometry = makeVolumeGeometry({ shape, affine: geometry?.affine, sourceKind: geometry?.sourceKind || "training" });
  const labelIds = labelsInMasks(masks);
  const labelBytes = createNiftiLabelVolume(masks, width, height, labelGeometry);
  const files = new Map();
  const entries = [];
  const manifestChannels = [];
  channels.forEach((channel, index) => {
    let bytes;
    let extension = "nii";
    let datatype = channel.datatype || null;
    if (channel.encodedBytes) {
      bytes = bytesView(channel.encodedBytes);
      extension = channel.compressed ? "nii.gz" : "nii";
      const parsed = readNiftiTrainingVolume(bytes, { includeValues: false });
      datatype = datatype || parsed.datatype;
      assertSameGeometry(parsed.geometry, labelGeometry, `Image channel ${index} and label`);
      if (parsed.channelCount !== 1) throw new Error("Encoded training channels must contain scalar NIfTI volumes.");
    } else {
      bytes = createNiftiScalarVolume({
        values: channel.values,
        width,
        height,
        depth: masks.length,
        geometry: labelGeometry,
        datatype: channel.datatype,
      });
      datatype = readNiftiTrainingVolume(bytes, { includeValues: false }).datatype;
    }
    const name = `imagesTr/${caseId}_${String(index).padStart(4, "0")}.${extension}`;
    files.set(name, bytes);
    entries.push(entry(name, bytes));
    manifestChannels.push({ index, name: channel.name || (channels.length === 1 ? "scalar" : ["red", "green", "blue"][index]), file: name, datatype });
  });
  const labelName = `labelsTr/${caseId}.nii`;
  files.set(labelName, labelBytes);
  entries.push(entry(labelName, labelBytes));
  const manifest = {
    format: TRAINING_CASE_FORMAT,
    case_id: caseId,
    created_by: "SegRef3D Lite",
    image: {
      source_format: String(sourceFormat || "unknown").toLowerCase(),
      channel_count: channels.length,
      channels: manifestChannels,
      intensity_policy: intensityPolicy,
    },
    label: {
      file: labelName,
      datatype: "uint8",
      slice_index_base: 1,
      slice_order: MASK_SLICE_ORDER,
      objects: normalizedObjects(labelIds, objectNames),
    },
    geometry: {
      shape,
      spacing_mm: labelGeometry.spacing,
      origin_mm: labelGeometry.origin,
      orientation: affineOrientation(labelGeometry.affine),
      affine: labelGeometry.affine,
    },
    privacy: {
      dicom_headers_included: false,
      patient_identifiers_in_manifest: false,
      image_data_may_be_identifiable: true,
      processing: "browser_local",
    },
  };
  if (warnings.length > 0) manifest.warnings = warnings.map(String);
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  files.set("manifest.json", manifestBytes);
  entries.push(entry("manifest.json", manifestBytes, "application/json"));
  validateTrainingCaseFiles({ manifest, files });
  return { entries, manifest, emptyMask: labelIds.length === 0 };
}
