// extract.js — turns OCR output into structured contact fields.
//
// Accepts either:
//   - a plain string (legacy / quick testing), or
//   - { text, lines } where `lines` is [{ text, height }], height coming
//     from Tesseract's per-line bounding boxes.
//
// Strategy:
//   1. Regex-strip email / phone / website from every line, including
//      lines that mix a label with the value ("Mobile: 017...") or mix
//      a value with other text on the same line. Anything matched is
//      removed from that line before it's considered for name/company/
//      title/address, so a phone number can never masquerade as a name.
//   2. Among whatever text is left, font size (line height) decides the
//      name: the largest remaining line is almost always the person's
//      name on a real business card, which is a much stronger signal
//      than "first line we haven't used yet."
//   3. Keyword matching still picks out title and company where
//      possible; whatever's left becomes the address.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const WEBSITE_RE = /((https?:\/\/)?(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/[^\s]*)?)/;
const PHONE_RE = /(\+?\d[\d\s().-]{5,}\d)/;

const LABEL_ONLY_RE = /^(mobile|tel|telephone|phone|fax|cell|office|direct|landline|whatsapp|email|e-mail|web|website|url)\s*[:.]?\s*$/i;
const LABEL_PREFIX_RE = /^(mobile|tel|telephone|phone|fax|cell|office|direct|landline|whatsapp|email|e-mail|web|website|url)\s*[:.]?\s*/i;

const TITLE_WORDS = [
  "manager", "director", "engineer", "founder", "co-founder", "ceo", "cto",
  "cfo", "coo", "president", "vp", "vice president", "head of", "lead",
  "consultant", "designer", "developer", "analyst", "specialist",
  "executive", "officer", "owner", "partner", "architect", "administrator",
  "supervisor", "coordinator", "representative", "sales", "marketing",
];

const COMPANY_WORDS = [
  "ltd", "llc", "inc", "corp", "co.", "company", "group", "solutions",
  "technologies", "technology", "systems", "enterprises", "industries",
  "studio", "agency", "labs", "partners", "associates", "holdings",
];

function looksLikeTitle(line) {
  const l = line.toLowerCase();
  return TITLE_WORDS.some((w) => l.includes(w));
}
function looksLikeCompany(line) {
  const l = line.toLowerCase();
  return COMPANY_WORDS.some((w) => l.includes(w));
}

function isValidPhoneDigits(raw) {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function cleanWebsite(raw) {
  let w = raw.trim().replace(/\s+/g, "");
  if (w.includes("@")) return "";
  if (!/^https?:\/\//i.test(w)) w = "https://" + w;
  return w;
}

/**
 * Pulls email/phone/website out of one line, returning the matches
 * found plus whatever text is left over once they're removed.
 */
function stripKnownFields(line) {
  let remainder = line;
  const matches = {};

  const emailMatch = remainder.match(EMAIL_RE);
  if (emailMatch) {
    matches.email = emailMatch[0];
    remainder = remainder.replace(emailMatch[0], " ");
  }

  const phoneMatch = remainder.match(PHONE_RE);
  if (phoneMatch && isValidPhoneDigits(phoneMatch[0])) {
    matches.phone = phoneMatch[0].trim();
    remainder = remainder.replace(phoneMatch[0], " ");
  }

  // Only look for a website if this line wasn't just consumed by an email,
  // since "name@site.com" can otherwise partially re-match as a domain.
  if (!matches.email) {
    const websiteMatch = remainder.match(WEBSITE_RE);
    if (websiteMatch) {
      const candidate = cleanWebsite(websiteMatch[0]);
      if (candidate) {
        matches.website = candidate;
        remainder = remainder.replace(websiteMatch[0], " ");
      }
    }
  }

  remainder = remainder.replace(LABEL_PREFIX_RE, "");
  remainder = remainder.replace(/[\s:|,.-]+$/, "").trim();
  if (LABEL_ONLY_RE.test(remainder)) remainder = "";

  return { matches, remainder };
}

function normalizeLines(input) {
  if (typeof input === "string") {
    return input
      .split("\n")
      .map((t) => ({ text: t.trim(), height: 0 }))
      .filter((l) => l.text.length > 1);
  }
  if (input && Array.isArray(input.lines) && input.lines.length) {
    return input.lines
      .map((l) => ({ text: (l.text || "").trim(), height: l.height || 0 }))
      .filter((l) => l.text.length > 1);
  }
  return (input && input.text ? input.text : "")
    .split("\n")
    .map((t) => ({ text: t.trim(), height: 0 }))
    .filter((l) => l.text.length > 1);
}

export function extractFields(ocrResult) {
  const lines = normalizeLines(ocrResult);

  const result = {
    name: "", company: "", title: "", phone: "", email: "", website: "", address: "",
  };

  // Pass 1: strip out anything regex-identifiable, line by line.
  const remaining = []; // { text, height }
  for (const line of lines) {
    const { matches, remainder } = stripKnownFields(line.text);

    if (matches.email && !result.email) result.email = matches.email;
    if (matches.phone && !result.phone) result.phone = matches.phone;
    if (matches.website && !result.website) result.website = matches.website;
    // A second phone/website/email match on a different line is deliberately
    // dropped rather than leaked into name/company/address; the review
    // screen is where a second number gets added by hand if wanted.

    if (remainder && remainder.length > 1) {
      remaining.push({ text: remainder, height: line.height });
    }
  }

  // Pass 2: among what's left, use font size to find the name; keywords
  // to find title/company; everything else becomes the address.
  const haveHeights = remaining.some((l) => l.height > 0);
  const candidates = remaining.filter(
    (l) => !looksLikeTitle(l.text) && !looksLikeCompany(l.text)
  );

  let nameIdx = -1;
  if (candidates.length) {
    if (haveHeights) {
      let best = 0;
      for (let i = 1; i < candidates.length; i++) {
        if (candidates[i].height > candidates[best].height) best = i;
      }
      nameIdx = remaining.indexOf(candidates[best]);
    } else {
      nameIdx = remaining.indexOf(candidates[0]);
    }
  }

  const leftover = [];
  let titleSet = false;
  let companySet = false;

  remaining.forEach((line, i) => {
    if (i === nameIdx) {
      result.name = line.text;
      return;
    }
    if (!titleSet && looksLikeTitle(line.text)) {
      result.title = line.text;
      titleSet = true;
      return;
    }
    if (!companySet && looksLikeCompany(line.text)) {
      result.company = line.text;
      companySet = true;
      return;
    }
    leftover.push(line.text);
  });

  if (!result.name && leftover.length) result.name = leftover.shift();
  if (!result.company && leftover.length) result.company = leftover.shift();
  result.address = leftover.join(", ");

  return result;
}
