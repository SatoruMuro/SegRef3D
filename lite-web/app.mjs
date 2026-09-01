import {
  LABEL_COLORS,
  applyRasterToMask,
  clamp,
  colorToRgb,
  combineLabelMasks,
  createProjectId,
  datasetNameStem,
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
  screenToImage,
  timestamp,
  traceRegionPath,
  transferLabel,
  zoomAroundPoint,
} from "./core.mjs?v=28";
import {
  decodeDicomSeriesAsync,
  dicomMappingPreview,
  groupDicomSeries,
  isNiftiFilename,
  isTiffFilename,
  parseDicomInstance,
  parseNiftiLabelVolume,
  parseNiftiVolume,
  parseTiffStack,
} from "./medical-io.mjs?v=24";
import {
  axisAlignedAffine,
  geometryWithSpacing,
  makeVolumeGeometry,
  transformGeometryForPreparedImage,
  upsampleGeometryAlongK,
} from "./medical-geometry.mjs?v=3";
import { demoDatasetById } from "./demo-datasets.mjs?v=4";
import { clearProjectMasks, loadMask, saveMask } from "./storage.mjs?v=26";
import { createZip, parseZip } from "./zip.mjs?v=25";
import {
  SEGMENTATION_RESULT_KIND,
  createSegmentationJobManifest,
  validateSegmentationArchive,
} from "./segmentation-job.mjs?v=17";
import {
  collapseInstant3DObjects,
  createInstant3DRequest,
  geometryMismatches as instant3DGeometryMismatches,
  sha256Hex,
  validateInstant3DResult,
} from "./instant3d-bridge.mjs?v=4";
import {
  adjustedRgba,
  displayControlRange,
  hexToRgb,
  modalityToRgba,
  rgbAt,
  rgbRaster,
  rgbToHex,
  thresholdRaster,
} from "./image-tools.mjs?v=26";
import {
  createBinaryStl,
  createNiftiLabelVolume,
  createTiffLabelStack,
  createVolInfoCsv,
  cropLabelVolume,
  interpolateLabelVolume,
  interpolateMultiLabelVolume,
  marchingTetrahedra,
  parseVolInfoCsv,
} from "./volume-tools.mjs?v=17";
import {
  applyMaskVolumeChanges,
  buildMaskVolumeChanges,
  checkProject,
  cleanupLabelMask,
  clearLabelVolume,
  createVolumeStatisticsCsv,
  frameIndicesForScope,
  interpolateLabelMasks,
  mergeLabelVolume,
  relabelVolume,
  volumeStatistics,
  volumeStatisticsAsync,
} from "./mask-tools.mjs?v=20";
import { upgradeWorkspaceLayout } from "./workspace-ui.mjs?v=30";
import {
  createTrainingCaseEntries,
  createTrainingCaseId,
  prepareTrainingSourceChannels,
} from "./training-export.mjs?v=2";
import {
  MASK_MANIFEST_FILENAME,
  MASK_SLICE_ORDER,
  createLabelPngEntries,
  exportMappingPreview,
  maskManifestBlob,
  validateMaskManifest,
} from "./mask-sequence.mjs?v=1";

const DEBUG_SLICE_MAPPING = new URLSearchParams(
  globalThis.location?.search || "",
).get("debugSliceMapping") === "1";
const DEBUG_DICOM_DISPLAY = new URLSearchParams(
  globalThis.location?.search || "",
).get("debugDicomDisplay") === "1";

try {
  upgradeWorkspaceLayout();
} catch (error) {
  console.error("Workspace layout initialization failed", error);
  const startupStatus = document.querySelector("#status-text");
  if (startupStatus) startupStatus.textContent = `Workspace initialization failed: ${error.message}`;
  throw error;
}

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
  loadRabbitDemo: document.querySelector("#load-rabbit-demo"),
  fitView: document.querySelector("#fit-view"),
  previousImage: document.querySelector("#previous-image"),
  nextImage: document.querySelector("#next-image"),
  imageCounter: document.querySelector("#image-counter"),
  sliceNumber: document.querySelector("#slice-number"),
  sliceSlider: document.querySelector("#slice-slider"),
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
  undoAction: document.querySelector("#undo-action"),
  redoAction: document.querySelector("#redo-action"),
  clearMasks: document.querySelector("#clear-masks"),
  imageTools: document.querySelector("#image-tools"),
  exportMenu: document.querySelector("#export-menu"),
  exportMenuNifti: document.querySelector("#export-menu-nifti"),
  exportMenuNifti5x: document.querySelector("#export-menu-nifti-5x"),
  exportMenuNifti10x: document.querySelector("#export-menu-nifti-10x"),
  exportMenuTiff: document.querySelector("#export-menu-tiff"),
  exportMenuStatistics: document.querySelector("#export-menu-statistics"),
  exportMenuStl: document.querySelector("#export-menu-stl"),
  exportLabels: document.querySelector("#export-labels"),
  exportOverlays: document.querySelector("#export-overlays"),
  exportProject: document.querySelector("#export-project"),
  exportTraining: document.querySelector("#export-training"),
  segonwebJobs: document.querySelector("#segonweb-jobs"),
  exportSegonweb: document.querySelector("#export-segonweb"),
  importSegonweb: document.querySelector("#import-segonweb"),
  segonwebResultInput: document.querySelector("#segonweb-result-input"),
  segonwebWorkflow: document.querySelector("#segonweb-workflow"),
  segonwebWorkflowDialog: document.querySelector("#segonweb-workflow-dialog"),
  segonwebWorkflowClose: document.querySelector("#segonweb-workflow-close"),
  segonwebWorkflowSummary: document.querySelector("#segonweb-workflow-summary"),
  segOnWeb: document.querySelector("#seg-on-web"),
  segonwebWarningDialog: document.querySelector("#segonweb-warning-dialog"),
  segonwebWarningCancel: document.querySelector("#segonweb-warning-cancel"),
  segonwebWarningContinue: document.querySelector("#segonweb-warning-continue"),
  instant3dSourceStatus: document.querySelector("#instant3d-source-status"),
  instant3dSearch: document.querySelector("#instant3d-search"),
  instant3dAvailable: document.querySelector("#instant3d-available"),
  instant3dObjectId: document.querySelector("#instant3d-object-id"),
  instant3dAdd: document.querySelector("#instant3d-add"),
  instant3dSelected: document.querySelector("#instant3d-selected"),
  instant3dFast: document.querySelector("#instant3d-fast"),
  instant3dExport: document.querySelector("#instant3d-export"),
  instant3dOpen: document.querySelector("#instant3d-open"),
  instant3dImport: document.querySelector("#instant3d-import"),
  instant3dResultInput: document.querySelector("#instant3d-result-input"),
  instant3dWarningDialog: document.querySelector("#instant3d-warning-dialog"),
  instant3dWarningCancel: document.querySelector("#instant3d-warning-cancel"),
  instant3dWarningContinue: document.querySelector("#instant3d-warning-continue"),
  instant3dConflictDialog: document.querySelector("#instant3d-conflict-dialog"),
  instant3dConflictCancel: document.querySelector("#instant3d-conflict-cancel"),
  instant3dConflictMerge: document.querySelector("#instant3d-conflict-merge"),
  instant3dConflictReplace: document.querySelector("#instant3d-conflict-replace"),
  labelsPanel: document.querySelector("#labels-panel"),
  labelsToggle: document.querySelector("#labels-toggle"),
  labelsClose: document.querySelector("#labels-close"),
  toolsToggle: document.querySelector("#tools-toggle"),
  labelList: document.querySelector("#label-list"),
  maskSummary: document.querySelector("#mask-summary"),
  projectName: document.querySelector("#project-name"),
  projectDetails: document.querySelector("#project-details"),
  projectHealth: document.querySelector("#project-health"),
  projectHealthDetail: document.querySelector("#project-health-detail"),
  currentTargetDisplay: document.querySelector("#current-target-display"),
  autosaveIndicator: document.querySelector("#autosave-indicator"),
  statusText: document.querySelector("#status-text"),
  imageMeta: document.querySelector("#image-meta"),
  localProcessingStatus: document.querySelector("#local-processing-status"),
  localProcessingDialog: document.querySelector("#local-processing-dialog"),
  localProcessingClose: document.querySelector("#local-processing-close"),
  zoomReadout: document.querySelector("#zoom-readout"),
  editingState: document.querySelector("#editing-state"),
  editingObject: document.querySelector("#editing-object"),
  editingMode: document.querySelector("#editing-mode"),
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
  labelManagerDialog: document.querySelector("#label-manager-dialog"),
  labelManagerClose: document.querySelector("#label-manager-close"),
  labelManagerSwatch: document.querySelector("#label-manager-swatch"),
  labelManagerObject: document.querySelector("#label-manager-object"),
  labelManagerName: document.querySelector("#label-manager-name"),
  labelManagerTarget: document.querySelector("#label-manager-target"),
  labelManagerRename: document.querySelector("#label-manager-rename"),
  labelManagerRelabel: document.querySelector("#label-manager-relabel"),
  labelManagerMerge: document.querySelector("#label-manager-merge"),
  labelManagerClear: document.querySelector("#label-manager-clear"),
  projectCheckDialog: document.querySelector("#project-check-dialog"),
  projectCheckClose: document.querySelector("#project-check-close"),
  projectCheckSummary: document.querySelector("#project-check-summary"),
  projectCheckResults: document.querySelector("#project-check-results"),
  segonwebJobsDialog: document.querySelector("#segonweb-jobs-dialog"),
  segonwebJobsClose: document.querySelector("#segonweb-jobs-close"),
  segonwebJobRows: document.querySelector("#segonweb-job-rows"),
  segonwebJobEmpty: document.querySelector("#segonweb-job-empty"),
  segonwebObjectId: document.querySelector("#segonweb-object-id"),
  segonwebObjectName: document.querySelector("#segonweb-object-name"),
  segonwebTrackingStart: document.querySelector("#segonweb-tracking-start"),
  segonwebTrackingEnd: document.querySelector("#segonweb-tracking-end"),
  segonwebSetStart: document.querySelector("#segonweb-set-start"),
  segonwebSetEnd: document.querySelector("#segonweb-set-end"),
  segonwebPreviousFrame: document.querySelector("#segonweb-previous-frame"),
  segonwebNextFrame: document.querySelector("#segonweb-next-frame"),
  segonwebCurrentFrame: document.querySelector("#segonweb-current-frame"),
  segonwebPromptRows: document.querySelector("#segonweb-prompt-rows"),
  segonwebPromptEmpty: document.querySelector("#segonweb-prompt-empty"),
  segonwebNewObject: document.querySelector("#segonweb-new-object"),
  segonwebSetBox: document.querySelector("#segonweb-set-box"),
  segonwebSaveObject: document.querySelector("#segonweb-save-object"),
  toolsDialog: document.querySelector("#tools-dialog"),
  toolsClose: document.querySelector("#tools-close"),
  toolsPreviousFrame: document.querySelector("#tools-previous-frame"),
  toolsNextFrame: document.querySelector("#tools-next-frame"),
  toolsCurrentFrame: document.querySelector("#tools-current-frame"),
  checkProject: document.querySelector("#check-project"),
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
  demoCalibrationGuide: document.querySelector("#demo-calibration-guide"),
  demoCalibrationTitle: document.querySelector("#demo-calibration-title"),
  demoGuideProgress: document.querySelector("#demo-guide-progress"),
  demoCalibrationInstruction: document.querySelector("#demo-calibration-instruction"),
  demoPrimaryLabel: document.querySelector("#demo-primary-label"),
  demoReferenceValue: document.querySelector("#demo-reference-value"),
  demoSecondaryLabel: document.querySelector("#demo-secondary-label"),
  demoSpacingValue: document.querySelector("#demo-spacing-value"),
  demoReferenceNote: document.querySelector("#demo-reference-note"),
  demoSpacingNote: document.querySelector("#demo-spacing-note"),
  demoNextStep: document.querySelector("#demo-next-step"),
  demoAttributionPrefix: document.querySelector("#demo-attribution-prefix"),
  demoSourceLink: document.querySelector("#demo-source-link"),
  demoLicenseLink: document.querySelector("#demo-license-link"),
  exportNifti: document.querySelector("#export-nifti"),
  exportNifti5x: document.querySelector("#export-nifti-5x"),
  exportNifti10x: document.querySelector("#export-nifti-10x"),
  exportTiff: document.querySelector("#export-tiff"),
  stlFactor: document.querySelector("#stl-factor"),
  stlScope: document.querySelector("#stl-scope"),
  previewStl: document.querySelector("#preview-stl"),
  exportStl: document.querySelector("#export-stl"),
  stlPreviewDialog: document.querySelector("#stl-preview-dialog"),
  stlPreviewClose: document.querySelector("#stl-preview-close"),
  stlPreviewReset: document.querySelector("#stl-preview-reset"),
  stlPreviewCanvas: document.querySelector("#stl-preview-canvas"),
  stlPreviewObjects: document.querySelector("#stl-preview-objects"),
  stlPreviewProgress: document.querySelector("#stl-preview-progress"),
  cleanupObject: document.querySelector("#cleanup-object"),
  cleanupOperation: document.querySelector("#cleanup-operation"),
  cleanupScope: document.querySelector("#cleanup-scope"),
  cleanupStart: document.querySelector("#cleanup-start"),
  cleanupEnd: document.querySelector("#cleanup-end"),
  cleanupMinimum: document.querySelector("#cleanup-minimum"),
  cleanupRadius: document.querySelector("#cleanup-radius"),
  cleanupIterations: document.querySelector("#cleanup-iterations"),
  applyCleanup: document.querySelector("#apply-cleanup"),
  interpolationObject: document.querySelector("#interpolation-object"),
  interpolationStart: document.querySelector("#interpolation-start"),
  interpolationEnd: document.querySelector("#interpolation-end"),
  applyInterpolation: document.querySelector("#apply-interpolation"),
  volumeStatisticsRows: document.querySelector("#volume-statistics-rows"),
  volumeStatisticsCalibration: document.querySelector("#volume-statistics-calibration"),
  exportVolumeStatistics: document.querySelector("#export-volume-statistics"),
  toast: document.querySelector("#toast"),
  spatialInformationValue: document.querySelector("#spatial-information-value"),
  spatialInformationSource: document.querySelector("#spatial-information-source"),
  manualCalibration: document.querySelector("#manual-calibration"),
  openMenu: document.querySelector("#open-menu"),
  openAppleDemo: document.querySelector("#open-apple-demo"),
  openRabbitDemo: document.querySelector("#open-rabbit-demo"),
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
  objectNames: Array.from({ length: 21 }, (_, label) => label === 0 ? "" : `Object ${label}`),
  drawMode: "click",
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
  displayDefaults: { windowCenter: 127.5, windowWidth: 255, brightness: 0, contrast: 1 },
  displayRange: { minimum: 0, maximum: 255 },
  displaySettings: { windowCenter: 127.5, windowWidth: 255, brightness: 0, contrast: 1 },
  displayVersion: 0,
  calibration: { xSpacing: 1, ySpacing: 1, zSpacing: 1, referenceLength: 10 },
  volumeOrigin: [0, 0, 0],
  volumeGeometry: null,
  volumeInfoSource: "Default spacing",
  calibrationMode: false,
  calibrationPoints: [],
  calibrationHoverPoint: null,
  rgbPickMode: false,
  segmentationJobs: [],
  segmentationDraft: null,
  segmentationBoxMode: null,
  currentOperation: "add",
  stlPreview: null,
  labelManagerLabel: 1,
  bulkUndo: [],
  bulkRedo: [],
  editSequence: 0,
  volumeStatisticsGeneration: 0,
  activeDemoDatasetId: null,
  sourceVolume: null,
  instant3dCatalog: null,
  instant3dMappings: [],
  instant3dPendingAction: null,
  instant3dPendingImport: null,
  trainingCaseId: null,
};

