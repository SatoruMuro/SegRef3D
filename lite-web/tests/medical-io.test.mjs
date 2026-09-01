import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  decodeDicomSeries,
  decodeDicomSeriesAsync,
  dicomTransferSyntaxName,
  groupDicomSeries,
  isNiftiFilename,
  isTiffFilename,
  parseDicomInstance,
  parseNiftiVolume,
  parseTiffStack,
  sortDicomInstances,
} from "../medical-io.mjs";
import { createNiftiLabelVolume, createTiffLabelStack } from "../volume-tools.mjs";

const require = createRequire(import.meta.url);
const dicomParser = require("../vendor/dicom-parser.min.js");
let testCodecsPromise = null;

function loadTestCodecs() {
  if (!testCodecsPromise) {
    testCodecsPromise = (async () => {
      const dcmjs = require("../vendor/dcmjs.min.js");
      const Module = require("node:module");
      const originalLoad = Module._load;
      Module._load = function loadWithVendoredDcmjs(request, parent, isMain) {
        if (request === "dcmjs") return dcmjs;
        return originalLoad.call(this, request, parent, isMain);
      };
      let codecs;
      try {
        codecs = require("../vendor/dcmjs-codecs.min.js");
      } finally {
        Module._load = originalLoad;
      }
      if (!codecs.NativeCodecs.isInitialized()) {
        await codecs.NativeCodecs.initializeAsync({
          webAssemblyModulePathOrUrl: fileURLToPath(
            new URL("../vendor/dcmjs-native-codecs.wasm", import.meta.url),
          ),
        });
      }
      return codecs;
    })();
  }
  return testCodecsPromise;
}

function syntheticNifti({ timePoints = 1 } = {}) {
  const width = 3;
  const height = 2;
  const depth = 2;
  const voxOffset = 352;
  const values = new Int16Array(width * height * depth * timePoints);
  for (let index = 0; index < values.length; index += 1) values[index] = index * 10 - 20;
  const bytes = new Uint8Array(voxOffset + values.byteLength);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 348, true);
  view.setInt16(40, timePoints > 1 ? 4 : 3, true);
  view.setInt16(42, width, true);
  view.setInt16(44, height, true);
  view.setInt16(46, depth, true);
  view.setInt16(48, timePoints, true);
  view.setInt16(70, 4, true);
  view.setInt16(72, 16, true);
  view.setFloat32(80, 0.5, true);
  view.setFloat32(84, 0.75, true);
  view.setFloat32(88, 2.5, true);
  view.setFloat32(108, voxOffset, true);
  view.setFloat32(112, 2, true);
  view.setFloat32(116, 5, true);
  view.setInt16(254, 1, true);
  view.setFloat32(280, 0.5, true);
  view.setFloat32(292, 12.5, true);
  view.setFloat32(300, 0.75, true);
  view.setFloat32(308, -4, true);
  view.setFloat32(320, 2.5, true);
  view.setFloat32(324, 8.25, true);
  bytes.set([0x6e, 0x2b, 0x31, 0], 344);
  new Int16Array(bytes.buffer, voxOffset, values.length).set(values);
  return bytes.buffer;
}

function evenBytes(value, vr) {
  const raw = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
  if (raw.length % 2 === 0) return raw;
  const output = new Uint8Array(raw.length + 1);
  output.set(raw);
  output[raw.length] = vr === "UI" || vr === "OW" ? 0 : 0x20;
  return output;
}

