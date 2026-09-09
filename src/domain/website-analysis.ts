import { calculateLeadScore, type LeadScoreResult } from "./scoring";

export type RedirectFact = {
  status: number;
  from: string;
  to: string;
};

export type TechnologyDetection = {
  technology: string;
  confidence: number;
  evidence: string;
};

export type WebsiteAnalysisFacts = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  redirects: RedirectFact[];
  https: boolean;
  contentType: string;
  title: string | null;
  metaDescription: string | null;
  viewportMeta: string | null;
  canonicalUrl: string | null;
  language: string | null;
  forms: {
    count: number;
    actions: string[];
  };
  contacts: {
    whatsappLinks: string[];
    phoneLinks: string[];
    emailLinks: string[];
    schedulingLinks: string[];
  };
  ctas: Array<{ text: string; href: string | null }>;
  structuredDataCount: number;
  socialLinks: string[];
  technologies: TechnologyDetection[];
};

export type WebsiteSignalCandidate = {
  type: string;
  confidence: number;
  evidence: Record<string, unknown>;
};

export const WEBSITE_MANAGED_SIGNAL_TYPES = [
  "NO_WEBSITE",
  "MISSING_VIEWPORT_META",
  "NO_HOMEPAGE_FORM",
  "WHATSAPP_PRESENT",
  "NO_HOMEPAGE_SCHEDULING_LINK",
  "ANALYTICS_DETECTED",
  "META_PIXEL_DETECTED",
  "ECOMMERCE_PLATFORM_DETECTED",
  "CMS_DETECTED",
  "NO_META_DESCRIPTION",
  "NO_STRUCTURED_DATA",
] as const;

const CTA_TERMS = [
  "agendar",
  "agende",
  "comprar",
  "compre",
  "contato",
  "fale conosco",
  "falar com",
  "orçamento",
  "orcamento",
  "pedir proposta",
  "solicitar",
  "começar",
  "comecar",
  "quero",
  "whatsapp",
  "contact",
  "book",
  "buy",
  "get started",
];

