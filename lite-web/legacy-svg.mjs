// Import boundary for SegRef3D Local's colored slice masks, not a general SVG renderer.
// Source: SegRef3D.py load_svg_as_label_mask / rasterize_path_to_binary,
// ui_SegRef3D.py color_labels, and write_label_mask_svg (M/L/Z contours).
import { MASK_MANIFEST_FILENAME, MASK_SLICE_ORDER } from "./mask-sequence.mjs?v=1";

export const LEGACY_SVG_COLORS = Object.freeze([
  null, "#ff0000", "#0000ff", "#00ff00", "#ffff00", "#800080", "#ffa500",
  "#00ffff", "#adff2f", "#808080", "#008080", "#ffc0cb", "#ff1493",
  "#008000", "#800000", "#00ffe6", "#ffd700", "#ff4500", "#000080", "#dc143c", "#808000",
]);
export const SVG_FORMAT = "segref3d-colored-svg-masks";
const base = name => String(name).replaceAll("\\", "/").split("/").at(-1);
const fail = message => { throw new Error(`Legacy SVG: ${message}`); };
const MAX_TEXT = 16_000_000;
const MAX_POINTS = 500_000;
const numberPattern = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/iy;

function numbers(text) {
  const values = [];
  let offset = 0;
  while (offset < text.length) {
    const separator = /^[\s,]+/.exec(text.slice(offset));
    if (separator) { offset += separator[0].length; continue; }
    numberPattern.lastIndex = offset;
    const match = numberPattern.exec(text);
    if (!match) fail("invalid numeric coordinates.");
    const value = Number(match[0]);
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) fail("coordinate exceeds supported limits.");
    values.push(value);
    if (values.length > MAX_POINTS * 2) fail("too many coordinates.");
    offset = numberPattern.lastIndex;
  }
  return values;
}

function length(value, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!/^[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:px)?$/.test(value || "")) fail("dimensions must be explicit pixels.");
  const result = Number(value.replace(/px$/, ""));
  if (!Number.isFinite(result) || Math.abs(result) > 1_000_000) fail("dimension exceeds supported limits.");
  return result;
}