function uint16Bytes(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint32Bytes(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function explicitElement(group, element, vr, rawValue) {
  const value = evenBytes(rawValue, vr);
  const longVr = ["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UN", "UR", "UT"].includes(vr);
  const headerLength = longVr ? 12 : 8;
  const output = new Uint8Array(headerLength + value.length);
  const view = new DataView(output.buffer);
  view.setUint16(0, group, true);
  view.setUint16(2, element, true);
  output.set(new TextEncoder().encode(vr), 4);
  if (longVr) view.setUint32(8, value.length, true);
  else view.setUint16(6, value.length, true);
  output.set(value, headerLength);
  return output;
}

function explicitBigEndianElement(group, element, vr, rawValue) {
  const value = evenBytes(rawValue, vr);
  const longVr = ["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UN", "UR", "UT"].includes(vr);
  const headerLength = longVr ? 12 : 8;
  const output = new Uint8Array(headerLength + value.length);
  const view = new DataView(output.buffer);
  view.setUint16(0, group, false);
  view.setUint16(2, element, false);
  output.set(new TextEncoder().encode(vr), 4);
  if (longVr) view.setUint32(8, value.length, false);
  else view.setUint16(6, value.length, false);
  output.set(value, headerLength);
  return output;
}

function uint16BigEndianBytes(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, false);
  return bytes;
}

function encapsulatedPixelElement(encodedFrame, emptyOffsetTable = false) {
  const frame = evenBytes(encodedFrame, "OB");
  const header = new Uint8Array(12);
  const headerView = new DataView(header.buffer);
  headerView.setUint16(0, 0x7fe0, true);
  headerView.setUint16(2, 0x0010, true);
  header.set(new TextEncoder().encode("OB"), 4);
  headerView.setUint32(8, 0xffffffff, true);
  const item = (payload) => {
    const output = new Uint8Array(8 + payload.length);
    const view = new DataView(output.buffer);
    view.setUint16(0, 0xfffe, true);
    view.setUint16(2, 0xe000, true);
    view.setUint32(4, payload.length, true);
    output.set(payload, 8);
    return output;
  };
  const offsetTable = item(emptyOffsetTable ? new Uint8Array() : uint32Bytes(0));
  const fragment = item(frame);
  const delimiter = new Uint8Array(8);
  const delimiterView = new DataView(delimiter.buffer);
  delimiterView.setUint16(0, 0xfffe, true);
  delimiterView.setUint16(2, 0xe0dd, true);
  return joinBytes([header, offsetTable, fragment, delimiter]);
}

function joinBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function syntheticDicom(instanceNumber, pixelValues, {
  position = [10, 20, 30],
  orientation = [1, 0, 0, 0, 1, 0],
  pixelSpacing = [0.5, 0.75],
  sliceSpacing = 2,
  rescaleSlope = 1,
  rescaleIntercept = 0,
  transferSyntaxUid = "1.2.840.10008.1.2.1",
  pixelDataElement = null,
  photometric = "MONOCHROME2",
  bitsAllocated = 16,
  bitsStored = bitsAllocated === 8 ? 8 : 12,
  highBit = bitsStored - 1,
  pixelRepresentation = 0,
} = {}) {
  const transferSyntax = explicitElement(0x0002, 0x0010, "UI", transferSyntaxUid);
  const metaLength = explicitElement(0x0002, 0x0000, "UL", uint32Bytes(transferSyntax.length));
  const pixelBytes = new Uint8Array(pixelValues.length * (bitsAllocated / 8));
  const pixelView = new DataView(pixelBytes.buffer);
  pixelValues.forEach((value, index) => {
    if (bitsAllocated === 8) pixelView.setUint8(index, value);
    else pixelView.setUint16(index * 2, value, true);
  });
  const dataSet = joinBytes([
    explicitElement(0x0020, 0x000e, "UI", "1.2.3.4.5"),
    explicitElement(0x0020, 0x0013, "IS", String(instanceNumber)),
    explicitElement(0x0020, 0x0032, "DS", position.join("\\")),
    explicitElement(0x0020, 0x0037, "DS", orientation.join("\\")),
    explicitElement(0x0018, 0x0050, "DS", String(sliceSpacing)),
    explicitElement(0x0028, 0x0002, "US", uint16Bytes(1)),
    explicitElement(0x0028, 0x0004, "CS", photometric),
    explicitElement(0x0028, 0x0010, "US", uint16Bytes(2)),
    explicitElement(0x0028, 0x0011, "US", uint16Bytes(2)),
    explicitElement(0x0028, 0x0030, "DS", pixelSpacing.join("\\")),
    explicitElement(0x0028, 0x0100, "US", uint16Bytes(bitsAllocated)),
    explicitElement(0x0028, 0x0101, "US", uint16Bytes(bitsStored)),
    explicitElement(0x0028, 0x0102, "US", uint16Bytes(highBit)),
    explicitElement(0x0028, 0x0103, "US", uint16Bytes(pixelRepresentation)),
    explicitElement(0x0028, 0x1050, "DS", "1500"),
    explicitElement(0x0028, 0x1051, "DS", "3001"),
    explicitElement(0x0028, 0x1052, "DS", String(rescaleIntercept)),
    explicitElement(0x0028, 0x1053, "DS", String(rescaleSlope)),
    pixelDataElement || explicitElement(0x7fe0, 0x0010, bitsAllocated === 8 ? "OB" : "OW", pixelBytes),
  ]);
  const preamble = new Uint8Array(132);
  preamble.set([0x44, 0x49, 0x43, 0x4d], 128);
  return joinBytes([preamble, metaLength, transferSyntax, dataSet]).buffer;
}

async function syntheticCompressedDicom(
  instanceNumber,
  pixelValues,
  transferSyntaxUid,
  encoderName,
  encoderOptions = {},
  metadata = {},
) {
  const codecs = await loadTestCodecs();
  const bitsAllocated = metadata.bitsAllocated || 16;
  const bitsStored = metadata.bitsStored || (bitsAllocated === 8 ? 8 : 12);
  const decodedBuffer = new Uint8Array(pixelValues.length * (bitsAllocated / 8));
  const view = new DataView(decodedBuffer.buffer);
  pixelValues.forEach((value, index) => {
    if (bitsAllocated === 8) view.setUint8(index, value);
    else view.setUint16(index * 2, value, true);
  });
  const context = new codecs.Context({
    width: 2,
    height: 2,
    bitsAllocated,
    bitsStored,
    samplesPerPixel: 1,
    pixelRepresentation: 0,
    planarConfiguration: 0,
    photometricInterpretation: "MONOCHROME2",
    decodedBuffer,
  });
  const encoded = codecs.NativeCodecs[encoderName](context, encoderOptions).getEncodedBuffer();
  return syntheticDicom(instanceNumber, pixelValues, {
    ...metadata,
    transferSyntaxUid,
    pixelDataElement: encapsulatedPixelElement(encoded, metadata.emptyOffsetTable === true),
  });
}

function syntheticBigEndianDicom(pixelValues) {
  const transferSyntax = explicitElement(0x0002, 0x0010, "UI", "1.2.840.10008.1.2.2");
  const metaLength = explicitElement(0x0002, 0x0000, "UL", uint32Bytes(transferSyntax.length));
  const pixelBytes = new Uint8Array(pixelValues.length * 2);
  const pixelView = new DataView(pixelBytes.buffer);
  pixelValues.forEach((value, index) => pixelView.setUint16(index * 2, value, false));
  const dataSet = joinBytes([
    explicitBigEndianElement(0x0020, 0x000e, "UI", "1.2.3.4.6"),
    explicitBigEndianElement(0x0020, 0x0013, "IS", "1"),
    explicitBigEndianElement(0x0020, 0x0032, "DS", "10\\20\\30"),
    explicitBigEndianElement(0x0020, 0x0037, "DS", "1\\0\\0\\0\\1\\0"),
    explicitBigEndianElement(0x0018, 0x0050, "DS", "2"),
    explicitBigEndianElement(0x0028, 0x0002, "US", uint16BigEndianBytes(1)),
    explicitBigEndianElement(0x0028, 0x0004, "CS", "MONOCHROME2"),
    explicitBigEndianElement(0x0028, 0x0010, "US", uint16BigEndianBytes(2)),
    explicitBigEndianElement(0x0028, 0x0011, "US", uint16BigEndianBytes(2)),
    explicitBigEndianElement(0x0028, 0x0030, "DS", "0.5\\0.75"),
    explicitBigEndianElement(0x0028, 0x0100, "US", uint16BigEndianBytes(16)),
    explicitBigEndianElement(0x0028, 0x0101, "US", uint16BigEndianBytes(12)),
    explicitBigEndianElement(0x0028, 0x0102, "US", uint16BigEndianBytes(11)),
    explicitBigEndianElement(0x0028, 0x0103, "US", uint16BigEndianBytes(0)),
    explicitBigEndianElement(0x7fe0, 0x0010, "OW", pixelBytes),
  ]);
  const preamble = new Uint8Array(132);
  preamble.set([0x44, 0x49, 0x43, 0x4d], 128);
  return joinBytes([preamble, metaLength, transferSyntax, dataSet]).buffer;
}

function syntheticTiff({ width = 2, height = 2, bits = 8, samples = 1, pixels }) {
  const entries = samples === 3 ? 10 : 9;
  const ifdOffset = 8;
  const ifdSize = 2 + entries * 12 + 4;
  const bitsOffset = ifdOffset + ifdSize;
  const bitsBytes = samples === 3 ? 6 : 0;
  const pixelOffset = bitsOffset + bitsBytes;
  const bytes = new Uint8Array(pixelOffset + pixels.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49], 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries, true);
  const records = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, samples, samples === 3 ? bitsOffset : bits],
    [259, 3, 1, 1],
    [262, 3, 1, samples === 3 ? 2 : 1],
    [273, 4, 1, pixelOffset],
    [277, 3, 1, samples],
    [278, 4, 1, height],
    [279, 4, 1, pixels.length],
  ];
  if (samples === 3) records.push([284, 3, 1, 1]);
  records.sort((left, right) => left[0] - right[0]);
  records.forEach(([tag, type, count, value], index) => {
    const offset = ifdOffset + 2 + index * 12;
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(offset + 8, value, true);
    else view.setUint32(offset + 8, value, true);
  });
  view.setUint32(ifdOffset + 2 + entries * 12, 0, true);
  if (samples === 3) {
    view.setUint16(bitsOffset, bits, true);
    view.setUint16(bitsOffset + 2, bits, true);
    view.setUint16(bitsOffset + 4, bits, true);
  }
  bytes.set(pixels, pixelOffset);
  return bytes.buffer;
}

