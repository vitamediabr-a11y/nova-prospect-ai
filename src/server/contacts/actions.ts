"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/access";
import {
  assertCanApproveContact,
  assertCanCreateFirstContact,
  assertCanRegisterResponse,
  ContactWorkflowError,
} from "@/domain/contact-workflow";
import {
  approveFirstContactSchema,
  createFirstContactSchema,
  registerResponseSchema,
  type ApproveFirstContactInput,
  type CreateFirstContactInput,
  type RegisterResponseInput,
} from "./schema";

export type ContactActionResult =
  | { ok: true; id: string; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapError(error: unknown, fallback: string): ContactActionResult {
  if (error instanceof ContactWorkflowError) return { ok: false, message: error.message };
  console.error(fallback, { error });
  return { ok: false, message: fallback };
}

export async function createFirstContactDraft(input: CreateFirstContactInput): Promise<ContactActionResult> {
  const { session } = await requireRole(["OWNER", "ADMIN", "MANAGER", "SALES"]);
  const parsed = createFirstContactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Revise os campos da abordagem.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const prospect = await tx.prospect.findUnique({
        where: { id: parsed.data.prospectId },
        include: {
          company: { select: { id: true, doNotContact: true } },
          contactAttempts: { select: { status: true }, orderBy: { createdAt: "asc" } },
        },
      });
      if (!prospect) throw new ContactWorkflowError("Prospect não encontrado.");

      assertCanCreateFirstContact({
        doNotContact: prospect.company.doNotContact,
        suppressedAt: prospect.suppressedAt,
        existingAttemptStates: prospect.contactAttempts.map((attempt) => attempt.status),
      });

      if (parsed.data.opportunityId) {
        const opportunity = await tx.opportunity.findFirst({
          where: { id: parsed.data.opportunityId, companyId: prospect.companyId },
          select: { id: true },
        });
        if (!opportunity) throw new ContactWorkflowError("A oportunidade não pertence a este prospect.");
      }

      const failedAttempts = prospect.contactAttempts.filter((attempt) => attempt.status === "FAILED").length;
      const attempt = await tx.contactAttempt.create({
        data: {
          prospectId: prospect.id,
          opportunityId: parsed.data.opportunityId ?? null,
          channel: parsed.data.channel,
          messageDraft: parsed.data.messageDraft,
          evidence: parsed.data.evidence,
          idempotencyKey: `initial-contact:${prospect.id}:v${failedAttempts + 1}`,
        },
      });

      await tx.domainEvent.create({
        data: {
          type: "contact.drafted",
          aggregateType: "contact_attempt",
          aggregateId: attempt.id,
          payload: { prospectId: prospect.id, channel: attempt.channel },
          uniqueKey: `contact.drafted:${attempt.id}`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "contact.draft.create",
          entityType: "contact_attempt",
          entityId: attempt.id,
          metadata: { prospectId: prospect.id, channel: attempt.channel },
        },
      });

      return attempt;
    });

    return { ok: true, id: result.id };
  } catch (error) {
    return mapError(error, "Não foi possível criar o rascunho da primeira abordagem.");
  }
}

export async function approveFirstContact(input: ApproveFirstContactInput): Promise<ContactActionResult> {
  const { session } = await requireRole(["OWNER", "ADMIN", "MANAGER", "SALES"]);
  const parsed = approveFirstContactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Revise a mensagem final.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const attempt = await prisma.$transaction(async (tx) => {
      const current = await tx.contactAttempt.findUnique({
        where: { id: parsed.data.contactAttemptId },
        include: { prospect: { include: { company: { select: { doNotContact: true } } } } },
      });
      if (!current) throw new ContactWorkflowError("Abordagem não encontrada.");

      assertCanApproveContact(current.status, {
        doNotContact: current.prospect.company.doNotContact,
        suppressedAt: current.prospect.suppressedAt,
      });

      const updated = await tx.contactAttempt.update({
        where: { id: current.id },
        data: {
          status: "APPROVED",
          messageFinal: parsed.data.messageFinal,
          approvedById: session.user.id,
        },
      });

      await tx.domainEvent.create({
        data: {
          type: "contact.approved",
          aggregateType: "contact_attempt",
          aggregateId: updated.id,
          payload: { prospectId: updated.prospectId, channel: updated.channel },
          uniqueKey: `contact.approved:${updated.id}`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "contact.approve",
          entityType: "contact_attempt",
          entityId: updated.id,
          metadata: { prospectId: updated.prospectId },
        },
      });

      return updated;
    });

    return { ok: true, id: attempt.id, message: "Abordagem aprovada. O envio ainda depende de uma integração configurada." };
  } catch (error) {
    return mapError(error, "Não foi possível aprovar a abordagem.");
  }
}

