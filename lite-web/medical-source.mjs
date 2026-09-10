// A medical source keeps scalar voxels and their native IJK grid together.
// Its transport is NIfTI even when the user opened a DICOM series.
import { createNiftiScalarVolume } from "./training-export.mjs?v=2";
import { affineOrientation } from "./medical-io.mjs?v=25";

export function dicomMedicalSource(volume) {
  if (!volume.geometry) throw new Error(volume.geometryWarnings?.join(" ") || "DICOM patient geometry is missing.");
  if (!["CT", "MRI"].includes(volume.modality)) {
    throw new Error("DICOM Modality must be CT or MR and consistent throughout the series.");
  }
  const { width, height, depth, frames, geometry } = volume;
  if (volume.hasModalityLut) throw new Error("DICOM Modality LUT Sequence is not supported for SegCT/MRI in Lite.");
  const a = geometry.affine;
  const determinant = a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
    - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
    + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  if (Math.abs(determinant) < 1e-8) throw new Error("DICOM slice positions do not define an invertible 3D patient affine.");
  if (frames.length !== depth || frames.some((frame) =>
    frame.width !== width || frame.height !== height ||
    !(frame.modalityPixels instanceof Float32Array) || frame.modalityPixels.length !== width * height ||
    frame.modalityPixels.some((value) => !Number.isFinite(value)))) {
    throw new Error("DICOM requires finite scalar voxel values on one consistent 3D grid.");
  }
  if (depth === 1 && !(volume.declaredSliceSpacing > 0)) {
    throw new Error("Single-slice DICOM requires SpacingBetweenSlices or SliceThickness.");
  }
  // Match the actual float32 NIfTI header, avoiding checksum/affine differences
  // from serializing higher precision DICOM decimal strings in the manifest.
  const bytes = createNiftiScalarVolume({
    values: frames.map((frame) => frame.modalityPixels), width, height, depth,
    geometry, datatype: "float32",
  });
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const affine = geometry.affine.map((row, y) => row.map((value, x) =>
    y < 3 ? header.getFloat32(280 + y * 16 + x * 4, true) : value));
  return {
    format: "nifti", sourceKind: "dicom", modality: volume.modality,
    filename: "source.nii", bytes, shape: [width, height, depth], affine,
    spacing: [0, 1, 2].map((axis) => header.getFloat32(80 + axis * 4, true)),
    orientation: affineOrientation(affine),
  };
}
