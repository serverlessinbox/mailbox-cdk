/// <reference types="jest" />

import { isAllowedRedirectUri, validateRedirectUris } from '../redirect-uri';

describe('isAllowedRedirectUri', () => {
  it.each([
    ['http://127.0.0.1:51004/oauth2redirect', 'IPv4 loopback, arbitrary port'],
    ['http://127.0.0.1/oauth2redirect', 'IPv4 loopback, no port'],
    ['http://[::1]:61023/oauth2redirect', 'IPv6 loopback, arbitrary port'],
    ['http://localhost:8080/callback', 'localhost, arbitrary port'],
    ['com.example.app:/oauth2redirect/example-provider', 'RFC 8252 §7.1 private-use scheme'],
    ['myapp://callback', 'custom scheme with authority-like syntax'],
  ])('accepts %s (%s)', (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });

  it.each([
    ['http://127.0.0.1@attacker.com/', 'userinfo trick — hostname is actually attacker.com'],
    ['http://127.0.0.1.attacker.com/', 'lookalike-subdomain trick — hostname is not exactly 127.0.0.1'],
    ['https://client.example.org/callback', 'ordinary https web-app URI, not loopback'],
    ['http://example.com/callback', 'ordinary http web-app URI, not loopback'],
    ['not a uri at all', 'structurally invalid URI'],
  ])('rejects %s (%s)', (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });

  it.each([
    ['javascript:alert(1)', 'javascript: pseudo-scheme — XSS vector'],
    ['data:text/html,<script>alert(1)</script>', 'data: pseudo-scheme — inline content vector'],
    ['file:///etc/passwd', 'file: scheme — local file disclosure'],
    ['blob:https://example.com/uuid', 'blob: scheme'],
    ['vbscript:msgbox(1)', 'vbscript: pseudo-scheme'],
    ['about:blank', 'about: pseudo-scheme'],
  ])('rejects denylisted scheme %s (%s)', (uri: string) => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });

  it.each([
    ['com.example.app:/cb', 'RFC 8252 §7.1 private-use scheme (regression)'],
    ['http://127.0.0.1:8080/cb', 'loopback URI (regression)'],
  ])('still accepts %s (%s) after the denylist was added', (uri: string) => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });
});

describe('validateRedirectUris', () => {
  it('rejects an empty array', () => {
    expect(validateRedirectUris([])).toBe(false);
  });

  it('accepts an array of all-valid URIs', () => {
    expect(validateRedirectUris(['http://127.0.0.1:1234/cb', 'com.example.app:/cb'])).toBe(true);
  });

  it('rejects the array if any single entry is disallowed', () => {
    expect(validateRedirectUris(['http://127.0.0.1:1234/cb', 'https://attacker.com/cb'])).toBe(false);
  });
});