const context = elements.canvas.getContext("2d", { alpha: false });

function currentImage() {
  return state.index >= 0 ? state.images[state.index] : null;
}

function outputFileStem() {
  return datasetNameStem(state.projectName);
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

async function loadInstant3DCatalog() {
  try {
    const response = await fetch(new URL("../resources/totalsegmentator_roi_catalog.json", import.meta.url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = await response.json();
    if (catalog.schema_version !== "1.0" || !Array.isArray(catalog.structures)) {
      throw new Error("unsupported catalog schema");
    }
    state.instant3dCatalog = catalog;
    renderInstant3DCatalog();
    updateInstant3DControls();
  } catch (error) {
    console.error("Instant3D ROI catalog failed", error);
    elements.instant3dSourceStatus.textContent = `ROI catalog unavailable: ${error.message}`;
  }
}

function renderInstant3DCatalog() {
  if (!state.instant3dCatalog) return;
  const query = elements.instant3dSearch.value.trim().toLowerCase();
  const modality = state.sourceVolume?.modality || null;
  elements.instant3dAvailable.replaceChildren();
  const groups = (state.instant3dCatalog.groups || []).map((item) => ({ ...item, group: item.id }));
  for (const structure of [...groups, ...state.instant3dCatalog.structures]) {
    if (structure.license_required) continue;
    if (!modality || !(structure.modality || []).includes(modality)) continue;
    const haystack = [
      structure.display_name, structure.roi || "", structure.group || "", structure.category,
      ...(structure.synonyms || []),
    ]
      .join(" ").toLowerCase();
    if (query && !haystack.includes(query)) continue;
    const option = document.createElement("option");
    option.value = structure.group ? `group/${structure.group}` : `${structure.task}/${structure.roi}`;
    option.textContent = `${structure.display_name} · ${structure.category || "Other"}`;
    option.dataset.structure = JSON.stringify(structure);
    elements.instant3dAvailable.append(option);
  }
}

function nextInstant3DObjectId() {
  const used = new Set(state.instant3dMappings.map((item) => Number(item.object_id)));
  return Array.from({ length: 20 }, (_, index) => index + 1).find((value) => !used.has(value)) || 1;
}

function instant3DSelectionMembers(selection) {
  if (!selection.group) return new Set([`${selection.task}/${selection.roi}`]);
  const group = (state.instant3dCatalog.groups || []).find((item) => item.id === selection.group);
  return new Set(group.members.map((roi) => `${group.task}/${roi}`));
}

function renderInstant3DMappings() {
  elements.instant3dSelected.replaceChildren();
  if (state.instant3dMappings.length === 0) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "No structures selected.";
    elements.instant3dSelected.append(empty);
  }
  for (const mapping of state.instant3dMappings) {
    const row = document.createElement("div");
    row.className = "instant3d-selected-row";
    const object = document.createElement("strong");
    object.textContent = mapping.group ? mapping.display_name : `Obj ${mapping.object_id}`;
    const name = document.createElement("span");
    name.textContent = mapping.group ? `→ Obj ${mapping.object_id}` : mapping.display_name;
    name.title = mapping.display_name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.title = `Remove ${mapping.display_name}`;
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.instant3dMappings = state.instant3dMappings.filter(
        (item) => Number(item.object_id) !== Number(mapping.object_id),
      );
      renderInstant3DMappings();
    });
    row.append(object, name, remove);
    elements.instant3dSelected.append(row);
  }
  elements.instant3dObjectId.value = String(nextInstant3DObjectId());
  updateInstant3DControls();
}

function updateInstant3DControls() {
  const ready = state.sourceVolume?.format === "nifti" && Boolean(state.instant3dCatalog);
  elements.instant3dExport.disabled = !ready || state.instant3dMappings.length === 0;
  elements.instant3dImport.disabled = !ready;
  elements.instant3dAdd.disabled = !ready;
  elements.instant3dSourceStatus.textContent = ready
    ? `${state.sourceVolume.modality} NIfTI · ${state.sourceVolume.shape.join(" × ")} · ${state.sourceVolume.spacing.map((value) => Number(value).toPrecision(4)).join(" × ")} mm · ${state.sourceVolume.orientation}`
    : "Load a compatible CT/MRI NIfTI volume to enable Seg CT/MRI export and import.";
  renderInstant3DCatalog();
}

function addInstant3DStructure() {
  const option = elements.instant3dAvailable.selectedOptions[0];
  if (!option) return;
  const structure = JSON.parse(option.dataset.structure);
  const objectId = Number(elements.instant3dObjectId.value);
  const members = instant3DSelectionMembers(structure);
  const alreadyCovered = state.instant3dMappings.some((item) => {
    if (Number(item.object_id) !== objectId) return false;
    const existing = instant3DSelectionMembers(item);
    return [...members].every((key) => existing.has(key));
  });
  if (alreadyCovered) return;
  state.instant3dMappings = state.instant3dMappings.filter((item) => {
    if (Number(item.object_id) === objectId) return false;
    const existing = instant3DSelectionMembers(item);
    return [...members].every((key) => !existing.has(key));
  });
  const mapping = {
    object_id: objectId,
    display_name: structure.display_name,
  };
  if (structure.group) mapping.group = structure.group;
  else Object.assign(mapping, { task: structure.task, roi: structure.roi });
  state.instant3dMappings.push(mapping);
  state.instant3dMappings.sort((left, right) => left.object_id - right.object_id);
  renderInstant3DMappings();
}

async function exportInstant3DRequest() {
  try {
    setLoading(true, "Exporting Seg CT/MRI request", "Validating source geometry");
    const { entries, manifest } = await createInstant3DRequest({
      source: state.sourceVolume,
      objects: state.instant3dMappings,
      catalog: state.instant3dCatalog,
      fast: elements.instant3dFast.checked,
    });
    const filename = `${outputFileStem()}_instant3d_request.zip`;
    downloadBlob(await createZip(entries), filename);
    setStatus(`Seg CT/MRI request created: ${manifest.objects.length} anatomical ROI(s).`);
    showToast(`Downloaded ${filename}`);
  } catch (error) {
    console.error(error);
    setStatus(`Seg CT/MRI export failed: ${error.message}`);
    window.alert(`Seg CT/MRI export failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
  }
}

async function applyInstant3DImport(mode) {
  const pending = state.instant3dPendingImport;
  if (!pending) return;
  const { manifest, volume } = pending;
  const objectIds = new Set(manifest.objects.map((item) => Number(item.object_id)));
  const nextMasks = state.images.map((image, index) => {
    const next = image.mask.slice();
    const incoming = volume.frames[index];
    if (mode === "replace") {
      for (let pixel = 0; pixel < next.length; pixel += 1) {
        if (objectIds.has(next[pixel])) next[pixel] = 0;
        if (objectIds.has(incoming[pixel])) next[pixel] = incoming[pixel];
      }
    } else {
      for (let pixel = 0; pixel < next.length; pixel += 1) {
        if (next[pixel] === 0 && objectIds.has(incoming[pixel])) next[pixel] = incoming[pixel];
      }
    }
    return next;
  });
  for (const item of manifest.objects) {
    state.objectNames[Number(item.object_id)] = item.assignment_name || item.display_name;
  }
  state.instant3dMappings = collapseInstant3DObjects(manifest.objects, state.instant3dCatalog);
  setSegmentationObjectNames();
  updateLabelTargets();
  await applyMaskVolumeTransaction(nextMasks,
    `Imported Seg CT/MRI result: ${objectIds.size} object(s), ${mode} mode.`);
  enableLabelsUsedByMasks(nextMasks);
  renderInstant3DMappings();
  state.instant3dPendingImport = null;
  if (elements.instant3dConflictDialog.open) elements.instant3dConflictDialog.close();
  if (manifest.overlaps?.length) {
    window.alert("Overlapping ROI voxels were detected. The merged labelmap gives lower object IDs priority; individual binary NIfTI masks remain in the result ZIP.");
  }
}

async function importInstant3DResult(file) {
  if (!file) return;
  try {
    setLoading(true, "Importing Seg CT/MRI result", "Opening ZIP");
    const entries = await parseZip(file);
    const validated = validateInstant3DResult(entries, state.sourceVolume, state.instant3dCatalog);
    const volume = parseNiftiLabelVolume(validated.labelmap.bytes, validated.labelmap.name);
    const geometryErrors = instant3DGeometryMismatches(validated.manifest.source, volume, { includeChecksum: false });
    if (geometryErrors.length) throw new Error(`Result labelmap geometry mismatch: ${geometryErrors.join(", ")}.`);
    if (volume.width !== state.images[0].width || volume.height !== state.images[0].height || volume.depth !== state.images.length) {
      throw new Error("Result labelmap dimensions do not match the editable image sequence.");
    }
    state.instant3dPendingImport = { manifest: validated.manifest, volume };
    const objectIds = new Set(validated.manifest.objects.map((item) => Number(item.object_id)));
    const conflicts = state.images.some((image) => image.mask.some((value) => objectIds.has(value)));
    if (conflicts) elements.instant3dConflictDialog.showModal();
    else await applyInstant3DImport("replace");
  } catch (error) {
    console.error(error);
    state.instant3dPendingImport = null;
    setStatus(`Seg CT/MRI import failed: ${error.message}`);
    window.alert(`Seg CT/MRI import failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
    elements.instant3dResultInput.value = "";
  }
}

function objectDisplayName(label) {
  const name = state.objectNames[label];
  return name && name !== `Object ${label}` ? `Obj ${label} · ${name}` : `Obj ${label}`;
}

function updateEditingState() {
  const enabled = Boolean(currentImage());
  elements.editingState.hidden = !enabled;
  if (!enabled) return;
  elements.editingObject.textContent = objectDisplayName(state.targetLabel);
  const operation = state.autoApplyMode === "off"
    ? state.currentOperation.toUpperCase()
    : `AUTO ${state.autoApplyMode.toUpperCase()}`;
  elements.editingMode.textContent = `${state.drawMode.toUpperCase()} · ${operation}`;
  elements.editingState.classList.toggle("automatic", state.autoApplyMode !== "off");
}

function updateSegonwebWorkflowSummary() {
  const objectCount = state.segmentationJobs.length;
  const promptCount = state.segmentationJobs.reduce(
    (sum, job) => sum + Math.max(1, job.prompts?.length || (job.box ? 1 : 0)),
    0,
  );
  elements.segonwebWorkflowSummary.textContent = objectCount
    ? `${objectCount} object${objectCount === 1 ? "" : "s"} · ${promptCount} prompt${promptCount === 1 ? "" : "s"} configured`
    : "No AI tracking setup yet.";
}

function initializeLabels() {
  for (let label = 1; label <= 20; label += 1) {
    const targetOption = new Option(`Obj ${label}`, String(label));
    const transferOption = new Option(`Obj ${label}`, String(label));
    const jobOption = new Option(`Obj ${label}`, String(label));
    const cleanupOption = new Option(`Obj ${label}`, String(label));
    const interpolationOption = new Option(`Obj ${label}`, String(label));
    const managerOption = new Option(`Obj ${label}`, String(label));
    elements.targetLabel.add(targetOption);
    elements.transferLabel.add(transferOption);
    elements.segonwebObjectId.add(jobOption);
    elements.cleanupObject.add(cleanupOption);
    elements.interpolationObject.add(interpolationOption);
    elements.labelManagerTarget.add(managerOption);

    const item = document.createElement("div");
    item.className = `label-item${label === 1 ? " target" : ""}`;
    item.dataset.label = String(label);
    item.innerHTML = `
      <input type="checkbox" aria-label="Show object ${label}" ${label === 1 ? "checked" : ""} />
      <span class="label-swatch" style="background:${LABEL_COLORS[label]}"></span>
      <span class="label-copy"><strong>Obj ${label}</strong><span>0 px</span></span>
      <button class="label-menu-button" type="button" title="Manage object ${label}" aria-label="Manage object ${label}">
        <svg><use href="#i-more"></use></svg>
      </button>
    `;
    const checkbox = item.querySelector("input");
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      state.visibleLabels[label] = checkbox.checked;
      for (const image of state.images) image.overlayDirty = true;
      render();
    });
    item.querySelector(".label-menu-button").addEventListener("click", (event) => {
      event.stopPropagation();
      openLabelManager(label);
    });
    item.addEventListener("click", () => selectTargetLabel(label));
    elements.labelList.append(item);
  }
  elements.targetLabel.value = "1";
  elements.transferLabel.value = "2";
  elements.segonwebObjectId.value = "1";
  elements.cleanupObject.value = "1";
  elements.interpolationObject.value = "1";
  elements.labelManagerTarget.value = "2";
}

function selectTargetLabel(label) {
  state.targetLabel = label;
  elements.targetLabel.value = String(label);
  elements.cleanupObject.value = String(label);
  elements.interpolationObject.value = String(label);
  elements.segonwebObjectId.value = String(label);
  if (elements.currentTargetDisplay) elements.currentTargetDisplay.textContent = objectDisplayName(label);
  state.visibleLabels[label] = true;
  const item = elements.labelList.querySelector(`[data-label="${label}"]`);
  if (item) item.querySelector("input").checked = true;
  for (const image of state.images) image.overlayDirty = true;
  updateLabelTargets();
  updateEditingState();
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
    elements.exportTraining,
    elements.exportNifti,
    elements.exportNifti5x,
    elements.exportNifti10x,
    elements.exportTiff,
    elements.exportMenuNifti,
    elements.exportMenuNifti5x,
    elements.exportMenuNifti10x,
    elements.exportMenuTiff,
    elements.exportMenuStatistics,
    elements.exportMenuStl,
    elements.previewStl,
    elements.segonwebJobs,
    elements.exportSegonweb,
    ...elements.modeButtons,
  ];
  for (const control of controls) control.disabled = !enabled;
  for (const control of elements.labelList.querySelectorAll(".label-menu-button")) {
    control.disabled = !enabled;
  }
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const image = currentImage();
  const enabled = Boolean(image);
  elements.undoLine.disabled = !enabled || (image.paths.length === 0 && image.activePath.length === 0);
  elements.redoLine.disabled = !enabled || image.pathRedo.length === 0;
  elements.clearLines.disabled = !enabled || (image.paths.length === 0 && image.activePath.length === 0);
  elements.undoEdit.disabled = !enabled || (image.undo.length === 0 && state.bulkUndo.length === 0);
  elements.redoEdit.disabled = !enabled || (image.redo.length === 0 && state.bulkRedo.length === 0);
  const lineUndoSequence = image?.activePath.length > 0
    ? Number.POSITIVE_INFINITY
    : image?.paths.at(-1)?.sequence ?? -1;
  const editUndoSequence = Math.max(
    image?.undo.at(-1)?.sequence ?? -1,
    state.bulkUndo.at(-1)?.sequence ?? -1,
  );
  const lineRedoSequence = image?.pathRedo.at(-1)?.sequence ?? -1;
  const editRedoSequence = Math.max(
    image?.redo.at(-1)?.sequence ?? -1,
    state.bulkRedo.at(-1)?.sequence ?? -1,
  );
  elements.undoAction.disabled = !enabled || Math.max(lineUndoSequence, editUndoSequence) < 0;
  elements.redoAction.disabled = !enabled || Math.max(lineRedoSequence, editRedoSequence) < 0;
  elements.previousImage.disabled = !enabled || state.index <= 0;
  elements.nextImage.disabled = !enabled || state.index >= state.images.length - 1;
}

