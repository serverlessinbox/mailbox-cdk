import { ServerlessInboxTagKeys }        from '@serverlessinbox/mailbox-cdk-shared';
import { Capture, Match, Template }      from 'aws-cdk-lib/assertions';
import * as acm                          from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda                       from 'aws-cdk-lib/aws-lambda';
import * as s3                           from 'aws-cdk-lib/aws-s3';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import type { IAuthKeyStoreTable }       from '../../../resources/tables/auth-key-store-table';
import { Cdn, type CdnProps }            from '../cdn-construct';

/*
 * Pins the synthesized CloudFront distribution of the blob CDN. The Lambda@Edge authorizer receives its whole
 * configuration through the custom headers of the S3 origin, so a header value that drifts leaves the
 * authorizer rejecting every download at runtime, and neither tsc nor synth notices. The region header must
 * stay a reference to the deploying region even on a stack with an explicit environment, where a literal region
 * would be baked into the template shipped to customers.
 */

const EDGE_VERSION_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:jmap-blob-download:3';
const CERTIFICATE_ARN  = 'arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555';

/** Stands in for the auth key store table; the CDN reads only its name. */
function fakeAuthKeyStoreTable(tableName: string): IAuthKeyStoreTable {
  return { tableName, tableArn: `arn:aws:dynamodb:eu-west-1:123456789012:table/${tableName}`, grantRead: jest.fn(), grantReadWrite: jest.fn() };
}

function importedCertificate(): acm.ICertificate {
  return acm.Certificate.fromCertificateArn(new cdk.Stack(new App(), 'CertificateStack'), 'certificate', CERTIFICATE_ARN);
}

interface SynthesizedCdn {
  readonly stack:    cdk.Stack;
  readonly cdn:      Cdn;
  readonly template: Template;
}

/** A stack with an explicit environment, where a region read from the stack resolves to a literal. */
function synthesizeCdn(overrides: Partial<CdnProps> = {}): SynthesizedCdn {
  const stack = new cdk.Stack(new App(), 'TestStack', {
    synthesizer: new BootstraplessSynthesizer(),
    env:         { account: '123456789012', region: 'eu-west-1' },
  });
  const cdn   = new Cdn(stack, 'blob-cdn', {
    blobStore:               s3.Bucket.fromBucketName(stack, 'blob-store', 'blob-bucket'),
    authKeyStoreTable:       fakeAuthKeyStoreTable('auth-key-store-table'),
    jmapBlobDownloadVersion: lambda.Version.fromVersionArn(stack, 'edge-version', EDGE_VERSION_ARN),
    ...overrides,
  });
  return { stack, cdn, template: Template.fromStack(stack) };
}

function hasOriginHeader(headerName: string, headerValue: unknown): object {
  return Match.objectLike({
    DistributionConfig: Match.objectLike({
      Origins: Match.arrayWith([
        Match.objectLike({ OriginCustomHeaders: Match.arrayWith([{ HeaderName: headerName, HeaderValue: headerValue }]) }),
      ]),
    }),
  });
}

describe('Cdn', () => {
  describe('origin headers for the authorizer', () => {
    it.each([
      ['x-auth-key-store-table', 'auth-key-store-table'],
      ['x-region', { Ref: 'AWS::Region' }],
      ['x-jwt-algorithms', 'RS256'],
    ])('sets %s', (headerName, headerValue) => {
      const { template } = synthesizeCdn();

      template.hasResourceProperties('AWS::CloudFront::Distribution', hasOriginHeader(headerName, headerValue));
    });
  });

  describe('CORS response headers policy', () => {
    it('allows the configured origins', () => {
      const { template } = synthesizeCdn({ allowedOrigins: ['https://mail.example.com'] });

      template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
        ResponseHeadersPolicyConfig: Match.objectLike({
          CorsConfig: Match.objectLike({
            AccessControlAllowOrigins: { Items: ['https://mail.example.com'] },
          }),
        }),
      });
    });

    it.each([
      ['unset', undefined],
      ['empty', []],
    ])('is not created when the allowed origins are %s', (_label, allowedOrigins) => {
      const { template } = synthesizeCdn({ allowedOrigins });

      template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 0);
    });
  });

  describe('custom domain', () => {
    it('serves the distribution on the domain with its certificate', () => {
      const { stack, cdn, template } = synthesizeCdn({
        customDomain: { name: 'cdn.example.com', certificate: importedCertificate() },
      });

      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          Aliases:           ['cdn.example.com'],
          ViewerCertificate: Match.objectLike({ AcmCertificateArn: CERTIFICATE_ARN }),
        }),
      });
      expect(stack.resolve(cdn.host)).toEqual('https://cdn.example.com');
    });

    it('keeps the CloudFront domain without a custom domain', () => {
      const { stack, cdn, template } = synthesizeCdn();

      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({ Aliases: Match.absent(), ViewerCertificate: Match.absent() }),
      });
      expect(JSON.stringify(stack.resolve(cdn.host))).toContain('DomainName');
    });
  });

  it('names the Origin Access Control with the install id', () => {
    const { template } = synthesizeCdn();
    const name         = new Capture();

    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({ Name: name }),
    });

    expect(JSON.stringify(name.asObject())).toContain('"Ref":"AWS::StackId"');
  });

  it('runs the given Lambda@Edge version at origin-request', () => {
    const { template } = synthesizeCdn();

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          LambdaFunctionAssociations: [{ EventType: 'origin-request', LambdaFunctionARN: EDGE_VERSION_ARN }],
        }),
      }),
    });
  });

  it('tags the distribution as exempt from auto-update', () => {
    const { template } = synthesizeCdn();

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      Tags: Match.arrayWith([{ Key: ServerlessInboxTagKeys.autoUpdateType, Value: 'none' }]),
    });
  });
});
