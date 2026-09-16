import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { LEGACY_SVG_COLORS, decodeLegacySvg, encodeLegacySvg, createSvgMaskEntries, mapSvgEntries } from "../legacy-svg.mjs";
import { combineLabelMasks } from "../core.mjs";
import { createZip, parseZip } from "../zip.mjs";

const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6" viewBox="0 0 8 6">${body}</svg>`;
const rect = (fill = "#ff0000") => `<rect x="1" y="1" width="3" height="2" fill="${fill}"/>`;
const images = () => Array.from({length: 4}, (_, z) => ({width: 8, height: 6, mask: new Uint8Array(48), dicom:{sourceFilename:`slice${4-z}.dcm`}}));
const entries = () => [4, 1, 3, 2].map(n => ({name:`folder/legacy-mask${String(n).padStart(4,"0")}.svg`}));

test("Local GPU production exporter/parser fixtures are pixel-identical in Lite", async () => {
  const fixture = JSON.parse(await readFile(new URL("../../test-data/legacy-svg/expected.json", import.meta.url)));
  assert.deepEqual(LEGACY_SVG_COLORS.slice(1), fixture.palette.map(rgb => "#"+rgb.map(v=>v.toString(16).padStart(2,"0")).join("")));
  for (const c of fixture.cases) {
    const text = await readFile(new URL(`../../test-data/legacy-svg/${c.file}`, import.meta.url), "utf8");
    assert.deepEqual([...decodeLegacySvg(text, c.width, c.height)], c.labels, c.file);
  }
});

test("SVG export/import is lossless for all labels, holes, border pixels and empty slices", async () => {
  const frames = images();
  frames[0].mask.set([1,2,0,20,3,4,0,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]);
  for (let i=0;i<48;i++) frames[1].mask[i] = (i*17 + Math.floor(i/8)) % 21;
  frames[2].mask.fill(1); frames[2].mask[19] = 0; frames[2].mask[28] = 2;
  const archive = await parseZip(await createZip(createSvgMaskEntries(frames)));
  const manifest = JSON.parse(new TextDecoder().decode(archive.find(e=>e.name.endsWith(".json")).bytes));
  const mappings = mapSvgEntries(archive.reverse(), frames, {manifest, order:"reverse"});
  for (const m of mappings) assert.deepEqual(decodeLegacySvg(new TextDecoder().decode(m.entry.bytes),8,6),m.image.mask);
  assert.equal(manifest.sliceOrder, "segref3d-canonical-v1");
  assert.equal(manifest.frameCount,4);
  assert.equal(manifest.objects[0].color,"#ff0000");
  assert.equal(manifest.objects[1].color,"#0000ff");
  assert.equal(mappings[0].zIndex,0);
});

test("100 decimal-coordinate contours match Local Qt pixel boundaries exactly", async () => {
  const cases=JSON.parse(await readFile(new URL("../../test-data/legacy-svg/decimal-parity.json",import.meta.url)));
  for (const c of cases) assert.deepEqual([...decodeLegacySvg(c.svg,64,48)],[...Buffer.from(c.labelsBase64,"base64")]);
});

test("100 cubic/quadratic/smooth curves match the Local Qt outline mapper exactly", async () => {
  const cases=JSON.parse(await readFile(new URL("../../test-data/legacy-svg/curve-parity.json",import.meta.url)));
  for (const c of cases) assert.deepEqual([...decodeLegacySvg(c.svg,64,48)],[...Buffer.from(c.labelsBase64,"base64")]);
});

test("legacy colors, document-order overwrite, style precedence, forced evenodd and polyline closure", () => {
  assert.equal(decodeLegacySvg(svg(rect()),8,6)[9],1);
  assert.equal(decodeLegacySvg(svg(rect("rgb(0,0,255)")),8,6)[9],2);
  assert.equal(decodeLegacySvg(svg(rect()+rect("#0000ff")),8,6)[9],2);
  assert.equal(decodeLegacySvg(svg('<rect x="1" y="1" width="2" height="2" fill="#ff0000" style="fill:#0000ff"/>'),8,6)[9],2);
  const hole = decodeLegacySvg(svg('<path d="M0 0H8V6H0Z M2 2H6V4H2Z" fill="#ff0000" fill-rule="nonzero"/>'),8,6);
  assert.equal(hole[0],1); assert.equal(hole[19],0);
  const relative = decodeLegacySvg(svg('<path d="m1 1 h3 v2 h-3 z" fill="#ff0000"/>'),8,6);
  assert.deepEqual(relative,decodeLegacySvg(svg(rect()),8,6));
  const prefixed=svg(rect()).replace('<svg xmlns=', '<ns0:svg xmlns:ns0=').replace('</svg>','</ns0:svg>').replace('<rect','<ns0:rect');
  assert.deepEqual(decodeLegacySvg(prefixed,8,6),decodeLegacySvg(svg(rect()),8,6));
  assert.throws(()=>decodeLegacySvg(prefixed.replace('xmlns:ns0','xmlns:other'),8,6),/namespace/);
});

