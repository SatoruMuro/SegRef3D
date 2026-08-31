// Stable import boundary for segref3d-training-case-1.0 consumers.
// Deliberately independent of either application's state, canvas and display loaders.
import { boundedDecompress, CASE_LIMITS, readSafeZip } from "./training-archive.mjs?v=1";
export const TRAINING_CASE_FORMAT = "segref3d-training-case-1.0";
export const TOLERANCE = 1e-5;
const types = { 2:["uint8",1,"getUint8",true], 4:["int16",2,"getInt16",true], 8:["int32",4,"getInt32",true],
  16:["float32",4,"getFloat32",false], 64:["float64",8,"getFloat64",false],
  256:["int8",1,"getInt8",true], 512:["uint16",2,"getUint16",true], 768:["uint32",4,"getUint32",true] };
export const validCaseId = value => typeof value === "string" && /^SR3D_[a-f0-9]{8,32}$/i.test(value);
export function orientation(affine) {
  const used = new Set();
  return [0,1,2].map(axis => {
    const world = [0,1,2].filter(i => !used.has(i)).sort((a,b) => Math.abs(affine[b][axis])-Math.abs(affine[a][axis]))[0];
    used.add(world);
    return (affine[world][axis] >= 0 ? "RAS" : "LPI")[world];
  }).join("");
}
export function validateGeometry(g) {
  const finite = x => typeof x === "number" && Number.isFinite(x);
  if (!Array.isArray(g?.shape) || g.shape.length !== 3 || g.shape.some(x => !Number.isSafeInteger(x) || x < 1)
      || !Array.isArray(g.affine) || g.affine.length !== 4 || g.affine.some(row => !Array.isArray(row) || row.length !== 4 || !row.every(finite))
      || !Array.isArray(g.spacing_mm) || g.spacing_mm.length !== 3 || g.spacing_mm.some(x => !finite(x) || x <= 0)) throw new Error("Invalid geometry shape, spacing or affine.");
  const a = g.affine;
  const det = a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1])-a[0][1]*(a[1][0]*a[2][2]-a[1][2]*a[2][0])+a[0][2]*(a[1][0]*a[2][1]-a[1][1]*a[2][0]);
  if (Math.abs(det) < 1e-12 || a[3].some((x,i) => Math.abs(x-(i===3?1:0)) >= TOLERANCE)) throw new Error("Singular or invalid affine.");
  for (let i=0;i<3;i++) if (Math.abs(Math.hypot(a[0][i],a[1][i],a[2][i])-g.spacing_mm[i]) >= TOLERANCE) throw new Error("Spacing does not match affine.");
  if (g.origin_mm && (g.origin_mm.length !== 3 || g.origin_mm.some((x,i) => !finite(x) || Math.abs(x-a[i][3]) >= TOLERANCE))) throw new Error("Origin does not match affine.");
  if (g.orientation !== undefined && g.orientation !== orientation(a)) throw new Error("Orientation does not match affine.");
  return g;
}
export function sameGeometry(a, b) {
  validateGeometry(a); validateGeometry(b);
  if (a.shape.some((x,i) => x !== b.shape[i]) || a.spacing_mm.some((x,i) => Math.abs(x-b.spacing_mm[i]) >= TOLERANCE)
      || a.affine.some((row,i) => row.some((x,j) => Math.abs(x-b.affine[i][j]) >= TOLERANCE))) throw new Error("Image / label / manifest geometry mismatch.");
}
function quaternionAffine(b,c,d,origin,spacing,qfac) {
  const norm = b*b+c*c+d*d;
  let a = Math.sqrt(Math.max(0,1-norm));
  if (norm > 1) { const n=Math.sqrt(norm); b/=n;c/=n;d/=n;a=0; }
  const matrix = [[a*a+b*b-c*c-d*d,2*(b*c-a*d),2*(b*d+a*c)],
    [2*(b*c+a*d),a*a+c*c-b*b-d*d,2*(c*d-a*b)], [2*(b*d-a*c),2*(c*d+a*b),a*a+d*d-c*c-b*b]];
  return [...matrix.map((row,i) => [...row.map((x,j) => x*spacing[j]*(j===2 && qfac<0?-1:1)),origin[i]]),[0,0,0,1]];
}
export async function inspectNifti(input, { labels = false, limit = CASE_LIMITS.expanded } = {}) {
  let bytes = input;
  if (bytes[0] === 31 && bytes[1] === 139) bytes = await boundedDecompress(new Blob([bytes]), "gzip", limit);
  if (bytes.length < 352 || bytes.length > limit) throw new Error("Invalid or oversized NIfTI.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const le = [348,540].includes(v.getInt32(0,true));
  const version = v.getInt32(0,le);
  if (![348,540].includes(version)) throw new Error("Not a NIfTI-1/2 volume.");
  const n2 = version === 540, f = n2 ? (o=>v.getFloat64(o,le)) : (o=>v.getFloat32(o,le));
  const integer64 = o => { const n=Number(v.getBigInt64(o,le)); if (!Number.isSafeInteger(n)) throw new Error("Oversized NIfTI integer."); return n; };
  if (bytes.length < (n2?544:352) || (n2 ? String.fromCharCode(...bytes.subarray(4,8)) !== "n+2\0" : String.fromCharCode(...bytes.subarray(344,348)) !== "n+1\0")) throw new Error("Only single-file NIfTI is supported.");
  const dims = Array.from({length:8},(_,i)=>n2?integer64(16+i*8):v.getInt16(40+i*2,le));
  if (dims[0]<3 || dims[0]>7 || dims.slice(4,dims[0]+1).some(n=>n!==1)) throw new Error("Training requires scalar 3D NIfTI channels, not 4D data.");
  const shape = dims.slice(1,4), code = v.getInt16(n2?12:70,le), type=types[code];
  if (!type || v.getInt16(n2?14:72,le)!==type[1]*8) throw new Error("Unsupported NIfTI datatype / bitpix.");
  const pix = Array.from({length:4},(_,i)=>f((n2?104:76)+i*(n2?8:4)));
  const spacing = pix.slice(1).map(Math.abs), units = n2?v.getInt32(500,le):v.getUint8(123);
  if (![0,2].includes(units & 7)) throw new Error("NIfTI spatial units must be mm or unspecified; recalibrate before export.");
  const qform = n2?v.getInt32(344,le):v.getInt16(252,le), sform = n2?v.getInt32(348,le):v.getInt16(254,le);
  let affine;
  if (sform>0) affine=[...Array.from({length:3},(_,i)=>Array.from({length:4},(_,j)=>f((n2?400:280)+(i*4+j)*(n2?8:4)))),[0,0,0,1]];
  else if (qform>0) {
    const q = Array.from({length:6},(_,i)=>f((n2?352:256)+i*(n2?8:4)));
    affine=quaternionAffine(...q.slice(0,3),q.slice(3),spacing,pix[0]);
  } else throw new Error("NIfTI requires an explicit qform or sform for reproducible geometry.");
  const geometry = validateGeometry({shape, spacing_mm:spacing, affine});
  const offset = n2?integer64(168):f(108), count = shape.reduce((a,b)=>a*b,1);
  if (!Number.isSafeInteger(count) || !Number.isInteger(offset) || offset < (n2?544:352)
      || count*type[1]+offset > bytes.length || count*type[1] > CASE_LIMITS.expanded) throw new Error("Truncated or oversized NIfTI voxel data.");
  const rawSlope=f(n2?176:112), rawIntercept=f(n2?184:116);
  const slope = rawSlope===0 || !Number.isFinite(rawSlope) ? 1 : rawSlope;
  const intercept = rawSlope===0 || !Number.isFinite(rawSlope) ? 0 : rawIntercept;
  if (!Number.isFinite(intercept) || (labels && (!type[3] || slope!==1 || intercept!==0))) throw new Error("Labels require unscaled integer NIfTI data.");
  const ids=new Set(); let min=Infinity,max=-Infinity;
  for (let i=0;i<count;i++) {
    const x=v[type[2]](offset+i*type[1],le)*slope+intercept;
    if (!Number.isFinite(x)) throw new Error("NIfTI contains non-finite voxel values.");
    if (labels && (x<0 || x>65535)) throw new Error("Label IDs must be integers in 0..65535.");
    if (labels && x) ids.add(x);
    min=Math.min(min,x);max=Math.max(max,x);
  }
  return {geometry, datatype:type[0], ids:[...ids].sort((a,b)=>a-b), range:[min,max], decodedBytes:bytes.length};
}
export function sourceCategory(image) {
  if (image.channel_count === 3) return "rgb";
  return ["nifti","dicom"].includes(image.source_format) && /original_scalar|dicom_rescale/.test(image.intensity_policy) ? "medical_scalar" : "grayscale_8bit";
}
export async function validateTrainingCase(blob) {
  const files=await readSafeZip(blob);
  if (!files.has("manifest.json") || files.get("manifest.json").length > 1048576) throw new Error("Missing or oversized manifest.json.");
  const m=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(files.get("manifest.json")));
  if (m.format!==TRAINING_CASE_FORMAT || !validCaseId(m.case_id)) throw new Error("Invalid training case manifest format or case_id.");
  const image=m.image, label=m.label;
  if (![1,3].includes(image?.channel_count) || !Array.isArray(image.channels) || image.channels.length!==image.channel_count
      || typeof image.source_format!=="string" || !/^[a-z0-9_-]{1,32}$/.test(image.source_format)
      || typeof image.intensity_policy!=="string" || !/^[a-z0-9_-]{1,96}$/.test(image.intensity_policy)
      || !Array.isArray(label?.objects)) throw new Error("Invalid case channels, source or label schema.");
  validateGeometry(m.geometry);
  const expected=new Set(["manifest.json",label.file]);
  if (!new RegExp(`^labelsTr/${m.case_id}\\.nii(?:\\.gz)?$`).test(label.file)) throw new Error("Invalid label filename.");
  if (!files.has(label.file)) throw new Error("Missing label NIfTI.");
  const parsedLabel=await inspectNifti(files.get(label.file),{labels:true});
  let decodedTotal=parsedLabel.decodedBytes;
  sameGeometry(parsedLabel.geometry,m.geometry);
  if (label.datatype!==parsedLabel.datatype) throw new Error("Label datatype disagrees with manifest.");
  const ids=new Set();
  for (const o of label.objects) {
    if (!Number.isInteger(o.id) || o.id<1 || o.id>65535 || ids.has(o.id) || typeof o.name!=="string" || o.name.length>80 || !o.name.trim()) throw new Error("Invalid label objects.");
    ids.add(o.id);
  }
  if (ids.size!==parsedLabel.ids.length || parsedLabel.ids.some(id=>!ids.has(id))) throw new Error("Manifest label IDs disagree with voxels.");
  for (const [i,c] of image.channels.entries()) {
    if (c.index!==i || !new RegExp(`^imagesTr/${m.case_id}_${String(i).padStart(4,"0")}\\.nii(?:\\.gz)?$`).test(c.file)
        || c.name!==(image.channel_count===1?"scalar":["red","green","blue"][i])) throw new Error("Invalid image channel filename / order / name.");
    if (!files.has(c.file)) throw new Error("Missing image NIfTI.");
    const parsed=await inspectNifti(files.get(c.file),{limit:CASE_LIMITS.expanded-decodedTotal});
    decodedTotal+=parsed.decodedBytes;
    sameGeometry(parsed.geometry,parsedLabel.geometry);
    if (c.datatype && c.datatype!==parsed.datatype) throw new Error("Image datatype disagrees with manifest.");
    if (image.channel_count===3 && (parsed.range[0]<0 || parsed.range[1]>255)) throw new Error("MVP RGB channels require a 0–255 range.");
    expected.add(c.file);
  }
  if (files.size!==expected.size || [...files.keys()].some(k=>!expected.has(k))) throw new Error("Unexpected files in Training ZIP; only declared NIfTI channels, label and manifest are allowed.");
  for (const name of expected) if (name!=="manifest.json") {
    const data=files.get(name);
    if (name.endsWith(".gz")!==(data[0]===31 && data[1]===139)) throw new Error("NIfTI gzip filename disagrees with file contents.");
  }
  if (m.privacy?.dicom_headers_included!==false || m.privacy?.patient_identifiers_in_manifest!==false) throw new Error("Invalid training case privacy declaration.");
  // Whitelist summaries; never propagate arbitrary case metadata to a new manifest.
  return {caseId:m.case_id, sourceFormat:image.source_format, channelCount:image.channel_count,
    intensityPolicy:image.intensity_policy, sourceCategory:sourceCategory(image), geometry:m.geometry,
    objects:label.objects.map(o=>({id:o.id,name:o.name})), labelIds:parsedLabel.ids};
}
