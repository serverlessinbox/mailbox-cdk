/**
 * Structural `redirect_uris` validation for RFC 7591 Dynamic Client Registration.
 *
 * Deliberately uses `new URL()` for structural parsing, never a regex — a regex over the raw
 * string is exactly what lets a userinfo trick (`http://127.0.0.1@attacker.com/`) or a
 * lookalike-subdomain trick (`http://127.0.0.1.attacker.com/`) slip through, because both
 * contain the literal substring "127.0.0.1" while resolving to a completely different host.
 * `new URL(...).hostname` gives the actual authority component the browser/HTTP client would
 * connect to, which is what must be checked.
 */

/**
 * RFC 8252 §7.3 loopback hostnames. Native apps bind an ephemeral port per launch, so the
 * port is never part of the comparison — any port is accepted for these hosts.
 */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * Schemes that must never be accepted as a `redirect_uris` entry, even though the RFC 8252 §7.1
 * "any other scheme" branch below would otherwise allow them as private-use/custom schemes.
 * These are not native-app schemes at all — they are pseudo-schemes that execute or expose
 * content in-browser/in-client (`javascript:`, `vbscript:`, `data:`, `about:`) or read local
 * files (`file:`, `blob:`). A registered redirect URI on one of these is an XSS/local-file
 * disclosure vector wherever the value is ever rendered, navigated to, or otherwise resolved.
 * Checked against `parsed.protocol` (normalised, lowercased, trailing colon) — never a raw
 * substring of the input — for the same reason the file header avoids regexes over the input.
 * This is a denylist, not a positive allowlist: broadening it to require reverse-DNS scheme
 * form is a stricter policy deferred to the Phase 10 security review.
 */
const DENYLISTED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'blob:', 'vbscript:', 'about:']);

/**
 * True if `uri` is an acceptable RFC 7591 `redirect_uris` entry:
 * - an `http`/`https` URI is accepted only when its hostname is an RFC 8252 §7.3 loopback host
 *   (`127.0.0.1`, `[::1]`, `localhost`), any port;
 * - a `DENYLISTED_SCHEMES` scheme is always rejected, regardless of the rest of the URI;
 * - any other (custom/private-use) URI scheme is accepted per RFC 8252 §7.1 — native apps
 *   register scheme values that cannot be enumerated here;
 * - a structurally invalid URI (fails `new URL()`) is rejected.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  if (DENYLISTED_SCHEMES.has(parsed.protocol)) {
    return false;
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return LOOPBACK_HOSTNAMES.has(parsed.hostname);
  }

  return true;
}

/** True if every entry of a non-empty `redirect_uris` array is acceptable. */
export function validateRedirectUris(uris: readonly string[]): boolean {
  return uris.length > 0 && uris.every(isAllowedRedirectUri);
}
