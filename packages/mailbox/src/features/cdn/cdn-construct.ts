import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import type { IDataTable } from '../../data/data-tables';
import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import type { IAuthKeyStoreTable } from '../auth-key-store/auth-key-store-table';

/** What the CDN needs: the blob bucket it fronts, the Lambda@Edge authorizer, and the configuration it hands that authorizer. */
export interface CdnProps {
  readonly blobStore: IBucket;
  readonly configTable: IDataTable;
  readonly authKeyStoreTable: IAuthKeyStoreTable;
  readonly userPoolIssuer: string;

  /** Origins allowed to download cross-origin. Unset or empty adds no CORS response headers policy. */
  readonly allowedOrigins?: string[];

  /** JWT algorithms the authorizer accepts. Unset or empty means RS256 only. */
  readonly jwtAlgorithms?: string[];

  /** Pre-deployed Lambda@Edge version (us-east-1). */
  readonly jmapBlobDownloadVersion: lambda.IVersion;

  /** Custom domain name for the distribution (e.g., cdn.example.com). Applies only together with `certificate`. */
  readonly domainName?: string;

  /** us-east-1 ACM certificate for `domainName`. Applies only together with `domainName`. */
  readonly certificate?: acm.ICertificate;
}

/** A custom domain with the certificate that covers it. */
interface CustomDomain {
  readonly name: string;
  readonly certificate: acm.ICertificate;
}

/**
 * CloudFront distribution in front of the email blob bucket, with a Lambda@Edge authorizer at origin-request.
 * The authorizer cannot read environment variables, so this construct hands it its configuration as custom
 * headers on the S3 origin. Not responsible for the bucket's own policy: the bucket is imported here as an `IBucket`.
 */
export class Cdn extends Construct {
  public readonly distribution: cloudfront.Distribution;
  public readonly host: string;
  public readonly distributionId: string;

  constructor(scope: Construct, id: string, props: CdnProps) {
    super(scope, id);

    const customDomain = this.customDomainOf(props);

    this.distribution = this.createDistribution(props, customDomain);
    cdk.Tags.of(this.distribution).add(ServerlessInboxTagKeys.autoUpdateType, 'none');

    this.host = `https://${customDomain ? customDomain.name : this.distribution.distributionDomainName}`;
    this.distributionId = this.distribution.distributionId;
  }

  private customDomainOf(props: CdnProps): CustomDomain | undefined {
    if (!props.domainName || !props.certificate) {
      return undefined;
    }
    return { name: props.domainName, certificate: props.certificate };
  }

  private createDistribution(props: CdnProps, customDomain: CustomDomain | undefined): cloudfront.Distribution {
    return new cloudfront.Distribution(this, 'blob-distribution', {
      comment: 'CDN for email blob downloads with Lambda@Edge auth',
      domainNames: customDomain ? [customDomain.name] : undefined,
      certificate: customDomain?.certificate,
      defaultBehavior: {
        origin: this.createBlobOrigin(props),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: this.createCachePolicy(),
        responseHeadersPolicy: this.createResponseHeadersPolicy(props.allowedOrigins),
        edgeLambdas: [
          {
            functionVersion: props.jmapBlobDownloadVersion,
            eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
          },
        ],
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
  }

  /**
   * The bucket origin through Origin Access Control, carrying the authorizer's configuration as custom headers
   * (Lambda@Edge supports no environment variables). The bucket is an imported `IBucket`, so CDK's `grantRead`
   * adds nothing to the bucket's resource policy.
   */
  private createBlobOrigin(props: CdnProps): cloudfront.IOrigin {
    return origins.S3BucketOrigin.withOriginAccessControl(props.blobStore, {
      customHeaders: {
        'x-config-table': props.configTable.tableName,
        'x-auth-key-store-table': props.authKeyStoreTable.tableName,
        'x-region': cdk.Stack.of(this).region,
        'x-jwt-algorithms': this.jwtAlgorithmsHeader(props.jwtAlgorithms),
        'x-auth-policy-name': 'JMAP_API',
      },
    });
  }

  private jwtAlgorithmsHeader(jwtAlgorithms: string[] | undefined): string {
    return jwtAlgorithms && jwtAlgorithms.length > 0 ? jwtAlgorithms.join(',') : 'RS256';
  }

  private createCachePolicy(): cloudfront.CachePolicy {
    return new cloudfront.CachePolicy(this, 'blob-cache-policy', {
      comment: 'Cache policy for email blobs with auth',
      defaultTtl: cdk.Duration.hours(24),
      maxTtl: cdk.Duration.days(365),
      minTtl: cdk.Duration.seconds(0),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Authorization'),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });
  }

  private createResponseHeadersPolicy(allowedOrigins: string[] | undefined): cloudfront.ResponseHeadersPolicy | undefined {
    if (!allowedOrigins || allowedOrigins.length === 0) {
      return undefined;
    }
    return new cloudfront.ResponseHeadersPolicy(this, 'blob-response-headers-policy', {
      comment: 'CORS policy for email blob downloads',
      corsBehavior: {
        accessControlAllowOrigins: allowedOrigins,
        accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
        accessControlAllowHeaders: ['Authorization', 'Content-Type'],
        accessControlAllowCredentials: true,
        accessControlMaxAge: cdk.Duration.hours(1),
        originOverride: true,
      },
    });
  }
}
