import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseZip } from '../zip.mjs';
import { demoDatasetById } from '../demo-datasets.mjs';
import { parseDicomInstance, groupDicomSeries, decodeDicomSeries } from '../medical-io.mjs';
import { dicomMedicalSource } from '../medical-source.mjs';
import { orientAxialDicomDemo } from '../dicom-demo.mjs';
const dicomParser = createRequire(import.meta.url)('../vendor/dicom-parser.min.js');

test('TCIA demo retains every original DICOM and continuous CT geometry', async () => {
  const demo = demoDatasetById('pancreas-ct-demo');
  const base = new URL('../demo/pancreas-ct/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
  const zip = await readFile(new URL('PANCREAS_0080.zip',base));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(zip.length, demo.volumeBytes);
  assert.equal(hash(zip), demo.archiveSha256);
  assert.equal(hash(zip), manifest.archive.sha256);
  const entries = await parseZip(new Blob([zip])); // Checks every entry's CRC.
  assert.equal(entries.length,182);
  assert.deepEqual(Buffer.from(entries.find(e=>e.name==='LICENSE').bytes),await readFile(new URL('LICENSE.txt',base)));
  const files = entries.filter(e=>e.name.endsWith('.dcm'));
  assert.equal(files.length,181);
  for(const file of files) assert.equal(hash(file.bytes), manifest.files.find(f=>f.path===file.name).sha256);
  const instances = files.map(e=>parseDicomInstance(e.bytes.buffer.slice(e.bytes.byteOffset,e.bytes.byteOffset+e.bytes.byteLength),e.name,dicomParser));
  const series = groupDicomSeries(instances);
  assert.equal(series.length,1);
  const volume = decodeDicomSeries(series[0].items);
  assert.equal(volume.frames.length,181);
  assert.deepEqual(volume.geometryWarnings,[]);
  assert.deepEqual(volume.spacing,[0.9765625,0.9765625,1]);
  assert.ok(volume.frames.every(f=>f.width===512 && f.height===512 && f.modalityPixels));
  const oriented = orientAxialDicomDemo(volume);
  assert.ok(oriented.affine[0][0] < 0, 'screen right is patient left');
  assert.ok(oriented.affine[1][1] < 0, 'screen down is posterior in RAS');
  assert.ok(oriented.affine[2][2] > 0, 'slice order is caudal to cranial');
  assert.equal(oriented.frames[0].dicom.imagePositionPatient[2], -180);
  assert.equal(oriented.frames.at(-1).dicom.imagePositionPatient[2], 0);
  const point = (a,x,y,z) => a.slice(0,3).map(r=>r[0]*x+r[1]*y+r[2]*z+r[3]);
  for(let z=0; z<181; z++) {
    const original = volume.frames[180-z];
    for(let y=0; y<512; y++) {
      assert.deepEqual(oriented.frames[z].modalityPixels.subarray(y*512,(y+1)*512),
        original.modalityPixels.subarray((511-y)*512,(512-y)*512));
    }
    assert.equal(oriented.frames[z].trainingPixels, oriented.frames[z].modalityPixels);
    for(const [x,y] of [[0,0],[511,511],[137,283]]) {
      assert.deepEqual(point(oriented.affine,x,y,z),point(volume.affine,x,511-y,180-z));
    }
  }
  assert.equal(volume.affine[1][1],0.9765625, 'original decoded geometry is unchanged');
  assert.equal(volume.affine[2][2],-1);
  const source = dicomMedicalSource(oriented);
  assert.deepEqual(source.affine, oriented.affine);
  const nifti = new DataView(source.bytes.buffer,source.bytes.byteOffset,source.bytes.byteLength);
  for(const [x,y,z] of [[0,0,0],[137,283,90],[511,511,180]]) {
    assert.equal(nifti.getFloat32(352+4*(z*512*512+y*512+x),true),
      volume.frames[180-z].modalityPixels[(511-y)*512+x]);
  }
  assert.equal(source.modality,'CT');
  assert.equal(source.sourceKind,'dicom');
  assert.deepEqual(source.shape,[512,512,181]);
  assert.equal(manifest.manualSegmentationIncluded,false);
  assert.equal(manifest.license,'CC BY 3.0');
  assert.match(manifest.citation,/Roth H, Farag A/);
  assert.equal(manifest.doiUrl,demo.attribution.doiUrl);
  assert.equal(demo.initialFrameIndex,90);
  assert.deepEqual(demo.displayDefaults,{windowCenter:40,windowWidth:400});
});
