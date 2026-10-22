/// <reference types="jest" />

/**
 * Pins the branches of the addressing a Mailbox resolves: the given domain, an empty domain when
 * none is given, the namespace condition and edge prefix with and without a subdomain namespace,
 * and the optional UI URLs. A domain that is dropped points every endpoint at the wrong host; a
 * wrong edge prefix points the edge stack at the wrong host names; a URL present for a disabled UI
 * leaks an endpoint that does not exist.
 */

import { Template }                             from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { MailboxAddressing }                    from '../mailbox-addressing';
import type { MailboxEnabledUis }               from '../mailbox-addressing';

const DOMAIN_NAME                 = 'example.com';
const BOTH_UIS: MailboxEnabledUis = { adminUi: true, webmailUi: true };

function newStack(): Stack {
  return new Stack(new App(), 'test-stack', { synthesizer: new BootstraplessSynthesizer() });
}

describe('MailboxAddressing', () => {
  it('names the endpoints after the given domain', () => {
    const addressing = MailboxAddressing.resolve(newStack(), { domainName: 'mail.example.org' }, BOTH_UIS);

    expect(addressing.domains.domainName).toBe('mail.example.org');
    expect(addressing.urls.adminApi).toBe('https://api.mail.example.org');
  });

  it('keeps a domain that is only known at deploy time as a token', () => {
    const stack = newStack();

    const addressing = MailboxAddressing.resolve(stack, { domainName: stack.region }, BOTH_UIS);

    expect(stack.resolve(addressing.domains.domainName)).toEqual({ Ref: 'AWS::Region' });
  });

  it('has an empty domain when no domain is given', () => {
    const addressing = MailboxAddressing.resolve(newStack(), {}, BOTH_UIS);

    expect(addressing.domains.domainName).toBe('');
    expect(addressing.urls.adminApi).toBe('https://api.');
  });

  it('creates no namespace condition and uses the bare edge prefix without a subdomain namespace', () => {
    const stack = newStack();

    const addressing = MailboxAddressing.resolve(stack, { domainName: DOMAIN_NAME }, BOTH_UIS);

    expect(addressing.subdomainNamespaceCondition).toBeUndefined();
    expect(addressing.edgePrefix).toBe('.');
    expect(Template.fromStack(stack).toJSON().Conditions).toBeUndefined();
  });

  it('creates the namespace condition under the given scope and wraps the edge prefix in it', () => {
    const stack = newStack();

    const addressing = MailboxAddressing.resolve(stack, { domainName: DOMAIN_NAME, subdomainNamespace: 'team' }, BOTH_UIS);

    expect(Object.keys(Template.fromStack(stack).findConditions('HasSubdomainNamespace'))).toEqual(['HasSubdomainNamespace']);
    expect(stack.resolve(addressing.edgePrefix)).toEqual({
      'Fn::If': ['HasSubdomainNamespace', '.team.', '.'],
    });
  });

  it('includes the url of each enabled UI', () => {
    const addressing = MailboxAddressing.resolve(newStack(), { domainName: DOMAIN_NAME }, BOTH_UIS);

    expect(addressing.urls.adminUi).toBeDefined();
    expect(addressing.urls.webmailUi).toBeDefined();
  });

  it('omits the url of a disabled UI and keeps the API urls', () => {
    const adminOnly   = MailboxAddressing.resolve(newStack(), { domainName: DOMAIN_NAME }, { adminUi: true, webmailUi: false });
    const webmailOnly = MailboxAddressing.resolve(newStack(), { domainName: DOMAIN_NAME }, { adminUi: false, webmailUi: true });
    const addressing  = MailboxAddressing.resolve(newStack(), { domainName: DOMAIN_NAME }, { adminUi: false, webmailUi: false });

    expect(adminOnly.urls.adminUi).toBeDefined();
    expect(adminOnly.urls.webmailUi).toBeUndefined();
    expect(webmailOnly.urls.adminUi).toBeUndefined();
    expect(webmailOnly.urls.webmailUi).toBeDefined();
    expect(addressing.urls.adminUi).toBeUndefined();
    expect(addressing.urls.webmailUi).toBeUndefined();
    expect(addressing.urls.jmapApi).toBeDefined();
    expect(addressing.urls.adminApi).toBeDefined();
  });
});
