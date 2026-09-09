import { ACTIVE_OPPORTUNITY_WHERE } from "@/domain/opportunity-lifecycle";
import {
  buildCommercialEvidencePack,
  commercialEvidenceFingerprint,
  generationPreflight,
  isCommercialAnalysisStale,
  shouldReuseCommercialAnalysis,
  validateGroundedCommercialOutput,
  type CommercialEvidenceCore,
  type CommercialEvidencePack,
} from "@/domain/commercial-ai";
import { prisma } from "@/lib/prisma";
import {
  CommercialAIProviderError,
  type CommercialAIProvider,
} from "./providers/types";

const MAX_AI_REQUESTS_PER_USER_PER_HOUR = 20;
const MAX_AI_REQUESTS_PER_COMPANY_PER_HOUR = 6;
const REUSE_MAX_AGE_HOURS = 24;

export type CommercialAnalysisView = {
  id: string;
  opportunityId: string;
  inputFingerprint: string;
  summary: string;
  commercialInterpretation: string;
  messageDraft: string;
  evidenceReferences: string[];
  evidenceFacts: Array<{ ref: string; fact: string }>;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  warnings: string[];
  provider: string;
  model: string;
  createdAt: string;
  stale: boolean;
};

export type CommercialApproachState = {
  companyId: string;
  prospectId: string | null;
  inputFingerprint: string;
  suppressed: boolean;
  activeOpportunity: CommercialEvidencePack["activeOpportunities"][number] | null;
  latestAnalysis: CommercialAnalysisView | null;
  defaultChannel: "INSTAGRAM" | "WHATSAPP" | "EMAIL" | "PHONE" | "OTHER";
};

