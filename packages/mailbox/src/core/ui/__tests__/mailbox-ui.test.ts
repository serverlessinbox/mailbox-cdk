/// <reference types="jest" />

/**
 * MailboxUi tests: what the construct itself decides.
 *
 * Pins how the distribution is exposed (alias only with a certificate), which paths bypass the
 * single-page-app cache (`/config/*`) or go to the token exchange (`/auth/*`), which of the bucket's
 * origins each behavior reads, what is deployed and tagged for a bundle or a config, and that
 * `grantContentDeploy` hands the grantee to the bucket, which owns the statement. A cached `/config/*`
 * or a `/config/*` read from the `content/` prefix stays green in tsc and synth and only shows up on a
 * live distribution.
 */

import { ArtifactZone, PinnedArtifactResolver }         from '@serverlessinbox/artifact-registry-cdk';
import { ServerlessInboxTagKeys }                       from '@serverlessinbox/mailbox-cdk-shared';
import { Capture, Match, Template }                     from 'aws-cdk-lib/assertions';
import * as acm                                         from 'aws-cdk-lib/aws-certificatemanager';
import * as dynamodb                                    from 'aws-cdk-lib/aws-dynamodb';
import * as iam                                         from 'aws-cdk-lib/aws-iam';
import * as cdk                                         from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                from 'aws-cdk-lib';

import { AuthPolicyName, OAuthClientName }              from '../../../contracts/auth-names';
import { UiBucket }                                     from '../../../resources/buckets/ui-bucket';
import { AuditEventsQueue }                             from '../../../resources/queues/audit-events-queue';
import { DataTable }                                    from '../../../resources/tables/data-tables';
import { MailboxUi }                                    from '../mailbox-ui';
import type { MailboxUiProps }                          from '../mailbox-ui';