function updateImageUi() {
  const image = currentImage();
  elements.emptyState.hidden = Boolean(image);
  elements.zoomReadout.hidden = !image;
  elements.imageCounter.textContent = image ? `${state.index + 1} / ${state.images.length}` : "0 / 0";
  elements.sliceNumber.disabled = !image;
  elements.sliceSlider.disabled = !image;
  elements.sliceNumber.max = String(Math.max(1, state.images.length));
  elements.sliceSlider.max = String(Math.max(1, state.images.length));
  elements.sliceNumber.value = String(image ? state.index + 1 : 1);
  elements.sliceSlider.value = String(image ? state.index + 1 : 1);
  elements.projectName.textContent = state.projectName;
  elements.imageMeta.textContent = image
    ? `${image.name} · ${image.width} × ${image.height}px${
        image.sourceFormat === "dicom" ? " · DICOM" : image.sourceFormat === "nifti" ? " · NIfTI" : image.sourceFormat === "tiff" ? " · TIFF" : ""
      }`
    : "No image loaded";
  elements.projectDetails.textContent = image
    ? `${state.images.length} slices · ${image.width} × ${image.height} · ${Number(state.calibration.xSpacing).toPrecision(4)} × ${Number(state.calibration.ySpacing).toPrecision(4)} × ${Number(state.calibration.zSpacing).toPrecision(4)} mm`
    : "Open images or a volume to begin";
  elements.projectHealth.disabled = !image;
  if (image) {
    setStatus(`Editing ${image.name}. Wheel: images · Ctrl+wheel: zoom · middle drag: pan.`);
  }
  updateLabelCounts();
  updateHistoryButtons();
  syncSegmentationCurrentFrame();
  syncToolsCurrentFrame();
  updateEditingState();
  updateSegonwebWorkflowSummary();
  syncSpatialInformation();
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

function displayDiagnosticStatistics(length, valueAt) {
  const values = new Float64Array(length);
  for (let index = 0; index < length; index += 1) values[index] = valueAt(index);
  values.sort();
  const percentile = (percentage) => {
    const position = (values.length - 1) * percentage / 100;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const weight = position - lower;
    return values[lower] * (1 - weight) + values[upper] * weight;
  };
  return {
    min: values[0],
    max: values.at(-1),
    p0_5: percentile(0.5),
    p1: percentile(1),
    p50: percentile(50),
    p99: percentile(99),
    p99_5: percentile(99.5),
  };
}

function logDicomDisplayDiagnostics(image, output) {
  if (!DEBUG_DICOM_DISPLAY || !image.modalityPixels || !image.dicom) return;
  const slope = Number(image.dicom.rescaleSlope) || 1;
  const intercept = Number(image.dicom.rescaleIntercept) || 0;
  const modality = displayDiagnosticStatistics(
    image.modalityPixels.length,
    (index) => image.modalityPixels[index],
  );
  const raw = displayDiagnosticStatistics(
    image.modalityPixels.length,
    (index) => (image.modalityPixels[index] - intercept) / slope,
  );
  const display = displayDiagnosticStatistics(
    image.modalityPixels.length,
    (index) => output[index * 4],
  );
  console.debug("[SegRef3D Lite] DICOM display diagnostics", {
    slice: state.index + 1,
    sourceFilename: image.dicom.sourceFilename,
    raw,
    pixelRepresentation: image.dicom.pixelRepresentation === 1 ? "signed" : "unsigned",
    bitsAllocated: image.dicom.bitsAllocated,
    bitsStored: image.dicom.bitsStored,
    highBit: image.dicom.highBit,
    rescaleSlope: slope,
    rescaleIntercept: intercept,
    modality,
    dicomWindowCenter: image.dicom.windowCenters,
    dicomWindowWidth: image.dicom.windowWidths,
    activeWindowCenter: state.displaySettings.windowCenter,
    activeWindowWidth: state.displaySettings.windowWidth,
    photometricInterpretation: image.dicom.photometricInterpretation,
    pixelPaddingValue: image.dicom.pixelPaddingValue,
    pixelPaddingRangeLimit: image.dicom.pixelPaddingRangeLimit,
    display,
  });
}

function ensureDisplayImage(image) {
  const modalityReady =
    image.modalityPixels instanceof Float32Array &&
    image.modalityPixels.length === image.width * image.height;
  if ((!modalityReady && !image.basePixels) || image.displayVersion === state.displayVersion) return;
  const output = modalityReady
    ? modalityToRgba(image.modalityPixels, {
        ...state.displaySettings,
        photometricInterpretation: image.dicom?.photometricInterpretation,
      })
    : adjustedRgba(image.basePixels, state.displaySettings);
  const outputContext = image.sourceCanvas.getContext("2d");
  const imageData = outputContext.createImageData(image.width, image.height);
  imageData.data.set(output);
  outputContext.putImageData(imageData, 0, 0);
  image.sourcePixels = null;
  image.displayVersion = state.displayVersion;
  if (modalityReady) logDicomDisplayDiagnostics(image, output);
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
  const promptJobs = state.segmentationJobs.map((job) =>
    state.segmentationDraft?.id === job.id ? state.segmentationDraft : job,
  );
  if (state.segmentationDraft && !promptJobs.some((job) => job.id === state.segmentationDraft.id)) {
    promptJobs.push(state.segmentationDraft);
  }
  const promptBoxes = promptJobs.flatMap((job) =>
    normalizedJobPrompts(job)
      .filter((prompt) => prompt.frame === state.index)
      .map((prompt) => ({ id: job.id, box: prompt.box, draft: job === state.segmentationDraft })),
  );
  for (const prompt of promptBoxes) {
    const [x1, y1, x2, y2] = prompt.box;
    context.strokeStyle = prompt.draft ? "#d9544b" : LABEL_COLORS[prompt.id] || "#d9544b";
    context.lineWidth = 2 / state.viewport.zoom;
    context.setLineDash(prompt.draft ? [7 / state.viewport.zoom, 5 / state.viewport.zoom] : []);
    context.strokeRect(x1, y1, x2 - x1, y2 - y1);
    context.setLineDash([]);
    context.fillStyle = context.strokeStyle;
    context.font = `${Math.max(10 / state.viewport.zoom, 12 / state.viewport.zoom)}px sans-serif`;
    context.fillText(`Obj ${prompt.id}`, x1 + 3 / state.viewport.zoom, Math.max(12 / state.viewport.zoom, y1 - 4 / state.viewport.zoom));
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
      sequence: ++state.editSequence,
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
      const zIndex = state.images.indexOf(image);
      await saveMask(state.projectId, image.name, image.width, image.height, snapshot, {
        zIndex,
        sliceOrder: MASK_SLICE_ORDER,
      });
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
  image.undo.push({ mask: before, sequence: ++state.editSequence });
  if (image.undo.length > 20) image.undo.shift();
  image.redo.length = 0;
  state.bulkRedo.length = 0;
  image.overlayDirty = true;
}

async function applyMaskVolumeTransaction(nextMasks, message) {
  const changes = buildMaskVolumeChanges(state.images.map((image) => image.mask), nextMasks);
  for (const change of changes) {
    const image = state.images[change.index];
    image.mask = change.after.slice();
    image.overlayDirty = true;
    clearImagePaths(image);
    image.redo.length = 0;
  }
  if (changes.length === 0) {
    setStatus(`${message}: no mask pixels changed.`);
    return 0;
  }
  state.bulkUndo.push({ sequence: ++state.editSequence, changes, message });
  if (state.bulkUndo.length > 20) state.bulkUndo.shift();
  state.bulkRedo.length = 0;
  for (const change of changes) await autosave(state.images[change.index], `${message} autosaved`);
  updateLabelCounts();
  updateHistoryButtons();
  render();
  setStatus(`${message}: ${changes.length} frame(s) changed.`);
  return changes.length;
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

async function undoEdit() {
  const image = currentImage();
  if (!image) return;
  const local = image.undo.at(-1);
  const bulk = state.bulkUndo.at(-1);
  const localSequence = local?.sequence ?? -1;
  const bulkSequence = bulk?.sequence ?? -1;
  if (bulkSequence > localSequence) {
    const transaction = state.bulkUndo.pop();
    const restored = applyMaskVolumeChanges(state.images.map((item) => item.mask), transaction.changes, "before");
    for (const change of transaction.changes) {
      const target = state.images[change.index];
      target.mask = restored[change.index];
      target.overlayDirty = true;
      await autosave(target);
    }
    state.bulkRedo.push(transaction);
    setStatus(`Undid: ${transaction.message}.`);
  } else if (local) {
    image.redo.push({ mask: image.mask.slice(), sequence: local.sequence });
    image.mask = image.undo.pop().mask;
    image.overlayDirty = true;
    await autosave(image);
    setStatus("Undid the last mask edit.");
  } else {
    return;
  }
  updateLabelCounts();
  updateHistoryButtons();
  render();
}

function latestMaskUndoSequence(image) {
  return Math.max(
    image?.undo.at(-1)?.sequence ?? -1,
    state.bulkUndo.at(-1)?.sequence ?? -1,
  );
}

function latestMaskRedoSequence(image) {
  return Math.max(
    image?.redo.at(-1)?.sequence ?? -1,
    state.bulkRedo.at(-1)?.sequence ?? -1,
  );
}

function smartUndo() {
  const image = currentImage();
  if (!image) return;
  if (image.activePath.length > 0) {
    finalizeActivePath();
    undoLine();
    return;
  }
  const lineSequence = image.paths.at(-1)?.sequence ?? -1;
  if (lineSequence > latestMaskUndoSequence(image)) undoLine();
  else void undoEdit();
}

function smartRedo() {
  const image = currentImage();
  if (!image) return;
  const lineSequence = image.pathRedo.at(-1)?.sequence ?? -1;
  if (lineSequence > latestMaskRedoSequence(image)) redoLine();
  else void redoEdit();
}

async function redoEdit() {
  const image = currentImage();
  if (!image) return;
  const local = image.redo.at(-1);
  const bulk = state.bulkRedo.at(-1);
  const localSequence = local?.sequence ?? -1;
  const bulkSequence = bulk?.sequence ?? -1;
  if (bulkSequence > localSequence) {
    const transaction = state.bulkRedo.pop();
    const restored = applyMaskVolumeChanges(state.images.map((item) => item.mask), transaction.changes, "after");
    for (const change of transaction.changes) {
      const target = state.images[change.index];
      target.mask = restored[change.index];
      target.overlayDirty = true;
      await autosave(target);
    }
    state.bulkUndo.push(transaction);
    setStatus(`Redid: ${transaction.message}.`);
  } else if (local) {
    image.undo.push({ mask: image.mask.slice(), sequence: local.sequence });
    image.mask = image.redo.pop().mask;
    image.overlayDirty = true;
    await autosave(image);
    setStatus("Redid the last mask edit.");
  } else {
    return;
  }
  updateLabelCounts();
  updateHistoryButtons();
  render();
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
  }
  updateImageUi();
  render();
}

function jumpToSlice(sliceNumber) {
  if (state.images.length === 0) return;
  const requested = Number.isFinite(sliceNumber) ? Math.round(sliceNumber) : state.index + 1;
  const targetIndex = clamp(requested - 1, 0, state.images.length - 1);
  switchImage(targetIndex - state.index);
  elements.sliceNumber.value = String(state.index + 1);
  elements.sliceSlider.value = String(state.index + 1);
}

function setDrawMode(mode) {
  finalizeActivePath();
  state.drawMode = mode;
  for (const button of elements.modeButtons) {
    button.classList.toggle("selected", button.dataset.mode === mode);
  }
  updateEditingState();
  const label = `${mode[0].toUpperCase()}${mode.slice(1)}`;
  setStatus(
    mode === "free"
      ? `${label} drawing mode.`
      : `${label} drawing mode. Left-click points, then right-click the final point to close.`,
  );
}

function setAutoApplyMode(mode, { announce = true } = {}) {
  state.autoApplyMode = ["add", "erase", "transfer"].includes(mode) ? mode : "off";
  elements.autoApplyMode.value = state.autoApplyMode;
  updateEditingState();
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
  closeToolsDockOnNarrow();
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
  closeToolsDockOnNarrow();
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
  closeToolsDockOnNarrow();
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

function syncDisplayControlRanges() {
  const range = displayControlRange(state.displayRange, state.displayDefaults);
  elements.windowCenter.min = String(range.centerMinimum);
  elements.windowCenter.max = String(range.centerMaximum);
  elements.windowCenter.step = String(range.centerStep);
  elements.windowWidth.min = "1";
  elements.windowWidth.max = String(range.widthMaximum);
  elements.windowWidth.step = String(range.widthStep);
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
  state.displaySettings = { ...state.displayDefaults };
  state.displayVersion += 1;
  syncDisplayControlRanges();
  syncDisplayControls();
  render();
  if (announce) setStatus("Display settings reset.");
}

function activeDemoDataset() {
  return demoDatasetById(state.activeDemoDatasetId);
}

function syncDemoCalibrationGuide() {
  const dataset = activeDemoDataset();
  elements.demoCalibrationGuide.hidden = !dataset;
  if (!dataset) return;
  const guide = dataset.guide;
  const targetPanel = elements.toolPanels.find(
    (panel) => panel.dataset.toolPanel === guide.toolTab,
  );
  if (targetPanel && elements.demoCalibrationGuide.parentElement !== targetPanel) {
    targetPanel.prepend(elements.demoCalibrationGuide);
  }
  elements.demoCalibrationTitle.textContent = guide.title;
  if (elements.demoGuideProgress) elements.demoGuideProgress.textContent = "Step 2 of 5";
  elements.demoCalibrationInstruction.textContent = guide.instruction;
  elements.demoPrimaryLabel.textContent = guide.primaryLabel;
  elements.demoReferenceValue.textContent = guide.primaryValue;
  elements.demoSecondaryLabel.textContent = guide.secondaryLabel;
  elements.demoSpacingValue.textContent = guide.secondaryValue;
  elements.demoReferenceNote.textContent = guide.note;
  elements.demoSpacingNote.textContent = guide.detail;
  elements.demoNextStep.textContent = guide.nextStep;
  elements.demoNextStep.hidden =
    guide.revealNextStepAfterCalibration && state.volumeInfoSource !== "Reference line calibration";
  elements.demoAttributionPrefix.textContent = dataset.attribution.uiPrefix;
  elements.demoSourceLink.href = dataset.attribution.doiUrl;
  elements.demoSourceLink.textContent = "the cited Zenodo dataset";
  elements.demoLicenseLink.href = dataset.attribution.licenseUrl;
  elements.demoLicenseLink.textContent = dataset.attribution.licenseName;
}

function syncCalibrationControls() {
  elements.spacingX.value = String(state.calibration.xSpacing);
  elements.spacingY.value = String(state.calibration.ySpacing);
  elements.spacingZ.value = String(state.calibration.zSpacing);
  elements.referenceLength.value = String(state.calibration.referenceLength);
  syncDemoCalibrationGuide();
  syncSpatialInformation();
}

function syncSpatialInformation() {
  if (!elements.spatialInformationValue) return;
  const values = [
    state.calibration.xSpacing,
    state.calibration.ySpacing,
    state.calibration.zSpacing,
  ].map((value) => Number(value).toPrecision(4));
  elements.spatialInformationValue.textContent = `${values.join(" × ")} mm`;
  elements.spatialInformationSource.textContent = state.volumeInfoSource;
  if (elements.manualCalibration && activeDemoDataset()?.id === "apple-kanzi-84") {
    elements.manualCalibration.open = true;
  }
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
  const sourceSpacing = state.volumeGeometry?.spacing || [
    image?.pixelSpacing?.[0],
    image?.pixelSpacing?.[1],
    image?.sliceSpacing,
  ];
  const xSpacing = Number(sourceSpacing[0]);
  const ySpacing = Number(sourceSpacing[1]);
  const zSpacing = Number(sourceSpacing[2]);
  state.calibration = {
    xSpacing: Number.isFinite(xSpacing) && xSpacing > 0 ? xSpacing : 1,
    ySpacing: Number.isFinite(ySpacing) && ySpacing > 0 ? ySpacing : 1,
    zSpacing: Number.isFinite(zSpacing) && zSpacing > 0 ? zSpacing : 1,
    referenceLength: 10,
  };
  const sourceOrigin = state.volumeGeometry?.origin || image?.volumeOrigin;
  state.volumeOrigin = [0, 1, 2].map((index) => {
    const value = Number(sourceOrigin?.[index]);
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
  const spacing = [
    state.calibration.xSpacing,
    state.calibration.ySpacing,
    state.calibration.zSpacing,
  ];
  const geometry = state.volumeGeometry
    ? geometryWithSpacing(state.volumeGeometry, spacing)
    : makeVolumeGeometry({
        shape: [width, height, state.images.length],
        affine: axisAlignedAffine(spacing, state.volumeOrigin.slice(0, 3)),
        sourceKind: "axis-aligned-fallback",
      });
  return {
    width,
    height,
    depth: state.images.length,
    spacing: geometry.spacing,
    origin: geometry.origin,
    affine: geometry.affine,
    sourceKind: geometry.sourceKind,
    geometry,
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
    const filename = `${outputFileStem()}_volinf.csv`;
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
    state.volumeGeometry = makeVolumeGeometry({
      shape: [current.width, current.height, current.depth],
      affine: imported.affine || axisAlignedAffine(imported.spacing, imported.origin),
      sourceKind: imported.affine ? "volinfo-affine" : "volinfo-legacy-fallback",
      warnings: imported.affine ? [] : ["Legacy VolInfo CSV has no affine."],
    });
    state.calibration = {
      ...state.calibration,
      xSpacing: state.volumeGeometry.spacing[0],
      ySpacing: state.volumeGeometry.spacing[1],
      zSpacing: state.volumeGeometry.spacing[2],
    };
    state.volumeOrigin = [...state.volumeGeometry.origin];
    state.volumeInfoSource = file.name;
    syncCalibrationControls();
    syncVolInfoSummary();
    setStatus(
      `VolInfo loaded: spacing ${state.volumeGeometry.spacing.map((value) => value.toPrecision(6)).join(" × ")} mm.`,
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
  if (name === "volume") void renderVolumeStatistics();
  else state.volumeStatisticsGeneration += 1;
  if (name === "cleanup") syncCleanupControls();
}

function openToolsDock(name = "draw") {
  selectToolTab(name);
  elements.toolsDialog.classList.add("open");
}

function closeToolsDockOnNarrow() {
  if (window.matchMedia("(max-width: 900px)").matches) {
    elements.toolsDialog.classList.remove("open");
  }
}

function openImageTools(name = "display") {
  if (!currentImage() || state.loading) return;
  selectToolTab(name);
  syncDisplayControls();
  syncCalibrationControls();
  syncVolInfoSummary();
  syncToolsCurrentFrame();
  openToolsDock(name);
}

function syncToolsCurrentFrame() {
  if (!elements.toolsCurrentFrame) return;
  const current = state.images.length > 0 ? state.index + 1 : 0;
  elements.toolsCurrentFrame.textContent = `${current} / ${state.images.length}`;
  elements.toolsPreviousFrame.disabled = state.images.length === 0 || state.index === 0;
  elements.toolsNextFrame.disabled = state.images.length === 0 || state.index === state.images.length - 1;
}

function statisticsForCurrentVolume() {
  if (state.images.length === 0) throw new Error("No images are loaded.");
  const width = state.images[0].width;
  const height = state.images[0].height;
  if (state.images.some((image) => image.width !== width || image.height !== height)) {
    throw new Error("Volume statistics require equal frame dimensions.");
  }
  const spacing = state.volumeInfoSource === "Default spacing"
    ? null
    : [state.calibration.xSpacing, state.calibration.ySpacing, state.calibration.zSpacing];
  return volumeStatistics(state.images.map((image) => image.mask), width, height, spacing, state.objectNames);
}

function renderVolumeStatisticsRows(statistics) {
  elements.volumeStatisticsRows.replaceChildren();
  elements.volumeStatisticsCalibration.textContent = statistics.calibrated
    ? `Spacing ${statistics.spacing.map((value) => Number(value).toPrecision(4)).join(" × ")} mm`
    : "Volume calibration required";
  for (const row of statistics.rows) {
    const tableRow = document.createElement("tr");
    const values = [
      `Obj ${row.objectId}: ${row.objectName}`,
      row.voxelCount.toLocaleString(),
      row.volumeMm3 === null ? "—" : row.volumeMm3.toLocaleString(undefined, { maximumFractionDigits: 4 }),
      row.volumeCm3 === null ? "—" : row.volumeCm3.toLocaleString(undefined, { maximumFractionDigits: 6 }),
      `${row.firstFrame}-${row.lastFrame}`,
      row.occupiedSlices,
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      tableRow.append(cell);
    }
    elements.volumeStatisticsRows.append(tableRow);
  }
  if (statistics.rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No labeled voxels.";
    row.append(cell);
    elements.volumeStatisticsRows.append(row);
  }
}

async function renderVolumeStatistics() {
  const generation = ++state.volumeStatisticsGeneration;
  elements.volumeStatisticsRows.replaceChildren();
  if (state.images.length === 0) return;
  const progressRow = document.createElement("tr");
  const progressCell = document.createElement("td");
  progressCell.colSpan = 6;
  progressCell.textContent = `Calculating volume statistics… 0 / ${state.images.length}`;
  progressRow.append(progressCell);
  elements.volumeStatisticsRows.append(progressRow);
  elements.volumeStatisticsCalibration.textContent = "Calculating…";
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    const width = state.images[0].width;
    const height = state.images[0].height;
    if (state.images.some((image) => image.width !== width || image.height !== height)) {
      throw new Error("Volume statistics require equal frame dimensions.");
    }
    const spacing = state.volumeInfoSource === "Default spacing"
      ? null
      : [state.calibration.xSpacing, state.calibration.ySpacing, state.calibration.zSpacing];
    const statistics = await volumeStatisticsAsync(
      state.images.map((image) => image.mask),
      width,
      height,
      spacing,
      state.objectNames,
      {
        isCanceled: () => generation !== state.volumeStatisticsGeneration,
        onProgress: (completed, total) => {
          if (generation !== state.volumeStatisticsGeneration) return;
          if (completed === total || completed === 1 || completed % 5 === 0) {
            progressCell.textContent = `Calculating volume statistics… ${completed} / ${total}`;
          }
        },
      },
    );
    if (!statistics || generation !== state.volumeStatisticsGeneration) return;
    renderVolumeStatisticsRows(statistics);
  } catch (error) {
    if (generation !== state.volumeStatisticsGeneration) return;
    elements.volumeStatisticsRows.replaceChildren();
    elements.volumeStatisticsCalibration.textContent = error.message;
  }
}

function exportVolumeStatisticsCsv() {
  try {
    const statistics = statisticsForCurrentVolume();
    const filename = `${outputFileStem()}_Volume_Statistics_${timestamp()}.csv`;
    downloadBlob(new Blob([createVolumeStatisticsCsv(statistics)], { type: "text/csv;charset=utf-8" }), filename);
    setStatus(`Exported volume statistics for ${statistics.rows.length} object(s).`);
    showToast(`Downloaded ${filename}`);
  } catch (error) {
    setStatus(`Volume statistics export failed: ${error.message}`);
    window.alert(`Volume statistics export failed.\n\n${error.message}`);
  }
}

function openLabelManager(label) {
  state.labelManagerLabel = Number(label);
  elements.labelManagerObject.textContent = objectDisplayName(label);
  elements.labelManagerSwatch.style.background = LABEL_COLORS[label];
  elements.labelManagerName.value = state.objectNames[label] || `Object ${label}`;
  const fallback = label === 20 ? 19 : label + 1;
  if (Number(elements.labelManagerTarget.value) === label) elements.labelManagerTarget.value = String(fallback);
  if (!elements.labelManagerDialog.open) elements.labelManagerDialog.showModal();
}

function renameManagedObject() {
  const label = state.labelManagerLabel;
  const name = elements.labelManagerName.value.trim();
  if (!name) {
    setStatus("Object name cannot be empty.");
    return;
  }
  state.objectNames[label] = name.slice(0, 80);
  const job = segmentationJobById(label);
  if (job) job.name = state.objectNames[label];
  if (state.segmentationDraft?.id === label) state.segmentationDraft.name = state.objectNames[label];
  setSegmentationObjectNames();
  elements.labelManagerObject.textContent = objectDisplayName(label);
  setStatus(`Renamed Obj ${label} to ${state.objectNames[label]}.`);
}

async function relabelOrMergeManagedObject(mode) {
  const source = state.labelManagerLabel;
  const target = Number(elements.labelManagerTarget.value);
  if (source === target) {
    setStatus("Choose a different destination object.");
    return;
  }
  if (mode === "merge" && !window.confirm(`Merge Obj ${source} into Obj ${target} on all frames?`)) return;
  try {
    const masks = state.images.map((image) => image.mask);
    const next = mode === "merge"
      ? mergeLabelVolume(masks, source, target)
      : relabelVolume(masks, source, target);
    await applyMaskVolumeTransaction(next, `${mode === "merge" ? "Merged" : "Relabeled"} Obj ${source} to Obj ${target}`);
    const sourceName = state.objectNames[source];
    if (mode === "relabel" || state.objectNames[target] === `Object ${target}`) state.objectNames[target] = sourceName;
    state.objectNames[source] = `Object ${source}`;
    const sourceJob = segmentationJobById(source);
    const targetJob = segmentationJobById(target);
    if (sourceJob && !targetJob) {
      sourceJob.id = target;
      sourceJob.name = state.objectNames[target];
    } else if (sourceJob) {
      state.segmentationJobs = state.segmentationJobs.filter((job) => job !== sourceJob);
    }
    state.segmentationJobs.sort((left, right) => left.id - right.id);
    selectTargetLabel(target);
    setSegmentationObjectNames();
    elements.labelManagerDialog.close();
  } catch (error) {
    setStatus(`${mode === "merge" ? "Merge" : "Relabel"} failed: ${error.message}`);
    window.alert(error.message);
  }
}

async function clearManagedObject() {
  const label = state.labelManagerLabel;
  if (!window.confirm(`Clear Obj ${label} from all frames?\n\nOther objects will not be changed.`)) return;
  await applyMaskVolumeTransaction(
    clearLabelVolume(state.images.map((image) => image.mask), label),
    `Cleared Obj ${label}`,
  );
  elements.labelManagerDialog.close();
}

function runProjectCheck() {
  const spacing = state.volumeInfoSource === "Default spacing"
    ? null
    : [state.calibration.xSpacing, state.calibration.ySpacing, state.calibration.zSpacing];
  const findings = checkProject({
    images: state.images,
    spacing,
    objectNames: state.objectNames,
    segmentationJobs: state.segmentationJobs,
  });
  elements.projectCheckResults.replaceChildren();
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  elements.projectCheckSummary.textContent = errors
    ? `${errors} error(s) · ${warnings} warning(s)`
    : warnings
      ? `No errors · ${warnings} warning(s)`
      : "Project check passed.";
  elements.projectCheckSummary.className = `workflow-summary ${errors ? "error" : warnings ? "warning" : "success"}`;
  const healthLabel = elements.projectHealth.querySelector("span");
  const healthText = errors
    ? `${errors} issue${errors === 1 ? "" : "s"}`
    : warnings
      ? `${warnings} warning${warnings === 1 ? "" : "s"}`
      : "Project Check ✓";
  if (healthLabel) healthLabel.textContent = healthText;
  elements.projectHealth.className = `header-health-indicator ${errors ? "error" : warnings ? "warning" : "success"}`;
  elements.projectHealthDetail.textContent = elements.projectCheckSummary.textContent;
  for (const finding of findings) {
    const item = document.createElement("div");
    item.className = `project-check-item ${finding.severity}`;
    const marker = finding.severity === "ok" ? "✓" : finding.severity === "error" ? "×" : finding.severity === "warning" ? "!" : "i";
    item.innerHTML = `<span>${marker}</span><p></p>`;
    item.querySelector("p").textContent = finding.message;
    elements.projectCheckResults.append(item);
  }
  closeToolsDockOnNarrow();
  if (!elements.projectCheckDialog.open) elements.projectCheckDialog.showModal();
}

function syncCleanupControls() {
  const frameCount = Math.max(1, state.images.length);
  for (const input of [elements.cleanupStart, elements.cleanupEnd, elements.interpolationStart, elements.interpolationEnd]) {
    input.max = String(frameCount);
  }
  elements.cleanupStart.value = String(Math.min(Number(elements.cleanupStart.value) || 1, frameCount));
  elements.cleanupEnd.value = String(Math.min(Number(elements.cleanupEnd.value) || frameCount, frameCount));
  elements.interpolationStart.value = String(Math.min(Number(elements.interpolationStart.value) || 1, frameCount));
  elements.interpolationEnd.value = String(Math.min(Math.max(2, Number(elements.interpolationEnd.value) || frameCount), frameCount));
}

function cleanupFrameIndices() {
  const scope = elements.cleanupScope.value;
  const start = Number(elements.cleanupStart.value) - 1;
  const end = Number(elements.cleanupEnd.value) - 1;
  return frameIndicesForScope(scope, state.index, start, end, state.images.length);
}

async function applyMaskCleanup() {
  if (state.loading) return;
  try {
    const label = Number(elements.cleanupObject.value);
    const indices = cleanupFrameIndices();
    const next = state.images.map((image) => image.mask.slice());
    closeToolsDockOnNarrow();
    setLoading(true, "Applying mask cleanup", `0 / ${indices.length}`);
    for (let position = 0; position < indices.length; position += 1) {
      const index = indices[position];
      const image = state.images[index];
      elements.loadingDetail.textContent = `${position + 1} / ${indices.length}`;
      next[index] = cleanupLabelMask(image.mask, image.width, image.height, label, elements.cleanupOperation.value, {
        minimumSize: elements.cleanupMinimum.value,
        radius: elements.cleanupRadius.value,
        iterations: elements.cleanupIterations.value,
        amount: elements.cleanupIterations.value,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await applyMaskVolumeTransaction(next, `${elements.cleanupOperation.selectedOptions[0].text} · Obj ${label}`);
  } catch (error) {
    setStatus(`Mask cleanup failed: ${error.message}`);
    window.alert(`Mask cleanup failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
  }
}

async function applySliceInterpolation() {
  if (state.loading) return;
  try {
    const label = Number(elements.interpolationObject.value);
    const start = Number(elements.interpolationStart.value) - 1;
    const end = Number(elements.interpolationEnd.value) - 1;
    if (!(Number.isInteger(start) && Number.isInteger(end) && 0 <= start && start + 1 < end && end < state.images.length)) {
      throw new Error("Start and End must leave at least one intermediate frame.");
    }
    const first = state.images[start];
    const last = state.images[end];
    if (first.width !== last.width || first.height !== last.height) throw new Error("Start and End frame dimensions do not match.");
    closeToolsDockOnNarrow();
    setLoading(true, "Interpolating masks", `Frames ${start + 1}-${end + 1}`);
    const generated = interpolateLabelMasks(first.mask, last.mask, first.width, first.height, label, end - start - 1);
    const next = state.images.map((image) => image.mask.slice());
    for (let offset = 0; offset < generated.length; offset += 1) {
      const target = next[start + offset + 1];
      for (let index = 0; index < target.length; index += 1) {
        if (target[index] === label) target[index] = 0;
        if (generated[offset][index] && target[index] === 0) target[index] = label;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await applyMaskVolumeTransaction(next, `Interpolated Obj ${label} between frames ${start + 1}-${end + 1}`);
  } catch (error) {
    setStatus(`Mask interpolation failed: ${error.message}`);
    window.alert(`Mask interpolation failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
  }
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

function logMaskExportMapping(destination) {
  if (!DEBUG_SLICE_MAPPING) return;
  let message =
    `[SegRef3D] ${destination} export mapping (${state.images.length} canonical slices):\n` +
      exportMappingPreview(state.images).map((line) => `  ${line}`).join("\n");
  const indices = [...new Set([0, 1, 49, 99, 399, state.images.length - 1])]
    .filter((index) => index >= 0 && index < state.images.length);
  const dicomLines = indices
    .filter((index) => state.images[index].dicom)
    .map((index) => {
      const image = state.images[index];
      return `  UI display ${index + 1} -> canonical z=${index} -> ${maskFilename(index)} ` +
        `-> source=${image.dicom.sourceFilename} -> InstanceNumber=${image.dicom.instanceNumber ?? "unavailable"}`;
    });
  if (dicomLines.length > 0) message += `\n[SegRef3D] ${destination} DICOM source mapping:\n${dicomLines.join("\n")}`;
  console.debug(message);
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
    let entries = [];
    if (kind === "labels") {
      logMaskExportMapping("Label PNG");
      entries = await createLabelPngEntries(state.images, {
        onProgress(completed, total) {
          elements.loadingDetail.textContent = `${completed} / ${total}`;
        },
      });
    } else {
      for (let index = 0; index < state.images.length; index += 1) {
        const image = state.images[index];
        elements.loadingDetail.textContent = `${index + 1} / ${state.images.length}`;
        entries.push({ name: overlayFilename(index), blob: await overlayPngBlob(image) });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    elements.loadingDetail.textContent = "Creating ZIP";
    const zip = await createZip(entries);
    const prefix = kind === "labels" ? "label_png" : "overlay_png";
    const filename = `${outputFileStem()}_${prefix}_${timestamp()}.zip`;
    downloadBlob(zip, filename);
    setStatus(`Exported ${state.images.length} ${kind === "labels" ? "label" : "overlay"} PNGs.`);
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
  const info = currentVolInfo();
  return {
    width,
    height,
    masks: state.images.map((image) => image.mask),
    spacing: info.spacing,
    origin: info.origin,
    geometry: info.geometry,
  };
}

async function exportLabelVolume(format, factor = 1) {
  if (state.loading) return;
  const scale = format === "nifti" ? Number(factor) : 1;
  closeToolsDockOnNarrow();
  setLoading(true, `Exporting ${format.toUpperCase()}`, "Preparing label volume");
  try {
    logMaskExportMapping(`${format.toUpperCase()} label volume`);
    const { masks, width, height, geometry } = labelVolumeGeometry();
    let exportMasks = masks;
    let exportGeometry = geometry;
    if (format === "nifti" && scale > 1) {
      const interpolated = await interpolateMultiLabelVolume(masks, width, height, scale, {
        onProgress(completed, total) {
          setLoading(
            true,
            `Exporting NIfTI Labelmap (${scale}x)`,
            `Interpolating slice interval ${completed} of ${total}`,
          );
        },
      });
      exportMasks = interpolated.masks;
      exportGeometry = upsampleGeometryAlongK(geometry, scale);
      setLoading(true, `Exporting NIfTI Labelmap (${scale}x)`, "Building NIfTI labelmap");
    }
    const bytes =
      format === "nifti"
        ? createNiftiLabelVolume(exportMasks, width, height, exportGeometry)
        : createTiffLabelStack(exportMasks, width, height);
    const extension = format === "nifti" ? "nii" : "tiff";
    const mimeType = format === "nifti" ? "application/octet-stream" : "image/tiff";
    const factorSuffix = format === "nifti" && scale > 1 ? `_${scale}x` : "";
    const volumeName = format === "nifti" ? "labelmap" : "labels";
    const filename = `${outputFileStem()}_${volumeName}${factorSuffix}_${timestamp()}.${extension}`;
    downloadBlob(new Blob([bytes], { type: mimeType }), filename);
    const geometryNote = format === "nifti"
      ? ` with ${geometry.sourceKind === "axis-aligned-fallback" ? "axis-aligned fallback" : "source image"} geometry`
      : " (pixel stack only; patient-space geometry is not embedded)";
    const factorNote = format === "nifti" && scale > 1 ? ` (${scale}x slice interpolation)` : "";
    setStatus(`Exported ${exportMasks.length}-slice label volume as ${extension.toUpperCase()}${factorNote}${geometryNote}.`);
    showToast(`Downloaded ${filename}`);
  } catch (error) {
    console.error(error);
    setStatus(`Volume export failed: ${error.message}`);
    window.alert(`Volume export failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
  }
}

async function exportTrainingDataZip() {
  if (state.loading || state.images.length === 0) return;
  const highBitDepth = Math.max(...state.images.map((image) => Number(image.sourceBitDepth) || 8));
  if (highBitDepth > 8 && !window.confirm(
    `Warning: this ${highBitDepth}-bit source image was decoded to the editor's 8-bit working grid.\n\n` +
      "The Training ZIP cannot claim to contain original high-bit-depth intensities. Continue with an explicit degraded-intensity warning in manifest.json?",
  )) return;
  if (!window.confirm(
    "Create one browser-local Training Data ZIP?\n\n" +
      "DICOM headers and patient identifiers are not included automatically. Image pixels/voxels, facial anatomy, burned-in text, unique anatomy, and user-entered object names may still be identifiable. Nothing is uploaded to SegRef3D.",
  )) return;

  setLoading(true, "Preparing training data…", "Validating geometry…");
  try {
    logMaskExportMapping("Training Data ZIP");
    const { masks, width, height, geometry } = labelVolumeGeometry();
    const hasForeground = masks.some((mask) => mask.some((value) => value !== 0));
    if (!hasForeground && !window.confirm(
      "This training case contains no foreground labels. It can be used as a negative case. Continue?",
    )) return;
    elements.loadingDetail.textContent = "Encoding image volume…";
    const prepared = await prepareTrainingSourceChannels({
      sourceVolume: state.sourceVolume,
      images: state.images,
      width,
      height,
      geometry,
      onProgress(message) {
        elements.loadingDetail.textContent = message;
      },
    });
    elements.loadingDetail.textContent = "Encoding label volume…";
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = createTrainingCaseEntries({
      caseId: state.trainingCaseId || (state.trainingCaseId = createTrainingCaseId()),
      sourceFormat: state.images[0].sourceFormat,
      channels: prepared.channels,
      masks,
      width,
      height,
      geometry,
      objectNames: state.objectNames,
      intensityPolicy: prepared.intensityPolicy,
      warnings: prepared.warnings || [],
    });
    prepared.channels.length = 0;
    elements.loadingDetail.textContent = "Creating ZIP…";
    await new Promise((resolve) => setTimeout(resolve, 0));
    const zip = await createZip(result.entries);
    const filename = `SegRef3D_Train_${result.manifest.case_id}.zip`;
    downloadBlob(zip, filename);
    setStatus(`Training Data ZIP created locally: ${result.manifest.image.channel_count} image channel(s), ${result.manifest.label.objects.length} foreground label(s).`);
    showToast(`Downloaded ${filename}`);
  } catch (error) {
    console.error(error);
    setStatus(`Training Data ZIP export failed: ${error.message}`);
    window.alert(`Training Data ZIP export failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
  }
}

function labelIsUsed(label, masks) {
  return masks.some((mask) => mask.includes(label));
}

function selectedStlLabels(masks) {
  return elements.stlScope.value === "visible"
    ? Array.from({ length: 20 }, (_, index) => index + 1).filter(
        (label) => state.visibleLabels[label] && labelIsUsed(label, masks),
      )
    : [state.targetLabel].filter((label) => labelIsUsed(label, masks));
}

async function buildStlMeshData(progress = () => {}) {
  const factor = Number(elements.stlFactor.value);
  const { masks, width, height, spacing } = labelVolumeGeometry();
  const labels = selectedStlLabels(masks);
  if (labels.length === 0) throw new Error("The selected object set has no label pixels.");
  const meshes = [];
  for (const label of labels) {
    progress(`Obj ${label}: optimizing volume`);
    const cropped = cropLabelVolume(masks, width, height, label);
    if (!cropped) continue;
    const interpolatedDepth = (masks.length - 1) * factor + 1;
    const voxelCount = cropped.width * cropped.height * interpolatedDepth;
    if (voxelCount > 200_000_000) {
      throw new Error(
        `Obj ${label} is still too large after mask-area optimization (${Math.round(voxelCount / 1_000_000)} million voxels).`,
      );
    }
    if (
      voxelCount > 50_000_000 &&
      !window.confirm(
        `Obj ${label}: the optimized ${factor}x volume contains about ${Math.round(voxelCount / 1_000_000)} million voxels.\n\nContinue 3D generation?`,
      )
    ) {
      throw new Error("3D generation was canceled.");
    }
    progress(`Obj ${label}: interpolation`);
    const interpolated = interpolateLabelVolume(
      cropped.masks,
      cropped.width,
      cropped.height,
      label,
      factor,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    progress(`Obj ${label}: meshing`);
    const triangles = marchingTetrahedra(
      interpolated.data,
      cropped.width,
      cropped.height,
      interpolated.depth,
      [spacing[0], spacing[1], spacing[2] / factor],
      [cropped.offsetX * spacing[0], cropped.offsetY * spacing[1], 0],
    );
    if (triangles.length > 0) {
      meshes.push({
        label,
        factor,
        name: `${outputFileStem()}_obj${String(label).padStart(2, "0")}_${factor}x.stl`,
        triangles,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (meshes.length === 0) throw new Error("No STL surface could be generated.");
  return meshes;
}

function closeStlPreview() {
  state.stlPreview?.dispose();
  state.stlPreview = null;
  elements.stlPreviewObjects.replaceChildren();
  if (elements.stlPreviewDialog.open) elements.stlPreviewDialog.close();
}

function renderStlPreviewControls(meshes) {
  elements.stlPreviewObjects.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = "Objects";
  elements.stlPreviewObjects.append(heading);
  for (const mesh of meshes) {
    const row = document.createElement("div");
    row.className = "stl-preview-object-row";
    const visibility = document.createElement("input");
    visibility.type = "checkbox";
    visibility.checked = true;
    visibility.setAttribute("aria-label", `Show Obj ${mesh.label} in 3D preview`);
    const swatch = document.createElement("span");
    swatch.className = "label-swatch";
    swatch.style.background = LABEL_COLORS[mesh.label];
    const name = document.createElement("span");
    name.textContent = objectDisplayName(mesh.label);
    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.min = "0.05";
    opacity.max = "1";
    opacity.step = "0.05";
    opacity.value = "0.86";
    opacity.title = `Obj ${mesh.label} opacity`;
    visibility.addEventListener("change", () => state.stlPreview?.setObjectVisible(mesh.label, visibility.checked));
    opacity.addEventListener("input", () => state.stlPreview?.setObjectOpacity(mesh.label, opacity.value));
    row.append(visibility, swatch, name, opacity);
    elements.stlPreviewObjects.append(row);
  }
}

async function openStlPreview() {
  if (state.loading) return;
  closeToolsDockOnNarrow();
  closeStlPreview();
  elements.stlPreviewProgress.hidden = false;
  elements.stlPreviewProgress.textContent = "Preparing 3D preview…";
  elements.stlPreviewDialog.showModal();
  try {
    const meshes = await buildStlMeshData((message) => {
      elements.stlPreviewProgress.textContent = message;
      setStatus(message);
    });
    elements.stlPreviewProgress.textContent = "Starting Three.js viewer";
    const { createStlPreview } = await import("./three-viewer.mjs?v=17");
    state.stlPreview = createStlPreview({
      container: elements.stlPreviewCanvas,
      meshes,
      colors: LABEL_COLORS,
    });
    renderStlPreviewControls(meshes);
    elements.stlPreviewProgress.hidden = true;
    setStatus(`Previewing ${meshes.length} object surface(s) with ${meshes[0].factor}x interpolation.`);
  } catch (error) {
    console.error(error);
    elements.stlPreviewProgress.hidden = false;
    elements.stlPreviewProgress.textContent = `3D preview failed: ${error.message}`;
    setStatus(`3D preview failed: ${error.message}`);
  }
}

async function exportStlMeshes() {
  if (state.loading) return;
  const factor = Number(elements.stlFactor.value);
  closeToolsDockOnNarrow();
  setLoading(true, "Exporting STL", "Preparing label volume");
  try {
    const meshes = await buildStlMeshData((message) => {
      elements.loadingDetail.textContent = message;
    });
    const entries = meshes.map((mesh) => ({
      name: mesh.name,
      blob: new Blob([createBinaryStl(mesh.triangles, `SegRef3D Obj ${mesh.label}`)], {
        type: "model/stl",
      }),
    }));
    if (entries.length === 1) {
      downloadBlob(entries[0].blob, entries[0].name);
      showToast(`Downloaded ${entries[0].name}`);
    } else {
      elements.loadingDetail.textContent = "Creating STL ZIP";
      const filename = `${outputFileStem()}_STL_${factor}x_${timestamp()}.zip`;
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

async function readEntryText(entry) {
  if (entry.bytes) return new TextDecoder().decode(entry.bytes);
  if (entry.blob?.text) return entry.blob.text();
  throw new Error(`Cannot read ${entry.name}.`);
}

async function selectCanonicalLabelEntries(entries) {
  const manifestEntry = entries.find(
    (entry) => entryBasename(entry.name).toLowerCase() === MASK_MANIFEST_FILENAME,
  );
  if (!manifestEntry) return selectLabelPngEntries(entries);

  let manifest;
  try {
    manifest = JSON.parse(await readEntryText(manifestEntry));
  } catch {
    throw new Error(`${MASK_MANIFEST_FILENAME} is not valid JSON.`);
  }
  validateMaskManifest(manifest);
  const byPath = new Map(entries.map((entry) => [normalizedEntryPath(entry.name), entry]));
  const byBasename = new Map();
  for (const entry of entries) {
    const basename = entryBasename(entry.name).toLowerCase();
    if (!byBasename.has(basename)) byBasename.set(basename, []);
    byBasename.get(basename).push(entry);
  }
  return manifest.files.map((file) => {
    const normalized = normalizedEntryPath(file.filename);
    const direct = byPath.get(normalized);
    const basenameMatches = byBasename.get(entryBasename(file.filename).toLowerCase()) || [];
    const entry = direct || (basenameMatches.length === 1 ? basenameMatches[0] : null);
    if (!entry) throw new Error(`Manifest mask is missing or ambiguous: ${file.filename}`);
    return entry;
  });
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
  const selected = await selectCanonicalLabelEntries(entries);
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
  if (DEBUG_SLICE_MAPPING) {
    const observed = [...new Set([0, 1, 49, 99, 399, importCount - 1])]
      .filter((index) => index >= 0 && index < importCount)
      .map((index) => {
        const image = state.images[index];
        return `  ${selected[index].name} -> canonical z=${index} -> display slice=${index + 1}` +
          (image.dicom ? ` -> source=${image.dicom.sourceFilename}` : "");
      });
    console.debug(`[SegRef3D Lite] Load Masks observation:\n${observed.join("\n")}`);
  }
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
  const savedObjectNames = Array.isArray(settings.objectNames) ? settings.objectNames : null;

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
  syncDisplayControlRanges();
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
  if (savedObjectNames && (savedObjectNames.length === 20 || savedObjectNames.length === 21)) {
    for (let label = 1; label <= 20; label += 1) {
      const value = savedObjectNames.length === 21 ? savedObjectNames[label] : savedObjectNames[label - 1];
      state.objectNames[label] = String(value || `Object ${label}`).slice(0, 80);
    }
  }
  if (Array.isArray(settings.segmentationJobs)) {
    state.segmentationJobs = settings.segmentationJobs.map((job) => cloneSegmentationJob({
      id: Number(job.id),
      name: String(job.name || `Object ${job.id}`),
      promptFrame: Number(job.promptFrame),
      box: Array.isArray(job.box) ? job.box.map(Number) : null,
      prompts: Array.isArray(job.prompts)
        ? job.prompts.map((prompt) => ({
            type: prompt.type,
            frame: Number(prompt.frame),
            box: Array.isArray(prompt.box) ? prompt.box.map(Number) : prompt.box,
          }))
        : undefined,
      trackingStart: Number(job.trackingStart),
      trackingEnd: Number(job.trackingEnd),
    }));
    state.segmentationDraft = state.segmentationJobs.length
      ? cloneSegmentationJob(state.segmentationJobs[0])
      : null;
  }
  setSegmentationObjectNames();
  updateLabelTargets();
  for (const image of state.images) image.overlayDirty = true;
}

function validateProjectManifest(manifest) {
  if (!manifest || manifest.format !== PROJECT_FORMAT || manifest.version !== PROJECT_VERSION) {
    throw new Error("This is not a supported SegRef3D Lite project ZIP.");
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
      throw new Error("A saved Seg Anything object ID exceeds the SegRef3D Lite label limit of 20.");
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
    logMaskExportMapping("Project ZIP");
    const manifest = {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      createdAt: new Date().toISOString(),
      projectName: state.projectName,
      maskManifest: MASK_MANIFEST_FILENAME,
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
        objectNames: state.objectNames.slice(1),
        segmentationJobs: state.segmentationJobs.map(cloneSegmentationJob),
      },
    };
    const entries = [
      {
        name: "segref3d-project.json",
        blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
      },
      {
        name: MASK_MANIFEST_FILENAME,
        blob: maskManifestBlob(state.images, { prefix: "label_png/" }),
      },
    ];
    entries.push(...await createLabelPngEntries(state.images, {
      prefix: "label_png/",
      includeManifest: false,
      onProgress(completed, total) {
        elements.loadingDetail.textContent = `Preparing ${completed} / ${total}`;
      },
    }));
    elements.loadingDetail.textContent = "Creating ZIP";
    const zip = await createZip(entries);
    const filename = `${outputFileStem()}_SegRef3D_Project_${timestamp()}.zip`;
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
    name: state.objectNames[Number(objectId)] || `Object ${Number(objectId)}`,
    prompts: [],
    promptFrame: Math.max(0, state.index),
    box: null,
    trackingStart: 0,
    trackingEnd: Math.max(0, state.images.length - 1),
  };
}

function normalizedJobPrompts(job) {
  const source = Array.isArray(job?.prompts) && job.prompts.length > 0
    ? job.prompts
    : job?.box
      ? [{ type: "box", frame: Number(job.promptFrame), box: job.box }]
      : [];
  return source.map((prompt) => ({
    type: "box",
    frame: Number(prompt.frame),
    box: prompt.box.slice(),
  })).sort((left, right) => left.frame - right.frame);
}

function syncLegacyPromptFields(job) {
  const prompts = normalizedJobPrompts(job);
  const primary = prompts[0] || null;
  return {
    ...job,
    prompts,
    promptFrame: primary?.frame ?? Math.max(0, state.index),
    box: primary?.box.slice() ?? null,
  };
}

function cloneSegmentationJob(job) {
  return syncLegacyPromptFields(job);
}

function segmentationJobById(objectId) {
  return state.segmentationJobs.find((job) => job.id === Number(objectId)) || null;
}

function setSegmentationObjectNames() {
  for (const job of state.segmentationJobs) {
    if (job.name?.trim()) state.objectNames[job.id] = job.name.trim();
  }
  for (let label = 1; label <= 20; label += 1) {
    const name = state.objectNames[label];
    const display = name && name !== `Object ${label}` ? `Obj ${label}: ${name}` : `Obj ${label}`;
    const copy = elements.labelList.querySelector(`[data-label="${label}"] .label-copy strong`);
    if (copy) copy.textContent = display;
    const targetOption = elements.targetLabel.querySelector(`option[value="${label}"]`);
    const transferOption = elements.transferLabel.querySelector(`option[value="${label}"]`);
    const cleanupOption = elements.cleanupObject.querySelector(`option[value="${label}"]`);
    const interpolationOption = elements.interpolationObject.querySelector(`option[value="${label}"]`);
    const managerOption = elements.labelManagerTarget.querySelector(`option[value="${label}"]`);
    if (targetOption) targetOption.textContent = display;
    if (transferOption) transferOption.textContent = display;
    if (cleanupOption) cleanupOption.textContent = display;
    if (interpolationOption) interpolationOption.textContent = display;
    if (managerOption) managerOption.textContent = display;
  }
  updateEditingState();
  updateSegonwebWorkflowSummary();
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
    const promptCount = normalizedJobPrompts(job).length;
    promptCell.textContent = `${promptCount} keyframe${promptCount === 1 ? "" : "s"}`;
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

function renderSegmentationPromptRows() {
  elements.segonwebPromptRows.replaceChildren();
  const draft = state.segmentationDraft;
  const prompts = normalizedJobPrompts(draft);
  for (const prompt of prompts) {
    const row = document.createElement("tr");
    const frameCell = document.createElement("td");
    frameCell.textContent = String(prompt.frame + 1);
    const typeCell = document.createElement("td");
    typeCell.textContent = "Box";
    const boxCell = document.createElement("td");
    boxCell.textContent = prompt.box.map((value) => Number(value).toFixed(1).replace(/\.0$/, "")).join(", ");
    const actionCell = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "text-action-button";
    edit.textContent = "Edit";
    edit.title = `Redraw the box on frame ${prompt.frame + 1}`;
    edit.addEventListener("click", () => beginSegmentationBox(prompt.frame));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-action-button danger-text";
    remove.textContent = "Delete";
    remove.title = `Delete the prompt on frame ${prompt.frame + 1}`;
    remove.addEventListener("click", () => {
      state.segmentationDraft = syncLegacyPromptFields({
        ...draft,
        prompts: prompts.filter((item) => item.frame !== prompt.frame),
        box: null,
      });
      syncSegmentationJobDialog();
      setStatus(`Deleted Obj ${draft.id} prompt on frame ${prompt.frame + 1}. Save the object to keep this change.`);
      render();
    });
    actionCell.append(edit, remove);
    row.append(frameCell, typeCell, boxCell, actionCell);
    elements.segonwebPromptRows.append(row);
  }
  elements.segonwebPromptEmpty.hidden = prompts.length > 0;
  elements.segonwebSetBox.querySelector("span").textContent = prompts.some((prompt) => prompt.frame === state.index)
    ? "Replace Box on This Frame"
    : "Add Box Prompt Here";
}

function syncSegmentationJobDialog() {
  if (!state.segmentationDraft) state.segmentationDraft = blankSegmentationDraft();
  state.segmentationDraft = syncLegacyPromptFields(state.segmentationDraft);
  const draft = state.segmentationDraft;
  const frameCount = Math.max(1, state.images.length);
  elements.segonwebObjectId.value = String(draft.id);
  elements.segonwebObjectName.value = draft.name;
  for (const input of [elements.segonwebTrackingStart, elements.segonwebTrackingEnd]) {
    input.max = String(frameCount);
  }
  elements.segonwebTrackingStart.value = String(draft.trackingStart + 1);
  elements.segonwebTrackingEnd.value = String(draft.trackingEnd + 1);
  syncSegmentationCurrentFrame();
  renderSegmentationJobRows();
  renderSegmentationPromptRows();
}

function syncSegmentationCurrentFrame() {
  if (!elements.segonwebCurrentFrame) return;
  const current = state.images.length > 0 ? state.index + 1 : 0;
  elements.segonwebCurrentFrame.textContent = `${current} / ${state.images.length}`;
  elements.segonwebPreviousFrame.disabled = state.images.length === 0 || state.index === 0;
  elements.segonwebNextFrame.disabled = state.images.length === 0 || state.index === state.images.length - 1;
  if (state.segmentationDraft) renderSegmentationPromptRows();
}

function captureSegmentationRangeBoundary(boundary) {
  if (!state.segmentationDraft || state.images.length === 0) return;
  try {
    const currentFrame = state.index;
    let start = readRequiredNumber(elements.segonwebTrackingStart, "Tracking Start") - 1;
    let end = readRequiredNumber(elements.segonwebTrackingEnd, "Tracking End") - 1;
    if (boundary === "start") {
      start = currentFrame;
      if (end < start) end = start;
    } else {
      end = currentFrame;
      if (start > end) start = end;
    }
    const outside = normalizedJobPrompts(state.segmentationDraft).find(
      (prompt) => prompt.frame < start || prompt.frame > end,
    );
    if (outside) {
      setStatus(`Tracking range would exclude the prompt on frame ${outside.frame + 1}. Delete or move that prompt first.`);
      return;
    }
    state.segmentationDraft = {
      ...state.segmentationDraft,
      id: Number(elements.segonwebObjectId.value),
      name: elements.segonwebObjectName.value.trim() || `Object ${elements.segonwebObjectId.value}`,
      trackingStart: start,
      trackingEnd: end,
    };
    syncSegmentationJobDialog();
    setStatus(`Tracking ${boundary === "start" ? "Start" : "End"} set to frame ${currentFrame + 1}.`);
    elements.canvas.focus();
  } catch (error) {
    setStatus(`Seg Anything job: ${error.message}`);
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
  const trackingStart = readRequiredNumber(elements.segonwebTrackingStart, "Tracking Start") - 1;
  const trackingEnd = readRequiredNumber(elements.segonwebTrackingEnd, "Tracking End") - 1;
  if (![trackingStart, trackingEnd].every(Number.isInteger)) {
    throw new Error("Tracking Start and End must be whole numbers.");
  }
  if (!(0 <= trackingStart && trackingStart <= trackingEnd && trackingEnd < state.images.length)) {
    throw new Error("Tracking Start/End range is invalid.");
  }
  const prompts = normalizedJobPrompts(state.segmentationDraft);
  if (requireBox && prompts.length === 0) throw new Error("Add at least one Box Prompt before saving this object.");
  const seenFrames = new Set();
  for (const prompt of prompts) {
    if (!Number.isInteger(prompt.frame) || prompt.frame < trackingStart || prompt.frame > trackingEnd) {
      throw new Error(`Prompt frame ${prompt.frame + 1} is outside the Tracking Start/End range.`);
    }
    if (seenFrames.has(prompt.frame)) throw new Error(`Duplicate Box Prompts on frame ${prompt.frame + 1}.`);
    seenFrames.add(prompt.frame);
    const image = state.images[prompt.frame];
    const box = prompt.box;
    if (!(0 <= box[0] && box[0] < box[2] && box[2] <= image.width)) {
      throw new Error(`Box X coordinates are outside frame ${prompt.frame + 1}.`);
    }
    if (!(0 <= box[1] && box[1] < box[3] && box[3] <= image.height)) {
      throw new Error(`Box Y coordinates are outside frame ${prompt.frame + 1}.`);
    }
  }
  return syncLegacyPromptFields({ id, name, prompts, trackingStart, trackingEnd });
}

function openSegmentationJobs(objectId = null) {
  if (state.images.length === 0 || state.loading) {
    setStatus("Load images before creating Seg Anything jobs.");
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

function beginSegmentationBox(frame = state.index) {
  try {
    const draft = readSegmentationDraft({ requireBox: false });
    const promptFrame = Number(frame);
    if (!Number.isInteger(promptFrame) || promptFrame < 0 || promptFrame >= state.images.length) {
      throw new Error("The prompt frame is outside the image sequence.");
    }
    draft.trackingStart = Math.min(draft.trackingStart, promptFrame);
    draft.trackingEnd = Math.max(draft.trackingEnd, promptFrame);
    state.segmentationDraft = draft;
    state.index = promptFrame;
    state.segmentationBoxMode = { frame: promptFrame, firstPoint: null, hoverPoint: null };
    elements.segonwebJobsDialog.close();
    updateImageUi();
    setStatus(`Obj ${draft.id}: click two opposite corners on frame ${promptFrame + 1}. Existing prompt on this frame will be replaced.`);
    elements.canvas.focus();
    render();
  } catch (error) {
    setStatus(`Seg Anything job: ${error.message}`);
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
      `Saved Obj ${draft.id}: ${draft.prompts.length} prompt(s), tracking ${draft.trackingStart + 1}-${draft.trackingEnd + 1}.`,
    );
    render();
  } catch (error) {
    setStatus(`Seg Anything job: ${error.message}`);
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
  setLoading(true, "Exporting Seg Anything job", "Validating manifest");
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
    const filename = `${outputFileStem()}_segonweb_input.zip`;
    downloadBlob(await createZip(entries), filename);
    setStatus(`Exported Seg Anything job: ${state.images.length} images, ${state.segmentationJobs.length} object(s).`);
    showToast(`Downloaded ${filename}`);
  } catch (error) {
    console.error(error);
    setStatus(`Seg Anything export failed: ${error.message}`);
    window.alert(`Seg Anything export failed.\n\n${error.message}`);
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
    throw new Error("Image order mismatch between the current project and Seg Anything result.");
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
  setLoading(true, "Importing Seg Anything result", "Opening ZIP");
  try {
    const entries = await parseZip(file);
    const { manifest, entriesByPath } = validateSegmentationArchive(entries, SEGMENTATION_RESULT_KIND);
    if (manifest.objects.some((object) => object.id > 20)) {
      throw new Error("SegRef3D Lite supports object IDs 1-20.");
    }
    validateCurrentImagesForSegmentationResult(manifest);
    const resultImages = await decodeSegmentationResultImages(manifest, entriesByPath);
    const decodedMasks = await decodeSegmentationResultMasks(manifest, entriesByPath);

    const hasExistingMasks = state.images.some((image) => image.mask.some((value) => value !== 0));
    if (
      hasExistingMasks &&
      !window.confirm("Importing this Seg Anything result will replace the current label masks. Continue?")
    ) {
      setStatus("Seg Anything result import canceled. Current masks were not changed.");
      return;
    }

    if (state.images.length === 0) {
      const loaded = await prepareImageSequence(
        resultImages.sources,
        resultImages.files,
        manifest.source.project_name || "Seg Anything result",
        "Seg Anything result image(s)",
        { preserveDimensions: true },
      );
      if (!loaded) return;
    }
    const imported = decodedMasks.map((mask, index) => ({ image: state.images[index], mask }));
    await applyImportedMasks(imported, { mode: "replace" });
    state.segmentationJobs = manifest.objects.map((object) => cloneSegmentationJob({
      id: object.id,
      name: object.name,
      promptFrame: object.prompt_frame,
      box: object.box.slice(),
      prompts: object.prompts.map((prompt) => ({
        type: prompt.type,
        frame: prompt.frame,
        box: prompt.box.slice(),
      })),
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
    setStatus(`Imported Seg Anything result: ${decodedMasks.length} masks, ${state.segmentationJobs.length} object(s).`);
    showToast("Seg Anything result imported.");
  } catch (error) {
    console.error(error);
    setStatus(`Seg Anything result import failed: ${error.message}`);
    window.alert(`Seg Anything result import failed.\n\n${error.message}`);
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
  {
    autoExportVolInfo = false,
    preserveDimensions = false,
    demoDataset = null,
    volumeGeometry = null,
  } = {},
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
    const trainingGridUnchanged =
      source.width === size.width && source.height === size.height &&
      width === size.width && height === size.height;
    const modalityPixels =
      trainingGridUnchanged && source.modalityPixels instanceof Float32Array
        ? source.modalityPixels
        : null;
    const sourceSpacing = source.pixelSpacing;
    const pixelSpacing = sourceSpacing
      ? [
          Number(sourceSpacing[0]) * (source.width / size.width),
          Number(sourceSpacing[1]) * (source.height / size.height),
        ]
      : null;
    const restored = await loadMask(projectId, source.name, width, height, {
      zIndex: index,
      sliceOrder: MASK_SLICE_ORDER,
    }).catch(() => null);
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
      dicom: source.dicom || null,
      sourceCanvas,
      basePixels: modalityPixels ? null : canvasRgba(sourceCanvas),
      modalityPixels,
      displayDefaults: source.displayDefaults || null,
      displayRange: source.displayRange || null,
      trainingKind: source.trainingKind || null,
      trainingPixels: trainingGridUnchanged ? source.trainingPixels || null : null,
      trainingIntensityPolicy: source.trainingIntensityPolicy || null,
      trainingWarning: source.trainingWarning || null,
      trainingUnavailableReason: source.trainingPixels && !trainingGridUnchanged
        ? "The medical source grid was resized or placed on a shared canvas; original scalar voxels no longer match the editable mask grid."
        : source.trainingUnavailableReason || null,
      sourceBitDepth: source.sourceBitDepth || 8,
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

  let preparedVolumeGeometry = null;
  if (volumeGeometry) {
    if (volumeGeometry.shape[2] !== prepared.length) {
      throw new Error("Source volume geometry depth does not match the prepared image sequence.");
    }
    const first = prepared[0];
    preparedVolumeGeometry = transformGeometryForPreparedImage(volumeGeometry, {
      sourceWidth: first.originalWidth,
      sourceHeight: first.originalHeight,
      contentWidth: first.contentWidth,
      contentHeight: first.contentHeight,
      outputWidth: first.width,
      outputHeight: first.height,
      contentX: first.contentX,
      contentY: first.contentY,
    });
  }
  state.images = prepared;
  state.volumeGeometry = preparedVolumeGeometry;
  state.sourceVolume = null;
  state.instant3dMappings = [];
  state.instant3dPendingImport = null;
  state.bulkUndo = [];
  state.bulkRedo = [];
  state.segmentationJobs = [];
  state.objectNames = Array.from({ length: 21 }, (_, label) => label === 0 ? "" : `Object ${label}`);
  state.segmentationDraft = null;
  state.segmentationBoxMode = null;
  setSegmentationObjectNames();
  renderInstant3DMappings();
  if (state.projectId !== projectId || !state.trainingCaseId) state.trainingCaseId = createTrainingCaseId();
  state.projectId = projectId;
  state.index = clamp(demoDataset?.initialFrameIndex ?? 0, 0, prepared.length - 1);
  state.projectName = projectName;
  state.activeDemoDatasetId = demoDataset?.id ?? null;
  state.visibleLabels = Array.from({ length: 21 }, (_, label) => label === 1);
  const modalityDisplay = prepared.find((image) => image.modalityPixels && image.displayDefaults);
  state.displayDefaults = modalityDisplay
    ? { ...modalityDisplay.displayDefaults, brightness: 0, contrast: 1 }
    : { windowCenter: 127.5, windowWidth: 255, brightness: 0, contrast: 1 };
  state.displayRange = modalityDisplay?.displayRange
    ? { ...modalityDisplay.displayRange }
    : { minimum: 0, maximum: 255 };
  resetDisplaySettings({ announce: false });
  initializeCalibrationFromImages();
  if (demoDataset) {
    if (demoDataset.calibration) {
      state.calibration.referenceLength = demoDataset.calibration.referenceLengthMm;
      state.calibration.zSpacing = demoDataset.calibration.sliceSpacingMm;
    }
    if (demoDataset.voxelSpacingMm) {
      const [xSpacing, ySpacing, zSpacing] = demoDataset.voxelSpacingMm;
      state.calibration.xSpacing = xSpacing;
      state.calibration.ySpacing = ySpacing;
      state.calibration.zSpacing = zSpacing;
    }
    state.volumeInfoSource = demoDataset.volumeInfoSource || "Default spacing";
    syncCalibrationControls();
    syncVolInfoSummary();
  }
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
      let sourceBitDepth = 8;
      if (/\.png$/i.test(files[index].name)) {
        const header = new Uint8Array(await files[index].slice(0, 29).arrayBuffer());
        const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (pngSignature.every((value, offset) => header[offset] === value)) sourceBitDepth = Number(header[24]) || 8;
      }
      sources.push({
        name: files[index].name,
        width: decoded.image.naturalWidth,
        height: decoded.image.naturalHeight,
        sourceCanvas: imageElementToCanvas(decoded.image),
        sourceFormat: /\.png$/i.test(files[index].name) ? "png" : "jpeg",
        sourceBitDepth,
        trainingWarning: sourceBitDepth > 8
          ? `${sourceBitDepth}-bit PNG values are decoded to the editor's 8-bit working grid; original high-bit-depth values are not retained.`
          : null,
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
  const decoded = await decodeDicomSeriesAsync(selected.items, {
    onProgress: (completed, total, instance) => {
      elements.loadingDetail.textContent =
        `Decoding DICOM ${completed} / ${total} · ${instance.name}`;
    },
  });
  if (DEBUG_SLICE_MAPPING) {
    console.debug(
      `[SegRef3D Lite] DICOM load/UI mapping (${decoded.frames.length} canonical slices):\n` +
        dicomMappingPreview(selected.items).map((line) => `  ${line}`).join("\n"),
    );
  }
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
      modalityPixels: frame.modalityPixels || null,
      displayDefaults: {
        windowCenter: decoded.initialWindow.center,
        windowWidth: decoded.initialWindow.width,
      },
      displayRange: {
        minimum: decoded.modalityStatistics.minimum,
        maximum: decoded.modalityStatistics.maximum,
      },
      trainingKind: frame.trainingKind || null,
      trainingPixels: frame.trainingPixels || null,
      trainingIntensityPolicy: frame.trainingIntensityPolicy || null,
      trainingUnavailableReason: frame.trainingKind
        ? null
        : "This DICOM frame does not expose scalar voxel values for training export.",
      pixelSpacing: decoded.spacing.slice(0, 2),
      sliceSpacing: decoded.spacing[2],
      volumeOrigin: decoded.origin,
      dicom: frame.dicom,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return {
    sources,
    files: selected.items.map((instance) => instance.file),
    description: selected.description || "DICOM series",
    geometry: decoded.geometry,
    geometryWarnings: decoded.geometryWarnings,
  };
}

async function decodeNiftiSources(file) {
  const input = await file.arrayBuffer();
  const volume = parseNiftiVolume(input, file.name);
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
  return { volume, sources, bytes: new Uint8Array(input) };
}

async function prepareNiftiFile(file) {
  if (!file || state.loading) return;
  setLoading(true, "Loading NIfTI volume", "Reading volume");
  try {
    const { volume, sources, bytes } = await decodeNiftiSources(file);
    const loaded = await prepareImageSequence(
      sources,
      [file],
      file.name.replace(/\.nii(?:\.gz)?$/i, "") || "NIfTI volume",
      "NIfTI slice(s)",
      { autoExportVolInfo: true, volumeGeometry: volume.geometry },
    );
    if (loaded) {
      state.sourceVolume = {
        format: "nifti",
        modality: "CT",
        filename: file.name,
        bytes,
        shape: [volume.width, volume.height, volume.depth],
        spacing: [...volume.spacing],
        affine: volume.affine.map((row) => [...row]),
        orientation: volume.orientation,
        sha256: await sha256Hex(bytes),
      };
      updateInstant3DControls();
    }
  } catch (error) {
    console.error(error);
    setStatus(`NIfTI loading failed: ${error.message}`);
    window.alert(`NIfTI loading failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
    elements.volumeInput.value = "";
  }
}

async function decodeTiffSources(files) {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (
    totalBytes > 512 * 1024 * 1024 &&
    !window.confirm(
      `The selected TIFF data is ${Math.round(totalBytes / 1024 / 1024)} MB.\n\n` +
        "Decoding may use several times this amount of memory. Continue?",
    )
  ) {
    return null;
  }
  const sources = [];
  let expectedSize = null;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    elements.loadingDetail.textContent = `Reading TIFF ${fileIndex + 1} / ${files.length}`;
    const volume = parseTiffStack(await file.arrayBuffer(), file.name);
    if (!expectedSize) expectedSize = [volume.width, volume.height];
    if (volume.width !== expectedSize[0] || volume.height !== expectedSize[1]) {
      throw new Error(`${file.name} dimensions do not match the first TIFF image.`);
    }
    for (let frameIndex = 0; frameIndex < volume.frames.length; frameIndex += 1) {
      const frame = volume.frames[frameIndex];
      sources.push({
        name: files.length === 1
          ? frame.name
          : `${file.name.replace(/\.tiff?$/i, "")}_${String(frameIndex + 1).padStart(4, "0")}.png`,
        width: frame.width,
        height: frame.height,
        sourceCanvas: await medicalFrameToCanvas(frame),
        sourceFormat: "tiff",
        sourceBitDepth: frame.sourceBitDepth || volume.sourceBitDepth || 8,
        trainingWarning: volume.trainingWarning,
        pixelSpacing: [1, 1],
        sliceSpacing: 1,
        volumeOrigin: [0, 0, 0],
      });
      if (sources.length % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return sources;
}

async function prepareTiffFiles(files) {
  if (!files.length || state.loading) return;
  setLoading(true, "Loading TIFF stack", "Reading TIFF data");
  try {
    const ordered = [...files].sort((left, right) => naturalCompare(left.name, right.name));
    const sources = await decodeTiffSources(ordered);
    if (!sources) {
      setStatus("TIFF loading canceled.");
      return;
    }
    await prepareImageSequence(
      sources,
      ordered,
      ordered.length === 1 ? ordered[0].name.replace(/\.tiff?$/i, "") : "TIFF stack",
      "TIFF slice(s)",
    );
  } catch (error) {
    console.error(error);
    setStatus(`TIFF loading failed: ${error.message}`);
    window.alert(`TIFF loading failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
    elements.volumeInput.value = "";
  }
}

async function prepareVolumeFile(file) {
  if (!file) return;
  if (isTiffFilename(file.name)) await prepareTiffFiles([file]);
  else await prepareNiftiFile(file);
}

async function prepareFiles(files) {
  if (state.loading) return;
  const visibleFiles = files.filter((file) => !file.name.startsWith("."));
  const niftiFiles = visibleFiles.filter((file) => isNiftiFilename(file.name));
  const tiffFiles = visibleFiles
    .filter((file) => isTiffFilename(file.name))
    .sort((left, right) => naturalCompare(left.name, right.name));
  const rasterFiles = visibleFiles
    .filter((file) => /\.(jpe?g|png)$/i.test(file.name))
    .sort((left, right) => naturalCompare(left.name, right.name));
  const dicomFiles = visibleFiles
    .filter((file) => /\.dcm$/i.test(file.name) || !file.name.includes("."))
    .sort((left, right) => naturalCompare(left.name, right.name));
  setLoading(true, "Loading images", `Reading 0 / ${visibleFiles.length}`);
  try {
    if (niftiFiles.length > 0) {
      if (niftiFiles.length !== 1 || tiffFiles.length > 0 || rasterFiles.length > 0 || dicomFiles.length > 0) {
        throw new Error("Select one NIfTI file by itself, without other image formats.");
      }
      setLoading(false);
      await prepareNiftiFile(niftiFiles[0]);
      return;
    }
    if (tiffFiles.length > 0) {
      if (rasterFiles.length > 0 || dicomFiles.length > 0) {
        throw new Error("The selected folder mixes TIFF and other image formats. Use separate folders.");
      }
      const sources = await decodeTiffSources(tiffFiles);
      if (!sources) {
        setStatus("TIFF loading canceled.");
        return;
      }
      const projectFolder = visibleFiles[0]?.webkitRelativePath?.split("/")[0] || "TIFF stack";
      await prepareImageSequence(sources, tiffFiles, projectFolder, "TIFF slice(s)");
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
        { autoExportVolInfo: true, volumeGeometry: decoded.geometry },
      );
      if (decoded.geometryWarnings.length > 0) {
        console.warn(...decoded.geometryWarnings);
        if (!decoded.geometry) {
          setStatus(
            `DICOM loaded. Geometry unavailable: using axis-aligned fallback. ${decoded.geometryWarnings[0]}`,
          );
        }
      }
      return;
    }
    throw new Error("No JPG, PNG, TIFF, DICOM, or NIfTI images were found.");
  } catch (error) {
    console.error(error);
    setStatus(`Image loading failed: ${error.message}`);
    window.alert(`Image loading failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
    elements.folderInput.value = "";
  }
}

function loadDemoImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error(`Could not load demo image: ${path}`)),
      { once: true },
    );
    image.src = new URL(path, document.baseURI).href;
  });
}

async function loadImageSequenceDemo(dataset) {
  setLoading(true, `Loading ${dataset.displayName}`, `Reading 0 / ${dataset.imagePaths.length}`);
  try {
    const sources = [];
    for (let index = 0; index < dataset.imagePaths.length; index += 1) {
      elements.loadingDetail.textContent = `Reading ${index + 1} / ${dataset.imagePaths.length}`;
      const image = await loadDemoImage(dataset.imagePaths[index]);
      sources.push({
        name: `apple_${String(index + 1).padStart(4, "0")}.jpg`,
        width: image.naturalWidth,
        height: image.naturalHeight,
        sourceCanvas: imageElementToCanvas(image),
        sourceFormat: dataset.sourceFormat,
        sliceSpacing: dataset.calibration.sliceSpacingMm,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const projectFiles = sources.map((source) => ({
      name: source.name,
      size: 0,
      lastModified: dataset.revision,
    }));
    const loaded = await prepareImageSequence(
      sources,
      projectFiles,
      dataset.projectName,
      `${dataset.displayName} slice(s)`,
      { preserveDimensions: true, demoDataset: dataset },
    );
    if (!loaded) return;
    setSaveState(`${dataset.displayName} autosave active`, "saved");
    setStatus(
      `${dataset.displayName} loaded: ${sources.length} slices. Calibrate the widest apple diameter using the ${dataset.calibration.referenceLengthMm} mm learning reference.`,
    );
    showToast(`${dataset.displayName} ready · Start with Calibration`);
    requestAnimationFrame(() => {
      fitCurrentImage();
      openImageTools(dataset.guide.toolTab);
    });
  } catch (error) {
    console.error(error);
    setStatus(`${dataset.displayName} loading failed: ${error.message}`);
    window.alert(`${dataset.displayName} loading failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
  }
}

async function downloadDemoVolume(dataset) {
  const url = new URL(dataset.volumePath, document.baseURI);
  if (url.origin !== window.location.origin) {
    throw new Error("Demo volumes must be loaded from the SegRef3D Lite origin.");
  }
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Volume download failed with HTTP ${response.status}.`);
  const totalBytes = Number(response.headers.get("Content-Length")) || dataset.volumeBytes;
  if (!response.body) {
    return new File([await response.blob()], dataset.volumeFilename, {
      type: "application/gzip",
      lastModified: dataset.revision,
    });
  }
  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.byteLength;
    elements.loadingDetail.textContent =
      `Downloading ${(receivedBytes / 1024 / 1024).toFixed(1)} / ${(totalBytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return new File(chunks, dataset.volumeFilename, {
    type: "application/gzip",
    lastModified: dataset.revision,
  });
}

async function loadNiftiDemo(dataset) {
  setLoading(true, `Loading ${dataset.displayName}`, "Downloading volume");
  try {
    const file = await downloadDemoVolume(dataset);
    elements.loadingDetail.textContent = "Reading NIfTI volume";
    const { volume, sources, bytes } = await decodeNiftiSources(file);
    const loaded = await prepareImageSequence(
      sources,
      [file],
      dataset.projectName,
      `${dataset.displayName} slice(s)`,
      { preserveDimensions: true, demoDataset: dataset, volumeGeometry: volume.geometry },
    );
    if (!loaded) return;
    state.sourceVolume = {
      format: "nifti",
      modality: "CT",
      filename: file.name,
      bytes,
      shape: [volume.width, volume.height, volume.depth],
      spacing: [...volume.spacing],
      affine: volume.affine.map((row) => [...row]),
      orientation: volume.orientation,
      sha256: await sha256Hex(bytes),
    };
    updateInstant3DControls();
    setSaveState(`${dataset.displayName} autosave active`, "saved");
    setStatus(
      `${dataset.displayName} loaded: ${sources.length} slices · 1.0 mm isotropic. Suggested target: skull or body contour.`,
    );
    showToast(`${dataset.displayName} ready · Try Threshold or drawing tools`);
    requestAnimationFrame(() => {
      fitCurrentImage();
      openImageTools(dataset.guide.toolTab);
    });
  } catch (error) {
    console.error(error);
    setStatus(`${dataset.displayName} loading failed: ${error.message}`);
    window.alert(`${dataset.displayName} loading failed.\n\n${error.message}`);
  } finally {
    setLoading(false);
  }
}

async function loadDemo(datasetId) {
  const dataset = demoDatasetById(datasetId);
  if (!dataset || state.loading) return;
  if (dataset.kind === "image-sequence") await loadImageSequenceDemo(dataset);
  else if (dataset.kind === "nifti-volume") await loadNiftiDemo(dataset);
  else throw new Error(`Unsupported demo dataset kind: ${dataset.kind}`);
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
  if (event.button === 2) {
    event.preventDefault();
    if (
      state.drawMode === "free" ||
      state.segmentationBoxMode ||
      state.rgbPickMode ||
      state.calibrationMode ||
      image.activePath.length === 0
    ) {
      return;
    }
    const rawPoint = screenToImage(local.x, local.y, state.viewport);
    if (!pointInsideImage(rawPoint, image.width, image.height)) return;
    elements.canvas.focus();
    const point = imagePointerPosition(event, state.drawMode === "snap");
    const previous = image.activePath.at(-1);
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      image.activePath.push(point);
      image.pathRedo.length = 0;
    }
    finalizeActivePath();
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
      const prompts = normalizedJobPrompts(state.segmentationDraft)
        .filter((prompt) => prompt.frame !== state.index);
      prompts.push({ type: "box", frame: state.index, box });
      state.segmentationDraft = syncLegacyPromptFields({
        ...state.segmentationDraft,
        prompts,
        box: null,
        trackingStart: Math.min(state.segmentationDraft.trackingStart, state.index),
        trackingEnd: Math.max(state.segmentationDraft.trackingEnd, state.index),
      });
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
        const calibrationStatus =
          `Calibrated ${state.calibration.referenceLength.toLocaleString()} mm over ` +
          `${pixelLength.toFixed(2)} px: ${spacing.toPrecision(6)} mm/px.`;
        setStatus(calibrationStatus);
        syncDemoCalibrationGuide();
        exportVolInfoCsv({ automatic: true });
        const nextStep = activeDemoDataset()?.guide?.nextStep;
        if (nextStep) {
          setStatus(`${calibrationStatus} ${nextStep}`);
          showToast(nextStep);
        }
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
    elements.toolsDialog.contains(event.target) &&
    event.target.closest?.("input, select, button");
  if (
    elements.localFileDialog.open ||
    elements.maskImportDialog.open ||
    elements.clearMasksDialog.open ||
    elements.localProcessingDialog.open ||
    elements.segonwebWarningDialog.open ||
    elements.instant3dWarningDialog.open ||
    elements.instant3dConflictDialog.open ||
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
    event.shiftKey ? smartRedo() : smartUndo();
    event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && (code === "KeyY" || lowerKey === "y")) {
    smartRedo();
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
    ? "Open a local NIfTI or TIFF volume"
    : "Open a local image folder";
  elements.localFileContinueText.textContent = isVolume ? "Open Volume" : "Open Folder";
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
  const returnToSegonwebWorkflow = () => {
    elements.segonwebWarningDialog.close();
    updateSegonwebWorkflowSummary();
    openToolsDock("ai");
  };

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
  elements.localProcessingStatus.addEventListener("click", () => {
    if (!elements.localProcessingDialog.open) elements.localProcessingDialog.showModal();
  });
  elements.localProcessingClose.addEventListener("click", () => elements.localProcessingDialog.close());
  elements.folderInput.addEventListener("change", () => prepareFiles([...elements.folderInput.files]));
  elements.volumeInput.addEventListener("change", () => prepareVolumeFile(elements.volumeInput.files[0]));
  elements.loadMasks.addEventListener("click", requestMaskImport);
  elements.maskImportCancel.addEventListener("click", () => elements.maskImportDialog.close());
  elements.clearMasksCancel.addEventListener("click", () => elements.clearMasksDialog.close());
  elements.clearMasksConfirm.addEventListener("click", clearAllMasks);
  elements.labelManagerClose.addEventListener("click", () => elements.labelManagerDialog.close());
  elements.labelManagerRename.addEventListener("click", renameManagedObject);
  elements.labelManagerRelabel.addEventListener("click", () => relabelOrMergeManagedObject("relabel"));
  elements.labelManagerMerge.addEventListener("click", () => relabelOrMergeManagedObject("merge"));
  elements.labelManagerClear.addEventListener("click", clearManagedObject);
  elements.projectCheckClose.addEventListener("click", () => elements.projectCheckDialog.close());
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
  elements.loadDemo.addEventListener("click", () => loadDemo("apple-kanzi-84"));
  elements.loadRabbitDemo.addEventListener("click", () => loadDemo("rabbitct-reference-256"));
  elements.openAppleDemo.addEventListener("click", () => {
    elements.openMenu.open = false;
    elements.loadDemo.click();
  });
  elements.openRabbitDemo.addEventListener("click", () => {
    elements.openMenu.open = false;
    elements.loadRabbitDemo.click();
  });
  elements.fitView.addEventListener("click", fitCurrentImage);
  elements.previousImage.addEventListener("click", () => switchImage(-1));
  elements.nextImage.addEventListener("click", () => switchImage(1));
  elements.sliceSlider.addEventListener("input", () => jumpToSlice(Number(elements.sliceSlider.value)));
  elements.sliceNumber.addEventListener("input", () => jumpToSlice(Number(elements.sliceNumber.value)));
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
  elements.addMask.addEventListener("click", () => {
    state.currentOperation = "add";
    updateEditingState();
    commitPaths("add");
  });
  elements.eraseMask.addEventListener("click", () => {
    state.currentOperation = "erase";
    updateEditingState();
    commitPaths("erase");
  });
  elements.transferMask.addEventListener("click", () => {
    state.currentOperation = "transfer";
    updateEditingState();
    transferCurrentLabel();
  });
  elements.undoLine.addEventListener("click", undoLine);
  elements.redoLine.addEventListener("click", redoLine);
  elements.clearLines.addEventListener("click", clearLines);
  elements.undoEdit.addEventListener("click", undoEdit);
  elements.redoEdit.addEventListener("click", redoEdit);
  elements.undoAction.addEventListener("click", smartUndo);
  elements.redoAction.addEventListener("click", smartRedo);
  elements.clearMasks.addEventListener("click", requestClearAllMasks);
  elements.imageTools.addEventListener("click", () => openImageTools("display"));
  elements.toolsClose.addEventListener("click", () => elements.toolsDialog.classList.remove("open"));
  elements.toolsToggle.addEventListener("click", () => elements.toolsDialog.classList.toggle("open"));
  elements.toolsPreviousFrame.addEventListener("click", () => switchImage(-1));
  elements.toolsNextFrame.addEventListener("click", () => switchImage(1));
  elements.checkProject.addEventListener("click", runProjectCheck);
  elements.projectHealth.addEventListener("click", runProjectCheck);
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
    closeToolsDockOnNarrow();
    elements.volInfoInput.click();
  });
  elements.exportVolInfo.addEventListener("click", () => exportVolInfoCsv());
  elements.volInfoInput.addEventListener("change", () =>
    importVolInfoCsv(elements.volInfoInput.files[0]),
  );
  elements.exportNifti.addEventListener("click", () => exportLabelVolume("nifti", 1));
  elements.exportNifti5x.addEventListener("click", () => exportLabelVolume("nifti", 5));
  elements.exportNifti10x.addEventListener("click", () => exportLabelVolume("nifti", 10));
  elements.exportTiff.addEventListener("click", () => exportLabelVolume("tiff"));
  elements.previewStl.addEventListener("click", openStlPreview);
  elements.exportStl.addEventListener("click", exportStlMeshes);
  elements.stlPreviewClose.addEventListener("click", closeStlPreview);
  elements.stlPreviewReset.addEventListener("click", () => state.stlPreview?.resetCamera());
  elements.stlPreviewDialog.addEventListener("close", () => {
    if (state.stlPreview) {
      state.stlPreview.dispose();
      state.stlPreview = null;
    }
  });
  elements.applyCleanup.addEventListener("click", applyMaskCleanup);
  elements.applyInterpolation.addEventListener("click", applySliceInterpolation);
  elements.exportVolumeStatistics.addEventListener("click", exportVolumeStatisticsCsv);
  elements.exportMenuNifti.addEventListener("click", () => exportLabelVolume("nifti", 1));
  elements.exportMenuNifti5x.addEventListener("click", () => exportLabelVolume("nifti", 5));
  elements.exportMenuNifti10x.addEventListener("click", () => exportLabelVolume("nifti", 10));
  elements.exportMenuTiff.addEventListener("click", () => exportLabelVolume("tiff"));
  elements.exportMenuStatistics.addEventListener("click", exportVolumeStatisticsCsv);
  elements.exportMenuStl.addEventListener("click", exportStlMeshes);
  elements.exportTraining.addEventListener("click", exportTrainingDataZip);
  elements.exportLabels.addEventListener("click", () => exportSequence("labels"));
  elements.exportOverlays.addEventListener("click", () => exportSequence("overlays"));
  elements.exportProject.addEventListener("click", exportProjectZip);
  for (const button of elements.exportMenu.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      elements.exportMenu.open = false;
    });
  }
  elements.segonwebWorkflow.addEventListener("click", () => {
    updateSegonwebWorkflowSummary();
    openToolsDock("ai");
  });
  elements.segonwebWorkflowClose.addEventListener("click", () => closeToolsDockOnNarrow());
  elements.segOnWeb.addEventListener("click", (event) => {
    event.preventDefault();
    elements.segonwebWarningContinue.href = elements.segOnWeb.href;
    if (!elements.segonwebWarningDialog.open) elements.segonwebWarningDialog.showModal();
  });
  elements.segonwebWarningCancel.addEventListener("click", returnToSegonwebWorkflow);
  elements.segonwebWarningDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    returnToSegonwebWorkflow();
  });
  elements.segonwebWarningContinue.addEventListener("click", () => {
    setTimeout(() => {
      if (elements.segonwebWarningDialog.open) elements.segonwebWarningDialog.close();
      setStatus("Opening Seg Anything in Google Colab. Upload occurs only when you choose the input ZIP in Colab.");
    }, 0);
  });
  elements.instant3dSearch.addEventListener("input", renderInstant3DCatalog);
  elements.instant3dAvailable.addEventListener("dblclick", addInstant3DStructure);
  elements.instant3dAdd.addEventListener("click", addInstant3DStructure);
  elements.instant3dExport.addEventListener("click", () => {
    state.instant3dPendingAction = "export";
    elements.instant3dWarningDialog.showModal();
  });
  elements.instant3dOpen.addEventListener("click", (event) => {
    event.preventDefault();
    state.instant3dPendingAction = "open";
    elements.instant3dWarningDialog.showModal();
  });
  elements.instant3dWarningCancel.addEventListener("click", () => {
    state.instant3dPendingAction = null;
    elements.instant3dWarningDialog.close();
  });
  elements.instant3dWarningDialog.addEventListener("cancel", () => {
    state.instant3dPendingAction = null;
  });
  elements.instant3dWarningContinue.addEventListener("click", () => {
    const action = state.instant3dPendingAction;
    state.instant3dPendingAction = null;
    elements.instant3dWarningDialog.close();
    if (action === "export") exportInstant3DRequest();
    if (action === "open") {
      window.open(elements.instant3dOpen.href, "_blank", "noopener,noreferrer");
      setStatus("Opening Seg CT/MRI in Google Colab. Upload occurs only when you select the request ZIP there.");
    }
  });
  elements.instant3dImport.addEventListener("click", () => elements.instant3dResultInput.click());
  elements.instant3dResultInput.addEventListener("change", () =>
    importInstant3DResult(elements.instant3dResultInput.files[0]));
  elements.instant3dConflictCancel.addEventListener("click", () => {
    state.instant3dPendingImport = null;
    elements.instant3dConflictDialog.close();
    setStatus("Seg CT/MRI result import canceled; masks were not changed.");
  });
  elements.instant3dConflictMerge.addEventListener("click", () => applyInstant3DImport("merge"));
  elements.instant3dConflictReplace.addEventListener("click", () => applyInstant3DImport("replace"));
  elements.segonwebJobs.addEventListener("click", () => {
    openSegmentationJobs(state.targetLabel);
  });
  elements.segonwebJobsClose.addEventListener("click", () => elements.segonwebJobsDialog.close());
  elements.segonwebNewObject.addEventListener("click", newSegmentationObject);
  elements.segonwebSetBox.addEventListener("click", () => beginSegmentationBox());
  elements.segonwebPreviousFrame.addEventListener("click", () => switchImage(-1));
  elements.segonwebNextFrame.addEventListener("click", () => switchImage(1));
  elements.segonwebSetStart.addEventListener("click", () => captureSegmentationRangeBoundary("start"));
  elements.segonwebSetEnd.addEventListener("click", () => captureSegmentationRangeBoundary("end"));
  elements.segonwebSaveObject.addEventListener("click", saveSegmentationObject);
  elements.segonwebObjectId.addEventListener("change", () => {
    const objectId = Number(elements.segonwebObjectId.value);
    selectTargetLabel(objectId);
    const existing = segmentationJobById(objectId);
    state.segmentationDraft = existing ? cloneSegmentationJob(existing) : blankSegmentationDraft(objectId);
    syncSegmentationJobDialog();
    render();
  });
  elements.exportSegonweb.addEventListener("click", () => {
    exportSegmentationJob();
  });
  elements.importSegonweb.addEventListener("click", () => {
    elements.segonwebResultInput.click();
  });
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
  elements.canvas.addEventListener("wheel", handleWheel, { passive: false });
  elements.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("keydown", handleKeyDown, { capture: true });
  new ResizeObserver(() => resizeCanvas()).observe(elements.canvasPanel);
}

initializeLabels();
for (let objectId = 1; objectId <= 20; objectId += 1) {
  const option = document.createElement("option");
  option.value = String(objectId);
  option.textContent = `Obj ${objectId}`;
  elements.instant3dObjectId.append(option);
}
renderInstant3DMappings();
loadInstant3DCatalog();
elements.penColorSwatch.style.background = state.penColor;
setAutoApplyMode("off", { announce: false });
setMaskImportMode("replace");
syncDisplayControlRanges();
syncDisplayControls();
syncExtractionControls();
syncCalibrationControls();
syncVolInfoSummary();
selectToolTab("draw");
bindEvents();
setControlsEnabled(false);
resizeCanvas();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./service-worker.js").catch((error) => {
    console.warn("Service worker registration failed", error);
  });
}
