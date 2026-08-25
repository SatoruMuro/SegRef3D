import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  decodeDicomSeries,
  groupDicomSeries,
  isNiftiFilename,
  isTiffFilename,
  parseDicomInstance,
  parseNiftiVolume,
  parseTiffStack,
  sortDicomInstances,
} from "../medical-io.mjs";
import { createTiffLabelStack } from "../volume-tools.mjs";

const require = createRequire(import.meta.url);
const dicomParser = require("../vendor/dicom-parser.min.js");

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

function syntheticDicom(instanceNumber, pixelValues) {
  const transferSyntax = explicitElement(0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1");
  const metaLength = explicitElement(0x0002, 0x0000, "UL", uint32Bytes(transferSyntax.length));
  const pixelBytes = new Uint8Array(pixelValues.length * 2);
  const pixelView = new DataView(pixelBytes.buffer);
  pixelValues.forEach((value, index) => pixelView.setUint16(index * 2, value, true));
  const dataSet = joinBytes([
    explicitElement(0x0020, 0x000e, "UI", "1.2.3.4.5"),
    explicitElement(0x0020, 0x0013, "IS", String(instanceNumber)),
    explicitElement(0x0020, 0x0032, "DS", "10\\20\\30"),
    explicitElement(0x0018, 0x0050, "DS", "2"),
    explicitElement(0x0028, 0x0002, "US", uint16Bytes(1)),
    explicitElement(0x0028, 0x0004, "CS", "MONOCHROME2"),
    explicitElement(0x0028, 0x0010, "US", uint16Bytes(2)),
    explicitElement(0x0028, 0x0011, "US", uint16Bytes(2)),
    explicitElement(0x0028, 0x0030, "DS", "0.5\\0.75"),
    explicitElement(0x0028, 0x0100, "US", uint16Bytes(16)),
    explicitElement(0x0028, 0x0101, "US", uint16Bytes(12)),
    explicitElement(0x0028, 0x0102, "US", uint16Bytes(11)),
    explicitElement(0x0028, 0x0103, "US", uint16Bytes(0)),
    explicitElement(0x0028, 0x1050, "DS", "1500"),
    explicitElement(0x0028, 0x1051, "DS", "3001"),
    explicitElement(0x7fe0, 0x0010, "OW", pixelBytes),
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
  assert.deepEqual(series.origin, [10, 20, 30]);
  assert.deepEqual([...series.frames[0].pixels], [0, 85, 170, 255]);
});

test("groups DICOM series and sorts slices by instance number", () => {
  const later = parseDicomInstance(syntheticDicom(12, [1, 2, 3, 4]), "IM0012", dicomParser);
  const earlier = parseDicomInstance(syntheticDicom(3, [1, 2, 3, 4]), "IM0003", dicomParser);
  assert.deepEqual(sortDicomInstances([later, earlier]).map((item) => item.instanceNumber), [3, 12]);
  const groups = groupDicomSeries([later, earlier]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items[0].name, "IM0003");
});
