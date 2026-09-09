import { detectOpportunity } from "@/domain/opportunity-rules";
import { WebsiteSecurityError } from "@/domain/ssrf";
import {
  WEBSITE_MANAGED_SIGNAL_TYPES,
  analyzeWebsiteHtml,
  deriveWebsiteSignals,
  noWebsiteSignal,
  priorityFromScore,
  reconcileWebsiteSignalTypes,
  scoreWebsiteOpportunity,
  websiteOpportunityKey,
  websiteSignalKey,
  type WebsiteAnalysisFacts,
  type WebsiteSignalCandidate,
} from "@/domain/website-analysis";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { safeFetchHtml, WebsiteFetchError, type SafeHtmlResponse } from "./safe-fetch";

export type AnalyzeCompanyWebsiteResult =
  | { ok: true; status: "COMPLETED" | "NO_WEBSITE"; message: string }
  | { ok: false; status: "SECURITY_BLOCKED" | "UNREACHABLE" | "NOT_ANALYZABLE" | "NOT_FOUND"; message: string };

const VERIFIED_SAFE_RESPONSE = Symbol("verified-safe-website-response");

export type VerifiedWebsiteAnalysis = {
  readonly facts: WebsiteAnalysisFacts;
  readonly [VERIFIED_SAFE_RESPONSE]: true;
};

type CompanyWebsiteContext = {
  id: string;
  website: string | null;
  whatsapp: string | null;
  email: string | null;
  doNotContact: boolean;
  prospect: { ownerId: string | null; lastContactAt: Date | null } | null;
};

type ManagedSignalState = {
  id: string;
  type: string;
  resolvedAt: Date | null;
};

function toJsonArray(value: unknown[]): Prisma.InputJsonArray {
  return value.map((item) => toJsonNested(item));
}

function toJsonNested(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return toJsonArray(value);
  if (typeof value === "object") {
    const result: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined) result[key] = toJsonNested(nested);
    }
    return result;
  }
  return String(value);
}

function toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  const result: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested !== undefined) result[key] = toJsonNested(nested);
  }
  return result;
}

function wasRecentlyContacted(lastContactAt: Date | null, now: Date) {
  if (!lastContactAt) return false;
  return now.getTime() - lastContactAt.getTime() < 30 * 24 * 60 * 60 * 1000;
}

async function getCompanyContext(companyId: string): Promise<CompanyWebsiteContext | null> {
  return prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      website: true,
      whatsapp: true,
      email: true,
      doNotContact: true,
      prospect: { select: { ownerId: true, lastContactAt: true } },
    },
  });
}

async function resolveSignalsAndLinkedOpportunities(
  tx: Prisma.TransactionClient,
  input: { companyId: string; signals: ManagedSignalState[]; resolvedAt: Date },
) {
  const activeSignals = input.signals.filter((signal) => signal.resolvedAt === null);
  if (activeSignals.length === 0) return;

  const signalIds = activeSignals.map((signal) => signal.id);
  await tx.signal.updateMany({
    where: { id: { in: signalIds }, resolvedAt: null },
    data: { resolvedAt: input.resolvedAt },
  });

  const activeOpportunities = await tx.opportunity.findMany({
    where: {
      signalId: { in: signalIds },
      dedupeKey: { startsWith: `website:${input.companyId}:` },
      resolvedAt: null,
    },
    select: { id: true, signalId: true },
  });

  if (activeOpportunities.length > 0) {
    await tx.opportunity.updateMany({
      where: { id: { in: activeOpportunities.map((opportunity) => opportunity.id) }, resolvedAt: null },
      data: { resolvedAt: input.resolvedAt },
    });
  }

  const transitionKey = input.resolvedAt.toISOString();
  await tx.domainEvent.createMany({
    data: [
      ...activeSignals.map((signal) => ({
        type: "signal.resolved",
        aggregateType: "signal",
        aggregateId: signal.id,
        payload: { companyId: input.companyId, signalType: signal.type },
        uniqueKey: `signal.resolved:${signal.id}:${transitionKey}`,
      })),
      ...activeOpportunities.map((opportunity) => ({
        type: "opportunity.resolved",
        aggregateType: "opportunity",
        aggregateId: opportunity.id,
        payload: { companyId: input.companyId, signalId: opportunity.signalId },
        uniqueKey: `opportunity.resolved:${opportunity.id}:${transitionKey}`,
      })),
    ],
    skipDuplicates: true,
  });
}

