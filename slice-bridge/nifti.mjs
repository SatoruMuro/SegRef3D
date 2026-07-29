const NIFTI1_HEADER_SIZE = 348;
const AXIS_INDEX = Object.freeze({ x: 0, y: 1, z: 2 });

const DATA_TYPES = Object.freeze({
  2: { name: "uint8", bitpix: 8, read: "getUint8" },
  4: { name: "int16", bitpix: 16, read: "getInt16" },
  8: { name: "int32", bitpix: 32, read: "getInt32" },
  256: { name: "int8", bitpix: 8, read: "getInt8" },
  512: { name: "uint16", bitpix: 16, read: "getUint16" },
  768: { name: "uint32", bitpix: 32, read: "getUint32" },
});

function readAscii(bytes, start, length) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function assertSafeInteger(value, message) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(message);
  }
}

function detectEndian(view) {
  if (view.getInt32(0, true) === NIFTI1_HEADER_SIZE) return true;
  if (view.getInt32(0, false) === NIFTI1_HEADER_SIZE) return false;
  if (view.getInt32(0, true) === 540 || view.getInt32(0, false) === 540) {
    throw new Error("NIfTI-2は現在未対応です。NIfTI-1形式で書き出してください。");
  }
  throw new Error("NIfTI-1のヘッダーを確認できませんでした。");
}

function scanLabels(parsed, limit = 256) {
  const { bytes, voxOffset, voxelCount, dataType, littleEndian, bytesPerVoxel } = parsed;
  const labels = new Set();

  if (dataType === 2 || dataType === 256) {
    const data = bytes.subarray(voxOffset, voxOffset + voxelCount);
    for (let i = 0; i < data.length; i += 1) {
      const value = dataType === 2 ? data[i] : (data[i] << 24) >> 24;
      if (value !== 0) labels.add(value);
      if (labels.size > limit) break;
    }
  } else {
    const info = DATA_TYPES[dataType];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < voxelCount; i += 1) {
      const offset = voxOffset + i * bytesPerVoxel;
      const value = view[info.read](offset, littleEndian);
      if (value !== 0) labels.add(value);
      if (labels.size > limit) break;
    }
  }

  if (labels.size > limit) {
    return { values: [], overflow: true };
  }
  return {
    values: [...labels].sort((a, b) => a - b),
    overflow: false,
  };
}

export function parseNifti(arrayBuffer, fileName = "") {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 352) {
    throw new Error("ファイルが短すぎるため、NIfTIとして読み込めません。");
  }

  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const littleEndian = detectEndian(view);
  const magic = readAscii(bytes, 344, 4);
  if (magic !== "n+1\0") {
    if (magic === "ni1\0") {
      throw new Error("2ファイル形式（.hdr/.img）は未対応です。単一の.niiを使用してください。");
    }
    throw new Error("単一ファイル形式のNIfTI-1（.nii）ではありません。");
  }

  const dimensionCount = view.getInt16(40, littleEndian);
  if (dimensionCount !== 3) {
    throw new Error(`3次元ラベルマップが必要です（dim[0] = ${dimensionCount}）。`);
  }

  const dimensions = [0, 1, 2].map((index) =>
    view.getInt16(42 + index * 2, littleEndian),
  );
  if (dimensions.some((value) => value <= 0)) {
    throw new Error("画像サイズが不正です。");
  }

  const spacing = [0, 1, 2].map((index) =>
    Math.abs(view.getFloat32(80 + index * 4, littleEndian)),
  );
  if (spacing.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Voxel spacingが不正です。");
  }

  const dataType = view.getInt16(70, littleEndian);
  const bitpix = view.getInt16(72, littleEndian);
  const typeInfo = DATA_TYPES[dataType];
  if (!typeInfo || typeInfo.bitpix !== bitpix) {
    throw new Error(
      `未対応のデータ型です（datatype ${dataType}, ${bitpix} bit）。整数ラベルマップを使用してください。`,
    );
  }

  const rawVoxOffset = view.getFloat32(108, littleEndian);
  const voxOffset = Math.round(rawVoxOffset);
  if (!Number.isFinite(rawVoxOffset) || voxOffset < 352 || voxOffset > bytes.byteLength) {
    throw new Error("NIfTIのvoxel data offsetが不正です。");
  }

  const bytesPerVoxel = bitpix / 8;
  const voxelCount = dimensions.reduce((product, value) => product * value, 1);
  const dataByteLength = voxelCount * bytesPerVoxel;
  assertSafeInteger(dataByteLength, "画像データが大きすぎます。");
  if (voxOffset + dataByteLength > bytes.byteLength) {
    throw new Error("ヘッダーに記載された画像サイズよりファイルが短くなっています。");
  }

  const maxSpacing = Math.max(...spacing);
  const autoAxis = ["x", "y", "z"][spacing.indexOf(maxSpacing)];
  const parsed = {
    fileName,
    bytes,
    littleEndian,
    dimensions,
    spacing,
    dataType,
    dataTypeName: typeInfo.name,
    bitpix,
    bytesPerVoxel,
    voxelCount,
    voxOffset,
    autoAxis,
    qformCode: view.getInt16(252, littleEndian),
    sformCode: view.getInt16(254, littleEndian),
    slope: view.getFloat32(112, littleEndian),
    intercept: view.getFloat32(116, littleEndian),
  };
  parsed.labels = scanLabels(parsed);
  return parsed;
}

export function resolveAxis(parsed, requestedAxis) {
  if (requestedAxis === "auto") return parsed.autoAxis;
  if (!(requestedAxis in AXIS_INDEX)) {
    throw new Error("スライス方向の指定が不正です。");
  }
  return requestedAxis;
}