export type GenerateCommercialResult =
  | { ok: true; analysis: CommercialAnalysisView; reused: boolean }
  | { ok: false; code: string; message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function signalEvidenceSummary(type: string) {
  const summaries: Record<string, string> = {
    NO_WEBSITE: "Nenhum site está cadastrado nos dados disponíveis.",
    MISSING_VIEWPORT_META: "Meta viewport não detectada na homepage.",
    NO_HOMEPAGE_FORM: "Nenhum formulário detectado na homepage.",
    WHATSAPP_PRESENT: "Link de WhatsApp detectado na homepage.",
    NO_HOMEPAGE_SCHEDULING_LINK: "Nenhum link de agendamento conhecido detectado na homepage.",
    ANALYTICS_DETECTED: "Fingerprint de ferramenta de analytics detectado.",
    META_PIXEL_DETECTED: "Fingerprint do Meta Pixel detectado.",
    ECOMMERCE_PLATFORM_DETECTED: "Fingerprint de plataforma de e-commerce detectado.",
    CMS_DETECTED: "Fingerprint de CMS detectado.",
    NO_META_DESCRIPTION: "Meta description não detectada na homepage.",
    NO_STRUCTURED_DATA: "Dados estruturados JSON-LD não detectados na homepage.",
  };
  return summaries[type] ?? "Sinal determinístico atual registrado pela plataforma.";
}

function stringArray(value: unknown) {
  return asArray(value).filter((item): item is string => typeof item === "string").slice(0, 20);
}

function defaultContactChannel(company: { whatsapp: string | null; email: string | null; instagram: string | null }) {
  if (company.whatsapp) return "WHATSAPP" as const;
  if (company.email) return "EMAIL" as const;
  if (company.instagram) return "INSTAGRAM" as const;
  return "OTHER" as const;
}

async function loadEvidenceContext(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      prospect: true,
      signals: {
        where: { resolvedAt: null },
        orderBy: [{ lastObservedAt: "desc" }, { createdAt: "asc" }],
        take: 20,
      },
      opportunities: {
        where: ACTIVE_OPPORTUNITY_WHERE,
        orderBy: [{ score: "desc" }, { createdAt: "asc" }],
        take: 5,
      },
    },
  });
  if (!company) return null;

  const analysis = asRecord(company.websiteAnalysis);
  const facts = asRecord(analysis?.facts);
  const contacts = asRecord(facts?.contacts);
  const forms = asRecord(facts?.forms);
  const technologyObjects = asArray(facts?.technologies).map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
  const technologies = technologyObjects.map((item) => text(item.technology)).filter((item): item is string => Boolean(item)).slice(0, 20);
  const schedulingLinks = asArray(contacts?.schedulingLinks);
  const objectiveFacts: Array<{ ref: string; fact: string }> = [];

  if (facts) {
    if (typeof facts.https === "boolean") objectiveFacts.push({ ref: "website.https", fact: facts.https ? "A URL final usa HTTPS." : "A URL final não usa HTTPS." });
    const formCount = numberValue(forms?.count);
    if (formCount !== null) objectiveFacts.push({ ref: "website.form.count", fact: `${formCount} formulário(s) detectado(s) na homepage.` });
    const structuredDataCount = numberValue(facts.structuredDataCount);
    if (structuredDataCount !== null) objectiveFacts.push({ ref: "website.structured-data.count", fact: `${structuredDataCount} bloco(s) JSON-LD detectado(s) na homepage.` });
    objectiveFacts.push({
      ref: "website.meta-description",
      fact: text(facts.metaDescription) ? "Meta description detectada na homepage." : "Meta description não detectada na homepage.",
    });
  }

  const core: CommercialEvidenceCore = {
    company: {
      id: company.id,
      name: company.displayName.slice(0, 180),
      industry: company.industry?.slice(0, 120) ?? null,
      location: company.location?.slice(0, 120) ?? null,
      website: company.website?.slice(0, 500) ?? null,
    },
    website: {
      status: text(analysis?.status),
      title: text(facts?.title)?.slice(0, 300) ?? null,
      contacts: {
        whatsapp: asArray(contacts?.whatsappLinks).length > 0,
        phone: asArray(contacts?.phoneLinks).length > 0,
        email: asArray(contacts?.emailLinks).length > 0,
        scheduling: schedulingLinks.length > 0,
        form: (numberValue(forms?.count) ?? 0) > 0,
      },
      technologies,
      objectiveFacts,
    },
    currentSignals: company.signals.map((signal) => ({
      id: signal.id,
      type: signal.type,
      confidence: signal.confidence,
      evidence: signalEvidenceSummary(signal.type),
      lastObservedAt: signal.lastObservedAt.toISOString(),
    })),
    activeOpportunities: company.opportunities.map((opportunity) => {
      const breakdown = asRecord(opportunity.scoreBreakdown);
      return {
        id: opportunity.id,
        problem: opportunity.problem.slice(0, 300),
        businessImpact: opportunity.businessImpact.slice(0, 500),
        recommendedSolution: opportunity.recommendedSolution.slice(0, 500),
        score: opportunity.score,
        scoreExplanation: text(breakdown?.explanation)?.slice(0, 500) ?? "Score calculado por regras determinísticas.",
        priority: opportunity.priority,
      };
    }),
    commercialState: {
      doNotContact: company.doNotContact,
      suppressed: Boolean(company.prospect?.suppressedAt),
      prospectStage: company.prospect?.stage ?? null,
      lastContactAt: company.prospect?.lastContactAt?.toISOString() ?? null,
    },
  };

  const pack = buildCommercialEvidencePack(core);
  return {
    company,
    pack,
    fingerprint: commercialEvidenceFingerprint(pack),
    defaultChannel: defaultContactChannel(company),
  };
}

function jsonStrings(value: unknown) {
  return stringArray(value);
}

function analysisView(input: {
  analysis: {
    id: string;
    opportunityId: string;
    inputFingerprint: string;
    summary: string;
    commercialInterpretation: string;
    messageDraft: string;
    evidenceReferences: unknown;
    confidence: string;
    warnings: unknown;
    provider: string;
    model: string;
    createdAt: Date;
  };
  pack: CommercialEvidencePack;
  currentFingerprint: string;
}): CommercialAnalysisView {
  const refs = jsonStrings(input.analysis.evidenceReferences);
  const factsByRef = new Map(input.pack.evidenceCatalog.map((item) => [item.ref, item.fact]));
  const confidence = ["LOW", "MEDIUM", "HIGH"].includes(input.analysis.confidence)
    ? input.analysis.confidence as "LOW" | "MEDIUM" | "HIGH"
    : "LOW";
  return {
    id: input.analysis.id,
    opportunityId: input.analysis.opportunityId,
    inputFingerprint: input.analysis.inputFingerprint,
    summary: input.analysis.summary,
    commercialInterpretation: input.analysis.commercialInterpretation,
    messageDraft: input.analysis.messageDraft,
    evidenceReferences: refs,
    evidenceFacts: refs.flatMap((ref) => {
      const fact = factsByRef.get(ref);
      return fact ? [{ ref, fact }] : [];
    }),
    confidence,
    warnings: jsonStrings(input.analysis.warnings),
    provider: input.analysis.provider,
    model: input.analysis.model,
    createdAt: input.analysis.createdAt.toISOString(),
    stale: isCommercialAnalysisStale(input.analysis.inputFingerprint, input.currentFingerprint),
  };
}

