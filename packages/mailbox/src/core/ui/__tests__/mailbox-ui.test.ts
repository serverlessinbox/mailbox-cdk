/// <reference types="jest" />

/**
 * MailboxUi tests: what the construct itself decides.
 *
 * Pins how the distribution is exposed (alias only with a certificate), which paths bypass the
 * single-page-app cache (`/config/*`) or go to the token exchange (`/auth/*`), that the bucket is
 * read through its own distribution, what is deployed and tagged for a bundle or
 * a config, and the exact scope of `grantContentDeploy`. A widened grant or a cached `/config/*`
 * stays green in tsc and synth and only shows up on a live distribution.
 */

import { ArtifactZone, PinnedArtifactResolver }         from '@serverlessinbox/artifact-registry-cdk';
import { ServerlessInboxTagKeys }                       from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                              from 'aws-cdk-lib/assertions';
import * as acm                                         from 'aws-cdk-lib/aws-certificatemanager';
import * as dynamodb                                    from 'aws-cdk-lib/aws-dynamodb';
import * as iam                                         from 'aws-cdk-lib/aws-iam';
import * as cdk                                         from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                from 'aws-cdk-lib';

import { AuthPolicyName, OAuthClientName }              from '../../../contracts/auth-names';
import { AuditEventsQueue }                             from '../../../resources/queues/audit-events-queue';
import { DataTable }                                    from '../../../resources/tables/data-tables';
import { MailboxUi }                                    from '../mailbox-ui';
import type { MailboxUiProps }                          from '../mailbox-ui';

/** The parts of a synthesized `AWS::CloudFront::Distribution` that these tests read. */
interface SynthesizedDistribution {
  readonly Properties: {
    readonly DistributionConfig: Record<string, unknown>;
    readonly Tags?:              Array<{ Key: string; Value: string }>;
  };
}

