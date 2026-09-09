import { z } from "zod";

export const discoveryInputSchema = z.object({
  segment: z.string().trim().min(2, "Informe o segmento.").max(120),
  location: z.string().trim().min(2, "Informe a localização.").max(120),
  additionalTerms: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export type DiscoveryInput = z.input<typeof discoveryInputSchema>;
export type DiscoveryData = z.output<typeof discoveryInputSchema>;
