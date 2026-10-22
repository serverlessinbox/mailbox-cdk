import type { RedirectUri } from '../shared/identity-identifiers';

/**
 * RFC 8252 §7.3 loopback hostnames. A native app binds an ephemeral port per launch, so the port is never
 * compared.
 */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * Schemes that are never accepted, although the RFC 8252 §7.1 private-use scheme branch would otherwise allow
 * them. They execute or expose content in the client (`javascript:`, `vbscript:`, `data:`, `about:`) or read
 * local files (`file:`, `blob:`), which makes a registered redirect URI on one of them an XSS or file
 * disclosure vector wherever it is rendered or navigated to. A denylist, not an allowlist of reverse-DNS
 * schemes.
 */
const DENYLISTED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'blob:', 'vbscript:', 'about:']);

/**
 * Which `redirect_uris` a registration may carry (RFC 7591, RFC 8252):
 * - an `http`/`https` URI only when its hostname is a loopback host, on any port;
 * - a private-use scheme (RFC 8252 §7.1), because native apps register schemes that cannot be enumerated here,
 *   unless the scheme is denylisted;
 * - nothing that `new URL()` cannot parse.
 *
 * The hostname is read from the parsed URL and never matched against the raw string: `http://127.0.0.1@attacker.com/`
 * and `http://127.0.0.1.attacker.com/` both contain "127.0.0.1" and neither is a loopback host.
 */
export class RedirectUriPolicy {
  /** True when `uris` is not empty and every entry is allowed. */
  public allowsAll(uris: readonly RedirectUri[]): boolean {
    return uris.length > 0 && uris.every((uri) => this.allows(uri));
  }

  public allows(uri: RedirectUri): boolean {
    if (!URL.canParse(uri)) {
      return false;
    }

    const parsed = new URL(uri);
    if (DENYLISTED_SCHEMES.has(parsed.protocol)) {
      return false;
    }

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return LOOPBACK_HOSTNAMES.has(parsed.hostname);
    }

    return true;
  }
}
