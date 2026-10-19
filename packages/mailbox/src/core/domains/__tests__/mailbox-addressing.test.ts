/// <reference types="jest" />

/**
 * Pins the branches of the addressing a Mailbox resolves: the namespace condition and edge prefix
 * with and without a subdomain namespace, and the optional UI URLs. A wrong edge prefix points
 * the edge stack at the wrong host names; a URL present for a disabled UI leaks an endpoint that
 * does not exist.
 */

import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MailboxAddressing } from '../mailbox-addressing';
import type { MailboxEnabledUis } from '../mailbox-addressing';

const DOMAIN_NAME = 'example.com';
const BOTH_UIS: MailboxEnabledUis = { adminUi: true, webmailUi: true };

function newStack(): Stack {
  return new Stack(new App(), 'test-stack', { synthesizer: new BootstraplessSynthesizer() });
}

describe('MailboxAddressing', () => {
  it('creates no namespace condition and uses the bare edge prefix without a subdomain namespace', () => {
    const stack = newStack();

    const addressing = MailboxAddressing.resolve(stack, {}, DOMAIN_NAME, BOTH_UIS);

    expect(addressing.subdomainNamespaceCondition).toBeUndefined();
    expect(addressing.edgePrefix).toBe('.');
    expect(Template.fromStack(stack).toJSON().Conditions).toBeUndefined();
  });

  it('creates the namespace condition under the given scope and wraps the edge prefix in it', () => {
    const stack = newStack();

    const addressing = MailboxAddressing.resolve(stack, { subdomainNamespace: 'team' }, DOMAIN_NAME, BOTH_UIS);

    expect(Object.keys(Template.fromStack(stack).toJSON().Conditions)).toEqual(['HasSubdomainNamespace']);
    expect(stack.resolve(addressing.edgePrefix)).toEqual({
      'Fn::If': ['HasSubdomainNamespace', '.team.', '.'],
    });
  });

  it('includes the url of each enabled UI', () => {
    const addressing = MailboxAddressing.resolve(newStack(), {}, DOMAIN_NAME, BOTH_UIS);

    expect(addressing.urls.adminUi).toBeDefined();
    expect(addressing.urls.webmailUi).toBeDefined();
  });

  it('omits the url of a disabled UI and keeps the API urls', () => {
    const adminOnly = MailboxAddressing.resolve(newStack(), {}, DOMAIN_NAME, { adminUi: true, webmailUi: false });
    const webmailOnly = MailboxAddressing.resolve(newStack(), {}, DOMAIN_NAME, { adminUi: false, webmailUi: true });

    expect(adminOnly.urls.adminUi).toBeDefined();
    expect(adminOnly.urls.webmailUi).toBeUndefined();
    expect(webmailOnly.urls.adminUi).toBeUndefined();
    expect(webmailOnly.urls.webmailUi).toBeDefined();
    const addressing = MailboxAddressing.resolve(newStack(), {}, DOMAIN_NAME, { adminUi: false, webmailUi: false });

    expect(addressing.urls.adminUi).toBeUndefined();
    expect(addressing.urls.webmailUi).toBeUndefined();
    expect(addressing.urls.jmapApi).toBeDefined();
    expect(addressing.urls.adminApi).toBeDefined();
  });
});
