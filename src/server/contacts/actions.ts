"use server";

import { revalidatePath } from "next/cache";
import { ACTIVE_OPPORTUNITY_WHERE } from "@/domain/opportunity-lifecycle";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/access";
import {
  assertCanApproveContact,
  assertCanCreateFirstContact,
  ContactWorkflowError,
  responseTransition,
} from "@/domain/contact-workflow";
import {
  approveFirstContactSchema,
  createFirstContactSchema,
  registerResponseSchema,
  takeOverConversationSchema,
  type ApproveFirstContactInput,
  type CreateFirstContactInput,
  type RegisterResponseInput,
} from "./schema";

export type ContactActionResult =
  | { ok: true; id: string; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapError(error: unknown, fallback: string): ContactActionResult {
  if (error instanceof ContactWorkflowError) return { ok: false, message: error.message };
  console.error(fallback, { errorName: error instanceof Error ? error.name : "UnknownError" });
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
          where: {
            id: parsed.data.opportunityId,
            companyId: prospect.companyId,
            ...ACTIVE_OPPORTUNITY_WHERE,
          },
          select: { id: true },
        });
        if (!opportunity) throw new ContactWorkflowError("A oportunidade não está disponível para esta abordagem.");
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

      const transition = responseTransition(attempt.status);
      const requestedRespondedAt = parsed.data.respondedAt ?? new Date();
      const currentConversation = await tx.conversation.upsert({
        where: { contactAttemptId: attempt.id },
        update: {},
        create: {
          prospectId: attempt.prospectId,
          contactAttemptId: attempt.id,
          status: transition.conversationStatus,
          responsePreview: parsed.data.responsePreview,
          respondedAt: requestedRespondedAt,
        },
      });

      const contactTransition = await tx.contactAttempt.updateMany({
        where: { id: attempt.id, status: { in: ["SENT", "DELIVERED"] } },
        data: { status: transition.contactState, respondedAt: currentConversation.respondedAt },
      });

      if (contactTransition.count === 0) return currentConversation;

      await tx.prospect.update({
        where: { id: attempt.prospectId },
        data: { stage: transition.prospectStage },
      });

      if (attempt.opportunityId) {
        await tx.opportunity.update({
          where: { id: attempt.opportunityId },
          data: { status: transition.opportunityStatus },
        });
      }

      await tx.domainEvent.createMany({
        data: [
          {
            type: "contact.responded",
            aggregateType: "contact_attempt",
            aggregateId: attempt.id,
            payload: { prospectId: attempt.prospectId, conversationId: currentConversation.id },
            uniqueKey: `contact.responded:${attempt.id}`,
          },
          {
            type: "human_handoff.required",
            aggregateType: "conversation",
            aggregateId: currentConversation.id,
            payload: { prospectId: attempt.prospectId, contactAttemptId: attempt.id },
            uniqueKey: `human_handoff.required:${currentConversation.id}`,
          },
        ],
        skipDuplicates: true,
      });

      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "contact.response.register",
          entityType: "conversation",
          entityId: currentConversation.id,
          metadata: { prospectId: attempt.prospectId, contactAttemptId: attempt.id },
        },
      });

      return currentConversation;
    });

    return { ok: true, id: conversation.id, message: "Resposta registrada. Atendimento humano necessário." };
  } catch (error) {
    return mapError(error, "Não foi possível registrar a resposta do prospect.");
  }
}

export async function takeOverConversation(formData: FormData): Promise<void> {
  const { session } = await requireRole(["OWNER", "ADMIN", "MANAGER", "SALES"]);
  const parsed = takeOverConversationSchema.safeParse({
    conversationId: formData.get("conversationId"),
  });
  if (!parsed.success) throw new ContactWorkflowError("Conversa inválida.");

  await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({
      where: { id: parsed.data.conversationId },
      select: { id: true, prospectId: true, status: true, humanTakenOverAt: true },
    });
    if (!conversation) throw new ContactWorkflowError("Conversa não encontrada.");
    if (conversation.status === "IN_PROGRESS" && conversation.humanTakenOverAt) return;
    if (conversation.status !== "NEEDS_HUMAN") {
      throw new ContactWorkflowError("Esta conversa não está aguardando atendimento humano.");
    }

    const takenOverAt = new Date();
    const claimed = await tx.conversation.updateMany({
      where: { id: conversation.id, status: "NEEDS_HUMAN", humanTakenOverAt: null },
      data: { status: "IN_PROGRESS", humanTakenOverAt: takenOverAt },
    });

    if (claimed.count === 0) {
      const current = await tx.conversation.findUnique({
        where: { id: conversation.id },
        select: { status: true, humanTakenOverAt: true },
      });
      if (current?.status === "IN_PROGRESS" && current.humanTakenOverAt) return;
      throw new ContactWorkflowError("Esta conversa não está mais disponível para assumir.");
    }

    await tx.prospect.update({
      where: { id: conversation.prospectId },
      data: { stage: "IN_CONVERSATION" },
    });
    await tx.domainEvent.createMany({
      data: [{
        type: "human_handoff.accepted",
        aggregateType: "conversation",
        aggregateId: conversation.id,
        payload: { prospectId: conversation.prospectId, userId: session.user.id },
        uniqueKey: `human_handoff.accepted:${conversation.id}`,
      }],
      skipDuplicates: true,
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