// A deliberately small XML grammar. Nothing is handed to a DOM, image decoder,
// stylesheet engine or URL loader. Unknown attributes/elements fail closed.
function elements(text) {
  if (typeof text !== "string" || text.length > MAX_TEXT) fail("file exceeds the 16 MB limit.");
  text = text.replace(/^\uFEFF/, "").replace(/^\s*<\?xml\s+[^?]*\?>/, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  if (/[&]|<!|<\?/.test(text)) fail("entities, declarations and processing instructions are not supported.");
  const output = [], stack = [], prefixes = new Set([""]);
  let offset = 0, roots = 0;
  const attributes = {
    svg: ["xmlns", "width", "height", "viewBox", "version", "id"],
    g: ["id"],
    path: ["d"], polygon: ["points"], polyline: ["points"],
    rect: ["x", "y", "width", "height"],
    circle: ["cx", "cy", "r"], ellipse: ["cx", "cy", "rx", "ry"],
  };
  const common = ["fill", "fill-rule", "stroke", "stroke-width", "opacity", "fill-opacity", "style", "id", "data-label-id"];
  while (offset < text.length) {
    const whitespace = /^\s+/.exec(text.slice(offset));
    if (whitespace) { offset += whitespace[0].length; continue; }
    const token = /^<\s*(\/?)\s*([A-Za-z][\w-]*(?::[A-Za-z][\w-]*)?)([^<>]*?)\s*(\/?)>/.exec(text.slice(offset));
    if (!token) fail("malformed or unsupported XML.");
    offset += token[0].length;
    const [, closing, qualifiedTag, body, selfClosing] = token;
    const parts = qualifiedTag.split(":"), tag = parts.at(-1), prefix = parts.length === 2 ? parts[0] : "";
    if (!Object.hasOwn(attributes, tag)) fail(`unsupported element <${tag}>.`);
    if (closing) {
      if (body.trim() || selfClosing || stack.pop() !== qualifiedTag) fail("mismatched XML elements.");
      continue;
    }
    if (!stack.length) { if (tag !== "svg" || roots++) fail("expected one SVG root."); }
    else if (!["svg", "g"].includes(stack.at(-1).split(":").at(-1)) || tag === "svg") fail("unsupported element nesting.");
    const attrs = Object.create(null);
    let remaining = body;
    while (remaining.trim()) {
      const attribute = /^\s+([\w:-]+)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/.exec(remaining);
      if (!attribute) fail("malformed XML attribute.");
      const name = attribute[1], value = attribute[2] ?? attribute[3];
      if (/url\s*\(|javascript:|https?:|data:|\\/i.test(value) && value !== "http://www.w3.org/2000/svg") fail("URLs and CSS escapes are forbidden.");
      if (Object.hasOwn(attrs, name)) fail(`duplicate attribute ${name}.`);
      if (tag === "svg" && /^xmlns(?::[A-Za-z][\w-]*)?$/.test(name)) {
        if (value !== "http://www.w3.org/2000/svg") fail("unsupported namespace.");
        prefixes.add(name.includes(":") ? name.split(":")[1] : "");
      } else if (!attributes[tag].includes(name) && !(tag !== "svg" && tag !== "g" && common.includes(name))) fail(`unsupported attribute ${name}.`);
      attrs[name] = value;
      remaining = remaining.slice(attribute[0].length);
    }
    if (!prefixes.has(prefix)) fail("undeclared SVG namespace prefix.");
    if (attrs.xmlns && attrs.xmlns !== "http://www.w3.org/2000/svg") fail("unsupported namespace.");
    if (attrs.style) {
      for (const declaration of attrs.style.split(";").filter(s => s.trim())) {
        const pair = /^\s*(fill|fill-rule|stroke|stroke-width|opacity|fill-opacity)\s*:\s*([^:]+?)\s*$/.exec(declaration);
        if (!pair) fail("unsupported style (only literal fill/stroke properties are accepted).");
        attrs[pair[1]] = pair[2];
      }
    }
    for (const value of Object.values(attrs)) {
      if (/url\s*\(|javascript:|https?:|data:|\\/i.test(value) && value !== "http://www.w3.org/2000/svg") fail("URLs and CSS escapes are forbidden.");
    }
    output.push({ tag, attrs });
    if (output.length > 100_000 || stack.length > 32) fail("document is too complex.");
    if (!selfClosing) stack.push(qualifiedTag);
  }
  if (stack.length || roots !== 1) fail("incomplete SVG document.");
  return output;
}

function fillId(attrs) {
  let color = (attrs.fill || "").trim().toLowerCase();
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  if (rgb) color = "#" + rgb.slice(1).map(v => Number(v).toString(16).padStart(2, "0")).join("");
  if (!color || color === "none" || color === "#000000") return 0;
  const id = LEGACY_SVG_COLORS.indexOf(color);
  if (id < 1) fail(`unknown legacy palette color ${color}.`);
  if (attrs["data-label-id"] !== undefined && Number(attrs["data-label-id"]) !== id) fail("data-label-id disagrees with the legacy color.");
  return id;
}

const qtCoordinate = v => Math.sign(v) * Math.floor(Math.abs(v) * 64 + 0.5);

// Match QOutlineMapper's unit-scale curve tolerance before 26.6 conversion.
// Cubics use bounded De Casteljau subdivision; no browser path renderer is used.
function cubicPoints(start, first, second, end) {
  const output = [], stack = [[start, first, second, end, 0]];
  const midpoint = (a, b) => a.map((v, i) => (v + b[i]) / 2);
  while (stack.length) {
    const [a, b, c, d, depth] = stack.pop();
    const dx = d[0] - a[0], dy = d[1] - a[1], span = Math.abs(dx) + Math.abs(dy);
    const deviation = span > 1
      ? Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) + Math.abs((c[0] - a[0]) * dy - (c[1] - a[1]) * dx)
      : Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]);
    if (deviation < 0.25 * (span > 1 ? span : 1) || depth === 9) {
      output.push(d);
      if (output.length > MAX_POINTS) fail("curve complexity limit exceeded.");
    } else {
      const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d);
      const abc = midpoint(ab, bc), bcd = midpoint(bc, cd), middle = midpoint(abc, bcd);
      stack.push([middle, bcd, cd, d, depth + 1], [a, ab, abc, middle, depth + 1]);
    }
  }
  return output;
}