test("recognizes NIfTI file extensions", () => {
  assert.equal(isNiftiFilename("scan.nii"), true);
  assert.equal(isNiftiFilename("scan.NII.GZ"), true);
  assert.equal(isNiftiFilename("scan.dcm"), false);
});

test("recognizes TIFF extensions and decodes a multi-page grayscale stack", () => {
  assert.equal(isTiffFilename("stack.TIFF"), true);
  assert.equal(isTiffFilename("stack.tif"), true);
  const masks = [new Uint8Array([0, 1, 2, 3]), new Uint8Array([4, 5, 6, 7])];
  const volume = parseTiffStack(createTiffLabelStack(masks, 2, 2), "stack.tiff");
  assert.deepEqual([volume.width, volume.height, volume.depth], [2, 2, 2]);
  assert.deepEqual([...volume.frames[0].pixels], [0, 1, 2, 3]);
  assert.deepEqual([...volume.frames[1].pixels], [4, 5, 6, 7]);
});

test("decodes 16-bit grayscale and RGB TIFF pixels", () => {
  const grayPixels = new Uint8Array(8);
  const grayView = new DataView(grayPixels.buffer);
  [0, 16384, 32768, 65535].forEach((value, index) => grayView.setUint16(index * 2, value, true));
  const gray = parseTiffStack(syntheticTiff({ bits: 16, pixels: grayPixels }), "gray16.tif");
  assert.equal(gray.frames[0].kind, "gray");
  assert.deepEqual([...gray.frames[0].pixels], [0, 64, 128, 255]);

  const rgbPixels = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 120, 130, 140]);
  const rgb = parseTiffStack(syntheticTiff({ bits: 8, samples: 3, pixels: rgbPixels }), "rgb.tif");
  assert.equal(rgb.frames[0].kind, "rgba");
  assert.deepEqual([...rgb.frames[0].pixels.slice(0, 12)], [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
});

