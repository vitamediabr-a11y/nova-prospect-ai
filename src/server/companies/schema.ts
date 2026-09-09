import { z } from "zod";

const optionalUrl = z.union([z.literal(""), z.string().url("Informe uma URL válida.")]);
const optionalEmail = z.union([z.literal(""), z.string().email("Informe um e-mail válido.")]);

export const createCompanySchema = z.object({
  displayName: z.string().trim().min(2, "Informe o nome da empresa.").max(160),
  website: optionalUrl.default(""),
  instagram: z.string().trim().max(120).default(""),
  whatsapp: z.string().trim().max(32).default(""),
  email: optionalEmail.default(""),
  location: z.string().trim().max(160).default(""),
  industry: z.string().trim().max(120).default(""),
});

export type CreateCompanyInput = z.input<typeof createCompanySchema>;
export type CreateCompanyData = z.output<typeof createCompanySchema>;
