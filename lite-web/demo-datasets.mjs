const appleImages = Array.from(
  { length: 20 },
  (_, index) => `./demo/apple-kanzi-84/apple_${String(index + 1).padStart(4, "0")}.jpg`,
);

export const DEMO_DATASETS = Object.freeze([
  Object.freeze({
    id: "apple-kanzi-84",
    revision: 1,
    displayName: "Apple Demo",
    projectName: "Apple Demo - Kanzi 84",
    sourceFormat: "demo",
    imagePaths: Object.freeze(appleImages),
    calibration: Object.freeze({
      referenceLengthMm: 75,
      sliceSpacingMm: 4,
      instruction: "Draw a calibration line across the widest diameter of the apple.",
      referenceNote:
        "75 mm is an assumed typical apple diameter for demonstration purposes, not a measurement of this specimen.",
      spacingNote: "The source dataset describes the slice spacing as roughly 4 mm.",
    }),
    nextStep: "Next: segment the outer contour of the apple.",
    attribution: Object.freeze({
      citation:
        "Schut DE, Trull AK, Couvée M. Dataset of CT scans, slice photographs, and visual browning scores of 120 'Kanzi' apples. Zenodo.",
      doiUrl: "https://doi.org/10.5281/zenodo.8167285",
      licenseName: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      adaptation: "Images were selected, cropped, and resized for the SegRef3D demo.",
    }),
  }),
]);

export function demoDatasetById(id) {
  return DEMO_DATASETS.find((dataset) => dataset.id === id) ?? null;
}
