import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';

export interface CdnProps {
  readonly blobStore: IBucket;
  readonly configTable: ITable;
  readonly authKeyStoreTable: ITable;
  readonly userPoolIssuer: string;
  readonly allowedOrigins?: string[];
  readonly jwtAlgorithms?: string[];

  /** Pre-deployed Lambda@Edge version (us-east-1). */
  readonly blobAuthorizerVersion: lambda.IVersion;

  /** Optional custom domain name for the CDN distribution (e.g., cdn.example.com). */
  readonly domainName?: string;

  /** Optional us-east-1 ACM certificate for the custom domain name. */
  readonly certificate?: acm.ICertificate;
}

export class Cdn extends Construct {
  public readonly distribution: cloudfront.Distribution;
  public readonly host: string;
  public readonly distributionId: string;

  constructor(scope: Construct, id: string, props: CdnProps) {
    super(scope, id);

    const responseHeadersPolicy = props.allowedOrigins && props.allowedOrigins.length > 0
      ? new cloudfront.ResponseHeadersPolicy(this, 'blob-response-headers-policy', {
        comment: 'CORS policy for email blob downloads',
        corsBehavior: {
          accessControlAllowOrigins: props.allowedOrigins,
          accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
          accessControlAllowHeaders: ['Authorization', 'Content-Type'],
          accessControlAllowCredentials: true,
          accessControlMaxAge: cdk.Duration.hours(1),
          originOverride: true,
        },
      })
      : undefined;

    // Create custom origin with configuration headers
    // (Lambda@Edge doesn't support environment variables)
    // Use OAC (Origin Access Control) instead of the deprecated OAI (S3Origin).
    // The blob-store bucket lives in a separate MailboxDataStack and is imported here as
    // an IBucket; CDK's grantRead on an imported bucket is a no-op for the bucket resource
    // policy. The s3:GetObject grant for cloudfront.amazonaws.com is therefore placed
    // directly on the owned BlobStore bucket (see resources/blob-store.ts).
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(props.blobStore, {
      customHeaders: {
        'x-config-table': props.configTable.tableName,
        'x-auth-key-store-table': props.authKeyStoreTable.tableName,
        'x-region': cdk.Stack.of(this).region,
        // Configurable allowlist for JWT verification (Edge has no env vars)
        'x-jwt-algorithms': (props.jwtAlgorithms && props.jwtAlgorithms.length > 0) ? props.jwtAlgorithms.join(',') : 'RS256',
        // Policy-driven auth (audiences + required group) for JMAP downloads
        'x-auth-policy-name': 'JMAP_API',
      },
    });

    // CloudFront distribution with Lambda@Edge authorization
    this.distribution = new cloudfront.Distribution(this, 'blob-distribution', {
      comment: 'CDN for email blob downloads with Lambda@Edge auth',
      domainNames: props.domainName && props.certificate ? [props.domainName] : undefined,
      certificate: props.domainName && props.certificate ? props.certificate : undefined,
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: new cloudfront.CachePolicy(this, 'blob-cache-policy', {
          comment: 'Cache policy for email blobs with auth',
          defaultTtl: cdk.Duration.hours(24),
          maxTtl: cdk.Duration.days(365),
          minTtl: cdk.Duration.seconds(0),
          headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Authorization'),
          queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
          cookieBehavior: cloudfront.CacheCookieBehavior.none(),
          enableAcceptEncodingGzip: true,
          enableAcceptEncodingBrotli: true,
        }),
        responseHeadersPolicy,
        // Lambda@Edge runs at viewer-request (before cache lookup)
        edgeLambdas: [
          {
            functionVersion: props.blobAuthorizerVersion,
            eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
          },
        ],
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US, Canada, Europe
    });

    this.host = `https://${props.domainName && props.certificate ? props.domainName : this.distribution.distributionDomainName}`;
    this.distributionId = this.distribution.distributionId;
  }
}