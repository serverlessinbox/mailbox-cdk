import {
  ComponentDescription,
  ServerlessInboxTagKeys,
  makePhysicalName,
} from '@serverlessinbox/mailbox-cdk-shared';
import * as acm                             from 'aws-cdk-lib/aws-certificatemanager';
import * as origins                         from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudfront                      from 'aws-cdk-lib/aws-cloudfront';
import * as lambda                          from 'aws-cdk-lib/aws-lambda';
import { IBucket }                          from 'aws-cdk-lib/aws-s3';
import * as cdk                             from 'aws-cdk-lib';
import { Construct }                        from 'constructs';

import type { IAuthKeyStoreTable }          from '../../resources/tables/auth-key-store-table';
import type { BlobDownloadOriginHeaders }   from '../../runtime/jmap-blob-download/cloudfront/origin-headers';

/** A custom domain with the us-east-1 ACM certificate that covers it. */
export interface CdnCustomDomain {
  readonly name:        string;
  readonly certificate: acm.ICertificate;
}

/** What the CDN needs: the blob bucket it fronts, the Lambda@Edge authorizer, and the configuration it hands that authorizer. */
export interface CdnProps {
  readonly blobStore:         IBucket;
  readonly authKeyStoreTable: IAuthKeyStoreTable;

  /** Origins allowed to download cross-origin. Unset or empty adds no CORS response headers policy. */
  readonly allowedOrigins?: string[];

  /** Pre-deployed Lambda@Edge version (us-east-1). */
  readonly jmapBlobDownloadVersion: lambda.IVersion;

  /** Serves the distribution on this domain. Unset keeps the CloudFront domain. */
  readonly customDomain?: CdnCustomDomain;
}

/**
 * CloudFront distribution in front of the email blob bucket, with a Lambda@Edge authorizer at origin-request.
 * The authorizer cannot read environment variables, so this construct hands it its configuration as custom
 * headers on the S3 origin. Not responsible for the bucket's own policy: the bucket is imported here as an `IBucket`.
 */
export class Cdn extends Construct {
  public readonly distribution: cloudfront.Distribution;
  public readonly host: string;

  constructor(scope: Construct, id: string, props: CdnProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'CloudFront CDN serving authenticated blob and attachment downloads, authorized at the edge.');

    this.distribution = this.createDistribution(props);
    cdk.Tags.of(this.distribution).add(ServerlessInboxTagKeys.autoUpdateType, 'none');

    this.host = `https://${props.customDomain ? props.customDomain.name : this.distribution.distributionDomainName}`;
  }

  private createDistribution(props: CdnProps): cloudfront.Distribution {
    return new cloudfront.Distribution(this, 'blob-distribution', {
      comment:         'CDN for email blob downloads with Lambda@Edge auth',
      domainNames:     props.customDomain ? [props.customDomain.name] : undefined,
      certificate:     props.customDomain?.certificate,
      defaultBehavior: {
        origin:                this.createBlobOrigin(props),
        viewerProtocolPolicy:  cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods:        cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods:         cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress:              true,
        cachePolicy:           this.createCachePolicy(),
        responseHeadersPolicy: this.createResponseHeadersPolicy(props.allowedOrigins),
        edgeLambdas:           [
          {
            functionVersion: props.jmapBlobDownloadVersion,
            eventType:       cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
          },
        ],
      },
      priceClass:      cloudfront.PriceClass.PRICE_CLASS_100,
    });
  }

  /**
   * The bucket origin through Origin Access Control, carrying the authorizer's configuration as custom headers
   * (Lambda@Edge supports no environment variables). The bucket is an imported `IBucket`, so CDK's `grantRead`
   * adds nothing to the bucket's resource policy.
   */
  private createBlobOrigin(props: CdnProps): cloudfront.IOrigin {
    const originAccessControl = new cloudfront.S3OriginAccessControl(this, 'blob-origin-access-control', {
      originAccessControlName: makePhysicalName(this, 'blob-origin-access-control', { maxLength: 64 }),
    });

    return origins.S3BucketOrigin.withOriginAccessControl(props.blobStore, {
      originAccessControl,
      customHeaders: this.authorizerHeaders(props),
    });
  }

  private authorizerHeaders(props: CdnProps): BlobDownloadOriginHeaders {
    return {
      'x-auth-key-store-table': props.authKeyStoreTable.tableName,
      'x-region':               cdk.Aws.REGION,
      'x-jwt-algorithms':       'RS256',
    };
  }

  private createCachePolicy(): cloudfront.CachePolicy {
    return new cloudfront.CachePolicy(this, 'blob-cache-policy', {
      comment:                    'Cache policy for email blobs with auth',
      defaultTtl:                 cdk.Duration.hours(24),
      maxTtl:                     cdk.Duration.days(365),
      minTtl:                     cdk.Duration.seconds(0),
      headerBehavior:             cloudfront.CacheHeaderBehavior.allowList('Authorization'),
      queryStringBehavior:        cloudfront.CacheQueryStringBehavior.all(),
      cookieBehavior:             cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip:   true,
      enableAcceptEncodingBrotli: true,
    });
  }

  private createResponseHeadersPolicy(allowedOrigins: string[] | undefined): cloudfront.ResponseHeadersPolicy | undefined {
    if (!allowedOrigins || allowedOrigins.length === 0) {
      return undefined;
    }
    return new cloudfront.ResponseHeadersPolicy(this, 'blob-response-headers-policy', {
      comment:      'CORS policy for email blob downloads',
      corsBehavior: {
        accessControlAllowOrigins:     allowedOrigins,
        accessControlAllowMethods:     ['GET', 'HEAD', 'OPTIONS'],
        accessControlAllowHeaders:     ['Authorization', 'Content-Type'],
        accessControlAllowCredentials: true,
        accessControlMaxAge:           cdk.Duration.hours(1),
        originOverride:                true,
      },
    });
  }
}
