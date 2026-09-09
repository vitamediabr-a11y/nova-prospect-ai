import type { WebsiteAnalysisFacts } from "./website-analysis";

export const DISCOVERY_MAX_CANDIDATES = 10;
export const DISCOVERY_CONCURRENCY = 3;
export const DISCOVERY_STALE_MINUTES = 15;

const BLOCKED_HOSTS = new Set([
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "wikipedia.org",
  "google.com",
  "bing.com",
  "brave.com",
  "gov.br",
  "doctoralia.com.br",
  "guiamais.com.br",
  "telelistas.net",
]);

const BUSINESS_TYPES = new Set([
  "Organization",
  "LocalBusiness",
  "MedicalBusiness",
  "Store",
  "ProfessionalService",
  "Dentist",
  "Physician",
  "Hospital",
  "HealthAndBeautyBusiness",
  "Restaurant",
  "Hotel",
  "AutomotiveBusiness",
  "FinancialService",
  "LegalService",
  "RealEstateAgent",
]);

export type DiscoveryCandidateDecision =
  | { accepted: true; url: string; hostname: string }
  | { accepted: false; reason: "INVALID_URL" | "UNSUPPORTED_PROTOCOL" | "BLOCKED_HOST" | "NON_HTML_FILE" };

export type FirstPartyBusinessIdentity = {
  displayName: string;
  provisional: boolean;
  identitySource: "JSON_LD" | "OG_SITE_NAME" | "TITLE" | "HOSTNAME";
  website: string;
  hostname: string;
  location: string | null;
  email: string | null;
  whatsapp: string | null;
};

export function normalizeDiscoveryText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function buildDiscoveryQuery(input: { segment: string; location: string; additionalTerms?: string | null }) {
  return [input.segment, input.location, input.additionalTerms]
    .map((value) => normalizeDiscoveryText(value ?? ""))
    .filter(Boolean)
    .join(" ");
}

export function normalizeBusinessHostname(input: string) {
  const url = new URL(input);
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

export function companyDedupeKeyFromWebsite(input: string) {
  return `web:${normalizeBusinessHostname(input)}`;
}

function isBlockedHostname(hostname: string) {
  return [...BLOCKED_HOSTS].some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
}

export function evaluateDiscoveryCandidate(input: string): DiscoveryCandidateDecision {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { accepted: false, reason: "INVALID_URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { accepted: false, reason: "UNSUPPORTED_PROTOCOL" };
  }

  const hostname = normalizeBusinessHostname(url.toString());
  if (isBlockedHostname(hostname)) return { accepted: false, reason: "BLOCKED_HOST" };
  if (/\.pdf$/i.test(url.pathname)) return { accepted: false, reason: "NON_HTML_FILE" };

  url.hash = "";
  return { accepted: true, url: url.toString(), hostname };
}

function parseAttributes(tag: string) {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const body = tag.replace(/^<\/?[a-z0-9:-]+/i, "").replace(/\/?\s*>$/, "");
  for (const match of body.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function cleanText(value: unknown, max = 180) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

function jsonLdObjects(html: string) {
  const output: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    output.push(record);
    if (Array.isArray(record["@graph"])) visit(record["@graph"]);
  };

  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1]));
    } catch {
      // Invalid JSON-LD is ignored; identity must remain evidence-based.
    }
  }
  return output;
}

function typeMatchesBusiness(value: unknown) {
  const types = Array.isArray(value) ? value : [value];
  return types.some((type) => typeof type === "string" && BUSINESS_TYPES.has(type));
}

function jsonLdIdentity(html: string) {
  for (const record of jsonLdObjects(html)) {
    if (!typeMatchesBusiness(record["@type"])) continue;
    const name = cleanText(record.name);
    if (!name) continue;

    let location: string | null = null;
    if (record.address && typeof record.address === "object" && !Array.isArray(record.address)) {
      const address = record.address as Record<string, unknown>;
      location = [cleanText(address.addressLocality, 80), cleanText(address.addressRegion, 80)].filter(Boolean).join(", ") || null;
    }

    return {
      name,
      location,
      email: cleanText(record.email, 160),
      telephone: cleanText(record.telephone, 40),
    };
  }
  return null;
}

function ogSiteName(html: string) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const property = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (property === "og:site_name") return cleanText(attrs.content, 160);
  }
  return null;
}

function titleIdentity(title: string | null) {
  const clean = cleanText(title, 180);
  if (!clean) return null;
  const first = clean.split(/\s+[|–—-]\s+/)[0]?.trim() ?? "";
  if (!first || /^(home|início|inicio|página inicial|pagina inicial)$/i.test(first)) return null;
  return first.slice(0, 160);
}

function extractMailto(facts: WebsiteAnalysisFacts) {
  const raw = facts.contacts.emailLinks[0];
  if (!raw?.toLowerCase().startsWith("mailto:")) return null;
  return raw.slice(7).trim().toLowerCase() || null;
}

function extractWhatsapp(facts: WebsiteAnalysisFacts) {
  for (const raw of facts.contacts.whatsappLinks) {
    try {
      const url = new URL(raw);
      const digits = url.pathname.replace(/\D/g, "");
      if (digits.length >= 10) return digits.slice(0, 20);
    } catch {
      const digits = raw.replace(/\D/g, "");
      if (digits.length >= 10) return digits.slice(0, 20);
    }
  }
  return null;
}

export function extractFirstPartyBusinessIdentity(input: {
  html: string;
  facts: WebsiteAnalysisFacts;
}): FirstPartyBusinessIdentity {
  const { html, facts } = input;
  const finalHostname = normalizeBusinessHostname(facts.finalUrl);
  const canonicalUrl = facts.canonicalUrl && normalizeBusinessHostname(facts.canonicalUrl) === finalHostname
    ? facts.canonicalUrl
    : facts.finalUrl;
  const structured = jsonLdIdentity(html);
  const ogName = ogSiteName(html);
  const titleName = titleIdentity(facts.title);

  let displayName = finalHostname;
  let provisional = true;
  let identitySource: FirstPartyBusinessIdentity["identitySource"] = "HOSTNAME";

  if (structured?.name) {
    displayName = structured.name;
    provisional = false;
    identitySource = "JSON_LD";
  } else if (ogName) {
    displayName = ogName;
    provisional = false;
    identitySource = "OG_SITE_NAME";
  } else if (titleName) {
    displayName = titleName;
    provisional = false;
    identitySource = "TITLE";
  }

  return {
    displayName,
    provisional,
    identitySource,
    website: canonicalUrl,
    hostname: normalizeBusinessHostname(canonicalUrl),
    location: structured?.location ?? null,
    email: structured?.email?.toLowerCase() ?? extractMailto(facts),
    whatsapp: extractWhatsapp(facts),
  };
}

export function shouldRefreshWebsiteAnalysis(lastAnalyzedAt: Date | null, now = new Date(), staleDays = 7) {
  if (!lastAnalyzedAt) return true;
  return now.getTime() - lastAnalyzedAt.getTime() >= staleDays * 24 * 60 * 60 * 1000;
}

export function isDiscoveryRunStale(
  run: { status: string; startedAt: Date | null },
  now = new Date(),
  staleMinutes = DISCOVERY_STALE_MINUTES,
) {
  if (run.status !== "RUNNING" || !run.startedAt) return false;
  return now.getTime() - run.startedAt.getTime() >= staleMinutes * 60 * 1000;
}
