const CACHE_NAME = "segref3d-lite-web-v17";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css?v=17",
  "./app.mjs?v=17",
  "./core.mjs",
  "./image-tools.mjs",
  "./medical-io.mjs?v=17",
  "./segmentation-job.mjs?v=17",
  "./mask-tools.mjs?v=17",
  "./storage.mjs",
  "./volume-tools.mjs?v=15",
  "./three-viewer.mjs?v=17",
  "./zip.mjs",
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
  "./favicon.svg",
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
