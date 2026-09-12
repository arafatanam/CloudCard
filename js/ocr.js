// ocr.js — thin wrapper around Tesseract.js.
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

export async function recognizeText(canvasOrImage, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvasOrImage);
  return data.text || "";
}
