import assert from "node:assert/strict";
import test from "node:test";

import { trianglesToPositions } from "../three-viewer.mjs";

test("converts shared STL triangles into Three.js position buffers", () => {
  const positions = trianglesToPositions([
    [[0, 1, 2], [3, 4, 5], [6, 7, 8]],
    [[9, 10, 11], [12, 13, 14], [15, 16, 17]],
  ]);
  assert.equal(positions instanceof Float32Array, true);
  assert.deepEqual([...positions], Array.from({ length: 18 }, (_, index) => index));
});