export async function getCommercialApproachState(companyId: string): Promise<CommercialApproachState | null> {
  const context = await loadEvidenceContext(companyId);
  if (!context) return null;
  const latest = await prisma.commercialAnalysis.findFirst({
    where: { companyId, status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
  });

  return {
    companyId,
    prospectId: context.company.prospect?.id ?? null,
    inputFingerprint: context.fingerprint,
    suppressed: context.pack.commercialState.doNotContact || context.pack.commercialState.suppressed,
    activeOpportunity: context.pack.activeOpportunities[0] ?? null,
    latestAnalysis: latest ? analysisView({ analysis: latest, pack: context.pack, currentFingerprint: context.fingerprint }) : null,
    defaultChannel: context.defaultChannel,
  };
}

function failureMessage(code: string) {
  switch (code) {
    case "CONTACT_SUPPRESSED": return "Contato bloqueado pelas regras de supressão.";
    case "NO_ACTIVE_OPPORTUNITY": return "Nenhuma oportunidade atual para abordagem.";
    case "AI_INSUFFICIENT_EVIDENCE": return "Ainda não há evidências suficientes para uma abordagem confiável.";
    case "AI_RATE_LIMITED": return "Limite temporário da IA atingido.";
    case "AI_INVALID_OUTPUT": return "A IA retornou uma análise inválida.";
    default: return "Não foi possível gerar a abordagem agora.";
  }
}

async function auditFailure(actorId: string, companyId: string, code: string, provider: CommercialAIProvider) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action: "ai.commercial.failed",
      entityType: "company",
      entityId: companyId,
      metadata: { code, provider: provider.providerName, model: provider.modelName },
    },
  });
}

