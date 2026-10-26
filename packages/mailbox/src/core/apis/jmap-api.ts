import type { IArtifactResolver }                                                                     from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription, PublicStaticAssetsBucket, StaticContentDeployer, StaticContentSource } from '@serverlessinbox/mailbox-cdk-shared';
import { HttpLambdaAuthorizer }                                                                       from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration, HttpUrlIntegration }                                                  from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  ApiMapping,
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  IHttpApi,
  IHttpStage,
} from 'aws-cdk-lib/aws-apigatewayv2';
import type { CorsPreflightOptions }                                          from 'aws-cdk-lib/aws-apigatewayv2';
import type { IFunction }                                                     from 'aws-cdk-lib/aws-lambda';
import { Duration, Aws, CfnResource }                                         from 'aws-cdk-lib';
import { Construct }                                                          from 'constructs';
import type { IConstruct }                                                    from 'constructs';

import { AuthPolicyName }                                                     from '../../contracts/auth-names';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTargetWithUrl }     from '../../contracts/websocket-push';
import type { IDataBlobStore }                                                from '../../resources/buckets/data-blob-store';
import { AuthorizerLambda }                                                   from '../../resources/lambdas/authorizer-lambda';
import type { IIdentityProvisioner }                                          from '../../resources/lambdas/identity-provisioner-lambda';
import { JmapApiLambda }                                                      from '../../resources/lambdas/jmap-api-lambda';
import type { IAuditEventsQueue }                                             from '../../resources/queues/audit-events-queue';
import type { IEmailSendingQueue }                                            from '../../resources/queues/email-sending-queue';
import type { IAuthKeyStoreTable }                                            from '../../resources/tables/auth-key-store-table';
import type { IDataTable }                                                    from '../../resources/tables/data-tables';
import { IMailboxAuthProvider }                                               from '../auth/auth-provider';

import type { IJmapApiAddon }                                                 from './addons';
import { ApiCustomDomain }                                                    from './api-custom-domain';
import type { ApiCustomDomainProps, ILogicalIdPin }                           from './api-custom-domain';

/**
 * Inputs of {@link JmapApi}: the tables, queues and blob store its handler Lambda works on, the
 * addons that mount further routes, the optional custom domain and the optional OAuth issuer that
 * switches on the protected-resource metadata document.
 */
export interface JmapApiProps {
  readonly configTable:          IDataTable;
  readonly itemTable:            IDataTable;
  readonly changelogTable:       IDataTable;
  readonly authKeyStoreTable:    IAuthKeyStoreTable;
  readonly blobStore:            IDataBlobStore;
  readonly emailSubmissionQueue: IEmailSendingQueue;
  readonly auditEventsQueue:     IAuditEventsQueue;

  readonly cdnHost: string;
  /** Origins allowed by the API's CORS preflight. Without any, no CORS configuration is created. */
  readonly allowedOrigins?: string[];

  readonly artifactResolver: IArtifactResolver;
  readonly authProvider:     IMailboxAuthProvider;

  /** Pre-constructed identity-provisioner function. Passed through to JmapApiLambda. */
  readonly identityProvisioner: IIdentityProvisioner;

  /** Optional custom domain (e.g. jmap.example.com) to serve this API on. */
  readonly customDomain?: ApiCustomDomainProps;

  /** Optional addon routes (e.g. OAuth DCR). */
  readonly jmapApiAddons?: IJmapApiAddon[];

  /** Optional: absolute URL of this auth provider's OAuth issuer,
   *  if OAuth DCR/discovery is enabled — undefined otherwise. jmap-api uses this
   *  to build its own RFC 9728 protected-resource metadata document. */
  readonly oauthIssuerUrl?: string;

  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
}

/**
 * The JMAP HTTP API: the JMAP session, API and upload routes behind a Lambda authorizer (the
 * session route is anonymous), the routes its addons mount, an optional custom domain, and, when
 * an OAuth issuer is given, the RFC 9728 protected-resource metadata document.
 *
 * It does not create the DNS record for the custom domain (it exposes `domainTarget` for that),
 * and it does not decide who is authorized (the authorizer Lambda does).
 */
