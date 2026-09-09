import { isIP } from "node:net";

export type WebsiteSecurityErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "BLOCKED_HOST"
  | "BLOCKED_ADDRESS"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE";

export class WebsiteSecurityError extends Error {
  constructor(
    public readonly code: WebsiteSecurityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WebsiteSecurityError";
  }
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number(part));
  if (bytes.some((byte, index) => !Number.isInteger(byte) || byte < 0 || byte > 255 || String(byte) !== String(Number(parts[index])))) {
    return null;
  }
  return bytes;
}

function parseIpv6(address: string): number[] | null {
  let input = normalizeHostname(address);
  if (!input.includes(":")) return null;

  const ipv4TailMatch = input.match(/(^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4TailMatch) {
    const bytes = parseIpv4(ipv4TailMatch[2]);
    if (!bytes) return null;
    const first = ((bytes[0] << 8) | bytes[1]).toString(16);
    const second = ((bytes[2] << 8) | bytes[3]).toString(16);
    input = `${input.slice(0, ipv4TailMatch.index ?? 0)}${ipv4TailMatch[1]}${first}:${second}`;
  }

  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (left.some((part) => !/^[0-9a-f]{1,4}$/i.test(part)) || right.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) {
    return null;
  }

  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

  const words = [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16)),
  ];
  return words.length === 8 ? words : null;
}

export function isBlockedIp(address: string) {
  const version = isIP(normalizeHostname(address));
  if (version === 4) {
    const bytes = parseIpv4(normalizeHostname(address));
    if (!bytes) return true;
    const [a, b, c] = bytes;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (version === 6) {
    const words = parseIpv6(address);
    if (!words) return true;

    const ipv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
    if (ipv4Mapped) {
      const mapped = [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join(".");
      return isBlockedIp(mapped);
    }

    const isGlobalUnicast = (words[0] & 0xe000) === 0x2000;
    const isDocumentation = words[0] === 0x2001 && words[1] === 0x0db8;
    return !isGlobalUnicast || isDocumentation;
  }

  return true;
}

export function assertSafeWebsiteUrl(input: string | URL) {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.toString()) : new URL(input);
  } catch {
    throw new WebsiteSecurityError("INVALID_URL", "A URL do site é inválida.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebsiteSecurityError("UNSUPPORTED_PROTOCOL", "Somente URLs HTTP e HTTPS podem ser analisadas.");
  }
  if (url.username || url.password) {
    throw new WebsiteSecurityError("BLOCKED_HOST", "URLs com credenciais não podem ser analisadas.");
  }

  const hostname = normalizeHostname(url.hostname);
  const ipVersion = isIP(hostname);
  if (ipVersion && isBlockedIp(hostname)) {
    throw new WebsiteSecurityError("BLOCKED_ADDRESS", "O endereço de destino não é público.");
  }

  if (!ipVersion) {
    const internalSuffixes = [".localhost", ".local", ".internal", ".localdomain", ".lan", ".home", ".onion"];
    if (
      hostname === "localhost" ||
      hostname === "metadata" ||
      hostname === "metadata.google.internal" ||
      hostname === "instance-data.ec2.internal" ||
      !hostname.includes(".") ||
      internalSuffixes.some((suffix) => hostname.endsWith(suffix))
    ) {
      throw new WebsiteSecurityError("BLOCKED_HOST", "O hostname de destino não é público.");
    }
  }

  return url;
}

export function assertSafeResolvedAddresses(addresses: string[]) {
  if (addresses.length === 0) {
    throw new WebsiteSecurityError("BLOCKED_ADDRESS", "O domínio não resolveu para um endereço público.");
  }
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new WebsiteSecurityError("BLOCKED_ADDRESS", "A resolução DNS apontou para um endereço não público.");
    }
  }
}

export function resolveSafeRedirect(currentUrl: URL, location: string) {
  let target: URL;
  try {
    target = new URL(location, currentUrl);
  } catch {
    throw new WebsiteSecurityError("INVALID_URL", "O redirecionamento retornou uma URL inválida.");
  }
  return assertSafeWebsiteUrl(target);
}

export function assertHtmlContentType(contentType: string | undefined) {
  const normalized = (contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  if (normalized !== "text/html" && normalized !== "application/xhtml+xml") {
    throw new WebsiteSecurityError("UNSUPPORTED_CONTENT_TYPE", "O recurso retornado não é HTML.");
  }
}

export function nextResponseSize(currentBytes: number, chunkBytes: number, maxBytes = 1_000_000) {
  const next = currentBytes + chunkBytes;
  if (next > maxBytes) {
    throw new WebsiteSecurityError("RESPONSE_TOO_LARGE", "A resposta HTML excedeu o limite permitido.");
  }
  return next;
}
