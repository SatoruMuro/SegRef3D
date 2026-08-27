import * as nifti from "./vendor/nifti-reader.js";
import UTIF from "./vendor/utif.module.js";
import { dicomSeriesGeometry, makeVolumeGeometry } from "./medical-geometry.mjs?v=2";

const DICOM_UID = Object.freeze({
  implicitLittle: "1.2.840.10008.1.2",
  explicitLittle: "1.2.840.10008.1.2.1",
  explicitBig: "1.2.840.10008.1.2.2",
  deflatedLittle: "1.2.840.10008.1.2.1.99",
  jpegBaseline: "1.2.840.10008.1.2.4.50",
});

const NIFTI_SCALAR_TYPES = Object.freeze({
  2: { name: "uint8", bytes: 1, read: "getUint8" },
  4: { name: "int16", bytes: 2, read: "getInt16" },
  8: { name: "int32", bytes: 4, read: "getInt32" },
  16: { name: "float32", bytes: 4, read: "getFloat32" },
  64: { name: "float64", bytes: 8, read: "getFloat64" },
  256: { name: "int8", bytes: 1, read: "getInt8" },
  512: { name: "uint16", bytes: 2, read: "getUint16" },
  768: { name: "uint32", bytes: 4, read: "getUint32" },
});

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function filenameBase(name) {
  return name.replace(/\.nii(?:\.gz)?$/i, "").replace(/\.[^.]+$/, "") || "volume";
}

function ensureArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new Error("Medical image data must be an ArrayBuffer.");
}

function niftiAffine(header, spacing, origin) {
  const candidate = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => Number(header.affine?.[row]?.[column])),
  );
  if (candidate.every((row) => row.every(Number.isFinite))) return candidate;
  return [
    [spacing[0], 0, 0, origin[0]],
    [0, spacing[1], 0, origin[1]],
    [0, 0, spacing[2], origin[2]],
    [0, 0, 0, 1],
  ];
}

export function affineOrientation(affine) {
  const positive = ["R", "A", "S"];
  const negative = ["L", "P", "I"];
  const used = new Set();
  return [0, 1, 2].map((axis) => {
    const candidates = [0, 1, 2]
      .filter((world) => !used.has(world))
      .sort((left, right) => Math.abs(affine[right][axis]) - Math.abs(affine[left][axis]));
    const world = candidates[0];
    used.add(world);
    return affine[world][axis] >= 0 ? positive[world] : negative[world];
  }).join("");
}

function numericList(dataSet, tag) {
  const value = dataSet.string(tag);
  if (!value) return [];
  return value
    .split("\\")
    .map(Number)
    .filter(Number.isFinite);
}

function firstNumber(dataSet, tag, fallback = null) {
  return numericList(dataSet, tag)[0] ?? fallback;
}

