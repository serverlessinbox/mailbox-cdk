/// <reference types="jest" />

/**
 * Pins which redirect URIs a registration may carry. A redirect URI that is accepted wrongly sends the
 * authorization code to a host the registrant controls, so the hostname must be read from the parsed URL and the
 * schemes that execute or expose content must stay denied.
 */

import { toRedirectUri }     from '../../shared/identity-identifiers';
import { RedirectUriPolicy } from '../redirect-uri';

describe('RedirectUriPolicy', () => {
  const policy = new RedirectUriPolicy();

  describe('allows', () => {
    it.each([
      ['http://127.0.0.1:51004/oauth2redirect', 'IPv4 loopback, arbitrary port'],
      ['http://127.0.0.1/oauth2redirect', 'IPv4 loopback, no port'],
      ['http://[::1]:61023/oauth2redirect', 'IPv6 loopback, arbitrary port'],
      ['http://localhost:8080/callback', 'localhost, arbitrary port'],
      ['com.example.app:/oauth2redirect/example-provider', 'RFC 8252 §7.1 private-use scheme'],
      ['myapp://callback', 'custom scheme with authority-like syntax'],
    ])('accepts %s (%s)', (uri) => {
      expect(policy.allows(toRedirectUri(uri))).toBe(true);
    });

    it.each([
      ['http://127.0.0.1@attacker.com/', 'userinfo trick, the hostname is attacker.com'],
      ['http://127.0.0.1.attacker.com/', 'lookalike subdomain, the hostname is not exactly 127.0.0.1'],
      ['https://client.example.org/callback', 'ordinary https web-app URI, not loopback'],
      ['http://example.com/callback', 'ordinary http web-app URI, not loopback'],
      ['not a uri at all', 'structurally invalid URI'],
    ])('rejects %s (%s)', (uri) => {
      expect(policy.allows(toRedirectUri(uri))).toBe(false);
    });

    it.each([
      ['javascript:alert(1)', 'javascript: pseudo-scheme'],
      ['data:text/html,<script>alert(1)</script>', 'data: pseudo-scheme'],
      ['file:///etc/passwd', 'file: scheme'],
      ['blob:https://example.com/uuid', 'blob: scheme'],
      ['vbscript:msgbox(1)', 'vbscript: pseudo-scheme'],
      ['about:blank', 'about: pseudo-scheme'],
    ])('rejects the denylisted scheme of %s (%s)', (uri) => {
      expect(policy.allows(toRedirectUri(uri))).toBe(false);
    });
  });

  describe('allowsAll', () => {
    it('rejects an empty list', () => {
      expect(policy.allowsAll([])).toBe(false);
    });

    it('accepts a list of which every entry is allowed', () => {
      expect(policy.allowsAll([toRedirectUri('http://127.0.0.1:1234/cb'), toRedirectUri('com.example.app:/cb')])).toBe(true);
    });

    it('rejects a list of which a single entry is not allowed', () => {
      expect(policy.allowsAll([toRedirectUri('http://127.0.0.1:1234/cb'), toRedirectUri('https://attacker.com/cb')])).toBe(false);
    });
  });
});
