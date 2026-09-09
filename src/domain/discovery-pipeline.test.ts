import test from "node:test";
import assert from "node:assert/strict";
import { DISCOVERY_CONCURRENCY } from "./discovery";
import type { FirstPartyBusinessIdentity } from "./discovery";
import { BraveSearchProvider } from "@/server/discovery/providers/brave";
import { DiscoveryProviderError, type DiscoveryProvider } from "@/server/discovery/providers/types";
import { executeDiscoveryRunBoundary } from "@/server/discovery/run-boundary";
import {
  CandidateVerificationError,
  executeDiscoveryPipeline,
  type DiscoveryRepository,
  type VerifiedBusiness,
} from "@/server/discovery/service";
import { analyzeSafeWebsiteResponse } from "@/server/website/service";

const identity: FirstPartyBusinessIdentity = {
  displayName: "Clínica Bem Estar",
  provisional: false,
  identitySource: "JSON_LD",
  website: "https://clinicabemestar.com.br/",
  hostname: "clinicabemestar.com.br",
  location: "Belém, PA",
  email: "contato@clinicabemestar.com.br",
  whatsapp: "5591999999999",
};

function identityFor(input: {
  hostname: string;
  displayName?: string;
  email?: string | null;
  whatsapp?: string | null;
  location?: string | null;
}): FirstPartyBusinessIdentity {
  return {
    displayName: input.displayName ?? input.hostname,
    provisional: false,
    identitySource: "JSON_LD",
    website: `https://${input.hostname}/`,
    hostname: input.hostname,
    location: input.location ?? "Belém, PA",
    email: input.email ?? null,
    whatsapp: input.whatsapp ?? null,
  };
}

function analysisFor(url: string) {
  return analyzeSafeWebsiteResponse({
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    redirects: [],
    contentType: "text/html; charset=utf-8",
    html: "<!doctype html><html><head><title>Empresa</title></head><body>Empresa</body></html>",
  });
}

function verifiedFor(business: FirstPartyBusinessIdentity): VerifiedBusiness {
  return { identity: business, analysis: analysisFor(business.website) };
}

function provider(urls: string[]): DiscoveryProvider {
  return {
    name: "FIXTURE",
    async search() {
      return { candidates: urls.map((url) => ({ url })), providerRequests: 1 };
    },
  };
}

function memoryRepository() {
  const companies = new Map<string, { id: string; websiteAnalyzedAt: Date | null }>();
  const prospects = new Set<string>();
  const acceptedAudit: Array<Record<string, unknown>> = [];
  let nextId = 1;

  const repository: DiscoveryRepository = {
    async acceptVerified({ identity: verifiedIdentity }) {
      const key = verifiedIdentity.hostname;
      const existing = companies.get(key);
      if (existing) return { companyId: existing.id, isNew: false, websiteAnalyzedAt: existing.websiteAnalyzedAt };
      const id = `company-${nextId++}`;
      companies.set(key, { id, websiteAnalyzedAt: null });
      prospects.add(id);
      return { companyId: id, isNew: true, websiteAnalyzedAt: null };
    },
    async recordAccepted(input) {
      acceptedAudit.push({ ...input.accepted, discoveryRunId: input.discoveryRunId });
    },
  };

  return { repository, companies, prospects, acceptedAudit };
}

function verified(): Promise<VerifiedBusiness> {
  return Promise.resolve(verifiedFor(identity));
}

test("Brave response validation extracts only transient candidate URLs", async () => {
  const apiKey = "secret-test-key";
  const adapter = new BraveSearchProvider(apiKey, async () => new Response(JSON.stringify({
    web: {
      results: [
        { url: "https://empresa-a.com", title: "Provider title", description: "Provider snippet must disappear" },
        { url: "https://empresa-b.com", title: "Other title", description: "Other snippet" },
      ],
    },
  }), { status: 200, headers: { "content-type": "application/json" } }));

  const result = await adapter.search({ query: "empresa", limit: 10 });
  assert.deepEqual(result, {
    candidates: [{ url: "https://empresa-a.com" }, { url: "https://empresa-b.com" }],
    providerRequests: 1,
  });
  assert.equal(JSON.stringify(result).includes("Provider snippet"), false);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
});

test("Brave adapter reports provider rate limit without leaking credentials", async () => {
  const apiKey = "secret-rate-limit-key";
  const adapter = new BraveSearchProvider(apiKey, async () => new Response("{}", { status: 429 }));
  await assert.rejects(
    () => adapter.search({ query: "empresa", limit: 10 }),
    (error: unknown) => {
      assert.ok(error instanceof DiscoveryProviderError);
      assert.equal(error.code, "SEARCH_PROVIDER_RATE_LIMITED");
      assert.equal(error.message.includes(apiKey), false);
      return true;
    },
  );
});

