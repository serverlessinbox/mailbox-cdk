/// <reference types="jest" />

/**
 * Pins the names a Mailbox serves its endpoints on. Every endpoint address, DNS record name and
 * certificate name is built here: a wrong domain, namespace or label sends traffic and certificate
 * validation to a host that is not the Mailbox's, and a namespace that is only known at deploy time
 * must stay switchable by its CloudFormation condition.
 */

import { App, BootstraplessSynthesizer, CfnParameter, Stack } from 'aws-cdk-lib';

import type { MailboxSubdomainOverrides }                     from '../../../mailbox-props';
import { MailboxDomains }                                     from '../mailbox-domains';

const OVERRIDABLE_ENDPOINTS: Array<keyof MailboxSubdomainOverrides> = ['ws', 'api', 'jmap', 'webmail', 'admin', 'cdn', 'mcp'];

function newStack(): Stack {
  return new Stack(new App(), 'test-stack', { synthesizer: new BootstraplessSynthesizer() });
}

describe('MailboxDomains', () => {
  describe('names', () => {
    it('puts each endpoint under the domain with its default label, and gives its zone-relative label', () => {
      const domains = new MailboxDomains({ domainName: 'example.com' });

      expect(domains.fqdn('ws')).toBe('ws.example.com');
      expect(domains.fqdn('mcp')).toBe('mcp.example.com');
      expect(domains.admin).toBe('admin.example.com');
      expect(domains.relativeLabel('webmail')).toBe('webmail');
      expect(domains.relativeLabel('cdn')).toBe('cdn');
    });

    it('uses the override label of the endpoints that have one, in both the full and the relative name', () => {
      const domains = new MailboxDomains({ domainName: 'example.com', subdomainOverrides: { admin: 'console', jmap: 'mail-api' } });

      expect(domains.admin).toBe('console.example.com');
      expect(domains.relativeLabel('admin')).toBe('console');
      expect(domains.jmap).toBe('mail-api.example.com');
      expect(domains.api).toBe('api.example.com');
    });

    it.each(OVERRIDABLE_ENDPOINTS)('lets the %s endpoint be overridden, in both the full and the relative name', (endpoint) => {
      const domains = new MailboxDomains({ domainName: 'example.com', subdomainOverrides: { [endpoint]: 'custom' } });

      expect(domains.fqdn(endpoint)).toBe('custom.example.com');
      expect(domains.relativeLabel(endpoint)).toBe('custom');
    });

    it('lower-cases and trims an override label', () => {
      const domains = new MailboxDomains({ domainName: 'example.com', subdomainOverrides: { admin: ' Console ' } });

      expect(domains.admin).toBe('console.example.com');
    });

    it('keeps an override label that is only known at deploy time as a token', () => {
      const stack   = newStack();
      const label   = new CfnParameter(stack, 'cdnLabel').valueAsString;
      const domains = new MailboxDomains({ domainName: 'example.com', subdomainOverrides: { cdn: label } });

      expect(stack.resolve(domains.cdn)).toEqual({ 'Fn::Join': ['', [{ Ref: 'cdnLabel' }, '.example.com']] });
    });

    it('normalizes the domain to lower case without surrounding blanks or trailing dots', () => {
      const domains = new MailboxDomains({ domainName: ' Example.COM. ' });

      expect(domains.domainName).toBe('example.com');
    });

    it('has an empty domain when none is given', () => {
      const domains = new MailboxDomains({});

      expect(domains.domainName).toBe('');
      expect(domains.api).toBe('api.');
    });

    it('keeps a domain that is only known at deploy time as a token', () => {
      const stack   = newStack();
      const domains = new MailboxDomains({ domainName: stack.region });

      expect(stack.resolve(domains.api)).toEqual({ 'Fn::Join': ['', ['api.', { Ref: 'AWS::Region' }]] });
    });
  });

  describe('domain validation', () => {
    it.each([
      ['an empty domain', '', 'domainName is required'],
      ['a domain with a scheme', 'https://example.com', 'domainName must be a bare DNS name, got: https://example.com'],
      ['a domain with a path', 'example.com/mail', 'domainName must be a bare DNS name, got: example.com/mail'],
      ['a domain with an invalid label', 'exa_mple.com', 'domainName contains invalid DNS label: exa_mple'],
    ])('rejects %s', (_description, domainName, message) => {
      expect(() => new MailboxDomains({ domainName })).toThrow(message);
    });
  });

  describe('override validation', () => {
    it.each([
      ['a label with a dot', 'a.b'],
      ['a label with a leading hyphen', '-x'],
      ['a blank label', '  '],
    ])('rejects %s, naming the endpoint and the value', (_description, label) => {
      expect(() => new MailboxDomains({ domainName: 'example.com', subdomainOverrides: { cdn: label } }))
        .toThrow(`subdomain override "cdn" must be a single valid DNS label, got: "${label}"`);
    });
  });

  describe('namespace', () => {
    it('puts the endpoints under the namespace label and adds it to the relative labels', () => {
      const domains = new MailboxDomains({ domainName: 'example.com', prefix: 'Team' });

      expect(domains.api).toBe('api.team.example.com');
      expect(domains.relativeNamespaceSuffix).toBe('.team');
      expect(domains.relativeLabel('api')).toBe('api.team');
    });

    it.each(['', '.', ' '])('treats the blank namespace %j as none', (prefix) => {
      const domains = new MailboxDomains({ domainName: 'example.com', prefix });

      expect(domains.api).toBe('api.example.com');
      expect(domains.relativeNamespaceSuffix).toBe('');
    });

    it.each([
      ['a namespace with a dot', 'a.b', 'prefix must be a single DNS label (no dots), got: a.b'],
      ['a namespace that is not a DNS label', '-team', 'prefix is not a valid DNS label, got: -team'],
    ])('rejects %s', (_description, prefix, message) => {
      expect(() => new MailboxDomains({ domainName: 'example.com', prefix })).toThrow(message);
    });

    it('switches a namespace that is only known at deploy time on its condition', () => {
      const stack     = newStack();
      const namespace = new CfnParameter(stack, 'namespace').valueAsString;

      const domains = new MailboxDomains({ domainName: 'example.com', prefix: namespace, prefixConditionName: 'HasNamespace' });

      expect(stack.resolve(domains.relativeNamespaceSuffix)).toEqual({
        'Fn::If': ['HasNamespace', { 'Fn::Join': ['', ['.', { Ref: 'namespace' }]] }, ''],
      });
      expect(stack.resolve(domains.api)).toEqual({
        'Fn::Join': ['', ['api.', { 'Fn::If': ['HasNamespace', { 'Fn::Join': ['', [{ Ref: 'namespace' }, '.example.com']] }, 'example.com'] }]],
      });
    });

    it('treats a namespace that is only known at deploy time as present when no condition is given', () => {
      const stack     = newStack();
      const namespace = new CfnParameter(stack, 'namespace').valueAsString;

      const domains = new MailboxDomains({ domainName: 'example.com', prefix: namespace });

      expect(stack.resolve(domains.relativeNamespaceSuffix)).toEqual({ 'Fn::Join': ['', ['.', { Ref: 'namespace' }]] });
    });
  });
});
