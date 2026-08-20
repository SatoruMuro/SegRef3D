import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { createZip, parseZip } from "../zip.mjs";

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
  const entries = await parseZip(bytes.buffer);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, "mask0001.png");
  assert.deepEqual([...entries[0].bytes], [1, 2, 3]);
});

test("reads deflated ZIP entries created by standard archivers", async () => {
  const original = new TextEncoder().encode("SegRef3D project manifest");
  const stored = new Uint8Array(
    await (
      await createZip([{ name: "segref3d-project.json", blob: new Blob([original]) }])
    ).arrayBuffer(),
  );
  const sourceView = new DataView(stored.buffer);
  const nameLength = sourceView.getUint16(26, true);
  const dataStart = 30 + nameLength;
  const centralOffset = sourceView.getUint32(stored.length - 6, true);
  const compressed = new Uint8Array(deflateRawSync(original));
  const output = new Uint8Array(stored.length - original.length + compressed.length);
  const outputView = new DataView(output.buffer);
  output.set(stored.subarray(0, dataStart));
  output.set(compressed, dataStart);
  const nextCentralOffset = dataStart + compressed.length;
  output.set(stored.subarray(centralOffset, stored.length - 22), nextCentralOffset);
  output.set(stored.subarray(stored.length - 22), output.length - 22);
  outputView.setUint16(8, 8, true);
  outputView.setUint32(18, compressed.length, true);
  outputView.setUint16(nextCentralOffset + 10, 8, true);
  outputView.setUint32(nextCentralOffset + 20, compressed.length, true);
  outputView.setUint32(output.length - 6, nextCentralOffset, true);

  const entries = await parseZip(output.buffer);
  assert.equal(entries.length, 1);
  assert.equal(new TextDecoder().decode(entries[0].bytes), "SegRef3D project manifest");
});
