import { z } from "zod";

export const analyzeCompanyWebsiteSchema = z.object({
  companyId: z.string().trim().min(1).max(200),
});

export type AnalyzeCompanyWebsiteInput = z.input<typeof analyzeCompanyWebsiteSchema>;
