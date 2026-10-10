import { Construct } from 'constructs';
import { AuthorizerLambda, ApiHandlerLambda } from '../../lambdas';
import type { JmapOAuthHandlerConfig } from '../../lambdas/jmap-api';
import type { IIdentityProvisioner } from '../../lambdas/identity-provisioner';
import {
  ApiMapping,
  CorsHttpMethod,
  CfnStage,
  DomainName,
  EndpointType,
  HttpApi,
  HttpMethod,
  SecurityPolicy,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration, HttpUrlIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { IDataTable } from '../../data/data-tables';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Duration, Aws, CfnResource } from 'aws-cdk-lib';
import type { IDataBlobStore } from '../../data/data-blob-store';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { PublicStaticAssetsBucket, StaticContentDeployer, StaticContentSource } from '@serverlessinbox/mailbox-cdk-shared';
import { IMailboxAuthProvider } from '../../auth/types';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTargetWithUrl } from '../websocket/websocket';
import type { IJmapApiAddon } from '../addons';
import type { IAuditEventsQueue } from '../../features/audit-writing/audit-events-queue';
import type { IEmailSendingQueue } from '../../email/sending/email-sending-queue';
import type { IAuthKeyStoreTable } from '../../features/auth-key-store/auth-key-store-table';

export interface JMapApiProps {
  readonly configTable: IDataTable;
  readonly itemTable: IDataTable;
  readonly changelogTable: IDataTable;
  readonly authKeyStoreTable: IAuthKeyStoreTable;
  readonly blobStore: IDataBlobStore;
  readonly emailSubmissionQueue: IEmailSendingQueue;
  readonly auditEventsQueue: IAuditEventsQueue;

  /** OAuth clientId to advertise in the JMAP session response (must be JMAP_UI). */
  readonly oauthClientId: string;

  readonly cdnHost: string;
  readonly allowedOrigins?: string[];

  readonly webSocketUrl?: string;
  readonly webSocketCapabilityDomain?: string;

  readonly artifactResolver: IArtifactResolver;
  readonly authProvider: IMailboxAuthProvider;

  /** Pre-constructed identity-provisioner function. Passed through to ApiHandlerLambda. */
  readonly identityProvisioner: IIdentityProvisioner;

  /** Optional custom domain name for this API (e.g. jmap.example.com). */
  readonly domainName?: string;

  /** ACM certificate for domainName (must be regional, in the same region as the stack/API). */
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

export class JMapApi extends Construct {
  /** RFC 9728 OAuth protected-resource well-known path (with leading slash for HTTP routes). */
  private static readonly OAUTH_PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

  url: string;
  /** CNAME target to publish (API Gateway regional domain) when custom domain is enabled. */
  public readonly domainTarget?: string;
  authorizerLambda: AuthorizerLambda; // Exposed for reuse in WebSocket API
  private readonly apiHandlerLambda: IWebSocketPushTargetWithUrl;
  /** Exposed for constructs that need the underlying IHttpApi (e.g. McpApi). */
  public readonly httpApi: HttpApi;
  /** L1 CfnDomainName resource, for logical-ID pinning. Present only when domainName was provided. */
  public readonly domainCfnResource?: CfnResource;

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

      this.url = `https://${props.domainName}`;
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
        issuer: props.authProvider.issuer,
        tokenEndpoint: props.authProvider.tokenEndpoint,
        authorizationEndpoint: props.authProvider.authorizationEndpoint,
        clientId: props.oauthClientId,
        scopeMap: props.authProvider.scopeMap,
      } satisfies JmapOAuthHandlerConfig,
      oauthProtectedResourceUrl: props.oauthIssuerUrl ? `${this.url}${JMapApi.OAUTH_PROTECTED_RESOURCE_PATH}` : undefined,
    });
    this.apiHandlerLambda = apiHandlerLambda;

    // Instance A: default identity source and caching for authenticated routes
    const httpLambdaAuthorize = new HttpLambdaAuthorizer('authorizer', lambdaAuthorizer);
    // Instance B: no identity source, no caching for anonymous discovery route
    const httpLambdaAuthorizeAnonymous = new HttpLambdaAuthorizer('authorizer-anonymous', lambdaAuthorizer, {
      identitySource: [],
      resultsCacheTtl: Duration.seconds(0),
    });
    this.authorizerLambda = lambdaAuthorizer;

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

    // Mount addon-provided routes (e.g. OAuth DCR)
    for (const addon of props.jmapApiAddons ?? []) {
      addon.addRoutes(api);
    }

    // Mount RFC 9728 OAuth protected-resource well-known document (if enabled)
    if (props.oauthIssuerUrl) {
      const protectedResourceDoc = {
        resource: this.url,
        authorization_servers: [props.oauthIssuerUrl],
      };

      // Deploy to the shared public-static-assets bucket
      const bucket = PublicStaticAssetsBucket.getOrCreate(this, props.artifactResolver);
      const deployer = StaticContentDeployer.getOrCreate(this, props.artifactResolver);

      deployer.deploy(this, 'oauth-protected-resource', {
        targetBucket: bucket,
        source: StaticContentSource.data(
          JMapApi.OAUTH_PROTECTED_RESOURCE_PATH.slice(1),
          JSON.stringify(protectedResourceDoc),
          { contentType: 'application/json', cacheControl: 'public, max-age=3600' },
        ),
      });

      // Mount GET route via S3 proxy (zero Lambda invocation)
      const protectedResourceIntegration = new HttpUrlIntegration(
        'protected-resource',
        `https://${bucket.bucketRegionalDomainName}${JMapApi.OAUTH_PROTECTED_RESOURCE_PATH}`,
      );

      const protectedResourceRoutes = api.addRoutes({
        path: JMapApi.OAUTH_PROTECTED_RESOURCE_PATH,
        methods: [HttpMethod.GET],
        integration: protectedResourceIntegration,
      });

      // Apply per-route throttling via the L1 CfnStage (merge with any existing settings)
      const cfnStage = api.defaultStage!.node.defaultChild as CfnStage;

      // API Gateway rejects a RouteSettings entry whose route does not exist yet, and CloudFormation
      // updates the Stage before creating the Route unless told otherwise:
      //   "Unable to find Route by key ... within the provided RouteSettings"
      protectedResourceRoutes.forEach((route) => {
        cfnStage.addDependency(route.node.defaultChild as CfnResource);
      });
      const existingSettings = cfnStage.routeSettings as Record<string, any> || {};
      const routeSettings: Record<string, any> = { ...existingSettings };

      // Keys MUST be PascalCase — this map is passed through to CloudFormation unmapped, and
      // camelCase fails the deploy with `Unrecognized field "throttlingBurstLimit"`.
      routeSettings[`GET ${JMapApi.OAUTH_PROTECTED_RESOURCE_PATH}`] = {
        ThrottlingBurstLimit: 20,
        ThrottlingRateLimit: 10,
      };

      cfnStage.routeSettings = routeSettings;
    }
  }

  public enableWebSocketPublishing(webSocketUrl: string, broadcaster: IWebSocketBroadcastPublisher): void {
    this.apiHandlerLambda.enableWebSocketPush(webSocketUrl, broadcaster);
  }
}
