import { formatNumber } from "./nifti.mjs";

const elements = {
  fileInput: document.querySelector("#file-input"),
  dropZone: document.querySelector("#drop-zone"),
  fileCard: document.querySelector("#file-card"),
  fileName: document.querySelector("#file-name"),
  fileSize: document.querySelector("#file-size"),
  replaceFile: document.querySelector("#replace-file"),
  metaDimensions: document.querySelector("#meta-dimensions"),
  metaSpacing: document.querySelector("#meta-spacing"),
  metaDatatype: document.querySelector("#meta-datatype"),
  metaLabels: document.querySelector("#meta-labels"),
  settings: document.querySelector("#settings"),
  axisSelect: document.querySelector("#axis-select"),
  axisHint: document.querySelector("#axis-hint"),
  factorInput: document.querySelector("#factor-input"),
  factorMinus: document.querySelector("#factor-minus"),
  factorPlus: document.querySelector("#factor-plus"),
  previewOldSpacing: document.querySelector("#preview-old-spacing"),
  previewNewSpacing: document.querySelector("#preview-new-spacing"),
  previewAxis: document.querySelector("#preview-axis"),
  previewDimensions: document.querySelector("#preview-dimensions"),
  previewSize: document.querySelector("#preview-size"),
  warning: document.querySelector("#warning"),
  generateButton: document.querySelector("#generate-button"),
  progressPanel: document.querySelector("#progress-panel"),
  progressLabel: document.querySelector("#progress-label"),
  progressValue: document.querySelector("#progress-value"),
  progressTrack: document.querySelector(".progress-track"),
  progressBar: document.querySelector("#progress-bar"),
  result: document.querySelector("#result"),
  resultName: document.querySelector("#result-name"),
  resultSummary: document.querySelector("#result-summary"),
  downloadLink: document.querySelector("#download-link"),
  slicerGuide: document.querySelector("#slicer-guide"),
  toast: document.querySelector("#toast"),
};

const worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
let metadata = null;
let selectedFile = null;
let downloadUrl = null;
let toastTimer = null;

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 100 || index === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function axisLabel(axis) {
  return axis.toUpperCase();
}

function resolvedAxis() {
  return elements.axisSelect.value === "auto"
    ? metadata?.autoAxis ?? "z"
    : elements.axisSelect.value;
}

function factorValue() {
  return Math.min(100, Math.max(2, Math.round(Number(elements.factorInput.value) || 10)));
}

function setProgress(value, label) {
  const safeValue = Math.min(100, Math.max(0, Math.round(value)));
  elements.progressPanel.hidden = false;
  elements.progressLabel.textContent = label;
  elements.progressValue.textContent = `${safeValue}%`;
  elements.progressTrack.setAttribute("aria-valuenow", String(safeValue));
  elements.progressBar.style.width = `${safeValue}%`;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 7000);
}

function clearResult() {
  elements.result.hidden = true;
  elements.slicerGuide.hidden = true;
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }
}

function updatePreview() {
  if (!metadata) return;
  const axis = resolvedAxis();
  const axisIndex = { x: 0, y: 1, z: 2 }[axis];
  const factor = factorValue();
  elements.factorInput.value = String(factor);

  const dimensions = [...metadata.dimensions];
  dimensions[axisIndex] = (dimensions[axisIndex] - 1) * factor + 1;
  const spacing = metadata.spacing[axisIndex];
  const outputSpacing = spacing / factor;
  const uncompressedBytes =
    dimensions.reduce((product, value) => product * value, 1) * metadata.bytesPerVoxel +
    metadata.voxOffset;

  elements.previewOldSpacing.textContent = `${formatNumber(spacing, 6)} mm`;
  elements.previewNewSpacing.textContent = `${formatNumber(outputSpacing, 6)} mm`;
  elements.previewAxis.textContent = `${axisLabel(axis)}方向 · ${factor}倍`;
  elements.previewDimensions.textContent = `${dimensions.join(" × ")} voxels`;
  elements.previewSize.textContent = `非圧縮時 約${humanBytes(uncompressedBytes)}`;
  elements.axisHint.textContent =
    elements.axisSelect.value === "auto"
      ? `最大spacingから${axisLabel(metadata.autoAxis)}軸を選択`
      : `${axisLabel(axis)}軸を手動選択中`;

  const warnings = [];
  if (dimensions[axisIndex] > 32767) {
    warnings.push(`${axisLabel(axis)}方向がNIfTI-1の上限32767を超えます。`);
  }
  if (uncompressedBytes > 1_000_000_000) {
    warnings.push("非圧縮時に1 GBを超えます。十分なメモリのあるPCで実行してください。");
  }
  if (metadata.slope !== 0 && metadata.slope !== 1) {
    warnings.push("scl_slopeが設定されています。ラベル値は元ファイルの生データを保持します。");
  }

  elements.warning.hidden = warnings.length === 0;
  elements.warning.textContent = warnings.join(" ");
  elements.generateButton.disabled =
    dimensions[axisIndex] > 32767 || uncompressedBytes > 2_000_000_000;
  clearResult();
}