async function persistWebsiteResult(input: {
  company: CompanyWebsiteContext;
  actorId: string;
  facts: WebsiteAnalysisFacts | null;
  candidates: WebsiteSignalCandidate[];
  analyzedAt: Date;
  snapshot: Prisma.InputJsonObject;
}) {
  const { company, actorId, facts, candidates, analyzedAt, snapshot } = input;
  const currentTypes = candidates.map((candidate) => candidate.type);

  await prisma.$transaction(async (tx) => {
    const existingSignals = await tx.signal.findMany({
      where: {
        companyId: company.id,
        source: "WEBSITE_ANALYZER",
        type: { in: [...WEBSITE_MANAGED_SIGNAL_TYPES] },
      },
      select: { id: true, type: true, resolvedAt: true },
    });

    const reconciliation = reconcileWebsiteSignalTypes(
      existingSignals.map((signal) => signal.type),
      currentTypes,
    );

    const signalsToResolve = existingSignals.filter((signal) => reconciliation.resolved.includes(signal.type));
    await resolveSignalsAndLinkedOpportunities(tx, {
      companyId: company.id,
      signals: signalsToResolve,
      resolvedAt: analyzedAt,
    });

    for (const candidate of candidates) {
      const dedupeKey = websiteSignalKey(company.id, candidate.type);
      const previousSignal = existingSignals.find((signal) => signal.type === candidate.type) ?? null;
      const signal = await tx.signal.upsert({
        where: { dedupeKey },
        create: {
          companyId: company.id,
          type: candidate.type,
          source: "WEBSITE_ANALYZER",
          confidence: candidate.confidence,
          evidence: toJsonObject(candidate.evidence),
          dedupeKey,
          detectedAt: analyzedAt,
          lastObservedAt: analyzedAt,
        },
        update: {
          confidence: candidate.confidence,
          evidence: toJsonObject(candidate.evidence),
          lastObservedAt: analyzedAt,
          resolvedAt: null,
        },
      });

      const signalEvents = [{
        type: "signal.detected",
        aggregateType: "signal",
        aggregateId: signal.id,
        payload: { companyId: company.id, signalType: signal.type, source: "WEBSITE_ANALYZER" },
        uniqueKey: `signal.detected:${signal.id}`,
      }];
      if (previousSignal?.resolvedAt) {
        signalEvents.push({
          type: "signal.reactivated",
          aggregateType: "signal",
          aggregateId: signal.id,
          payload: { companyId: company.id, signalType: signal.type, source: "WEBSITE_ANALYZER" },
          uniqueKey: `signal.reactivated:${signal.id}:${previousSignal.resolvedAt.toISOString()}`,
        });
      }
      await tx.domainEvent.createMany({ data: signalEvents, skipDuplicates: true });

      const suggestion = detectOpportunity(signal);
      if (!suggestion) continue;

      const score = scoreWebsiteOpportunity({
        signalType: signal.type,
        facts,
        knownContact: {
          whatsapp: Boolean(company.whatsapp),
          phone: false,
          email: Boolean(company.email),
        },
        doNotContact: company.doNotContact,
        recentlyContacted: wasRecentlyContacted(company.prospect?.lastContactAt ?? null, analyzedAt),
      });
      const opportunityDedupeKey = websiteOpportunityKey(company.id, signal.type);
      const previousOpportunity = await tx.opportunity.findUnique({
        where: { dedupeKey: opportunityDedupeKey },
        select: { id: true, resolvedAt: true },
      });
      const opportunity = await tx.opportunity.upsert({
        where: { dedupeKey: opportunityDedupeKey },
        create: {
          companyId: company.id,
          signalId: signal.id,
          ownerId: company.prospect?.ownerId ?? null,
          dedupeKey: opportunityDedupeKey,
          problem: suggestion.problem,
          evidence: toJsonObject({ signalType: signal.type, signalEvidence: candidate.evidence }),
          businessImpact: suggestion.businessImpact,
          recommendedSolution: suggestion.recommendedSolution,
          score: score.total,
          scoreBreakdown: toJsonObject({ components: score.components, explanation: score.explanation, eligible: score.eligible }),
          priority: priorityFromScore(score.total),
          resolvedAt: null,
        },
        update: {
          signalId: signal.id,
          ownerId: company.prospect?.ownerId ?? null,
          problem: suggestion.problem,
          evidence: toJsonObject({ signalType: signal.type, signalEvidence: candidate.evidence }),
          businessImpact: suggestion.businessImpact,
          recommendedSolution: suggestion.recommendedSolution,
          score: score.total,
          scoreBreakdown: toJsonObject({ components: score.components, explanation: score.explanation, eligible: score.eligible }),
          priority: priorityFromScore(score.total),
          resolvedAt: null,
        },
      });

      const opportunityEvents = [{
        type: "opportunity.created",
        aggregateType: "opportunity",
        aggregateId: opportunity.id,
        payload: { companyId: company.id, signalId: signal.id, source: "WEBSITE_ANALYZER" },
        uniqueKey: `opportunity.created:${opportunity.id}`,
      }];
      if (previousOpportunity?.resolvedAt) {
        opportunityEvents.push({
          type: "opportunity.reactivated",
          aggregateType: "opportunity",
          aggregateId: opportunity.id,
          payload: { companyId: company.id, signalId: signal.id, source: "WEBSITE_ANALYZER" },
          uniqueKey: `opportunity.reactivated:${opportunity.id}:${previousOpportunity.resolvedAt.toISOString()}`,
        });
      }
      await tx.domainEvent.createMany({ data: opportunityEvents, skipDuplicates: true });
    }

    await tx.company.update({
      where: { id: company.id },
      data: {
        websiteAnalysis: snapshot,
        websiteAnalyzedAt: analyzedAt,
        technologySignals: facts ? toJsonArray(facts.technologies) : undefined,
      },
    });

    await tx.domainEvent.createMany({
      data: [{
        type: "website.analyzed",
        aggregateType: "company",
        aggregateId: company.id,
        payload: { companyId: company.id },
        uniqueKey: `website.analyzed:${company.id}`,
      }],
      skipDuplicates: true,
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: "website.analysis.complete",
        entityType: "company",
        entityId: company.id,
        metadata: { signalCount: candidates.length, hasWebsite: Boolean(company.website) },
      },
    });
  });
}

