const CACHE_NAME = "segref3d-lite-web-v14";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.mjs",
  "./core.mjs",
  "./image-tools.mjs",
  "./medical-io.mjs",
  "./segmentation-job.mjs",
  "./storage.mjs",
  "./volume-tools.mjs",
  "./zip.mjs",
  "./vendor/dicom-parser.min.js",
  "./vendor/fflate.mjs",
  "./vendor/nifti-reader.js",
  "./vendor/nifti1.js",
  "./vendor/nifti2.js",
  "./vendor/nifti-extension.js",
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
