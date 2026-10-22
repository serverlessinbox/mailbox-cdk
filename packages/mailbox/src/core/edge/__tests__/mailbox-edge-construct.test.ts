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

function synthesizeEdge(prefix: string): Template {
  const stack = new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  new MailboxEdgeConstruct(stack, 'edge', {
    domainName:                'example.com',
    prefix,
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
  it('covers the webmail, admin, auth and cdn hosts under the prefix and validates each in the hosted zone', () => {
    const template = synthesizeEdge('.mail.');

    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName:              'webmail.mail.example.com',
      SubjectAlternativeNames: ['admin.mail.example.com', 'auth.mail.example.com', 'cdn.mail.example.com'],
      ValidationMethod:        'DNS',
      DomainValidationOptions: [
        { DomainName: 'webmail.mail.example.com', HostedZoneId: 'Z0TESTZONE' },
        { DomainName: 'admin.mail.example.com', HostedZoneId: 'Z0TESTZONE' },
        { DomainName: 'auth.mail.example.com', HostedZoneId: 'Z0TESTZONE' },
        { DomainName: 'cdn.mail.example.com', HostedZoneId: 'Z0TESTZONE' },
      ],
    });
  });

  it('serves the function from the artifact bucket and key, with the given role and the shared log group', () => {
    const template = synthesizeEdge('.');

    template.hasResourceProperties('AWS::Lambda::Function', {
      Code:          { S3Bucket: 'test-artifacts', S3Key: 'prefix/lambdas/jmap-blob-download.zip', S3ObjectVersion: { 'Fn::If': [Match.anyValue(), 'abc123', { Ref: 'AWS::NoValue' }] } },
      Role:          ROLE_ARN,
      LoggingConfig: { LogGroup: 'jmap-pipeline' },
    });
  });
});
