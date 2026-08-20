import assert from "node:assert/strict";
import test from "node:test";
import { createZip } from "../zip.mjs";

test("creates a readable ZIP32 structure with UTF-8 filenames", async () => {
  const zip = await createZip([
    { name: "mask0001.png", blob: new Blob([new Uint8Array([1, 2, 3])]) },
    { name: "overlay_日本語.png", blob: new Blob([new Uint8Array([4, 5])]) },
  ]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), 2);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /mask0001\.png/);
  assert.match(text, /overlay_日本語\.png/);
});
