// cropper.js — lets the user drag the 4 corners of the card over the photo,
// then flattens that quadrilateral into a clean rectangle (perspective
// correction) plus an optional fine-rotation pass for tilted shots.

const OUTPUT_W = 700;
const OUTPUT_H = 440; // ~ standard business card ratio

function solveLinear(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [b[i], b[maxRow]] = [b[maxRow], b[i]];
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) sum -= A[i][j] * x[j];
    x[i] = sum / A[i][i];
  }
  return x;
}

// Maps rectangle corners (srcPts) -> arbitrary quad corners (dstPts).
function computeHomography(srcPts, dstPts) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = srcPts[i];
    const [X, Y] = dstPts[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  const [a, bb, c, d, e, f, g, h] = solveLinear(A, b);
  return { a, b: bb, c, d, e, f, g, h };
}

function applyH(H, x, y) {
  const denom = H.g * x + H.h * y + 1;
  return [(H.a * x + H.b * y + H.c) / denom, (H.d * x + H.e * y + H.f) / denom];
}

export function createCropper(canvasEl, image, containerMaxW, containerMaxH) {
  // `image` is an HTMLImageElement or ImageBitmap at full resolution.
  const iw = image.width;
  const ih = image.height;

  let rotationDeg = 0; // fine rotation, applied before warp

  // Fit-to-container scale for the *display* canvas.
  const scale = Math.min(containerMaxW / iw, containerMaxH / ih, 1);
  const dispW = Math.round(iw * scale);
  const dispH = Math.round(ih * scale);
  canvasEl.width = dispW;
  canvasEl.height = dispH;
  const ctx = canvasEl.getContext("2d");

  // Quad corners in DISPLAY space, inset 12% from edges by default.
  const inset = 0.12;
  let corners = [
    [dispW * inset, dispH * inset], // top-left
    [dispW * (1 - inset), dispH * inset], // top-right
    [dispW * (1 - inset), dispH * (1 - inset)], // bottom-right
    [dispW * inset, dispH * (1 - inset)], // bottom-left
  ];

  const HANDLE_R = 16;
  let dragIndex = -1;

  function draw() {
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.save();
    ctx.translate(dispW / 2, dispH / 2);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(image, -dispW / 2, -dispH / 2, dispW, dispH);
    ctx.restore();

    // dim outside the quad
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.rect(0, 0, dispW, dispH);
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.restore();

    // quad outline
    ctx.strokeStyle = "#f2a541";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
    ctx.closePath();
    ctx.stroke();

    // handles
    corners.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = "#f2a541";
      ctx.fill();
      ctx.strokeStyle = "#101114";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  function pointerPos(evt) {
    const rect = canvasEl.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    return [
      ((clientX - rect.left) / rect.width) * dispW,
      ((clientY - rect.top) / rect.height) * dispH,
    ];
  }

  function hitTest(px, py) {
    for (let i = 0; i < 4; i++) {
      const [x, y] = corners[i];
      if (Math.hypot(px - x, py - y) <= HANDLE_R) return i;
    }
    return -1;
  }

  function onDown(evt) {
    const [px, py] = pointerPos(evt);
    dragIndex = hitTest(px, py);
    if (dragIndex >= 0) evt.preventDefault();
  }
  function onMove(evt) {
    if (dragIndex < 0) return;
    evt.preventDefault();
    const [px, py] = pointerPos(evt);
    corners[dragIndex] = [
      Math.min(Math.max(px, 0), dispW),
      Math.min(Math.max(py, 0), dispH),
    ];
    draw();
  }
  function onUp() {
    dragIndex = -1;
  }

  canvasEl.addEventListener("mousedown", onDown);
  canvasEl.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  canvasEl.addEventListener("touchstart", onDown, { passive: false });
  canvasEl.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("touchend", onUp);

  draw();

  return {
    setRotation(deg) {
      rotationDeg = deg;
      draw();
    },
    rotate90(dir) {
      // Rotate the underlying image 90deg by re-drawing to an offscreen
      // canvas and swapping which image we reference. Simplest correct
      // approach: bake rotation into a new bitmap and reset corners.
      const off = document.createElement("canvas");
      off.width = ih;
      off.height = iw;
      const octx = off.getContext("2d");
      octx.translate(off.width / 2, off.height / 2);
      octx.rotate((dir * 90 * Math.PI) / 180);
      octx.drawImage(image, -iw / 2, -ih / 2);
      return off; // caller swaps this in as the new working image
    },
    /**
     * Produces the final flattened, cropped card image as a canvas.
     */
    getResultCanvas() {
      // Render the (possibly fine-rotated) full-res image to an offscreen
      // canvas the same aspect as the display, so corner coords map 1:1
      // after scaling back up.
      const full = document.createElement("canvas");
      full.width = iw;
      full.height = ih;
      const fctx = full.getContext("2d");
      fctx.save();
      fctx.translate(iw / 2, ih / 2);
      fctx.rotate((rotationDeg * Math.PI) / 180);
      fctx.drawImage(image, -iw / 2, -ih / 2, iw, ih);
      fctx.restore();

      const srcQuadFullRes = corners.map(([x, y]) => [x / scale, y / scale]);

      const rectCorners = [
        [0, 0],
        [OUTPUT_W, 0],
        [OUTPUT_W, OUTPUT_H],
        [0, OUTPUT_H],
      ];
      const H = computeHomography(rectCorners, srcQuadFullRes);

      const out = document.createElement("canvas");
      out.width = OUTPUT_W;
      out.height = OUTPUT_H;
      const octx = out.getContext("2d");
      const outData = octx.createImageData(OUTPUT_W, OUTPUT_H);

      const srcCtx = full.getContext("2d");
      const srcData = srcCtx.getImageData(0, 0, iw, ih).data;

      for (let v = 0; v < OUTPUT_H; v++) {
        for (let u = 0; u < OUTPUT_W; u++) {
          const [sx, sy] = applyH(H, u, v);
          const x0 = Math.floor(sx);
          const y0 = Math.floor(sy);
          const di = (v * OUTPUT_W + u) * 4;
          if (x0 < 0 || y0 < 0 || x0 >= iw - 1 || y0 >= ih - 1) {
            outData.data[di + 3] = 0;
            continue;
          }
          // bilinear sample
          const fx = sx - x0;
          const fy = sy - y0;
          for (let c = 0; c < 4; c++) {
            const p00 = srcData[(y0 * iw + x0) * 4 + c];
            const p10 = srcData[(y0 * iw + x0 + 1) * 4 + c];
            const p01 = srcData[((y0 + 1) * iw + x0) * 4 + c];
            const p11 = srcData[((y0 + 1) * iw + x0 + 1) * 4 + c];
            const top = p00 * (1 - fx) + p10 * fx;
            const bot = p01 * (1 - fx) + p11 * fx;
            outData.data[di + c] = top * (1 - fy) + bot * fy;
          }
        }
      }
      octx.putImageData(outData, 0, 0);
      return out;
    },
    destroy() {
      canvasEl.removeEventListener("mousedown", onDown);
      canvasEl.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvasEl.removeEventListener("touchstart", onDown);
      canvasEl.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    },
  };
}
