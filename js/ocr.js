// ocr.js — thin wrapper around Tesseract.js, plus a light preprocessing
// pass that measurably improves text recognition on phone-camera photos.
//
// Note: the Tesseract worker/core/language files are fetched from a CDN
// at runtime (jsdelivr), same as the library script in index.html. That
// means the very first scan on a device needs internet; the browser
// caches those assets after that. Everything else in the app (storage,
// search, viewing saved cards) works fully offline.

let workerPromise = null;

function getWorker(onProgress) {
  if (!workerPromise) {
    // `Tesseract` is loaded globally via the <script> tag in index.html.
    workerPromise = Tesseract.createWorker("eng", 1, {
      logger: (m) => onProgress && onProgress(m),
    });
  }
  return workerPromise;
}

/**
 * Grayscale + percentile contrast stretch. This is the single biggest
 * lever for OCR accuracy on phone-camera card photos: it flattens out
 * uneven lighting/shadow and pushes faint text toward pure black/white
 * without fully thresholding (which can erase thin character strokes).
 * Returns a NEW canvas; the original (color) canvas is left untouched
 * so it can still be saved/displayed normally.
 */
export function preprocessForOcr(sourceCanvas) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.drawImage(sourceCanvas, 0, 0);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const n = w * h;
  const gray = new Uint8ClampedArray(n);

  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }

  // 2nd/98th percentile stretch, cheaper than a full histogram and
  // robust enough for this use case.
  const sample = Array.from(gray).sort((a, b) => a - b);
  const lo = sample[Math.floor(n * 0.02)];
  const hi = sample[Math.ceil(n * 0.98) - 1];
  const range = Math.max(hi - lo, 1);

  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let v = ((gray[p] - lo) / range) * 255;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }

  ctx.putImageData(imgData, 0, 0);
  return out;
}

/**
 * Runs OCR and returns both the raw text (for backward-compat/debugging)
 * and per-line data including each line's height, so the caller can use
 * font size as a signal (biggest text on a card is almost always the
 * person's name).
 */
export async function recognizeCard(canvasOrImage, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvasOrImage);
  const lines = (data.lines || [])
    .map((l) => ({
      text: (l.text || "").trim(),
      height: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0,
    }))
    .filter((l) => l.text.length > 1);
  return { text: data.text || "", lines };
}
