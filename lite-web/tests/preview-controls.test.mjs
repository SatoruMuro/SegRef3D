import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "../vendor/three.module.min.js";
import { PreviewControls } from "../preview-controls.mjs";
import { createPreviewCamera, resetPreviewCamera } from "../three-viewer.mjs";

function fixture(width = 1000, height = 500) {
  const listeners = new Map(), captures = new Set();
  const element = {
    style: { touchAction: "pan-y" },
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id),
  };
  const camera = createPreviewCamera();
  assert.deepEqual(camera.up.toArray(), [0, 0, 1]);
  const controls = new PreviewControls(camera, element);
  resetPreviewCamera(camera, controls, 10);
  const event = (type, props = {}) => listeners.get(type)?.({
    pointerId: 1, pointerType: "mouse", button: 0, clientX: 300, clientY: 200,
    preventDefault() {}, ...props,
  });
  return { camera, controls, element, listeners, captures, event,
    resize(w, h) { width = w; height = h; camera.aspect = w / h; } };
}
const close = (a, b) => assert.ok(a.distanceTo(b) < 1e-9, `${a.toArray()} != ${b.toArray()}`);

test("Z-up is established before controller initialization; reset restores orientation and target", () => {
  const { camera, controls } = fixture();
  const position = camera.position.clone(), up = camera.up.clone(), quaternion = camera.quaternion.clone();
  controls.rotate(217, 316); controls.pan(50, -80); controls.dolly(0.5);
  resetPreviewCamera(camera, controls, 10);
  close(camera.position, position); close(camera.up, up); close(controls.target, new Vector3());
  assert.ok(camera.quaternion.angleTo(quaternion) < 1e-7);
  close(camera.getWorldDirection(new Vector3()), position.clone().negate().normalize());
  assert.ok(Math.abs(camera.up.dot(position.clone().normalize())) < 1e-12);
});

test("rotation uses 200 degrees per width/height and survives resize and pole crossings", () => {
  const a = fixture(), b = fixture(400, 1200);
  a.controls.rotate(100, 50); b.controls.rotate(40, 120);
  close(a.camera.position, b.camera.position); close(a.camera.up, b.camera.up);
  a.resize(600, 300); b.resize(1200, 800);
  a.controls.rotate(60, 30); b.controls.rotate(120, 80);
  close(a.camera.position, b.camera.position);
  resetPreviewCamera(a.camera, a.controls, 10);
  const start = a.camera.position.clone(), initialUp = a.camera.up.clone();
  for (let i = 0; i < 36; i++) a.controls.rotate(0, 300 / 20);
  close(a.camera.position, start); close(a.camera.up, initialUp);
  const expected = start.clone().applyAxisAngle(initialUp, -20 * Math.PI / 180);
  a.controls.rotate(60, 0); close(a.camera.position, expected);
});

test("pointer release/cancel/reset stop immediately; disposal releases capture and listeners", () => {
  const f = fixture();
  f.event("pointerdown"); f.event("pointermove", { clientX: 350 }); f.event("pointerup");
  const stopped = f.camera.position.clone();
  f.event("pointermove", { clientX: 600 });
  for (let i = 0; i < 60; i++) f.controls.update();
  close(f.camera.position, stopped);
  for (const end of ["pointercancel", "lostpointercapture"]) {
    f.event("pointerdown"); f.event(end); f.event("pointermove", { clientX: 900 });
    close(f.camera.position, stopped);
  }
  f.event("pointerdown"); resetPreviewCamera(f.camera, f.controls, 10);
  assert.equal(f.captures.size, 0);
  f.event("pointerdown"); f.controls.dispose();
  assert.equal(f.captures.size, 0); assert.equal(f.listeners.size, 0);
  assert.equal(f.element.style.touchAction, "pan-y");
});

test("middle/Shift-left pan, right/Shift-Ctrl-left dolly, Ctrl-left spin, and wheel bindings", () => {
  for (const props of [{ button: 1 }, { shiftKey: true }]) {
    const f = fixture(), offset = f.camera.position.clone().sub(f.controls.target);
    f.event("pointerdown", props); f.event("pointermove", { clientX: 340, clientY: 220 });
    assert.ok(f.controls.target.length() > 0); close(f.camera.position.clone().sub(f.controls.target), offset);
  }
  for (const props of [{ button: 2 }, { shiftKey: true, ctrlKey: true }]) {
    const f = fixture(), distance = f.camera.position.length();
    f.event("pointerdown", props); f.event("pointermove", { clientY: 240 });
    assert.ok(f.camera.position.length() > distance);
  }
  const f = fixture(), position = f.camera.position.clone(), up = f.camera.up.clone();
  f.event("pointerdown", { ctrlKey: true }); f.event("pointermove", { clientY: 100 });
  close(f.camera.position, position); assert.ok(f.camera.up.distanceTo(up) > 0.1);
  f.event("pointerup"); f.event("wheel", { deltaY: -100, deltaMode: 0 });
  assert.ok(f.camera.position.length() < position.length());
  let prevented = false;
  f.event("contextmenu", { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test("touch retains one-finger rotation and two-finger pinch/pan", () => {
  const f = fixture(), before = f.camera.position.clone();
  f.event("pointerdown", { pointerType: "touch" });
  f.event("pointermove", { pointerType: "touch", clientX: 340 });
  assert.ok(f.camera.position.distanceTo(before) > 0);
  f.event("pointerdown", { pointerType: "touch", pointerId: 2, clientX: 500 });
  const distance = f.camera.position.distanceTo(f.controls.target);
  f.event("pointermove", { pointerType: "touch", pointerId: 2, clientX: 600 });
  assert.ok(f.camera.position.distanceTo(f.controls.target) < distance);
  assert.ok(f.controls.target.length() > 0);
});
