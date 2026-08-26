function svgIcon(symbol) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${symbol}`);
  svg.append(use);
  return svg;
}

function commandButton(id, label, icon, className = "command-button") {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = className;
  if (icon) button.append(svgIcon(icon));
  const text = document.createElement("span");
  text.textContent = label;
  button.append(text);
  return button;
}

function toolTab(name, label, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.toolTab = name;
  button.textContent = label;
  button.title = title || label;
  button.setAttribute("role", "tab");
  button.setAttribute("aria-selected", String(name === "draw"));
  return button;
}

function createOpenMenu() {
  const menu = document.createElement("details");
  menu.id = "open-menu";
  menu.className = "toolbar-menu";
  const summary = document.createElement("summary");
  summary.className = "command-button accent";
  summary.append(svgIcon("i-folder"));
  const label = document.createElement("span");
  label.textContent = "Open";
  summary.append(label);
  const panel = document.createElement("div");
  panel.className = "toolbar-menu-panel open-menu-panel";
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", "Open project data");
  menu.append(summary, panel);
  return { menu, panel };
}

function createDrawPanel(drawSettings, editActions, clearLines) {
  const panel = document.createElement("section");
  panel.className = "tool-panel draw-refine-panel";
  panel.dataset.toolPanel = "draw";

  const target = document.createElement("div");
  target.className = "current-target-card";
  target.innerHTML = `
    <span>Current target</span>
    <strong id="current-target-display">Obj 1</strong>
    <small>Select an object in the left panel.</small>
  `;

  const drawHeading = document.createElement("div");
  drawHeading.className = "tool-section-heading";
  drawHeading.innerHTML = `<strong>Draw mode</strong><span>Choose how the pending region is shaped.</span>`;
  const operationHeading = document.createElement("div");
  operationHeading.className = "tool-section-heading";
  operationHeading.innerHTML = `<strong>Mask operation</strong><span>Apply to all slices that contain pending drawings.</span>`;

  const pending = document.createElement("div");
  pending.className = "pending-drawing-row";
  pending.innerHTML = `<span><strong>Pending drawing</strong><small>Scope: All pending slices</small></span>`;
  pending.append(clearLines);

  const targetField = drawSettings.querySelector("#target-label")?.closest("label");
  if (targetField) targetField.classList.add("legacy-target-field");
  panel.append(target, drawHeading, drawSettings, operationHeading, editActions, pending);
  return panel;
}

function createAiPanel(workflowDialog) {
  const panel = document.createElement("section");
  panel.id = "segonweb-workflow-dialog";
  panel.className = "tool-panel ai-workflow-panel";
  panel.dataset.toolPanel = "ai";
  panel.hidden = true;

  const shell = workflowDialog.querySelector(".workflow-dialog-shell");
  const close = shell?.querySelector("#segonweb-workflow-close");
  if (close) close.classList.add("legacy-control");
  const header = shell?.querySelector(".tools-dialog-header");
  if (header) header.remove();
  if (close) panel.append(close);
  while (shell?.firstChild) panel.append(shell.firstChild);
  workflowDialog.remove();
  return panel;
}

function createProjectPanel(checkButton, clearMasks) {
  const panel = document.createElement("section");
  panel.className = "tool-panel project-check-panel";
  panel.dataset.toolPanel = "check";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="tool-section-heading">
      <strong>Project health</strong>
      <span>Review dimensions, spacing, labels, frame gaps, and AI setup.</span>
    </div>
    <div id="project-health-detail" class="project-health-detail">Load a project to run validation.</div>
  `;
  checkButton.classList.add("accent");
  const destructive = document.createElement("div");
  destructive.className = "project-destructive-actions";
  destructive.innerHTML = `<strong>Project masks</strong><span>Destructive actions require confirmation.</span>`;
  destructive.append(clearMasks);
  panel.append(checkButton, destructive);
  return panel;
}

function enhanceCalibrationPanel(panel) {
  const grid = panel.querySelector(".calibration-grid");
  const actions = grid?.nextElementSibling;
  if (!grid || !actions) return;
  const spatial = document.createElement("div");
  spatial.className = "spatial-information";
  spatial.innerHTML = `
    <span>SPATIAL INFORMATION</span>
    <strong id="spatial-information-value">1 × 1 × 1 mm</strong>
    <small id="spatial-information-source">Default spacing</small>
  `;
  const details = document.createElement("details");
  details.id = "manual-calibration";
  details.className = "tool-disclosure";
  const summary = document.createElement("summary");
  summary.textContent = "Manual calibration";
  details.append(summary, grid, actions);
  panel.insertBefore(spatial, panel.firstChild);
  const guide = panel.querySelector("#demo-calibration-guide");
  if (guide) guide.after(details);
  else spatial.after(details);
}

