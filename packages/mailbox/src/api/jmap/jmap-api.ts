import type { IArtifactResolver }                                               from '@serverlessinbox/artifact-registry-cdk';
import { PublicStaticAssetsBucket, StaticContentDeployer, StaticContentSource } from '@serverlessinbox/mailbox-cdk-shared';
import { HttpLambdaAuthorizer }                                                 from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration, HttpUrlIntegration }                            from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  ApiMapping,
  CorsHttpMethod,
  CfnStage,
  DomainName,
  EndpointType,
  HttpApi,
  HttpMethod,
  IHttpApi,
  SecurityPolicy,
} from 'aws-cdk-lib/aws-apigatewayv2';
import * as acm                                                           from 'aws-cdk-lib/aws-certificatemanager';
import type { IFunction }                                                 from 'aws-cdk-lib/aws-lambda';
import { Duration, Aws, CfnResource }                                     from 'aws-cdk-lib';
import { Construct }                                                      from 'constructs';

import { IMailboxAuthProvider }                                           from '../../auth/types';
import type { IDataBlobStore }                                            from '../../resources/buckets/data-blob-store';
import type { IDataTable }                                                from '../../resources/tables/data-tables';
import type { IEmailSendingQueue }                                        from '../../resources/queues/email-sending-queue';
import type { IAuditEventsQueue }                                         from '../../resources/queues/audit-events-queue';
import type { IAuthKeyStoreTable }                                        from '../../resources/tables/auth-key-store-table';
import type { IIdentityProvisioner }                                      from '../../resources/lambdas/identity-provisioner-lambda';
import type { JmapOAuthHandlerConfig }                                    from '../../resources/lambdas/jmap-api-lambda';
import { ApiHandlerLambda }                                               from '../../resources/lambdas/jmap-api-lambda';
import { AuthorizerLambda }                                               from '../../resources/lambdas/authorizer-lambda';
import type { IJmapApiAddon }                                             from '../addons';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTargetWithUrl } from '../websocket/websocket';

/**
 * Inputs of {@link JMapApi}: the tables, queues and blob store its handler Lambda works on, the
 * addons that mount further routes, the optional custom domain and the optional OAuth issuer that
 * switches on the protected-resource metadata document.
 */
export interface JMapApiProps {
  readonly configTable: IDataTable;
  readonly itemTable: IDataTable;
  readonly changelogTable: IDataTable;
  readonly authKeyStoreTable: IAuthKeyStoreTable;
  readonly blobStore: IDataBlobStore;
  readonly emailSubmissionQueue: IEmailSendingQueue;
  readonly auditEventsQueue: IAuditEventsQueue;

  readonly cdnHost: string;
  /** Origins allowed by the API's CORS preflight. Without any, no CORS configuration is created. */
  readonly allowedOrigins?: string[];

  readonly artifactResolver: IArtifactResolver;
  readonly authProvider: IMailboxAuthProvider;

  /** Pre-constructed identity-provisioner function. Passed through to ApiHandlerLambda. */
  readonly identityProvisioner: IIdentityProvisioner;

  /** Optional custom domain name for this API (e.g. jmap.example.com). */
  readonly domainName?: string;

  /** ACM certificate for domainName (must be regional, in the same region as the stack/API). Required when domainName is set. */
  readonly certificate?: acm.ICertificate;

  /** Optional addon routes (e.g. OAuth DCR). */
  readonly jmapApiAddons?: IJmapApiAddon[];

  /** Optional: absolute URL of this auth provider's OAuth issuer,
   *  if OAuth DCR/discovery is enabled — undefined otherwise. jmap-api uses this
   *  to build its own RFC 9728 protected-resource metadata document. */
  readonly oauthIssuerUrl?: string;

  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
}

/** Per-route throttle settings, keyed PascalCase because CloudFormation receives them unmapped. */
interface RouteThrottleSettings {
  readonly ThrottlingBurstLimit: number;
  readonly ThrottlingRateLimit: number;
}

/** The `RouteSettings` of an API Gateway stage, keyed by route key (`<METHOD> <path>`). */
interface StageRouteSettings {
  [routeKey: string]: RouteThrottleSettings;
}

