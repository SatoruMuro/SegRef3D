import {
  LABEL_COLORS,
  applyRasterToMask,
  clamp,
  colorToRgb,
  combineLabelMasks,
  createProjectId,
  fitViewport,
  labelPixelCounts,
  maskFilename,
  naturalCompare,
  nearestEdgePoint,
  overlayFilename,
  placeLabelMask,
  pointInsideImage,
  rgbaToLabelMask,
  resizeLabelMaskNearest,
  sanitizeFilename,
  screenToImage,
  timestamp,
  traceRegionPath,
  transferLabel,
  zoomAroundPoint,
} from "./core.mjs";
import {
  decodeDicomSeries,
  groupDicomSeries,
  isNiftiFilename,
  parseDicomInstance,
  parseNiftiVolume,
} from "./medical-io.mjs";
import { clearProjectMasks, loadMask, saveMask } from "./storage.mjs";
import { createZip, parseZip } from "./zip.mjs";
import {
  SEGMENTATION_RESULT_KIND,
  createSegmentationJobManifest,
  validateSegmentationArchive,
} from "./segmentation-job.mjs";
import {
  adjustedRgba,
  hexToRgb,
  rgbAt,
  rgbRaster,
  rgbToHex,
  thresholdRaster,
} from "./image-tools.mjs";
import {
  createBinaryStl,
  createNiftiLabelVolume,
  createTiffLabelStack,
  createVolInfoCsv,
  interpolateLabelVolume,
  marchingTetrahedra,
  parseVolInfoCsv,
} from "./volume-tools.mjs";

const elements = {
  canvas: document.querySelector("#editor-canvas"),
  canvasPanel: document.querySelector("#canvas-panel"),
  emptyState: document.querySelector("#empty-state"),
  emptyLoad: document.querySelector("#empty-load"),
  loadFolder: document.querySelector("#load-folder"),
  folderInput: document.querySelector("#folder-input"),
  loadVolume: document.querySelector("#load-volume"),
  volumeInput: document.querySelector("#volume-input"),
  emptyVolume: document.querySelector("#empty-volume"),
  loadMasks: document.querySelector("#load-masks"),
  maskFolderInput: document.querySelector("#mask-folder-input"),
  maskZipInput: document.querySelector("#mask-zip-input"),
  loadDemo: document.querySelector("#load-demo"),
  fitView: document.querySelector("#fit-view"),
  previousImage: document.querySelector("#previous-image"),
  nextImage: document.querySelector("#next-image"),
  imageCounter: document.querySelector("#image-counter"),
  targetLabel: document.querySelector("#target-label"),
  transferLabel: document.querySelector("#transfer-label"),
  penColor: document.querySelector("#pen-color"),
  penColorSwatch: document.querySelector("#pen-color-swatch"),
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  addMask: document.querySelector("#add-mask"),
  eraseMask: document.querySelector("#erase-mask"),
  transferMask: document.querySelector("#transfer-mask"),
  autoApplyMode: document.querySelector("#auto-apply-mode"),
  undoLine: document.querySelector("#undo-line"),
  redoLine: document.querySelector("#redo-line"),
  clearLines: document.querySelector("#clear-lines"),
  undoEdit: document.querySelector("#undo-edit"),
  redoEdit: document.querySelector("#redo-edit"),
  clearMasks: document.querySelector("#clear-masks"),
  imageTools: document.querySelector("#image-tools"),
  exportLabels: document.querySelector("#export-labels"),
  exportOverlays: document.querySelector("#export-overlays"),
  exportProject: document.querySelector("#export-project"),
  segonwebJobs: document.querySelector("#segonweb-jobs"),
  exportSegonweb: document.querySelector("#export-segonweb"),
  importSegonweb: document.querySelector("#import-segonweb"),
  segonwebResultInput: document.querySelector("#segonweb-result-input"),
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
  localFileDialog: document.querySelector("#local-file-dialog"),
  localFileTitle: document.querySelector("#local-file-title"),
  localFileDontShow: document.querySelector("#local-file-dont-show"),
  localFileCancel: document.querySelector("#local-file-cancel"),
  localFileContinue: document.querySelector("#local-file-continue"),
  localFileContinueText: document.querySelector("#local-file-continue span"),
  maskImportDialog: document.querySelector("#mask-import-dialog"),
  chooseMaskFolder: document.querySelector("#choose-mask-folder"),
  chooseMaskZip: document.querySelector("#choose-mask-zip"),
  maskImportCancel: document.querySelector("#mask-import-cancel"),
  maskImportModes: [...document.querySelectorAll('input[name="mask-import-mode"]')],
  maskImportModeDescription: document.querySelector("#mask-import-mode-description"),
  clearMasksDialog: document.querySelector("#clear-masks-dialog"),
  clearMasksCount: document.querySelector("#clear-masks-count"),
  clearMasksCancel: document.querySelector("#clear-masks-cancel"),
  clearMasksConfirm: document.querySelector("#clear-masks-confirm"),
  segonwebJobsDialog: document.querySelector("#segonweb-jobs-dialog"),
  segonwebJobsClose: document.querySelector("#segonweb-jobs-close"),
  segonwebJobRows: document.querySelector("#segonweb-job-rows"),
  segonwebJobEmpty: document.querySelector("#segonweb-job-empty"),
  segonwebObjectId: document.querySelector("#segonweb-object-id"),
  segonwebObjectName: document.querySelector("#segonweb-object-name"),
  segonwebPromptFrame: document.querySelector("#segonweb-prompt-frame"),
  segonwebTrackingStart: document.querySelector("#segonweb-tracking-start"),
  segonwebTrackingEnd: document.querySelector("#segonweb-tracking-end"),
  segonwebSetStart: document.querySelector("#segonweb-set-start"),
  segonwebSetEnd: document.querySelector("#segonweb-set-end"),
  segonwebPreviousFrame: document.querySelector("#segonweb-previous-frame"),
  segonwebNextFrame: document.querySelector("#segonweb-next-frame"),
  segonwebCurrentFrame: document.querySelector("#segonweb-current-frame"),
  segonwebBoxX1: document.querySelector("#segonweb-box-x1"),
  segonwebBoxY1: document.querySelector("#segonweb-box-y1"),
  segonwebBoxX2: document.querySelector("#segonweb-box-x2"),
  segonwebBoxY2: document.querySelector("#segonweb-box-y2"),
  segonwebNewObject: document.querySelector("#segonweb-new-object"),
  segonwebSetBox: document.querySelector("#segonweb-set-box"),
  segonwebSaveObject: document.querySelector("#segonweb-save-object"),
  toolsDialog: document.querySelector("#tools-dialog"),
  toolsClose: document.querySelector("#tools-close"),
  toolsPreviousFrame: document.querySelector("#tools-previous-frame"),
  toolsNextFrame: document.querySelector("#tools-next-frame"),
  toolsCurrentFrame: document.querySelector("#tools-current-frame"),
  toolTabs: [...document.querySelectorAll("[data-tool-tab]")],
  toolPanels: [...document.querySelectorAll("[data-tool-panel]")],
  windowCenter: document.querySelector("#window-center"),
  windowCenterValue: document.querySelector("#window-center-value"),
  windowWidth: document.querySelector("#window-width"),
  windowWidthValue: document.querySelector("#window-width-value"),
  brightness: document.querySelector("#brightness"),
  brightnessValue: document.querySelector("#brightness-value"),
  contrast: document.querySelector("#contrast"),
  contrastValue: document.querySelector("#contrast-value"),
  resetDisplay: document.querySelector("#reset-display"),
  thresholdMin: document.querySelector("#threshold-min"),
  thresholdMinValue: document.querySelector("#threshold-min-value"),
  thresholdMax: document.querySelector("#threshold-max"),
  thresholdMaxValue: document.querySelector("#threshold-max-value"),
  thresholdOperation: document.querySelector("#threshold-operation"),
  thresholdScope: document.querySelector("#threshold-scope"),
  applyThreshold: document.querySelector("#apply-threshold"),
  rgbTarget: document.querySelector("#rgb-target"),
  rgbTolerance: document.querySelector("#rgb-tolerance"),
  rgbToleranceValue: document.querySelector("#rgb-tolerance-value"),
  rgbOperation: document.querySelector("#rgb-operation"),
  rgbScope: document.querySelector("#rgb-scope"),
  pickRgb: document.querySelector("#pick-rgb"),
  applyRgb: document.querySelector("#apply-rgb"),
  spacingX: document.querySelector("#spacing-x"),
  spacingY: document.querySelector("#spacing-y"),
  spacingZ: document.querySelector("#spacing-z"),
  referenceLength: document.querySelector("#reference-length"),
  drawCalibration: document.querySelector("#draw-calibration"),
  volInfoSummary: document.querySelector("#vol-info-summary"),
  importVolInfo: document.querySelector("#import-vol-info"),
  exportVolInfo: document.querySelector("#export-vol-info"),
  volInfoInput: document.querySelector("#vol-info-input"),
  exportNifti: document.querySelector("#export-nifti"),
  exportTiff: document.querySelector("#export-tiff"),
  stlFactor: document.querySelector("#stl-factor"),
  stlScope: document.querySelector("#stl-scope"),
  exportStl: document.querySelector("#export-stl"),
  toast: document.querySelector("#toast"),
};

const LOCAL_FILE_NOTICE_KEY = "segref3d-hide-local-file-notice";

const state = {
  images: [],
  index: -1,
  projectId: null,
  projectName: "No project",
  targetLabel: 1,
  transferLabel: 2,
  penColor: "#808080",
  visibleLabels: Array.from({ length: 21 }, (_, index) => index === 1),
  drawMode: "free",
  autoApplyMode: "off",
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
  pendingPicker: "folder",
  maskImportMode: "replace",
  displaySettings: { windowCenter: 127.5, windowWidth: 255, brightness: 0, contrast: 1 },
  displayVersion: 0,
  calibration: { xSpacing: 1, ySpacing: 1, zSpacing: 1, referenceLength: 10 },
  volumeOrigin: [0, 0, 0],
  volumeInfoSource: "Default spacing",
  calibrationMode: false,
  calibrationPoints: [],
  calibrationHoverPoint: null,
  rgbPickMode: false,
  segmentationJobs: [],
  segmentationDraft: null,
  segmentationBoxMode: null,
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
  elements.importSegonweb.disabled = active;
}

function setSaveState(text, className = "") {
  elements.autosaveIndicator.textContent = text;
  elements.autosaveIndicator.className = `save-state ${className}`.trim();
}

