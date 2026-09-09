import { z } from "zod";
import { DISCOVERY_MAX_CANDIDATES } from "@/domain/discovery";

export const discoveryInputSchema = z.object({
  segment: z.string().trim().min(2, "Informe o segmento.").max(120),
  location: z.string().trim().min(2, "Informe a localização.").max(120),
  additionalTerms: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(DISCOVERY_MAX_CANDIDATES).default(DISCOVERY_MAX_CANDIDATES),
});

export type DiscoveryInput = z.input<typeof discoveryInputSchema>;
export type DiscoveryData = z.output<typeof discoveryInputSchema>;