test("rejects invalid TIFF data", () => {
  assert.throws(() => parseTiffStack(new Uint8Array([1, 2, 3, 4]).buffer, "bad.tif"), /valid TIFF|no TIFF image pages/);
});

test("decodes NIfTI-1 int16 volumes and applies scaling", () => {
  const volume = parseNiftiVolume(syntheticNifti(), "scan.nii");
  assert.deepEqual([volume.width, volume.height, volume.depth], [3, 2, 2]);
  assert.deepEqual(volume.spacing, [0.5, 0.75, 2.5]);
  assert.deepEqual(volume.origin, [12.5, -4, 8.25]);
  assert.equal(volume.frames.length, 2);
  assert.equal(volume.frames[0].name, "scan_slice0001.png");
  assert.equal(volume.frames[0].pixels[0], 0);
  assert.equal(volume.frames[1].pixels.at(-1), 255);
});

test("NIfTI input retains off-diagonal sform and nonzero origin", () => {
  const bytes = new Uint8Array(syntheticNifti());
  const view = new DataView(bytes.buffer);
  const affine = [
    [-0.5, 0.02, 0.1, 100.076588],
    [-0.01, 0.75, -0.2, 23.749557],
    [0.03, -0.04, 2.5, 137.329995],
  ];
  affine.forEach((row, y) => row.forEach((value, x) => {
    view.setFloat32(280 + y * 16 + x * 4, value, true);
  }));
  const volume = parseNiftiVolume(bytes.buffer, "oblique.nii");
  affine.forEach((row, y) => row.forEach((value, x) => {
    assert.ok(Math.abs(volume.affine[y][x] - value) < 1e-4);
  }));
  assert.deepEqual(volume.geometry.affine, volume.affine);
});

