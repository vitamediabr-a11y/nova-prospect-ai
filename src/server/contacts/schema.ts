import { z } from "zod";

export const createFirstContactSchema = z.object({
  prospectId: z.string().min(1),
  opportunityId: z.string().min(1).optional(),
  channel: z.enum(["INSTAGRAM", "WHATSAPP", "EMAIL", "PHONE", "OTHER"]),
  messageDraft: z.string().trim().min(20, "A abordagem precisa ter pelo menos 20 caracteres.").max(2000),
  evidence: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export const approveFirstContactSchema = z.object({
  contactAttemptId: z.string().min(1),
  messageFinal: z.string().trim().min(20, "A mensagem final precisa ter pelo menos 20 caracteres.").max(2000),
});

export const registerResponseSchema = z.object({
  contactAttemptId: z.string().min(1),
  responsePreview: z.string().trim().min(1).max(1000),
  respondedAt: z.coerce.date().optional(),
});

export const takeOverConversationSchema = z.object({
  conversationId: z.string().trim().min(1),
});

export type CreateFirstContactInput = z.infer<typeof createFirstContactSchema>;
export type ApproveFirstContactInput = z.infer<typeof approveFirstContactSchema>;
export type RegisterResponseInput = z.infer<typeof registerResponseSchema>;
