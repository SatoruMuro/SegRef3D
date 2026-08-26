import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const liteWebRoot = new URL("../", import.meta.url);

async function readLiteWebFile(name) {
  return readFile(new URL(name, liteWebRoot), "utf8");
}

test("local-processing UI and Seg on Web confirmation are wired into the app", async () => {
  const [html, app] = await Promise.all([
    readLiteWebFile("index.html"),
    readLiteWebFile("app.mjs"),
  ]);

  assert.match(html, /id="local-processing-status"/);
  assert.match(html, /id="local-processing-dialog"/);
  assert.match(html, /id="segonweb-warning-dialog"/);
  assert.match(html, /segonweb_input\.zip.*working image sequence/s);
  assert.match(app, /elements\.segOnWeb\.addEventListener\("click"/);
  assert.match(app, /event\.preventDefault\(\);[\s\S]*elements\.segonwebWarningDialog\.showModal\(\)/);
});

test("offline cache uses the current UI asset generation", async () => {
  const [html, worker] = await Promise.all([
    readLiteWebFile("index.html"),
    readLiteWebFile("service-worker.js"),
  ]);

  assert.match(html, /styles\.css\?v=19/);
  assert.match(html, /app\.mjs\?v=19/);
  assert.match(worker, /segref3d-lite-web-v19/);
  assert.match(worker, /styles\.css\?v=19/);
  assert.match(worker, /app\.mjs\?v=19/);
});

test("Lite Web runtime has no image-upload or telemetry transport", async () => {
  const names = (await readdir(liteWebRoot)).filter((name) => name.endsWith(".mjs"));
  const forbiddenTransports = [
    ["fetch", /\bfetch\s*\(/],
    ["XMLHttpRequest", /\bXMLHttpRequest\b/],
    ["WebSocket", /\bWebSocket\b/],
    ["Beacon API", /\bsendBeacon\s*\(/],
    ["FormData upload", /\bFormData\b/],
    ["analytics", /\banalytics\b/i],
    ["telemetry", /\btelemetry\b/i],
  ];

  for (const name of names) {
    const source = await readLiteWebFile(name);
    for (const [label, pattern] of forbiddenTransports) {
      assert.doesNotMatch(source, pattern, `${name} unexpectedly contains ${label}`);
    }
  }
});