test("decodes gzip-compressed NIfTI and rejects 4D input", () => {
  const compressed = gzipSync(new Uint8Array(syntheticNifti()));
  const compressedBuffer = compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength,
  );
  assert.equal(parseNiftiVolume(compressedBuffer, "scan.nii.gz").frames.length, 2);
  assert.throws(() => parseNiftiVolume(syntheticNifti({ timePoints: 2 }), "four-d.nii"), /4D/);
});

test("parses extensionless uncompressed DICOM and windows grayscale pixels", () => {
  const instance = parseDicomInstance(
    syntheticDicom(2, [0, 1000, 2000, 3000]),
    "IM0002",
    dicomParser,
  );
  assert.equal(instance.rows, 2);
  assert.equal(instance.columns, 2);
  assert.equal(instance.instanceNumber, 2);
  const series = decodeDicomSeries([instance], dicomParser);
  assert.equal(series.frames.length, 1);
  assert.deepEqual(series.spacing, [0.75, 0.5, 2]);
  assert.deepEqual(series.origin, [-10, -20, 30]);
  assert.deepEqual(series.affine, [
    [-0.75, 0, 0, -10],
    [0, -0.5, 0, -20],
    [0, 0, 2, 30],
    [0, 0, 0, 1],
  ]);
  assert.deepEqual([...series.frames[0].pixels], [0, 85, 170, 255]);
});

test("decodes Explicit VR Big Endian stored pixels without byte swapping errors", () => {
  const instance = parseDicomInstance(
    syntheticBigEndianDicom([0, 1000, 2000, 4095]),
    "big-endian.dcm",
    dicomParser,
  );
  assert.equal(instance.transferSyntax, "1.2.840.10008.1.2.2");
  const volume = decodeDicomSeries([instance]);
  assert.deepEqual(volume.pixelValueRange, [0, 4095]);
  assert.deepEqual([...volume.frames[0].trainingPixels], [0, 1000, 2000, 4095]);
});

test("DICOM training pixels preserve slope/intercept scalar values instead of windowed bytes", () => {
  const instance = parseDicomInstance(
    syntheticDicom(1, [0, 100, 500, 1000], { rescaleSlope: 2, rescaleIntercept: -1024 }),
    "IM0001",
    dicomParser,
  );
  const decoded = decodeDicomSeries([instance], dicomParser);
  assert.equal(decoded.frames[0].trainingKind, "scalar");
  assert.deepEqual([...decoded.frames[0].trainingPixels], [-1024, -824, -24, 976]);
  assert.equal(decoded.frames[0].trainingIntensityPolicy, "dicom_rescale_slope_intercept_float32");
  assert.notDeepEqual([...decoded.frames[0].pixels], [...decoded.frames[0].trainingPixels]);
});

test("DICOM signed pixels and MONOCHROME1 preserve raw modality values", () => {
  const instance = parseDicomInstance(
    syntheticDicom(1, [-1024, -1, 0, 1023], {
      pixelRepresentation: 1,
      photometric: "MONOCHROME1",
      rescaleSlope: 2,
      rescaleIntercept: -10,
    }),
    "signed-monochrome1.dcm",
    dicomParser,
  );
  const decoded = decodeDicomSeries([instance]);
  assert.deepEqual([...decoded.frames[0].trainingPixels], [-2058, -12, -10, 2036]);
  assert.deepEqual(decoded.pixelValueRange, [-2058, 2036]);
  assert.equal(decoded.frames[0].pixels[0], 255);
  assert.ok(decoded.frames[0].pixels[0] > decoded.frames[0].pixels.at(-1));
});

