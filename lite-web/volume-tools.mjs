function validateVolume(masks, width, height) {
  if (!Array.isArray(masks) || masks.length === 0) throw new Error("The label volume is empty.");
  const sliceSize = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || sliceSize < 1) {
    throw new Error("Volume dimensions are invalid.");
  }
  for (const mask of masks) {
    if (mask.length !== sliceSize) throw new Error("Label mask dimensions do not match.");
  }
}

function normalizedSpacing(spacing) {
  return [0, 1, 2].map((index) => {
    const value = Number(spacing?.[index]);
    return Number.isFinite(value) && value > 0 ? value : 1;
  });
}

function normalizedOrigin(origin) {
  return [0, 1, 2].map((index) => {
    const value = Number(origin?.[index]);
    return Number.isFinite(value) ? value : 0;
  });
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text).replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("VolInfo CSV contains an unterminated quoted value.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim() !== ""));
}

function headerMatches(row, expected) {
  return expected.every((value, index) => row?.[index]?.trim().toLowerCase() === value);
}

export function createVolInfoCsv({ width, height, depth, spacing, origin = [0, 0, 0] }) {
  const dimensions = [width, height, depth].map(Number);
  if (dimensions.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error("VolInfo dimensions must be positive integers.");
  }
  const normalized = normalizedSpacing(spacing);
  const normalizedPosition = normalizedOrigin(origin);
  const rows = [
    ["Width", "Height", "Depth"],
    dimensions,
    ["X Spacing", "Y Spacing", "Z Spacing"],
    normalized,
    ["X Origin", "Y Origin", "Z Origin"],
    normalizedPosition,
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function parseVolInfoCsv(text) {
  const rows = parseCsvRows(text);
  const sizeHeader = rows.findIndex((row) =>
    headerMatches(row, ["width", "height", "depth"]),
  );
  const spacingHeader = rows.findIndex((row) =>
    headerMatches(row, ["x spacing", "y spacing", "z spacing"]),
  );
  const originHeader = rows.findIndex((row) =>
    headerMatches(row, ["x origin", "y origin", "z origin"]),
  );
  if (sizeHeader < 0 || !rows[sizeHeader + 1]) {
    throw new Error("Could not find Width/Height/Depth rows in VolInfo CSV.");
  }
  if (spacingHeader < 0 || !rows[spacingHeader + 1]) {
    throw new Error("Could not find X/Y/Z Spacing rows in VolInfo CSV.");
  }
  const dimensions = rows[sizeHeader + 1].slice(0, 3).map(Number);
  if (dimensions.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error("VolInfo dimensions must be positive integers.");
  }
  const spacing = rows[spacingHeader + 1].slice(0, 3).map(Number);
  if (spacing.length < 3 || spacing.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("VolInfo spacing values must be positive numbers.");
  }
  const origin = originHeader >= 0 && rows[originHeader + 1]
    ? rows[originHeader + 1].slice(0, 3).map(Number)
    : [0, 0, 0];
  if (origin.length < 3 || origin.some((value) => !Number.isFinite(value))) {
    throw new Error("VolInfo origin values must be numbers.");
  }
  return {
    width: dimensions[0],
    height: dimensions[1],
    depth: dimensions[2],
    spacing,
    origin,
  };
}

export function createNiftiLabelVolume(
  masks,
  width,
  height,
  spacing = [1, 1, 1],
  origin = [0, 0, 0],
) {
  validateVolume(masks, width, height);
  const [spacingX, spacingY, spacingZ] = normalizedSpacing(spacing);
  const [originX, originY, originZ] = normalizedOrigin(origin);
  const voxelCount = width * height * masks.length;
  const output = new Uint8Array(352 + voxelCount);
  const view = new DataView(output.buffer);
  view.setInt32(0, 348, true);
  view.setInt16(40, 3, true);
  view.setInt16(42, width, true);
  view.setInt16(44, height, true);
  view.setInt16(46, masks.length, true);
  for (let index = 4; index < 8; index += 1) view.setInt16(40 + index * 2, 1, true);
  view.setInt16(70, 2, true);
  view.setInt16(72, 8, true);
  view.setFloat32(76, 1, true);
  view.setFloat32(80, spacingX, true);
  view.setFloat32(84, spacingY, true);
  view.setFloat32(88, spacingZ, true);
  view.setFloat32(108, 352, true);
  view.setUint8(123, 2);
  view.setInt16(254, 1, true);
  view.setFloat32(280, spacingX, true);
  view.setFloat32(292, originX, true);
  view.setFloat32(300, spacingY, true);
  view.setFloat32(308, originY, true);
  view.setFloat32(320, spacingZ, true);
  view.setFloat32(324, originZ, true);
  output.set([0x6e, 0x2b, 0x31, 0], 344);
  let offset = 352;
  for (const mask of masks) {
    output.set(mask, offset);
    offset += mask.length;
  }
  return output;
}

function writeTiffEntry(view, offset, tag, type, count, value) {
  view.setUint16(offset, tag, true);
  view.setUint16(offset + 2, type, true);
  view.setUint32(offset + 4, count, true);
  if (type === 3 && count === 1) {
    view.setUint16(offset + 8, value, true);
    view.setUint16(offset + 10, 0, true);
  } else {
    view.setUint32(offset + 8, value, true);
  }
}

export function createTiffLabelStack(masks, width, height) {
  validateVolume(masks, width, height);
  const sliceBytes = width * height;
  const entryCount = 9;
  const ifdBytes = 2 + entryCount * 12 + 4;
  const pixelStart = 8;
  const firstIfd = pixelStart + sliceBytes * masks.length;
  const output = new Uint8Array(firstIfd + ifdBytes * masks.length);
  const view = new DataView(output.buffer);
  output[0] = 0x49;
  output[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, firstIfd, true);
  for (let page = 0; page < masks.length; page += 1) {
    output.set(masks[page], pixelStart + page * sliceBytes);
    const ifdOffset = firstIfd + page * ifdBytes;
    view.setUint16(ifdOffset, entryCount, true);
    const entries = [
      [256, 4, 1, width],
      [257, 4, 1, height],
      [258, 3, 1, 8],
      [259, 3, 1, 1],
      [262, 3, 1, 1],
      [273, 4, 1, pixelStart + page * sliceBytes],
      [277, 3, 1, 1],
      [278, 4, 1, height],
      [279, 4, 1, sliceBytes],
    ];
    for (let index = 0; index < entries.length; index += 1) {
      writeTiffEntry(view, ifdOffset + 2 + index * 12, ...entries[index]);
    }
    view.setUint32(
      ifdOffset + 2 + entryCount * 12,
      page + 1 < masks.length ? ifdOffset + ifdBytes : 0,
      true,
    );
  }
  return output;
}

export function distanceTransform1d(values, length) {
  const distances = new Float64Array(length);
  const locations = new Int32Array(length);
  const boundaries = new Float64Array(length + 1);
  let k = 0;
  locations[0] = 0;
  boundaries[0] = -Infinity;
  boundaries[1] = Infinity;
  for (let q = 1; q < length; q += 1) {
    let intersection;
    while (true) {
      const p = locations[k];
      intersection = (values[q] + q * q - (values[p] + p * p)) / (2 * q - 2 * p);
      if (intersection > boundaries[k]) break;
      k -= 1;
    }
    k += 1;
    locations[k] = q;
    boundaries[k] = intersection;
    boundaries[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < length; q += 1) {
    while (boundaries[k + 1] < q) k += 1;
    const delta = q - locations[k];
    distances[q] = delta * delta + values[locations[k]];
  }
  return distances;
}

export function squaredDistanceTransform(features, width, height) {
  const infinity = (width * width + height * height) * 4 + 1;
  const temporary = new Float64Array(width * height);
  const output = new Float64Array(width * height);
  const row = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    const start = y * width;
    for (let x = 0; x < width; x += 1) row[x] = features[start + x] ? 0 : infinity;
    temporary.set(distanceTransform1d(row, width), start);
  }
  const column = new Float64Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) column[y] = temporary[y * width + x];
    const transformed = distanceTransform1d(column, height);
    for (let y = 0; y < height; y += 1) output[y * width + x] = transformed[y];
  }
  return output;
}