/** CloudFront's managed CachingDisabled policy. */
const CACHING_DISABLED_POLICY_ID = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';

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

  function distributionHasConfig(distributionConfig: unknown): void {
    Template.fromStack(stack).hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: distributionConfig });
  }

  function distributionLogicalId(): string {
    return Object.keys(Template.fromStack(stack).findResources('AWS::CloudFront::Distribution'))[0];
  }

  function distributionHasTag(key: string, value: string): void {
    Template.fromStack(stack).hasResourceProperties('AWS::CloudFront::Distribution', { Tags: Match.arrayWith([{ Key: key, Value: value }]) });
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

      distributionHasConfig(Match.objectLike({ Aliases: ['admin.example.com'] }));
      expect(sut.distributionDomainName).toBe('admin.example.com');
    });

    it('serves on the CloudFront domain and reports it when no certificate is given', () => {
      const sut = new MailboxUi(stack, 'admin-ui', propsWith());

      distributionHasConfig(Match.objectLike({ Aliases: Match.absent() }));
      expect(stack.resolve(sut.distributionDomainName)).toEqual({ 'Fn::GetAtt': [distributionLogicalId(), 'DomainName'] });
    });
  });

  describe('behaviors', () => {
    it('serves index.html for 403 and 404 so client-side routes resolve', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      distributionHasConfig(Match.objectLike({
        DefaultRootObject:    'index.html',
        CustomErrorResponses: Match.arrayWith([
          { ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' },
          { ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' },
        ]),
      }));
    });

    it('serves /config/* uncached and read-only', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      distributionHasConfig(Match.objectLike({
        CacheBehaviors: Match.arrayWith([Match.objectLike({
          PathPattern:    '/config/*',
          CachePolicyId:  CACHING_DISABLED_POLICY_ID,
          AllowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        })]),
      }));
    });

    it('routes /auth/* over HTTPS only, uncached, with all methods and the forwarded-host function', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      distributionHasConfig(Match.objectLike({
        CacheBehaviors: Match.arrayWith([Match.objectLike({
          PathPattern:          '/auth/*',
          ViewerProtocolPolicy: 'https-only',
          CachePolicyId:        CACHING_DISABLED_POLICY_ID,
          AllowedMethods:       ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
          FunctionAssociations: [Match.objectLike({ EventType: 'viewer-request' })],
        })]),
      }));
    });
  });

  describe('origins', () => {
    it('reads the default behavior from the bucket\'s content/ prefix', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      const originId = new Capture();
      distributionHasConfig(Match.objectLike({ DefaultCacheBehavior: Match.objectLike({ TargetOriginId: originId }) }));
      distributionHasConfig(Match.objectLike({ Origins: Match.arrayWith([Match.objectLike({ Id: originId.asString(), OriginPath: '/content' })]) }));
    });

    it('reads /config/* from the bucket\'s config/ prefix, not from content/config/', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      const originId = new Capture();
      distributionHasConfig(Match.objectLike({
        CacheBehaviors: Match.arrayWith([Match.objectLike({ PathPattern: '/config/*', TargetOriginId: originId })]),
      }));
      distributionHasConfig(Match.objectLike({ Origins: Match.arrayWith([Match.objectLike({ Id: originId.asString(), OriginPath: '' })]) }));
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

      const withPolicy = Match.objectLike({ ResponseHeadersPolicyId: { Ref: policyIds[0] } });
      distributionHasConfig(Match.objectLike({ DefaultCacheBehavior: withPolicy, CacheBehaviors: [withPolicy, withPolicy] }));
    });

    it('requires TLS 1.2 2021 as the minimum viewer protocol when a certificate is given', () => {
      // The feature flag is off, so CDK's own default is TLS 1.2 2019 and only the explicit setting yields 2021.
      stack             = new cdk.Stack(new App({ context: { '@aws-cdk/aws-cloudfront:defaultSecurityPolicyTLSv1.2_2021': false } }), 'TestStack', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });
      const certificate = acm.Certificate.fromCertificateArn(stack, 'certificate', 'arn:aws:acm:us-east-1:123456789012:certificate/abc');

      new MailboxUi(stack, 'admin-ui', propsWith({ certificate }));

      distributionHasConfig(Match.objectLike({ ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: 'TLSv1.2_2021' }) }));
    });

    it('sets no viewer certificate, and so no minimum protocol version, without a certificate', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      distributionHasConfig(Match.objectLike({ ViewerCertificate: Match.absent() }));
    });
  });

  describe('deployment', () => {
    it('deploys and invalidates nothing without a bundle or a config', () => {
      new MailboxUi(stack, 'admin-ui', propsWith());

      const template = Template.fromStack(stack);
      template.resourceCountIs('Custom::ContentDeployment', 0);
      template.resourceCountIs('Custom::ContentInvalidation', 0);
      template.resourcePropertiesCountIs('AWS::CloudFront::Distribution', { Tags: Match.arrayWith([Match.objectLike({ Key: ServerlessInboxTagKeys.autoUpdateType })]) }, 0);
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
      distributionHasTag(ServerlessInboxTagKeys.autoUpdateType, 'ui');
    });

    it('invalidates its own distribution', () => {
      new MailboxUi(stack, 'admin-ui', propsWith({ uiConfig: { apiUrl: 'https://api.example.com' } }));

      Template.fromStack(stack).hasResourceProperties('Custom::ContentInvalidation', { distributionId: { Ref: distributionLogicalId() } });
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

      distributionHasTag(ServerlessInboxTagKeys.autoUpdateType, 'ui');
      distributionHasTag(ServerlessInboxTagKeys.artifactPackage, 'mailbox-cdk');
      distributionHasTag(ServerlessInboxTagKeys.artifactName, 'ui/admin.zip');
      distributionHasTag(ServerlessInboxTagKeys.artifactVersion, '1.0.0');
    });
  });

  describe('grantContentDeploy', () => {
    it('hands the grantee to the bucket, which owns the statement', () => {
      const grantContentDeploy = jest.spyOn(UiBucket.prototype, 'grantContentDeploy');
      const sut                = new MailboxUi(stack, 'admin-ui', propsWith());
      const role               = new iam.Role(stack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

      sut.grantContentDeploy(role);

      expect(grantContentDeploy).toHaveBeenCalledTimes(1);
      expect(grantContentDeploy).toHaveBeenCalledWith(role);
      grantContentDeploy.mockRestore();
    });
  });
});
