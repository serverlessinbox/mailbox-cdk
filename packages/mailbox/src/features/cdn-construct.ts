import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { INamedBucket } from '../utils/named-bucket';
import { INamedTable } from '../utils/named-table';

export interface CdnProps {
  emailBucket: INamedBucket;
  itemTable: INamedTable;
  configTable: INamedTable;
  jwkCacheTable: INamedTable;
  userPoolIssuer: string;
  allowedOrigins?: string[];
  jwtAlgorithms?: string[];

  blobHmacKey: string;

  /** Pre-deployed Lambda@Edge version (us-east-1). */
  blobAuthorizerVersion: lambda.IVersion;

  /** Optional custom domain name for the CDN distribution (e.g., cdn.example.com). */
  domainName?: string;

  /** Optional us-east-1 ACM certificate for the custom domain name. */
  certificate?: acm.ICertificate;
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
    const s3Origin = new origins.S3Origin(props.emailBucket, {
      customHeaders: {
        'x-table-name': props.itemTable.tableName,
        'x-config-table': props.configTable.tableName,
        'x-jwk-cache-table': props.jwkCacheTable.tableName,
        'x-region': cdk.Stack.of(this).region,
        // Configurable allowlist for JWT verification (Edge has no env vars)
        'x-jwt-algorithms': (props.jwtAlgorithms && props.jwtAlgorithms.length > 0) ? props.jwtAlgorithms.join(',') : 'RS256',
        // Policy-driven auth (audiences + required group) for JMAP downloads
        'x-auth-policy-name': 'JMAP_API',
        'x-hmac-secret': props.blobHmacKey,
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