import test from "node:test";
import assert from "node:assert/strict";
import { detectOpportunity } from "./opportunity-rules";
import {
  analyzeWebsiteHtml,
  deriveWebsiteSignals,
  detectTechnologies,
  noWebsiteSignal,
  reconcileWebsiteSignalTypes,
  scoreWebsiteOpportunity,
  websiteOpportunityKey,
  websiteSignalKey,
} from "./website-analysis";

const sparseHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <title>Clínica Exemplo</title>
  <link rel="canonical" href="https://example.com/">
  <script src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>
  <script>gtag('config', 'G-TEST'); fbq('init', '123');</script>
  <script src="https://connect.facebook.net/en_US/fbevents.js"></script>
  <link rel="stylesheet" href="/wp-content/themes/site/style.css">
</head>
<body>
  <a href="https://wa.me/5511999999999?text=oi">Fale no WhatsApp</a>
  <a href="tel:+551133334444">Ligar</a>
  <a href="mailto:contato@example.com">Contato</a>
  <div class="woocommerce">Loja</div>
</body>
</html>`;

const richHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <title>Empresa</title>
  <meta name="description" content="Descrição objetiva">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script type="application/ld+json">{"@context":"https://schema.org"}</script>
  <script src="/_next/static/chunks/app.js"></script>
</head>
<body>
  <form action="/contato"><input name="email"></form>
  <a href="https://calendly.com/empresa/reuniao">Agendar conversa</a>
</body>
</html>`;

function analyze(html: string) {
  return analyzeWebsiteHtml({
    html,
    requestedUrl: "https://example.com",
    finalUrl: "https://example.com/",
    status: 200,
    redirects: [],
    contentType: "text/html; charset=utf-8",
  });
}

test("extracts objective homepage facts without storing raw HTML", () => {
  const facts = analyze(sparseHtml);
  assert.equal(facts.status, 200);
  assert.equal(facts.https, true);
  assert.equal(facts.title, "Clínica Exemplo");
  assert.equal(facts.language, "pt-BR");
  assert.equal(facts.forms.count, 0);
  assert.equal(facts.contacts.whatsappLinks.length, 1);
  assert.equal(facts.contacts.phoneLinks.length, 1);
  assert.equal(facts.contacts.emailLinks.length, 1);
  assert.equal(facts.contacts.whatsappLinks[0].includes("?text="), false);
});

test("detects technologies only from observable fingerprints", () => {
  const names = detectTechnologies(sparseHtml).map((item) => item.technology);
  assert.ok(names.includes("WordPress"));
  assert.ok(names.includes("WooCommerce"));
  assert.ok(names.includes("Google Analytics"));
  assert.ok(names.includes("Meta Pixel"));
  assert.ok(names.includes("WhatsApp"));
  assert.equal(names.includes("Shopify"), false);
});

test("generates narrow factual signals from homepage evidence", () => {
  const facts = analyze(sparseHtml);
  const types = deriveWebsiteSignals(facts).map((signal) => signal.type);
  assert.ok(types.includes("MISSING_VIEWPORT_META"));
  assert.ok(types.includes("NO_HOMEPAGE_FORM"));
  assert.ok(types.includes("WHATSAPP_PRESENT"));
  assert.ok(types.includes("NO_HOMEPAGE_SCHEDULING_LINK"));
  assert.ok(types.includes("ANALYTICS_DETECTED"));
  assert.ok(types.includes("META_PIXEL_DETECTED"));
  assert.ok(types.includes("ECOMMERCE_PLATFORM_DETECTED"));
  assert.ok(types.includes("CMS_DETECTED"));
  assert.ok(types.includes("NO_META_DESCRIPTION"));
  assert.ok(types.includes("NO_STRUCTURED_DATA"));
});

test("repeated analysis uses stable keys and resolves findings that disappear", () => {
  const companyId = "company-1";
  assert.equal(websiteSignalKey(companyId, "NO_HOMEPAGE_FORM"), websiteSignalKey(companyId, "NO_HOMEPAGE_FORM"));
  assert.equal(websiteOpportunityKey(companyId, "NO_HOMEPAGE_FORM"), "website:company-1:NO_HOMEPAGE_FORM");

  const firstTypes = deriveWebsiteSignals(analyze(sparseHtml)).map((signal) => signal.type);
  const secondTypes = deriveWebsiteSignals(analyze(richHtml)).map((signal) => signal.type);
  const reconciliation = reconcileWebsiteSignalTypes(firstTypes, secondTypes);
  assert.ok(reconciliation.resolved.includes("NO_HOMEPAGE_FORM"));
  assert.ok(reconciliation.resolved.includes("MISSING_VIEWPORT_META"));
});

test("NO_WEBSITE is factual and deterministic", () => {
  const signal = noWebsiteSignal("company-1");
  assert.equal(signal.type, "NO_WEBSITE");
  assert.equal(signal.confidence, 1);
  assert.equal(signal.evidence.websiteRegistered, false);
});

test("website opportunity score uses existing deterministic scorer", () => {
  const facts = analyze(sparseHtml);
  const first = scoreWebsiteOpportunity({
    signalType: "MISSING_VIEWPORT_META",
    facts,
    knownContact: { whatsapp: false, phone: false, email: false },
    doNotContact: false,
    recentlyContacted: false,
  });
  const second = scoreWebsiteOpportunity({
    signalType: "MISSING_VIEWPORT_META",
    facts,
    knownContact: { whatsapp: false, phone: false, email: false },
    doNotContact: false,
    recentlyContacted: false,
  });
  assert.deepEqual(first, second);
  assert.ok(first.total < 70);
});

test("new website signals integrate through the existing opportunity rules", () => {
  const suggestion = detectOpportunity({
    type: "NO_HOMEPAGE_FORM",
    confidence: 1,
    evidence: { scope: "homepage", formCount: 0 },
  });
  assert.ok(suggestion);
  assert.match(suggestion.problem, /homepage/i);
});
