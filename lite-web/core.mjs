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

export function transferLabel(mask, sourceLabel, destinationLabel) {
  if (sourceLabel === destinationLabel) return 0;
  let changed = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === sourceLabel) {
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
