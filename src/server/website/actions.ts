"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/access";
import { analyzeCompanyWebsiteSchema, type AnalyzeCompanyWebsiteInput } from "./schema";
import {
  analyzeCompanyWebsiteInternal,
  type AnalyzeCompanyWebsiteResult as InternalAnalyzeCompanyWebsiteResult,
} from "./service";

export type AnalyzeCompanyWebsiteResult =
  | InternalAnalyzeCompanyWebsiteResult
  | { ok: false; status: "INVALID_INPUT"; message: string };

export async function analyzeCompanyWebsite(input: AnalyzeCompanyWebsiteInput): Promise<AnalyzeCompanyWebsiteResult> {
  const { session } = await requireRole(["OWNER", "ADMIN", "MANAGER", "SALES"]);
  const parsed = analyzeCompanyWebsiteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: "INVALID_INPUT", message: "Empresa inválida para análise." };

  const result = await analyzeCompanyWebsiteInternal({
    companyId: parsed.data.companyId,
    actorId: session.user.id,
  });

  revalidatePath(`/empresas/${parsed.data.companyId}`);
  revalidatePath("/painel");
  return result;
}
