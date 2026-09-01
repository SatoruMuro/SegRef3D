const LPS_TO_RAS = [
  [-1, 0, 0, 0],
  [0, -1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];

function finiteVector(value, length, name) {
  const output = Array.from(value || [], Number);
  if (output.length !== length || output.some((item) => !Number.isFinite(item))) {
    throw new Error(`DICOM ${name} must contain ${length} finite values.`);
  }
  return output;
}

function norm(vector) {
  return Math.hypot(...vector);
}

function normalize(vector, name = "vector") {
  const length = norm(vector);
  if (!(length > 0)) throw new Error(`${name} has zero length.`);
  return vector.map((value) => value / length);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function add(left, right) {
  return left.map((value, index) => value + right[index]);
}

function scale(vector, factor) {
  return vector.map((value) => value * factor);
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function multiply4(left, right) {
  return Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) =>
      [0, 1, 2, 3].reduce((sum, index) => sum + left[row][index] * right[index][column], 0)),
  );
}

export function normalizeAffine(value) {
  const affine = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => Number(value?.[row]?.[column])),
  );
  if (affine.some((row) => row.some((item) => !Number.isFinite(item)))) {
    throw new Error("IJK-to-RAS affine must be one finite 4x4 matrix.");
  }
  if (affine[3].some((value, index) => Math.abs(value - [0, 0, 0, 1][index]) > 1e-8)) {
    throw new Error("IJK-to-RAS affine has an invalid homogeneous row.");
  }
  if (spacingFromAffineUnchecked(affine).some((value) => !(value > 0))) {
    throw new Error("IJK-to-RAS affine contains a zero-length voxel axis.");
  }
  return affine;
}

function spacingFromAffineUnchecked(affine) {
  return [0, 1, 2].map((column) => Math.hypot(affine[0][column], affine[1][column], affine[2][column]));
}

export function spacingFromAffine(affine) {
  return spacingFromAffineUnchecked(normalizeAffine(affine));
}

export function directionFromAffine(affine) {
  const matrix = normalizeAffine(affine);
  const spacing = spacingFromAffineUnchecked(matrix);
  return Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, column) => matrix[row][column] / spacing[column]),
  );
}

export function affineWithSpacing(affine, spacing) {
  const matrix = normalizeAffine(affine);
  const values = Array.from(spacing || [], Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Voxel spacing must contain three positive values.");
  }
  const direction = directionFromAffine(matrix);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      matrix[row][column] = direction[row][column] * values[column];
    }
  }
  return matrix;
}

export function axisAlignedAffine(spacing = [1, 1, 1], origin = [0, 0, 0]) {
  const values = Array.from(spacing || [], Number);
  const position = Array.from(origin || [], Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Fallback spacing values must be positive.");
  }
  if (position.length !== 3 || position.some((value) => !Number.isFinite(value))) {
    throw new Error("Fallback origin values must be finite.");
  }
  return [
    [values[0], 0, 0, position[0]],
    [0, values[1], 0, position[1]],
    [0, 0, values[2], position[2]],
    [0, 0, 0, 1],
  ];
}

export function makeVolumeGeometry({ shape, affine, sourceKind = "unknown", warnings = [] }) {
  const dimensions = Array.from(shape || [], Number);
  if (dimensions.length !== 3 || dimensions.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error("Volume geometry requires three positive dimensions.");
  }
  const affineRas = normalizeAffine(affine);
  return {
    shape: dimensions,
    affine: affineRas,
    spacing: spacingFromAffineUnchecked(affineRas),
    origin: affineRas.slice(0, 3).map((row) => row[3]),
    direction: directionFromAffine(affineRas),
    sourceKind: String(sourceKind || "unknown"),
    warnings: Array.from(warnings || [], String),
  };
}

export function geometryWithSpacing(geometry, spacing, sourceKind = geometry?.sourceKind) {
  return makeVolumeGeometry({
    shape: geometry.shape,
    affine: affineWithSpacing(geometry.affine, spacing),
    sourceKind,
    warnings: geometry.warnings,
  });
}

export function upsampleGeometryAlongK(geometry, factor) {
  const scale = Number(factor);
  if (![1, 5, 10].includes(scale)) {
    throw new Error("K-axis interpolation factor must be 1, 5, or 10.");
  }
  const affine = normalizeAffine(geometry.affine);
  for (let row = 0; row < 3; row += 1) affine[row][2] /= scale;
  return makeVolumeGeometry({
    shape: [geometry.shape[0], geometry.shape[1], (geometry.shape[2] - 1) * scale + 1],
    affine,
    sourceKind: scale === 1 ? geometry.sourceKind : `${geometry.sourceKind}:k-${scale}x`,
    warnings: geometry.warnings,
  });
}

