import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import { INamedBucket } from '../utils/named-bucket';
import { INamedTable } from '../utils/named-table';
import { createEdgeFunction } from '../utils/edge-function';
import * as path from 'path';

export interface CdnProps {
  emailBucket: INamedBucket;
  itemTable: INamedTable;
  configTable: INamedTable;
  jwkCacheTable: INamedTable;
  userPoolIssuer: string;
  allowedOrigins: string[];
}

export class Cdn extends Construct {
  public readonly distribution: cloudfront.Distribution;
  public readonly host: string;
  public readonly distributionId: string;

  constructor(scope: Construct, id: string, props: CdnProps) {
    super(scope, id);

    // Lambda@Edge function for blob authorization
    // Verifies JWT token and checks user access via DynamoDB
    const blobAuthFunction = createEdgeFunction(this, 'BlobAuthEdge', {
      entry: path.join(__dirname, 'edge-functions/blob-authorizer/index.ts'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
    });

    // Grant DynamoDB read access
    props.itemTable.grantReadData(blobAuthFunction);
    props.configTable.grantReadData(blobAuthFunction);
    props.jwkCacheTable.grantReadData(blobAuthFunction);

    // Create custom origin with configuration headers
    // (Lambda@Edge doesn't support environment variables)
    const s3Origin = new origins.S3Origin(props.emailBucket, {
      customHeaders: {
        'x-table-name': props.itemTable.tableName,
        'x-config-table': props.configTable.tableName,
        'x-jwk-cache-table': props.jwkCacheTable.tableName,
        'x-region': cdk.Stack.of(this).region,
        'x-issuer': props.userPoolIssuer,
      },
    });

    // CloudFront distribution with Lambda@Edge authorization
    this.distribution = new cloudfront.Distribution(this, 'BlobDistribution', {
      comment: 'CDN for email blob downloads with Lambda@Edge auth',
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: new cloudfront.CachePolicy(this, 'BlobCachePolicy', {
          cachePolicyName: 'MailboxBlobCachePolicy',
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
        responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(this, 'BlobResponseHeadersPolicy', {
          responseHeadersPolicyName: 'MailboxBlobResponseHeaders',
          comment: 'CORS policy for email blob downloads',
          corsBehavior: {
            accessControlAllowOrigins: props.allowedOrigins,
            accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
            accessControlAllowHeaders: ['Authorization', 'Content-Type'],
            accessControlAllowCredentials: true,
            accessControlMaxAge: cdk.Duration.hours(1),
            originOverride: true,
          },
        }),
        // Lambda@Edge runs at viewer-request (before cache lookup)
        edgeLambdas: [
          {
            functionVersion: blobAuthFunction.currentVersion,
            eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
          },
        ],
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US, Canada, Europe
    });

    this.host = `https://${this.distribution.distributionDomainName}`;
    this.distributionId = this.distribution.distributionId;
  }
}