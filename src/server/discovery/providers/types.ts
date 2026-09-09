export type DiscoverySearchInput = {
  query: string;
  limit: number;
};

export type DiscoveryCandidate = {
  url: string;
};

export type DiscoverySearchResult = {
  candidates: DiscoveryCandidate[];
  providerRequests: number;
};

export type DiscoveryProviderErrorCode =
  | "SEARCH_PROVIDER_NOT_CONFIGURED"
  | "SEARCH_PROVIDER_RATE_LIMITED"
  | "SEARCH_PROVIDER_ERROR"
  | "SEARCH_PROVIDER_INVALID_RESPONSE";

export class DiscoveryProviderError extends Error {
  constructor(
    public readonly code: DiscoveryProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DiscoveryProviderError";
  }
}

export interface DiscoveryProvider {
  readonly name: string;
  search(input: DiscoverySearchInput): Promise<DiscoverySearchResult>;
}
