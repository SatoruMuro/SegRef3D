import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("workspace UI exposes the Objects, Image, and Tools mental model", async () => {
  const [ui, css] = await Promise.all([read("workspace-ui.mjs"), read("styles.css")]);
  assert.match(ui, /workspace\.replaceChildren\(labelsPanel, center, toolsAside\)/);
  assert.match(css, /grid-template-columns:\s*var\(--objects-width\) minmax\(360px, 1fr\) var\(--tools-width\)/);
  assert.match(ui, /toolTab\("draw", "Draw & Refine"/);
  assert.match(ui, /toolTab\("ai", "AI Segmentation"/);
  assert.match(ui, /toolTab\("check", "Project Check"/);
});

test("top commands and drawing scope are simplified without removing legacy controls", async () => {
  const ui = await read("workspace-ui.mjs");
  assert.match(ui, /commandButton\("undo-action", "Undo"/);
  assert.match(ui, /commandButton\("redo-action", "Redo"/);
  assert.match(ui, /Scope: All pending slices/);
  assert.match(ui, /legacy\.append\(undoLine, redoLine, undoEdit, redoEdit/);
});

test("slice navigation and unified history route through one public control set", async () => {
  const app = await read("app.mjs");
  assert.match(app, /function jumpToSlice\(sliceNumber\)/);
  assert.match(app, /elements\.sliceSlider\.addEventListener\("input"/);
  assert.match(app, /elements\.sliceNumber\.addEventListener\("input"/);
  assert.match(app, /function smartUndo\(\)/);
  assert.match(app, /function smartRedo\(\)/);
  assert.match(app, /event\.shiftKey \? smartRedo\(\) : smartUndo\(\)/);
});

test("responsive UI uses canvas-first drawers on narrow screens", async () => {
  const css = await read("styles.css");
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.labels-panel\.open\s*\{\s*transform: translateX\(0\)/s);
  assert.match(css, /\.tools-dock\.open\s*\{\s*transform: translateX\(0\)/s);
  assert.match(css, /\.image-workspace\s*\{[^}]*width: 100%/s);
});

test("NIfTI Labelmap exports expose original, 5x, and 10x geometry-preserving choices", async () => {
  const [html, app, ui] = await Promise.all([read("index.html"), read("app.mjs"), read("workspace-ui.mjs")]);
  assert.match(html, /Export NIfTI Labelmap/);
  assert.match(html, /NIfTI Labelmap \(5x\)/);
  assert.match(html, /NIfTI Labelmap \(10x\)/);
  assert.match(html, /load as\s+<strong>Segmentation<\/strong>/s);
  assert.match(app, /exportLabelVolume\("nifti", 5\)/);
  assert.match(app, /exportLabelVolume\("nifti", 10\)/);
  assert.match(ui, /preserving source CT\/MRI physical geometry/);
});
