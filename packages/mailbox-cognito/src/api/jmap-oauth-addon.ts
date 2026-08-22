import { Construct } from 'constructs';
import { HttpApi, HttpMethod, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUrlIntegration, HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { StaticContentDeployer, StaticContentSource, PublicStaticAssetsBucket } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { IJmapApiAddon } from '@serverlessinbox/mailbox';
import { MailboxUserPool } from '../auth/mailbox-user-pool';
import { JmapOAuthDcrLambda } from '../lambdas/jmap-oauth-dcr';

/** RFC 7591 Dynamic Client Registration path, mounted on the JMAP API's HttpApi. */
const REGISTRATION_PATH = '/oauth/register';

export interface JmapOAuthAddonProps {
  /** The Cognito user pool providing OAuth. */
  readonly pool: MailboxUserPool;
  /** Artifact resolver for provisioning Lambda functions. */
  readonly artifactResolver: ICdkArtifactEngine;
  /** Base URL of the JMAP API (where well-known docs are mounted). */
  readonly apiBaseUrl: string;
  /** The `identity-provisioner` Lambda, invoked by the DCR route to provision new clients. */
  readonly identityProvisionerFunction: IFunction;
  /**
   * Enable RFC 7591 Dynamic Client Registration (`POST /oauth/register`) and the
   * `registration_endpoint` field in the discovery document.
   * @default false
   */
  readonly enableDynamicClientRegistration?: boolean;
}

/**
 * Mounts OIDC discovery endpoints for the JMAP API.
 *
 * Routes:
 * - `GET /.well-known/openid-configuration` (static S3)
 * - `POST /oauth/register` (RFC 7591 DCR, Lambda-backed, no authorizer) — only when
 *   `enableDynamicClientRegistration` is true.
 *
 * Well-known documents are served via direct S3 proxy with no Lambda invocation.
 * The openid-configuration document is hosted in the shared public-static-assets bucket.
 * RFC 9728 oauth-protected-resource is now owned and served by jmap-api core (not this addon).
 */
export class JmapOAuthAddon extends Construct implements IJmapApiAddon {
  private readonly bucket: IBucket;
  private readonly enableDynamicClientRegistration: boolean;
  private readonly dcrLambda?: JmapOAuthDcrLambda;

  constructor(scope: Construct, id: string, props: JmapOAuthAddonProps) {
    super(scope, id);

    this.enableDynamicClientRegistration = props.enableDynamicClientRegistration ?? false;

    if (this.enableDynamicClientRegistration) {
      this.dcrLambda = new JmapOAuthDcrLambda(this, 'dcr-lambda', {
        artifactResolver: props.artifactResolver,
        identityProvisionerFunction: props.identityProvisionerFunction,
        userPoolId: props.pool.userPoolId,
        userPoolArn: props.pool.userPool.userPoolArn,
      });
    }

    // Use the shared public-static-assets bucket (singleton, centrally managed)
    const bucket = PublicStaticAssetsBucket.getOrCreate(this, props.artifactResolver);

    // Build the openid-configuration document as synth-time JSON
    const openidConfigurationDoc = {
      issuer: props.pool.issuer,
      authorization_endpoint: props.pool.authorizationEndpoint,
      token_endpoint: props.pool.tokenEndpoint,
      userinfo_endpoint: `${props.pool.issuer}/oauth2/userInfo`,
      ...(this.enableDynamicClientRegistration
        ? { registration_endpoint: `${props.apiBaseUrl}${REGISTRATION_PATH}` }
        : {}),
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

    if (this.enableDynamicClientRegistration) {
      // POST /oauth/register — no authorizer, unauthenticated bootstrap endpoint (RFC 7591).
      const dcrIntegration = new HttpLambdaIntegration('dcr-integration', this.dcrLambda!);
      api.addRoutes({
        path: REGISTRATION_PATH,
        methods: [HttpMethod.POST],
        integration: dcrIntegration,
      });

      routeSettings[`POST ${REGISTRATION_PATH}`] = {
        throttlingBurstLimit: 5,
        throttlingRateLimit: 2,
      };
    }

    cfnStage.routeSettings = routeSettings;
  }
}