export class JmapApi extends Construct {
  /** RFC 9728 OAuth protected-resource well-known path (with leading slash for HTTP routes). */
  private static readonly OAUTH_PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

  /** The API's base URL: `https://<domainName>` with a custom domain, the API Gateway endpoint otherwise. */
  public readonly url: string;
  /** CNAME target to publish (API Gateway regional domain) when custom domain is enabled. */
  public readonly domainTarget?: string;
  /** Fixes the logical id of the custom domain name. Present only when a custom domain is set. */
  public readonly domainLogicalIdPin?: ILogicalIdPin;
  /** The authorizer that protects this API's routes, for other APIs that authorize the same callers. */
  public readonly authorizerLambda: IFunction;
  /** The underlying HTTP API, for constructs that add routes to it. */
  public readonly httpApi: IHttpApi;
  private readonly apiHandlerLambda: IWebSocketPushTargetWithUrl;
  private readonly defaultStage: IHttpStage;

  constructor(scope: Construct, id: string, props: JmapApiProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'JMAP protocol API — the mail client endpoint for sync, query and message submission.');

    const lambdaAuthorizer = new AuthorizerLambda(this, 'lambda-authorizer', {
      authKeyStoreTable: props.authKeyStoreTable,
      configTable:       props.configTable,
      artifactResolver:  props.artifactResolver,
      authPolicyName:    AuthPolicyName.JMAP_API,
      anonymousRoutes:   ['GET /.well-known/jmap'],
      serviceName:       'authorizer-jmap-api',
      pipeline:          'jmap',
    });

    this.authorizerLambda = lambdaAuthorizer;

    const api         = new HttpApi(this, 'jmap-api', {
      apiName:            `Mailbox ${Aws.STACK_NAME} JMAP API`,
      createDefaultStage: false,
      description:        'This service serves mailbox operations.',
      corsPreflight:      this.corsPreflight(props.allowedOrigins),
      ...(props.customDomain ? { disableExecuteApiEndpoint: true } : {}),
    });
    this.defaultStage = api.addStage('DefaultStage', {
      autoDeploy: true,
      throttle:   { rateLimit: 100, burstLimit: 200 },
    });

    if (props.customDomain) {
      const domain = this.addCustomDomain(api, props.customDomain);

      this.url                = `https://${props.customDomain.domainName}`;
      this.domainTarget       = domain.regionalDomainName;
      this.domainLogicalIdPin = domain.logicalIdPin;
    } else {
      this.url = api.apiEndpoint;
    }

    this.httpApi = api;

    this.apiHandlerLambda = this.createHandlerLambda(props);

    this.addJmapRoutes(api, lambdaAuthorizer);

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

