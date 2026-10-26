/// <reference types="jest" />

/**
 * Pins what MailboxAddressing itself decides: the URLs it composes from the endpoint names, which UIs
 * get a URL, the namespace condition and its hand-off to the domains, and the subdomain overrides it
 * passes on. A URL present for a disabled UI leaks an endpoint that does not exist; a lost override or
 * a namespace condition that does not reach the names points endpoints at the wrong host. The
 * normalisation of the names is `MailboxDomains`' own and is pinned in its test.
 */

import { Template }                                           from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, CfnParameter, Stack } from 'aws-cdk-lib';

import { MailboxAddressing }                                  from '../mailbox-addressing';
import type { MailboxEnabledUis }                             from '../mailbox-addressing';

const DOMAIN_NAME                 = 'example.com';
const BOTH_UIS: MailboxEnabledUis = { adminUi: true, webmailUi: true };

function newStack(): Stack {
  return new Stack(new App(), 'test-stack', { synthesizer: new BootstraplessSynthesizer() });
}

describe('MailboxAddressing', () => {
  it('composes each URL from the name of its endpoint', () => {
    const addressing = MailboxAddressing.resolve(newStack(), { domainName: DOMAIN_NAME }, BOTH_UIS);

    expect(addressing.urls).toEqual({
      adminUi:   'https://admin.example.com',
      webmailUi: 'https://webmail.example.com',
      jmapApi:   'https://jmap.example.com',
      adminApi:  'https://api.example.com',
    });
  });

  it('omits the webmail url when only the admin UI is enabled', () => {
    const addressing = MailboxAddressing.resolve(newStack(), { domainName: DOMAIN_NAME }, { adminUi: true, webmailUi: false });

    expect(addressing.urls.adminUi).toBe('https://admin.example.com');
    expect(addressing.urls).not.toHaveProperty('webmailUi');
  });

  it('omits the admin url when only the webmail UI is enabled', () => {
    const addressing = MailboxAddressing.resolve(newStack(), { domainName: DOMAIN_NAME }, { adminUi: false, webmailUi: true });

    expect(addressing.urls.webmailUi).toBe('https://webmail.example.com');
    expect(addressing.urls).not.toHaveProperty('adminUi');
  });

  it('keeps the API urls when no UI is enabled', () => {
    const addressing = MailboxAddressing.resolve(newStack(), { domainName: DOMAIN_NAME }, { adminUi: false, webmailUi: false });

    expect(addressing.urls).toEqual({ jmapApi: 'https://jmap.example.com', adminApi: 'https://api.example.com' });
  });

  it('hands the subdomain overrides to the endpoint names', () => {
    const addressing = MailboxAddressing.resolve(
      newStack(),
      { domainName: DOMAIN_NAME, overrides: { subdomains: { api: 'rest', admin: 'console' } } },
      BOTH_UIS,
    );

    expect(addressing.urls.adminApi).toBe('https://rest.example.com');
    expect(addressing.urls.adminUi).toBe('https://console.example.com');
    expect(addressing.urls.jmapApi).toBe('https://jmap.example.com');
  });

  describe('subdomain namespace', () => {
    it('creates no namespace condition without a subdomain namespace', () => {
      const stack = newStack();

      const addressing = MailboxAddressing.resolve(stack, { domainName: DOMAIN_NAME }, BOTH_UIS);

      expect(addressing.subdomainNamespaceCondition).toBeUndefined();
      expect(Template.fromStack(stack).toJSON().Conditions).toBeUndefined();
    });

    it('creates the namespace condition under the given scope', () => {
      const stack = newStack();

      const addressing = MailboxAddressing.resolve(stack, { domainName: DOMAIN_NAME, subdomainNamespace: 'team' }, BOTH_UIS);

      const conditionId = String(stack.resolve(addressing.subdomainNamespaceCondition?.logicalId));

      expect(Object.keys(Template.fromStack(stack).findConditions(conditionId))).toEqual([conditionId]);
    });

    it('puts a literal namespace into the URLs', () => {
      const addressing = MailboxAddressing.resolve(newStack(), { domainName: DOMAIN_NAME, subdomainNamespace: 'team' }, BOTH_UIS);

      expect(addressing.urls.adminApi).toBe('https://api.team.example.com');
    });

    it('guards a namespace that is known only at deploy time with the namespace condition', () => {
      const stack     = newStack();
      const namespace = new CfnParameter(stack, 'namespace').valueAsString;

      const addressing = MailboxAddressing.resolve(stack, { domainName: DOMAIN_NAME, subdomainNamespace: namespace }, BOTH_UIS);

      const conditionId = String(stack.resolve(addressing.subdomainNamespaceCondition?.logicalId));

      expect(stack.resolve(addressing.urls.adminApi)).toEqual({
        'Fn::Join': ['', [
          'https://api.',
          { 'Fn::If': [conditionId, { 'Fn::Join': ['', [{ Ref: 'namespace' }, '.example.com']] }, 'example.com'] },
        ]],
      });
    });
  });
});