async function persistAnalysisFailure(input: {
  company: CompanyWebsiteContext;
  actorId: string;
  analyzedAt: Date;
  status: AnalyzeCompanyWebsiteResult["status"];
  code: string;
  message: string;
  facts?: WebsiteAnalysisFacts;
}) {
  const { company, actorId, analyzedAt, status, code, message, facts } = input;
  await prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: company.id },
      data: {
        websiteAnalysis: toJsonObject({ status, code, message, requestedUrl: company.website, facts }),
        websiteAnalyzedAt: analyzedAt,
      },
    });

    if (company.website) {
      const noWebsite = await tx.signal.findUnique({
        where: { dedupeKey: websiteSignalKey(company.id, "NO_WEBSITE") },
        select: { id: true, type: true, resolvedAt: true },
      });
      if (noWebsite) {
        await resolveSignalsAndLinkedOpportunities(tx, {
          companyId: company.id,
          signals: [noWebsite],
          resolvedAt: analyzedAt,
        });
      }
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: "website.analysis.failed",
        entityType: "company",
        entityId: company.id,
        metadata: { status, code },
      },
    });
  });
}

export function analyzeSafeWebsiteResponse(response: SafeHtmlResponse): VerifiedWebsiteAnalysis {
  return {
    facts: analyzeWebsiteHtml(response),
    [VERIFIED_SAFE_RESPONSE]: true,
  };
}

