import { MathUtils, Vector3 } from "./vendor/three.module.min.js";

// VTK-style azimuth/elevation: 200 degrees across each viewport dimension.
// Unlike OrbitControls, view-up follows the camera through the poles. Unlike
// a virtual trackball, ordinary left drags do not introduce a separate roll.
export class PreviewControls {
  constructor(camera, element) {
    this.camera = camera;
    this.element = element;
    this.target = new Vector3();
    this.onChange = () => {};
    this.minDistance = 0.001;
    this.maxDistance = Infinity;
    this.pointers = new Map();
    this.oldTouchAction = element.style.touchAction;
    element.style.touchAction = "none";
    this.listeners = {
      pointerdown: (event) => this.pointerDown(event),
      pointermove: (event) => this.pointerMove(event),
      pointerup: (event) => this.pointerEnd(event),
      pointercancel: (event) => this.pointerEnd(event),
      lostpointercapture: (event) => this.pointerEnd(event),
      contextmenu: (event) => event.preventDefault(),
      wheel: (event) => {
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.rect().height : 1;
        this.dolly(Math.exp(MathUtils.clamp(event.deltaY * unit * 0.002, -1, 1)));
      },
    };
    for (const [type, listener] of Object.entries(this.listeners)) {
      element.addEventListener(type, listener, { passive: false });
    }
  }

  rect() {
    const rect = this.element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
  }

  update() {
    const backward = this.camera.position.clone().sub(this.target).normalize();
    const right = new Vector3().crossVectors(this.camera.up, backward).normalize();
    this.camera.up.crossVectors(backward, right).normalize();
    this.camera.lookAt(this.target);
    this.onChange();
  }

  rotate(dx, dy) {
    const { width, height } = this.rect();
    const offset = this.camera.position.clone().sub(this.target);
    const angle = 200 * MathUtils.DEG2RAD;
    offset.applyAxisAngle(this.camera.up, -angle * dx / width);
    const right = new Vector3().crossVectors(this.camera.up, offset).normalize();
    offset.applyAxisAngle(right, -angle * dy / height);
    this.camera.up.applyAxisAngle(right, -angle * dy / height);
    this.camera.position.copy(this.target).add(offset);
    this.update();
  }

  pan(dx, dy) {
    const { width, height } = this.rect();
    const offset = this.camera.position.clone().sub(this.target);
    const span = 2 * offset.length() * Math.tan(this.camera.fov * MathUtils.DEG2RAD / 2) / this.camera.zoom;
    const right = new Vector3().crossVectors(this.camera.up, offset).normalize();
    const translation = right.multiplyScalar(-dx * span * this.camera.aspect / width)
      .addScaledVector(this.camera.up, dy * span / height);
    this.camera.position.add(translation);
    this.target.add(translation);
    this.update();
  }

  dolly(factor) {
    const offset = this.camera.position.clone().sub(this.target);
    offset.setLength(MathUtils.clamp(offset.length() * factor, this.minDistance, this.maxDistance));
    this.camera.position.copy(this.target).add(offset);
    this.update();
  }

  spin(previous, current) {
    const rect = this.rect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    // The polar angle is ill-defined at the center; ignore that small region.
    if (Math.hypot(previous.x - cx, previous.y - cy) < 8 || Math.hypot(current.x - cx, current.y - cy) < 8) return;
    const angle = Math.atan2(current.y - cy, current.x - cx) - Math.atan2(previous.y - cy, previous.x - cx);
    const backward = this.camera.position.clone().sub(this.target).normalize();
    this.camera.up.applyAxisAngle(backward, angle);
    this.update();
  }

  pointerDown(event) {
    if (event.button > 2 || (event.pointerType !== "touch" && this.pointers.size)) return;
    event.preventDefault();
    const mode = event.button === 1 || (event.shiftKey && !event.ctrlKey) ? "pan"
      : event.button === 2 || (event.shiftKey && event.ctrlKey) ? "dolly"
        : event.ctrlKey || event.metaKey ? "spin" : "rotate";
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, mode });
    this.element.setPointerCapture(event.pointerId);
  }

  pointerMove(event) {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    event.preventDefault();
    const current = { ...previous, x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, current);
    const dx = current.x - previous.x, dy = current.y - previous.y;
    if (event.pointerType === "touch" && this.pointers.size === 2) {
      const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)[1];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(current.x - other.x, current.y - other.y);
      if (before > 1 && after > 1) this.dolly(before / after);
      this.pan(dx / 2, dy / 2);
    } else if (this.pointers.size === 1) {
      if (current.mode === "rotate") this.rotate(dx, dy);
      else if (current.mode === "pan") this.pan(dx, dy);
      else if (current.mode === "spin") this.spin(previous, current);
      else this.dolly(Math.exp(2 * dy / this.rect().height));
    }
  }

  pointerEnd(event) {
    this.pointers.delete(event.pointerId);
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
  }

  cancelGesture() {
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    for (const id of ids) {
      if (this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id);
    }
  }

  dispose() {
    for (const [type, listener] of Object.entries(this.listeners)) this.element.removeEventListener(type, listener);
    this.cancelGesture();
    this.element.style.touchAction = this.oldTouchAction;
  }
}
