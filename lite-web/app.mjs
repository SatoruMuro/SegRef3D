import {
  LABEL_COLORS,
  applyRasterToMask,
  clamp,
  colorToRgb,
  createProjectId,
  fitViewport,
  labelPixelCounts,
  maskFilename,
  naturalCompare,
  nearestEdgePoint,
  overlayFilename,
  pointInsideImage,
  screenToImage,
  timestamp,
  transferLabel,
  zoomAroundPoint,
} from "./core.mjs";
import { loadMask, saveMask } from "./storage.mjs";
import { createZip } from "./zip.mjs";

const elements = {
  canvas: document.querySelector("#editor-canvas"),
  canvasPanel: document.querySelector("#canvas-panel"),
  emptyState: document.querySelector("#empty-state"),
  emptyLoad: document.querySelector("#empty-load"),
  loadFolder: document.querySelector("#load-folder"),
  folderInput: document.querySelector("#folder-input"),
  loadDemo: document.querySelector("#load-demo"),
  fitView: document.querySelector("#fit-view"),
  previousImage: document.querySelector("#previous-image"),
  nextImage: document.querySelector("#next-image"),
  imageCounter: document.querySelector("#image-counter"),
  targetLabel: document.querySelector("#target-label"),
  transferLabel: document.querySelector("#transfer-label"),
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  addMask: document.querySelector("#add-mask"),
  eraseMask: document.querySelector("#erase-mask"),
  transferMask: document.querySelector("#transfer-mask"),
  undoLine: document.querySelector("#undo-line"),
  redoLine: document.querySelector("#redo-line"),
  clearLines: document.querySelector("#clear-lines"),
  undoEdit: document.querySelector("#undo-edit"),
  redoEdit: document.querySelector("#redo-edit"),
  exportLabels: document.querySelector("#export-labels"),
  exportOverlays: document.querySelector("#export-overlays"),
  labelsPanel: document.querySelector("#labels-panel"),
  labelsToggle: document.querySelector("#labels-toggle"),
  labelsClose: document.querySelector("#labels-close"),
  labelList: document.querySelector("#label-list"),
  maskSummary: document.querySelector("#mask-summary"),
  projectName: document.querySelector("#project-name"),
  autosaveIndicator: document.querySelector("#autosave-indicator"),
  statusText: document.querySelector("#status-text"),
  imageMeta: document.querySelector("#image-meta"),
  zoomReadout: document.querySelector("#zoom-readout"),
  loadingOverlay: document.querySelector("#loading-overlay"),
  loadingTitle: document.querySelector("#loading-title"),
  loadingDetail: document.querySelector("#loading-detail"),
  toast: document.querySelector("#toast"),
};

const state = {
  images: [],
  index: -1,
  projectId: null,
  projectName: "No project",
  targetLabel: 1,
  transferLabel: 2,
  visibleLabels: Array.from({ length: 21 }, (_, index) => index === 1),
  drawMode: "free",
  viewport: { zoom: 1, panX: 0, panY: 0 },
  pointer: {
    drawing: false,
    panning: false,
    id: null,
    lastX: 0,
    lastY: 0,
  },
  wheelLockedUntil: 0,
  saveQueue: Promise.resolve(),
  toastTimer: null,
  loading: false,
};

const context = elements.canvas.getContext("2d", { alpha: false });

function currentImage() {
  return state.index >= 0 ? state.images[state.index] : null;
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function showToast(message, duration = 2800) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, duration);
}

function setLoading(active, title = "Loading images", detail = "") {
  state.loading = active;
  elements.loadingOverlay.hidden = !active;
  elements.loadingTitle.textContent = title;
  elements.loadingDetail.textContent = detail;
}

function setSaveState(text, className = "") {
  elements.autosaveIndicator.textContent = text;
  elements.autosaveIndicator.className = `save-state ${className}`.trim();
}

