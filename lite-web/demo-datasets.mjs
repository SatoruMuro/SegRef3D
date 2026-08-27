const appleImages = Array.from(
  { length: 20 },
  (_, index) => `./demo/apple-kanzi-84/apple_${String(index + 1).padStart(4, "0")}.jpg`,
);

export const DEMO_DATASETS = Object.freeze([
  Object.freeze({
    id: "apple-kanzi-84",
    revision: 2,
    kind: "image-sequence",
    displayName: "Apple Demo",
    projectName: "Apple Demo - Kanzi 84",
    sourceFormat: "demo",
    imagePaths: Object.freeze(appleImages),
    calibration: Object.freeze({
      referenceLengthMm: 100,
      sliceSpacingMm: 4,
      instruction: "Draw a calibration line across the widest diameter of the apple.",
      referenceNote:
        "100 mm is an assumed apple diameter for demonstration purposes, not a measurement of this specimen.",
      spacingNote: "The source dataset describes the slice spacing as roughly 4 mm.",
    }),
    guide: Object.freeze({
      toolTab: "calibration",
      title: "Apple Demo Calibration",
      instruction: "Draw a calibration line across the widest diameter of the apple.",
      primaryLabel: "Reference length",
      primaryValue: "100 mm",
      secondaryLabel: "Slice spacing",
      secondaryValue: "4.0 mm (approx.)",
      note: "100 mm is an assumed apple diameter for demonstration purposes, not a measurement of this specimen.",
      detail: "The source dataset describes the slice spacing as roughly 4 mm.",
      nextStep: "Next: segment the outer contour of the apple.",
      revealNextStepAfterCalibration: true,
    }),
    attribution: Object.freeze({
      uiPrefix: "Images adapted from",
      citation:
        "Schut DE, Trull AK, Couvée M. Dataset of CT scans, slice photographs, and visual browning scores of 120 'Kanzi' apples. Zenodo.",
      doiUrl: "https://doi.org/10.5281/zenodo.8167285",
      licenseName: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      adaptation: "Images were selected, cropped, and resized for the SegRef3D demo.",
    }),
  }),
  Object.freeze({
    id: "rabbitct-reference-256",
    revision: 1,
    kind: "nifti-volume",
    displayName: "RabbitCT Demo",
    projectName: "RabbitCT Demo - Reference 256",
    sourceFormat: "nifti",
    volumePath: "./demo/rabbitct/RabbitCT_reference_256_corrected.nii.gz",
    volumeFilename: "RabbitCT_reference_256_corrected.nii.gz",
    volumeBytes: 20071402,
    initialFrameIndex: 127,
    voxelSpacingMm: Object.freeze([1, 1, 1]),
    volumeInfoSource: "NIfTI metadata",
    guide: Object.freeze({
      toolTab: "extract",
      title: "RabbitCT Demo",
      instruction: "This demo uses a reconstructed CT volume.",
      primaryLabel: "Voxel spacing",
      primaryValue: "1.0 mm isotropic",
      secondaryLabel: "Suggested target",
      secondaryValue: "Skull or body contour",
      note: "Voxel spacing is preset to 1.0 mm in X, Y, and Z; no calibration line is required.",
      detail: "Try Threshold or drawing tools to segment a high-contrast structure.",
      nextStep: "Next: refine the mask, then preview the reconstruction in Volume & 3D.",
      revealNextStepAfterCalibration: false,
    }),
    attribution: Object.freeze({
      uiPrefix: "Volume adapted from",
      citation: "RabbitCT benchmark dataset. Zenodo record 21267885.",
      doiUrl: "https://zenodo.org/records/21267885",
      licenseName: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      adaptation:
        "The original reference volume was converted to NIfTI and reoriented for SegRef3D Lite demo use.",
    }),
  }),
]);

export function demoDatasetById(id) {
  return DEMO_DATASETS.find((dataset) => dataset.id === id) ?? null;
}