test("decodes lossless compressed DICOM pixels with the browser WASM codecs", async () => {
  const cases = [
    {
      name: "RLE Lossless",
      uid: "1.2.840.10008.1.2.5",
      encoder: "encodeRle",
    },
    {
      name: "JPEG Lossless Process 14",
      uid: "1.2.840.10008.1.2.4.57",
      encoder: "encodeJpeg",
      options: { predictor: 6, pointTransform: 0 },
    },
    {
      name: "JPEG Lossless Process 14 SV1",
      uid: "1.2.840.10008.1.2.4.70",
      encoder: "encodeJpeg",
      options: { predictor: 1, pointTransform: 0 },
      metadata: { emptyOffsetTable: true },
    },
    {
      name: "JPEG-LS Lossless",
      uid: "1.2.840.10008.1.2.4.80",
      encoder: "encodeJpegLs",
      options: { lossy: false },
    },
    {
      name: "JPEG 2000 Lossless",
      uid: "1.2.840.10008.1.2.4.90",
      encoder: "encodeJpeg2000",
      options: { lossy: false },
    },
  ];
  const expected = [0, 100, 500, 4095];
  const codecs = await loadTestCodecs();
  for (const item of cases) {
    const input = await syntheticCompressedDicom(
      1,
      expected,
      item.uid,
      item.encoder,
      item.options,
      { pixelSpacing: [0.5, 0.75], sliceSpacing: 2, ...item.metadata },
    );
    const instance = parseDicomInstance(input, `${item.name}.dcm`, dicomParser);
    assert.equal(instance.compressed, true, item.name);
    assert.equal(dicomTransferSyntaxName(item.uid).startsWith(item.name.split(" Process")[0]), true);
    const volume = await decodeDicomSeriesAsync([instance], { parser: dicomParser, codecs });
    assert.deepEqual([volume.width, volume.height, volume.depth], [2, 2, 1], item.name);
    assert.deepEqual(volume.spacing, [0.75, 0.5, 2], item.name);
    assert.deepEqual(volume.pixelValueRange, [0, 4095], item.name);
    assert.deepEqual([...volume.frames[0].trainingPixels], expected, item.name);
    assert.deepEqual(
      [Math.min(...volume.frames[0].trainingPixels), Math.max(...volume.frames[0].trainingPixels)],
      [0, 4095],
      item.name,
    );
  }
});

test("loads JPEG Baseline, JPEG-LS Near-Lossless, and lossy JPEG 2000 frames", async () => {
  const codecs = await loadTestCodecs();
  const cases = [
    {
      name: "JPEG Baseline",
      uid: "1.2.840.10008.1.2.4.50",
      encoder: "encodeJpeg",
      options: { lossy: true, quality: 95 },
      values: [0, 64, 128, 255],
      metadata: { bitsAllocated: 8, bitsStored: 8, highBit: 7 },
    },
    {
      name: "JPEG-LS Near-Lossless",
      uid: "1.2.840.10008.1.2.4.81",
      encoder: "encodeJpegLs",
      options: { lossy: true, allowedLossyError: 3 },
      values: [0, 100, 500, 4095],
    },
    {
      name: "JPEG 2000",
      uid: "1.2.840.10008.1.2.4.91",
      encoder: "encodeJpeg2000",
      options: { lossy: true, rate: 8 },
      values: [0, 100, 500, 4095],
    },
  ];
  for (const item of cases) {
    const input = await syntheticCompressedDicom(
      1,
      item.values,
      item.uid,
      item.encoder,
      item.options,
      item.metadata,
    );
    const instance = parseDicomInstance(input, `${item.name}.dcm`, dicomParser);
    const volume = await decodeDicomSeriesAsync([instance], { parser: dicomParser, codecs });
    assert.deepEqual([volume.width, volume.height, volume.depth], [2, 2, 1], item.name);
    assert.equal(volume.frames[0].trainingPixels.length, 4, item.name);
    assert.ok(volume.frames[0].trainingPixels.every(Number.isFinite), item.name);
    assert.ok(volume.pixelValueRange[0] <= volume.pixelValueRange[1], item.name);
  }
});

