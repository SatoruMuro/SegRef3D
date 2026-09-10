// Calculation stays in mm. Provenance, not placeholder numbers or UI prose,
// determines whether a grid supports physical measurements.
const SOURCES = new Set(["unknown", "metadata", "estimated", "user-calibrated", "manual"]);

export function physicalSpacingState(xy = "unknown", z = "unknown", extra = {}) {
  return { xy, z, ...extra };
}

export function measurementSpacing(calibration, physical) {
  const values = [calibration.xSpacing, calibration.ySpacing, calibration.zSpacing];
  return SOURCES.has(physical?.xy) && SOURCES.has(physical?.z) &&
    physical.xy !== "unknown" && physical.z !== "unknown" &&
    values.every(v => Number.isFinite(v) && v > 0) ? values : null;
}

export function spacingStatus(physical) {
  if (!physical || physical.xy === "unknown" || physical.z === "unknown") return "requiresCalibration";
  return physical.z === "estimated" || physical.referenceApproximate ? "estimated" : "known";
}

export function formatSpacing(spacing) {
  const maximum = Math.max(...spacing);
  const [factor, unit] = maximum < 0.001 ? [1e6, "nm"] : maximum < 0.1 ? [1e3, "µm"] : [1, "mm"];
  return `${spacing.map(v => factor === 1 ? Number(v).toPrecision(4) : Number((v * factor).toPrecision(4))).join(" × ")} ${unit}`;
}

export function spatialInformation(calibration, physical) {
  const measured = measurementSpacing(calibration, physical);
  if (physical?.referenceApproximate) {
    const xy = physical.xy === "unknown" ? "Unknown — calibration required"
      : `${Number(calibration.xSpacing).toPrecision(4)} mm calibrated from ${physical.referenceLengthMm} mm reference (approx.)`;
    return `X/Y: ${xy} · Z: ${calibration.zSpacing.toFixed(2)} mm / ${calibration.zSpacing * 1000} µm (estimated)`;
  }
  return measured ? formatSpacing(measured) : "Unknown — calibration required";
}

export function physicalSpacingNote(physical) {
  if (physical?.referenceApproximate) return `X/Y: ${physical.xy === "unknown" ? "user calibration required" : "user-calibrated"} using approximate ${physical.referenceLengthMm} mm adult mouse brain reference, not a measurement of this specimen. Z: estimated 100 µm effective interval, not original histological section thickness; not supplied in source metadata.`;
  return `X/Y: ${physical?.xy || "unknown"}; Z: ${physical?.z || "unknown"}`;
}

export function applyReferenceCalibration(calibration, physical, pixelLength) {
  if (!(Number.isFinite(pixelLength) && pixelLength > 0)) throw new Error("Calibration points must be different.");
  const spacing = calibration.referenceLength / pixelLength;
  return {
    calibration: { ...calibration, xSpacing: spacing, ySpacing: spacing },
    physicalSpacing: { ...physical, xy: "user-calibrated" },
  };
}

export function restorePhysicalSpacing(saved, fallback, legacySource = "") {
  if (saved && SOURCES.has(saved.xy) && SOURCES.has(saved.z)) {
    const restored = physicalSpacingState(saved.xy, saved.z);
    if (saved.referenceApproximate && Number(saved.referenceLengthMm) > 0) {
      Object.assign(restored, { referenceApproximate: true, referenceLengthMm: Number(saved.referenceLengthMm), requiresReferenceCalibration: true });
    }
    return restored;
  }
  // Compatibility only: old Project ZIPs had no explicit provenance. Never infer
  // validity merely because a free-form source string differs from "Default".
  if (["Manual settings", "Reference line calibration", "DICOM metadata", "NIfTI metadata"].includes(legacySource)) {
    if (legacySource.endsWith("metadata")) return physicalSpacingState("metadata", "metadata");
    return physicalSpacingState(legacySource === "Reference line calibration" ? "user-calibrated" : "manual", "manual");
  }
  return { ...fallback };
}

export function formatVolumeNumber(value, digits = 4) {
  if (value === null) return "—";
  if (value !== 0 && Math.abs(value) < 10 ** -digits) return value.toExponential(3);
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function statisticsDisplayUnit(rows) {
  const positive = rows.map(row => row.volumeMm3).filter(v => v > 0);
  return positive.length && Math.max(...positive) < 0.001 ? { unit: "µm³", factor: 1e9 } : { unit: "mm³", factor: 1 };
}
