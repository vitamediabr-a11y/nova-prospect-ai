"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { WebsiteSecurityError } from "@/domain/ssrf";
import { detectOpportunity } from "@/domain/opportunity-rules";
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
import { safeFetchHtml, WebsiteFetchError } from "./safe-fetch";
import { analyzeCompanyWebsiteSchema, type AnalyzeCompanyWebsiteInput } from "./schema";

export type AnalyzeCompanyWebsiteResult =
  | { ok: true; status: "COMPLETED" | "NO_WEBSITE"; message: string }
  | { ok: false; status: "SECURITY_BLOCKED" | "UNREACHABLE" | "NOT_ANALYZABLE" | "INVALID_INPUT" | "NOT_FOUND"; message: string };

type CompanyWebsiteContext = {
  id: string;
  website: string | null;
  whatsapp: string | null;
  email: string | null;
  doNotContact: boolean;
  prospect: { ownerId: string | null; lastContactAt: Date | null } | null;
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

    if (reconciliation.resolved.length > 0) {
      await tx.signal.updateMany({
        where: {
          companyId: company.id,
          source: "WEBSITE_ANALYZER",
          type: { in: reconciliation.resolved },
          resolvedAt: null,
        },
        data: { resolvedAt: analyzedAt },
      });

      const resolvedEvents = existingSignals
        .filter((signal) => reconciliation.resolved.includes(signal.type) && signal.resolvedAt === null)
        .map((signal) => ({
          type: "signal.resolved",
          aggregateType: "signal",
          aggregateId: signal.id,
          payload: { companyId: company.id, signalType: signal.type },
          uniqueKey: `signal.resolved:${signal.id}`,
        }));
      if (resolvedEvents.length > 0) await tx.domainEvent.createMany({ data: resolvedEvents, skipDuplicates: true });
    }

    for (const candidate of candidates) {
      const dedupeKey = websiteSignalKey(company.id, candidate.type);
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

      await tx.domainEvent.createMany({
        data: [{
          type: "signal.detected",
          aggregateType: "signal",
          aggregateId: signal.id,
          payload: { companyId: company.id, signalType: signal.type, source: "WEBSITE_ANALYZER" },
          uniqueKey: `signal.detected:${signal.id}`,
        }],
        skipDuplicates: true,
      });

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
        },
      });

      await tx.domainEvent.createMany({
        data: [{
          type: "opportunity.created",
          aggregateType: "opportunity",
          aggregateId: opportunity.id,
          payload: { companyId: company.id, signalId: signal.id, source: "WEBSITE_ANALYZER" },
          uniqueKey: `opportunity.created:${opportunity.id}`,
        }],
        skipDuplicates: true,
      });
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
      await tx.signal.updateMany({
        where: { dedupeKey: websiteSignalKey(company.id, "NO_WEBSITE"), resolvedAt: null },
        data: { resolvedAt: analyzedAt },
      });
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

export async function analyzeCompanyWebsite(input: AnalyzeCompanyWebsiteInput): Promise<AnalyzeCompanyWebsiteResult> {
  const { session } = await requireRole(["OWNER", "ADMIN", "MANAGER", "SALES"]);
  const parsed = analyzeCompanyWebsiteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: "INVALID_INPUT", message: "Empresa inválida para análise." };

  const company = await prisma.company.findUnique({
    where: { id: parsed.data.companyId },
    select: {
      id: true,
      website: true,
      whatsapp: true,
      email: true,
      doNotContact: true,
      prospect: { select: { ownerId: true, lastContactAt: true } },
    },
  });
  if (!company) return { ok: false, status: "NOT_FOUND", message: "Empresa não encontrada." };

  const analyzedAt = new Date();
  if (!company.website) {
    const signal = noWebsiteSignal(company.id);
    await persistWebsiteResult({
      company,
      actorId: session.user.id,
      facts: null,
      candidates: [signal],
      analyzedAt,
      snapshot: toJsonObject({
        status: "NO_WEBSITE",
        finding: "Nenhum site está cadastrado nos dados disponíveis da empresa.",
      }),
    });
    revalidatePath(`/empresas/${company.id}`);
    return { ok: true, status: "NO_WEBSITE", message: "Site não cadastrado. O sinal factual foi registrado." };
  }

  try {
    const response = await safeFetchHtml(company.website);
    const facts = analyzeWebsiteHtml(response);

    if (facts.status < 200 || facts.status >= 400) {
      const message = `O site retornou HTTP ${facts.status}.`;
      await persistAnalysisFailure({
        company,
        actorId: session.user.id,
        analyzedAt,
        status: "NOT_ANALYZABLE",
        code: `HTTP_${facts.status}`,
        message,
        facts,
      });
      revalidatePath(`/empresas/${company.id}`);
      return { ok: false, status: "NOT_ANALYZABLE", message };
    }

    const candidates = deriveWebsiteSignals(facts);
    await persistWebsiteResult({
      company,
      actorId: session.user.id,
      facts,
      candidates,
      analyzedAt,
      snapshot: toJsonObject({ status: "COMPLETED", facts }),
    });
    revalidatePath(`/empresas/${company.id}`);
    revalidatePath("/painel");
    return { ok: true, status: "COMPLETED", message: "Análise concluída com evidências objetivas." };
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
      actorId: session.user.id,
      analyzedAt,
      status: result.status,
      code,
      message: result.message,
    });
    revalidatePath(`/empresas/${company.id}`);
    return result;
  }
}
