import {
  DISCOVERY_CONCURRENCY,
  DISCOVERY_MAX_CANDIDATES,
  companyDedupeKeyFromWebsite,
  evaluateDiscoveryCandidate,
  extractFirstPartyBusinessIdentity,
  normalizeBusinessHostname,
  shouldRefreshWebsiteAnalysis,
  type FirstPartyBusinessIdentity,
} from "@/domain/discovery";
import { WebsiteSecurityError } from "@/domain/ssrf";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { safeFetchHtml, WebsiteFetchError } from "@/server/website/safe-fetch";
import {
  analyzeSafeWebsiteResponse,
  type VerifiedWebsiteAnalysis,
} from "@/server/website/service";
import type { DiscoveryProvider } from "./providers/types";

export type VerifiedBusiness = {
  identity: FirstPartyBusinessIdentity;
  analysis: VerifiedWebsiteAnalysis;
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
  analyzeCompany: (companyId: string, analysis: VerifiedWebsiteAnalysis) => Promise<{ ok: boolean }>;
  now?: () => Date;
};

export async function verifyCandidateWebsite(url: string): Promise<VerifiedBusiness> {
  try {
    const response = await safeFetchHtml(url);
    const analysis = analyzeSafeWebsiteResponse(response);
    if (analysis.facts.status < 200 || analysis.facts.status >= 400) {
      throw new CandidateVerificationError("CANDIDATE_NOT_ANALYZABLE", `O site retornou HTTP ${analysis.facts.status}.`);
    }
    return {
      identity: extractFirstPartyBusinessIdentity({ html: response.html, facts: analysis.facts }),
      analysis,
    };
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

function softMatchConditions(identity: FirstPartyBusinessIdentity): Prisma.CompanyWhereInput[] {
  const conditions: Prisma.CompanyWhereInput[] = [];
  if (identity.whatsapp) conditions.push({ whatsapp: identity.whatsapp });
  if (identity.email) conditions.push({ email: { equals: identity.email, mode: "insensitive" } });
  if (!identity.provisional && identity.location) {
    conditions.push({
      AND: [
        { displayName: { equals: identity.displayName, mode: "insensitive" } },
        { location: { equals: identity.location, mode: "insensitive" } },
      ],
    });
  }
  return conditions;
}

function softMatchEvidence(identity: FirstPartyBusinessIdentity) {
  const evidence: string[] = [];
  if (identity.whatsapp) evidence.push("WHATSAPP");
  if (identity.email) evidence.push("EMAIL");
  if (!identity.provisional && identity.location) evidence.push("NAME_LOCATION");
  return evidence;
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

      const softConditions = softMatchConditions(identity);
      const possibleDuplicates = softConditions.length > 0
        ? await prisma.company.findMany({
            where: { OR: softConditions },
            select: { id: true },
            take: 5,
          })
        : [];

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
                possibleDuplicateCount: possibleDuplicates.length,
              },
            },
          });

          if (possibleDuplicates.length > 0) {
            await tx.auditLog.create({
              data: {
                actorId,
                action: "discovery.possible_duplicate",
                entityType: "company",
                entityId: created.id,
                metadata: {
                  discoveryRunId,
                  evidence: softMatchEvidence(identity),
                  matchedCompanyIds: possibleDuplicates.map((company) => company.id),
                },
              },
            });
          }

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
    searchResult = await deps.provider.search({ query: input.query, limit: Math.min(input.limit, DISCOVERY_MAX_CANDIDATES) });
    result.providerRequests = Math.max(1, searchResult.providerRequests);
  } catch (error) {
    const candidate = error as { code?: string; message?: string };
    result.providerError = {
      code: candidate.code ?? "SEARCH_PROVIDER_ERROR",
      message: candidate.message ?? "A busca externa falhou.",
    };
    return result;
  }

  const providerCandidates = searchResult.candidates.slice(0, Math.min(input.limit, DISCOVERY_MAX_CANDIDATES));
  result.candidatesFound = providerCandidates.length;

  const seenInputHosts = new Set<string>();
  const candidatesToVerify: Array<{ url: string }> = [];
  for (const candidate of providerCandidates) {
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
    candidatesToVerify.push({ url: decision.url });
  }

  const seenVerifiedHosts = new Set<string>();
  async function processCandidate(candidate: { url: string }) {
    let verified: VerifiedBusiness;
    try {
      verified = await deps.verifyCandidate(candidate.url);
    } catch (error) {
      if (error instanceof CandidateVerificationError && error.code === "CANDIDATE_BLOCKED") result.securityBlocked += 1;
      else result.failedCandidates += 1;
      return;
    }

    const verifiedDecision = evaluateDiscoveryCandidate(verified.identity.website);
    if (!verifiedDecision.accepted) {
      result.rejectedCandidates += 1;
      return;
    }

    const finalHost = normalizeBusinessHostname(verified.identity.website);
    if (seenVerifiedHosts.has(finalHost)) {
      result.duplicatesSkipped += 1;
      return;
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
        const analysis = await deps.analyzeCompany(persisted.companyId, verified.analysis);
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

  let nextCandidate = 0;
  async function worker() {
    while (true) {
      const index = nextCandidate;
      nextCandidate += 1;
      if (index >= candidatesToVerify.length) return;
      await processCandidate(candidatesToVerify[index]);
    }
  }

  const workerCount = Math.min(DISCOVERY_CONCURRENCY, candidatesToVerify.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return result;
}
