/// <reference types="jest" />

/**
 * Pins that the edge certificate names every host the UI and blob CDN distributions are served on,
 * and the sign-in host, when the subdomain labels are overridden and a namespace is set. The Mailbox
 * derives the CloudFront aliases and the edge stack's host parameters from the same domain names, so
 * a host that reaches the aliases but not the certificate produces a distribution CloudFront refuses
 * to attach the certificate to. The edge construct is fed the deployer's own parameters from the
 * synthesized main template.
 */

import { Template }                                      from 'aws-cdk-lib/assertions';
import * as route53                                      from 'aws-cdk-lib/aws-route53';
import * as cdk                                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                 from 'aws-cdk-lib';
import * as t                                            from 'typanion';

import { MailboxEdgeConstruct }                          from '../core/edge/mailbox-edge-construct';
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
const isCertificateProperties  = t.isPartial({
  DomainName:              t.isString(),
  SubjectAlternativeNames: t.isArray(t.isString()),
  DomainValidationOptions: t.isArray(t.isPartial({ DomainName: t.isString() })),
});

function synthMainTemplate(): Template {
  const app   = new App({ context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT } });
  const stack = new cdk.Stack(app, 'TestUiHostOverrides', {
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

function synthEdgeCertificate(template: Template): Template {
  const [deployer] = resourcesOfType(template, 'Custom::MailboxEdgeDeployer', isDeployerProperties);
  const edgeStack  = new cdk.Stack(new App(), 'TestEdge', {
    env:         { account: '123456789012', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  new MailboxEdgeConstruct(edgeStack, 'edge', {
    ...deployer.properties.parameters,
    hostedZoneId:              'Z0TESTZONE',
    hostedZoneName:            'example.com',
    artifactBucket:            'test-artifacts',
    jmapBlobDownloadReference: { bucket: 'test-artifacts', key: 'lambdas/jmap-blob-download.zip' },
    itemTableArn:              'arn:aws:dynamodb:us-west-2:111122223333:table/item',
    configTableArn:            'arn:aws:dynamodb:us-west-2:111122223333:table/config',
    authKeyStoreTableArn:      'arn:aws:dynamodb:us-west-2:111122223333:table/auth-keys',
    productVersion:            '1.2.3',
    logGroupName:              'jmap-pipeline',
    jmapBlobDownloadRoleArn:   'arn:aws:iam::123456789012:role/jmap-blob-download',
  });

  return Template.fromStack(edgeStack);
}

describe('Mailbox with overridden host labels and a namespace', () => {
  const mainTemplate     = synthMainTemplate();
  const aliases          = resourcesOfType(mainTemplate, 'AWS::CloudFront::Distribution', isDistributionProperties)
    .flatMap((distribution) => distribution.properties.DistributionConfig.Aliases ?? []);
  const [certificate]    = resourcesOfType(synthEdgeCertificate(mainTemplate), 'AWS::CertificateManager::Certificate', isCertificateProperties);
  const certificateNames = [certificate.properties.DomainName, ...certificate.properties.SubjectAlternativeNames];

  it('serves the admin UI, the webmail UI and the blob CDN on the renamed, namespaced hosts', () => {
    expect(aliases.sort()).toEqual(['console.mail.example.com', 'files.mail.example.com', 'inbox.mail.example.com']);
  });

  it('issues the edge certificate for every alias of the UI and CDN distributions', () => {
    expect(certificateNames).toEqual(expect.arrayContaining(aliases));
  });

  it('issues the edge certificate for no sign-in host', () => {
    expect(certificateNames.filter((name) => name.startsWith('auth.'))).toEqual([]);
  });

  it('validates every certificate name in the hosted zone', () => {
    const validated = certificate.properties.DomainValidationOptions.map((option) => option.DomainName);

    expect(validated.sort()).toEqual([...certificateNames].sort());
  });
});
