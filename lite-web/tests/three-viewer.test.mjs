import assert from "node:assert/strict";
import test from "node:test";

import { trianglesToPositions, setSurfaceOpacity } from "../three-viewer.mjs";
import { MeshStandardMaterial } from "../vendor/three.module.min.js";

test("opacity transitions update blending, depth and program state in both directions", () => {
  const material = new MeshStandardMaterial();
  for (const opacity of [1, 0.5, 0.1, 1, 0.999, 0.998, 0]) {
    const version = material.version, transparent = material.transparent;
    setSurfaceOpacity(material, opacity);
    assert.equal(material.opacity, opacity);
    assert.equal(material.transparent, opacity < 0.999);
    assert.equal(material.depthWrite, opacity >= 0.999);
    assert.equal(material.depthTest, true);
    assert.equal(material.version, version + Number(transparent !== material.transparent));
  }
  setSurfaceOpacity(material, "0.5"); assert.equal(material.opacity, 0.5);
  setSurfaceOpacity(material, NaN); assert.equal(material.opacity, 0.5);
  setSurfaceOpacity(material, 2); assert.equal(material.opacity, 1);
  setSurfaceOpacity(material, -2); assert.equal(material.opacity, 0);
});

test("converts shared STL triangles into Three.js position buffers", () => {
  const positions = trianglesToPositions([
    [[0, 1, 2], [3, 4, 5], [6, 7, 8]],
    [[9, 10, 11], [12, 13, 14], [15, 16, 17]],
  ]);
  assert.equal(positions instanceof Float32Array, true);
  assert.deepEqual([...positions], Array.from({ length: 18 }, (_, index) => index));
});
