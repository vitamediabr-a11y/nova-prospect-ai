import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDiscoveryQuery,
  companyDedupeKeyFromWebsite,
  evaluateDiscoveryCandidate,
  extractFirstPartyBusinessIdentity,
  normalizeBusinessHostname,
  shouldRefreshWebsiteAnalysis,
} from "./discovery";
import { analyzeWebsiteHtml } from "./website-analysis";

function factsFor(html: string, finalUrl = "https://clinicabemestar.com.br/") {
  return analyzeWebsiteHtml({
    html,
    requestedUrl: finalUrl,
    finalUrl,
    status: 200,
    redirects: [],
    contentType: "text/html; charset=utf-8",
  });
}

test("builds one deterministic search query without query explosion", () => {
  assert.equal(
    buildDiscoveryQuery({ segment: " clínica odontológica ", location: " Belém, PA ", additionalTerms: " implantes " }),
    "clínica odontológica Belém, PA implantes",
  );
});

test("rejects social, directory and non-HTML candidates", () => {
  assert.deepEqual(evaluateDiscoveryCandidate("https://instagram.com/clinica"), { accepted: false, reason: "BLOCKED_HOST" });
  assert.deepEqual(evaluateDiscoveryCandidate("https://doctoralia.com.br/clinica/x"), { accepted: false, reason: "BLOCKED_HOST" });
  assert.deepEqual(evaluateDiscoveryCandidate("https://example.com/catalogo.pdf"), { accepted: false, reason: "NON_HTML_FILE" });
  assert.equal(evaluateDiscoveryCandidate("https://empresa.com.br").accepted, true);
});

test("normalizes canonical business host for deterministic dedupe", () => {
  assert.equal(normalizeBusinessHostname("http://www.Example.com/abc"), "example.com");
  assert.equal(companyDedupeKeyFromWebsite("https://www.example.com/"), "web:example.com");
  assert.equal(companyDedupeKeyFromWebsite("http://example.com/outro"), "web:example.com");
});

test("extracts first-party identity from JSON-LD and ignores search intent", () => {
  const html = `<!doctype html><html><head>
    <title>Resultado de busca não usado</title>
    <script type="application/ld+json">{
      "@type":"Dentist",
      "name":"Clínica Bem Estar",
      "address":{"addressLocality":"Belém","addressRegion":"PA"},
      "email":"CONTATO@CLINICA.COM.BR"
    }</script>
  </head><body><a href="https://wa.me/5591999999999">WhatsApp</a></body></html>`;
  const identity = extractFirstPartyBusinessIdentity({ html, facts: factsFor(html) });
  assert.equal(identity.displayName, "Clínica Bem Estar");
  assert.equal(identity.identitySource, "JSON_LD");
  assert.equal(identity.provisional, false);
  assert.equal(identity.location, "Belém, PA");
  assert.equal(identity.email, "contato@clinica.com.br");
  assert.equal(identity.whatsapp, "5591999999999");
});

test("falls back to hostname as a clearly provisional identity", () => {
  const html = "<!doctype html><html><head></head><body>Empresa</body></html>";
  const identity = extractFirstPartyBusinessIdentity({ html, facts: factsFor(html) });
  assert.equal(identity.displayName, "clinicabemestar.com.br");
  assert.equal(identity.provisional, true);
  assert.equal(identity.identitySource, "HOSTNAME");
});

test("only refreshes existing website intelligence after the staleness threshold", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  assert.equal(shouldRefreshWebsiteAnalysis(null, now), true);
  assert.equal(shouldRefreshWebsiteAnalysis(new Date("2026-09-04T12:00:00Z"), now), false);
  assert.equal(shouldRefreshWebsiteAnalysis(new Date("2026-09-01T12:00:00Z"), now), true);
});