function initializeLabels() {
  for (let label = 1; label <= 20; label += 1) {
    const targetOption = new Option(`Obj ${label}`, String(label));
    const transferOption = new Option(`Obj ${label}`, String(label));
    elements.targetLabel.add(targetOption);
    elements.transferLabel.add(transferOption);

    const item = document.createElement("div");
    item.className = `label-item${label === 1 ? " target" : ""}`;
    item.dataset.label = String(label);
    item.innerHTML = `
      <input type="checkbox" aria-label="Show object ${label}" ${label === 1 ? "checked" : ""} />
      <span class="label-swatch" style="background:${LABEL_COLORS[label]}"></span>
      <span class="label-copy"><strong>Obj ${label}</strong><span>0 px</span></span>
    `;
    const checkbox = item.querySelector("input");
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      state.visibleLabels[label] = checkbox.checked;
      for (const image of state.images) image.overlayDirty = true;
      render();
    });
    item.addEventListener("click", () => selectTargetLabel(label));
    elements.labelList.append(item);
  }
  elements.targetLabel.value = "1";
  elements.transferLabel.value = "2";
}

function selectTargetLabel(label) {
  state.targetLabel = label;
  elements.targetLabel.value = String(label);
  state.visibleLabels[label] = true;
  const item = elements.labelList.querySelector(`[data-label="${label}"]`);
  if (item) item.querySelector("input").checked = true;
  for (const image of state.images) image.overlayDirty = true;
  updateLabelTargets();
  render();
}

function updateLabelTargets() {
  for (const item of elements.labelList.querySelectorAll(".label-item")) {
    item.classList.toggle("target", Number(item.dataset.label) === state.targetLabel);
  }
}

function updateLabelCounts() {
  const image = currentImage();
  const counts = image ? labelPixelCounts(image.mask) : new Uint32Array(21);
  let used = 0;
  for (let label = 1; label <= 20; label += 1) {
    const count = counts[label];
    if (count > 0) used += 1;
    const countElement = elements.labelList.querySelector(
      `[data-label="${label}"] .label-copy span`,
    );
    if (countElement) countElement.textContent = `${count.toLocaleString()} px`;
  }
  elements.maskSummary.textContent = image ? `${used} label${used === 1 ? "" : "s"}` : "No labels";
}

function setControlsEnabled(enabled) {
  const controls = [
    elements.fitView,
    elements.targetLabel,
    elements.transferLabel,
    elements.addMask,
    elements.eraseMask,
    elements.transferMask,
    elements.exportLabels,
    elements.exportOverlays,
    ...elements.modeButtons,
  ];
  for (const control of controls) control.disabled = !enabled;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const image = currentImage();
  const enabled = Boolean(image);
  elements.undoLine.disabled = !enabled || (image.paths.length === 0 && image.activePath.length === 0);
  elements.redoLine.disabled = !enabled || image.pathRedo.length === 0;
  elements.clearLines.disabled = !enabled || (image.paths.length === 0 && image.activePath.length === 0);
  elements.undoEdit.disabled = !enabled || image.undo.length === 0;
  elements.redoEdit.disabled = !enabled || image.redo.length === 0;
  elements.previousImage.disabled = !enabled || state.index <= 0;
  elements.nextImage.disabled = !enabled || state.index >= state.images.length - 1;
}

function updateImageUi() {
  const image = currentImage();
  elements.emptyState.hidden = Boolean(image);
  elements.zoomReadout.hidden = !image;
  elements.imageCounter.textContent = image ? `${state.index + 1} / ${state.images.length}` : "0 / 0";
  elements.projectName.textContent = state.projectName;
  elements.imageMeta.textContent = image
    ? `${image.name} · ${image.width} × ${image.height}px`
    : "Local processing · no uploads";
  if (image) {
    setStatus(`Editing ${image.name}. Wheel: images · Ctrl+wheel: zoom · middle drag: pan.`);
  }
  updateLabelCounts();
  updateHistoryButtons();
}

function resizeCanvas({ refit = false } = {}) {
  const rect = elements.canvasPanel.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (elements.canvas.width !== width || elements.canvas.height !== height) {
    elements.canvas.width = width;
    elements.canvas.height = height;
    if (currentImage() && refit) fitCurrentImage();
  }
  render();
}

function fitCurrentImage() {
  const image = currentImage();
  if (!image) return;
  const rect = elements.canvasPanel.getBoundingClientRect();
  state.viewport = fitViewport(rect.width, rect.height, image.width, image.height, 22);
  render();
}