function pathPolygons(d) {
  const tokens = [];
  for (let offset = 0; offset < d.length;) {
    const separator = /^[\s,]+/.exec(d.slice(offset));
    if (separator) { offset += separator[0].length; continue; }
    if (/[a-z]/i.test(d[offset])) { tokens.push(d[offset++]); continue; }
    numberPattern.lastIndex = offset;
    const match = numberPattern.exec(d);
    if (!match || !Number.isFinite(Number(match[0])) || Math.abs(Number(match[0])) > 1_000_000) fail("invalid path coordinates.");
    tokens.push(Number(match[0])); offset = numberPattern.lastIndex;
  }
  const polygons = [];
  let polygon = [], current = [0, 0], start = null, previous = "", control = null, op = "", i = 0, total = 0;
  const append = points => {
    total += points.length;
    if (total > MAX_POINTS) fail("too many path points.");
    for (const p of points) polygon.push(p);
  };
  while (i < tokens.length) {
    if (typeof tokens[i] === "string") op = tokens[i++];
    const upper = op.toUpperCase(), relative = op !== upper;
    if (upper === "Z") {
      if (!start) fail("invalid close path.");
      current = start; polygons.push(polygon); polygon = []; previous = "Z"; control = null; op = ""; continue;
    }
    const count = ({M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2})[upper];
    if (!count) fail(`unsupported path command ${op || "(missing)"}.`);
    const values = tokens.slice(i, i + count);
    if (values.length !== count || values.some(v => typeof v !== "number")) fail("incomplete path coordinates.");
    i += count;
    const point = n => [values[n] + (relative ? current[0] : 0), values[n + 1] + (relative ? current[1] : 0)];
    let end, nextControl = null;
    if (upper === "M") {
      if (polygon.length) polygons.push(polygon);
      polygon = []; end = point(0); start = end; append([end]); op = relative ? "l" : "L";
    } else {
      if (!start) fail("path must start with M.");
      if (!polygon.length) append([current]);
      if (upper === "L") { end = point(0); append([end]); }
      else if (upper === "H") { end = [values[0] + (relative ? current[0] : 0), current[1]]; append([end]); }
      else if (upper === "V") { end = [current[0], values[0] + (relative ? current[1] : 0)]; append([end]); }
      else if (upper === "C" || upper === "S") {
        const first = upper === "C" ? point(0) : ["C", "S"].includes(previous) ? current.map((v, k) => 2 * v - control[k]) : current;
        nextControl = point(upper === "C" ? 2 : 0); end = point(upper === "C" ? 4 : 2);
        append(cubicPoints(current, first, nextControl, end));
      } else {
        nextControl = upper === "Q" ? point(0) : ["Q", "T"].includes(previous) ? current.map((v, k) => 2 * v - control[k]) : current;
        end = point(upper === "Q" ? 2 : 0);
        const first = current.map((v, k) => v + (nextControl[k] - v) * 2 / 3);
        const second = end.map((v, k) => v + (nextControl[k] - v) * 2 / 3);
        append(cubicPoints(current, first, second, end));
      }
    }
    current = end; control = nextControl; previous = upper;
  }
  if (polygon.length) polygons.push(polygon);
  return polygons;
}

function ellipsePolygon(cx, cy, rx, ry) {
  const k = 0.5522847498; // QPainterPath::addEllipse's cubic approximation.
  const start = [cx + rx, cy], bottom = [cx, cy + ry], left = [cx - rx, cy], top = [cx, cy - ry];
  return [start,
    ...cubicPoints(start, [cx + rx, cy + k * ry], [cx + k * rx, cy + ry], bottom),
    ...cubicPoints(bottom, [cx - k * rx, cy + ry], [cx - rx, cy + k * ry], left),
    ...cubicPoints(left, [cx - rx, cy - k * ry], [cx - k * rx, cy - ry], top),
    ...cubicPoints(top, [cx + k * rx, cy - ry], [cx + rx, cy - k * ry], start),
  ];
}

// Aliased odd-even scan conversion: Local forces OddEvenFill and disables AA.
// Match Qt's 26.6 coordinate rounding, 16.16 edge stepping and half-pixel
// tie rule. Floating-point point-in-polygon tests differ on legacy boundaries.
// Reference: qtbase/src/gui/painting/qrasterizer.cpp (mergeLine) and qoutlinemapper.cpp (26.6 rounding).
function paintPolygons(mask, width, height, polygons, id, budget) {
  const rows = new Map();
  for (const polygon of polygons) for (let i = 0; i < polygon.length; i++) {
    let a = polygon[i].map(qtCoordinate), b = polygon[(i + 1) % polygon.length].map(qtCoordinate);
    if (a[1] > b[1]) [a, b] = [b, a];
    if (a[1] === b[1]) continue;
    const start = Math.max(0, Math.floor((a[1] + 32) / 64));
    const end = Math.min(height, Math.floor((b[1] - 32) / 64) + 1);
    budget.edges += Math.max(0, end - start);
    if (budget.edges > 20_000_000) fail("rasterization complexity limit exceeded.");
    const step = Math.trunc((b[0] - a[0]) / (b[1] - a[1]) * 65536);
    let intersection = a[0] * 1024 + 32768 + Math.floor(step * (start + 0.5 - a[1] / 64));
    for (let y = start; y < end; y++) {
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(Math.floor(intersection / 65536));
      intersection += step;
    }
  }
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const start = Math.max(0, xs[i]);
      const end = Math.min(width, xs[i + 1]);
      if (end > start) {
        budget.pixels += end - start;
        if (budget.pixels > 100_000_000) fail("rasterization pixel limit exceeded.");
        mask.fill(id, y * width + start, y * width + end);
      }
    }
  }
}

