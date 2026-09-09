import test from "node:test";
import assert from "node:assert/strict";
import {
  assertHtmlContentType,
  assertSafeResolvedAddresses,
  assertSafeWebsiteUrl,
  isBlockedIp,
  nextResponseSize,
  resolveSafeRedirect,
  WebsiteSecurityError,
} from "./ssrf";

test("accepts public HTTP/HTTPS URLs and rejects unsupported protocols", () => {
  assert.equal(assertSafeWebsiteUrl("https://example.com/path").hostname, "example.com");
  assert.throws(() => assertSafeWebsiteUrl("file:///etc/passwd"), WebsiteSecurityError);
  assert.throws(() => assertSafeWebsiteUrl("ftp://example.com/file"), WebsiteSecurityError);
});

test("blocks localhost, internal hostnames and private IPv4", () => {
  for (const url of [
    "http://localhost",
    "http://service.internal",
    "http://10.0.0.1",
    "http://127.0.0.1",
    "http://169.254.169.254/latest/meta-data",
    "http://172.16.0.1",
    "http://192.168.1.1",
  ]) {
    assert.throws(() => assertSafeWebsiteUrl(url), WebsiteSecurityError, url);
  }
  assert.equal(isBlockedIp("8.8.8.8"), false);
});

test("blocks IPv6 loopback, local, multicast and documentation ranges", () => {
  for (const address of ["::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1"]) {
    assert.equal(isBlockedIp(address), true, address);
  }
  assert.equal(isBlockedIp("2001:4860:4860::8888"), false);
});

test("rejects DNS answers when any resolved address is non-public", () => {
  assert.doesNotThrow(() => assertSafeResolvedAddresses(["8.8.8.8", "1.1.1.1"]));
  assert.throws(() => assertSafeResolvedAddresses(["8.8.8.8", "10.0.0.2"]), WebsiteSecurityError);
});

test("validates every redirect target before a future connection", () => {
  const current = new URL("https://example.com");
  assert.equal(resolveSafeRedirect(current, "/novo").toString(), "https://example.com/novo");
  assert.throws(() => resolveSafeRedirect(current, "http://169.254.169.254/latest"), WebsiteSecurityError);
  assert.throws(() => resolveSafeRedirect(current, "http://localhost/admin"), WebsiteSecurityError);
});

test("accepts HTML content types and rejects binary responses", () => {
  assert.doesNotThrow(() => assertHtmlContentType("text/html; charset=utf-8"));
  assert.doesNotThrow(() => assertHtmlContentType("application/xhtml+xml"));
  assert.throws(() => assertHtmlContentType("image/png"), WebsiteSecurityError);
  assert.throws(() => assertHtmlContentType("application/pdf"), WebsiteSecurityError);
});

test("enforces response size limit", () => {
  assert.equal(nextResponseSize(400, 500, 1000), 900);
  assert.throws(() => nextResponseSize(900, 101, 1000), WebsiteSecurityError);
});
