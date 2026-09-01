function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function adjustedRgba(
  source,
  { windowCenter = 127.5, windowWidth = 255, brightness = 0, contrast = 1 } = {},
) {
  const width = Math.max(1, Number(windowWidth));
  const output = new Uint8ClampedArray(source.length);
  for (let offset = 0; offset < source.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const windowed = ((source[offset + channel] - (windowCenter - width / 2)) / width) * 255;
      output[offset + channel] = clampByte((windowed - 127.5) * contrast + 127.5 + brightness);
    }
    output[offset + 3] = source[offset + 3];
  }
  return output;
}

export function windowModalityValue(value, windowCenter, windowWidth) {
  const center = Number(windowCenter);
  const width = Math.max(1, Number(windowWidth));
  if (!Number.isFinite(value) || !Number.isFinite(center) || !Number.isFinite(width)) return 0;
  if (width <= 1) return value > center - 0.5 ? 255 : 0;
  const lower = center - 0.5 - (width - 1) / 2;
  const upper = center - 0.5 + (width - 1) / 2;
  if (value <= lower) return 0;
  if (value > upper) return 255;
  return clampByte(((value - (center - 0.5)) / (width - 1) + 0.5) * 255);
}

export function modalityToRgba(
  source,
  {
    windowCenter,
    windowWidth,
    brightness = 0,
    contrast = 1,
    photometricInterpretation = "MONOCHROME2",
  } = {},
) {
  const output = new Uint8ClampedArray(source.length * 4);
  const invert = String(photometricInterpretation).toUpperCase() === "MONOCHROME1";
  const displayContrast = Math.max(0.1, Number(contrast));
  const displayBrightness = Number(brightness);
  for (let index = 0; index < source.length; index += 1) {
    let display = windowModalityValue(source[index], windowCenter, windowWidth);
    if (invert) display = 255 - display;
    display = clampByte(
      (display - 127.5) * displayContrast + 127.5 + displayBrightness,
    );
    const offset = index * 4;
    output[offset] = display;
    output[offset + 1] = display;
    output[offset + 2] = display;
    output[offset + 3] = 255;
  }
  return output;
}

export function displayControlRange(
  { minimum = 0, maximum = 255 } = {},
  { windowCenter = 127.5, windowWidth = 255 } = {},
) {
  const finiteMinimum = Number.isFinite(Number(minimum)) ? Number(minimum) : 0;
  const finiteMaximum = Number.isFinite(Number(maximum)) && Number(maximum) > finiteMinimum
    ? Number(maximum)
    : finiteMinimum + 255;
  const span = Math.max(1, finiteMaximum - finiteMinimum);
  return {
    centerMinimum: Math.floor(Math.min(finiteMinimum, Number(windowCenter))),
    centerMaximum: Math.ceil(Math.max(finiteMaximum, Number(windowCenter))),
    centerStep: span > 4096 ? 1 : 0.5,
    widthMaximum: Math.ceil(Math.max(510, span * 2, Number(windowWidth) * 2)),
    widthStep: span > 4096 ? 1 : 0.5,
  };
}

export function thresholdRaster(source, minimum, maximum) {
  let low = Number(minimum);
  let high = Number(maximum);
  if (low > high) [low, high] = [high, low];
  const output = new Uint8Array(source.length / 4);
  for (let index = 0; index < output.length; index += 1) {
    const offset = index * 4;
    const gray =
      source[offset] * 0.299 + source[offset + 1] * 0.587 + source[offset + 2] * 0.114;
    if (gray >= low && gray <= high && source[offset + 3] !== 0) output[index] = 255;
  }
  return output;
}

export function rgbRaster(source, target, tolerance) {
  const red = Number(target.red);
  const green = Number(target.green);
  const blue = Number(target.blue);
  const range = Math.max(0, Number(tolerance));
  const output = new Uint8Array(source.length / 4);
  for (let index = 0; index < output.length; index += 1) {
    const offset = index * 4;
    if (
      source[offset + 3] !== 0 &&
      Math.abs(source[offset] - red) <= range &&
      Math.abs(source[offset + 1] - green) <= range &&
      Math.abs(source[offset + 2] - blue) <= range
    ) {
      output[index] = 255;
    }
  }
  return output;
}

export function rgbAt(source, width, height, x, y) {
  const px = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const py = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const offset = (py * width + px) * 4;
  return {
    red: source[offset],
    green: source[offset + 1],
    blue: source[offset + 2],
  };
}

export function rgbToHex({ red, green, blue }) {
  return `#${[red, green, blue]
    .map((value) => clampByte(value).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function hexToRgb(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value || "");
  if (!match) throw new Error("RGB color must use #RRGGBB format.");
  return {
    red: Number.parseInt(match[1].slice(0, 2), 16),
    green: Number.parseInt(match[1].slice(2, 4), 16),
    blue: Number.parseInt(match[1].slice(4, 6), 16),
  };
}
