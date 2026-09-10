import assert from "node:assert/strict";
import test from "node:test";
import { demoDatasetById } from "../demo-datasets.mjs";
import { volumeStatistics, createVolumeStatisticsCsv } from "../mask-tools.mjs";
import { createVolInfoCsv, parseVolInfoCsv } from "../volume-tools.mjs";
import { physicalSpacingState, measurementSpacing, spacingStatus, formatSpacing, spatialInformation,
  applyReferenceCalibration, restorePhysicalSpacing, statisticsDisplayUnit, formatVolumeNumber } from "../physical-spacing.mjs";

test("HeLa retains its exact mm calculation while spacing and small volumes are readable", () => {
  const spacing = demoDatasetById("hela-em-demo").voxelSpacingMm;
  assert.deepEqual(spacing, [0.0000390625, 0.0000390625, 0.0001]);
  assert.equal(formatSpacing(spacing), "39.06 × 39.06 × 100 nm");
  const masks = [new Uint8Array(10000).fill(1)];
  const stats = volumeStatistics(masks, 100, 100, spacing);
  assert.equal(stats.rows[0].volumeMm3, 10000 * spacing.reduce((p,v) => p*v, 1));
  assert.equal(stats.rows[0].volumeMm3 * 1e9, 1.52587890625);
  assert.deepEqual(statisticsDisplayUnit(stats.rows), { unit: "µm³", factor: 1e9 });
  assert.notEqual(formatVolumeNumber(stats.rows[0].volumeMm3), "0");
  const [header, row] = createVolumeStatisticsCsv(stats).trim().split(/\r?\n/).map(line => line.split(","));
  for (const [name, value] of [["volume_mm3",stats.rows[0].volumeMm3], ["volume_cm3",stats.rows[0].volumeCm3], ["volume_um3",1.52587890625]]) {
    assert.equal(Number(row[header.indexOf(name)]), value);
  }
  assert.equal(formatSpacing([0.7, 0.8, 2]), "0.7000 × 0.8000 × 2.000 mm");
  assert.equal(formatSpacing([0.002, 0.002, 0.005]), "2 × 2 × 5 µm");
});

test("Mouse reference calibration gates physical volume and preserves estimated Z/provenance", () => {
  const demo = demoDatasetById("mouse-brain-demo");
  const calibration = { xSpacing:1, ySpacing:1, zSpacing:demo.estimatedSliceSpacingMm, referenceLength:demo.referenceCalibrationWidthMm };
  const physical = physicalSpacingState("unknown", "estimated", { referenceApproximate:true, referenceLengthMm:11.4, requiresReferenceCalibration:true });
  assert.equal(demo.guide.primaryValue, "11.4 mm (approx.)");
  assert.equal(spacingStatus(physical), "requiresCalibration");
  assert.equal(measurementSpacing(calibration, physical), null);
  assert.match(spatialInformation(calibration, physical), /X\/Y: Unknown.*Z: 0.10 mm \/ 100 µm \(estimated\)/);
  assert.doesNotMatch(spatialInformation(calibration, physical), /1 × 1 × 1/);
  const masks = [new Uint8Array([1,1])];
  assert.equal(volumeStatistics(masks, 2, 1, measurementSpacing(calibration,physical)).rows[0].volumeMm3, null);
  const done = applyReferenceCalibration(calibration, physical, 570);
  assert.deepEqual(measurementSpacing(done.calibration, done.physicalSpacing), [0.02,0.02,0.1]);
  assert.equal(spacingStatus(done.physicalSpacing), "estimated");
  assert.equal(volumeStatistics(masks,2,1,measurementSpacing(done.calibration,done.physicalSpacing)).rows[0].volumeMm3, 2*0.02*0.02*0.1);
  assert.match(spatialInformation(done.calibration, done.physicalSpacing), /calibrated from 11.4 mm reference/);
  assert.equal(physical.xy, "unknown", "calibration must not mutate another source's provenance");
  assert.throws(() => applyReferenceCalibration(calibration,physical,0), /different/);
});

test("Project and VolInfo provenance roundtrip cannot promote unknown placeholders", () => {
  const unknown = physicalSpacingState("unknown","estimated",{referenceApproximate:true,referenceLengthMm:11.4,requiresReferenceCalibration:true});
  assert.deepEqual(restorePhysicalSpacing(JSON.parse(JSON.stringify(unknown)), physicalSpacingState()), unknown);
  assert.deepEqual(restorePhysicalSpacing(null, unknown, "Unknown physical spacing — calibrate before measurement"),unknown);
  assert.equal(restorePhysicalSpacing(null,physicalSpacingState(),"Reference line calibration").xy,"user-calibrated");
  const physical = {...unknown, xy:"user-calibrated"};
  const csv = createVolInfoCsv({width:2,height:2,depth:2,spacing:[0.02,0.02,0.1],physicalSpacing:physical});
  assert.deepEqual(parseVolInfoCsv(csv).physicalSpacing, physical);
  assert.equal(spacingStatus(physicalSpacingState("metadata","metadata")),"known");
  assert.equal(spacingStatus(physicalSpacingState()),"requiresCalibration");
});
