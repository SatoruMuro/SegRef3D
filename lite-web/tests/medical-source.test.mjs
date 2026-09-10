import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dicomMedicalSource } from "../medical-source.mjs";
import { dicomSeriesGeometry } from "../medical-geometry.mjs";
import { parseNiftiLabelVolume } from "../medical-io.mjs";
import { createNiftiScalarVolume, readNiftiTrainingVolume } from "../training-export.mjs";
import { createInstant3DRequest, geometryMismatches, sha256Hex, validateInstant3DResult } from "../instant3d-bridge.mjs";

const catalog = JSON.parse(await readFile(new URL("../../resources/totalsegmentator_roi_catalog.json", import.meta.url)));
function volume(modality = "MRI", iop = [0.8, 0.6, 0, -0.48, 0.64, 0.6]) {
  const i = iop.slice(0, 3), j = iop.slice(3);
  const n = [i[1]*j[2]-i[2]*j[1], i[2]*j[0]-i[0]*j[2], i[0]*j[1]-i[1]*j[0]];
  const instances = Array.from({ length: 4 }, (_, k) => ({
    columns: 6, rows: 5, imageOrientation: iop, pixelSpacing: [1.1, 0.7],
    imagePosition: [31.25, -22.5, 17.75].map((o, a) => o + k * (n[a]*2.3 + i[a]*0.12)),
  }));
  return { width: 6, height: 5, depth: 4, modality,
    geometry: dicomSeriesGeometry(instances), frames: instances.map((_, k) => ({
      width: 6, height: 5, modalityPixels: Float32Array.from({ length: 30 }, (_, p) => (p+k*100-20)*(2+k)-1024),
    })),
  };
}

for (const modality of ["CT", "MRI"]) {
  for (const iop of [[1,0,0,0,1,0], [1,0,0,0,0,-1], [0,1,0,0,0,1], [0.8,0.6,0,-0.48,0.64,0.6]]) {
    test(`${modality} DICOM source retains scalars and mask coordinates for ${iop}`, async () => {
      const decoded = volume(modality, iop);
      const source = dicomMedicalSource(decoded);
      source.sha256 = await sha256Hex(source.bytes);
      const read = readNiftiTrainingVolume(source.bytes);
      assert.deepEqual([...read.values], decoded.frames.flatMap((f) => [...f.modalityPixels]));
      assert.deepEqual(read.shape, [6,5,4]);
      const task = modality === "MRI" ? "total_mr" : "total";
      const { manifest } = await createInstant3DRequest({ source, objects: [{object_id: 3, task, roi: "liver"}], catalog });
      assert.equal(manifest.source.modality, modality);
      assert.deepEqual(geometryMismatches(manifest.source, source), []);
      const values = new Uint8Array(120);
      values[2*30+1*6+4] = values[0*30+3*6+1] = 3;
      const bytes = createNiftiScalarVolume({ values, width: 6, height: 5, depth: 4, geometry: read.geometry });
      const entries = [
        { name: "manifest.json", bytes: new TextEncoder().encode(JSON.stringify({ ...manifest, status: "success" })) },
        { name: "labelmap/labels.nii.gz", bytes },
      ];
      const result = validateInstant3DResult(entries, source, catalog);
      const labels = parseNiftiLabelVolume(result.labelmap.bytes, "labels.nii");
      assert.deepEqual(geometryMismatches(manifest.source, labels, {includeChecksum: false}), []);
      assert.equal(labels.frames[2][1*6+4], 3);
      assert.equal(labels.frames[0][3*6+1], 3);
      const shifted = { ...source, affine: source.affine.map((row) => [...row]) };
      shifted.affine[0][3] += 0.7;
      assert.throws(() => validateInstant3DResult(entries, shifted, catalog), /affine/);
      assert.throws(() => validateInstant3DResult(entries, { ...source, sha256: "bad" }, catalog), /checksum/);
    });
  }
}

test("DICOM errors identify missing metadata, scalar values, modality and single-slice spacing", () => {
  assert.throws(() => dicomMedicalSource({...volume(), geometry: null, geometryWarnings: ["ImagePositionPatient missing"]}), /ImagePositionPatient/);
  assert.throws(() => dicomMedicalSource(volume("PT")), /Modality/);
  const missing = volume(); missing.frames[0].modalityPixels = null;
  assert.throws(() => dicomMedicalSource(missing), /scalar/);
  const single = volume(); single.depth = 1; single.frames = single.frames.slice(0,1);
  assert.throws(() => dicomMedicalSource(single), /SliceThickness/);
});

test("MRI catalog uses 50 official total_mr ROIs and rejects CT task assignments", async () => {
  const mr = catalog.structures.filter((item) => item.modality.includes("MRI"));
  assert.equal(mr.length, 50);
  assert.ok(mr.every((item) => item.task === "total_mr"));
  await assert.rejects(createInstant3DRequest({ source: dicomMedicalSource(volume()),
    objects: [{object_id: 1, task: "total", roi: "liver"}], catalog }), /not available for MRI/);
});
