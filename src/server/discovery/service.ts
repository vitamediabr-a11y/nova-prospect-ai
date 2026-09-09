import {
  companyDedupeKeyFromWebsite,
  evaluateDiscoveryCandidate,
  extractFirstPartyBusinessIdentity,
  normalizeBusinessHostname,
  shouldRefreshWebsiteAnalysis,
  type FirstPartyBusinessIdentity,
} from "@/domain/discovery";
import { WebsiteSecurityError } from "@/domain/ssrf";
import { analyzeWebsiteHtml } from "@/domain/website-analysis";
import { prisma } from "@/lib/prisma";
import { safeFetchHtml, WebsiteFetchError } from "@/server/website/safe-fetch";
import type { DiscoveryProvider } from "./providers/types";

export type VerifiedBusiness = {
  identity: FirstPartyBusinessIdentity;
};

export type AcceptedDiscoveryCompany = {
  companyId: string;
  outcome: "NEW" | "EXISTING";
  analysisStatus: "ANALYZED" | "FRESH" | "ANALYSIS_FAILED";
  identitySource: FirstPartyBusinessIdentity["identitySource"];
  provisional: boolean;
};

export type DiscoveryPipelineResult = {
  providerRequests: number;
  candidatesFound: number;
  candidatesAccepted: number;
  newCompanies: number;
  duplicatesSkipped: number;
  rejectedCandidates: number;
  failedCandidates: number;
  securityBlocked: number;
  acceptedCompanies: AcceptedDiscoveryCompany[];
  providerError?: { code: string; message: string };
};

export class CandidateVerificationError extends Error {
  constructor(
    public readonly code: "CANDIDATE_BLOCKED" | "CANDIDATE_UNREACHABLE" | "CANDIDATE_NOT_ANALYZABLE",
    message: string,
  ) {
    super(message);
    this.name = "CandidateVerificationError";
  }
}

export type DiscoveryRepository = {
  acceptVerified(input: {
    identity: FirstPartyBusinessIdentity;
    actorId: string;
    discoveryRunId: string;
  }): Promise<{ companyId: string; isNew: boolean; websiteAnalyzedAt: Date | null }>;
  recordAccepted(input: {
    actorId: string;
    discoveryRunId: string;
    accepted: AcceptedDiscoveryCompany;
  }): Promise<void>;
};

export type DiscoveryPipelineDependencies = {
  provider: DiscoveryProvider;
  verifyCandidate: (url: string) => Promise<VerifiedBusiness>;
  repository: DiscoveryRepository;
  analyzeCompany: (companyId: string) => Promise<{ ok: boolean }>;
  now?: () => Date;
};

export async function verifyCandidateWebsite(url: string): Promise<VerifiedBusiness> {
  try {
    const response = await safeFetchHtml(url);
    if (response.status < 200 || response.status >= 400) {
      throw new CandidateVerificationError("CANDIDATE_NOT_ANALYZABLE", `O site retornou HTTP ${response.status}.`);
    }
    const facts = analyzeWebsiteHtml(response);
    return { identity: extractFirstPartyBusinessIdentity({ html: response.html, facts }) };
  } catch (error) {
    if (error instanceof CandidateVerificationError) throw error;
    if (error instanceof WebsiteSecurityError) {
      throw new CandidateVerificationError("CANDIDATE_BLOCKED", "URL descartada pelas regras de segurança.");
    }
    if (error instanceof WebsiteFetchError) {
      throw new CandidateVerificationError("CANDIDATE_UNREACHABLE", "O site não respondeu.");
    }
    throw new CandidateVerificationError("CANDIDATE_UNREACHABLE", "O site não pôde ser verificado.");
  }
}

