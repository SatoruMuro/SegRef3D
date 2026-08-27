import { signedDistanceForLabel } from "./volume-tools.mjs?v=17";

function validateMasks(masks, width, height) {
  if (!Array.isArray(masks) || masks.length === 0) throw new Error("The label volume is empty.");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Mask dimensions are invalid.");
  }
  const size = width * height;
  for (const mask of masks) {
    if (!(mask instanceof Uint8Array) || mask.length !== size) {
      throw new Error("Mask dimensions do not match.");
    }
  }
}

function validSpacing(spacing) {
  if (!Array.isArray(spacing) || spacing.length < 3) return null;
  const values = spacing.slice(0, 3).map(Number);
  return values.every((value) => Number.isFinite(value) && value > 0) ? values : null;
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function createVolumeStatisticsAccumulator() {
  const firstFrames = new Int32Array(256);
  const lastFrames = new Int32Array(256);
  firstFrames.fill(-1);
  lastFrames.fill(-1);
  return {
    voxelCounts: new Float64Array(256),
    firstFrames,
    lastFrames,
    occupiedSlices: new Uint32Array(256),
  };
}

function accumulateVolumeStatistics(mask, frame, accumulator) {
  const labelsInSlice = new Uint8Array(256);
  for (let index = 0; index < mask.length; index += 1) {
    const label = mask[index];
    if (label === 0) continue;
    accumulator.voxelCounts[label] += 1;
    labelsInSlice[label] = 1;
  }
  for (let label = 1; label <= 255; label += 1) {
    if (!labelsInSlice[label]) continue;
    if (accumulator.firstFrames[label] < 0) accumulator.firstFrames[label] = frame;
    accumulator.lastFrames[label] = frame;
    accumulator.occupiedSlices[label] += 1;
  }
}

function finalizeVolumeStatistics(accumulator, spacing, objectNames) {
  const normalizedSpacing = validSpacing(spacing);
  const voxelVolume = normalizedSpacing ? normalizedSpacing.reduce((product, value) => product * value, 1) : null;
  const rows = [];
  for (let label = 1; label <= 255; label += 1) {
    const voxelCount = accumulator.voxelCounts[label];
    if (voxelCount === 0) continue;
    const volumeMm3 = voxelVolume === null ? null : voxelCount * voxelVolume;
    rows.push({
      objectId: label,
      objectName: String(objectNames[label] || `Object ${label}`),
      voxelCount,
      volumeMm3,
      volumeCm3: volumeMm3 === null ? null : volumeMm3 / 1000,
      firstFrame: accumulator.firstFrames[label] + 1,
      lastFrame: accumulator.lastFrames[label] + 1,
      occupiedSlices: accumulator.occupiedSlices[label],
    });
  }
  return { calibrated: normalizedSpacing !== null, spacing: normalizedSpacing, rows };
}

export function volumeStatistics(masks, width, height, spacing, objectNames = []) {
  validateMasks(masks, width, height);
  const accumulator = createVolumeStatisticsAccumulator();
  for (let frame = 0; frame < masks.length; frame += 1) {
    accumulateVolumeStatistics(masks[frame], frame, accumulator);
  }
  return finalizeVolumeStatistics(accumulator, spacing, objectNames);
}

export async function volumeStatisticsAsync(
  masks,
  width,
  height,
  spacing,
  objectNames = [],
  { onProgress, isCanceled, yieldEverySlices = 1 } = {},
) {
  validateMasks(masks, width, height);
  const accumulator = createVolumeStatisticsAccumulator();
  const yieldInterval = Math.max(1, Math.floor(Number(yieldEverySlices) || 1));
  for (let frame = 0; frame < masks.length; frame += 1) {
    if (isCanceled?.()) return null;
    accumulateVolumeStatistics(masks[frame], frame, accumulator);
    onProgress?.(frame + 1, masks.length);
    if ((frame + 1) % yieldInterval === 0 && frame + 1 < masks.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  if (isCanceled?.()) return null;
  return finalizeVolumeStatistics(accumulator, spacing, objectNames);
}

export function createVolumeStatisticsCsv(statistics) {
  const header = [
    "object_id", "object_name", "voxel_count", "volume_mm3", "volume_cm3",
    "first_frame", "last_frame", "occupied_slices",
  ];
  const lines = [header.join(",")];
  for (const row of statistics.rows) {
    lines.push([
      row.objectId,
      csvCell(row.objectName),
      row.voxelCount,
      row.volumeMm3 === null ? "" : row.volumeMm3.toFixed(6).replace(/\.?0+$/, ""),
      row.volumeCm3 === null ? "" : row.volumeCm3.toFixed(9).replace(/\.?0+$/, ""),
      row.firstFrame,
      row.lastFrame,
      row.occupiedSlices,
    ].join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function labelUsed(masks, label) {
  return masks.some((mask) => mask.includes(label));
}

export function relabelVolume(masks, sourceLabel, targetLabel) {
  if (sourceLabel === targetLabel) throw new Error("Source and target objects must be different.");
  if (labelUsed(masks, targetLabel)) {
    throw new Error(`Object ${targetLabel} is already used. Use Merge instead of Relabel.`);
  }
  return masks.map((mask) => {
    const output = mask.slice();
    for (let index = 0; index < output.length; index += 1) {
      if (output[index] === sourceLabel) output[index] = targetLabel;
    }
    return output;
  });
}

export function mergeLabelVolume(masks, sourceLabel, targetLabel) {
  if (sourceLabel === targetLabel) throw new Error("Source and target objects must be different.");
  return masks.map((mask) => {
    const output = mask.slice();
    for (let index = 0; index < output.length; index += 1) {
      if (output[index] === sourceLabel) output[index] = targetLabel;
    }
    return output;
  });
}

export function clearLabelVolume(masks, label) {
  return masks.map((mask) => {
    const output = mask.slice();
    for (let index = 0; index < output.length; index += 1) {
      if (output[index] === label) output[index] = 0;
    }
    return output;
  });
}

export function frameIndicesForScope(scope, currentFrame, startFrame, endFrame, frameCount) {
  if (!Number.isInteger(frameCount) || frameCount < 1) throw new Error("Frame count must be positive.");
  if (scope === "current") {
    if (!Number.isInteger(currentFrame) || currentFrame < 0 || currentFrame >= frameCount) throw new Error("Current frame is invalid.");
    return [currentFrame];
  }
  if (scope === "all") return Array.from({ length: frameCount }, (_, index) => index);
  if (scope !== "range") throw new Error(`Unsupported frame scope: ${scope}.`);
  if (!(Number.isInteger(startFrame) && Number.isInteger(endFrame) && 0 <= startFrame && startFrame <= endFrame && endFrame < frameCount)) {
    throw new Error("Choose a valid cleanup frame range.");
  }
  return Array.from({ length: endFrame - startFrame + 1 }, (_, index) => startFrame + index);
}

export function buildMaskVolumeChanges(currentMasks, nextMasks) {
  if (!Array.isArray(currentMasks) || !Array.isArray(nextMasks) || currentMasks.length !== nextMasks.length) {
    throw new Error("Mask transaction does not match the image sequence.");
  }
  const changes = [];
  for (let index = 0; index < currentMasks.length; index += 1) {
    const before = currentMasks[index];
    const after = nextMasks[index];
    if (!(before instanceof Uint8Array) || !(after instanceof Uint8Array) || before.length !== after.length) {
      throw new Error(`Mask dimensions do not match at frame ${index + 1}.`);
    }
    let changed = false;
    for (let pixel = 0; pixel < before.length; pixel += 1) {
      if (before[pixel] !== after[pixel]) {
        changed = true;
        break;
      }
    }
    if (changed) changes.push({ index, before: before.slice(), after: after.slice() });
  }
  return changes;
}

export function applyMaskVolumeChanges(masks, changes, direction) {
  if (direction !== "before" && direction !== "after") throw new Error("Mask transaction direction must be before or after.");
  const result = masks.map((mask) => mask.slice());
  for (const change of changes) {
    if (!Number.isInteger(change.index) || change.index < 0 || change.index >= result.length) throw new Error("Mask transaction frame is invalid.");
    const replacement = change[direction];
    if (!(replacement instanceof Uint8Array) || replacement.length !== result[change.index].length) throw new Error("Mask transaction dimensions do not match.");
    result[change.index] = replacement.slice();
  }
  return result;
}

function neighbors(index, width, height, diagonal = true) {
  const x = index % width;
  const y = Math.floor(index / width);
  const output = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (!diagonal && dx !== 0 && dy !== 0) continue;
      const nextX = x + dx;
      const nextY = y + dy;
      if (0 <= nextX && nextX < width && 0 <= nextY && nextY < height) {
        output.push(nextY * width + nextX);
      }
    }
  }
  return output;
}

export function connectedComponents(binary, width, height, diagonal = true) {
  if (binary.length !== width * height) throw new Error("Binary mask dimensions do not match.");
  const visited = new Uint8Array(binary.length);
  const components = [];
  for (let start = 0; start < binary.length; start += 1) {
    if (!binary[start] || visited[start]) continue;
    const component = [];
    const queue = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      component.push(index);
      for (const next of neighbors(index, width, height, diagonal)) {
        if (binary[next] && !visited[next]) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
    components.push(component);
  }
  return components.sort((left, right) => right.length - left.length);
}

function binaryLabel(mask, label) {
  const binary = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) binary[index] = mask[index] === label ? 1 : 0;
  return binary;
}

function dilate(binary, width, height, radius) {
  const output = binary.slice();
  for (let index = 0; index < binary.length; index += 1) {
    if (!binary[index]) continue;
    const centerX = index % width;
    const centerY = Math.floor(index / width);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = centerX + dx;
        const y = centerY + dy;
        if (0 <= x && x < width && 0 <= y && y < height) output[y * width + x] = 1;
      }
    }
  }
  return output;
}

function erode(binary, width, height, radius) {
  const output = binary.slice();
  for (let index = 0; index < binary.length; index += 1) {
    if (!binary[index]) continue;
    const centerX = index % width;
    const centerY = Math.floor(index / width);
    let keep = true;
    for (let dy = -radius; dy <= radius && keep; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = centerX + dx;
        const y = centerY + dy;
        if (x < 0 || x >= width || y < 0 || y >= height || !binary[y * width + x]) {
          keep = false;
          break;
        }
      }
    }
    if (!keep) output[index] = 0;
  }
  return output;
}

function fillHoles(binary, width, height) {
  const outside = new Uint8Array(binary.length);
  const queue = [];
  const add = (index) => {
    if (!binary[index] && !outside[index]) {
      outside[index] = 1;
      queue.push(index);
    }
  };
  for (let x = 0; x < width; x += 1) {
    add(x);
    add((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    add(y * width);
    add(y * width + width - 1);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const next of neighbors(queue[cursor], width, height, false)) add(next);
  }
  const output = binary.slice();
  for (let index = 0; index < output.length; index += 1) {
    if (!binary[index] && !outside[index]) output[index] = 1;
  }
  return output;
}

function smooth(binary, width, height, amount) {
  let output = binary.slice();
  for (let iteration = 0; iteration < amount; iteration += 1) {
    const next = output.slice();
    for (let index = 0; index < output.length; index += 1) {
      let count = output[index] ? 1 : 0;
      for (const neighbor of neighbors(index, width, height, true)) count += output[neighbor] ? 1 : 0;
      next[index] = count >= 5 ? 1 : 0;
    }
    output = next;
  }
  return output;
}

export function cleanupLabelMask(mask, width, height, label, operation, options = {}) {
  let binary = binaryLabel(mask, label);
  const radius = Math.max(1, Math.min(20, Math.floor(Number(options.radius) || 1)));
  const iterations = Math.max(1, Math.min(20, Math.floor(Number(options.iterations) || 1)));
  if (operation === "fill-holes") {
    binary = fillHoles(binary, width, height);
  } else if (operation === "remove-islands") {
    const minimum = Math.max(1, Math.floor(Number(options.minimumSize) || 1));
    const output = new Uint8Array(binary.length);
    for (const component of connectedComponents(binary, width, height)) {
      if (component.length >= minimum) for (const index of component) output[index] = 1;
    }
    binary = output;
  } else if (operation === "largest") {
    const output = new Uint8Array(binary.length);
    for (const index of connectedComponents(binary, width, height)[0] || []) output[index] = 1;
    binary = output;
  } else if (operation === "smooth") {
    binary = smooth(binary, width, height, Math.max(1, Math.floor(Number(options.amount) || 1)));
  } else if (operation === "dilate" || operation === "erode") {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      binary = operation === "dilate" ? dilate(binary, width, height, radius) : erode(binary, width, height, radius);
    }
  } else {
    throw new Error(`Unsupported cleanup operation: ${operation}.`);
  }

  const output = mask.slice();
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] === label && !binary[index]) output[index] = 0;
    else if (output[index] === 0 && binary[index]) output[index] = label;
  }
  return output;
}