  private corsPreflight(allowedOrigins: string[] | undefined): CorsPreflightOptions | undefined {
    if (!allowedOrigins || allowedOrigins.length === 0) {
      return undefined;
    }

    return {
      allowOrigins:     allowedOrigins,
      allowMethods:     [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
      allowHeaders:     ['Content-Type', 'Authorization'],
      allowCredentials: true,
      maxAge:           Duration.hours(1),
    };
  }

  private addCustomDomain(api: HttpApi, customDomain: ApiCustomDomainProps): ApiCustomDomain {
    const domain = new ApiCustomDomain(this, 'domain', customDomain);

    new ApiMapping(this, 'mapping', {
      api,
      domainName: domain,
      stage:      this.defaultStage,
    });

    return domain;
  }

  private createHandlerLambda(props: JmapApiProps): JmapApiLambda {
    return new JmapApiLambda(this, 'jmap-api-handler', {
      configTable:               props.configTable,
      itemTable:                 props.itemTable,
      changelogTable:            props.changelogTable,
      authKeyStoreTable:         props.authKeyStoreTable,
      blobStore:                 props.blobStore,
      emailSubmissionQueue:      props.emailSubmissionQueue,
      auditEventsQueue:          props.auditEventsQueue,
      cdnHost:                   props.cdnHost,
      apiBaseUrl:                this.url,
      artifactResolver:          props.artifactResolver,
      identityProvisioner:       props.identityProvisioner,
      vendorAccountIds:          props.vendorAccountIds,
      scopeMap:                  props.authProvider.scopeMap,
      oauthProtectedResourceUrl: props.oauthIssuerUrl ? `${this.url}${JmapApi.OAUTH_PROTECTED_RESOURCE_PATH}` : undefined,
    });
  }

  private addJmapRoutes(api: HttpApi, lambdaAuthorizer: AuthorizerLambda): void {
    const authenticatedAuthorizer = new HttpLambdaAuthorizer('authorizer', lambdaAuthorizer);
    const anonymousAuthorizer     = new HttpLambdaAuthorizer('authorizer-anonymous', lambdaAuthorizer, {
      identitySource:  [],
      resultsCacheTtl: Duration.seconds(0),
    });

    const httpLambdaIntegration = new HttpLambdaIntegration('handler', this.apiHandlerLambda);

    api.addRoutes({
      path:        '/.well-known/jmap',
      methods:     [HttpMethod.GET],
      authorizer:  anonymousAuthorizer,
      integration: httpLambdaIntegration,
    });
    api.addRoutes({
      path:        '/',
      methods:     [HttpMethod.POST],
      authorizer:  authenticatedAuthorizer,
      integration: httpLambdaIntegration,
    });
    api.addRoutes({
      path:        '/upload/{accountId}',
      methods:     [HttpMethod.POST],
      authorizer:  authenticatedAuthorizer,
      integration: httpLambdaIntegration,
    });
  }

  /**
   * Serves the RFC 9728 protected-resource metadata document straight from the shared public
   * static-assets bucket through an HTTP URL integration, so the route costs no Lambda invocation,
   * and throttles that route.
   */
  private addOAuthProtectedResourceRoute(api: HttpApi, oauthIssuerUrl: string, artifactResolver: IArtifactResolver): void {
    const protectedResourceDoc = {
      resource:              this.url,
      authorization_servers: [oauthIssuerUrl],
    };

    const bucket   = PublicStaticAssetsBucket.getOrCreate(this, artifactResolver);
    const deployer = StaticContentDeployer.getOrCreate(this, artifactResolver);

    deployer.deploy(this, 'oauth-protected-resource', {
      targetBucket: bucket,
      source:       StaticContentSource.data(
        JmapApi.OAUTH_PROTECTED_RESOURCE_PATH.slice(1),
        JSON.stringify(protectedResourceDoc),
        { contentType: 'application/json', cacheControl: 'public, max-age=3600' },
      ),
    });

    const protectedResourceIntegration = new HttpUrlIntegration(
      'protected-resource',
      `https://${bucket.bucketRegionalDomainName}${JmapApi.OAUTH_PROTECTED_RESOURCE_PATH}`,
    );

    const protectedResourceRoutes = api.addRoutes({
      path:        JmapApi.OAUTH_PROTECTED_RESOURCE_PATH,
      methods:     [HttpMethod.GET],
      integration: protectedResourceIntegration,
    });

    const cfnStage = this.defaultCfnResource(this.defaultStage);

    // API Gateway rejects a RouteSettings entry whose route does not exist yet, and CloudFormation
    // updates the Stage before creating the Route unless told otherwise:
    //   "Unable to find Route by key ... within the provided RouteSettings"
    for (const route of protectedResourceRoutes) {
      cfnStage.addDependency(this.defaultCfnResource(route));
    }

    // A property override path is split on dots, so the dots of the route key are escaped.
    const routeKey = `GET ${JmapApi.OAUTH_PROTECTED_RESOURCE_PATH}`.replace(/\./g, '\\.');

    cfnStage.addPropertyOverride(`RouteSettings.${routeKey}`, {
      ThrottlingBurstLimit: 20,
      ThrottlingRateLimit:  10,
    });
  }

  private defaultCfnResource(construct: IConstruct | undefined): CfnResource {
    const resource = construct?.node.defaultChild;

    if (!CfnResource.isCfnResource(resource)) {
      throw new Error(`JmapApi ${this.node.path}: ${construct?.node.path ?? 'the construct'} has no CloudFormation resource as its default child`);
    }

    return resource;
  }
}
