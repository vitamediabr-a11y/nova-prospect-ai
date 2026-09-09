"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/access";
import { GeminiCommercialAIProvider, DEFAULT_GEMINI_MODEL } from "./providers/gemini";
import { generateCommercialApproachWithProvider, type GenerateCommercialResult } from "./service";

const generateCommercialSchema = z.object({
  companyId: z.string().min(1),
  regenerate: z.boolean().default(false),
});

export async function generateCommercialApproach(input: z.input<typeof generateCommercialSchema>): Promise<GenerateCommercialResult> {
  const { session } = await requireRole(["OWNER", "ADMIN", "MANAGER", "SALES"]);
  const parsed = generateCommercialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "Empresa inválida para geração." };

  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  if (!apiKey) return { ok: false, code: "AI_NOT_CONFIGURED", message: "IA não configurada." };

  const model = process.env.AI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const provider = new GeminiCommercialAIProvider(apiKey, model);
  const result = await generateCommercialApproachWithProvider({
    companyId: parsed.data.companyId,
    actorId: session.user.id,
    regenerate: parsed.data.regenerate,
    provider,
  });

  if (result.ok) {
    revalidatePath(`/empresas/${parsed.data.companyId}`);
    revalidatePath("/painel");
  }
  return result;
}