describe('MailboxUi', () => {
  let stack: cdk.Stack;

  function propsWith(overrides: Partial<MailboxUiProps> = {}): MailboxUiProps {
    return {
      domainName:               'admin.example.com',
      label:                    'admin',
      tokenExchangeServiceName: 'idp-token-exchange-admin-ui',
      tokenExchangePipeline:    'admin',
      configTable:              new DataTable(new dynamodb.Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      })),
      auditEventsQueue:         new AuditEventsQueue(stack, 'audit-events-queue'),
      authPolicyName:           AuthPolicyName.ADMIN_API,
      oauthClientName:          OAuthClientName.ADMIN_UI,
      artifactResolver:         new PinnedArtifactResolver({
        packages:         {
          'mailbox-cdk':        { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-go':         { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        },
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      ...overrides,
    };
  }

  function synthesizedDistribution(): SynthesizedDistribution {
    // cast: CDK's findResources returns untyped template JSON; this is the one framework boundary.
    return Object.values(Template.fromStack(stack).findResources('AWS::CloudFront::Distribution'))[0] as SynthesizedDistribution;
  }

  function distributionConfig(): Record<string, unknown> {
    return synthesizedDistribution().Properties.DistributionConfig;
  }

  function distributionTags(): Record<string, string> {
    const tags = synthesizedDistribution().Properties.Tags ?? [];
    return Object.fromEntries(tags.map((tag) => [tag.Key, tag.Value]));
  }

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  describe('distribution domain', () => {
    it('attaches domainName as the alias and reports it when a certificate is given', () => {
      const certificate = acm.Certificate.fromCertificateArn(stack, 'certificate', 'arn:aws:acm:us-east-1:123456789012:certificate/abc');

      const sut = new MailboxUi(stack, 'admin-ui', propsWith({ certificate }));

      expect(distributionConfig().Aliases).toEqual(['admin.example.com']);
      expect(sut.distributionDomainName).toBe('admin.example.com');
    });

    it('serves on the CloudFront domain and reports it when no certificate is given', () => {
      const sut = new MailboxUi(stack, 'admin-ui', propsWith());

      const distributionId = Object.keys(Template.fromStack(stack).findResources('AWS::CloudFront::Distribution'))[0];
      expect(distributionConfig().Aliases).toBeUndefined();
      expect(stack.resolve(sut.distributionDomainName)).toEqual({ 'Fn::GetAtt': [distributionId, 'DomainName'] });
    });
  });

  describe('behaviors', () => {
    it('serves index.html for 403 and 404 so client-side routes resolve', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      const config = distributionConfig();
      expect(config.DefaultRootObject).toBe('index.html');
      expect(config.CustomErrorResponses).toEqual(expect.arrayContaining([
        { ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' },
        { ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' },
      ]));
    });

    it('serves /config/* uncached and read-only', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      const behaviors      = distributionConfig().CacheBehaviors as Array<Record<string, unknown>>;
      const configBehavior = behaviors.find((behavior) => behavior.PathPattern === '/config/*');
      expect(configBehavior).toMatchObject({
        // CloudFront's managed CachingDisabled policy.
        CachePolicyId:  '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
        AllowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      });
    });

    it('routes /auth/* over HTTPS only, uncached, with all methods and the forwarded-host function', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      const behaviors    = distributionConfig().CacheBehaviors as Array<Record<string, unknown>>;
      const authBehavior = behaviors.find((behavior) => behavior.PathPattern === '/auth/*');
      expect(authBehavior).toMatchObject({
        ViewerProtocolPolicy: 'https-only',
        CachePolicyId:        '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
        AllowedMethods:       ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
        FunctionAssociations: [expect.objectContaining({ EventType: 'viewer-request' })],
      });
    });
  });

  describe('security headers and TLS', () => {
    it('attaches one response-headers policy with HSTS, nosniff and frame-ancestors to every behavior', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      const template  = Template.fromStack(stack);
      const policyIds = Object.keys(template.findResources('AWS::CloudFront::ResponseHeadersPolicy'));
      expect(policyIds).toHaveLength(1);
      template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
        ResponseHeadersPolicyConfig: {
          SecurityHeadersConfig: {
            StrictTransportSecurity: { AccessControlMaxAgeSec: 31536000, IncludeSubdomains: false, Override: true },
            ContentTypeOptions:      { Override: true },
            ContentSecurityPolicy:   { ContentSecurityPolicy: "frame-ancestors 'none'", Override: true },
          },
        },
      });

      const config    = distributionConfig();
      const behaviors = [
        config.DefaultCacheBehavior as Record<string, unknown>,
        ...(config.CacheBehaviors as Array<Record<string, unknown>>),
      ];
      expect(behaviors).toHaveLength(3);
      for (const behavior of behaviors) {
        expect(behavior.ResponseHeadersPolicyId).toEqual({ Ref: policyIds[0] });
      }
    });

    it('requires TLS 1.2 2021 as the minimum viewer protocol when a certificate is given', () => {
      // The feature flag is off, so CDK's own default is TLS 1.2 2019 and only the explicit setting yields 2021.
      stack             = new cdk.Stack(new App({ context: { '@aws-cdk/aws-cloudfront:defaultSecurityPolicyTLSv1.2_2021': false } }), 'TestStack', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });
      const certificate =acm.Certificate.fromCertificateArn(stack, 'certificate', 'arn:aws:acm:us-east-1:123456789012:certificate/abc');

      new MailboxUi(stack, 'admin-ui', propsWith({ certificate }));

      expect(distributionConfig().ViewerCertificate).toMatchObject({ MinimumProtocolVersion: 'TLSv1.2_2021' });
    });

    it('sets no viewer certificate, and so no minimum protocol version, without a certificate', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      expect(distributionConfig().ViewerCertificate).toBeUndefined();
    });
  });

  describe('bucket', () => {
    it('reads the bucket through its own distribution', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      const template       = Template.fromStack(stack);
      const distributionId = Object.keys(template.findResources('AWS::CloudFront::Distribution'))[0];
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: {
          Statement: [
            Match.objectLike({
              Effect:    'Deny',
              Action:    's3:*',
              Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            }),
            Match.objectLike({
              Condition: { StringEquals: { 'AWS:SourceArn': { 'Fn::Join': ['', Match.arrayWith([{ Ref: distributionId }])] } } },
            }),
          ],
        },
      });
    });
  });

  describe('deployment', () => {
    it('deploys, invalidates and tags nothing without a bundle or a config', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      const template = Template.fromStack(stack);
      template.resourceCountIs('Custom::ContentDeployment', 0);
      template.resourceCountIs('Custom::ContentInvalidation', 0);
      expect(distributionTags()).not.toHaveProperty([ServerlessInboxTagKeys.autoUpdateType]);
    });

    it('with only a config, deploys the config as non-cacheable JSON, invalidates and tags the distribution as a UI', () => {
      new MailboxUi(stack, 'admin-ui', propsWith({ uiConfig: { apiUrl: 'https://api.example.com' } }));

      const template = Template.fromStack(stack);
      template.resourceCountIs('Custom::ContentDeployment', 1);
      template.hasResourceProperties('Custom::ContentDeployment', {
        sources: [Match.objectLike({
          kind:         'data',
          key:          'config/config.json',
          body:         '{"apiUrl":"https://api.example.com"}',
          contentType:  'application/json; charset=utf-8',
          cacheControl: 'no-store',
        })],
      });
      template.hasResourceProperties('Custom::ContentInvalidation', { invalidationPaths: ['/*'] });
      const tags = distributionTags();
      expect(tags[ServerlessInboxTagKeys.autoUpdateType]).toBe('ui');
    });

    it('invalidates its own distribution', () => {
      new MailboxUi(stack, 'admin-ui', propsWith({ uiConfig: { apiUrl: 'https://api.example.com' } }));

      const template       = Template.fromStack(stack);
      const distributionId = Object.keys(template.findResources('AWS::CloudFront::Distribution'))[0];
      template.hasResourceProperties('Custom::ContentInvalidation', { distributionId: { Ref: distributionId } });
    });

    it('with a bundle, deploys it under content/', () => {
      new MailboxUi(stack, 'admin-ui', propsWith({ uiBundle: { packageName: 'mailbox-cdk', objectPath: 'ui/admin.zip' } }));

      const template = Template.fromStack(stack);
      template.resourceCountIs('Custom::ContentDeployment', 1);
      template.hasResourceProperties('Custom::ContentDeployment', {
        sources: [Match.objectLike({ kind: 'zip', sourceKey: Match.stringLikeRegexp('mailbox-cdk/.*ui/admin\\.zip$'), targetPrefix: 'content/' })],
      });
    });

    it('with a bundle, tags the distribution with the bundle package, object and version', () => {
      new MailboxUi(stack, 'admin-ui', propsWith({ uiBundle: { packageName: 'mailbox-cdk', objectPath: 'ui/admin.zip' } }));

      expect(distributionTags()).toMatchObject({
        [ServerlessInboxTagKeys.autoUpdateType]:  'ui',
        [ServerlessInboxTagKeys.artifactPackage]: 'mailbox-cdk',
        [ServerlessInboxTagKeys.artifactName]:    'ui/admin.zip',
        [ServerlessInboxTagKeys.artifactVersion]: '1.0.0',
      });
    });
  });

  describe('grantContentDeploy', () => {
    it('allows write and delete on content/ and config/ only, and listing of those prefixes only', () => {
      const sut  = new MailboxUi(stack, 'admin-ui', propsWith());
      const role = new iam.Role(stack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

      sut.grantContentDeploy(role);

      const template       = Template.fromStack(stack);
      const bucketArn      = { 'Fn::GetAtt': [Object.keys(template.findResources('AWS::S3::Bucket'))[0], 'Arn'] };
      const objectsUnder   = (prefix: string): unknown => ({ 'Fn::Join': ['', [bucketArn, `/${prefix}/*`]] });
      const writeAndDelete = ['s3:PutObject', 's3:DeleteObject'];
      const listOnly       = (prefix: string): unknown => Match.objectEquals({
        Action:    's3:ListBucket',
        Effect:    'Allow',
        Resource:  bucketArn,
        Condition: { StringLike: { 's3:prefix': `${prefix}/*` } },
      });
      template.hasResourceProperties('AWS::IAM::Policy', {
        Roles:          [{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }],
        PolicyDocument: {
          Statement: Match.arrayEquals([
            Match.objectEquals({ Action: writeAndDelete, Effect: 'Allow', Resource: objectsUnder('content') }),
            Match.objectEquals({ Action: writeAndDelete, Effect: 'Allow', Resource: objectsUnder('config') }),
            listOnly('content'),
            listOnly('config'),
          ]),
        },
      });
    });
  });
});