function renderMetadata(file, loaded) {
  metadata = loaded;
  elements.dropZone.hidden = true;
  elements.fileCard.hidden = false;
  elements.settings.hidden = false;
  elements.fileName.textContent = file.name;
  elements.fileSize.textContent = `${humanBytes(file.size)} · ローカル`;
  elements.metaDimensions.textContent = loaded.dimensions.join(" × ");
  elements.metaSpacing.textContent = `${loaded.spacing
    .map((value) => formatNumber(value, 6))
    .join(" × ")} mm`;
  elements.metaDatatype.textContent = `${loaded.dataTypeName} (${loaded.bitpix} bit)`;
  if (loaded.labels.overflow) {
    elements.metaLabels.textContent = "256種類超";
  } else if (loaded.labels.values.length === 0) {
    elements.metaLabels.textContent = "背景のみ";
  } else {
    const values = loaded.labels.values;
    elements.metaLabels.textContent =
      values.length <= 8 ? values.join(", ") : `${values.slice(0, 7).join(", ")} … (${values.length})`;
  }
  elements.progressPanel.hidden = true;
  elements.generateButton.disabled = false;
  updatePreview();
}

function loadFile(file) {
  if (!file) return;
  if (!/\.nii(?:\.gz)?$/i.test(file.name)) {
    showToast(".nii または .nii.gz ファイルを選択してください。");
    return;
  }
  selectedFile = file;
  metadata = null;
  clearResult();
  elements.dropZone.hidden = false;
  elements.dropZone.classList.add("is-loading");
  elements.fileCard.hidden = true;
  elements.settings.hidden = true;
  elements.generateButton.disabled = true;
  worker.postMessage({ type: "load", file });
}

elements.fileInput.addEventListener("change", () => loadFile(elements.fileInput.files[0]));
elements.replaceFile.addEventListener("click", () => elements.fileInput.click());

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
}
elements.dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));

elements.axisSelect.addEventListener("change", updatePreview);
elements.factorInput.addEventListener("change", updatePreview);
elements.factorInput.addEventListener("input", () => {
  if (Number(elements.factorInput.value) >= 2) updatePreview();
});
elements.factorMinus.addEventListener("click", () => {
  elements.factorInput.value = String(factorValue() - 1);
  updatePreview();
});
elements.factorPlus.addEventListener("click", () => {
  elements.factorInput.value = String(factorValue() + 1);
  updatePreview();
});

elements.generateButton.addEventListener("click", () => {
  if (!metadata) return;
  clearResult();
  elements.generateButton.disabled = true;
  setProgress(0, "変換を開始しています…");
  worker.postMessage({
    type: "generate",
    axis: elements.axisSelect.value,
    factor: factorValue(),
  });
});

worker.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "progress") {
    setProgress(message.value, message.label);
    return;
  }

  if (message.type === "loaded") {
    elements.dropZone.classList.remove("is-loading");
    renderMetadata(selectedFile, message.metadata);
    return;
  }

  if (message.type === "generated") {
    downloadUrl = URL.createObjectURL(message.blob);
    elements.downloadLink.href = downloadUrl;
    elements.downloadLink.download = message.fileName;
    elements.resultName.textContent = message.fileName;
    elements.resultSummary.textContent = `${axisLabel(message.summary.axis)}方向 ${
      message.summary.factor
    }倍 · ${message.summary.dimensions.join(" × ")} · ${humanBytes(
      message.summary.compressedSize,
    )}`;
    elements.result.hidden = false;
    elements.slicerGuide.hidden = false;
    elements.generateButton.disabled = false;
    elements.result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }

  if (message.type === "error") {
    elements.dropZone.classList.remove("is-loading");
    elements.generateButton.disabled = !metadata;
    elements.progressPanel.hidden = true;
    if (message.operation === "load") {
      elements.dropZone.hidden = false;
      elements.fileCard.hidden = true;
      elements.settings.hidden = true;
    }
    showToast(message.message);
  }
});

worker.addEventListener("error", (event) => {
  elements.dropZone.classList.remove("is-loading");
  elements.generateButton.disabled = !metadata;
  elements.progressPanel.hidden = true;
  showToast(`処理を開始できませんでした: ${event.message}`);
});

if (
  typeof Worker === "undefined" ||
  typeof CompressionStream === "undefined" ||
  typeof DecompressionStream === "undefined"
) {
  elements.generateButton.disabled = true;
  showToast("最新版のChromeまたはEdgeで開いてください。");
}

window.addEventListener("beforeunload", () => {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
});
