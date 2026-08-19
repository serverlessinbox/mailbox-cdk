import { Construct } from 'constructs';
import { HttpApi, HttpMethod, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUrlIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { StaticContentDeployer, StaticContentSource, PublicStaticAssetsBucket } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { IJmapApiAddon } from '@serverlessinbox/mailbox';
import { MailboxUserPool } from '../auth/mailbox-user-pool';

export interface JmapOAuthAddonProps {
  /** The Cognito user pool providing OAuth. */
  readonly pool: MailboxUserPool;
  /** Artifact resolver for provisioning Lambda functions. */
  readonly artifactResolver: ICdkArtifactEngine;
  /** Base URL of the JMAP API (where well-known docs are mounted). */
  readonly apiBaseUrl: string;
}

/**
 * Mounts OIDC discovery endpoints for the JMAP API.
 *
 * Routes:
 * - `GET /.well-known/openid-configuration` (static S3)
 *
 * Well-known documents are served via direct S3 proxy with no Lambda invocation.
 * The openid-configuration document is hosted in the shared public-static-assets bucket.
 * RFC 9728 oauth-protected-resource is now owned and served by jmap-api core (not this addon).
 */
export class JmapOAuthAddon extends Construct implements IJmapApiAddon {
  constructor(scope: Construct, id: string, props: JmapOAuthAddonProps) {
    super(scope, id);

    // Use the shared public-static-assets bucket (singleton, centrally managed)
    const bucket = PublicStaticAssetsBucket.getOrCreate(this, props.artifactResolver);

    // Build the openid-configuration document as synth-time JSON
    const openidConfigurationDoc = {
      issuer: props.pool.issuer,
      authorization_endpoint: props.pool.authorizationEndpoint,
      token_endpoint: props.pool.tokenEndpoint,
      userinfo_endpoint: `${props.pool.issuer}/oauth2/userInfo`,
      scopes_supported: ['openid', 'email', 'profile', 'offline_access'],
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      claims_supported: ['sub', 'email', 'email_verified', 'name'],
      claim_types_supported: ['normal'],
      claims_parameter_supported: false,
      request_parameter_supported: false,
      request_uri_parameter_supported: false,
    };

    // Deploy openid-configuration document to the shared bucket using StaticContentDeployer
    const deployer = StaticContentDeployer.getOrCreate(this, props.artifactResolver);

    deployer.deploy(this, 'openid-config-v2', {
      targetBucket: bucket.bucketName,
      source: StaticContentSource.data(
        '.well-known/openid-configuration',
        JSON.stringify(openidConfigurationDoc),
        { contentType: 'application/json', cacheControl: 'public, max-age=3600' },
      ),
    });

    // Store for use in addRoutes
    this.bucket = bucket;
  }

  private bucket: any;

  addRoutes(api: HttpApi): void {
    // Static route for openid-configuration — direct S3 proxy, zero Lambda invocation
    const openidIntegration = new HttpUrlIntegration('openid-config', `https://${this.bucket.bucketRegionalDomainName}/.well-known/openid-configuration`);

    api.addRoutes({
      path: '/.well-known/openid-configuration',
      methods: [HttpMethod.GET],
      integration: openidIntegration,
    });

    // Apply per-route throttling via the L1 CfnStage (merge with any existing settings)
    const cfnStage = api.defaultStage!.node.defaultChild as CfnStage;
    const existingSettings = cfnStage.routeSettings as Record<string, any> || {};
    const routeSettings: Record<string, any> = { ...existingSettings };

    // GET well-known route: generous burst/rate (cached, cheap operation)
    routeSettings['GET /.well-known/openid-configuration'] = {
      throttlingBurstLimit: 20,
      throttlingRateLimit: 10,
    };

    cfnStage.routeSettings = routeSettings;
  }
}