const SOCIAL_HOSTS = ["instagram.com", "facebook.com", "linkedin.com", "youtube.com", "tiktok.com"];
const SCHEDULING_HOSTS = ["calendly.com", "cal.com", "acuityscheduling.com", "calendar.app.google", "meetings.hubspot.com"];

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanText(value: string, max = 300) {
  const text = decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function parseAttributes(tag: string) {
  const attributes: Record<string, string> = {};
  const body = tag.replace(/^<\/?[a-z0-9:-]+/i, "").replace(/\/?\s*>$/, "");
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of body.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function sanitizeHref(href: string, baseUrl: string) {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || /^javascript:/i.test(trimmed) || /^data:/i.test(trimmed)) return null;
  if (/^(tel:|mailto:|whatsapp:)/i.test(trimmed)) {
    return trimmed.split("?", 1)[0].slice(0, 300);
  }
  try {
    const url = new URL(trimmed, baseUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

function uniqueLimited(values: Array<string | null>, limit = 12) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].slice(0, limit);
}

function hostnameOf(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hasHost(value: string, hosts: string[]) {
  const hostname = hostnameOf(value);
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

export function detectTechnologies(html: string): TechnologyDetection[] {
  const lower = html.toLowerCase();
  const found = new Map<string, TechnologyDetection>();

  const add = (technology: string, confidence: number, evidence: string) => {
    const current = found.get(technology);
    if (!current || confidence > current.confidence) found.set(technology, { technology, confidence, evidence });
  };

  if (lower.includes("/wp-content/") || lower.includes("/wp-includes/")) add("WordPress", 0.95, "Asset /wp-content/ ou /wp-includes/ detectado");
  if (/name=["']generator["'][^>]+wordpress|content=["'][^"']*wordpress/i.test(html)) add("WordPress", 0.95, "Meta generator do WordPress detectado");
  if (lower.includes("woocommerce") || lower.includes("/plugins/woocommerce/")) add("WooCommerce", 0.95, "Fingerprint do WooCommerce detectado");
  if (lower.includes("cdn.shopify.com") || lower.includes("shopify-section") || lower.includes("myshopify.com")) add("Shopify", 0.95, "Asset ou markup do Shopify detectado");
  if (lower.includes("static.wixstatic.com") || lower.includes("wix-code-sdk") || lower.includes("wix.com/website")) add("Wix", 0.95, "Asset do Wix detectado");
  if (lower.includes("static1.squarespace.com") || lower.includes("squarespace-cdn.com") || lower.includes("squarespace.com/universal")) add("Squarespace", 0.95, "Asset do Squarespace detectado");
  if (lower.includes("data-wf-page=") || lower.includes("webflow.css") || lower.includes("website-files.com")) add("Webflow", 0.95, "Markup ou asset do Webflow detectado");
  if (lower.includes("nuvemshop") || lower.includes("tiendanube") || lower.includes("nuvemshop.com.br")) add("Nuvemshop", 0.9, "Fingerprint da Nuvemshop detectado");
  if (lower.includes("/_next/static/") || lower.includes("__next_data__")) add("Next.js", 0.95, "Asset /_next/static/ ou __NEXT_DATA__ detectado");
  if (lower.includes("data-reactroot") || lower.includes("data-reactid")) add("React", 0.85, "Atributo de renderização React detectado");
  if (lower.includes("googletagmanager.com/gtag/js") || lower.includes("google-analytics.com") || /gtag\s*\(\s*["']config["']/i.test(html)) add("Google Analytics", 0.95, "Script ou configuração do Google Analytics detectado");
  if (lower.includes("googletagmanager.com/gtm.js") || /gtm-[a-z0-9]+/i.test(html)) add("Google Tag Manager", 0.9, "Container ou script do Google Tag Manager detectado");
  if (lower.includes("connect.facebook.net") && lower.includes("fbevents.js") || /fbq\s*\(/i.test(html)) add("Meta Pixel", 0.95, "Script ou chamada fbq do Meta Pixel detectado");
  if (lower.includes("js.hs-scripts.com") || lower.includes("js.hsforms.net") || lower.includes("hubspotutk")) add("HubSpot", 0.95, "Script do HubSpot detectado");
  if (lower.includes("rdstation") || lower.includes("rd.services") || lower.includes("d335luupugsy2.cloudfront.net")) add("RD Station", 0.9, "Script ou domínio do RD Station detectado");
  if (lower.includes("calendly.com/") || lower.includes("assets.calendly.com")) add("Calendly", 0.95, "Link ou asset do Calendly detectado");
  if (lower.includes("hotmart.com") || lower.includes("hotmart-checkout") || lower.includes("checkout.hotmart")) add("Hotmart", 0.9, "Link ou fingerprint da Hotmart detectado");
  if (lower.includes("wa.me/") || lower.includes("api.whatsapp.com") || lower.includes("whatsapp://")) add("WhatsApp", 0.95, "Link direto para WhatsApp detectado");

  return [...found.values()].sort((a, b) => a.technology.localeCompare(b.technology));
}

export function analyzeWebsiteHtml(input: {
  html: string;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  redirects: RedirectFact[];
  contentType: string;
}): WebsiteAnalysisFacts {
  const { html, finalUrl } = input;
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0];
  const language = htmlTag ? parseAttributes(htmlTag).lang?.trim().slice(0, 40) || null : null;

  let metaDescription: string | null = null;
  let viewportMeta: string | null = null;
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const name = attrs.name?.toLowerCase();
    if (name === "description" && !metaDescription) metaDescription = cleanText(attrs.content ?? "", 500);
    if (name === "viewport" && !viewportMeta) viewportMeta = cleanText(attrs.content ?? "", 300);
  }

  let canonicalUrl: string | null = null;
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    if ((attrs.rel ?? "").toLowerCase().split(/\s+/).includes("canonical") && attrs.href) {
      canonicalUrl = sanitizeHref(attrs.href, finalUrl);
      break;
    }
  }

  const formTags = [...html.matchAll(/<form\b[^>]*>/gi)];
  const formActions = uniqueLimited(formTags.map((match) => sanitizeHref(parseAttributes(match[0]).action ?? finalUrl, finalUrl)));

  const whatsappLinks: string[] = [];
  const phoneLinks: string[] = [];
  const emailLinks: string[] = [];
  const schedulingLinks: string[] = [];
  const socialLinks: string[] = [];
  const ctas: Array<{ text: string; href: string | null }> = [];

  for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const openingTag = match[0].match(/^<a\b[^>]*>/i)?.[0] ?? "";
    const attrs = parseAttributes(openingTag);
    const rawHref = attrs.href ?? "";
    const href = sanitizeHref(rawHref, finalUrl);
    if (!href) continue;

    const lowerHref = rawHref.toLowerCase();
    if (lowerHref.startsWith("tel:")) phoneLinks.push(href);
    if (lowerHref.startsWith("mailto:")) emailLinks.push(href);
    if (lowerHref.startsWith("whatsapp:") || hasHost(href, ["wa.me", "api.whatsapp.com", "web.whatsapp.com"])) whatsappLinks.push(href);
    if (hasHost(href, SCHEDULING_HOSTS) || href.includes("calendar.google.com/calendar/appointments")) schedulingLinks.push(href);
    if (hasHost(href, SOCIAL_HOSTS)) socialLinks.push(href);

    const text = cleanText(match[1], 120);
    if (text && CTA_TERMS.some((term) => text.toLowerCase().includes(term))) ctas.push({ text, href });
  }

  for (const match of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
    const text = cleanText(match[1], 120);
    if (text && CTA_TERMS.some((term) => text.toLowerCase().includes(term))) ctas.push({ text, href: null });
  }

  const structuredDataCount = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>/gi)].length;

  return {
    requestedUrl: input.requestedUrl,
    finalUrl,
    status: input.status,
    redirects: input.redirects.slice(0, 5),
    https: new URL(finalUrl).protocol === "https:",
    contentType: input.contentType.split(";", 1)[0].trim().toLowerCase(),
    title: titleMatch ? cleanText(titleMatch[1], 300) : null,
    metaDescription,
    viewportMeta,
    canonicalUrl,
    language,
    forms: { count: formTags.length, actions: formActions },
    contacts: {
      whatsappLinks: uniqueLimited(whatsappLinks),
      phoneLinks: uniqueLimited(phoneLinks),
      emailLinks: uniqueLimited(emailLinks),
      schedulingLinks: uniqueLimited(schedulingLinks),
    },
    ctas: ctas.slice(0, 12),
    structuredDataCount,
    socialLinks: uniqueLimited(socialLinks),
    technologies: detectTechnologies(html),
  };
}

export function deriveWebsiteSignals(facts: WebsiteAnalysisFacts): WebsiteSignalCandidate[] {
  const signals: WebsiteSignalCandidate[] = [];
  const evidenceBase = { scope: "homepage", finalUrl: facts.finalUrl };
  const technologyNames = facts.technologies.map((item) => item.technology);

  if (!facts.viewportMeta) signals.push({ type: "MISSING_VIEWPORT_META", confidence: 1, evidence: { ...evidenceBase, viewportMeta: false } });
  if (facts.forms.count === 0) signals.push({ type: "NO_HOMEPAGE_FORM", confidence: 1, evidence: { ...evidenceBase, formCount: 0 } });
  if (facts.contacts.whatsappLinks.length > 0) signals.push({ type: "WHATSAPP_PRESENT", confidence: 1, evidence: { ...evidenceBase, links: facts.contacts.whatsappLinks } });
  if (facts.contacts.schedulingLinks.length === 0) signals.push({ type: "NO_HOMEPAGE_SCHEDULING_LINK", confidence: 0.85, evidence: { ...evidenceBase, schedulingLinks: [] } });
  if (!facts.metaDescription) signals.push({ type: "NO_META_DESCRIPTION", confidence: 1, evidence: { ...evidenceBase, metaDescription: false } });
  if (facts.structuredDataCount === 0) signals.push({ type: "NO_STRUCTURED_DATA", confidence: 1, evidence: { ...evidenceBase, structuredDataCount: 0 } });

  const analytics = facts.technologies.filter((item) => item.technology === "Google Analytics" || item.technology === "Google Tag Manager");
  if (analytics.length > 0) signals.push({ type: "ANALYTICS_DETECTED", confidence: Math.max(...analytics.map((item) => item.confidence)), evidence: { ...evidenceBase, technologies: analytics } });

  const metaPixel = facts.technologies.find((item) => item.technology === "Meta Pixel");
  if (metaPixel) signals.push({ type: "META_PIXEL_DETECTED", confidence: metaPixel.confidence, evidence: { ...evidenceBase, technology: metaPixel } });

  const ecommerce = facts.technologies.filter((item) => ["WooCommerce", "Shopify", "Nuvemshop"].includes(item.technology));
  if (ecommerce.length > 0) signals.push({ type: "ECOMMERCE_PLATFORM_DETECTED", confidence: Math.max(...ecommerce.map((item) => item.confidence)), evidence: { ...evidenceBase, technologies: ecommerce } });

  const cms = facts.technologies.filter((item) => ["WordPress", "Wix", "Squarespace", "Webflow"].includes(item.technology));
  if (cms.length > 0) signals.push({ type: "CMS_DETECTED", confidence: Math.max(...cms.map((item) => item.confidence)), evidence: { ...evidenceBase, technologies: cms } });

  return signals.sort((a, b) => a.type.localeCompare(b.type));
}

export function noWebsiteSignal(companyId: string): WebsiteSignalCandidate {
  return {
    type: "NO_WEBSITE",
    confidence: 1,
    evidence: {
      companyId,
      source: "company_record",
      websiteRegistered: false,
      finding: "Nenhum site está cadastrado nos dados disponíveis da empresa.",
    },
  };
}

export function websiteSignalKey(companyId: string, type: string) {
  return `website:${companyId}:${type}`;
}

export function websiteOpportunityKey(companyId: string, signalType: string) {
  return `website:${companyId}:${signalType}`;
}

export function reconcileWebsiteSignalTypes(existingTypes: string[], currentTypes: string[]) {
  const managed = new Set<string>(WEBSITE_MANAGED_SIGNAL_TYPES);
  const current = new Set(currentTypes);
  return {
    observed: [...current].filter((type) => managed.has(type)).sort(),
    resolved: [...new Set(existingTypes)].filter((type) => managed.has(type) && !current.has(type)).sort(),
  };
}

export function scoreWebsiteOpportunity(input: {
  signalType: string;
  facts: WebsiteAnalysisFacts | null;
  knownContact: { whatsapp: boolean; phone: boolean; email: boolean };
  doNotContact: boolean;
  recentlyContacted: boolean;
}): LeadScoreResult {
  const siteContact = input.facts?.contacts;
  const hasWhatsapp = input.knownContact.whatsapp || Boolean(siteContact?.whatsappLinks.length);
  const hasPhone = input.knownContact.phone || Boolean(siteContact?.phoneLinks.length);
  const hasEmail = input.knownContact.email || Boolean(siteContact?.emailLinks.length);
  const contactability = Math.min(10, (hasWhatsapp ? 4 : 0) + (hasPhone ? 3 : 0) + (hasEmail ? 3 : 0));

  const technologies = new Set(input.facts?.technologies.map((item) => item.technology) ?? []);
  const digitalInvestment = Math.min(
    10,
    (technologies.has("Google Analytics") || technologies.has("Google Tag Manager") ? 3 : 0) +
      (technologies.has("Meta Pixel") ? 2 : 0) +
      (["WooCommerce", "Shopify", "Nuvemshop"].some((technology) => technologies.has(technology)) ? 4 : 0) +
      (["WordPress", "Wix", "Squarespace", "Webflow"].some((technology) => technologies.has(technology)) ? 1 : 0),
  );

  const severity: Record<string, number> = {
    NO_WEBSITE: 25,
    MISSING_VIEWPORT_META: 12,
    NO_HOMEPAGE_FORM: 10,
    NO_HOMEPAGE_SCHEDULING_LINK: 8,
  };

  return calculateLeadScore({
    icpFit: 0,
    problemSeverity: severity[input.signalType] ?? 0,
    commercialActivity: 0,
    contactability,
    digitalInvestment,
    buyingIntent: 0,
    recentlyContacted: input.recentlyContacted,
    insufficientEvidence: contactability === 0 && digitalInvestment === 0,
    doNotContact: input.doNotContact,
  });
}

export function priorityFromScore(score: number): "LOW" | "MEDIUM" | "HIGH" {
  if (score >= 70) return "HIGH";
  if (score >= 45) return "MEDIUM";
  return "LOW";
}
