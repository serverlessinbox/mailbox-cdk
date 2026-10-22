import type { IArtifactResolver }                                                                      from '@serverlessinbox/artifact-registry-cdk';
import { StaticContentDeployer, StaticContentSource, PublicStaticAssetsBucket, GateOnConditionAspect } from '@serverlessinbox/mailbox-cdk-shared';
import { IJmapApiAddon, IIdentityProvisioner }                                                         from '@serverlessinbox/mailbox';
import { HttpUrlIntegration, HttpLambdaIntegration }                                                   from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpApi, HttpMethod, HttpRoute, CfnStage }                                                    from 'aws-cdk-lib/aws-apigatewayv2';
import { IUserPool }                                                                                   from 'aws-cdk-lib/aws-cognito';
import { IBucket }                                                                                     from 'aws-cdk-lib/aws-s3';
import * as cdk                                                                                        from 'aws-cdk-lib';
import { Construct }                                                                                   from 'constructs';

import { JmapOAuthDcrLambda }                                                                          from './resources/lambdas/jmap-oauth-dcr-lambda';
import { DynamicClientRegistrationMode }                                                               from './user-pool/dynamic-client-registration-mode';

/** RFC 7591 Dynamic Client Registration path, mounted on the JMAP API's HttpApi. */
const REGISTRATION_PATH      = '/oauth/register';
const REGISTRATION_ROUTE_KEY = `POST ${REGISTRATION_PATH}`;

const OPENID_CONFIGURATION_PATH      = '/.well-known/openid-configuration';
const OPENID_CONFIGURATION_ROUTE_KEY = `GET ${OPENID_CONFIGURATION_PATH}`;

/**
 * The throttling of one route, in the form CloudFormation reads. The keys are PascalCase because the L1 `CfnStage`
 * passes `routeSettings` through unmapped: camelCase keys fail the deploy with `Unrecognized field
 * "throttlingBurstLimit" ... not marked as ignorable`.
 */
interface RouteThrottle {
  readonly ThrottlingBurstLimit: number;
  readonly ThrottlingRateLimit: number;
}

/** The throttling of each route of a stage, by route key. A value is a token when the route is gated on a condition. */
type RouteSettings = Record<string, RouteThrottle | cdk.IResolvable>;

const DISCOVERY_THROTTLE: RouteThrottle    = { ThrottlingBurstLimit: 20, ThrottlingRateLimit: 10 };
const REGISTRATION_THROTTLE: RouteThrottle = { ThrottlingBurstLimit: 5, ThrottlingRateLimit: 2 };

/** What the addon needs from the Cognito user pool providing OAuth: its identity and its OAuth endpoints. */
export interface JmapOAuthPool {
  readonly userPool: IUserPool;
  readonly userPoolId: string;
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
}

export interface JmapOAuthAddonProps {
  /** The Cognito user pool providing OAuth. */
  readonly pool: JmapOAuthPool;
  /** Artifact resolver for provisioning Lambda functions. */
  readonly artifactResolver: IArtifactResolver;
  /** Base URL of the JMAP API (where well-known docs are mounted). */
  readonly apiBaseUrl: string;
  /** The `identity-provisioner` Lambda, invoked by the DCR route to provision new clients. */
  readonly identityProvisioner: IIdentityProvisioner;
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
 */
export class JmapOAuthAddon extends Construct implements IJmapApiAddon {
  private readonly bucket: IBucket;
  private readonly dcrLambda?: JmapOAuthDcrLambda;
  private readonly registrationEnabled?: cdk.CfnCondition;

  constructor(scope: Construct, id: string, props: JmapOAuthAddonProps) {
    super(scope, id);

    const mode = props.dynamicClientRegistration ?? DynamicClientRegistrationMode.DISABLED;
    this.requireValidMode(mode);

    // Only a literal DISABLED turns DCR off at synth: a token never equals 'disabled', so ENABLED and any token take the gated path.
    if (mode !== DynamicClientRegistrationMode.DISABLED) {
      this.registrationEnabled = new cdk.CfnCondition(this, 'IsDcrEnabled', {
        expression: cdk.Fn.conditionEquals(mode, DynamicClientRegistrationMode.ENABLED),
      });

      // Constructed unconditionally: the Lambda must exist in the template for the condition to gate it.
      this.dcrLambda = new JmapOAuthDcrLambda(this, 'dcr-lambda', {
        artifactResolver: props.artifactResolver,
        identityProvisioner: props.identityProvisioner,
        userPoolId: props.pool.userPoolId,
        userPoolArn: props.pool.userPool.userPoolArn,
      });
      cdk.Aspects.of(this.dcrLambda).add(new GateOnConditionAspect(this.registrationEnabled));
    }

    this.bucket = PublicStaticAssetsBucket.getOrCreate(this, props.artifactResolver);

    // A serialized body cannot take a conditional key, so a gated document is two complete bodies selected by Fn::If.
    const openidConfigurationBody = this.registrationEnabled
      ? cdk.Fn.conditionIf(
          this.registrationEnabled.logicalId,
          this.openidConfigurationBody(props, true),
          this.openidConfigurationBody(props, false),
        ).toString()
      : this.openidConfigurationBody(props, false);

    StaticContentDeployer.getOrCreate(this, props.artifactResolver).deploy(this, 'openid-config', {
      targetBucket: this.bucket,
      source: StaticContentSource.data(
        '.well-known/openid-configuration',
        openidConfigurationBody,
        { contentType: 'application/json', cacheControl: 'public, max-age=3600' },
      ),
    });
  }

