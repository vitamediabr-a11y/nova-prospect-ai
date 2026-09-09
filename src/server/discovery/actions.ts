"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { buildDiscoveryQuery, normalizeDiscoveryText } from "@/domain/discovery";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { persistVerifiedCompanyWebsite } from "@/server/website/service";
import { discoveryInputSchema, type DiscoveryInput } from "./schema";
import { BraveSearchProvider } from "./providers/brave";
import { executeDiscoveryRunBoundary, type DiscoveryRunFailure } from "./run-boundary";
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

function existingRunResult(run: { id: string; status: string; errorCode: string | null; errorMessage: string | null }): DiscoveryActionResult {
  if (run.status === "FAILED") {
    return {
      ok: false,
      runId: run.id,
      code: run.errorCode ?? "DISCOVERY_FAILED",
      message: run.errorMessage ?? "Esta busca falhou.",
    };
  }
  return { ok: true, runId: run.id, message: "Esta busca já foi iniciada. Abrindo o resultado existente." };
}

async function failRun(input: {
  actorId: string;
  runId: string;
  code: string;
  message: string;
  providerRequests?: number;
}) {
  const completedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.discoveryRun.update({
      where: { id: input.runId },
      data: {
        status: "FAILED",
        completedAt,
        providerRequests: input.providerRequests,
        errorCode: input.code,
        errorMessage: input.message,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "discovery.run.failed",
        entityType: "discovery_run",
        entityId: input.runId,
        metadata: { code: input.code, providerRequests: input.providerRequests ?? null },
      },
    });
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
  const query = buildDiscoveryQuery({
    segment: parsed.data.segment,
    location: parsed.data.location,
    additionalTerms: parsed.data.additionalTerms,
  });
  const key = idempotencyKey({ userId: session.user.id, query, limit: parsed.data.limit, now });

  const existing = await prisma.discoveryRun.findUnique({ where: { idempotencyKey: key } });
  if (existing) return existingRunResult(existing);

  // Operational cost guardrail, not a security boundary. The unique idempotency key remains the DB-level duplicate-run protection.
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

  let run;
  try {
    run = await prisma.$transaction(async (tx) => {
      const created = await tx.discoveryRun.create({
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
      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "discovery.run.started",
          entityType: "discovery_run",
          entityId: created.id,
          metadata: { requestedLimit: parsed.data.limit },
        },
      });
      return created;
    });
  } catch {
    const concurrent = await prisma.discoveryRun.findUnique({ where: { idempotencyKey: key } });
    if (concurrent) return existingRunResult(concurrent);
    return { ok: false, code: "DISCOVERY_START_FAILED", message: "Não foi possível iniciar a busca." };
  }

  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim() ?? "";
  if (!apiKey) {
    await failRun({
      actorId: session.user.id,
      runId: run.id,
      code: "SEARCH_PROVIDER_NOT_CONFIGURED",
      message: "Conexão de busca não configurada.",
    });
    revalidatePath("/descoberta");
    return {
      ok: false,
      runId: run.id,
      code: "SEARCH_PROVIDER_NOT_CONFIGURED",
      message: "Conexão de busca não configurada.",
    };
  }

  const execution = await executeDiscoveryRunBoundary<DiscoveryActionResult>({
    execute: async () => {
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
          analyzeCompany: async (companyId, analysis) => {
            const result = await persistVerifiedCompanyWebsite({
              companyId,
              actorId: session.user.id,
              analysis,
            });
            return { ok: result.ok };
          },
        },
      );

      if (pipeline.providerError) {
        await failRun({
          actorId: session.user.id,
          runId: run.id,
          code: pipeline.providerError.code,
          message: pipeline.providerError.message,
          providerRequests: pipeline.providerRequests,
        });
        return { ok: false, runId: run.id, code: pipeline.providerError.code, message: pipeline.providerError.message };
      }

      const hasOperationalFailures = pipeline.failedCandidates > 0 || pipeline.securityBlocked > 0;
      const status = hasOperationalFailures ? "PARTIAL" : "COMPLETED";
      const completedAt = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.discoveryRun.update({
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
            completedAt,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: session.user.id,
            action: "discovery.run.completed",
            entityType: "discovery_run",
            entityId: run.id,
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
          },
        });
      });

      return {
        ok: true,
        runId: run.id,
        message: status === "PARTIAL" ? "Busca concluída com algumas falhas de verificação." : "Busca concluída.",
      };
    },
    markFailed: async (failure: DiscoveryRunFailure) => {
      await failRun({
        actorId: session.user.id,
        runId: run.id,
        code: failure.code,
        message: failure.message,
      });
    },
  });

  revalidatePath("/descoberta");
  revalidatePath("/painel");
  if (!execution.ok) {
    return { ok: false, runId: run.id, code: execution.failure.code, message: execution.failure.message };
  }
  return execution.value;
}
