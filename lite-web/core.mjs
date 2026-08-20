export const LABEL_COLORS = [
  null,
  "#ff1616",
  "#1717e8",
  "#12dc2a",
  "#fff014",
  "#980b89",
  "#ff9f13",
  "#19d8da",
  "#8bfa22",
  "#878787",
  "#078d89",
  "#ffb7c4",
  "#ff1595",
  "#078d16",
  "#8d0e0e",
  "#11dacd",
  "#ffd216",
  "#ff4510",
  "#171287",
  "#e51545",
  "#858d08",
];

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function naturalCompare(left, right) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sanitizeFilename(name) {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return cleaned || "untitled";
}

export function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function maskFilename(index) {
  return `mask${String(index + 1).padStart(4, "0")}.png`;
}

export function overlayFilename(index) {
  return `overlay${String(index + 1).padStart(4, "0")}.png`;
}

export function rgbaToLabelMask(rgba, width, height, maximumLabel = 20) {
  if (rgba.length !== width * height * 4) {
    throw new Error("Decoded PNG dimensions do not match its pixel data.");
  }
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    if (rgba[offset + 3] === 0) continue;
    const red = rgba[offset];
    const green = rgba[offset + 1];
    const blue = rgba[offset + 2];
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 1) {
      throw new Error("Label PNG must be grayscale, not a color image.");
    }
    const value = Math.round((red + green + blue) / 3);
    if (value > maximumLabel) {
      throw new Error(`Label PNG contains value ${value}; supported values are 0-${maximumLabel}.`);
    }
    mask[index] = value;
  }
  return mask;
}

export function placeLabelMask(mask, sourceWidth, sourceHeight, targetWidth, targetHeight, x, y) {
  if (mask.length !== sourceWidth * sourceHeight) {
    throw new Error("Source mask dimensions do not match its pixel data.");
  }
  if (x < 0 || y < 0 || x + sourceWidth > targetWidth || y + sourceHeight > targetHeight) {
    throw new Error("Source mask does not fit inside the target canvas.");
  }
  const output = new Uint8Array(targetWidth * targetHeight);
  for (let row = 0; row < sourceHeight; row += 1) {
    const sourceStart = row * sourceWidth;
    const targetStart = (row + y) * targetWidth + x;
    output.set(mask.subarray(sourceStart, sourceStart + sourceWidth), targetStart);
  }
  return output;
}

export function resizeLabelMaskNearest(mask, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (mask.length !== sourceWidth * sourceHeight) {
    throw new Error("Source mask dimensions do not match its pixel data.");
  }
  if (targetWidth < 1 || targetHeight < 1) {
    throw new Error("Target mask dimensions must be positive.");
  }
  const output = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / targetHeight));
    const sourceRow = sourceY * sourceWidth;
    const targetRow = y * targetWidth;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / targetWidth));
      output[targetRow + x] = mask[sourceRow + sourceX];
    }
  }
  return output;
}

export function fitViewport(viewWidth, viewHeight, imageWidth, imageHeight, padding = 24) {
  if (!viewWidth || !viewHeight || !imageWidth || !imageHeight) {
    return { zoom: 1, panX: 0, panY: 0 };
  }
  const availableWidth = Math.max(1, viewWidth - padding * 2);
  const availableHeight = Math.max(1, viewHeight - padding * 2);
  const zoom = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
  return {
    zoom,
    panX: (viewWidth - imageWidth * zoom) / 2,
    panY: (viewHeight - imageHeight * zoom) / 2,
  };
}

export function screenToImage(screenX, screenY, viewport) {
  return {
    x: (screenX - viewport.panX) / viewport.zoom,
    y: (screenY - viewport.panY) / viewport.zoom,
  };
}

export function imageToScreen(imageX, imageY, viewport) {
  return {
    x: imageX * viewport.zoom + viewport.panX,
    y: imageY * viewport.zoom + viewport.panY,
  };
}