test("Brave adapter exposes explicit not-configured state", () => {
  assert.throws(
    () => new BraveSearchProvider(""),
    (error: unknown) => error instanceof DiscoveryProviderError && error.code === "SEARCH_PROVIDER_NOT_CONFIGURED",
  );
});

test("failed candidate does not kill the discovery run", async () => {
  const memory = memoryRepository();
  const result = await executeDiscoveryPipeline({
    query: "clínica Belém",
    limit: 10,
    actorId: "user-1",
    discoveryRunId: "run-1",
  }, {
    provider: provider(["https://falha.com", "https://clinicabemestar.com.br"]),
    verifyCandidate: async (url) => {
      if (url.includes("falha.com")) throw new CandidateVerificationError("CANDIDATE_UNREACHABLE", "falhou");
      return verified();
    },
    repository: memory.repository,
    analyzeCompany: async (companyId) => {
      memory.companies.get(identity.hostname)!.websiteAnalyzedAt = new Date("2026-09-09T12:00:00Z");
      assert.equal(companyId, "company-1");
      return { ok: true };
    },
    now: () => new Date("2026-09-09T12:00:00Z"),
  });

  assert.equal(result.failedCandidates, 1);
  assert.equal(result.candidatesAccepted, 1);
  assert.equal(memory.companies.size, 1);
});

test("unverified candidate never creates a Company", async () => {
  const memory = memoryRepository();
  const result = await executeDiscoveryPipeline({
    query: "clínica Belém",
    limit: 10,
    actorId: "user-1",
    discoveryRunId: "run-1",
  }, {
    provider: provider(["https://nao-verificada.com"]),
    verifyCandidate: async () => { throw new CandidateVerificationError("CANDIDATE_UNREACHABLE", "falhou"); },
    repository: memory.repository,
    analyzeCompany: async () => ({ ok: true }),
  });

  assert.equal(result.candidatesAccepted, 0);
  assert.equal(memory.companies.size, 0);
  assert.equal(memory.prospects.size, 0);
});

test("deterministic integration creates one Company and Prospect and invokes Website Intelligence once", async () => {
  const memory = memoryRepository();
  let websiteFetches = 0;
  let intelligenceCalls = 0;

  const result = await executeDiscoveryPipeline({
    query: "clínica odontológica Belém PA",
    limit: 10,
    actorId: "user-1",
    discoveryRunId: "run-1",
  }, {
    provider: provider([
      "https://clinicabemestar.com.br",
      "https://www.clinicabemestar.com.br/contato",
      "https://instagram.com/clinicabemestar",
    ]),
    verifyCandidate: async () => {
      websiteFetches += 1;
      return verified();
    },
    repository: memory.repository,
    analyzeCompany: async (_companyId, analysis) => {
      intelligenceCalls += 1;
      assert.equal(analysis.facts.finalUrl, identity.website);
      memory.companies.get(identity.hostname)!.websiteAnalyzedAt = new Date("2026-09-09T12:00:00Z");
      return { ok: true };
    },
    now: () => new Date("2026-09-09T12:00:00Z"),
  });

  assert.equal(result.newCompanies, 1);
  assert.equal(result.candidatesAccepted, 1);
  assert.equal(memory.companies.size, 1);
  assert.equal(memory.prospects.size, 1);
  assert.equal(websiteFetches, 1);
  assert.equal(intelligenceCalls, 1);
  assert.equal(memory.acceptedAudit.length, 1);
  assert.equal(JSON.stringify(memory.acceptedAudit).includes("snippet"), false);
});

test("shared WhatsApp is a soft match and does not merge distinct website identities", async () => {
  const memory = memoryRepository();
  const centro = identityFor({ hostname: "clinicacentro.com.br", displayName: "Clínica Centro", whatsapp: "5591999999999" });
  const norte = identityFor({ hostname: "clinicanorte.com.br", displayName: "Clínica Norte", whatsapp: "5591999999999" });
  const byHost = new Map([[centro.hostname, centro], [norte.hostname, norte]]);

  const result = await executeDiscoveryPipeline({ query: "q", limit: 10, actorId: "u", discoveryRunId: "r" }, {
    provider: provider([centro.website, norte.website]),
    verifyCandidate: async (url) => verifiedFor(byHost.get(new URL(url).hostname)! ),
    repository: memory.repository,
    analyzeCompany: async () => ({ ok: true }),
  });

  assert.equal(result.newCompanies, 2);
  assert.equal(memory.companies.size, 2);
});