function buildOverlay(image) {
  if (!image.overlayDirty && image.overlayCanvas) return image.overlayCanvas;
  const overlay = image.overlayCanvas ?? document.createElement("canvas");
  overlay.width = image.width;
  overlay.height = image.height;
  const overlayContext = overlay.getContext("2d");
  const pixels = overlayContext.createImageData(image.width, image.height);
  const output = pixels.data;
  for (let index = 0; index < image.mask.length; index += 1) {
    const label = image.mask[index];
    if (label === 0 || !state.visibleLabels[label]) continue;
    const rgb = colorToRgb(LABEL_COLORS[label]);
    const offset = index * 4;
    output[offset] = rgb.r;
    output[offset + 1] = rgb.g;
    output[offset + 2] = rgb.b;
    output[offset + 3] = 77;
  }
  overlayContext.putImageData(pixels, 0, 0);
  image.overlayCanvas = overlay;
  image.overlayDirty = false;
  return overlay;
}

function drawPath(path, active = false) {
  if (path.length === 0) return;
  const color = LABEL_COLORS[state.targetLabel];
  context.beginPath();
  context.moveTo(path[0].x, path[0].y);
  for (let index = 1; index < path.length; index += 1) {
    context.lineTo(path[index].x, path[index].y);
  }
  if (!active && path.length >= 3) {
    context.closePath();
    context.fillStyle = `${color}35`;
    context.fill();
  }
  context.strokeStyle = color;
  context.lineWidth = Math.max(1.2 / state.viewport.zoom, 2 / state.viewport.zoom);
  context.stroke();

  if ((state.drawMode === "click" || state.drawMode === "snap") && active) {
    const radius = 3.2 / state.viewport.zoom;
    context.fillStyle = color;
    for (const point of path) {
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  const width = elements.canvas.width / dpr;
  const height = elements.canvas.height / dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = "#d7dadd";
  context.fillRect(0, 0, width, height);
  const image = currentImage();
  if (!image) return;

  context.save();
  context.translate(state.viewport.panX, state.viewport.panY);
  context.scale(state.viewport.zoom, state.viewport.zoom);
  context.imageSmoothingEnabled = state.viewport.zoom < 2.5;
  context.drawImage(image.sourceCanvas, 0, 0);
  context.drawImage(buildOverlay(image), 0, 0);
  context.strokeStyle = "rgb(30 35 38 / 45%)";
  context.lineWidth = 1 / state.viewport.zoom;
  context.strokeRect(0, 0, image.width, image.height);
  for (const path of image.paths) drawPath(path, false);
  drawPath(image.activePath, true);
  context.restore();

  elements.zoomReadout.textContent = `${Math.round(state.viewport.zoom * 100)}%`;
}

function localPointerPosition(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function imagePointerPosition(event, snap = false) {
  const image = currentImage();
  const local = localPointerPosition(event);
  let point = screenToImage(local.x, local.y, state.viewport);
  point = {
    x: clamp(point.x, 0, Math.max(0, image.width - 1)),
    y: clamp(point.y, 0, Math.max(0, image.height - 1)),
  };
  if (snap) {
    if (!image.sourcePixels) {
      image.sourcePixels = image.sourceCanvas
        .getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, image.width, image.height).data;
    }
    point = nearestEdgePoint(image.sourcePixels, image.width, image.height, point, 9);
  }
  return point;
}

function finalizeActivePath() {
  const image = currentImage();
  if (!image || image.activePath.length === 0) return false;
  if (image.activePath.length >= 3) {
    image.paths.push(image.activePath.map((point) => ({ ...point })));
    image.pathRedo.length = 0;
  }
  image.activePath = [];
  updateHistoryButtons();
  render();
  return true;
}

function undoLine() {
  const image = currentImage();
  if (!image) return;
  if (image.activePath.length > 0) finalizeActivePath();
  const path = image.paths.pop();
  if (!path) return;
  image.pathRedo.push(path);
  setStatus("Undid the last drawn line. Mask edit history was not changed.");
  updateHistoryButtons();
  render();
}

function redoLine() {
  const image = currentImage();
  if (!image) return;
  const path = image.pathRedo.pop();
  if (!path) return;
  image.paths.push(path);
  setStatus("Redid the last drawn line. Mask edit history was not changed.");
  updateHistoryButtons();
  render();
}

function clearLines() {
  const image = currentImage();
  if (!image) return;
  image.activePath = [];
  image.paths = [];
  image.pathRedo = [];
  setStatus("Cleared drawn lines.");
  updateHistoryButtons();
  render();
}

function rasterizePaths(image) {
  finalizeActivePath();
  if (image.paths.length === 0) return null;
  const rasterCanvas = document.createElement("canvas");
  rasterCanvas.width = image.width;
  rasterCanvas.height = image.height;
  const rasterContext = rasterCanvas.getContext("2d", { willReadFrequently: true });
  rasterContext.fillStyle = "#ffffff";
  for (const path of image.paths) {
    if (path.length < 3) continue;
    rasterContext.beginPath();
    rasterContext.moveTo(path[0].x, path[0].y);
    for (let index = 1; index < path.length; index += 1) {
      rasterContext.lineTo(path[index].x, path[index].y);
    }
    rasterContext.closePath();
    rasterContext.fill();
  }
  const rgba = rasterContext.getImageData(0, 0, image.width, image.height).data;
  const alpha = new Uint8Array(image.width * image.height);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[index * 4 + 3];
  return alpha;
}

function pushEditSnapshot(image) {
  image.undo.push(image.mask.slice());
  if (image.undo.length > 20) image.undo.shift();
  image.redo.length = 0;
}

async function autosave(image, message = "Autosaved in browser") {
  if (!state.projectId || !image) return;
  const snapshot = image.mask.slice();
  setSaveState("Saving…", "saving");
  state.saveQueue = state.saveQueue.then(async () => {
    try {
      await saveMask(state.projectId, image.name, image.width, image.height, snapshot);
      setSaveState(message, "saved");
    } catch (error) {
      console.error(error);
      setSaveState("Autosave unavailable");
      setStatus(`Browser autosave failed: ${error.message}`);
    }
  });
  return state.saveQueue;
}

function finishMaskChange(image, status) {
  image.overlayDirty = true;
  image.paths = [];
  image.pathRedo = [];
  image.activePath = [];
  updateLabelCounts();
  updateHistoryButtons();
  render();
  setStatus(status);
  autosave(image);
}

function commitPaths(operation) {
  const image = currentImage();
  if (!image) return;
  const raster = rasterizePaths(image);
  if (!raster) {
    setStatus("Draw a closed region before editing the mask.");
    showToast("No drawn region to apply.");
    return;
  }
  const before = image.mask.slice();
  const changed = applyRasterToMask(image.mask, raster, operation, state.targetLabel);
  if (changed === 0) {
    image.mask = before;
    setStatus(operation === "erase" ? "No pixels of the target label were inside the region." : "Mask unchanged.");
    return;
  }
  image.undo.push(before);
  if (image.undo.length > 20) image.undo.shift();
  image.redo.length = 0;
  finishMaskChange(
    image,
    `${operation === "add" ? "Added to" : "Erased from"} Obj ${state.targetLabel}: ${changed.toLocaleString()} px.`,
  );
}

function transferCurrentLabel() {
  const image = currentImage();
  if (!image) return;
  if (state.targetLabel === state.transferLabel) {
    showToast("Choose a different destination label.");
    return;
  }
  const before = image.mask.slice();
  const changed = transferLabel(image.mask, state.targetLabel, state.transferLabel);
  if (changed === 0) {
    setStatus(`Obj ${state.targetLabel} has no pixels on this image.`);
    return;
  }
  image.undo.push(before);
  if (image.undo.length > 20) image.undo.shift();
  image.redo.length = 0;
  state.visibleLabels[state.transferLabel] = true;
  const checkbox = elements.labelList.querySelector(
    `[data-label="${state.transferLabel}"] input`,
  );
  if (checkbox) checkbox.checked = true;
  for (const item of state.images) item.overlayDirty = true;
  finishMaskChange(
    image,
    `Transferred ${changed.toLocaleString()} px from Obj ${state.targetLabel} to Obj ${state.transferLabel}.`,
  );
}

function undoEdit() {
  const image = currentImage();
  if (!image || image.undo.length === 0) return;
  image.redo.push(image.mask.slice());
  image.mask = image.undo.pop();
  image.overlayDirty = true;
  updateLabelCounts();
  updateHistoryButtons();
  render();
  setStatus("Undid the last mask edit.");
  autosave(image);
}

function redoEdit() {
  const image = currentImage();
  if (!image || image.redo.length === 0) return;
  image.undo.push(image.mask.slice());
  image.mask = image.redo.pop();
  image.overlayDirty = true;
  updateLabelCounts();
  updateHistoryButtons();
  render();
  setStatus("Redid the last mask edit.");
  autosave(image);
}

function switchImage(delta) {
  if (state.images.length === 0) return;
  const nextIndex = clamp(state.index + delta, 0, state.images.length - 1);
  if (nextIndex === state.index) return;
  finalizeActivePath();
  state.index = nextIndex;
  fitCurrentImage();
  updateImageUi();
}

function setDrawMode(mode) {
  finalizeActivePath();
  state.drawMode = mode;
  for (const button of elements.modeButtons) {
    button.classList.toggle("selected", button.dataset.mode === mode);
  }
  setStatus(`${mode[0].toUpperCase()}${mode.slice(1)} drawing mode.`);
}

function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Image encoding failed."))),
      type,
      quality,
    );
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function labelPngBlob(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const outputContext = canvas.getContext("2d");
  const pixels = outputContext.createImageData(image.width, image.height);
  for (let index = 0; index < image.mask.length; index += 1) {
    const value = image.mask[index];
    const offset = index * 4;
    pixels.data[offset] = value;
    pixels.data[offset + 1] = value;
    pixels.data[offset + 2] = value;
    pixels.data[offset + 3] = 255;
  }
  outputContext.putImageData(pixels, 0, 0);
  return canvasToBlob(canvas);
}

async function overlayPngBlob(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const outputContext = canvas.getContext("2d");
  outputContext.drawImage(image.sourceCanvas, 0, 0);
  outputContext.drawImage(buildOverlay(image), 0, 0);
  return canvasToBlob(canvas);
}

async function exportSequence(kind) {
  if (state.images.length === 0 || state.loading) return;
  setLoading(true, kind === "labels" ? "Exporting label PNG" : "Exporting overlay PNG", "Preparing files");
  try {
    const entries = [];
    for (let index = 0; index < state.images.length; index += 1) {
      const image = state.images[index];
      elements.loadingDetail.textContent = `${index + 1} / ${state.images.length}`;
      const blob = kind === "labels" ? await labelPngBlob(image) : await overlayPngBlob(image);
      entries.push({
        name: kind === "labels" ? maskFilename(index) : overlayFilename(index),
        blob,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    elements.loadingDetail.textContent = "Creating ZIP";
    const zip = await createZip(entries);
    const prefix = kind === "labels" ? "label_png" : "overlay_png";
    const filename = `${prefix}_${timestamp()}.zip`;
    downloadBlob(zip, filename);
    setStatus(`Exported ${entries.length} ${kind === "labels" ? "label" : "overlay"} PNGs.`);
    showToast(`Downloaded ${filename}`);
  } catch (error) {
    console.error(error);
    setStatus(`Export failed: ${error.message}`);
    showToast("Export failed.");
  } finally {
    setLoading(false);
  }
}

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}`));
    };
    image.src = url;
  });
}

function makeWorkingCanvas(image, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const outputContext = canvas.getContext("2d", { willReadFrequently: false });
  outputContext.fillStyle = "#ffffff";
  outputContext.fillRect(0, 0, targetWidth, targetHeight);
  const x = Math.floor((targetWidth - sourceWidth) / 2);
  const y = Math.floor((targetHeight - sourceHeight) / 2);
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";
  outputContext.drawImage(image, x, y, sourceWidth, sourceHeight);
  return canvas;
}

async function prepareFiles(files) {
  const accepted = files
    .filter((file) => /\.(jpe?g|png)$/i.test(file.name))
    .sort((left, right) => naturalCompare(left.name, right.name));
  if (accepted.length === 0) {
    showToast("No JPG or PNG images were found.");
    return;
  }

  setLoading(true, "Loading images", `Reading 0 / ${accepted.length}`);
  const decoded = [];
  try {
    for (let index = 0; index < accepted.length; index += 1) {
      elements.loadingDetail.textContent = `Reading ${index + 1} / ${accepted.length}`;
      const result = await decodeImage(accepted[index]);
      decoded.push({ file: accepted[index], ...result });
    }

    const largeCount = decoded.filter(
      ({ image }) => Math.max(image.naturalWidth, image.naturalHeight) > 2000,
    ).length;
    const resizeLarge =
      largeCount > 0 &&
      window.confirm(
        `${largeCount} image(s) are larger than 2000px.\n\nResize their longest side to 1000px for smoother editing?`,
      );

    const dimensions = decoded.map(({ image }) => {
      const longest = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = resizeLarge && longest > 2000 ? 1000 / longest : 1;
      return {
        width: Math.max(1, Math.round(image.naturalWidth * scale)),
        height: Math.max(1, Math.round(image.naturalHeight * scale)),
      };
    });
    const uniqueSizes = new Set(dimensions.map(({ width, height }) => `${width}x${height}`));
    const unifyCanvas =
      uniqueSizes.size > 1 &&
      window.confirm(
        "The images have different dimensions.\n\nPlace them at the center of a shared white canvas?",
      );
    const commonWidth = Math.max(...dimensions.map(({ width }) => width));
    const commonHeight = Math.max(...dimensions.map(({ height }) => height));
    const totalPixels = dimensions.reduce(
      (sum, size) => sum + (unifyCanvas ? commonWidth * commonHeight : size.width * size.height),
      0,
    );
    if (
      totalPixels > 160_000_000 &&
      !window.confirm(
        `This project needs about ${Math.round(totalPixels / 1_000_000)} million mask pixels.\n\nContinue loading?`,
      )
    ) {
      return;
    }

    const projectId = createProjectId(accepted);
    const prepared = [];
    for (let index = 0; index < decoded.length; index += 1) {
      elements.loadingDetail.textContent = `Preparing ${index + 1} / ${decoded.length}`;
      const source = decoded[index];
      const size = dimensions[index];
      const width = unifyCanvas ? commonWidth : size.width;
      const height = unifyCanvas ? commonHeight : size.height;
      const sourceCanvas = makeWorkingCanvas(source.image, size.width, size.height, width, height);
      const restored = await loadMask(projectId, source.file.name, width, height).catch(() => null);
      prepared.push({
        name: source.file.name,
        width,
        height,
        sourceCanvas,
        sourcePixels: null,
        mask: restored ?? new Uint8Array(width * height),
        overlayCanvas: null,
        overlayDirty: true,
        paths: [],
        activePath: [],
        pathRedo: [],
        undo: [],
        redo: [],
      });
      URL.revokeObjectURL(source.url);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    state.images = prepared;
    state.projectId = projectId;
    state.index = 0;
    state.projectName = accepted[0].webkitRelativePath?.split("/")[0] || "Image sequence";
    state.visibleLabels = Array.from({ length: 21 }, (_, label) => label === 1);
    for (let label = 1; label <= 20; label += 1) {
      const checkbox = elements.labelList.querySelector(`[data-label="${label}"] input`);
      if (checkbox) checkbox.checked = label === 1;
    }
    setControlsEnabled(true);
    updateImageUi();
    requestAnimationFrame(() => fitCurrentImage());
    const restoredCount = prepared.filter((item) => item.mask.some((value) => value !== 0)).length;
    setSaveState(restoredCount ? `Restored ${restoredCount} autosaved mask(s)` : "Browser autosave active", "saved");
    setStatus(
      `Loaded ${prepared.length} image(s)${resizeLarge ? " · resized large images" : ""}${unifyCanvas ? " · unified canvas" : ""}.`,
    );
    elements.canvas.focus();
    navigator.storage?.persist?.().catch(() => {});
  } catch (error) {
    console.error(error);
    setStatus(error.message);
    showToast("Image loading failed.");
  } finally {
    for (const entry of decoded) URL.revokeObjectURL(entry.url);
    setLoading(false);
    elements.folderInput.value = "";
  }
}

function demoImage(index, width = 900, height = 650) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const demoContext = canvas.getContext("2d");
  demoContext.fillStyle = "#f9f8f4";
  demoContext.fillRect(0, 0, width, height);
  demoContext.strokeStyle = "#d6d0c8";
  demoContext.lineWidth = 2;
  for (let y = 28; y < height; y += 34) {
    demoContext.beginPath();
    demoContext.moveTo(0, y + Math.sin(index + y) * 5);
    for (let x = 0; x <= width; x += 20) {
      demoContext.lineTo(x, y + Math.sin(x / 55 + index * 0.5) * 5);
    }
    demoContext.stroke();
  }
  const offset = (index - 3.5) * 9;
  demoContext.fillStyle = "#c9899e";
  demoContext.beginPath();
  demoContext.ellipse(360 + offset, 315, 155, 205, -0.12, 0, Math.PI * 2);
  demoContext.fill();
  demoContext.fillStyle = "#efd9d2";
  demoContext.beginPath();
  demoContext.ellipse(360 + offset, 315, 105, 155, -0.12, 0, Math.PI * 2);
  demoContext.fill();
  demoContext.fillStyle = "#7e486b";
  demoContext.beginPath();
  demoContext.ellipse(360 + offset, 315, 42 + index * 2, 88, -0.12, 0, Math.PI * 2);
  demoContext.fill();
  demoContext.fillStyle = "#89a7a1";
  demoContext.beginPath();
  demoContext.ellipse(590 - offset * 0.5, 330, 100, 150, 0.18, 0, Math.PI * 2);
  demoContext.fill();
  demoContext.fillStyle = "#d8e1dc";
  demoContext.beginPath();
  demoContext.ellipse(590 - offset * 0.5, 330, 56, 100, 0.18, 0, Math.PI * 2);
  demoContext.fill();
  return canvas;
}

async function loadDemo() {
  setLoading(true, "Loading demo", "Preparing image sequence");
  const images = [];
  for (let index = 0; index < 8; index += 1) {
    const sourceCanvas = demoImage(index);
    images.push({
      name: `demo${String(index + 1).padStart(4, "0")}.png`,
      width: sourceCanvas.width,
      height: sourceCanvas.height,
      sourceCanvas,
      sourcePixels: null,
      mask: new Uint8Array(sourceCanvas.width * sourceCanvas.height),
      overlayCanvas: null,
      overlayDirty: true,
      paths: [],
      activePath: [],
      pathRedo: [],
      undo: [],
      redo: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  state.images = images;
  state.projectId = "segref3d-lite-demo-v1";
  state.projectName = "Demo sequence";
  state.index = 0;
  setControlsEnabled(true);
  updateImageUi();
  setLoading(false);
  requestAnimationFrame(() => fitCurrentImage());
  setSaveState("Demo autosave active", "saved");
  setStatus("Demo loaded. Draw a region and apply Add or Erase.");
  elements.canvas.focus();
}

function handlePointerDown(event) {
  const image = currentImage();
  if (!image || state.loading) return;
  const local = localPointerPosition(event);
  if (event.button === 1) {
    event.preventDefault();
    state.pointer.panning = true;
    state.pointer.id = event.pointerId;
    state.pointer.lastX = local.x;
    state.pointer.lastY = local.y;
    elements.canvas.classList.add("panning");
    elements.canvas.setPointerCapture(event.pointerId);
    return;
  }
  if (event.button !== 0) return;
  const rawPoint = screenToImage(local.x, local.y, state.viewport);
  if (!pointInsideImage(rawPoint, image.width, image.height)) return;
  event.preventDefault();
  elements.canvas.focus();
  const point = imagePointerPosition(event, state.drawMode === "snap");
  if (state.drawMode === "free") {
    image.activePath = [point];
    state.pointer.drawing = true;
    state.pointer.id = event.pointerId;
    elements.canvas.setPointerCapture(event.pointerId);
  } else {
    image.activePath.push(point);
    image.pathRedo.length = 0;
  }
  updateHistoryButtons();
  render();
}

function handlePointerMove(event) {
  const image = currentImage();
  if (!image) return;
  const local = localPointerPosition(event);
  if (state.pointer.panning && state.pointer.id === event.pointerId) {
    const deltaX = local.x - state.pointer.lastX;
    const deltaY = local.y - state.pointer.lastY;
    state.viewport.panX += deltaX;
    state.viewport.panY += deltaY;
    state.pointer.lastX = local.x;
    state.pointer.lastY = local.y;
    render();
    return;
  }
  if (!state.pointer.drawing || state.pointer.id !== event.pointerId) return;
  const point = imagePointerPosition(event, false);
  const previous = image.activePath.at(-1);
  if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.8) {
    image.activePath.push(point);
    render();
  }
}

function handlePointerUp(event) {
  if (state.pointer.panning && state.pointer.id === event.pointerId) {
    state.pointer.panning = false;
    state.pointer.id = null;
    elements.canvas.classList.remove("panning");
    if (elements.canvas.hasPointerCapture(event.pointerId)) {
      elements.canvas.releasePointerCapture(event.pointerId);
    }
    return;
  }
  if (state.pointer.drawing && state.pointer.id === event.pointerId) {
    state.pointer.drawing = false;
    state.pointer.id = null;
    if (elements.canvas.hasPointerCapture(event.pointerId)) {
      elements.canvas.releasePointerCapture(event.pointerId);
    }
    finalizeActivePath();
  }
}

function handleWheel(event) {
  if (!currentImage()) return;
  event.preventDefault();
  const local = localPointerPosition(event);
  if (event.ctrlKey || event.metaKey) {
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nextZoom = clamp(state.viewport.zoom * factor, 0.05, 24);
    state.viewport = zoomAroundPoint(state.viewport, local.x, local.y, nextZoom);
    render();
    return;
  }
  if (event.shiftKey) {
    state.viewport.panX -= event.deltaY || event.deltaX;
    render();
    return;
  }
  const now = performance.now();
  if (now < state.wheelLockedUntil) return;
  state.wheelLockedUntil = now + 180;
  switchImage(event.deltaY > 0 ? 1 : -1);
}

function handleKeyDown(event) {
  const tagName = event.target?.tagName;
  if (tagName === "INPUT" || tagName === "SELECT" || tagName === "TEXTAREA") return;
  if (!currentImage()) return;
  if (event.key === "Enter") {
    finalizeActivePath();
    event.preventDefault();
  } else if (event.key === "Escape") {
    currentImage().activePath = [];
    render();
    updateHistoryButtons();
  } else if (["PageDown", "f", "F", "j", "J"].includes(event.key)) {
    switchImage(1);
    event.preventDefault();
  } else if (["PageUp", "r", "R", "u", "U"].includes(event.key)) {
    switchImage(-1);
    event.preventDefault();
  } else if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
    state.viewport.panX += 28;
    render();
    event.preventDefault();
  } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
    state.viewport.panX -= 28;
    render();
    event.preventDefault();
  } else if (event.key === "ArrowUp" || event.key === "w" || event.key === "W") {
    state.viewport.panY += 28;
    render();
    event.preventDefault();
  } else if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") {
    state.viewport.panY -= 28;
    render();
    event.preventDefault();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.shiftKey ? redoEdit() : undoEdit();
    event.preventDefault();
  }
}

function bindEvents() {
  const openFolder = () => elements.folderInput.click();
  elements.loadFolder.addEventListener("click", openFolder);
  elements.emptyLoad.addEventListener("click", openFolder);
  elements.folderInput.addEventListener("change", () => prepareFiles([...elements.folderInput.files]));
  elements.loadDemo.addEventListener("click", loadDemo);
  elements.fitView.addEventListener("click", fitCurrentImage);
  elements.previousImage.addEventListener("click", () => switchImage(-1));
  elements.nextImage.addEventListener("click", () => switchImage(1));
  elements.targetLabel.addEventListener("change", () => selectTargetLabel(Number(elements.targetLabel.value)));
  elements.transferLabel.addEventListener("change", () => {
    state.transferLabel = Number(elements.transferLabel.value);
  });
  for (const button of elements.modeButtons) {
    button.addEventListener("click", () => setDrawMode(button.dataset.mode));
  }
  elements.addMask.addEventListener("click", () => commitPaths("add"));
  elements.eraseMask.addEventListener("click", () => commitPaths("erase"));
  elements.transferMask.addEventListener("click", transferCurrentLabel);
  elements.undoLine.addEventListener("click", undoLine);
  elements.redoLine.addEventListener("click", redoLine);
  elements.clearLines.addEventListener("click", clearLines);
  elements.undoEdit.addEventListener("click", undoEdit);
  elements.redoEdit.addEventListener("click", redoEdit);
  elements.exportLabels.addEventListener("click", () => exportSequence("labels"));
  elements.exportOverlays.addEventListener("click", () => exportSequence("overlays"));
  elements.labelsToggle.addEventListener("click", () => elements.labelsPanel.classList.add("open"));
  elements.labelsClose.addEventListener("click", () => elements.labelsPanel.classList.remove("open"));
  elements.canvas.addEventListener("pointerdown", handlePointerDown);
  elements.canvas.addEventListener("pointermove", handlePointerMove);
  elements.canvas.addEventListener("pointerup", handlePointerUp);
  elements.canvas.addEventListener("pointercancel", handlePointerUp);
  elements.canvas.addEventListener("dblclick", (event) => {
    if (state.drawMode !== "free") {
      event.preventDefault();
      finalizeActivePath();
    }
  });
  elements.canvas.addEventListener("wheel", handleWheel, { passive: false });
  elements.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("keydown", handleKeyDown);
  new ResizeObserver(() => resizeCanvas({ refit: true })).observe(elements.canvasPanel);
}

initializeLabels();
bindEvents();
setControlsEnabled(false);
resizeCanvas();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./service-worker.js").catch((error) => {
    console.warn("Service worker registration failed", error);
  });
}