export async function persistVerifiedCompanyWebsite(input: {
  companyId: string;
  actorId: string;
  analysis: VerifiedWebsiteAnalysis;
  analyzedAt?: Date;
}): Promise<AnalyzeCompanyWebsiteResult> {
  if (input.analysis[VERIFIED_SAFE_RESPONSE] !== true) {
    throw new Error("Website analysis did not originate from the safe fetch boundary.");
  }

  const company = await getCompanyContext(input.companyId);
  if (!company) return { ok: false, status: "NOT_FOUND", message: "Empresa não encontrada." };

  const analyzedAt = input.analyzedAt ?? new Date();
  const facts = input.analysis.facts;
  if (facts.status < 200 || facts.status >= 400) {
    const message = `O site retornou HTTP ${facts.status}.`;
    await persistAnalysisFailure({
      company,
      actorId: input.actorId,
      analyzedAt,
      status: "NOT_ANALYZABLE",
      code: `HTTP_${facts.status}`,
      message,
      facts,
    });
    return { ok: false, status: "NOT_ANALYZABLE", message };
  }

  const candidates = deriveWebsiteSignals(facts);
  await persistWebsiteResult({
    company,
    actorId: input.actorId,
    facts,
    candidates,
    analyzedAt,
    snapshot: toJsonObject({ status: "COMPLETED", facts }),
  });
  return { ok: true, status: "COMPLETED", message: "Análise concluída com evidências objetivas." };
}

export async function analyzeCompanyWebsiteInternal(input: {
  companyId: string;
  actorId: string;
}): Promise<AnalyzeCompanyWebsiteResult> {
  const company = await getCompanyContext(input.companyId);
  if (!company) return { ok: false, status: "NOT_FOUND", message: "Empresa não encontrada." };

  const analyzedAt = new Date();
  if (!company.website) {
    await persistWebsiteResult({
      company,
      actorId: input.actorId,
      facts: null,
      candidates: [noWebsiteSignal(company.id)],
      analyzedAt,
      snapshot: toJsonObject({
        status: "NO_WEBSITE",
        finding: "Nenhum site está cadastrado nos dados disponíveis da empresa.",
      }),
    });
    return { ok: true, status: "NO_WEBSITE", message: "Site não cadastrado. O sinal factual foi registrado." };
  }

  try {
    const response = await safeFetchHtml(company.website);
    const analysis = analyzeSafeWebsiteResponse(response);
    return await persistVerifiedCompanyWebsite({
      companyId: company.id,
      actorId: input.actorId,
      analysis,
      analyzedAt,
    });
  } catch (error) {
    let result: AnalyzeCompanyWebsiteResult;
    let code = "UNKNOWN";

    if (error instanceof WebsiteSecurityError) {
      code = error.code;
      if (["BLOCKED_HOST", "BLOCKED_ADDRESS", "UNSUPPORTED_PROTOCOL", "INVALID_URL"].includes(error.code)) {
        result = { ok: false, status: "SECURITY_BLOCKED", message: "URL bloqueada por segurança." };
      } else {
        result = { ok: false, status: "NOT_ANALYZABLE", message: error.message };
      }
    } else if (error instanceof WebsiteFetchError) {
      code = error.code;
      result = { ok: false, status: "UNREACHABLE", message: "Não foi possível acessar o site dentro dos limites seguros." };
    } else {
      result = { ok: false, status: "UNREACHABLE", message: "Não foi possível acessar o site." };
    }

    await persistAnalysisFailure({
      company,
      actorId: input.actorId,
      analyzedAt,
      status: result.status,
      code,
      message: result.message,
    });
    return result;
  }
}