function initializeLabels() {
  for (let label = 1; label <= 20; label += 1) {
    const targetOption = new Option(`Obj ${label}`, String(label));
    const transferOption = new Option(`Obj ${label}`, String(label));
    const jobOption = new Option(`Obj ${label}`, String(label));
    elements.targetLabel.add(targetOption);
    elements.transferLabel.add(transferOption);
    elements.segonwebObjectId.add(jobOption);

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
  elements.segonwebObjectId.value = "1";
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
    elements.autoApplyMode,
    elements.loadMasks,
    elements.clearMasks,
    elements.imageTools,
    elements.exportLabels,
    elements.exportOverlays,
    elements.exportProject,
    elements.segonwebJobs,
    elements.exportSegonweb,
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
    ? `${image.name} · ${image.width} × ${image.height}px${
        image.sourceFormat === "dicom" ? " · DICOM" : image.sourceFormat === "nifti" ? " · NIfTI" : ""
      }`
    : "Local processing · no uploads";
  if (image) {
    setStatus(`Editing ${image.name}. Wheel: images · Ctrl+wheel: zoom · middle drag: pan.`);
  }
  updateLabelCounts();
  updateHistoryButtons();
  syncSegmentationCurrentFrame();
  syncToolsCurrentFrame();
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

function canvasRgba(canvas) {
  return canvas
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height).data.slice();
}

function ensureDisplayImage(image) {
  if (!image.basePixels || image.displayVersion === state.displayVersion) return;
  const output = adjustedRgba(image.basePixels, state.displaySettings);
  const outputContext = image.sourceCanvas.getContext("2d");
  const imageData = outputContext.createImageData(image.width, image.height);
  imageData.data.set(output);
  outputContext.putImageData(imageData, 0, 0);
  image.sourcePixels = null;
  image.displayVersion = state.displayVersion;
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

function drawPath(points, { active = false, color = state.penColor, mode = state.drawMode } = {}) {
  if (points.length === 0) return;
  const smooth = mode === "click" || mode === "snap";
  context.save();
  context.beginPath();
  traceRegionPath(context, points, { closed: !active, smooth });
  if (!active && points.length >= 3) {
    context.fillStyle = color;
    context.globalAlpha = 0.2;
    context.fill();
    context.globalAlpha = 1;
  }
  context.strokeStyle = color;
  context.lineWidth = Math.max(1.2 / state.viewport.zoom, 2 / state.viewport.zoom);
  context.stroke();

  if (smooth && active) {
    const radius = 3.2 / state.viewport.zoom;
    context.fillStyle = color;
    for (const point of points) {
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
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
  ensureDisplayImage(image);

  context.save();
  context.translate(state.viewport.panX, state.viewport.panY);
  context.scale(state.viewport.zoom, state.viewport.zoom);
  context.imageSmoothingEnabled = state.viewport.zoom < 2.5;
  context.drawImage(image.sourceCanvas, 0, 0);
  context.drawImage(buildOverlay(image), 0, 0);
  context.strokeStyle = "rgb(30 35 38 / 45%)";
  context.lineWidth = 1 / state.viewport.zoom;
  context.strokeRect(0, 0, image.width, image.height);
  for (const path of image.paths) {
    drawPath(path.points, { color: path.color, mode: path.mode });
  }
  drawPath(image.activePath, {
    active: true,
    color: image.activePathColor ?? state.penColor,
    mode: image.activePathMode ?? state.drawMode,
  });
  if (image.calibrationLine?.length === 2) {
    const [start, end] = image.calibrationLine;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = "#0d6269";
    context.lineWidth = 2 / state.viewport.zoom;
    context.setLineDash([7 / state.viewport.zoom, 5 / state.viewport.zoom]);
    context.stroke();
    context.setLineDash([]);
  }
  if (state.calibrationMode && state.calibrationPoints.length === 1) {
    const start = state.calibrationPoints[0];
    const hover = state.calibrationHoverPoint || start;
    const pixelLength = Math.hypot(hover.x - start.x, hover.y - start.y);
    context.strokeStyle = "rgb(13 98 105 / 62%)";
    context.lineWidth = 1 / state.viewport.zoom;
    context.setLineDash([6 / state.viewport.zoom, 5 / state.viewport.zoom]);
    context.beginPath();
    context.moveTo(0, hover.y);
    context.lineTo(image.width, hover.y);
    context.moveTo(hover.x, 0);
    context.lineTo(hover.x, image.height);
    context.stroke();
    context.setLineDash([]);

    context.strokeStyle = "#0d6269";
    context.lineWidth = 2 / state.viewport.zoom;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(hover.x, hover.y);
    context.stroke();

    const radius = 6 / state.viewport.zoom;
    for (const point of [start, hover]) {
      context.beginPath();
      context.moveTo(point.x - radius, point.y);
      context.lineTo(point.x + radius, point.y);
      context.moveTo(point.x, point.y - radius);
      context.lineTo(point.x, point.y + radius);
      context.stroke();
    }
    context.fillStyle = "#0d6269";
    context.font = `${12 / state.viewport.zoom}px sans-serif`;
    context.fillText(
      `${pixelLength.toFixed(1)} px`,
      (start.x + hover.x) / 2 + 7 / state.viewport.zoom,
      (start.y + hover.y) / 2 - 7 / state.viewport.zoom,
    );
  }
  const promptBoxes = state.segmentationJobs
    .filter((job) => job.promptFrame === state.index)
    .map((job) => ({ ...job, draft: false }));
  if (
    state.segmentationDraft?.box &&
    state.segmentationDraft.promptFrame === state.index &&
    !promptBoxes.some((job) => job.id === state.segmentationDraft.id)
  ) {
    promptBoxes.push({ ...state.segmentationDraft, draft: true });
  }
  for (const job of promptBoxes) {
    const [x1, y1, x2, y2] = job.box;
    context.strokeStyle = job.draft ? "#d9544b" : LABEL_COLORS[job.id] || "#d9544b";
    context.lineWidth = 2 / state.viewport.zoom;
    context.setLineDash(job.draft ? [7 / state.viewport.zoom, 5 / state.viewport.zoom] : []);
    context.strokeRect(x1, y1, x2 - x1, y2 - y1);
    context.setLineDash([]);
    context.fillStyle = context.strokeStyle;
    context.font = `${Math.max(10 / state.viewport.zoom, 12 / state.viewport.zoom)}px sans-serif`;
    context.fillText(`Obj ${job.id}`, x1 + 3 / state.viewport.zoom, Math.max(12 / state.viewport.zoom, y1 - 4 / state.viewport.zoom));
  }
  if (state.segmentationBoxMode?.hoverPoint) {
    const hover = state.segmentationBoxMode.hoverPoint;
    context.strokeStyle = "rgb(217 84 75 / 75%)";
    context.lineWidth = 1 / state.viewport.zoom;
    context.setLineDash([6 / state.viewport.zoom, 5 / state.viewport.zoom]);
    context.beginPath();
    context.moveTo(0, hover.y);
    context.lineTo(image.width, hover.y);
    context.moveTo(hover.x, 0);
    context.lineTo(hover.x, image.height);
    context.stroke();
    context.setLineDash([]);
    if (state.segmentationBoxMode.firstPoint) {
      const first = state.segmentationBoxMode.firstPoint;
      context.strokeStyle = "#d9544b";
      context.lineWidth = 2 / state.viewport.zoom;
      context.strokeRect(first.x, first.y, hover.x - first.x, hover.y - first.y);
    }
  }
  if (state.segmentationBoxMode?.firstPoint) {
    const point = state.segmentationBoxMode.firstPoint;
    const radius = 6 / state.viewport.zoom;
    context.strokeStyle = "#d9544b";
    context.lineWidth = 2 / state.viewport.zoom;
    context.beginPath();
    context.moveTo(point.x - radius, point.y);
    context.lineTo(point.x + radius, point.y);
    context.moveTo(point.x, point.y - radius);
    context.lineTo(point.x, point.y + radius);
    context.stroke();
  }
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
  let finalizedPath = false;
  if (image.activePath.length >= 3) {
    image.paths.push({
      points: image.activePath.map((point) => ({ ...point })),
      color: image.activePathColor ?? state.penColor,
      mode: image.activePathMode ?? state.drawMode,
    });
    image.pathRedo.length = 0;
    finalizedPath = true;
  }
  image.activePath = [];
  image.activePathColor = null;
  image.activePathMode = null;
  if (finalizedPath && state.autoApplyMode !== "off") {
    applyAutoModeToLatestPath(image);
    return true;
  }
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
  image.activePathColor = null;
  image.activePathMode = null;
  image.paths = [];
  image.pathRedo = [];
  setStatus("Cleared drawn lines.");
  updateHistoryButtons();
  render();
}

function rasterizePaths(image, paths = image.paths) {
  if (paths.length === 0) return null;
  const rasterCanvas = document.createElement("canvas");
  rasterCanvas.width = image.width;
  rasterCanvas.height = image.height;
  const rasterContext = rasterCanvas.getContext("2d", { willReadFrequently: true });
  rasterContext.fillStyle = "#ffffff";
  for (const path of paths) {
    if (path.points.length < 3) continue;
    rasterContext.beginPath();
    traceRegionPath(rasterContext, path.points, {
      closed: true,
      smooth: path.mode === "click" || path.mode === "snap",
    });
    rasterContext.fill();
  }
  const rgba = rasterContext.getImageData(0, 0, image.width, image.height).data;
  const alpha = new Uint8Array(image.width * image.height);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[index * 4 + 3];
  return alpha;
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

function clearImagePaths(image) {
  image.paths = [];
  image.pathRedo = [];
  image.activePath = [];
  image.activePathColor = null;
  image.activePathMode = null;
}

function recordMaskChange(image, before) {
  image.undo.push(before);
  if (image.undo.length > 20) image.undo.shift();
  image.redo.length = 0;
  image.overlayDirty = true;
}

function ensureLabelVisible(label) {
  state.visibleLabels[label] = true;
  const checkbox = elements.labelList.querySelector(`[data-label="${label}"] input`);
  if (checkbox) checkbox.checked = true;
}

function applyAutoModeToLatestPath(image) {
  const mode = state.autoApplyMode;
  const path = image.paths.at(-1);
  if (!path || mode === "off") return false;

  const raster = rasterizePaths(image, [path]);
  image.paths.pop();
  image.pathRedo.length = 0;
  if (!raster) {
    updateHistoryButtons();
    render();
    return false;
  }

  if (mode === "transfer" && state.targetLabel === state.transferLabel) {
    setStatus("Auto Transfer skipped: choose a different destination label.");
    showToast("Choose a different destination label.");
    updateHistoryButtons();
    render();
    return false;
  }

  const before = image.mask.slice();
  let changed = 0;
  let status = "";
  if (mode === "transfer") {
    changed = transferLabel(image.mask, state.targetLabel, state.transferLabel, raster);
    ensureLabelVisible(state.transferLabel);
    status = `Auto Transferred Obj ${state.targetLabel} to Obj ${state.transferLabel}`;
  } else {
    changed = applyRasterToMask(image.mask, raster, mode, state.targetLabel);
    if (mode === "add") ensureLabelVisible(state.targetLabel);
    status = `${mode === "add" ? "Auto Added to" : "Auto Erased from"} Obj ${state.targetLabel}`;
  }

  if (changed > 0) {
    recordMaskChange(image, before);
    autosave(image, "Auto edit autosaved");
  }
  updateLabelCounts();
  updateHistoryButtons();
  render();
  setStatus(`${status}: ${changed.toLocaleString()} px changed.`);
  return changed > 0;
}

function finishDrawnMaskBatch(processedImages, changedImages, status) {
  for (const image of processedImages) clearImagePaths(image);
  updateLabelCounts();
  updateHistoryButtons();
  render();
  setStatus(status);
  for (const image of changedImages) autosave(image);
}

function commitPaths(operation) {
  if (!currentImage()) return;
  finalizeActivePath();
  const processedImages = state.images.filter((image) => image.paths.length > 0);
  if (processedImages.length === 0) {
    setStatus("Draw a closed region before editing the mask.");
    showToast("No drawn region to apply.");
    return;
  }

  const changedImages = [];
  let changedPixels = 0;
  for (const image of processedImages) {
    const raster = rasterizePaths(image);
    if (!raster) continue;
    const before = image.mask.slice();
    const changed = applyRasterToMask(image.mask, raster, operation, state.targetLabel);
    if (changed > 0) {
      recordMaskChange(image, before);
      changedImages.push(image);
      changedPixels += changed;
    }
  }

  if (operation === "add") {
    ensureLabelVisible(state.targetLabel);
  }
  finishDrawnMaskBatch(
    processedImages,
    changedImages,
    `${operation === "add" ? "Added to" : "Erased from"} Obj ${state.targetLabel} on ${processedImages.length} image(s): ${changedPixels.toLocaleString()} px changed.`,
  );
}

function transferCurrentLabel() {
  if (!currentImage()) return;
  if (state.targetLabel === state.transferLabel) {
    showToast("Choose a different destination label.");
    return;
  }

  finalizeActivePath();
  const processedImages = state.images.filter((image) => image.paths.length > 0);
  if (processedImages.length === 0) {
    setStatus("Draw a closed region before transferring a label.");
    showToast("No drawn region to transfer.");
    return;
  }

  const changedImages = [];
  let changedPixels = 0;
  for (const image of processedImages) {
    const raster = rasterizePaths(image);
    if (!raster) continue;
    const before = image.mask.slice();
    const changed = transferLabel(
      image.mask,
      state.targetLabel,
      state.transferLabel,
      raster,
    );
    if (changed > 0) {
      recordMaskChange(image, before);
      changedImages.push(image);
      changedPixels += changed;
    }
  }

  ensureLabelVisible(state.transferLabel);
  finishDrawnMaskBatch(
    processedImages,
    changedImages,
    `Transferred Obj ${state.targetLabel} to Obj ${state.transferLabel} inside drawn regions on ${processedImages.length} image(s): ${changedPixels.toLocaleString()} px changed.`,
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
  if (state.calibrationMode) {
    state.calibrationMode = false;
    state.calibrationPoints = [];
    state.calibrationHoverPoint = null;
    setStatus("Unfinished calibration line canceled before switching images.");
  }
  state.index = nextIndex;
  if (state.segmentationBoxMode) {
    state.segmentationBoxMode = { frame: nextIndex, firstPoint: null, hoverPoint: null };
    state.segmentationDraft.promptFrame = nextIndex;
  }
  updateImageUi();
  render();
}

function setDrawMode(mode) {
  finalizeActivePath();
  state.drawMode = mode;
  for (const button of elements.modeButtons) {
    button.classList.toggle("selected", button.dataset.mode === mode);
  }
  setStatus(`${mode[0].toUpperCase()}${mode.slice(1)} drawing mode.`);
}

function setAutoApplyMode(mode, { announce = true } = {}) {
  state.autoApplyMode = ["add", "erase", "transfer"].includes(mode) ? mode : "off";
  elements.autoApplyMode.value = state.autoApplyMode;
  if (!announce) return;
  const label =
    state.autoApplyMode === "off"
      ? "Off"
      : `${state.autoApplyMode[0].toUpperCase()}${state.autoApplyMode.slice(1)}`;
  setStatus(
    state.autoApplyMode === "off"
      ? "Automatic mask editing is off."
      : `Auto ${label} enabled. Each completed region is applied to the current image.`,
  );
}

async function applyPixelExtraction(kind) {
  if (!currentImage() || state.loading) return;
  const isThreshold = kind === "threshold";
  const scope = isThreshold ? elements.thresholdScope.value : elements.rgbScope.value;
  const operation = isThreshold
    ? elements.thresholdOperation.value
    : elements.rgbOperation.value;
  const images = scope === "all" ? state.images : [currentImage()];
  const targetColor = isThreshold ? null : hexToRgb(elements.rgbTarget.value);
  let changedPixels = 0;
  let changedImages = 0;
  elements.toolsDialog.close();
  setLoading(true, isThreshold ? "Applying threshold" : "Applying RGB extraction", `0 / ${images.length}`);
  try {
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      elements.loadingDetail.textContent = `${index + 1} / ${images.length}`;
      const raster = isThreshold
        ? thresholdRaster(image.basePixels, elements.thresholdMin.value, elements.thresholdMax.value)
        : rgbRaster(image.basePixels, targetColor, elements.rgbTolerance.value);
      const before = image.mask.slice();
      const changed = applyRasterToMask(image.mask, raster, operation, state.targetLabel);
      if (changed > 0) {
        recordMaskChange(image, before);
        changedPixels += changed;
        changedImages += 1;
        await autosave(image, `${isThreshold ? "Threshold" : "RGB"} edit autosaved`);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (operation === "add") ensureLabelVisible(state.targetLabel);
    updateLabelCounts();
    updateHistoryButtons();
    render();
    setStatus(
      `${isThreshold ? "Threshold" : "RGB"} ${operation === "add" ? "added to" : "erased from"} ` +
        `Obj ${state.targetLabel}: ${changedPixels.toLocaleString()} px on ${changedImages} image(s).`,
    );
    showToast(`${isThreshold ? "Threshold" : "RGB"} extraction complete.`);
  } catch (error) {
    console.error(error);
    setStatus(`${isThreshold ? "Threshold" : "RGB"} extraction failed: ${error.message}`);
    showToast("Extraction failed.");
  } finally {
    setLoading(false);
  }
}

function beginRgbPicker() {
  if (!currentImage()) return;
  state.rgbPickMode = true;
  state.calibrationMode = false;
  state.calibrationPoints = [];
  state.calibrationHoverPoint = null;
  elements.toolsDialog.close();
  elements.canvas.focus();
  setStatus("Click the image to pick the RGB extraction color.");
}

function beginCalibration() {
  if (!currentImage()) return;
  updateCalibrationFromControls();
  state.calibrationMode = true;
  state.calibrationPoints = [];
  state.calibrationHoverPoint = null;
  state.rgbPickMode = false;
  currentImage().calibrationLine = null;
  elements.toolsDialog.close();
  elements.canvas.focus();
  setStatus("Click two points for the calibration reference line.");
  render();
}

function syncDisplayControls() {
  const settings = state.displaySettings;
  elements.windowCenter.value = String(settings.windowCenter);
  elements.windowWidth.value = String(settings.windowWidth);
  elements.brightness.value = String(settings.brightness);
  elements.contrast.value = String(settings.contrast);
  elements.windowCenterValue.textContent = Number(settings.windowCenter).toFixed(1);
  elements.windowWidthValue.textContent = Number(settings.windowWidth).toFixed(0);
  elements.brightnessValue.textContent = Number(settings.brightness).toFixed(0);
  elements.contrastValue.textContent = Number(settings.contrast).toFixed(2);
}

function updateDisplaySettingsFromControls() {
  state.displaySettings = {
    windowCenter: Number(elements.windowCenter.value),
    windowWidth: Math.max(1, Number(elements.windowWidth.value)),
    brightness: Number(elements.brightness.value),
    contrast: Math.max(0.1, Number(elements.contrast.value)),
  };
  state.displayVersion += 1;
  syncDisplayControls();
  render();
}

function resetDisplaySettings({ announce = true } = {}) {
  state.displaySettings = { windowCenter: 127.5, windowWidth: 255, brightness: 0, contrast: 1 };
  state.displayVersion += 1;
  syncDisplayControls();
  render();
  if (announce) setStatus("Display settings reset.");
}

function syncCalibrationControls() {
  elements.spacingX.value = String(state.calibration.xSpacing);
  elements.spacingY.value = String(state.calibration.ySpacing);
  elements.spacingZ.value = String(state.calibration.zSpacing);
  elements.referenceLength.value = String(state.calibration.referenceLength);
}

function syncExtractionControls() {
  elements.thresholdMinValue.textContent = elements.thresholdMin.value;
  elements.thresholdMaxValue.textContent = elements.thresholdMax.value;
  elements.rgbToleranceValue.textContent = elements.rgbTolerance.value;
}

function updateCalibrationFromControls() {
  const positive = (element, fallback) => {
    const value = Number(element.value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  state.calibration = {
    xSpacing: positive(elements.spacingX, state.calibration.xSpacing),
    ySpacing: positive(elements.spacingY, state.calibration.ySpacing),
    zSpacing: positive(elements.spacingZ, state.calibration.zSpacing),
    referenceLength: positive(elements.referenceLength, state.calibration.referenceLength),
  };
  syncCalibrationControls();
  syncVolInfoSummary();
}

function initializeCalibrationFromImages() {
  const image = state.images[0];
  const xSpacing = Number(image?.pixelSpacing?.[0]);
  const ySpacing = Number(image?.pixelSpacing?.[1]);
  const zSpacing = Number(image?.sliceSpacing);
  state.calibration = {
    xSpacing: Number.isFinite(xSpacing) && xSpacing > 0 ? xSpacing : 1,
    ySpacing: Number.isFinite(ySpacing) && ySpacing > 0 ? ySpacing : 1,
    zSpacing: Number.isFinite(zSpacing) && zSpacing > 0 ? zSpacing : 1,
    referenceLength: 10,
  };
  state.volumeOrigin = [0, 1, 2].map((index) => {
    const value = Number(image?.volumeOrigin?.[index]);
    return Number.isFinite(value) ? value : 0;
  });
  state.volumeInfoSource = image?.sourceFormat === "dicom"
    ? "DICOM metadata"
    : image?.sourceFormat === "nifti"
      ? "NIfTI metadata"
      : "Default spacing";
  syncCalibrationControls();
  syncVolInfoSummary();
}

function currentVolInfo() {
  if (state.images.length === 0) throw new Error("No images are loaded.");
  const width = state.images[0].width;
  const height = state.images[0].height;
  const mismatch = state.images.find((image) => image.width !== width || image.height !== height);
  if (mismatch) {
    throw new Error(
      "VolInfo requires equal image dimensions. Reload the sequence on a shared canvas.",
    );
  }
  return {
    width,
    height,
    depth: state.images.length,
    spacing: [
      state.calibration.xSpacing,
      state.calibration.ySpacing,
      state.calibration.zSpacing,
    ],
    origin: state.volumeOrigin.slice(0, 3),
  };
}

function syncVolInfoSummary() {
  if (!elements.volInfoSummary) return;
  if (state.images.length === 0) {
    elements.volInfoSummary.textContent = "No volume information loaded.";
    return;
  }
  try {
    const info = currentVolInfo();
    elements.volInfoSummary.textContent =
      `${info.width} × ${info.height} × ${info.depth} · spacing ` +
      `${info.spacing.map((value) => Number(value).toPrecision(6)).join(" × ")} mm · ` +
      `origin ${info.origin.map((value) => Number(value).toPrecision(6)).join(", ")} · ` +
      state.volumeInfoSource;
  } catch (error) {
    elements.volInfoSummary.textContent = error.message;
  }
}

function exportVolInfoCsv({ automatic = false } = {}) {
  try {
    updateCalibrationFromControls();
    const info = currentVolInfo();
    const filename = `${sanitizeFilename(state.projectName)}_volinf.csv`;
    downloadBlob(
      new Blob([createVolInfoCsv(info)], { type: "text/csv;charset=utf-8" }),
      filename,
    );
    setStatus(`${automatic ? "Auto-exported" : "Exported"} VolInfo CSV: ${filename}`);
    showToast(`${automatic ? "Auto-downloaded" : "Downloaded"} ${filename}`);
    return filename;
  } catch (error) {
    console.error(error);
    setStatus(`VolInfo export failed: ${error.message}`);
    if (!automatic) window.alert(`VolInfo export failed.\n\n${error.message}`);
    return null;
  }
}

async function importVolInfoCsv(file) {
  if (!file || state.images.length === 0) return;
  try {
    const imported = parseVolInfoCsv(await file.text());
    const current = currentVolInfo();
    const dimensionsMatch =
      imported.width === current.width &&
      imported.height === current.height &&
      imported.depth === current.depth;
    if (
      !dimensionsMatch &&
      !window.confirm(
        `VolInfo dimensions are ${imported.width} × ${imported.height} × ${imported.depth}, ` +
          `but the loaded sequence is ${current.width} × ${current.height} × ${current.depth}.\n\n` +
          "Apply the imported spacing and origin anyway?",
      )
    ) {
      setStatus("VolInfo import canceled. Calibration was not changed.");
      return;
    }
    state.calibration = {
      ...state.calibration,
      xSpacing: imported.spacing[0],
      ySpacing: imported.spacing[1],
      zSpacing: imported.spacing[2],
    };
    state.volumeOrigin = imported.origin.slice();
    state.volumeInfoSource = file.name;
    syncCalibrationControls();
    syncVolInfoSummary();
    setStatus(
      `VolInfo loaded: spacing ${imported.spacing.map((value) => value.toPrecision(6)).join(" × ")} mm.`,
    );
    showToast(`Loaded ${file.name}`);
    openImageTools("calibration");
  } catch (error) {
    console.error(error);
    setStatus(`VolInfo import failed: ${error.message}`);
    window.alert(`VolInfo import failed.\n\n${error.message}`);
  } finally {
    elements.volInfoInput.value = "";
  }
}

function selectToolTab(name) {
  for (const tab of elements.toolTabs) {
    const selected = tab.dataset.toolTab === name;
    tab.setAttribute("aria-selected", String(selected));
  }
  for (const panel of elements.toolPanels) panel.hidden = panel.dataset.toolPanel !== name;
}

function openImageTools(name = "display") {
  if (!currentImage() || state.loading) return;
  selectToolTab(name);
  syncDisplayControls();
  syncCalibrationControls();
  syncVolInfoSummary();
  syncToolsCurrentFrame();
  if (!elements.toolsDialog.open) elements.toolsDialog.show();
}

function syncToolsCurrentFrame() {
  if (!elements.toolsCurrentFrame) return;
  const current = state.images.length > 0 ? state.index + 1 : 0;
  elements.toolsCurrentFrame.textContent = `${current} / ${state.images.length}`;
  elements.toolsPreviousFrame.disabled = state.images.length === 0 || state.index === 0;
  elements.toolsNextFrame.disabled = state.images.length === 0 || state.index === state.images.length - 1;
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
  ensureDisplayImage(image);
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

function labelVolumeGeometry() {
  if (state.images.length === 0) throw new Error("No images are loaded.");
  const width = state.images[0].width;
  const height = state.images[0].height;
  const mismatch = state.images.find((image) => image.width !== width || image.height !== height);
  if (mismatch) {
    throw new Error(
      "Volume export requires equal image dimensions. Reload the sequence on a shared canvas.",
    );
  }
  updateCalibrationFromControls();
  return {
    width,
    height,
    masks: state.images.map((image) => image.mask),
    spacing: [
      state.calibration.xSpacing,
      state.calibration.ySpacing,
      state.calibration.zSpacing,
    ],
    origin: state.volumeOrigin.slice(0, 3),
  };
}

async function exportLabelVolume(format) {
  if (state.loading) return;
  elements.toolsDialog.close();
  setLoading(true, `Exporting ${format.toUpperCase()}`, "Preparing label volume");
  try {
    const { masks, width, height, spacing, origin } = labelVolumeGeometry();
    const bytes =
      format === "nifti"
        ? createNiftiLabelVolume(masks, width, height, spacing, origin)
        : createTiffLabelStack(masks, width, height);
    const extension = format === "nifti" ? "nii" : "tiff";
    const mimeType = format === "nifti" ? "application/octet-stream" : "image/tiff";
    const filename = `${sanitizeFilename(state.projectName)}_labels_${timestamp()}.${extension}`;
    downloadBlob(new Blob([bytes], { type: mimeType }), filename);
    setStatus(`Exported ${masks.length}-slice label volume as ${extension.toUpperCase()}.`);
    showToast(`Downloaded ${filename}`);
  } catch (error) {
    console.error(error);
    setStatus(`Volume export failed: ${error.message}`);
    window.alert(`Volume export failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
  }
}

function labelIsUsed(label, masks) {
  return masks.some((mask) => mask.includes(label));
}

async function exportStlMeshes() {
  if (state.loading) return;
  const factor = Number(elements.stlFactor.value);
  elements.toolsDialog.close();
  setLoading(true, "Exporting STL", "Preparing label volume");
  try {
    const { masks, width, height, spacing } = labelVolumeGeometry();
    const labels =
      elements.stlScope.value === "visible"
        ? Array.from({ length: 20 }, (_, index) => index + 1).filter(
            (label) => state.visibleLabels[label] && labelIsUsed(label, masks),
          )
        : [state.targetLabel].filter((label) => labelIsUsed(label, masks));
    if (labels.length === 0) throw new Error("The selected object set has no label pixels.");
    const interpolatedDepth = (masks.length - 1) * factor + 1;
    const voxelCount = width * height * interpolatedDepth;
    if (voxelCount > 200_000_000) {
      throw new Error("The interpolated volume is too large for safe browser processing.");
    }
    if (
      voxelCount > 50_000_000 &&
      !window.confirm(
        `The ${factor}x interpolated volume contains about ${Math.round(voxelCount / 1_000_000)} million voxels.\n\nContinue STL generation?`,
      )
    ) {
      setStatus("STL export canceled.");
      return;
    }

    const entries = [];
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index];
      elements.loadingDetail.textContent = `Obj ${label}: interpolation`;
      const interpolated = interpolateLabelVolume(masks, width, height, label, factor);
      await new Promise((resolve) => setTimeout(resolve, 0));
      elements.loadingDetail.textContent = `Obj ${label}: meshing`;
      const triangles = marchingTetrahedra(interpolated.data, width, height, interpolated.depth, [
        spacing[0],
        spacing[1],
        spacing[2] / factor,
      ]);
      if (triangles.length === 0) continue;
      const name = `obj${String(label).padStart(2, "0")}_${factor}x.stl`;
      entries.push({
        name,
        blob: new Blob([createBinaryStl(triangles, `SegRef3D Obj ${label}`)], {
          type: "model/stl",
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (entries.length === 0) throw new Error("No STL surface could be generated.");
    if (entries.length === 1) {
      downloadBlob(entries[0].blob, entries[0].name);
      showToast(`Downloaded ${entries[0].name}`);
    } else {
      elements.loadingDetail.textContent = "Creating STL ZIP";
      const filename = `${sanitizeFilename(state.projectName)}_STL_${factor}x_${timestamp()}.zip`;
      downloadBlob(await createZip(entries), filename);
      showToast(`Downloaded ${filename}`);
    }
    setStatus(`Exported ${entries.length} STL file(s) with ${factor}x signed-distance interpolation.`);
  } catch (error) {
    console.error(error);
    setStatus(`STL export failed: ${error.message}`);
    window.alert(`STL export failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
  }
}

const PROJECT_FORMAT = "segref3d-lite-web-project";
const PROJECT_VERSION = 1;

function entryBasename(path) {
  return path.replaceAll("\\", "/").split("/").at(-1) || path;
}

function normalizedEntryPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function selectLabelPngEntries(entries) {
  const pngEntries = entries.filter((entry) => {
    const path = entry.name.replaceAll("\\", "/");
    const basename = entryBasename(path);
    return (
      /\.png$/i.test(basename) &&
      !path.split("/").includes("__MACOSX") &&
      !basename.startsWith(".")
    );
  });
  const standardNames = pngEntries.filter((entry) =>
    /^mask\d+(?:\[autosave\])?\.png$/i.test(entryBasename(entry.name)),
  );
  const selected = standardNames.length
    ? standardNames
    : pngEntries.filter((entry) => !/(?:preview|overlay)/i.test(entryBasename(entry.name)));
  return selected.sort((left, right) => naturalCompare(left.name, right.name));
}

async function decodeLabelPng(entry) {
  const result = await decodeImage(entry.blob, entry.name);
  try {
    const width = result.image.naturalWidth;
    const height = result.image.naturalHeight;
    if (width * height > 160_000_000) {
      throw new Error(`${entry.name} is too large to process safely in this browser.`);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const outputContext = canvas.getContext("2d", { willReadFrequently: true });
    outputContext.drawImage(result.image, 0, 0);
    const rgba = outputContext.getImageData(0, 0, width, height).data;
    return {
      name: entry.name,
      width,
      height,
      mask: rgbaToLabelMask(rgba, width, height),
    };
  } catch (error) {
    throw new Error(`${entry.name}: ${error.message}`);
  } finally {
    URL.revokeObjectURL(result.url);
  }
}

function centerLabelMask(decoded, image) {
  return placeLabelMask(
    decoded.mask,
    decoded.width,
    decoded.height,
    image.width,
    image.height,
    image.contentX,
    image.contentY,
  );
}

function resizeLabelMask(decoded, targetWidth, targetHeight) {
  return resizeLabelMaskNearest(
    decoded.mask,
    decoded.width,
    decoded.height,
    targetWidth,
    targetHeight,
  );
}

function normalizeDecodedMask(decoded, image, allowResize) {
  if (decoded.width === image.width && decoded.height === image.height) return decoded.mask;
  if (
    decoded.width === image.contentWidth &&
    decoded.height === image.contentHeight &&
    image.contentX >= 0 &&
    image.contentY >= 0
  ) {
    return centerLabelMask(decoded, image);
  }
  if (!allowResize) return null;
  if (decoded.width === image.originalWidth && decoded.height === image.originalHeight) {
    const resizedContent = {
      width: image.contentWidth,
      height: image.contentHeight,
      mask: resizeLabelMask(decoded, image.contentWidth, image.contentHeight),
    };
    return centerLabelMask(resizedContent, image);
  }
  return resizeLabelMask(decoded, image.width, image.height);
}

function masksEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function enableLabelsUsedByMasks(imported) {
  const used = new Uint8Array(21);
  for (const { mask } of imported) {
    for (const label of mask) {
      if (label > 0 && label <= 20) used[label] = 1;
    }
  }
  for (let label = 1; label <= 20; label += 1) {
    if (!used[label]) continue;
    state.visibleLabels[label] = true;
    const checkbox = elements.labelList.querySelector(`[data-label="${label}"] input`);
    if (checkbox) checkbox.checked = true;
  }
  for (const image of state.images) image.overlayDirty = true;
}

async function applyImportedMasks(
  imported,
  { settings = null, projectName = null, mode = "replace" } = {},
) {
  const changedImages = [];
  const applied = [];
  for (const { image, mask } of imported) {
    clearImagePaths(image);
    const nextMask = combineLabelMasks(image.mask, mask, mode);
    applied.push({ image, mask: nextMask });
    if (masksEqual(image.mask, nextMask)) continue;
    const before = image.mask.slice();
    image.mask = nextMask;
    recordMaskChange(image, before);
    changedImages.push(image);
  }
  if (settings && mode === "replace") applyProjectSettings(settings);
  else enableLabelsUsedByMasks(applied);
  if (projectName && mode === "replace") state.projectName = projectName;
  updateImageUi();
  render();
  for (const image of changedImages) await autosave(image, "Imported masks autosaved");
  return changedImages.length;
}

async function prepareImportedMasks(mappings) {
  const decoded = [];
  for (let index = 0; index < mappings.length; index += 1) {
    elements.loadingDetail.textContent = `Checking ${index + 1} / ${mappings.length}`;
    const mapping = mappings[index];
    const decodedMask = await decodeLabelPng(mapping.entry);
    if (
      Number.isInteger(mapping.expectedWidth) &&
      Number.isInteger(mapping.expectedHeight) &&
      (decodedMask.width !== mapping.expectedWidth || decodedMask.height !== mapping.expectedHeight)
    ) {
      throw new Error(
        `${mapping.entry.name} dimensions do not match the project manifest ` +
          `(${decodedMask.width}x${decodedMask.height} vs ${mapping.expectedWidth}x${mapping.expectedHeight}).`,
      );
    }
    decoded.push({ image: mapping.image, decoded: decodedMask });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const mismatched = decoded.filter(
    ({ image, decoded: item }) => normalizeDecodedMask(item, image, false) === null,
  );
  let allowResize = false;
  if (mismatched.length > 0) {
    allowResize = window.confirm(
      `${mismatched.length} mask(s) do not match the working image dimensions.\n\n` +
        "Resize them with nearest-neighbor interpolation?\n" +
        "Choose Cancel to leave all current masks unchanged.",
    );
    if (!allowResize) return null;
  }
  return decoded.map(({ image, decoded: item }) => ({
    image,
    mask: normalizeDecodedMask(item, image, allowResize),
  }));
}

async function importLabelEntries(entries, sourceName, mode = "replace") {
  const selected = selectLabelPngEntries(entries);
  if (selected.length === 0) throw new Error("No label PNG files were found.");
  const importCount = Math.min(selected.length, state.images.length);
  if (
    selected.length !== state.images.length &&
    !window.confirm(
      `Found ${selected.length} label PNG(s) for ${state.images.length} image(s).\n\n` +
        `Load the first ${importCount} mask(s) in natural filename order?\n` +
        "Unmatched images will keep their current masks.",
    )
  ) {
    setStatus("Mask import canceled. Current masks were not changed.");
    showToast("Mask import canceled.");
    return false;
  }
  const mappings = selected.slice(0, importCount).map((entry, index) => ({
    entry,
    image: state.images[index],
  }));
  const imported = await prepareImportedMasks(mappings);
  if (!imported) {
    setStatus("Mask import canceled. Current masks were not changed.");
    showToast("Mask import canceled.");
    return false;
  }
  const changedCount = await applyImportedMasks(imported, { mode });
  const action = mode === "merge" ? "Merged" : "Replaced";
  setStatus(
    `${action} ${imported.length} label PNG mask(s) from ${sourceName}. ${changedCount} image(s) changed and autosaved.`,
  );
  showToast(`${action} ${imported.length} mask(s).`);
  return true;
}

function applyProjectSettings(settings = {}) {
  const targetLabel = Number(settings.targetLabel);
  const transferLabelValue = Number(settings.transferLabel);
  const drawMode = ["free", "click", "snap"].includes(settings.drawMode)
    ? settings.drawMode
    : state.drawMode;
  const penColor = ["#808080", "#000000", "#ffffff"].includes(settings.penColor)
    ? settings.penColor
    : state.penColor;
  const autoApplyMode = ["add", "erase", "transfer"].includes(settings.autoApplyMode)
    ? settings.autoApplyMode
    : "off";
  const savedDisplay = settings.displaySettings || {};
  const savedCalibration = settings.calibration || {};
  const savedVolumeOrigin = Array.isArray(settings.volumeOrigin) ? settings.volumeOrigin : null;
  const savedVisibility = Array.isArray(settings.visibleLabels) ? settings.visibleLabels : null;

  if (targetLabel >= 1 && targetLabel <= 20) state.targetLabel = targetLabel;
  if (transferLabelValue >= 1 && transferLabelValue <= 20) state.transferLabel = transferLabelValue;
  state.drawMode = drawMode;
  state.penColor = penColor;
  setAutoApplyMode(autoApplyMode, { announce: false });
  state.displaySettings = {
    windowCenter: Number.isFinite(Number(savedDisplay.windowCenter))
      ? Number(savedDisplay.windowCenter)
      : 127.5,
    windowWidth: Math.max(1, Number(savedDisplay.windowWidth) || 255),
    brightness: Number.isFinite(Number(savedDisplay.brightness))
      ? Number(savedDisplay.brightness)
      : 0,
    contrast: Math.max(0.1, Number(savedDisplay.contrast) || 1),
  };
  state.displayVersion += 1;
  state.calibration = {
    xSpacing: Number(savedCalibration.xSpacing) > 0
      ? Number(savedCalibration.xSpacing)
      : state.calibration.xSpacing,
    ySpacing: Number(savedCalibration.ySpacing) > 0
      ? Number(savedCalibration.ySpacing)
      : state.calibration.ySpacing,
    zSpacing: Number(savedCalibration.zSpacing) > 0
      ? Number(savedCalibration.zSpacing)
      : state.calibration.zSpacing,
    referenceLength: Number(savedCalibration.referenceLength) > 0
      ? Number(savedCalibration.referenceLength)
      : state.calibration.referenceLength,
  };
  if (savedVolumeOrigin?.length >= 3) {
    state.volumeOrigin = [0, 1, 2].map((index) => {
      const value = Number(savedVolumeOrigin[index]);
      return Number.isFinite(value) ? value : 0;
    });
    state.volumeInfoSource = typeof settings.volumeInfoSource === "string"
      ? settings.volumeInfoSource.slice(0, 120)
      : "Project ZIP";
  }
  syncDisplayControls();
  syncCalibrationControls();
  syncVolInfoSummary();
  elements.targetLabel.value = String(state.targetLabel);
  elements.transferLabel.value = String(state.transferLabel);
  elements.penColor.value = state.penColor;
  elements.penColorSwatch.style.background = state.penColor;
  for (const button of elements.modeButtons) {
    button.classList.toggle("selected", button.dataset.mode === state.drawMode);
  }
  if (savedVisibility && (savedVisibility.length === 20 || savedVisibility.length === 21)) {
    for (let label = 1; label <= 20; label += 1) {
      const value = savedVisibility.length === 21 ? savedVisibility[label] : savedVisibility[label - 1];
      state.visibleLabels[label] = Boolean(value);
      const checkbox = elements.labelList.querySelector(`[data-label="${label}"] input`);
      if (checkbox) checkbox.checked = state.visibleLabels[label];
    }
  }
  if (Array.isArray(settings.segmentationJobs)) {
    state.segmentationJobs = settings.segmentationJobs.map((job) => ({
      id: Number(job.id),
      name: String(job.name || `Object ${job.id}`),
      promptFrame: Number(job.promptFrame),
      box: Array.isArray(job.box) ? job.box.map(Number) : null,
      trackingStart: Number(job.trackingStart),
      trackingEnd: Number(job.trackingEnd),
    }));
    state.segmentationDraft = state.segmentationJobs.length
      ? cloneSegmentationJob(state.segmentationJobs[0])
      : null;
    setSegmentationObjectNames();
  }
  updateLabelTargets();
  for (const image of state.images) image.overlayDirty = true;
}

function validateProjectManifest(manifest) {
  if (!manifest || manifest.format !== PROJECT_FORMAT || manifest.version !== PROJECT_VERSION) {
    throw new Error("This is not a supported SegRef3D Lite Web project ZIP.");
  }
  if (!Array.isArray(manifest.images) || manifest.images.length === 0) {
    throw new Error("The project manifest has no image sequence.");
  }
  if (manifest.images.length !== state.images.length) {
    throw new Error(
      `This project expects ${manifest.images.length} source image(s), but ${state.images.length} are loaded.`,
    );
  }
  const savedJobs = manifest.settings?.segmentationJobs;
  if (Array.isArray(savedJobs) && savedJobs.length > 0) {
    if (savedJobs.some((job) => Number(job.id) > 20)) {
      throw new Error("A saved SegOnWeb object ID exceeds the Lite Web label limit of 20.");
    }
    createSegmentationJobManifest({
      images: state.images.map((image, index) => ({
        name: image.name,
        originalFilename: image.name,
        workingFilename: `image${String(index + 1).padStart(4, "0")}.jpg`,
        width: image.width,
        height: image.height,
      })),
      objects: savedJobs,
      source: { project_name: manifest.projectName || "Imported project" },
    });
  }
}

async function importProjectEntries(entries, manifestEntry, sourceName, mode = "replace") {
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestEntry.bytes));
  } catch {
    throw new Error("The SegRef3D project manifest is not valid JSON.");
  }
  validateProjectManifest(manifest);

  const imagesByName = new Map();
  for (const image of state.images) {
    if (!imagesByName.has(image.name)) imagesByName.set(image.name, []);
    imagesByName.get(image.name).push(image);
  }
  const entriesByPath = new Map(entries.map((entry) => [normalizedEntryPath(entry.name), entry]));
  const mappings = [];
  for (const savedImage of manifest.images) {
    const candidates = imagesByName.get(savedImage.name);
    if (!candidates?.length) {
      throw new Error(
        `Source image ${savedImage.name} is not loaded. Load the original image folder first.`,
      );
    }
    const entry = entriesByPath.get(normalizedEntryPath(savedImage.mask || ""));
    if (!entry) throw new Error(`Project mask is missing: ${savedImage.mask || savedImage.name}`);
    mappings.push({
      image: candidates.shift(),
      entry,
      expectedWidth: savedImage.width,
      expectedHeight: savedImage.height,
    });
  }

  const imported = await prepareImportedMasks(mappings);
  if (!imported) {
    setStatus("Project import canceled. Current masks were not changed.");
    showToast("Project import canceled.");
    return false;
  }
  const changedCount = await applyImportedMasks(imported, {
    settings: mode === "replace" ? manifest.settings : null,
    projectName: mode === "replace" ? manifest.projectName || state.projectName : null,
    mode,
  });
  const action = mode === "merge" ? "Merged masks from" : "Restored project";
  setStatus(
    `${action} ${manifest.projectName || sourceName}: ${imported.length} mask(s), ${changedCount} changed and autosaved.`,
  );
  showToast(
    mode === "merge" ? "Project masks merged; current settings preserved." : "Project masks and settings restored.",
  );
  return true;
}

async function importMaskFolder(files) {
  if (state.images.length === 0 || state.loading) return;
  const entries = files.map((file) => ({
    name: file.webkitRelativePath || file.name,
    blob: file,
  }));
  setLoading(true, "Loading label masks", "Checking folder");
  try {
    await importLabelEntries(entries, "selected folder", state.maskImportMode);
  } catch (error) {
    console.error(error);
    setStatus(`Mask loading failed: ${error.message}`);
    window.alert(`Mask loading failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
    elements.maskFolderInput.value = "";
  }
}

async function importMaskZip(file) {
  if (!file || state.images.length === 0 || state.loading) return;
  setLoading(true, "Loading label masks", "Opening ZIP");
  try {
    const entries = await parseZip(file);
    const manifestEntry = entries.find(
      (entry) => entryBasename(entry.name).toLowerCase() === "segref3d-project.json",
    );
    if (manifestEntry) {
      await importProjectEntries(entries, manifestEntry, file.name, state.maskImportMode);
    } else {
      await importLabelEntries(entries, file.name, state.maskImportMode);
    }
  } catch (error) {
    console.error(error);
    setStatus(`Mask ZIP loading failed: ${error.message}`);
    window.alert(`Mask ZIP loading failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
    elements.maskZipInput.value = "";
  }
}

async function exportProjectZip() {
  if (state.images.length === 0 || state.loading) return;
  setLoading(true, "Exporting project ZIP", "Preparing project manifest");
  try {
    const manifest = {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      createdAt: new Date().toISOString(),
      projectName: state.projectName,
      images: state.images.map((image, index) => ({
        name: image.name,
        width: image.width,
        height: image.height,
        originalWidth: image.originalWidth,
        originalHeight: image.originalHeight,
        contentWidth: image.contentWidth,
        contentHeight: image.contentHeight,
        contentX: image.contentX,
        contentY: image.contentY,
        sourceFormat: image.sourceFormat,
        pixelSpacing: image.pixelSpacing,
        sliceSpacing: image.sliceSpacing,
        volumeOrigin: image.volumeOrigin,
        mask: `label_png/${maskFilename(index)}`,
      })),
      settings: {
        targetLabel: state.targetLabel,
        transferLabel: state.transferLabel,
        visibleLabels: state.visibleLabels.slice(1),
        drawMode: state.drawMode,
        penColor: state.penColor,
        autoApplyMode: state.autoApplyMode,
        displaySettings: { ...state.displaySettings },
        calibration: { ...state.calibration },
        volumeOrigin: state.volumeOrigin.slice(),
        volumeInfoSource: state.volumeInfoSource,
        segmentationJobs: state.segmentationJobs.map(cloneSegmentationJob),
      },
    };
    const entries = [
      {
        name: "segref3d-project.json",
        blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
      },
    ];
    for (let index = 0; index < state.images.length; index += 1) {
      elements.loadingDetail.textContent = `Preparing ${index + 1} / ${state.images.length}`;
      entries.push({
        name: `label_png/${maskFilename(index)}`,
        blob: await labelPngBlob(state.images[index]),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    elements.loadingDetail.textContent = "Creating ZIP";
    const zip = await createZip(entries);
    const filename = `${sanitizeFilename(state.projectName)}_SegRef3D_Project_${timestamp()}.zip`;
    downloadBlob(zip, filename);
    setStatus(`Exported project ZIP with ${state.images.length} label mask(s).`);
    showToast(`Downloaded ${filename}`);
  } catch (error) {
    console.error(error);
    setStatus(`Project export failed: ${error.message}`);
    showToast("Project export failed.");
  } finally {
    setLoading(false);
  }
}

function blankSegmentationDraft(objectId = state.targetLabel) {
  return {
    id: Number(objectId),
    name: `Object ${Number(objectId)}`,
    promptFrame: Math.max(0, state.index),
    box: null,
    trackingStart: 0,
    trackingEnd: Math.max(0, state.images.length - 1),
  };
}

function cloneSegmentationJob(job) {
  return { ...job, box: job.box ? job.box.slice() : null };
}

function segmentationJobById(objectId) {
  return state.segmentationJobs.find((job) => job.id === Number(objectId)) || null;
}

function setSegmentationObjectNames() {
  const names = new Map(state.segmentationJobs.map((job) => [job.id, job.name]));
  for (let label = 1; label <= 20; label += 1) {
    const name = names.get(label);
    const display = name && name !== `Object ${label}` ? `Obj ${label}: ${name}` : `Obj ${label}`;
    const copy = elements.labelList.querySelector(`[data-label="${label}"] .label-copy strong`);
    if (copy) copy.textContent = display;
    const targetOption = elements.targetLabel.querySelector(`option[value="${label}"]`);
    const transferOption = elements.transferLabel.querySelector(`option[value="${label}"]`);
    if (targetOption) targetOption.textContent = display;
    if (transferOption) transferOption.textContent = display;
  }
}

function renderSegmentationJobRows() {
  elements.segonwebJobRows.replaceChildren();
  const selectedId = state.segmentationDraft?.id;
  for (const job of state.segmentationJobs) {
    const row = document.createElement("tr");
    row.classList.toggle("selected", job.id === selectedId);
    row.tabIndex = 0;
    const objectCell = document.createElement("td");
    objectCell.textContent = `Obj ${job.id}: ${job.name}`;
    const promptCell = document.createElement("td");
    promptCell.textContent = String(job.promptFrame + 1);
    const rangeCell = document.createElement("td");
    rangeCell.textContent = `${job.trackingStart + 1}-${job.trackingEnd + 1}`;
    const actionCell = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.title = `Delete object ${job.id}`;
    remove.setAttribute("aria-label", `Delete object ${job.id}`);
    remove.innerHTML = '<svg><use href="#i-trash"></use></svg>';
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      state.segmentationJobs = state.segmentationJobs.filter((item) => item.id !== job.id);
      state.segmentationDraft = blankSegmentationDraft(job.id);
      setSegmentationObjectNames();
      syncSegmentationJobDialog();
      render();
    });
    actionCell.append(remove);
    row.append(objectCell, promptCell, rangeCell, actionCell);
    const select = () => {
      state.segmentationDraft = cloneSegmentationJob(job);
      syncSegmentationJobDialog();
      render();
    };
    row.addEventListener("click", select);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") select();
    });
    elements.segonwebJobRows.append(row);
  }
  elements.segonwebJobEmpty.hidden = state.segmentationJobs.length > 0;
}

function syncSegmentationJobDialog() {
  if (!state.segmentationDraft) state.segmentationDraft = blankSegmentationDraft();
  const draft = state.segmentationDraft;
  const frameCount = Math.max(1, state.images.length);
  elements.segonwebObjectId.value = String(draft.id);
  elements.segonwebObjectName.value = draft.name;
  for (const input of [
    elements.segonwebPromptFrame,
    elements.segonwebTrackingStart,
    elements.segonwebTrackingEnd,
  ]) input.max = String(frameCount);
  elements.segonwebPromptFrame.value = String(draft.promptFrame + 1);
  elements.segonwebTrackingStart.value = String(draft.trackingStart + 1);
  elements.segonwebTrackingEnd.value = String(draft.trackingEnd + 1);
  const boxValues = draft.box || ["", "", "", ""];
  [
    elements.segonwebBoxX1,
    elements.segonwebBoxY1,
    elements.segonwebBoxX2,
    elements.segonwebBoxY2,
  ].forEach((input, index) => {
    input.value = boxValues[index];
  });
  syncSegmentationCurrentFrame();
  renderSegmentationJobRows();
}

function syncSegmentationCurrentFrame() {
  if (!elements.segonwebCurrentFrame) return;
  const current = state.images.length > 0 ? state.index + 1 : 0;
  elements.segonwebCurrentFrame.textContent = `${current} / ${state.images.length}`;
  elements.segonwebPreviousFrame.disabled = state.images.length === 0 || state.index === 0;
  elements.segonwebNextFrame.disabled = state.images.length === 0 || state.index === state.images.length - 1;
}

function captureSegmentationRangeBoundary(boundary) {
  if (!state.segmentationDraft || state.images.length === 0) return;
  try {
    const currentFrame = state.index;
    const hasBox = [
      elements.segonwebBoxX1,
      elements.segonwebBoxY1,
      elements.segonwebBoxX2,
      elements.segonwebBoxY2,
    ].every((input) => input.value.trim() !== "");
    const promptFrame = readRequiredNumber(elements.segonwebPromptFrame, "Prompt Frame") - 1;
    if (hasBox && boundary === "start" && currentFrame > promptFrame) {
      setStatus("Tracking Start must be on or before the Box Prompt frame.");
      return;
    }
    if (hasBox && boundary === "end" && currentFrame < promptFrame) {
      setStatus("Tracking End must be on or after the Box Prompt frame.");
      return;
    }

    let start = readRequiredNumber(elements.segonwebTrackingStart, "Tracking Start") - 1;
    let end = readRequiredNumber(elements.segonwebTrackingEnd, "Tracking End") - 1;
    if (boundary === "start") {
      start = currentFrame;
      if (end < start) end = start;
    } else {
      end = currentFrame;
      if (start > end) start = end;
    }
    const normalizedPrompt = hasBox ? promptFrame : clamp(promptFrame, start, end);
    state.segmentationDraft = {
      ...state.segmentationDraft,
      id: Number(elements.segonwebObjectId.value),
      name: elements.segonwebObjectName.value.trim() || `Object ${elements.segonwebObjectId.value}`,
      promptFrame: normalizedPrompt,
      trackingStart: start,
      trackingEnd: end,
    };
    syncSegmentationJobDialog();
    setStatus(`Tracking ${boundary === "start" ? "Start" : "End"} set to frame ${currentFrame + 1}.`);
    elements.canvas.focus();
  } catch (error) {
    setStatus(`SegOnWeb job: ${error.message}`);
  }
}

function readRequiredNumber(input, label) {
  if (input.value.trim() === "") throw new Error(`${label} is required.`);
  const value = Number(input.value);
  if (!Number.isFinite(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function readSegmentationDraft({ requireBox = true } = {}) {
  if (state.images.length === 0) throw new Error("Load images before creating a batch job.");
  const id = Number(elements.segonwebObjectId.value);
  const name = elements.segonwebObjectName.value.trim() || `Object ${id}`;
  const promptFrame = readRequiredNumber(elements.segonwebPromptFrame, "Prompt Frame") - 1;
  const trackingStart = readRequiredNumber(elements.segonwebTrackingStart, "Tracking Start") - 1;
  const trackingEnd = readRequiredNumber(elements.segonwebTrackingEnd, "Tracking End") - 1;
  if (![promptFrame, trackingStart, trackingEnd].every(Number.isInteger)) {
    throw new Error("Prompt Frame and Tracking Range must be whole numbers.");
  }
  if (!(0 <= trackingStart && trackingStart <= promptFrame && promptFrame <= trackingEnd && trackingEnd < state.images.length)) {
    throw new Error("Prompt Frame must be inside the Tracking Start/End range.");
  }
  const boxInputs = [
    elements.segonwebBoxX1,
    elements.segonwebBoxY1,
    elements.segonwebBoxX2,
    elements.segonwebBoxY2,
  ];
  const hasBox = boxInputs.every((input) => input.value.trim() !== "");
  if (requireBox && !hasBox) throw new Error("Set a Box Prompt on the desired Prompt Frame first.");
  const box = hasBox ? boxInputs.map((input, index) => readRequiredNumber(input, ["X1", "Y1", "X2", "Y2"][index])) : null;
  if (box) {
    const image = state.images[promptFrame];
    if (!(0 <= box[0] && box[0] < box[2] && box[2] <= image.width)) {
      throw new Error("Box X coordinates are outside the prompt image.");
    }
    if (!(0 <= box[1] && box[1] < box[3] && box[3] <= image.height)) {
      throw new Error("Box Y coordinates are outside the prompt image.");
    }
  }
  return { id, name, promptFrame, box, trackingStart, trackingEnd };
}

function openSegmentationJobs(objectId = null) {
  if (state.images.length === 0 || state.loading) {
    setStatus("Load images before creating SegOnWeb jobs.");
    return;
  }
  const requestedId = Number(objectId || state.segmentationDraft?.id || state.targetLabel);
  const existing = segmentationJobById(requestedId);
  if (!state.segmentationDraft || objectId !== null) {
    state.segmentationDraft = existing ? cloneSegmentationJob(existing) : blankSegmentationDraft(requestedId);
  }
  syncSegmentationJobDialog();
  if (!elements.segonwebJobsDialog.open) elements.segonwebJobsDialog.show();
}

function newSegmentationObject() {
  const used = new Set(state.segmentationJobs.map((job) => job.id));
  const nextId = Array.from({ length: 20 }, (_, index) => index + 1).find((id) => !used.has(id));
  if (!nextId) {
    setStatus("All 20 object IDs are already registered.");
    return;
  }
  state.segmentationDraft = blankSegmentationDraft(nextId);
  syncSegmentationJobDialog();
  render();
}

function beginSegmentationBox() {
  try {
    const draft = readSegmentationDraft({ requireBox: false });
    draft.promptFrame = state.index;
    draft.trackingStart = Math.min(draft.trackingStart, state.index);
    draft.trackingEnd = Math.max(draft.trackingEnd, state.index);
    draft.box = null;
    state.segmentationDraft = draft;
    state.segmentationBoxMode = { frame: state.index, firstPoint: null, hoverPoint: null };
    elements.segonwebJobsDialog.close();
    setStatus(`Obj ${draft.id}: click the top-left and bottom-right corners on frame ${state.index + 1}.`);
    elements.canvas.focus();
    render();
  } catch (error) {
    setStatus(`SegOnWeb job: ${error.message}`);
  }
}

function saveSegmentationObject() {
  try {
    const draft = readSegmentationDraft();
    const index = state.segmentationJobs.findIndex((job) => job.id === draft.id);
    if (index >= 0) state.segmentationJobs[index] = draft;
    else state.segmentationJobs.push(draft);
    state.segmentationJobs.sort((left, right) => left.id - right.id);
    state.segmentationDraft = cloneSegmentationJob(draft);
    setSegmentationObjectNames();
    syncSegmentationJobDialog();
    setStatus(
      `Saved Obj ${draft.id}: prompt frame ${draft.promptFrame + 1}, tracking ${draft.trackingStart + 1}-${draft.trackingEnd + 1}.`,
    );
    render();
  } catch (error) {
    setStatus(`SegOnWeb job: ${error.message}`);
  }
}

function workingImageJpegBlob(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const outputContext = canvas.getContext("2d");
  const pixels = outputContext.createImageData(image.width, image.height);
  pixels.data.set(image.basePixels);
  outputContext.putImageData(pixels, 0, 0);
  return canvasToBlob(canvas, "image/jpeg", 0.95);
}

async function exportSegmentationJob() {
  if (state.images.length === 0 || state.loading) return;
  if (state.segmentationJobs.length === 0) {
    setStatus("Add at least one Batch Tracking object before export.");
    openSegmentationJobs();
    return;
  }
  setLoading(true, "Exporting SegOnWeb job", "Validating manifest");
  try {
    const manifest = createSegmentationJobManifest({
      images: state.images.map((image, index) => ({
        name: image.name,
        originalFilename: image.name,
        workingFilename: `image${String(index + 1).padStart(4, "0")}.jpg`,
        width: image.width,
        height: image.height,
      })),
      objects: state.segmentationJobs,
      source: {
        project_name: state.projectName,
        exported_at: new Date().toISOString(),
      },
    });
    const entries = [{
      name: "manifest.json",
      blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
    }];
    for (let index = 0; index < state.images.length; index += 1) {
      elements.loadingDetail.textContent = `Preparing image ${index + 1} / ${state.images.length}`;
      entries.push({
        name: manifest.images.files[index].archive_path,
        blob: await workingImageJpegBlob(state.images[index]),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    elements.loadingDetail.textContent = "Creating ZIP";
    downloadBlob(await createZip(entries), "segonweb_input.zip");
    setStatus(`Exported SegOnWeb job: ${state.images.length} images, ${state.segmentationJobs.length} object(s).`);
    showToast("Downloaded segonweb_input.zip");
  } catch (error) {
    console.error(error);
    setStatus(`SegOnWeb export failed: ${error.message}`);
    window.alert(`SegOnWeb export failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
  }
}

async function decodeSegmentationResultImages(manifest, entriesByPath) {
  const sources = [];
  const files = [];
  for (let index = 0; index < manifest.images.files.length; index += 1) {
    const record = manifest.images.files[index];
    const entry = entriesByPath.get(record.archive_path);
    elements.loadingDetail.textContent = `Checking result image ${index + 1} / ${manifest.images.count}`;
    const decoded = await decodeImage(entry.blob, record.archive_path);
    try {
      if (decoded.image.naturalWidth !== manifest.images.width || decoded.image.naturalHeight !== manifest.images.height) {
        throw new Error(`Result image size mismatch: ${record.archive_path}.`);
      }
      sources.push({
        name: record.original_filename,
        width: decoded.image.naturalWidth,
        height: decoded.image.naturalHeight,
        sourceCanvas: imageElementToCanvas(decoded.image),
        sourceFormat: "raster",
      });
      files.push(new File([entry.blob], record.original_filename, { type: "image/jpeg" }));
    } finally {
      URL.revokeObjectURL(decoded.url);
    }
  }
  return { sources, files };
}

function validateCurrentImagesForSegmentationResult(manifest) {
  if (state.images.length === 0) return;
  if (state.images.length !== manifest.images.count) {
    throw new Error(`Image count mismatch: current project has ${state.images.length}, result has ${manifest.images.count}.`);
  }
  const expectedOrder = state.images.map((_, index) => String(index + 1).padStart(4, "0"));
  if (!expectedOrder.every((key, index) => key === manifest.images.order[index])) {
    throw new Error("Image order mismatch between the current project and SegOnWeb result.");
  }
  for (let index = 0; index < state.images.length; index += 1) {
    const image = state.images[index];
    const record = manifest.images.files[index];
    if (image.width !== manifest.images.width || image.height !== manifest.images.height) {
      throw new Error(`Image size mismatch at frame ${index + 1}.`);
    }
    if (image.name && record.original_filename && image.name !== record.original_filename) {
      throw new Error(`Original filename mismatch at frame ${index + 1}: ${image.name} vs ${record.original_filename}.`);
    }
  }
}

async function decodeSegmentationResultMasks(manifest, entriesByPath) {
  const allowed = new Set([0, ...manifest.objects.map((object) => object.id)]);
  const decoded = [];
  for (let index = 0; index < manifest.result.masks.length; index += 1) {
    const record = manifest.result.masks[index];
    elements.loadingDetail.textContent = `Checking result mask ${index + 1} / ${manifest.images.count}`;
    const mask = await decodeLabelPng(entriesByPath.get(record.archive_path));
    if (mask.width !== manifest.images.width || mask.height !== manifest.images.height) {
      throw new Error(`Mask size mismatch: ${record.archive_path}.`);
    }
    for (const value of mask.mask) {
      if (!allowed.has(value)) throw new Error(`${record.archive_path} contains undeclared object ID ${value}.`);
    }
    decoded.push(mask.mask);
  }
  return decoded;
}

async function importSegmentationResult(file) {
  if (!file || state.loading) return;
  setLoading(true, "Importing SegOnWeb result", "Opening ZIP");
  try {
    const entries = await parseZip(file);
    const { manifest, entriesByPath } = validateSegmentationArchive(entries, SEGMENTATION_RESULT_KIND);
    if (manifest.objects.some((object) => object.id > 20)) {
      throw new Error("SegRef3D Lite Web supports object IDs 1-20.");
    }
    validateCurrentImagesForSegmentationResult(manifest);
    const resultImages = await decodeSegmentationResultImages(manifest, entriesByPath);
    const decodedMasks = await decodeSegmentationResultMasks(manifest, entriesByPath);

    const hasExistingMasks = state.images.some((image) => image.mask.some((value) => value !== 0));
    if (
      hasExistingMasks &&
      !window.confirm("Importing this SegOnWeb result will replace the current label masks. Continue?")
    ) {
      setStatus("SegOnWeb result import canceled. Current masks were not changed.");
      return;
    }

    if (state.images.length === 0) {
      const loaded = await prepareImageSequence(
        resultImages.sources,
        resultImages.files,
        manifest.source.project_name || "SegOnWeb result",
        "SegOnWeb result image(s)",
        { preserveDimensions: true },
      );
      if (!loaded) return;
    }
    const imported = decodedMasks.map((mask, index) => ({ image: state.images[index], mask }));
    await applyImportedMasks(imported, { mode: "replace" });
    state.segmentationJobs = manifest.objects.map((object) => ({
      id: object.id,
      name: object.name,
      promptFrame: object.prompt_frame,
      box: object.box.slice(),
      trackingStart: object.tracking_start,
      trackingEnd: object.tracking_end,
    }));
    state.segmentationDraft = state.segmentationJobs.length
      ? cloneSegmentationJob(state.segmentationJobs[0])
      : null;
    state.segmentationBoxMode = null;
    setSegmentationObjectNames();
    updateImageUi();
    render();
    setStatus(`Imported SegOnWeb result: ${decodedMasks.length} masks, ${state.segmentationJobs.length} object(s).`);
    showToast("SegOnWeb result imported.");
  } catch (error) {
    console.error(error);
    setStatus(`SegOnWeb result import failed: ${error.message}`);
    window.alert(`SegOnWeb result import failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
    elements.segonwebResultInput.value = "";
  }
}

function decodeImage(file, displayName = file.name || "image") {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${displayName}`));
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

function imageElementToCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas;
}

async function medicalFrameToCanvas(frame) {
  if (frame.kind === "encoded") {
    const blob = new Blob([frame.bytes], { type: frame.mimeType });
    const decoded = await decodeImage(blob, frame.name);
    try {
      return makeWorkingCanvas(
        decoded.image,
        decoded.image.naturalWidth,
        decoded.image.naturalHeight,
        frame.width,
        frame.height,
      );
    } finally {
      URL.revokeObjectURL(decoded.url);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const outputContext = canvas.getContext("2d");
  const imageData = outputContext.createImageData(frame.width, frame.height);
  if (frame.kind === "gray") {
    for (let index = 0; index < frame.pixels.length; index += 1) {
      const target = index * 4;
      const value = frame.pixels[index];
      imageData.data[target] = value;
      imageData.data[target + 1] = value;
      imageData.data[target + 2] = value;
      imageData.data[target + 3] = 255;
    }
  } else {
    imageData.data.set(frame.pixels);
  }
  outputContext.putImageData(imageData, 0, 0);
  return canvas;
}

async function prepareImageSequence(
  sources,
  projectFiles,
  projectName,
  sourceDescription,
  { autoExportVolInfo = false, preserveDimensions = false } = {},
) {
  if (sources.length === 0) throw new Error("No readable image slices were found.");
  const largeCount = sources.filter(
    (source) => Math.max(source.width, source.height) > 2000,
  ).length;
  const resizeLarge =
    !preserveDimensions &&
    largeCount > 0 &&
    window.confirm(
      `${largeCount} image(s) are larger than 2000px.\n\nResize their longest side to 1000px for smoother editing?`,
    );

  const dimensions = sources.map((source) => {
    const longest = Math.max(source.width, source.height);
    const scale = resizeLarge && longest > 2000 ? 1000 / longest : 1;
    return {
      width: Math.max(1, Math.round(source.width * scale)),
      height: Math.max(1, Math.round(source.height * scale)),
    };
  });
  const uniqueSizes = new Set(dimensions.map(({ width, height }) => `${width}x${height}`));
  const unifyCanvas =
    !preserveDimensions &&
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
    return false;
  }

  const projectId = createProjectId(projectFiles);
  const prepared = [];
  for (let index = 0; index < sources.length; index += 1) {
    elements.loadingDetail.textContent = `Preparing ${index + 1} / ${sources.length}`;
    const source = sources[index];
    const size = dimensions[index];
    const width = unifyCanvas ? commonWidth : size.width;
    const height = unifyCanvas ? commonHeight : size.height;
    const sourceCanvas = makeWorkingCanvas(
      source.sourceCanvas,
      size.width,
      size.height,
      width,
      height,
    );
    const sourceSpacing = source.pixelSpacing;
    const pixelSpacing = sourceSpacing
      ? [
          Number(sourceSpacing[0]) * (source.width / size.width),
          Number(sourceSpacing[1]) * (source.height / size.height),
        ]
      : null;
    const restored = await loadMask(projectId, source.name, width, height).catch(() => null);
    prepared.push({
      name: source.name,
      width,
      height,
      originalWidth: source.width,
      originalHeight: source.height,
      contentWidth: size.width,
      contentHeight: size.height,
      contentX: Math.floor((width - size.width) / 2),
      contentY: Math.floor((height - size.height) / 2),
      sourceFormat: source.sourceFormat || "raster",
      pixelSpacing,
      sliceSpacing: source.sliceSpacing || null,
      volumeOrigin: source.volumeOrigin || null,
      sourceCanvas,
      basePixels: canvasRgba(sourceCanvas),
      displayVersion: -1,
      sourcePixels: null,
      mask: restored ?? new Uint8Array(width * height),
      overlayCanvas: null,
      overlayDirty: true,
      paths: [],
      activePath: [],
      activePathColor: null,
      activePathMode: null,
      pathRedo: [],
      undo: [],
      redo: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  state.images = prepared;
  state.segmentationJobs = [];
  state.segmentationDraft = null;
  state.segmentationBoxMode = null;
  setSegmentationObjectNames();
  state.projectId = projectId;
  state.index = 0;
  state.projectName = projectName;
  state.visibleLabels = Array.from({ length: 21 }, (_, label) => label === 1);
  resetDisplaySettings({ announce: false });
  initializeCalibrationFromImages();
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
    `Loaded ${prepared.length} ${sourceDescription}${resizeLarge ? " · resized large images" : ""}${unifyCanvas ? " · unified canvas" : ""}.`,
  );
  elements.canvas.focus();
  navigator.storage?.persist?.().catch(() => {});
  if (autoExportVolInfo) exportVolInfoCsv({ automatic: true });
  return true;
}

async function decodeRasterSources(files) {
  const sources = [];
  for (let index = 0; index < files.length; index += 1) {
    elements.loadingDetail.textContent = `Reading ${index + 1} / ${files.length}`;
    const decoded = await decodeImage(files[index]);
    try {
      sources.push({
        name: files[index].name,
        width: decoded.image.naturalWidth,
        height: decoded.image.naturalHeight,
        sourceCanvas: imageElementToCanvas(decoded.image),
        sourceFormat: "raster",
      });
    } finally {
      URL.revokeObjectURL(decoded.url);
    }
  }
  return sources;
}

function chooseDicomSeries(groups) {
  if (groups.length === 1) return groups[0];
  const choices = groups
    .map((group, index) => {
      const label = group.description || `Series ${group.seriesNumber || index + 1}`;
      return `${index + 1}: ${label} (${group.items.length} file(s))`;
    })
    .join("\n");
  const answer = window.prompt(
    `Found ${groups.length} DICOM series.\n\n${choices}\n\nEnter the series number to load:`,
    "1",
  );
  if (answer === null) return null;
  const index = Number.parseInt(answer, 10) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= groups.length) {
    throw new Error("The selected DICOM series number is invalid.");
  }
  return groups[index];
}

async function decodeDicomSources(files) {
  const instances = [];
  const failures = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    elements.loadingDetail.textContent = `Reading DICOM ${index + 1} / ${files.length}`;
    try {
      const instance = parseDicomInstance(await file.arrayBuffer(), file.name);
      instance.file = file;
      instances.push(instance);
    } catch (error) {
      failures.push({ file, error });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (instances.length === 0) {
    throw new Error(failures[0]?.error.message || "No readable DICOM images were found.");
  }
  if (
    failures.length > 0 &&
    !window.confirm(
      `${failures.length} file(s) could not be read as DICOM.\n\n` +
        `Continue with ${instances.length} readable file(s)?`,
    )
  ) {
    return null;
  }
  const selected = chooseDicomSeries(groupDicomSeries(instances));
  if (!selected) return null;
  const decoded = decodeDicomSeries(selected.items);
  const sources = [];
  for (let index = 0; index < decoded.frames.length; index += 1) {
    elements.loadingDetail.textContent = `Preparing DICOM ${index + 1} / ${decoded.frames.length}`;
    const frame = decoded.frames[index];
    sources.push({
      name: frame.name,
      width: frame.width,
      height: frame.height,
      sourceCanvas: await medicalFrameToCanvas(frame),
      sourceFormat: "dicom",
      pixelSpacing: decoded.spacing.slice(0, 2),
      sliceSpacing: decoded.spacing[2],
      volumeOrigin: decoded.origin,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return {
    sources,
    files: selected.items.map((instance) => instance.file),
    description: selected.description || "DICOM series",
  };
}

async function prepareNiftiFile(file) {
  if (!file || state.loading) return;
  setLoading(true, "Loading NIfTI volume", "Reading volume");
  try {
    const volume = parseNiftiVolume(await file.arrayBuffer(), file.name);
    const sources = [];
    for (let index = 0; index < volume.frames.length; index += 1) {
      elements.loadingDetail.textContent = `Preparing slice ${index + 1} / ${volume.frames.length}`;
      const frame = volume.frames[index];
      sources.push({
        name: frame.name,
        width: frame.width,
        height: frame.height,
        sourceCanvas: await medicalFrameToCanvas(frame),
        sourceFormat: "nifti",
        pixelSpacing: volume.spacing.slice(0, 2),
        sliceSpacing: volume.spacing[2],
        volumeOrigin: volume.origin,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await prepareImageSequence(
      sources,
      [file],
      file.name.replace(/\.nii(?:\.gz)?$/i, "") || "NIfTI volume",
      "NIfTI slice(s)",
      { autoExportVolInfo: true },
    );
  } catch (error) {
    console.error(error);
    setStatus(`NIfTI loading failed: ${error.message}`);
    window.alert(`NIfTI loading failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
    elements.volumeInput.value = "";
  }
}

async function prepareFiles(files) {
  if (state.loading) return;
  const visibleFiles = files.filter((file) => !file.name.startsWith("."));
  const niftiFiles = visibleFiles.filter((file) => isNiftiFilename(file.name));
  const rasterFiles = visibleFiles
    .filter((file) => /\.(jpe?g|png)$/i.test(file.name))
    .sort((left, right) => naturalCompare(left.name, right.name));
  const dicomFiles = visibleFiles
    .filter((file) => /\.dcm$/i.test(file.name) || !file.name.includes("."))
    .sort((left, right) => naturalCompare(left.name, right.name));
  setLoading(true, "Loading images", `Reading 0 / ${visibleFiles.length}`);
  try {
    if (niftiFiles.length > 0) {
      if (niftiFiles.length !== 1 || rasterFiles.length > 0 || dicomFiles.length > 0) {
        throw new Error("Select one NIfTI file by itself, without other image formats.");
      }
      setLoading(false);
      await prepareNiftiFile(niftiFiles[0]);
      return;
    }
    const explicitDicom = dicomFiles.some((file) => /\.dcm$/i.test(file.name));
    if (rasterFiles.length > 0 && explicitDicom) {
      throw new Error("The selected folder mixes raster images and DICOM files. Use separate folders.");
    }
    const projectFolder =
      visibleFiles[0]?.webkitRelativePath?.split("/")[0] || "Image sequence";
    if (rasterFiles.length > 0) {
      const sources = await decodeRasterSources(rasterFiles);
      await prepareImageSequence(sources, rasterFiles, projectFolder, "image(s)");
      return;
    }
    if (dicomFiles.length > 0) {
      const decoded = await decodeDicomSources(dicomFiles);
      if (!decoded) {
        setStatus("DICOM loading canceled.");
        return;
      }
      await prepareImageSequence(
        decoded.sources,
        decoded.files,
        projectFolder === "Image sequence" ? decoded.description : projectFolder,
        "DICOM frame(s)",
        { autoExportVolInfo: true },
      );
      return;
    }
    throw new Error("No JPG, PNG, DICOM, or NIfTI images were found.");
  } catch (error) {
    console.error(error);
    setStatus(`Image loading failed: ${error.message}`);
    window.alert(`Image loading failed.\n\n${error.message}`);
  } finally {
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
      originalWidth: sourceCanvas.width,
      originalHeight: sourceCanvas.height,
      contentWidth: sourceCanvas.width,
      contentHeight: sourceCanvas.height,
      contentX: 0,
      contentY: 0,
      sourceFormat: "demo",
      pixelSpacing: null,
      sliceSpacing: null,
      volumeOrigin: null,
      sourceCanvas,
      basePixels: canvasRgba(sourceCanvas),
      displayVersion: -1,
      sourcePixels: null,
      mask: new Uint8Array(sourceCanvas.width * sourceCanvas.height),
      overlayCanvas: null,
      overlayDirty: true,
      paths: [],
      activePath: [],
      activePathColor: null,
      activePathMode: null,
      pathRedo: [],
      undo: [],
      redo: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  state.images = images;
  state.segmentationJobs = [];
  state.segmentationDraft = null;
  state.segmentationBoxMode = null;
  setSegmentationObjectNames();
  state.projectId = "segref3d-lite-demo-v1";
  state.projectName = "Demo sequence";
  state.index = 0;
  resetDisplaySettings({ announce: false });
  initializeCalibrationFromImages();
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
  if (state.segmentationBoxMode) {
    if (state.segmentationBoxMode.frame !== state.index) {
      state.segmentationBoxMode = { frame: state.index, firstPoint: null, hoverPoint: null };
      state.segmentationDraft.promptFrame = state.index;
    }
    const point = imagePointerPosition(event, false);
    state.segmentationBoxMode.hoverPoint = point;
    if (!state.segmentationBoxMode.firstPoint) {
      state.segmentationBoxMode.firstPoint = point;
      setStatus("Click the opposite corner of the Box Prompt.");
    } else {
      const first = state.segmentationBoxMode.firstPoint;
      const box = [
        Math.min(first.x, point.x),
        Math.min(first.y, point.y),
        Math.max(first.x, point.x),
        Math.max(first.y, point.y),
      ];
      if (box[2] - box[0] < 1 || box[3] - box[1] < 1) {
        setStatus("Box Prompt must have a positive width and height.");
        state.segmentationBoxMode.firstPoint = null;
        render();
        return;
      }
      state.segmentationDraft.box = box;
      state.segmentationDraft.promptFrame = state.index;
      state.segmentationBoxMode = null;
      setStatus(`Box Prompt set for Obj ${state.segmentationDraft.id} on frame ${state.index + 1}.`);
      render();
      setTimeout(() => openSegmentationJobs(), 0);
      return;
    }
    render();
    return;
  }
  if (state.rgbPickMode) {
    const color = rgbAt(image.basePixels, image.width, image.height, rawPoint.x, rawPoint.y);
    elements.rgbTarget.value = rgbToHex(color);
    state.rgbPickMode = false;
    setStatus(`Picked RGB (${color.red}, ${color.green}, ${color.blue}).`);
    openImageTools("extract");
    return;
  }
  if (state.calibrationMode) {
    const point = imagePointerPosition(event, false);
    state.calibrationPoints.push(point);
    state.calibrationHoverPoint = point;
    if (state.calibrationPoints.length === 2) {
      const [start, end] = state.calibrationPoints;
      const pixelLength = Math.hypot(end.x - start.x, end.y - start.y);
      if (pixelLength > 0) {
        const spacing = state.calibration.referenceLength / pixelLength;
        state.calibration.xSpacing = spacing;
        state.calibration.ySpacing = spacing;
        state.volumeInfoSource = "Reference line calibration";
        image.calibrationLine = [start, end];
        syncCalibrationControls();
        syncVolInfoSummary();
        setStatus(
          `Calibrated ${state.calibration.referenceLength.toLocaleString()} mm over ` +
            `${pixelLength.toFixed(2)} px: ${spacing.toPrecision(6)} mm/px.`,
        );
        exportVolInfoCsv({ automatic: true });
      } else {
        setStatus("Calibration points must be different.");
      }
      state.calibrationMode = false;
      state.calibrationPoints = [];
      state.calibrationHoverPoint = null;
    } else {
      setStatus("Click the second calibration point.");
    }
    render();
    return;
  }
  const point = imagePointerPosition(event, state.drawMode === "snap");
  if (state.drawMode === "free") {
    image.activePath = [point];
    image.activePathColor = state.penColor;
    image.activePathMode = state.drawMode;
    state.pointer.drawing = true;
    state.pointer.id = event.pointerId;
    elements.canvas.setPointerCapture(event.pointerId);
  } else {
    if (image.activePath.length === 0) {
      image.activePathColor = state.penColor;
      image.activePathMode = state.drawMode;
    }
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
  if (state.segmentationBoxMode) {
    const rawPoint = screenToImage(local.x, local.y, state.viewport);
    state.segmentationBoxMode.hoverPoint = pointInsideImage(rawPoint, image.width, image.height)
      ? imagePointerPosition(event, false)
      : null;
    render();
    return;
  }
  if (state.calibrationMode && state.calibrationPoints.length === 1) {
    const rawPoint = screenToImage(local.x, local.y, state.viewport);
    state.calibrationHoverPoint = pointInsideImage(rawPoint, image.width, image.height)
      ? imagePointerPosition(event, false)
      : null;
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

function handlePointerLeave() {
  if (state.pointer.drawing || state.pointer.panning) return;
  let changed = false;
  if (state.segmentationBoxMode?.hoverPoint) {
    state.segmentationBoxMode.hoverPoint = null;
    changed = true;
  }
  if (state.calibrationHoverPoint) {
    state.calibrationHoverPoint = null;
    changed = true;
  }
  if (changed) render();
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

function zoomFromKeyboard(factor) {
  const rect = elements.canvas.getBoundingClientRect();
  const nextZoom = clamp(state.viewport.zoom * factor, 0.05, 24);
  state.viewport = zoomAroundPoint(
    state.viewport,
    rect.width / 2,
    rect.height / 2,
    nextZoom,
  );
  render();
}

function handleKeyDown(event) {
  const editingJobField =
    elements.segonwebJobsDialog.open &&
    elements.segonwebJobsDialog.contains(event.target) &&
    event.target.closest?.("input, select, button");
  const editingToolsField =
    elements.toolsDialog.open &&
    elements.toolsDialog.contains(event.target) &&
    event.target.closest?.("input, select, button");
  if (
    elements.localFileDialog.open ||
    elements.maskImportDialog.open ||
    elements.clearMasksDialog.open ||
    editingJobField ||
    editingToolsField
  ) {
    return;
  }
  if (!currentImage()) return;
  const key = event.key;
  const lowerKey = key.toLowerCase();
  const code = event.code;

  if (key === "Escape" && state.segmentationBoxMode) {
    state.segmentationBoxMode = null;
    setStatus("Box Prompt canceled.");
    render();
    event.preventDefault();
    return;
  }
  if (key === "Escape" && state.calibrationMode) {
    state.calibrationMode = false;
    state.calibrationPoints = [];
    state.calibrationHoverPoint = null;
    setStatus("Calibration line canceled.");
    render();
    event.preventDefault();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && (code === "KeyZ" || lowerKey === "z")) {
    event.shiftKey ? redoEdit() : undoEdit();
    event.preventDefault();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (key === "Enter") {
    finalizeActivePath();
    event.preventDefault();
  } else if (key === "Escape") {
    currentImage().activePath = [];
    currentImage().activePathColor = null;
    currentImage().activePathMode = null;
    render();
    updateHistoryButtons();
  } else if (["PageDown", "KeyF", "KeyJ"].includes(code) || lowerKey === "pagedown") {
    switchImage(1);
    event.preventDefault();
  } else if (["PageUp", "KeyR", "KeyU"].includes(code) || lowerKey === "pageup") {
    switchImage(-1);
    event.preventDefault();
  } else if (["KeyE", "KeyI", "NumpadAdd", "Equal"].includes(code)) {
    zoomFromKeyboard(1.25);
    event.preventDefault();
  } else if (["KeyQ", "KeyP", "NumpadSubtract", "Minus"].includes(code)) {
    zoomFromKeyboard(0.8);
    event.preventDefault();
  } else if (["ArrowLeft", "KeyA", "KeyK"].includes(code)) {
    state.viewport.panX += 50;
    render();
    event.preventDefault();
  } else if (["ArrowRight", "KeyD", "Semicolon"].includes(code)) {
    state.viewport.panX -= 50;
    render();
    event.preventDefault();
  } else if (["ArrowUp", "KeyW", "KeyO"].includes(code)) {
    state.viewport.panY += 50;
    render();
    event.preventDefault();
  } else if (["ArrowDown", "KeyS", "KeyL"].includes(code)) {
    state.viewport.panY -= 50;
    render();
    event.preventDefault();
  }
}

function localFileNoticeHidden() {
  try {
    return localStorage.getItem(LOCAL_FILE_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberLocalFileNotice() {
  if (!elements.localFileDontShow.checked) return;
  try {
    localStorage.setItem(LOCAL_FILE_NOTICE_KEY, "1");
  } catch {
    // Folder selection still works when browser storage is unavailable.
  }
}

function pendingLocalInput() {
  return state.pendingPicker === "volume" ? elements.volumeInput : elements.folderInput;
}

function requestLocalPicker(kind) {
  state.pendingPicker = kind;
  if (localFileNoticeHidden() || typeof elements.localFileDialog.showModal !== "function") {
    pendingLocalInput().click();
    return;
  }
  elements.localFileDontShow.checked = false;
  const isVolume = kind === "volume";
  elements.localFileTitle.textContent = isVolume
    ? "Open a local NIfTI volume"
    : "Open a local image folder";
  elements.localFileContinueText.textContent = isVolume ? "Open NIfTI" : "Open Folder";
  elements.localFileDialog.showModal();
}

function requestLocalFolder() {
  requestLocalPicker("folder");
}

function requestLocalVolume() {
  requestLocalPicker("volume");
}

function requestMaskImport() {
  if (state.images.length === 0 || state.loading) return;
  if (typeof elements.maskImportDialog.showModal === "function") {
    elements.maskImportDialog.showModal();
  } else {
    elements.maskZipInput.click();
  }
}

function setMaskImportMode(mode) {
  state.maskImportMode = mode === "merge" ? "merge" : "replace";
  for (const input of elements.maskImportModes) {
    input.checked = input.value === state.maskImportMode;
  }
  elements.maskImportModeDescription.textContent =
    state.maskImportMode === "merge"
      ? "Add imported non-zero labels. Imported labels win where masks overlap."
      : "Replace each matched frame with the imported mask.";
}

function requestClearAllMasks() {
  if (state.images.length === 0 || state.loading) return;
  const changedImages = state.images.filter((image) => image.mask.some((value) => value !== 0));
  if (changedImages.length === 0) {
    setStatus("All label masks are already empty.");
    showToast("Masks are already empty.");
    return;
  }
  elements.clearMasksCount.textContent =
    `Label masks on ${changedImages.length} of ${state.images.length} image(s) will be cleared.`;
  elements.clearMasksDialog.showModal();
}

async function clearAllMasks() {
  if (state.images.length === 0 || state.loading) return;
  const changedImages = state.images.filter((image) => image.mask.some((value) => value !== 0));
  elements.clearMasksDialog.close();
  if (changedImages.length === 0) return;
  setLoading(true, "Clearing label masks", `Resetting ${changedImages.length} image(s)`);
  try {
    await state.saveQueue;
    for (const image of state.images) {
      image.mask.fill(0);
      image.undo.length = 0;
      image.redo.length = 0;
      image.overlayDirty = true;
      clearImagePaths(image);
    }
    if (state.projectId) await clearProjectMasks(state.projectId);
    updateLabelCounts();
    updateHistoryButtons();
    render();
    setSaveState("All masks cleared", "saved");
    setStatus(`Cleared label masks from ${changedImages.length} image(s) and reset browser autosave.`);
    showToast("All masks cleared.");
  } catch (error) {
    console.error(error);
    for (const image of changedImages) await autosave(image, "Cleared masks autosaved");
    setStatus(`Masks were cleared, but autosave reset needed a fallback: ${error.message}`);
    showToast("Masks cleared with autosave fallback.");
  } finally {
    setLoading(false);
  }
}

function bindEvents() {
  elements.loadFolder.addEventListener("click", requestLocalFolder);
  elements.emptyLoad.addEventListener("click", requestLocalFolder);
  elements.loadVolume.addEventListener("click", requestLocalVolume);
  elements.emptyVolume.addEventListener("click", requestLocalVolume);
  elements.localFileCancel.addEventListener("click", () => elements.localFileDialog.close());
  elements.localFileContinue.addEventListener("click", () => {
    rememberLocalFileNotice();
    elements.localFileDialog.close();
    pendingLocalInput().click();
  });
  elements.folderInput.addEventListener("change", () => prepareFiles([...elements.folderInput.files]));
  elements.volumeInput.addEventListener("change", () => prepareNiftiFile(elements.volumeInput.files[0]));
  elements.loadMasks.addEventListener("click", requestMaskImport);
  elements.maskImportCancel.addEventListener("click", () => elements.maskImportDialog.close());
  elements.clearMasksCancel.addEventListener("click", () => elements.clearMasksDialog.close());
  elements.clearMasksConfirm.addEventListener("click", clearAllMasks);
  for (const input of elements.maskImportModes) {
    input.addEventListener("change", () => setMaskImportMode(input.value));
  }
  elements.chooseMaskFolder.addEventListener("click", () => {
    elements.maskImportDialog.close();
    elements.maskFolderInput.click();
  });
  elements.chooseMaskZip.addEventListener("click", () => {
    elements.maskImportDialog.close();
    elements.maskZipInput.click();
  });
  elements.maskFolderInput.addEventListener("change", () =>
    importMaskFolder([...elements.maskFolderInput.files]),
  );
  elements.maskZipInput.addEventListener("change", () => importMaskZip(elements.maskZipInput.files[0]));
  elements.loadDemo.addEventListener("click", loadDemo);
  elements.fitView.addEventListener("click", fitCurrentImage);
  elements.previousImage.addEventListener("click", () => switchImage(-1));
  elements.nextImage.addEventListener("click", () => switchImage(1));
  elements.targetLabel.addEventListener("change", () => selectTargetLabel(Number(elements.targetLabel.value)));
  elements.penColor.addEventListener("change", () => {
    state.penColor = elements.penColor.value;
    elements.penColorSwatch.style.background = state.penColor;
    render();
  });
  elements.transferLabel.addEventListener("change", () => {
    state.transferLabel = Number(elements.transferLabel.value);
  });
  elements.autoApplyMode.addEventListener("change", () => {
    setAutoApplyMode(elements.autoApplyMode.value);
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
  elements.clearMasks.addEventListener("click", requestClearAllMasks);
  elements.imageTools.addEventListener("click", () => openImageTools("display"));
  elements.toolsClose.addEventListener("click", () => elements.toolsDialog.close());
  elements.toolsPreviousFrame.addEventListener("click", () => switchImage(-1));
  elements.toolsNextFrame.addEventListener("click", () => switchImage(1));
  for (const tab of elements.toolTabs) {
    tab.addEventListener("click", () => selectToolTab(tab.dataset.toolTab));
  }
  for (const input of [
    elements.windowCenter,
    elements.windowWidth,
    elements.brightness,
    elements.contrast,
  ]) {
    input.addEventListener("input", updateDisplaySettingsFromControls);
  }
  elements.resetDisplay.addEventListener("click", () => resetDisplaySettings());
  elements.thresholdMin.addEventListener("input", syncExtractionControls);
  elements.thresholdMax.addEventListener("input", syncExtractionControls);
  elements.rgbTolerance.addEventListener("input", syncExtractionControls);
  elements.applyThreshold.addEventListener("click", () => applyPixelExtraction("threshold"));
  elements.pickRgb.addEventListener("click", beginRgbPicker);
  elements.applyRgb.addEventListener("click", () => applyPixelExtraction("rgb"));
  for (const input of [
    elements.spacingX,
    elements.spacingY,
    elements.spacingZ,
    elements.referenceLength,
  ]) {
    input.addEventListener("change", () => {
      updateCalibrationFromControls();
      state.volumeInfoSource = "Manual settings";
      syncVolInfoSummary();
    });
  }
  elements.drawCalibration.addEventListener("click", beginCalibration);
  elements.importVolInfo.addEventListener("click", () => {
    elements.toolsDialog.close();
    elements.volInfoInput.click();
  });
  elements.exportVolInfo.addEventListener("click", () => exportVolInfoCsv());
  elements.volInfoInput.addEventListener("change", () =>
    importVolInfoCsv(elements.volInfoInput.files[0]),
  );
  elements.exportNifti.addEventListener("click", () => exportLabelVolume("nifti"));
  elements.exportTiff.addEventListener("click", () => exportLabelVolume("tiff"));
  elements.exportStl.addEventListener("click", exportStlMeshes);
  elements.exportLabels.addEventListener("click", () => exportSequence("labels"));
  elements.exportOverlays.addEventListener("click", () => exportSequence("overlays"));
  elements.exportProject.addEventListener("click", exportProjectZip);
  elements.segonwebJobs.addEventListener("click", () => openSegmentationJobs());
  elements.segonwebJobsClose.addEventListener("click", () => elements.segonwebJobsDialog.close());
  elements.segonwebNewObject.addEventListener("click", newSegmentationObject);
  elements.segonwebSetBox.addEventListener("click", beginSegmentationBox);
  elements.segonwebPreviousFrame.addEventListener("click", () => switchImage(-1));
  elements.segonwebNextFrame.addEventListener("click", () => switchImage(1));
  elements.segonwebSetStart.addEventListener("click", () => captureSegmentationRangeBoundary("start"));
  elements.segonwebSetEnd.addEventListener("click", () => captureSegmentationRangeBoundary("end"));
  elements.segonwebSaveObject.addEventListener("click", saveSegmentationObject);
  elements.segonwebObjectId.addEventListener("change", () => {
    const objectId = Number(elements.segonwebObjectId.value);
    const existing = segmentationJobById(objectId);
    state.segmentationDraft = existing ? cloneSegmentationJob(existing) : blankSegmentationDraft(objectId);
    syncSegmentationJobDialog();
    render();
  });
  elements.exportSegonweb.addEventListener("click", exportSegmentationJob);
  elements.importSegonweb.addEventListener("click", () => elements.segonwebResultInput.click());
  elements.segonwebResultInput.addEventListener("change", () =>
    importSegmentationResult(elements.segonwebResultInput.files[0]),
  );
  elements.labelsToggle.addEventListener("click", () => elements.labelsPanel.classList.add("open"));
  elements.labelsClose.addEventListener("click", () => elements.labelsPanel.classList.remove("open"));
  elements.canvas.addEventListener("pointerdown", handlePointerDown);
  elements.canvas.addEventListener("pointermove", handlePointerMove);
  elements.canvas.addEventListener("pointerleave", handlePointerLeave);
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
  document.addEventListener("keydown", handleKeyDown, { capture: true });
  new ResizeObserver(() => resizeCanvas()).observe(elements.canvasPanel);
}

initializeLabels();
elements.penColorSwatch.style.background = state.penColor;
setAutoApplyMode("off", { announce: false });
setMaskImportMode("replace");
syncDisplayControls();
syncExtractionControls();
syncCalibrationControls();
syncVolInfoSummary();
bindEvents();
setControlsEnabled(false);
resizeCanvas();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./service-worker.js").catch((error) => {
    console.warn("Service worker registration failed", error);
  });
}
