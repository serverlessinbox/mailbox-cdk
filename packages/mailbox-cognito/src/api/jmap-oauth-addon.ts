import { Construct, IConstruct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { HttpApi, HttpMethod, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUrlIntegration, HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { StaticContentDeployer, StaticContentSource, PublicStaticAssetsBucket } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { IJmapApiAddon } from '@serverlessinbox/mailbox';
import { MailboxUserPool, DynamicClientRegistrationMode } from '../auth/mailbox-user-pool';
import { JmapOAuthDcrLambda } from '../lambdas/jmap-oauth-dcr';

/** RFC 7591 Dynamic Client Registration path, mounted on the JMAP API's HttpApi. */
const REGISTRATION_PATH = '/oauth/register';

/**
 * Aspect that gates all CfnResource children of a construct onto a condition, so the whole
 * subtree "produces zero resources" when the condition is false.
 *
 * Local copy of the identical pattern in `mailbox`'s
 * `src/artifacts/resolvers/auto-updater.ts` (`GateOnConditionAspect`). Not shared across
 * packages: `mailbox-cdk-shared` does not yet expose a CDK-aspect helper, and adding one there
 * (or exporting the `mailbox` copy) would be a new public export made unilaterally rather than
 * owner-approved — so this is intentionally duplicated rather than shared.
 */
class GateOnConditionAspect implements cdk.IAspect {
  constructor(private readonly condition: cdk.CfnCondition) {}

  visit(node: IConstruct): void {
    // Skip the condition itself (a condition cannot carry a condition)
    if (node === this.condition) return;

    // Gate every CfnResource in the subtree
    if (cdk.CfnResource.isCfnResource(node)) {
      node.cfnOptions.condition = this.condition;
    }
  }
}

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
   * Dynamic Client Registration mode. Defaults to DISABLED.
   *
   * To drive this from a CloudFormation parameter, cast the parameter's `valueAsString`
   * to this enum — the value stays an unresolved token until deploy and is gated by a
   * CfnCondition rather than evaluated at synth.
   * @default DynamicClientRegistrationMode.DISABLED
   */
  readonly dynamicClientRegistration?: DynamicClientRegistrationMode;
}

/**
 * Mounts OIDC discovery endpoints for the JMAP API.
 *
 * Routes:
 * - `GET /.well-known/openid-configuration` (static S3)
 * - `POST /oauth/register` (RFC 7591 DCR, Lambda-backed, no authorizer) — only mounted at all when
 *   `dynamicClientRegistration` is `'enabled'` or an unresolved CFN-parameter token. When it's the
 *   literal `'disabled'` (or omitted), DCR is fully off at synth: no Lambda, no route, no
 *   `CfnCondition` — a clean template with no dead conditional machinery. Otherwise every resource
 *   the DCR subtree adds (Lambda, role, policy, log group, API route, integration, invoke
 *   permission) carries a `Condition` derived from `dynamicClientRegistration`, so it produces zero
 *   live resources when a token resolves to disabled at deploy time.
 *
 * Well-known documents are served via direct S3 proxy with no Lambda invocation.
 * The openid-configuration document is hosted in the shared public-static-assets bucket. When DCR
 * is gated (enabled literal or token), its body is a `Fn::If` selecting between a
 * with-`registration_endpoint` and without-`registration_endpoint` variant of the same document,
 * keyed off the same condition. When DCR is fully disabled, the body is the plain
 * without-`registration_endpoint` document — no `Fn::If`.
 * RFC 9728 oauth-protected-resource is now owned and served by jmap-api core (not this addon).
 */
export class JmapOAuthAddon extends Construct implements IJmapApiAddon {
  private readonly bucket: IBucket;
  private readonly dcrLambda?: JmapOAuthDcrLambda;
  private readonly registrationEnabled?: cdk.CfnCondition;

  constructor(scope: Construct, id: string, props: JmapOAuthAddonProps) {
    super(scope, id);

    const mode = props.dynamicClientRegistration ?? DynamicClientRegistrationMode.DISABLED;

    // A literal typo (or an invalid string cast through the enum) must fail loudly at synth; an
    // unresolved CFN-parameter token must pass through untouched (its value is only known at
    // deploy time).
    if (!cdk.Token.isUnresolved(mode) && !Object.values(DynamicClientRegistrationMode).includes(mode)) {
      throw new Error(`dynamicClientRegistration must be 'enabled' or 'disabled', got '${mode}'`);
    }

    // A literal DISABLED is the only value that turns DCR fully off at synth — a token string
    // never literally equals 'disabled', so both ENABLED and any token fall into the gated path.
    const dcrFullyDisabled = mode === DynamicClientRegistrationMode.DISABLED;

    if (!dcrFullyDisabled) {
      // Drives both the gated DCR subtree (Lambda/role/policy/route/integration/permission) and
      // the discovery document's registration_endpoint field. A literal or a CFN-parameter token
      // is resolved here, once, via a CfnCondition — see GateOnConditionAspect above.
      this.registrationEnabled = new cdk.CfnCondition(this, 'IsDcrEnabled', {
        expression: cdk.Fn.conditionEquals(mode, DynamicClientRegistrationMode.ENABLED),
      });

      // Constructed unconditionally: the DCR Lambda must exist in the template for the condition
      // to gate it. Its whole subtree (function, role, inline policy, log group) is gated below.
      this.dcrLambda = new JmapOAuthDcrLambda(this, 'dcr-lambda', {
        artifactResolver: props.artifactResolver,
        identityProvisionerFunction: props.identityProvisionerFunction,
        userPoolId: props.pool.userPoolId,
        userPoolArn: props.pool.userPool.userPoolArn,
      });
      cdk.Aspects.of(this.dcrLambda).add(new GateOnConditionAspect(this.registrationEnabled));
    }

    // Use the shared public-static-assets bucket (singleton, centrally managed)
    const bucket = PublicStaticAssetsBucket.getOrCreate(this, props.artifactResolver);

    // Build the openid-configuration document as synth-time JSON. A single builder keeps the
    // document's shape defined exactly once; only the presence of registration_endpoint varies
    // between the two branches selected by Fn::If below.
    const buildOpenidConfigurationDoc = (withRegistration: boolean) => ({
      issuer: props.pool.issuer,
      authorization_endpoint: props.pool.authorizationEndpoint,
      token_endpoint: props.pool.tokenEndpoint,
      userinfo_endpoint: `${props.pool.issuer}/oauth2/userInfo`,
      ...(withRegistration
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
    });

    // When DCR is gated (enabled literal or token): two complete serialized bodies (built from the
    // one shape above), selected at deploy time by the same condition that gates the DCR
    // resources — a single JSON key can't be conditionally inserted into an already-serialized
    // body, so the whole body is Fn::If-selected instead. When DCR is fully disabled at synth, skip
    // the conditional machinery entirely and emit the plain without-registration document.
    const openidConfigurationDocBody = this.registrationEnabled
      ? cdk.Fn.conditionIf(
          this.registrationEnabled.logicalId,
          JSON.stringify(buildOpenidConfigurationDoc(true)),
          JSON.stringify(buildOpenidConfigurationDoc(false)),
        ).toString()
      : JSON.stringify(buildOpenidConfigurationDoc(false));

    // Deploy openid-configuration document to the shared bucket using StaticContentDeployer
    const deployer = StaticContentDeployer.getOrCreate(this, props.artifactResolver);

    deployer.deploy(this, 'openid-config-v2', {
      targetBucket: bucket.bucketName,
      source: StaticContentSource.data(
        '.well-known/openid-configuration',
        openidConfigurationDocBody,
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

    // POST /oauth/register — only mounted at all when DCR isn't fully disabled at synth (literal
    // 'disabled' means dcrLambda/registrationEnabled are both undefined and this block is skipped
    // entirely, producing a clean template with no dead conditional machinery). When mounted
    // (enabled literal or token), no authorizer — unauthenticated bootstrap endpoint (RFC 7591).
    // CfnRoute, CfnIntegration and the apigateway invoke CfnPermission are all synthesized as
    // children of the HttpRoute construct returned by addRoutes() (verified against aws-cdk-lib's
    // HttpRoute/HttpRouteIntegration/HttpLambdaIntegration sources), so gating that construct's
    // subtree gates all three.
    if (this.dcrLambda && this.registrationEnabled) {
      const registrationEnabled = this.registrationEnabled;
      const dcrIntegration = new HttpLambdaIntegration('dcr-integration', this.dcrLambda);
      const dcrRoutes = api.addRoutes({
        path: REGISTRATION_PATH,
        methods: [HttpMethod.POST],
        integration: dcrIntegration,
      });
      dcrRoutes.forEach((route) => cdk.Aspects.of(route).add(new GateOnConditionAspect(registrationEnabled)));

      // RouteSettings is a property map on the always-present CfnStage, not a separate resource,
      // so it can't carry its own Condition — omit the entry entirely when disabled via Fn::If +
      // NoValue.
      routeSettings[`POST ${REGISTRATION_PATH}`] = cdk.Fn.conditionIf(
        registrationEnabled.logicalId,
        { throttlingBurstLimit: 5, throttlingRateLimit: 2 },
        cdk.Aws.NO_VALUE,
      );
    }

    cfnStage.routeSettings = routeSettings;
  }
}