test("compressed DICOM series keep geometry and patient-position slice order", async () => {
  const codecs = await loadTestCodecs();
  const later = parseDicomInstance(
    await syntheticCompressedDicom(
      20,
      [200, 201, 202, 203],
      "1.2.840.10008.1.2.4.70",
      "encodeJpeg",
      { predictor: 1 },
      { position: [10, 20, 32] },
    ),
    "slice20.dcm",
    dicomParser,
  );
  const earlier = parseDicomInstance(
    await syntheticCompressedDicom(
      10,
      [100, 101, 102, 103],
      "1.2.840.10008.1.2.4.70",
      "encodeJpeg",
      { predictor: 1 },
      { position: [10, 20, 30] },
    ),
    "slice10.dcm",
    dicomParser,
  );
  const volume = await decodeDicomSeriesAsync([later, earlier], { parser: dicomParser, codecs });
  assert.deepEqual(volume.spacing, [0.75, 0.5, 2]);
  assert.deepEqual(volume.frames.map((frame) => [...frame.trainingPixels]), [
    [100, 101, 102, 103],
    [200, 201, 202, 203],
  ]);
  assert.deepEqual(volume.pixelValueRange, [100, 203]);
});

test("reports an unsupported compressed transfer syntax by name and UID", () => {
  const input = syntheticDicom(1, [0, 1, 2, 3], {
    transferSyntaxUid: "1.2.840.10008.1.2.4.92",
  });
  assert.throws(
    () => parseDicomInstance(input, "unsupported.dcm", dicomParser),
    /Unsupported DICOM compression: JPEG 2000 Part 2 Multicomponent Lossless \(1\.2\.840\.10008\.1\.2\.4\.92\)/,
  );
});

test("DICOM coronal and oblique metadata produce full IJK-to-RAS geometry", () => {
  const coronal = [0, 1, 2].map((index) => parseDicomInstance(
    syntheticDicom(index + 1, [1, 2, 3, 4], {
      position: [100.076588, 23.749557 + index * 3.75, 137.329995],
      orientation: [1, 0, 0, 0, 0, -1],
      pixelSpacing: [0.6875, 0.6875],
      sliceSpacing: 3.75,
    }),
    `COR${index + 1}`,
    dicomParser,
  ));
  const volume = decodeDicomSeries(coronal, dicomParser);
  assert.deepEqual(volume.spacing, [0.6875, 0.6875, 3.75]);
  volume.origin.forEach((value, index) => assert.ok(Math.abs(value - [-100.076588, -23.749557, 137.329995][index]) < 1e-5));
  const expectedDirection = [[-1, 0, 0], [0, 0, -1], [0, -1, 0]];
  volume.geometry.direction.forEach((row, y) => row.forEach((value, x) => {
    assert.ok(Math.abs(value - expectedDirection[y][x]) < 1e-6);
  }));

  const orientation = [0.8, 0.6, 0, -0.3, 0.4, 0.866025403784];
  const step = [0.25, -0.15, 2.4];
  const oblique = [0, 1, 2].map((index) => parseDicomInstance(
    syntheticDicom(index + 1, [1, 2, 3, 4], {
      position: [45 + index * step[0], -22 + index * step[1], 81 + index * step[2]],
      orientation,
    }),
    `OBL${index + 1}`,
    dicomParser,
  ));
  const obliqueVolume = decodeDicomSeries(oblique, dicomParser);
  [-0.25, 0.15, 2.4].forEach((value, index) => {
    assert.ok(Math.abs(obliqueVolume.affine[index][2] - value) < 1e-6);
  });

  const masks = obliqueVolume.frames.map((frame, index) => {
    const mask = new Uint8Array(frame.width * frame.height);
    mask[index] = index + 1;
    return mask;
  });
  const exported = createNiftiLabelVolume(
    masks,
    obliqueVolume.width,
    obliqueVolume.height,
    obliqueVolume.geometry,
  );
  const reopened = parseNiftiVolume(exported.buffer, "dicom-derived-labels.nii");
  reopened.affine.forEach((row, y) => row.forEach((value, x) => {
    assert.ok(Math.abs(value - obliqueVolume.affine[y][x]) < 1e-5);
  }));
});

test("groups DICOM series and sorts slices by instance number", () => {
  const later = parseDicomInstance(syntheticDicom(12, [1, 2, 3, 4]), "IM0012", dicomParser);
  const earlier = parseDicomInstance(syntheticDicom(3, [1, 2, 3, 4]), "IM0003", dicomParser);
  assert.deepEqual(sortDicomInstances([later, earlier]).map((item) => item.instanceNumber), [3, 12]);
  const groups = groupDicomSeries([later, earlier]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items[0].name, "IM0003");
});
