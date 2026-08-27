const CACHE_NAME = "segref3d-lite-web-v40";
const APPLE_DEMO_FILES = Array.from(
  { length: 20 },
  (_, index) => `./demo/apple-kanzi-84/apple_${String(index + 1).padStart(4, "0")}.jpg`,
);
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css?v=32",
  "./app.mjs?v=38",
  "./workspace-ui.mjs?v=30",
  "./core.mjs?v=27",
  "./demo-datasets.mjs?v=3",
  "./image-tools.mjs?v=25",
  "./medical-io.mjs?v=20",
  "./medical-geometry.mjs?v=2",
  "./instant3d-bridge.mjs?v=3",
  "../resources/totalsegmentator_roi_catalog.json",
  "./segmentation-job.mjs?v=17",
  "./mask-tools.mjs?v=20",
  "./storage.mjs?v=25",
  "./volume-tools.mjs?v=17",
  "./three-viewer.mjs?v=17",
  "./zip.mjs?v=25",
  "./vendor/dicom-parser.min.js",
  "./vendor/fflate.mjs",
  "./vendor/nifti-reader.js",
  "./vendor/nifti1.js",
  "./vendor/nifti2.js",
  "./vendor/nifti-extension.js",
  "./vendor/utif.module.js",
  "./vendor/three.module.min.js",
  "./vendor/three.core.min.js",
  "./vendor/OrbitControls.js",
  "./vendor/THREE-LICENSE.txt",
  "./vendor/utilities.js",
  "./favicon.ico",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./manifest.webmanifest",
  ...APPLE_DEMO_FILES,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