export async function registerProspectResponse(input: RegisterResponseInput): Promise<ContactActionResult> {
  const { session } = await requireRole(["OWNER", "ADMIN", "MANAGER", "SALES"]);
  const parsed = registerResponseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Revise os dados da resposta.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const conversation = await prisma.$transaction(async (tx) => {
      const attempt = await tx.contactAttempt.findUnique({
        where: { id: parsed.data.contactAttemptId },
        include: { conversation: true },
      });
      if (!attempt) throw new ContactWorkflowError("Abordagem não encontrada.");

      if (attempt.status === "RESPONDED" && attempt.conversation) return attempt.conversation;
      assertCanRegisterResponse(attempt.status);

      const respondedAt = parsed.data.respondedAt ?? new Date();
      const createdConversation = await tx.conversation.create({
        data: {
          prospectId: attempt.prospectId,
          contactAttemptId: attempt.id,
          status: "NEEDS_HUMAN",
          responsePreview: parsed.data.responsePreview,
          respondedAt,
        },
      });

      await tx.contactAttempt.update({
        where: { id: attempt.id },
        data: { status: "RESPONDED", respondedAt },
      });
      await tx.prospect.update({
        where: { id: attempt.prospectId },
        data: { stage: "RESPONDED" },
      });

      await tx.domainEvent.createMany({
        data: [
          {
            type: "contact.responded",
            aggregateType: "contact_attempt",
            aggregateId: attempt.id,
            payload: { prospectId: attempt.prospectId, conversationId: createdConversation.id },
            uniqueKey: `contact.responded:${attempt.id}`,
          },
          {
            type: "human_handoff.required",
            aggregateType: "conversation",
            aggregateId: createdConversation.id,
            payload: { prospectId: attempt.prospectId, contactAttemptId: attempt.id },
            uniqueKey: `human_handoff.required:${createdConversation.id}`,
          },
        ],
      });

      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "contact.response.register",
          entityType: "conversation",
          entityId: createdConversation.id,
          metadata: { prospectId: attempt.prospectId, contactAttemptId: attempt.id },
        },
      });

      return createdConversation;
    });

    return { ok: true, id: conversation.id, message: "Resposta registrada. Atendimento humano necessário." };
  } catch (error) {
    return mapError(error, "Não foi possível registrar a resposta do prospect.");
  }
}

export async function takeOverConversation(formData: FormData): Promise<void> {
  const { session } = await requireRole(["OWNER", "ADMIN", "MANAGER", "SALES"]);
  const conversationId = String(formData.get("conversationId") ?? "").trim();
  if (!conversationId) return;

  await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, prospectId: true, status: true, humanTakenOverAt: true },
    });
    if (!conversation) throw new ContactWorkflowError("Conversa não encontrada.");
    if (conversation.status === "IN_PROGRESS" && conversation.humanTakenOverAt) return;
    if (conversation.status !== "NEEDS_HUMAN") {
      throw new ContactWorkflowError("Esta conversa não está aguardando atendimento humano.");
    }

    const takenOverAt = new Date();
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { status: "IN_PROGRESS", humanTakenOverAt: takenOverAt },
    });
    await tx.prospect.update({
      where: { id: conversation.prospectId },
      data: { stage: "IN_CONVERSATION" },
    });
    await tx.domainEvent.create({
      data: {
        type: "human_handoff.accepted",
        aggregateType: "conversation",
        aggregateId: conversation.id,
        payload: { prospectId: conversation.prospectId, userId: session.user.id },
        uniqueKey: `human_handoff.accepted:${conversation.id}`,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: session.user.id,
        action: "conversation.take_over",
        entityType: "conversation",
        entityId: conversation.id,
        metadata: { prospectId: conversation.prospectId },
      },
    });
  });

  revalidatePath("/inbox");
}
