/// <reference types="jest" />

/**
 * Pins the hosts a Mailbox derives when the subdomain labels are overridden and a namespace is set:
 * the CloudFront aliases of the UI and blob CDN distributions, and the host parameters it hands to
 * the edge deployer. A host that reaches the aliases but not the edge parameters yields a
 * certificate that does not cover the distribution. What the edge construct does with the
 * parameters is pinned in its own test.
 */

import { Template }                                      from 'aws-cdk-lib/assertions';
import * as route53                                      from 'aws-cdk-lib/aws-route53';
import { App, BootstraplessSynthesizer, Stack }          from 'aws-cdk-lib';
import * as t                                            from 'typanion';

import { Mailbox }                                       from '../mailbox';

import { createMockAuthProvider, TEST_ARTIFACT_CONTEXT } from './mailbox-helpers';
import { resourcesOfType }                               from './template-resources';

const isDeployerProperties     = t.isPartial({
  parameters: t.isPartial({
    webmailHost: t.isString(),
    adminHost:   t.isString(),
    cdnHost:     t.isString(),
  }),
});
const isDistributionProperties = t.isPartial({
  DistributionConfig: t.isPartial({ Aliases: t.isOptional(t.isArray(t.isString())) }),
});

function synthMainTemplate(): Template {
  const app   = new App({ context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT } });
  const stack = new Stack(app, 'TestUiHostOverrides', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  new Mailbox(stack, 'mailbox', {
    authProvider:       createMockAuthProvider(),
    hostedZone:         route53.HostedZone.fromHostedZoneAttributes(stack, 'zone', { hostedZoneId: 'Z0TESTZONE', zoneName: 'example.com' }),
    subdomainNamespace: 'mail',
    overrides:          { subdomains: { admin: 'console', webmail: 'inbox', cdn: 'files' } },
  });

  return Template.fromStack(stack);
}

describe('Mailbox with overridden host labels and a namespace', () => {
  const mainTemplate = synthMainTemplate();

  it('serves the admin UI, the webmail UI and the blob CDN on the renamed, namespaced hosts', () => {
    const aliases = resourcesOfType(mainTemplate, 'AWS::CloudFront::Distribution', isDistributionProperties)
      .flatMap((distribution) => distribution.properties.DistributionConfig.Aliases ?? []);

    expect([...aliases].sort()).toEqual(['console.mail.example.com', 'files.mail.example.com', 'inbox.mail.example.com']);
  });

  it('hands the edge deployer the hosts the distributions are aliased on', () => {
    const [deployer] = resourcesOfType(mainTemplate, 'Custom::MailboxEdgeDeployer', isDeployerProperties);

    expect(deployer.properties.parameters).toMatchObject({
      webmailHost: 'inbox.mail.example.com',
      adminHost:   'console.mail.example.com',
      cdnHost:     'files.mail.example.com',
    });
  });
});