test("strict numbered mapping detects missing slices, duplicates, zero-base and off-by-one", () => {
  const frames = images();
  const mappings = mapSvgEntries(entries(),frames);
  assert.deepEqual(mappings.map(m=>m.zIndex),[0,1,2,3]);
  assert.match(mappings[0].entry.name,/0001/);
  assert.throws(()=>mapSvgEntries(entries().slice(1),frames),/complete sequence/);
  for (const name of ["mask0000.svg","mask0005.svg","mask0002.svg","mask.svg"]) {
    const input=entries();input[0]={name};
    assert.throws(()=>mapSvgEntries(input,frames),/slice number/);
  }
});

test("old natural DICOM filename order is mapped to canonical positions, including reverse and nontrivial permutations", () => {
  const frames = images();
  assert.deepEqual(mapSvgEntries(entries(),frames,{order:"legacy-filename"}).map(m=>m.zIndex),[3,2,1,0]);
  assert.deepEqual(mapSvgEntries(entries(),frames,{order:"reverse"}).map(m=>m.zIndex),[3,2,1,0]);
  [frames[0],frames[1]]=[frames[1],frames[0]];
  assert.deepEqual(mapSvgEntries(entries(),frames,{order:"legacy-filename"}).map(m=>m.zIndex),[3,2,0,1]);
  frames[1].dicom.sourceFilename=frames[0].dicom.sourceFilename;
  assert.throws(()=>mapSvgEntries(entries(),frames,{order:"legacy-filename"}),/unique/);
});

test("manifest rejects reversed/off-by-one filenames and mismatched geometry/palette", async () => {
  const frames=images(), exported=createSvgMaskEntries(frames);
  const manifest=JSON.parse(await exported.at(-1).blob.text());
  const reordered=structuredClone(manifest);
  reordered.objects=reordered.objects.map(({id,color})=>({color,id}));
  assert.equal(mapSvgEntries(exported,frames,{manifest:reordered}).length,4);
  for (const mutate of [m=>m.files.reverse(),m=>m.files[0].zIndex=1,m=>m.files[0].filename="mask0000.svg",m=>m.width=9,m=>m.frameCount=3,m=>m.objects[0].color="#ff1616",m=>m.sliceOrder="reversed"]) {
    const copy=structuredClone(manifest);mutate(copy);
    assert.throws(()=>mapSvgEntries(exported,frames,{manifest:copy}));
  }
});

test("geometry mismatch, absent dimensions, nonzero viewBox origin and unsupported units never resize", () => {
  for (const invalid of [svg(rect()).replace('width="8"','width="9"'),svg(rect()).replace('height="6"','height="7"'),svg(rect()).replace('viewBox="0 0 8 6"','viewBox="1 0 8 6"'),svg(rect()).replace('width="8"','width="8mm"'),svg(rect()).replace('width="8"','')]) {
    assert.throws(()=>decodeLegacySvg(invalid,8,6),/grid|viewBox|dimensions/);
  }
});

test("fail-closed SVG subset prevents executable content and network references", () => {
  const invalid = [
    '<script>alert(1)</script>', '<image href="https://example.invalid/a"/>',
    '<foreignObject/>', '<use href="#x"/>', '<style>path { fill: red }</style>',
    '<rect width="1" height="1" onload="alert(1)"/>',
    '<rect width="1" height="1" fill="url(https://example.invalid/a)"/>',
    '<rect width="1" height="1" style="fill:javascript:alert(1)"/>',
    '<rect width="1" height="1" style="fill:u\\72l(x)"/>',
    '<g transform="translate(2)">'+rect()+'</g>',
    '<path d="M 0 0 C 1 1 2 2" fill="#ff0000"/>',
    '<path d="M 0 0 A 1 1 0 0 0 2 2" fill="#ff0000"/>',
    rect("#ff1616"), '<rect width="1" height="1" fill="#ff0000" data-label-id="2"/>',
    '<rect width="1" height="1" fill="&#35;ff0000"/>',
    '<svg width="8" height="6"/>', '<path d="M 0"/>', '<g>'+rect(),
  ];
  for (const body of invalid) assert.throws(()=>decodeLegacySvg(svg(body),8,6),undefined,body);
  assert.throws(()=>decodeLegacySvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///x">]>'+svg(rect()),8,6));
  assert.throws(()=>decodeLegacySvg('<?xml-stylesheet href="https://example.invalid/x"?>'+svg(rect()),8,6));
  assert.throws(()=>decodeLegacySvg('x'.repeat(16_000_001),8,6),/limit/);
});

test("SVG uses existing PNG Replace/Merge semantics without losing non-overlapping labels", () => {
  const imported=decodeLegacySvg(svg(rect()),8,6), current=new Uint8Array(48);
  current[0]=20;current[9]=2;
  const merged=combineLabelMasks(current,imported,"merge");
  assert.equal(merged[0],20);assert.equal(merged[9],1);assert.equal(current[9],2);
  assert.deepEqual(combineLabelMasks(current,imported,"replace"),imported);
  assert.throws(()=>encodeLegacySvg(new Uint8Array([21]),1,1),/Obj 20/);
});