export function decodeLegacySvg(text, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_000_000) fail("invalid working grid.");
  const nodes = elements(text), root = nodes[0].attrs;
  const sw = length(root.width), sh = length(root.height);
  if (sw !== width || sh !== height) fail(`canvas ${sw}x${sh} does not match working grid ${width}x${height}; resizing is not allowed.`);
  if (root.viewBox !== undefined) {
    const vb = numbers(root.viewBox);
    if (vb.length !== 4 || vb[0] !== 0 || vb[1] !== 0 || vb[2] !== width || vb[3] !== height) fail("viewBox must match 0 0 width height of the working grid.");
  }
  const mask = new Uint8Array(width * height);
  const budget = { edges: 0, pixels: 0 };
  let pointCount = 0;
  for (const { tag, attrs } of nodes.slice(1)) {
    if (tag === "g") continue;
    let polygons;
    if (tag === "path") polygons = pathPolygons(attrs.d || "");
    else if (tag === "rect") {
      const x = length(attrs.x, 0), y = length(attrs.y, 0), w = length(attrs.width), h = length(attrs.height);
      if (w < 0 || h < 0) fail("negative rectangle size.");
      polygons = [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]];
    } else if (tag === "circle" || tag === "ellipse") {
      const cx = length(attrs.cx, 0), cy = length(attrs.cy, 0);
      const rx = length(tag === "circle" ? attrs.r : attrs.rx), ry = tag === "circle" ? rx : length(attrs.ry);
      if (rx <= 0 || ry <= 0) fail("ellipse radius must be positive.");
      polygons = [ellipsePolygon(cx, cy, rx, ry)];
    } else {
      const points = numbers(attrs.points || "");
      if (points.length < 4 || points.length % 2) fail("invalid polygon points.");
      polygons = [Array.from({ length: points.length / 2 }, (_, i) => points.slice(i * 2, i * 2 + 2))];
    }
    pointCount += polygons.reduce((n, p) => n + p.length, 0);
    if (pointCount > MAX_POINTS) fail("too many path points.");
    const id = fillId(attrs);
    if (id) paintPolygons(mask, width, height, polygons, id, budget);
  }
  return mask;
}