export function signedDistanceForLabel(mask, width, height, label) {
  if (mask.length !== width * height) throw new Error("Label mask dimensions do not match.");
  const foreground = new Uint8Array(mask.length);
  const background = new Uint8Array(mask.length);
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const inside = mask[index] === label;
    foreground[index] = inside ? 1 : 0;
    background[index] = inside ? 0 : 1;
    if (inside) count += 1;
  }
  const output = new Float32Array(mask.length);
  if (count === 0) {
    output.fill(Math.hypot(width, height));
    return output;
  }
  if (count === mask.length) {
    output.fill(-Math.hypot(width, height));
    return output;
  }
  const toForeground = squaredDistanceTransform(foreground, width, height);
  const toBackground = squaredDistanceTransform(background, width, height);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.sqrt(toForeground[index]) - Math.sqrt(toBackground[index]);
  }
  return output;
}

export function cropLabelVolume(masks, width, height, label, padding = 2) {
  validateVolume(masks, width, height);
  const safePadding = Math.max(0, Math.floor(Number(padding) || 0));
  let minimumX = width;
  let minimumY = height;
  let maximumX = -1;
  let maximumY = -1;
  for (const mask of masks) {
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * width;
      for (let x = 0; x < width; x += 1) {
        if (mask[rowStart + x] !== label) continue;
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
      }
    }
  }
  if (maximumX < 0) return null;

  minimumX = Math.max(0, minimumX - safePadding);
  minimumY = Math.max(0, minimumY - safePadding);
  maximumX = Math.min(width - 1, maximumX + safePadding);
  maximumY = Math.min(height - 1, maximumY + safePadding);
  const croppedWidth = maximumX - minimumX + 1;
  const croppedHeight = maximumY - minimumY + 1;
  const croppedMasks = masks.map((mask) => {
    const output = new Uint8Array(croppedWidth * croppedHeight);
    for (let y = 0; y < croppedHeight; y += 1) {
      const sourceStart = (minimumY + y) * width + minimumX;
      output.set(mask.subarray(sourceStart, sourceStart + croppedWidth), y * croppedWidth);
    }
    return output;
  });
  return {
    masks: croppedMasks,
    width: croppedWidth,
    height: croppedHeight,
    offsetX: minimumX,
    offsetY: minimumY,
  };
}