export function interpolateLabelMasks(startMask, endMask, width, height, label, intermediateCount) {
  const count = Math.floor(Number(intermediateCount));
  if (!Number.isInteger(count) || count < 1) throw new Error("At least one intermediate frame is required.");
  if (!startMask.includes(label)) throw new Error("The start frame does not contain the selected object.");
  if (!endMask.includes(label)) throw new Error("The end frame does not contain the selected object.");
  const left = signedDistanceForLabel(startMask, width, height, label);
  const right = signedDistanceForLabel(endMask, width, height, label);
  const masks = [];
  for (let step = 1; step <= count; step += 1) {
    const ratio = step / (count + 1);
    const binary = new Uint8Array(width * height);
    for (let index = 0; index < binary.length; index += 1) {
      binary[index] = left[index] * (1 - ratio) + right[index] * ratio <= 0 ? 1 : 0;
    }
    masks.push(binary);
  }
  return masks;
}

export function checkProject({ images, spacing, objectNames = [], segmentationJobs = [], maxLabel = 20 }) {
  const findings = [];
  const add = (severity, code, message) => findings.push({ severity, code, message });
  if (!Array.isArray(images) || images.length === 0) {
    add("error", "no-frames", "No frames are loaded.");
    return findings;
  }
  add("ok", "frame-count", `${images.length} frames loaded.`);
  const width = images[0].width;
  const height = images[0].height;
  const consistent = images.every((image) => image.width === width && image.height === height);
  add(consistent ? "ok" : "error", "frame-dimensions", consistent ? "All frame dimensions match." : "Frame dimensions do not match.");
  const masksValid = images.every((image) => image.mask?.length === image.width * image.height);
  add(masksValid ? "ok" : "error", "mask-dimensions", masksValid ? "All mask dimensions match their frames." : "One or more mask dimensions are invalid.");
  if (masksValid) add("ok", "source-alignment", "Source images and masks are aligned by frame.");
  const normalizedSpacing = validSpacing(spacing);
  add(normalizedSpacing ? "ok" : "warning", "spacing", normalizedSpacing ? "Pixel and slice spacing are available." : "Volume calibration required.");

  const numberedNames = images.map((image) => {
    const name = String(image.name || "").replaceAll("\\", "/").split("/").at(-1);
    const match = name.match(/^(.*?)(\d+)(\.[^.]+)?$/);
    return match ? { prefix: match[1], number: Number(match[2]), suffix: match[3] || "" } : null;
  });
  if (numberedNames.every(Boolean) && numberedNames.length > 1) {
    const reference = numberedNames[0];
    const patternMatches = numberedNames.every((entry) => entry.prefix === reference.prefix && entry.suffix.toLowerCase() === reference.suffix.toLowerCase());
    if (!patternMatches) {
      add("warning", "filename-pattern", "Source filenames do not follow one consistent numbered sequence.");
    } else {
      const numbers = numberedNames.map((entry) => entry.number);
      const unique = new Set(numbers);
      const missing = [];
      for (let number = Math.min(...numbers); number <= Math.max(...numbers) && missing.length < 12; number += 1) {
        if (!unique.has(number)) missing.push(number);
      }
      if (unique.size !== numbers.length) add("error", "duplicate-frame-name", "Duplicate source frame numbers were found.");
      if (missing.length) {
        add("warning", "missing-frames", `Numbered source sequence has missing frame(s): ${missing.join(", ")}${missing.length === 12 ? " or more" : ""}.`);
      } else {
        add("ok", "filename-sequence", "Numbered source filenames form a continuous sequence.");
      }
      const ordered = numbers.every((number, index) => index === 0 || number > numbers[index - 1]);
      if (!ordered) add("warning", "filename-order", "Source filenames are not in ascending frame order.");
    }
  }

  const presence = Array.from({ length: maxLabel + 1 }, () => []);
  let invalidLabel = null;
  for (let frame = 0; frame < images.length; frame += 1) {
    const seen = new Set();
    for (const value of images[frame].mask || []) {
      if (value > maxLabel) invalidLabel ??= value;
      if (value > 0 && value <= maxLabel) seen.add(value);
    }
    for (const label of seen) presence[label].push(frame + 1);
  }
  add(invalidLabel === null ? "ok" : "error", "label-range", invalidLabel === null ? `All label IDs are within 1-${maxLabel}.` : `Invalid label ID ${invalidLabel} was found.`);
  for (let label = 1; label <= maxLabel; label += 1) {
    const frames = presence[label];
    if (frames.length > 0) {
      add("info", `object-${label}-range`, `${objectNames[label] || `Object ${label}`} is present on frames ${frames[0]}-${frames.at(-1)} (${frames.length} occupied).`);
    } else if (objectNames[label] && objectNames[label] !== `Object ${label}`) {
      add("warning", `object-${label}-empty`, `${objectNames[label]} has no mask pixels.`);
    }
  }

  if (masksValid && consistent) {
    const isolatedByLabel = new Map();
    for (let frame = 0; frame < images.length; frame += 1) {
      const mask = images[frame].mask;
      const visited = new Uint8Array(mask.length);
      for (let start = 0; start < mask.length; start += 1) {
        const label = mask[start];
        if (!label || label > maxLabel || visited[start]) continue;
        visited[start] = 1;
        const queue = [start];
        let size = 0;
        for (let head = 0; head < queue.length; head += 1) {
          const index = queue[head];
          size += 1;
          const x = index % width;
          const y = Math.floor(index / width);
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
              const neighbor = ny * width + nx;
              if (!visited[neighbor] && mask[neighbor] === label) {
                visited[neighbor] = 1;
                queue.push(neighbor);
              }
            }
          }
        }
        if (size <= 3) {
          const existing = isolatedByLabel.get(label);
          if (!existing || size < existing.size) isolatedByLabel.set(label, { frame: frame + 1, size });
        }
      }
    }
    for (const [label, component] of isolatedByLabel) {
      add(
        "warning",
        `object-${label}-isolated`,
        `${objectNames[label] || `Object ${label}`} contains a suspicious ${component.size}-pixel isolated component on frame ${component.frame}.`,
      );
    }
  }

  for (const job of segmentationJobs) {
    const prompts = job.prompts?.length ? job.prompts : job.box ? [{ type: "box", frame: job.promptFrame, box: job.box }] : [];
    if (!(Number.isInteger(job.trackingStart) && Number.isInteger(job.trackingEnd) && 0 <= job.trackingStart && job.trackingStart <= job.trackingEnd && job.trackingEnd < images.length)) {
      add("error", `tracking-${job.id}-range`, `Object ${job.id} has an invalid AI tracking range.`);
      continue;
    }
    const seenFrames = new Set();
    for (const prompt of prompts) {
      if (seenFrames.has(prompt.frame)) add("error", `tracking-${job.id}-duplicate-${prompt.frame}`, `Object ${job.id} has duplicate prompts on frame ${prompt.frame + 1}.`);
      seenFrames.add(prompt.frame);
      if (prompt.type !== "box") add("error", `tracking-${job.id}-type`, `Object ${job.id} has an unsupported prompt type.`);
      if (!Number.isInteger(prompt.frame) || prompt.frame < job.trackingStart || prompt.frame > job.trackingEnd || prompt.frame < 0 || prompt.frame >= images.length) {
        add("error", `tracking-${job.id}-frame`, `Object ${job.id} has a prompt outside its tracking range.`);
      }
      const box = prompt.box;
      if (!Array.isArray(box) || box.length !== 4 || !(0 <= box[0] && box[0] < box[2] && box[2] <= width && 0 <= box[1] && box[1] < box[3] && box[3] <= height)) {
        add("error", `tracking-${job.id}-box`, `Object ${job.id} has a box outside the image bounds.`);
      }
    }
    if (prompts.length === 0) add("error", `tracking-${job.id}-prompts`, `Object ${job.id} has no box prompts.`);
  }
  if (segmentationJobs.length > 0 && !findings.some((finding) => finding.severity === "error" && finding.code.startsWith("tracking-"))) {
    const promptCount = segmentationJobs.reduce((sum, job) => sum + (job.prompts?.length || (job.box ? 1 : 0)), 0);
    add("ok", "tracking-valid", `${segmentationJobs.length} AI tracking objects and ${promptCount} prompts are valid.`);
  }
  return findings;
}