export function upgradeWorkspaceLayout() {
  const app = document.querySelector("#app");
  const header = app.querySelector(".app-header");
  const commandBar = app.querySelector(".command-bar");
  const secondaryBar = app.querySelector(".secondary-bar");
  const workspace = app.querySelector(".workspace");
  const canvasPanel = document.querySelector("#canvas-panel");
  const labelsPanel = document.querySelector("#labels-panel");
  const oldStatus = app.querySelector(".status-bar");
  const oldToolsDialog = document.querySelector("#tools-dialog");
  const oldWorkflowDialog = document.querySelector("#segonweb-workflow-dialog");

  const projectSummary = header.querySelector(".project-summary");
  const projectDetails = document.createElement("span");
  projectDetails.id = "project-details";
  projectDetails.className = "project-details";
  projectDetails.textContent = "Open images or a volume to begin";
  projectSummary.insertBefore(projectDetails, document.querySelector("#autosave-indicator"));

  const headerActions = header.querySelector(".header-actions");
  const privacy = document.querySelector("#local-processing-status");
  privacy.classList.add("header-privacy-indicator");
  const projectHealth = commandButton("project-health", "Project Check", "i-check", "header-health-indicator");
  projectHealth.disabled = true;
  projectHealth.title = "Validate project dimensions, spacing, labels, frame gaps, and AI setup";
  headerActions.prepend(projectHealth, privacy);

  const folderInput = document.querySelector("#folder-input");
  const volumeInput = document.querySelector("#volume-input");
  const maskFolderInput = document.querySelector("#mask-folder-input");
  const maskZipInput = document.querySelector("#mask-zip-input");
  const loadFolder = document.querySelector("#load-folder");
  const loadVolume = document.querySelector("#load-volume");
  const loadMasks = document.querySelector("#load-masks");
  const fit = document.querySelector("#fit-view");
  const previous = document.querySelector("#previous-image");
  const next = document.querySelector("#next-image");
  const counter = document.querySelector("#image-counter");
  const exportMenu = document.querySelector("#export-menu");
  const drawSettings = commandBar.querySelector(".draw-settings");
  const editActions = commandBar.querySelector(".edit-actions");
  const clearLines = document.querySelector("#clear-lines");
  const clearMasks = document.querySelector("#clear-masks");
  const undoLine = document.querySelector("#undo-line");
  const redoLine = document.querySelector("#redo-line");
  const undoEdit = document.querySelector("#undo-edit");
  const redoEdit = document.querySelector("#redo-edit");
  const imageTools = document.querySelector("#image-tools");
  const workflowShortcut = document.querySelector("#segonweb-workflow");

  const { menu: openMenu, panel: openPanel } = createOpenMenu();
  const loadMasksLabel = loadMasks.querySelector("span");
  if (loadMasksLabel) loadMasksLabel.textContent = "Masks / Project ZIP";
  openPanel.append(loadFolder, loadVolume, loadMasks);
  const separator = document.createElement("hr");
  openPanel.append(separator);
  const appleDemo = commandButton("open-apple-demo", "Apple Demo", "i-image");
  const rabbitDemo = commandButton("open-rabbit-demo", "RabbitCT Demo", "i-box");
  openPanel.append(appleDemo, rabbitDemo);

  const undoAction = commandButton("undo-action", "Undo", "i-undo");
  const redoAction = commandButton("redo-action", "Redo", "i-redo");
  undoAction.disabled = true;
  redoAction.disabled = true;
  undoAction.title = "Undo the most recent pending drawing or mask edit (Ctrl+Z)";
  redoAction.title = "Redo the most recently undone action (Ctrl+Y or Ctrl+Shift+Z)";
  fit.classList.remove("icon-button");
  fit.classList.add("command-button");
  const fitLabel = document.createElement("span");
  fitLabel.textContent = "Fit";
  fit.append(fitLabel);

  const toolsToggle = commandButton("tools-toggle", "Tools", "i-sliders", "command-button mobile-tools-toggle");
  const topCommands = document.createElement("div");
  topCommands.className = "top-command-group";
  topCommands.append(openMenu, fit, undoAction, redoAction, exportMenu, toolsToggle);

  const legacy = document.createElement("div");
  legacy.className = "legacy-controls";
  legacy.hidden = true;
  legacy.append(undoLine, redoLine, undoEdit, redoEdit, imageTools, workflowShortcut);
  const inputs = document.createElement("div");
  inputs.className = "file-inputs";
  inputs.append(folderInput, volumeInput, maskFolderInput, maskZipInput);
  commandBar.replaceChildren(topCommands, inputs, legacy);
  secondaryBar.remove();

  const oldToolsShell = oldToolsDialog.querySelector(".tools-dialog-shell");
  const toolsAside = document.createElement("aside");
  toolsAside.id = "tools-dialog";
  toolsAside.className = "tools-dock";
  toolsAside.setAttribute("aria-label", "Tools");
  const toolsHeader = document.createElement("header");
  toolsHeader.className = "tools-dock-header";
  toolsHeader.innerHTML = `<div><span>TOOLS</span><strong>Image &amp; mask tools</strong></div>`;
  const toolsClose = oldToolsShell.querySelector("#tools-close");
  toolsClose.classList.add("mobile-only");
  toolsHeader.append(toolsClose);
  const tabs = document.createElement("div");
  tabs.className = "tools-category-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Tool categories");
  tabs.append(
    toolTab("draw", "Draw & Refine", "Drawing mode, mask operation, transfer, and Auto Apply"),
    toolTab("ai", "AI Segmentation", "Seg Anything and Seg CT/MRI workflows using Google Colab"),
    toolTab("display", "Display", "Window/level, brightness, and contrast"),
    toolTab("extract", "Extract", "Threshold and RGB extraction"),
    toolTab("cleanup", "Mask Cleanup", "Cleanup scope and signed-distance interpolation"),
    toolTab("calibration", "Calibration", "Spatial information and manual calibration"),
    toolTab("volume", "Volume & 3D", "Volume statistics, preview, and volume exports"),
    toolTab("check", "Project Check", "Validate project consistency"),
  );
  const body = document.createElement("div");
  body.className = "tools-dock-body";
  body.append(createDrawPanel(drawSettings, editActions, clearLines));
  body.append(createAiPanel(oldWorkflowDialog));

  const oldTabs = oldToolsShell.querySelector(".tools-tabs");
  oldTabs.remove();
  for (const panel of [...oldToolsShell.querySelectorAll(".tool-panel")]) body.append(panel);
  const toolsNavigation = oldToolsShell.querySelector(".tools-frame-navigation");
  toolsNavigation.classList.add("legacy-control");
  body.append(toolsNavigation);
  const checkButton = oldToolsShell.querySelector("#check-project");
  body.append(createProjectPanel(checkButton, clearMasks));
  enhanceCalibrationPanel(body.querySelector('[data-tool-panel="calibration"]'));
  const demoHeading = body.querySelector(".demo-calibration-heading");
  if (demoHeading) {
    const progress = document.createElement("span");
    progress.id = "demo-guide-progress";
    progress.className = "demo-guide-progress";
    progress.textContent = "Step 2 of 5";
    demoHeading.append(progress);
  }
  const tooltipMap = new Map([
    [document.querySelector('[data-mode="free"]'), "Draw a freehand closed region"],
    [document.querySelector('[data-mode="click"]'), "Place points with left click; right click the final point to close a smooth region"],
    [document.querySelector('[data-mode="snap"]'), "Place points near image edges; right click the final point to close"],
    [document.querySelector("#transfer-mask"), "Transfer only the current target pixels inside pending regions"],
    [document.querySelector("#auto-apply-mode"), "Apply Add, Erase, or Transfer when a drawing closes"],
    [document.querySelector("#cleanup-scope"), "Choose the current slice, a frame range, or all slices"],
    [document.querySelector("#apply-interpolation"), "Interpolate the selected object between endpoint masks using signed distances"],
    [document.querySelector("#export-nifti"), "Export the editable label masks as a NIfTI volume"],
    [document.querySelector("#export-project"), "Download images, masks, settings, and spatial information as a Project ZIP"],
  ]);
  for (const [control, title] of tooltipMap) {
    if (control) control.title = title;
  }
  toolsAside.append(toolsHeader, tabs, body);
  oldToolsDialog.remove();

  const center = document.createElement("div");
  center.className = "image-workspace";
  const sliceBar = document.createElement("div");
  sliceBar.className = "slice-status-bar";
  const navigation = document.createElement("div");
  navigation.className = "slice-navigation";
  navigation.setAttribute("aria-label", "Slice navigation");
  const number = document.createElement("input");
  number.id = "slice-number";
  number.className = "slice-number-input";
  number.type = "number";
  number.min = "1";
  number.step = "1";
  number.value = "1";
  number.disabled = true;
  number.setAttribute("aria-label", "Current slice number");
  const slider = document.createElement("input");
  slider.id = "slice-slider";
  slider.className = "slice-slider";
  slider.type = "range";
  slider.min = "1";
  slider.max = "1";
  slider.value = "1";
  slider.disabled = true;
  slider.setAttribute("aria-label", "Current slice");
  navigation.append(previous, number, counter, slider, next);
  const statusMessage = oldStatus.querySelector(".status-message");
  const imageMeta = document.querySelector("#image-meta");
  sliceBar.append(navigation, statusMessage, imageMeta);
  center.append(canvasPanel, sliceBar);
  oldStatus.remove();

  workspace.replaceChildren(labelsPanel, center, toolsAside);
  workspace.classList.add("workspace-redesigned");

  return {
    appleDemo,
    rabbitDemo,
    undoAction,
    redoAction,
    toolsToggle,
  };
}
