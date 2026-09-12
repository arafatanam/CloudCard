// extract.js — turns raw OCR text into structured contact fields.
// Strategy: regex rules for high-confidence fields (phone, email, website),
// then simple line-position heuristics for name / title / company among
// whatever text is left over.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const WEBSITE_RE = /((https?:\/\/)?(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/[^\s]*)?)/;
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;

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

function cleanWebsite(raw) {
  let w = raw.trim().replace(/\s+/g, "");
  // avoid mistaking an email for a website match
  if (w.includes("@")) return "";
  if (!/^https?:\/\//i.test(w)) w = "https://" + w.replace(/^www\./i, "www.");
  return w;
}

export function extractFields(rawText) {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  const result = {
    name: "",
    company: "",
    title: "",
    phone: "",
    email: "",
    website: "",
    address: "",
  };

  const remaining = [];

  for (const line of lines) {
    const emailMatch = line.match(EMAIL_RE);
    const phoneMatch = line.match(PHONE_RE);
    const websiteMatch = line.match(WEBSITE_RE);

    if (emailMatch && !result.email) {
      result.email = emailMatch[0];
      continue;
    }
    if (phoneMatch && !result.phone && phoneMatch[0].replace(/\D/g, "").length >= 7) {
      result.phone = phoneMatch[0].trim();
      continue;
    }
    if (websiteMatch && !emailMatch && !result.website) {
      const candidate = cleanWebsite(websiteMatch[0]);
      if (candidate) {
        result.website = candidate;
        continue;
      }
    }
    remaining.push(line);
  }

  // Line-position heuristics on whatever text has no regex match:
  // first remaining line is usually the name, unless it screams "title"
  // or "company"; the next distinct lines fill title / company; anything
  // left becomes address.
  const leftover = [];
  for (const line of remaining) {
    if (!result.name && !looksLikeTitle(line) && !looksLikeCompany(line)) {
      result.name = line;
      continue;
    }
    if (!result.title && looksLikeTitle(line)) {
      result.title = line;
      continue;
    }
    if (!result.company && looksLikeCompany(line)) {
      result.company = line;
      continue;
    }
    leftover.push(line);
  }

  // If we still have no name, fall back to the very first line seen.
  if (!result.name && lines.length) result.name = lines[0];

  // If no company was tagged by keyword, guess the second leftover line.
  if (!result.company && leftover.length) {
    result.company = leftover.shift();
  }

  result.address = leftover.join(", ");

  return result;
}
