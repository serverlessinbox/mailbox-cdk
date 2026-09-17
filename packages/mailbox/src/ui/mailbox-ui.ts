import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Fn, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  OriginAccessIdentity,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { AuthPolicyName, OAuthClientName } from '../auth/types';
import type { IAuditEventsQueue } from '../features/audit-writing/audit-events-queue';
import type { ICdkArtifactEngine, Pipeline } from '@serverlessinbox/mailbox-cdk-shared';
import { BucketAutoEmpty, StaticContentDeployer, StaticContentSource, StackNamedBucket } from '@serverlessinbox/mailbox-cdk-shared';
import { Aws } from 'aws-cdk-lib';
import { slugifyLabel } from '@serverlessinbox/mailbox-cdk-shared';
import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import { IdpTokenExchangeApi } from './idp-token-exchange/api';

export type UiBundleSource = {
  packageName: string;
  objectPath: string;
};

export interface MailboxUiProps {
  /** Domain name for the CloudFront distribution (e.g., admin.example.com) */
  domainName: string;

  /** Optional ACM certificate for `domainName`. */
  certificate?: acm.ICertificate;

  /** Shared config table used by token exchange API. */
  configTable: ITable;

  /** Which auth policy record to use for token exchange. */
  authPolicyName: AuthPolicyName;

  /** Which OAuth client record to use for token exchange. */
  oauthClientName: OAuthClientName;

  /** Audit events queue for publishing audit logs from token exchange. */
  auditEventsQueue: IAuditEventsQueue;

  /** Human-friendly label used for CloudFront comments. */
  label: string;

  /** SERVICE_NAME for the token-exchange lambda; distinguishes Admin UI vs Webmail UI instances. */
  tokenExchangeServiceName: string;

  /** Pipeline for the token-exchange lambda: 'admin' for Admin UI, 'jmap' for Webmail UI. */
  readonly tokenExchangePipeline: Pipeline;

  /** Optional UI bundle (zip) published as an artifact. Deployed to `s3://<ui-bucket>/content/` via custom resource. */
  uiBundle?: UiBundleSource;

  /** Optional UI runtime config written to `s3://<ui-bucket>/config/config.json` via custom resource. */
  uiConfig?: {
    /** Base URL for the UI's backend API (whatever the frontend consumes). */
    apiUrl?: string;
    /** Additional provider-/deployment-specific config for the UI. */
    [key: string]: unknown;
  };

  /** Artifact resolver for all UI resources (bundle + ui-deployer + token-exchange). */
  readonly artifactResolver: ICdkArtifactEngine;
}

/**
 * Shared UI construct used by Admin UI and Webmail UI.
 *
 * Creates:
 * - S3 bucket for static assets
 * - CloudFront distribution
 * - /auth/* behavior routed to token exchange API
 */