export function encodeLegacySvg(mask, width, height) {
  if (!(mask instanceof Uint8Array) || mask.length !== width * height || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) fail("invalid label mask.");
  const paths = Array.from({ length: 21 }, () => []);
  if (width * height > 16_000_000 || width > 1_000_000 || height > 1_000_000) fail("working grid exceeds supported dimensions.");
  let pointCount = 0;
  // Pixel-edge contours represented by horizontal runs are lossless, including
  // single pixels and holes, and use the same colored M/L/Z subset as Local.
  for (let y = 0; y < height; y++) for (let x = 0; x < width;) {
    const id = mask[y * width + x], start = x++;
    if (id > 20) fail("label exceeds Obj 20.");
    while (x < width && mask[y * width + x] === id) x++;
    if (id) {
      pointCount += 4;
      if (pointCount > MAX_POINTS) fail("mask is too complex for a lossless legacy SVG; use Label PNG.");
      paths[id].push(`M ${start} ${y} L ${x} ${y} L ${x} ${y + 1} L ${start} ${y + 1} Z`);
    }
  }
  const text = `<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    paths.map((parts, id) => parts.length ? `  <path d="${parts.join(" ")}" fill="${LEGACY_SVG_COLORS[id]}" fill-rule="evenodd" data-label-id="${id}"/>\n` : "").join("") + "</svg>\n";
  if (text.length > MAX_TEXT) fail("export exceeds the 16 MB SVG limit; use Label PNG.");
  return text;
}

export function createSvgMaskEntries(images) {
  if (!images.length || images.some(i => i.width !== images[0].width || i.height !== images[0].height)) fail("export requires a shared working grid.");
  const files = images.map((image, zIndex) => ({ filename: `mask${String(zIndex + 1).padStart(4, "0")}.svg`, zIndex, displaySlice: zIndex + 1 }));
  const manifest = {
    format: SVG_FORMAT, version: 1, sliceOrder: MASK_SLICE_ORDER, sliceIndexBase: 1,
    frameCount: images.length, sliceCount: images.length, width: images[0].width, height: images[0].height,
    objects: LEGACY_SVG_COLORS.slice(1).map((color, i) => ({ id: i + 1, color })), files,
  };
  return [
    ...files.map((file, i) => ({ name: file.filename, blob: new Blob([encodeLegacySvg(images[i].mask, images[i].width, images[i].height)], { type: "image/svg+xml" }) })),
    { name: MASK_MANIFEST_FILENAME, blob: new Blob([JSON.stringify(manifest, null, 2) + "\n"], { type: "application/json" }) },
  ];
}

export function svgEntries(entries) {
  return entries.filter(e => /\.svg$/i.test(e.name) && !base(e.name).startsWith(".") && !e.name.replaceAll("\\", "/").split("/").includes("__MACOSX"));
}

export function mapSvgEntries(entries, images, { manifest = null, order = "canonical" } = {}) {
  const selected = svgEntries(entries), count = images.length;
  if (!count || selected.length !== count) fail(`found ${selected.length} SVG files for ${count} source slices. A complete sequence (including empty slices) is required.`);
  if (!images.every(i => i.width === images[0].width && i.height === images[0].height)) fail("source slices must share a working grid.");
  const byNumber = new Map();
  for (const entry of selected) {
    const digits = base(entry.name).match(/\d+/g);
    const index = digits ? Number(digits.at(-1)) : NaN;
    if (!Number.isInteger(index) || index < 1 || index > count || byNumber.has(index)) fail(`missing, duplicate, zero-based or out-of-range slice number: ${base(entry.name)}.`);
    byNumber.set(index, entry);
  }
  if (manifest) {
    if (manifest.format !== SVG_FORMAT || manifest.version !== 1 || manifest.sliceOrder !== MASK_SLICE_ORDER || manifest.sliceIndexBase !== 1 || manifest.frameCount !== count || manifest.sliceCount !== count || manifest.width !== images[0].width || manifest.height !== images[0].height || manifest.files?.length !== count) fail("manifest geometry, count or canonical order is invalid.");
    if (!Array.isArray(manifest.objects) || manifest.objects.length !== 20 ||
      manifest.objects.some((object, i) => object?.id !== i + 1 || object.color !== LEGACY_SVG_COLORS[i + 1])) fail("manifest palette is incompatible.");
    for (let z = 0; z < count; z++) {
      const f = manifest.files[z];
      if (f.zIndex !== z || f.displaySlice !== z + 1 || f.filename !== `mask${String(z + 1).padStart(4, "0")}.svg` || base(byNumber.get(z + 1)?.name) !== f.filename) fail("manifest has a reversed or non-canonical filename mapping.");
    }
    order = "canonical";
  }
  let indices = images.map((_, i) => i);
  if (order === "legacy-filename") {
    const names = images.map(i => i.dicom?.sourceFilename);
    if (names.some(n => !n) || new Set(names).size !== count) fail("legacy filename mapping requires unique original DICOM filenames (single-frame instances).");
    // Old Local load_images used re.findall digits / natural ordering, before IPP sorting.
    const compare = (a, b) => {
      const aa = a.toLowerCase().match(/\d+|\D+/g), bb = b.toLowerCase().match(/\d+|\D+/g);
      for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
        const delta = /^\d+$/.test(aa[i]) && /^\d+$/.test(bb[i]) ? Number(aa[i]) - Number(bb[i]) : aa[i] < bb[i] ? -1 : aa[i] > bb[i] ? 1 : 0;
        if (delta) return delta;
      }
      return aa.length - bb.length;
    };
    indices.sort((a, b) => compare(names[a], names[b]));
    for (let i = 1; i < count; i++) if (!compare(names[indices[i - 1]], names[indices[i]])) fail("ambiguous natural DICOM filename order.");
  } else if (order === "reverse") indices.reverse();
  else if (order !== "canonical") fail("unknown slice ordering.");
  return indices.map((zIndex, oldIndex) => ({ entry: byNumber.get(oldIndex + 1), image: images[zIndex], zIndex, displaySlice: zIndex + 1 }));
}