/**
 * The JMAP HTTP API: the JMAP session, API and upload routes behind a Lambda authorizer (the
 * session route is anonymous), the routes its addons mount, an optional custom domain, and, when
 * an OAuth issuer is given, the RFC 9728 protected-resource metadata document.
 *
 * It does not create the DNS record for the custom domain (it exposes `domainTarget` for that),
 * and it does not decide who is authorized (the authorizer Lambda does).
 */
export class JMapApi extends Construct {
  /** RFC 9728 OAuth protected-resource well-known path (with leading slash for HTTP routes). */
  private static readonly OAUTH_PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

  /** The API's base URL: `https://<domainName>` with a custom domain, the API Gateway endpoint otherwise. */
  public readonly url: string;
  /** CNAME target to publish (API Gateway regional domain) when custom domain is enabled. */
  public readonly domainTarget?: string;
  /** The authorizer that protects this API's routes, for other APIs that authorize the same callers. */
  public readonly authorizerLambda: IFunction;
  /** The underlying HTTP API, for constructs that add routes to it. */
  public readonly httpApi: IHttpApi;
  /** L1 CfnDomainName resource, for logical-ID pinning. Present only when domainName was provided. */
  public readonly domainCfnResource?: CfnResource;
  private readonly apiHandlerLambda: IWebSocketPushTargetWithUrl;

  constructor(scope: Construct, id: string, props: JMapApiProps) {
    super(scope, id);

    const lambdaAuthorizer = new AuthorizerLambda(this, 'lambda-authorizer', {
      authKeyStoreTable: props.authKeyStoreTable,
      configTable: props.configTable,
      artifactResolver: props.artifactResolver,
      anonymousRoutes: ['GET /.well-known/jmap'],
      serviceName: 'authorizer-jmap-api',
      pipeline: 'jmap',
    });

    this.authorizerLambda = lambdaAuthorizer;

    const api = new HttpApi(this, 'jmap-api', {
      apiName: `Mailbox ${Aws.STACK_NAME} JMAP API`,
      description: 'This service serves mailbox operations.',
      corsPreflight:
        props.allowedOrigins && props.allowedOrigins.length > 0
          ? {
            allowOrigins: props.allowedOrigins,
            allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
            allowHeaders: ['Content-Type', 'Authorization'],
            allowCredentials: true,
            maxAge: Duration.hours(1),
          }
          : undefined,
    });

    if (props.domainName) {
      if (!props.certificate) {
        throw new Error('JMapApi: certificate is required when domainName is provided');
      }

      const domain = new DomainName(this, 'domain', {
        domainName: props.domainName,
        certificate: props.certificate,
        endpointType: EndpointType.REGIONAL,
        securityPolicy: SecurityPolicy.TLS_1_2,
      });

      // Be explicit: the domain must be deleted before the certificate.
      domain.node.addDependency(props.certificate);

      this.domainCfnResource = domain.node.defaultChild as CfnResource;

      new ApiMapping(this, 'mapping', {
        api,
        domainName: domain,
        stage: api.defaultStage!,
      });

      this.url          = `https://${props.domainName}`;
      this.domainTarget = domain.regionalDomainName;
    } else {
      this.url = api.apiEndpoint;
    }

    this.httpApi = api;

    const apiHandlerLambda = new ApiHandlerLambda(this, 'jmap-api-handler', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      authKeyStoreTable: props.authKeyStoreTable,
      blobStore: props.blobStore,
      emailSubmissionQueue: props.emailSubmissionQueue,
      auditEventsQueue: props.auditEventsQueue,
      cdnHost: props.cdnHost,
      apiBaseUrl: this.url,
      artifactResolver: props.artifactResolver,
      identityProvisioner: props.identityProvisioner,
      vendorAccountIds: props.vendorAccountIds,
      oauthHandlerConfig: {
        scopeMap: props.authProvider.scopeMap,
      } satisfies JmapOAuthHandlerConfig,
      oauthProtectedResourceUrl: props.oauthIssuerUrl ? `${this.url}${JMapApi.OAUTH_PROTECTED_RESOURCE_PATH}` : undefined,
    });
    this.apiHandlerLambda  = apiHandlerLambda;

