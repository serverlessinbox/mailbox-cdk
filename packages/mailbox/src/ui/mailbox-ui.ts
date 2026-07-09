import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { CustomResource, Duration, Fn, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
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
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { createHash } from 'crypto';
import { AuthPolicyName, OAuthClientName } from '../auth/types';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { StackNamedBucket } from '../utils/named-bucket';
import { Aws } from 'aws-cdk-lib';
import { slugifyLabel } from '../utils/resource-names';
import { TypeScriptLambda } from '../utils/ts-lambda';
import { ServerlessInboxTagKeys } from '../utils/serverless-inbox-tags';
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

  /** Optional audit events queue for publishing audit logs from token exchange. */
  auditEventsQueue?: IQueue;

  /** Human-friendly label used for CloudFront comments. */
  label: string;

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

  private getOrCreateUiDeployer(artifactResolver: ICdkArtifactEngine): TypeScriptLambda {
    const stack = Stack.of(this);
    const existing = stack.node.tryFindChild('mailbox-ui-deployer');
    if (existing) {
      return existing as TypeScriptLambda;
    }

    const deployer = new TypeScriptLambda(stack, 'mailbox-ui-deployer', {
      lambdaId: 'ui-deployer',
      artifactResolver,
      packageName: 'mailbox-cdk',
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 1024,
    });

    // UI discovery tag for the scheduled updater (Correction 1 / decision 2)
    Tags.of(deployer).add(ServerlessInboxTagKeys.uiBundleTarget, 'true');

    return deployer;
  }

  constructor(scope: Construct, id: string, props: MailboxUiProps) {
    super(scope, id);

    const artifacts = props.artifactResolver;

    this.bucket = new StackNamedBucket(this, `ui-${slugifyLabel(props.label)}`, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
    });

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
      comment: `Mailbox ${props.label} UI`,
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
    );

    if (props.uiBundle || props.uiConfig) {
      this.addUiDeployment(artifacts, props);
    }

    this.distributionDomainName = props.certificate ? props.domainName : this.distribution.distributionDomainName;
  }

  private addUiDeployment(artifacts: ICdkArtifactEngine, props: MailboxUiProps): void {
    const deployer = this.getOrCreateUiDeployer(artifacts);

    // UI discovery tag for the scheduled updater (Correction 1 / decision 2)
    Tags.of(this.bucket).add(ServerlessInboxTagKeys.uiBundleTarget, 'true');

    // Allow cache invalidations after deployment.
    deployer.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: ['*'],
      }),
    );

    // Allow writing + pruning UI bucket prefixes.
    this.bucket.grantReadWrite(deployer);
    deployer.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [this.bucket.bucketArn],
      }),
    );

    const uiResolved = props.uiBundle
      ? artifacts.resolve(props.uiBundle.packageName, props.uiBundle.objectPath, Stack.of(this).region)
      : undefined;

    // Allow reading UI bundle artifacts from the artifacts bucket.
    // Both GetObject and GetObjectVersion are required for versioned artifact access.
    if (uiResolved) {
      deployer.addToRolePolicy(
        new PolicyStatement({
          actions: [
            's3:GetObject',
            's3:GetObjectVersion',
          ],
          resources: [
            `arn:aws:s3:::${uiResolved.bucket}/${uiResolved.key}`,
          ],
        }),
      );
    }

    // Stable nonce so CFN updates when inputs change (without forcing redeploy on every synth).
    const normalizedConfig = props.uiConfig ?? undefined;
    const nonce = createHash('sha256')
      .update(JSON.stringify({ key: uiResolved?.key, versionId: uiResolved?.versionId, config: normalizedConfig }))
      .digest('hex')
      .slice(0, 16);

    new CustomResource(this, 'ui-assets', {
      serviceToken: deployer.functionArn,
      serviceTimeout: Duration.minutes(15), // caps CFN's default multi-hour wait
      properties: {
        deploymentNonce: nonce,

        targetBucket: this.bucket.bucketName,

        // Dedicated bucket: ensure stack deletion can fully clean it up.
        clearAllOnDelete: true,

        // Optional UI bundle deployment
        sourceBucket: uiResolved?.bucket,
        sourceKey: uiResolved?.key,
        sourceVersionId: uiResolved?.versionId,
        contentPrefix: 'content/',

        // Optional dynamic config
        configPrefix: 'config/',
        configJson: props.uiConfig ? JSON.stringify(props.uiConfig) : undefined,

        // Optional CDN cache invalidation (recommended when deploying a new UI bundle)
        distributionId: this.distribution.distributionId,
        invalidationPaths: ['/*'],
      },
    });
  }

  private addAuthBehavior(
    distribution: Distribution,
    artifactResolver: ICdkArtifactEngine,
    configTable: ITable,
    auditEventsQueue: IQueue | undefined,
    authPolicyName: AuthPolicyName,
    oauthClientName: OAuthClientName,
  ): void {
    const tokenExchange = new IdpTokenExchangeApi(this, 'oauth-api', {
      artifactResolver,
      configTable,
      auditEventsQueue,
      authPolicyName,
      oauthClientName,
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
