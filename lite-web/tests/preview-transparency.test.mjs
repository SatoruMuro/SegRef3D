import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewTransparency } from "../preview-transparency.mjs";

test("OIT declines unsupported float rendering without allocating targets", () => {
  assert.equal(createPreviewTransparency({ extensions: { has: () => false } }), null);
});

test("OIT restores the renderer and disposes targets when a framebuffer is incomplete", () => {
  const initialTarget = {}, disposed = new Set();
  let currentTarget = initialTarget;
  const gl = {
    RGBA16F: 1, RGBA8: 2, DEPTH_COMPONENT24: 3,
    FRAMEBUFFER_COMPLETE: 10,
    getInternalformatParameter: () => [4, 2],
    checkFramebufferStatus: () => 0,
  };
  const renderer = {
    extensions: { has: () => true }, getContext: () => gl,
    getRenderTarget: () => currentTarget,
    setRenderTarget(target) {
      currentTarget = target;
      if (target !== initialTarget) target.addEventListener("dispose", () => disposed.add(target));
    },
  };
  assert.equal(createPreviewTransparency(renderer), null);
  assert.equal(currentTarget, initialTarget);
  assert.equal(disposed.size, 3);
});
