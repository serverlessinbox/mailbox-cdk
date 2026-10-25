/// <reference types="jest" />

/**
 * MailboxEdgeConstruct tests: the us-east-1 certificate and the Lambda@Edge function it renders
 * from the edge stack's parameter values. A certificate that misses a host, or is validated in the
 * wrong zone, never issues and blocks the edge stack; a function wired to the wrong code or role
 * serves downloads without the authorizer the mailbox expects.
 */

import { Match, Template }               from 'aws-cdk-lib/assertions';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { MailboxEdgeConstruct }          from '../mailbox-edge-construct';

const ROLE_ARN = 'arn:aws:iam::123456789012:role/jmap-blob-download';

function synthesizeEdge(): Template {
  const stack = new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  new MailboxEdgeConstruct(stack, 'edge', {
    webmailHost:               'inbox.mail.example.com',
    adminHost:                 'console.mail.example.com',
    cdnHost:                   'files.mail.example.com',
    hostedZoneId:              'Z0TESTZONE',
    hostedZoneName:            'example.com',
    artifactBucket:            'test-artifacts',
    jmapBlobDownloadReference: { bucket: 'test-artifacts', key: 'prefix/lambdas/jmap-blob-download.zip', versionId: 'abc123' },
    itemTableArn:              'arn:aws:dynamodb:us-west-2:111122223333:table/item',
    configTableArn:            'arn:aws:dynamodb:us-west-2:111122223333:table/config',
    authKeyStoreTableArn:      'arn:aws:dynamodb:us-west-2:111122223333:table/auth-keys',
    productVersion:            '1.2.3',
    logGroupName:              'jmap-pipeline',
    jmapBlobDownloadRoleArn:   ROLE_ARN,
  });

  return Template.fromStack(stack);
}

describe('MailboxEdgeConstruct', () => {
  it('names the certificate after the webmail host, adds the admin and cdn hosts in that order and validates each in the hosted zone', () => {
    const template = synthesizeEdge();

    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName:              'inbox.mail.example.com',
      SubjectAlternativeNames: ['console.mail.example.com', 'files.mail.example.com'],
      ValidationMethod:        'DNS',
      DomainValidationOptions: [
        { DomainName: 'inbox.mail.example.com', HostedZoneId: 'Z0TESTZONE' },
        { DomainName: 'console.mail.example.com', HostedZoneId: 'Z0TESTZONE' },
        { DomainName: 'files.mail.example.com', HostedZoneId: 'Z0TESTZONE' },
      ],
    });
  });

  it('serves the function from the artifact bucket and key, with the given role and the shared log group', () => {
    const template = synthesizeEdge();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Code:          { S3Bucket: 'test-artifacts', S3Key: 'prefix/lambdas/jmap-blob-download.zip', S3ObjectVersion: { 'Fn::If': [Match.anyValue(), 'abc123', { Ref: 'AWS::NoValue' }] } },
      Role:          ROLE_ARN,
      LoggingConfig: { LogGroup: 'jmap-pipeline' },
    });
  });
});
