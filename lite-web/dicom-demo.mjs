import { makeVolumeGeometry } from "./medical-geometry.mjs?v=3";

// Demo presentation only. Permute voxels and update the affine together; never
// rewrite the downloaded DICOM or change ordinary DICOM loading conventions.
export function orientAxialDicomDemo(volume) {
  const { width, height, depth, geometry } = volume;
  const a = geometry?.affine;
  if (!a || a.slice(0, 3).some((row, r) => row.slice(0, 3).some((v, c) =>
    r !== c && Math.abs(v) > 1e-6))) {
    throw new Error("This demo requires an axis-aligned axial DICOM series.");
  }
  // RAS: screen right = patient left, screen down = posterior, slices = superior.
  const flips = [a[0][0] > 0, a[1][1] > 0, a[2][2] < 0];
  const shape = [width, height, depth];
  const affine = a.map(row => [...row]);
  for (let axis = 0; axis < 3; axis++) {
    if (!flips[axis]) continue;
    for (let r = 0; r < 3; r++) {
      affine[r][3] += a[r][axis] * (shape[axis] - 1);
      affine[r][axis] = -a[r][axis];
    }
  }
  const orientedGeometry = makeVolumeGeometry({
    shape, affine, sourceKind: geometry.sourceKind, warnings: geometry.warnings,
  });
  const frames = Array.from({ length: depth }, (_, z) => {
    const frame = volume.frames[flips[2] ? depth - 1 - z : z];
    if (frame.kind !== "gray") throw new Error("This CT demo requires scalar DICOM pixels.");
    const arrays = new Map();
    const orient = input => {
      if (!input || (!flips[0] && !flips[1])) return input;
      if (arrays.has(input)) return arrays.get(input);
      const output = new input.constructor(input.length);
      for (let y = 0; y < height; y++) {
        const sourceY = flips[1] ? height - 1 - y : y;
        for (let x = 0; x < width; x++) {
          output[y * width + x] = input[sourceY * width + (flips[0] ? width - 1 - x : x)];
        }
      }
      arrays.set(input, output);
      return output;
    };
    return { ...frame, pixels: orient(frame.pixels),
      modalityPixels: orient(frame.modalityPixels), trainingPixels: orient(frame.trainingPixels) };
  });
  return { ...volume, frames, geometry: orientedGeometry,
    affine: orientedGeometry.affine, origin: orientedGeometry.origin, spacing: orientedGeometry.spacing };
}