export function zoomAroundPoint(viewport, screenX, screenY, nextZoom) {
  const imagePoint = screenToImage(screenX, screenY, viewport);
  return {
    zoom: nextZoom,
    panX: screenX - imagePoint.x * nextZoom,
    panY: screenY - imagePoint.y * nextZoom,
  };
}

export function pointInsideImage(point, width, height) {
  return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
}

export function createProjectId(files) {
  const signature = files
    .map((file) => `${file.name}:${file.size ?? 0}:${file.lastModified ?? 0}`)
    .sort(naturalCompare)
    .join("|");
  let hash = 2166136261;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `project-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function applyRasterToMask(mask, rasterAlpha, operation, targetLabel) {
  if (mask.length !== rasterAlpha.length) {
    throw new Error("Mask and raster dimensions do not match.");
  }
  let changed = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (rasterAlpha[index] === 0) continue;
    const before = mask[index];
    if (operation === "add") {
      mask[index] = targetLabel;
    } else if (operation === "erase" && before === targetLabel) {
      mask[index] = 0;
    }
    if (mask[index] !== before) changed += 1;
  }
  return changed;
}

export function traceRegionPath(context, points, { closed = false, smooth = false } = {}) {
  if (!points.length) return;
  context.moveTo(points[0].x, points[0].y);
  if (!smooth || points.length < 3) {
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
    if (closed) context.closePath();
    return;
  }

  const tension = 0.75;
  const segmentCount = closed ? points.length : points.length - 1;
  const pointAt = (index) => {
    if (closed) return points[(index + points.length) % points.length];
    return points[clamp(index, 0, points.length - 1)];
  };

  for (let index = 0; index < segmentCount; index += 1) {
    const previous = pointAt(index - 1);
    const start = pointAt(index);
    const end = pointAt(index + 1);
    const following = pointAt(index + 2);
    const scale = tension / 6;
    context.bezierCurveTo(
      start.x + (end.x - previous.x) * scale,
      start.y + (end.y - previous.y) * scale,
      end.x - (following.x - start.x) * scale,
      end.y - (following.y - start.y) * scale,
      end.x,
      end.y,
    );
  }
  if (closed) context.closePath();
}

export function transferLabel(mask, sourceLabel, destinationLabel, rasterAlpha = null) {
  if (sourceLabel === destinationLabel) return 0;
  if (rasterAlpha && mask.length !== rasterAlpha.length) {
    throw new Error("Mask and raster dimensions do not match.");
  }
  let changed = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === sourceLabel && (!rasterAlpha || rasterAlpha[index] !== 0)) {
      mask[index] = destinationLabel;
      changed += 1;
    }
  }
  return changed;
}

export function labelPixelCounts(mask, labelCount = 20) {
  const counts = new Uint32Array(labelCount + 1);
  for (const value of mask) {
    if (value <= labelCount) counts[value] += 1;
  }
  return counts;
}

export function nearestEdgePoint(imageData, width, height, point, radius = 8) {
  if (!imageData || width < 3 || height < 3) return point;
  const centerX = clamp(Math.round(point.x), 1, width - 2);
  const centerY = clamp(Math.round(point.y), 1, height - 2);
  const sample = (x, y) => {
    const offset = (y * width + x) * 4;
    return (
      imageData[offset] * 0.299 +
      imageData[offset + 1] * 0.587 +
      imageData[offset + 2] * 0.114
    );
  };

  let bestX = centerX;
  let bestY = centerY;
  let bestScore = -1;
  const minX = Math.max(1, centerX - radius);
  const maxX = Math.min(width - 2, centerX + radius);
  const minY = Math.max(1, centerY - radius);
  const maxY = Math.min(height - 2, centerY + radius);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = sample(x + 1, y) - sample(x - 1, y);
      const dy = sample(x, y + 1) - sample(x, y - 1);
      const distance = Math.hypot(x - centerX, y - centerY);
      const score = Math.hypot(dx, dy) - distance * 0.35;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }
  return { x: bestX, y: bestY };
}

export function colorToRgb(hexColor) {
  const value = hexColor.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}
