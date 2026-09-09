"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { buildDiscoveryQuery, normalizeDiscoveryText } from "@/domain/discovery";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { analyzeCompanyWebsite } from "@/server/website/actions";
import { discoveryInputSchema, type DiscoveryInput } from "./schema";
import { BraveSearchProvider } from "./providers/brave";
import {
  createPrismaDiscoveryRepository,
  executeDiscoveryPipeline,
  verifyCandidateWebsite,
} from "./service";

const MAX_RUNS_PER_HOUR = 6;

export type DiscoveryActionResult =
  | { ok: true; runId: string; message: string }
  | { ok: false; runId?: string; code: string; message: string; fieldErrors?: Record<string, string[]> };

function idempotencyKey(input: { userId: string; query: string; limit: number; now: Date }) {
  const minuteBucket = Math.floor(input.now.getTime() / 60_000);
  const digest = createHash("sha256")
    .update(`${input.userId}|${input.query.toLowerCase()}|${input.limit}|${minuteBucket}`)
    .digest("hex");
  return `discovery:${digest}`;
}

async function auditRun(input: {
  actorId: string;
  action: "discovery.run.started" | "discovery.run.completed" | "discovery.run.failed";
  runId: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: "discovery_run",
      entityId: input.runId,
      metadata: input.metadata,
    },
  });
}

export async function startDiscovery(input: DiscoveryInput): Promise<DiscoveryActionResult> {
  const { session } = await requireRole(["OWNER", "ADMIN", "MANAGER", "SALES"]);
  const parsed = discoveryInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Revise os campos da busca.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const now = new Date();
  const recentRuns = await prisma.discoveryRun.count({
    where: {
      createdById: session.user.id,
      createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) },
    },
  });
  if (recentRuns >= MAX_RUNS_PER_HOUR) {
    return {
      ok: false,
      code: "DISCOVERY_RATE_LIMITED",
      message: "Limite de buscas atingido. Tente novamente mais tarde.",
    };
  }

  const query = buildDiscoveryQuery({
    segment: parsed.data.segment,
    location: parsed.data.location,
    additionalTerms: parsed.data.additionalTerms,
  });
  const key = idempotencyKey({ userId: session.user.id, query, limit: parsed.data.limit, now });

  let run = await prisma.discoveryRun.findUnique({ where: { idempotencyKey: key } });
  if (run) {
    return { ok: true, runId: run.id, message: "Esta busca já foi iniciada. Abrindo o resultado existente." };
  }

  run = await prisma.discoveryRun.create({
    data: {
      provider: "BRAVE_SEARCH",
      segment: normalizeDiscoveryText(parsed.data.segment),
      location: normalizeDiscoveryText(parsed.data.location),
      additionalTerms: normalizeDiscoveryText(parsed.data.additionalTerms) || null,
      query,
      requestedLimit: parsed.data.limit,
      createdById: session.user.id,
      idempotencyKey: key,
      status: "RUNNING",
      startedAt: now,
    },
  });
  await auditRun({ actorId: session.user.id, action: "discovery.run.started", runId: run.id });

  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim() ?? "";
  if (!apiKey) {
    await prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: "SEARCH_PROVIDER_NOT_CONFIGURED",
        errorMessage: "Conexão de busca não configurada.",
      },
    });
    await auditRun({
      actorId: session.user.id,
      action: "discovery.run.failed",
      runId: run.id,
      metadata: { code: "SEARCH_PROVIDER_NOT_CONFIGURED" },
    });
    revalidatePath("/descoberta");
    return {
      ok: false,
      runId: run.id,
      code: "SEARCH_PROVIDER_NOT_CONFIGURED",
      message: "Conexão de busca não configurada.",
    };
  }

  const pipeline = await executeDiscoveryPipeline(
    {
      query,
      limit: parsed.data.limit,
      actorId: session.user.id,
      discoveryRunId: run.id,
    },
    {
      provider: new BraveSearchProvider(apiKey),
      verifyCandidate: verifyCandidateWebsite,
      repository: createPrismaDiscoveryRepository(),
      analyzeCompany: async (companyId) => {
        const result = await analyzeCompanyWebsite({ companyId });
        return { ok: result.ok };
      },
    },
  );

  if (pipeline.providerError) {
    await prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        providerRequests: pipeline.providerRequests,
        completedAt: new Date(),
        errorCode: pipeline.providerError.code,
        errorMessage: pipeline.providerError.message,
      },
    });
    await auditRun({
      actorId: session.user.id,
      action: "discovery.run.failed",
      runId: run.id,
      metadata: { code: pipeline.providerError.code, providerRequests: pipeline.providerRequests },
    });
    revalidatePath("/descoberta");
    return { ok: false, runId: run.id, code: pipeline.providerError.code, message: pipeline.providerError.message };
  }

  const hasOperationalFailures = pipeline.failedCandidates > 0 || pipeline.securityBlocked > 0;
  const status = hasOperationalFailures ? "PARTIAL" : "COMPLETED";
  await prisma.discoveryRun.update({
    where: { id: run.id },
    data: {
      status,
      providerRequests: pipeline.providerRequests,
      candidatesFound: pipeline.candidatesFound,
      candidatesAccepted: pipeline.candidatesAccepted,
      newCompanies: pipeline.newCompanies,
      duplicatesSkipped: pipeline.duplicatesSkipped,
      rejectedCandidates: pipeline.rejectedCandidates,
      failedCandidates: pipeline.failedCandidates,
      securityBlocked: pipeline.securityBlocked,
      completedAt: new Date(),
    },
  });
  await auditRun({
    actorId: session.user.id,
    action: "discovery.run.completed",
    runId: run.id,
    metadata: {
      partial: status === "PARTIAL",
      candidatesFound: pipeline.candidatesFound,
      candidatesAccepted: pipeline.candidatesAccepted,
      newCompanies: pipeline.newCompanies,
      duplicatesSkipped: pipeline.duplicatesSkipped,
      rejectedCandidates: pipeline.rejectedCandidates,
      failedCandidates: pipeline.failedCandidates,
      securityBlocked: pipeline.securityBlocked,
      providerRequests: pipeline.providerRequests,
    },
  });

  revalidatePath("/descoberta");
  revalidatePath("/painel");
  return {
    ok: true,
    runId: run.id,
    message: status === "PARTIAL" ? "Busca concluída com algumas falhas de verificação." : "Busca concluída.",
  };
}
