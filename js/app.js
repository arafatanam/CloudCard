import { getAllContacts, getContact, saveContact, deleteContact, newId } from "./db.js";
import { createCropper } from "./cropper.js";
import { recognizeCard, preprocessForOcr } from "./ocr.js";
import { extractFields } from "./extract.js";

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------
const screens = Array.from(document.querySelectorAll(".screen"));
let navStack = ["home"];

function showScreen(name) {
  screens.forEach((s) => s.classList.toggle("hidden", s.dataset.screen !== name));
}
function goTo(name) {
  navStack.push(name);
  showScreen(name);
}
function goBack() {
  if (navStack.length > 1) navStack.pop();
  const prev = navStack[navStack.length - 1];
  showScreen(prev);
  if (prev === "home") refreshList();
  stopCamera();
}
document.querySelectorAll("[data-nav-back]").forEach((btn) =>
  btn.addEventListener("click", goBack)
);

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
}

// ---------------------------------------------------------------
// Working state for the current scan-in-progress
// ---------------------------------------------------------------
const flow = {
  rawImage: null, // HTMLImageElement or canvas, full resolution
  cropper: null,
  cardCanvas: null, // flattened card after crop
  editingId: null, // contact id being edited, or null for new
};

// ---------------------------------------------------------------
// HOME: list + search
// ---------------------------------------------------------------
let allContacts = [];

async function refreshList() {
  allContacts = await getAllContacts();
  renderList(allContacts);
}

function renderList(rows) {
  const list = document.getElementById("contact-list");
  const empty = document.getElementById("empty-state");
  list.innerHTML = "";
  if (!rows.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  for (const c of rows) {
    const li = document.createElement("li");
    li.className = "contact-card";
    li.dataset.id = c.id;
    const thumbUrl = c.thumb ? URL.createObjectURL(c.thumb) : "";
    li.innerHTML = `
      <img class="contact-thumb" src="${thumbUrl}" alt="" />
      <div class="contact-meta">
        <div class="name">${escapeHtml(c.name || "Untitled")}</div>
        <div class="sub">${escapeHtml(c.company || c.title || c.phone || "")}</div>
      </div>`;
    li.addEventListener("click", () => openDetail(c.id));
    list.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
}

document.getElementById("search-input").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) return renderList(allContacts);
  const fields = ["name", "company", "title", "phone", "email", "address", "notes"];
  const filtered = allContacts.filter((c) => {
    if (fields.some((f) => (c[f] || "").toLowerCase().includes(q))) return true;
    if ((c.tags || []).some((t) => t.toLowerCase().includes(q))) return true;
    return false;
  });
  renderList(filtered);
});

document.getElementById("btn-scan-fab").addEventListener("click", () => {
  flow.editingId = null;
  goTo("capture");
  startCamera();
});

// ---------------------------------------------------------------
// CAPTURE: camera + gallery import
// ---------------------------------------------------------------
const video = document.getElementById("camera-video");
let mediaStream = null;

async function startCamera() {
  document.getElementById("camera-fallback").classList.add("hidden");
  video.classList.remove("hidden");
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = mediaStream;
  } catch (err) {
    video.classList.add("hidden");
    document.getElementById("camera-fallback").classList.remove("hidden");
  }
}
function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
}

document.getElementById("btn-shutter").addEventListener("click", () => {
  if (!mediaStream) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  canvas.toBlob((blob) => loadImageFromBlob(blob), "image/jpeg", 0.92);
  stopCamera();
});

document.getElementById("file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadImageFromBlob(file);
});

function loadImageFromBlob(blob) {
  const img = new Image();
  img.onload = () => {
    flow.rawImage = img;
    goTo("crop");
    initCropScreen();
  };
  img.src = URL.createObjectURL(blob);
}

// ---------------------------------------------------------------
// CROP: drag corners, rotate, flatten
// ---------------------------------------------------------------
function initCropScreen() {
  const canvas = document.getElementById("crop-canvas");
  const wrap = canvas.parentElement;
  if (flow.cropper) flow.cropper.destroy();
  flow.cropper = createCropper(canvas, flow.rawImage, wrap.clientWidth, wrap.clientHeight);
  document.getElementById("fine-rotate").value = 0;
}

document.getElementById("fine-rotate").addEventListener("input", (e) => {
  flow.cropper.setRotation(parseFloat(e.target.value));
});

document.getElementById("btn-rotate-left").addEventListener("click", () => bakeRotate(-1));
document.getElementById("btn-rotate-right").addEventListener("click", () => bakeRotate(1));

function bakeRotate(dir) {
  const rotatedCanvas = flow.cropper.rotate90(dir);
  flow.rawImage = rotatedCanvas;
  initCropScreen();
}

document.getElementById("btn-crop-done").addEventListener("click", async () => {
  flow.cardCanvas = flow.cropper.getResultCanvas();
  goTo("processing");
  await runOcrAndExtract();
});

// ---------------------------------------------------------------
// PROCESSING: OCR + field extraction
// ---------------------------------------------------------------
async function runOcrAndExtract() {
  const label = document.getElementById("processing-label");
  label.textContent = "Preparing image…";
  try {
    const ocrCanvas = preprocessForOcr(flow.cardCanvas);
    label.textContent = "Loading OCR engine…";
    const ocrResult = await recognizeCard(ocrCanvas, (m) => {
      if (m.status === "recognizing text") {
        label.textContent = `Reading text… ${Math.round((m.progress || 0) * 100)}%`;
      } else if (m.status) {
        label.textContent = m.status.charAt(0).toUpperCase() + m.status.slice(1) + "…";
      }
    });
    const fields = extractFields(ocrResult);
    openReview(fields);
  } catch (err) {
    console.error(err);
    toast("OCR failed, opening blank form");
    openReview({});
  }
}

