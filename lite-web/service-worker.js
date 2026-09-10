const CACHE_NAME = "segref3d-lite-web-v55";
// Demo images and volumes are downloaded only when selected; cache on demand.
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css?v=35",
  "./app.mjs?v=52",
  "./physical-spacing.mjs?v=1",
  "./workspace-ui.mjs?v=33",
  "./core.mjs?v=28",
  "./mask-sequence.mjs?v=1",
  "./demo-datasets.mjs?v=6",
  "./image-tools.mjs?v=26",
  "./medical-io.mjs?v=25",
  "./medical-source.mjs?v=2",
  "./dicom-codec.mjs?v=1",
  "./training-export.mjs?v=2",
  "./custom-model.mjs?v=1",
  "./medical-geometry.mjs?v=3",
  "./instant3d-bridge.mjs?v=7",
  "../resources/totalsegmentator_roi_catalog.json",
  "./segmentation-job.mjs?v=17",
  "./mask-tools.mjs?v=21",
  "./storage.mjs?v=26",
  "./volume-tools.mjs?v=18",
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
