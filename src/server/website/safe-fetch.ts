import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import {
  assertHtmlContentType,
  assertSafeResolvedAddresses,
  assertSafeWebsiteUrl,
  nextResponseSize,
  resolveSafeRedirect,
} from "@/domain/ssrf";
import type { RedirectFact } from "@/domain/website-analysis";

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1_000_000;
const TIMEOUT_MS = 8_000;
const USER_AGENT = "NovaProspectAI/0.1 WebsiteIntelligence";

export type SafeHtmlResponse = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  redirects: RedirectFact[];
  html: string;
};

export class WebsiteFetchError extends Error {
  constructor(
    public readonly code: "TIMEOUT" | "NETWORK_ERROR" | "TOO_MANY_REDIRECTS" | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "WebsiteFetchError";
  }
}

type SingleResponse = {
  status: number;
  contentType: string;
  location: string | null;
  html: string | null;
};

function hostnameWithoutBrackets(hostname: string) {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

async function requestOnce(url: URL): Promise<SingleResponse> {
  assertSafeWebsiteUrl(url);

  const hostname = hostnameWithoutBrackets(url.hostname);
  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch((error: unknown) => {
    throw new WebsiteFetchError("NETWORK_ERROR", error instanceof Error ? error.message : "Falha ao resolver o domínio.");
  });
  assertSafeResolvedAddresses(addresses.map((item) => item.address));
  const target = addresses[0];

  return new Promise<SingleResponse>((resolve, reject) => {
    const commonOptions = {
      hostname: target.address,
      family: target.family,
      port: url.port ? Number(url.port) : undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        Host: url.host,
        Accept: "text/html,application/xhtml+xml;q=0.9",
        "Accept-Encoding": "identity",
        "User-Agent": USER_AGENT,
      },
    };

    const onResponse = (response: http.IncomingMessage) => {
      const status = response.statusCode ?? 0;
      const contentType = Array.isArray(response.headers["content-type"])
        ? response.headers["content-type"][0] ?? ""
        : response.headers["content-type"] ?? "";
      const location = Array.isArray(response.headers.location)
        ? response.headers.location[0] ?? null
        : response.headers.location ?? null;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        resolve({ status, contentType, location, html: null });
        return;
      }

      try {
        assertHtmlContentType(contentType);
        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > 0) nextResponseSize(0, declaredLength, MAX_RESPONSE_BYTES);
      } catch (error) {
        response.resume();
        reject(error);
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      let stopped = false;

      response.on("data", (chunk: Buffer | string) => {
        if (stopped) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        try {
          receivedBytes = nextResponseSize(receivedBytes, buffer.byteLength, MAX_RESPONSE_BYTES);
          chunks.push(buffer);
        } catch (error) {
          stopped = true;
          response.destroy();
          reject(error);
        }
      });
      response.on("end", () => {
        if (!stopped) resolve({ status, contentType, location: null, html: Buffer.concat(chunks).toString("utf8") });
      });
      response.on("error", (error) => {
        if (!stopped) reject(new WebsiteFetchError("NETWORK_ERROR", error.message));
      });
    };

    const request = url.protocol === "https:"
      ? https.request(
          {
            ...commonOptions,
            servername: isIP(hostname) ? undefined : hostname,
          },
          onResponse,
        )
      : http.request(commonOptions, onResponse);

    request.setTimeout(TIMEOUT_MS, () => {
      request.destroy(new WebsiteFetchError("TIMEOUT", "O site não respondeu dentro do limite de tempo."));
    });
    request.on("error", (error) => {
      if (error instanceof WebsiteFetchError) reject(error);
      else reject(new WebsiteFetchError("NETWORK_ERROR", error.message));
    });
    request.end();
  });
}

export async function safeFetchHtml(input: string): Promise<SafeHtmlResponse> {
  const initialUrl = assertSafeWebsiteUrl(input);
  const requestedUrl = initialUrl.toString();
  const redirects: RedirectFact[] = [];
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await requestOnce(currentUrl);
    if (response.location) {
      if (redirectCount === MAX_REDIRECTS) {
        throw new WebsiteFetchError("TOO_MANY_REDIRECTS", "O site excedeu o limite de redirecionamentos.");
      }
      const nextUrl = resolveSafeRedirect(currentUrl, response.location);
      redirects.push({ status: response.status, from: currentUrl.toString(), to: nextUrl.toString() });
      currentUrl = nextUrl;
      continue;
    }

    if (response.html === null) {
      throw new WebsiteFetchError("INVALID_RESPONSE", "O site retornou uma resposta HTML inválida.");
    }

    return {
      requestedUrl,
      finalUrl: currentUrl.toString(),
      status: response.status,
      contentType: response.contentType,
      redirects,
      html: response.html,
    };
  }

  throw new WebsiteFetchError("TOO_MANY_REDIRECTS", "O site excedeu o limite de redirecionamentos.");
}