export function interpolateLabelVolume(masks, width, height, label, factor) {
  validateVolume(masks, width, height);
  const scale = Number(factor);
  if (![1, 5, 10].includes(scale)) throw new Error("Interpolation factor must be 1, 5, or 10.");
  const sliceSize = width * height;
  if (scale === 1 || masks.length === 1) {
    const output = new Uint8Array(sliceSize * masks.length);
    for (let z = 0; z < masks.length; z += 1) {
      for (let index = 0; index < sliceSize; index += 1) {
        output[z * sliceSize + index] = masks[z][index] === label ? 1 : 0;
      }
    }
    return { data: output, depth: masks.length };
  }

  const depth = (masks.length - 1) * scale + 1;
  const output = new Uint8Array(sliceSize * depth);
  let left = signedDistanceForLabel(masks[0], width, height, label);
  for (let z = 0; z < masks.length - 1; z += 1) {
    const right = signedDistanceForLabel(masks[z + 1], width, height, label);
    for (let step = 0; step < scale; step += 1) {
      const ratio = step / scale;
      const targetStart = (z * scale + step) * sliceSize;
      for (let index = 0; index < sliceSize; index += 1) {
        output[targetStart + index] = left[index] * (1 - ratio) + right[index] * ratio <= 0 ? 1 : 0;
      }
    }
    left = right;
  }
  const lastStart = (depth - 1) * sliceSize;
  const lastMask = masks.at(-1);
  for (let index = 0; index < sliceSize; index += 1) {
    output[lastStart + index] = lastMask[index] === label ? 1 : 0;
  }
  return { data: output, depth };
}

