import {
  makeOutputFileName,
  makeOutputPlan,
  metadataForMessage,
  outputChunks,
  parseNifti,
} from "./nifti.mjs";

let current = null;

function postProgress(value, label) {
  self.postMessage({ type: "progress", value, label });
}

async function decompressIfNeeded(file) {
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const isGzip =
    fileBytes.byteLength >= 2 && fileBytes[0] === 0x1f && fileBytes[1] === 0x8b;
  if (!isGzip) return fileBytes.buffer;

  if (typeof DecompressionStream === "undefined") {
    throw new Error("このブラウザはgzip展開に未対応です。最新版のChromeまたはEdgeを使用してください。");
  }
  const stream = new Blob([fileBytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function loadFile(file) {
  postProgress(3, "ファイルを読み込んでいます…");
  const arrayBuffer = await decompressIfNeeded(file);
  postProgress(85, "NIfTIヘッダーを確認しています…");
  current = parseNifti(arrayBuffer, file.name);
  self.postMessage({
    type: "loaded",
    metadata: metadataForMessage(current),
  });
}

async function generate(requestedAxis, factor) {
  if (!current) throw new Error("先にNIfTIファイルを選択してください。");
  if (typeof CompressionStream === "undefined") {
    throw new Error("このブラウザはgzip圧縮に未対応です。最新版のChromeまたはEdgeを使用してください。");
  }

  const plan = makeOutputPlan(current, requestedAxis, factor);
  const compression = new CompressionStream("gzip");
  const writer = compression.writable.getWriter();
  const blobPromise = new Response(compression.readable).blob();
  const totalSlices = plan.dimensions[2];
  let completedSlices = -1;

  postProgress(1, "出力ヘッダーを準備しています…");
  for (const chunk of outputChunks(current, plan)) {
    await writer.write(chunk);
    if (completedSlices >= 0) {
      const percent = Math.min(94, 3 + Math.round(((completedSlices + 1) / totalSlices) * 91));
      postProgress(percent, "空白スライスを挿入しています…");
    }
    completedSlices += 1;
  }

  postProgress(96, "gzipで圧縮しています…");
  await writer.close();
  const compressed = await blobPromise;
  const blob = new Blob([compressed], { type: "application/gzip" });
  const fileName = makeOutputFileName(current.fileName, plan);

  postProgress(100, "完了しました");
  self.postMessage({
    type: "generated",
    blob,
    fileName,
    summary: {
      axis: plan.axis,
      factor: plan.factor,
      dimensions: plan.dimensions,
      spacing: plan.spacing,
      compressedSize: blob.size,
    },
  });
}

self.addEventListener("message", async (event) => {
  const { type } = event.data ?? {};
  try {
    if (type === "load") {
      await loadFile(event.data.file);
    } else if (type === "generate") {
      await generate(event.data.axis, event.data.factor);
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      operation: type,
    });
  }
});
