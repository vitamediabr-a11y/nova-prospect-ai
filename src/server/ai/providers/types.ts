import type { CommercialEvidencePack } from "@/domain/commercial-ai";

export type CommercialAIProviderErrorCode = "AI_RATE_LIMITED" | "AI_INVALID_OUTPUT" | "AI_PROVIDER_ERROR";

export class CommercialAIProviderError extends Error {
  constructor(public readonly code: CommercialAIProviderErrorCode, message: string) {
    super(message);
    this.name = "CommercialAIProviderError";
  }
}

export type CommercialAIProviderResult = {
  output: unknown;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

export interface CommercialAIProvider {
  readonly providerName: string;
  readonly modelName: string;
  generateCommercialAnalysis(pack: CommercialEvidencePack): Promise<CommercialAIProviderResult>;
}