function triangleNormal(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

function edgePoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function tetraTriangles(points, values) {
  const inside = [];
  const outside = [];
  for (let index = 0; index < 4; index += 1) (values[index] ? inside : outside).push(index);
  if (inside.length === 0 || inside.length === 4) return [];
  if (inside.length === 1 || inside.length === 3) {
    const reverse = inside.length === 3;
    const pivot = reverse ? outside[0] : inside[0];
    const others = reverse ? inside : outside;
    const triangle = others.map((index) => edgePoint(points[pivot], points[index]));
    return [reverse ? [triangle[0], triangle[2], triangle[1]] : triangle];
  }
  const [insideA, insideB] = inside;
  const [outsideA, outsideB] = outside;
  const p00 = edgePoint(points[insideA], points[outsideA]);
  const p01 = edgePoint(points[insideA], points[outsideB]);
  const p10 = edgePoint(points[insideB], points[outsideA]);
  const p11 = edgePoint(points[insideB], points[outsideB]);
  return [[p00, p01, p10], [p10, p01, p11]];
}

export function marchingTetrahedra(
  volume,
  width,
  height,
  depth,
  spacing = [1, 1, 1],
  origin = [0, 0, 0],
) {
  if (volume.length !== width * height * depth) throw new Error("Volume dimensions do not match.");
  const [spacingX, spacingY, spacingZ] = normalizedSpacing(spacing);
  const [originX, originY, originZ] = normalizedOrigin(origin);
  const offsets = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const tetrahedra = [
    [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
    [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
  ];
  const sample = (x, y, z) =>
    x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= depth
      ? 0
      : volume[(z * height + y) * width + x];
  let minimumX = width;
  let minimumY = height;
  let minimumZ = depth;
  let maximumX = -1;
  let maximumY = -1;
  let maximumZ = -1;
  for (let z = 0; z < depth; z += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!sample(x, y, z)) continue;
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        minimumZ = Math.min(minimumZ, z);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
        maximumZ = Math.max(maximumZ, z);
      }
    }
  }
  if (maximumX < 0) return [];
  const triangles = [];
  for (let z = minimumZ - 1; z <= maximumZ; z += 1) {
    for (let y = minimumY - 1; y <= maximumY; y += 1) {
      for (let x = minimumX - 1; x <= maximumX; x += 1) {
        const values = offsets.map(([dx, dy, dz]) => sample(x + dx, y + dy, z + dz));
        const total = values.reduce((sum, value) => sum + (value ? 1 : 0), 0);
        if (total === 0 || total === 8) continue;
        const points = offsets.map(([dx, dy, dz]) => [
          originX + (x + dx) * spacingX,
          originY + (y + dy) * spacingY,
          originZ + (z + dz) * spacingZ,
        ]);
        for (const tetra of tetrahedra) {
          const tetraPoints = tetra.map((index) => points[index]);
          const tetraValues = tetra.map((index) => values[index]);
          triangles.push(...tetraTriangles(tetraPoints, tetraValues));
        }
      }
    }
  }
  return triangles;
}

export function createBinaryStl(triangles, name = "SegRef3D") {
  const output = new Uint8Array(84 + triangles.length * 50);
  const header = new TextEncoder().encode(name.slice(0, 80));
  output.set(header, 0);
  const view = new DataView(output.buffer);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const triangle of triangles) {
    const normal = triangleNormal(...triangle);
    for (const value of normal) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    for (const vertex of triangle) {
      for (const value of vertex) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return output;
}
