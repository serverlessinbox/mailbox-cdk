import { Construct } from "constructs";
import { Bucket, BlockPublicAccess } from "aws-cdk-lib/aws-s3";
import { Distribution, OriginAccessIdentity, ViewerProtocolPolicy, CachePolicy, ResponseHeadersPolicy, HeadersFrameOption, HeadersReferrerPolicy, AllowedMethods, OriginRequestPolicy, Function as CloudFrontFunction, FunctionCode, FunctionEventType } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Fn, RemovalPolicy, Duration } from "aws-cdk-lib";
import { IdpTokenExchangeApi } from "./idp-token-exchange/api";
import { IArtifactResolver } from "../utils/artifact-resolver";
import { IAuthConfig } from "../auth/IAuthConfig";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { createArtifactResolverFromContext } from "../utils/artifact-context";

export interface AdminUiProps {
  /**
   * Domain name for the CloudFront distribution (e.g., admin.example.com)
   */
  domainName: string;

  /**
   * Optional ACM certificate for `domainName`.
   * When provided, the CloudFront distribution will be configured with an alternate domain name.
   */
  certificate?: acm.ICertificate;

  authConfig: IAuthConfig

  /**
   * Shared config table used by token exchange API.
   */
  configTable: ITable;

  /**
   * Content Security Policy header value
   * Generated at build time with script/style hashes
   * Example: "default-src 'none'; script-src 'self' sha256-abc123...; ..."
   * Optional - if not provided, a basic CSP will be used
   */
  cspPolicy?: string;
}

/**
 * Admin UI Module
 *
 * Creates infrastructure for hosting the admin dashboard:
 * - S3 bucket for storing static UI files
 * - CloudFront distribution for global CDN delivery
 * - Origin Access Identity for secure S3 access
 * - Routes /auth/* requests to OAuth API
 * - CSP security headers
 *
 * Example:
 * ```typescript
 * const oauthHandler = new OAuthHandler(this, 'oauth-handler', {...});
 * 
 * const adminUi = new AdminUi(this, 'admin-ui', {
 *   domainName: 'admin.example.com',
 *   oauthApiUrl: oauthHandler.apiUrl + '/admin/auth',
 * });
 *
 * console.log(`Admin UI available at: ${adminUi.distributionDomainName}`);
 * ```
 */
export class AdminUi extends Construct {
  readonly bucket: Bucket;
  readonly distribution: Distribution;
  readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: AdminUiProps) {
    super(scope, id);

    const artifactResolver = createArtifactResolverFromContext(this);
    

    // Create S3 bucket for UI assets
    this.bucket = new Bucket(this, 'ui-bucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create Origin Access Identity for CloudFront to access S3
    const originAccessIdentity = new OriginAccessIdentity(this, 'oai', {
      comment: `OAI for Admin UI distribution`,
    });

    // Grant CloudFront access to S3 bucket
    this.bucket.grantRead(originAccessIdentity);

    // Create CloudFront distribution
    this.distribution = new Distribution(this, 'distribution', {
      defaultRootObject: 'index.html',
      domainNames: props.certificate ? [props.domainName] : undefined,
      certificate: props.certificate,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessIdentity(this.bucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        // responseHeadersPolicy: this.defaultResponseHeadersPolicy(props.cspPolicy),
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

    this.addAuthBehaviror(this.distribution, artifactResolver, props.configTable);

    this.distributionDomainName = props.certificate
      ? props.domainName
      : this.distribution.distributionDomainName;
  }

  addAuthBehaviror(distribution: Distribution, artifactResolver: IArtifactResolver, configTable: ITable) {
    const tokenExchange = new IdpTokenExchangeApi(this, 'oauth-api', {
      artifactResolver,
      configTable,
      authPolicyName: 'ADMIN_API',
      oauthClientName: 'ADMIN_UI',
    });


    // Parse OAuth API URL to create origin
    // apiEndpoint format: https://abc123.execute-api.eu-west-1.amazonaws.com/
    // We need to extract just the hostname: abc123.execute-api.eu-west-1.amazonaws.com
    const hostname = Fn.select(1, Fn.split('://', tokenExchange.api.apiEndpoint));
    const oauthOrigin = new HttpOrigin(hostname, {
      originPath: '',
    });

    // Create CloudFront function to add X-Forwarded-Host header
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
        }
      ],
      compress: false,
      allowedMethods: AllowedMethods.ALLOW_ALL,
    });

  }

  defaultResponseHeadersPolicy(cspPolicy?: string): ResponseHeadersPolicy {
    // Create Response Headers Policy with CSP and security headers
    const defaultCspPolicy = [
      "default-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src https: 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "form-action 'none'",
      "base-uri 'none'",
      "upgrade-insecure-requests",
      "frame-ancestors 'none'",
    ].join('; ');

    const responseHeadersPolicy = new ResponseHeadersPolicy(this, 'security-headers-policy', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: cspPolicy || defaultCspPolicy,
        },
        contentTypeOptions: {
          override: true,
        },
        frameOptions: {
          frameOption: HeadersFrameOption.DENY,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.seconds(31536000),
          includeSubdomains: true,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'X-XSS-Protection',
            value: '1; mode=block',
            override: true,
          },
        ],
      },
    });
    return responseHeadersPolicy;
  }
}