// ---------------------------------------------------------------
// REVIEW: prefill + save
// ---------------------------------------------------------------
const reviewForm = document.getElementById("review-form");

function openReview(fields, existingContact) {
  document.getElementById("review-title").textContent = existingContact ? "Edit Contact" : "Review Contact";
  document.getElementById("f-name").value = fields.name || "";
  document.getElementById("f-company").value = fields.company || "";
  document.getElementById("f-title").value = fields.title || "";
  document.getElementById("f-phone").value = fields.phone || "";
  document.getElementById("f-email").value = fields.email || "";
  document.getElementById("f-website").value = fields.website || "";
  document.getElementById("f-address").value = fields.address || "";
  document.getElementById("f-tags").value = (fields.tags || []).join(", ");
  document.getElementById("f-notes").value = fields.notes || "";

  const thumb = document.getElementById("review-thumb");
  if (flow.cardCanvas) {
    thumb.src = flow.cardCanvas.toDataURL("image/jpeg", 0.85);
    thumb.classList.remove("hidden");
  } else if (existingContact && existingContact.image) {
    thumb.src = URL.createObjectURL(existingContact.image);
    thumb.classList.remove("hidden");
  } else {
    thumb.classList.add("hidden");
  }

  goTo("review");
}

document.getElementById("btn-cancel-review").addEventListener("click", goBack);

reviewForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(reviewForm);
  const tags = (fd.get("tags") || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const now = Date.now();
  let imageBlob = null;
  let thumbBlob = null;

  if (flow.cardCanvas) {
    imageBlob = await canvasToBlob(flow.cardCanvas, 0.9);
    thumbBlob = await canvasToBlob(resizeCanvas(flow.cardCanvas, 200), 0.85);
  }

  let contact;
  if (flow.editingId) {
    contact = await getContact(flow.editingId);
  }
  if (!contact) {
    contact = { id: newId(), dateScanned: now };
  }

  contact.name = fd.get("name") || "Untitled";
  contact.company = fd.get("company") || "";
  contact.title = fd.get("title") || "";
  contact.phone = fd.get("phone") || "";
  contact.email = fd.get("email") || "";
  contact.website = fd.get("website") || "";
  contact.address = fd.get("address") || "";
  contact.notes = fd.get("notes") || "";
  contact.tags = tags;
  contact.dateModified = now;
  if (imageBlob) contact.image = imageBlob;
  if (thumbBlob) contact.thumb = thumbBlob;

  await saveContact(contact);
  toast("Contact saved");
  flow.rawImage = null;
  flow.cardCanvas = null;
  flow.editingId = null;
  navStack = ["home"];
  showScreen("home");
  refreshList();
});

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function resizeCanvas(canvas, maxW) {
  const ratio = canvas.height / canvas.width;
  const out = document.createElement("canvas");
  out.width = maxW;
  out.height = Math.round(maxW * ratio);
  out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

// ---------------------------------------------------------------
// DETAIL: view / quick actions / edit / delete
// ---------------------------------------------------------------
let detailContact = null;

async function openDetail(id) {
  detailContact = await getContact(id);
  if (!detailContact) return;

  document.getElementById("detail-name").textContent = detailContact.name;
  document.getElementById("detail-title-line").textContent = detailContact.title || detailContact.name;
  document.getElementById("detail-company-line").textContent = detailContact.company || "";

  const img = document.getElementById("detail-image");
  if (detailContact.image) {
    img.src = URL.createObjectURL(detailContact.image);
    img.classList.remove("hidden");
  } else {
    img.classList.add("hidden");
  }

  const call = document.getElementById("qa-call");
  const email = document.getElementById("qa-email");
  const web = document.getElementById("qa-web");
  call.href = detailContact.phone ? `tel:${detailContact.phone.replace(/\s+/g, "")}` : "#";
  call.style.opacity = detailContact.phone ? 1 : 0.35;
  email.href = detailContact.email ? `mailto:${detailContact.email}` : "#";
  email.style.opacity = detailContact.email ? 1 : 0.35;
  web.href = detailContact.website || "#";
  web.style.opacity = detailContact.website ? 1 : 0.35;

  const tagRow = document.getElementById("detail-tags");
  tagRow.innerHTML = (detailContact.tags || [])
    .map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`)
    .join("");

  const fieldsEl = document.getElementById("detail-fields");
  const rows = [
    ["Phone", detailContact.phone],
    ["Email", detailContact.email],
    ["Website", detailContact.website],
    ["Address", detailContact.address],
  ].filter(([, v]) => v);
  fieldsEl.innerHTML = rows
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join("");

  document.getElementById("detail-notes").textContent = detailContact.notes || "—";

  goTo("detail");
}

document.getElementById("btn-edit").addEventListener("click", () => {
  if (!detailContact) return;
  flow.editingId = detailContact.id;
  flow.cardCanvas = null; // keep existing image unless user rescans
  openReview(detailContact, detailContact);
});

document.getElementById("btn-delete").addEventListener("click", async () => {
  if (!detailContact) return;
  if (!confirm(`Delete ${detailContact.name}? This can't be undone.`)) return;
  await deleteContact(detailContact.id);
  toast("Contact deleted");
  navStack = ["home"];
  showScreen("home");
  refreshList();
});

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------
refreshList();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