  public addRoutes(api: HttpApi): void {
    const stage            = this.defaultStageOf(api);
    const existingSettings = this.routeSettingsOf(stage);

    const discoverySettings    = this.addDiscoveryRoute(api, stage);
    const registrationSettings = this.addRegistrationRoute(api, stage);

    stage.routeSettings = { ...existingSettings, ...discoverySettings, ...registrationSettings };
  }

  // A literal that is not a mode fails at synth; an unresolved CFN-parameter token passes, as its value is known only at deploy time.
  private requireValidMode(mode: DynamicClientRegistrationMode): void {
    if (!cdk.Token.isUnresolved(mode) && !Object.values(DynamicClientRegistrationMode).includes(mode)) {
      throw new Error(`dynamicClientRegistration must be 'enabled' or 'disabled', got '${mode}'`);
    }
  }

  private openidConfigurationBody(props: JmapOAuthAddonProps, withRegistration: boolean): string {
    return JSON.stringify({
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
  }

  /** Mounts the discovery document as a direct S3 proxy, with no Lambda invocation. */
  private addDiscoveryRoute(api: HttpApi, stage: CfnStage): RouteSettings {
    const integration = new HttpUrlIntegration('openid-config', `https://${this.bucket.bucketRegionalDomainName}${OPENID_CONFIGURATION_PATH}`);
    const routes      = api.addRoutes({
      path: OPENID_CONFIGURATION_PATH,
      methods: [HttpMethod.GET],
      integration,
    });
    routes.forEach((route) => this.makeStageDependOn(stage, route));

    return { [OPENID_CONFIGURATION_ROUTE_KEY]: DISCOVERY_THROTTLE };
  }

  /**
   * Mounts the registration route, unauthenticated as RFC 7591 bootstrap requires, when DCR is not off at synth.
   * The route's `CfnRoute`, `CfnIntegration` and invoke `CfnPermission` are all children of the `HttpRoute`, so
   * gating the route gates all three. Route settings are a property of the always-present stage and cannot carry
   * a `Condition`, so the entry is selected with `Fn::If` and `NoValue`.
   */
  private addRegistrationRoute(api: HttpApi, stage: CfnStage): RouteSettings {
    if (!this.dcrLambda || !this.registrationEnabled) {
      return {};
    }

    const registrationEnabled = this.registrationEnabled;
    const routes              = api.addRoutes({
      path: REGISTRATION_PATH,
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('dcr-integration', this.dcrLambda),
    });
    routes.forEach((route) => cdk.Aspects.of(route).add(new GateOnConditionAspect(registrationEnabled)));
    routes.forEach((route) => this.makeStageDependOn(stage, route));

    return {
      [REGISTRATION_ROUTE_KEY]: cdk.Fn.conditionIf(registrationEnabled.logicalId, REGISTRATION_THROTTLE, cdk.Aws.NO_VALUE),
    };
  }

  // API Gateway rejects a route setting whose route does not exist yet ("Unable to find Route by key POST /oauth/register
  // within the provided RouteSettings"), and CloudFormation updates the stage before it creates the route unless the stage depends on it.
  private makeStageDependOn(stage: CfnStage, route: HttpRoute): void {
    const routeResource = route.node.defaultChild;
    if (!(routeResource instanceof cdk.CfnResource)) {
      throw new Error(`The route ${route.node.path} has no CloudFormation resource for the stage to depend on`);
    }
    stage.addDependency(routeResource);
  }

  // cast: the L1 CfnStage types routeSettings as any.
  private routeSettingsOf(stage: CfnStage): RouteSettings {
    return { ...(stage.routeSettings as RouteSettings | undefined) };
  }

  private defaultStageOf(api: HttpApi): CfnStage {
    const stage = api.defaultStage?.node.defaultChild;
    if (!(stage instanceof CfnStage)) {
      throw new Error('The HTTP API has no default stage to carry the route settings');
    }
    return stage;
  }
}
