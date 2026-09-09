import { z } from "zod";
import {
  DiscoveryProviderError,
  type DiscoveryProvider,
  type DiscoverySearchInput,
  type DiscoverySearchResult,
} from "./types";

const braveWebResponseSchema = z.object({
  web: z.object({
    results: z.array(z.object({ url: z.string().url() }).passthrough()).default([]),
  }).optional(),
}).passthrough();

export class BraveSearchProvider implements DiscoveryProvider {
  readonly name = "BRAVE_SEARCH";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey.trim()) {
      throw new DiscoveryProviderError(
        "SEARCH_PROVIDER_NOT_CONFIGURED",
        "Conexão de busca não configurada.",
      );
    }
  }

  async search(input: DiscoverySearchInput): Promise<DiscoverySearchResult> {
    const count = Math.max(1, Math.min(20, Math.trunc(input.limit)));
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", input.query);
    url.searchParams.set("count", String(count));
    url.searchParams.set("country", "BR");
    url.searchParams.set("search_lang", "pt-br");

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new DiscoveryProviderError(
        "SEARCH_PROVIDER_ERROR",
        "A busca externa falhou.",
      );
    }

    if (response.status === 429) {
      throw new DiscoveryProviderError(
        "SEARCH_PROVIDER_RATE_LIMITED",
        "O provedor de busca atingiu o limite temporário.",
      );
    }
    if (!response.ok) {
      throw new DiscoveryProviderError(
        "SEARCH_PROVIDER_ERROR",
        "A busca externa falhou.",
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DiscoveryProviderError(
        "SEARCH_PROVIDER_INVALID_RESPONSE",
        "O provedor de busca retornou uma resposta inválida.",
      );
    }

    const parsed = braveWebResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new DiscoveryProviderError(
        "SEARCH_PROVIDER_INVALID_RESPONSE",
        "O provedor de busca retornou uma resposta inválida.",
      );
    }

    return {
      candidates: (parsed.data.web?.results ?? []).slice(0, count).map((result) => ({ url: result.url })),
      providerRequests: 1,
    };
  }
}
