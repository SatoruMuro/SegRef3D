import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Colab shortcut is present before dataset creation and preserves the ready link", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const shortcut = html.match(/<p\b[^>]*id="colab-shortcut"[^>]*>[\s\S]*?<\/p>/)?.[0];
  assert.ok(shortcut, "Shortcut exists in initial HTML");
  assert.match(shortcut, /Already have a Dataset ZIP\?/);
  assert.match(shortcut, /class="hint"/);
  assert.doesNotMatch(shortcut, /\bhidden\b|\b(?:button|primary)\b/);
  assert.match(shortcut, /title="Opening Colab does not upload anything automatically\."/);
  assert.match(shortcut, />Open TrainRef3D Colab ↗<\/a>/);
  assert.match(html, /<p class="privacy">[\s\S]*?<\/p>\s*<p id="colab-shortcut"[\s\S]*?<\/p>\s*<section aria-labelledby="load-heading">/);
  const ready = html.match(/<section id="ready" hidden[^>]*>[\s\S]*?<\/section>/)?.[0];
  assert.ok(ready, "Dataset ready remains hidden initially");
  assert.match(ready, /<a class="button"[^>]*>Open TrainRef3D Colab<\/a>/);
  assert.match(ready, /id="download" class="button primary"/);
  for (const section of [shortcut, ready]) {
    const link = section.match(/<a\b[^>]*href="\.\.\/ColabNotebooks\/trainref3d\.html"[^>]*>/)?.[0];
    assert.ok(link, "Both links use the existing Colab launcher");
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noopener noreferrer"/);
  }
});