    // Instance A: default identity source and caching for authenticated routes
    const httpLambdaAuthorize = new HttpLambdaAuthorizer('authorizer', lambdaAuthorizer);
    // Instance B: no identity source, no caching for anonymous discovery route
    const httpLambdaAuthorizeAnonymous = new HttpLambdaAuthorizer('authorizer-anonymous', lambdaAuthorizer, {
      identitySource: [],
      resultsCacheTtl: Duration.seconds(0),
    });

    const httpLambdaIntegration = new HttpLambdaIntegration('handler', apiHandlerLambda);

    api.addRoutes({
      path: '/.well-known/jmap',
      methods: [HttpMethod.GET],
      authorizer: httpLambdaAuthorizeAnonymous,
      integration: httpLambdaIntegration,
    });
    api.addRoutes({
      path: '/',
      methods: [HttpMethod.POST],
      authorizer: httpLambdaAuthorize,
      integration: httpLambdaIntegration,
    });
    api.addRoutes({
      path: '/upload/{accountId}',
      methods: [HttpMethod.POST],
      authorizer: httpLambdaAuthorize,
      integration: httpLambdaIntegration,
    });

    for (const addon of props.jmapApiAddons ?? []) {
      addon.addRoutes(api);
    }

    if (props.oauthIssuerUrl) {
      this.addOAuthProtectedResourceRoute(api, props.oauthIssuerUrl, props.artifactResolver);
    }
  }

  /** Lets the handler Lambda publish through `broadcaster` to the WebSocket API at `webSocketUrl`. */
  public enableWebSocketPublishing(webSocketUrl: string, broadcaster: IWebSocketBroadcastPublisher): void {
    this.apiHandlerLambda.enableWebSocketPush(webSocketUrl, broadcaster);
  }

  /**
   * Serves the RFC 9728 protected-resource metadata document straight from the shared public
   * static-assets bucket through an HTTP URL integration, so the route costs no Lambda invocation,
   * and throttles that route.
   */
  private addOAuthProtectedResourceRoute(api: HttpApi, oauthIssuerUrl: string, artifactResolver: IArtifactResolver): void {
    const protectedResourceDoc = {
      resource: this.url,
      authorization_servers: [oauthIssuerUrl],
    };

    const bucket   = PublicStaticAssetsBucket.getOrCreate(this, artifactResolver);
    const deployer = StaticContentDeployer.getOrCreate(this, artifactResolver);

    deployer.deploy(this, 'oauth-protected-resource', {
      targetBucket: bucket,
      source: StaticContentSource.data(
        JMapApi.OAUTH_PROTECTED_RESOURCE_PATH.slice(1),
        JSON.stringify(protectedResourceDoc),
        { contentType: 'application/json', cacheControl: 'public, max-age=3600' },
      ),
    });

    const protectedResourceIntegration = new HttpUrlIntegration(
      'protected-resource',
      `https://${bucket.bucketRegionalDomainName}${JMapApi.OAUTH_PROTECTED_RESOURCE_PATH}`,
    );

    const protectedResourceRoutes = api.addRoutes({
      path: JMapApi.OAUTH_PROTECTED_RESOURCE_PATH,
      methods: [HttpMethod.GET],
      integration: protectedResourceIntegration,
    });

    const cfnStage = api.defaultStage!.node.defaultChild as CfnStage;

    // API Gateway rejects a RouteSettings entry whose route does not exist yet, and CloudFormation
    // updates the Stage before creating the Route unless told otherwise:
    //   "Unable to find Route by key ... within the provided RouteSettings"
    protectedResourceRoutes.forEach((route) => {
      cfnStage.addDependency(route.node.defaultChild as CfnResource);
    });

    const existingSettings: StageRouteSettings | undefined = cfnStage.routeSettings;
    const routeSettings: StageRouteSettings                = {
      ...existingSettings,
      [`GET ${JMapApi.OAUTH_PROTECTED_RESOURCE_PATH}`]: {
        ThrottlingBurstLimit: 20,
        ThrottlingRateLimit: 10,
      },
    };

    cfnStage.routeSettings = routeSettings;
  }
}
