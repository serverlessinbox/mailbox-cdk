import { Construct } from 'constructs';
import { AuthorizerLambda, ApiHandlerLambda, UserProvisionerLambda } from '../lambdas';
import type { JmapOAuthHandlerConfig } from '../lambdas/jmap-api';
import {
  ApiMapping,
  CorsHttpMethod,
  DomainName,
  EndpointType,
  HttpApi,
  HttpMethod,
  SecurityPolicy,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Duration, Aws } from 'aws-cdk-lib';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import type { ICdkArtifactResolver } from '../artifacts/cdk-artifact-resolver';
import { IMailboxAuthProvider } from '../auth/types';
import { GoLambda } from '../utils/go-lambda';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import type { IWebSocketBroadcastPublisher } from './websocket';

export interface JMapApiProps {
  readonly configTable: ITable;
  readonly itemTable: ITable;
  readonly changelogTable: ITable;
  readonly authKeyStoreTable: ITable;
  readonly blobStore: IBucket;
  readonly emailSubmissionQueue: IQueue;
  readonly auditEventsQueue: IQueue;

  /** OAuth clientId to advertise in the JMAP session response (must be JMAP_UI). */
  readonly oauthClientId: string;

  readonly cdnHost: string;
  readonly allowedOrigins?: string[];

  readonly webSocketUrl?: string;
  readonly webSocketCapabilityDomain?: string;

  readonly artifactResolver: ICdkArtifactResolver;
  readonly authProvider: IMailboxAuthProvider;

  readonly sesConfigSetName: string;

  /** Full URL of the Admin UI (e.g. https://admin.example.com). Forwarded to user-provisioner for welcome email CTA. */
  readonly adminUIURL: string;

  /** Optional custom domain name for this API (e.g. jmap.example.com). */
  readonly domainName?: string;

  /** ACM certificate for domainName (must be regional, in the same region as the stack/API). */
  readonly certificate?: acm.ICertificate;
}

export class JMapApi extends Construct {
  url: string;
  /** CNAME target to publish (API Gateway regional domain) when custom domain is enabled. */
  public readonly domainTarget?: string;
  authorizerLambda: GoLambda; // Exposed for reuse in WebSocket API
  apiHandlerLambda: GoLambda; // Exposed to add WebSocket URL env var
  /** Exposed so callers can set additional env vars (e.g. SYSTEM_SENDER_ADDRESS) after construction. */
  public readonly userProvisionerLambda: GoLambda;
  /** Exposed for constructs that need the underlying IHttpApi (e.g. McpApi). */
  public readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: JMapApiProps) {
    super(scope, id);

    const lambdaAuthorizer = new AuthorizerLambda(this, 'lambda-authorizer', {
      authKeyStoreTable: props.authKeyStoreTable,
      configTable: props.configTable,
      userPoolIssuer: props.authProvider.issuer,
      artifactResolver: props.artifactResolver,
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

    const userProvisionerLambda = new UserProvisionerLambda(this, 'user-provisioner', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      auditEventsQueue: props.auditEventsQueue,
      artifactResolver: props.artifactResolver,
      adminUIURL: props.adminUIURL,
      blobStore: props.blobStore,
      emailSubmissionQueue: props.emailSubmissionQueue,
      sesConfigSetName: props.sesConfigSetName,
    });
    this.userProvisionerLambda = userProvisionerLambda;

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
      sesConfigSetName: props.sesConfigSetName,
      artifactResolver: props.artifactResolver,
      userProvisionionFunction: userProvisionerLambda,
      oauthHandlerConfig: {
        issuer: props.authProvider.issuer,
        tokenEndpoint: props.authProvider.tokenEndpoint,
        authorizationEndpoint: props.authProvider.authorizationEndpoint,
        clientId: props.oauthClientId,
        scopeMap: props.authProvider.scopeMap,
      } satisfies JmapOAuthHandlerConfig,
    });
    this.apiHandlerLambda = apiHandlerLambda;

    const httpLambdaAuthorize = new HttpLambdaAuthorizer('authorizer', lambdaAuthorizer);
    this.authorizerLambda = lambdaAuthorizer;

    const httpLambdaIntegration = new HttpLambdaIntegration('handler', apiHandlerLambda);

    api.addRoutes({
      path: '/.well-known/jmap',
      methods: [HttpMethod.GET],
      authorizer: httpLambdaAuthorize,
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
  }

  public enableWebSocketPublishing(webSocketUrl: string, broadcaster: IWebSocketBroadcastPublisher): void {
    this.apiHandlerLambda.addEnvironment('WEBSOCKET_URL', webSocketUrl);

    this.apiHandlerLambda.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this.apiHandlerLambda);
  }
}
