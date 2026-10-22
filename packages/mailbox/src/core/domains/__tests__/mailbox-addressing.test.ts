/// <reference types="jest" />

/**
 * Pins the branches of the addressing a Mailbox resolves: the domain taken from the given hosted
 * zone, the namespace condition and edge prefix with and without a subdomain namespace, and the
 * optional UI URLs. A domain taken from anywhere but the zone's name points every endpoint at the
 * wrong host; a wrong edge prefix points the edge stack at the wrong host names; a URL present for a
 * disabled UI leaks an endpoint that does not exist.
 */

import { Template }                             from 'aws-cdk-lib/assertions';
import * as route53                             from 'aws-cdk-lib/aws-route53';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { MailboxAddressing }                    from '../mailbox-addressing';
import type { MailboxEnabledUis }               from '../mailbox-addressing';

const DOMAIN_NAME                 = 'example.com';
const BOTH_UIS: MailboxEnabledUis = { adminUi: true, webmailUi: true };

function newStack(): Stack {
  return new Stack(new App(), 'test-stack', { synthesizer: new BootstraplessSynthesizer() });
}

function zoneOf(stack: Stack, zoneName: string): route53.IHostedZone {
  return route53.HostedZone.fromHostedZoneAttributes(stack, 'zone', { hostedZoneId: 'Z123', zoneName });
}

describe('MailboxAddressing', () => {
  it('names the endpoints after the zone name of the given hosted zone and exposes that zone', () => {
    const stack = newStack();
    const zone  = zoneOf(stack, 'mail.example.org');

    const addressing = MailboxAddressing.resolve(stack, { hostedZone: zone }, BOTH_UIS);

    expect(addressing.zone).toBe(zone);
    expect(addressing.domains.domainName).toBe('mail.example.org');
    expect(addressing.urls.adminApi).toBe('https://api.mail.example.org');
  });

  it('keeps a zone name that is only known at deploy time as a token', () => {
    const stack = newStack();
    const zone  = route53.HostedZone.fromHostedZoneAttributes(stack, 'zone', { hostedZoneId: 'Z123', zoneName: stack.region });

    const addressing = MailboxAddressing.resolve(stack, { hostedZone: zone }, BOTH_UIS);

    expect(stack.resolve(addressing.domains.domainName)).toEqual({ Ref: 'AWS::Region' });
  });

  it('has no zone and an empty deploy-time domain when no hosted zone is given', () => {
    const stack = newStack();

    const addressing = MailboxAddressing.resolve(stack, {}, BOTH_UIS);

    expect(addressing.zone).toBeUndefined();
    expect(stack.resolve(addressing.domains.domainName)).toBe('');
  });

  it('creates no namespace condition and uses the bare edge prefix without a subdomain namespace', () => {
    const stack = newStack();

    const addressing = MailboxAddressing.resolve(stack, { hostedZone: zoneOf(stack, DOMAIN_NAME) }, BOTH_UIS);

    expect(addressing.subdomainNamespaceCondition).toBeUndefined();
    expect(addressing.edgePrefix).toBe('.');
    expect(Template.fromStack(stack).toJSON().Conditions).toBeUndefined();
  });

  it('creates the namespace condition under the given scope and wraps the edge prefix in it', () => {
    const stack = newStack();

    const addressing = MailboxAddressing.resolve(stack, { hostedZone: zoneOf(stack, DOMAIN_NAME), subdomainNamespace: 'team' }, BOTH_UIS);

    expect(Object.keys(Template.fromStack(stack).findConditions('HasSubdomainNamespace'))).toEqual(['HasSubdomainNamespace']);
    expect(stack.resolve(addressing.edgePrefix)).toEqual({
      'Fn::If': ['HasSubdomainNamespace', '.team.', '.'],
    });
  });

  it('includes the url of each enabled UI', () => {
    const stack = newStack();

    const addressing = MailboxAddressing.resolve(stack, { hostedZone: zoneOf(stack, DOMAIN_NAME) }, BOTH_UIS);

    expect(addressing.urls.adminUi).toBeDefined();
    expect(addressing.urls.webmailUi).toBeDefined();
  });

  it('omits the url of a disabled UI and keeps the API urls', () => {
    const adminStack   = newStack();
    const webmailStack = newStack();
    const noUiStack    = newStack();
    const adminOnly    = MailboxAddressing.resolve(adminStack, { hostedZone: zoneOf(adminStack, DOMAIN_NAME) }, { adminUi: true, webmailUi: false });
    const webmailOnly  = MailboxAddressing.resolve(webmailStack, { hostedZone: zoneOf(webmailStack, DOMAIN_NAME) }, { adminUi: false, webmailUi: true });
    const addressing   = MailboxAddressing.resolve(noUiStack, { hostedZone: zoneOf(noUiStack, DOMAIN_NAME) }, { adminUi: false, webmailUi: false });

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