export async function generateCommercialApproachWithProvider(input: {
  companyId: string;
  actorId: string;
  regenerate: boolean;
  provider: CommercialAIProvider;
}): Promise<GenerateCommercialResult> {
  const context = await loadEvidenceContext(input.companyId);
  if (!context) return { ok: false, code: "NOT_FOUND", message: "Empresa não encontrada." };

  const preflight = generationPreflight(context.pack);
  if (!preflight.ok) return { ok: false, code: preflight.code, message: failureMessage(preflight.code) };

  const now = new Date();
  if (!input.regenerate) {
    const reusable = await prisma.commercialAnalysis.findFirst({
      where: {
        companyId: input.companyId,
        inputFingerprint: context.fingerprint,
        generationPurpose: "FIRST_MESSAGE",
        status: "SUCCESS",
        createdAt: { gte: new Date(now.getTime() - REUSE_MAX_AGE_HOURS * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (reusable && shouldReuseCommercialAnalysis({
      existingFingerprint: reusable.inputFingerprint,
      currentFingerprint: context.fingerprint,
      createdAt: reusable.createdAt,
      now,
      regenerate: false,
      maxAgeHours: REUSE_MAX_AGE_HOURS,
    })) {
      return {
        ok: true,
        analysis: analysisView({ analysis: reusable, pack: context.pack, currentFingerprint: context.fingerprint }),
        reused: true,
      };
    }
  }

  const since = new Date(now.getTime() - 60 * 60 * 1000);
  const [userRequests, companyRequests] = await Promise.all([
    prisma.auditLog.count({ where: { actorId: input.actorId, action: "ai.commercial.requested", createdAt: { gte: since } } }),
    prisma.auditLog.count({ where: { action: "ai.commercial.requested", entityType: "company", entityId: input.companyId, createdAt: { gte: since } } }),
  ]);
  if (userRequests >= MAX_AI_REQUESTS_PER_USER_PER_HOUR || companyRequests >= MAX_AI_REQUESTS_PER_COMPANY_PER_HOUR) {
    return { ok: false, code: "AI_RATE_LIMITED", message: failureMessage("AI_RATE_LIMITED") };
  }

  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: "ai.commercial.requested",
      entityType: "company",
      entityId: input.companyId,
      metadata: { provider: input.provider.providerName, model: input.provider.modelName, regenerate: input.regenerate },
    },
  });

  let providerResult;
  try {
    providerResult = await input.provider.generateCommercialAnalysis(context.pack);
  } catch (error) {
    const code = error instanceof CommercialAIProviderError ? error.code : "AI_PROVIDER_ERROR";
    await auditFailure(input.actorId, input.companyId, code, input.provider);
    return { ok: false, code, message: failureMessage(code) };
  }

  const grounded = validateGroundedCommercialOutput(context.pack, providerResult.output);
  if (!grounded.ok) {
    await auditFailure(input.actorId, input.companyId, grounded.code, input.provider);
    return { ok: false, code: grounded.code, message: failureMessage(grounded.code) };
  }

  const selectedOpportunity = context.pack.activeOpportunities.find((item) => item.id === grounded.output.strongestOpportunity.opportunityId);
  if (!selectedOpportunity) {
    await auditFailure(input.actorId, input.companyId, "AI_INVALID_OUTPUT", input.provider);
    return { ok: false, code: "AI_INVALID_OUTPUT", message: failureMessage("AI_INVALID_OUTPUT") };
  }

  const saved = await prisma.$transaction(async (tx) => {
    const opportunityStillActive = await tx.opportunity.findFirst({
      where: { id: selectedOpportunity.id, companyId: input.companyId, ...ACTIVE_OPPORTUNITY_WHERE },
      select: { id: true },
    });
    const companyState = await tx.company.findUnique({
      where: { id: input.companyId },
      select: { doNotContact: true, prospect: { select: { suppressedAt: true } } },
    });
    if (!opportunityStillActive) throw new CommercialAIProviderError("AI_INVALID_OUTPUT", "Opportunity changed before persistence.");
    if (!companyState || companyState.doNotContact || companyState.prospect?.suppressedAt) {
      throw new CommercialAIProviderError("AI_PROVIDER_ERROR", "Suppression changed before persistence.");
    }

    const analysis = await tx.commercialAnalysis.create({
      data: {
        companyId: input.companyId,
        opportunityId: selectedOpportunity.id,
        provider: providerResult.provider,
        model: providerResult.model,
        generationPurpose: "FIRST_MESSAGE",
        inputFingerprint: context.fingerprint,
        summary: grounded.output.summary,
        commercialInterpretation: grounded.output.commercialInterpretation,
        messageDraft: grounded.output.messageDraft,
        evidenceReferences: grounded.output.evidenceReferences,
        confidence: grounded.output.confidence,
        warnings: grounded.output.warnings,
        status: "SUCCESS",
        createdById: input.actorId,
        inputTokens: providerResult.inputTokens,
        outputTokens: providerResult.outputTokens,
      },
    });

    await tx.domainEvent.create({
      data: {
        type: "ai.commercial.generated",
        aggregateType: "commercial_analysis",
        aggregateId: analysis.id,
        payload: { companyId: input.companyId, opportunityId: selectedOpportunity.id },
        uniqueKey: `ai.commercial.generated:${analysis.id}`,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "ai.commercial.generated",
        entityType: "commercial_analysis",
        entityId: analysis.id,
        metadata: { companyId: input.companyId, opportunityId: selectedOpportunity.id, provider: providerResult.provider, model: providerResult.model },
      },
    });
    return analysis;
  }).catch(async (error) => {
    const code = error instanceof CommercialAIProviderError && error.message.includes("Suppression") ? "CONTACT_SUPPRESSED" : "AI_INVALID_OUTPUT";
    await auditFailure(input.actorId, input.companyId, code, input.provider);
    return null;
  });

  if (!saved) {
    const refreshed = await loadEvidenceContext(input.companyId);
    if (refreshed && (refreshed.pack.commercialState.doNotContact || refreshed.pack.commercialState.suppressed)) {
      return { ok: false, code: "CONTACT_SUPPRESSED", message: failureMessage("CONTACT_SUPPRESSED") };
    }
    return { ok: false, code: "AI_INVALID_OUTPUT", message: failureMessage("AI_INVALID_OUTPUT") };
  }

  return {
    ok: true,
    analysis: analysisView({ analysis: saved, pack: context.pack, currentFingerprint: context.fingerprint }),
    reused: false,
  };
}
