import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Fn, RemovalPolicy, Tags } from 'aws-cdk-lib';
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
import type { IDataTable } from '../data/data-tables';
import { AuthPolicyName, OAuthClientName } from '../auth/types';
import type { IAuditEventsQueue } from '../features/audit-writing/audit-events-queue';
import type { Pipeline } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { BucketAutoEmpty, StaticContentDeployer, StaticContentSource, StackNamedBucket, S3Actions, grantObjectActions, grantListBucket } from '@serverlessinbox/mailbox-cdk-shared';
import { Aws } from 'aws-cdk-lib';
import { slugifyLabel } from '@serverlessinbox/mailbox-cdk-shared';
import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import { IdpTokenExchangeApi } from './idp-token-exchange/api';

/** Location of a UI bundle zip in the artifact registry: the package that publishes it and the object path within it. */
export type UiBundleSource = {
  packageName: string;
  objectPath: string;
};

/** Inputs of `MailboxUi`: the CloudFront domain, the token-exchange wiring behind `/auth/*`, and the optional static content to deploy. */
export interface MailboxUiProps {
  domainName: string;

  /**
   * Without a certificate the distribution is served on its default CloudFront domain and
   * `domainName` is not attached to it as an alias.
   */
  certificate?: acm.ICertificate;

  configTable: IDataTable;

  authPolicyName: AuthPolicyName;

  oauthClientName: OAuthClientName;

  auditEventsQueue: IAuditEventsQueue;

  /** Used for the CloudFront comments, and slugified into the bucket's construct ID. */
  label: string;

  /** SERVICE_NAME for the token-exchange lambda. */
  tokenExchangeServiceName: string;

  readonly tokenExchangePipeline: Pipeline;

  /** Optional UI bundle (zip) published as an artifact. Deployed to `s3://<ui-bucket>/content/` via custom resource. */
  uiBundle?: UiBundleSource;

  /** Optional UI runtime config written to `s3://<ui-bucket>/config/config.json` via custom resource. */
  uiConfig?: {
    /** Base URL of the UI's backend API. */
    apiUrl?: string;
    /** Further keys are written to `config.json` unchanged. */
    [key: string]: unknown;
  };

  readonly artifactResolver: IArtifactResolver;
}

/**
 * Static-content UI: an S3 bucket behind a CloudFront distribution, with a `/config/*` behavior
 * for runtime config and an `/auth/*` behavior routed to a token-exchange API.
 *
 * Creates:
 * - S3 bucket for static assets
 * - CloudFront distribution
 * - /auth/* behavior routed to token exchange API
 */
export class MailboxUi extends Construct {
  private readonly bucket: Bucket;
  readonly distribution: Distribution;
  readonly distributionDomainName: string;

  /** Name of the static-content bucket, so subclasses can reference it without access to the bucket resource itself. */
  protected readonly bucketName: string;

  constructor(scope: Construct, id: string, props: MailboxUiProps) {
    super(scope, id);

    const artifacts = props.artifactResolver;

    this.bucket = new StackNamedBucket(this, `ui-${slugifyLabel(props.label)}`, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      abacStatus: true,
    });
    this.bucketName = this.bucket.bucketName;

    BucketAutoEmpty.getOrCreate(this, artifacts).attach(this, 'bucket-auto-empty', this.bucket);

    const originAccessIdentity = new OriginAccessIdentity(this, 'origin-access-identity', {
      comment: `Mailbox ${Aws.STACK_NAME} ${props.label} OAI`,
    });

    // The OAI only fetches individual objects: defaultRootObject and both custom error-page paths
    // resolve to specific keys, never a listing. s3:GetObject is therefore the whole grant.
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [this.bucket.arnForObjects('*')],
        principals: [originAccessIdentity.grantPrincipal],
      }),
    );

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

  /**
   * Grants `grantee` exactly the S3 actions needed to deploy static content into this UI's own
   * bucket: `s3:PutObject`/`s3:DeleteObject` on the `content/` and `config/` prefixes, and
   * `s3:ListBucket` scoped to list only those prefixes.
   *
   * The grant is scoped by this bucket's ARN and key patterns, never by tag: `aws:ResourceTag`
   * reads the still-untagged object being written, and `s3:BucketTag` is not honored for
   * `PutObject` even though it is listed as a supported condition key on the S3 `object`
   * resource type. A tag condition on these actions therefore denies the write.
   */
  grantContentDeploy(grantee: iam.IGrantable): void {
    grantObjectActions(grantee, this.bucket, [...S3Actions.write, ...S3Actions.delete], 'content/*');
    grantObjectActions(grantee, this.bucket, [...S3Actions.write, ...S3Actions.delete], 'config/*');
    grantListBucket(grantee, this.bucket, 'content/*');
    grantListBucket(grantee, this.bucket, 'config/*');
  }

  private addUiDeployment(artifacts: IArtifactResolver, props: MailboxUiProps): void {
    const deployer = StaticContentDeployer.getOrCreate(this, artifacts);

    // Distribution tags: update type
    Tags.of(this.distribution).add(ServerlessInboxTagKeys.autoUpdateType, 'ui');

    const uiResolved = props.uiBundle
      ? artifacts.resolve(props.uiBundle.packageName, props.uiBundle.objectPath)
      : undefined;

    // Distribution tags: artifact metadata
    if (props.uiBundle) {
      const bundleVersion = artifacts.getVersion(props.uiBundle.packageName);
      Tags.of(this.distribution).add(ServerlessInboxTagKeys.artifactPackage, props.uiBundle.packageName);
      Tags.of(this.distribution).add(ServerlessInboxTagKeys.artifactName, props.uiBundle.objectPath);
      Tags.of(this.distribution).add(ServerlessInboxTagKeys.artifactVersion, bundleVersion);
      Tags.of(this.distribution).add(ServerlessInboxTagKeys.bucketName, this.bucket.bucketName);
    }

    // Deploy UI bundle (if present)
    if (uiResolved) {
      deployer.deploy(this, 'ui-content', {
        targetBucket: this.bucket,
        source: StaticContentSource.zipFromBucket(uiResolved.bucket, uiResolved.key, 'content/', {
          sourceVersionId: uiResolved.versionId,
        }),
      });
    }

    // Deploy UI config (if present)
    if (props.uiConfig) {
      deployer.deploy(this, 'ui-config', {
        targetBucket: this.bucket,
        source: StaticContentSource.data('config/config.json', JSON.stringify(props.uiConfig), {
          contentType: 'application/json; charset=utf-8',
          cacheControl: 'no-store',
        }),
      });
    }

    // Invalidate CloudFront distribution cache for all UI content
    deployer.invalidate(this, 'ui-invalidate', {
      distributionId: this.distribution.distributionId,
      paths: ['/*'],
    });
  }

  private addAuthBehavior(
    distribution: Distribution,
    artifactResolver: IArtifactResolver,
    configTable: IDataTable,
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