test("shared e-mail is a soft match and does not merge distinct website identities", async () => {
  const memory = memoryRepository();
  const a = identityFor({ hostname: "empresa-a.com.br", displayName: "Empresa A", email: "contato@grupo.com.br" });
  const b = identityFor({ hostname: "empresa-b.com.br", displayName: "Empresa B", email: "contato@grupo.com.br" });
  const byHost = new Map([[a.hostname, a], [b.hostname, b]]);

  const result = await executeDiscoveryPipeline({ query: "q", limit: 10, actorId: "u", discoveryRunId: "r" }, {
    provider: provider([a.website, b.website]),
    verifyCandidate: async (url) => verifiedFor(byHost.get(new URL(url).hostname)! ),
    repository: memory.repository,
    analyzeCompany: async () => ({ ok: true }),
  });

  assert.equal(result.newCompanies, 2);
  assert.equal(memory.companies.size, 2);
});

test("www and apex variants remain one hard website identity", async () => {
  const memory = memoryRepository();
  let websiteFetches = 0;
  const business = identityFor({ hostname: "empresa.com", displayName: "Empresa" });

  const result = await executeDiscoveryPipeline({ query: "q", limit: 10, actorId: "u", discoveryRunId: "r" }, {
    provider: provider(["https://empresa.com", "https://www.empresa.com/"]),
    verifyCandidate: async () => {
      websiteFetches += 1;
      return verifiedFor(business);
    },
    repository: memory.repository,
    analyzeCompany: async () => ({ ok: true }),
  });

  assert.equal(result.newCompanies, 1);
  assert.equal(memory.companies.size, 1);
  assert.equal(websiteFetches, 1);
});

test("candidate processing never exceeds bounded concurrency", async () => {
  const memory = memoryRepository();
  const urls = Array.from({ length: 8 }, (_, index) => `https://empresa-${index}.com.br/`);
  let active = 0;
  let maxActive = 0;

  await executeDiscoveryPipeline({ query: "q", limit: 10, actorId: "u", discoveryRunId: "r" }, {
    provider: provider(urls),
    verifyCandidate: async (url) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      const hostname = new URL(url).hostname;
      return verifiedFor(identityFor({ hostname, displayName: hostname }));
    },
    repository: memory.repository,
    analyzeCompany: async () => ({ ok: true }),
  });

  assert.equal(maxActive, DISCOVERY_CONCURRENCY);
  assert.ok(maxActive <= DISCOVERY_CONCURRENCY);
  assert.equal(memory.companies.size, 8);
});

test("repeated discovery run reuses existing Company and skips fresh re-analysis", async () => {
  const memory = memoryRepository();
  let intelligenceCalls = 0;
  const deps = {
    provider: provider(["https://clinicabemestar.com.br"]),
    verifyCandidate: async () => verified(),
    repository: memory.repository,
    analyzeCompany: async () => {
      intelligenceCalls += 1;
      memory.companies.get(identity.hostname)!.websiteAnalyzedAt = new Date("2026-09-09T12:00:00Z");
      return { ok: true };
    },
    now: () => new Date("2026-09-09T12:00:00Z"),
  };

  const first = await executeDiscoveryPipeline({ query: "q", limit: 10, actorId: "u", discoveryRunId: "r1" }, deps);
  const second = await executeDiscoveryPipeline({ query: "q", limit: 10, actorId: "u", discoveryRunId: "r2" }, deps);

  assert.equal(first.newCompanies, 1);
  assert.equal(second.newCompanies, 0);
  assert.equal(memory.companies.size, 1);
  assert.equal(memory.prospects.size, 1);
  assert.equal(intelligenceCalls, 1);
});

test("provider failure is contained as a run-level provider error", async () => {
  const memory = memoryRepository();
  const failingProvider: DiscoveryProvider = {
    name: "FIXTURE",
    async search() {
      throw new DiscoveryProviderError("SEARCH_PROVIDER_RATE_LIMITED", "O provedor de busca atingiu o limite temporário.");
    },
  };

  const result = await executeDiscoveryPipeline({ query: "q", limit: 10, actorId: "u", discoveryRunId: "r" }, {
    provider: failingProvider,
    verifyCandidate: async () => verified(),
    repository: memory.repository,
    analyzeCompany: async () => ({ ok: true }),
  });

  assert.equal(result.providerError?.code, "SEARCH_PROVIDER_RATE_LIMITED");
  assert.equal(memory.companies.size, 0);
});

test("unexpected run-level failure invokes the FAILED transition boundary", async () => {
  let markedCode: string | null = null;
  const result = await executeDiscoveryRunBoundary({
    execute: async () => {
      throw new Error("unexpected internal failure");
    },
    markFailed: async (failure) => {
      markedCode = failure.code;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(markedCode, "DISCOVERY_UNEXPECTED_ERROR");
  if (!result.ok) assert.equal(result.failure.message, "A execução da busca foi interrompida por um erro interno.");
});