export function createPrismaDiscoveryRepository(): DiscoveryRepository {
  return {
    async acceptVerified({ identity, actorId, discoveryRunId }) {
      const dedupeKey = companyDedupeKeyFromWebsite(identity.website);
      const existing = await prisma.company.findUnique({
        where: { dedupeKey },
        select: { id: true, websiteAnalyzedAt: true },
      });
      if (existing) return { companyId: existing.id, isNew: false, websiteAnalyzedAt: existing.websiteAnalyzedAt };

      try {
        const company = await prisma.$transaction(async (tx) => {
          const created = await tx.company.create({
            data: {
              displayName: identity.displayName,
              displayNameProvisional: identity.provisional,
              website: identity.website,
              whatsapp: identity.whatsapp,
              email: identity.email,
              location: identity.location,
              source: "WEB_SEARCH",
              dedupeKey,
              prospect: { create: { stage: "DISCOVERED", ownerId: actorId } },
            },
            select: { id: true, websiteAnalyzedAt: true },
          });

          await tx.domainEvent.create({
            data: {
              type: "company.discovered",
              aggregateType: "company",
              aggregateId: created.id,
              payload: { companyId: created.id, source: "WEB_SEARCH", discoveryRunId },
              uniqueKey: `company.discovered:${created.id}`,
            },
          });

          await tx.auditLog.create({
            data: {
              actorId,
              action: "company.create",
              entityType: "company",
              entityId: created.id,
              metadata: {
                source: "WEB_SEARCH",
                discoveryRunId,
                identitySource: identity.identitySource,
                provisional: identity.provisional,
              },
            },
          });

          return created;
        });

        return { companyId: company.id, isNew: true, websiteAnalyzedAt: company.websiteAnalyzedAt };
      } catch {
        const concurrent = await prisma.company.findUnique({
          where: { dedupeKey },
          select: { id: true, websiteAnalyzedAt: true },
        });
        if (concurrent) return { companyId: concurrent.id, isNew: false, websiteAnalyzedAt: concurrent.websiteAnalyzedAt };
        throw new Error("Não foi possível persistir a empresa verificada.");
      }
    },

    async recordAccepted({ actorId, discoveryRunId, accepted }) {
      await prisma.auditLog.create({
        data: {
          actorId,
          action: "discovery.company.accepted",
          entityType: "company",
          entityId: accepted.companyId,
          metadata: {
            discoveryRunId,
            outcome: accepted.outcome,
            analysisStatus: accepted.analysisStatus,
            identitySource: accepted.identitySource,
            provisional: accepted.provisional,
          },
        },
      });
    },
  };
}

export async function executeDiscoveryPipeline(input: {
  query: string;
  limit: number;
  actorId: string;
  discoveryRunId: string;
}, deps: DiscoveryPipelineDependencies): Promise<DiscoveryPipelineResult> {
  const result: DiscoveryPipelineResult = {
    providerRequests: 1,
    candidatesFound: 0,
    candidatesAccepted: 0,
    newCompanies: 0,
    duplicatesSkipped: 0,
    rejectedCandidates: 0,
    failedCandidates: 0,
    securityBlocked: 0,
    acceptedCompanies: [],
  };

  let searchResult;
  try {
    searchResult = await deps.provider.search({ query: input.query, limit: input.limit });
    result.providerRequests = Math.max(1, searchResult.providerRequests);
  } catch (error) {
    const candidate = error as { code?: string; message?: string };
    result.providerError = {
      code: candidate.code ?? "SEARCH_PROVIDER_ERROR",
      message: candidate.message ?? "A busca externa falhou.",
    };
    return result;
  }

  result.candidatesFound = searchResult.candidates.length;
  const seenInputHosts = new Set<string>();
  const seenVerifiedHosts = new Set<string>();

  for (const candidate of searchResult.candidates) {
    const decision = evaluateDiscoveryCandidate(candidate.url);
    if (!decision.accepted) {
      result.rejectedCandidates += 1;
      continue;
    }
    if (seenInputHosts.has(decision.hostname)) {
      result.duplicatesSkipped += 1;
      continue;
    }
    seenInputHosts.add(decision.hostname);

    let verified: VerifiedBusiness;
    try {
      verified = await deps.verifyCandidate(decision.url);
    } catch (error) {
      if (error instanceof CandidateVerificationError && error.code === "CANDIDATE_BLOCKED") result.securityBlocked += 1;
      else result.failedCandidates += 1;
      continue;
    }

    const finalHost = normalizeBusinessHostname(verified.identity.website);
    if (seenVerifiedHosts.has(finalHost)) {
      result.duplicatesSkipped += 1;
      continue;
    }
    seenVerifiedHosts.add(finalHost);

    try {
      const persisted = await deps.repository.acceptVerified({
        identity: verified.identity,
        actorId: input.actorId,
        discoveryRunId: input.discoveryRunId,
      });
      result.candidatesAccepted += 1;
      if (persisted.isNew) result.newCompanies += 1;
      else result.duplicatesSkipped += 1;

      let analysisStatus: AcceptedDiscoveryCompany["analysisStatus"] = "FRESH";
      if (persisted.isNew || shouldRefreshWebsiteAnalysis(persisted.websiteAnalyzedAt, deps.now?.() ?? new Date())) {
        const analysis = await deps.analyzeCompany(persisted.companyId);
        analysisStatus = analysis.ok ? "ANALYZED" : "ANALYSIS_FAILED";
        if (!analysis.ok) result.failedCandidates += 1;
      }

      const accepted: AcceptedDiscoveryCompany = {
        companyId: persisted.companyId,
        outcome: persisted.isNew ? "NEW" : "EXISTING",
        analysisStatus,
        identitySource: verified.identity.identitySource,
        provisional: verified.identity.provisional,
      };
      result.acceptedCompanies.push(accepted);
      await deps.repository.recordAccepted({ actorId: input.actorId, discoveryRunId: input.discoveryRunId, accepted });
    } catch {
      result.failedCandidates += 1;
    }
  }

  return result;
}