export function transformGeometryForPreparedImage(
  geometry,
  {
    sourceWidth, sourceHeight, contentWidth, contentHeight,
    outputWidth = contentWidth, outputHeight = contentHeight,
    contentX = 0, contentY = 0,
  },
) {
  if (!geometry) return null;
  const scaleX = Number(sourceWidth) / Number(contentWidth);
  const scaleY = Number(sourceHeight) / Number(contentHeight);
  if (![scaleX, scaleY].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Prepared image geometry scale is invalid.");
  }
  const internalToSource = [
    [scaleX, 0, 0, -Number(contentX) * scaleX],
    [0, scaleY, 0, -Number(contentY) * scaleY],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  return makeVolumeGeometry({
    shape: [Math.round(Number(outputWidth)), Math.round(Number(outputHeight)), geometry.shape[2]],
    affine: multiply4(geometry.affine, internalToSource),
    sourceKind: geometry.sourceKind,
    warnings: geometry.warnings,
  });
}

export function dicomSeriesGeometry(ordered, { positionToleranceMm = 1e-3 } = {}) {
  if (!Array.isArray(ordered) || ordered.length === 0) throw new Error("No DICOM slices were provided.");
  if (ordered.some((instance) => Number(instance.frameCount || 1) !== 1)) {
    throw new Error("Multi-frame DICOM needs per-frame geometry metadata and uses fallback geometry.");
  }
  const first = ordered[0];
  const width = Number(first.columns);
  const height = Number(first.rows);
  const iop = finiteVector(first.imageOrientation, 6, "ImageOrientationPatient");
  const iDirection = normalize(iop.slice(0, 3), "DICOM I direction");
  const jDirection = normalize(iop.slice(3, 6), "DICOM J direction");
  if (Math.abs(dot(iDirection, jDirection)) > 1e-4) {
    throw new Error("DICOM row and column directions are not orthogonal.");
  }
  const normal = normalize(cross(iDirection, jDirection), "DICOM slice normal");
  const pixelSpacing = finiteVector(first.pixelSpacing, 2, "PixelSpacing");
  const [rowSpacing, columnSpacing] = pixelSpacing;
  if (!(rowSpacing > 0 && columnSpacing > 0)) throw new Error("DICOM PixelSpacing must be positive.");

  const positions = ordered.map((instance) => {
    if (instance.columns !== width || instance.rows !== height) {
      throw new Error("DICOM slice dimensions are inconsistent.");
    }
    const currentIop = finiteVector(instance.imageOrientation, 6, "ImageOrientationPatient");
    if (currentIop.some((value, index) => Math.abs(value - iop[index]) > 1e-4)) {
      throw new Error("DICOM slices are not parallel with a consistent orientation.");
    }
    const currentSpacing = finiteVector(instance.pixelSpacing, 2, "PixelSpacing");
    if (currentSpacing.some((value, index) => Math.abs(value - pixelSpacing[index]) > positionToleranceMm)) {
      throw new Error("DICOM PixelSpacing changes within the series.");
    }
    return finiteVector(instance.imagePosition, 3, "ImagePositionPatient");
  });

  let sliceStep;
  const warnings = [];
  if (positions.length >= 2) {
    const denominator = positions.reduce((sum, _position, index) => sum + index * index, 0);
    // Fit through the exact first IPP. This avoids accumulating normal DICOM
    // decimal rounding (for example alternating 0.629/0.630 mm increments).
    sliceStep = [0, 1, 2].map((axis) => positions.reduce(
      (sum, position, index) => sum + index * (position[axis] - positions[0][axis]),
      0,
    ) / denominator);
    const stepLength = norm(sliceStep);
    if (!(stepLength > positionToleranceMm)) throw new Error("DICOM slices contain duplicate positions.");
    const errors = positions.map((position, index) =>
      norm(subtract(position, add(positions[0], scale(sliceStep, index)))));
    const maxError = Math.max(...errors);
    if (maxError > Math.max(positionToleranceMm, stepLength * 0.01)) {
      throw new Error(`DICOM slice positions are not regular enough for one 3D affine (max error ${maxError} mm).`);
    }
    if (maxError > positionToleranceMm) warnings.push(`DICOM slice fit residual: ${maxError} mm.`);
  } else {
    const declared = Math.abs(Number(first.sliceSpacing)) || 1;
    sliceStep = scale(normal, declared);
    warnings.push("Single-slice DICOM geometry uses the declared slice spacing.");
  }

  const affineLps = [
    [iDirection[0] * columnSpacing, jDirection[0] * rowSpacing, sliceStep[0], positions[0][0]],
    [iDirection[1] * columnSpacing, jDirection[1] * rowSpacing, sliceStep[1], positions[0][1]],
    [iDirection[2] * columnSpacing, jDirection[2] * rowSpacing, sliceStep[2], positions[0][2]],
    [0, 0, 0, 1],
  ];
  return makeVolumeGeometry({
    shape: [width, height, positions.length],
    affine: multiply4(LPS_TO_RAS, affineLps),
    sourceKind: "dicom",
    warnings,
  });
}