function firstInteger(dataSet, tag, fallback = null) {
  const value = Number.parseInt(dataSet.string(tag) || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function uint16(dataSet, tag, fallback = null) {
  const value = dataSet.uint16(tag);
  return Number.isFinite(value) ? value : fallback;
}

function normalizedUid(value) {
  return (value || "").replace(/\0/g, "").trim();
}

function hasDicomPreamble(bytes) {
  return (
    bytes.length >= 132 &&
    bytes[128] === 0x44 &&
    bytes[129] === 0x49 &&
    bytes[130] === 0x43 &&
    bytes[131] === 0x4d
  );
}

function dicomSortCoordinate(position, orientation) {
  if (position.length < 3 || orientation.length < 6) return null;
  const row = orientation.slice(0, 3);
  const column = orientation.slice(3, 6);
  const normal = [
    row[1] * column[2] - row[2] * column[1],
    row[2] * column[0] - row[0] * column[2],
    row[0] * column[1] - row[1] * column[0],
  ];
  return position[0] * normal[0] + position[1] * normal[1] + position[2] * normal[2];
}

function parseDicomDataSet(bytes, parser) {
  if (!parser?.parseDicom) throw new Error("The bundled DICOM parser is unavailable.");
  if (hasDicomPreamble(bytes)) return { dataSet: parser.parseDicom(bytes), rawTransferSyntax: null };

  const attempts = [DICOM_UID.implicitLittle, DICOM_UID.explicitLittle, DICOM_UID.explicitBig];
  let lastError = null;
  for (const transferSyntax of attempts) {
    try {
      const dataSet = parser.parseDicom(bytes, { TransferSyntaxUID: transferSyntax });
      if (dataSet.elements.x00280010 && dataSet.elements.x00280011 && dataSet.elements.x7fe00010) {
        return { dataSet, rawTransferSyntax: transferSyntax };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`DICOM data set could not be parsed${lastError ? `: ${lastError}` : "."}`);
}

function dicomFrameName(name, frameIndex, frameCount) {
  if (frameCount === 1) return name;
  const base = name.replace(/\.[^.]+$/, "") || "dicom";
  return `${base}_frame${String(frameIndex + 1).padStart(4, "0")}`;
}

function validateDicomPixelFormat(instance) {
  const { bitsAllocated, samplesPerPixel, photometric } = instance;
  if (![8, 16].includes(bitsAllocated)) {
    throw new Error(`${instance.name}: ${bitsAllocated}-bit DICOM pixels are not supported.`);
  }
  if (samplesPerPixel === 1 && ["MONOCHROME1", "MONOCHROME2"].includes(photometric)) return;
  if (
    bitsAllocated === 8 &&
    samplesPerPixel === 3 &&
    ["RGB", "YBR_FULL"].includes(photometric)
  ) {
    return;
  }
  throw new Error(
    `${instance.name}: unsupported DICOM pixel format (${photometric}, ${samplesPerPixel} sample(s)).`,
  );
}

function pixelDataView(instance) {
  const bytes = instance.dataSet.byteArray;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function frameByteRange(instance, frameIndex) {
  const bytesPerSample = instance.bitsAllocated / 8;
  const frameBytes = instance.rows * instance.columns * instance.samplesPerPixel * bytesPerSample;
  const start = instance.pixelElement.dataOffset + frameIndex * frameBytes;
  const end = start + frameBytes;
  if (end > instance.dataSet.byteArray.byteLength) {
    throw new Error(`${instance.name}: pixel data is shorter than the declared frame size.`);
  }
  return { start, end, frameBytes };
}

function storedPixelValue(instance, view, byteOffset) {
  let raw =
    instance.bitsAllocated === 8
      ? view.getUint8(byteOffset)
      : view.getUint16(byteOffset, instance.littleEndian);
  const shift = Math.max(0, instance.highBit - instance.bitsStored + 1);
  raw = Math.floor(raw / 2 ** shift) % 2 ** instance.bitsStored;
  if (instance.pixelRepresentation === 1) {
    const signBit = 2 ** (instance.bitsStored - 1);
    if (raw >= signBit) raw -= 2 ** instance.bitsStored;
  }
  return raw * instance.rescaleSlope + instance.rescaleIntercept;
}

function dicomSeriesRange(instances) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const instance of instances) {
    if (instance.samplesPerPixel !== 1 || instance.compressed) continue;
    const view = pixelDataView(instance);
    const bytesPerSample = instance.bitsAllocated / 8;
    for (let frame = 0; frame < instance.frameCount; frame += 1) {
      const { start } = frameByteRange(instance, frame);
      const pixelCount = instance.rows * instance.columns;
      for (let index = 0; index < pixelCount; index += 1) {
        const value = storedPixelValue(instance, view, start + index * bytesPerSample);
        if (value < minimum) minimum = value;
        if (value > maximum) maximum = value;
      }
    }
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return { minimum: 0, maximum: 1 };
  return { minimum, maximum };
}

function windowedByte(value, windowCenter, windowWidth, range) {
  if (Number.isFinite(windowCenter) && Number.isFinite(windowWidth) && windowWidth > 1) {
    return clampByte(((value - (windowCenter - 0.5)) / (windowWidth - 1) + 0.5) * 255);
  }
  if (range.maximum === range.minimum) return range.maximum === 0 ? 0 : 255;
  return clampByte(((value - range.minimum) / (range.maximum - range.minimum)) * 255);
}

function decodeMonochromeFrame(instance, frameIndex, range, sharedWindow) {
  const view = pixelDataView(instance);
  const { start } = frameByteRange(instance, frameIndex);
  const pixelCount = instance.rows * instance.columns;
  const bytesPerSample = instance.bitsAllocated / 8;
  const pixels = new Uint8ClampedArray(pixelCount);
  const center = sharedWindow?.center ?? instance.windowCenter;
  const width = sharedWindow?.width ?? instance.windowWidth;
  for (let index = 0; index < pixelCount; index += 1) {
    const value = storedPixelValue(instance, view, start + index * bytesPerSample);
    const output = windowedByte(value, center, width, range);
    pixels[index] = instance.photometric === "MONOCHROME1" ? 255 - output : output;
  }
  return { kind: "gray", pixels };
}

function decodeColorFrame(instance, frameIndex) {
  const bytes = instance.dataSet.byteArray;
  const { start } = frameByteRange(instance, frameIndex);
  const pixelCount = instance.rows * instance.columns;
  const output = new Uint8ClampedArray(pixelCount * 4);
  const planeSize = pixelCount;
  for (let index = 0; index < pixelCount; index += 1) {
    const source =
      instance.planarConfiguration === 1
        ? [bytes[start + index], bytes[start + planeSize + index], bytes[start + planeSize * 2 + index]]
        : [bytes[start + index * 3], bytes[start + index * 3 + 1], bytes[start + index * 3 + 2]];
    let [red, green, blue] = source;
    if (instance.photometric === "YBR_FULL") {
      const y = red;
      const cb = green - 128;
      const cr = blue - 128;
      red = clampByte(y + 1.402 * cr);
      green = clampByte(y - 0.344136 * cb - 0.714136 * cr);
      blue = clampByte(y + 1.772 * cb);
    }
    const target = index * 4;
    output[target] = red;
    output[target + 1] = green;
    output[target + 2] = blue;
    output[target + 3] = 255;
  }
  return { kind: "rgba", pixels: output };
}

function sharedDicomWindow(instances) {
  const item = instances.find(
    (instance) => Number.isFinite(instance.windowCenter) && instance.windowWidth > 1,
  );
  return item ? { center: item.windowCenter, width: item.windowWidth } : null;
}

export function isNiftiFilename(name) {
  return /\.nii(?:\.gz)?$/i.test(name);
}

export function isTiffFilename(name) {
  return /\.tiff?$/i.test(name);
}

export function parseTiffStack(input, fileName = "stack.tiff") {
  const data = ensureArrayBuffer(input);
  let ifds;
  try {
    ifds = UTIF.decode(data);
  } catch (error) {
    throw new Error(`${fileName} is not a valid TIFF file: ${error.message}`);
  }
  if (!Array.isArray(ifds) || ifds.length === 0) {
    throw new Error(`${fileName} contains no TIFF image pages.`);
  }
  const width = Number(ifds[0].width || ifds[0].t256?.[0]);
  const height = Number(ifds[0].height || ifds[0].t257?.[0]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`${fileName} has invalid TIFF dimensions.`);
  }
  const totalPixels = width * height * ifds.length;
  if (!Number.isSafeInteger(totalPixels) || totalPixels > 300_000_000) {
    throw new Error(`${fileName} is too large to process safely in this browser.`);
  }
  const base = filenameBase(fileName);
  const frames = ifds.map((ifd, index) => {
    const pageWidth = Number(ifd.width || ifd.t256?.[0]);
    const pageHeight = Number(ifd.height || ifd.t257?.[0]);
    if (pageWidth !== width || pageHeight !== height) {
      throw new Error(`${fileName} page ${index + 1} dimensions do not match the first page.`);
    }
    try {
      UTIF.decodeImage(data, ifd, ifds);
    } catch (error) {
      throw new Error(`${fileName} page ${index + 1} could not be decoded: ${error.message}`);
    }
    const rgba = UTIF.toRGBA8(ifd);
    if (!(rgba instanceof Uint8Array) || rgba.length !== width * height * 4) {
      throw new Error(`${fileName} page ${index + 1} returned invalid pixel data.`);
    }
    const samples = Number(ifd.t277?.[0] || 1);
    const photometric = Number(ifd.t262?.[0] ?? 1);
    const color = samples >= 3 || photometric === 2 || photometric === 3 || photometric === 5 || photometric === 6;
    if (color) {
      return {
        name: `${base}_slice${String(index + 1).padStart(4, "0")}.png`,
        width,
        height,
        kind: "rgba",
        pixels: new Uint8ClampedArray(rgba),
      };
    }
    const pixels = new Uint8ClampedArray(width * height);
    for (let pixel = 0; pixel < pixels.length; pixel += 1) pixels[pixel] = rgba[pixel * 4];
    return {
      name: `${base}_slice${String(index + 1).padStart(4, "0")}.png`,
      width,
      height,
      kind: "gray",
      pixels,
    };
  });
  return {
    format: "tiff",
    name: fileName,
    width,
    height,
    depth: frames.length,
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    frames,
  };
}

export function parseNiftiVolume(input, fileName = "volume.nii") {
  let data = ensureArrayBuffer(input);
  if (nifti.isCompressed(data)) data = nifti.decompress(data);
  if (!nifti.isNIFTI(data)) throw new Error(`${fileName} is not a valid NIfTI-1 or NIfTI-2 file.`);
  const header = nifti.readHeader(data);
  const dimensionCount = Number(header.dims[0]);
  const width = Number(header.dims[1]);
  const height = Number(header.dims[2]);
  const depth = Number(header.dims[3]);
  const timePoints = Number(header.dims[4] || 1);
  if (dimensionCount < 3 || width < 1 || height < 1 || depth < 1) {
    throw new Error(`${fileName} does not contain a valid 3D image volume.`);
  }
  if (dimensionCount > 3 && timePoints > 1) {
    throw new Error(`${fileName} is a 4D NIfTI file. Load a single 3D volume.`);
  }
  const voxelCount = width * height * depth;
  if (!Number.isSafeInteger(voxelCount) || voxelCount > 500_000_000) {
    throw new Error(`${fileName} is too large to process safely in this browser.`);
  }

  const datatype = Number(header.datatypeCode);
  const image = nifti.readImage(header, data);
  const colorChannels = datatype === 128 ? 3 : datatype === 2304 ? 4 : 0;
  const scalarType = NIFTI_SCALAR_TYPES[datatype];
  if (!scalarType && colorChannels === 0) {
    throw new Error(`${fileName} uses unsupported NIfTI datatype ${datatype}.`);
  }
  const expectedBytes = voxelCount * (colorChannels || scalarType.bytes);
  if (image.byteLength < expectedBytes) throw new Error(`${fileName} has incomplete voxel data.`);

  const spacing = [1, 2, 3].map((index) => Math.abs(Number(header.pixDims[index])) || 1);
  const origin = [0, 1, 2].map((index) => {
    const affineValue = Number(header.affine?.[index]?.[3]);
    if (Number.isFinite(affineValue)) return affineValue;
    const offsetValue = Number(header[`qoffset_${["x", "y", "z"][index]}`]);
    return Number.isFinite(offsetValue) ? offsetValue : 0;
  });
  const affine = niftiAffine(header, spacing, origin);
  const orientation = affineOrientation(affine);
  const frames = [];
  const base = filenameBase(fileName);
  if (colorChannels > 0) {
    const source = new Uint8Array(image);
    const slicePixels = width * height;
    for (let z = 0; z < depth; z += 1) {
      const pixels = new Uint8ClampedArray(slicePixels * 4);
      for (let index = 0; index < slicePixels; index += 1) {
        const sourceOffset = (z * slicePixels + index) * colorChannels;
        const targetOffset = index * 4;
        pixels[targetOffset] = source[sourceOffset];
        pixels[targetOffset + 1] = source[sourceOffset + 1];
        pixels[targetOffset + 2] = source[sourceOffset + 2];
        pixels[targetOffset + 3] = colorChannels === 4 ? source[sourceOffset + 3] : 255;
      }
      frames.push({
        name: `${base}_slice${String(z + 1).padStart(4, "0")}.png`,
        width,
        height,
        kind: "rgba",
        pixels,
      });
    }
  } else {
    const view = new DataView(image);
    const littleEndian = header.littleEndian !== false;
    const slopeValue = Number(header.scl_slope);
    const interceptValue = Number(header.scl_inter);
    const slope = Number.isFinite(slopeValue) && slopeValue !== 0 ? slopeValue : 1;
    const intercept = Number.isFinite(interceptValue) ? interceptValue : 0;
    const readValue = (index) => {
      const offset = index * scalarType.bytes;
      const raw =
        scalarType.bytes === 1
          ? view[scalarType.read](offset)
          : view[scalarType.read](offset, littleEndian);
      return raw * slope + intercept;
    };
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let index = 0; index < voxelCount; index += 1) {
      const value = readValue(index);
      if (!Number.isFinite(value)) continue;
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
      throw new Error(`${fileName} contains no finite voxel values.`);
    }
    const slicePixels = width * height;
    const range = { minimum, maximum };
    for (let z = 0; z < depth; z += 1) {
      const pixels = new Uint8ClampedArray(slicePixels);
      const sourceStart = z * slicePixels;
      for (let index = 0; index < slicePixels; index += 1) {
        pixels[index] = windowedByte(readValue(sourceStart + index), null, null, range);
      }
      frames.push({
        name: `${base}_slice${String(z + 1).padStart(4, "0")}.png`,
        width,
        height,
        kind: "gray",
        pixels,
      });
    }
  }

  return {
    format: "nifti",
    name: fileName,
    width,
    height,
    depth,
    spacing,
    origin,
    affine,
    geometry: makeVolumeGeometry({
      shape: [width, height, depth],
      affine,
      sourceKind: "nifti",
    }),
    orientation,
    datatype,
    frames,
  };
}

export function parseNiftiLabelVolume(input, fileName = "labels.nii.gz") {
  let data = ensureArrayBuffer(input);
  if (nifti.isCompressed(data)) data = nifti.decompress(data);
  if (!nifti.isNIFTI(data)) throw new Error(`${fileName} is not a valid NIfTI label volume.`);
  const header = nifti.readHeader(data);
  const width = Number(header.dims[1]);
  const height = Number(header.dims[2]);
  const depth = Number(header.dims[3]);
  if (Number(header.dims[0]) !== 3 || width < 1 || height < 1 || depth < 1) {
    throw new Error(`${fileName} must be one 3D NIfTI label volume.`);
  }
  const datatype = Number(header.datatypeCode);
  const scalarType = NIFTI_SCALAR_TYPES[datatype];
  if (!scalarType) throw new Error(`${fileName} uses unsupported label datatype ${datatype}.`);
  const image = nifti.readImage(header, data);
  const voxelCount = width * height * depth;
  if (image.byteLength < voxelCount * scalarType.bytes) throw new Error(`${fileName} has incomplete voxel data.`);
  const view = new DataView(image);
  const littleEndian = header.littleEndian !== false;
  const slope = Number.isFinite(Number(header.scl_slope)) && Number(header.scl_slope) !== 0
    ? Number(header.scl_slope) : 1;
  const intercept = Number.isFinite(Number(header.scl_inter)) ? Number(header.scl_inter) : 0;
  const pixels = new Uint8Array(voxelCount);
  for (let index = 0; index < voxelCount; index += 1) {
    const offset = index * scalarType.bytes;
    const raw = scalarType.bytes === 1
      ? view[scalarType.read](offset)
      : view[scalarType.read](offset, littleEndian);
    const value = raw * slope + intercept;
    if (!Number.isInteger(value) || value < 0 || value > 20) {
      throw new Error(`${fileName} contains a label outside the supported 0-20 range.`);
    }
    pixels[index] = value;
  }
  const spacing = [1, 2, 3].map((index) => Math.abs(Number(header.pixDims[index])) || 1);
  const origin = [0, 1, 2].map((index) => Number(header.affine?.[index]?.[3]) || 0);
  const affine = niftiAffine(header, spacing, origin);
  return {
    width, height, depth, shape: [width, height, depth], spacing, origin, affine,
    orientation: affineOrientation(affine),
    frames: Array.from({ length: depth }, (_, index) =>
      pixels.slice(index * width * height, (index + 1) * width * height)),
  };
}

export function parseDicomInstance(input, fileName, parser = globalThis.dicomParser) {
  const arrayBuffer = ensureArrayBuffer(input);
  const bytes = new Uint8Array(arrayBuffer);
  const { dataSet, rawTransferSyntax } = parseDicomDataSet(bytes, parser);
  const rows = uint16(dataSet, "x00280010");
  const columns = uint16(dataSet, "x00280011");
  const pixelElement = dataSet.elements.x7fe00010;
  if (!rows || !columns || !pixelElement) {
    throw new Error(`${fileName}: required DICOM Rows, Columns, or Pixel Data is missing.`);
  }
  const transferSyntax = normalizedUid(dataSet.string("x00020010")) || rawTransferSyntax;
  const compressed = ![
    DICOM_UID.implicitLittle,
    DICOM_UID.explicitLittle,
    DICOM_UID.explicitBig,
  ].includes(transferSyntax);
  if (transferSyntax === DICOM_UID.deflatedLittle) {
    throw new Error(`${fileName}: Deflated Explicit VR DICOM is not supported in this build.`);
  }
  if (compressed && transferSyntax !== DICOM_UID.jpegBaseline) {
    throw new Error(
      `${fileName}: compressed DICOM transfer syntax ${transferSyntax || "unknown"} is not supported.`,
    );
  }

  const instance = {
    name: fileName,
    dataSet,
    rows,
    columns,
    pixelElement,
    transferSyntax,
    compressed,
    littleEndian: transferSyntax !== DICOM_UID.explicitBig,
    samplesPerPixel: uint16(dataSet, "x00280002", 1),
    photometric: (dataSet.string("x00280004") || "MONOCHROME2").trim().toUpperCase(),
    planarConfiguration: uint16(dataSet, "x00280006", 0),
    frameCount: Math.max(1, firstInteger(dataSet, "x00280008", 1)),
    bitsAllocated: uint16(dataSet, "x00280100", 8),
    bitsStored: uint16(dataSet, "x00280101", uint16(dataSet, "x00280100", 8)),
    highBit: uint16(dataSet, "x00280102", uint16(dataSet, "x00280101", 8) - 1),
    pixelRepresentation: uint16(dataSet, "x00280103", 0),
    rescaleSlope: firstNumber(dataSet, "x00281053", 1),
    rescaleIntercept: firstNumber(dataSet, "x00281052", 0),
    windowCenter: firstNumber(dataSet, "x00281050"),
    windowWidth: firstNumber(dataSet, "x00281051"),
    seriesUid: normalizedUid(dataSet.string("x0020000e")) || "default-series",
    seriesNumber: firstInteger(dataSet, "x00200011", 0),
    seriesDescription: (dataSet.string("x0008103e") || "").trim(),
    instanceNumber: firstInteger(dataSet, "x00200013", 0),
    imagePosition: numericList(dataSet, "x00200032"),
    imageOrientation: numericList(dataSet, "x00200037"),
    sliceLocation: firstNumber(dataSet, "x00201041"),
    pixelSpacing: numericList(dataSet, "x00280030"),
    sliceSpacing: firstNumber(
      dataSet,
      "x00180088",
      firstNumber(dataSet, "x00180050", 1),
    ),
  };
  instance.sortCoordinate = dicomSortCoordinate(instance.imagePosition, instance.imageOrientation);
  if (!instance.compressed) validateDicomPixelFormat(instance);
  return instance;
}

export function groupDicomSeries(instances) {
  const groups = new Map();
  for (const instance of instances) {
    if (!groups.has(instance.seriesUid)) groups.set(instance.seriesUid, []);
    groups.get(instance.seriesUid).push(instance);
  }
  return [...groups.entries()]
    .map(([uid, items]) => ({
      uid,
      seriesNumber: items[0].seriesNumber,
      description: items[0].seriesDescription,
      items: sortDicomInstances(items),
    }))
    .sort((left, right) => right.items.length - left.items.length);
}

export function sortDicomInstances(instances) {
  return [...instances].sort((left, right) => {
    if (Number.isFinite(left.sortCoordinate) && Number.isFinite(right.sortCoordinate)) {
      const delta = left.sortCoordinate - right.sortCoordinate;
      if (Math.abs(delta) > 1e-6) return delta;
    }
    if (Number.isFinite(left.sliceLocation) && Number.isFinite(right.sliceLocation)) {
      const delta = left.sliceLocation - right.sliceLocation;
      if (Math.abs(delta) > 1e-6) return delta;
    }
    if (left.instanceNumber !== right.instanceNumber) {
      return left.instanceNumber - right.instanceNumber;
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function decodeDicomSeries(instances, parser = globalThis.dicomParser) {
  const ordered = sortDicomInstances(instances);
  if (ordered.length === 0) throw new Error("No readable DICOM images were found.");
  const range = dicomSeriesRange(ordered);
  const window = sharedDicomWindow(ordered);
  const frames = [];
  for (const instance of ordered) {
    for (let frameIndex = 0; frameIndex < instance.frameCount; frameIndex += 1) {
      const common = {
        name: dicomFrameName(instance.name, frameIndex, instance.frameCount),
        width: instance.columns,
        height: instance.rows,
      };
      if (instance.compressed) {
        if (!parser?.readEncapsulatedImageFrame) {
          throw new Error(`${instance.name}: the JPEG DICOM decoder is unavailable.`);
        }
        frames.push({
          ...common,
          kind: "encoded",
          mimeType: "image/jpeg",
          bytes: parser.readEncapsulatedImageFrame(
            instance.dataSet,
            instance.pixelElement,
            frameIndex,
          ),
        });
      } else if (instance.samplesPerPixel === 1) {
        frames.push({ ...common, ...decodeMonochromeFrame(instance, frameIndex, range, window) });
      } else {
        frames.push({ ...common, ...decodeColorFrame(instance, frameIndex) });
      }
    }
  }
  const first = ordered[0];
  let geometry = null;
  const geometryWarnings = [];
  try {
    geometry = dicomSeriesGeometry(ordered);
    geometryWarnings.push(...geometry.warnings);
  } catch (error) {
    geometryWarnings.push(`Physical DICOM geometry unavailable: ${error.message}`);
  }
  const fallbackOriginLps = first.imagePosition.length >= 3 ? first.imagePosition.slice(0, 3) : [0, 0, 0];
  const fallbackOriginRas = [-fallbackOriginLps[0], -fallbackOriginLps[1], fallbackOriginLps[2]];
  return {
    format: "dicom",
    seriesUid: first.seriesUid,
    width: first.columns,
    height: first.rows,
    depth: frames.length,
    spacing: geometry?.spacing || [first.pixelSpacing[1] || 1, first.pixelSpacing[0] || 1, first.sliceSpacing || 1],
    origin: geometry?.origin || fallbackOriginRas,
    affine: geometry?.affine || null,
    geometry,
    geometryWarnings,
    frames,
  };
}
