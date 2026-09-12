# CloudCard

A free, privacy-focused Progressive Web App that scans business cards, pulls out the contact info with OCR, and saves everything on your phone. No account, no subscription, no server.

> Scan it. Save it. Find it later. Throw away the card.

## What's in this MVP

- Camera capture **and** gallery import
- Manual crop: drag the 4 corner handles to fit the card, plus rotate (90° buttons + fine-tune slider)
- OCR via Tesseract.js, run entirely in the browser
- Automatic field extraction (name, company, title, phone, email, website, address) using regex + line-position heuristics, with a review screen to fix mistakes before saving
- Local storage in IndexedDB: contact data, full card image, and thumbnail
- Search across name, company, title, phone, email, address, tags
- Contact detail screen with tap-to-call, tap-to-email, tap-to-open-website
- Tags and notes fields (basic, comma-separated tags)
- Installable PWA with offline app shell

**Deliberately deferred** (per the original spec, these are fast-follows, not MVP): CSV/VCF export, automatic duplicate detection, QR code detection, front/back card sides, multi-language OCR tuning.

## Running it locally

Camera access requires either `https://` or `localhost`, so you can't just double-click `index.html`. Serve it:

```bash
# any static server works, for example:
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed `localhost` URL on your phone (same Wi-Fi network) or in your desktop browser to test without a camera (use gallery import instead).

## Deploying to GitHub Pages (free hosting)

1. Push this folder to your `cloudcard` repo on GitHub.
2. In the repo, go to **Settings → Pages**.
3. Under **Source**, pick the branch (usually `main`) and root folder.
4. Save. GitHub gives you a URL like `https://<username>.github.io/cloudcard/`.
5. Open that URL on your phone and use **Add to Home Screen** (Safari: Share → Add to Home Screen; Chrome: menu → Install app) to get a native-feeling icon.

That's it. $0 hosting, $0 OCR, $0 database, $0 subscription.

## How OCR works here

Tesseract.js (the engine, the WASM core, and the English language model) loads from a CDN (jsdelivr) the first time you scan a card. Your browser caches those files after that, so repeat scans are fast and mostly offline. Everything else, saving, searching, and viewing contacts, works fully offline from the first load, since your data never leaves IndexedDB on your device.

If you want zero network dependency even on first use, you'd need to vendor the Tesseract worker, wasm core, and `eng.traineddata` (several MB) into the repo yourself. Left out here to keep the repo small and the setup simple.

## Architecture

```
index.html          all screens, single-page app (no framework)
css/style.css        app styling
js/app.js            navigation, camera, form handling, save/search/detail
js/db.js             IndexedDB wrapper (contacts store)
js/cropper.js         drag-corner crop + perspective flatten + rotate
js/ocr.js             Tesseract.js wrapper
js/extract.js         raw OCR text -> structured fields
manifest.json         PWA manifest
sw.js                 service worker, caches the app shell for offline use
icons/                app icons
```

Contact record shape (as stored in IndexedDB):

```js
{
  id, name, company, title, phone, email, website, address,
  tags: string[], notes,
  dateScanned, dateModified,
  image: Blob,   // full flattened card photo, JPEG
  thumb: Blob,   // small JPEG for the list view
}
```

## The crop tool, in plain terms

You drag 4 handles onto the card's corners in the photo. On "Next," the app computes a perspective transform (a homography) that maps that quadrilateral onto a flat rectangle, so an off-angle photo still produces a straight, front-on card image before OCR runs. The fine-rotation slider and 90° buttons handle photos that are simply tilted or sideways.

## Known limitations (v1)

- OCR accuracy depends heavily on photo quality and lighting; always double-check the review screen.
- No duplicate detection yet: scanning the same card twice creates two contacts.
- Tags are a single comma-separated text field, not a tag picker.
- No CSV/VCF export yet.
- Deleting a contact is immediate after a confirm dialog. No trash/undo.

## Security notes

- No scanned images or contact data are committed to this repo. `.gitignore` excludes nothing sensitive because nothing sensitive ever touches disk here, your data lives in the browser's IndexedDB on your device only.
- No analytics, no external contact-data calls. The only outbound network traffic is the one-time OCR asset download from jsdelivr.
