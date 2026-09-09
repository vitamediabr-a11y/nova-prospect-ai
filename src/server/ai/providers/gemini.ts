import { GoogleGenAI } from "@google/genai";
import {
  buildCommercialUserPrompt,
  COMMERCIAL_AI_SYSTEM_INSTRUCTION,
  COMMERCIAL_OUTPUT_JSON_SCHEMA,
  type CommercialEvidencePack,
} from "@/domain/commercial-ai";
import {
  CommercialAIProviderError,
  type CommercialAIProvider,
  type CommercialAIProviderResult,
} from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

function numericField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

export class GeminiCommercialAIProvider implements CommercialAIProvider {
  readonly providerName = "GOOGLE_GEMINI";
  readonly modelName: string;
  private readonly client: GoogleGenAI;

  constructor(apiKey: string, model = DEFAULT_GEMINI_MODEL) {
    const normalizedKey = apiKey.trim();
    if (!normalizedKey) throw new CommercialAIProviderError("AI_PROVIDER_ERROR", "AI provider is not configured.");
    this.modelName = model.trim() || DEFAULT_GEMINI_MODEL;
    this.client = new GoogleGenAI({ apiKey: normalizedKey });
  }

  async generateCommercialAnalysis(pack: CommercialEvidencePack): Promise<CommercialAIProviderResult> {
    try {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: buildCommercialUserPrompt(pack),
        config: {
          systemInstruction: COMMERCIAL_AI_SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: COMMERCIAL_OUTPUT_JSON_SCHEMA,
        },
      });

      if (!response.text) throw new CommercialAIProviderError("AI_INVALID_OUTPUT", "The provider returned no structured text.");

      let output: unknown;
      try {
        output = JSON.parse(response.text);
      } catch {
        throw new CommercialAIProviderError("AI_INVALID_OUTPUT", "The provider returned invalid JSON.");
      }

      const usage = response.usageMetadata as Record<string, unknown> | undefined;
      return {
        output,
        provider: this.providerName,
        model: this.modelName,
        inputTokens: numericField(usage?.promptTokenCount),
        outputTokens: numericField(usage?.candidatesTokenCount),
      };
    } catch (error) {
      if (error instanceof CommercialAIProviderError) throw error;
      const candidate = error as { status?: unknown; code?: unknown };
      if (Number(candidate.status) === 429 || Number(candidate.code) === 429) {
        throw new CommercialAIProviderError("AI_RATE_LIMITED", "The AI provider rate limit was reached.");
      }
      throw new CommercialAIProviderError("AI_PROVIDER_ERROR", "The AI provider request failed.");
    }
  }
}