export function makeOutputPlan(parsed, requestedAxis, rawFactor) {
  const axis = resolveAxis(parsed, requestedAxis);
  const axisIndex = AXIS_INDEX[axis];
  const factor = Number(rawFactor);
  if (!Number.isInteger(factor) || factor < 2 || factor > 100) {
    throw new Error("細分化倍率は2〜100の整数で指定してください。");
  }

  const dimensions = [...parsed.dimensions];
  dimensions[axisIndex] = (dimensions[axisIndex] - 1) * factor + 1;
  if (dimensions[axisIndex] > 32767) {
    throw new Error(
      `変換後の${axis.toUpperCase()}方向がNIfTI-1の上限（32767）を超えます。倍率を下げてください。`,
    );
  }

  const spacing = [...parsed.spacing];
  spacing[axisIndex] /= factor;
  const voxelCount = dimensions.reduce((product, value) => product * value, 1);
  const dataByteLength = voxelCount * parsed.bytesPerVoxel;
  assertSafeInteger(dataByteLength, "変換後の画像データが大きすぎます。");
  if (dataByteLength > 2_000_000_000) {
    throw new Error("変換後の非圧縮データが2 GBを超えます。倍率を下げてください。");
  }

  const prefix = parsed.bytes.slice(0, parsed.voxOffset);
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  view.setInt16(42 + axisIndex * 2, dimensions[axisIndex], parsed.littleEndian);
  view.setFloat32(80 + axisIndex * 4, spacing[axisIndex], parsed.littleEndian);

  if (parsed.sformCode > 0) {
    for (const rowOffset of [280, 296, 312]) {
      const itemOffset = rowOffset + axisIndex * 4;
      const value = view.getFloat32(itemOffset, parsed.littleEndian);
      view.setFloat32(itemOffset, value / factor, parsed.littleEndian);
    }
  }

  return {
    axis,
    axisIndex,
    factor,
    dimensions,
    spacing,
    voxelCount,
    dataByteLength,
    totalByteLength: parsed.voxOffset + dataByteLength,
    prefix,
  };
}

export function* outputChunks(parsed, plan) {
  yield plan.prefix;

  const [sourceX, sourceY, sourceZ] = parsed.dimensions;
  const [outputX, outputY, outputZ] = plan.dimensions;
  const bytesPerVoxel = parsed.bytesPerVoxel;
  const sourceSliceBytes = sourceX * sourceY * bytesPerVoxel;
  const outputSliceBytes = outputX * outputY * bytesPerVoxel;
  const sourceDataStart = parsed.voxOffset;

  if (plan.axis === "z") {
    const zeroSlice = new Uint8Array(outputSliceBytes);
    for (let outputZIndex = 0; outputZIndex < outputZ; outputZIndex += 1) {
      if (outputZIndex % plan.factor === 0) {
        const sourceZIndex = outputZIndex / plan.factor;
        const start = sourceDataStart + sourceZIndex * sourceSliceBytes;
        yield parsed.bytes.subarray(start, start + sourceSliceBytes);
      } else {
        yield zeroSlice;
      }
    }
    return;
  }

  if (plan.axis === "y") {
    const rowBytes = sourceX * bytesPerVoxel;
    for (let z = 0; z < sourceZ; z += 1) {
      const outputSlice = new Uint8Array(outputSliceBytes);
      const sourceSliceStart = sourceDataStart + z * sourceSliceBytes;
      for (let y = 0; y < sourceY; y += 1) {
        const sourceStart = sourceSliceStart + y * rowBytes;
        const outputStart = y * plan.factor * rowBytes;
        outputSlice.set(parsed.bytes.subarray(sourceStart, sourceStart + rowBytes), outputStart);
      }
      yield outputSlice;
    }
    return;
  }

  for (let z = 0; z < sourceZ; z += 1) {
    const outputSlice = new Uint8Array(outputSliceBytes);
    const sourceSliceStart = sourceDataStart + z * sourceSliceBytes;
    for (let y = 0; y < sourceY; y += 1) {
      const sourceRowStart = sourceSliceStart + y * sourceX * bytesPerVoxel;
      const outputRowStart = y * outputX * bytesPerVoxel;
      for (let x = 0; x < sourceX; x += 1) {
        const sourceStart = sourceRowStart + x * bytesPerVoxel;
        const outputStart = outputRowStart + x * plan.factor * bytesPerVoxel;
        outputSlice.set(
          parsed.bytes.subarray(sourceStart, sourceStart + bytesPerVoxel),
          outputStart,
        );
      }
    }
    yield outputSlice;
  }
}

export function makeOutputFileName(fileName, plan) {
  const base = fileName.replace(/\.nii(?:\.gz)?$/i, "") || "labelmap";
  const spacingText = formatNumber(plan.spacing[plan.axisIndex], 6).replace(".", "p");
  return `${base}_anchor_${plan.axis}${spacingText}mm.nii.gz`;
}

export function formatNumber(value, maximumFractionDigits = 4) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    useGrouping: false,
  }).format(value);
}

export function metadataForMessage(parsed) {
  return {
    fileName: parsed.fileName,
    dimensions: parsed.dimensions,
    spacing: parsed.spacing,
    dataType: parsed.dataType,
    dataTypeName: parsed.dataTypeName,
    bitpix: parsed.bitpix,
    bytesPerVoxel: parsed.bytesPerVoxel,
    voxOffset: parsed.voxOffset,
    autoAxis: parsed.autoAxis,
    qformCode: parsed.qformCode,
    sformCode: parsed.sformCode,
    slope: parsed.slope,
    intercept: parsed.intercept,
    labels: parsed.labels,
  };
}
