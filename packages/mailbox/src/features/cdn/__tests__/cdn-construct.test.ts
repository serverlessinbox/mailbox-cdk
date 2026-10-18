import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import type { IDataTable } from '../../../data/data-tables';
import type { IAuthKeyStoreTable } from '../../auth-key-store/auth-key-store-table';
import { Cdn, type CdnProps } from '../cdn-construct';

/*
 * Pins the synthesized CloudFront distribution of the blob CDN. The Lambda@Edge authorizer receives its whole
 * configuration through the custom headers of the S3 origin, so a header name or value that drifts leaves the
 * authorizer rejecting every download at runtime, and neither tsc nor synth notices. The header names asserted
 * below are the ones the authorizer's config reader looks up.
 */

const EDGE_VERSION_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:jmap-blob-download:3';
const CERTIFICATE_ARN = 'arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555';

/** Stands in for the configuration table; the CDN reads only its name. */
function fakeDataTable(tableName: string): IDataTable {
  return { tableName, tableArn: `arn:aws:dynamodb:eu-west-1:123456789012:table/${tableName}`, grantRead: jest.fn(), grantReadWrite: jest.fn() };
}

/** Stands in for the auth key store table; the CDN reads only its name. */
function fakeAuthKeyStoreTable(tableName: string): IAuthKeyStoreTable {
  return { tableName, tableArn: `arn:aws:dynamodb:eu-west-1:123456789012:table/${tableName}`, grantRead: jest.fn(), grantReadWrite: jest.fn() };
}

function importedCertificate(): acm.ICertificate {
  return acm.Certificate.fromCertificateArn(new cdk.Stack(new App(), 'CertificateStack'), 'certificate', CERTIFICATE_ARN);
}

interface SynthesizedCdn {
  readonly stack: cdk.Stack;
  readonly cdn: Cdn;
  readonly template: Template;
}

/** A stack without an explicit environment, as the product's template renders for customers. */
function synthesizeCdn(overrides: Partial<CdnProps> = {}): SynthesizedCdn {
  const stack = new cdk.Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
  const cdn = new Cdn(stack, 'blob-cdn', {
    blobStore: s3.Bucket.fromBucketName(stack, 'blob-store', 'blob-bucket'),
    configTable: fakeDataTable('config-table'),
    authKeyStoreTable: fakeAuthKeyStoreTable('auth-key-store-table'),
    userPoolIssuer: 'https://issuer.example.com',
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
      ['x-config-table', 'config-table'],
      ['x-auth-key-store-table', 'auth-key-store-table'],
      ['x-region', { Ref: 'AWS::Region' }],
      ['x-auth-policy-name', 'JMAP_API'],
    ])('sets %s', (headerName, headerValue) => {
      const { template } = synthesizeCdn();

      template.hasResourceProperties('AWS::CloudFront::Distribution', hasOriginHeader(headerName, headerValue));
    });

    it('lists the configured JWT algorithms, comma-separated', () => {
      const { template } = synthesizeCdn({ jwtAlgorithms: ['RS256', 'ES256'] });

      template.hasResourceProperties('AWS::CloudFront::Distribution', hasOriginHeader('x-jwt-algorithms', 'RS256,ES256'));
    });

    it.each([
      ['unset', undefined],
      ['empty', []],
    ])('falls back to RS256 when the JWT algorithms are %s', (_label, jwtAlgorithms) => {
      const { template } = synthesizeCdn({ jwtAlgorithms });

      template.hasResourceProperties('AWS::CloudFront::Distribution', hasOriginHeader('x-jwt-algorithms', 'RS256'));
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
      const { stack, cdn, template } = synthesizeCdn({ domainName: 'cdn.example.com', certificate: importedCertificate() });

      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          Aliases: ['cdn.example.com'],
          ViewerCertificate: Match.objectLike({ AcmCertificateArn: CERTIFICATE_ARN }),
        }),
      });
      expect(stack.resolve(cdn.host)).toEqual('https://cdn.example.com');
    });

    it.each([
      ['a domain name without a certificate', { domainName: 'cdn.example.com' }],
      ['a certificate without a domain name', { certificate: importedCertificate() }],
    ])('keeps the CloudFront domain given %s', (_label, domainProps: Partial<CdnProps>) => {
      const { stack, cdn, template } = synthesizeCdn(domainProps);

      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({ Aliases: Match.absent(), ViewerCertificate: Match.absent() }),
      });
      expect(JSON.stringify(stack.resolve(cdn.host))).toContain('DomainName');
    });
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

  it('exposes the id of the distribution it creates', () => {
    const { stack, cdn, template } = synthesizeCdn();

    const [distributionLogicalId] = Object.keys(template.findResources('AWS::CloudFront::Distribution'));

    expect(stack.resolve(cdn.distributionId)).toEqual({ Ref: distributionLogicalId });
  });
});