export class MailboxUi extends Construct {
  readonly bucket: Bucket;
  readonly distribution: Distribution;
  readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: MailboxUiProps) {
    super(scope, id);

    const artifacts = props.artifactResolver;

    this.bucket = new StackNamedBucket(this, `ui-${slugifyLabel(props.label)}`, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      abacStatus: true,
    });

    // Attach bucket auto-empty handler to clean up bucket on stack deletion
    BucketAutoEmpty.getOrCreate(this, artifacts).attach(this, 'bucket-auto-empty', this.bucket);

    const originAccessIdentity = new OriginAccessIdentity(this, 'origin-access-identity', {
      comment: `Mailbox ${Aws.STACK_NAME} ${props.label} OAI`,
    });

    this.bucket.grantRead(originAccessIdentity);

    const contentOrigin = S3BucketOrigin.withOriginAccessIdentity(this.bucket, {
      originAccessIdentity,
      originPath: '/content',
    });

    const configOrigin = S3BucketOrigin.withOriginAccessIdentity(this.bucket, {
      originAccessIdentity,
      originPath: '',
    });

    this.distribution = new Distribution(this, 'distribution', {
      comment: `Mailbox ${props.label}`,
      defaultRootObject: 'index.html',
      domainNames: props.certificate ? [props.domainName] : undefined,
      certificate: props.certificate,
      defaultBehavior: {
        // Default UI content lives under /content in the bucket.
        origin: contentOrigin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: undefined,
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: undefined,
        },
      ],
    });

    // Tag the distribution for root-stack correlation (inherited via parent, but explicit for clarity).
    Tags.of(this.distribution).add(ServerlessInboxTagKeys.rootStack, Aws.STACK_NAME);

    // Always route /config/* to the bucket's /config/* (not /content/config/*).
    // Disable caching so CDK-driven config updates propagate immediately.
    this.distribution.addBehavior('/config/*', configOrigin, {
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      compress: true,
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
    });

    this.addAuthBehavior(
      this.distribution,
      artifacts,
      props.configTable,
      props.auditEventsQueue,
      props.authPolicyName,
      props.oauthClientName,
      props.tokenExchangeServiceName,
      props.tokenExchangePipeline,
    );

    if (props.uiBundle || props.uiConfig) {
      this.addUiDeployment(artifacts, props);
    }

    this.distributionDomainName = props.certificate ? props.domainName : this.distribution.distributionDomainName;
  }

  private addUiDeployment(artifacts: ICdkArtifactEngine, props: MailboxUiProps): void {
    const deployer = StaticContentDeployer.getOrCreate(this, artifacts);

    // Tag the distribution for scheduled auto-update discovery
    Tags.of(this.distribution).add(ServerlessInboxTagKeys.autoUpdateType, 'ui');

    const uiResolved = props.uiBundle
      ? artifacts.resolve(props.uiBundle.packageName, props.uiBundle.objectPath, Stack.of(this).region)
      : undefined;

    // Tag the distribution with artifact metadata for auto-update tracking
    if (props.uiBundle) {
      const bundleVersion = artifacts.getVersion(props.uiBundle.packageName);
      Tags.of(this.distribution).add(ServerlessInboxTagKeys.artifactPackage, props.uiBundle.packageName);
      Tags.of(this.distribution).add(ServerlessInboxTagKeys.artifactName, props.uiBundle.objectPath);
      Tags.of(this.distribution).add(ServerlessInboxTagKeys.artifactVersion, bundleVersion);
      Tags.of(this.distribution).add(ServerlessInboxTagKeys.bucketName, this.bucket.bucketName);
    }

    // Deploy UI bundle (if present)
    if (uiResolved) {
      deployer.deploy(this, 'ui-content-v2', {
        targetBucket: this.bucket.bucketName,
        source: StaticContentSource.zipFromBucket(uiResolved.bucket, uiResolved.key, 'content/', {
          sourceVersionId: uiResolved.versionId,
        }),
      });
    }

    // Deploy UI config (if present)
    if (props.uiConfig) {
      deployer.deploy(this, 'ui-config-v3', {
        targetBucket: this.bucket.bucketName,
        source: StaticContentSource.data('config/config.json', JSON.stringify(props.uiConfig), {
          contentType: 'application/json; charset=utf-8',
          cacheControl: 'no-store',
        }),
      });
    }

    // Invalidate CloudFront distribution cache for all UI content
    deployer.invalidate(this, 'ui-invalidate-v3', {
      distributionId: this.distribution.distributionId,
      paths: ['/*'],
    });
  }

  private addAuthBehavior(
    distribution: Distribution,
    artifactResolver: ICdkArtifactEngine,
    configTable: ITable,
    auditEventsQueue: IAuditEventsQueue,
    authPolicyName: AuthPolicyName,
    oauthClientName: OAuthClientName,
    tokenExchangeServiceName: string,
    tokenExchangePipeline: Pipeline,
  ): void {
    const tokenExchange = new IdpTokenExchangeApi(this, 'oauth-api', {
      artifactResolver,
      configTable,
      auditEventsQueue,
      authPolicyName,
      oauthClientName,
      serviceName: tokenExchangeServiceName,
      pipeline: tokenExchangePipeline,
    });

    // Token exchange API is internal behind CloudFront.
    const hostname = Fn.select(1, Fn.split('://', tokenExchange.api.apiEndpoint));
    const oauthOrigin = new HttpOrigin(hostname, { originPath: '' });

    const authViewerRequestFunction = new CloudFrontFunction(this, 'auth-viewer-request', {
      code: FunctionCode.fromInline(`function handler(event) {
  var req = event.request;
  var host = req.headers.host.value;
  req.headers['x-forwarded-host'] = { value: host };
  return req;
}`),
    });

    distribution.addBehavior('/auth/*', oauthOrigin, {
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      functionAssociations: [
        {
          function: authViewerRequestFunction,
          eventType: FunctionEventType.VIEWER_REQUEST,
        },
      ],
      compress: false,
      allowedMethods: AllowedMethods.ALLOW_ALL,
    });
  }

}
